import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { change, click, render, submit } from '../test/render';
import type { OperationalAdminBlocker } from '../lib/api';
import { WhatsAppInstancesManagement } from './whatsapp-instances-management';

const DashboardApiErrorMock = vi.hoisted(() => {
  class FakeDashboardApiError extends Error {
    constructor(
      message: string,
      public readonly status?: number,
      public readonly code?: string,
    ) {
      super(message);
      this.name = 'DashboardApiError';
    }
  }
  return FakeDashboardApiError;
});

const getOperationalAdminMock = vi.fn();
const createOperationalInstanceMock = vi.fn();
const updateOperationalInstanceMock = vi.fn();

vi.mock('../lib/api', () => ({
  DashboardApiError: DashboardApiErrorMock,
  getOperationalAdmin: (...args: unknown[]) => getOperationalAdminMock(...args),
  createOperationalInstance: (...args: unknown[]) =>
    createOperationalInstanceMock(...args),
  updateOperationalInstance: (...args: unknown[]) =>
    updateOperationalInstanceMock(...args),
}));

const baseInstance = {
  name: 'whatsapp-principal',
  active: true,
  paused: false,
  health: 'UNKNOWN' as string,
  assignedGroupCount: 2,
  lastSendAt: '2026-08-28T11:00:00.000Z',
  nextSendAt: '2026-08-28T13:00:00.000Z',
  blockers: [] as OperationalAdminBlocker[],
  updatedAt: '2026-08-28T12:00:00.000Z',
};

const overview = {
  generatedAt: '2026-08-28T12:00:00.000Z',
  automation: {
    paused: true,
    allowedStartTime: '08:00',
    allowedEndTime: '22:00',
    timezone: 'America/Sao_Paulo',
    minimumIntervalMinutes: 15,
    staggerMinutes: 5,
    dailyGlobalLimit: 10,
    dailyGroupLimit: 5,
    dailyGlobalLimitOverride: null,
    dailyGroupLimitOverride: null,
    dailyShopeeHttpLimit: 10,
    dailyOpenAiGenerationLimit: 10,
    dailyShopeeHttpLimitOverride: null,
    dailyOpenAiGenerationLimitOverride: null,
    providerUsage: {
      dayKey: '2026-08-28',
      shopee: { used: 0, limit: 10, reached: false },
      openAi: { used: 0, limit: 10, reached: false },
    },
    hardCaps: {
      maxMessagesPerRun: 1,
    },
    scheduleRevision: 2,
    updatedAt: '2026-08-28T12:00:00.000Z',
  },
  nextSendAt: null,
  lastSendAt: null,
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
  scheduler: null,
  instances: [baseInstance],
  groups: [],
  campaigns: [],
};

const renderView = async (nextOverview = overview) => {
  getOperationalAdminMock.mockResolvedValue(nextOverview);
  return render(<WhatsAppInstancesManagement />);
};

beforeEach(() => {
  getOperationalAdminMock.mockReset();
  createOperationalInstanceMock.mockReset().mockResolvedValue({});
  updateOperationalInstanceMock.mockReset().mockResolvedValue({});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('WhatsAppInstancesManagement', () => {
  it('apresenta resumo, identidade, saúde explícita, horários e pendências amigáveis', async () => {
    const screen = await renderView({
      ...overview,
      instances: [
        { ...baseInstance, health: 'HEALTHY' },
        {
          ...baseInstance,
          name: 'whatsapp-pausado',
          active: false,
          paused: true,
          assignedGroupCount: 0,
          health: 'OFFLINE',
          blockers: [
            {
              scope: 'INSTANCE',
              code: 'INSTANCE_PAUSED',
              entityId: 'secret-id-not-shown',
              message: 'raw message',
            },
          ],
        },
      ],
    });

    expect(screen.container.textContent).toContain('Instâncias ativas1');
    expect(screen.container.textContent).toContain('Instâncias pausadas1');
    expect(screen.container.textContent).toContain('Grupos atribuídos2');
    expect(screen.container.textContent).toContain('Com pendência1');
    expect(screen.container.textContent).toContain('Operacional');
    expect(screen.container.textContent).toContain('Indisponível');
    expect(screen.container.textContent).toContain('whatsapp-pausado');
    expect(screen.container.textContent).toContain('Pausada');
    expect(screen.container.textContent).toContain(
      'Este WhatsApp está pausado.',
    );
    expect(screen.container.textContent).toContain('28/08/2026');
    expect(screen.container.textContent).not.toContain('secret-id-not-shown');
    await screen.unmount();
  });

  it('usa o fallback neutro para health desconhecido sem afirmar conexão', async () => {
    const screen = await renderView({
      ...overview,
      instances: [{ ...baseInstance, health: 'NEW_UNDOCUMENTED_STATE' }],
    });

    expect(screen.container.textContent).toContain('Estado não confirmado');
    expect(screen.container.textContent).not.toContain('Conectado');
    expect(screen.container.textContent).not.toContain('Health sanitizado');
    await screen.unmount();
  });

  it('mantém códigos e estado técnico apenas em informações avançadas', async () => {
    const screen = await renderView({
      ...overview,
      instances: [
        {
          ...baseInstance,
          health: 'OFFLINE',
          blockers: [
            {
              scope: 'INSTANCE',
              code: 'CUSTOM_BLOCKER',
              entityId: 'technical-id',
              message: 'technical message',
            },
          ],
        },
      ],
    });

    expect(screen.container.textContent).toContain(
      'Existe uma pendência que precisa de atenção.',
    );
    const details = screen.container.querySelector('details');
    expect(
      details?.parentElement?.querySelector('.whatsapp-instance-attention')
        ?.textContent,
    ).not.toContain('CUSTOM_BLOCKER');
    expect(details?.textContent).toContain('CUSTOM_BLOCKER');
    expect(details?.textContent).toContain('OFFLINE');
    expect(details?.textContent).not.toContain('technical-id');
    await screen.unmount();
  });

  it('mantém cadastro como identificação operacional, sem conexão, QR ou telefone inventado', async () => {
    const screen = await renderView();
    const input = screen.container.querySelector(
      'input[placeholder="afiliado-shopee-local"]',
    ) as HTMLInputElement;
    const form = input.closest('form') as HTMLFormElement;

    expect(screen.container.textContent).toContain(
      'O cadastro cria a identificação operacional. A conexão de um novo WhatsApp ainda não está disponível pelo painel.',
    );
    expect(screen.container.textContent).not.toContain('Conectar');
    expect(screen.container.textContent).not.toContain('QR');
    expect(screen.container.textContent).not.toContain('telefone');

    await change(input, 'whatsapp-novo');
    await submit(form);

    expect(createOperationalInstanceMock).toHaveBeenCalledWith(
      'whatsapp-novo',
      'CONFIRMAR_ALTERACAO_OPERACIONAL',
    );
    expect(window.confirm).toHaveBeenCalledWith(
      'Cadastrar esta instancia operacional?',
    );
    await screen.unmount();
  });

  it('preserva confirmations, expectedUpdatedAt e não reenvia ação durante save', async () => {
    let resolveUpdate: ((value: unknown) => void) | undefined;
    updateOperationalInstanceMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    const screen = await renderView();
    const buttons = Array.from(screen.container.querySelectorAll('button'));
    const pauseButton = buttons.find((button) =>
      button.textContent?.includes('Pausar'),
    )!;

    await click(pauseButton);

    expect(window.confirm).toHaveBeenCalledWith(
      'Confirmar pausar a instancia whatsapp-principal?',
    );
    expect(updateOperationalInstanceMock).toHaveBeenCalledWith(
      'whatsapp-principal',
      {
        paused: true,
        expectedUpdatedAt: '2026-08-28T12:00:00.000Z',
        confirmation: 'CONFIRMAR_PAUSA_OPERACIONAL',
      },
    );
    expect((pauseButton as HTMLButtonElement).disabled).toBe(true);
    await click(pauseButton);
    expect(updateOperationalInstanceMock).toHaveBeenCalledTimes(1);
    resolveUpdate?.({});
    await screen.unmount();
  });

  it('usa confirmation de alteração para ativar e desativar', async () => {
    const screen = await renderView({
      ...overview,
      instances: [{ ...baseInstance, active: false }],
    });

    const activateButton = Array.from(
      screen.container.querySelectorAll('button'),
    ).find((button) => button.textContent?.includes('Ativar'))!;
    await click(activateButton);

    expect(updateOperationalInstanceMock).toHaveBeenCalledWith(
      'whatsapp-principal',
      expect.objectContaining({
        active: true,
        expectedUpdatedAt: '2026-08-28T12:00:00.000Z',
        confirmation: 'CONFIRMAR_ALTERACAO_OPERACIONAL',
      }),
    );
    await screen.unmount();
  });

  it('apresenta o conflito CAS sem retry ou sobrescrita', async () => {
    updateOperationalInstanceMock.mockRejectedValueOnce(
      new DashboardApiErrorMock(
        'conflict details must not be shown',
        409,
        'OPERATIONAL_CAS_CONFLICT',
      ),
    );
    const screen = await renderView();
    const pauseButton = Array.from(
      screen.container.querySelectorAll('button'),
    ).find((button) => button.textContent?.includes('Pausar'))!;

    await click(pauseButton);

    expect(updateOperationalInstanceMock).toHaveBeenCalledTimes(1);
    expect(getOperationalAdminMock).toHaveBeenCalledTimes(1);
    expect(screen.container.textContent).toContain(
      'Este WhatsApp foi alterado em outro lugar. Atualize os dados antes de tentar novamente.',
    );
    expect(screen.container.textContent).not.toContain('conflict details');
    await screen.unmount();
  });

  it('preserva dados anteriores quando uma atualização falha', async () => {
    const screen = await renderView();
    getOperationalAdminMock.mockRejectedValueOnce(
      new Error('temporary read failure'),
    );

    const refresh = Array.from(
      screen.container.querySelectorAll('button'),
    ).find((button) => button.textContent?.includes('Atualizar'))!;
    await click(refresh);

    expect(screen.container.textContent).toContain('whatsapp-principal');
    expect(screen.container.textContent).toContain(
      'Não foi possível carregar os WhatsApps agora.',
    );
    expect(screen.container.textContent).toContain('Tentar novamente');
    await screen.unmount();
  });

  it('mostra erro inicial com retry explícito e nenhum estado inventado', async () => {
    getOperationalAdminMock.mockRejectedValueOnce(new Error('offline'));
    const screen = await renderView();

    expect(screen.container.textContent).toContain('WhatsApps indisponíveis');
    expect(screen.container.textContent).not.toContain('Instâncias ativas');
    expect(screen.container.textContent).toContain('Tentar novamente');
    await screen.unmount();
  });

  it('expõe somente links contextuais para grupos e histórico', async () => {
    const screen = await renderView();

    expect(
      screen.container.querySelector('a[href="/whatsapp"]')?.textContent,
    ).toContain('Ver grupos');
    expect(
      screen.container.querySelector('a[href="/envios"]')?.textContent,
    ).toContain('Ver histórico de envios');
    expect(screen.container.textContent).not.toContain('PENDING');
    expect(screen.container.textContent).not.toContain('SENT');
    expect(screen.container.textContent).not.toContain('FAILED');
    expect(screen.container.textContent).not.toContain('externalMessageId');
    await screen.unmount();
  });
});
