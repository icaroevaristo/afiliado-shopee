import { describe, expect, it, vi } from 'vitest';
import { CommercialInventorySupervisor } from '../src/commercial-inventory-supervisor';
import {
  decideCommercialPreparedRecovery,
  type CommercialPreparedRecoveryEvidence,
} from '../src/commercial-prepared-inventory-recovery';
import type {
  CommercialAutomationSettingsRecord,
  CommercialDiscoveryCheckpointRecord,
  CommercialDiscoveryCheckpointRepository,
  CommercialNicheRecord,
  CommercialPreparedMessageRecord,
  CommercialPreparedMessageRepository,
} from '../src/repositories';

const now = new Date('2026-09-06T12:00:00.000Z');

const target = {
  groupId: 'group-1',
  groupName: 'Grupo 1',
  instanceName: 'instance-1',
  logicalGroupFingerprint: 'group-fingerprint',
  campaignId: 'campaign-1',
  nicheId: 'niche-1',
  dailyLimit: 1,
  minCommissionRate: 0,
  minimumScore: 60,
};

const niche: CommercialNicheRecord = {
  id: 'niche-1',
  name: 'Casa',
  slug: 'casa',
  active: true,
  categoryIds: ['123'],
  includeKeywords: [],
  excludeKeywords: [],
  minPrice: null,
  maxPrice: null,
  minDiscountRate: 5,
  minRating: 0,
  minSales: 0,
  minCommissionRate: 0,
  minimumScore: 60,
  createdAt: now,
  updatedAt: now,
};

const settings: CommercialAutomationSettingsRecord = {
  paused: false,
  pausedAt: null,
  resumedAt: now,
  allowedStartTime: '00:00',
  allowedEndTime: '23:59',
  timezone: 'UTC',
  minimumIntervalMinutes: 1,
  staggerMinutes: 0,
  dailyGlobalLimit: 1,
  dailyGroupLimit: 1,
  dailyShopeeHttpLimit: 10,
  dailyOpenAiGenerationLimit: 10,
  usableCandidateLowWatermark: 2,
  usableCandidateTarget: 4,
  preparedLowWatermark: 1,
  preparedTarget: 2,
  discoveryPagesPerRun: 2,
  discoveryRefreshCooldownMinutes: 60,
  scheduleRevision: 1,
  updatedAt: now,
};

class MemoryCheckpointRepository implements CommercialDiscoveryCheckpointRepository {
  record: CommercialDiscoveryCheckpointRecord | undefined;
  advanceOwners: string[] = [];
  private sequence = 0;

  async acquire(input: Parameters<CommercialDiscoveryCheckpointRepository['acquire']>[0]) {
    if (!this.record) {
      this.record = {
        id: 'checkpoint-1',
        identityFingerprint: input.identityFingerprint,
        source: input.source,
        campaignId: input.campaignId,
        nicheId: input.nicheId,
        query: input.query,
        page: 1,
        cursor: null,
        status: 'ACTIVE',
        nextRefreshAt: null,
        leaseOwnerId: input.ownerId,
        leaseExpiresAt: input.leaseExpiresAt,
        lastRequestAt: input.now,
        lastSuccessAt: null,
        lastErrorCode: null,
        fetchedPages: 0,
        fetchedProducts: 0,
        createdAt: input.now,
        updatedAt: input.now,
      };
      return this.record;
    }
    if (this.record.nextRefreshAt && this.record.nextRefreshAt > input.now) return null;
    this.record = {
      ...this.record,
      leaseOwnerId: input.ownerId,
      leaseExpiresAt: input.leaseExpiresAt,
      lastRequestAt: input.now,
      ...(this.record.status === 'EXHAUSTED'
        ? { status: 'ACTIVE' as const, page: 1, cursor: null }
        : {}),
    };
    return this.record;
  }

  async advance(input: Parameters<CommercialDiscoveryCheckpointRepository['advance']>[0]) {
    if (!this.record || this.record.leaseOwnerId !== input.ownerId) return null;
    this.advanceOwners.push(input.ownerId);
    this.sequence += 1;
    this.record = {
      ...this.record,
      page: input.page,
      cursor: input.cursor,
      status: input.hasNextPage ? 'ACTIVE' : 'EXHAUSTED',
      nextRefreshAt: input.nextRefreshAt,
      lastSuccessAt: input.now,
      leaseOwnerId: input.hasNextPage ? input.ownerId : null,
      leaseExpiresAt: input.hasNextPage ? input.leaseExpiresAt : null,
      fetchedPages: this.sequence,
      fetchedProducts: this.record.fetchedProducts + input.fetchedProducts,
      updatedAt: input.now,
    };
    return this.record;
  }

  async fail(input: Parameters<CommercialDiscoveryCheckpointRepository['fail']>[0]) {
    if (!this.record || this.record.leaseOwnerId !== input.ownerId) return false;
    this.record = { ...this.record, lastErrorCode: input.errorCode, leaseOwnerId: null, leaseExpiresAt: null };
    return true;
  }
}

const emptyPreparedRepository = (): CommercialPreparedMessageRepository => ({
  countReady: vi.fn(async () => 0),
  createReady: vi.fn(async () => null),
  claimReady: vi.fn(async () => null),
  markDispatched: vi.fn(async () => false),
  release: vi.fn(async () => false),
  recoverExpired: vi.fn(async () => 0),
  invalidateStale: vi.fn(async () => 0),
});

describe('CommercialInventorySupervisor', () => {
  it('mantem o lease entre duas paginas e reinicia por cooldown apos replay', async () => {
    let currentNow = now;
    const checkpoints = new MemoryCheckpointRepository();
    const syncOffers = vi
      .fn()
      .mockResolvedValueOnce({ fetched: 2, hasNextPage: true, page: 1, nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ fetched: 1, hasNextPage: false, page: 2 })
      .mockResolvedValueOnce({ fetched: 2, hasNextPage: true, page: 1, nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ fetched: 1, hasNextPage: false, page: 2 });
    const candidateFlow = {
      listTargets: vi.fn(async () => [target]),
      preflight: vi.fn(async () => ({ outcome: 'NO_CANDIDATE' as const })),
      replenish: vi.fn(async () => ({ rejectionSummary: {} })),
      prepare: vi.fn(),
    };
    const supervisor = new CommercialInventorySupervisor({
      candidateFlow,
      preparedMessages: emptyPreparedRepository(),
      checkpoints,
      settings: {
        getOrCreate: vi.fn(async () => settings),
        get: vi.fn(async () => settings),
        setPaused: vi.fn(async () => settings),
        updateSchedule: vi.fn(async () => settings),
      },
      niches: { findById: vi.fn(async () => niche) },
      syncOffers: { run: syncOffers },
      logger: { info: vi.fn(), error: vi.fn() },
      clock: () => currentNow,
    });

    const first = await supervisor.run({ mode: 'send', provider: 'official' });
    expect(first.discoveredPages).toBe(2);
    expect(syncOffers).toHaveBeenCalledTimes(2);
    expect(syncOffers).toHaveBeenNthCalledWith(1, {
      categoryId: '123',
      sort: 'commission_desc',
      page: 1,
    });
    expect(checkpoints.advanceOwners).toHaveLength(2);
    expect(checkpoints.advanceOwners[0]).toBe(checkpoints.advanceOwners[1]);
    expect(checkpoints.record?.status).toBe('EXHAUSTED');

    currentNow = new Date(now.getTime() + 61 * 60_000);
    const second = await supervisor.run({ mode: 'send', provider: 'official' });
    expect(second.discoveredPages).toBe(2);
    expect(syncOffers).toHaveBeenCalledTimes(4);
    expect(syncOffers).toHaveBeenNthCalledWith(3, expect.objectContaining({ page: 1 }));
  });

  it('respeita pausa persistida e não descobre nem prepara', async () => {
    const candidateFlow = {
      listTargets: vi.fn(async () => [target]),
      preflight: vi.fn(),
      replenish: vi.fn(),
      prepare: vi.fn(),
    };
    const syncOffers = vi.fn();
    const supervisor = new CommercialInventorySupervisor({
      candidateFlow,
      preparedMessages: emptyPreparedRepository(),
      checkpoints: new MemoryCheckpointRepository(),
      settings: {
        getOrCreate: vi.fn(async () => ({ ...settings, paused: true })),
        get: vi.fn(async () => ({ ...settings, paused: true })),
        setPaused: vi.fn(async () => ({ ...settings, paused: true })),
        updateSchedule: vi.fn(async () => ({ ...settings, paused: true })),
      },
      niches: { findById: vi.fn(async () => niche) },
      syncOffers: { run: syncOffers },
      logger: { info: vi.fn(), error: vi.fn() },
      clock: () => now,
    });

    await expect(supervisor.run({ mode: 'send', provider: 'official' })).resolves.toMatchObject({
      targets: 0,
      discoveredPages: 0,
      preparedMessages: 0,
    });
    expect(candidateFlow.listTargets).not.toHaveBeenCalled();
    expect(syncOffers).not.toHaveBeenCalled();
  });

  it('não chama provider quando o inventário preparado já atingiu o target', async () => {
    const candidateFlow = {
      listTargets: vi.fn(async () => [target]),
      preflight: vi.fn(),
      replenish: vi.fn(),
      prepare: vi.fn(),
    };
    const preparedMessages = {
      ...emptyPreparedRepository(),
      countReady: vi.fn(async () => 2),
    };
    const syncOffers = vi.fn();
    const supervisor = new CommercialInventorySupervisor({
      candidateFlow,
      preparedMessages,
      checkpoints: new MemoryCheckpointRepository(),
      settings: {
        getOrCreate: vi.fn(async () => settings),
        get: vi.fn(async () => settings),
        setPaused: vi.fn(async () => settings),
        updateSchedule: vi.fn(async () => settings),
      },
      niches: { findById: vi.fn(async () => niche) },
      syncOffers: { run: syncOffers },
      logger: { info: vi.fn(), error: vi.fn() },
      clock: () => now,
    });

    await expect(supervisor.run({ mode: 'send', provider: 'official' })).resolves.toMatchObject({
      skipped: 1,
      discoveredPages: 0,
      preparedMessages: 0,
    });
    expect(candidateFlow.preflight).not.toHaveBeenCalled();
    expect(syncOffers).not.toHaveBeenCalled();
  });

  it('prepara candidates distintos até cobrir o target do inventário', async () => {
    const candidateOptions = [
      { candidateId: 'candidate-a', snapshotId: 'snapshot-a' },
      { candidateId: 'candidate-b', snapshotId: 'snapshot-b' },
    ];
    const readyCandidateIds: string[] = [];
    const candidateFlow = {
      listTargets: vi.fn(async () => [target]),
      preflight: vi.fn(async (
        _target: typeof target,
        options?: { excludeCandidateIds?: readonly string[] },
      ) => {
        const candidate = candidateOptions.find(
          ({ candidateId }) => !options?.excludeCandidateIds?.includes(candidateId),
        );
        return candidate
          ? {
              outcome: 'READY' as const,
              candidateId: candidate.candidateId,
              snapshotId: candidate.snapshotId,
              candidateStatus: 'COPY_READY' as const,
              queue: { candidateCount: 2, eligibleCount: 2, rejectedCount: 0 },
            }
          : { outcome: 'NO_CANDIDATE' as const };
      }),
      replenish: vi.fn(async () => ({ rejectionSummary: {} })),
      prepare: vi.fn(async (selection: { candidateId: string }) => ({
        runId: `run-${selection.candidateId}`,
        generatedCopyId: `copy-${selection.candidateId}`,
        candidateId: selection.candidateId,
        campaignId: target.campaignId,
        groupId: target.groupId,
        logicalGroupFingerprint: target.logicalGroupFingerprint,
      })),
    };
    const preparedMessages: CommercialPreparedMessageRepository = {
      countReady: vi.fn(async () => readyCandidateIds.length),
      listProtectedCandidateIds: vi.fn(async () => [...readyCandidateIds]),
      createReady: vi.fn(async (input) => {
        readyCandidateIds.push(input.candidateId);
        return {
          id: `prepared-${input.candidateId}`,
          campaignId: input.campaignId,
          groupDestinationId: input.groupDestinationId,
          instanceName: input.instanceName,
          logicalGroupFingerprint: input.logicalGroupFingerprint,
          candidateId: input.candidateId,
          snapshotId: `snapshot-${input.candidateId.slice(-1)}`,
          generatedCopyId: input.generatedCopyId,
          runId: input.runId,
          status: 'READY',
          reservationOwnerId: null,
          reservationLeaseExpiresAt: null,
          invalidatedReason: null,
          invalidatedAt: null,
          createdAt: input.now,
          updatedAt: input.now,
        } satisfies CommercialPreparedMessageRecord;
      }),
      claimReady: vi.fn(async () => null),
      markDispatched: vi.fn(async () => false),
      release: vi.fn(async () => false),
      recoverExpired: vi.fn(async () => 0),
      invalidateStale: vi.fn(async () => 0),
    };
    const supervisor = new CommercialInventorySupervisor({
      candidateFlow,
      preparedMessages,
      checkpoints: new MemoryCheckpointRepository(),
      settings: {
        getOrCreate: vi.fn(async () => settings),
        get: vi.fn(async () => settings),
        setPaused: vi.fn(async () => settings),
        updateSchedule: vi.fn(async () => settings),
      },
      niches: { findById: vi.fn(async () => niche) },
      syncOffers: { run: vi.fn() },
      logger: { info: vi.fn(), error: vi.fn() },
      clock: () => now,
    });

    const report = await supervisor.run({ mode: 'send', provider: 'official' });

    expect(readyCandidateIds).toEqual(['candidate-a', 'candidate-b']);
    expect(preparedMessages.createReady).toHaveBeenCalledTimes(2);
    expect(report.preparedReady).toBe(2);
    expect(candidateFlow.prepare).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ candidateId: 'candidate-a' }),
      { executionId: 'prepared:candidate-a:snapshot-a' },
    );
    expect(candidateFlow.prepare).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ candidateId: 'candidate-b' }),
      { executionId: 'prepared:candidate-b:snapshot-b' },
    );
    expect(candidateFlow.preflight).toHaveBeenNthCalledWith(
      3,
      target,
      { excludeCandidateIds: ['candidate-a'] },
    );
  });
});

describe('prepared inventory recovery', () => {
  const evidence = (patch: Partial<CommercialPreparedRecoveryEvidence> = {}): CommercialPreparedRecoveryEvidence => ({
    runMode: 'DRY_RUN',
    dispatchId: null,
    dispatchExists: false,
    outboxExists: false,
    ...patch,
  });

  it('reabre somente crash antes da criacao de outbox', () => {
    expect(decideCommercialPreparedRecovery(evidence())).toBe('REOPEN_READY');
  });

  it('fecha a reserva quando o crash ocorreu depois do outbox', () => {
    expect(decideCommercialPreparedRecovery(evidence({ outboxExists: true }))).toBe('CLOSE_DISPATCHED');
    expect(decideCommercialPreparedRecovery(evidence({ dispatchExists: true }))).toBe('CLOSE_DISPATCHED');
    expect(decideCommercialPreparedRecovery(evidence({ runMode: 'CONFIRMED' }))).toBe('CLOSE_DISPATCHED');
  });
});
