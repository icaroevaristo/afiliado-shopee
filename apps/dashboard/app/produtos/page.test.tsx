import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { change, click, render, submit } from '../../test/render';
import ProductsPage from './page';

const listMock = vi.fn();
const categoriesMock = vi.fn();

vi.mock('../../lib/api', () => ({
  listShopeeOffers: (...args: unknown[]) => listMock(...args),
  listShopeeCategories: (...args: unknown[]) => categoriesMock(...args),
}));

const offer = {
  id: 'offer-1',
  source: 'MOCK',
  providerProductId: 'mock-1',
  productName: 'Produto ficticio',
  shopName: 'Loja ficticia',
  categoryIds: ['100001'],
  price: '99.90',
  priceMin: '99.90',
  priceMax: '99.90',
  referencePrice: null,
  referencePriceUnavailableReason: 'OFFICIAL_REFERENCE_PRICE_NOT_AVAILABLE',
  discountRate: 20,
  rating: 4.8,
  sales: 1000,
  commissionRate: 8,
  imageUrl: 'https://example.invalid/image.jpg',
  productLink: 'https://example.invalid/product',
  affiliateLink: 'https://example.invalid/affiliate',
  affiliateLinkPresent: true,
  fetchedAt: '2026-07-24T00:00:00.000Z',
  lastSeenAt: '2026-07-24T00:00:00.000Z',
  score: 80,
  scoreUpdatedAt: null,
  createdAt: '2026-07-24T00:00:00.000Z',
  updatedAt: '2026-07-24T00:00:00.000Z',
  status: 'ACTIVE',
  commercialSnapshotRevision: 1,
  commercialSnapshotFingerprint: 'fingerprint-1',
  snapshot: null,
  capturedAt: '2026-07-24T00:00:00.000Z',
  capturedAtSource: 'FALLBACK_FETCHED_AT',
  commercialScores: [],
  bestCurrentCommercialScore: 82,
  commercialStateSummary: {
    currentCandidateCount: 0,
    queued: 0,
    copyReady: 0,
    reserved: 0,
    dispatched: 0,
    blocked: 0,
    expired: 0,
    bestCurrentCommercialScore: null,
  },
  everSent: false,
  sentDestinationCount: 0,
  lastSentAt: null,
  destinationDelivery: null,
};

beforeEach(() => {
  listMock.mockReset().mockResolvedValue({
    provider: 'official',
    items: [offer],
    page: 1,
    limit: 12,
    total: 1,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
    flashDealCapability: {
      status: 'UNSUPPORTED_CURRENT_PROVIDER_CONTRACT',
      reasonCode: 'OFFICIAL_SIGNAL_NOT_AVAILABLE',
    },
  });
  categoriesMock.mockReset().mockResolvedValue({
    hierarchyStatus: 'NOT_AVAILABLE_FROM_CURRENT_PROVIDER_CONTRACT',
    items: [
      {
        id: '100001',
        name: null,
        parentId: null,
        mappingSource: 'OFFICIAL_PRODUCT_CATEGORY_ID',
        productCount: 1,
        displayLabel: 'Casa e cozinha',
      },
    ],
  });
});

describe('ProductsPage', () => {
  it('exibe o catalogo real da API em modo somente leitura', async () => {
    const screen = await render(<ProductsPage />);

    expect(screen.container.textContent).toContain('Produto ficticio');
    expect(screen.container.textContent).toContain('Ofertas relâmpago');
    expect(screen.container.textContent).toContain('Casa e cozinha');
    expect(screen.container.textContent).toContain('Vendas');
    expect(screen.container.textContent).toContain('Score');
    expect(screen.container.textContent).toContain('82');
    expect(screen.container.textContent).toContain('Avaliação');
    expect(screen.container.textContent).toContain('Preço atual');
    expect(screen.container.textContent).toContain('Ver detalhes');
    expect(
      screen.container.querySelector('nav[aria-label="Navegação de ofertas"]'),
    ).not.toBeNull();
    expect(screen.container.querySelector('.offers-table-wrap')).not.toBeNull();
    expect(
      screen.container.querySelector('.offers-mobile-list'),
    ).not.toBeNull();
    expect(screen.container.querySelectorAll('th[scope="col"]').length).toBe(
      11,
    );
    expect(
      screen.container.querySelector('[title="Link afiliado disponível"]'),
    ).not.toBeNull();
    expect(screen.container.textContent).toContain('Ainda não enviado');
    expect(screen.container.textContent).not.toContain('Provider atual');
    expect(screen.container.textContent).not.toContain('fingerprint-1');
    expect(screen.container.textContent).not.toContain('mock-1');
    expect(screen.container.textContent).not.toContain('Sincronizar ofertas');
    expect(screen.container.textContent).not.toContain('Importacao manual');
    expect(screen.container.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.invalid/image.jpg',
    );
    expect(listMock).toHaveBeenCalledTimes(1);

    await screen.unmount();
  });

  it('mantém o resultado anterior e oferece retry quando a atualização falha', async () => {
    listMock
      .mockResolvedValueOnce({
        provider: 'official',
        items: [offer],
        page: 1,
        limit: 12,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
        flashDealCapability: {
          status: 'UNSUPPORTED_CURRENT_PROVIDER_CONTRACT',
          reasonCode: 'OFFICIAL_SIGNAL_NOT_AVAILABLE',
        },
      })
      .mockRejectedValueOnce(new Error('temporarily offline'))
      .mockResolvedValueOnce({
        provider: 'official',
        items: [offer],
        page: 1,
        limit: 12,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
        flashDealCapability: {
          status: 'UNSUPPORTED_CURRENT_PROVIDER_CONTRACT',
          reasonCode: 'OFFICIAL_SIGNAL_NOT_AVAILABLE',
        },
      });
    const screen = await render(<ProductsPage />);
    const quickFilter = Array.from(
      screen.container.querySelectorAll('button'),
    ).find((button) => button.textContent === 'Mais vendidas');

    expect(quickFilter).toBeDefined();
    await click(quickFilter as HTMLButtonElement);
    const refresh = Array.from(
      screen.container.querySelectorAll('button'),
    ).find((button) => button.textContent === 'Atualizar');
    expect(refresh).toBeDefined();
    expect(screen.container.textContent).toContain('temporarily offline');
    expect(screen.container.textContent).toContain('Produto ficticio');
    await click(refresh as HTMLButtonElement);
    expect(screen.container.textContent).toContain('Produto ficticio');
    expect(screen.container.textContent).not.toContain('temporarily offline');
    await screen.unmount();
  });

  it('mapeia atalho de mais vendidas para a ordenação suportada', async () => {
    const screen = await render(<ProductsPage />);
    const button = Array.from(screen.container.querySelectorAll('button')).find(
      (item) => item.textContent === 'Mais vendidas',
    );

    expect(button).toBeDefined();
    await click(button as HTMLButtonElement);

    expect(listMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: 'sales_desc', page: 1 }),
    );
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    await screen.unmount();
  });

  it('mantém a oferta visível quando o registro de categorias falha', async () => {
    categoriesMock.mockReset().mockRejectedValue(new Error('offline'));
    const screen = await render(<ProductsPage />);

    expect(screen.container.textContent).toContain('Produto ficticio');
    expect(screen.container.textContent).toContain('Categorias indisponíveis');
    expect(screen.container.textContent).toContain('Categoria indisponível');
    expect(screen.container.textContent).not.toContain('100001');
    await screen.unmount();
  });

  it('não transforma score ausente em zero', async () => {
    listMock.mockResolvedValueOnce({
      provider: 'official',
      items: [{ ...offer, bestCurrentCommercialScore: null }],
      page: 1,
      limit: 12,
      total: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
      flashDealCapability: {
        status: 'UNSUPPORTED_CURRENT_PROVIDER_CONTRACT',
        reasonCode: 'OFFICIAL_SIGNAL_NOT_AVAILABLE',
      },
    });
    const screen = await render(<ProductsPage />);

    const row = screen.container.querySelector('.offers-table tbody tr');
    expect(row?.querySelectorAll('td')[4]?.textContent?.trim()).toBe('—');
    expect(row?.textContent).not.toContain('Score 0');
    await screen.unmount();
  });

  it('mostra faixa de preço observada sem inventar preço de referência', async () => {
    listMock.mockResolvedValueOnce({
      provider: 'official',
      items: [
        {
          ...offer,
          priceMin: '80.00',
          priceMax: '99.90',
        },
      ],
      page: 1,
      limit: 12,
      total: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
      flashDealCapability: {
        status: 'UNSUPPORTED_CURRENT_PROVIDER_CONTRACT',
        reasonCode: 'OFFICIAL_SIGNAL_NOT_AVAILABLE',
      },
    });
    const screen = await render(<ProductsPage />);
    const text = screen.container.textContent?.replace(/\u00a0/g, ' ') ?? '';

    expect(text).toContain('Faixa observada:');
    expect(text).toContain('R$ 80,00');
    expect(text).toContain('R$ 99,90');
    expect(text).not.toContain('Preço de referência');
    await screen.unmount();
  });

  it('não expõe o ID quando a categoria não tem nome utilizável', async () => {
    categoriesMock.mockReset().mockResolvedValue({
      hierarchyStatus: 'NOT_AVAILABLE_FROM_CURRENT_PROVIDER_CONTRACT',
      items: [
        {
          id: '100001',
          name: null,
          parentId: null,
          mappingSource: 'OFFICIAL_PRODUCT_CATEGORY_ID',
          productCount: 1,
          displayLabel: 'Categoria 100001',
        },
      ],
    });
    const screen = await render(<ProductsPage />);

    expect(screen.container.textContent).toContain('Categoria não disponível');
    expect(screen.container.textContent).not.toContain('100001');
    await screen.unmount();
  });

  it('mostra bloqueio comercial sem mascará-lo como preparação', async () => {
    listMock.mockResolvedValueOnce({
      provider: 'official',
      items: [
        {
          ...offer,
          commercialStateSummary: {
            ...offer.commercialStateSummary,
            blocked: 1,
          },
        },
      ],
      page: 1,
      limit: 12,
      total: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
      flashDealCapability: {
        status: 'UNSUPPORTED_CURRENT_PROVIDER_CONTRACT',
        reasonCode: 'OFFICIAL_SIGNAL_NOT_AVAILABLE',
      },
    });
    const screen = await render(<ProductsPage />);

    expect(screen.container.textContent).toContain('Bloqueada no fluxo');
    const row = screen.container.querySelector('.offers-table tbody tr');
    expect(row?.querySelectorAll('td')[8]?.textContent).toContain(
      'Bloqueada no fluxo',
    );
    expect(screen.container.textContent).not.toContain('Em preparação');
    await screen.unmount();
  });

  it('avança a página pelo controle da API', async () => {
    listMock
      .mockResolvedValueOnce({
        provider: 'official',
        items: [offer],
        page: 1,
        limit: 12,
        total: 13,
        totalPages: 2,
        hasNextPage: true,
        hasPreviousPage: false,
        flashDealCapability: {
          status: 'UNSUPPORTED_CURRENT_PROVIDER_CONTRACT',
          reasonCode: 'OFFICIAL_SIGNAL_NOT_AVAILABLE',
        },
      })
      .mockResolvedValueOnce({
        provider: 'official',
        items: [offer],
        page: 2,
        limit: 12,
        total: 13,
        totalPages: 2,
        hasNextPage: false,
        hasPreviousPage: true,
        flashDealCapability: {
          status: 'UNSUPPORTED_CURRENT_PROVIDER_CONTRACT',
          reasonCode: 'OFFICIAL_SIGNAL_NOT_AVAILABLE',
        },
      });
    const screen = await render(<ProductsPage />);
    const next = Array.from(screen.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Próxima',
    );

    expect(next).toBeDefined();
    await click(next as HTMLButtonElement);
    expect(listMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
    );
    expect(screen.container.textContent).toContain('Página 2 de 2');
    await screen.unmount();
  });

  it('envia filtros combináveis à API e limpa o estado local', async () => {
    const screen = await render(<ProductsPage />);
    const selects = screen.container.querySelectorAll('select');
    const form = screen.container.querySelector('form');
    const clearButton = Array.from(
      screen.container.querySelectorAll('button'),
    ).find((button) => button.textContent === 'Limpar');
    const applyButton = Array.from(
      screen.container.querySelectorAll('button'),
    ).find((button) => button.textContent === 'Aplicar filtros');

    expect(form).not.toBeNull();
    expect(clearButton).toBeDefined();
    expect(applyButton?.closest('form')).toBe(form);
    await change(selects[0] as HTMLSelectElement, '100001');
    await change(selects[1] as HTMLSelectElement, 'ACTIVE');
    await change(selects[2] as HTMLSelectElement, 'sales_desc');
    await submit(form as HTMLFormElement);

    expect(listMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        categoryId: '100001',
        availability: 'ACTIVE',
        sort: 'sales_desc',
        page: 1,
      }),
    );

    await click(clearButton as HTMLButtonElement);
    expect(listMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        availability: '',
        sort: 'recent',
        deliveryStatus: 'any',
        page: 1,
      }),
    );
    await screen.unmount();
  });
});
