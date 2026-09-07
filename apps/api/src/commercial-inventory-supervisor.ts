import { createHash, randomUUID } from 'node:crypto';
import type { ShopeeProductOfferListInput } from '@shopee-auto-affiliate-ai/providers';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type {
  CommercialAutomationInventoryPreparation,
  CommercialAutomationCandidatePreflight,
  CommercialAutomationCandidateSelection,
  CommercialAutomationCandidatePolicyFence,
  CommercialAutomationCandidateRevalidation,
} from './commercial-automation-candidate-flow-service';
import { COMMERCIAL_AUTOMATION_NICHE_POLICY_CHANGED } from './commercial-automation-candidate-flow-service';
import type {
  CommercialAutomationMode,
  CommercialAutomationProvider,
} from './commercial-automation-execution-domain';
import type {
  CommercialDiscoveryWriteFence,
  CommercialAutomationSettingsRepository,
  CommercialDiscoveryCheckpointRepository,
  CommercialNicheRepository,
  CommercialPreparedMessageRepository,
} from './repositories';
import type { CommercialAutomationTarget } from './repositories';

export const COMMERCIAL_READY_INVENTORY_EMPTY =
  'COMMERCIAL_READY_INVENTORY_EMPTY';

const MAX_DISCOVERY_PAGES_PER_RUN = 3;
const MAX_DISCOVERY_PAGES_PER_HEARTBEAT = 6;
const MAX_PREPARED_PER_TARGET = 8;
const MAX_PREPARED_MESSAGES_PER_HEARTBEAT = 16;
const MAX_TARGETS_PER_HEARTBEAT = 32;
const CHECKPOINT_LEASE_MS = 120_000;
const PREPARED_RECOVERY_LIMIT = 100;

type InventoryRunBudget = {
  discoveryPagesRemaining: number;
  preparedMessagesRemaining: number;
};

type InventoryLogger = {
  info: (obj: unknown, message?: string) => void;
  error: (obj: unknown, message?: string) => void;
};

type CandidateFlow = {
  listTargets(): Promise<CommercialAutomationTarget[]>;
  preflight(
    target: CommercialAutomationTarget,
    options?: { excludeCandidateIds?: readonly string[] },
  ): Promise<CommercialAutomationCandidatePreflight>;
  replenish(target: CommercialAutomationTarget): Promise<unknown>;
  prepareInventory(
    selection: CommercialAutomationCandidateSelection,
  ): Promise<CommercialAutomationInventoryPreparation>;
  revalidate(
    input: CommercialAutomationCandidateRevalidation,
  ): Promise<CommercialAutomationCandidatePolicyFence>;
};

export type CommercialInventorySupervisorReport = {
  targets: number;
  prepared: number;
  preparedReady: number;
  futureSlotsCovered: number;
  nominalCandidates: number;
  usableCandidates: number;
  fetchedProducts: number;
  createdProducts: number;
  discoveredPages: number;
  mined: number;
  preparedMessages: number;
  skipped: number;
  failures: string[];
};

type PreparedInventoryFill = {
  readyCount: number;
  preparedCount: number;
};

const safeErrorCode = (error: unknown) =>
  error instanceof AppError ? error.code : 'COMMERCIAL_INVENTORY_SUPERVISOR_FAILED';

const hashIdentity = (
  source: string,
  campaignId: string,
  nicheId: string,
  query: ShopeeProductOfferListInput,
) =>
  createHash('sha256')
    .update(JSON.stringify({ source, campaignId, nicheId, query }))
    .digest('hex');

const selectionFromPreflight = (
  target: CommercialAutomationTarget,
  preflight: Extract<CommercialAutomationCandidatePreflight, { outcome: 'READY' }>,
): CommercialAutomationCandidateSelection => ({
  target,
  candidateId: preflight.candidateId,
  snapshotId: preflight.snapshotId,
  candidateStatus: preflight.candidateStatus,
  queue: preflight.queue ?? {
    candidateCount: 1,
    eligibleCount: 1,
    rejectedCount: 0,
  },
});

const queryForTarget = async (
  target: CommercialAutomationTarget,
  niches: Pick<CommercialNicheRepository, 'findById'>,
): Promise<ShopeeProductOfferListInput> => {
  const niche = await niches.findById(target.nicheId);
  if (!niche) return {};
  const query: ShopeeProductOfferListInput = {
    sort: 'commission_desc',
  };
  const categoryId = niche.categoryIds[0];
  const keyword = niche.includeKeywords[0];
  if (categoryId) query.categoryId = categoryId;
  else if (keyword) query.keyword = keyword;
  return query;
};

export class CommercialInventorySupervisor {
  private readonly clock: () => Date;

  constructor(
    private readonly dependencies: {
      candidateFlow: CandidateFlow;
      preparedMessages: CommercialPreparedMessageRepository;
      checkpoints: CommercialDiscoveryCheckpointRepository;
      settings: CommercialAutomationSettingsRepository;
      niches: Pick<CommercialNicheRepository, 'findById'>;
      syncOffers: {
        run(
          input?: ShopeeProductOfferListInput,
          options?: { writeFence?: CommercialDiscoveryWriteFence },
        ): Promise<{
          fetched: number;
          created?: number;
          hasNextPage: boolean;
          page?: number;
          nextCursor?: string;
        }>;
      };
      logger: InventoryLogger;
      clock?: () => Date;
    },
  ) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  private async listProtectedCandidateIds(
    target: CommercialAutomationTarget,
    revisions: { scheduleRevision: number; assignmentRevision: number },
  ) {
    return (
      (await this.dependencies.preparedMessages.listProtectedCandidateIds?.({
        campaignId: target.campaignId,
        groupDestinationId: target.groupId,
        instanceName: target.instanceName ?? '',
        logicalGroupFingerprint: target.logicalGroupFingerprint,
        scheduleRevision: revisions.scheduleRevision,
        assignmentRevision: revisions.assignmentRevision,
        now: this.clock(),
      })) ??
      (await this.dependencies.preparedMessages.listReadyCandidateIds?.({
        campaignId: target.campaignId,
        groupDestinationId: target.groupId,
        instanceName: target.instanceName ?? '',
        logicalGroupFingerprint: target.logicalGroupFingerprint,
        scheduleRevision: revisions.scheduleRevision,
        assignmentRevision: revisions.assignmentRevision,
      })) ??
      []
    );
  }

  private async prepareAvailable(
    target: CommercialAutomationTarget,
    report: CommercialInventorySupervisorReport,
    targetLimit: number,
    budget: InventoryRunBudget,
    revisions: { scheduleRevision: number; assignmentRevision: number },
    sharedRouteCandidateIds: Set<string>,
  ): Promise<PreparedInventoryFill> {
    const protectedCandidateIds = await this.listProtectedCandidateIds(
      target,
      revisions,
    );
    const readyCandidateIds = new Set(sharedRouteCandidateIds);
    for (const candidateId of protectedCandidateIds) {
      readyCandidateIds.add(candidateId);
      sharedRouteCandidateIds.add(candidateId);
    }
    let preparedCount = await this.dependencies.preparedMessages.countReady({
      campaignId: target.campaignId,
      groupDestinationId: target.groupId,
      instanceName: target.instanceName ?? '',
      logicalGroupFingerprint: target.logicalGroupFingerprint,
      scheduleRevision: revisions.scheduleRevision,
      assignmentRevision: revisions.assignmentRevision,
      now: this.clock(),
    });
    let preparedMessagesPrepared = 0;
    for (
      let attempt = 0;
      attempt < MAX_PREPARED_PER_TARGET &&
      preparedCount < targetLimit &&
      budget.preparedMessagesRemaining > 0;
      attempt += 1
    ) {
      const preflight = await this.dependencies.candidateFlow.preflight(target, {
        excludeCandidateIds: [...readyCandidateIds],
      });
      if (preflight.outcome !== 'READY') break;
      budget.preparedMessagesRemaining -= 1;
      try {
        const prepared = await this.dependencies.candidateFlow.prepareInventory(
          selectionFromPreflight(target, preflight),
        );
        const created = await this.dependencies.preparedMessages.createReady({
          campaignId: prepared.campaignId,
          groupDestinationId: prepared.groupId,
          instanceName: target.instanceName ?? '',
          logicalGroupFingerprint:
            prepared.logicalGroupFingerprint ?? target.logicalGroupFingerprint,
          candidateId: prepared.candidateId,
          generatedCopyId: prepared.generatedCopyId,
          copyPreview: prepared.copyPreview,
          scheduleRevision: revisions.scheduleRevision,
          assignmentRevision: revisions.assignmentRevision,
          offerEndsAt: prepared.offerEndsAt,
          now: this.clock(),
        });
        if (!created) {
          readyCandidateIds.add(preflight.candidateId);
          continue;
        }
        readyCandidateIds.add(created.candidateId);
        sharedRouteCandidateIds.add(created.candidateId);
        const refreshedCount = await this.dependencies.preparedMessages.countReady({
          campaignId: target.campaignId,
          groupDestinationId: target.groupId,
          instanceName: target.instanceName ?? '',
          logicalGroupFingerprint: target.logicalGroupFingerprint,
          scheduleRevision: revisions.scheduleRevision,
          assignmentRevision: revisions.assignmentRevision,
          now: this.clock(),
        });
        preparedCount = refreshedCount;
        preparedMessagesPrepared += 1;
        report.preparedMessages += 1;
      } catch (error) {
        const code = safeErrorCode(error);
        report.failures.push(code);
        this.dependencies.logger.error(
          { event: 'commercial-inventory.prepare.failed', campaignId: target.campaignId, code },
          'Commercial inventory preparation failed',
        );
        break;
      }
    }
    return {
      readyCount: preparedCount,
      preparedCount: preparedMessagesPrepared,
    };
  }

  private async reconcilePreparedPolicy(
    target: CommercialAutomationTarget,
    revisions: { scheduleRevision: number; assignmentRevision: number },
  ) {
    const preparedRows = await this.dependencies.preparedMessages.listReady({
      campaignId: target.campaignId,
      groupDestinationId: target.groupId,
      instanceName: target.instanceName ?? '',
      logicalGroupFingerprint: target.logicalGroupFingerprint,
      scheduleRevision: revisions.scheduleRevision,
      assignmentRevision: revisions.assignmentRevision,
      now: this.clock(),
    });
    for (const prepared of preparedRows) {
      try {
        await this.dependencies.candidateFlow.revalidate({
          candidateId: prepared.candidateId,
          generatedCopyId: prepared.generatedCopyId,
          campaignId: prepared.campaignId,
          groupId: prepared.groupDestinationId,
          logicalGroupFingerprint: prepared.logicalGroupFingerprint,
        });
      } catch (error) {
        if (safeErrorCode(error) !== COMMERCIAL_AUTOMATION_NICHE_POLICY_CHANGED) {
          throw error;
        }
        await this.dependencies.preparedMessages.invalidateReadyForPolicy({
          id: prepared.id,
          reason: COMMERCIAL_AUTOMATION_NICHE_POLICY_CHANGED,
          now: this.clock(),
        });
      }
    }
  }

  private async discover(
    target: CommercialAutomationTarget,
    report: CommercialInventorySupervisorReport,
    pagesPerRun: number,
    cooldownMinutes: number,
    budget: InventoryRunBudget,
  ) {
    if (budget.discoveryPagesRemaining <= 0) return;
    const query = await queryForTarget(target, this.dependencies.niches);
    const identityFingerprint = hashIdentity(
      'OFFICIAL',
      target.campaignId,
      target.nicheId,
      query,
    );
    const now = this.clock();
    const ownerId = `inventory:${randomUUID()}`;
    const checkpoint = await this.dependencies.checkpoints.acquire({
      identityFingerprint,
      source: 'OFFICIAL',
      campaignId: target.campaignId,
      nicheId: target.nicheId,
      query: {
        ...(query.keyword ? { keyword: query.keyword } : {}),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.minPrice ? { minPrice: query.minPrice } : {}),
        ...(query.maxPrice ? { maxPrice: query.maxPrice } : {}),
        ...(query.minCommissionRate !== undefined ? { minCommissionRate: query.minCommissionRate } : {}),
        ...(query.minDiscountRate !== undefined ? { minDiscountRate: query.minDiscountRate } : {}),
        ...(query.minRating !== undefined ? { minRating: query.minRating } : {}),
        ...(query.sort ? { sort: query.sort } : {}),
      },
      ownerId,
      now,
      leaseExpiresAt: new Date(now.getTime() + CHECKPOINT_LEASE_MS),
    });
    if (!checkpoint) return;
    const maxPages = Math.min(
      Math.max(pagesPerRun, 1),
      MAX_DISCOVERY_PAGES_PER_RUN,
      budget.discoveryPagesRemaining,
    );
    let current = checkpoint;
    for (let page = 0; page < maxPages; page += 1) {
      try {
        const input: ShopeeProductOfferListInput = {
          ...current.query,
          page: current.page,
          ...(current.cursor ? { cursor: current.cursor } : {}),
        };
        budget.discoveryPagesRemaining -= 1;
        const sync = await this.dependencies.syncOffers.run(input, {
          writeFence: {
            checkpointId: current.id,
            ownerId,
            leaseRevision: current.leaseRevision,
            now: this.clock(),
          },
        });
        report.fetchedProducts += sync.fetched;
        report.createdProducts += sync.created ?? 0;
        const next = await this.dependencies.checkpoints.advance({
          id: current.id,
          ownerId,
          leaseRevision: current.leaseRevision,
          now: this.clock(),
          leaseExpiresAt: new Date(this.clock().getTime() + CHECKPOINT_LEASE_MS),
          page: sync.hasNextPage ? (sync.page ?? current.page) + 1 : current.page,
          cursor: sync.hasNextPage ? sync.nextCursor ?? null : null,
          hasNextPage: sync.hasNextPage,
          fetchedProducts: sync.fetched,
          nextRefreshAt: sync.hasNextPage
            ? null
            : new Date(this.clock().getTime() + cooldownMinutes * 60_000),
        });
        report.discoveredPages += 1;
        if (!next || !sync.hasNextPage) break;
        current = next;
      } catch (error) {
        const code = safeErrorCode(error);
        await this.dependencies.checkpoints.fail({
          id: current.id,
          ownerId,
          leaseRevision: current.leaseRevision,
          now: this.clock(),
          errorCode: code,
        });
        report.failures.push(code);
        this.dependencies.logger.error(
          { event: 'commercial-inventory.discovery.failed', campaignId: target.campaignId, code },
          'Commercial inventory discovery failed',
        );
        break;
      }
    }
  }

  async run(input: {
    mode: CommercialAutomationMode;
    provider: CommercialAutomationProvider;
  }): Promise<CommercialInventorySupervisorReport> {
    const report: CommercialInventorySupervisorReport = {
      targets: 0,
      prepared: 0,
      preparedReady: 0,
      futureSlotsCovered: 0,
      nominalCandidates: 0,
      usableCandidates: 0,
      fetchedProducts: 0,
      createdProducts: 0,
      discoveredPages: 0,
      mined: 0,
      preparedMessages: 0,
      skipped: 0,
      failures: [],
    };
    if (input.mode !== 'send' || input.provider !== 'official') return report;
    const settings = await this.dependencies.settings.getOrCreate(this.clock());
    if (settings.paused) {
      this.dependencies.logger.info(
        { event: 'commercial-inventory.supervisor.skipped', reason: 'AUTOMATION_PAUSED' },
        'Commercial inventory supervisor skipped while automation is paused',
      );
      return report;
    }
    const targets = await this.dependencies.candidateFlow.listTargets();
    report.targets = targets.length;
    await this.dependencies.preparedMessages.recoverExpired({ now: this.clock(), limit: PREPARED_RECOVERY_LIMIT });
    await this.dependencies.preparedMessages.invalidateStale({ now: this.clock(), limit: PREPARED_RECOVERY_LIMIT });
    const preparedTarget = Math.max(settings.preparedTarget ?? 2, 1);
    const preparedLowWatermark = Math.max(settings.preparedLowWatermark ?? 1, 1);
    const usableLowWatermark = Math.max(settings.usableCandidateLowWatermark ?? 2, 1);
    const usableCandidateTarget = Math.max(settings.usableCandidateTarget ?? 4, usableLowWatermark);
    const pagesPerRun = settings.discoveryPagesPerRun ?? 1;
    const cooldownMinutes = settings.discoveryRefreshCooldownMinutes ?? 60;
    const budget: InventoryRunBudget = {
      discoveryPagesRemaining: MAX_DISCOVERY_PAGES_PER_HEARTBEAT,
      preparedMessagesRemaining: MAX_PREPARED_MESSAGES_PER_HEARTBEAT,
    };
    const scheduleRevision = Math.max(settings.scheduleRevision, 1);
    // Materialize each ordered sender assignment so a prepared message remains
    // valid for the planner's A-B-A-B rotation and its assignment revision.
    const preparationTargets = targets.flatMap((target) => {
      const orderedInstanceNames = target.orderedInstanceNames?.filter(
        (name) => name.length > 0,
      );
      const instanceNames =
        orderedInstanceNames && orderedInstanceNames.length > 0
          ? orderedInstanceNames
          : target.instanceName
            ? [target.instanceName]
            : [];
      return instanceNames.map((instanceName) => ({
        ...target,
        instanceName,
        assignmentRevision: target.assignmentRevision ?? 1,
        scheduleRevision,
      }));
    });
    const sharedRouteCandidateIds = new Map<string, Set<string>>();

    const routeKeyFor = (
      target: CommercialAutomationTarget,
      revisions: { scheduleRevision: number; assignmentRevision: number },
    ) =>
      JSON.stringify([
        target.campaignId,
        target.groupId,
        target.logicalGroupFingerprint,
        revisions.scheduleRevision,
        revisions.assignmentRevision,
      ]);

    // Reserve candidate identity across the complete A-B assignment before
    // filling each individual instance. This prevents the first instance from
    // selecting a candidate that is already protected by a later instance.
    for (const target of preparationTargets) {
      const revisions = {
        scheduleRevision: target.scheduleRevision ?? scheduleRevision,
        assignmentRevision: target.assignmentRevision ?? 1,
      };
      const routeKey = routeKeyFor(target, revisions);
      const routeCandidateIds =
        sharedRouteCandidateIds.get(routeKey) ?? new Set<string>();
      sharedRouteCandidateIds.set(routeKey, routeCandidateIds);
      for (const candidateId of await this.listProtectedCandidateIds(
        target,
        revisions,
      )) {
        routeCandidateIds.add(candidateId);
      }
    }

    for (const [targetIndex, target] of preparationTargets.entries()) {
      if (targetIndex >= MAX_TARGETS_PER_HEARTBEAT) {
        report.skipped += preparationTargets.length - targetIndex;
        break;
      }
      const revisions = {
        scheduleRevision: target.scheduleRevision ?? scheduleRevision,
        assignmentRevision: target.assignmentRevision ?? 1,
      };
      const routeKey = routeKeyFor(target, revisions);
      const routeCandidateIds =
        sharedRouteCandidateIds.get(routeKey) ?? new Set<string>();
      sharedRouteCandidateIds.set(routeKey, routeCandidateIds);
      const instanceName = target.instanceName ?? '';
      await this.reconcilePreparedPolicy(target, revisions);
      const existing = await this.dependencies.preparedMessages.countReady({
        campaignId: target.campaignId,
        groupDestinationId: target.groupId,
        instanceName,
        logicalGroupFingerprint: target.logicalGroupFingerprint,
        scheduleRevision: revisions.scheduleRevision,
        assignmentRevision: revisions.assignmentRevision,
        now: this.clock(),
      });
      if (existing >= preparedTarget) {
        for (const candidateId of await this.listProtectedCandidateIds(
          target,
          revisions,
        )) {
          routeCandidateIds.add(candidateId);
        }
        report.preparedReady += existing;
        report.futureSlotsCovered += Math.min(existing, preparedTarget);
        report.skipped += 1;
        continue;
      }
      if (budget.preparedMessagesRemaining <= 0) {
        report.skipped += preparationTargets.length - targetIndex;
        break;
      }
      let preflight = await this.dependencies.candidateFlow.preflight(target);
      if (preflight.outcome === 'NO_CANDIDATE') {
        await this.dependencies.candidateFlow.replenish(target);
        report.mined += 1;
        preflight = await this.dependencies.candidateFlow.preflight(target);
      }
      const preparedFill = await this.prepareAvailable(
        target,
        report,
        preparedTarget,
        budget,
        revisions,
        routeCandidateIds,
      );
      report.prepared += preparedFill.preparedCount;
      const usableCount = preflight.queue?.usableCount ?? 0;
      report.nominalCandidates += preflight.queue?.candidateCount ?? 0;
      report.usableCandidates += usableCount;
      const urgentPreparedRefill = existing < preparedLowWatermark;
      const discoveryNeeded =
        preflight.outcome === 'NO_CANDIDATE' ||
        usableCount < usableLowWatermark ||
        (urgentPreparedRefill && usableCount < usableCandidateTarget);
      if (preparedFill.readyCount < preparedTarget && discoveryNeeded) {
        await this.discover(
          target,
          report,
          pagesPerRun,
          cooldownMinutes,
          budget,
        );
        await this.dependencies.candidateFlow.replenish(target);
        report.mined += 1;
        const replenishedFill = await this.prepareAvailable(
          target,
          report,
          preparedTarget,
          budget,
          revisions,
          routeCandidateIds,
        );
        report.prepared += replenishedFill.preparedCount;
      }
      const finalReady = await this.dependencies.preparedMessages.countReady({
        campaignId: target.campaignId,
        groupDestinationId: target.groupId,
        instanceName,
        logicalGroupFingerprint: target.logicalGroupFingerprint,
        scheduleRevision: revisions.scheduleRevision,
        assignmentRevision: revisions.assignmentRevision,
        now: this.clock(),
      });
      report.preparedReady += finalReady;
      report.futureSlotsCovered += Math.min(finalReady, preparedTarget);
    }
    this.dependencies.logger.info(
      {
        event: 'commercial-inventory.supervisor.completed',
        preparedLowWatermark,
        preparedTarget,
        usableCandidateLowWatermark: usableLowWatermark,
        usableCandidateTarget,
        createdFetchedRatio:
          report.fetchedProducts === 0
            ? 0
            : report.createdProducts / report.fetchedProducts,
        ...report,
      },
      'Commercial inventory supervisor completed',
    );
    return report;
  }
}
