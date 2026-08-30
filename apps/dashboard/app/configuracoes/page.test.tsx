import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { change, click, render } from '../../test/render';
import type {
  CommercialAutomationStatus,
  SchedulerStatus,
} from '../../lib/api';
import SettingsPage from './page';

const getHealthMock = vi.fn();
const getSchedulerStatusMock = vi.fn();
const getCommercialAutomationStatusMock = vi.fn();
const pauseCommercialAutomationMock = vi.fn();
const resumeCommercialAutomationMock = vi.fn();

vi.mock('../../lib/api', () => ({
  getApiBaseUrl: () => 'http://localhost:3333',
  getHealth: (...args: unknown[]) => getHealthMock(...args),
  getSchedulerStatus: (...args: unknown[]) => getSchedulerStatusMock(...args),
  getCommercialAutomationStatus: (...args: unknown[]) =>
    getCommercialAutomationStatusMock(...args),
  pauseCommercialAutomation: (...args: unknown[]) =>
    pauseCommercialAutomationMock(...args),
  resumeCommercialAutomation: (...args: unknown[]) =>
    resumeCommercialAutomationMock(...args),
}));

const schedulerStatus: SchedulerStatus = {
  enabled: true,
  status: 'registered',
  jobId: 'scheduled-pipeline-product',
  queue: 'product-pipeline',
  jobName: 'pipeline-product',
  cronExpression: '0 8 * * *',
  timezone: 'America/Sao_Paulo',
  nextRunAt: '2026-07-25T11:00:00.000Z',
};

const automationStatus: CommercialAutomationStatus = {
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

const flush = async () => {
  await act(async () => undefined);
};

beforeEach(() => {
  getHealthMock.mockReset().mockResolvedValue({ status: 'ok', service: 'api' });
  getSchedulerStatusMock.mockReset().mockResolvedValue(schedulerStatus);
  getCommercialAutomationStatusMock
    .mockReset()
    .mockResolvedValue(automationStatus);
  pauseCommercialAutomationMock.mockReset().mockResolvedValue({
    ...automationStatus,
    paused: true,
  });
  resumeCommercialAutomationMock.mockReset().mockResolvedValue({
    ...automationStatus,
    paused: false,
    reasons: ['AUTOMATION_DISABLED'],
  });
});

describe('SettingsPage Scheduler', () => {
  it('mostra loading isolado durante a consulta', async () => {
    getSchedulerStatusMock.mockReturnValue(new Promise(() => undefined));

    const screen = await render(<SettingsPage />);

    expect(screen.container.textContent).toContain(
      'Consultando status do Scheduler',
    );
    const refreshButton = Array.from(
      screen.container.querySelectorAll('button'),
    ).find((button) => button.textContent?.includes('Atualizar status'));
    expect((refreshButton as HTMLButtonElement).disabled).toBe(true);
    await screen.unmount();
  });

  it.each([
    ['disabled', false, 'Desativado'],
    ['registered', true, 'Agendado'],
    ['not-registered', true, 'Não registrado'],
  ] as const)(
    'exibe detalhes somente leitura para %s',
    async (status, enabled, label) => {
      getSchedulerStatusMock.mockResolvedValue({
        ...schedulerStatus,
        status,
        enabled,
      });

      const screen = await render(<SettingsPage />);
      await flush();

      expect(screen.container.textContent).toContain(label);
      expect(screen.container.textContent).toContain(
        'scheduled-pipeline-product',
      );
      expect(screen.container.textContent).toContain('product-pipeline');
      expect(screen.container.textContent).toContain('pipeline-product');
      expect(screen.container.textContent).toContain('0 8 * * *');
      expect(screen.container.textContent).toContain('America/Sao_Paulo');
      expect(screen.container.textContent).toContain('25/07/2026');
      expect(screen.container.textContent).toContain(
        'Esta tela é somente leitura',
      );
      expect(
        screen.container.querySelector('input, textarea, select'),
      ).toBeNull();
      expect(screen.container.textContent).not.toContain('Ativar Scheduler');
      expect(screen.container.textContent).not.toContain('Desativar Scheduler');
      await screen.unmount();
    },
  );

  it('mostra indisponibilidade como erro e faz retry', async () => {
    getSchedulerStatusMock
      .mockRejectedValueOnce(new Error('Consulta indisponível (503)'))
      .mockResolvedValueOnce(schedulerStatus);

    const screen = await render(<SettingsPage />);
    await flush();

    expect(screen.container.textContent).toContain(
      'Consulta indisponível (503)',
    );
    expect(screen.container.textContent).not.toContain('Desativado');

    const retryButton = Array.from(
      screen.container.querySelectorAll('button'),
    ).find((button) => button.textContent?.includes('Tentar novamente'));
    await click(retryButton as HTMLButtonElement);
    await flush();

    expect(getSchedulerStatusMock).toHaveBeenCalledTimes(2);
    expect(screen.container.textContent).toContain('Agendado');
    await screen.unmount();
  });

  it('evita chamadas duplicadas durante atualizacao', async () => {
    const pending = new Promise<SchedulerStatus>(() => undefined);
    getSchedulerStatusMock
      .mockResolvedValueOnce(schedulerStatus)
      .mockReturnValueOnce(pending);
    const screen = await render(<SettingsPage />);
    await flush();

    const refreshButton = Array.from(
      screen.container.querySelectorAll('button'),
    ).find((button) => button.textContent?.includes('Atualizar status'));
    await click(refreshButton as HTMLButtonElement);
    await click(refreshButton as HTMLButtonElement);

    expect(getSchedulerStatusMock).toHaveBeenCalledTimes(2);
    expect((refreshButton as HTMLButtonElement).disabled).toBe(true);
    await screen.unmount();
  });
});

describe('SettingsPage commercial automation', () => {
  it('mostra estados, limites, motivos e garantias de nao envio', async () => {
    const screen = await render(<SettingsPage />);
    await flush();

    const text = screen.container.textContent ?? '';
    expect(text).toContain('Controle da automação');
    expect(text).toContain('Ambiente: desabilitada');
    expect(text).toContain('Operação: pausada');
    expect(text).toContain('08:00–20:00');
    expect(text).toContain('America/Sao_Paulo');
    expect(text).toContain('0/1 · 1 restante(s)');
    expect(text).toContain('Automação desabilitada pelo ambiente.');
    expect(text).toContain('Automação pausada operacionalmente.');
    expect(text).toContain('Este controle altera somente a pausa persistida.');
    expect(text).toContain('Ligar ou desligar não envia mensagem');
    await screen.unmount();
  });

  it('abre modal e so retoma com a confirmacao exata', async () => {
    const screen = await render(<SettingsPage />);
    await flush();

    const resumeButton = Array.from(
      screen.container.querySelectorAll('button'),
    ).find((button) => button.textContent?.trim() === 'Ligar automação');
    await click(resumeButton as HTMLButtonElement);

    const dialog = screen.container.querySelector('[role="dialog"]');
    const input = screen.container.querySelector(
      '#resume-automation-confirmation',
    ) as HTMLInputElement;
    const confirmButton = Array.from(
      screen.container.querySelectorAll('button'),
    ).find((button) => button.textContent?.includes('Confirmar retomada'));
    expect(dialog).not.toBeNull();
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);

    await change(input, 'RETOMAR_AUTOMACAO_COMERCIAL');
    expect((confirmButton as HTMLButtonElement).disabled).toBe(false);
    await click(confirmButton as HTMLButtonElement);
    await flush();

    expect(resumeCommercialAutomationMock).toHaveBeenCalledWith(
      'RETOMAR_AUTOMACAO_COMERCIAL',
    );
    expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.container.textContent).toContain('Operação: ativa');
    await screen.unmount();
  });

  it('pausa diretamente sem criar confirmacao', async () => {
    getCommercialAutomationStatusMock.mockResolvedValue({
      ...automationStatus,
      paused: false,
      reasons: ['AUTOMATION_DISABLED'],
    });
    const screen = await render(<SettingsPage />);
    await flush();

    const pauseButton = Array.from(
      screen.container.querySelectorAll('button'),
    ).find((button) => button.textContent?.trim() === 'Desligar automação');
    await click(pauseButton as HTMLButtonElement);
    await flush();

    expect(pauseCommercialAutomationMock).toHaveBeenCalledOnce();
    expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
    await screen.unmount();
  });
});
