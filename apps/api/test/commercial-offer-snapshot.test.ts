import { describe, expect, it } from 'vitest';
import {
  canonicalizeCommercialDecimal,
  fingerprintCommercialOffer,
  type CommercialOfferFingerprintInput,
} from '../src/commercial-offer-snapshot';

const base = (): CommercialOfferFingerprintInput => ({
  source: 'OFFICIAL',
  providerProductId: 'official-1',
  productLink: 'https://shopee.com.br/product/1/2',
  affiliateLink: 'https://s.shopee.com.br/affiliate-link',
  price: '10.0000',
  priceMin: null,
  priceMax: '10.00',
  discountRate: 10,
  commissionRate: 5,
  offerStartsAt: new Date('2026-07-29T12:00:00-03:00'),
  offerEndsAt: null,
  unavailableAt: null,
});

describe('commercial offer fingerprint', () => {
  it('canonicaliza decimais sem locale ou zeros irrelevantes', () => {
    expect(
      ['10', '10.0', '10.0000'].map(canonicalizeCommercialDecimal),
    ).toEqual(['10', '10', '10']);
    expect(canonicalizeCommercialDecimal('000.0100')).toBe('0.01');
  });

  it('e deterministico, usa ordem fixa, null explicito e datas UTC', () => {
    const input = base();
    const reordered = {
      affiliateLink: 'https://s.shopee.com.br/affiliate-link',
      productLink: 'https://shopee.com.br/product/1/2',
      providerProductId: 'official-1',
      source: 'OFFICIAL' as const,
      unavailableAt: null,
      offerEndsAt: null,
      offerStartsAt: new Date('2026-07-29T15:00:00.000Z'),
      commissionRate: 5,
      discountRate: 10,
      priceMax: '10',
      priceMin: null,
      price: '10.0',
    };
    expect(fingerprintCommercialOffer(input)).toBe(
      fingerprintCommercialOffer(reordered),
    );
  });

  it('ignora rating e sales, que nao pertencem ao material canonico', () => {
    const withObservations = { ...base(), rating: 1, sales: 2 };
    const changedObservations = { ...base(), rating: 5, sales: 9999 };
    expect(fingerprintCommercialOffer(withObservations)).toBe(
      fingerprintCommercialOffer(changedObservations),
    );
  });

  it.each([
    ['source', { source: 'MANUAL' as const }],
    ['providerProductId', { providerProductId: 'official-2' }],
    ['productLink', { productLink: 'https://shopee.com.br/product/1/3' }],
    ['affiliateLink', { affiliateLink: 'https://s.shopee.com.br/affiliate-v2' }],
    ['price', { price: '11' }],
    ['discount', { discountRate: 11 }],
    ['commission', { commissionRate: 6 }],
    ['start', { offerStartsAt: new Date('2026-07-30T15:00:00.000Z') }],
    ['end', { offerEndsAt: new Date('2026-08-30T15:00:00.000Z') }],
    ['unavailable', { unavailableAt: new Date('2026-07-31T15:00:00.000Z') }],
  ])('altera quando muda %s', (_field, change) => {
    expect(fingerprintCommercialOffer({ ...base(), ...change })).not.toBe(
      fingerprintCommercialOffer(base()),
    );
  });

  it('rejeita numero nao finito, decimal invalido e data invalida', () => {
    expect(() =>
      fingerprintCommercialOffer({ ...base(), discountRate: Number.NaN }),
    ).toThrow();
    expect(() =>
      fingerprintCommercialOffer({ ...base(), price: '1e2' }),
    ).toThrow();
    expect(() =>
      fingerprintCommercialOffer({
        ...base(),
        offerEndsAt: new Date('invalid'),
      }),
    ).toThrow();
  });
});
