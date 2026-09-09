import React, { act } from 'react';
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
      status: 'READY',
      source: 'PROVIDER_USAGE',
      observedAt: '2026-08-28T12:00:00.000Z',
      usage: {
        dayKey: '2026-08-28',
        shopee: { used: 0, limit: 10, reached: false },
        openAi: { used: 0, limit: 10, reached: false },
      },
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
    {
      name: 'whatsapp-terciario',
      active: true,
      paused: false,
      health: 'UNKNOWN',
      assignedGroupCount: 1,
      lastSendAt: null,
      nextSendAt: null,
      blockers: [],
      updatedAt: '2026-08-28T12:00:00.000Z',
    },
    {
      name: 'whatsapp-reserva',
      active: true,
      paused: false,
      health: 'UNKNOWN',
      assignedGroupCount: 0,
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
      assignedInstanceNames: [
        'whatsapp-principal',
        'whatsapp-secundario',
        'whatsapp-terciario',
      ],
      assignmentRevision: 7,
      upcomingAssignments: [
        {
          scheduledFor: '2026-08-28T13:00:00.000Z',
          instanceName: 'whatsapp-principal',
        },
      ],
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

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const overviewWithGroupAOrder = (
  assignedInstanceNames: string[],
  updatedAt = '2026-08-28T12:30:00.000Z',
) => ({
  ...overview,
  groups: overview.groups.map((group) =>
    group.id === 'group-a-internal'
      ? {
          ...group,
          assignedInstanceName: assignedInstanceNames[0] ?? null,
          assignedInstanceNames,
          assignmentRevision: 8,
          updatedAt,
        }
      : group,
  ),
});

describe('GroupsManagement', () => {
  it('mostra resumo, filtros, dados reais e oculta IDs no primeiro nível', async () => {
    const screen = await render(<GroupsManagement />);
    const cards = screen.container.querySelectorAll('.ops-group-card');

    expect(screen.container.querySelector('h1')?.textContent).toBe('Grupos');
    expect(screen.container.textContent).toContain(
      'Gerencie onde as ofertas serão enviadas e qual WhatsApp é responsável.',
    );
    expect(screen.container.textContent).toContain('Grupos em operação');
    expect(screen.container.textContent).toContain('Grupos pausados');
    expect(screen.container.textContent).toContain('Com pendência');
    expect(screen.container.textContent).toContain('Sem responsável');
    expect(screen.container.textContent).toContain('Casa em oferta');
    expect(screen.container.textContent).toContain('Sem campanha');
    expect(
      screen.container.querySelector(
        'a[href="/campanhas?groupId=group-c-internal"]',
      ),
    ).not.toBeNull();
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
    await change(selects[0], 'whatsapp-terciario');
    expect(cardByName(screen.container, 'Ofertas A')).toBeTruthy();
    expect(cardByName(screen.container, 'Ofertas B')).toBeFalsy();

    await change(selects[0], '');
    await change(selects[1], 'campaign-b');
    expect(
      selects[1].querySelector('option[value="campaign-a"]')?.textContent,
    ).toBe('Casa em oferta');
    expect(
      selects[1].querySelector('option[value="campaign-b"]')?.textContent,
    ).toBe('Beleza em oferta');
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

  it('mantém o resumo persistido enquanto edita um rascunho e envia somente a lista ordenada', async () => {
    const screen = await render(<GroupsManagement />);
    const card = cardByName(screen.container, 'Ofertas A')!;
    await click(
      Array.from(card.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Editar'),
      )!,
    );
    const moveSecondUp = card.querySelector(
      'button[aria-label="Mover whatsapp-secundario para cima"]',
    )!;
    await click(moveSecondUp);
    expect(updateOperationalGroupMock).not.toHaveBeenCalled();
    expect(card.textContent).toContain(
      'Ordem persistida: whatsapp-principal → whatsapp-secundario → whatsapp-terciario',
    );
    expect(card.textContent).toContain('Alterações não salvas');

    await click(
      Array.from(card.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Salvar ordem dos WhatsApps'),
      )!,
    );
    expect(window.confirm).toHaveBeenCalledWith(
      'Alterar a ordem de WhatsApps do grupo Ofertas A? Ordem anterior: whatsapp-principal → whatsapp-secundario → whatsapp-terciario. Nova ordem: whatsapp-secundario → whatsapp-principal → whatsapp-terciario.',
    );
    expect(updateOperationalGroupMock).toHaveBeenCalledWith(
      'group-a-internal',
      {
        assignedInstanceNames: [
          'whatsapp-secundario',
          'whatsapp-principal',
          'whatsapp-terciario',
        ],
        expectedUpdatedAt: '2026-08-28T12:00:00.000Z',
        confirmation: 'CONFIRMAR_REATRIBUICAO_GRUPO',
      },
    );
    await screen.unmount();
  });

  it('adiciona e remove itens no rascunho sem oferecer assignments duplicadas', async () => {
    const screen = await render(<GroupsManagement />);
    const card = cardByName(screen.container, 'Ofertas A')!;
    await click(
      Array.from(card.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Editar'),
      )!,
    );

    const addSelect = card.querySelector(
      'select[aria-label="Adicionar WhatsApp para Ofertas A"]',
    )!;
    expect(
      Array.from(addSelect.querySelectorAll('option')).map(
        (option) => option.value,
      ),
    ).toEqual(['', 'whatsapp-reserva']);
    await change(addSelect, 'whatsapp-reserva');
    await click(
      Array.from(card.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Adicionar',
      )!,
    );
    expect(
      Array.from(card.querySelectorAll<HTMLSelectElement>('select')).some(
        (select) => select.value === 'whatsapp-reserva',
      ),
    ).toBe(true);

    await click(
      card.querySelector('button[aria-label="Remover whatsapp-secundario"]')!,
    );
    expect(
      Array.from(card.querySelectorAll<HTMLSelectElement>('select')).some(
        (select) => select.value === 'whatsapp-secundario',
      ),
    ).toBe(false);
    expect(card.textContent).toContain('Alterações não salvas');
    expect(updateOperationalGroupMock).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it('preserva assignment persistida indisponível sem remover, substituir ou oferecê-la como nova', async () => {
    getOperationalAdminMock.mockResolvedValueOnce({
      ...overview,
      instances: overview.instances.map((instance) =>
        instance.name === 'whatsapp-secundario'
          ? { ...instance, active: false, paused: true }
          : instance,
      ),
    });
    const screen = await render(<GroupsManagement />);
    const card = cardByName(screen.container, 'Ofertas A')!;
    expect(card.textContent).toContain(
      'Ordem persistida: whatsapp-principal → whatsapp-secundario → whatsapp-terciario',
    );
    await click(
      Array.from(card.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Editar'),
      )!,
    );
    const unavailableSelect = Array.from(
      card.querySelectorAll<HTMLSelectElement>('select'),
    ).find((select) => select.value === 'whatsapp-secundario');
    expect(
      unavailableSelect?.querySelector('option[value="whatsapp-secundario"]')
        ?.textContent,
    ).toContain('(indisponível)');
    expect(updateOperationalGroupMock).not.toHaveBeenCalled();
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
    expect(getOperationalAdminMock).toHaveBeenCalledTimes(2);
    expect(screen.container.textContent).toContain(
      'Este grupo foi alterado em outro lugar. Atualize os dados antes de tentar novamente.',
    );
    await screen.unmount();
  });

  it('confirma a alteração mesmo quando a leitura pós-write falha, sem repetir o write', async () => {
    const screen = await render(<GroupsManagement />);
    getOperationalAdminMock.mockRejectedValueOnce(
      new Error('refresh indisponível'),
    );
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
    expect(screen.container.textContent).toContain(
      'Alteração concluída, mas não foi possível atualizar os dados exibidos.',
    );
    expect(screen.container.textContent).toContain(
      'Os dados exibidos podem estar desatualizados.',
    );
    expect(screen.container.textContent).not.toContain('Grupos indisponíveis');
    await screen.unmount();
  });

  it('descarta o rascunho ao fechar o editor e torna a revisão somente leitura', async () => {
    const screen = await render(<GroupsManagement />);
    const card = cardByName(screen.container, 'Ofertas A')!;
    const edit = Array.from(card.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Editar'),
    )!;
    await click(edit);
    await click(
      card.querySelector(
        'button[aria-label="Mover whatsapp-secundario para cima"]',
      )!,
    );
    expect(card.textContent).toContain('Alterações não salvas');
    await click(
      Array.from(card.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Fechar edição'),
      )!,
    );
    await click(
      Array.from(card.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Editar'),
      )!,
    );
    expect(card.textContent).toContain('Igual ao estado persistido');
    expect(card.textContent).toContain('Revisão do roteamento7');
    expect(updateOperationalGroupMock).not.toHaveBeenCalled();
    await screen.unmount();
  });

  it('impede duplo submit e bloqueia nova mutation quando o refresh pós-write falha', async () => {
    const patchResult = deferred<object>();
    updateOperationalGroupMock.mockReturnValueOnce(patchResult.promise);
    const screen = await render(<GroupsManagement />);
    const card = cardByName(screen.container, 'Ofertas A')!;
    await click(
      Array.from(card.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Editar'),
      )!,
    );
    await click(
      card.querySelector(
        'button[aria-label="Mover whatsapp-secundario para cima"]',
      )!,
    );
    const save = Array.from(card.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Salvar ordem dos WhatsApps'),
    )!;
    await act(async () => {
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(updateOperationalGroupMock).toHaveBeenCalledTimes(1);
    getOperationalAdminMock.mockRejectedValueOnce(
      new Error('refresh indisponível'),
    );
    await act(async () => patchResult.resolve({}));
    expect(screen.container.textContent).toContain(
      'Os dados exibidos podem estar desatualizados.',
    );
    expect(save).toHaveProperty('disabled', true);
    await click(save);
    expect(updateOperationalGroupMock).toHaveBeenCalledTimes(1);
    await screen.unmount();
  });

  it('ignora leitura antiga que termina depois do snapshot pós-write', async () => {
    const staleRead = deferred<typeof overview>();
    const currentRead = deferred<ReturnType<typeof overviewWithGroupAOrder>>();
    const screen = await render(<GroupsManagement />);
    getOperationalAdminMock
      .mockImplementationOnce(() => staleRead.promise)
      .mockImplementationOnce(() => currentRead.promise);

    await click(
      Array.from(screen.container.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Atualizar',
      )!,
    );
    const card = cardByName(screen.container, 'Ofertas A')!;
    await click(
      Array.from(card.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Editar'),
      )!,
    );
    await click(
      card.querySelector(
        'button[aria-label="Mover whatsapp-secundario para cima"]',
      )!,
    );
    await click(
      Array.from(card.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Salvar ordem dos WhatsApps'),
      )!,
    );
    await act(async () =>
      currentRead.resolve(
        overviewWithGroupAOrder([
          'whatsapp-secundario',
          'whatsapp-principal',
          'whatsapp-terciario',
        ]),
      ),
    );
    await act(async () => staleRead.resolve(overview));
    expect(cardByName(screen.container, 'Ofertas A')?.textContent).toContain(
      'Ordem persistida: whatsapp-secundario → whatsapp-principal → whatsapp-terciario',
    );
    await screen.unmount();
  });

  it('recarrega o estado do servidor após CAS 409 e exige nova confirmação', async () => {
    updateOperationalGroupMock.mockRejectedValueOnce(
      new DashboardApiErrorMock('conflito', 409, 'OPERATIONAL_CAS_CONFLICT'),
    );
    getOperationalAdminMock
      .mockResolvedValueOnce(overview)
      .mockResolvedValueOnce(
        overviewWithGroupAOrder([
          'whatsapp-secundario',
          'whatsapp-principal',
          'whatsapp-terciario',
        ]),
      );
    const screen = await render(<GroupsManagement />);
    const card = cardByName(screen.container, 'Ofertas A')!;
    await click(
      Array.from(card.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Editar'),
      )!,
    );
    await click(
      card.querySelector('button[aria-label*="para cima"]:not([disabled])')!,
    );
    await click(
      Array.from(card.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Salvar ordem'),
      )!,
    );
    expect(updateOperationalGroupMock).toHaveBeenCalledTimes(1);
    expect(cardByName(screen.container, 'Ofertas A')?.textContent).toContain(
      'Ordem persistida: whatsapp-secundario → whatsapp-principal → whatsapp-terciario',
    );
    expect(screen.container.textContent).toContain('alterado em outro lugar');
    await screen.unmount();
  });

  it('remove o último responsável somente com confirmação específica e sem fallback', async () => {
    const screen = await render(<GroupsManagement />);
    const card = cardByName(screen.container, 'Ofertas B')!;
    await click(
      Array.from(card.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Editar'),
      )!,
    );
    await click(
      card.querySelector('button[aria-label="Remover whatsapp-secundario"]')!,
    );
    await click(
      Array.from(card.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Trocar WhatsApp responsável'),
      )!,
    );
    expect(window.confirm).toHaveBeenCalledWith(
      'Remover o último WhatsApp responsável do grupo Ofertas B? Ordem anterior: whatsapp-secundario. Nova ordem: nenhum. O grupo ficará sem WhatsApp responsável.',
    );
    expect(updateOperationalGroupMock).toHaveBeenCalledWith(
      'group-b-internal',
      {
        assignedInstanceNames: [],
        expectedUpdatedAt: '2026-08-28T12:00:00.000Z',
        confirmation: 'CONFIRMAR_REATRIBUICAO_GRUPO',
      },
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
    await click(
      card.querySelector(
        'button[aria-label="Mover whatsapp-secundario para cima"]',
      )!,
    );
    await click(
      Array.from(card.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Salvar ordem dos WhatsApps'),
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
