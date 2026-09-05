import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '../../test/render';
import WhatsAppPage from './page';

const searchParamsMock = vi.hoisted(() => vi.fn());
const getOperationalAdminMock = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParamsMock(),
}));

vi.mock('../../lib/api', () => ({
  DashboardApiError: class DashboardApiError extends Error {
    code?: string;
  },
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
    expect(screen.container.textContent).not.toContain('WhatsApps cadastrados');
    expect(
      screen.container.querySelector('a[href="/envios"]')?.textContent,
    ).toContain('Ver histórico de envios');

    const groupsLink = screen.container.querySelector('a[href="/whatsapp"]');
    const whatsAppsLink = screen.container.querySelector(
      'a[href="/whatsapp?view=whatsapps"]',
    );
    expect(groupsLink?.getAttribute('aria-current')).toBe('page');
    expect(whatsAppsLink?.getAttribute('aria-current')).toBeNull();
    expect(getOperationalAdminMock).toHaveBeenCalledTimes(1);
    await screen.unmount();
  });

  it('abre a visão diária de WhatsApps sem misturar histórico técnico', async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams('view=whatsapps'));

    const screen = await render(<WhatsAppPage />);

    expect(screen.container.querySelector('h1')?.textContent).toBe('WhatsApps');
    expect(screen.container.textContent).toContain(
      'Acompanhe as instâncias usadas para enviar ofertas aos grupos.',
    );
    expect(screen.container.textContent).toContain('whatsapp-principal');
    expect(screen.container.textContent).toContain('Estado não confirmado');
    expect(screen.container.textContent).not.toContain('Destinos individuais');
    expect(screen.container.textContent).not.toContain('Dispatches');
    expect(screen.container.textContent).not.toContain('External message ID');
    expect(screen.container.textContent).not.toContain('Copy');

    const whatsAppsLink = screen.container.querySelector(
      'a[href="/whatsapp?view=whatsapps"]',
    );
    expect(whatsAppsLink?.getAttribute('aria-current')).toBe('page');
    await screen.unmount();
  });

  it('mantém o histórico em Envios e não expõe assignments na visão diária', async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams('view=whatsapps'));

    const screen = await render(<WhatsAppPage />);

    expect(
      screen.container.querySelector('a[href="/envios"]')?.textContent,
    ).toContain('Ver histórico de envios');
    expect(screen.container.textContent).toContain('Ver grupos');
    expect(screen.container.textContent).not.toContain(
      'Trocar WhatsApp responsável',
    );
    expect(screen.container.textContent).not.toContain('assignment');
    await screen.unmount();
  });

  it('mostra vazio seguro quando não existem instâncias', async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams('view=whatsapps'));
    getOperationalAdminMock.mockResolvedValue({ ...overview, instances: [] });

    const screen = await render(<WhatsAppPage />);

    expect(screen.container.textContent).toContain(
      'Nenhum WhatsApp cadastrado',
    );
    expect(screen.container.textContent).toContain('Cadastrar instância');
    await screen.unmount();
  });
});
