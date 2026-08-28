import { describe, expect, it, vi } from 'vitest';
import {
  fingerprintWhatsAppGroupId,
  MockWhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';
import { JOB_NAMES, type WhatsAppDispatchJob } from '@shopee-auto-affiliate-ai/queue';

import {
  MANUAL_PUBLICATION_CONFIRMATION,
  ManualPublicationService,
} from '../../api/src/manual-publication-service';
import {
  COMMERCIAL_AI_COPY_PROMPT_VERSION,
  COMMERCIAL_AI_COPY_VALIDATION_VERSION,
} from '../../api/src/commercial-ai-copy-prompt';
import { fingerprintCommercialOffer } from '../../api/src/commercial-offer-snapshot';
import {
  COMMERCIAL_CONFIRMATION_TOKEN,
  CommercialPipelineConfirmationService,
  commercialConfirmationIds,
} from '../../api/src/commercial-pipeline-confirmation-service';
import { CommercialDispatchOutboxPublisher } from '../../api/src/commercial-dispatch-outbox-publisher';
import { WhatsAppGroupSendPolicy } from '../../api/src/whatsapp-group-send-policy';
import { processWhatsAppDispatchJob } from '../src/whatsapp-dispatch-worker';
import type { WhatsAppDispatchProcessorRepositories } from '../src/whatsapp-dispatch-worker';
import type {
  CommercialAutomationExecutionRecord,
  CommercialDispatchOutboxRecord,
  CommercialPipelineRunRecord,
  CommercialPromotionCandidateRecord,
  CommercialPromotionSnapshotRecord,
  CommercialGroupCampaignRecord,
  ManualPublicationRequestCreateData,
  ManualPublicationRequestRecord,
  ManualPublicationTargetRecord,
  ShopeeOfferRecord,
  WhatsAppDispatchDetails,
  WhatsAppDispatchRecord,
  WhatsAppGroupRecord,
} from '../../api/src/repositories';

const now = new Date('2026-08-26T12:00:00.000Z');
const instanceName = 'manual-instance';
const groupDestination = '120363000000000000@g.us';
const groupFingerprint = fingerprintWhatsAppGroupId(groupDestination);
const productId = 'manual-product';
const snapshotId = 'manual-snapshot';
const affiliateLink = 'https://shope.ee/manual-affiliate';
const imageUrl = 'https://example.invalid/manual-image.jpg';

const offer: ShopeeOfferRecord = {
  id: productId,
  source: 'OFFICIAL',
  providerProductId: 'official-manual-product',
  productName: 'Oferta manual',
  shopName: 'Loja manual',
  categoryIds: ['category-1'],
  price: '99.90',
  priceMin: '99.90',
  priceMax: '99.90',
  discountRate: 20,
  rating: 4.8,
  sales: 1000,
  commissionRate: 8,
  imageUrl,
  productLink: 'https://shopee.com.br/product/1/1',
  affiliateLink,
  fetchedAt: now,
  score: 88,
  scoreUpdatedAt: now,
  lastSeenAt: now,
  unavailableAt: undefined,
  createdAt: now,
  updatedAt: now,
};

const snapshotFingerprint = fingerprintCommercialOffer({
  source: offer.source,
  providerProductId: offer.providerProductId,
  productLink: offer.productLink ?? null,
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

const snapshot: CommercialPromotionSnapshotRecord = {
  id: snapshotId,
  productId,
  revision: 1,
  fingerprint: snapshotFingerprint,
  price: offer.price,
  priceMin: offer.priceMin,
  priceMax: offer.priceMax,
  discountRate: offer.discountRate,
  commissionRate: offer.commissionRate,
  observedRating: offer.rating,
  observedSales: offer.sales,
  offerStartsAt: null,
  offerEndsAt: null,
  unavailableAt: null,
  capturedAt: now,
  createdAt: now,
};

const catalogItem = {
  product: offer,
  commercialSnapshotRevision: snapshot.revision,
  commercialSnapshotFingerprint: snapshot.fingerprint,
  latestSnapshotRevision: snapshot.revision,
  currentSnapshot: snapshot,
  previousSnapshot: null,
};

const group: WhatsAppGroupRecord = {
  id: 'manual-group',
  name: 'Grupo manual',
  destination: groupDestination,
  type: 'GROUP',
  active: true,
  available: true,
  fingerprint: groupFingerprint,
  sourceInstanceName: instanceName,
  assignedInstanceName: instanceName,
  discoveredAt: now,
  lastSyncedAt: now,
};

const campaign: CommercialGroupCampaignRecord = {
  id: 'manual-campaign',
  name: 'Campanha manual',
  logicalGroupFingerprint: groupFingerprint,
  anchorDestinationId: group.id,
  nicheId: 'manual-niche',
  active: true,
  cadenceMinutes: 15,
  timezone: 'America/Sao_Paulo',
  allowedStartTime: '00:00',
  allowedEndTime: '23:59',
  dailyLimit: 60,
  failureCount: 0,
  nextEligibleAt: null,
  attemptExecutionId: null,
  attemptReservedAt: null,
  attemptLeaseExpiresAt: null,
  queueTargetSize: 40,
  dedupeDays: 30,
  niche: {
    id: 'manual-niche',
    name: 'Nicho manual',
    slug: 'manual-niche',
    active: true,
  },
  anchorDestination: {
    id: group.id,
    name: group.name,
    fingerprint: group.fingerprint,
    active: group.active,
    available: group.available,
    assignedInstanceName: instanceName,
  },
  createdAt: now,
  updatedAt: now,
};

const candidate: CommercialPromotionCandidateRecord = {
  id: 'manual-candidate',
  campaignId: campaign.id,
  productId,
  snapshotId,
  generatedCopyId: 'manual-copy',
  status: 'COPY_READY',
  rankPosition: 1,
  commercialScore: 88,
  scorePolicyVersion: 'official-v2',
  minimumScoreUsed: 60,
  scoreBreakdown: {
    policyVersion: 'official-v2',
    rawTotal: 88,
    finalScore: 88,
    components: {},
  },
  promotionSignals: [],
  priceDropPercent: null,
  queuedAt: now,
  lastEvaluatedAt: now,
  expiresAt: null,
  dedupeUntil: null,
  blockedReason: null,
  manualSelectionOverride: true,
  createdAt: now,
  updatedAt: now,
};

const runBase = (): CommercialPipelineRunRecord => ({
  id: 'manual-run',
  mode: 'DRY_RUN',
  status: 'COMPLETED',
  executionId: null,
  instanceName,
  productId,
  groupDestinationId: group.id,
  productName: offer.productName,
  productPrice: offer.price,
  groupName: group.name,
  groupFingerprint,
  score: candidate.commercialScore,
  scorePolicyVersion: candidate.scorePolicyVersion,
  minimumScoreUsed: candidate.minimumScoreUsed,
  maximumScoreObserved: candidate.commercialScore,
  selectedScoreBreakdown: candidate.scoreBreakdown,
  candidateCount: 1,
  eligibleCount: 1,
  rejectedCount: 0,
  rejectionSummary: {},
  selectionReasons: ['manual'],
  copyPreview: `Oferta manual\n\nConfira: ${affiliateLink}`,
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

const dispatchBase = (): WhatsAppDispatchDetails => ({
  id: 'manual-run-dispatch',
  productId,
  generatedCopyId: 'manual-copy',
  destinationId: group.id,
  instanceName,
  status: 'PENDING',
  attemptCount: 0,
  errorMessage: null,
  sentAt: null,
  externalMessageId: null,
  createdAt: now,
  updatedAt: now,
  destination: {
    id: group.id,
    destination: groupDestination,
    type: 'GROUP',
    active: true,
    available: true,
    fingerprint: groupFingerprint,
    sourceInstanceName: instanceName,
    assignedInstanceName: instanceName,
  },
  product: {
    comissao: offer.commissionRate,
    urlImagem: imageUrl,
    affiliateLink,
  },
  generatedCopy: {
    id: 'manual-copy',
    productId,
    snapshotId,
    createdFromCandidateId: candidate.id,
    source: 'AI',
    promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
    validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
    titulo: 'Oferta manual',
    mensagem: 'Oferta com dados atuais.',
    cta: `Confira: ${affiliateLink}`,
    hashtags: '#oferta',
    promotionCandidates: [
      {
        id: candidate.id,
        campaignId: campaign.id,
        campaign: {
          id: campaign.id,
          logicalGroupFingerprint: groupFingerprint,
        },
        productId,
        snapshotId,
        generatedCopyId: candidate.generatedCopyId ?? null,
        status: 'COPY_READY',
        expiresAt: null,
        product: {
          id: productId,
          source: offer.source,
          providerProductId: offer.providerProductId,
          productName: offer.productName,
          shopName: offer.shopName,
          productLink: offer.productLink,
          unavailableAt: null,
          affiliateLink,
          urlImagem: imageUrl,
          price: offer.price,
          priceMin: offer.priceMin,
          priceMax: offer.priceMax,
          discountRate: offer.discountRate,
          commissionRate: offer.commissionRate,
          rating: offer.rating,
          sales: offer.sales,
          commercialSnapshotRevision: snapshot.revision,
          commercialSnapshotFingerprint: snapshot.fingerprint,
        },
        snapshot: {
          id: snapshotId,
          productId,
          revision: snapshot.revision,
          fingerprint: snapshot.fingerprint,
          unavailableAt: null,
          offerEndsAt: null,
        },
      } as never,
    ],
  },
});

const targetBase = (requestId: string): ManualPublicationTargetRecord => ({
  id: `${requestId}-target-01`,
  requestId,
  destinationId: group.id,
  campaignId: campaign.id,
  logicalGroupFingerprint: groupFingerprint,
  assignedInstanceName: instanceName,
  candidateId: null,
  runId: null,
  dispatchId: null,
  outboxId: null,
  status: 'ACCEPTED',
  blockedReason: null,
  investigationRequired: false,
  createdAt: now,
  updatedAt: now,
  destination: {
    id: group.id,
    name: group.name,
    type: 'GROUP',
    fingerprint: groupFingerprint,
    active: true,
    available: true,
  },
  campaign: {
    id: campaign.id,
    name: campaign.name,
    active: true,
    nicheId: campaign.nicheId,
    nicheActive: true,
    dailyLimit: campaign.dailyLimit,
    cadenceMinutes: campaign.cadenceMinutes,
    timezone: campaign.timezone,
    allowedStartTime: campaign.allowedStartTime,
    allowedEndTime: campaign.allowedEndTime,
    failureCount: 0,
    nextEligibleAt: null,
  },
  candidate: {
    id: candidate.id,
    generatedCopyId: candidate.generatedCopyId ?? null,
    status: candidate.status,
  },
  run: null,
  dispatch: null,
  outbox: null,
});

describe('manual publication execution ownership integration', () => {
  it('atravessa manual -> execution -> outbox -> worker com Sender mock uma vez', async () => {
    const requestId = 'manual-request-e2e';
    const request: ManualPublicationRequestRecord = {
      id: requestId,
      idempotencyKey: 'manual-e2e-key',
      payloadHash: '',
      mode: 'SEND',
      productId,
      requestedSnapshotId: snapshotId,
      requestedSnapshotRevision: snapshot.revision,
      requestedSnapshotFingerprint: snapshot.fingerprint,
      status: 'ACCEPTED',
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      processingOwnerId: null,
      processingLeaseExpiresAt: null,
      targets: [targetBase(requestId)],
    };
    const requests = new Map<string, ManualPublicationRequestRecord>();
    let run = runBase();
    let dispatch = dispatchBase();
    let outbox: CommercialDispatchOutboxRecord | null = null;
    let execution: CommercialAutomationExecutionRecord | null = null;
    let attemptExecutionId: string | null = null;
    const jobs = new Set<string>();
    const provider = new MockWhatsAppProvider();
    const providerResolver = vi.fn(async (resolvedInstanceName: string) => {
      expect(resolvedInstanceName).toBe(instanceName);
      return provider;
    });

    const executions = {
      start: vi.fn(async (input: {
        schedulerJobId: string;
        mode: 'SEND';
        ownerId: string;
        startedAt: Date;
        heartbeatAt: Date;
        leaseExpiresAt: Date;
      }) => {
        execution = {
          id: 'manual-execution-real',
          schedulerJobId: input.schedulerJobId,
          bullMqJobId: null,
          activeKey: 'commercial-automation',
          ownerId: input.ownerId,
          heartbeatAt: input.heartbeatAt,
          leaseExpiresAt: input.leaseExpiresAt,
          mode: input.mode,
          status: 'STARTED',
          externalStage: 'NOT_REACHED',
          reasons: [],
          commercialRunId: null,
          failureCode: null,
          startedAt: input.startedAt,
          completedAt: null,
        };
        return {
          outcome: 'created' as const,
          execution,
          ownership: { executionId: execution.id, ownerId: input.ownerId },
        };
      }),
      findBySchedulerJobId: vi.fn(async (schedulerJobId: string) =>
        execution?.schedulerJobId === schedulerJobId ? execution : null,
      ),
      heartbeat: vi.fn(async (
        ownership: { executionId: string; ownerId: string },
        input: { heartbeatAt: Date; leaseExpiresAt: Date },
      ) => {
        if (
          !execution ||
          execution.id !== ownership.executionId ||
          execution.ownerId !== ownership.ownerId ||
          execution.status !== 'STARTED'
        ) {
          throw new Error('execution ownership lost');
        }
        execution.heartbeatAt = input.heartbeatAt;
        execution.leaseExpiresAt = input.leaseExpiresAt;
      }),
      markExternalMayHaveStarted: vi.fn(async () => {
        if (!execution) throw new Error('execution missing');
        execution.externalStage = 'EXTERNAL_MAY_HAVE_STARTED';
        return execution;
      }),
      finish: vi.fn(async (
        ownership: { executionId: string; ownerId: string },
        input: {
          status: 'QUEUED' | 'BLOCKED' | 'FAILED' | 'AMBIGUOUS';
          commercialRunId?: string;
          completedAt: Date;
        },
      ) => {
        if (
          !execution ||
          execution.id !== ownership.executionId ||
          execution.ownerId !== ownership.ownerId ||
          execution.status !== 'STARTED'
        ) {
          throw new Error('execution ownership lost');
        }
        execution.activeKey = null;
        execution.status = input.status;
        execution.commercialRunId = input.commercialRunId ?? null;
        execution.completedAt = input.completedAt;
        return execution;
      }),
      findById: vi.fn(async (id: string) => (execution?.id === id ? execution : null)),
    };

    const runs = {
      create: vi.fn(),
      update: vi.fn(async (id: string, data: Partial<CommercialPipelineRunRecord>) => {
        if (id !== run.id) throw new Error('run mismatch');
        run = { ...run, ...data };
        return run;
      }),
      list: vi.fn(),
      findById: vi.fn(async (id: string) => (id === run.id ? run : null)),
      findByExecutionId: vi.fn(async (id: string) =>
        run.executionId === id ? run : null,
      ),
      findByDispatchId: vi.fn(async (id: string) =>
        run.dispatchId === id ? run : null,
      ),
      finalizeByDispatchId: vi.fn(async (id: string) => {
        if (id !== dispatch.id || dispatch.status !== 'SENT') {
          return { kind: 'AMBIGUOUS' as const, transitioned: false };
        }
        run = {
          ...run,
          status: 'COMPLETED',
          finalStatus: 'SENT',
          investigationRequired: false,
        };
        return { kind: 'SENT' as const, transitioned: true };
      }),
      findExecutionById: vi.fn(async (id: string) =>
        execution?.id === id
          ? { id: execution.id, commercialRunId: execution.commercialRunId }
          : null,
      ),
    };

    const outboxes = {
      createPendingConfirmation: vi.fn(async (input: {
        outboxId: string;
        runId: string;
        confirmedAt: Date;
        jobId: string;
        instanceName?: string | null;
        dispatch: WhatsAppDispatchRecord;
        existingGeneratedCopyId: string;
      }) => {
        dispatch = {
          ...dispatch,
          ...input.dispatch,
          status: 'PENDING',
          attemptCount: 0,
          errorMessage: null,
          sentAt: null,
          externalMessageId: null,
          createdAt: input.confirmedAt,
          updatedAt: input.confirmedAt,
        };
        outbox = {
          id: input.outboxId,
          commercialRunId: input.runId,
          dispatchId: input.dispatch.id,
          jobId: input.jobId,
          instanceName: input.instanceName ?? null,
          status: 'PENDING',
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
          dispatchId: dispatch.id,
          jobId: null,
          finalStatus: 'PENDING',
          investigationRequired: false,
        };
        return outbox;
      }),
      list: vi.fn(async () => ({ items: outbox ? [outbox] : [], total: outbox ? 1 : 0 })),
      findById: vi.fn(async (id: string) => (outbox?.id === id ? outbox : null)),
      findByDispatchId: vi.fn(async (id: string) =>
        outbox?.dispatchId === id ? outbox : null,
      ),
      findPublicationContext: vi.fn(async () =>
        outbox ? { outbox, run, dispatch } : null,
      ),
      markPublished: vi.fn(async (id: string, publishedAt: Date) => {
        if (!outbox || outbox.id !== id) return null;
        outbox = { ...outbox, status: 'PUBLISHED', publishedAt };
        run = { ...run, jobId: outbox.jobId };
        return outbox;
      }),
      markAmbiguous: vi.fn(async () => outbox),
    };

    const confirmation = new CommercialPipelineConfirmationService({
      runs: runs as never,
      offers: { findOfferById: vi.fn(async () => offer) } as never,
      groups: { listAll: vi.fn(async () => [group]) } as never,
      instances: {
        findByName: vi.fn(async (name: string) => ({
          name,
          active: true,
          createdAt: now,
          updatedAt: now,
        })),
      },
      outboxes: outboxes as never,
      deliveryHistory: {
        wasProductSentToGroup: vi.fn(async () => false),
        findLastSentAtByGroup: vi.fn(async () => null),
      },
      copy: { generate: vi.fn(() => run.copyPreview ?? '') },
      publisher: new CommercialDispatchOutboxPublisher({
        outboxes: outboxes as never,
        queue: {
          hasJob: vi.fn(async (jobId: string) => jobs.has(jobId)),
          enqueue: vi.fn(async (_dispatchId: string, jobId: string) => {
            jobs.add(jobId);
          }),
        },
        logger: { info: vi.fn(), error: vi.fn() },
        clock: () => now,
      }),
      instanceName,
      environment: {
        groupSendEnabled: true,
        safeMode: true,
        schedulerEnabled: false,
        maximumMessagesPerRun: 1,
      },
      logger: { info: vi.fn(), error: vi.fn() },
      clock: () => now,
    });

    const manual = new ManualPublicationService({
      requests: {
        accept: vi.fn(async (input: ManualPublicationRequestCreateData) => {
          const accepted = {
            ...request,
            id: input.id ?? request.id,
            idempotencyKey: input.idempotencyKey,
            payloadHash: input.payloadHash,
            requestedSnapshotId: input.requestedSnapshotId,
            requestedSnapshotRevision: input.requestedSnapshotRevision,
            requestedSnapshotFingerprint: input.requestedSnapshotFingerprint,
            status: input.status ?? 'ACCEPTED',
            targets: input.targets.map((item: ManualPublicationRequestCreateData['targets'][number]) => ({
              ...targetBase(input.id ?? request.id),
              id: item.id ?? `${input.id}-target-01`,
              requestId: input.id ?? request.id,
              status: item.status ?? 'ACCEPTED',
            })),
          } satisfies ManualPublicationRequestRecord;
          requests.set(accepted.id, accepted);
          requests.set(accepted.idempotencyKey, accepted);
          return { request: accepted, created: true };
        }),
        findById: vi.fn(async (id: string) => requests.get(id) ?? null),
        findByIdempotencyKey: vi.fn(async (key: string) => requests.get(key) ?? null),
        claimProcessing: vi.fn(async (id: string, ownerId: string, _at: Date, lease: Date) => {
          const current = requests.get(id);
          if (!current) return null;
          current.status = 'PROCESSING';
          current.processingOwnerId = ownerId;
          current.processingLeaseExpiresAt = lease;
          return current;
        }),
        renewProcessing: vi.fn(async (id: string, ownerId: string, lease: Date) => {
          const current = requests.get(id);
          if (!current || current.processingOwnerId !== ownerId) return false;
          current.processingLeaseExpiresAt = lease;
          return true;
        }),
        reserveSendSlot: vi.fn(async () => ({ kind: 'RESERVED' as const })),
        releaseSendSlot: vi.fn(async () => undefined),
        updateTarget: vi.fn(async (id: string, data: Partial<ManualPublicationTargetRecord>) => {
          const current = [...requests.values()]
            .flatMap((item) => item.targets)
            .find((item) => item.id === id);
          if (!current) return null;
          Object.assign(current, data);
          return current;
        }),
        updateRequest: vi.fn(async (id: string, data: Partial<ManualPublicationRequestRecord>) => {
          const current = requests.get(id);
          if (!current) return null;
          Object.assign(current, data);
          return current;
        }),
      } as never,
      offers: { findOfferById: vi.fn(async () => offer) },
      catalog: { findOfficialCatalogItem: vi.fn(async () => catalogItem) },
      groups: { findById: vi.fn(async () => group), listAll: vi.fn(async () => [group]) },
      campaigns: { findByLogicalGroupFingerprint: vi.fn(async () => campaign), list: vi.fn() },
      instances: {
        findByName: vi.fn(async (name: string) => ({
          name,
          active: true,
          createdAt: now,
          updatedAt: now,
        })),
      },
      candidates: {
        findByCampaignAndProduct: vi.fn(async () => candidate),
        listCampaignCandidates: vi.fn(async () => [candidate]),
      },
      copies: { loadContext: vi.fn(), findCopyForCandidate: vi.fn() },
      deliveryHistory: { wasProductSentToGroup: vi.fn(async () => false) },
      policy: {
        evaluateManualSendSafety: vi.fn(async () => ({
          allowed: true,
          reasons: [],
          timezone: campaign.timezone,
          dailyGlobalLimit: 10,
          dailyGroupLimit: 10,
        })),
      },
      candidateFlow: {
        reserveAttempt: vi.fn(async (_target, input: { executionId: string }) => {
          attemptExecutionId = input.executionId;
          return {
            kind: 'RESERVED' as const,
            campaignId: campaign.id,
            executionId: input.executionId,
            reservedAt: now,
            leaseExpiresAt: new Date(now.getTime() + 120_000),
            acquired: true,
          };
        }),
        releaseAttempt: vi.fn(async () => {
          attemptExecutionId = null;
          return {
            kind: 'RELEASED' as const,
            campaignId: campaign.id,
            executionId: execution?.id ?? '',
            released: true,
          };
        }),
        renewAttempt: vi.fn(async (input: { executionId: string }) => ({
          kind: 'RENEWED' as const,
          campaignId: campaign.id,
          executionId: input.executionId,
          leaseExpiresAt: new Date(now.getTime() + 120_000),
          renewed: true,
        })),
        prepareManual: vi.fn(async (
          _manualProductId: string,
          _target: { campaignId: string },
          input: { executionId: string },
        ) => {
          run = { ...run, executionId: input.executionId };
          return {
            runId: run.id,
            candidateId: candidate.id,
            generatedCopyId: 'manual-copy',
            campaignId: campaign.id,
            groupId: group.id,
            logicalGroupFingerprint: groupFingerprint,
            nicheId: campaign.nicheId,
            deliveryMode: 'IMAGE' as const,
            copyPreview: run.copyPreview ?? '',
            pipeline: {} as never,
          };
        }),
      } as never,
      confirmation,
      executions: executions as never,
      runs: runs as never,
      outboxes: { findById: outboxes.findById },
      dispatches: { findByIdWithDetails: vi.fn(async () => dispatch) },
      environment: {
        groupSendEnabled: true,
        safeMode: true,
        schedulerEnabled: false,
        maximumMessagesPerRun: 1,
      },
      clock: () => now,
    } as never);

    const result = await manual.create({
      idempotencyKey: request.idempotencyKey,
      productId,
      destinationIds: [group.id],
      confirm: MANUAL_PUBLICATION_CONFIRMATION,
    });
    const jobId = commercialConfirmationIds(run.id).jobId;
    const realExecution = execution as CommercialAutomationExecutionRecord | null;
    if (!realExecution) throw new Error('execution ausente depois do manual create');
    const publishedOutbox = outbox as CommercialDispatchOutboxRecord | null;
    const job: Pick<import('bullmq').Job<WhatsAppDispatchJob>, 'id' | 'name' | 'data'> = {
      id: jobId,
      name: JOB_NAMES.whatsappDispatch,
      data: { dispatchId: dispatch.id, instanceName },
    };

    expect(result.request.targets[0]).toMatchObject({
      status: 'QUEUED',
      runId: run.id,
      dispatchId: dispatch.id,
      outboxId: publishedOutbox?.id,
      assignedInstanceName: instanceName,
    });
    expect(realExecution).toMatchObject({
      mode: 'SEND',
      status: 'QUEUED',
      commercialRunId: run.id,
    });
    expect(run.executionId).toBe(realExecution.id);
    expect(attemptExecutionId).toBe(realExecution.id);
    expect(outbox).toMatchObject({
      status: 'PUBLISHED',
      instanceName,
      commercialRunId: run.id,
    });
    expect(dispatch.instanceName).toBe(instanceName);
    expect(job.data.instanceName).toBe(instanceName);
    expect(executions.finish).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: realExecution.id }),
      expect.objectContaining({ status: 'QUEUED', commercialRunId: run.id }),
    );

    const groupSendPolicy = new WhatsAppGroupSendPolicy({
      enabled: true,
      safeMode: true,
      instanceName,
    });
    await processWhatsAppDispatchJob(job, {
      repositories: {
        whatsappDispatches: {
          findByIdWithDetails: vi.fn(async () => dispatch),
          findByIdForSending: vi.fn(async () => dispatch),
          markAttemptPending: vi.fn(async () => {
            dispatch = { ...dispatch, status: 'PROCESSING', attemptCount: 1 };
            return true;
          }),
          markSent: vi.fn(async (
            _id: string,
            data: Parameters<NonNullable<WhatsAppDispatchProcessorRepositories['whatsappDispatches']['markSent']>>[1],
          ) => {
            dispatch = { ...dispatch, ...data, status: 'SENT', attemptCount: 1 };
            return dispatch;
          }),
          markFailed: vi.fn(),
          createPending: vi.fn(),
          list: vi.fn(),
        },
        commercialRuns: runs as never,
        commercialPromotions: {
          findAttemptContextByGeneratedCopyId: vi.fn(async () => ({
            kind: 'FOUND' as const,
            candidateId: candidate.id,
            campaignId: campaign.id,
            attemptExecutionId: realExecution.id,
          })),
          markDispatchedByGeneratedCopyId: vi.fn(async () => ({
            kind: 'DISPATCHED' as const,
            candidateId: candidate.id,
            campaignId: campaign.id,
            transitioned: true,
          })),
          markBlockedByGeneratedCopyId: vi.fn(),
          resetCampaignFailureStateByGeneratedCopyId: vi.fn(async () => ({
            kind: 'RESET' as const,
            campaignId: campaign.id,
            transitioned: true,
          })),
          releaseAttempt: vi.fn(async () => ({
            kind: 'RELEASED' as const,
            campaignId: campaign.id,
            executionId: realExecution.id,
            released: true,
          })),
        },
        commercialAutomationExecutions: { findById: executions.findById },
        commercialGroupCampaigns: {
          renewAttempt: vi.fn(async () => ({
            kind: 'RENEWED' as const,
            campaignId: campaign.id,
            executionId: realExecution.id,
            leaseExpiresAt: new Date(now.getTime() + 120_000),
            renewed: true,
          })),
        },
        commercialDispatchOutboxes: {
          findByDispatchId: outboxes.findByDispatchId,
        },
        whatsappInstances: {
          findByName: vi.fn(async (name: string) => ({
            name,
            active: true,
            createdAt: now,
            updatedAt: now,
          })),
        },
      },
      whatsAppProvider: provider,
      whatsAppProviderResolver: providerResolver,
      groupSendPolicy,
      reservationLeaseMilliseconds: 120_000,
      clock: () => now,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(provider.sentMessages).toHaveLength(1);
    expect(dispatch).toMatchObject({ status: 'SENT', attemptCount: 1, instanceName });
    expect(run).toMatchObject({
      status: 'COMPLETED',
      finalStatus: 'SENT',
      executionId: realExecution.id,
      instanceName,
    });
    expect(providerResolver).toHaveBeenCalledWith(instanceName);
    expect(groupSendPolicy).toBeDefined();
    expect(executions.findById).toHaveBeenCalledWith(realExecution.id);
    expect(COMMERCIAL_CONFIRMATION_TOKEN).toBe('CONFIRMAR_ENVIO_COMERCIAL');
  });
});
