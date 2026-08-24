import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import { buildAuthenticatedTestApp } from './authenticated-test-app';
import type { CommercialAutomationStatus } from '../src/commercial-automation-policy-service';

const status: CommercialAutomationStatus = {
  enabled: false,
  allowed: false,
  reasons: ['AUTOMATION_DISABLED', 'AUTOMATION_PAUSED'],
  nextAllowedAt: null,
  globalSentToday: 0,
  globalRemainingToday: 1,
  groupSentToday: 0,
  groupRemainingToday: 1,
  lastSentAt: null,
  paused: true,
  pausedAt: '2026-07-25T15:00:00.000Z',
  resumedAt: null,
  updatedAt: '2026-07-25T15:00:00.000Z',
  allowedStartTime: '08:00',
  allowedEndTime: '20:00',
  timezone: 'America/Sao_Paulo',
  dailyGlobalLimit: 1,
  dailyGroupLimit: 1,
  minimumIntervalMinutes: 60,
  authorizedGroupCount: 0,
};

const schedule = {
  timezone: 'America/Sao_Paulo',
  allowedStartTime: '08:00',
  allowedEndTime: '20:00',
  minimumIntervalMinutes: 60,
  staggerMinutes: 0,
  scheduleRevision: 0,
};

const schedulePreview = {
  slots: [
    {
      slotKey: 'slot-preview-1',
      jobId: 'commercial-target-slot-preview-1',
      scheduledFor: new Date('2026-08-24T12:00:00.000Z'),
      delayMs: 0,
      target: {
        campaignId: 'campaign-1',
        groupId: 'group-1',
        logicalGroupFingerprint: 'fingerprint-1',
        instanceName: 'instance-1',
        scheduledFor: '2026-08-24T12:00:00.000Z',
        slotKey: 'slot-preview-1',
        scheduleRevision: 0,
      },
    },
  ],
  skippedTargets: [],
};

const apps: Array<Awaited<ReturnType<typeof buildAuthenticatedTestApp>>> = [];

const createApp = async () => {
  const evaluateAutomationReadiness = vi.fn().mockResolvedValue(status);
  const setPaused = vi.fn().mockResolvedValue(status);
  const getScheduleSettings = vi.fn().mockResolvedValue(schedule);
  const updateScheduleSettings = vi.fn().mockResolvedValue({
    ...schedule,
    minimumIntervalMinutes: 14,
    scheduleRevision: 1,
  });
  const preview = vi.fn().mockResolvedValue(schedulePreview);
  const pipelineAdd = vi.fn();
  const dispatchAdd = vi.fn();
  const app = await buildAuthenticatedTestApp({
    logger: false,
    prisma: {} as never,
    commercialAutomationPolicyService: {
      evaluateAutomationReadiness,
      setPaused,
      getScheduleSettings,
      updateScheduleSettings,
    },
    commercialAutomationSchedulePlanner: { preview },
    pipelineQueue: { add: pipelineAdd },
    whatsappDispatchQueue: {
      add: dispatchAdd,
      getJob: vi.fn(),
    },
  });
  apps.push(app);
  return {
    app,
    evaluateAutomationReadiness,
    setPaused,
    getScheduleSettings,
    updateScheduleSettings,
    preview,
    pipelineAdd,
    dispatchAdd,
  };
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('commercial automation routes', () => {
  it('retorna status sanitizado sem criar fila, dispatch ou mensagem', async () => {
    const subject = await createApp();

    const response = await subject.app.inject({
      method: 'GET',
      url: '/commercial-automation/status',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(status);
    expect(subject.evaluateAutomationReadiness).toHaveBeenCalledOnce();
    expect(subject.pipelineAdd).not.toHaveBeenCalled();
    expect(subject.dispatchAdd).not.toHaveBeenCalled();
    expect(JSON.stringify(response.json())).not.toMatch(
      /destination|externalMessageId|apiKey|redis/iu,
    );
  });

  it('pausa sem exigir confirmacao', async () => {
    const subject = await createApp();

    const response = await subject.app.inject({
      method: 'PATCH',
      url: '/commercial-automation/settings',
      payload: { paused: true },
    });

    expect(response.statusCode).toBe(200);
    expect(subject.setPaused).toHaveBeenCalledWith({
      paused: true,
      confirmation: undefined,
    });
  });

  it('consulta e atualiza somente a agenda persistida', async () => {
    const subject = await createApp();

    const getResponse = await subject.app.inject({
      method: 'GET',
      url: '/commercial-automation/settings',
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toEqual(schedule);

    const patchResponse = await subject.app.inject({
      method: 'PATCH',
      url: '/commercial-automation/settings/schedule',
      payload: {
        minimumIntervalMinutes: 14,
        staggerMinutes: 5,
        expectedRevision: 0,
      },
    });
    expect(patchResponse.statusCode).toBe(200);
    expect(subject.updateScheduleSettings).toHaveBeenCalledWith({
      minimumIntervalMinutes: 14,
      staggerMinutes: 5,
      expectedRevision: 0,
    });
  });

  it('consulta a previa da agenda sem criar trabalho', async () => {
    const subject = await createApp();

    const response = await subject.app.inject({
      method: 'GET',
      url: '/commercial-automation/schedule/preview',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      scheduleRevision: 0,
      plannedSlots: 1,
      skippedTargets: [],
      nextSlot: {
        slotKey: 'slot-preview-1',
        jobId: 'commercial-target-slot-preview-1',
        scheduledFor: '2026-08-24T12:00:00.000Z',
        campaignId: 'campaign-1',
        groupId: 'group-1',
        logicalGroupFingerprint: 'fingerprint-1',
        instanceName: 'instance-1',
      },
    });
    expect(subject.preview).toHaveBeenCalledOnce();
    expect(subject.pipelineAdd).not.toHaveBeenCalled();
    expect(subject.dispatchAdd).not.toHaveBeenCalled();
  });

  it('rejeita campos que nao pertencem ao contrato da agenda', async () => {
    const subject = await createApp();
    const response = await subject.app.inject({
      method: 'PATCH',
      url: '/commercial-automation/settings/schedule',
      payload: { dailyGlobalLimit: 999 },
    });
    expect(response.statusCode).toBe(400);
    expect(subject.updateScheduleSettings).not.toHaveBeenCalled();
  });

  it('retoma somente com a confirmacao exata', async () => {
    const subject = await createApp();

    const response = await subject.app.inject({
      method: 'PATCH',
      url: '/commercial-automation/settings',
      payload: {
        paused: false,
        confirmation: 'RETOMAR_AUTOMACAO_COMERCIAL',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(subject.setPaused).toHaveBeenCalledWith({
      paused: false,
      confirmation: 'RETOMAR_AUTOMACAO_COMERCIAL',
    });
  });

  it.each([
    {},
    { paused: false },
    { paused: true, confirmation: 'RETOMAR_AUTOMACAO_COMERCIAL' },
    { paused: true, extra: true },
    { paused: 'true' },
  ])('rejeita payload invalido ou campos adicionais: %j', async (payload) => {
    const subject = await createApp();

    const response = await subject.app.inject({
      method: 'PATCH',
      url: '/commercial-automation/settings',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'INVALID_COMMERCIAL_AUTOMATION_SETTINGS',
    });
    expect(subject.setPaused).not.toHaveBeenCalled();
  });

  it('propaga rejeicao da confirmacao incorreta sem detalhes internos', async () => {
    const subject = await createApp();
    subject.setPaused.mockRejectedValueOnce(
      new AppError(
        'Confirmacao explicita obrigatoria',
        'COMMERCIAL_AUTOMATION_RESUME_CONFIRMATION_REQUIRED',
      ),
    );

    const response = await subject.app.inject({
      method: 'PATCH',
      url: '/commercial-automation/settings',
      payload: { paused: false, confirmation: 'INCORRETA' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'COMMERCIAL_AUTOMATION_RESUME_CONFIRMATION_REQUIRED',
      message: 'Confirmacao explicita obrigatoria',
    });
  });
});
