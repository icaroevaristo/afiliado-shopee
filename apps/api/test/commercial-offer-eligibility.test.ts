import { describe, expect, it } from 'vitest';

import { commercialProductRejections } from '../src/commercial-offer-eligibility';
import type { ShopeeOfferRecord } from '../src/repositories';

const NOW = new Date('2026-08-16T12:00:00.000Z');

const product = (
  overrides: Partial<ShopeeOfferRecord> = {},
): ShopeeOfferRecord => ({
  id: 'product-1',
  source: 'OFFICIAL',
  providerProductId: 'provider-1',
  productName: 'Produto valido',
  shopId: 'shop-1',
  shopName: 'Loja valida',
  categoryIds: ['cat'],
  price: '99.90',
  priceMin: '99.90',
  priceMax: '99.90',
  discountRate: 20,
  rating: 4.8,
  sales: 100,
  commissionRate: 10,
  imageUrl: 'https://example.invalid/image.jpg',
  productLink: 'https://example.invalid/product',
  affiliateLink: 'https://example.invalid/affiliate',
  offerStartsAt: new Date('2026-08-15T00:00:00.000Z'),
  offerEndsAt: new Date('2026-08-17T00:00:00.000Z'),
  fetchedAt: NOW,
  lastSeenAt: NOW,
  score: null,
  scoreUpdatedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

describe('commercialProductRejections', () => {
  it('aceita produto estruturalmente valido deterministicamente', () => {
    const input = product();
    expect(commercialProductRejections(input, NOW)).toEqual([]);
    expect(commercialProductRejections(input, NOW)).toEqual([]);
  });

  it('bloqueia disponibilidade e janela temporal antes da selecao', () => {
    expect(
      commercialProductRejections(
        product({ unavailableAt: NOW, offerEndsAt: NOW }),
        NOW,
      ),
    ).toEqual(['OFFER_UNAVAILABLE', 'OFFER_EXPIRED']);
    expect(
      commercialProductRejections(
        product({ offerStartsAt: new Date(NOW.getTime() + 1) }),
        NOW,
      ),
    ).toEqual(['OFFER_NOT_STARTED']);
    expect(
      commercialProductRejections(product({ offerStartsAt: NOW }), NOW),
    ).toEqual([]);
  });

  it('bloqueia link, imagem e campos comerciais invalidos de forma explicita', () => {
    expect(
      commercialProductRejections(
        product({
          affiliateLink: 'ftp://invalid',
          imageUrl: 'not-a-url',
          productName: ' ',
          price: '0',
          shopName: ' ',
          rating: 6,
          sales: -1,
          commissionRate: 101,
        }),
        NOW,
      ),
    ).toEqual([
      'INVALID_AFFILIATE_LINK',
      'INVALID_PRODUCT_NAME',
      'INVALID_PRICE',
      'INVALID_IMAGE',
      'INVALID_SHOP',
      'INVALID_RATING',
      'INVALID_SALES',
      'INVALID_COMMISSION_RATE',
    ]);
  });

  it('distingue affiliate link ausente de invalido', () => {
    expect(
      commercialProductRejections(product({ affiliateLink: undefined }), NOW),
    ).toEqual(['MISSING_AFFILIATE_LINK']);
  });
});
