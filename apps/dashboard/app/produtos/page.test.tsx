import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '../../test/render';
import ProductsPage from './page';

const listMock = vi.fn();

vi.mock('../../lib/api', () => ({
  listShopeeOffers: (...args: unknown[]) => listMock(...args),
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
  discountRate: 20,
  rating: 4.8,
  sales: 1000,
  commissionRate: 8,
  imageUrl: 'https://example.invalid/image.jpg',
  productLink: 'https://example.invalid/product',
  affiliateLink: 'https://example.invalid/affiliate',
  fetchedAt: '2026-07-24T00:00:00.000Z',
  lastSeenAt: '2026-07-24T00:00:00.000Z',
  score: 80,
  scoreUpdatedAt: null,
  createdAt: '2026-07-24T00:00:00.000Z',
  updatedAt: '2026-07-24T00:00:00.000Z',
  status: 'ACTIVE',
};

beforeEach(() => {
  listMock.mockReset().mockResolvedValue({
    provider: 'official',
    items: [offer],
    page: 1,
    limit: 12,
    total: 1,
    totalPages: 1,
  });
});

describe('ProductsPage', () => {
  it('exibe o catalogo real da API em modo somente leitura', async () => {
    const screen = await render(<ProductsPage />);

    expect(screen.container.textContent).toContain('Produto ficticio');
    expect(screen.container.textContent).toContain('Provider atual');
    expect(screen.container.textContent).toContain('Oficial');
    expect(screen.container.textContent).toContain('somente leitura');
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
});
