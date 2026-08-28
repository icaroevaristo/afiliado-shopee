import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { change, render, submit } from '../../test/render';
import WhatsAppPage from './page';

const listDestinationsMock = vi.fn();
const listDispatchesMock = vi.fn();
const getDispatchMock = vi.fn();
const listWhatsAppGroupsMock = vi.fn();
const getOperationalAdminMock = vi.fn();

vi.mock('../../lib/api', () => ({
  listDestinations: (...args: unknown[]) => listDestinationsMock(...args),
  listDispatches: (...args: unknown[]) => listDispatchesMock(...args),
  getDispatch: (...args: unknown[]) => getDispatchMock(...args),
  listWhatsAppGroups: (...args: unknown[]) => listWhatsAppGroupsMock(...args),
  getOperationalAdmin: (...args: unknown[]) => getOperationalAdminMock(...args),
}));

beforeEach(() => {
  listDestinationsMock.mockReset().mockResolvedValue([]);
  listDispatchesMock.mockReset().mockResolvedValue([]);
  getDispatchMock.mockReset();
  listWhatsAppGroupsMock.mockReset().mockResolvedValue([]);
  getOperationalAdminMock.mockReset().mockResolvedValue({
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
    instances: [],
    groups: [],
  });
});

describe('WhatsAppPage', () => {
  it('aplica filtros de dispatches por leitura', async () => {
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

  it('mostra estado vazio seguro de grupos', async () => {
    const screen = await render(<WhatsAppPage />);
    expect(screen.container.textContent).toContain(
      'Esta conta ainda não participa de nenhum grupo disponível.',
    );
    expect(screen.container.textContent).toContain(
      'Health, próximo envio, último envio e blockers são derivados',
    );
    await screen.unmount();
  });

  it('exibe grupos e destinos com administração separada e identificadores seguros', async () => {
    listWhatsAppGroupsMock.mockResolvedValue([
      {
        id: 'group-1',
        name: 'Grupo controlado',
        fingerprint: 'grp_0123456789ab',
        memberCount: 4,
        ownerIsParticipant: null,
        active: false,
        available: true,
        discoveredAt: '2026-07-24T12:00:00.000Z',
        lastSyncedAt: '2026-07-24T12:00:00.000Z',
        updatedAt: null,
      },
    ]);
    listDestinationsMock.mockResolvedValue([
      {
        id: 'destination-1',
        name: 'Destino controlado',
        destination: 'private-destination',
        active: true,
      },
    ]);

    const screen = await render(<WhatsAppPage />);
    expect(screen.container.textContent).toContain('Grupo controlado');
    expect(screen.container.textContent).toContain('Destino controlado');
    expect(screen.container.textContent).not.toContain('Sincronizar grupos');
    expect(screen.container.textContent).toContain('Administração operacional');
    expect(screen.container.textContent).toContain('Cadastrar instância');
    expect(screen.container.textContent).not.toContain('Novo destino');
    await screen.unmount();
  });

  it('mantem identificadores sensiveis mascarados', async () => {
    listWhatsAppGroupsMock.mockResolvedValue([
      {
        id: 'group-1',
        name: 'Grupo controlado',
        fingerprint: 'grp_0123456789ab',
        memberCount: 4,
        ownerIsParticipant: null,
        active: false,
        available: true,
        discoveredAt: '2026-07-24T12:00:00.000Z',
        lastSyncedAt: '2026-07-24T12:00:00.000Z',
        updatedAt: null,
      },
    ]);
    listDestinationsMock.mockResolvedValue([
      {
        id: 'destination-1',
        name: 'Destino controlado',
        destination: 'private-destination',
        active: true,
      },
    ]);

    const screen = await render(<WhatsAppPage />);
    expect(screen.container.textContent).not.toContain('private-destination');
    expect(screen.container.textContent).not.toContain('@g.us');
    expect(screen.container.textContent).not.toContain('participants');
    await screen.unmount();
  });
});
