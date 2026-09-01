import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { change, click, render, submit } from '../../test/render';
import AutomationPage from './page';

const RESUME_CONFIRMATION = 'RETOMAR_AUTOMACAO_COMERCIAL';

const DashboardApiErrorMock = vi.hoisted(
  () =>
    class FakeDashboardApiError extends Error {
      constructor(
        message: string,
        public readonly status?: number,
        public readonly code?: string,
      ) {
        super(message);
        this.name = 'DashboardApiError';
      }
    },
);

const getStatusMock = vi.fn();
const getSchedulerMock = vi.fn();
const getScheduleMock = vi.fn();
const getPreviewMock = vi.fn();
const getOperationalAdminMock = vi.fn();
const pauseMock = vi.fn();
const resumeMock = vi.fn();
const updateOperationalAutomationMock = vi.fn();

vi.mock('../../lib/api', () => ({
  DashboardApiError: DashboardApiErrorMock,
  getCommercialAutomationStatus: (...args: unknown[]) => getStatusMock(...args),
  getCommercialAutomationSchedulerStatus: (...args: unknown[]) =>
    getSchedulerMock(...args),
  getCommercialAutomationScheduleSettings: (...args: unknown[]) =>
    getScheduleMock(...args),
  getCommercialAutomationSchedulePreview: (...args: unknown[]) =>
    getPreviewMock(...args),
  getOperationalAdmin: (...args: unknown[]) => getOperationalAdminMock(...args),
  pauseCommercialAutomation: (...args: unknown[]) => pauseMock(...args),
  resumeCommercialAutomation: (...args: unknown[]) => resumeMock(...args),
  updateOperationalAutomation: (...args: unknown[]) =>
    updateOperationalAutomationMock(...args),
}));

const baseStatus = {
  enabled: true,
  allowed: true,
  reasons: [],
  nextAllowedAt: null,
  globalSentToday: 1,
  globalRemainingToday: 59,
  groupSentToday: 1,
  groupRemainingToday: 59,
  lastSentAt: '2026-08-10T12:00:00.000Z',
  paused: false,
  pausedAt: null,
  resumedAt: null,
  updatedAt: '2026-08-10T12:00:00.000Z',
  allowedStartTime: '08:00',
  allowedEndTime: '23:00',
  timezone: 'America/Sao_Paulo',
  dailyGlobalLimit: 60,
  dailyGroupLimit: 60,
  minimumIntervalMinutes: 14,
  authorizedGroupCount: 1,
};

const baseScheduler = {
  enabled: true,
  status: 'registered',
  jobId: 'scheduled-commercial-automation',
  queue: 'commercial-automation',
  jobName: 'commercial-automation-tick',
  cron: '*/15 8-22 * * *',
  timezone: 'America/Sao_Paulo',
  nextRunAt: '2026-08-10T12:15:00.000Z',
  mode: 'send',
};

const baseSchedule = {
  timezone: 'America/Sao_Paulo',
  allowedStartTime: '08:00',
  allowedEndTime: '23:00',
  minimumIntervalMinutes: 14,
  staggerMinutes: 5,
  scheduleRevision: 3,
};

const basePreview = {
  scheduleRevision: 3,
  plannedSlots: 2,
  skippedTargets: [],
  nextSlot: {
    slotKey: 'slot-1',
    jobId: 'commercial-target-slot-1',
    scheduledFor: '2026-08-10T12:15:00.000Z',
    campaignId: 'campaign-1',
    groupId: 'group-1',
    logicalGroupFingerprint: 'fingerprint-1',
    instanceName: 'affiliate-bot',
  },
};

const makeOperational = (overrides: Record<string, unknown> = {}) => ({
  generatedAt: '2026-08-10T12:00:00.000Z',
  automation: {
    paused: false,
    allowedStartTime: '08:00',
    allowedEndTime: '23:00',
    timezone: 'America/Sao_Paulo',
    minimumIntervalMinutes: 14,
    staggerMinutes: 5,
    dailyGlobalLimit: 60,
    dailyGroupLimit: 60,
    dailyGlobalLimitOverride: 60,
    dailyGroupLimitOverride: 60,
    dailyShopeeHttpLimit: 8,
    dailyOpenAiGenerationLimit: 6,
    dailyShopeeHttpLimitOverride: 8,
    dailyOpenAiGenerationLimitOverride: 6,
    providerUsage: {
      dayKey: '2026-08-10',
      shopee: { used: 3, limit: 8, reached: false },
      openAi: { used: 2, limit: 6, reached: false },
    },
    hardCaps: {
      dailyGlobalLimit: 60,
      dailyGroupLimit: 60,
      maxMessagesPerRun: 1,
    },
    scheduleRevision: 3,
    updatedAt: '2026-08-10T12:00:00.000Z',
  },
  nextSendAt: '2026-08-10T12:15:00.000Z',
  lastSendAt: '2026-08-10T12:00:00.000Z',
  blockers: [],
  queues: {
    productPipeline: { waiting: 0, active: 0, delayed: 0, prioritized: 0 },
    whatsappDispatch: { waiting: 0, active: 0, delayed: 0, prioritized: 0 },
    commercialAutomation: {
      waiting: 0,
      active: 0,
      delayed: 0,
      prioritized: 0,
    },
  },
  activeExecutions: 0,
  activeReservations: 0,
  ambiguity: 0,
  investigationRequired: 0,
  pendingDispatches: 0,
  pendingOutboxes: 0,
  scheduler: baseScheduler,
  instances: [],
  groups: [],
  campaigns: [],
  ...overrides,
});

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const buttonWithText = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(text),
  );

const withoutAdvancedDetails = (container: HTMLElement) => {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('details').forEach((details) => details.remove());
  return clone.textContent ?? '';
};

const renderLoaded = async () => {
  const screen = await render(<AutomationPage />);
  await settle();
  return screen;
};

beforeEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  getStatusMock.mockReset().mockResolvedValue({ ...baseStatus });
  getSchedulerMock.mockReset().mockResolvedValue({ ...baseScheduler });
  getScheduleMock.mockReset().mockResolvedValue({ ...baseSchedule });
  getPreviewMock.mockReset().mockResolvedValue({ ...basePreview });
  getOperationalAdminMock.mockReset().mockResolvedValue(makeOperational());
  pauseMock.mockReset().mockResolvedValue({ ...baseStatus, paused: true });
  resumeMock.mockReset().mockResolvedValue({ ...baseStatus, paused: false });
  updateOperationalAutomationMock
    .mockReset()
    .mockResolvedValue({ ...baseSchedule, scheduleRevision: 4 });
});

describe('AutomationPage — Lote 6', () => {
  it('prioriza linguagem diária e não expõe jargão no primeiro nível', async () => {
    const screen = await renderLoaded();
    const firstLevel = withoutAdvancedDetails(screen.container);

    expect(firstLevel).toContain('Automação');
    expect(firstLevel).toContain('Configure quando e com que frequência');
    expect(firstLevel).toContain('AUTOMAÇÃO LIGADA');
    expect(firstLevel).toContain('Configuração de envio');
    expect(firstLevel).not.toContain('Control plane');
    expect(firstLevel).not.toContain('Scheduler');
    expect(firstLevel).not.toContain('Readiness');
    expect(firstLevel).not.toContain('Reason');
    expect(firstLevel).not.toContain('Tick');
    expect(firstLevel).not.toContain('Hard cap');
    expect(firstLevel).not.toContain('CAS');
    expect(screen.container.querySelector('details')?.open).toBe(false);
    expect(getOperationalAdminMock).toHaveBeenCalledTimes(1);
    await screen.unmount();
  });

  it('mostra automação ligada somente com enabled e pausa authoritative', async () => {
    const screen = await renderLoaded();
    expect(screen.container.textContent).toContain('AUTOMAÇÃO LIGADA');
    expect(screen.container.textContent).toContain('Desligar automação');
    await screen.unmount();
  });

  it('mostra automação desligada quando paused=true mesmo com enabled=true', async () => {
    getStatusMock.mockResolvedValueOnce({ ...baseStatus, paused: true });
    const screen = await renderLoaded();

    expect(screen.container.textContent).toContain('AUTOMAÇÃO DESLIGADA');
    expect(screen.container.textContent).toContain('Ligar automação');
    await screen.unmount();
  });

  it('mostra estado indisponível sem inferir uma ação quando a leitura falha', async () => {
    getStatusMock.mockRejectedValueOnce(new Error('offline'));
    getSchedulerMock.mockRejectedValueOnce(new Error('offline'));
    getScheduleMock.mockRejectedValueOnce(new Error('offline'));
    getPreviewMock.mockRejectedValueOnce(new Error('offline'));
    getOperationalAdminMock.mockRejectedValueOnce(new Error('offline'));
    const screen = await renderLoaded();

    expect(screen.container.textContent).toContain('ESTADO INDISPONÍVEL');
    expect(screen.container.textContent).toContain('Automação indisponível');
    expect(buttonWithText(screen.container, 'Ligar automação')).toBeUndefined();
    expect(
      buttonWithText(screen.container, 'Desligar automação'),
    ).toBeUndefined();
    await screen.unmount();
  });

  it('invalida o estado principal quando uma atualização posterior falha', async () => {
    const screen = await renderLoaded();
    getStatusMock.mockRejectedValueOnce(new Error('status offline'));

    await click(buttonWithText(screen.container, 'Atualizar')!);
    await settle();

    expect(screen.container.textContent).toContain('ESTADO INDISPONÍVEL');
    expect(
      buttonWithText(screen.container, 'Desligar automação'),
    ).toBeUndefined();
    expect(buttonWithText(screen.container, 'Ligar automação')).toBeUndefined();
    await screen.unmount();
  });

  it('não oferece toggle quando o ambiente desabilita a automação', async () => {
    getStatusMock.mockResolvedValueOnce({ ...baseStatus, enabled: false });
    const screen = await renderLoaded();

    expect(screen.container.textContent).toContain('AUTOMAÇÃO DESLIGADA');
    expect(screen.container.textContent).toContain('desativada pelo ambiente');
    expect(buttonWithText(screen.container, 'Ligar automação')).toBeUndefined();
    await screen.unmount();
  });

  it('confirma e pausa com ação explícita', async () => {
    const screen = await renderLoaded();
    const pauseButton = buttonWithText(screen.container, 'Desligar automação');
    expect(pauseButton).toBeDefined();

    await click(pauseButton!);
    expect(screen.container.textContent).toContain('Desligar a automação?');
    expect(screen.container.textContent).toContain(
      'Novos envios automáticos não serão iniciados enquanto ela estiver desligada.',
    );
    await click(
      screen.container.querySelector(
        '[role="dialog"] [data-variant="danger"]',
      )!,
    );
    await settle();

    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(screen.container.textContent).toContain('Automação desligada.');
    await screen.unmount();
  });

  it('confirma retomada com o contrato vigente e expectedUpdatedAt', async () => {
    getStatusMock.mockResolvedValueOnce({ ...baseStatus, paused: true });
    const screen = await renderLoaded();
    await click(buttonWithText(screen.container, 'Ligar automação')!);

    expect(screen.container.textContent).toContain('Ligar a automação?');
    expect(screen.container.textContent).toContain(
      'Novos envios poderão ocorrer conforme horários, limites e demais regras.',
    );
    await click(
      screen.container.querySelector(
        '[role="dialog"] [data-variant="primary"]',
      )!,
    );
    await settle();

    expect(resumeMock).toHaveBeenCalledTimes(1);
    expect(resumeMock).toHaveBeenCalledWith(
      'RETOMAR_AUTOMACAO_COMERCIAL',
      baseStatus.updatedAt,
    );
    expect(screen.container.textContent).toContain('Automação ligada.');
    await screen.unmount();
  });

  it('congela o expectedUpdatedAt da retomada durante uma atualização', async () => {
    const oldUpdatedAt = '2026-08-10T12:00:00.000Z';
    getStatusMock.mockResolvedValueOnce({
      ...baseStatus,
      paused: true,
      updatedAt: oldUpdatedAt,
    });
    const screen = await renderLoaded();
    await click(buttonWithText(screen.container, 'Ligar automação')!);
    getStatusMock.mockResolvedValueOnce({
      ...baseStatus,
      paused: true,
      updatedAt: '2026-08-10T12:05:00.000Z',
    });
    await click(buttonWithText(screen.container, 'Atualizar')!);
    await settle();
    await click(
      screen.container.querySelector(
        '[role="dialog"] [data-variant="primary"]',
      )!,
    );
    await settle();

    expect(resumeMock).toHaveBeenCalledWith(RESUME_CONFIRMATION, oldUpdatedAt);
    await screen.unmount();
  });

  it('trata resume obsoleto como conflito sem retry automático', async () => {
    getStatusMock.mockResolvedValueOnce({ ...baseStatus, paused: true });
    resumeMock.mockRejectedValueOnce(
      new DashboardApiErrorMock('conflito', 409, 'OPERATIONAL_CAS_CONFLICT'),
    );
    const screen = await renderLoaded();
    await click(buttonWithText(screen.container, 'Ligar automação')!);
    await click(
      screen.container.querySelector(
        '[role="dialog"] [data-variant="primary"]',
      )!,
    );
    await settle();

    expect(resumeMock).toHaveBeenCalledTimes(1);
    expect(screen.container.textContent).toContain(
      'A configuração mudou em outro lugar. Atualize os dados antes de ligar a automação.',
    );
    expect(screen.container.textContent).toContain('AUTOMAÇÃO DESLIGADA');
    expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
    await screen.unmount();
  });

  it('renderiza horários, intervalos, limites e budgets separados', async () => {
    const screen = await renderLoaded();

    expect(
      (
        screen.container.querySelector(
          '#automation-start-time',
        ) as HTMLInputElement
      ).value,
    ).toBe('08:00');
    expect(
      (
        screen.container.querySelector(
          '#automation-end-time',
        ) as HTMLInputElement
      ).value,
    ).toBe('23:00');
    expect(screen.container.textContent).toContain('Intervalo entre envios');
    expect(screen.container.textContent).toContain('Intervalo entre grupos');
    expect(screen.container.textContent).toContain('Limite diário total');
    expect(screen.container.textContent).toContain('Limite diário por grupo');
    expect(screen.container.textContent).toContain(
      'Limite de consultas Shopee por dia',
    );
    expect(screen.container.textContent).toContain(
      'Limite de gerações OpenAI por dia',
    );
    expect(
      screen.container
        .querySelector('#automation-minimum-interval')
        ?.getAttribute('min'),
    ).toBe('1');
    expect(
      screen.container
        .querySelector('#automation-stagger')
        ?.getAttribute('min'),
    ).toBe('0');
    await screen.unmount();
  });

  it('mostra timezone de Brasília sem converter o valor no frontend', async () => {
    const screen = await renderLoaded();
    expect(screen.container.textContent).toContain('Horário de Brasília');
    expect(screen.container.textContent).not.toContain('UTC');
    await screen.unmount();
  });

  it('mostra zero de uso quando o backend informa zero explicitamente', async () => {
    getOperationalAdminMock.mockResolvedValueOnce(
      makeOperational({
        automation: {
          ...makeOperational().automation,
          providerUsage: {
            dayKey: '2026-08-10',
            shopee: { used: 0, limit: 8, reached: false },
            openAi: { used: 0, limit: 6, reached: false },
          },
        },
      }),
    );
    const screen = await renderLoaded();

    expect(screen.container.textContent).toContain('0 de 8');
    expect(screen.container.textContent).toContain('0 de 6');
    await screen.unmount();
  });

  it('mostra uso indisponível sem transformar ausência em zero', async () => {
    const operational = makeOperational();
    (operational.automation as { providerUsage?: unknown }).providerUsage =
      undefined;
    getOperationalAdminMock.mockResolvedValueOnce(operational);
    const screen = await renderLoaded();

    const text = screen.container.textContent ?? '';
    expect(text).toContain('ShopeeNão disponível');
    expect(text).toContain('OpenAINão disponível');
    expect(text).not.toContain('0 de 8');
    expect(text).not.toContain('0 de 6');
    await screen.unmount();
  });

  it('mantém controles seguros quando uma leitura secundária falha', async () => {
    getOperationalAdminMock.mockRejectedValueOnce(new Error('usage offline'));
    const screen = await renderLoaded();

    expect(screen.container.textContent).toContain('AUTOMAÇÃO LIGADA');
    expect(screen.container.textContent).toContain('Não disponível');
    expect(screen.container.textContent).toContain(
      'Limites temporariamente indisponíveis',
    );
    expect(
      (
        screen.container.querySelector(
          'button[type="submit"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await screen.unmount();
  });

  it('mostra próximo envio somente quando existe fato retornado', async () => {
    const screen = await renderLoaded();
    expect(screen.container.textContent).toContain('Próximo envio');
    expect(screen.container.textContent).toContain('10/08/2026');
    await screen.unmount();

    getOperationalAdminMock.mockResolvedValueOnce(
      makeOperational({ nextSendAt: null }),
    );
    getPreviewMock.mockResolvedValueOnce({
      ...basePreview,
      nextSlot: null,
      plannedSlots: 0,
    });
    const unavailable = await renderLoaded();
    expect(unavailable.container.textContent).toContain('Não disponível');
    await unavailable.unmount();
  });

  it('traduz pendências conhecidas e esconde código desconhecido no caminho diário', async () => {
    getStatusMock.mockResolvedValueOnce({
      ...baseStatus,
      allowed: false,
      reasons: ['GLOBAL_DAILY_LIMIT_REACHED', 'UNKNOWN_BLOCKER'],
    });
    const screen = await renderLoaded();
    const firstLevel = withoutAdvancedDetails(screen.container);

    expect(firstLevel).toContain('Limite diário global atingido.');
    expect(firstLevel).toContain(
      'Há uma ocorrência que precisa de investigação.',
    );
    expect(firstLevel).not.toContain('UNKNOWN_BLOCKER');
    expect(screen.container.textContent).toContain('UNKNOWN_BLOCKER');
    await screen.unmount();
  });

  it('mostra apenas a previsão retornada sem calcular agenda no frontend', async () => {
    getPreviewMock.mockResolvedValueOnce({
      ...basePreview,
      plannedSlots: 1,
    });
    const screen = await renderLoaded();

    expect(screen.container.textContent).toContain('Horários nesta consulta');
    expect(screen.container.textContent).toContain('1');
    expect(withoutAdvancedDetails(screen.container)).not.toContain('*/15');
    await screen.unmount();
  });

  it('não apresenta previsão de uma revisão diferente como agenda atual', async () => {
    getScheduleMock.mockResolvedValueOnce({
      ...baseSchedule,
      scheduleRevision: 4,
    });
    const screen = await renderLoaded();
    const previewSection = Array.from(
      screen.container.querySelectorAll('section'),
    ).find((section) =>
      section.textContent?.includes('Próximos horários previstos'),
    );

    expect(previewSection?.textContent).toContain('Não disponível');
    expect(previewSection?.textContent).toContain(
      'A previsão anterior não corresponde às regras atuais.',
    );
    await screen.unmount();
  });

  it('bloqueia edição quando agenda e resumo têm revisões diferentes', async () => {
    getScheduleMock.mockResolvedValueOnce({
      ...baseSchedule,
      scheduleRevision: 4,
    });
    const screen = await renderLoaded();

    expect(
      (
        screen.container.querySelector(
          'button[type="submit"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.container.textContent).toContain(
      'As regras retornaram versões diferentes.',
    );
    await screen.unmount();
  });

  it('não hidrata o descarte com duas revisões diferentes', async () => {
    const screen = await renderLoaded();
    await change(
      screen.container.querySelector('#automation-minimum-interval')!,
      '21',
    );
    getScheduleMock.mockResolvedValueOnce({
      ...baseSchedule,
      scheduleRevision: 4,
    });
    await click(buttonWithText(screen.container, 'Atualizar')!);
    await settle();
    await click(buttonWithText(screen.container, 'Descartar alterações')!);

    expect(
      (
        screen.container.querySelector(
          '#automation-minimum-interval',
        ) as HTMLInputElement
      ).value,
    ).toBe('');
    expect(screen.container.textContent).toContain(
      'Atualize os dados para confirmar uma única versão da configuração.',
    );
    await screen.unmount();
  });

  it('preserva alterações locais durante uma atualização automática', async () => {
    const screen = await renderLoaded();
    await change(
      screen.container.querySelector('#automation-minimum-interval')!,
      '21',
    );
    getScheduleMock.mockResolvedValueOnce({
      ...baseSchedule,
      minimumIntervalMinutes: 30,
      scheduleRevision: 3,
    });
    await click(buttonWithText(screen.container, 'Atualizar')!);
    await settle();

    expect(
      (
        screen.container.querySelector(
          '#automation-minimum-interval',
        ) as HTMLInputElement
      ).value,
    ).toBe('21');
    expect(screen.container.textContent).toContain(
      'Há alterações locais ainda não salvas nesta configuração.',
    );
    await screen.unmount();
  });

  it('bloqueia o salvamento quando a revisão muda durante a edição', async () => {
    const screen = await renderLoaded();
    await change(
      screen.container.querySelector('#automation-minimum-interval')!,
      '21',
    );
    getScheduleMock.mockResolvedValueOnce({
      ...baseSchedule,
      scheduleRevision: 4,
    });
    await click(buttonWithText(screen.container, 'Atualizar')!);
    await settle();

    expect(
      (
        screen.container.querySelector(
          'button[type="submit"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await submit(screen.container.querySelector('form')!);
    expect(screen.container.textContent).toContain(
      'A configuração mudou desde que você começou a editar.',
    );
    expect(updateOperationalAutomationMock).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it('preserva valores confirmados quando o refresh pós-save falha', async () => {
    const screen = await renderLoaded();
    await change(
      screen.container.querySelector('#automation-start-time')!,
      '09:00',
    );
    await change(
      screen.container.querySelector('#automation-minimum-interval')!,
      '21',
    );
    await change(
      screen.container.querySelector('#automation-global-limit')!,
      '77',
    );
    await change(
      screen.container.querySelector('#automation-shopee-limit')!,
      '12',
    );
    await change(
      screen.container.querySelector('#automation-openai-limit')!,
      '10',
    );
    getScheduleMock.mockRejectedValueOnce(new Error('refresh unavailable'));
    getOperationalAdminMock.mockRejectedValueOnce(
      new Error('refresh unavailable'),
    );
    updateOperationalAutomationMock.mockResolvedValueOnce({
      ...baseSchedule,
      allowedStartTime: '09:00',
      minimumIntervalMinutes: 21,
      scheduleRevision: 4,
    });

    await click(buttonWithText(screen.container, 'Salvar alterações')!);
    await click(
      screen.container.querySelector(
        '[role="dialog"] [data-variant="primary"]',
      )!,
    );
    await settle();

    expect(
      (
        screen.container.querySelector(
          '#automation-start-time',
        ) as HTMLInputElement
      ).value,
    ).toBe('09:00');
    expect(
      (
        screen.container.querySelector(
          '#automation-minimum-interval',
        ) as HTMLInputElement
      ).value,
    ).toBe('21');
    expect(
      (
        screen.container.querySelector(
          '#automation-global-limit',
        ) as HTMLInputElement
      ).value,
    ).toBe('77');
    expect(screen.container.textContent).toContain('3 de 12');
    expect(screen.container.textContent).toContain('2 de 10');
    expect(screen.container.textContent).toContain(
      'Alteração salva, mas não foi possível atualizar os dados exibidos.',
    );
    await screen.unmount();
  });

  it('associa cada campo à sua própria descrição acessível', async () => {
    const screen = await renderLoaded();
    expect(
      screen.container
        .querySelector('#automation-end-time')
        ?.getAttribute('aria-describedby'),
    ).toBe('automation-window-end-help');
    expect(
      screen.container
        .querySelector('#automation-group-limit')
        ?.getAttribute('aria-describedby'),
    ).toBe('automation-group-limit-help');
    await screen.unmount();
  });

  it('exige confirmação e envia expectedRevision ao salvar', async () => {
    const screen = await renderLoaded();
    await click(buttonWithText(screen.container, 'Salvar alterações')!);

    expect(screen.container.textContent).toContain('Salvar esta configuração?');
    await click(
      screen.container.querySelector(
        '[role="dialog"] [data-variant="primary"]',
      )!,
    );
    await settle();

    expect(updateOperationalAutomationMock).toHaveBeenCalledTimes(1);
    expect(updateOperationalAutomationMock).toHaveBeenCalledWith({
      allowedStartTime: '08:00',
      allowedEndTime: '23:00',
      minimumIntervalMinutes: 14,
      staggerMinutes: 5,
      dailyGlobalLimit: 60,
      dailyGroupLimit: 60,
      dailyShopeeHttpLimit: 8,
      dailyOpenAiGenerationLimit: 6,
      expectedRevision: 3,
      confirmation: 'CONFIRMAR_ALTERACAO_OPERACIONAL',
    });
    expect(screen.container.textContent).toContain('Alterações salvas.');
    await screen.unmount();
  });

  it('congela o payload e a revisão no momento da confirmação', async () => {
    const screen = await renderLoaded();
    await click(buttonWithText(screen.container, 'Salvar alterações')!);

    getScheduleMock.mockResolvedValueOnce({
      ...baseSchedule,
      allowedStartTime: '09:00',
      scheduleRevision: 4,
    });
    await click(buttonWithText(screen.container, 'Atualizar')!);
    await settle();
    await click(
      screen.container.querySelector(
        '[role="dialog"] [data-variant="primary"]',
      )!,
    );
    await settle();

    expect(updateOperationalAutomationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedStartTime: '08:00',
        expectedRevision: 3,
      }),
    );
    await screen.unmount();
  });

  it('bloqueia janela inválida antes do request', async () => {
    const screen = await renderLoaded();
    await change(
      screen.container.querySelector('#automation-end-time')!,
      '08:00',
    );
    await submit(screen.container.querySelector('form')!);

    expect(screen.container.textContent).toContain(
      'O início e o fim da janela precisam ser diferentes.',
    );
    expect(updateOperationalAutomationMock).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it('bloqueia intervalo fora do contrato antes do request', async () => {
    const screen = await renderLoaded();
    await change(
      screen.container.querySelector('#automation-minimum-interval')!,
      '0',
    );
    await submit(screen.container.querySelector('form')!);

    expect(screen.container.textContent).toContain(
      'O intervalo entre envios deve estar entre 1 e 1.440 minutos.',
    );
    expect(updateOperationalAutomationMock).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it('bloqueia limite acima do contrato e não expõe hard cap como campo', async () => {
    const screen = await renderLoaded();
    const input = screen.container.querySelector('#automation-global-limit')!;
    expect(input.getAttribute('max')).toBe('1000000');
    await change(input, '1000001');
    await submit(screen.container.querySelector('form')!);

    expect(screen.container.textContent).toContain(
      'O limite diário total deve estar entre 1 e 1.000.000.',
    );
    expect(withoutAdvancedDetails(screen.container)).not.toContain('Hard caps');
    expect(updateOperationalAutomationMock).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it('executa exatamente um write quando a confirmação é submetida duas vezes', async () => {
    const screen = await renderLoaded();
    await click(buttonWithText(screen.container, 'Salvar alterações')!);
    const confirm = screen.container.querySelector(
      '[role="dialog"] [data-variant="primary"]',
    );
    await click(confirm!);
    await click(confirm!);
    await settle();

    expect(updateOperationalAutomationMock).toHaveBeenCalledTimes(1);
    await screen.unmount();
  });

  it('mantém o foco no diálogo enquanto uma alteração aguarda resposta', async () => {
    updateOperationalAutomationMock.mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    const screen = await renderLoaded();
    await click(buttonWithText(screen.container, 'Salvar alterações')!);
    const confirm = screen.container.querySelector(
      '[role="dialog"] [data-variant="primary"]',
    )!;
    await click(confirm);

    const dialog = screen.container.querySelector('[role="dialog"]')!;
    expect(document.activeElement).toBe(dialog);
    await act(async () => {
      dialog.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(dialog);
    await screen.unmount();
  });

  it('mostra conflito de configuração sem retry ou overwrite', async () => {
    updateOperationalAutomationMock.mockRejectedValueOnce(
      new DashboardApiErrorMock('conflito', 409, 'OPERATIONAL_CAS_CONFLICT'),
    );
    const screen = await renderLoaded();
    await click(buttonWithText(screen.container, 'Salvar alterações')!);
    await click(
      screen.container.querySelector(
        '[role="dialog"] [data-variant="primary"]',
      )!,
    );
    await settle();

    expect(updateOperationalAutomationMock).toHaveBeenCalledTimes(1);
    expect(screen.container.textContent).toContain(
      'A configuração mudou em outro lugar. Atualize os dados antes de salvar novamente.',
    );
    await screen.unmount();
  });

  it('preserva a semântica após write confirmado e refresh posterior falho', async () => {
    const screen = await renderLoaded();
    getStatusMock.mockRejectedValueOnce(new Error('refresh failed'));
    getSchedulerMock.mockRejectedValueOnce(new Error('refresh failed'));
    getScheduleMock.mockRejectedValueOnce(new Error('refresh failed'));
    getPreviewMock.mockRejectedValueOnce(new Error('refresh failed'));
    getOperationalAdminMock.mockRejectedValueOnce(new Error('refresh failed'));

    await click(buttonWithText(screen.container, 'Salvar alterações')!);
    await click(
      screen.container.querySelector(
        '[role="dialog"] [data-variant="primary"]',
      )!,
    );
    await settle();

    expect(screen.container.textContent).toContain(
      'Alteração salva, mas não foi possível atualizar os dados exibidos.',
    );
    expect(screen.container.textContent).not.toContain(
      'Automação indisponível',
    );
    expect(updateOperationalAutomationMock).toHaveBeenCalledTimes(1);
    await screen.unmount();
  });

  it('fecha a confirmação com Escape e restaura o foco', async () => {
    const screen = await renderLoaded();
    const pauseButton = buttonWithText(screen.container, 'Desligar automação')!;
    pauseButton.focus();
    await click(pauseButton);
    expect(document.activeElement?.textContent).toContain('Cancelar');

    const dialog = screen.container.querySelector('[role="dialog"]')!;
    await act(async () => {
      dialog.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });

    expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(pauseButton);
    await screen.unmount();
  });

  it('usa polling de 30 segundos e nenhum polling quando a aba começa oculta', async () => {
    const intervalSpy = vi.spyOn(window, 'setInterval');
    const screen = await renderLoaded();
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
    await screen.unmount();

    intervalSpy.mockClear();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    const hidden = await renderLoaded();
    expect(intervalSpy).not.toHaveBeenCalled();
    await hidden.unmount();
  });

  it('mantém termos técnicos disponíveis somente dentro de informações avançadas', async () => {
    const screen = await renderLoaded();
    const details = screen.container.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain('Schedule revision');
    expect(details.textContent).toContain('Reason codes');
    expect(details.textContent).toContain('Cron');
    await screen.unmount();
  });
});
