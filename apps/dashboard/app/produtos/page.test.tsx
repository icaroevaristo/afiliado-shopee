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
  bestCurrentCommercialScore: null,
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
        displayLabel: 'Categoria 100001',
      },
    ],
  });
});

describe('ProductsPage', () => {
  it('exibe o catalogo real da API em modo somente leitura', async () => {
    const screen = await render(<ProductsPage />);

    expect(screen.container.textContent).toContain('Produto ficticio');
    expect(screen.container.textContent).toContain('Provider atual');
    expect(screen.container.textContent).toContain('Oficial');
    expect(screen.container.textContent).toContain('somente leitura');
    expect(screen.container.textContent).toContain('Ofertas Relâmpago: não suportado');
    expect(screen.container.textContent).toContain('Categoria');
    expect(screen.container.textContent).toContain('Vendas');
    expect(screen.container.textContent).toContain('Avaliação');
    expect(screen.container.textContent).toContain('Provider');
    expect(screen.container.textContent).toContain('Disponibilidade');
    expect(screen.container.textContent).toContain('Resumo comercial');
    expect(screen.container.querySelector('[title="Link afiliado disponível"]')).not.toBeNull();
    expect(screen.container.textContent).toContain('Não enviado');
    expect(screen.container.textContent).not.toContain('Aguardando credenciais');
    expect(screen.container.textContent).not.toContain('Sincronizar ofertas');
    expect(screen.container.textContent).not.toContain('Importacao manual');
    expect(screen.container.textContent).not.toContain('Preview');
    expect(screen.container.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.invalid/image.jpg',
    );
    expect(listMock).toHaveBeenCalledTimes(1);

    await screen.unmount();
  });

  it('envia filtros combináveis à API e limpa o estado local', async () => {
    const screen = await render(<ProductsPage />);
    const selects = screen.container.querySelectorAll('select');
    const form = screen.container.querySelector('form');
    const clearButton = Array.from(screen.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Limpar',
    );

    expect(form).not.toBeNull();
    expect(clearButton).toBeDefined();
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
