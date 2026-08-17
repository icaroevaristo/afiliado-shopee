import { describe, expect, it } from 'vitest';

import { rankCommercialPromotionCandidates } from '../src/commercial-promotion-ranking';
import type { CommercialPromotionRankedCandidate } from '../src/repositories';

const NOW = new Date('2026-08-16T12:00:00.000Z');

const candidate = (
  productId: string,
  overrides: Partial<CommercialPromotionRankedCandidate> = {},
): CommercialPromotionRankedCandidate => ({
  productId,
  snapshotId: `snapshot-${productId}`,
  snapshotRevision: 1,
  snapshotFingerprint: `fingerprint-${productId}`,
  expectedProductUpdatedAt: NOW,
  commercialScore: 80,
  scorePolicyVersion: 'official-v2',
  minimumScoreUsed: 60,
  scoreBreakdown: {
    policyVersion: 'official-v2',
    rawTotal: 80,
    finalScore: 80,
    components: {},
  },
  promotionSignals: ['CURRENT_DISCOUNT'],
  priceDropPercent: null,
  discountRate: 20,
  commissionRate: 10,
  sales: 100,
  expiresAt: null,
  expectedCandidateStatus: null,
  expectedDedupeUntil: null,
  expectedCandidateUpdatedAt: null,
  ...overrides,
});

describe('rankCommercialPromotionCandidates', () => {
  it('prioriza PRICE_DROP e maior queda antes do score', () => {
    const ranked = rankCommercialPromotionCandidates([
      candidate('score-high', { commercialScore: 100 }),
      candidate('drop-small', {
        commercialScore: 10,
        promotionSignals: ['PRICE_DROP'],
        priceDropPercent: '5',
      }),
      candidate('drop-large', {
        commercialScore: 1,
        promotionSignals: ['PRICE_DROP'],
        priceDropPercent: '25',
      }),
    ]);

    expect(ranked.map(({ productId }) => productId)).toEqual([
      'drop-large',
      'drop-small',
      'score-high',
    ]);
  });

  it('aplica score, desconto, comissao e vendas em ordem explicita', () => {
    const ranked = rankCommercialPromotionCandidates([
      candidate('sales', { sales: 500 }),
      candidate('commission', { commissionRate: 20 }),
      candidate('discount', { discountRate: 40 }),
      candidate('score', { commercialScore: 90 }),
    ]);

    expect(ranked.map(({ productId }) => productId)).toEqual([
      'score',
      'discount',
      'commission',
      'sales',
    ]);
  });

  it('desempata finalmente por productId independentemente da ordem de entrada', () => {
    const first = rankCommercialPromotionCandidates([
      candidate('product-b'),
      candidate('product-a'),
      candidate('product-c'),
    ]);
    const second = rankCommercialPromotionCandidates([
      candidate('product-c'),
      candidate('product-b'),
      candidate('product-a'),
    ]);

    expect(first.map(({ productId }) => productId)).toEqual([
      'product-a',
      'product-b',
      'product-c',
    ]);
    expect(second).toEqual(first);
  });

  it('nao muta a entrada ao ranquear', () => {
    const input = [candidate('product-b'), candidate('product-a')];
    const before = [...input];

    rankCommercialPromotionCandidates(input);

    expect(input).toEqual(before);
  });
});
