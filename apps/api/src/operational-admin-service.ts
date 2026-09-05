import { AppError } from '@shopee-auto-affiliate-ai/shared';

import { COMMERCIAL_GROUP_FINGERPRINT } from './commercial-group-selection';
import {
  resolveCommercialAutomationSchedule,
  type CommercialAutomationPolicyConfig,
  type CommercialAutomationPolicyService,
} from './commercial-automation-policy-service';
import { getOrderedAssignedInstanceNames } from './commercial-instance-stickiness';
import type { CommercialAutomationSchedulerPlanner } from './commercial-automation-scheduler-planner';
import type {
  CommercialExternalProviderBudgetService,
  CommercialExternalProviderBudgetSnapshot,
} from './commercial-external-provider-budget-service';
import type {
  CommercialAutomationHistoryRepository,
  CommercialAutomationSettingsRecord,
  CommercialAutomationSettingsRepository,
  CommercialGroupCampaignRecord,
  CommercialGroupCampaignRepository,
  OperationalStatusCounts,
  OperationalStatusRepository,
  WhatsAppDispatchRepository,
  WhatsAppGroupDirectoryRepository,
  WhatsAppGroupRecord,
  WhatsAppInstanceRecord,
  WhatsAppInstanceRepository,
} from './repositories';

export const OPERATIONAL_CHANGE_CONFIRMATION =
  'CONFIRMAR_ALTERACAO_OPERACIONAL';
export const OPERATIONAL_PAUSE_CONFIRMATION = 'CONFIRMAR_PAUSA_OPERACIONAL';
export const OPERATIONAL_ASSIGNMENT_CONFIRMATION =
  'CONFIRMAR_REATRIBUICAO_GRUPO';

type QueueCountsReader = {
  getJobCounts?: (
    ...types: Array<'waiting' | 'active' | 'delayed' | 'prioritized'>
  ) => Promise<Record<string, number>>;
};

type SchedulerStatusReader = {
  getStatus: () => Promise<unknown>;
};

export type OperationalAdminBlocker = {
  scope: 'GLOBAL' | 'INSTANCE' | 'GROUP' | 'CAMPAIGN';
  code: string;
  entityId: string | null;
  message: string;
  actionHint?: string;
  nextEligibleAt?: string | null;
};

export type OperationalAdminInstance = {
  name: string;
  active: boolean;
  paused: boolean;
  health: 'UNKNOWN';
  assignedGroupCount: number;
  lastSendAt: string | null;
  nextSendAt: string | null;
  blockers: OperationalAdminBlocker[];
  updatedAt: string;
};

export type OperationalAdminGroup = {
  id: string;
  name: string;
  active: boolean;
  paused: boolean;
  available: boolean;
  fingerprint: string | null;
  sourceInstanceName: string | null;
  assignedInstanceName: string | null;
  assignedInstanceNames: string[];
  assignmentRevision: number | null;
  campaign: {
    id: string;
    name: string;
    active: boolean;
  } | null;
  niche: {
    id: string;
    name: string;
    active: boolean;
  } | null;
  lastSendAt: string | null;
  nextSendAt: string | null;
  upcomingAssignments: Array<{
    scheduledFor: string;
    instanceName: string;
  }>;
  blockers: OperationalAdminBlocker[];
  memberCount: number | null;
  ownerIsParticipant: boolean | null;
  discoveredAt: string | null;
  lastSyncedAt: string | null;
  updatedAt: string | null;
};

export type OperationalAdminCampaign = {
  id: string;
  name: string;
  active: boolean;
  groupId: string | null;
  groupName: string | null;
  instanceName: string | null;
  cadenceMinutes: number;
  timezone: string;
  allowedStartTime: string;
  allowedEndTime: string;
  dailyLimit: number;
  niche: {
    id: string;
    name: string;
    active: boolean;
  };
  lastSendAt: string | null;
  nextSendAt: string | null;
  blockers: OperationalAdminBlocker[];
};

export type OperationalAdminQueueCounts = {
  waiting: number;
  active: number;
  delayed: number;
  prioritized: number;
};

export type OperationalAdminResponse = {
  generatedAt: string;
  automation: {
    paused: boolean;
    allowedStartTime: string;
    allowedEndTime: string;
    timezone: string;
    minimumIntervalMinutes: number;
    staggerMinutes: number;
    dailyGlobalLimit: number;
    dailyGroupLimit: number;
    dailyGlobalLimitOverride: number | null;
    dailyGroupLimitOverride: number | null;
    dailyShopeeHttpLimit: number;
    dailyOpenAiGenerationLimit: number;
    dailyShopeeHttpLimitOverride: number | null;
    dailyOpenAiGenerationLimitOverride: number | null;
    providerUsage: CommercialExternalProviderBudgetSnapshot;
    hardCaps: {
      maxMessagesPerRun: number;
    };
    scheduleRevision: number;
    updatedAt: string;
  };
  nextSendAt: string | null;
  lastSendAt: string | null;
  blockers: OperationalAdminBlocker[];
  queues: {
    productPipeline: OperationalAdminQueueCounts;
    whatsappDispatch: OperationalAdminQueueCounts;
    commercialAutomation: OperationalAdminQueueCounts;
  };
  activeExecutions: number;
  activeReservations: number;
  ambiguity: number;
  investigationRequired: number;
  pendingDispatches: number;
  pendingOutboxes: number;
  scheduler: unknown;
  instances: OperationalAdminInstance[];
  groups: OperationalAdminGroup[];
  campaigns: OperationalAdminCampaign[];
};

export type OperationalAdminDependencies = {
  instances: WhatsAppInstanceRepository;
  groups: WhatsAppGroupDirectoryRepository;
  campaigns: CommercialGroupCampaignRepository;
  dispatches: WhatsAppDispatchRepository;
  history: CommercialAutomationHistoryRepository;
  settings: CommercialAutomationSettingsRepository;
  status: OperationalStatusRepository;
  policy: Pick<
    CommercialAutomationPolicyService,
    'updateScheduleSettings' | 'evaluateAutomationReadiness'
  >;
  planner: Pick<CommercialAutomationSchedulerPlanner, 'preview'>;
  config: CommercialAutomationPolicyConfig;
  queues?: {
    productPipeline?: QueueCountsReader;
    whatsappDispatch?: QueueCountsReader;
    commercialAutomation?: QueueCountsReader;
  };
  scheduler?: SchedulerStatusReader;
  maxMessagesPerRun: number;
  externalBudget?: Pick<CommercialExternalProviderBudgetService, 'snapshot'>;
  environment?: {
    groupSendEnabled: boolean;
    safeMode: boolean;
  };
  clock?: () => Date;
};

const INSTANCE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

const emptyQueueCounts = (): OperationalAdminQueueCounts => ({
  waiting: 0,
  active: 0,
  delayed: 0,
  prioritized: 0,
});

const readQueueCounts = async (
  queue: QueueCountsReader | undefined,
): Promise<OperationalAdminQueueCounts> => {
  if (!queue?.getJobCounts) return emptyQueueCounts();
  const counts = await queue.getJobCounts(
    'waiting',
    'active',
    'delayed',
    'prioritized',
  );
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    prioritized: counts.prioritized ?? 0,
  };
};

const fallbackSettings = (now: Date): CommercialAutomationSettingsRecord => ({
  paused: true,
  pausedAt: now,
  resumedAt: null,
  allowedStartTime: null,
  allowedEndTime: null,
  timezone: null,
  minimumIntervalMinutes: null,
  staggerMinutes: null,
  dailyGlobalLimit: null,
  dailyGroupLimit: null,
  dailyShopeeHttpLimit: null,
  dailyOpenAiGenerationLimit: null,
  scheduleRevision: 0,
  updatedAt: now,
});

const uniqueBlockers = (blockers: OperationalAdminBlocker[]) => {
  const seen = new Set<string>();
  return blockers.filter((blocker) => {
    const key = [blocker.scope, blocker.entityId, blocker.code].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const messageForReason = (reason: string) => {
  const messages: Record<string, string> = {
    AUTOMATION_DISABLED: 'A automacao comercial esta desativada no deployment.',
    AUTOMATION_PAUSED: 'A automacao comercial esta pausada.',
    OUTSIDE_ALLOWED_WINDOW: 'Fora da janela operacional configurada.',
    GLOBAL_DAILY_LIMIT_REACHED: 'O limite diario global foi atingido.',
    GROUP_DAILY_LIMIT_REACHED: 'O limite diario do grupo foi atingido.',
    COMMERCIAL_SHOPEE_DAILY_BUDGET_REACHED:
      'O limite diario de consultas Shopee foi atingido.',
    COMMERCIAL_OPENAI_DAILY_BUDGET_REACHED:
      'O limite diario de geracoes OpenAI foi atingido.',
    MINIMUM_INTERVAL_NOT_REACHED: 'O intervalo minimo ainda nao foi atingido.',
    NO_AUTHORIZED_GROUP: 'Nenhum grupo autorizado e disponivel.',
    MULTIPLE_AUTHORIZED_GROUPS:
      'Ha mais de um grupo autorizado para a mesma identidade.',
    COMMERCIAL_AUTOMATION_DUPLICATE_LOGICAL_GROUP:
      'Existe duplicidade de identidade logica.',
    COMMERCIAL_AUTOMATION_TARGET_NOT_ELIGIBLE:
      'O alvo comercial nao esta elegivel.',
    WHATSAPP_GROUP_SEND_DISABLED:
      'O envio para grupos esta desativado na configuracao de deployment.',
    WHATSAPP_GROUP_SAFE_MODE_REQUIRED:
      'O safe mode precisa permanecer ativo para operar grupos.',
    AMBIGUOUS_COMMERCIAL_RUN_EXISTS:
      'Existe uma execucao ambigua aguardando investigacao.',
    COMMERCIAL_EXECUTION_IN_PROGRESS: 'Existe uma execucao comercial ativa.',
    STALE_COMMERCIAL_EXECUTION_EXISTS:
      'Existe uma execucao stale que exige revisao.',
  };
  return messages[reason] ?? 'Existe um bloqueio operacional ativo.';
};

const reasonBlocker = (
  scope: OperationalAdminBlocker['scope'],
  entityId: string | null,
  reason: string,
): OperationalAdminBlocker => ({
  scope,
  entityId,
  code: reason,
  message: messageForReason(reason),
});

const campaignForGroup = (
  group: WhatsAppGroupRecord,
  campaigns: CommercialGroupCampaignRecord[],
) =>
  campaigns.find(
    (campaign) =>
      campaign.anchorDestinationId === group.id ||
      campaign.logicalGroupFingerprint === group.fingerprint,
  ) ?? null;

const MAX_ORDERED_GROUP_ASSIGNMENTS = 32;

const normalizeRequestedAssignmentNames = (input: {
  assignedInstanceName?: string | null;
  assignedInstanceNames?: string[];
}) => {
  if (input.assignedInstanceNames !== undefined) {
    if (
      !Array.isArray(input.assignedInstanceNames) ||
      input.assignedInstanceNames.length > MAX_ORDERED_GROUP_ASSIGNMENTS
    ) {
      throw new AppError(
        'A lista ordenada de instancias do grupo e invalida',
        'OPERATIONAL_ASSIGNMENT_INVALID',
      );
    }
    const names = input.assignedInstanceNames.map((name) =>
      typeof name === 'string' ? name.trim() : '',
    );
    if (
      names.some((name) => name === '') ||
      new Set(names).size !== names.length
    ) {
      throw new AppError(
        'A lista ordenada de instancias do grupo e invalida',
        'OPERATIONAL_ASSIGNMENT_INVALID',
      );
    }
    if (
      input.assignedInstanceName !== undefined &&
      input.assignedInstanceName !== null &&
      input.assignedInstanceName.trim() !== names[0]
    ) {
      throw new AppError(
        'O assignment principal precisa ser o primeiro da lista ordenada',
        'OPERATIONAL_ASSIGNMENT_INVALID',
      );
    }
    return names;
  }
  if (
    input.assignedInstanceName === undefined ||
    input.assignedInstanceName === null
  ) {
    return [];
  }
  const name = input.assignedInstanceName.trim();
  if (!name) {
    throw new AppError(
      'A instancia atribuida e invalida',
      'OPERATIONAL_ASSIGNMENT_INVALID',
    );
  }
  return [name];
};

const listCampaigns = async (repository: CommercialGroupCampaignRepository) => {
  const items: CommercialGroupCampaignRecord[] = [];
  let page = 1;
  while (true) {
    const result = await repository.list({ page, limit: 100 });
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) return items;
    page += 1;
  }
};

const asTarget = (
  group: WhatsAppGroupRecord,
  campaign: CommercialGroupCampaignRecord,
) => ({
  groupId: group.id,
  groupName: group.name,
  instanceName: group.assignedInstanceName ?? undefined,
  orderedInstanceNames: group.assignedInstanceNames,
  assignmentRevision: group.assignmentRevision,
  logicalGroupFingerprint: group.fingerprint,
  campaignId: campaign.id,
  nicheId: campaign.nicheId,
  dailyLimit: campaign.dailyLimit,
  cadenceMinutes: campaign.cadenceMinutes,
  timezone: campaign.timezone,
  allowedStartTime: campaign.allowedStartTime,
  allowedEndTime: campaign.allowedEndTime,
  nextEligibleAt: campaign.nextEligibleAt,
});

export class OperationalAdminService {
  constructor(private readonly dependencies: OperationalAdminDependencies) {}

  private now() {
    return (this.dependencies.clock ?? (() => new Date()))();
  }

  private async readContext() {
    const now = this.now();
    const [settings, instances, groups, campaigns, dispatches, counts, plan] =
      await Promise.all([
        this.dependencies.settings.get(),
        this.dependencies.instances.list(),
        this.dependencies.groups.listAll
          ? this.dependencies.groups.listAll()
          : Promise.resolve([]),
        listCampaigns(this.dependencies.campaigns),
        this.dependencies.dispatches.list({ status: 'SENT' }),
        this.dependencies.status.getCounts(now),
        this.dependencies.planner.preview(now),
      ]);
    return {
      now,
      settings: settings ?? fallbackSettings(now),
      instances,
      groups,
      campaigns,
      dispatches,
      counts,
      plan,
    };
  }

  private async blockersForGroup(
    group: WhatsAppGroupRecord,
    campaign: CommercialGroupCampaignRecord | null,
    instances: WhatsAppInstanceRecord[],
    now: Date,
  ) {
    const blockers: OperationalAdminBlocker[] = [];
    if (!group.active) {
      blockers.push({
        scope: 'GROUP',
        code: 'GROUP_INACTIVE',
        entityId: group.id,
        message: 'O grupo esta desativado administrativamente.',
        actionHint: 'Ative o grupo quando a identidade estiver validada.',
      });
    }
    if (group.paused === true) {
      blockers.push({
        scope: 'GROUP',
        code: 'GROUP_PAUSED',
        entityId: group.id,
        message: 'O grupo esta pausado temporariamente.',
        actionHint: 'Retire a pausa somente com autorizacao operacional.',
      });
    }
    if (!group.available) {
      blockers.push({
        scope: 'GROUP',
        code: 'GROUP_UNAVAILABLE',
        entityId: group.id,
        message:
          'A disponibilidade do grupo nao foi confirmada pelo diretorio.',
      });
    }
    if (
      !group.fingerprint ||
      !COMMERCIAL_GROUP_FINGERPRINT.test(group.fingerprint)
    ) {
      blockers.push({
        scope: 'GROUP',
        code: 'FINGERPRINT_MISMATCH',
        entityId: group.id,
        message:
          'A identidade do grupo nao possui fingerprint comercial valido.',
      });
    }
    let assignedNames: string[] = [];
    try {
      assignedNames = getOrderedAssignedInstanceNames(group);
    } catch {
      assignedNames = [];
    }
    const assignedInstances = assignedNames
      .map((name) => instances.find((candidate) => candidate.name === name))
      .filter((instance): instance is WhatsAppInstanceRecord =>
        Boolean(instance),
      );
    const executableInstance = assignedInstances.find(
      (instance) => instance.active && instance.paused !== true,
    );
    if (
      assignedNames.length === 0 ||
      assignedInstances.length !== assignedNames.length
    ) {
      blockers.push({
        scope: 'GROUP',
        code: 'ASSIGNMENT_INVALID',
        entityId: group.id,
        message: 'O grupo nao possui assignment valido para uma instancia.',
        actionHint: 'Atribua explicitamente uma instancia ativa.',
      });
    } else if (
      !executableInstance &&
      assignedInstances.some((instance) => !instance.active)
    ) {
      blockers.push({
        scope: 'INSTANCE',
        code: 'INSTANCE_INACTIVE',
        entityId: assignedNames[0] ?? null,
        message: 'Todas as instancias atribuidas estao desativadas.',
      });
    } else if (
      !executableInstance &&
      assignedInstances.every((instance) => instance.paused === true)
    ) {
      blockers.push({
        scope: 'INSTANCE',
        code: 'INSTANCE_PAUSED',
        entityId: assignedNames[0] ?? null,
        message: 'Todas as instancias atribuidas estao pausadas.',
      });
    }
    if (!campaign) {
      blockers.push({
        scope: 'GROUP',
        code: 'NO_CAMPAIGN_ASSIGNMENT',
        entityId: group.id,
        message: 'O grupo ainda nao esta associado a uma campanha operacional.',
      });
      return blockers;
    }
    if (
      campaign.anchorDestinationId &&
      campaign.anchorDestinationId !== group.id
    ) {
      blockers.push({
        scope: 'CAMPAIGN',
        code: 'ASSIGNMENT_INVALID',
        entityId: campaign.id,
        message: 'A campanha aponta para outro grupo ancorado.',
      });
    }
    if (!campaign.active) {
      blockers.push({
        scope: 'CAMPAIGN',
        code: 'CAMPAIGN_INACTIVE',
        entityId: campaign.id,
        message: 'A campanha esta desativada.',
      });
    }
    if (!campaign.niche.active) {
      blockers.push({
        scope: 'CAMPAIGN',
        code: 'NICHE_INACTIVE',
        entityId: campaign.niche.id,
        message: 'O nicho da campanha esta desativado.',
      });
    }
    try {
      const readiness =
        await this.dependencies.policy.evaluateAutomationReadiness({
          target: asTarget(group, campaign),
        });
      for (const reason of readiness.reasons) {
        blockers.push(reasonBlocker('GROUP', group.id, reason));
      }
    } catch {
      blockers.push({
        scope: 'GROUP',
        code: 'OPERATIONAL_STATUS_UNAVAILABLE',
        entityId: group.id,
        message: 'O estado de elegibilidade nao pode ser confirmado agora.',
      });
    }
    if (campaign.nextEligibleAt && campaign.nextEligibleAt > now) {
      blockers.push({
        scope: 'GROUP',
        code: 'NEXT_ELIGIBLE_AT',
        entityId: group.id,
        message: 'O grupo aguarda o proximo slot elegivel.',
        nextEligibleAt: campaign.nextEligibleAt.toISOString(),
      });
    }
    return blockers;
  }

  async getOverview(): Promise<OperationalAdminResponse> {
    const context = await this.readContext();
    const schedule = resolveCommercialAutomationSchedule(
      this.dependencies.config,
      context.settings,
    );
    const [
      queueProduct,
      queueDispatch,
      queueCommercial,
      scheduler,
      providerUsage,
    ] = await Promise.all([
      readQueueCounts(this.dependencies.queues?.productPipeline),
      readQueueCounts(this.dependencies.queues?.whatsappDispatch),
      readQueueCounts(this.dependencies.queues?.commercialAutomation),
      this.dependencies.scheduler?.getStatus() ?? Promise.resolve(null),
      this.dependencies.externalBudget?.snapshot() ??
        Promise.resolve({
          dayKey: '',
          shopee: {
            used: 0,
            limit: schedule.dailyShopeeHttpLimit,
            reached: false,
          },
          openAi: {
            used: 0,
            limit: schedule.dailyOpenAiGenerationLimit,
            reached: false,
          },
        }),
    ]);
    const campaignByGroup = new Map(
      context.groups.map((group) => [
        group.id,
        campaignForGroup(group, context.campaigns),
      ]),
    );
    const lastByGroup = new Map<string, Date>();
    const lastByCampaign = new Map<string, Date>();
    const lastByInstance = new Map<string, Date>();
    let lastGlobal: Date | null = null;
    for (const dispatch of context.dispatches) {
      if (dispatch.sentAt && (!lastGlobal || dispatch.sentAt > lastGlobal)) {
        lastGlobal = dispatch.sentAt;
      }
      if (dispatch.sentAt) {
        const currentGroup = lastByGroup.get(dispatch.destinationId);
        if (!currentGroup || dispatch.sentAt > currentGroup) {
          lastByGroup.set(dispatch.destinationId, dispatch.sentAt);
        }
        const campaign = campaignByGroup.get(dispatch.destinationId);
        if (campaign) {
          const currentCampaign = lastByCampaign.get(campaign.id);
          if (!currentCampaign || dispatch.sentAt > currentCampaign) {
            lastByCampaign.set(campaign.id, dispatch.sentAt);
          }
        }
        if (dispatch.instanceName) {
          const currentInstance = lastByInstance.get(dispatch.instanceName);
          if (!currentInstance || dispatch.sentAt > currentInstance) {
            lastByInstance.set(dispatch.instanceName, dispatch.sentAt);
          }
        }
      }
    }
    const nextByGroup = new Map<string, Date>();
    const nextByCampaign = new Map<string, Date>();
    const nextByInstance = new Map<string, Date>();
    const upcomingByGroup = new Map<
      string,
      Array<{ scheduledFor: string; instanceName: string }>
    >();
    const plannedSlots = [...context.plan.slots].sort(
      (left, right) =>
        left.scheduledFor.getTime() - right.scheduledFor.getTime() ||
        left.slotKey.localeCompare(right.slotKey),
    );
    for (const slot of plannedSlots) {
      const groupId = slot.target.groupId;
      const currentGroup = nextByGroup.get(groupId);
      if (!currentGroup || slot.scheduledFor < currentGroup) {
        nextByGroup.set(groupId, slot.scheduledFor);
      }
      const currentCampaign = nextByCampaign.get(slot.target.campaignId);
      if (!currentCampaign || slot.scheduledFor < currentCampaign) {
        nextByCampaign.set(slot.target.campaignId, slot.scheduledFor);
      }
      const currentInstance = nextByInstance.get(slot.target.instanceName);
      if (!currentInstance || slot.scheduledFor < currentInstance) {
        nextByInstance.set(slot.target.instanceName, slot.scheduledFor);
      }
      const upcoming = upcomingByGroup.get(groupId) ?? [];
      if (upcoming.length < 4) {
        upcoming.push({
          scheduledFor: slot.scheduledFor.toISOString(),
          instanceName: slot.target.instanceName,
        });
        upcomingByGroup.set(groupId, upcoming);
      }
    }
    const groupOutputs: OperationalAdminGroup[] = [];
    for (const group of context.groups) {
      const campaign = campaignByGroup.get(group.id) ?? null;
      const blockers = await this.blockersForGroup(
        group,
        campaign,
        context.instances,
        context.now,
      );
      const campaignNext = campaign ? nextByCampaign.get(campaign.id) : null;
      groupOutputs.push({
        id: group.id,
        name: group.name,
        active: group.active,
        paused: group.paused === true,
        available: group.available,
        fingerprint: group.fingerprint ?? null,
        sourceInstanceName: group.sourceInstanceName ?? null,
        assignedInstanceName: group.assignedInstanceName ?? null,
        assignedInstanceNames: (() => {
          try {
            return getOrderedAssignedInstanceNames(group);
          } catch {
            return [];
          }
        })(),
        assignmentRevision: group.assignmentRevision ?? null,
        campaign: campaign
          ? { id: campaign.id, name: campaign.name, active: campaign.active }
          : null,
        niche: campaign?.niche
          ? {
              id: campaign.niche.id,
              name: campaign.niche.name,
              active: campaign.niche.active,
            }
          : null,
        lastSendAt: iso(lastByGroup.get(group.id)),
        nextSendAt: iso(nextByGroup.get(group.id) ?? campaignNext),
        upcomingAssignments: upcomingByGroup.get(group.id) ?? [],
        blockers: uniqueBlockers(blockers),
        memberCount: group.memberCount ?? null,
        ownerIsParticipant: group.ownerIsParticipant ?? null,
        discoveredAt: iso(group.discoveredAt),
        lastSyncedAt: iso(group.lastSyncedAt),
        updatedAt: iso(group.updatedAt),
      });
    }
    const globalReadiness =
      await this.dependencies.policy.evaluateAutomationReadiness();
    const globalBlockers = globalReadiness.reasons.map((reason) =>
      reasonBlocker('GLOBAL', null, reason),
    );
    const environment = this.dependencies.environment ?? {
      groupSendEnabled: true,
      safeMode: true,
    };
    if (!environment.groupSendEnabled) {
      globalBlockers.push(
        reasonBlocker('GLOBAL', null, 'WHATSAPP_GROUP_SEND_DISABLED'),
      );
    }
    if (!environment.safeMode) {
      globalBlockers.push(
        reasonBlocker('GLOBAL', null, 'WHATSAPP_GROUP_SAFE_MODE_REQUIRED'),
      );
    }
    if (providerUsage.shopee.reached) {
      globalBlockers.push(
        reasonBlocker('GLOBAL', null, 'COMMERCIAL_SHOPEE_DAILY_BUDGET_REACHED'),
      );
    }
    if (providerUsage.openAi.reached) {
      globalBlockers.push(
        reasonBlocker('GLOBAL', null, 'COMMERCIAL_OPENAI_DAILY_BUDGET_REACHED'),
      );
    }
    const instances = context.instances.map((instance) => {
      const assignedGroups = groupOutputs.filter((group) =>
        group.assignedInstanceNames.includes(instance.name),
      );
      const groupBlockers = assignedGroups.flatMap((group) =>
        group.blockers.filter(
          (blocker) =>
            blocker.scope === 'INSTANCE' || blocker.scope === 'GLOBAL',
        ),
      );
      const blockers: OperationalAdminBlocker[] = [...groupBlockers];
      if (!instance.active) {
        blockers.push({
          scope: 'INSTANCE',
          code: 'INSTANCE_INACTIVE',
          entityId: instance.name,
          message: 'A instancia esta desativada administrativamente.',
        });
      }
      if (instance.paused === true) {
        blockers.push({
          scope: 'INSTANCE',
          code: 'INSTANCE_PAUSED',
          entityId: instance.name,
          message: 'A instancia esta pausada temporariamente.',
        });
      }
      return {
        name: instance.name,
        active: instance.active,
        paused: instance.paused === true,
        health: 'UNKNOWN' as const,
        assignedGroupCount: assignedGroups.length,
        lastSendAt: iso(lastByInstance.get(instance.name)),
        nextSendAt: iso(nextByInstance.get(instance.name)),
        blockers: uniqueBlockers(blockers),
        updatedAt: instance.updatedAt.toISOString(),
      };
    });
    const campaigns = context.campaigns.map((campaign) => {
      const linkedGroup = groupOutputs.find(
        (group) => group.campaign?.id === campaign.id,
      );
      const campaignBlockers = linkedGroup
        ? linkedGroup.blockers
        : [
            {
              scope: 'CAMPAIGN' as const,
              code: 'ASSIGNMENT_INVALID',
              entityId: campaign.id,
              message: 'A campanha nao possui grupo operacional vinculado.',
              actionHint: 'Associe a campanha a um grupo validado.',
            },
          ];
      return {
        id: campaign.id,
        name: campaign.name,
        active: campaign.active,
        groupId: linkedGroup?.id ?? campaign.anchorDestinationId ?? null,
        groupName:
          linkedGroup?.name ?? campaign.anchorDestination?.name ?? null,
        instanceName: linkedGroup?.assignedInstanceName ?? null,
        cadenceMinutes: campaign.cadenceMinutes,
        timezone: campaign.timezone,
        allowedStartTime: campaign.allowedStartTime,
        allowedEndTime: campaign.allowedEndTime,
        dailyLimit: campaign.dailyLimit,
        niche: {
          id: campaign.niche.id,
          name: campaign.niche.name,
          active: campaign.niche.active,
        },
        lastSendAt: iso(lastByCampaign.get(campaign.id)),
        nextSendAt: iso(nextByCampaign.get(campaign.id)),
        blockers: uniqueBlockers(campaignBlockers),
      };
    });
    return {
      generatedAt: context.now.toISOString(),
      automation: {
        paused: context.settings.paused,
        allowedStartTime: schedule.allowedStartTime,
        allowedEndTime: schedule.allowedEndTime,
        timezone: schedule.timezone,
        minimumIntervalMinutes: schedule.minimumIntervalMinutes,
        staggerMinutes: schedule.staggerMinutes,
        dailyGlobalLimit: schedule.dailyGlobalLimit,
        dailyGroupLimit: schedule.dailyGroupLimit,
        dailyGlobalLimitOverride: context.settings.dailyGlobalLimit ?? null,
        dailyGroupLimitOverride: context.settings.dailyGroupLimit ?? null,
        dailyShopeeHttpLimit: schedule.dailyShopeeHttpLimit,
        dailyOpenAiGenerationLimit: schedule.dailyOpenAiGenerationLimit,
        dailyShopeeHttpLimitOverride:
          context.settings.dailyShopeeHttpLimit ?? null,
        dailyOpenAiGenerationLimitOverride:
          context.settings.dailyOpenAiGenerationLimit ?? null,
        providerUsage,
        hardCaps: {
          maxMessagesPerRun: this.dependencies.maxMessagesPerRun,
        },
        scheduleRevision: schedule.scheduleRevision,
        updatedAt: context.settings.updatedAt.toISOString(),
      },
      nextSendAt: iso(context.plan.slots[0]?.scheduledFor),
      lastSendAt: iso(lastGlobal),
      blockers: uniqueBlockers([
        ...globalBlockers,
        ...groupOutputs.flatMap((group) => group.blockers),
      ]),
      queues: {
        productPipeline: queueProduct,
        whatsappDispatch: queueDispatch,
        commercialAutomation: queueCommercial,
      },
      activeExecutions: context.counts.activeExecutions,
      activeReservations: context.counts.activeReservations,
      ambiguity: context.counts.ambiguity,
      investigationRequired: context.counts.investigationRequired,
      pendingDispatches: context.counts.pendingDispatches,
      pendingOutboxes: context.counts.pendingOutboxes,
      scheduler,
      instances,
      groups: groupOutputs,
      campaigns,
    };
  }

  async createInstance(input: { name: string; confirmation?: string }) {
    const name = input.name.trim();
    if (!INSTANCE_NAME_PATTERN.test(name)) {
      throw new AppError(
        'Nome de instancia invalido',
        'OPERATIONAL_INSTANCE_NAME_INVALID',
      );
    }
    if (input.confirmation !== OPERATIONAL_CHANGE_CONFIRMATION) {
      throw new AppError(
        'Confirmacao explicita obrigatoria para cadastrar instancia',
        'OPERATIONAL_CONFIRMATION_REQUIRED',
      );
    }
    if (await this.dependencies.instances.findByName(name)) {
      throw new AppError(
        'A instancia ja existe',
        'OPERATIONAL_INSTANCE_ALREADY_EXISTS',
      );
    }
    try {
      if (!this.dependencies.instances.create) {
        throw new AppError(
          'Cadastro de instancia indisponivel',
          'OPERATIONAL_INSTANCE_CREATE_UNAVAILABLE',
        );
      }
      return await this.dependencies.instances.create(name);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        'A instancia mudou durante o cadastro',
        'OPERATIONAL_INSTANCE_CONFLICT',
      );
    }
  }

  async updateInstance(input: {
    name: string;
    active?: boolean;
    paused?: boolean;
    expectedUpdatedAt: string;
    confirmation?: string;
  }) {
    const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
    if (Number.isNaN(expectedUpdatedAt.getTime())) {
      throw new AppError(
        'updatedAt esperado invalido',
        'OPERATIONAL_CAS_INVALID',
      );
    }
    if (input.active === undefined && input.paused === undefined) {
      throw new AppError(
        'Nenhuma alteracao operacional informada',
        'OPERATIONAL_UPDATE_INVALID',
      );
    }
    if (
      input.active !== undefined &&
      input.confirmation !== OPERATIONAL_CHANGE_CONFIRMATION
    ) {
      throw new AppError(
        'Confirmacao explicita obrigatoria para alterar estado da instancia',
        'OPERATIONAL_CONFIRMATION_REQUIRED',
      );
    }
    if (
      input.paused !== undefined &&
      input.confirmation !== OPERATIONAL_PAUSE_CONFIRMATION
    ) {
      throw new AppError(
        'Confirmacao explicita obrigatoria para pausar instancia',
        'OPERATIONAL_PAUSE_CONFIRMATION_REQUIRED',
      );
    }
    if (!this.dependencies.instances.updateAdministrative) {
      throw new AppError(
        'CAS de instancia indisponivel',
        'OPERATIONAL_CAS_UNAVAILABLE',
      );
    }
    const updated = await this.dependencies.instances.updateAdministrative(
      input.name,
      {
        ...(input.active === undefined ? {} : { active: input.active }),
        ...(input.paused === undefined ? {} : { paused: input.paused }),
        expectedUpdatedAt,
      },
    );
    if (!updated) {
      throw new AppError(
        'A instancia mudou ou nao existe',
        'OPERATIONAL_CAS_CONFLICT',
      );
    }
    return updated;
  }

  async updateGroup(input: {
    id: string;
    active?: boolean;
    paused?: boolean;
    assignedInstanceName?: string | null;
    assignedInstanceNames?: string[];
    expectedUpdatedAt: string;
    confirmation?: string;
  }) {
    const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
    if (Number.isNaN(expectedUpdatedAt.getTime())) {
      throw new AppError(
        'updatedAt esperado invalido',
        'OPERATIONAL_CAS_INVALID',
      );
    }
    if (
      input.active === undefined &&
      input.paused === undefined &&
      input.assignedInstanceName === undefined &&
      input.assignedInstanceNames === undefined
    ) {
      throw new AppError(
        'Nenhuma alteracao de grupo informada',
        'OPERATIONAL_UPDATE_INVALID',
      );
    }
    if (
      input.active !== undefined &&
      input.confirmation !== OPERATIONAL_CHANGE_CONFIRMATION
    ) {
      throw new AppError(
        'Confirmacao explicita obrigatoria para alterar grupo',
        'OPERATIONAL_CONFIRMATION_REQUIRED',
      );
    }
    if (
      input.paused !== undefined &&
      input.confirmation !== OPERATIONAL_PAUSE_CONFIRMATION
    ) {
      throw new AppError(
        'Confirmacao explicita obrigatoria para pausar grupo',
        'OPERATIONAL_PAUSE_CONFIRMATION_REQUIRED',
      );
    }
    if (
      (input.assignedInstanceName !== undefined ||
        input.assignedInstanceNames !== undefined) &&
      input.confirmation !== OPERATIONAL_ASSIGNMENT_CONFIRMATION
    ) {
      throw new AppError(
        'Confirmacao explicita obrigatoria para reatribuir grupo',
        'OPERATIONAL_ASSIGNMENT_CONFIRMATION_REQUIRED',
      );
    }
    const group = await this.dependencies.groups.findById(input.id);
    if (!group) {
      throw new AppError('Grupo nao encontrado', 'OPERATIONAL_GROUP_NOT_FOUND');
    }
    const assignmentRequested =
      input.assignedInstanceName !== undefined ||
      input.assignedInstanceNames !== undefined;
    if (assignmentRequested) {
      const nextNames = normalizeRequestedAssignmentNames(input);
      for (const instanceName of nextNames) {
        const instance =
          await this.dependencies.instances.findByName(instanceName);
        if (!instance || !instance.active || instance.paused === true) {
          throw new AppError(
            'A instancia de destino precisa estar ativa e nao pausada',
            'OPERATIONAL_ASSIGNMENT_INSTANCE_BLOCKED',
          );
        }
      }
      if (
        !group.fingerprint ||
        !COMMERCIAL_GROUP_FINGERPRINT.test(group.fingerprint)
      ) {
        throw new AppError(
          'Fingerprint do grupo invalido',
          'OPERATIONAL_ASSIGNMENT_FINGERPRINT_INVALID',
        );
      }
      const relatedCampaign = campaignForGroup(
        group,
        await listCampaigns(this.dependencies.campaigns),
      );
      if (
        relatedCampaign?.anchorDestinationId &&
        relatedCampaign.anchorDestinationId !== group.id
      ) {
        throw new AppError(
          'A campanha relacionada aponta para outro grupo',
          'OPERATIONAL_ASSIGNMENT_CAMPAIGN_MISMATCH',
        );
      }
      if (
        relatedCampaign &&
        relatedCampaign.logicalGroupFingerprint !== group.fingerprint
      ) {
        throw new AppError(
          'O fingerprint nao coincide com a campanha relacionada',
          'OPERATIONAL_ASSIGNMENT_CAMPAIGN_MISMATCH',
        );
      }
      if (relatedCampaign && !relatedCampaign.niche.active) {
        throw new AppError(
          'O nicho da campanha relacionada esta inativo',
          'OPERATIONAL_ASSIGNMENT_NICHE_BLOCKED',
        );
      }
      let currentNames: string[];
      try {
        currentNames = getOrderedAssignedInstanceNames(group);
      } catch {
        throw new AppError(
          'O assignment persistido do grupo e invalido',
          'OPERATIONAL_ASSIGNMENT_INVALID',
        );
      }
      const assignmentChanging =
        currentNames.length !== nextNames.length ||
        currentNames.some((name, index) => name !== nextNames[index]);
      if (assignmentChanging) {
        const now = this.now();
        if (
          this.dependencies.status.hasActiveGroupLifecycle &&
          (await this.dependencies.status.hasActiveGroupLifecycle(
            input.id,
            now,
          ))
        ) {
          throw new AppError(
            'Assignment bloqueado enquanto o grupo possui lifecycle ativo',
            'OPERATIONAL_ASSIGNMENT_LIFECYCLE_ACTIVE',
          );
        }
        if (!this.dependencies.groups.updateAdministrativeWithLifecycleGuard) {
          throw new AppError(
            'Serializacao de routing indisponivel',
            'OPERATIONAL_ROUTING_SERIALIZATION_UNAVAILABLE',
          );
        }
        const result =
          await this.dependencies.groups.updateAdministrativeWithLifecycleGuard(
            input.id,
            {
              ...(input.active === undefined ? {} : { active: input.active }),
              ...(input.paused === undefined ? {} : { paused: input.paused }),
              assignedInstanceName: nextNames[0] ?? null,
              assignedInstanceNames: nextNames,
              expectedUpdatedAt,
              now,
            },
          );
        if (result.kind === 'ACTIVE_LIFECYCLE') {
          throw new AppError(
            'Assignment bloqueado enquanto o grupo possui lifecycle ativo',
            'OPERATIONAL_ASSIGNMENT_LIFECYCLE_ACTIVE',
          );
        }
        if (result.kind === 'CAS_CONFLICT') {
          throw new AppError(
            'O grupo mudou ou nao existe',
            'OPERATIONAL_CAS_CONFLICT',
          );
        }
        return result.group;
      }
      if (
        input.active === undefined &&
        input.paused === undefined &&
        input.assignedInstanceName === undefined
      ) {
        return group;
      }
    }
    if (!this.dependencies.groups.updateAdministrative) {
      throw new AppError(
        'CAS de grupo indisponivel',
        'OPERATIONAL_CAS_UNAVAILABLE',
      );
    }
    const updated = await this.dependencies.groups.updateAdministrative(
      input.id,
      {
        ...(input.active === undefined ? {} : { active: input.active }),
        ...(input.paused === undefined ? {} : { paused: input.paused }),
        ...(input.assignedInstanceName === undefined ||
        input.assignedInstanceNames !== undefined
          ? {}
          : { assignedInstanceName: input.assignedInstanceName }),
        expectedUpdatedAt,
      },
    );
    if (!updated) {
      throw new AppError(
        'O grupo mudou ou nao existe',
        'OPERATIONAL_CAS_CONFLICT',
      );
    }
    return updated;
  }

  async updateAutomationSettings(input: {
    allowedStartTime?: string | null;
    allowedEndTime?: string | null;
    timezone?: string | null;
    minimumIntervalMinutes?: number | null;
    staggerMinutes?: number | null;
    dailyGlobalLimit?: number | null;
    dailyGroupLimit?: number | null;
    dailyShopeeHttpLimit?: number | null;
    dailyOpenAiGenerationLimit?: number | null;
    expectedRevision: number;
    confirmation: string;
  }) {
    if (input.confirmation !== OPERATIONAL_CHANGE_CONFIRMATION) {
      throw new AppError(
        'Confirmacao explicita obrigatoria para alterar automacao',
        'OPERATIONAL_CONFIRMATION_REQUIRED',
      );
    }
    const { confirmation, ...schedule } = input;
    void confirmation;
    return this.dependencies.policy.updateScheduleSettings(schedule);
  }
}

export const isOperationalAdminCounts = (
  value: OperationalStatusCounts,
): value is OperationalStatusCounts =>
  Object.values(value).every(
    (item) => typeof item === 'number' && Number.isInteger(item) && item >= 0,
  );
