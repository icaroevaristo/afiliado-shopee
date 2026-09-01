import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render } from '../test/render';
import OverviewPage from './page';

const getHealthMock = vi.fn();
const getAutomationStatusMock = vi.fn();
const getAutomationSchedulerMock = vi.fn();
const getOperationalAdminMock = vi.fn();
const listExecutionsMock = vi.fn();
const listDispatchesMock = vi.fn();

vi.mock('../lib/api', () => ({
  getHealth: (...args: unknown[]) => getHealthMock(...args),
  getCommercialAutomationStatus: (...args: unknown[]) => getAutomationStatusMock(...args),
  getCommercialAutomationSchedulerStatus: (...args: unknown[]) => getAutomationSchedulerMock(...args),
  getOperationalAdmin: (...args: unknown[]) => getOperationalAdminMock(...args),
  listCommercialAutomationExecutions: (...args: unknown[]) => listExecutionsMock(...args),
  listDispatches: (...args: unknown[]) => listDispatchesMock(...args),
}));

const automationStatus = {
  enabled: true,
  allowed: true,
  reasons: [],
  nextAllowedAt: null,
  globalSentToday: 2,
  globalRemainingToday: 58,
  groupSentToday: 1,
  groupRemainingToday: 59,
  lastSentAt: '2026-08-09T18:30:00.000Z',
  paused: false,
  pausedAt: null,
  resumedAt: '2026-08-09T18:00:00.000Z',
  updatedAt: '2026-08-09T18:30:00.000Z',
  allowedStartTime: '08:00',
  allowedEndTime: '22:00',
  timezone: 'America/Sao_Paulo',
  dailyGlobalLimit: 60,
  dailyGroupLimit: 60,
  minimumIntervalMinutes: 10,
  authorizedGroupCount: 2,
};

const scheduler = {
  enabled: true,
  status: 'registered' as const,
  jobId: 'scheduled-commercial-automation',
  queue: 'commercial-automation',
  jobName: 'commercial-automation-tick',
  cron: '*/10 * * * *',
  timezone: 'America/Sao_Paulo',
  nextRunAt: '2026-08-09T22:40:00.000Z',
  mode: 'send' as const,
};

const operationalAdmin = {
  generatedAt: '2026-08-09T18:30:00.000Z',
  automation: {
    paused: false,
    allowedStartTime: '08:00',
    allowedEndTime: '22:00',
    timezone: 'America/Sao_Paulo',
    minimumIntervalMinutes: 10,
    staggerMinutes: 2,
    dailyGlobalLimit: 60,
    dailyGroupLimit: 60,
    dailyGlobalLimitOverride: null,
    dailyGroupLimitOverride: null,
    dailyShopeeHttpLimit: 60,
    dailyOpenAiGenerationLimit: 60,
    dailyShopeeHttpLimitOverride: null,
    dailyOpenAiGenerationLimitOverride: null,
    providerUsage: {
      dayKey: '2026-08-09',
      shopee: { used: 2, limit: 60, reached: false },
      openAi: { used: 1, limit: 60, reached: false },
    },
    hardCaps: { dailyGlobalLimit: 60, dailyGroupLimit: 60, maxMessagesPerRun: 1 },
    scheduleRevision: 4,
    updatedAt: '2026-08-09T18:30:00.000Z',
  },
  nextSendAt: '2026-08-09T22:42:00.000Z',
  lastSendAt: '2026-08-09T18:30:00.000Z',
  blockers: [],
  queues: {
    productPipeline: { waiting: 0, active: 0, delayed: 0, prioritized: 0 },
    whatsappDispatch: { waiting: 0, active: 0, delayed: 0, prioritized: 0 },
    commercialAutomation: { waiting: 0, active: 0, delayed: 0, prioritized: 0 },
  },
  activeExecutions: 0,
  activeReservations: 0,
  ambiguity: 0,
  investigationRequired: 0,
  pendingDispatches: 0,
  pendingOutboxes: 0,
  scheduler,
  instances: [
    { name: 'afiliado-shopee-local', active: true, paused: false, health: 'UNKNOWN' as const, assignedGroupCount: 1, lastSendAt: null, nextSendAt: null, blockers: [], updatedAt: '2026-08-09T18:30:00.000Z' },
    { name: 'afiliado-shopee-secondary', active: true, paused: false, health: 'UNKNOWN' as const, assignedGroupCount: 1, lastSendAt: null, nextSendAt: null, blockers: [], updatedAt: '2026-08-09T18:30:00.000Z' },
  ],
  groups: [
    { id: 'group-1', name: 'Casa e cozinha', active: true, paused: false, available: true, fingerprint: null, sourceInstanceName: 'afiliado-shopee-local', assignedInstanceName: 'afiliado-shopee-local', campaign: { id: 'campaign-1', name: 'Casa', active: true }, niche: null, lastSendAt: null, nextSendAt: null, blockers: [], memberCount: null, ownerIsParticipant: null, discoveredAt: null, lastSyncedAt: null, updatedAt: null },
    { id: 'group-2', name: 'Achadinhos', active: false, paused: false, available: false, fingerprint: null, sourceInstanceName: 'afiliado-shopee-secondary', assignedInstanceName: 'afiliado-shopee-secondary', campaign: null, niche: null, lastSendAt: null, nextSendAt: null, blockers: [], memberCount: null, ownerIsParticipant: null, discoveredAt: null, lastSyncedAt: null, updatedAt: null },
  ],
  campaigns: [],
};

const dispatch = {
  id: 'dispatch-internal-1',
  productId: 'product-internal-1',
  generatedCopyId: 'copy-internal-1',
  destinationId: 'group-1',
  status: 'SENT' as const,
  attemptCount: 1,
  deliveryMode: 'IMAGE' as const,
  sentAt: '2026-08-09T18:30:08.000Z',
  createdAt: '2026-08-09T18:30:00.000Z',
  destination: { id: 'group-internal-1', name: 'Casa e cozinha', destination: 'masked' },
  product: { id: 'product-internal-1', nome: 'Tapioqueira Peneira Polvilhador', preco: 39.9, urlImagem: 'https://example.invalid/image.jpg' },
  generatedCopy: {
    id: 'copy-internal-1',
    productId: 'product-internal-1',
    titulo: 'Oferta prática para a cozinha',
    mensagem: 'Uma mensagem comercial de teste.',
    cta: 'Confira',
    hashtags: '#casa',
    createdFromCandidateId: 'candidate-internal-1',
  },
};

const execution = {
  id: 'execution-internal-1',
  schedulerJobId: 'scheduler-internal-1',
  bullMqJobId: null,
  mode: 'send' as const,
  status: 'COMPLETED',
  reasons: [],
  commercialRunId: null,
  failureCode: null,
  stale: false,
  heartbeatAt: null,
  leaseExpiresAt: null,
  startedAt: '2026-08-09T18:29:00.000Z',
  completedAt: '2026-08-09T18:30:08.000Z',
};

const executionPage = { items: [execution], page: 1, limit: 10, total: 1, totalPages: 1 };
const emptyExecutionPage = { items: [], page: 1, limit: 10, total: 0, totalPages: 1 };

const flush = async () => {
  await act(async () => undefined);
};

function configureSuccessfulReads() {
  getHealthMock.mockResolvedValue({ status: 'ok', service: 'api' });
  getAutomationStatusMock.mockResolvedValue(automationStatus);
  getAutomationSchedulerMock.mockResolvedValue(scheduler);
  getOperationalAdminMock.mockResolvedValue(operationalAdmin);
  listExecutionsMock.mockResolvedValue(executionPage);
  listDispatchesMock.mockResolvedValue([dispatch]);
}

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  configureSuccessfulReads();
});

describe('OverviewPage', () => {
  it('mostra loading enquanto a leitura paralela está pendente', async () => {
    const pending = new Promise<never>(() => undefined);
    getHealthMock.mockReturnValue(pending);
    getAutomationStatusMock.mockReturnValue(pending);
    getAutomationSchedulerMock.mockReturnValue(pending);
    getOperationalAdminMock.mockReturnValue(pending);
    listExecutionsMock.mockReturnValue(pending);
    listDispatchesMock.mockReturnValue(pending);

    const screen = await render(<OverviewPage />);
    expect(screen.container.textContent).toContain('Carregando sua visão diária');
    await screen.unmount();
  });

  it('mostra a visão diária completa sem IDs ou rótulos técnicos', async () => {
    const screen = await render(<OverviewPage />);
    await flush();

    expect(screen.container.textContent).toContain('Início');
    expect(screen.container.textContent).toContain('Automação ligada');
    expect(screen.container.textContent).toContain('2 de 60');
    expect(screen.container.textContent).toContain('08:00–22:00');
    expect(screen.container.textContent).toContain('Grupos em operação');
    expect(screen.container.textContent).toContain('Instâncias ativas');
    expect(screen.container.textContent).toContain('Último envio');
    expect(screen.container.textContent).toContain('Enviado');
    expect(screen.container.textContent).toContain('Tudo certo por aqui.');
    expect(screen.container.textContent).toContain('Tapioqueira Peneira Polvilhador');
    expect(screen.container.textContent).not.toContain('dispatch-internal-1');
    expect(screen.container.textContent).not.toContain('candidate-internal-1');
    expect(screen.container.textContent).not.toContain('SENT');
    expect(screen.container.querySelector('a[href="/automacao"]')).toBeDefined();
    expect(screen.container.querySelector('a[href="/envios"]')).toBeDefined();
    expect(screen.container.querySelector('[aria-label^="Jornada do envio"]')).toBeDefined();
    await screen.unmount();
  });

  it('traduz automação desligada e oferece o caminho para ligá-la', async () => {
    getAutomationStatusMock.mockResolvedValueOnce({ ...automationStatus, paused: true, allowed: false, reasons: ['AUTOMATION_PAUSED'] });
    const screen = await render(<OverviewPage />);
    await flush();

    expect(screen.container.textContent).toContain('Automação desligada');
    expect(screen.container.textContent).toContain('A automação está desligada.');
    expect(screen.container.querySelector('a.ops-home-attention-link[href="/automacao"]')).toBeDefined();
    await screen.unmount();
  });

  it('traduz espera de cadência sem expor o código do motivo', async () => {
    getAutomationStatusMock.mockResolvedValueOnce({ ...automationStatus, allowed: false, reasons: ['MINIMUM_INTERVAL_NOT_REACHED'] });
    const screen = await render(<OverviewPage />);
    await flush();

    expect(screen.container.textContent).toContain('Aguarda o intervalo mínimo entre envios.');
    expect(screen.container.textContent).not.toContain('MINIMUM_INTERVAL_NOT_REACHED');
    await screen.unmount();
  });

  it('mostra estados vazios quando não existem envios', async () => {
    listDispatchesMock.mockResolvedValueOnce([]);
    listExecutionsMock.mockResolvedValueOnce(emptyExecutionPage);
    const screen = await render(<OverviewPage />);
    await flush();

    expect(screen.container.textContent).toContain('Nenhum envio registrado');
    expect(screen.container.textContent).toContain('Nenhuma atividade recente');
    await screen.unmount();
  });

  it('distingue histórico indisponível de histórico vazio', async () => {
    listDispatchesMock.mockRejectedValueOnce(new Error('dispatch read unavailable'));
    const screen = await render(<OverviewPage />);
    await flush();

    expect(screen.container.textContent).toContain('Envios indisponíveis');
    expect(screen.container.textContent).toContain('Jornada indisponível');
    expect(screen.container.textContent).toContain('Atividade indisponível');
    expect(screen.container.textContent).not.toContain('Nenhum envio registrado');
    expect(screen.container.textContent).not.toContain('Tudo certo por aqui.');
    await screen.unmount();
  });

  it('trata envio em processamento como aguardando confirmação', async () => {
    listDispatchesMock.mockResolvedValueOnce([{ ...dispatch, status: 'PROCESSING' as const }]);
    const screen = await render(<OverviewPage />);
    await flush();

    expect(screen.container.textContent).toContain('Aguardando confirmação');
    expect(screen.container.textContent).toContain('Há um envio aguardando confirmação.');
    const sendStage = Array.from(screen.container.querySelectorAll('.ops-home-journey-stage')).find(
      (stage) => stage.querySelector('.ops-home-journey-label')?.textContent === 'Envio',
    );
    expect(sendStage?.getAttribute('data-state')).toBe('current');
    await screen.unmount();
  });

  it('sinaliza envio não realizado na área de atenção', async () => {
    listDispatchesMock.mockResolvedValueOnce([{ ...dispatch, status: 'FAILED' as const }]);
    const screen = await render(<OverviewPage />);
    await flush();

    expect(screen.container.textContent).toContain('Não realizado');
    expect(screen.container.textContent).toContain('Há um envio que não foi realizado.');
    expect(screen.container.textContent).not.toContain('Tudo certo por aqui.');
    await screen.unmount();
  });

  it('preserva o último dado bom quando uma leitura posterior falha', async () => {
    const screen = await render(<OverviewPage />);
    await flush();
    getDispatchesMockForSecondRead();
    const refresh = Array.from(screen.container.querySelectorAll('button')).find((button) => button.textContent?.includes('Atualizar'));
    await click(refresh as HTMLButtonElement);
    await flush();

    expect(screen.container.textContent).toContain('Algumas informações estão desatualizadas');
    expect(screen.container.textContent).toContain('Tapioqueira Peneira Polvilhador');
    expect(screen.container.textContent).not.toContain('Tudo certo por aqui.');
    await screen.unmount();
  });

  it('mostra retry e estado indisponível quando a API falha', async () => {
    getHealthMock.mockRejectedValueOnce(new Error('API unavailable'));
    const screen = await render(<OverviewPage />);
    await flush();

    expect(screen.container.textContent).toContain('Algumas informações estão desatualizadas');
    expect(screen.container.textContent).toContain('API não disponível');
    const retry = Array.from(screen.container.querySelectorAll('button')).find((button) => button.textContent?.includes('Tentar novamente'));
    expect(retry).toBeDefined();
    await click(retry as HTMLButtonElement);
    await flush();
    expect(getHealthMock).toHaveBeenCalledTimes(2);
    await screen.unmount();
  });

  it('não faz polling em aba escondida e atualiza quando ela volta a ficar visível', async () => {
    vi.useFakeTimers();
    const originalVisibility = document.visibilityState;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    const screen = await render(<OverviewPage />);
    await flush();
    const initialCalls = getHealthMock.mock.calls.length;

    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(getHealthMock).toHaveBeenCalledTimes(initialCalls);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await act(async () => { vi.advanceTimersByTime(30_000); });
    await flush();
    expect(getHealthMock).toHaveBeenCalledTimes(initialCalls + 1);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: originalVisibility });
    await screen.unmount();
    vi.useRealTimers();
  });
});

function getDispatchesMockForSecondRead() {
  listDispatchesMock.mockRejectedValueOnce(new Error('dispatch read unavailable'));
}
