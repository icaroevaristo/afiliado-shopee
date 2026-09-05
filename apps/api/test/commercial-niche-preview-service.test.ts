import { describe, expect, it, vi } from 'vitest';

import { CommercialNichePreviewService } from '../src/commercial-niche-preview-service';
import type {
  CommercialPromotionCatalogItem,
  ShopeeOfferRecord,
} from '../src/repositories';

const now = new Date('2026-08-30T12:00:00.000Z');

const offer = (
  id: string,
  productName: string,
  categoryIds: string[],
  overrides: Partial<ShopeeOfferRecord> = {},
): ShopeeOfferRecord => ({
  id,
  source: 'OFFICIAL',
  providerProductId: `provider-${id}`,
  productName,
  shopName: 'Loja oficial',
  categoryIds,
  shopType: [],
  price: '39.90',
  priceMin: '39.90',
  priceMax: '39.90',
  discountRate: 20,
  rating: 4.8,
  sales: 1000,
  commissionRate: 12,
  imageUrl: 'https://example.invalid/image',
  productLink: 'https://example.invalid/product',
  affiliateLink: 'https://example.invalid/affiliate',
  score: 80,
  scoreUpdatedAt: now,
  fetchedAt: now,
  lastSeenAt: now,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const item = (product: ShopeeOfferRecord): CommercialPromotionCatalogItem => ({
  product,
  commercialSnapshotRevision: 1,
  commercialSnapshotFingerprint: `snapshot-${product.id}`,
  latestSnapshotRevision: 1,
  currentSnapshot: null,
  previousSnapshot: null,
});

const catalog = (items: CommercialPromotionCatalogItem[]) => ({
  listOfficialCatalogPage: vi.fn(async () => ({ items, hasMore: false })),
});

describe('CommercialNichePreviewService', () => {
  it('previewa Maternidade com categorias sem escrever nem chamar providers', async () => {
    const repository = catalog([
      item(offer('diaper', 'Fralda para bebê', ['baby'])),
      item(offer('bottle', 'Mamadeira anticólica', ['feeding'])),
      item(offer('stroller', 'Carrinho de bebê', ['stroller'])),
      item(offer('layette', 'Kit de enxoval', ['layette'])),
      item(offer('drill', 'Furadeira doméstica', ['tools'])),
      item(offer('pet-food', 'Ração para cães', ['pets'])),
      item(offer('car', 'Acessório automotivo', ['automotive'])),
    ]);
    const service = new CommercialNichePreviewService(repository, () => now);

    const report = await service.preview({
      name: 'Maternidade',
      categoryIds: ['baby', 'feeding', 'stroller', 'layette'],
      includeKeywords: [],
      excludeKeywords: [],
      minPrice: null,
      maxPrice: null,
      minDiscountRate: 5,
      minRating: 0,
      minSales: 0,
      minCommissionRate: 0,
      minimumScore: 60,
    });

    expect(report).toMatchObject({
      preview: true,
      evaluatedCount: 7,
      matchedCount: 4,
      rejectedCount: 3,
      evaluationTruncated: false,
    });
    expect(report.matches.map(({ productId }) => productId)).toEqual([
      'diaper',
      'bottle',
      'stroller',
      'layette',
    ]);
    expect(report.rejectionSummary.CATEGORY_NOT_INCLUDED).toBe(3);
    expect(repository.listOfficialCatalogPage).toHaveBeenCalledOnce();
  });

  it('permite Achadinhos transversal sem categoria e bloqueia produto caro', async () => {
    const repository = catalog([
      item(offer('audio', 'Fone de áudio', ['audio'], { price: '49.90' })),
      item(offer('home', 'Organizador de casa', ['home'], { price: '29.90' })),
      item(offer('expensive', 'Produto premium', ['other'], { price: '90.00' })),
    ]);
    const service = new CommercialNichePreviewService(repository, () => now);

    const report = await service.preview({
      name: 'Achadinhos até R$50',
      categoryIds: [],
      includeKeywords: [],
      excludeKeywords: [],
      minPrice: null,
      maxPrice: '50',
      minDiscountRate: 10,
      minRating: 4,
      minSales: 100,
      minCommissionRate: 5,
      minimumScore: 60,
    });

    expect(report.matchedCount).toBe(2);
    expect(report.matches.map(({ productId }) => productId)).toEqual([
      'audio',
      'home',
    ]);
    expect(report.rejectionSummary.PRICE_ABOVE_MAXIMUM).toBe(1);
    expect(report.rejectionSummary.CATEGORY_NOT_INCLUDED).toBeUndefined();
  });

  it('deduplica páginas e mantém amostras limitadas ao catálogo persistido', async () => {
    const duplicate = item(offer('same', 'Oferta repetida', ['audio']));
    const listOfficialCatalogPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [duplicate], hasMore: true })
      .mockResolvedValueOnce({ items: [duplicate], hasMore: false });
    const service = new CommercialNichePreviewService(
      { listOfficialCatalogPage },
      () => now,
    );

    const report = await service.preview({ name: 'Achadinhos' });

    expect(report.evaluatedCount).toBe(1);
    expect(report.matchedCount).toBe(1);
    expect(listOfficialCatalogPage).toHaveBeenCalledTimes(2);
    expect(listOfficialCatalogPage).toHaveBeenLastCalledWith({
      afterId: 'same',
      limit: 200,
    });
  });
});
