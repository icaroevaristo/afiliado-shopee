import { describe, expect, it } from 'vitest';

import {
  COMMERCIAL_AUTOMATION_RESUME_CONFIRMATION,
  CommercialAutomationPolicyService,
  type CommercialAutomationPolicyConfig,
} from '../src/commercial-automation-policy-service';
import type {
  CommercialAutomationTarget,
  CommercialAutomationHistoryRepository,
  CommercialAutomationSettingsRecord,
  CommercialAutomationSettingsRepository,
  WhatsAppGroupRecord,
} from '../src/repositories';

const NOW = new Date('2026-07-25T15:00:00.000Z');

const baseConfig: CommercialAutomationPolicyConfig = {
  enabled: true,
  timezone: 'America/Sao_Paulo',
  allowedStartTime: '08:00',
  allowedEndTime: '20:00',
  dailyGlobalLimit: 1,
  dailyGroupLimit: 1,
  minimumIntervalMinutes: 60,
};

const group = (id = 'group-1'): WhatsAppGroupRecord => ({
  id,
  name: `Grupo ${id}`,
  destination: `${id}@g.us`,
  type: 'GROUP',
  active: true,
  available: true,
  fingerprint: id.endsWith('2') ? 'grp_bbbbbbbbbbbb' : 'grp_aaaaaaaaaaaa',
  sourceInstanceName: 'affiliate-bot',
  discoveredAt: NOW,
  lastSyncedAt: NOW,
});

const target = (
  id = 'group-1',
  dailyLimit = 60,
): CommercialAutomationTarget => ({
  groupId: id,
  groupName: `Grupo ${id}`,
  logicalGroupFingerprint: id.endsWith('2')
    ? 'grp_bbbbbbbbbbbb'
    : 'grp_aaaaaaaaaaaa',
  campaignId: `campaign-${id}`,
  nicheId: `niche-${id}`,
  dailyLimit,
});

class MemorySettings implements CommercialAutomationSettingsRepository {
  record: CommercialAutomationSettingsRecord;

  constructor(paused = false) {
    this.record = {
      paused,
      pausedAt: paused ? NOW : null,
      resumedAt: paused ? null : NOW,
      updatedAt: NOW,
    };
  }

  async getOrCreate() {
    return this.record;
  }

  async get() {
    return this.record;
  }

  async setPaused(paused: boolean, now: Date) {
    this.record = {
      ...this.record,
      paused,
      pausedAt: paused ? now : this.record.pausedAt,
      resumedAt: paused ? this.record.resumedAt : now,
      updatedAt: now,
    };
    return this.record;
  }
}

class MemoryHistory implements CommercialAutomationHistoryRepository {
  globalSentToday = 0;
  groupSentToday = 0;
  groupSentTodayById = new Map<string, number>();
  lastSentAt: Date | null = null;
  groupLastSentAtById = new Map<string, Date>();
  ambiguous = false;
  ambiguousRunIds = new Set<string>();
  active = false;
  activeRunIds = new Set<string>();
  stale = false;
  lastRange?: { dayStartsAt: Date; dayEndsAt: Date; groupId?: string };

  async getSnapshot(input: {
    groupId?: string;
    dayStartsAt: Date;
    dayEndsAt: Date;
  }) {
    this.lastRange = input;
    return {
      globalSentToday: this.globalSentToday,
      groupSentToday: input.groupId
        ? (this.groupSentTodayById.get(input.groupId) ?? this.groupSentToday)
        : this.groupSentToday,
      lastSentAt: this.lastSentAt,
      globalLastSentAt: this.lastSentAt,
      groupLastSentAt: input.groupId
        ? (this.groupLastSentAtById.get(input.groupId) ?? null)
        : null,
    };
  }

  async hasAmbiguousCommercialExecution(excludedRunId?: string) {
    if (this.ambiguous) return true;
    return [...this.ambiguousRunIds].some((runId) => runId !== excludedRunId);
  }

  async hasActiveCommercialExecution(
    _now: Date,
    _excludedExecutionId?: string,
    excludedRunId?: string,
  ) {
    if (this.active) return true;
    return [...this.activeRunIds].some((runId) => runId !== excludedRunId);
  }

  async hasStaleCommercialExecution() {
    return this.stale;
  }
}

const createSubject = ({
  config = {},
  paused = false,
  groups = [group()],
  now = NOW,
}: {
  config?: Partial<CommercialAutomationPolicyConfig>;
  paused?: boolean;
  groups?: WhatsAppGroupRecord[];
  now?: Date;
} = {}) => {
  const settings = new MemorySettings(paused);
  const history = new MemoryHistory();
  const service = new CommercialAutomationPolicyService({
    settings,
    history,
    groups: { list: async () => groups },
    instanceName: 'affiliate-bot',
    config: { ...baseConfig, ...config },
    clock: () => now,
  });
  return { service, settings, history };
};

describe('CommercialAutomationPolicyService', () => {
  it('bloqueia quando a automacao esta desabilitada', async () => {
    const { service } = createSubject({ config: { enabled: false } });

    const result = await service.evaluateAutomationReadiness();

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('AUTOMATION_DISABLED');
    expect(result.nextAllowedAt).toBeNull();
  });

  it('bloqueia quando a pausa persistida esta ativa', async () => {
    const { service } = createSubject({ paused: true });

    await expect(service.evaluateAutomationReadiness()).resolves.toMatchObject({
      allowed: false,
      paused: true,
      reasons: ['AUTOMATION_PAUSED'],
    });
  });

  it('pausa diretamente e exige a confirmacao exata para retomar', async () => {
    const { service, settings } = createSubject();

    await service.setPaused({ paused: true });
    expect(settings.record.paused).toBe(true);
    await expect(service.setPaused({ paused: false })).rejects.toMatchObject({
      code: 'COMMERCIAL_AUTOMATION_RESUME_CONFIRMATION_REQUIRED',
    });
    await expect(
      service.setPaused({ paused: false, confirmation: 'retomar' }),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_AUTOMATION_RESUME_CONFIRMATION_REQUIRED',
    });

    const resumed = await service.setPaused({
      paused: false,
      confirmation: COMMERCIAL_AUTOMATION_RESUME_CONFIRMATION,
    });
    expect(resumed.paused).toBe(false);
    expect(resumed.allowed).toBe(true);
  });

  it('permite dentro da janela e calcula o dia no timezone configurado', async () => {
    const { service, history } = createSubject();

    const result = await service.evaluateAutomationReadiness();

    expect(result.allowed).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(history.lastRange).toMatchObject({
      groupId: undefined,
      dayStartsAt: new Date('2026-07-25T03:00:00.000Z'),
      dayEndsAt: new Date('2026-07-26T03:00:00.000Z'),
    });
  });

  it('bloqueia fora da janela e calcula a proxima abertura', async () => {
    const { service } = createSubject({
      now: new Date('2026-07-25T10:00:00.000Z'),
    });

    await expect(service.evaluateAutomationReadiness()).resolves.toMatchObject({
      allowed: false,
      reasons: ['OUTSIDE_ALLOWED_WINDOW'],
      nextAllowedAt: '2026-07-25T11:00:00.000Z',
    });
  });

  it('suporta janela que atravessa meia-noite', async () => {
    const config = {
      allowedStartTime: '22:00',
      allowedEndTime: '06:00',
    };
    const inside = createSubject({
      config,
      now: new Date('2026-07-26T02:00:00.000Z'),
    });
    const outside = createSubject({ config });

    expect((await inside.service.evaluateAutomationReadiness()).allowed).toBe(
      true,
    );
    await expect(
      outside.service.evaluateAutomationReadiness(),
    ).resolves.toMatchObject({
      reasons: ['OUTSIDE_ALLOWED_WINDOW'],
      nextAllowedAt: '2026-07-26T01:00:00.000Z',
    });
  });

  it('aplica o timezone na avaliacao da janela', async () => {
    const { service } = createSubject({
      config: { allowedStartTime: '08:00', allowedEndTime: '09:00' },
      now: new Date('2026-07-25T11:30:00.000Z'),
    });

    expect((await service.evaluateAutomationReadiness()).allowed).toBe(true);
  });

  it('avanca ate o primeiro minuto valido durante a transicao de horario de verao', async () => {
    const { service, history } = createSubject({
      config: {
        timezone: 'America/New_York',
        allowedStartTime: '02:30',
        allowedEndTime: '04:00',
      },
      now: new Date('2026-03-08T06:59:00.000Z'),
    });

    await expect(service.evaluateAutomationReadiness()).resolves.toMatchObject({
      reasons: ['OUTSIDE_ALLOWED_WINDOW'],
      nextAllowedAt: '2026-03-08T07:00:00.000Z',
    });
    expect(history.lastRange).toMatchObject({
      dayStartsAt: new Date('2026-03-08T05:00:00.000Z'),
      dayEndsAt: new Date('2026-03-09T04:00:00.000Z'),
    });
  });

  it('calcula janela e dia de 25 horas na transicao de volta do horario de verao', async () => {
    const { service, history } = createSubject({
      config: {
        timezone: 'America/New_York',
        allowedStartTime: '01:30',
        allowedEndTime: '02:30',
      },
      now: new Date('2026-11-01T05:00:00.000Z'),
    });

    await expect(service.evaluateAutomationReadiness()).resolves.toMatchObject({
      reasons: ['OUTSIDE_ALLOWED_WINDOW'],
      nextAllowedAt: '2026-11-01T05:30:00.000Z',
    });
    expect(history.lastRange).toMatchObject({
      dayStartsAt: new Date('2026-11-01T04:00:00.000Z'),
      dayEndsAt: new Date('2026-11-02T05:00:00.000Z'),
    });
  });

  it('bloqueia no limite global ate a proxima janela do dia seguinte', async () => {
    const { service, history } = createSubject();
    history.globalSentToday = 1;

    await expect(service.evaluateAutomationReadiness()).resolves.toMatchObject({
      reasons: ['GLOBAL_DAILY_LIMIT_REACHED'],
      globalRemainingToday: 0,
      nextAllowedAt: '2026-07-26T11:00:00.000Z',
    });
  });

  it('bloqueia no limite do grupo', async () => {
    const { service, history } = createSubject({
      config: { dailyGlobalLimit: 5 },
    });
    history.groupSentToday = 1;

    await expect(
      service.evaluateAutomationReadiness({ target: target() }),
    ).resolves.toMatchObject({
      reasons: ['GROUP_DAILY_LIMIT_REACHED'],
      groupRemainingToday: 0,
    });
  });

  it.each([
    { campaignLimit: 1, groupLimit: 3, sentToday: 1 },
    { campaignLimit: 3, groupLimit: 1, sentToday: 1 },
    { campaignLimit: 2, groupLimit: 2, sentToday: 2 },
  ])(
    'aplica a menor quota entre campanha ($campaignLimit) e grupo ($groupLimit)',
    async ({ campaignLimit, groupLimit, sentToday }) => {
      const { service, history } = createSubject({
        config: { dailyGlobalLimit: 10, dailyGroupLimit: groupLimit },
      });
      history.groupSentToday = sentToday;

      await expect(
        service.evaluateAutomationReadiness({
          target: target('group-1', campaignLimit),
        }),
      ).resolves.toMatchObject({
        allowed: false,
        reasons: ['GROUP_DAILY_LIMIT_REACHED'],
        groupRemainingToday: 0,
      });
    },
  );

  it('mantem a campanha dentro da quota efetiva quando o fallback e maior', async () => {
    const { service, history } = createSubject({
      config: { dailyGlobalLimit: 10, dailyGroupLimit: 5 },
    });
    history.groupSentToday = 1;

    await expect(
      service.evaluateAutomationReadiness({ target: target('group-1', 2) }),
    ).resolves.toMatchObject({ allowed: true, groupRemainingToday: 1 });
  });

  it.each([
    ['quota da campanha', target('group-1', 0), {}],
    ['quota global', target(), { dailyGlobalLimit: 0 }],
    ['fallback do grupo', target(), { dailyGroupLimit: 0 }],
  ] as const)(
    'bloqueia com zero em %s',
    async (_description, quotaTarget, config) => {
      const { service } = createSubject({ config });

      await expect(
        service.evaluateAutomationReadiness({ target: quotaTarget }),
      ).resolves.toMatchObject({ allowed: false });
    },
  );

  it.each([
    ['campanha negativa', target('group-1', -1), {}],
    ['campanha fracionaria', target('group-1', 1.5), {}],
    ['campanha nao numerica', target('group-1', Number.NaN), {}],
    ['global negativo', target(), { dailyGlobalLimit: -1 }],
    ['global nao finito', target(), { dailyGlobalLimit: Number.POSITIVE_INFINITY }],
    ['grupo negativo', target(), { dailyGroupLimit: -1 }],
    ['grupo fracionario', target(), { dailyGroupLimit: 1.5 }],
  ] as const)(
    'bloqueia quota invalida: %s',
    async (_description, quotaTarget, config) => {
      const { service } = createSubject({ config });

      await expect(
        service.evaluateAutomationReadiness({ target: quotaTarget }),
      ).resolves.toMatchObject({ allowed: false });
    },
  );

  it.each([
    { globalLimit: 1, groupSentToday: 0, globalSentToday: 1, allowed: false },
    { globalLimit: 3, groupSentToday: 0, globalSentToday: 1, allowed: true },
  ])(
    'mantem o teto global independente da quota efetiva do grupo',
    async ({ globalLimit, groupSentToday, globalSentToday, allowed }) => {
      const { service, history } = createSubject({
        config: { dailyGlobalLimit: globalLimit, dailyGroupLimit: 5 },
      });
      history.groupSentToday = groupSentToday;
      history.globalSentToday = globalSentToday;

      await expect(
        service.evaluateAutomationReadiness({ target: target('group-1', 2) }),
      ).resolves.toMatchObject({ allowed });
    },
  );

  it('mantem quota por campanha e grupo, sem usar capacidade de fila', async () => {
    const { service, history } = createSubject({
      config: { dailyGlobalLimit: 10, dailyGroupLimit: 5 },
      groups: [group('1'), group('2')],
    });
    history.groupSentTodayById.set('1', 2);
    history.groupSentTodayById.set('2', 0);
    const firstTarget = { ...target('1', 2), queueTargetSize: 1, protectedCount: 1 };
    const secondTarget = { ...target('2', 2), queueTargetSize: 0, protectedCount: 99 };

    await expect(
      service.evaluateAutomationReadiness({ target: firstTarget }),
    ).resolves.toMatchObject({
      allowed: false,
      reasons: ['GROUP_DAILY_LIMIT_REACHED'],
    });
    await expect(
      service.evaluateAutomationReadiness({ target: secondTarget }),
    ).resolves.toMatchObject({ allowed: true, groupRemainingToday: 2 });
  });

  it('calcula o intervalo minimo desde o ultimo SENT', async () => {
    const { service, history } = createSubject();
    const lastSentAt = new Date('2026-07-25T14:30:00.000Z');
    history.lastSentAt = lastSentAt;
    history.groupLastSentAtById.set('group-1', lastSentAt);

    await expect(
      service.evaluateAutomationReadiness({ target: target() }),
    ).resolves.toMatchObject({
      reasons: ['MINIMUM_INTERVAL_NOT_REACHED'],
      lastSentAt: '2026-07-25T14:30:00.000Z',
      groupLastSentAt: '2026-07-25T14:30:00.000Z',
      nextAllowedAt: '2026-07-25T15:30:00.000Z',
    });
  });

  it('nao aplica o ultimo envio global a um alvo nunca enviado', async () => {
    const { service, history } = createSubject({
      groups: [group('1'), group('2')],
    });
    history.lastSentAt = new Date('2026-07-25T14:59:00.000Z');

    await expect(
      service.evaluateAutomationReadiness({ target: target('2') }),
    ).resolves.toMatchObject({
      allowed: true,
      reasons: [],
      groupLastSentAt: null,
      lastSentAt: '2026-07-25T14:59:00.000Z',
    });
  });

  it('bloqueia quando nao existe grupo autorizado', async () => {
    const { service } = createSubject({ groups: [] });

    await expect(service.evaluateAutomationReadiness()).resolves.toMatchObject({
      reasons: ['NO_AUTHORIZED_GROUP'],
      authorizedGroupCount: 0,
      nextAllowedAt: null,
    });
  });

  it('nao autoriza grupo com fingerprint invalido', async () => {
    const invalidGroup = { ...group(), fingerprint: 'grp_invalido' };
    const { service } = createSubject({ groups: [invalidGroup] });

    await expect(service.evaluateAutomationReadiness()).resolves.toMatchObject({
      reasons: ['NO_AUTHORIZED_GROUP'],
      authorizedGroupCount: 0,
    });
  });

  it('permite status global quando existem multiplos grupos distintos', async () => {
    const { service } = createSubject({ groups: [group('1'), group('2')] });

    await expect(service.evaluateAutomationReadiness()).resolves.toMatchObject({
      reasons: [],
      allowed: true,
      authorizedGroupCount: 2,
    });
  });

  it('nao aplica cooldown de um grupo ao proximo alvo permitido', async () => {
    const { service, history } = createSubject({
      groups: [group('1'), group('2')],
    });
    history.groupLastSentAtById.set(
      '1',
      new Date('2026-07-25T14:30:00.000Z'),
    );

    await expect(
      service.evaluateAutomationReadiness({ target: target('2') }),
    ).resolves.toMatchObject({ allowed: true, reasons: [] });
  });

  it('nao aplica limite diario de um grupo ao proximo alvo permitido', async () => {
    const { service, history } = createSubject({
      config: { dailyGlobalLimit: 5 },
      groups: [group('1'), group('2')],
    });
    history.groupSentTodayById.set('1', 1);
    history.groupSentTodayById.set('2', 0);

    await expect(
      service.evaluateAutomationReadiness({ target: target('2') }),
    ).resolves.toMatchObject({ allowed: true, reasons: [] });
  });

  it('bloqueia destinos fisicos com a mesma fingerprint logica', async () => {
    const { service } = createSubject({
      groups: [group('1'), { ...group('2'), fingerprint: group('1').fingerprint }],
    });

    await expect(service.evaluateAutomationReadiness()).resolves.toMatchObject({
      allowed: false,
      reasons: ['COMMERCIAL_AUTOMATION_DUPLICATE_LOGICAL_GROUP'],
    });
  });

  it('bloqueia enquanto existir execucao comercial ambigua', async () => {
    const { service, history } = createSubject();
    history.ambiguous = true;

    await expect(service.evaluateAutomationReadiness()).resolves.toMatchObject({
      reasons: ['AMBIGUOUS_COMMERCIAL_RUN_EXISTS'],
      nextAllowedAt: null,
    });
  });

  it('permite excluir somente o proprio run ambiguo por id explicito', async () => {
    const { service, history } = createSubject();
    history.ambiguousRunIds.add('run-recovery');

    await expect(
      service.evaluateAutomationReadiness({ excludedAmbiguousRunId: 'run-recovery' }),
    ).resolves.toMatchObject({ allowed: true, reasons: [] });
  });

  it('outro run ambiguo continua bloqueando mesmo com exclusao explicita', async () => {
    const { service, history } = createSubject();
    history.ambiguousRunIds.add('run-recovery');
    history.ambiguousRunIds.add('run-other');

    await expect(
      service.evaluateAutomationReadiness({ excludedAmbiguousRunId: 'run-recovery' }),
    ).resolves.toMatchObject({
      allowed: false,
      reasons: ['AMBIGUOUS_COMMERCIAL_RUN_EXISTS'],
    });
  });

  it('mantem comportamento fail-closed quando nenhuma exclusao de run e informada', async () => {
    const { service, history } = createSubject();
    history.ambiguousRunIds.add('run-recovery');

    await expect(service.evaluateAutomationReadiness()).resolves.toMatchObject({
      allowed: false,
      reasons: ['AMBIGUOUS_COMMERCIAL_RUN_EXISTS'],
    });
  });

  it('o proprio run excluido nao se auto-bloqueia como in progress', async () => {
    const { service, history } = createSubject();
    history.activeRunIds.add('run-recovery');

    await expect(
      service.evaluateAutomationReadiness({
        excludedExecutionId: 'execution-recovery',
        excludedAmbiguousRunId: 'run-recovery',
      }),
    ).resolves.toMatchObject({ allowed: true, reasons: [] });
  });

  it('outro run ativo continua bloqueando mesmo ao excluir o run recuperado', async () => {
    const { service, history } = createSubject();
    history.activeRunIds.add('run-recovery');
    history.activeRunIds.add('run-other');

    await expect(
      service.evaluateAutomationReadiness({
        excludedExecutionId: 'execution-recovery',
        excludedAmbiguousRunId: 'run-recovery',
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reasons: ['COMMERCIAL_EXECUTION_IN_PROGRESS'],
    });
  });

  it('bloqueia enquanto existir execucao comercial em andamento', async () => {
    const { service, history } = createSubject();
    history.active = true;

    await expect(service.evaluateAutomationReadiness()).resolves.toMatchObject({
      reasons: ['COMMERCIAL_EXECUTION_IN_PROGRESS'],
      nextAllowedAt: null,
    });
  });

  it('separa execucao stale de execucao ativa', async () => {
    const { service, history } = createSubject();
    history.stale = true;

    await expect(service.evaluateAutomationReadiness()).resolves.toMatchObject({
      reasons: ['STALE_COMMERCIAL_EXECUTION_EXISTS'],
      nextAllowedAt: null,
    });
  });
});
