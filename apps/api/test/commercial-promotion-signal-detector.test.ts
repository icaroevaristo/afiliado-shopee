import { describe, expect, it } from 'vitest';

import { rankCommercialPromotionCandidates } from '../src/commercial-promotion-ranking';
import { CommercialPromotionSignalDetector } from '../src/commercial-promotion-signal-detector';
import type {
  CommercialPromotionRankedCandidate,
  CommercialPromotionSnapshotRecord,
  ShopeeOfferRecord,
} from '../src/repositories';

const NOW = new Date('2026-07-29T15:00:00.000Z');

const product = (
  overrides: Partial<ShopeeOfferRecord> = {},
): ShopeeOfferRecord => ({
  id: 'product-a',
  source: 'OFFICIAL',
  providerProductId: 'external-hidden',
  productName: 'Produto oficial',
  shopName: 'Loja',
  categoryIds: ['cat'],
  price: '80',
  priceMin: '80',
  priceMax: '80',
  discountRate: 20,
  rating: 4.8,
  sales: 500,
  commissionRate: 10,
  imageUrl: 'https://example.invalid/image',
  productLink: 'https://example.invalid/product',
  affiliateLink: 'https://example.invalid/affiliate',
  fetchedAt: NOW,
  lastSeenAt: NOW,
  score: null,
  scoreUpdatedAt: null,
  createdAt: new Date(NOW.getTime() - 60_000),
  updatedAt: NOW,
  ...overrides,
});

const snapshot = (
  revision: number,
  price: string,
  overrides: Partial<CommercialPromotionSnapshotRecord> = {},
): CommercialPromotionSnapshotRecord => ({
  id: `snapshot-${revision}`,
  productId: 'product-a',
  revision,
  fingerprint: `fingerprint-${revision}`,
  price,
  priceMin: price,
  priceMax: price,
  discountRate: 20,
  commissionRate: 10,
  observedRating: 4.8,
  observedSales: 500,
  offerStartsAt: null,
  offerEndsAt: null,
  unavailableAt: null,
  capturedAt: new Date(NOW.getTime() - 60_000),
  createdAt: NOW,
  ...overrides,
});

describe('CommercialPromotionSignalDetector', () => {
  const detector = new CommercialPromotionSignalDetector();

  it('comprova PRICE_DROP somente entre snapshots consecutivos e calcula decimal', () => {
    expect(
      detector.detect({
        product: product(),
        currentSnapshot: snapshot(2, '0.2'),
        previousSnapshot: snapshot(1, '0.3'),
        now: NOW,
      }),
    ).toEqual({
      signals: ['PRICE_DROP', 'CURRENT_DISCOUNT'],
      priceDropPercent: '33.3333',
    });
  });

  it('nao declara queda sem snapshot anterior ou com preco anterior zero', () => {
    expect(
      detector.detect({
        product: product({ discountRate: 0 }),
        currentSnapshot: snapshot(1, '80'),
        previousSnapshot: null,
        now: NOW,
      }).signals,
    ).not.toContain('PRICE_DROP');
    expect(
      detector.detect({
        product: product({ discountRate: 0 }),
        currentSnapshot: snapshot(2, '0'),
        previousSnapshot: snapshot(1, '0'),
        now: NOW,
      }).signals,
    ).not.toContain('PRICE_DROP');
  });

  it('detecta aumento de desconto, mas nao desconto igual', () => {
    expect(
      detector.detect({
        product: product(),
        currentSnapshot: snapshot(2, '80', { discountRate: 25 }),
        previousSnapshot: snapshot(1, '80', { discountRate: 20 }),
        now: NOW,
      }).signals,
    ).toContain('DISCOUNT_INCREASE');
    expect(
      detector.detect({
        product: product(),
        currentSnapshot: snapshot(2, '80'),
        previousSnapshot: snapshot(1, '80'),
        now: NOW,
      }).signals,
    ).not.toContain('DISCOUNT_INCREASE');
  });

  it('classifica NEWLY_OBSERVED apenas para revision 1 recente e nao futura', () => {
    expect(
      detector.detect({
        product: product(),
        currentSnapshot: snapshot(1, '80'),
        previousSnapshot: null,
        now: NOW,
      }).signals,
    ).toContain('NEWLY_OBSERVED');
    expect(
      detector.detect({
        product: product({ createdAt: new Date('2026-07-20T00:00:00.000Z') }),
        currentSnapshot: snapshot(1, '80', {
          capturedAt: new Date('2026-07-20T00:00:00.000Z'),
        }),
        previousSnapshot: null,
        now: NOW,
      }).signals,
    ).not.toContain('NEWLY_OBSERVED');
    expect(
      detector.detect({
        product: product({ createdAt: new Date(NOW.getTime() + 1) }),
        currentSnapshot: snapshot(1, '80'),
        previousSnapshot: null,
        now: NOW,
      }).signals,
    ).not.toContain('NEWLY_OBSERVED');
  });

  it('trata CURRENT_DISCOUNT apenas como desconto corrente positivo', () => {
    expect(
      detector.detect({
        product: product(),
        currentSnapshot: snapshot(2, '80'),
        previousSnapshot: snapshot(1, '80'),
        now: NOW,
      }).signals,
    ).toContain('CURRENT_DISCOUNT');
    expect(
      detector.detect({
        product: product({ discountRate: 0 }),
        currentSnapshot: snapshot(2, '80', { discountRate: 0 }),
        previousSnapshot: snapshot(1, '80', { discountRate: 0 }),
        now: NOW,
      }).signals,
    ).not.toContain('CURRENT_DISCOUNT');
  });

  it('permite multiplos sinais no mesmo produto', () => {
    expect(
      detector.detect({
        product: product(),
        currentSnapshot: snapshot(2, '80', { discountRate: 25 }),
        previousSnapshot: snapshot(1, '100', { discountRate: 10 }),
        now: NOW,
      }),
    ).toEqual({
      signals: ['PRICE_DROP', 'DISCOUNT_INCREASE', 'CURRENT_DISCOUNT'],
      priceDropPercent: '20',
    });
  });
});

const rankedCandidate = (
  productId: string,
  overrides: Partial<CommercialPromotionRankedCandidate> = {},
): CommercialPromotionRankedCandidate => ({
  productId,
  snapshotId: `snapshot-${productId}`,
  snapshotRevision: 1,
  snapshotFingerprint: `fingerprint-${productId}`,
  expectedProductUpdatedAt: NOW,
  commercialScore: 70,
  scorePolicyVersion: 'official-v2',
  minimumScoreUsed: 60,
  scoreBreakdown: {
    policyVersion: 'official-v2',
    rawTotal: 70,
    finalScore: 70,
    components: {},
  },
  promotionSignals: ['CURRENT_DISCOUNT'],
  priceDropPercent: null,
  discountRate: 10,
  commissionRate: 5,
  sales: 100,
  expiresAt: null,
  expectedCandidateStatus: null,
  expectedDedupeUntil: null,
  expectedCandidateUpdatedAt: null,
  ...overrides,
});

describe('rankCommercialPromotionCandidates', () => {
  it('mantem o ranking promocional separado do score legado', () => {
    const values = [
      rankedCandidate('g'),
      rankedCandidate('f', { sales: 101 }),
      rankedCandidate('e', { commissionRate: 6 }),
      rankedCandidate('d', { discountRate: 11 }),
      rankedCandidate('c', { commercialScore: 71 }),
      rankedCandidate('b', {
        promotionSignals: ['PRICE_DROP'],
        priceDropPercent: '5',
      }),
      rankedCandidate('a', {
        promotionSignals: ['PRICE_DROP'],
        priceDropPercent: '10',
      }),
    ];
    expect(
      rankCommercialPromotionCandidates(values).map(
        ({ productId }) => productId,
      ),
    ).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });

  it('preserva desempates deterministas e nao altera a entrada', () => {
    const values = [rankedCandidate('b'), rankedCandidate('a')];
    expect(
      rankCommercialPromotionCandidates(values).map(
        ({ productId }) => productId,
      ),
    ).toEqual(['a', 'b']);
    expect(values.map(({ productId }) => productId)).toEqual(['b', 'a']);
  });
});
