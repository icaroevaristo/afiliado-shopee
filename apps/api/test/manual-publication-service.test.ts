import { describe, expect, it, vi } from 'vitest';

import {
  canonicalManualPublicationPayload,
  MANUAL_PUBLICATION_CONFIRMATION,
  ManualPublicationService,
  manualPublicationPayloadHash,
} from '../src/manual-publication-service';
import type {
  CommercialGroupCampaignRecord,
  CommercialPipelineRunRecord,
  CommercialPromotionCatalogItem,
  CommercialPromotionSnapshotRecord,
  ManualPublicationRequestRecord,
  ManualPublicationRequestRepository,
  ManualPublicationTargetRecord,
  ShopeeOfferRecord,
  WhatsAppGroupRecord,
} from '../src/repositories';

const NOW = new Date('2026-08-25T15:00:00.000Z');

const offer = (source: ShopeeOfferRecord['source'] = 'OFFICIAL'): ShopeeOfferRecord => ({
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

const catalogItem = (source: ShopeeOfferRecord['source'] = 'OFFICIAL'): CommercialPromotionCatalogItem => ({
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

const campaign = (selectedGroup: WhatsAppGroupRecord): CommercialGroupCampaignRecord => ({
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
) => {
  const groups = [group('a'), group('b', false)];
  const campaigns = groups.map(campaign);
  const requests = new Map<string, ManualPublicationRequestRecord>();
  const outboxes = new Map<string, { id: string; commercialRunId: string; dispatchId: string; jobId: string; instanceName: string; status: 'PENDING'; failureCode: null; createdAt: Date; publishedAt: null }>();
  const reserveAttempt = vi.fn(async (target: { campaignId: string }) => ({
    kind: 'RESERVED' as const,
    campaignId: target.campaignId,
    executionId: 'manual-execution',
    reservedAt: NOW,
    leaseExpiresAt: new Date(NOW.getTime() + 120_000),
    acquired: true,
  }));
  const prepareManual = vi.fn(async (_productId: string, target: { groupId: string; campaignId: string; logicalGroupFingerprint: string }) => ({
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
  }));
  const confirm = vi.fn(async (runId: string) => {
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
  });

  const requestRepository: ManualPublicationRequestRepository = {
    accept: async (input) => {
      const existing = requests.get(input.idempotencyKey);
      if (existing) return { request: existing, created: false };
      const request: ManualPublicationRequestRecord = {
        id: input.id ?? 'manual-request',
        idempotencyKey: input.idempotencyKey,
        payloadHash: input.payloadHash,
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
          const selectedGroup = groups.find((candidate) => candidate.id === item.destinationId)!;
          const selectedCampaign = campaigns.find((candidate) => candidate.id === item.campaignId)!;
          return {
            ...targetRecord(requestIdFor(input.id), selectedGroup, selectedCampaign),
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
      if (request.status !== 'ACCEPTED' && !(request.status === 'PROCESSING' && expired)) {
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
    reserveSendSlot: async () => ({ kind: 'RESERVED' as const }),
    releaseSendSlot: async () => undefined,
    updateTarget: async (id, data) => {
      const request = [...requests.values()].find((candidate) => candidate.targets.some((target) => target.id === id));
      const target = request?.targets.find((candidate) => candidate.id === id);
      if (!target) return null;
      Object.assign(target, data, { updatedAt: NOW });
      return target;
    },
    updateRequest: async (id, data) => {
      const request = requests.get(id);
      if (!request) return null;
      Object.assign(request, data, { updatedAt: NOW });
      return request;
    },
  };

  const service = new ManualPublicationService({
    requests: requestRepository,
    offers: { findOfferById: async () => offer(source) },
    catalog: { findOfficialCatalogItem: async () => catalogItem(source) },
    groups: {
      findById: async (id: string) => groups.find((candidate) => candidate.id === id) ?? null,
      listAll: async () => groups,
    },
    campaigns: {
      findByLogicalGroupFingerprint: async (fingerprint: string) => campaigns.find((candidate) => candidate.logicalGroupFingerprint === fingerprint) ?? null,
      list: async () => ({ items: campaigns, total: campaigns.length }),
    },
    instances: { findByName: async (name: string) => ({ name, active: true, createdAt: NOW, updatedAt: NOW }) },
    candidates: { findByCampaignAndProduct: async () => null, listCampaignCandidates: async () => [] },
    copies: {
      loadContext: async () => null,
      findCopyForCandidate: async () => null,
    },
    deliveryHistory: { wasProductSentToGroup: async () => false },
    policy: {
      evaluateManualSendSafety: async (target: { groupId: string }) =>
        target.groupId === 'b'
          ? { allowed: false, reasons: ['GROUP_DAILY_LIMIT_REACHED'] }
          : { allowed: true, reasons: [] },
    },
    candidateFlow: {
      reserveAttempt,
      releaseAttempt: async () => ({ kind: 'RELEASED' as const, campaignId: 'campaign-a', executionId: 'manual-execution', released: true }),
      renewAttempt: async () => ({ kind: 'RENEWED' as const, campaignId: 'campaign-a', executionId: 'manual-execution', leaseExpiresAt: new Date(NOW.getTime() + 120_000), renewed: true }),
      prepareManual,
    },
    confirmation: { confirm },
    runs: {
      findById: async (id: string) =>
        recovery?.run.id === id ? recovery.run : null,
      findByExecutionId: async (executionId: string) => {
        if (!recovery) return null;
        recovery.run.executionId = executionId;
        return recovery.run;
      },
    },
    outboxes: { findById: async (id: string) => outboxes.get(id) ?? null },
    dispatches: { findByIdWithDetails: async () => null },
    environment: {
      groupSendEnabled: true,
      safeMode: true,
      schedulerEnabled: true,
      maximumMessagesPerRun: 1,
    },
    clock: () => NOW,
  } as never);

  return { service, reserveAttempt, prepareManual, confirm };
};

const requestIdFor = (id: string | undefined) => id ?? 'manual-publication-request';

describe('ManualPublicationService', () => {
  it('canonicaliza destinos e produz o mesmo hash independentemente da ordem', () => {
    const first = canonicalManualPublicationPayload({ productId: 'product-1', destinationIds: ['b', 'a'] });
    const second = canonicalManualPublicationPayload({ productId: 'product-1', destinationIds: ['a', 'b'] });

    expect(first).toBe(second);
    expect(manualPublicationPayloadHash(first)).toBe(manualPublicationPayloadHash(second));
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

  it('aceita grupos independentemente, preserva pausa como nao-bloqueio e replay nao repete o pipeline', async () => {
    const subject = createSubject();
    const input = {
      idempotencyKey: 'manual-key',
      productId: 'product-1',
      destinationIds: ['b', 'a'],
      confirm: MANUAL_PUBLICATION_CONFIRMATION,
    };

    const first = await subject.service.create(input);
    expect(first.created).toBe(true);
    expect(first.request.targets.find((target) => target.destinationId === 'a')).toMatchObject({ status: 'QUEUED' });
    expect(first.request.targets.find((target) => target.destinationId === 'b')).toMatchObject({
      status: 'BLOCKED',
      blockedReason: 'GROUP_DAILY_LIMIT_REACHED',
    });
    expect(subject.prepareManual).toHaveBeenCalledOnce();
    expect(subject.confirm).toHaveBeenCalledOnce();
    expect(subject.confirm).toHaveBeenCalledWith(
      'run-a',
      'CONFIRMAR_ENVIO_COMERCIAL',
      expect.objectContaining({ manual: true }),
    );

    const replay = await subject.service.create({ ...input, destinationIds: ['a', 'b'] });
    expect(replay.created).toBe(false);
    expect(subject.prepareManual).toHaveBeenCalledOnce();
    expect(subject.confirm).toHaveBeenCalledOnce();

    await expect(subject.service.create({ ...input, destinationIds: ['a'] })).rejects.toMatchObject({
      code: 'MANUAL_PUBLICATION_IDEMPOTENCY_CONFLICT',
    });
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
    expect(subject.confirm).toHaveBeenCalledTimes(1);
  });
});
