import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { click, render } from '../../test/render';
import LifecyclePage from './page';

const listMock = vi.fn();

vi.mock('../../lib/api', () => ({
  listCommercialLifecycles: (...args: unknown[]) => listMock(...args),
}));

const lifecycle = {
  lifecycleId: 'run-sent',
  createdAt: '2026-08-20T14:00:00.000Z',
  execution: {
    id: 'execution-sent',
    bullMqJobId: null,
    mode: 'SEND',
    status: 'QUEUED',
    externalStage: 'EXTERNAL_MAY_HAVE_STARTED',
    commercialRunId: 'run-sent',
    failureCode: null,
    leaseExpiresAt: '2026-08-20T16:00:00.000Z',
    startedAt: '2026-08-20T13:59:00.000Z',
    completedAt: '2026-08-20T14:01:00.000Z',
  },
  run: {
    id: 'run-sent',
    executionId: 'execution-sent',
    mode: 'CONFIRMED',
    status: 'COMPLETED',
    productId: 'product-1',
    productName: 'Produto Lifecycle',
    productPrice: '39.90',
    groupDestinationId: 'destination-1',
    groupName: 'Grupo Lifecycle',
    groupFingerprint: 'fingerprint-1',
    score: 88,
    candidateCount: 1,
    eligibleCount: 1,
    rejectedCount: 0,
    dispatchId: 'dispatch-1',
    jobId: 'job-1',
    confirmedAt: '2026-08-20T14:00:30.000Z',
    finalStatus: 'SENT',
    investigationRequired: false,
    failureCode: null,
    createdAt: '2026-08-20T14:00:00.000Z',
    completedAt: '2026-08-20T14:01:00.000Z',
  },
  candidate: {
    id: 'candidate-1',
    campaignId: 'campaign-1',
    campaignName: 'Campanha Lifecycle',
    productId: 'product-1',
    productName: 'Produto Lifecycle',
    providerProductId: 'provider-1',
    status: 'DISPATCHED',
    rankPosition: 1,
    score: 88,
    scorePolicyVersion: 'official-v2',
    createdAt: '2026-08-20T13:50:00.000Z',
    updatedAt: '2026-08-20T14:01:00.000Z',
  },
  copy: {
    id: 'copy-1',
    productId: 'product-1',
    snapshotId: 'snapshot-1',
    createdFromCandidateId: 'candidate-1',
    source: 'AI',
    createdAt: '2026-08-20T13:55:00.000Z',
  },
  copyAttempt: {
    id: 'attempt-1',
    status: 'SUCCEEDED',
    failureCode: null,
    requestMayHaveStarted: true,
    startedAt: '2026-08-20T13:54:00.000Z',
    completedAt: '2026-08-20T13:55:00.000Z',
  },
  dispatch: {
    id: 'dispatch-1',
    destinationId: 'destination-1',
    destinationName: 'Grupo Lifecycle',
    destinationFingerprint: 'fingerprint-1',
    status: 'SENT',
    attemptCount: 2,
    externalMessageId: 'external-message-1',
    errorMessage: null,
    sentAt: '2026-08-20T14:01:00.000Z',
    createdAt: '2026-08-20T14:00:40.000Z',
    updatedAt: '2026-08-20T14:01:00.000Z',
  },
  outbox: {
    id: 'outbox-1',
    dispatchId: 'dispatch-1',
    jobId: 'job-1',
    status: 'PUBLISHED',
    failureCode: null,
    createdAt: '2026-08-20T14:00:35.000Z',
    publishedAt: '2026-08-20T14:00:40.000Z',
  },
  reservation: {
    campaignId: 'campaign-1',
    campaignName: 'Campanha Lifecycle',
    attemptExecutionId: 'execution-sent',
    attemptReservedAt: '2026-08-20T13:50:00.000Z',
    attemptLeaseExpiresAt: '2026-08-20T16:00:00.000Z',
    state: 'ACTIVE',
  },
  recovery: null,
  bullmq: {
    queue: 'whatsapp-dispatch',
    jobId: 'job-1',
    state: 'completed',
    attemptsMade: 2,
    processedOn: '2026-08-20T14:00:45.000Z',
    finishedOn: '2026-08-20T14:01:00.000Z',
    failedReason: null,
  },
  timeline: [
    {
      type: 'EXECUTION_CREATED',
      label: 'Execucao criada',
      at: '2026-08-20T13:59:00.000Z',
    },
    {
      type: 'RUN_CREATED',
      label: 'Run criado',
      at: '2026-08-20T14:00:00.000Z',
    },
    {
      type: 'FINALIZED',
      label: 'Lifecycle finalizado',
      at: '2026-08-20T14:01:00.000Z',
    },
  ],
};

const page = {
  items: [lifecycle],
  page: 1,
  limit: 25,
  total: 1,
  totalPages: 1,
  summary: {
    activeExecutions: 1,
    sentToday: 1,
    failed: 0,
    ambiguous: 0,
    investigationRequired: 0,
    activeReservations: 1,
    pendingDispatches: 0,
    pendingOutboxes: 0,
    manualRecoveries: 0,
    jobs: { waiting: 0, active: 0, failed: 0 },
  },
};

const ambiguousPartialLifecycle = {
  ...lifecycle,
  lifecycleId: 'run-ambiguous',
  createdAt: '2026-08-20T15:00:00.000Z',
  execution: {
    ...lifecycle.execution,
    id: 'execution-ambiguous',
    status: 'PROCESSING',
    commercialRunId: 'run-ambiguous',
    completedAt: null,
  },
  run: {
    ...lifecycle.run,
    id: 'run-ambiguous',
    executionId: 'execution-ambiguous',
    finalStatus: 'AMBIGUOUS',
    investigationRequired: true,
  },
  copy: null,
  dispatch: null,
  outbox: null,
  reservation: {
    ...lifecycle.reservation,
    attemptExecutionId: 'execution-ambiguous',
    state: 'UNKNOWN',
  },
  recovery: {
    id: 'recovery-1',
    dispatchId: 'dispatch-ambiguous',
    runId: 'run-ambiguous',
    executionId: 'execution-ambiguous',
    candidateId: 'candidate-ambiguous',
    campaignId: 'campaign-1',
    jobId: 'job-ambiguous',
    decision: 'MANUAL_REARM',
    attemptCountObserved: 2,
    authorizedAt: '2026-08-20T15:01:00.000Z',
    rearmedAt: '2026-08-20T15:02:00.000Z',
    requeuedAt: null,
  },
  bullmq: null,
};

beforeEach(() => {
  listMock.mockReset().mockResolvedValue(page);
});

describe('LifecyclePage', () => {
  it('mostra lifecycle completo e timeline sem acoes de escrita', async () => {
    const screen = await render(<LifecyclePage />);

    expect(screen.container.textContent).toContain('Produto Lifecycle');
    expect(screen.container.textContent).toContain('Timeline comprovada');
    expect(screen.container.textContent).toContain('Outbox');
    expect(screen.container.textContent).toContain('whatsapp-dispatch');
    expect(screen.container.textContent).toContain('SENT hoje');
    expect(screen.container.textContent).toContain('Cadeia do lifecycle');
    expect(screen.container.textContent).toContain('RESERVA ATIVA');
    expect(screen.container.textContent).toContain('PRESENTE');
    expect(screen.container.textContent).not.toMatch(
      /autorizar|requeue|enviar mensagem|retry/iu,
    );
    expect(listMock).toHaveBeenCalledWith(1, 25);

    await act(async () => undefined);
    await screen.unmount();
  });

  it('destaca sinais críticos, recovery e presença parcial da cadeia', async () => {
    listMock.mockResolvedValueOnce({
      ...page,
      items: [ambiguousPartialLifecycle],
      summary: {
        ...page.summary,
        ambiguous: 1,
        investigationRequired: 1,
        manualRecoveries: 1,
        activeReservations: 0,
      },
    });
    const screen = await render(<LifecyclePage />);

    expect(screen.container.textContent).toContain('AMBIGUOUS');
    expect(screen.container.textContent).toContain('PROCESSING');
    expect(screen.container.textContent).toContain('INVESTIGACAO NECESSARIA');
    expect(screen.container.textContent).toContain('RECOVERY');
    expect(screen.container.textContent).toContain('RESERVA DESCONHECIDA');
    expect(screen.container.textContent).toContain('DESCONHECIDO');
    expect(screen.container.textContent).toContain('Decisao');
    expect(screen.container.textContent).toContain('MANUAL_REARM');
    expect(screen.container.textContent).toContain('Tentativas observadas');
    expect(screen.container.textContent).toContain('Rearmado');
    expect(screen.container.textContent).toContain('Copy');
    expect(screen.container.textContent).toContain('AUSENTE');
    expect(screen.container.textContent).not.toMatch(
      /autorizar|requeue|enviar mensagem|retry/iu,
    );

    await screen.unmount();
  });

  it('navega entre páginas usando somente a consulta GET da lista', async () => {
    const firstPage = {
      ...page,
      total: 26,
      totalPages: 2,
    };
    const secondPage = {
      ...page,
      page: 2,
      total: 26,
      totalPages: 2,
      items: [
        {
          ...lifecycle,
          lifecycleId: 'run-page-2',
          run: {
            ...lifecycle.run,
            id: 'run-page-2',
            productName: 'Produto Lifecycle pagina 2',
          },
          candidate: {
            ...lifecycle.candidate,
            productName: 'Produto Lifecycle pagina 2',
          },
        },
      ],
    };
    listMock.mockImplementation((requestedPage: number) =>
      Promise.resolve(requestedPage === 2 ? secondPage : firstPage),
    );
    const screen = await render(<LifecyclePage />);

    expect(screen.container.textContent).toContain('Página 1 de 2');
    const next = screen.container.querySelector(
      'button[aria-label="Próxima página"]',
    );
    expect(next).not.toBeNull();
    if (!next) throw new Error('Botão de próxima página não encontrado.');

    await click(next);

    expect(listMock).toHaveBeenLastCalledWith(2, 25);
    expect(screen.container.textContent).toContain('Página 2 de 2');
    expect(screen.container.textContent).toContain(
      'Produto Lifecycle pagina 2',
    );

    const previous = screen.container.querySelector(
      'button[aria-label="Página anterior"]',
    );
    expect(previous).not.toBeNull();
    if (!previous) throw new Error('Botão de página anterior não encontrado.');

    await click(previous);

    expect(listMock).toHaveBeenLastCalledWith(1, 25);
    expect(screen.container.textContent).toContain('Página 1 de 2');
    await screen.unmount();
  });

  it('mostra estado vazio sem criar acao operacional', async () => {
    listMock.mockResolvedValueOnce({
      ...page,
      items: [],
      total: 0,
      totalPages: 1,
    });
    const screen = await render(<LifecyclePage />);

    expect(screen.container.textContent).toContain(
      'Nenhum lifecycle encontrado',
    );
    expect(screen.container.textContent).not.toMatch(
      /autorizar|requeue|send/iu,
    );
    await screen.unmount();
  });
});
