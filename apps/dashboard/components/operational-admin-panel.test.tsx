import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { change, click, render, submit } from '../test/render';
import { OperationalAdminPanel } from './operational-admin-panel';

const getOperationalAdminMock = vi.fn();
const createOperationalInstanceMock = vi.fn();
const updateOperationalInstanceMock = vi.fn();
const updateOperationalGroupMock = vi.fn();

vi.mock('../lib/api', () => ({
  DashboardApiError: class DashboardApiError extends Error {
    code?: string;
  },
  getOperationalAdmin: (...args: unknown[]) => getOperationalAdminMock(...args),
  createOperationalInstance: (...args: unknown[]) =>
    createOperationalInstanceMock(...args),
  updateOperationalInstance: (...args: unknown[]) =>
    updateOperationalInstanceMock(...args),
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
      name: 'instance-a',
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
      id: 'group-a',
      name: 'Grupo A',
      active: true,
      paused: false,
      available: true,
      fingerprint: 'grp_aaaaaaaaaaaa',
      sourceInstanceName: 'instance-a',
      assignedInstanceName: 'instance-a',
      campaign: { id: 'campaign-a', name: 'Campanha A', active: true },
      niche: { id: 'niche-a', name: 'Nicho A', active: true },
      lastSendAt: null,
      nextSendAt: null,
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
      id: 'campaign-a',
      name: 'Campanha A',
      active: true,
      groupId: 'group-a',
      groupName: 'Grupo A',
      instanceName: 'instance-a',
      niche: { id: 'niche-a', name: 'Nicho A', active: true },
      lastSendAt: null,
      nextSendAt: null,
      blockers: [],
    },
  ],
};

beforeEach(() => {
  getOperationalAdminMock.mockReset().mockResolvedValue(overview);
  createOperationalInstanceMock.mockReset().mockResolvedValue({});
  updateOperationalInstanceMock.mockReset().mockResolvedValue({});
  updateOperationalGroupMock.mockReset().mockResolvedValue({});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('OperationalAdminPanel', () => {
  it('cadastra instância e exibe sucesso sem expor secrets', async () => {
    const screen = await render(<OperationalAdminPanel />);
    const input = screen.container.querySelector(
      'input[placeholder="afiliado-shopee-local"]',
    );
    const form = input?.closest('form');

    await change(input as HTMLInputElement, 'instance-new');
    await submit(form as HTMLFormElement);

    expect(createOperationalInstanceMock).toHaveBeenCalledWith(
      'instance-new',
      'CONFIRMAR_ALTERACAO_OPERACIONAL',
    );
    expect(screen.container.textContent).toContain('Instância cadastrada');
    expect(screen.container.textContent).not.toContain('EVOLUTION_API_KEY');
    await screen.unmount();
  });

  it('permite remover assignment com confirmação e CAS', async () => {
    const screen = await render(<OperationalAdminPanel />);
    const selects = Array.from(
      screen.container.querySelectorAll('select'),
    ) as HTMLSelectElement[];
    const assignment = selects[4];

    await change(assignment, '');

    expect(updateOperationalGroupMock).toHaveBeenCalledWith('group-a', {
      assignedInstanceName: null,
      expectedUpdatedAt: '2026-08-28T12:00:00.000Z',
      confirmation: 'CONFIRMAR_REATRIBUICAO_GRUPO',
    });
    expect(screen.container.textContent).toContain('Grupo Grupo A atualizado.');
    await screen.unmount();
  });

  it('pode apresentar somente os números na view contextual de WhatsApps', async () => {
    const screen = await render(<OperationalAdminPanel showGroups={false} />);

    expect(screen.container.textContent).toContain('Instâncias operacionais');
    expect(screen.container.textContent).toContain('instance-a');
    expect(screen.container.textContent).not.toContain('Grupos e assignments');
    expect(screen.container.textContent).not.toContain('Grupo A');
    await screen.unmount();
  });

  it('permite reorganizar vários números por slot sem editar um contador', async () => {
    const orderedOverview = {
      ...overview,
      instances: [
        ...overview.instances,
        { ...overview.instances[0], name: 'instance-b' },
      ],
      groups: [
        {
          ...overview.groups[0],
          assignedInstanceNames: ['instance-a', 'instance-b'],
          assignmentRevision: 4,
        },
      ],
    };
    getOperationalAdminMock.mockReset().mockResolvedValue(orderedOverview);
    const screen = await render(<OperationalAdminPanel />);

    await click(
      screen.container.querySelector(
        'button[aria-label="Mover instance-b para cima"]',
      ) as HTMLButtonElement,
    );
    await click(
      Array.from(screen.container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Salvar ordem dos WhatsApps'),
      ) as HTMLButtonElement,
    );

    expect(updateOperationalGroupMock).toHaveBeenCalledWith('group-a', {
      assignedInstanceNames: ['instance-b', 'instance-a'],
      expectedUpdatedAt: '2026-08-28T12:00:00.000Z',
      confirmation: 'CONFIRMAR_REATRIBUICAO_GRUPO',
    });
    await screen.unmount();
  });
});
