import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CommercialAutomationExecutionPage,
  CommercialAutomationSchedulerStatus,
  CommercialAutomationStatus,
  CommercialDispatchOutboxPage,
  HealthResponse,
  OperationalAdmin,
  WhatsAppDispatch,
} from '../../lib/api';
import { click, render } from '../../test/render';
import DiagnosticsPage from './page';

const {
  getHealthMock,
  getAutomationStatusMock,
  getSchedulerMock,
  getOperationalAdminMock,
  listExecutionsMock,
  listOutboxMock,
  listDispatchesMock,
} = vi.hoisted(() => ({
  getHealthMock: vi.fn(),
  getAutomationStatusMock: vi.fn(),
  getSchedulerMock: vi.fn(),
  getOperationalAdminMock: vi.fn(),
  listExecutionsMock: vi.fn(),
  listOutboxMock: vi.fn(),
  listDispatchesMock: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  getHealth: (...args: unknown[]) => getHealthMock(...args),
  getCommercialAutomationStatus: (...args: unknown[]) =>
    getAutomationStatusMock(...args),
  getCommercialAutomationSchedulerStatus: (...args: unknown[]) =>
    getSchedulerMock(...args),
  getOperationalAdmin: (...args: unknown[]) => getOperationalAdminMock(...args),
  listCommercialAutomationExecutions: (...args: unknown[]) =>
    listExecutionsMock(...args),
  listCommercialDispatchOutbox: (...args: unknown[]) => listOutboxMock(...args),
  listDispatches: (...args: unknown[]) => listDispatchesMock(...args),
}));

const automation: CommercialAutomationStatus = {
  enabled: true,
  allowed: false,
  reasons: ['AUTOMATION_PAUSED'],
  nextAllowedAt: null,
  globalSentToday: 2,
  globalRemainingToday: 58,
  groupSentToday: 1,
  groupRemainingToday: 59,
  lastSentAt: '2026-08-31T12:00:00.000Z',
  paused: true,
  pausedAt: '2026-08-31T11:00:00.000Z',
  resumedAt: null,
  updatedAt: '2026-08-31T12:00:00.000Z',
  allowedStartTime: '07:00',
  allowedEndTime: '22:00',
  timezone: 'America/Sao_Paulo',
  dailyGlobalLimit: 60,
  dailyGroupLimit: 60,
  minimumIntervalMinutes: 10,
  authorizedGroupCount: 1,
};

const scheduler: CommercialAutomationSchedulerStatus = {
  enabled: true,
  status: 'registered',
  jobId: 'scheduler-job-1',
  queue: 'commercial-automation',
  jobName: 'commercial-automation-tick',
  cron: '*/10 * * * *',
  timezone: 'America/Sao_Paulo',
  nextRunAt: '2026-08-31T12:10:00.000Z',
  mode: 'send',
};

const operational: OperationalAdmin = {
  generatedAt: '2026-08-31T12:00:00.000Z',
  automation: {
    paused: true,
    allowedStartTime: '07:00',
    allowedEndTime: '22:00',
    timezone: 'America/Sao_Paulo',
    minimumIntervalMinutes: 10,
    staggerMinutes: 2,
    dailyGlobalLimit: 60,
    dailyGroupLimit: 60,
    dailyGlobalLimitOverride: null,
    dailyGroupLimitOverride: null,
    dailyShopeeHttpLimit: 8,
    dailyOpenAiGenerationLimit: 8,
    dailyShopeeHttpLimitOverride: null,
    dailyOpenAiGenerationLimitOverride: null,
    providerUsage: {
      dayKey: '2026-08-31',
      shopee: { used: 1, limit: 8, reached: false },
      openAi: { used: 2, limit: 8, reached: false },
    },
    hardCaps: {
      maxMessagesPerRun: 1,
    },
    scheduleRevision: 7,
    updatedAt: '2026-08-31T12:00:00.000Z',
  },
  nextSendAt: null,
  lastSendAt: '2026-08-31T12:00:00.000Z',
  blockers: [
    {
      scope: 'GLOBAL',
      code: 'AUTOMATION_PAUSED',
      entityId: null,
      message: 'Automação pausada',
    },
  ],
  queues: {
    productPipeline: { waiting: 1, active: 0, delayed: 2, prioritized: 0 },
    whatsappDispatch: { waiting: 0, active: 1, delayed: 0, prioritized: 0 },
    commercialAutomation: { waiting: 3, active: 0, delayed: 1, prioritized: 0 },
  },
  activeExecutions: 0,
  activeReservations: 0,
  ambiguity: 0,
  investigationRequired: 0,
  pendingDispatches: 1,
  pendingOutboxes: 1,
  scheduler,
  instances: [
    {
      name: 'afiliado-shopee-local',
      active: true,
      paused: false,
      health: 'UNKNOWN',
      assignedGroupCount: 1,
      lastSendAt: null,
      nextSendAt: null,
      blockers: [],
      updatedAt: '2026-08-31T12:00:00.000Z',
    },
  ],
  groups: [
    {
      id: 'group-1',
      name: 'Grupo Casa',
      active: true,
      paused: false,
      available: true,
      fingerprint: 'fingerprint-1',
      sourceInstanceName: 'afiliado-shopee-local',
      assignedInstanceName: 'afiliado-shopee-local',
      campaign: { id: 'campaign-1', name: 'Casa', active: true },
      niche: { id: 'niche-1', name: 'Casa', active: true },
      lastSendAt: null,
      nextSendAt: null,
      blockers: [],
      memberCount: null,
      ownerIsParticipant: null,
      discoveredAt: null,
      lastSyncedAt: null,
      updatedAt: '2026-08-31T12:00:00.000Z',
    },
  ],
  campaigns: [],
};

const executionPage: CommercialAutomationExecutionPage = {
  items: [
    {
      id: 'execution-1',
      schedulerJobId: 'scheduler-job-1',
      bullMqJobId: 'bull-job-1',
      mode: 'send',
      status: 'COMPLETED',
      reasons: [],
      commercialRunId: 'run-1',
      failureCode: null,
      stale: false,
      heartbeatAt: null,
      leaseExpiresAt: null,
      startedAt: '2026-08-31T11:59:00.000Z',
      completedAt: '2026-08-31T12:00:00.000Z',
    },
  ],
  page: 1,
  limit: 20,
  total: 1,
  totalPages: 1,
};

const outboxPage: CommercialDispatchOutboxPage = {
  items: [
    {
      id: 'outbox-1',
      commercialRunId: 'run-1',
      dispatchId: 'dispatch-1',
      jobId: 'dispatch-job-1',
      status: 'published',
      failureCode: null,
      createdAt: '2026-08-31T11:59:30.000Z',
      publishedAt: '2026-08-31T11:59:31.000Z',
    },
  ],
  page: 1,
  limit: 20,
  total: 1,
  totalPages: 1,
};

const dispatch: WhatsAppDispatch = {
  id: 'dispatch-1',
  productId: 'product-1',
  generatedCopyId: 'copy-1',
  destinationId: 'group-1',
  externalMessageId: 'external-1',
  status: 'SENT',
  attemptCount: 1,
  deliveryMode: 'IMAGE',
  provider: 'evolution',
  errorMessage: null,
  sentAt: '2026-08-31T12:00:00.000Z',
  createdAt: '2026-08-31T11:59:30.000Z',
  updatedAt: '2026-08-31T12:00:00.000Z',
  destination: {
    id: 'group-1',
    name: 'Grupo Casa',
    destination: 'private-value',
  },
  product: null,
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const renderLoaded = async () => {
  const screen = await render(<DiagnosticsPage />);
  await flush();
  return screen;
};

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  getHealthMock.mockResolvedValue({
    status: 'ok',
    service: 'api',
  } satisfies HealthResponse);
  getAutomationStatusMock.mockResolvedValue(automation);
  getSchedulerMock.mockResolvedValue(scheduler);
  getOperationalAdminMock.mockResolvedValue(operational);
  listExecutionsMock.mockResolvedValue(executionPage);
  listOutboxMock.mockResolvedValue(outboxPage);
  listDispatchesMock.mockResolvedValue([dispatch]);
});

describe('DiagnosticsPage — Lote 9', () => {
  it('apresenta as seções técnicas em modo somente leitura e usa limites conservadores', async () => {
    const screen = await renderLoaded();
    const text = screen.container.textContent ?? '';

    expect(screen.container.querySelector('h1')?.textContent).toBe(
      'Diagnóstico avançado',
    );
    expect(text).toContain('Esta área é somente leitura.');
    expect(text).toContain('Visão técnica');
    expect(text).toContain('Automação');
    expect(text).toContain('Execuções');
    expect(text).toContain('Fila e outbox');
    expect(text).toContain('Envios técnicos');
    expect(text).toContain('WhatsApp');
    expect(text).toContain('Ferramentas técnicas');
    expect(text).toContain('execution-1');
    expect(text).toContain('outbox-1');
    expect(text).toContain('dispatch-1');
    expect(text).toContain('fingerprint-1');
    expect(listExecutionsMock).toHaveBeenCalledWith(1, 20);
    expect(listOutboxMock).toHaveBeenCalledWith(1, 20);
    expect(listDispatchesMock).toHaveBeenCalledWith();
    await screen.unmount();
  });

  it('renderiza apenas campos allowlisted mesmo quando respostas trazem campos sensíveis extras', async () => {
    const marker = 'TEST_SECRET_MUST_NEVER_APPEAR';
    getHealthMock.mockResolvedValueOnce(
      Object.assign(
        { status: 'ok', service: 'api' },
        {
          Authorization: marker,
          DATABASE_URL: marker,
        },
      ),
    );
    getOperationalAdminMock.mockResolvedValueOnce(
      Object.assign({}, operational, {
        LOCAL_API_AUTH_TOKEN: marker,
        headers: { Authorization: `Bearer ${marker}` },
      }),
    );
    listOutboxMock.mockResolvedValueOnce(
      Object.assign({}, outboxPage, {
        headers: { Authorization: marker },
        payload: marker,
      }),
    );

    const screen = await renderLoaded();
    const text = screen.container.textContent ?? '';

    expect(text).not.toContain(marker);
    for (const forbidden of [
      'Authorization',
      'Bearer',
      'LOCAL_API_AUTH_TOKEN',
      'EVOLUTION_API_KEY',
      'OPENAI_API_KEY',
      'DATABASE_URL',
      'REDIS_URL',
      'password',
      'cookie',
    ]) {
      expect(text).not.toContain(forbidden);
    }
    await screen.unmount();
  });

  it('mantém o restante da tela quando o outbox falha e não expõe o erro interno', async () => {
    listOutboxMock.mockRejectedValueOnce(new Error('private outbox failure'));
    const screen = await renderLoaded();
    const text = screen.container.textContent ?? '';

    expect(text).toContain('Outbox indisponível');
    expect(text).toContain('Execuções');
    expect(text).toContain('execution-1');
    expect(text).toContain('Envios técnicos');
    expect(text).not.toContain('private outbox failure');
    await screen.unmount();
  });

  it('não converte uma falha de fila em contagens zero', async () => {
    getOperationalAdminMock.mockRejectedValueOnce(
      new Error('queue unavailable'),
    );
    const screen = await renderLoaded();
    const text = screen.container.textContent ?? '';

    expect(text).toContain('Dados de fila indisponíveis');
    expect(text).not.toContain('Pipeline de ofertas');
    expect(text).not.toContain('queue unavailable');
    await screen.unmount();
  });

  it('destaca PROCESSING e AMBIGUOUS sem oferecer retry, requeue ou recuperação', async () => {
    listExecutionsMock.mockResolvedValueOnce({
      ...executionPage,
      items: [{ ...executionPage.items[0], status: 'PROCESSING' }],
    });
    listOutboxMock.mockResolvedValueOnce({
      ...outboxPage,
      items: [{ ...outboxPage.items[0], status: 'ambiguous' }],
    });
    listDispatchesMock.mockResolvedValueOnce([
      { ...dispatch, status: 'PROCESSING' },
    ]);

    const screen = await renderLoaded();
    const text = screen.container.textContent ?? '';

    expect(text).toContain('PROCESSING');
    expect(text).toContain('AMBIGUOUS');
    expect(text).toContain('Resultado potencialmente incerto');
    expect(text).toContain('Exige investigação manual');
    for (const forbidden of [
      'Retry',
      'Requeue',
      'Reenviar',
      'Publicar',
      'Recuperar',
    ]) {
      expect(text).not.toContain(forbidden);
    }
    await screen.unmount();
  });

  it('distingue vazio de indisponibilidade e oferece apenas refresh manual', async () => {
    vi.useFakeTimers();
    const intervalSpy = vi.spyOn(window, 'setInterval');
    listExecutionsMock.mockResolvedValueOnce({
      ...executionPage,
      items: [],
      total: 0,
    });
    listOutboxMock.mockResolvedValueOnce({
      ...outboxPage,
      items: [],
      total: 0,
    });
    listDispatchesMock.mockResolvedValueOnce([]);

    const screen = await renderLoaded();
    const text = screen.container.textContent ?? '';
    expect(text).toContain('Nenhuma execução encontrada');
    expect(text).toContain('Nenhum registro de outbox');
    expect(text).toContain('Nenhum envio técnico');
    expect(intervalSpy).not.toHaveBeenCalled();

    const refresh = Array.from(
      screen.container.querySelectorAll('button'),
    ).find((button) => button.textContent?.includes('Atualizar'));
    await click(refresh!);
    await flush();
    expect(getHealthMock).toHaveBeenCalledTimes(2);
    expect(listExecutionsMock).toHaveBeenCalledTimes(2);
    expect(listOutboxMock).toHaveBeenCalledTimes(2);
    expect(listDispatchesMock).toHaveBeenCalledTimes(2);
    await screen.unmount();
  });
});
