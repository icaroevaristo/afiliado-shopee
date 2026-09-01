import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render } from '../../test/render';
import type { CommercialAutomationStatus } from '../../lib/api';
import SettingsPage from './page';

const getHealthMock = vi.fn();
const getCommercialAutomationStatusMock = vi.fn();

vi.mock('../../lib/api', () => ({
  getHealth: (...args: unknown[]) => getHealthMock(...args),
  getCommercialAutomationStatus: (...args: unknown[]) =>
    getCommercialAutomationStatusMock(...args),
}));

const automationStatus: CommercialAutomationStatus = {
  enabled: true,
  allowed: false,
  reasons: ['AUTOMATION_PAUSED'],
  nextAllowedAt: null,
  globalSentToday: 0,
  globalRemainingToday: 10,
  groupSentToday: 0,
  groupRemainingToday: 5,
  lastSentAt: null,
  paused: true,
  pausedAt: '2026-08-31T15:00:00.000Z',
  resumedAt: null,
  updatedAt: '2026-08-31T15:00:00.000Z',
  allowedStartTime: '08:00',
  allowedEndTime: '20:00',
  timezone: 'America/Sao_Paulo',
  dailyGlobalLimit: 10,
  dailyGroupLimit: 5,
  minimumIntervalMinutes: 60,
  authorizedGroupCount: 1,
};

const flush = async () => {
  await act(async () => undefined);
};

const updateButton = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes('Atualizar'),
  ) as HTMLButtonElement | undefined;

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

beforeEach(() => {
  vi.useRealTimers();
  getHealthMock.mockReset().mockResolvedValue({ status: 'ok', service: 'api' });
  getCommercialAutomationStatusMock
    .mockReset()
    .mockResolvedValue(automationStatus);
});

describe('SettingsPage — Lote 8', () => {
  it('apresenta título, descrição, saúde da API e timezone authoritative', async () => {
    const screen = await render(<SettingsPage />);
    await flush();

    expect(screen.container.querySelector('h1')?.textContent).toBe(
      'Configurações',
    );
    expect(screen.container.textContent).toContain(
      'Acesse preferências e informações gerais do sistema.',
    );
    expect(screen.container.textContent).toContain('API');
    expect(screen.container.textContent).toContain('Online');
    expect(screen.container.textContent).toContain('Horário de Brasília');
    expect(screen.container.textContent).toContain('America/Sao_Paulo');
    expect(getHealthMock).toHaveBeenCalledTimes(1);
    expect(getCommercialAutomationStatusMock).toHaveBeenCalledTimes(1);
    await screen.unmount();
  });

  it('mostra API indisponível sem afirmar que o sistema inteiro está operacional', async () => {
    getHealthMock.mockRejectedValueOnce(new Error('erro interno não exibível'));

    const screen = await render(<SettingsPage />);
    await flush();

    const text = screen.container.textContent ?? '';
    expect(text).toContain('Indisponível');
    expect(text).toContain('Não foi possível consultar a API.');
    expect(text).not.toContain('erro interno não exibível');
    expect(text).not.toContain('Sistema totalmente operacional');
    await screen.unmount();
  });

  it('permite tentar novamente a leitura da API sem expor erro interno', async () => {
    getHealthMock
      .mockRejectedValueOnce(new Error('falha privada'))
      .mockResolvedValueOnce({ status: 'ok', service: 'api' });

    const screen = await render(<SettingsPage />);
    await flush();
    expect(screen.container.textContent).toContain(
      'Não foi possível consultar a API.',
    );

    await click(updateButton(screen.container)!);
    await flush();

    expect(getHealthMock).toHaveBeenCalledTimes(2);
    expect(screen.container.textContent).toContain('Online');
    expect(screen.container.textContent).not.toContain(
      'Não foi possível consultar a API.',
    );
    await screen.unmount();
  });

  it('preserva a última leitura útil quando uma atualização falha', async () => {
    const screen = await render(<SettingsPage />);
    await flush();

    getHealthMock.mockRejectedValueOnce(new Error('offline após leitura'));
    await click(updateButton(screen.container)!);
    await flush();

    const text = screen.container.textContent ?? '';
    expect(text).toContain('Online');
    expect(text).toContain('Última leitura disponível.');
    expect(text).not.toContain('offline após leitura');
    await screen.unmount();
  });

  it('mantém a saúde disponível quando a leitura independente do timezone falha', async () => {
    getCommercialAutomationStatusMock.mockRejectedValueOnce(
      new Error('status privado'),
    );

    const screen = await render(<SettingsPage />);
    await flush();

    const text = screen.container.textContent ?? '';
    expect(text).toContain('API');
    expect(text).toContain('Online');
    expect(text).toContain('Não disponível');
    expect(text).toContain('Fuso horário indisponível.');
    expect(text).not.toContain('status privado');
    await screen.unmount();
  });

  it('mostra timezone retornado pela API sem inventar fallback', async () => {
    getCommercialAutomationStatusMock.mockResolvedValueOnce({
      ...automationStatus,
      timezone: 'America/Fortaleza',
    });

    const screen = await render(<SettingsPage />);
    await flush();

    expect(screen.container.textContent).toContain('America/Fortaleza');
    expect(screen.container.textContent).not.toContain('Horário de Brasília');
    await screen.unmount();
  });

  it('oferece somente os acessos rápidos das rotas reais', async () => {
    const screen = await render(<SettingsPage />);
    await flush();

    const links = Array.from(screen.container.querySelectorAll('a')).map(
      (link) => ({
        href: link.getAttribute('href'),
        text: link.textContent ?? '',
      }),
    );

    expect(links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/automacao',
          text: expect.stringContaining('Configurar automação'),
        }),
        expect.objectContaining({
          href: '/whatsapp',
          text: expect.stringContaining('Gerenciar grupos'),
        }),
        expect.objectContaining({
          href: '/whatsapp?view=whatsapps',
          text: expect.stringContaining('Gerenciar WhatsApps'),
        }),
        expect.objectContaining({
          href: '/envios',
          text: expect.stringContaining('Ver histórico'),
        }),
      ]),
    );
    await screen.unmount();
  });

  it('não duplica o controle de automação nem cria preferências locais', async () => {
    const screen = await render(<SettingsPage />);
    await flush();

    const text = screen.container.textContent ?? '';
    expect(text).not.toContain('Ligar automação');
    expect(text).not.toContain('Desligar automação');
    expect(text).not.toContain('Controle da automação');
    expect(
      screen.container.querySelector('input, textarea, select'),
    ).toBeNull();
    expect(screen.container.querySelectorAll('button')).toHaveLength(1);
    await screen.unmount();
  });

  it('remove detalhes técnicos e limitações da experiência diária', async () => {
    const screen = await render(<SettingsPage />);
    await flush();

    const text = screen.container.textContent ?? '';
    for (const forbidden of [
      'Scheduler',
      'Job ID',
      'product-pipeline',
      'pipeline-product',
      'cron',
      'NEXT_PUBLIC_API_URL',
      'WHATSAPP_PROVIDER',
      'EVOLUTION_API_KEY',
      'LOCAL_API_AUTH_TOKEN',
      '.env',
      'Limitações atuais',
    ]) {
      expect(text).not.toContain(forbidden);
    }
    expect(text).toContain('Consulte detalhes técnicos, estados de fila e evidências de execução quando precisar investigar.');
    expect(
      screen.container.querySelector('a[href="/diagnostico"]')?.textContent,
    ).toContain('Abrir diagnóstico avançado');
    await screen.unmount();
  });

  it('não faz polling e ignora refresh duplicado enquanto a leitura está em andamento', async () => {
    vi.useFakeTimers();
    const health = deferred<{ status: string; service: string }>();
    const status = deferred<CommercialAutomationStatus>();
    getHealthMock.mockReturnValueOnce(health.promise);
    getCommercialAutomationStatusMock.mockReturnValueOnce(status.promise);

    const screen = await render(<SettingsPage />);
    await click(updateButton(screen.container)!);
    await click(updateButton(screen.container)!);

    expect(getHealthMock).toHaveBeenCalledTimes(1);
    expect(getCommercialAutomationStatusMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    expect(getHealthMock).toHaveBeenCalledTimes(1);
    expect(getCommercialAutomationStatusMock).toHaveBeenCalledTimes(1);

    health.resolve({ status: 'ok', service: 'api' });
    status.resolve(automationStatus);
    await flush();
    await screen.unmount();
  });
});
