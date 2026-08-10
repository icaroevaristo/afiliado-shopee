import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { change, render, submit } from '../../test/render';
import WhatsAppPage from './page';

const listDestinationsMock = vi.fn();
const listDispatchesMock = vi.fn();
const getDispatchMock = vi.fn();
const listWhatsAppGroupsMock = vi.fn();

vi.mock('../../lib/api', () => ({
  listDestinations: (...args: unknown[]) => listDestinationsMock(...args),
  listDispatches: (...args: unknown[]) => listDispatchesMock(...args),
  getDispatch: (...args: unknown[]) => getDispatchMock(...args),
  listWhatsAppGroups: (...args: unknown[]) => listWhatsAppGroupsMock(...args),
}));

beforeEach(() => {
  listDestinationsMock.mockReset().mockResolvedValue([]);
  listDispatchesMock.mockReset().mockResolvedValue([]);
  getDispatchMock.mockReset();
  listWhatsAppGroupsMock.mockReset().mockResolvedValue([]);
});

describe('WhatsAppPage', () => {
  it('aplica filtros de dispatches por leitura', async () => {
    const screen = await render(<WhatsAppPage />);
    const form = screen.container.querySelector('form') as HTMLFormElement;
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
      'não sincroniza, autoriza ou desautoriza destinos',
    );
    await screen.unmount();
  });

  it('exibe grupos e destinos sem controles de mutação', async () => {
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
    expect(screen.container.textContent).not.toContain('Autorizar');
    expect(screen.container.textContent).not.toContain('Desautorizar');
    expect(screen.container.textContent).not.toContain('Novo destino');
    expect(screen.container.textContent).not.toContain('Salvar');
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
