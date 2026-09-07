import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import { CommercialInventorySupervisor } from '../src/commercial-inventory-supervisor';
import {
  decideCommercialPreparedRecovery,
  type CommercialPreparedRecoveryEvidence,
} from '../src/commercial-prepared-inventory-recovery';
import type { CommercialAutomationCandidatePolicyFence } from '../src/commercial-automation-candidate-flow-service';
import type {
  CommercialAutomationSettingsRecord,
  CommercialDiscoveryCheckpointRecord,
  CommercialDiscoveryCheckpointRepository,
  CommercialNicheRecord,
  CommercialPreparedMessageCreateInput,
  CommercialPreparedMessageRecord,
  CommercialPreparedMessageRepository,
  CommercialAutomationTarget,
} from '../src/repositories';

const now = new Date('2026-09-06T12:00:00.000Z');
const policyFence: CommercialAutomationCandidatePolicyFence = {
  nicheId: 'niche-1',
  nicheUpdatedAt: now,
};

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
        leaseRevision: 1,
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
      leaseRevision: this.record.leaseRevision + 1,
      lastRequestAt: input.now,
      ...(this.record.status === 'EXHAUSTED'
        ? { status: 'ACTIVE' as const, page: 1, cursor: null }
        : {}),
    };
    return this.record ?? null;
  }

  async advance(input: Parameters<CommercialDiscoveryCheckpointRepository['advance']>[0]) {
    if (
      !this.record ||
      this.record.leaseOwnerId !== input.ownerId ||
      this.record.leaseRevision !== input.leaseRevision
    ) return null;
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
  listReady: vi.fn(async () => []),
  createReady: vi.fn(async () => null),
  claimReady: vi.fn(async () => null),
  markDispatched: vi.fn(async () => false),
  release: vi.fn(async () => false),
  invalidateReserved: vi.fn(async () => false),
  invalidateReadyForPolicy: vi.fn(async () => false),
  recoverExpired: vi.fn(async () => 0),
  invalidateStale: vi.fn(async () => 0),
});

const preparedRecord = (
  candidateId: string,
  createdAt = now,
): CommercialPreparedMessageRecord => ({
  id: `prepared-${candidateId}`,
  campaignId: target.campaignId,
  groupDestinationId: target.groupId,
  instanceName: target.instanceName ?? '',
  logicalGroupFingerprint: target.logicalGroupFingerprint,
  candidateId,
  snapshotId: `snapshot-${candidateId}`,
  generatedCopyId: `copy-${candidateId}`,
  copyPreview: `copy ${candidateId}`,
  runId: null,
  status: 'READY',
  reservationOwnerId: null,
  reservationLeaseExpiresAt: null,
  scheduleRevision: 1,
  assignmentRevision: 1,
  preparationRevision: 1,
  expiresAt: new Date(createdAt.getTime() + 15 * 60_000),
  offerEndsAt: null,
  invalidatedReason: null,
  invalidatedAt: null,
  createdAt,
  updatedAt: createdAt,
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
      prepareInventory: vi.fn(async () => {
        throw new Error('unused');
      }),
      revalidate: vi.fn(async () => policyFence),
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
    expect(syncOffers).toHaveBeenNthCalledWith(
      1,
      {
        categoryId: '123',
        sort: 'commission_desc',
        page: 1,
      },
      expect.objectContaining({
        writeFence: expect.objectContaining({
          checkpointId: 'checkpoint-1',
          leaseRevision: 1,
        }),
      }),
    );
    expect(checkpoints.advanceOwners).toHaveLength(2);
    expect(checkpoints.advanceOwners[0]).toBe(checkpoints.advanceOwners[1]);
    expect(checkpoints.record?.status).toBe('EXHAUSTED');

    currentNow = new Date(now.getTime() + 61 * 60_000);
    const second = await supervisor.run({ mode: 'send', provider: 'official' });
    expect(second.discoveredPages).toBe(2);
    expect(syncOffers).toHaveBeenCalledTimes(4);
    expect(syncOffers).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ page: 1 }),
      expect.objectContaining({
        writeFence: expect.objectContaining({
          checkpointId: 'checkpoint-1',
          leaseRevision: 2,
        }),
      }),
    );
  });

  it('respeita pausa persistida e não descobre nem prepara', async () => {
    const candidateFlow = {
      listTargets: vi.fn(async () => [target]),
      preflight: vi.fn(),
      replenish: vi.fn(),
      prepareInventory: vi.fn(async () => {
        throw new Error('unused');
      }),
      revalidate: vi.fn(async () => policyFence),
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
      prepareInventory: vi.fn(async () => {
        throw new Error('unused');
      }),
      revalidate: vi.fn(async () => policyFence),
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

  it('remove READY incompatível antes de contar capacidade e prepara substituto local', async () => {
    const preparedRows = [preparedRecord('candidate-x'), preparedRecord('candidate-y')];
    const candidateFlow = {
      listTargets: vi.fn(async () => [target]),
      preflight: vi.fn(async () => ({
        outcome: 'READY' as const,
        candidateId: 'candidate-z',
        snapshotId: 'snapshot-candidate-z',
        candidateStatus: 'COPY_READY' as const,
        queue: { candidateCount: 3, eligibleCount: 1, rejectedCount: 2 },
      })),
      replenish: vi.fn(async () => ({ rejectionSummary: {} })),
      prepareInventory: vi.fn(async (selection: { candidateId: string; snapshotId?: string }) => ({
        generatedCopyId: `copy-${selection.candidateId}`,
        candidateId: selection.candidateId,
        snapshotId: selection.snapshotId ?? 'snapshot-candidate-z',
        campaignId: target.campaignId,
        groupId: target.groupId,
        logicalGroupFingerprint: target.logicalGroupFingerprint,
        nicheId: target.nicheId,
        copyPreview: 'copy candidate-z https://example.invalid/affiliate',
        offerEndsAt: null,
      })),
      revalidate: vi.fn(async (input: { candidateId: string }) => {
        if (input.candidateId === 'candidate-x') {
          throw new AppError(
            'Politica mudou',
            'COMMERCIAL_AUTOMATION_NICHE_POLICY_CHANGED',
          );
        }
        return policyFence;
      }),
    };
    const preparedMessages: CommercialPreparedMessageRepository = {
      ...emptyPreparedRepository(),
      countReady: vi.fn(async () =>
        preparedRows.filter((row) => row.status === 'READY').length,
      ),
      listReady: vi.fn(async () =>
        preparedRows.filter((row) => row.status === 'READY'),
      ),
      listProtectedCandidateIds: vi.fn(async () =>
        preparedRows
          .filter((row) => row.status === 'READY')
          .map((row) => row.candidateId),
      ),
      createReady: vi.fn(async (input: CommercialPreparedMessageCreateInput) => {
        const created = preparedRecord(input.candidateId, input.now);
        preparedRows.push({
          ...created,
          campaignId: input.campaignId,
          groupDestinationId: input.groupDestinationId,
          instanceName: input.instanceName,
          logicalGroupFingerprint: input.logicalGroupFingerprint,
          generatedCopyId: input.generatedCopyId,
          copyPreview: input.copyPreview ?? '',
        });
        return preparedRows[preparedRows.length - 1];
      }),
      invalidateReadyForPolicy: vi.fn(async (input) => {
        const row = preparedRows.find(({ id }) => id === input.id);
        if (!row || row.status !== 'READY') return false;
        row.status = 'INVALIDATED';
        row.invalidatedReason = input.reason;
        row.invalidatedAt = input.now;
        row.updatedAt = input.now;
        return true;
      }),
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

    await expect(
      supervisor.run({ mode: 'send', provider: 'official' }),
    ).resolves.toMatchObject({
      preparedMessages: 1,
      preparedReady: 2,
      skipped: 0,
    });
    expect(candidateFlow.revalidate).toHaveBeenCalledTimes(2);
    expect(preparedMessages.invalidateReadyForPolicy).toHaveBeenCalledWith({
      id: 'prepared-candidate-x',
      reason: 'COMMERCIAL_AUTOMATION_NICHE_POLICY_CHANGED',
      now,
    });
    expect(preparedMessages.createReady).toHaveBeenCalledWith(
      expect.objectContaining({ candidateId: 'candidate-z' }),
    );
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
      prepareInventory: vi.fn(async (selection: { candidateId: string; snapshotId?: string }) => ({
        generatedCopyId: `copy-${selection.candidateId}`,
        candidateId: selection.candidateId,
        snapshotId: selection.snapshotId ?? `snapshot-${selection.candidateId.slice(-1)}`,
        campaignId: target.campaignId,
        groupId: target.groupId,
        logicalGroupFingerprint: target.logicalGroupFingerprint,
        nicheId: target.nicheId,
        copyPreview: `copy-${selection.candidateId} https://example.invalid/affiliate`,
        offerEndsAt: null,
      })),
      revalidate: vi.fn(async () => policyFence),
    };
    const preparedMessages: CommercialPreparedMessageRepository = {
      countReady: vi.fn(async () => readyCandidateIds.length),
      listReady: vi.fn(async () => []),
      listProtectedCandidateIds: vi.fn(async () => [...readyCandidateIds]),
      createReady: vi.fn(async (input: CommercialPreparedMessageCreateInput) => {
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
          copyPreview: input.copyPreview ?? '',
          runId: input.runId ?? null,
          status: 'READY',
           reservationOwnerId: null,
           reservationLeaseExpiresAt: null,
           scheduleRevision: input.scheduleRevision ?? 1,
           assignmentRevision: input.assignmentRevision ?? 1,
           preparationRevision: input.preparationRevision ?? 1,
           expiresAt: new Date(input.now.getTime() + 15 * 60_000),
          offerEndsAt: null,
          invalidatedReason: null,
          invalidatedAt: null,
          createdAt: input.now,
          updatedAt: input.now,
        } satisfies CommercialPreparedMessageRecord;
      }),
      claimReady: vi.fn(async () => null),
      markDispatched: vi.fn(async () => false),
      release: vi.fn(async () => false),
      invalidateReserved: vi.fn(async () => false),
      invalidateReadyForPolicy: vi.fn(async () => false),
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
    expect(candidateFlow.prepareInventory).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ candidateId: 'candidate-a' }),
    );
    expect(candidateFlow.prepareInventory).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ candidateId: 'candidate-b' }),
    );
    expect(candidateFlow.preflight).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        ...target,
        scheduleRevision: 1,
        assignmentRevision: 1,
      }),
      { excludeCandidateIds: ['candidate-a'] },
    );
  });

  it('separa candidates entre as instancias ordenadas do mesmo grupo', async () => {
    const multiInstanceTarget: CommercialAutomationTarget = {
      ...target,
      instanceName: 'instance-a',
      orderedInstanceNames: ['instance-a', 'instance-b'],
      assignmentRevision: 1,
    };
    const candidates = [
      { candidateId: 'candidate-a', snapshotId: 'snapshot-a' },
      { candidateId: 'candidate-b', snapshotId: 'snapshot-b' },
      { candidateId: 'candidate-c', snapshotId: 'snapshot-c' },
      { candidateId: 'candidate-d', snapshotId: 'snapshot-d' },
    ];
    const preparedByInstance = new Map<string, string[]>([
      ['instance-b', ['candidate-a']],
    ]);
    const candidateFlow = {
      listTargets: vi.fn(async () => [multiInstanceTarget]),
      preflight: vi.fn(async (
        _target: CommercialAutomationTarget,
        options?: { excludeCandidateIds?: readonly string[] },
      ) => {
        const candidate = candidates.find(
          ({ candidateId }) =>
            !options?.excludeCandidateIds?.includes(candidateId),
        );
        return candidate
          ? {
              outcome: 'READY' as const,
              candidateId: candidate.candidateId,
              snapshotId: candidate.snapshotId,
              candidateStatus: 'COPY_READY' as const,
              queue: { candidateCount: 4, eligibleCount: 4, rejectedCount: 0 },
            }
          : { outcome: 'NO_CANDIDATE' as const };
      }),
      replenish: vi.fn(async () => ({ rejectionSummary: {} })),
      prepareInventory: vi.fn(async (selection: {
        candidateId: string;
        snapshotId?: string;
      }) => ({
        generatedCopyId: `copy-${selection.candidateId}`,
        candidateId: selection.candidateId,
        snapshotId: selection.snapshotId ?? 'missing-snapshot',
        campaignId: multiInstanceTarget.campaignId,
        groupId: multiInstanceTarget.groupId,
        logicalGroupFingerprint: multiInstanceTarget.logicalGroupFingerprint,
        nicheId: multiInstanceTarget.nicheId,
        copyPreview: `copy-${selection.candidateId} https://example.invalid/affiliate`,
        offerEndsAt: null,
      })),
      revalidate: vi.fn(async () => policyFence),
    };
    const listProtectedCandidateIds = vi.fn(async (input: {
      instanceName: string;
    }) => preparedByInstance.get(input.instanceName) ?? []);
    const countReady = vi.fn(async (input: { instanceName: string }) =>
      preparedByInstance.get(input.instanceName)?.length ?? 0,
    );
    const createReady = vi.fn(async (input: CommercialPreparedMessageCreateInput) => {
      const instanceCandidates = preparedByInstance.get(input.instanceName) ?? [];
      instanceCandidates.push(input.candidateId);
      preparedByInstance.set(input.instanceName, instanceCandidates);
      return {
        id: `prepared-${input.instanceName}-${input.candidateId}`,
        campaignId: input.campaignId,
        groupDestinationId: input.groupDestinationId,
        instanceName: input.instanceName,
        logicalGroupFingerprint: input.logicalGroupFingerprint,
        candidateId: input.candidateId,
        snapshotId: input.candidateId.replace('candidate', 'snapshot'),
        generatedCopyId: input.generatedCopyId,
        copyPreview: input.copyPreview ?? '',
        runId: input.runId ?? null,
        status: 'READY' as const,
        reservationOwnerId: null,
        reservationLeaseExpiresAt: null,
        scheduleRevision: input.scheduleRevision ?? 1,
        assignmentRevision: input.assignmentRevision ?? 1,
        preparationRevision: input.preparationRevision ?? 1,
        expiresAt: new Date(input.now.getTime() + 15 * 60_000),
        offerEndsAt: null,
        invalidatedReason: null,
        invalidatedAt: null,
        createdAt: input.now,
        updatedAt: input.now,
      } satisfies CommercialPreparedMessageRecord;
    });
    const preparedMessages: CommercialPreparedMessageRepository = {
      countReady,
      listReady: vi.fn(async () => []),
      listProtectedCandidateIds,
      createReady,
      claimReady: vi.fn(async () => null),
      markDispatched: vi.fn(async () => false),
      release: vi.fn(async () => false),
      invalidateReserved: vi.fn(async () => false),
      invalidateReadyForPolicy: vi.fn(async () => false),
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

    await supervisor.run({ mode: 'send', provider: 'official' });

    expect(
      createReady.mock.calls.map(([input]) => ({
        instanceName: input.instanceName,
        candidateId: input.candidateId,
      })),
    ).toEqual([
      { instanceName: 'instance-a', candidateId: 'candidate-b' },
      { instanceName: 'instance-a', candidateId: 'candidate-c' },
      { instanceName: 'instance-b', candidateId: 'candidate-d' },
    ]);
    expect(preparedByInstance).toEqual(
      new Map([
        ['instance-a', ['candidate-b', 'candidate-c']],
        ['instance-b', ['candidate-a', 'candidate-d']],
      ]),
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
