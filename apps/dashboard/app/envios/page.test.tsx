import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render } from '../../test/render';
import type { WhatsAppDispatch } from '../../lib/api';
import SendsPage from './page';

const { listDispatchesMock, listWhatsAppGroupsMock, DashboardApiErrorMock } =
  vi.hoisted(() => ({
    listDispatchesMock: vi.fn(),
    listWhatsAppGroupsMock: vi.fn(),
    DashboardApiErrorMock: class FakeDashboardApiError extends Error {
      constructor(
        message: string,
        public readonly status?: number,
        public readonly code?: string,
      ) {
        super(message);
        this.name = 'DashboardApiError';
      }
    },
  }));

vi.mock('../../lib/api', () => ({
  DashboardApiError: DashboardApiErrorMock,
  listDispatches: (...args: unknown[]) => listDispatchesMock(...args),
  listWhatsAppGroups: (...args: unknown[]) => listWhatsAppGroupsMock(...args),
}));

const makeDispatch = (
  overrides: Partial<WhatsAppDispatch> = {},
): WhatsAppDispatch => ({
  id: 'dispatch-1',
  productId: 'product-1',
  generatedCopyId: 'copy-1',
  destinationId: 'group-1',
  status: 'SENT',
  attemptCount: 1,
  deliveryMode: 'IMAGE',
  provider: 'evolution',
  externalMessageId: 'external-1',
  errorMessage: null,
  sentAt: '2026-08-20T12:00:00.000Z',
  createdAt: '2026-08-20T11:59:00.000Z',
  updatedAt: '2026-08-20T12:00:01.000Z',
  generatedCopy: {
    titulo: 'Copy de teste',
    mensagem: 'Mensagem de teste',
    cta: 'Ver oferta',
    hashtags: '#teste',
    createdFromCandidateId: 'candidate-1',
  },
  destination: {
    id: 'group-1',
    destination: 'destination-private',
  } as unknown as WhatsAppDispatch['destination'],
  product: {
    id: 'product-1',
    nome: 'Produto com um nome suficientemente longo para testar duas linhas',
    preco: '79.90',
    urlImagem: 'https://example.com/product.jpg',
  } as unknown as NonNullable<WhatsAppDispatch['product']>,
  ...overrides,
});

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const buttonWithText = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(text),
  );

beforeEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  listDispatchesMock.mockReset().mockResolvedValue([
    makeDispatch(),
    makeDispatch({
      id: 'dispatch-2',
      status: 'PROCESSING',
      sentAt: null,
      errorMessage: null,
    }),
    makeDispatch({
      id: 'dispatch-3',
      status: 'FAILED',
      sentAt: null,
      errorMessage: 'O provider não confirmou a publicação.',
    }),
    makeDispatch({
      id: 'dispatch-4',
      status: 'PENDING',
      sentAt: null,
      errorMessage: null,
    }),
  ]);
  listWhatsAppGroupsMock.mockReset().mockResolvedValue([
    {
      id: 'group-1',
      name: 'Grupo Casa',
      fingerprint: 'group-fingerprint',
      memberCount: 12,
      ownerIsParticipant: true,
      active: true,
      available: true,
      discoveredAt: '2026-08-20T11:00:00.000Z',
      lastSyncedAt: '2026-08-20T11:00:00.000Z',
      updatedAt: '2026-08-20T11:00:00.000Z',
    },
  ]);
});

describe('SendsPage — Lote 7', () => {
  it('apresenta histórico em linguagem diária e oculta dados técnicos no primeiro nível', async () => {
    const screen = await render(<SendsPage />);
    await settle();

    const firstLevel = [
      screen.container.querySelector('table')?.textContent ?? '',
      ...Array.from(
        screen.container.querySelectorAll('[data-history-card="true"]'),
      ).map((card) => card.textContent ?? ''),
    ]
      .join(' ')
      .replace(/\u00a0/g, ' ');

    expect(screen.container.textContent).toContain('Histórico');
    expect(screen.container.textContent).toContain(
      'Acompanhe os envios realizados e os resultados registrados pelo sistema.',
    );
    expect(buttonWithText(screen.container, 'Todos')).toBeDefined();
    expect(firstLevel).toContain('Enviado');
    expect(firstLevel).toContain('Não enviado');
    expect(firstLevel).toContain('Aguardando envio');
    expect(firstLevel).toContain('Resultado pendente');
    expect(firstLevel).toContain('Grupo Casa');
    expect(firstLevel).toContain('R$ 79,90');
    expect(screen.container.querySelectorAll('img').length).toBeGreaterThan(0);
    expect(
      screen.container.querySelector('[data-history-card="true"]'),
    ).toBeDefined();
    expect(
      screen.container.querySelector(
        '[data-history-card="true"] span.line-clamp-2',
      ),
    ).toBeDefined();
    expect(firstLevel).not.toContain('SENT');
    expect(firstLevel).not.toContain('PROCESSING');
    expect(firstLevel).not.toContain('FAILED');
    expect(firstLevel).not.toContain('dispatch-1');
    expect(firstLevel).not.toContain('evolution');
    expect(screen.container.textContent).not.toContain(
      'registros retornados pela API',
    );
    expect(screen.container.querySelector('details')).toBeNull();
    expect(listDispatchesMock).toHaveBeenCalledWith({});
    await screen.unmount();
  });

  it('distingue lista vazia de erro de leitura', async () => {
    listDispatchesMock.mockResolvedValueOnce([]);
    const empty = await render(<SendsPage />);
    await settle();
    expect(empty.container.textContent).toContain('Nenhum envio encontrado');
    expect(empty.container.textContent).not.toContain('Histórico indisponível');
    await empty.unmount();

    listDispatchesMock.mockRejectedValueOnce(
      new DashboardApiErrorMock('API indisponível', 503, 'API_UNAVAILABLE'),
    );
    const unavailable = await render(<SendsPage />);
    await settle();
    expect(unavailable.container.textContent).toContain(
      'Histórico indisponível',
    );
    expect(unavailable.container.textContent).toContain('API indisponível');
    expect(unavailable.container.textContent).not.toContain(
      'Nenhum envio encontrado',
    );
    await unavailable.unmount();
  });

  it('mantém os filtros reais e envia somente o status selecionado à API', async () => {
    const screen = await render(<SendsPage />);
    await settle();

    await click(buttonWithText(screen.container, 'Enviados')!);
    await settle();

    expect(listDispatchesMock).toHaveBeenLastCalledWith({ status: 'SENT' });
    const selected = buttonWithText(screen.container, 'Enviados')!;
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    await screen.unmount();
  });

  it('não inicia polling automático e oferece apenas atualização manual', async () => {
    const intervalSpy = vi.spyOn(window, 'setInterval');
    const screen = await render(<SendsPage />);
    await settle();

    expect(intervalSpy).not.toHaveBeenCalled();
    expect(buttonWithText(screen.container, 'Atualizar')).toBeDefined();
    await screen.unmount();
  });

  it('preserva a última leitura quando uma atualização falha', async () => {
    const screen = await render(<SendsPage />);
    await settle();
    listDispatchesMock.mockRejectedValueOnce(
      new Error('internal secret detail'),
    );

    await click(buttonWithText(screen.container, 'Atualizar')!);
    await settle();

    expect(screen.container.textContent).toContain('Produto com um nome');
    expect(screen.container.textContent).toContain(
      'Não foi possível atualizar agora. Os dados abaixo são da última leitura.',
    );
    expect(screen.container.textContent).not.toContain(
      'internal secret detail',
    );
    await screen.unmount();
  });

  it('mostra incerteza para PROCESSING sem oferecer retry ou reenvio', async () => {
    listDispatchesMock.mockResolvedValueOnce([
      makeDispatch({
        status: 'PROCESSING',
        sentAt: null,
        errorMessage: null,
      }),
    ]);
    const screen = await render(<SendsPage />);
    await settle();

    const record = screen.container.querySelector(
      'tr[data-history-record]',
    ) as HTMLElement;
    expect(record.textContent).toContain('Resultado pendente');
    expect(record.textContent).toContain('Criado em');
    expect(record.textContent).not.toContain('Tentar novamente');
    expect(record.textContent).not.toContain('Reenviar');
    expect(record.textContent).not.toContain('PROCESSING');

    await click(record);
    const dialog = screen.container.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain(
      'Não foi possível confirmar com segurança se este envio chegou ao destino.',
    );
    expect(dialog.textContent).toContain(
      'Nenhuma nova tentativa é oferecida aqui.',
    );
    expect(dialog.textContent).not.toContain('Tentar novamente');
    expect(dialog.querySelector('details')?.open).toBe(false);
    expect(dialog.querySelector('details')?.textContent).toContain(
      'PROCESSING',
    );
    await screen.unmount();
  });

  it('usa Enviado em somente quando existe sentAt e mantém detalhes técnicos progressivos', async () => {
    listDispatchesMock.mockResolvedValueOnce([makeDispatch()]);
    const screen = await render(<SendsPage />);
    await settle();

    const record = screen.container.querySelector(
      'tr[data-history-record]',
    ) as HTMLElement;
    expect(record.textContent).toContain('Enviado em');
    expect(record.textContent).not.toContain('Criado em');
    await click(record);

    const details = screen.container.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain('candidateId');
    expect(details.textContent).toContain('dispatchId');
    expect(details.textContent).toContain('Provider');
    expect(details.textContent).toContain('evolution');
    await screen.unmount();
  });

  it('abre um diálogo acessível, prende o foco, fecha com Escape e restaura o foco', async () => {
    listDispatchesMock.mockResolvedValueOnce([makeDispatch()]);
    const screen = await render(<SendsPage />);
    await settle();

    const record = screen.container.querySelector(
      'tr[data-history-record]',
    ) as HTMLElement;
    record.focus();
    await click(record);

    const dialog = screen.container.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe(
      'send-history-dialog-title',
    );
    const closeButton = dialog.querySelector(
      '.ops-drawer .ops-icon-button',
    ) as HTMLButtonElement;
    expect(document.activeElement).toBe(closeButton);

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => {
      const closedDetails = element.closest('details:not([open])');
      return !closedDetails || element.matches('summary');
    });
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    last.focus();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    });
    expect(document.activeElement).toBe(first);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(record);
    await screen.unmount();
  });

  it('fecha ao clicar no backdrop sem criar qualquer ação operacional', async () => {
    listDispatchesMock.mockResolvedValueOnce([makeDispatch()]);
    const screen = await render(<SendsPage />);
    await settle();
    await click(screen.container.querySelector('tr[data-history-record]')!);

    const backdrop = screen.container.querySelector(
      '[role="dialog"] > button[aria-label="Fechar detalhes"]',
    )!;
    await click(backdrop);

    expect(screen.container.querySelector('[role="dialog"]')).toBeNull();
    expect(
      Array.from(screen.container.querySelectorAll('button')).some((button) =>
        /retry|reenv|requeue|reprocess/i.test(button.textContent ?? ''),
      ),
    ).toBe(false);
    await screen.unmount();
  });

  it('mantém erro técnico somente no estado avançado e não faz escrita', async () => {
    listDispatchesMock.mockResolvedValueOnce([
      makeDispatch({
        status: 'FAILED',
        sentAt: null,
        errorMessage: 'Falha registrada sem credenciais.',
      }),
    ]);
    const screen = await render(<SendsPage />);
    await settle();

    const record = screen.container.querySelector('tr[data-history-record]')!;
    expect(record.textContent).toContain('Não enviado');
    expect(record.textContent).not.toContain('Falha registrada');
    await click(record);
    expect(
      screen.container.querySelector('[role="dialog"]')?.textContent,
    ).toContain('Falha registrada sem credenciais.');
    expect(listDispatchesMock).toHaveBeenCalledTimes(1);
    await screen.unmount();
  });
});
