import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render } from '../test/render';
import OverviewPage from './page';

const getAnalyticsMock = vi.fn();
const getHealthMock = vi.fn();
const getAutomationStatusMock = vi.fn();
const getAutomationSchedulerMock = vi.fn();
const listExecutionsMock = vi.fn();
const listDispatchesMock = vi.fn();
const listCampaignsMock = vi.fn();
const listQueueMock = vi.fn();

vi.mock('../lib/api', () => ({
  getAnalytics: (...args: unknown[]) => getAnalyticsMock(...args),
  getHealth: (...args: unknown[]) => getHealthMock(...args),
  getCommercialAutomationStatus: (...args: unknown[]) => getAutomationStatusMock(...args),
  getCommercialAutomationSchedulerStatus: (...args: unknown[]) => getAutomationSchedulerMock(...args),
  listCommercialAutomationExecutions: (...args: unknown[]) => listExecutionsMock(...args),
  listDispatches: (...args: unknown[]) => listDispatchesMock(...args),
  listCommercialCampaigns: (...args: unknown[]) => listCampaignsMock(...args),
  listCommercialCampaignQueue: (...args: unknown[]) => listQueueMock(...args),
}));

const snapshot = {
  totalProducts: 40,
  totalApprovedProducts: 12,
  totalGeneratedCopies: 18,
  totalQueuedDispatches: 3,
  totalSentDispatches: 10,
  totalFailedDispatches: 6,
  totalActiveDestinations: 1,
};

const automationStatus = {
  enabled: true,
  allowed: true,
  reasons: [],
  nextAllowedAt: null,
  globalSentToday: 1,
  globalRemainingToday: 59,
  groupSentToday: 1,
  groupRemainingToday: 59,
  lastSentAt: '2026-08-09T18:30:00.000Z',
  paused: false,
  pausedAt: null,
  resumedAt: null,
  updatedAt: '2026-08-09T18:30:00.000Z',
  allowedStartTime: '08:00',
  allowedEndTime: '23:00',
  timezone: 'America/Sao_Paulo',
  dailyGlobalLimit: 60,
  dailyGroupLimit: 60,
  minimumIntervalMinutes: 14,
  authorizedGroupCount: 1,
};

const scheduler = {
  enabled: true,
  status: 'registered' as const,
  jobId: 'scheduled-commercial-automation',
  queue: 'commercial-automation',
  jobName: 'commercial-automation-tick',
  cron: '*/15 8-22 * * *',
  timezone: 'America/Sao_Paulo',
  nextRunAt: '2026-08-09T22:45:00.000Z',
  mode: 'send' as const,
};

const flush = async () => {
  await act(async () => undefined);
};

beforeEach(() => {
  getAnalyticsMock.mockReset().mockResolvedValue(snapshot);
  getHealthMock.mockReset().mockResolvedValue({ status: 'ok', service: 'api' });
  getAutomationStatusMock.mockReset().mockResolvedValue(automationStatus);
  getAutomationSchedulerMock.mockReset().mockResolvedValue(scheduler);
  listExecutionsMock.mockReset().mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
  listDispatchesMock.mockReset().mockResolvedValue([]);
  listCampaignsMock.mockReset().mockResolvedValue({ items: [{ id: 'campaign-1', name: 'Casa e cozinha', active: true, queueTargetSize: 20 }], page: 1, limit: 20, total: 1, totalPages: 1 });
  listQueueMock.mockReset().mockResolvedValue({ items: [], page: 1, limit: 8, total: 0, totalPages: 1 });
});

describe('OverviewPage', () => {
  it('mostra o pulso operacional e as metricas reais', async () => {
    const screen = await render(<OverviewPage />);
    await flush();
    expect(screen.container.textContent).toContain('AUTOMATION');
    expect(screen.container.textContent).toContain('TODAY');
    expect(screen.container.textContent).toContain('40');
    expect(screen.container.textContent).toContain('Scheduler');
    expect(screen.container.textContent).toContain('Fila pronta');
    await screen.unmount();
  });

  it('renderiza o ultimo envio com o grupo e modo persistidos', async () => {
    listDispatchesMock.mockResolvedValueOnce([{
      id: 'dispatch-1',
      productId: 'product-1',
      generatedCopyId: 'copy-1',
      destinationId: 'group-1',
      status: 'SENT',
      attemptCount: 1,
      deliveryMode: 'IMAGE',
      sentAt: '2026-08-09T18:30:08.000Z',
      destination: { id: 'group-1', name: 'Ofertas da Sho | Achadinhos', destination: 'masked' },
      product: { id: 'product-1', nome: 'Tapioqueira Peneira Polvilhador', preco: 39.9, urlImagem: 'https://example.invalid/image.jpg' },
    }]);
    const screen = await render(<OverviewPage />);
    await flush();
    expect(screen.container.textContent).toContain('Tapioqueira Peneira Polvilhador');
    expect(screen.container.textContent).toContain('Ofertas da Sho | Achadinhos');
    expect(screen.container.textContent).toContain('IMAGE');
    await screen.unmount();
  });

  it('mostra erro acionavel quando o control plane cai', async () => {
    getHealthMock.mockRejectedValueOnce(new Error('API indisponivel'));
    const screen = await render(<OverviewPage />);
    await flush();
    expect(screen.container.textContent).toContain('Estado parcial');
    const retry = Array.from(screen.container.querySelectorAll('button')).find((button) => button.textContent?.includes('Tentar novamente'));
    expect(retry).toBeDefined();
    await click(retry as HTMLButtonElement);
    await flush();
    expect(getHealthMock).toHaveBeenCalledTimes(2);
    await screen.unmount();
  });
});
