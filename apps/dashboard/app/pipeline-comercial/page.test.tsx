import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render } from '../../test/render';
import CommercialPipelinePage from './page';

const listMock = vi.fn();

vi.mock('../../lib/api', () => ({
  listCommercialPipelineRuns: (...args: unknown[]) => listMock(...args),
}));

const history = {
  id: 'run-safe',
  mode: 'dry-run',
  status: 'completed',
  selectedProduct: {
    id: 'product-safe',
    name: 'Produto ficticio selecionado',
    price: '99.90',
    score: 82,
    affiliateLinkPresent: true,
  },
  selectedGroup: {
    id: 'group-safe',
    name: 'Grupo ficticio autorizado',
    fingerprint: 'grp_123456789abc',
  },
  candidateCount: 3,
  eligibleCount: 1,
  rejectedCount: 2,
  rejectionSummary: {
    MISSING_AFFILIATE_LINK: 1,
    SCORE_BELOW_MINIMUM: 1,
  },
  selectionReasons: ['Maior score elegivel: 82'],
  copyPreview: 'Oferta local para consulta',
  plannedSubIds: ['whatsapp', 'teste-local'],
  failureCode: null,
  confirmedAt: null,
  finalStatus: null,
  dispatchStatus: null,
  attemptCount: 0,
  externalMessageIdRecorded: false,
  investigationRequired: false,
  createdAt: '2026-07-25T12:00:00.000Z',
  completedAt: '2026-07-25T12:00:01.000Z',
  dispatchWasCreated: false,
  jobWasCreated: false,
  messageWasSent: false,
  confirmationAvailable: false,
};

const emptyPage = {
  items: [],
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 1,
};

beforeEach(() => {
  listMock.mockReset().mockResolvedValue({
    items: [history],
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
  });
});

describe('CommercialPipelinePage', () => {
  it('mostra loading e depois o historico somente leitura', async () => {
    let release: (value: unknown) => void = () => undefined;
    listMock.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const screen = await render(<CommercialPipelinePage />);
    expect(screen.container.textContent).toContain('Carregando histórico');
    await act(async () => {
      release({ items: [history], page: 1, limit: 20, total: 1, totalPages: 1 });
    });
    expect(screen.container.textContent).toContain('Produto ficticio selecionado');
    expect(screen.container.textContent).not.toContain('Confirmar envio');
    expect(screen.container.textContent).not.toContain('Executar dry-run');
    await screen.unmount();
  });

  it('consulta o endpoint de historico sem executar acoes comerciais', async () => {
    const screen = await render(<CommercialPipelinePage />);

    expect(listMock).toHaveBeenCalledWith(1, 20);
    expect(screen.container.textContent).toContain('Grupo ficticio autorizado');
    expect(screen.container.textContent).toContain('Oferta local para consulta');
    expect(screen.container.textContent).toContain('grp_123456789abc');
    expect(screen.container.textContent).toContain('somente leitura');
    expect(screen.container.textContent).not.toContain('Enviar mensagem');
    expect(screen.container.textContent).not.toContain('Confirmar envio real');
    await screen.unmount();
  });

  it('mostra estado vazio real', async () => {
    listMock.mockResolvedValueOnce(emptyPage);
    const screen = await render(<CommercialPipelinePage />);
    expect(screen.container.textContent).toContain('Nenhuma execução registrada');
    await screen.unmount();
  });

  it('mostra erro e permite retry de leitura', async () => {
    listMock
      .mockRejectedValueOnce(new Error('API indisponivel'))
      .mockResolvedValueOnce(emptyPage);

    const screen = await render(<CommercialPipelinePage />);
    expect(screen.container.textContent).toContain('API indisponivel');
    const retry = Array.from(screen.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Tentar novamente',
    );
    expect(retry).not.toBeUndefined();
    await click(retry as HTMLButtonElement);
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(screen.container.textContent).toContain('Nenhuma execução registrada');
    await screen.unmount();
  });
});
