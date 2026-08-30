import { describe, expect, it, vi } from 'vitest';
import {
  fingerprintWhatsAppGroupId,
  MockWhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';
import {
  COMMERCIAL_AUTOMATION_JOB_OPTIONS,
  JOB_NAMES,
  type WhatsAppDispatchJob,
} from '@shopee-auto-affiliate-ai/queue';
import { fingerprintCommercialOffer } from '../../api/src/commercial-offer-snapshot';
import {
  COMMERCIAL_AI_COPY_PROMPT_VERSION,
  COMMERCIAL_AI_COPY_VALIDATION_VERSION,
} from '../../api/src/commercial-ai-copy-prompt';
import { CommercialDispatchOutboxPublisher } from '../../api/src/commercial-dispatch-outbox-publisher';
import {
  COMMERCIAL_CONFIRMATION_TOKEN,
  CommercialPipelineConfirmationService,
} from '../../api/src/commercial-pipeline-confirmation-service';
import { WhatsAppGroupSendPolicy } from '../../api/src/whatsapp-group-send-policy';
import { processWhatsAppDispatchJob } from '../src/whatsapp-dispatch-worker';
import type { WhatsAppDispatchProcessorRepositories } from '../src/whatsapp-dispatch-worker';
import type {
  CommercialDispatchOutboxRecord,
  CommercialDispatchOutboxRepository,
  CommercialPipelineRunFinalizationRepository,
  CommercialPipelineRunRecord,
  CommercialPipelineRunRepository,
  ShopeeOfferRecord,
  WhatsAppDispatchDetails,
  WhatsAppDispatchRepository,
  WhatsAppDispatchRecord,
  WhatsAppGroupRecord,
} from '../../api/src/repositories';

const now = new Date('2026-08-08T12:00:00.000Z');
const productLink = 'https://shopee.com.br/product/1/1';
const affiliateLink = 'https://shope.ee/affiliate-product-1';
const groupDestination = '120363000000000000@g.us';

const group: WhatsAppGroupRecord = {
  id: 'group-1',
  name: 'Grupo comercial',
  destination: groupDestination,
  type: 'GROUP',
  active: true,
  available: true,
  fingerprint: fingerprintWhatsAppGroupId(groupDestination),
  sourceInstanceName: 'affiliate-bot',
  assignedInstanceName: 'affiliate-bot',
  discoveredAt: now,
  lastSyncedAt: now,
};

const offer: ShopeeOfferRecord = {
  id: 'product-1',
  source: 'OFFICIAL',
  providerProductId: 'official-product-1',
  productName: 'Produto comercial',
  shopName: 'Loja comercial',
  categoryIds: ['cat-1'],
  price: '99.90',
  priceMin: '99.90',
  priceMax: '99.90',
  discountRate: 20,
  rating: 4.8,
  sales: 100,
  commissionRate: 10,
  imageUrl: 'https://example.invalid/image.jpg',
  productLink,
  affiliateLink,
  fetchedAt: now,
  lastSeenAt: now,
  createdAt: now,
  updatedAt: now,
  score: 88,
  scoreUpdatedAt: now,
};

const createRun = (copyPreview: string): CommercialPipelineRunRecord => ({
  id: 'run-1',
  executionId: null,
  mode: 'DRY_RUN',
  status: 'COMPLETED',
  productId: offer.id,
  groupDestinationId: group.id,
  instanceName: 'affiliate-bot',
  productName: offer.productName,
  productPrice: offer.price,
  groupName: group.name,
  groupFingerprint: group.fingerprint,
  score: 88,
  candidateCount: 1,
  eligibleCount: 1,
  rejectedCount: 0,
  rejectionSummary: {},
  selectionReasons: ['candidate-flow'],
  copyPreview,
  plannedSubIds: [],
  dispatchId: null,
  jobId: null,
  confirmedAt: null,
  finalStatus: null,
  investigationRequired: false,
  failureCode: null,
  createdAt: now,
  completedAt: now,
});

const commercialFingerprint = fingerprintCommercialOffer({
  source: 'OFFICIAL',
  providerProductId: offer.providerProductId,
  productLink,
  affiliateLink,
  price: offer.price,
  priceMin: offer.priceMin,
  priceMax: offer.priceMax,
  discountRate: offer.discountRate,
  commissionRate: offer.commissionRate,
  offerStartsAt: null,
  offerEndsAt: null,
  unavailableAt: null,
});
describe('commercial candidate dispatch integration', () => {
  it('confirma, reserva, envia IMAGE e finaliza o candidato sem copy legacy', async () => {
    let candidateStatus: 'COPY_READY' | 'RESERVED' | 'DISPATCHED' =
      'COPY_READY';
    const caption = `Oferta validada\n\nConfira: ${affiliateLink}`;
    let run = createRun(caption);
    let dispatch: WhatsAppDispatchRecord | null = null;
    let outbox: CommercialDispatchOutboxRecord | null = null;
    const legacyCopies: unknown[] = [];
    const jobs = new Set<string>();

    const candidate = () => ({
      id: 'candidate-1',
      campaignId: 'campaign-1',
      campaign: {
        id: 'campaign-1',
        logicalGroupFingerprint: group.fingerprint,
      },
      productId: offer.id,
      snapshotId: 'snapshot-1',
      generatedCopyId: 'copy-1',
      status: candidateStatus,
      expiresAt: null,
      product: {
        id: offer.id,
        source: offer.source,
        providerProductId: offer.providerProductId,
        productName: offer.productName,
        shopName: offer.shopName,
        productLink,
        affiliateLink,
        price: offer.price,
        priceMin: offer.priceMin,
        priceMax: offer.priceMax,
        discountRate: offer.discountRate,
        commissionRate: offer.commissionRate,
        rating: offer.rating,
        sales: offer.sales,
        offerStartsAt: null,
        urlImagem: offer.imageUrl,
        offerEndsAt: null,
        unavailableAt: null,
        commercialSnapshotRevision: 1,
        commercialSnapshotFingerprint: commercialFingerprint,
        updatedAt: now,
      },
      snapshot: {
        id: 'snapshot-1',
        productId: offer.id,
        revision: 1,
        fingerprint: commercialFingerprint,
        unavailableAt: null,
        offerEndsAt: null,
      },
    });
    const generatedCopy = (): WhatsAppDispatchDetails['generatedCopy'] => ({
      id: 'copy-1',
      productId: offer.id,
      snapshotId: 'snapshot-1',
      createdFromCandidateId: 'candidate-1',
      source: 'AI',
      promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
      validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
      titulo: 'Oferta validada',
      mensagem: 'Produto com dados atuais.',
      cta: `Confira: ${affiliateLink}`,
      hashtags: '#oferta',
      promotionCandidates: [candidate()],
    });

    const dispatchDetails = (): WhatsAppDispatchDetails => ({
      id: dispatch?.id ?? 'dispatch-1',
      productId: offer.id,
      generatedCopyId: 'copy-1',
      destinationId: group.id,
      instanceName: 'affiliate-bot',
      status: dispatch?.status ?? 'PENDING',
      attemptCount: dispatch?.attemptCount ?? 0,
      errorMessage: dispatch?.errorMessage ?? null,
      sentAt: dispatch?.sentAt ?? null,
      externalMessageId: dispatch?.externalMessageId ?? null,
      createdAt: now,
      updatedAt: now,
      destination: group,
      product: {
        comissao: offer.commissionRate,
        urlImagem: offer.imageUrl,
        affiliateLink: offer.affiliateLink,
      },
      generatedCopy: generatedCopy(),
    });

    const runs: CommercialPipelineRunRepository &
      CommercialPipelineRunFinalizationRepository = {
      create: vi.fn(),
      update: vi.fn(async (_id, data) => {
        run = { ...run, ...data };
        return run;
      }),
      list: vi.fn(),
      findById: vi.fn(async (id) => (id === run.id ? run : null)),
      findByExecutionId: vi.fn(async (id) => (id === run.id ? run : null)),
      findByDispatchId: vi.fn(async (id) =>
        id === (dispatch?.id ?? 'dispatch-1') ? run : null,
      ),
      finalizeByDispatchId: vi.fn(async (_dispatchId, completedAt) => {
        if (!dispatch || dispatch.status !== 'SENT') {
          return { kind: 'AMBIGUOUS' as const, transitioned: false };
        }
        run = {
          ...run,
          status: 'COMPLETED',
          finalStatus: 'SENT',
          investigationRequired: false,
          failureCode: null,
          completedAt,
        };
        return { kind: 'SENT' as const, transitioned: true };
      }),
    };

    const outboxes: CommercialDispatchOutboxRepository = {
      createPendingConfirmation: vi.fn(async (input) => {
        if (
          run.mode !== 'DRY_RUN' ||
          run.status !== 'COMPLETED' ||
          candidateStatus !== 'COPY_READY'
        ) {
          return null;
        }
        if ('copy' in input) legacyCopies.push(input.copy);
        if (
          !('existingGeneratedCopyId' in input) ||
          input.existingGeneratedCopyId !== 'copy-1'
        ) {
          throw new Error('candidate copy was not reused');
        }
        candidateStatus = 'RESERVED';
        dispatch = {
          ...input.dispatch,
          status: 'PENDING',
          attemptCount: 0,
          errorMessage: null,
          sentAt: null,
          externalMessageId: null,
          createdAt: now,
          updatedAt: now,
        };
        outbox = {
          id: input.outboxId,
          commercialRunId: input.runId,
          dispatchId: input.dispatch.id,
          jobId: input.jobId,
          status: 'PENDING',
          instanceName: input.instanceName,
          failureCode: null,
          createdAt: input.confirmedAt,
          publishedAt: null,
        };
        run = {
          ...run,
          mode: 'CONFIRMED',
          status: 'STARTED',
          confirmedAt: input.confirmedAt,
          completedAt: null,
          dispatchId: input.dispatch.id,
          jobId: null,
          finalStatus: 'PENDING',
          investigationRequired: false,
          failureCode: null,
        };
        return outbox;
      }),
      list: vi.fn(async () => ({
        items: outbox ? [outbox] : [],
        total: outbox ? 1 : 0,
      })),
      findById: vi.fn(async (id) => (outbox?.id === id ? outbox : null)),
      findByDispatchId: vi.fn(async (id) =>
        outbox?.dispatchId === id ? outbox : null,
      ),
      findPublicationContext: vi.fn(async () =>
        outbox && dispatch ? { outbox, run, dispatch } : null,
      ),
      markPublished: vi.fn(async (id, publishedAt) => {
        if (!outbox || outbox.id !== id) return null;
        outbox = { ...outbox, status: 'PUBLISHED', publishedAt };
        run = { ...run, jobId: outbox.jobId };
        return outbox;
      }),
      markAmbiguous: vi.fn(async () => outbox),
    };

    const queue = {
      hasJob: vi.fn(async (jobId: string) => jobs.has(jobId)),
      enqueue: vi.fn(async (_dispatchId: string, jobId: string) => {
        jobs.add(jobId);
      }),
    };
    const confirmation = new CommercialPipelineConfirmationService({
      runs,
      offers: { findOfferById: vi.fn(async () => offer) } as never,
      groups: { list: vi.fn(async () => [group]) } as never,
      instances: {
        findByName: vi.fn(async (name: string) => ({
          name,
          active: true,
          createdAt: now,
          updatedAt: now,
        })),
      },
      outboxes,
      deliveryHistory: {
        wasProductSentToGroup: vi.fn(async () => false),
        findLastSentAtByGroup: vi.fn(async () => null),
      },
      copy: { generate: vi.fn(() => caption) },
      publisher: new CommercialDispatchOutboxPublisher({
        outboxes,
        queue,
        logger: { info: vi.fn(), error: vi.fn() },
        clock: () => now,
      }),
      instanceName: 'affiliate-bot',
      environment: {
        groupSendEnabled: true,
        safeMode: true,
        schedulerEnabled: false,
        maximumMessagesPerRun: 1,
      },
      logger: { info: vi.fn(), error: vi.fn() },
      clock: () => now,
    });

    await confirmation.confirm('run-1', COMMERCIAL_CONFIRMATION_TOKEN, {
      existingGeneratedCopyId: 'copy-1',
    });

    expect(candidateStatus).toBe('RESERVED');
    expect(outbox).toMatchObject({ status: 'PUBLISHED' });
    expect(legacyCopies).toHaveLength(0);

    const markAttemptPending = vi.fn(async () => {
      if (!dispatch || dispatch.status !== 'PENDING') return false;
      dispatch = { ...dispatch, status: 'PROCESSING', attemptCount: 1 };
      return true;
    });
    const markSent = vi.fn(
      async (
        _id: string,
        data: Parameters<WhatsAppDispatchRepository['markSent']>[1],
      ): Promise<WhatsAppDispatchRecord> => {
        const currentDispatch = dispatch;
        if (!currentDispatch) throw new Error('dispatch missing');
        const updatedDispatch: WhatsAppDispatchRecord = {
          ...currentDispatch,
          ...data,
          status: 'SENT',
          attemptCount: 1,
        };
        dispatch = updatedDispatch;
        return updatedDispatch;
      },
    );
    const markDispatchedByGeneratedCopyId = vi.fn(async () => {
      if (candidateStatus !== 'RESERVED') {
        throw new Error('unexpected candidate lifecycle');
      }
      candidateStatus = 'DISPATCHED';
      return {
        kind: 'DISPATCHED' as const,
        candidateId: 'candidate-1',
        campaignId: 'campaign-1',
        transitioned: true,
      };
    });
    const markBlockedByGeneratedCopyId = vi.fn(async () => {
      throw new Error('unexpected safe failure finalization');
    });
    const resetCampaignFailureStateByGeneratedCopyId = vi.fn(async () => ({
      kind: 'RESET' as const,
      campaignId: 'campaign-1',
      transitioned: true,
    }));
    const whatsappDispatches = {
      findByIdForSending: vi.fn(async () => dispatchDetails()),
      findByIdWithDetails: vi.fn(async () => dispatchDetails()),
      markAttemptPending,
      claimPendingForSending: vi.fn(async () =>
        (await markAttemptPending())
          ? { kind: 'CLAIMED' as const }
          : { kind: 'NOT_PENDING' as const },
      ),
      markSent,
      markFailed: vi.fn(),
      createPending: vi.fn(),
      list: vi.fn(),
    };
    const repositories: WhatsAppDispatchProcessorRepositories = {
      whatsappDispatches,
      commercialRuns: runs,
      commercialDispatchOutboxes: outboxes,
      whatsappInstances: {
        findByName: vi.fn(async (name: string) => ({
          name,
          active: true,
          createdAt: now,
          updatedAt: now,
        })),
      },
      commercialPromotions: {
        markDispatchedByGeneratedCopyId,
        markBlockedByGeneratedCopyId,
        resetCampaignFailureStateByGeneratedCopyId,
      },
    };
    const provider = new MockWhatsAppProvider();
    const groupSendPolicy = new WhatsAppGroupSendPolicy({
      enabled: true,
      safeMode: true,
      instanceName: 'affiliate-bot',
    });
    vi.spyOn(groupSendPolicy, 'assertAuthorized').mockImplementation(
      () => undefined,
    );
    const job: Pick<
      import('bullmq').Job<WhatsAppDispatchJob>,
      'id' | 'name' | 'data'
    > = {
      id: 'job-1',
      name: JOB_NAMES.whatsappDispatch,
      data: {
        dispatchId: 'commercial-run-1-dispatch',
        instanceName: 'affiliate-bot',
      },
    };

    await processWhatsAppDispatchJob(job, {
      repositories,
      whatsAppProvider: provider,
      whatsAppProviderResolver: vi.fn().mockResolvedValue(provider),
      groupSendPolicy,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(candidateStatus).toBe('DISPATCHED');
    expect(dispatch).toMatchObject({ status: 'SENT', attemptCount: 1 });
    expect(run).toMatchObject({
      status: 'COMPLETED',
      finalStatus: 'SENT',
      investigationRequired: false,
    });
    expect(provider.sentMessages).toHaveLength(1);
    expect(provider.sentMessages[0]).toMatchObject({
      destination: groupDestination,
      imageUrl: offer.imageUrl,
      destinationType: 'GROUP',
    });
    expect(markAttemptPending).toHaveBeenCalledOnce();
    expect(markDispatchedByGeneratedCopyId).toHaveBeenCalledWith('copy-1');
    expect(COMMERCIAL_AUTOMATION_JOB_OPTIONS.attempts).toBe(1);
  });
});
