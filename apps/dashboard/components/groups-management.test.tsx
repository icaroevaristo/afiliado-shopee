import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { change, click, render } from '../test/render';
import { GroupsManagement } from './groups-management';

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
const updateOperationalGroupMock = vi.fn();

vi.mock('../lib/api', () => ({
  DashboardApiError: DashboardApiErrorMock,
  getOperationalAdmin: (...args: unknown[]) => getOperationalAdminMock(...args),
  updateOperationalGroup: (...args: unknown[]) =>
    updateOperationalGroupMock(...args),
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
  instances: [
    {
      name: 'whatsapp-principal',
      active: true,
      paused: false,
      health: 'UNKNOWN',
      assignedGroupCount: 2,
      lastSendAt: null,
      nextSendAt: null,
      blockers: [],
      updatedAt: '2026-08-28T12:00:00.000Z',
    },
    {
      name: 'whatsapp-secundario',
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
      id: 'group-a-internal',
      name: 'Ofertas A',
      active: true,
      paused: false,
      available: true,
      fingerprint: 'grp_aaaaaaaaaaaa',
      sourceInstanceName: 'whatsapp-principal',
      assignedInstanceName: 'whatsapp-principal',
      campaign: { id: 'campaign-a', name: 'Casa em oferta', active: true },
      niche: { id: 'niche-a', name: 'Casa', active: true },
      lastSendAt: '2026-08-28T11:00:00.000Z',
      nextSendAt: '2026-08-28T13:00:00.000Z',
      blockers: [],
      memberCount: 4,
      ownerIsParticipant: true,
      discoveredAt: null,
      lastSyncedAt: '2026-08-28T10:00:00.000Z',
      updatedAt: '2026-08-28T12:00:00.000Z',
    },
    {
      id: 'group-b-internal',
      name: 'Ofertas B',
      active: true,
      paused: true,
      available: true,
      fingerprint: 'grp_bbbbbbbbbbbb',
      sourceInstanceName: 'whatsapp-secundario',
      assignedInstanceName: 'whatsapp-secundario',
      campaign: { id: 'campaign-b', name: 'Beleza em oferta', active: true },
      niche: { id: 'niche-b', name: 'Beleza', active: true },
      lastSendAt: null,
      nextSendAt: null,
      blockers: [
        {
          scope: 'GROUP' as const,
          code: 'GROUP_PAUSED',
          entityId: 'group-b-internal',
          message: 'O grupo está pausado temporariamente.',
        },
      ],
      memberCount: 2,
      ownerIsParticipant: true,
      discoveredAt: null,
      lastSyncedAt: null,
      updatedAt: '2026-08-28T12:00:00.000Z',
    },
    {
      id: 'group-c-internal',
      name: 'Ofertas C',
      active: false,
      paused: false,
      available: false,
      fingerprint: 'grp_cccccccccccc',
      sourceInstanceName: null,
      assignedInstanceName: null,
      campaign: null,
      niche: null,
      lastSendAt: null,
      nextSendAt: null,
      blockers: [
        {
          scope: 'GROUP' as const,
          code: 'UNEXPECTED_DIRECTORY_STATE',
          entityId: 'group-c-internal',
          message: 'O estado do diretório não foi confirmado.',
        },
      ],
      memberCount: null,
      ownerIsParticipant: null,
      discoveredAt: null,
      lastSyncedAt: null,
      updatedAt: '2026-08-28T12:00:00.000Z',
    },
  ],
  campaigns: [
    {
      id: 'campaign-a',
      name: 'Casa em oferta',
      active: true,
      groupId: 'group-a-internal',
      groupName: 'Ofertas A',
      instanceName: 'whatsapp-principal',
      niche: { id: 'niche-a', name: 'Casa', active: true },
      lastSendAt: null,
      nextSendAt: null,
      blockers: [],
    },
    {
      id: 'campaign-b',
      name: 'Beleza em oferta',
      active: true,
      groupId: 'group-b-internal',
      groupName: 'Ofertas B',
      instanceName: 'whatsapp-secundario',
      niche: { id: 'niche-b', name: 'Beleza', active: true },
      lastSendAt: null,
      nextSendAt: null,
      blockers: [],
    },
  ],
};

beforeEach(() => {
  getOperationalAdminMock.mockReset().mockResolvedValue(overview);
  updateOperationalGroupMock.mockReset().mockResolvedValue({});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const cardByName = (container: HTMLElement, name: string) =>
  Array.from(container.querySelectorAll<HTMLElement>('.ops-group-card')).find(
    (card) => card.querySelector('.ops-card-title')?.textContent === name,
  );

describe('GroupsManagement', () => {
  it('mostra resumo, filtros, dados reais e oculta IDs no primeiro nível', async () => {
    const screen = await render(<GroupsManagement />);
    const cards = screen.container.querySelectorAll('.ops-group-card');

    expect(screen.container.querySelector('h1')?.textContent).toBe('Grupos');
    expect(screen.container.textContent).toContain(
      'Gerencie onde as ofertas serão enviadas e qual WhatsApp é responsável.',
    );
    expect(screen.container.textContent).toContain('Grupos ativos');
    expect(screen.container.textContent).toContain('Grupos pausados');
    expect(screen.container.textContent).toContain('Com pendência');
    expect(screen.container.textContent).toContain('Sem responsável');
    expect(screen.container.textContent).toContain('Casa em oferta');
    expect(screen.container.textContent).toContain('Sem campanha');
    expect(screen.container.textContent).toContain('whatsapp-principal');
    expect(screen.container.textContent).toContain('Não disponível');
    expect(screen.container.textContent).toContain('28/08/2026');
    expect(screen.container.textContent).not.toContain('+55');
    expect(screen.container.textContent).not.toContain('telefone');
    expect(cards).toHaveLength(3);

    const firstDetails = cards[0].querySelector('details');
    expect(firstDetails?.open).toBe(false);
    expect(firstDetails?.textContent).toContain('group-a-internal');
    expect(
      cards[0].querySelector('.ops-group-card-header')?.textContent,
    ).not.toContain('group-a-internal');
    await screen.unmount();
  });

  it('filtra por estado, responsável e campanha sem recalcular routing', async () => {
    const screen = await render(<GroupsManagement />);
    const buttons = Array.from(screen.container.querySelectorAll('button'));
    await click(buttons.find((button) => button.textContent === 'Ativos')!);
    expect(cardByName(screen.container, 'Ofertas A')).toBeTruthy();
    expect(cardByName(screen.container, 'Ofertas B')).toBeFalsy();
    expect(cardByName(screen.container, 'Ofertas C')).toBeFalsy();

    await click(buttons.find((button) => button.textContent === 'Todos')!);
    const selects = screen.container.querySelectorAll('select');
    await change(selects[0], 'whatsapp-secundario');
    expect(cardByName(screen.container, 'Ofertas B')).toBeTruthy();
    expect(cardByName(screen.container, 'Ofertas A')).toBeFalsy();

    await change(selects[1], 'Beleza em oferta');
    expect(selects[1].innerHTML).not.toContain('campaign-a');
    expect(selects[1].innerHTML).not.toContain('campaign-b');
    expect(cardByName(screen.container, 'Ofertas B')).toBeTruthy();
    expect(updateOperationalGroupMock).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it('separa grupos pausados e grupos com pendência nos filtros', async () => {
    const screen = await render(<GroupsManagement />);
    const buttons = Array.from(screen.container.querySelectorAll('button'));

    await click(buttons.find((button) => button.textContent === 'Pausados')!);
    expect(cardByName(screen.container, 'Ofertas B')).toBeTruthy();
    expect(cardByName(screen.container, 'Ofertas A')).toBeFalsy();

    await click(
      buttons.find((button) => button.textContent === 'Com pendência')!,
    );
    expect(cardByName(screen.container, 'Ofertas B')).toBeTruthy();
    expect(cardByName(screen.container, 'Ofertas C')).toBeTruthy();
    expect(cardByName(screen.container, 'Ofertas A')).toBeFalsy();
    await screen.unmount();
  });

  it('traduz pendências conhecidas e desconhecidas sem expor código no resumo', async () => {
    const screen = await render(<GroupsManagement />);
    const pausedCard = cardByName(screen.container, 'Ofertas B');
    const unknownCard = cardByName(screen.container, 'Ofertas C');

    expect(pausedCard?.textContent).toContain('Este grupo está pausado.');
    expect(unknownCard?.textContent).toContain(
      'Existe uma pendência que precisa de atenção.',
    );
    expect(
      pausedCard?.querySelector('.ops-group-card-attention')?.textContent,
    ).not.toContain('GROUP_PAUSED');
    await screen.unmount();
  });

  it('preserva confirmação, CAS e ações de estado', async () => {
    const screen = await render(<GroupsManagement />);
    const card = cardByName(screen.container, 'Ofertas A')!;
    await click(
      Array.from(card.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Editar'),
      )!,
    );
    await click(
      Array.from(card.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Pausar grupo'),
      )!,
    );

    expect(window.confirm).toHaveBeenCalledWith('Pausar o grupo Ofertas A?');
    expect(updateOperationalGroupMock).toHaveBeenCalledWith(
      'group-a-internal',
      {
        paused: true,
        expectedUpdatedAt: '2026-08-28T12:00:00.000Z',
        confirmation: 'CONFIRMAR_PAUSA_OPERACIONAL',
      },
    );
    await screen.unmount();
  });

  it('permite retomar e ativar pelo mesmo contrato administrativo', async () => {
    const screen = await render(<GroupsManagement />);
    const pausedCard = cardByName(screen.container, 'Ofertas B')!;
    await click(
      Array.from(pausedCard.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Editar'),
      )!,
    );
    await click(
      Array.from(pausedCard.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Retomar grupo'),
      )!,
    );
    expect(updateOperationalGroupMock).toHaveBeenCalledWith(
      'group-b-internal',
      {
        paused: false,
        expectedUpdatedAt: '2026-08-28T12:00:00.000Z',
        confirmation: 'CONFIRMAR_PAUSA_OPERACIONAL',
      },
    );

    const inactiveCard = cardByName(screen.container, 'Ofertas C')!;
    await click(
      Array.from(inactiveCard.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Editar'),
      )!,
    );
    await click(
      Array.from(inactiveCard.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Ativar grupo'),
      )!,
    );
    expect(updateOperationalGroupMock).toHaveBeenLastCalledWith(
      'group-c-internal',
      {
        active: true,
        expectedUpdatedAt: '2026-08-28T12:00:00.000Z',
        confirmation: 'CONFIRMAR_ALTERACAO_OPERACIONAL',
      },
    );
    await screen.unmount();
  });

  it('faz a troca de responsável somente após ação explícita e envia expectedUpdatedAt', async () => {
    const screen = await render(<GroupsManagement />);
    const card = cardByName(screen.container, 'Ofertas A')!;
    await click(
      Array.from(card.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Editar'),
      )!,
    );
    const assignment = card.querySelector('select[aria-label]')!;
    await change(assignment, 'whatsapp-secundario');
    expect(updateOperationalGroupMock).not.toHaveBeenCalled();

    await click(
      Array.from(card.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Trocar WhatsApp responsável'),
      )!,
    );
    expect(window.confirm).toHaveBeenCalledWith(
      'Trocar o WhatsApp responsável de whatsapp-principal para whatsapp-secundario no grupo Ofertas A?',
    );
    expect(updateOperationalGroupMock).toHaveBeenCalledWith(
      'group-a-internal',
      {
        assignedInstanceName: 'whatsapp-secundario',
        expectedUpdatedAt: '2026-08-28T12:00:00.000Z',
        confirmation: 'CONFIRMAR_REATRIBUICAO_GRUPO',
      },
    );
    await screen.unmount();
  });

  it('trata CAS 409 sem retry ou sobrescrita', async () => {
    updateOperationalGroupMock.mockRejectedValueOnce(
      new DashboardApiErrorMock('conflito', 409, 'OPERATIONAL_CAS_CONFLICT'),
    );
    const screen = await render(<GroupsManagement />);
    const card = cardByName(screen.container, 'Ofertas A')!;
    await click(
      Array.from(card.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Editar'),
      )!,
    );
    await click(
      Array.from(card.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Pausar grupo'),
      )!,
    );

    expect(updateOperationalGroupMock).toHaveBeenCalledTimes(1);
    expect(getOperationalAdminMock).toHaveBeenCalledTimes(1);
    expect(screen.container.textContent).toContain(
      'Este grupo foi alterado em outro lugar. Atualize os dados antes de tentar novamente.',
    );
    await screen.unmount();
  });

  it('mostra bloqueio de lifecycle sem segunda tentativa', async () => {
    updateOperationalGroupMock.mockRejectedValueOnce(
      new DashboardApiErrorMock(
        'lifecycle ativo',
        409,
        'OPERATIONAL_ASSIGNMENT_LIFECYCLE_ACTIVE',
      ),
    );
    const screen = await render(<GroupsManagement />);
    const card = cardByName(screen.container, 'Ofertas A')!;
    await click(
      Array.from(card.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Editar'),
      )!,
    );
    const assignment = card.querySelector('select[aria-label]')!;
    await change(assignment, 'whatsapp-secundario');
    await click(
      Array.from(card.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Trocar WhatsApp responsável'),
      )!,
    );

    expect(updateOperationalGroupMock).toHaveBeenCalledTimes(1);
    expect(screen.container.textContent).toContain(
      'Há um envio em andamento para este grupo. Aguarde a conclusão antes de trocar o WhatsApp responsável.',
    );
    await screen.unmount();
  });

  it('falha de leitura e lista vazia são estados explícitos sem sync', async () => {
    getOperationalAdminMock.mockRejectedValueOnce(
      new DashboardApiErrorMock(
        'diretório indisponível',
        503,
        'WHATSAPP_GROUP_DIRECTORY_UNAVAILABLE',
      ),
    );
    const screen = await render(<GroupsManagement />);
    expect(screen.container.textContent).toContain(
      'Não foi possível consultar os grupos no WhatsApp agora.',
    );
    expect(screen.container.textContent).not.toContain('Sincronizar');
    await screen.unmount();

    getOperationalAdminMock.mockReset().mockResolvedValue({
      ...overview,
      groups: [],
      campaigns: [],
    });
    const empty = await render(<GroupsManagement />);
    expect(empty.container.textContent).toContain('Nenhum grupo cadastrado');
    await empty.unmount();
  });
});
