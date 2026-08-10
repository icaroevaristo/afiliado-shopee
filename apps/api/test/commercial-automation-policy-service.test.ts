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

const target = (id = 'group-1'): CommercialAutomationTarget => ({
  groupId: id,
  groupName: `Grupo ${id}`,
  logicalGroupFingerprint: id.endsWith('2')
    ? 'grp_bbbbbbbbbbbb'
    : 'grp_aaaaaaaaaaaa',
  campaignId: `campaign-${id}`,
  nicheId: `niche-${id}`,
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
  active = false;
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

  async hasAmbiguousCommercialExecution() {
    return this.ambiguous;
  }

  async hasActiveCommercialExecution() {
    return this.active;
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
