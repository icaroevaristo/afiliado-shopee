import { describe, expect, it, vi } from 'vitest';
import { JOB_NAMES } from '@shopee-auto-affiliate-ai/queue';

import {
  OperationalAdminService,
  OPERATIONAL_ASSIGNMENT_CONFIRMATION,
  OPERATIONAL_CHANGE_CONFIRMATION,
  OPERATIONAL_PAUSE_CONFIRMATION,
} from '../src/operational-admin-service';
import type {
  CommercialAutomationHistoryRepository,
  CommercialAutomationSettingsRecord,
  CommercialAutomationSettingsRepository,
  CommercialGroupCampaignRecord,
  CommercialGroupCampaignRepository,
  OperationalStatusRepository,
  WhatsAppDispatchRepository,
  WhatsAppGroupDirectoryRepository,
  WhatsAppGroupCreateData,
  WhatsAppGroupRecord,
  WhatsAppInstanceRecord,
  WhatsAppInstanceRepository,
} from '../src/repositories';
import type {
  CommercialAutomationPolicyConfig,
  CommercialAutomationPolicyService,
  CommercialAutomationStatus,
} from '../src/commercial-automation-policy-service';
import type { PlannedCommercialTargetSlot } from '../src/commercial-automation-scheduler-planner';

const NOW = new Date('2026-08-28T15:00:00.000Z');

const instance = (name = 'instance-a'): WhatsAppInstanceRecord => ({
  name,
  active: true,
  paused: false,
  createdAt: NOW,
  updatedAt: NOW,
});

const group = (): WhatsAppGroupRecord => ({
  id: 'group-a',
  name: 'Grupo A',
  destination: '123@g.us',
  type: 'GROUP',
  active: true,
  paused: false,
  available: true,
  fingerprint: 'grp_aaaaaaaaaaaa',
  sourceInstanceName: 'instance-a',
  assignedInstanceName: 'instance-a',
  memberCount: 3,
  ownerIsParticipant: true,
  discoveredAt: NOW,
  lastSyncedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
});

const campaign = (): CommercialGroupCampaignRecord => ({
  id: 'campaign-a',
  name: 'Campanha A',
  logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
  anchorDestinationId: 'group-a',
  nicheId: 'niche-a',
  active: true,
  cadenceMinutes: 15,
  timezone: 'America/Sao_Paulo',
  allowedStartTime: '08:00',
  allowedEndTime: '22:00',
  dailyLimit: 60,
  failureCount: 0,
  nextEligibleAt: null,
  attemptExecutionId: null,
  attemptReservedAt: null,
  attemptLeaseExpiresAt: null,
  queueTargetSize: 40,
  dedupeDays: 30,
  niche: { id: 'niche-a', name: 'Nicho A', slug: 'niche-a', active: true },
  anchorDestination: {
    id: 'group-a',
    name: 'Grupo A',
    fingerprint: 'grp_aaaaaaaaaaaa',
    active: true,
    available: true,
    assignedInstanceName: 'instance-a',
  },
  createdAt: NOW,
  updatedAt: NOW,
});

const plannedSlot = (scheduledFor: Date): PlannedCommercialTargetSlot => ({
  slotKey: `slot-${scheduledFor.getTime()}`,
  jobId: `commercial-target-slot-${scheduledFor.getTime()}`,
  scheduledFor,
  delayMs: Math.max(0, scheduledFor.getTime() - NOW.getTime()),
  target: {
    campaignId: 'campaign-a',
    groupId: 'group-a',
    logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
    instanceName: 'instance-a',
    scheduledFor: scheduledFor.toISOString(),
    slotKey: `slot-${scheduledFor.getTime()}`,
    scheduleRevision: 2,
  },
});

class MemoryInstances implements WhatsAppInstanceRepository {
  records = [instance()];

  async list() {
    return this.records;
  }

  async findByName(name: string) {
    return this.records.find((record) => record.name === name) ?? null;
  }

  async upsert(name: string) {
    const record = instance(name);
    this.records.push(record);
    return record;
  }

  async create(name: string) {
    const record = instance(name);
    record.active = false;
    this.records.push(record);
    return record;
  }

  async updateAdministrative(
    name: string,
    input: { active?: boolean; paused?: boolean; expectedUpdatedAt: Date },
  ) {
    const current = await this.findByName(name);
    if (
      !current ||
      current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
    ) {
      return null;
    }
    const updated = {
      ...current,
      ...(input.active === undefined ? {} : { active: input.active }),
      ...(input.paused === undefined ? {} : { paused: input.paused }),
      updatedAt: new Date(NOW.getTime() + 1),
    };
    this.records = this.records.map((record) =>
      record.name === name ? updated : record,
    );
    return updated;
  }

  async setActive(name: string, active: boolean) {
    return this.updateAdministrative(name, { active, expectedUpdatedAt: NOW });
  }
}

class MemoryGroups implements WhatsAppGroupDirectoryRepository {
  record = group();
  lifecycleActive = false;

  async findById(id: string) {
    return id === this.record.id ? this.record : null;
  }

  async findByExternalGroupId() {
    return this.record;
  }

  async listByInstance() {
    return [this.record];
  }

  async list() {
    return [this.record];
  }

  async listAll() {
    return [this.record];
  }

  async create(input: WhatsAppGroupCreateData) {
    this.record = {
      ...input,
      id: 'group-a',
      createdAt: NOW,
      updatedAt: NOW,
    };
    return this.record;
  }

  async update() {
    return this.record;
  }

  async updateAdministrative(
    id: string,
    input: {
      active?: boolean;
      paused?: boolean;
      assignedInstanceName?: string | null;
      assignedInstanceNames?: string[];
      expectedUpdatedAt: Date;
    },
  ) {
    if (
      id !== this.record.id ||
      this.record.updatedAt?.getTime() !== input.expectedUpdatedAt.getTime()
    )
      return null;
    this.record = {
      ...this.record,
      ...(input.active === undefined ? {} : { active: input.active }),
      ...(input.paused === undefined ? {} : { paused: input.paused }),
      ...(input.assignedInstanceName === undefined
        ? {}
        : { assignedInstanceName: input.assignedInstanceName }),
      ...(input.assignedInstanceNames === undefined
        ? {}
        : {
            assignedInstanceNames: input.assignedInstanceNames,
            assignedInstanceName: input.assignedInstanceNames[0] ?? null,
          }),
      updatedAt: new Date(NOW.getTime() + 1),
    };
    return this.record;
  }

  async updateAdministrativeWithLifecycleGuard(
    id: string,
    input: {
      active?: boolean;
      paused?: boolean;
      assignedInstanceName?: string | null;
      assignedInstanceNames?: string[];
      expectedUpdatedAt: Date;
      now: Date;
    },
  ) {
    if (this.lifecycleActive) return { kind: 'ACTIVE_LIFECYCLE' as const };
    const updated = await this.updateAdministrative(id, input);
    return updated
      ? { kind: 'UPDATED' as const, group: updated }
      : { kind: 'CAS_CONFLICT' as const };
  }
}

const settings: CommercialAutomationSettingsRecord = {
  paused: true,
  pausedAt: NOW,
  resumedAt: null,
  allowedStartTime: '08:00',
  allowedEndTime: '22:00',
  minimumIntervalMinutes: 15,
  staggerMinutes: 5,
  dailyGlobalLimit: 20,
  dailyGroupLimit: 5,
  scheduleRevision: 2,
  updatedAt: NOW,
};

const settingsRepository: CommercialAutomationSettingsRepository = {
  get: async () => settings,
  getOrCreate: async () => settings,
  setPaused: async () => settings,
  updateSchedule: async () => settings,
};

const history: CommercialAutomationHistoryRepository = {
  getSnapshot: async () => ({
    globalSentToday: 1,
    groupSentToday: 1,
    lastSentAt: NOW,
    globalLastSentAt: NOW,
    groupLastSentAt: NOW,
  }),
  hasAmbiguousCommercialExecution: async () => false,
  hasActiveCommercialExecution: async () => false,
  hasStaleCommercialExecution: async () => false,
};

const dispatches: WhatsAppDispatchRepository = {
  createPending: async () => null,
  findByIdForSending: async () => null,
  findByIdWithDetails: async () => null,
  list: async () => [],
  markAttemptPending: async () => false,
  markSubmitted: async () => {
    throw new Error('not used');
  },
  applyDeliveryEvent: async () => ({ kind: 'NOOP' }),
  expireSubmittedConfirmations: async () => [],
  markFailed: async () => {
    throw new Error('not used');
  },
};

const campaigns: CommercialGroupCampaignRepository = {
  createForGroup: async () => campaign(),
  list: async () => ({ items: [campaign()], total: 1 }),
  findById: async () => campaign(),
  update: async () => campaign(),
  hasEligibleDestination: async () => true,
  activateIfEligible: async () => campaign(),
};

const status: OperationalStatusRepository = {
  getCounts: async () => ({
    activeExecutions: 0,
    activeReservations: 0,
    ambiguity: 0,
    investigationRequired: 0,
    pendingDispatches: 0,
    pendingOutboxes: 0,
  }),
  hasActiveGroupLifecycle: async () => false,
};

const config: CommercialAutomationPolicyConfig = {
  enabled: true,
  timezone: 'America/Sao_Paulo',
  allowedStartTime: '08:00',
  allowedEndTime: '22:00',
  dailyGlobalLimit: 100,
  dailyGroupLimit: 20,
  minimumIntervalMinutes: 15,
};

const readiness: CommercialAutomationStatus = {
  enabled: true,
  allowed: false,
  reasons: ['AUTOMATION_PAUSED'],
  nextAllowedAt: null,
  globalSentToday: 1,
  globalRemainingToday: 19,
  groupSentToday: 1,
  groupRemainingToday: 4,
  lastSentAt: NOW.toISOString(),
  globalLastSentAt: NOW.toISOString(),
  groupLastSentAt: NOW.toISOString(),
  paused: true,
  pausedAt: NOW.toISOString(),
  resumedAt: null,
  updatedAt: NOW.toISOString(),
  allowedStartTime: '08:00',
  allowedEndTime: '22:00',
  timezone: 'America/Sao_Paulo',
  dailyGlobalLimit: 20,
  dailyGroupLimit: 5,
  minimumIntervalMinutes: 15,
  authorizedGroupCount: 1,
};

const policy = {
  evaluateAutomationReadiness: async () => readiness,
  updateScheduleSettings: vi.fn(async () => ({
    timezone: 'America/Sao_Paulo',
    allowedStartTime: '08:00',
    allowedEndTime: '22:00',
    minimumIntervalMinutes: 15,
    staggerMinutes: 5,
    scheduleRevision: 3,
  })),
} satisfies Pick<
  CommercialAutomationPolicyService,
  'evaluateAutomationReadiness' | 'updateScheduleSettings'
>;

const createService = (options?: {
  commercialTargetJobs?: Array<{
    id?: string | number;
    name?: string;
    data?: unknown;
  }>;
  commercialTargetJobPages?: Array<
    Array<{ id?: string | number; name?: string; data?: unknown }>
  >;
  plannerSlots?: PlannedCommercialTargetSlot[];
  queueCounts?: {
    productPipeline?: Record<string, number> | 'THROW';
    whatsappDispatch?: Record<string, number> | 'THROW';
    commercialAutomation?: Record<string, number> | 'THROW';
  };
  scheduler?: 'READY' | 'THROW';
}) => {
  status.hasActiveGroupLifecycle = async () => false;
  const instances = new MemoryInstances();
  const groups = new MemoryGroups();
  const getCommercialJobs = vi.fn(
    async (_types: Array<'waiting' | 'active' | 'delayed'>, start = 0) => {
      const jobs = options?.commercialTargetJobPages
        ? (options.commercialTargetJobPages[Math.floor(start / 200)] ?? [])
        : (options?.commercialTargetJobs ?? []);
      return jobs.map((job) => ({
        ...job,
        name: job.name ?? JOB_NAMES.commercialAutomationTarget,
      }));
    },
  );
  const queueReader = (value: Record<string, number> | 'THROW' | undefined) =>
    value === undefined
      ? undefined
      : {
          getJobCounts: async () => {
            if (value === 'THROW') throw new Error('queue unavailable');
            return value;
          },
        };
  const productPipeline = queueReader(options?.queueCounts?.productPipeline);
  const whatsappDispatch = queueReader(options?.queueCounts?.whatsappDispatch);
  const commercialCounts = queueReader(
    options?.queueCounts?.commercialAutomation,
  );
  const commercialAutomation =
    options?.commercialTargetJobs ||
    options?.commercialTargetJobPages ||
    commercialCounts
      ? {
          ...commercialCounts,
          ...(options?.commercialTargetJobs || options?.commercialTargetJobPages
            ? { getJobs: getCommercialJobs }
            : {}),
        }
      : undefined;
  return {
    instances,
    groups,
    getCommercialJobs,
    service: new OperationalAdminService({
      instances,
      groups,
      campaigns,
      dispatches,
      history,
      settings: settingsRepository,
      status,
      policy,
      planner: {
        preview: async () => ({
          slots: options?.plannerSlots ?? [],
          skippedTargets: [],
        }),
      },
      config,
      maxMessagesPerRun: 1,
      clock: () => NOW,
      ...(productPipeline || whatsappDispatch || commercialAutomation
        ? {
            queues: {
              ...(productPipeline ? { productPipeline } : {}),
              ...(whatsappDispatch ? { whatsappDispatch } : {}),
              ...(commercialAutomation ? { commercialAutomation } : {}),
            },
          }
        : {}),
      ...(options?.scheduler
        ? {
            scheduler: {
              getStatus: async () => {
                if (options.scheduler === 'THROW') {
                  throw new Error('scheduler unavailable');
                }
                return { status: 'registered' };
              },
            },
          }
        : {}),
    }),
  };
};

describe('OperationalAdminService', () => {
  it('preserva ausência de reader como UNKNOWN, sem inventar fila vazia', async () => {
    const { service } = createService();

    const result = await service.getOverview();

    expect(result.queues.productPipeline).toMatchObject({
      status: 'UNKNOWN',
      source: 'QUEUE',
      counts: null,
      observedAt: NOW.toISOString(),
    });
    expect(
      result.blockers.filter(
        (blocker) => blocker.code === 'QUEUE_HEALTH_UNKNOWN',
      ),
    ).toHaveLength(3);
  });

  it('reporta zero somente depois de medir cada estado de fila', async () => {
    const { service } = createService({
      queueCounts: {
        productPipeline: {},
        whatsappDispatch: {},
        commercialAutomation: {},
      },
    });

    const result = await service.getOverview();

    expect(result.queues.productPipeline).toMatchObject({
      status: 'READY',
      counts: { waiting: 0, active: 0, delayed: 0, prioritized: 0 },
    });
    expect(result.readiness.queues.status).toBe('READY');
    expect(
      result.blockers.some(
        (blocker) => blocker.code === 'QUEUE_HEALTH_UNKNOWN',
      ),
    ).toBe(false);
  });

  it('mantém saúde parcial de filas quando uma leitura falha', async () => {
    const { service } = createService({
      queueCounts: {
        productPipeline: { waiting: 2 },
        whatsappDispatch: 'THROW',
        commercialAutomation: { delayed: 1 },
      },
    });

    const result = await service.getOverview();

    expect(result.queues.productPipeline).toMatchObject({
      status: 'READY',
      counts: { waiting: 2, active: 0, delayed: 0, prioritized: 0 },
    });
    expect(result.queues.whatsappDispatch).toMatchObject({
      status: 'UNAVAILABLE',
      counts: null,
    });
    expect(result.queues.commercialAutomation).toMatchObject({
      status: 'READY',
      counts: { waiting: 0, active: 0, delayed: 1, prioritized: 0 },
    });
  });

  it('marca scheduler sem leitura como blocker correlacionado, sem derrubar o snapshot', async () => {
    const { service } = createService({ scheduler: 'THROW' });

    const result = await service.getOverview();
    const blocker = result.blockers.find(
      (candidate) => candidate.code === 'SCHEDULER_STATUS_UNKNOWN',
    );

    expect(blocker).toMatchObject({
      source: 'SCHEDULER',
      observedAt: NOW.toISOString(),
    });
    expect(result.readiness.scheduler.status).toBe('UNKNOWN');
    expect(result.scheduler).toBeNull();
  });

  it('correlaciona conexão de instância não comprovada com source e timestamp', async () => {
    const { service } = createService();

    const result = await service.getOverview();
    const blocker = result.blockers.find(
      (candidate) => candidate.code === 'WHATSAPP_INSTANCE_CONNECTION_UNKNOWN',
    );

    expect(blocker).toMatchObject({
      scope: 'INSTANCE',
      entityId: 'instance-a',
      source: 'INSTANCE_HEALTH',
      observedAt: NOW.toISOString(),
    });
    expect(result.readiness.instanceConnectivity.status).toBe('UNKNOWN');
    expect(result.readiness.send.status).toBe('NOT_READY');
  });

  it('deriva limites efetivos, próximo/último envio e blockers sem persistir estados derivados', async () => {
    const { service } = createService();
    const result = await service.getOverview();

    expect(result.automation.dailyGlobalLimit).toBe(20);
    expect(result.automation.dailyGroupLimit).toBe(5);
    expect(result.automation.hardCaps).toEqual({ maxMessagesPerRun: 1 });
    expect(result.groups[0]?.lastSendAt).toBe(null);
    expect(result.groups[0]?.blockers.map((blocker) => blocker.code)).toContain(
      'AUTOMATION_PAUSED',
    );
    expect(
      result.campaigns[0]?.blockers.map((blocker) => blocker.code),
    ).toContain('AUTOMATION_PAUSED');
    expect(result.activeReservations).toBe(0);
  });

  it('atribui bloqueio de janela operacional à fonte POLICY', async () => {
    const previousReasons = readiness.reasons;
    readiness.reasons = ['OUTSIDE_ALLOWED_WINDOW'];
    try {
      const { service } = createService();
      const result = await service.getOverview();

      expect(
        result.blockers.find(
          (blocker) => blocker.code === 'OUTSIDE_ALLOWED_WINDOW',
        ),
      ).toMatchObject({ source: 'POLICY', observedAt: NOW.toISOString() });
    } finally {
      readiness.reasons = previousReasons;
    }
  });

  it('T17 usa target pendente às 16:37 antes do slot hipotético do planner às 16:52', async () => {
    const queuedAt = new Date('2026-08-28T19:37:00.000Z');
    const plannerAt = new Date('2026-08-28T19:52:00.000Z');
    const { service } = createService({
      plannerSlots: [plannedSlot(plannerAt)],
      commercialTargetJobs: [
        {
          id: 'commercial-target-slot-queued',
          data: {
            mode: 'send',
            kind: 'target',
            target: {
              campaignId: 'campaign-a',
              groupId: 'group-a',
              logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
              instanceName: 'instance-a',
              scheduledFor: queuedAt.toISOString(),
              slotKey: 'slot-queued',
              scheduleRevision: 2,
            },
          },
        },
      ],
    });
    const result = await service.getOverview();

    expect(result.nextSendAt).toBe(queuedAt.toISOString());
    expect(result.groups[0]?.nextSendAt).toBe(queuedAt.toISOString());
    expect(result.groups[0]?.upcomingAssignments).toEqual([
      { scheduledFor: queuedAt.toISOString(), instanceName: 'instance-a' },
    ]);
  });

  it('T18 usa o fallback do planner quando não há target job pendente válido', async () => {
    const plannerAt = new Date('2026-08-28T19:52:00.000Z');
    const { service } = createService({
      plannerSlots: [plannedSlot(plannerAt)],
    });

    const result = await service.getOverview();

    expect(result.nextSendAt).toBe(plannerAt.toISOString());
    expect(result.groups[0]?.nextSendAt).toBe(plannerAt.toISOString());
  });

  it('T19 ignora target job com scheduleRevision stale em vez de apresentá-lo como próximo envio', async () => {
    const { service } = createService({
      commercialTargetJobs: [
        {
          id: 'commercial-target-slot-stale',
          data: {
            mode: 'send',
            kind: 'target',
            target: {
              campaignId: 'campaign-a',
              groupId: 'group-a',
              logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
              instanceName: 'instance-a',
              scheduledFor: '2026-08-28T19:37:00.000Z',
              slotKey: 'slot-stale',
              scheduleRevision: 1,
            },
          },
        },
      ],
    });

    const result = await service.getOverview();

    expect(result.nextSendAt).toBeNull();
    expect(result.groups[0]?.nextSendAt).toBeNull();
  });

  it('não consulta jobs active nem apresenta target vencido como próximo envio', async () => {
    const { service, getCommercialJobs } = createService({
      commercialTargetJobs: [
        {
          id: 'commercial-target-slot-expired',
          data: {
            mode: 'send',
            kind: 'target',
            target: {
              campaignId: 'campaign-a',
              groupId: 'group-a',
              logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
              instanceName: 'instance-a',
              scheduledFor: '2026-08-28T14:59:00.000Z',
              slotKey: 'slot-expired',
              scheduleRevision: 2,
            },
          },
        },
      ],
    });

    const result = await service.getOverview();

    expect(getCommercialJobs).toHaveBeenCalledWith(
      ['waiting', 'delayed'],
      0,
      199,
    );
    expect(result.nextSendAt).toBeNull();
  });

  it('ignora target preview mesmo quando sua identidade e horário parecem válidos', async () => {
    const { service } = createService({
      commercialTargetJobs: [
        {
          id: 'commercial-target-slot-preview',
          data: {
            mode: 'preview',
            kind: 'target',
            target: {
              campaignId: 'campaign-a',
              groupId: 'group-a',
              logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
              instanceName: 'instance-a',
              scheduledFor: '2026-08-28T19:37:00.000Z',
              slotKey: 'slot-preview',
              scheduleRevision: 2,
            },
          },
        },
      ],
    });

    await expect(service.getOverview()).resolves.toMatchObject({
      nextSendAt: null,
    });
  });

  it('ignora job com nome BullMQ divergente do target validado pelo worker', async () => {
    const { service } = createService({
      commercialTargetJobs: [
        {
          id: 'commercial-target-slot-wrong-name',
          name: JOB_NAMES.commercialAutomationTick,
          data: {
            mode: 'send',
            kind: 'target',
            target: {
              campaignId: 'campaign-a',
              groupId: 'group-a',
              logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
              instanceName: 'instance-a',
              scheduledFor: '2026-08-28T19:37:00.000Z',
              slotKey: 'slot-wrong-name',
              scheduleRevision: 2,
            },
          },
        },
      ],
    });

    await expect(service.getOverview()).resolves.toMatchObject({
      nextSendAt: null,
    });
  });

  it('T20 ignora target job com assignmentRevision stale', async () => {
    const { service, groups } = createService({
      commercialTargetJobs: [
        {
          id: 'commercial-target-slot-assignment-stale',
          data: {
            mode: 'send',
            kind: 'target',
            target: {
              campaignId: 'campaign-a',
              groupId: 'group-a',
              logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
              instanceName: 'instance-a',
              scheduledFor: '2026-08-28T19:37:00.000Z',
              slotKey: 'slot-assignment-stale',
              scheduleRevision: 2,
              assignmentRevision: 1,
            },
          },
        },
      ],
    });
    groups.record = { ...groups.record, assignmentRevision: 2 };

    const result = await service.getOverview();

    expect(result.nextSendAt).toBeNull();
    expect(result.groups[0]?.nextSendAt).toBeNull();
  });

  it('varre páginas completas e escolhe o menor scheduledFor depois do primeiro bloco', async () => {
    const filler = Array.from({ length: 200 }, (_, index) => ({
      id: `commercial-target-filler-${index}`,
      data: { mode: 'preview', kind: 'planner' },
    }));
    const earliest = '2026-08-28T19:37:00.000Z';
    const later = '2026-08-28T19:52:00.000Z';
    const { service, getCommercialJobs } = createService({
      commercialTargetJobPages: [
        filler,
        [
          {
            id: 'commercial-target-slot-later',
            data: {
              mode: 'send',
              kind: 'target',
              target: {
                campaignId: 'campaign-a',
                groupId: 'group-a',
                logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
                instanceName: 'instance-a',
                scheduledFor: later,
                slotKey: 'slot-later',
                scheduleRevision: 2,
              },
            },
          },
          {
            id: 'commercial-target-slot-earliest',
            data: {
              mode: 'send',
              kind: 'target',
              target: {
                campaignId: 'campaign-a',
                groupId: 'group-a',
                logicalGroupFingerprint: 'grp_aaaaaaaaaaaa',
                instanceName: 'instance-a',
                scheduledFor: earliest,
                slotKey: 'slot-earliest',
                scheduleRevision: 2,
              },
            },
          },
        ],
      ],
    });

    const result = await service.getOverview();

    expect(result.nextSendAt).toBe(earliest);
    expect(getCommercialJobs).toHaveBeenNthCalledWith(
      1,
      ['waiting', 'delayed'],
      0,
      199,
    );
    expect(getCommercialJobs).toHaveBeenNthCalledWith(
      2,
      ['waiting', 'delayed'],
      200,
      399,
    );
  });

  it('usa CAS para atualizar pausa de instância', async () => {
    const { service, instances } = createService();
    const updated = await service.updateInstance({
      name: 'instance-a',
      paused: true,
      expectedUpdatedAt: NOW.toISOString(),
      confirmation: OPERATIONAL_PAUSE_CONFIRMATION,
    });

    expect(updated.paused).toBe(true);
    await expect(
      service.updateInstance({
        name: 'instance-a',
        active: false,
        expectedUpdatedAt: NOW.toISOString(),
        confirmation: OPERATIONAL_CHANGE_CONFIRMATION,
      }),
    ).rejects.toMatchObject({ code: 'OPERATIONAL_CAS_CONFLICT' });
    expect(instances.records[0]?.active).toBe(true);
  });

  it('bloqueia reatribuição com lifecycle ativo e exige confirmação própria', async () => {
    const { service, groups } = createService();
    status.hasActiveGroupLifecycle = async () => true;

    await expect(
      service.updateGroup({
        id: 'group-a',
        assignedInstanceName: 'instance-a',
        expectedUpdatedAt: NOW.toISOString(),
        confirmation: OPERATIONAL_ASSIGNMENT_CONFIRMATION,
      }),
    ).resolves.toBeDefined();

    groups.record.assignedInstanceName = 'instance-old';
    await expect(
      service.updateGroup({
        id: 'group-a',
        assignedInstanceName: 'instance-a',
        expectedUpdatedAt: new Date(NOW.getTime() + 1).toISOString(),
        confirmation: OPERATIONAL_ASSIGNMENT_CONFIRMATION,
      }),
    ).rejects.toMatchObject({
      code: 'OPERATIONAL_ASSIGNMENT_LIFECYCLE_ACTIVE',
    });
  });

  it('reavalia lifecycle dentro da serialização mesmo após precheck seguro', async () => {
    const { service, groups, instances } = createService();
    instances.records.push(instance('instance-b'));
    status.hasActiveGroupLifecycle = async () => false;
    groups.lifecycleActive = true;

    await expect(
      service.updateGroup({
        id: 'group-a',
        assignedInstanceName: 'instance-b',
        expectedUpdatedAt: NOW.toISOString(),
        confirmation: OPERATIONAL_ASSIGNMENT_CONFIRMATION,
      }),
    ).rejects.toMatchObject({
      code: 'OPERATIONAL_ASSIGNMENT_LIFECYCLE_ACTIVE',
    });
    expect(groups.record.assignedInstanceName).toBe('instance-a');
  });

  it('preserva CAS stale dentro da serialização de routing', async () => {
    const { service, groups } = createService();

    await expect(
      service.updateGroup({
        id: 'group-a',
        assignedInstanceName: null,
        expectedUpdatedAt: new Date(NOW.getTime() - 1).toISOString(),
        confirmation: OPERATIONAL_ASSIGNMENT_CONFIRMATION,
      }),
    ).rejects.toMatchObject({ code: 'OPERATIONAL_CAS_CONFLICT' });
    expect(groups.record.assignedInstanceName).toBe('instance-a');
  });

  it('faz update de settings por confirmação e scheduleRevision', async () => {
    const { service } = createService();
    await service.updateAutomationSettings({
      dailyGlobalLimit: 10,
      dailyGroupLimit: 3,
      expectedRevision: 2,
      confirmation: OPERATIONAL_CHANGE_CONFIRMATION,
    });
    expect(policy.updateScheduleSettings).toHaveBeenCalledWith({
      dailyGlobalLimit: 10,
      dailyGroupLimit: 3,
      expectedRevision: 2,
    });
  });

  it('cadastra instância inativa até a ativação administrativa', async () => {
    const { service, instances } = createService();

    const created = await service.createInstance({
      name: 'instance-new',
      confirmation: OPERATIONAL_CHANGE_CONFIRMATION,
    });

    expect(created).toMatchObject({ name: 'instance-new', active: false });
    expect(instances.records).toHaveLength(2);
  });

  it('permite remover assignment com CAS quando não há lifecycle ativo', async () => {
    const { service, groups } = createService();

    await expect(
      service.updateGroup({
        id: 'group-a',
        assignedInstanceName: null,
        expectedUpdatedAt: NOW.toISOString(),
        confirmation: OPERATIONAL_ASSIGNMENT_CONFIRMATION,
      }),
    ).resolves.toMatchObject({ assignedInstanceName: null });
    expect(groups.record.assignedInstanceName).toBeNull();
  });

  it('preserva a ordem de múltiplas instâncias e usa a confirmação de assignment', async () => {
    const { service, groups, instances } = createService();
    instances.records.push(instance('instance-b'));

    await expect(
      service.updateGroup({
        id: 'group-a',
        assignedInstanceNames: ['instance-a', 'instance-b'],
        expectedUpdatedAt: NOW.toISOString(),
        confirmation: OPERATIONAL_ASSIGNMENT_CONFIRMATION,
      }),
    ).resolves.toMatchObject({
      assignedInstanceName: 'instance-a',
      assignedInstanceNames: ['instance-a', 'instance-b'],
    });
    expect(groups.record.assignedInstanceNames).toEqual([
      'instance-a',
      'instance-b',
    ]);
  });

  it('rejeita lista ordenada com duplicidade antes do repository', async () => {
    const { service, groups } = createService();

    await expect(
      service.updateGroup({
        id: 'group-a',
        assignedInstanceNames: ['instance-a', 'instance-a'],
        expectedUpdatedAt: NOW.toISOString(),
        confirmation: OPERATIONAL_ASSIGNMENT_CONFIRMATION,
      }),
    ).rejects.toMatchObject({ code: 'OPERATIONAL_ASSIGNMENT_INVALID' });
    expect(groups.record.assignedInstanceName).toBe('instance-a');
  });

  it('expõe blockers de segurança do deployment sem expor configuração sensível', async () => {
    const { instances, groups } = createService();
    const service = new OperationalAdminService({
      instances,
      groups,
      campaigns,
      dispatches,
      history,
      settings: settingsRepository,
      status,
      policy,
      planner: { preview: async () => ({ slots: [], skippedTargets: [] }) },
      config,
      maxMessagesPerRun: 1,
      environment: { groupSendEnabled: false, safeMode: false },
      clock: () => NOW,
    });

    const result = await service.getOverview();

    expect(result.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining([
        'WHATSAPP_GROUP_SEND_DISABLED',
        'WHATSAPP_GROUP_SAFE_MODE_REQUIRED',
      ]),
    );
  });
});
