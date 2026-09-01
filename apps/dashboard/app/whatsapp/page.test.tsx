import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { change, render, submit } from '../../test/render';
import WhatsAppPage from './page';

const searchParamsMock = vi.hoisted(() => vi.fn());
const listDestinationsMock = vi.fn();
const listDispatchesMock = vi.fn();
const getDispatchMock = vi.fn();
const getOperationalAdminMock = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParamsMock(),
}));

vi.mock('../../lib/api', () => ({
  DashboardApiError: class DashboardApiError extends Error {
    code?: string;
  },
  listDestinations: (...args: unknown[]) => listDestinationsMock(...args),
  listDispatches: (...args: unknown[]) => listDispatchesMock(...args),
  getDispatch: (...args: unknown[]) => getDispatchMock(...args),
  getOperationalAdmin: (...args: unknown[]) => getOperationalAdminMock(...args),
  updateOperationalGroup: vi.fn(),
}));

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
      dailyGlobalLimit: 10,
      dailyGroupLimit: 5,
      maxMessagesPerRun: 1,
    },
    scheduleRevision: 0,
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
  instances: [
    {
      name: 'whatsapp-principal',
      active: true,
      paused: false,
      health: 'UNKNOWN',
      assignedGroupCount: 1,
      lastSendAt: null,
      nextSendAt: null,
      blockers: [],
      updatedAt: '2026-08-28T12:00:00.000Z',
    },
  ],
  groups: [
    {
      id: 'group-1',
      name: 'Ofertas da casa',
      active: true,
      paused: false,
      available: true,
      fingerprint: 'grp_0123456789ab',
      sourceInstanceName: 'whatsapp-principal',
      assignedInstanceName: 'whatsapp-principal',
      campaign: { id: 'campaign-1', name: 'Campanha principal', active: true },
      niche: { id: 'niche-1', name: 'Casa', active: true },
      lastSendAt: '2026-08-28T11:00:00.000Z',
      nextSendAt: '2026-08-28T13:00:00.000Z',
      blockers: [],
      memberCount: 3,
      ownerIsParticipant: true,
      discoveredAt: null,
      lastSyncedAt: null,
      updatedAt: '2026-08-28T12:00:00.000Z',
    },
  ],
  campaigns: [
    {
      id: 'campaign-1',
      name: 'Campanha principal',
      active: true,
      groupId: 'group-1',
      groupName: 'Ofertas da casa',
      instanceName: 'whatsapp-principal',
      niche: { id: 'niche-1', name: 'Casa', active: true },
      lastSendAt: null,
      nextSendAt: null,
      blockers: [],
    },
  ],
};

beforeEach(() => {
  searchParamsMock.mockReset().mockReturnValue(new URLSearchParams());
  listDestinationsMock.mockReset().mockResolvedValue([]);
  listDispatchesMock.mockReset().mockResolvedValue([]);
  getDispatchMock.mockReset();
  getOperationalAdminMock.mockReset().mockResolvedValue(overview);
});

describe('WhatsAppPage', () => {
  it('abre Grupos por padrão com navegação contextual acessível', async () => {
    const screen = await render(<WhatsAppPage />);

    expect(screen.container.querySelector('h1')?.textContent).toBe('Grupos');
    expect(screen.container.textContent).toContain(
      'Gerencie onde as ofertas serão enviadas e qual WhatsApp é responsável.',
    );
    expect(screen.container.textContent).toContain('Ofertas da casa');
    expect(
      screen.container.querySelector('a[href="/envios"]')?.textContent,
    ).toContain('Ver histórico de envios');
    expect(screen.container.textContent).not.toContain('Dispatches');
    expect(screen.container.textContent).not.toContain('Destinos individuais');

    const groupsLink = screen.container.querySelector('a[href="/whatsapp"]');
    const whatsAppsLink = screen.container.querySelector(
      'a[href="/whatsapp?view=whatsapps"]',
    );
    expect(groupsLink?.getAttribute('aria-current')).toBe('page');
    expect(whatsAppsLink?.getAttribute('aria-current')).toBeNull();
    expect(listDestinationsMock).not.toHaveBeenCalled();
    expect(listDispatchesMock).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it('preserva a apresentação de WhatsApps e os filtros técnicos na view legada', async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams('view=whatsapps'));
    listDestinationsMock.mockResolvedValue([
      {
        id: 'destination-1',
        name: 'Destino individual',
        destination: 'private-destination',
        active: true,
      },
    ]);

    const screen = await render(<WhatsAppPage />);
    expect(screen.container.querySelector('h1')?.textContent).toBe('WhatsApps');
    expect(screen.container.textContent).toContain('Instâncias operacionais');
    expect(screen.container.textContent).toContain('Destino individual');
    expect(screen.container.textContent).toContain('Dispatches');
    expect(screen.container.textContent).not.toContain('Ofertas da casa');
    expect(
      screen.container
        .querySelector('a[href="/whatsapp?view=whatsapps"]')
        ?.getAttribute('aria-current'),
    ).toBe('page');
    await screen.unmount();
  });

  it('mantém filtros de dispatch somente na view WhatsApps', async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams('view=whatsapps'));
    const screen = await render(<WhatsAppPage />);
    const form = Array.from(screen.container.querySelectorAll('form')).find(
      (candidate) => candidate.textContent?.includes('Destination ID'),
    ) as HTMLFormElement;
    const statusSelect = form.querySelector('select');
    const productInput = form.querySelectorAll('input')[1];

    await change(statusSelect as HTMLSelectElement, 'FAILED');
    await change(productInput, 'product-1');
    await submit(form);

    expect(listDispatchesMock).toHaveBeenLastCalledWith({
      status: 'FAILED',
      destinationId: '',
      productId: 'product-1',
    });
    await screen.unmount();
  });

  it('mostra vazio seguro quando a leitura administrativa não retorna grupos', async () => {
    getOperationalAdminMock.mockResolvedValue({
      ...overview,
      groups: [],
      campaigns: [],
    });

    const screen = await render(<WhatsAppPage />);
    expect(screen.container.textContent).toContain('Nenhum grupo cadastrado');
    expect(screen.container.textContent).not.toContain('Sincronizar grupos');
    await screen.unmount();
  });
});
