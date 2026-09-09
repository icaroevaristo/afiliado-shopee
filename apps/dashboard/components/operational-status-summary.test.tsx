import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { click, render } from '../test/render';
import { OperationalStatusSummary } from './operational-status-summary';

const getOperationalAdminMock = vi.fn();

vi.mock('../lib/api', () => ({
  getOperationalAdmin: (...args: unknown[]) => getOperationalAdminMock(...args),
}));

const overview = {
  nextSendAt: null,
  lastSendAt: null,
  activeExecutions: 0,
  activeReservations: 0,
  pendingDispatches: 0,
  pendingOutboxes: 0,
  ambiguity: 0,
  investigationRequired: 0,
  blockers: [
    {
      scope: 'GLOBAL' as const,
      code: 'QUEUE_HEALTH_UNKNOWN',
      entityId: 'product-pipeline',
      message: 'Fila não medida.',
      source: 'QUEUE' as const,
      observedAt: '2026-09-09T12:00:00.000Z',
    },
  ],
  queues: {
    productPipeline: {
      status: 'UNKNOWN' as const,
      source: 'QUEUE' as const,
      observedAt: '2026-09-09T12:00:00.000Z',
      counts: null,
    },
    whatsappDispatch: {
      status: 'READY' as const,
      source: 'QUEUE' as const,
      observedAt: '2026-09-09T12:00:00.000Z',
      counts: { waiting: 0, active: 0, delayed: 0, prioritized: 0 },
    },
    commercialAutomation: {
      status: 'UNAVAILABLE' as const,
      source: 'QUEUE' as const,
      observedAt: '2026-09-09T12:00:00.000Z',
      counts: null,
    },
  },
  readiness: {
    controlPlane: {
      status: 'READY' as const,
      source: 'AUTHENTICATED_API' as const,
      observedAt: '2026-09-09T12:00:00.000Z',
      message: 'Autenticado.',
    },
    queues: {
      status: 'UNKNOWN' as const,
      source: 'QUEUE' as const,
      observedAt: '2026-09-09T12:00:00.000Z',
      message: 'Sem medição.',
    },
    scheduler: {
      status: 'UNKNOWN' as const,
      source: 'SCHEDULER' as const,
      observedAt: '2026-09-09T12:00:00.000Z',
      message: 'Sem fonte de scheduler.',
    },
    instanceConnectivity: {
      status: 'UNKNOWN' as const,
      source: 'INSTANCE_HEALTH' as const,
      observedAt: '2026-09-09T12:00:00.000Z',
      message: 'Sem heartbeat.',
    },
    providerConfiguration: {
      status: 'UNKNOWN' as const,
      source: 'PROVIDER_CONFIGURATION' as const,
      observedAt: '2026-09-09T12:00:00.000Z',
      message: 'Sem fonte de provider.',
    },
    commercial: {
      status: 'NOT_READY' as const,
      source: 'POLICY' as const,
      observedAt: '2026-09-09T12:00:00.000Z',
      message: 'Pausado.',
    },
    send: {
      status: 'NOT_READY' as const,
      source: 'PROVIDER_CONFIGURATION' as const,
      observedAt: '2026-09-09T12:00:00.000Z',
      message: 'Bloqueado.',
    },
  },
  campaigns: [],
};

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('OperationalStatusSummary', () => {
  beforeEach(() => {
    getOperationalAdminMock.mockReset().mockResolvedValue(overview);
  });

  it('preserva fila não medida como UNKNOWN em vez de zero', async () => {
    const screen = await render(<OperationalStatusSummary />);
    await settle();

    expect(screen.container.textContent).toContain(
      'pipeline UNKNOWN (não medido)',
    );
    expect(screen.container.textContent).toContain(
      'automação UNAVAILABLE (não medido)',
    );
    expect(screen.container.textContent).toContain('send NOT_READY');
    await screen.unmount();
  });

  it('mostra indisponibilidade e permite uma atualização manual bounded', async () => {
    getOperationalAdminMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(overview);
    const screen = await render(<OperationalStatusSummary />);
    await settle();

    expect(screen.container.textContent).toContain(
      'O snapshot operacional está indisponível',
    );
    const refresh = Array.from(
      screen.container.querySelectorAll('button'),
    ).find((button) => button.textContent === 'Atualizar status');
    expect(refresh).toBeDefined();
    await click(refresh!);
    await settle();

    expect(getOperationalAdminMock).toHaveBeenCalledTimes(2);
    expect(screen.container.textContent).toContain(
      'Estado operacional centralizado',
    );
    await screen.unmount();
  });

  it('marca snapshot anterior como stale quando o refresh posterior falha', async () => {
    getOperationalAdminMock
      .mockResolvedValueOnce(overview)
      .mockRejectedValueOnce(new Error('offline'));
    const screen = await render(<OperationalStatusSummary />);
    await settle();

    const refresh = Array.from(
      screen.container.querySelectorAll('button'),
    ).find((button) => button.textContent === 'Atualizar status');
    expect(refresh).toBeDefined();
    await click(refresh!);
    await settle();

    expect(screen.container.textContent).toContain(
      'O último snapshot permanece visível, mas a atualização atual falhou.',
    );
    expect(screen.container.textContent).toContain(
      'pipeline UNKNOWN (não medido)',
    );
    await screen.unmount();
  });
});
