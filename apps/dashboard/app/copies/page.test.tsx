import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { click, render } from '../../test/render';
import CopiesPage from './page';

const listMock = vi.fn();

vi.mock('../../lib/api', () => ({
  listCommercialCopyHistory: (...args: unknown[]) => listMock(...args),
}));

const attempt = {
  id: 'attempt-output-invalid',
  candidateId: 'candidate-1',
  snapshotId: 'snapshot-1',
  inputFingerprint: 'fingerprint-long-value',
  provider: 'openai',
  model: 'gpt-5-mini',
  promptVersion: 'copy-v10',
  validationVersion: 'validation-v2',
  status: 'OUTPUT_INVALID',
  generatedCopyId: 'copy-1',
  failureCode: 'COPY_OUTPUT_INVALID',
  validationFailureCodes: ['MISSING_CTA', 'TOO_LONG'],
  requestMayHaveStarted: true,
  inputTokens: 100,
  outputTokens: 40,
  totalTokens: 140,
  startedAt: '2026-08-20T14:00:00.000Z',
  completedAt: '2026-08-20T14:00:01.000Z',
  createdAt: '2026-08-20T14:00:00.000Z',
};

const candidate = {
  id: 'candidate-1',
  campaignId: 'campaign-1',
  campaignName: 'Campanha A',
  productId: 'product-1',
  productName: 'Produto da tentativa',
  status: 'COPY_READY',
};

const page = {
  page: 1,
  limit: 20,
  total: 3,
  totalPages: 2,
  items: [
    {
      kind: 'COPY' as const,
      id: 'copy-1',
      createdAt: '2026-08-20T14:00:02.000Z',
      copy: {
        id: 'copy-1',
        productId: 'product-1',
        productName: 'Produto de copy real',
        source: 'AI',
        provider: 'openai',
        model: 'gpt-5-mini',
        promptVersion: 'copy-v10',
        validationVersion: 'validation-v2',
        inputFingerprint: 'fingerprint-long-value',
        snapshotId: 'snapshot-1',
        createdFromCandidateId: 'candidate-1',
        usageInputTokens: 100,
        usageOutputTokens: 40,
        usageTotalTokens: 140,
        createdAt: '2026-08-20T14:00:02.000Z',
        candidate,
        attempts: [attempt],
        dispatches: [
          {
            id: 'dispatch-1',
            status: 'SENT',
            runId: 'run-1',
            runStatus: 'COMPLETED',
            finalStatus: 'SENT',
          },
        ],
      },
      attempt: null,
      candidate,
    },
    {
      kind: 'ATTEMPT' as const,
      id: 'attempt-ambiguous',
      createdAt: '2026-08-20T13:00:00.000Z',
      copy: null,
      attempt: {
        ...attempt,
        id: 'attempt-ambiguous',
        status: 'AMBIGUOUS',
        generatedCopyId: null,
        validationFailureCodes: [],
        totalTokens: null,
      },
      candidate,
    },
  ],
};

beforeEach(() => {
  listMock.mockReset().mockResolvedValue(page);
});

describe('CopiesPage', () => {
  it('mostra GeneratedCopy persistida, tentativa exata e referencias sem conteudo sensivel', async () => {
    const screen = await render(<CopiesPage />);

    expect(listMock).toHaveBeenCalledWith(1, 20);
    expect(screen.container.textContent).toContain('Produto de copy real');
    expect(screen.container.textContent).toContain('OUTPUT_INVALID');
    expect(screen.container.textContent).toContain('MISSING_CTA, TOO_LONG');
    expect(screen.container.textContent).toContain('100 / 40 / 140');
    expect(screen.container.textContent).toContain('dispatchId: dispatch-1...');
    expect(screen.container.textContent).toContain('runId: run-1...');
    expect(screen.container.textContent).not.toMatch(/mensagem|headers|secret/iu);

    await act(async () => undefined);
    await screen.unmount();
  });

  it('mostra tentativas sem GeneratedCopy sem inventar uma copy', async () => {
    const screen = await render(<CopiesPage />);

    expect(screen.container.textContent).toContain('Tentativa sem copy persistida');
    expect(screen.container.textContent).toContain('SEM GENERATEDCOPY');
    expect(screen.container.textContent).toContain('AMBIGUOUS');
    expect(screen.container.textContent).toContain('Produto da tentativa');
    expect(screen.container.textContent).toContain('productId: product-1...');
    expect(screen.container.textContent).toContain('candidateId: candidate-1...');

    await screen.unmount();
  });

  it('pagina com a mesma consulta GET e trata estado vazio e erro', async () => {
    const secondPage = {
      ...page,
      page: 2,
      items: [
        {
          kind: 'ATTEMPT' as const,
          id: 'attempt-started',
          createdAt: '2026-08-20T12:00:00.000Z',
          copy: null,
          attempt: {
            ...attempt,
            id: 'attempt-started',
            status: 'STARTED',
            generatedCopyId: null,
          },
          candidate,
        },
      ],
    };
    listMock.mockImplementation((requestedPage: number) =>
      Promise.resolve(requestedPage === 2 ? secondPage : page),
    );
    const screen = await render(<CopiesPage />);

    const next = screen.container.querySelector('button[aria-label="Proxima pagina"]');
    expect(next).not.toBeNull();
    if (!next) throw new Error('Botao de proxima pagina nao encontrado.');
    await click(next);

    expect(listMock).toHaveBeenLastCalledWith(2, 20);
    expect(screen.container.textContent).toContain('STARTED');
    await screen.unmount();

    listMock.mockResolvedValueOnce({ ...page, items: [], total: 0, totalPages: 1 });
    const emptyScreen = await render(<CopiesPage />);
    expect(emptyScreen.container.textContent).toContain('Nenhuma copy ou tentativa encontrada');
    await emptyScreen.unmount();

    listMock.mockRejectedValueOnce(new Error('Falha de consulta'));
    const errorScreen = await render(<CopiesPage />);
    expect(errorScreen.container.textContent).toContain('Falha de consulta');
    await errorScreen.unmount();
  });

  it('desabilita a paginacao enquanto a proxima consulta esta pendente', async () => {
    let resolveNextPage: ((value: typeof page) => void) | undefined;
    const nextPage = new Promise<typeof page>((resolve) => {
      resolveNextPage = resolve;
    });
    listMock.mockResolvedValueOnce(page).mockReturnValueOnce(nextPage);
    const screen = await render(<CopiesPage />);

    const next = screen.container.querySelector(
      'button[aria-label="Proxima pagina"]',
    );
    if (!(next instanceof HTMLButtonElement)) {
      throw new Error('Botao de proxima pagina nao encontrado.');
    }
    await click(next);

    expect(next.disabled).toBe(true);
    expect(listMock).toHaveBeenCalledTimes(2);
    if (!resolveNextPage) throw new Error('Consulta pendente nao foi criada.');
    resolveNextPage(page);
    await act(async () => {
      await nextPage;
    });
    await screen.unmount();
  });
});
