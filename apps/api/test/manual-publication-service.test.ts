import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import {
  canonicalManualPublicationPayload,
  MANUAL_PUBLICATION_CONFIRMATION,
  ManualPublicationService,
  manualPublicationPayloadHash,
} from '../src/manual-publication-service';
import { COMMERCIAL_CONFIRMATION_TOKEN } from '../src/commercial-pipeline-confirmation-service';
import type {
  CommercialGroupCampaignRecord,
  CommercialPipelineRunRecord,
  CommercialPromotionCatalogItem,
  CommercialPromotionSnapshotRecord,
  ManualPublicationRequestRecord,
  ManualPublicationRequestRepository,
  ManualPublicationRequestUpdate,
  ManualPublicationTargetRecord,
  ManualPublicationTargetUpdate,
  ShopeeOfferRecord,
  WhatsAppGroupRecord,
} from '../src/repositories';

const NOW = new Date('2026-08-25T15:00:00.000Z');

const offer = (
  source: ShopeeOfferRecord['source'] = 'OFFICIAL',
): ShopeeOfferRecord => ({
  id: 'product-1',
  source,
  providerProductId: 'provider-1',
  productName: 'Oferta oficial',
  shopName: 'Loja oficial',
  categoryIds: ['100001'],
  price: '99.90',
  priceMin: '99.90',
  priceMax: '99.90',
  discountRate: 20,
  rating: 4.8,
  sales: 1000,
  commissionRate: 8,
  imageUrl: 'https://example.invalid/image.jpg',
  productLink: 'https://example.invalid/product',
  affiliateLink: 'https://example.invalid/affiliate',
  fetchedAt: NOW,
  score: null,
  scoreUpdatedAt: null,
  lastSeenAt: NOW,
  unavailableAt: undefined,
  createdAt: NOW,
  updatedAt: NOW,
});

const snapshot = (): CommercialPromotionSnapshotRecord => ({
  id: 'snapshot-1',
  productId: 'product-1',
  revision: 1,
  fingerprint: 'snapshot-fingerprint',
  price: '99.90',
  priceMin: '99.90',
  priceMax: '99.90',
  discountRate: 20,
  commissionRate: 8,
  observedRating: 4.8,
  observedSales: 1000,
  offerStartsAt: null,
  offerEndsAt: null,
  unavailableAt: null,
  capturedAt: NOW,
  createdAt: NOW,
});

const catalogItem = (
  source: ShopeeOfferRecord['source'] = 'OFFICIAL',
): CommercialPromotionCatalogItem => ({
  product: offer(source),
  commercialSnapshotRevision: 1,
  commercialSnapshotFingerprint: 'snapshot-fingerprint',
  latestSnapshotRevision: 1,
  currentSnapshot: snapshot(),
  previousSnapshot: null,
});

const group = (id: string, active = true): WhatsAppGroupRecord => ({
  id,
  name: `Grupo ${id}`,
  destination: `${id}@g.us`,
  type: 'GROUP',
  active,
  available: active,
  fingerprint: `fingerprint-${id}`,
  sourceInstanceName: `instance-${id}`,
  assignedInstanceName: `instance-${id}`,
  discoveredAt: NOW,
  lastSyncedAt: NOW,
});

const campaign = (
  selectedGroup: WhatsAppGroupRecord,
): CommercialGroupCampaignRecord => ({
  id: `campaign-${selectedGroup.id}`,
  name: `Campanha ${selectedGroup.id}`,
  logicalGroupFingerprint: selectedGroup.fingerprint,
  anchorDestinationId: selectedGroup.id,
  nicheId: `niche-${selectedGroup.id}`,
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
    id: `niche-${selectedGroup.id}`,
    name: 'Nicho oficial',
    slug: `niche-${selectedGroup.id}`,
    active: true,
  },
  anchorDestination: {
    id: selectedGroup.id,
    name: selectedGroup.name,
    fingerprint: selectedGroup.fingerprint,
    active: selectedGroup.active,
    available: selectedGroup.available,
    assignedInstanceName: selectedGroup.assignedInstanceName,
  },
  createdAt: NOW,
  updatedAt: NOW,
});

const targetRecord = (
  requestId: string,
  selectedGroup: WhatsAppGroupRecord,
  selectedCampaign: CommercialGroupCampaignRecord,
): ManualPublicationTargetRecord => ({
  id: `${requestId}-${selectedGroup.id}`,
  requestId,
  destinationId: selectedGroup.id,
  campaignId: selectedCampaign.id,
  logicalGroupFingerprint: selectedGroup.fingerprint,
  assignedInstanceName: selectedGroup.assignedInstanceName ?? '',
  candidateId: null,
  runId: null,
  dispatchId: null,
  outboxId: null,
  status: 'ACCEPTED',
  blockedReason: null,
  investigationRequired: false,
  createdAt: NOW,
  updatedAt: NOW,
  destination: {
    id: selectedGroup.id,
    name: selectedGroup.name,
    type: 'GROUP',
    fingerprint: selectedGroup.fingerprint,
    active: selectedGroup.active,
    available: selectedGroup.available,
  },
  campaign: {
    id: selectedCampaign.id,
    name: selectedCampaign.name,
    active: selectedCampaign.active,
    nicheId: selectedCampaign.nicheId,
    nicheActive: selectedCampaign.niche.active,
    dailyLimit: selectedCampaign.dailyLimit,
    cadenceMinutes: selectedCampaign.cadenceMinutes,
    timezone: selectedCampaign.timezone,
    allowedStartTime: selectedCampaign.allowedStartTime,
    allowedEndTime: selectedCampaign.allowedEndTime,
    failureCount: selectedCampaign.failureCount,
    nextEligibleAt: selectedCampaign.nextEligibleAt,
  },
  candidate: null,
  run: null,
  dispatch: null,
  outbox: null,
});

const recoveredRun = (
  overrides: Partial<CommercialPipelineRunRecord> = {},
): CommercialPipelineRunRecord => ({
  id: 'run-a',
  mode: 'DRY_RUN',
  status: 'COMPLETED',
  executionId: 'placeholder-execution',
  instanceName: 'instance-a',
  productId: 'product-1',
  groupDestinationId: 'a',
  productName: 'Oferta oficial',
  productPrice: '99.90',
  groupName: 'Grupo a',
  groupFingerprint: 'fingerprint-a',
  score: 70,
  scorePolicyVersion: 'official-v2',
  minimumScoreUsed: 60,
  maximumScoreObserved: 70,
  selectedScoreBreakdown: null,
  candidateCount: 1,
  eligibleCount: 1,
  rejectedCount: 0,
  rejectionSummary: {},
  selectionReasons: ['manual'],
  copyPreview: 'copy preview',
  plannedSubIds: [],
  dispatchId: null,
  jobId: null,
  confirmedAt: null,
  finalStatus: null,
  investigationRequired: false,
  failureCode: null,
  createdAt: NOW,
  completedAt: NOW,
  ...overrides,
});

const createSubject = (
  source: ShopeeOfferRecord['source'] = 'OFFICIAL',
  recovery?: {
    run: CommercialPipelineRunRecord;
    candidate: { id: string; generatedCopyId: string; status: 'COPY_READY' };
  },
  overrides: {
    groups?: WhatsAppGroupRecord[];
    item?: CommercialPromotionCatalogItem;
    instanceActive?: boolean;
    groupSendEnabled?: boolean;
    safeMode?: boolean;
    allowAllGroups?: boolean;
    quotaBlocked?: string;
    publishOutboxError?: Error;
    recoverRun?: CommercialPipelineRunRecord;
    candidateStatus?: 'QUEUED' | 'COPY_READY';
    prepareManualFailure?: {
      point: 'PRE_MARKER' | 'POST_MARKER';
      error: Error;
    };
    markerError?: Error;
  } = {},
) => {
  const groups = overrides.groups ?? [group('a'), group('b', false)];
  const campaigns = groups.map(campaign);
  const requests = new Map<string, ManualPublicationRequestRecord>();
  const events: string[] = [];
  let createdRequestCount = 0;
  const outboxes = new Map<
    string,
    {
      id: string;
      commercialRunId: string;
      dispatchId: string;
      jobId: string;
      instanceName: string;
      status: 'PENDING';
      failureCode: null;
      createdAt: Date;
      publishedAt: null;
    }
  >();
  const executions: Array<{
    id: string;
    schedulerJobId: string;
    bullMqJobId: null;
    activeKey: string | null;
    ownerId: string | null;
    heartbeatAt: Date | null;
    leaseExpiresAt: Date | null;
    mode: 'SEND';
    status: 'STARTED' | 'QUEUED' | 'BLOCKED' | 'FAILED' | 'AMBIGUOUS';
    externalStage: 'NOT_REACHED' | 'EXTERNAL_MAY_HAVE_STARTED';
    reasons: string[];
    commercialRunId: string | null;
    failureCode: string | null;
    startedAt: Date;
    completedAt: Date | null;
  }> = [];
  const startExecution = vi.fn(
    async (input: {
      schedulerJobId: string;
      ownerId: string;
      startedAt: Date;
      heartbeatAt: Date;
      leaseExpiresAt: Date;
    }) => {
      events.push('execution-start');
      const existing = executions.find(
        (execution) => execution.schedulerJobId === input.schedulerJobId,
      );
      if (existing)
        return { outcome: 'existing' as const, execution: existing };
      if (recovery) {
        const execution = {
          id: 'manual-execution-recovered',
          schedulerJobId: input.schedulerJobId,
          bullMqJobId: null,
          activeKey: null,
          ownerId: null,
          heartbeatAt: input.heartbeatAt,
          leaseExpiresAt: input.leaseExpiresAt,
          mode: 'SEND' as const,
          status: 'QUEUED' as const,
          externalStage: 'NOT_REACHED' as const,
          reasons: [],
          commercialRunId: recovery.run.id,
          failureCode: null,
          startedAt: input.startedAt,
          completedAt: input.startedAt,
        };
        recovery.run.executionId = execution.id;
        executions.push(execution);
        outboxes.set(`commercial-${recovery.run.id}-outbox`, {
          id: `commercial-${recovery.run.id}-outbox`,
          commercialRunId: recovery.run.id,
          dispatchId: `commercial-${recovery.run.id}-dispatch`,
          jobId: `commercial-${recovery.run.id}-job`,
          instanceName: 'instance-a',
          status: 'PENDING',
          failureCode: null,
          createdAt: NOW,
          publishedAt: null,
        });
        return { outcome: 'existing' as const, execution };
      }
      const execution = {
        id: `manual-execution-${executions.length + 1}`,
        schedulerJobId: input.schedulerJobId,
        bullMqJobId: null,
        activeKey: 'commercial-automation',
        ownerId: input.ownerId,
        heartbeatAt: input.heartbeatAt,
        leaseExpiresAt: input.leaseExpiresAt,
        mode: 'SEND' as const,
        status: 'STARTED' as const,
        externalStage: 'NOT_REACHED' as const,
        reasons: [],
        commercialRunId: null,
        failureCode: null,
        startedAt: input.startedAt,
        completedAt: null,
      };
      executions.push(execution);
      return {
        outcome: 'created' as const,
        execution,
        ownership: { executionId: execution.id, ownerId: input.ownerId },
      };
    },
  );
  const reserveAttempt = vi.fn(
    async (target: { campaignId: string }, input: { executionId: string }) => {
      events.push(`reserve:${input.executionId}`);
      return {
        kind: 'RESERVED' as const,
        campaignId: target.campaignId,
        executionId: input.executionId,
        reservedAt: NOW,
        leaseExpiresAt: new Date(NOW.getTime() + 120_000),
        acquired: true,
      };
    },
  );
  const prepareManual = vi.fn(
    async (
      _productId: string,
      target: {
        groupId: string;
        campaignId: string;
        logicalGroupFingerprint: string;
      },
      input: {
        executionId: string;
        beforeExternalCopyGeneration?: () => Promise<void>;
      },
    ) => {
      events.push(`prepare:${input.executionId}`);
      if (overrides.prepareManualFailure?.point === 'PRE_MARKER') {
        throw overrides.prepareManualFailure.error;
      }
      if (overrides.candidateStatus !== 'COPY_READY') {
        events.push('beforeExternalMarker');
        await input.beforeExternalCopyGeneration?.();
        events.push('externalMarked');
        if (overrides.prepareManualFailure?.point === 'POST_MARKER') {
          throw overrides.prepareManualFailure.error;
        }
        events.push('copyGenerate');
      }
      return {
        runId: `run-${target.groupId}`,
        candidateId: `candidate-${target.groupId}`,
        generatedCopyId: `copy-${target.groupId}`,
        campaignId: target.campaignId,
        groupId: target.groupId,
        logicalGroupFingerprint: target.logicalGroupFingerprint,
        nicheId: `niche-${target.groupId}`,
        deliveryMode: 'IMAGE' as const,
        copyPreview: 'copy preview',
        pipeline: {} as never,
      };
    },
  );
  const evaluateManualSendSafety = vi.fn(async (target: { groupId: string }) =>
    target.groupId === 'b' && !overrides.allowAllGroups
      ? { allowed: false, reasons: ['GROUP_DAILY_LIMIT_REACHED'] }
      : { allowed: true, reasons: [] },
  );
  const confirm = vi.fn(
    async (
      runId: string,
      _token: string,
      options?: { deferPublication?: boolean },
    ) => {
      events.push(options?.deferPublication ? 'confirm-deferred' : 'confirm');
      const dispatchId = `commercial-${runId}-dispatch`;
      outboxes.set(`commercial-${runId}-outbox`, {
        id: `commercial-${runId}-outbox`,
        commercialRunId: runId,
        dispatchId,
        jobId: `commercial-${runId}-job`,
        instanceName: 'instance-a',
        status: 'PENDING',
        failureCode: null,
        createdAt: NOW,
        publishedAt: null,
      });
      return {} as never;
    },
  );
  const releaseSendSlot = vi.fn(async () => undefined);
  const releaseAttempt = vi.fn(async () => ({
    kind: 'RELEASED' as const,
    campaignId: 'campaign-a',
    executionId: 'manual-execution',
    released: true,
  }));
  const markExternalMayHaveStarted = vi.fn(
    async (ownership: { executionId: string; ownerId: string }) => {
      events.push(`external:${ownership.executionId}`);
      const execution = executions.find(
        (item) => item.id === ownership.executionId,
      );
      if (
        !execution ||
        execution.ownerId !== ownership.ownerId ||
        execution.status !== 'STARTED'
      ) {
        throw new Error('ownership lost');
      }
      execution.externalStage = 'EXTERNAL_MAY_HAVE_STARTED';
      if (overrides.markerError) throw overrides.markerError;
      return execution;
    },
  );
  const logger = { info: vi.fn(), error: vi.fn() };
  const updateTarget = vi.fn(
    async (id: string, data: ManualPublicationTargetUpdate) => {
      const request = [...requests.values()].find((candidate) =>
        candidate.targets.some((target) => target.id === id),
      );
      const target = request?.targets.find((candidate) => candidate.id === id);
      if (!target) return null;
      Object.assign(target, data, { updatedAt: NOW });
      return target;
    },
  );
  const updateRequest = vi.fn(
    async (id: string, data: ManualPublicationRequestUpdate) => {
      const request = requests.get(id);
      if (!request) return null;
      Object.assign(request, data, { updatedAt: NOW });
      return request;
    },
  );

  const requestRepository: ManualPublicationRequestRepository = {
    accept: async (input) => {
      const existing = requests.get(input.idempotencyKey);
      if (existing) return { request: existing, created: false };
      createdRequestCount += 1;
      const request: ManualPublicationRequestRecord = {
        id: input.id ?? 'manual-request',
        idempotencyKey: input.idempotencyKey,
        payloadHash: input.payloadHash,
        mode: input.mode,
        productId: input.productId,
        requestedSnapshotId: input.requestedSnapshotId,
        requestedSnapshotRevision: input.requestedSnapshotRevision,
        requestedSnapshotFingerprint: input.requestedSnapshotFingerprint,
        status: input.status ?? 'ACCEPTED',
        createdAt: input.createdAt ?? NOW,
        updatedAt: input.createdAt ?? NOW,
        completedAt: null,
        processingOwnerId: null,
        processingLeaseExpiresAt: null,
        targets: input.targets.map((item) => {
          const selectedGroup = groups.find(
            (candidate) => candidate.id === item.destinationId,
          )!;
          const selectedCampaign = campaigns.find(
            (candidate) => candidate.id === item.campaignId,
          )!;
          return {
            ...targetRecord(
              requestIdFor(input.id),
              selectedGroup,
              selectedCampaign,
            ),
            id: item.id ?? `${input.id}-${item.destinationId}`,
            requestId: input.id ?? 'manual-request',
            status: item.status ?? 'ACCEPTED',
            candidate:
              recovery?.candidate && selectedGroup.id === 'a'
                ? recovery.candidate
                : null,
          };
        }),
      };
      requests.set(request.idempotencyKey, request);
      requests.set(request.id, request);
      return { request, created: true };
    },
    findById: async (id) => requests.get(id) ?? null,
    findByIdempotencyKey: async (key) => requests.get(key) ?? null,
    claimProcessing: async (id, ownerId, now, leaseExpiresAt) => {
      const request = requests.get(id);
      if (!request) return null;
      const expired =
        request.processingLeaseExpiresAt === null ||
        request.processingLeaseExpiresAt.getTime() <= now.getTime();
      if (
        request.status !== 'ACCEPTED' &&
        !(request.status === 'PROCESSING' && expired)
      ) {
        return null;
      }
      Object.assign(request, {
        status: 'PROCESSING',
        processingOwnerId: ownerId,
        processingLeaseExpiresAt: leaseExpiresAt,
        completedAt: null,
        updatedAt: NOW,
      });
      return request;
    },
    renewProcessing: async (id, ownerId, leaseExpiresAt) => {
      const request = requests.get(id);
      if (
        !request ||
        request.status !== 'PROCESSING' ||
        request.processingOwnerId !== ownerId
      ) {
        return false;
      }
      request.processingLeaseExpiresAt = leaseExpiresAt;
      request.updatedAt = NOW;
      return true;
    },
    reserveSendSlot: async () =>
      overrides.quotaBlocked
        ? { kind: 'BLOCKED' as const, reason: overrides.quotaBlocked }
        : { kind: 'RESERVED' as const },
    releaseSendSlot,
    updateTarget,
    updateRequest,
  };

  const service = new ManualPublicationService({
    requests: requestRepository,
    offers: { findOfferById: async () => offer(source) },
    catalog: {
      findOfficialCatalogItem: async () =>
        overrides.item ?? catalogItem(source),
    },
    groups: {
      findById: async (id: string) =>
        groups.find((candidate) => candidate.id === id) ?? null,
      listAll: async () => groups,
    },
    campaigns: {
      findByLogicalGroupFingerprint: async (fingerprint: string) =>
        campaigns.find(
          (candidate) => candidate.logicalGroupFingerprint === fingerprint,
        ) ?? null,
      list: async () => ({ items: campaigns, total: campaigns.length }),
    },
    instances: {
      findByName: async (name: string) => ({
        name,
        active: overrides.instanceActive ?? true,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    },
    candidates: {
      findByCampaignAndProduct: async () => null,
      listCampaignCandidates: async () => [],
    },
    copies: {
      loadContext: async () => null,
      findCopyForCandidate: async () => null,
    },
    deliveryHistory: { wasProductSentToGroup: async () => false },
    policy: { evaluateManualSendSafety },
    candidateFlow: {
      reserveAttempt,
      releaseAttempt,
      renewAttempt: async () => ({
        kind: 'RENEWED' as const,
        campaignId: 'campaign-a',
        executionId: 'manual-execution',
        leaseExpiresAt: new Date(NOW.getTime() + 120_000),
        renewed: true,
      }),
      prepareManual,
    },
    executions: {
      start: startExecution,
      findBySchedulerJobId: async (schedulerJobId: string) =>
        executions.find(
          (execution) => execution.schedulerJobId === schedulerJobId,
        ) ?? null,
      heartbeat: async (
        ownership: { executionId: string; ownerId: string },
        input: { heartbeatAt: Date; leaseExpiresAt: Date },
      ) => {
        events.push(`heartbeat:${ownership.executionId}`);
        const execution = executions.find(
          (item) => item.id === ownership.executionId,
        );
        if (
          !execution ||
          execution.ownerId !== ownership.ownerId ||
          execution.status !== 'STARTED'
        ) {
          throw new Error('ownership lost');
        }
        execution.heartbeatAt = input.heartbeatAt;
        execution.leaseExpiresAt = input.leaseExpiresAt;
      },
      markExternalMayHaveStarted,
      finish: async (
        ownership: { executionId: string; ownerId: string },
        input: {
          status: 'QUEUED' | 'BLOCKED' | 'FAILED' | 'AMBIGUOUS';
          commercialRunId?: string;
          failureCode?: string;
          completedAt: Date;
        },
      ) => {
        events.push(`finish:${input.status}:${ownership.executionId}`);
        const execution = executions.find(
          (item) => item.id === ownership.executionId,
        );
        if (
          !execution ||
          execution.ownerId !== ownership.ownerId ||
          execution.status !== 'STARTED'
        ) {
          throw new Error('ownership lost');
        }
        execution.activeKey = null;
        execution.status = input.status;
        execution.commercialRunId = input.commercialRunId ?? null;
        execution.failureCode = input.failureCode ?? null;
        execution.completedAt = input.completedAt;
        return execution;
      },
      markQueuedAmbiguous: vi.fn(
        async (
          executionId: string,
          input: {
            commercialRunId: string;
            failureCode: string;
            completedAt: Date;
          },
        ) => {
          const execution = executions.find((item) => item.id === executionId);
          if (
            !execution ||
            execution.status !== 'QUEUED' ||
            execution.commercialRunId !== input.commercialRunId
          ) {
            throw new Error('queued execution ownership lost');
          }
          execution.activeKey = null;
          execution.status = 'AMBIGUOUS';
          execution.failureCode = input.failureCode;
          execution.completedAt = input.completedAt;
          return execution;
        },
      ),
      recoverStalePreMarkerReservation: vi.fn(
        async (
          executionId: string,
          input: { completedAt: Date; failureCode: string },
        ) => {
          const execution = executions.find((item) => item.id === executionId);
          if (!execution) throw new Error('execution missing');
          execution.activeKey = null;
          execution.ownerId = null;
          execution.status = 'FAILED';
          execution.failureCode = input.failureCode;
          execution.completedAt = input.completedAt;
          return {
            outcome: 'RECOVERED' as const,
            execution,
            campaignId: 'campaign-a',
            failureCount: 1,
            nextEligibleAt: input.completedAt,
          };
        },
      ),
      recoverStalePreConfirmationReservation: vi.fn(
        async (
          executionId: string,
          input: { completedAt: Date; failureCode: string },
        ) => {
          const execution = executions.find((item) => item.id === executionId);
          if (!execution) throw new Error('execution missing');
          execution.activeKey = null;
          execution.ownerId = null;
          execution.status = 'FAILED';
          execution.failureCode = input.failureCode;
          execution.completedAt = input.completedAt;
          return { outcome: 'RECOVERED' as const, execution };
        },
      ),
      recoverStale: vi.fn(
        async (
          executionId: string,
          input: {
            status: 'QUEUED' | 'FAILED' | 'AMBIGUOUS';
            failureCode?: string;
            completedAt: Date;
          },
        ) => {
          const execution = executions.find((item) => item.id === executionId);
          if (!execution) throw new Error('execution missing');
          execution.activeKey = null;
          execution.ownerId = null;
          execution.status = input.status;
          execution.failureCode = input.failureCode ?? null;
          execution.completedAt = input.completedAt;
          return execution;
        },
      ),
    },
    runs: {
      findById: async (id: string) =>
        recovery?.run.id === id
          ? recovery.run
          : overrides.recoverRun?.id === id
            ? overrides.recoverRun
            : null,
      findByExecutionId: async (executionId: string) => {
        if (!recovery) return null;
        recovery.run.executionId = executionId;
        return recovery.run;
      },
    },
    outboxes: { findById: async (id: string) => outboxes.get(id) ?? null },
    dispatches: { findByIdWithDetails: async () => null },
    confirmation: {
      confirm,
      publishOutbox: vi.fn(async () => {
        events.push('publish');
        if (overrides.publishOutboxError) throw overrides.publishOutboxError;
      }),
    },
    environment: {
      groupSendEnabled: overrides.groupSendEnabled ?? true,
      safeMode: overrides.safeMode ?? true,
      schedulerEnabled: true,
      maximumMessagesPerRun: 1,
    },
    logger,
    clock: () => NOW,
  } as never);

  return {
    service,
    reserveAttempt,
    releaseAttempt,
    releaseSendSlot,
    markExternalMayHaveStarted,
    prepareManual,
    confirm,
    startExecution,
    executions,
    events,
    evaluateManualSendSafety,
    updateTarget,
    updateRequest,
    requests,
    outboxes,
    logger,
    get createdRequestCount() {
      return createdRequestCount;
    },
  };
};

const requestIdFor = (id: string | undefined) =>
  id ?? 'manual-publication-request';

const TERMINAL_COMPLETED_AT = new Date('2026-08-25T15:01:00.000Z');
const TERMINAL_UPDATED_AT = new Date('2026-08-25T15:02:00.000Z');

const seedPersistedRequest = (
  subject: ReturnType<typeof createSubject>,
  options: {
    id?: string;
    idempotencyKey?: string;
    status?: ManualPublicationRequestRecord['status'];
    targetStatus?: ManualPublicationTargetRecord['status'];
    investigationRequired?: boolean;
    completedAt?: Date | null;
    updatedAt?: Date;
    processingOwnerId?: string | null;
    processingLeaseExpiresAt?: Date | null;
  } = {},
) => {
  const id = options.id ?? 'manual-terminal-request';
  const idempotencyKey = options.idempotencyKey ?? 'manual-terminal-key';
  const status = options.status ?? 'COMPLETED';
  const selectedGroup = group('a');
  const selectedCampaign = campaign(selectedGroup);
  const targetStatus =
    options.targetStatus ??
    (status === 'PROCESSING'
      ? 'QUEUED'
      : status === 'AMBIGUOUS'
        ? 'AMBIGUOUS'
        : 'SENT');
  const request: ManualPublicationRequestRecord = {
    id,
    idempotencyKey,
    payloadHash: manualPublicationPayloadHash(
      canonicalManualPublicationPayload({
        mode: 'SEND',
        productId: 'product-1',
        destinationIds: ['a'],
      }),
    ),
    mode: 'SEND',
    productId: 'product-1',
    requestedSnapshotId: 'snapshot-1',
    requestedSnapshotRevision: 1,
    requestedSnapshotFingerprint: 'snapshot-fingerprint',
    status,
    createdAt: NOW,
    updatedAt: options.updatedAt ?? TERMINAL_UPDATED_AT,
    completedAt:
      options.completedAt !== undefined
        ? options.completedAt
        : status === 'PROCESSING'
          ? null
          : TERMINAL_COMPLETED_AT,
    processingOwnerId:
      options.processingOwnerId !== undefined
        ? options.processingOwnerId
        : status === 'PROCESSING'
          ? 'owner-1'
          : null,
    processingLeaseExpiresAt:
      options.processingLeaseExpiresAt !== undefined
        ? options.processingLeaseExpiresAt
        : status === 'PROCESSING'
          ? new Date(NOW.getTime() + 60_000)
          : null,
    targets: [
      {
        ...targetRecord(id, selectedGroup, selectedCampaign),
        status: targetStatus,
        investigationRequired:
          options.investigationRequired ?? status === 'AMBIGUOUS',
      },
    ],
  };
  subject.requests.set(request.id, request);
  subject.requests.set(request.idempotencyKey, request);
  return request;
};

describe('ManualPublicationService', () => {
  it('canonicaliza destinos e produz o mesmo hash independentemente da ordem', () => {
    const first = canonicalManualPublicationPayload({
      productId: 'product-1',
      destinationIds: ['b', 'a'],
    });
    const second = canonicalManualPublicationPayload({
      productId: 'product-1',
      destinationIds: ['a', 'b'],
    });

    expect(first).toBe(second);
    expect(manualPublicationPayloadHash(first)).toBe(
      manualPublicationPayloadHash(second),
    );
  });

  it('inclui o modo da operacao no payload canonico', () => {
    const preview = canonicalManualPublicationPayload({
      mode: 'PREVIEW',
      productId: 'product-1',
      destinationIds: ['a'],
    });
    const send = canonicalManualPublicationPayload({
      mode: 'SEND',
      productId: 'product-1',
      destinationIds: ['a'],
    });

    expect(preview).not.toBe(send);
    expect(manualPublicationPayloadHash(preview)).not.toBe(
      manualPublicationPayloadHash(send),
    );
  });

  it('previewOnlyWritesRequestTargets', async () => {
    const subject = createSubject();

    const result = await subject.service.preview({
      idempotencyKey: 'preview-only-key',
      productId: 'product-1',
      destinationIds: ['a'],
    });

    expect(result.created).toBe(true);
    expect(result.request).toMatchObject({
      mode: 'PREVIEW',
      status: 'PREVIEW_READY',
    });
    expect(result.request.targets).toHaveLength(1);
    expect(result.request.targets[0]).toMatchObject({
      status: 'ACCEPTED',
      candidateId: null,
      runId: null,
      dispatchId: null,
      outboxId: null,
    });
    expect(subject.createdRequestCount).toBe(1);
    expect(subject.reserveAttempt).not.toHaveBeenCalled();
    expect(subject.prepareManual).not.toHaveBeenCalled();
    expect(subject.confirm).not.toHaveBeenCalled();
    expect(subject.evaluateManualSendSafety).not.toHaveBeenCalled();
    expect(subject.startExecution).not.toHaveBeenCalled();
    expect(subject.executions).toHaveLength(0);
  });

  it('previewNoCandidateWrites previewNoReservation previewNoCopy previewNoRun previewNoDispatch previewNoOutbox previewNoBullMQ previewNoProvider', async () => {
    const subject = createSubject();

    await subject.service.preview({
      idempotencyKey: 'preview-boundary-key',
      productId: 'product-1',
      destinationIds: ['a'],
    });

    expect(subject.reserveAttempt).not.toHaveBeenCalled();
    expect(subject.prepareManual).not.toHaveBeenCalled();
    expect(subject.confirm).not.toHaveBeenCalled();
    expect(subject.startExecution).not.toHaveBeenCalled();
    expect(subject.executions).toHaveLength(0);
    expect(subject.createdRequestCount).toBe(1);
  });

  it('pausedAllowsPreview without consulting send policy', async () => {
    const subject = createSubject();
    subject.evaluateManualSendSafety.mockResolvedValue({
      allowed: false,
      reasons: ['AUTOMATION_PAUSED'],
    });

    await expect(
      subject.service.preview({
        idempotencyKey: 'preview-paused-key',
        productId: 'product-1',
        destinationIds: ['a'],
      }),
    ).resolves.toMatchObject({
      request: { mode: 'PREVIEW', status: 'PREVIEW_READY' },
    });
    expect(subject.evaluateManualSendSafety).not.toHaveBeenCalled();
  });

  it('sourceMockRejected with zero request or target rows', async () => {
    const subject = createSubject('MOCK');

    await expect(
      subject.service.preview({
        idempotencyKey: 'preview-mock-key',
        productId: 'product-1',
        destinationIds: ['a'],
      }),
    ).rejects.toMatchObject({ code: 'MANUAL_PUBLICATION_SOURCE_UNSUPPORTED' });
    expect(subject.createdRequestCount).toBe(0);
  });

  it('staleRejected before any durable write', async () => {
    const stale = catalogItem('OFFICIAL');
    stale.commercialSnapshotFingerprint = 'stale-fingerprint';
    const subject = createSubject('OFFICIAL', undefined, { item: stale });

    await expect(
      subject.service.preview({
        idempotencyKey: 'preview-stale-key',
        productId: 'product-1',
        destinationIds: ['a'],
      }),
    ).rejects.toMatchObject({ code: 'MANUAL_PUBLICATION_PRODUCT_INELIGIBLE' });
    expect(subject.createdRequestCount).toBe(0);
  });

  it('sameKeyReplay reuses the preview request without extra rows', async () => {
    const subject = createSubject();
    const input = {
      idempotencyKey: 'preview-replay-key',
      productId: 'product-1',
      destinationIds: ['a'],
    };

    const first = await subject.service.preview(input);
    const second = await subject.service.preview(input);

    expect(first.request.id).toBe(second.request.id);
    expect(second.created).toBe(false);
    expect(subject.createdRequestCount).toBe(1);
    expect(second.request.targets).toHaveLength(1);
  });

  it('sameKeyConflict rejects a different preview payload without mutation', async () => {
    const subject = createSubject();
    await subject.service.preview({
      idempotencyKey: 'preview-conflict-key',
      productId: 'product-1',
      destinationIds: ['a'],
    });

    await expect(
      subject.service.preview({
        idempotencyKey: 'preview-conflict-key',
        productId: 'product-1',
        destinationIds: ['b'],
      }),
    ).rejects.toMatchObject({
      code: 'MANUAL_PUBLICATION_IDEMPOTENCY_CONFLICT',
    });
    expect(subject.createdRequestCount).toBe(1);
  });

  it('sameKeyConcurrent creates exactly one logical request', async () => {
    const subject = createSubject();
    const input = {
      idempotencyKey: 'preview-concurrent-key',
      productId: 'product-1',
      destinationIds: ['a'],
    };

    const [first, second] = await Promise.all([
      subject.service.preview(input),
      subject.service.preview(input),
    ]);

    expect(first.request.id).toBe(second.request.id);
    expect(subject.createdRequestCount).toBe(1);
    expect(first.request.targets).toHaveLength(1);
    expect(second.request.targets).toHaveLength(1);
  });

  it('restartSafePreview never aggregates or advances a preview request', async () => {
    const subject = createSubject();
    const first = await subject.service.preview({
      idempotencyKey: 'preview-restart-key',
      productId: 'product-1',
      destinationIds: ['a'],
    });

    const reloaded = await subject.service.find(first.request.id);

    expect(reloaded).toMatchObject({
      id: first.request.id,
      mode: 'PREVIEW',
      status: 'PREVIEW_READY',
    });
    expect(subject.createdRequestCount).toBe(1);
    expect(subject.reserveAttempt).not.toHaveBeenCalled();
    expect(subject.prepareManual).not.toHaveBeenCalled();
    expect(subject.confirm).not.toHaveBeenCalled();
  });

  it('find de SEND terminal permanece read-only e preserva completedAt', async () => {
    const subject = createSubject();
    const persisted = seedPersistedRequest(subject);

    const result = await subject.service.find(persisted.id);

    expect(result).toMatchObject({
      id: persisted.id,
      status: 'COMPLETED',
      completedAt: TERMINAL_COMPLETED_AT,
      updatedAt: TERMINAL_UPDATED_AT,
    });
    expect(subject.updateRequest).not.toHaveBeenCalled();
    expect(subject.updateTarget).not.toHaveBeenCalled();
    expect(subject.startExecution).not.toHaveBeenCalled();
    expect(subject.reserveAttempt).not.toHaveBeenCalled();
    expect(subject.prepareManual).not.toHaveBeenCalled();
    expect(subject.confirm).not.toHaveBeenCalled();
  });

  it('duas leituras de status consecutivas retornam a mesma view sem writes', async () => {
    const subject = createSubject();
    const persisted = seedPersistedRequest(subject);

    const first = await subject.service.find(persisted.id);
    const second = await subject.service.find(persisted.id);

    expect(second).toEqual(first);
    expect(subject.updateRequest).not.toHaveBeenCalled();
    expect(subject.updateTarget).not.toHaveBeenCalled();
  });

  it('find de request ativa também não reconcilia nem escreve lifecycle', async () => {
    const subject = createSubject();
    const persisted = seedPersistedRequest(subject, {
      id: 'manual-active-request',
      idempotencyKey: 'manual-active-key',
      status: 'PROCESSING',
      targetStatus: 'QUEUED',
    });

    const result = await subject.service.find(persisted.id);

    expect(result).toMatchObject({ id: persisted.id, status: 'PROCESSING' });
    expect(subject.updateRequest).not.toHaveBeenCalled();
    expect(subject.updateTarget).not.toHaveBeenCalled();
    expect(subject.startExecution).not.toHaveBeenCalled();
    expect(subject.reserveAttempt).not.toHaveBeenCalled();
  });

  it('replay de idempotencia terminal nao reagrega nem altera timestamps', async () => {
    const subject = createSubject();
    const persisted = seedPersistedRequest(subject);

    const result = await subject.service.create({
      idempotencyKey: persisted.idempotencyKey,
      productId: 'product-1',
      destinationIds: ['a'],
      confirm: MANUAL_PUBLICATION_CONFIRMATION,
    });

    expect(result.created).toBe(false);
    expect(result.request).toMatchObject({
      id: persisted.id,
      status: 'COMPLETED',
      completedAt: TERMINAL_COMPLETED_AT,
      updatedAt: TERMINAL_UPDATED_AT,
    });
    expect(subject.updateRequest).not.toHaveBeenCalled();
    expect(subject.updateTarget).not.toHaveBeenCalled();
    expect(subject.startExecution).not.toHaveBeenCalled();
    expect(subject.reserveAttempt).not.toHaveBeenCalled();
    expect(subject.prepareManual).not.toHaveBeenCalled();
    expect(subject.confirm).not.toHaveBeenCalled();
  });

  it('replay de AMBIGUOUS terminal nao tenta curar o lifecycle', async () => {
    const subject = createSubject();
    const persisted = seedPersistedRequest(subject, {
      id: 'manual-ambiguous-request',
      idempotencyKey: 'manual-ambiguous-key',
      status: 'AMBIGUOUS',
      targetStatus: 'AMBIGUOUS',
      investigationRequired: true,
    });

    const result = await subject.service.create({
      idempotencyKey: persisted.idempotencyKey,
      productId: 'product-1',
      destinationIds: ['a'],
      confirm: MANUAL_PUBLICATION_CONFIRMATION,
    });

    expect(result.created).toBe(false);
    expect(result.request).toMatchObject({
      id: persisted.id,
      status: 'AMBIGUOUS',
      completedAt: TERMINAL_COMPLETED_AT,
      updatedAt: TERMINAL_UPDATED_AT,
      targets: [{ status: 'AMBIGUOUS', investigationRequired: true }],
    });
    expect(subject.updateRequest).not.toHaveBeenCalled();
    expect(subject.updateTarget).not.toHaveBeenCalled();
    expect(subject.startExecution).not.toHaveBeenCalled();
    expect(subject.reserveAttempt).not.toHaveBeenCalled();
    expect(subject.prepareManual).not.toHaveBeenCalled();
    expect(subject.confirm).not.toHaveBeenCalled();
  });

  it.each([
    ['zero', []],
    ['two', ['a', 'b']],
    ['duplicate', ['a', 'a']],
  ] as const)(
    'max groups rejects %s with zero rows',
    async (_label, destinationIds) => {
      const subject = createSubject();

      await expect(
        subject.service.preview({
          idempotencyKey: `preview-groups-${_label}`,
          productId: 'product-1',
          destinationIds: [...destinationIds],
        }),
      ).rejects.toMatchObject({ code: 'MANUAL_PUBLICATION_DESTINATION_LIMIT' });
      expect(subject.createdRequestCount).toBe(0);
    },
  );

  it('manual publication permits exactly one group', async () => {
    const one = createSubject('OFFICIAL', undefined, { groups: [group('a')] });

    await expect(
      one.service.preview({
        idempotencyKey: 'preview-one-group',
        productId: 'product-1',
        destinationIds: ['a'],
      }),
    ).resolves.toMatchObject({ request: { status: 'PREVIEW_READY' } });
    expect(one.createdRequestCount).toBe(1);
  });

  it('previewCannotBecomeSend rejects before the SEND pipeline', async () => {
    const subject = createSubject();
    const input = {
      idempotencyKey: 'preview-send-escalation-key',
      productId: 'product-1',
      destinationIds: ['a'],
    };
    await subject.service.preview(input);

    await expect(
      subject.service.create({
        ...input,
        confirm: MANUAL_PUBLICATION_CONFIRMATION,
      }),
    ).rejects.toMatchObject({
      code: 'MANUAL_PUBLICATION_IDEMPOTENCY_CONFLICT',
    });
    expect(subject.reserveAttempt).not.toHaveBeenCalled();
    expect(subject.prepareManual).not.toHaveBeenCalled();
    expect(subject.confirm).not.toHaveBeenCalled();
    expect(subject.createdRequestCount).toBe(1);
  });

  it('bloqueia fonte MOCK antes de reserva, copy ou confirmacao', async () => {
    const subject = createSubject('MOCK');

    await expect(
      subject.service.create({
        idempotencyKey: 'manual-key',
        productId: 'product-1',
        destinationIds: ['a'],
        confirm: MANUAL_PUBLICATION_CONFIRMATION,
      }),
    ).rejects.toMatchObject({ code: 'MANUAL_PUBLICATION_SOURCE_UNSUPPORTED' });
    expect(subject.reserveAttempt).not.toHaveBeenCalled();
    expect(subject.prepareManual).not.toHaveBeenCalled();
    expect(subject.confirm).not.toHaveBeenCalled();
  });

  it('rejeita request SEND multi-grupo antes de criar request parcial', async () => {
    const subject = createSubject();
    const input = {
      idempotencyKey: 'manual-key',
      productId: 'product-1',
      destinationIds: ['b', 'a'],
      confirm: MANUAL_PUBLICATION_CONFIRMATION,
    };

    await expect(subject.service.create(input)).rejects.toMatchObject({
      code: 'MANUAL_PUBLICATION_DESTINATION_LIMIT',
    });
    expect(subject.createdRequestCount).toBe(0);
    expect(subject.prepareManual).not.toHaveBeenCalled();
    expect(subject.confirm).not.toHaveBeenCalled();
  });

  it('usa execution real, marca o boundary externo imediatamente antes da geracao e finaliza QUEUED antes de publicar o outbox', async () => {
    const subject = createSubject();

    await subject.service.create({
      idempotencyKey: 'manual-ownership-key',
      productId: 'product-1',
      destinationIds: ['a'],
      confirm: MANUAL_PUBLICATION_CONFIRMATION,
    });

    const [execution] = subject.executions;
    expect(execution).toMatchObject({
      mode: 'SEND',
      status: 'QUEUED',
      commercialRunId: 'run-a',
      schedulerJobId: expect.stringMatching(/^manual-publication:/),
    });
    expect(subject.reserveAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ executionId: execution?.id }),
    );
    expect(subject.prepareManual).toHaveBeenCalledWith(
      'product-1',
      expect.anything(),
      expect.objectContaining({ executionId: execution?.id }),
    );
    expect(subject.confirm).toHaveBeenCalledWith(
      'run-a',
      COMMERCIAL_CONFIRMATION_TOKEN,
      expect.objectContaining({ manual: true, deferPublication: true }),
    );
    expect(
      subject.events.filter((event) =>
        [
          'beforeExternalMarker',
          `external:${execution?.id}`,
          'externalMarked',
          'copyGenerate',
        ].includes(event),
      ),
    ).toEqual([
      'beforeExternalMarker',
      `external:${execution?.id}`,
      'externalMarked',
      'copyGenerate',
    ]);
    expect(subject.markExternalMayHaveStarted).toHaveBeenCalledOnce();
    expect(
      subject.events.indexOf(`finish:QUEUED:${execution?.id}`),
    ).toBeLessThan(subject.events.indexOf('publish'));
    expect(
      subject.events.filter((event: string) => event.startsWith('heartbeat:'))
        .length,
    ).toBeGreaterThanOrEqual(5);
  });

  it('libera reserva e slot quando o preparo falha antes do marker e da geracao', async () => {
    const subject = createSubject('OFFICIAL', undefined, {
      prepareManualFailure: {
        point: 'PRE_MARKER',
        error: new AppError(
          'Candidate mudou antes da geracao',
          'COMMERCIAL_AUTOMATION_CANDIDATE_CHANGED',
        ),
      },
    });

    const result = await subject.service.create({
      idempotencyKey: 'manual-pre-marker-failure',
      productId: 'product-1',
      destinationIds: ['a'],
      confirm: MANUAL_PUBLICATION_CONFIRMATION,
    });

    expect(result.request.targets[0]).toMatchObject({
      status: 'BLOCKED',
      investigationRequired: false,
      runId: null,
      dispatchId: null,
      outboxId: null,
    });
    expect(subject.markExternalMayHaveStarted).not.toHaveBeenCalled();
    expect(subject.events).not.toContain('copyGenerate');
    expect(subject.releaseAttempt).toHaveBeenCalledOnce();
    expect(subject.releaseSendSlot).toHaveBeenCalledOnce();
    expect(subject.executions[0]).toMatchObject({
      status: 'BLOCKED',
      externalStage: 'NOT_REACHED',
    });
    expect(subject.confirm).not.toHaveBeenCalled();
    expect(subject.outboxes.size).toBe(0);
  });

  it('mantem AMBIGUOUS e nao libera a reserva quando o marker persiste e falha na leitura', async () => {
    const subject = createSubject('OFFICIAL', undefined, {
      markerError: new AppError(
        'Ownership do marker perdida',
        'MANUAL_PUBLICATION_EXECUTION_CONFLICT',
      ),
    });

    const result = await subject.service.create({
      idempotencyKey: 'manual-marker-failure',
      productId: 'product-1',
      destinationIds: ['a'],
      confirm: MANUAL_PUBLICATION_CONFIRMATION,
    });

    expect(result.request.targets[0]).toMatchObject({
      status: 'AMBIGUOUS',
      investigationRequired: true,
    });
    expect(subject.markExternalMayHaveStarted).toHaveBeenCalledOnce();
    expect(subject.events).not.toContain('externalMarked');
    expect(subject.events).not.toContain('copyGenerate');
    expect(subject.releaseAttempt).not.toHaveBeenCalled();
    expect(subject.releaseSendSlot).not.toHaveBeenCalled();
    expect(subject.executions[0]).toMatchObject({
      status: 'AMBIGUOUS',
      externalStage: 'EXTERNAL_MAY_HAVE_STARTED',
    });
  });

  it('mantem AMBIGUOUS sem release ou retry quando a geracao fica incerta apos o marker', async () => {
    const subject = createSubject('OFFICIAL', undefined, {
      prepareManualFailure: {
        point: 'POST_MARKER',
        error: new AppError(
          'Resultado do provider incerto',
          'COMMERCIAL_AI_COPY_RESULT_AMBIGUOUS',
        ),
      },
    });
    const input = {
      idempotencyKey: 'manual-provider-uncertain',
      productId: 'product-1',
      destinationIds: ['a'],
      confirm: MANUAL_PUBLICATION_CONFIRMATION,
    };

    const result = await subject.service.create(input);
    const replay = await subject.service.create(input);

    expect(result.request.targets[0]).toMatchObject({
      status: 'AMBIGUOUS',
      investigationRequired: true,
    });
    expect(replay.request.targets[0]).toMatchObject({ status: 'AMBIGUOUS' });
    expect(subject.executions[0]).toMatchObject({
      status: 'AMBIGUOUS',
      externalStage: 'EXTERNAL_MAY_HAVE_STARTED',
    });
    expect(subject.releaseAttempt).not.toHaveBeenCalled();
    expect(subject.releaseSendSlot).not.toHaveBeenCalled();
    expect(subject.prepareManual).toHaveBeenCalledOnce();
  });

  it('nao torna ambiguo erro de provider que prova requestMayHaveStarted=false', async () => {
    const subject = createSubject('OFFICIAL', undefined, {
      prepareManualFailure: {
        point: 'POST_MARKER',
        error: new AppError(
          'Provider nao iniciou request',
          'COMMERCIAL_AI_COPY_PROVIDER_NOT_STARTED',
        ),
      },
    });

    const result = await subject.service.create({
      idempotencyKey: 'manual-provider-not-started',
      productId: 'product-1',
      destinationIds: ['a'],
      confirm: MANUAL_PUBLICATION_CONFIRMATION,
    });

    expect(result.request.targets[0]).toMatchObject({
      status: 'BLOCKED',
      blockedReason: 'COMMERCIAL_AI_COPY_PROVIDER_NOT_STARTED',
      investigationRequired: false,
    });
    expect(subject.releaseAttempt).toHaveBeenCalledOnce();
    expect(subject.releaseSendSlot).toHaveBeenCalledOnce();
    expect(subject.executions[0]).toMatchObject({ status: 'BLOCKED' });
  });

  it('nao marca nem gera quando a selecao manual ja retorna COPY_READY', async () => {
    const subject = createSubject('OFFICIAL', undefined, {
      candidateStatus: 'COPY_READY',
    });

    await subject.service.create({
      idempotencyKey: 'manual-copy-ready',
      productId: 'product-1',
      destinationIds: ['a'],
      confirm: MANUAL_PUBLICATION_CONFIRMATION,
    });

    expect(subject.markExternalMayHaveStarted).not.toHaveBeenCalled();
    expect(subject.events).not.toContain('copyGenerate');
  });

  it('mapeia erro desconhecido do preparo para codigo estavel sem registrar detalhes sensiveis', async () => {
    const subject = createSubject('OFFICIAL', undefined, {
      prepareManualFailure: {
        point: 'PRE_MARKER',
        error: new Error('secret provider payload'),
      },
    });

    const result = await subject.service.create({
      idempotencyKey: 'manual-unknown-preparation',
      productId: 'product-1',
      destinationIds: ['a'],
      confirm: MANUAL_PUBLICATION_CONFIRMATION,
    });

    expect(result.request.targets[0]).toMatchObject({
      status: 'FAILED',
      blockedReason: 'MANUAL_PUBLICATION_PREPARATION_FAILED',
      investigationRequired: false,
    });
    const [details, message] = subject.logger.error.mock.calls.at(-1) ?? [];
    expect(details).toMatchObject({
      event: 'manual-publication.target.unknown-failure',
      stage: 'PREPARATION',
      code: 'MANUAL_PUBLICATION_PREPARATION_FAILED',
    });
    expect(JSON.stringify(details)).not.toContain('secret provider payload');
    expect(message).toBe(
      'Manual publication target failed with an unknown error',
    );
  });

  it('marca a execution como AMBIGUOUS se a publicacao falha depois de QUEUED', async () => {
    const subject = createSubject('OFFICIAL', undefined, {
      publishOutboxError: new Error('publication uncertain'),
    });

    const result = await subject.service.create({
      idempotencyKey: 'manual-queued-ambiguous',
      productId: 'product-1',
      destinationIds: ['a'],
      confirm: MANUAL_PUBLICATION_CONFIRMATION,
    });

    expect(result.request.targets[0]).toMatchObject({
      status: 'AMBIGUOUS',
      investigationRequired: true,
    });
    expect(subject.executions[0]).toMatchObject({
      status: 'AMBIGUOUS',
      commercialRunId: 'run-a',
      activeKey: null,
    });
    expect(subject.events).toContain('finish:QUEUED:manual-execution-1');
  });

  it('nao cria execution quando a reserva de quota bloqueia o target', async () => {
    const subject = createSubject('OFFICIAL', undefined, {
      quotaBlocked: 'GROUP_DAILY_LIMIT_REACHED',
    });

    const result = await subject.service.create({
      idempotencyKey: 'manual-quota-blocked',
      productId: 'product-1',
      destinationIds: ['a'],
      confirm: MANUAL_PUBLICATION_CONFIRMATION,
    });

    expect(result.request.targets[0]).toMatchObject({
      status: 'BLOCKED',
      blockedReason: 'GROUP_DAILY_LIMIT_REACHED',
    });
    expect(subject.startExecution).not.toHaveBeenCalled();
    expect(subject.executions).toHaveLength(0);
    expect(subject.reserveAttempt).not.toHaveBeenCalled();
  });

  it.each([
    ['groupSendDisabled', { groupSendEnabled: false }, 'GROUP_SEND_DISABLED'],
    ['safeModeFalse', { safeMode: false }, 'COMMERCIAL_SAFE_MODE_REQUIRED'],
  ])(
    'bloqueia %s antes de criar execution',
    async (_name, overrides, reason) => {
      const subject = createSubject('OFFICIAL', undefined, overrides);

      const result = await subject.service.create({
        idempotencyKey: `manual-blocker-${reason}`,
        productId: 'product-1',
        destinationIds: ['a'],
        confirm: MANUAL_PUBLICATION_CONFIRMATION,
      });

      expect(result.request.targets[0]).toMatchObject({
        status: 'BLOCKED',
        blockedReason: reason,
      });
      expect(subject.startExecution).not.toHaveBeenCalled();
      expect(subject.executions).toHaveLength(0);
    },
  );

  it('mantem requests historicos multi-target legiveis sem migra-los', async () => {
    const subject = createSubject('OFFICIAL', undefined, {
      groups: [group('a'), group('b')],
      allowAllGroups: true,
    });
    const request = seedPersistedRequest(subject, {
      id: 'manual-two-targets',
      idempotencyKey: 'manual-two-targets-key',
    });
    request.targets.push(
      targetRecord(request.id, group('b'), campaign(group('b'))),
    );

    await expect(subject.service.find(request.id)).resolves.toMatchObject({
      id: request.id,
      targets: [{ destinationId: 'a' }, { destinationId: 'b' }],
    });
    expect(subject.startExecution).not.toHaveBeenCalled();
  });

  it('serializa duas criacoes concorrentes com a mesma chave', async () => {
    const subject = createSubject();
    const input = {
      idempotencyKey: 'manual-concurrent-key',
      productId: 'product-1',
      destinationIds: ['a'],
      confirm: MANUAL_PUBLICATION_CONFIRMATION,
    };

    const [first, second] = await Promise.all([
      subject.service.create(input),
      subject.service.create(input),
    ]);

    expect(first.request.id).toBe(second.request.id);
    expect(subject.prepareManual).toHaveBeenCalledOnce();
    expect(subject.confirm).toHaveBeenCalledOnce();
  });

  it('reconcilia um run persistido depois de restart sem criar novo pipeline', async () => {
    const subject = createSubject('OFFICIAL', {
      run: recoveredRun(),
      candidate: {
        id: 'candidate-a',
        generatedCopyId: 'copy-a',
        status: 'COPY_READY',
      },
    });

    const result = await subject.service.create({
      idempotencyKey: 'recovery-key',
      productId: 'product-1',
      destinationIds: ['a'],
      confirm: MANUAL_PUBLICATION_CONFIRMATION,
    });

    expect(result.request.targets[0]).toMatchObject({
      candidateId: 'candidate-a',
      runId: 'run-a',
      status: 'QUEUED',
    });
    expect(subject.prepareManual).not.toHaveBeenCalled();
    expect(subject.confirm).not.toHaveBeenCalled();
  });

  it('replaya target com run persistido pela execution logica sem criar outra execution', async () => {
    const subject = createSubject('OFFICIAL', {
      run: recoveredRun(),
      candidate: {
        id: 'candidate-a',
        generatedCopyId: 'copy-a',
        status: 'COPY_READY',
      },
    });

    const first = await subject.service.create({
      idempotencyKey: 'recovery-target-key',
      productId: 'product-1',
      destinationIds: ['a'],
      confirm: MANUAL_PUBLICATION_CONFIRMATION,
    });
    const request = subject.requests.get('recovery-target-key');
    if (!request) throw new Error('request ausente');
    const target = request.targets[0];
    target.status = 'PROCESSING';
    target.runId = first.request.targets[0]?.runId ?? 'run-a';
    target.dispatchId = null;
    target.outboxId = null;
    request.status = 'PROCESSING';
    request.processingLeaseExpiresAt = new Date(NOW.getTime() - 1);

    const replay = await subject.service.create({
      idempotencyKey: 'recovery-target-key',
      productId: 'product-1',
      destinationIds: ['a'],
      confirm: MANUAL_PUBLICATION_CONFIRMATION,
    });

    expect(replay.request.targets[0]).toMatchObject({
      runId: 'run-a',
      status: 'QUEUED',
    });
    expect(subject.startExecution).toHaveBeenCalledOnce();
    expect(subject.confirm).not.toHaveBeenCalled();
    expect(subject.executions).toHaveLength(1);
  });

  it('recupera execution STARTED stale pelo contrato seguro antes de criar outra', async () => {
    const subject = createSubject();
    const input = {
      idempotencyKey: 'manual-stale-execution',
      productId: 'product-1',
      destinationIds: ['a'],
      confirm: MANUAL_PUBLICATION_CONFIRMATION,
    };

    await subject.service.create(input);
    const request = subject.requests.get(input.idempotencyKey);
    if (!request) throw new Error('request ausente');
    const target = request.targets[0];
    const execution = subject.executions[0];
    if (!target || !execution) throw new Error('estado ausente');
    target.status = 'PROCESSING';
    target.candidateId = null;
    target.runId = null;
    target.dispatchId = null;
    target.outboxId = null;
    request.status = 'PROCESSING';
    request.processingLeaseExpiresAt = new Date(NOW.getTime() - 1);
    execution.status = 'STARTED';
    execution.activeKey = 'commercial-automation';
    execution.ownerId = 'stale-owner';
    execution.heartbeatAt = new Date(NOW.getTime() - 120_000);
    execution.leaseExpiresAt = new Date(NOW.getTime() - 1);
    execution.commercialRunId = null;
    execution.externalStage = 'NOT_REACHED';
    execution.completedAt = null;

    const replay = await subject.service.create(input);

    expect(replay.request.targets[0]).toMatchObject({
      status: 'FAILED',
      investigationRequired: false,
      blockedReason: 'COMMERCIAL_EXECUTION_ABANDONED_SAFE',
    });
    expect(execution).toMatchObject({
      status: 'FAILED',
      activeKey: null,
      ownerId: null,
    });
    expect(subject.startExecution).toHaveBeenCalledOnce();
    expect(subject.reserveAttempt).toHaveBeenCalledOnce();
  });

  it('marca como AMBIGUOUS a republicacao de execution QUEUED que falha', async () => {
    const overrides: NonNullable<Parameters<typeof createSubject>[2]> = {};
    const recovery = {
      run: recoveredRun({
        mode: 'CONFIRMED',
        dispatchId: 'commercial-run-a-dispatch',
        jobId: 'commercial-run-a-job',
      }),
      candidate: {
        id: 'candidate-a',
        generatedCopyId: 'copy-a',
        status: 'COPY_READY' as const,
      },
    };
    const subject = createSubject('OFFICIAL', recovery, overrides);
    const input = {
      idempotencyKey: 'manual-queued-replay',
      productId: 'product-1',
      destinationIds: ['a'],
      confirm: MANUAL_PUBLICATION_CONFIRMATION,
    };

    await subject.service.create(input);
    overrides.publishOutboxError = new Error('publication uncertain');
    const request = subject.requests.get(input.idempotencyKey);
    if (!request) throw new Error('request ausente');
    request.processingLeaseExpiresAt = new Date(NOW.getTime() - 1);
    const replay = await subject.service.create(input);

    expect(replay.request.targets[0]).toMatchObject({
      status: 'AMBIGUOUS',
      investigationRequired: true,
    });
    expect(subject.executions[0]).toMatchObject({
      status: 'AMBIGUOUS',
      commercialRunId: 'run-a',
      activeKey: null,
    });
  });

  it('recupera execution stale pre-confirmacao sem reenviar nem criar execution', async () => {
    const overrides: NonNullable<Parameters<typeof createSubject>[2]> = {
      recoverRun: recoveredRun(),
    };
    const subject = createSubject('OFFICIAL', undefined, overrides);
    const input = {
      idempotencyKey: 'manual-stale-preconfirmation',
      productId: 'product-1',
      destinationIds: ['a'],
      confirm: MANUAL_PUBLICATION_CONFIRMATION,
    };

    await subject.service.create(input);
    const request = subject.requests.get(input.idempotencyKey);
    if (!request) throw new Error('request ausente');
    const target = request.targets[0];
    const execution = subject.executions[0];
    if (!target || !execution) throw new Error('estado ausente');
    target.status = 'PROCESSING';
    target.candidateId = null;
    target.runId = null;
    target.dispatchId = null;
    target.outboxId = null;
    request.status = 'PROCESSING';
    request.processingLeaseExpiresAt = new Date(NOW.getTime() - 1);
    execution.status = 'STARTED';
    execution.activeKey = 'commercial-automation';
    execution.ownerId = 'stale-owner';
    execution.heartbeatAt = new Date(NOW.getTime() - 120_000);
    execution.leaseExpiresAt = new Date(NOW.getTime() - 1);
    execution.commercialRunId = 'run-a';
    execution.externalStage = 'NOT_REACHED';
    execution.completedAt = null;

    const replay = await subject.service.create(input);

    expect(replay.request.targets[0]).toMatchObject({
      status: 'FAILED',
      investigationRequired: false,
      blockedReason: 'COMMERCIAL_EXECUTION_ABANDONED_SAFE',
    });
    expect(execution).toMatchObject({
      status: 'FAILED',
      activeKey: null,
      ownerId: null,
    });
    expect(subject.startExecution).toHaveBeenCalledOnce();
    expect(subject.confirm).toHaveBeenCalledOnce();
  });
});
