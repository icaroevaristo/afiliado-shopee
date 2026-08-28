import { createHash } from 'node:crypto';

import type {
  CommercialAutomationJob,
  CommercialAutomationMode,
  CommercialAutomationTargetConstraint,
} from '@shopee-auto-affiliate-ai/queue';

import {
  getLocalDayRange,
  isInsideAllowedWindow,
  nextWindowOpeningAtOrAfter,
  resolveCommercialAutomationSchedule,
  type CommercialAutomationEffectiveSchedule,
  type CommercialAutomationPolicyConfig,
} from './commercial-automation-policy-service';
import type { CommercialAutomationPolicyService } from './commercial-automation-policy-service';
import type {
  CommercialAutomationHistoryRepository,
  CommercialAutomationSettingsRepository,
  CommercialAutomationSettingsRecord,
  CommercialAutomationTarget,
  CommercialGroupCampaignRecord,
  CommercialGroupCampaignRepository,
  WhatsAppGroupDirectoryRepository,
  WhatsAppInstanceRepository,
} from './repositories';

const MINUTE_MS = 60_000;
const PLANNER_HORIZON_MINUTES = 24 * 60;

const PLANNER_HARD_BLOCKING_REASONS = new Set([
  'AUTOMATION_DISABLED',
  'AUTOMATION_PAUSED',
  'NO_AUTHORIZED_GROUP',
  'MULTIPLE_AUTHORIZED_GROUPS',
  'COMMERCIAL_AUTOMATION_DUPLICATE_LOGICAL_GROUP',
  'COMMERCIAL_AUTOMATION_TARGET_NOT_ELIGIBLE',
  'AMBIGUOUS_COMMERCIAL_RUN_EXISTS',
  'COMMERCIAL_EXECUTION_IN_PROGRESS',
  'STALE_COMMERCIAL_EXECUTION_EXISTS',
]);

const readSettings = async (
  repository: CommercialAutomationSettingsRepository,
  now: Date,
): Promise<CommercialAutomationSettingsRecord> =>
  (repository.get
    ? await repository.get()
    : await repository.getOrCreate(now)) ?? {
    paused: true,
    pausedAt: now,
    resumedAt: null,
    allowedStartTime: null,
    allowedEndTime: null,
    minimumIntervalMinutes: null,
    staggerMinutes: null,
    dailyGlobalLimit: null,
    dailyGroupLimit: null,
    scheduleRevision: 0,
    updatedAt: now,
  };

export type CommercialAutomationPlannerTarget = CommercialAutomationTarget & {
  active: boolean;
  available: boolean;
  instanceActive: boolean;
  lastSentAt: Date | null;
  groupSentToday: number;
};

export type PlannedCommercialTargetSlot = {
  slotKey: string;
  jobId: string;
  scheduledFor: Date;
  delayMs: number;
  target: CommercialAutomationTargetConstraint;
};

export type CommercialAutomationPlannerInput = {
  now: Date;
  schedule: CommercialAutomationEffectiveSchedule;
  targets: CommercialAutomationPlannerTarget[];
  globalSentToday: number;
  horizonMinutes?: number;
};

export type CommercialAutomationPlannerResult = {
  slots: PlannedCommercialTargetSlot[];
  skippedTargets: string[];
};

const canonicalTargetKey = (target: CommercialAutomationPlannerTarget) =>
  [
    target.instanceName ?? '',
    target.logicalGroupFingerprint,
    target.campaignId,
    target.groupId,
  ].join('|');

const roundUpToMinute = (timestamp: number) =>
  Math.ceil(timestamp / MINUTE_MS) * MINUTE_MS;

const maxTimestamp = (...dates: Array<Date | null | undefined>) =>
  Math.max(
    ...dates
      .filter((date): date is Date => date instanceof Date)
      .map((date) => date.getTime()),
  );

const makeSlotKey = (
  scheduleRevision: number,
  target: CommercialAutomationPlannerTarget,
  scheduledFor: Date,
) =>
  createHash('sha256')
    .update(
      [
        scheduleRevision,
        canonicalTargetKey(target),
        scheduledFor.toISOString(),
      ].join('|'),
    )
    .digest('hex');

const findNextValidSlot = ({
  candidate,
  horizonEnd,
  schedule,
  target,
}: {
  candidate: Date;
  horizonEnd: Date;
  schedule: CommercialAutomationEffectiveSchedule;
  target: CommercialAutomationPlannerTarget;
}) => {
  let timestamp = roundUpToMinute(candidate.getTime());
  const targetTimezone = target.timezone ?? schedule.timezone;
  const targetStartTime = target.allowedStartTime ?? schedule.allowedStartTime;
  const targetEndTime = target.allowedEndTime ?? schedule.allowedEndTime;

  for (let attempt = 0; attempt < PLANNER_HORIZON_MINUTES * 2; attempt += 1) {
    if (timestamp > horizonEnd.getTime()) return null;
    const current = new Date(timestamp);
    if (
      !isInsideAllowedWindow(
        current,
        schedule.timezone,
        schedule.allowedStartTime,
        schedule.allowedEndTime,
      )
    ) {
      timestamp = nextWindowOpeningAtOrAfter(
        current,
        schedule.timezone,
        schedule.allowedStartTime,
        schedule.allowedEndTime,
      ).getTime();
      continue;
    }
    if (
      !isInsideAllowedWindow(
        current,
        targetTimezone,
        targetStartTime,
        targetEndTime,
      )
    ) {
      timestamp = nextWindowOpeningAtOrAfter(
        current,
        targetTimezone,
        targetStartTime,
        targetEndTime,
      ).getTime();
      continue;
    }
    return current;
  }
  return null;
};

export const planCommercialTargetSlots = ({
  now,
  schedule,
  targets,
  globalSentToday,
  horizonMinutes = PLANNER_HORIZON_MINUTES,
}: CommercialAutomationPlannerInput): CommercialAutomationPlannerResult => {
  const dayRange = getLocalDayRange(now, schedule.timezone);
  const horizonEnd = new Date(
    Math.min(
      dayRange.dayEndsAt.getTime(),
      now.getTime() + horizonMinutes * MINUTE_MS,
    ),
  );
  const orderedTargets = [...targets].sort((left, right) =>
    canonicalTargetKey(left).localeCompare(canonicalTargetKey(right)),
  );
  const skippedTargets: string[] = [];
  const globalRemaining = Math.max(
    0,
    schedule.dailyGlobalLimit - globalSentToday,
  );
  const targetStates = orderedTargets.flatMap((target) => {
    if (
      !target.active ||
      !target.available ||
      !target.instanceActive ||
      !target.instanceName
    ) {
      skippedTargets.push(target.campaignId);
      return [];
    }
    const groupLimit = Math.min(target.dailyLimit, schedule.dailyGroupLimit);
    const remainingForGroup = Math.max(0, groupLimit - target.groupSentToday);
    if (remainingForGroup === 0) {
      skippedTargets.push(target.campaignId);
      return [];
    }
    const cadenceMinutes = Math.max(1, target.cadenceMinutes ?? 15);
    return [
      {
        target,
        cadenceMinutes,
        remaining: remainingForGroup,
        slotIndex: 0,
        nextBase: new Date(
          maxTimestamp(
            now,
            target.lastSentAt
              ? new Date(
                  target.lastSentAt.getTime() +
                    Math.max(schedule.minimumIntervalMinutes, cadenceMinutes) *
                      MINUTE_MS,
                )
              : null,
            target.nextEligibleAt,
          ),
        ),
      },
    ];
  });
  const candidates: Array<{
    target: CommercialAutomationPlannerTarget;
    scheduledFor: Date;
    slotIndex: number;
  }> = [];
  let cursor = new Date(now.getTime() - schedule.staggerMinutes * MINUTE_MS);
  let madeProgress = true;
  while (candidates.length < globalRemaining && madeProgress) {
    madeProgress = false;
    for (const state of targetStates) {
      if (candidates.length >= globalRemaining) break;
      if (state.remaining === 0) continue;
      const staggerFloor =
        schedule.staggerMinutes > 0
          ? cursor.getTime() + schedule.staggerMinutes * MINUTE_MS
          : Number.NEGATIVE_INFINITY;
      const scheduledFor = findNextValidSlot({
        candidate: new Date(Math.max(state.nextBase.getTime(), staggerFloor)),
        horizonEnd,
        schedule,
        target: state.target,
      });
      if (!scheduledFor) {
        state.remaining = 0;
        continue;
      }
      candidates.push({
        target: state.target,
        scheduledFor,
        slotIndex: state.slotIndex,
      });
      state.slotIndex += 1;
      state.remaining -= 1;
      state.nextBase = new Date(
        scheduledFor.getTime() + state.cadenceMinutes * MINUTE_MS,
      );
      cursor = scheduledFor;
      madeProgress = true;
    }
  }

  candidates.sort(
    (left, right) =>
      left.scheduledFor.getTime() - right.scheduledFor.getTime() ||
      canonicalTargetKey(left.target).localeCompare(
        canonicalTargetKey(right.target),
      ) ||
      left.slotIndex - right.slotIndex,
  );

  const slots = candidates.slice(0, globalRemaining).map((candidate) => {
    const instanceName = candidate.target.instanceName;
    if (!instanceName) {
      throw new Error('COMMERCIAL_AUTOMATION_TARGET_INSTANCE_REQUIRED');
    }
    const slotKey = makeSlotKey(
      schedule.scheduleRevision,
      candidate.target,
      candidate.scheduledFor,
    );
    const target: CommercialAutomationTargetConstraint = {
      campaignId: candidate.target.campaignId,
      groupId: candidate.target.groupId,
      logicalGroupFingerprint: candidate.target.logicalGroupFingerprint,
      instanceName,
      scheduledFor: candidate.scheduledFor.toISOString(),
      slotKey,
      scheduleRevision: schedule.scheduleRevision,
    };
    return {
      slotKey,
      jobId: `commercial-target-${slotKey}`,
      scheduledFor: candidate.scheduledFor,
      delayMs: Math.max(0, candidate.scheduledFor.getTime() - now.getTime()),
      target,
    };
  });

  return { slots, skippedTargets };
};

type CommercialAutomationPlannerDependencies = {
  settings: CommercialAutomationSettingsRepository;
  campaigns: Pick<CommercialGroupCampaignRepository, 'list'>;
  groups: WhatsAppGroupDirectoryRepository;
  instances: Pick<WhatsAppInstanceRepository, 'list'>;
  history: CommercialAutomationHistoryRepository;
  policy: Pick<
    CommercialAutomationPolicyService,
    'evaluateAutomationReadiness'
  >;
  config: CommercialAutomationPolicyConfig;
  clock?: () => Date;
};

const listAllCampaigns = async (
  repository: Pick<CommercialGroupCampaignRepository, 'list'>,
) => {
  const items: CommercialGroupCampaignRecord[] = [];
  let page = 1;
  const limit = 100;
  while (true) {
    const result = await repository.list({ page, limit, active: true });
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) return items;
    page += 1;
  }
};

export class CommercialAutomationSchedulerPlanner {
  constructor(
    private readonly dependencies: CommercialAutomationPlannerDependencies,
  ) {}

  async getScheduleRevision() {
    const now = (this.dependencies.clock ?? (() => new Date()))();
    const settings = await readSettings(this.dependencies.settings, now);
    return settings.scheduleRevision;
  }

  private async buildPlan(now: Date) {
    const settings = await readSettings(this.dependencies.settings, now);
    const schedule = resolveCommercialAutomationSchedule(
      this.dependencies.config,
      settings,
    );
    if (!this.dependencies.groups.listAll) {
      return {
        slots: [],
        skippedTargets: ['GROUP_DIRECTORY_LIST_ALL_UNAVAILABLE'],
      };
    }
    const [campaigns, groups, instances] = await Promise.all([
      listAllCampaigns(this.dependencies.campaigns),
      this.dependencies.groups.listAll({ active: true, available: true }),
      this.dependencies.instances.list(),
    ]);
    const dayRange = getLocalDayRange(now, schedule.timezone);
    const globalHistory = await this.dependencies.history.getSnapshot(dayRange);
    const activeInstances = new Map(
      instances
        .filter((instance) => instance.active && instance.paused !== true)
        .map((instance) => [instance.name, instance]),
    );
    const targets = (
      await Promise.all(
        campaigns.map(
          async (
            campaign,
          ): Promise<CommercialAutomationPlannerTarget | null> => {
            if (!campaign.active || !campaign.niche.active) return null;
            const group = groups.find(
              (candidate) =>
                candidate.fingerprint === campaign.logicalGroupFingerprint &&
                (!campaign.anchorDestinationId ||
                  candidate.id === campaign.anchorDestinationId),
            );
            if (!group) return null;
            const assignedInstance = group.assignedInstanceName;
            const history = await this.dependencies.history.getSnapshot({
              groupId: group.id,
              ...dayRange,
            });
            const plannerTarget: CommercialAutomationPlannerTarget = {
              groupId: group.id,
              groupName: group.name,
              instanceName: assignedInstance ?? undefined,
              logicalGroupFingerprint: campaign.logicalGroupFingerprint,
              campaignId: campaign.id,
              nicheId: campaign.nicheId,
              dailyLimit: campaign.dailyLimit,
              cadenceMinutes: campaign.cadenceMinutes,
              timezone: campaign.timezone,
              allowedStartTime: campaign.allowedStartTime,
              allowedEndTime: campaign.allowedEndTime,
              nextEligibleAt: campaign.nextEligibleAt,
              active: campaign.active && group.active && group.paused !== true,
              available: group.available,
              instanceActive: assignedInstance
                ? activeInstances.has(assignedInstance)
                : false,
              lastSentAt: history.groupLastSentAt ?? history.lastSentAt,
              groupSentToday: history.groupSentToday,
            };
            const readiness =
              await this.dependencies.policy.evaluateAutomationReadiness({
                target: plannerTarget,
              });
            if (
              readiness.reasons.some((reason) =>
                PLANNER_HARD_BLOCKING_REASONS.has(reason),
              )
            ) {
              return null;
            }
            return plannerTarget;
          },
        ),
      )
    ).filter(
      (target): target is CommercialAutomationPlannerTarget => target !== null,
    );

    const result = planCommercialTargetSlots({
      now,
      schedule,
      targets,
      globalSentToday: globalHistory.globalSentToday,
    });
    return result;
  }

  async preview(now?: Date) {
    return this.buildPlan(
      now ?? (this.dependencies.clock ?? (() => new Date()))(),
    );
  }

  async plan(input: {
    now?: Date;
    mode: CommercialAutomationMode;
    enqueue: (
      data: Extract<CommercialAutomationJob, { kind: 'target' }>,
      jobId: string,
      delayMs: number,
    ) => Promise<void>;
  }) {
    const now = input.now ?? (this.dependencies.clock ?? (() => new Date()))();
    const result = await this.buildPlan(now);
    for (const slot of result.slots) {
      await input.enqueue(
        {
          mode: input.mode,
          kind: 'target',
          target: slot.target,
        },
        slot.jobId,
        slot.delayMs,
      );
    }
    return result;
  }
}
