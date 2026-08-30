import { describe, expect, it, vi } from 'vitest';
import type { WhatsAppProvider } from '@shopee-auto-affiliate-ai/providers';
import {
  JOB_NAMES,
  type WhatsAppDispatchJob,
} from '@shopee-auto-affiliate-ai/queue';
import { PrismaCommercialGroupCampaignAttemptRepository } from '../../api/src/prisma-repositories';
import {
  COMMERCIAL_AI_COPY_PROMPT_VERSION,
  COMMERCIAL_AI_COPY_VALIDATION_VERSION,
} from '../../api/src/commercial-ai-copy-prompt';
import { fingerprintCommercialOffer } from '../../api/src/commercial-offer-snapshot';
import type {
  CommercialAutomationExecutionRecord,
  CommercialPipelineRunFinalizationRepository,
  CommercialPipelineRunRecord,
  CommercialPipelineRunRepository,
  WhatsAppDispatchDetails,
  WhatsAppDispatchRecord,
  WhatsAppDispatchRepository,
} from '../../api/src/repositories';
import { WhatsAppGroupSendPolicy } from '../../api/src/whatsapp-group-send-policy';
import {
  processWhatsAppDispatchJob,
  type WhatsAppDispatchProcessorRepositories,
} from '../src/whatsapp-dispatch-worker';

const executionId = 'execution-handoff-integration';
const campaignId = 'campaign-handoff-integration';
const runId = 'run-handoff-integration';
const dispatchId = 'dispatch-handoff-integration';
const copyId = 'copy-handoff-integration';
const candidateId = 'candidate-handoff-integration';
const jobId = 'job-handoff-integration';
const startedAt = new Date('2026-08-21T12:00:00.000Z');
const now = new Date('2026-08-21T12:05:00.000Z');
const expiredLease = new Date('2026-08-21T12:02:00.000Z');
const renewedLease = new Date('2026-08-21T12:07:00.000Z');
const groupDestination = '120363000000000000@g.us';
const snapshotFingerprint = fingerprintCommercialOffer({
  source: 'OFFICIAL',
  providerProductId: 'provider-product-handoff-integration',
  productLink: 'https://shopee.com.br/product/1/1',
  affiliateLink: 'https://shope.ee/affiliate',
  price: '99.90',
  priceMin: '99.90',
  priceMax: '99.90',
  discountRate: 20,
  commissionRate: 10,
  offerStartsAt: null,
  offerEndsAt: null,
  unavailableAt: null,
});

const sameDate = (left: Date | null, right: Date | null) =>
  left?.getTime() === right?.getTime();

const createAttemptRepository = () => {
  let state = {
    attemptExecutionId: executionId as string | null,
    attemptReservedAt: startedAt as Date | null,
    attemptLeaseExpiresAt: expiredLease as Date | null,
  };
  type Delegate = ConstructorParameters<
    typeof PrismaCommercialGroupCampaignAttemptRepository
  >[0];
  const campaigns: Delegate = {
    updateMany: async ({ where, data }) => {
      if (
        where.id !== campaignId ||
        where.attemptExecutionId !== state.attemptExecutionId
      ) {
        return { count: 0 };
      }
      if (
        where.attemptReservedAt !== undefined &&
        !sameDate(where.attemptReservedAt, state.attemptReservedAt)
      ) {
        return { count: 0 };
      }
      const leaseFilter = where.attemptLeaseExpiresAt;
      if (leaseFilter instanceof Date) {
        if (!sameDate(leaseFilter, state.attemptLeaseExpiresAt)) {
          return { count: 0 };
        }
      } else if (leaseFilter === null) {
        if (state.attemptLeaseExpiresAt !== null) return { count: 0 };
      } else if (leaseFilter) {
        if (
          (leaseFilter.gt &&
            (!state.attemptLeaseExpiresAt ||
              state.attemptLeaseExpiresAt <= leaseFilter.gt)) ||
          (leaseFilter.lt &&
            (!state.attemptLeaseExpiresAt ||
              state.attemptLeaseExpiresAt >= leaseFilter.lt))
        ) {
          return { count: 0 };
        }
      }
      state = {
        ...state,
        ...('attemptExecutionId' in data
          ? {
              attemptExecutionId: data.attemptExecutionId,
              attemptReservedAt: data.attemptReservedAt,
            }
          : {}),
        attemptLeaseExpiresAt: data.attemptLeaseExpiresAt,
      };
      return { count: 1 };
    },
    findUnique: async ({ where }) =>
      where.id === campaignId ? { ...state } : null,
  };
  return {
    repository: new PrismaCommercialGroupCampaignAttemptRepository(campaigns),
    read: () => ({ ...state }),
  };
};

const createExecution = (run: CommercialPipelineRunRecord) =>
  ({
    id: executionId,
    schedulerJobId: 'scheduler-handoff-integration',
    bullMqJobId: jobId,
    activeKey: 'commercial-automation',
    ownerId: 'owner-handoff-integration',
    heartbeatAt: expiredLease,
    leaseExpiresAt: expiredLease,
    mode: 'SEND',
    status: 'QUEUED',
    externalStage: 'EXTERNAL_MAY_HAVE_STARTED',
    reasons: [],
    commercialRunId: run.id,
    failureCode: null,
    startedAt,
    completedAt: null,
  }) satisfies CommercialAutomationExecutionRecord;

describe('commercial reservation lease handoff integration', () => {
  it('renova a reservation expirada com execution lease expirada e conclui o lifecycle uma vez', async () => {
    const attempt = createAttemptRepository();
    let candidateStatus: 'RESERVED' | 'DISPATCHED' = 'RESERVED';
    let run: CommercialPipelineRunRecord = {
      id: runId,
      executionId,
      instanceName: 'affiliate-bot',
      mode: 'CONFIRMED',
      status: 'STARTED',
      productId: 'product-handoff-integration',
      groupDestinationId: 'destination-handoff-integration',
      productName: 'Produto de handoff',
      productPrice: '99.90',
      groupName: 'Grupo de handoff',
      groupFingerprint: 'fingerprint-handoff-integration',
      candidateCount: 1,
      eligibleCount: 1,
      rejectedCount: 0,
      rejectionSummary: {},
      selectionReasons: ['post-sync'],
      plannedSubIds: [],
      dispatchId,
      jobId,
      confirmedAt: expiredLease,
      finalStatus: 'PENDING',
      investigationRequired: false,
      failureCode: null,
      createdAt: startedAt,
      completedAt: null,
    };
    let dispatch: WhatsAppDispatchRecord = {
      id: dispatchId,
      instanceName: 'affiliate-bot',
      productId: 'product-handoff-integration',
      generatedCopyId: copyId,
      destinationId: 'destination-handoff-integration',
      status: 'PENDING',
      attemptCount: 0,
      externalMessageId: null,
      errorMessage: null,
      sentAt: null,
      createdAt: expiredLease,
      updatedAt: expiredLease,
    };
    const dispatchDetails = (): WhatsAppDispatchDetails => ({
      ...dispatch,
      generatedCopy: {
        id: copyId,
        productId: dispatch.productId,
        snapshotId: 'snapshot-handoff-integration',
        titulo: 'Oferta validada',
        mensagem: 'Mensagem validada',
        cta: 'Confira',
        hashtags: '#oferta',
        createdFromCandidateId: candidateId,
        source: 'AI',
        promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
        validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
        promotionCandidates: [
          {
            id: candidateId,
            campaignId,
            campaign: {
              id: campaignId,
              logicalGroupFingerprint: 'fingerprint-handoff-integration',
            },
            productId: dispatch.productId,
            snapshotId: 'snapshot-handoff-integration',
            generatedCopyId: copyId,
            status: 'RESERVED',
            expiresAt: null,
            product: {
              id: dispatch.productId,
              source: 'OFFICIAL',
              providerProductId: 'provider-product-handoff-integration',
              productName: 'Produto de handoff',
              shopName: 'Loja de handoff',
              productLink: 'https://shopee.com.br/product/1/1',
              unavailableAt: null,
              affiliateLink: 'https://shope.ee/affiliate',
              price: '99.90',
              priceMin: '99.90',
              priceMax: '99.90',
              discountRate: 20,
              commissionRate: 10,
              rating: 4.8,
              sales: 100,
              offerStartsAt: null,
              urlImagem: 'https://example.invalid/image.jpg',
              offerEndsAt: null,
              commercialSnapshotRevision: 1,
              commercialSnapshotFingerprint: snapshotFingerprint,
              updatedAt: now,
            },
            snapshot: {
              id: 'snapshot-handoff-integration',
              productId: dispatch.productId,
              revision: 1,
              fingerprint: snapshotFingerprint,
              unavailableAt: null,
              offerEndsAt: null,
            },
          },
        ],
      },
      destination: {
        id: dispatch.destinationId,
        destination: groupDestination,
        type: 'GROUP',
        active: true,
        available: true,
        fingerprint: 'fingerprint-handoff-integration',
        sourceInstanceName: 'affiliate-bot',
        assignedInstanceName: 'affiliate-bot',
      },
      product: {
        comissao: 10,
        urlImagem: 'https://example.invalid/image.jpg',
        affiliateLink: 'https://shope.ee/affiliate',
      },
    });
    const execution = createExecution(run);
    const outboxStatus = 'PUBLISHED' as const;
    const provider: WhatsAppProvider = {
      beginRun: vi.fn(),
      sendMessage: vi.fn(async () => ({
        status: 'sent' as const,
        externalMessageId: 'external-handoff-integration',
        sentAt: now,
      })),
    };
    let jobState: 'waiting' | 'completed' = 'waiting';
    let attemptsMade = 0;
    const runs: CommercialPipelineRunRepository &
      CommercialPipelineRunFinalizationRepository = {
      create: vi.fn(),
      update: vi.fn(async (_id, data) => {
        run = { ...run, ...data };
        return run;
      }),
      list: vi.fn(),
      findById: vi.fn(async (id) => (id === runId ? run : null)),
      findByExecutionId: vi.fn(async (id) => (id === runId ? run : null)),
      findByDispatchId: vi.fn(async (id) => (id === dispatchId ? run : null)),
      findExecutionById: vi.fn(async (id) =>
        id === executionId ? { id, commercialRunId: runId } : null,
      ),
      finalizeByDispatchId: vi.fn(async (id, completedAt) => {
        if (id !== dispatchId || dispatch.status !== 'SENT') {
          return { kind: 'AMBIGUOUS' as const, transitioned: false };
        }
        run = {
          ...run,
          status: 'COMPLETED',
          finalStatus: 'SENT',
          investigationRequired: false,
          completedAt,
        };
        return { kind: 'SENT' as const, transitioned: true };
      }),
    };
    const whatsappDispatches: WhatsAppDispatchRepository = {
      createPending: vi.fn(),
      findByIdForSending: vi.fn(async () => dispatchDetails()),
      findByIdWithDetails: vi.fn(async () => dispatchDetails()),
      list: vi.fn(),
      markAttemptPending: vi.fn(async () => {
        if (dispatch.status !== 'PENDING' || dispatch.attemptCount !== 0) {
          return false;
        }
        dispatch = { ...dispatch, status: 'PROCESSING', attemptCount: 1 };
        return true;
      }),
      claimPendingForSending: vi.fn(async () => {
        if (dispatch.status !== 'PENDING' || dispatch.attemptCount !== 0) {
          return { kind: 'NOT_PENDING' as const };
        }
        dispatch = { ...dispatch, status: 'PROCESSING', attemptCount: 1 };
        return { kind: 'CLAIMED' as const };
      }),
      markSent: vi.fn(async (_id, data) => {
        dispatch = {
          ...dispatch,
          ...data,
          status: 'SENT',
          attemptCount: 1,
        };
        jobState = 'completed';
        attemptsMade = 1;
        return dispatch;
      }),
      markFailed: vi.fn(),
    };
    const promotions = {
      findAttemptContextByGeneratedCopyId: vi.fn(async () => ({
        kind: 'FOUND' as const,
        candidateId,
        campaignId,
        attemptExecutionId: executionId,
      })),
      markDispatchedByGeneratedCopyId: vi.fn(async () => {
        candidateStatus = 'DISPATCHED';
        return {
          kind: 'DISPATCHED' as const,
          candidateId,
          campaignId,
          transitioned: true,
        };
      }),
      markBlockedByGeneratedCopyId: vi.fn(),
      resetCampaignFailureStateByGeneratedCopyId: vi.fn(async () => ({
        kind: 'RESET' as const,
        campaignId,
        transitioned: true,
      })),
      releaseAttempt: vi.fn(
        (input: { campaignId: string; executionId: string }) =>
          attempt.repository.release(input),
      ),
    };
    const repositories: WhatsAppDispatchProcessorRepositories = {
      whatsappDispatches,
      commercialRuns: runs,
      commercialAutomationExecutions: {
        findById: vi.fn(async (id) => (id === executionId ? execution : null)),
      },
      commercialGroupCampaigns: {
        renewAttempt: (input) => attempt.repository.renew(input),
      },
      commercialDispatchOutboxes: {
        findByDispatchId: async (id) =>
          id === dispatchId
            ? {
                id: 'outbox-handoff-integration',
                commercialRunId: runId,
                dispatchId,
                jobId,
                instanceName: 'affiliate-bot',
                status: 'PUBLISHED' as const,
                failureCode: null,
                createdAt: startedAt,
                publishedAt: now,
              }
            : null,
      },
      whatsappInstances: {
        findByName: async (name) =>
          name === 'affiliate-bot'
            ? {
                name,
                active: true,
                createdAt: startedAt,
                updatedAt: startedAt,
              }
            : null,
      },
      commercialPromotions: promotions,
    };
    const groupSendPolicy = new WhatsAppGroupSendPolicy({
      enabled: true,
      safeMode: true,
      instanceName: 'affiliate-bot',
    });
    vi.spyOn(groupSendPolicy, 'assertAuthorized').mockImplementation(
      () => undefined,
    );
    expect(outboxStatus).toBe('PUBLISHED');
    expect(jobState).toBe('waiting');

    await processWhatsAppDispatchJob(
      {
        id: jobId,
        name: JOB_NAMES.whatsappDispatch,
        data: { dispatchId, instanceName: 'affiliate-bot' },
      } satisfies Pick<
        import('bullmq').Job<WhatsAppDispatchJob>,
        'id' | 'name' | 'data'
      >,
      {
        repositories,
        whatsAppProvider: provider,
        whatsAppProviderResolver: vi.fn().mockResolvedValue(provider),
        groupSendPolicy,
        draftService: {
          createDraft: vi.fn().mockReturnValue({
            candidateId,
            generatedCopyId: copyId,
            caption: 'Oferta validada',
            deliveryMode: 'TEXT',
            warnings: [],
          }),
        },
        logger: { info: vi.fn(), error: vi.fn() },
        clock: () => now,
        reservationLeaseMilliseconds: renewedLease.getTime() - now.getTime(),
      },
    );

    expect(provider.sendMessage).toHaveBeenCalledOnce();
    expect(dispatch).toMatchObject({
      status: 'SENT',
      attemptCount: 1,
      externalMessageId: 'external-handoff-integration',
    });
    expect(run).toMatchObject({
      status: 'COMPLETED',
      finalStatus: 'SENT',
      investigationRequired: false,
    });
    expect(candidateStatus).toBe('DISPATCHED');
    expect(jobState).toBe('completed');
    expect(attemptsMade).toBe(1);
    expect(attempt.read()).toEqual({
      attemptExecutionId: null,
      attemptReservedAt: null,
      attemptLeaseExpiresAt: null,
    });
  });
});
