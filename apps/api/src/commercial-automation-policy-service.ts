import { AppError } from '@shopee-auto-affiliate-ai/shared';

import {
  duplicateLogicalGroupFingerprints,
  isCommercialAssignedGroup,
  isCommercialAuthorizedGroup,
} from './commercial-group-selection';
import { filterExecutableCommercialGroups } from './commercial-instance-stickiness';
import type {
  CommercialAutomationTarget,
  CommercialAutomationHistoryRepository,
  CommercialAutomationSettingsRecord,
  CommercialAutomationScheduleUpdate,
  CommercialAutomationSettingsRepository,
  WhatsAppGroupDirectoryRepository,
  WhatsAppInstanceRepository,
} from './repositories';

export type { CommercialAutomationScheduleUpdate } from './repositories';

export const COMMERCIAL_AUTOMATION_RESUME_CONFIRMATION =
  'RETOMAR_AUTOMACAO_COMERCIAL';

export const COMMERCIAL_EXECUTION_IN_PROGRESS =
  'COMMERCIAL_EXECUTION_IN_PROGRESS';
export const STALE_COMMERCIAL_EXECUTION_EXISTS =
  'STALE_COMMERCIAL_EXECUTION_EXISTS';

export const COMMERCIAL_AUTOMATION_REASONS = [
  'AUTOMATION_DISABLED',
  'AUTOMATION_PAUSED',
  'OUTSIDE_ALLOWED_WINDOW',
  'GLOBAL_DAILY_LIMIT_REACHED',
  'GROUP_DAILY_LIMIT_REACHED',
  'MINIMUM_INTERVAL_NOT_REACHED',
  'NO_AUTHORIZED_GROUP',
  'MULTIPLE_AUTHORIZED_GROUPS',
  'COMMERCIAL_AUTOMATION_DUPLICATE_LOGICAL_GROUP',
  'COMMERCIAL_AUTOMATION_TARGET_NOT_ELIGIBLE',
  'AMBIGUOUS_COMMERCIAL_RUN_EXISTS',
  COMMERCIAL_EXECUTION_IN_PROGRESS,
  STALE_COMMERCIAL_EXECUTION_EXISTS,
] as const;

export type CommercialAutomationReason =
  (typeof COMMERCIAL_AUTOMATION_REASONS)[number];

export type CommercialAutomationPolicyConfig = {
  enabled: boolean;
  timezone: string;
  allowedStartTime: string;
  allowedEndTime: string;
  dailyGlobalLimit: number;
  dailyGroupLimit: number;
  minimumIntervalMinutes: number;
};

export type CommercialAutomationEffectiveSchedule = {
  timezone: string;
  allowedStartTime: string;
  allowedEndTime: string;
  dailyGlobalLimit: number;
  dailyGroupLimit: number;
  minimumIntervalMinutes: number;
  staggerMinutes: number;
  scheduleRevision: number;
};

export type CommercialAutomationScheduleSettings = Pick<
  CommercialAutomationEffectiveSchedule,
  | 'timezone'
  | 'allowedStartTime'
  | 'allowedEndTime'
  | 'minimumIntervalMinutes'
  | 'staggerMinutes'
  | 'scheduleRevision'
>;

const toScheduleSettings = (
  schedule: CommercialAutomationEffectiveSchedule,
): CommercialAutomationScheduleSettings => ({
  timezone: schedule.timezone,
  allowedStartTime: schedule.allowedStartTime,
  allowedEndTime: schedule.allowedEndTime,
  minimumIntervalMinutes: schedule.minimumIntervalMinutes,
  staggerMinutes: schedule.staggerMinutes,
  scheduleRevision: schedule.scheduleRevision,
});

export const resolveCommercialAutomationSchedule = (
  config: CommercialAutomationPolicyConfig,
  settings: CommercialAutomationSettingsRecord,
): CommercialAutomationEffectiveSchedule => ({
  timezone: config.timezone,
  allowedStartTime: settings.allowedStartTime ?? config.allowedStartTime,
  allowedEndTime: settings.allowedEndTime ?? config.allowedEndTime,
  dailyGlobalLimit: Math.min(
    config.dailyGlobalLimit,
    settings.dailyGlobalLimit ?? config.dailyGlobalLimit,
  ),
  dailyGroupLimit: Math.min(
    config.dailyGroupLimit,
    settings.dailyGroupLimit ?? config.dailyGroupLimit,
  ),
  minimumIntervalMinutes:
    settings.minimumIntervalMinutes ?? config.minimumIntervalMinutes,
  staggerMinutes: settings.staggerMinutes ?? 0,
  scheduleRevision: settings.scheduleRevision,
});

export type CommercialAutomationStatus = {
  enabled: boolean;
  allowed: boolean;
  reasons: CommercialAutomationReason[];
  nextAllowedAt: string | null;
  globalSentToday: number;
  globalRemainingToday: number;
  groupSentToday: number | null;
  groupRemainingToday: number | null;
  lastSentAt: string | null;
  globalLastSentAt?: string | null;
  groupLastSentAt?: string | null;
  paused: boolean;
  pausedAt: string | null;
  resumedAt: string | null;
  updatedAt: string;
  allowedStartTime: string;
  allowedEndTime: string;
  timezone: string;
  dailyGlobalLimit: number;
  dailyGroupLimit: number;
  minimumIntervalMinutes: number;
  authorizedGroupCount: number;
};

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

const getFormatter = (timezone: string) => {
  let formatter = dateTimeFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    dateTimeFormatters.set(timezone, formatter);
  }
  return formatter;
};

const getZonedParts = (date: Date, timezone: string): ZonedDateParts => {
  const values = Object.fromEntries(
    getFormatter(timezone)
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
};

const parseTime = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const assertTime = (value: string | null | undefined, field: string) => {
  if (value !== null && value !== undefined && !TIME_PATTERN.test(value)) {
    throw new AppError(
      `${field} invalido`,
      'COMMERCIAL_AUTOMATION_SCHEDULE_INVALID',
    );
  }
};

const assertScheduleUpdate = (
  input: CommercialAutomationScheduleUpdate,
  effective: CommercialAutomationEffectiveSchedule,
) => {
  const hasScheduleField = [
    'allowedStartTime',
    'allowedEndTime',
    'minimumIntervalMinutes',
    'staggerMinutes',
    'dailyGlobalLimit',
    'dailyGroupLimit',
  ].some((field) => field in input);
  if (!hasScheduleField) {
    throw new AppError(
      'A atualizacao de agenda esta vazia',
      'COMMERCIAL_AUTOMATION_SCHEDULE_INVALID',
    );
  }
  const start = input.allowedStartTime ?? effective.allowedStartTime;
  const end = input.allowedEndTime ?? effective.allowedEndTime;
  assertTime(start, 'allowedStartTime');
  assertTime(end, 'allowedEndTime');
  if (start === end) {
    throw new AppError(
      'A janela comercial nao pode ter inicio e fim iguais',
      'COMMERCIAL_AUTOMATION_SCHEDULE_INVALID',
    );
  }
  const minimumIntervalMinutes =
    input.minimumIntervalMinutes ?? effective.minimumIntervalMinutes;
  if (
    !Number.isSafeInteger(minimumIntervalMinutes) ||
    minimumIntervalMinutes < 1 ||
    minimumIntervalMinutes > 1_440
  ) {
    throw new AppError(
      'minimumIntervalMinutes invalido',
      'COMMERCIAL_AUTOMATION_SCHEDULE_INVALID',
    );
  }
  for (const [field, value] of [
    ['dailyGlobalLimit', input.dailyGlobalLimit],
    ['dailyGroupLimit', input.dailyGroupLimit],
  ] as const) {
    if (value === undefined || value === null) continue;
    if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
      throw new AppError(
        `${field} invalido`,
        'COMMERCIAL_AUTOMATION_SCHEDULE_INVALID',
      );
    }
  }
  const staggerMinutes = input.staggerMinutes ?? effective.staggerMinutes;
  if (
    !Number.isSafeInteger(staggerMinutes) ||
    staggerMinutes < 0 ||
    staggerMinutes > 1_440
  ) {
    throw new AppError(
      'staggerMinutes invalido',
      'COMMERCIAL_AUTOMATION_SCHEDULE_INVALID',
    );
  }
  if (
    input.expectedRevision !== undefined &&
    (!Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0)
  ) {
    throw new AppError(
      'scheduleRevision esperado invalido',
      'COMMERCIAL_AUTOMATION_SCHEDULE_INVALID',
    );
  }
};

export const isInsideAllowedWindow = (
  date: Date,
  timezone: string,
  startTime: string,
  endTime: string,
) => {
  const parts = getZonedParts(date, timezone);
  const current = parts.hour * 60 + parts.minute;
  const start = parseTime(startTime);
  const end = parseTime(endTime);
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
};

export const nextWindowOpeningAtOrAfter = (
  date: Date,
  timezone: string,
  startTime: string,
  endTime: string,
) => {
  if (isInsideAllowedWindow(date, timezone, startTime, endTime)) return date;

  let candidate = Math.ceil(date.getTime() / 60_000) * 60_000;
  if (candidate <= date.getTime()) candidate += 60_000;
  for (let minute = 0; minute < 72 * 60; minute += 1) {
    const instant = new Date(candidate + minute * 60_000);
    if (isInsideAllowedWindow(instant, timezone, startTime, endTime)) {
      return instant;
    }
  }
  throw new Error('Nao foi possivel calcular a proxima janela comercial');
};

export const getLocalDayRange = (now: Date, timezone: string) => {
  const today = getZonedParts(now, timezone);
  const dateKey = `${today.year}-${today.month}-${today.day}`;
  const isSameLocalDay = (timestamp: number) => {
    const parts = getZonedParts(new Date(timestamp), timezone);
    return `${parts.year}-${parts.month}-${parts.day}` === dateKey;
  };
  const findBoundary = (direction: -1 | 1) => {
    const step = direction * 6 * 60 * 60_000;
    let inside = now.getTime();
    let outside = inside + step;
    while (isSameLocalDay(outside)) {
      inside = outside;
      outside += step;
    }
    let lower = Math.min(inside, outside);
    let upper = Math.max(inside, outside);
    while (upper - lower > 1) {
      const middle = Math.floor((lower + upper) / 2);
      if (isSameLocalDay(middle) === (direction === -1)) upper = middle;
      else lower = middle;
    }
    return new Date(upper);
  };
  return {
    dayStartsAt: findBoundary(-1),
    dayEndsAt: findBoundary(1),
  };
};

const isoOrNull = (date: Date | null) => date?.toISOString() ?? null;

const fallbackSettings = (now: Date): CommercialAutomationSettingsRecord => ({
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
});

const isValidDailyQuota = (value: number) =>
  Number.isSafeInteger(value) && value > 0;

const HARD_BLOCKING_REASONS = new Set<CommercialAutomationReason>([
  'AUTOMATION_DISABLED',
  'AUTOMATION_PAUSED',
  'NO_AUTHORIZED_GROUP',
  'COMMERCIAL_AUTOMATION_DUPLICATE_LOGICAL_GROUP',
  'COMMERCIAL_AUTOMATION_TARGET_NOT_ELIGIBLE',
  'AMBIGUOUS_COMMERCIAL_RUN_EXISTS',
  COMMERCIAL_EXECUTION_IN_PROGRESS,
  STALE_COMMERCIAL_EXECUTION_EXISTS,
]);

export class CommercialAutomationPolicyService {
  constructor(
    private readonly dependencies: {
      settings: CommercialAutomationSettingsRepository;
      history: CommercialAutomationHistoryRepository;
      groups: Pick<WhatsAppGroupDirectoryRepository, 'list'> &
        Partial<Pick<WhatsAppGroupDirectoryRepository, 'listAll'>>;
      instances?: Pick<WhatsAppInstanceRepository, 'findByName'>;
      instanceName: string;
      config: CommercialAutomationPolicyConfig;
      clock?: () => Date;
    },
  ) {}

  private async readSettings(now: Date) {
    const repository = this.dependencies.settings;
    const current = repository.get
      ? await repository.get()
      : await repository.getOrCreate(now);
    return current ?? fallbackSettings(now);
  }

  async evaluateAutomationReadiness(input?: {
    excludedExecutionId?: string;
    excludedAmbiguousRunId?: string;
    target?: CommercialAutomationTarget;
  }): Promise<CommercialAutomationStatus> {
    const now = (this.dependencies.clock ?? (() => new Date()))();
    const [settings, context] = await Promise.all([
      this.readSettings(now),
      this.loadOperationalContext(
        now,
        input?.excludedExecutionId,
        input?.excludedAmbiguousRunId,
        input?.target,
      ),
    ]);

    return this.buildStatus({ now, settings, ...context });
  }

  async evaluateManualSendSafety(target: CommercialAutomationTarget) {
    const status = await this.evaluateAutomationReadiness({ target });
    const schedulingOnly = new Set<CommercialAutomationReason>([
      'AUTOMATION_DISABLED',
      'AUTOMATION_PAUSED',
      'OUTSIDE_ALLOWED_WINDOW',
    ]);
    const reasons = status.reasons.filter(
      (reason) => !schedulingOnly.has(reason),
    );
    return {
      ...status,
      allowed: reasons.length === 0,
      reasons,
    };
  }

  async getScheduleSettings(): Promise<CommercialAutomationScheduleSettings> {
    const now = (this.dependencies.clock ?? (() => new Date()))();
    const settings = await this.readSettings(now);
    return toScheduleSettings(
      resolveCommercialAutomationSchedule(this.dependencies.config, settings),
    );
  }

  async updateScheduleSettings(
    input: CommercialAutomationScheduleUpdate,
  ): Promise<CommercialAutomationScheduleSettings> {
    const now = (this.dependencies.clock ?? (() => new Date()))();
    const current = await this.dependencies.settings.getOrCreate(now);
    const effective = resolveCommercialAutomationSchedule(
      this.dependencies.config,
      current,
    );
    assertScheduleUpdate(input, effective);
    const updated = await this.dependencies.settings.updateSchedule(input, now);
    return toScheduleSettings(
      resolveCommercialAutomationSchedule(this.dependencies.config, updated),
    );
  }

  private async loadOperationalContext(
    now: Date,
    excludedExecutionId?: string,
    excludedAmbiguousRunId?: string,
    target?: CommercialAutomationTarget,
  ) {
    const dayRange = getLocalDayRange(now, this.dependencies.config.timezone);
    const [groups, ambiguousExecution, activeExecution, staleExecution] =
      await Promise.all([
        this.dependencies.groups.listAll
          ? this.dependencies.groups.listAll({ active: true, available: true })
          : this.dependencies.groups.list(this.dependencies.instanceName, {
              active: true,
              available: true,
            }),
        this.dependencies.history.hasAmbiguousCommercialExecution(
          excludedAmbiguousRunId,
        ),
        this.dependencies.history.hasActiveCommercialExecution(
          now,
          excludedExecutionId,
          excludedAmbiguousRunId,
        ),
        this.dependencies.history.hasStaleCommercialExecution(now),
      ]);
    const authorizedCandidates = groups.filter((group) =>
      this.dependencies.groups.listAll
        ? typeof group.assignedInstanceName === 'string' &&
          isCommercialAssignedGroup(group, group.assignedInstanceName)
        : isCommercialAuthorizedGroup(group, this.dependencies.instanceName),
    );
    const authorizedGroups = await filterExecutableCommercialGroups(
      authorizedCandidates,
      this.dependencies.instances,
    );
    const duplicateFingerprints =
      duplicateLogicalGroupFingerprints(authorizedGroups);
    const selectedGroup = target
      ? authorizedGroups.find(
          (group) =>
            group.id === target.groupId &&
            group.fingerprint === target.logicalGroupFingerprint &&
            group.assignedInstanceName === target.instanceName,
        )
      : undefined;
    const history = await this.dependencies.history.getSnapshot({
      groupId: selectedGroup?.id,
      ...dayRange,
    });
    return {
      authorizedGroupCount: authorizedGroups.length,
      target,
      targetEligible: !target || Boolean(selectedGroup),
      duplicateLogicalGroup: duplicateFingerprints.length > 0,
      ambiguousExecution,
      activeExecution,
      staleExecution,
      history,
      dayEndsAt: dayRange.dayEndsAt,
    };
  }

  async setPaused(input: {
    paused: boolean;
    confirmation?: string;
  }): Promise<CommercialAutomationStatus> {
    if (
      !input.paused &&
      input.confirmation !== COMMERCIAL_AUTOMATION_RESUME_CONFIRMATION
    ) {
      throw new AppError(
        'Confirmacao explicita obrigatoria para retomar a automacao',
        'COMMERCIAL_AUTOMATION_RESUME_CONFIRMATION_REQUIRED',
      );
    }
    const now = (this.dependencies.clock ?? (() => new Date()))();
    const context = await this.loadOperationalContext(now);
    const settings = await this.dependencies.settings.setPaused(
      input.paused,
      now,
    );
    return this.buildStatus({ now, settings, ...context });
  }

  private buildStatus({
    now,
    settings,
    authorizedGroupCount,
    target,
    targetEligible,
    duplicateLogicalGroup,
    ambiguousExecution,
    activeExecution,
    staleExecution,
    history,
    dayEndsAt,
  }: {
    now: Date;
    settings: CommercialAutomationSettingsRecord;
    authorizedGroupCount: number;
    target?: CommercialAutomationTarget;
    targetEligible: boolean;
    duplicateLogicalGroup: boolean;
    ambiguousExecution: boolean;
    activeExecution: boolean;
    staleExecution: boolean;
    history: {
      globalSentToday: number;
      groupSentToday: number;
      lastSentAt: Date | null;
      globalLastSentAt?: Date | null;
      groupLastSentAt?: Date | null;
    };
    dayEndsAt: Date;
  }): CommercialAutomationStatus {
    const { config } = this.dependencies;
    const effective = resolveCommercialAutomationSchedule(config, settings);
    const targetTimezone = target?.timezone ?? effective.timezone;
    const targetStartTime =
      target?.allowedStartTime ?? effective.allowedStartTime;
    const targetEndTime = target?.allowedEndTime ?? effective.allowedEndTime;
    const reasons: CommercialAutomationReason[] = [];
    const outsideWindow = !isInsideAllowedWindow(
      now,
      targetTimezone,
      targetStartTime,
      targetEndTime,
    );
    const globalQuotaValid = isValidDailyQuota(effective.dailyGlobalLimit);
    const globalLimitReached =
      !globalQuotaValid ||
      history.globalSentToday >= effective.dailyGlobalLimit;
    const globalLastSentAt = history.globalLastSentAt ?? history.lastSentAt;
    const groupLastSentAt = target ? (history.groupLastSentAt ?? null) : null;
    const campaignQuotaValid = !target || isValidDailyQuota(target.dailyLimit);
    const groupQuotaValid = isValidDailyQuota(effective.dailyGroupLimit);
    const effectiveGroupLimit =
      target && campaignQuotaValid && groupQuotaValid
        ? Math.min(target.dailyLimit, effective.dailyGroupLimit)
        : null;
    const groupLimitReached =
      effectiveGroupLimit !== null &&
      history.groupSentToday >= effectiveGroupLimit;
    const intervalEndsAt = groupLastSentAt
      ? new Date(
          groupLastSentAt.getTime() + effective.minimumIntervalMinutes * 60_000,
        )
      : null;
    const minimumIntervalNotReached = Boolean(
      intervalEndsAt && intervalEndsAt > now,
    );

    if (!config.enabled) reasons.push('AUTOMATION_DISABLED');
    if (settings.paused) reasons.push('AUTOMATION_PAUSED');
    if (outsideWindow) reasons.push('OUTSIDE_ALLOWED_WINDOW');
    if (globalLimitReached) reasons.push('GLOBAL_DAILY_LIMIT_REACHED');
    if (target && (!targetEligible || !campaignQuotaValid)) {
      reasons.push('COMMERCIAL_AUTOMATION_TARGET_NOT_ELIGIBLE');
    }
    if (target && (!groupQuotaValid || groupLimitReached)) {
      reasons.push('GROUP_DAILY_LIMIT_REACHED');
    }
    if (target && minimumIntervalNotReached) {
      reasons.push('MINIMUM_INTERVAL_NOT_REACHED');
    }
    if (authorizedGroupCount === 0) reasons.push('NO_AUTHORIZED_GROUP');
    if (duplicateLogicalGroup) {
      reasons.push('COMMERCIAL_AUTOMATION_DUPLICATE_LOGICAL_GROUP');
    }
    if (ambiguousExecution) reasons.push('AMBIGUOUS_COMMERCIAL_RUN_EXISTS');
    if (activeExecution) reasons.push('COMMERCIAL_EXECUTION_IN_PROGRESS');
    if (staleExecution) reasons.push(STALE_COMMERCIAL_EXECUTION_EXISTS);

    let nextAllowedAt: Date | null = null;
    if (
      reasons.length > 0 &&
      !reasons.some((reason) => HARD_BLOCKING_REASONS.has(reason))
    ) {
      const candidates: Date[] = [];
      if (outsideWindow) {
        candidates.push(
          nextWindowOpeningAtOrAfter(
            now,
            targetTimezone,
            targetStartTime,
            targetEndTime,
          ),
        );
      }
      if (
        globalLimitReached ||
        (target && (!groupQuotaValid || groupLimitReached))
      )
        candidates.push(dayEndsAt);
      if (target && minimumIntervalNotReached && intervalEndsAt)
        candidates.push(intervalEndsAt);
      const latest = new Date(
        Math.max(...candidates.map((candidate) => candidate.getTime())),
      );
      nextAllowedAt = nextWindowOpeningAtOrAfter(
        latest,
        targetTimezone,
        targetStartTime,
        targetEndTime,
      );
    }

    return {
      enabled: config.enabled,
      allowed: reasons.length === 0,
      reasons,
      nextAllowedAt: isoOrNull(nextAllowedAt),
      globalSentToday: history.globalSentToday,
      globalRemainingToday: Math.max(
        0,
        globalQuotaValid
          ? effective.dailyGlobalLimit - history.globalSentToday
          : 0,
      ),
      groupSentToday: target ? history.groupSentToday : null,
      groupRemainingToday: target
        ? Math.max(
            0,
            effectiveGroupLimit !== null
              ? effectiveGroupLimit - history.groupSentToday
              : 0,
          )
        : null,
      lastSentAt: isoOrNull(globalLastSentAt),
      globalLastSentAt: isoOrNull(globalLastSentAt),
      groupLastSentAt: target ? isoOrNull(groupLastSentAt) : null,
      paused: settings.paused,
      pausedAt: isoOrNull(settings.pausedAt),
      resumedAt: isoOrNull(settings.resumedAt),
      updatedAt: settings.updatedAt.toISOString(),
      allowedStartTime: effective.allowedStartTime,
      allowedEndTime: effective.allowedEndTime,
      timezone: effective.timezone,
      dailyGlobalLimit: effective.dailyGlobalLimit,
      dailyGroupLimit: effective.dailyGroupLimit,
      minimumIntervalMinutes: effective.minimumIntervalMinutes,
      authorizedGroupCount,
    };
  }
}
