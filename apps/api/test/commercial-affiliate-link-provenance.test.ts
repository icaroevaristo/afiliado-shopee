import { describe, expect, it } from 'vitest';
import {
  COMMERCIAL_AFFILIATE_LINK_DOMAIN_UNAUTHORIZED,
  COMMERCIAL_AFFILIATE_LINK_INVALID,
  COMMERCIAL_AFFILIATE_LINK_NOT_AFFILIATE,
  COMMERCIAL_AFFILIATE_LINK_PROVENANCE_INVALID,
  COMMERCIAL_AFFILIATE_LINK_REQUIRED,
  COMMERCIAL_AFFILIATE_LINK_SNAPSHOT_MISMATCH,
  validateCommercialAffiliateLinkProvenance,
} from '../src/commercial-affiliate-link-provenance';
import { fingerprintCommercialOffer } from '../src/commercial-offer-snapshot';
import type { ShopeeAffiliateOfferSource } from '@shopee-auto-affiliate-ai/providers';
import type { CommercialPromotionCopyContext } from '../src/repositories';

const NOW = new Date('2026-08-16T12:00:00.000Z');
const END = new Date('2026-08-31T23:59:59.000Z');
type Input = Partial<{
  source: ShopeeAffiliateOfferSource; providerProductId: string;
  productLink: string | null; affiliateLink: string | null;
  candidateId: string; candidateProductId: string; candidateSnapshotId: string;
  candidateCampaignId: string; snapshotProductId: string;
  productRevision: number; snapshotRevision: number;
  productFingerprint: string | null; snapshotFingerprint: string;
  keepFingerprintFrom: { source: ShopeeAffiliateOfferSource; providerProductId: string; productLink: string | null; affiliateLink: string | null };
}>;
const fp = (x: { source: ShopeeAffiliateOfferSource; providerProductId: string; productLink: string | null; affiliateLink: string | null }) => fingerprintCommercialOffer({
  ...x, price: '99.90', priceMin: null, priceMax: null, discountRate: 20,
  commissionRate: 10, offerStartsAt: null, offerEndsAt: END, unavailableAt: null,
});
const context = (i: Input = {}): CommercialPromotionCopyContext => {
  const source = i.source ?? 'OFFICIAL';
  const providerProductId = i.providerProductId ?? 'provider-1';
  const productLink = i.productLink === undefined ? 'https://shopee.com.br/product/1/100' : i.productLink;
  const affiliateLink = i.affiliateLink === undefined ? 'https://s.shopee.com.br/affiliate-1' : i.affiliateLink;
  const current = { source, providerProductId, productLink, affiliateLink };
  const snapshotFingerprint = i.snapshotFingerprint ?? fp(i.keepFingerprintFrom ?? current);
  return {
    candidate: { id: i.candidateId ?? 'candidate-1', campaignId: i.candidateCampaignId ?? 'campaign-1', productId: i.candidateProductId ?? 'product-1', snapshotId: i.candidateSnapshotId ?? 'snapshot-1', generatedCopyId: null, status: 'QUEUED', rankPosition: 1, commercialScore: 90, scorePolicyVersion: 'official-v2', minimumScoreUsed: 60, scoreBreakdown: { policyVersion: 'official-v2', rawTotal: 90, finalScore: 90, components: { commission: 25, rating: 20, sales: 20, discount: 25 } }, promotionSignals: ['CURRENT_DISCOUNT'], priceDropPercent: null, queuedAt: NOW, lastEvaluatedAt: NOW, expiresAt: END, dedupeUntil: null, blockedReason: null, createdAt: NOW, updatedAt: NOW },
    campaign: { id: 'campaign-1', name: 'Campanha', logicalGroupFingerprint: 'grp_123456789abc', anchorDestinationId: null, nicheId: 'niche-1', active: true, cadenceMinutes: 15, timezone: 'America/Sao_Paulo', allowedStartTime: '07:00', allowedEndTime: '22:00', dailyLimit: 10, failureCount: 0, nextEligibleAt: null, attemptExecutionId: null, attemptReservedAt: null, attemptLeaseExpiresAt: null, queueTargetSize: 40, dedupeDays: 30, niche: { id: 'niche-1', name: 'Casa', slug: 'casa', active: true }, anchorDestination: null, createdAt: NOW, updatedAt: NOW },
    niche: { id: 'niche-1', name: 'Casa', slug: 'casa', active: true, categoryIds: [], includeKeywords: [], excludeKeywords: [], minPrice: null, maxPrice: null, minDiscountRate: 0, minRating: 0, minSales: 0, minCommissionRate: 0, minimumScore: 60, createdAt: NOW, updatedAt: NOW },
    product: { id: 'product-1', source, providerProductId, productName: 'Produto', shopName: 'Loja', productLink, affiliateLink, price: '99.90', priceMin: null, priceMax: null, discountRate: 20, commissionRate: 10, rating: 4.8, sales: 100, offerStartsAt: null, offerEndsAt: END, unavailableAt: null, commercialSnapshotRevision: i.productRevision ?? 1, commercialSnapshotFingerprint: i.productFingerprint === undefined ? snapshotFingerprint : i.productFingerprint, updatedAt: NOW },
    snapshot: { id: 'snapshot-1', productId: i.snapshotProductId ?? 'product-1', revision: i.snapshotRevision ?? 1, fingerprint: snapshotFingerprint, price: '99.90', priceMin: null, priceMax: null, discountRate: 20, commissionRate: 10, observedRating: 4.8, observedSales: 100, offerStartsAt: null, offerEndsAt: END, unavailableAt: null, capturedAt: NOW, createdAt: NOW },
    previousSnapshot: null,
  };
};
const code = (c: CommercialPromotionCopyContext) => {
  const r = validateCommercialAffiliateLinkProvenance(c, { candidateId: 'candidate-1', campaignId: 'campaign-1', groupId: 'group-1' });
  return r.valid ? null : r.code;
};
describe('commercial affiliate link provenance', () => {
  it('comprova OFFICIAL e preserva a cadeia completa sem alterar URLs', () => {
    const r = validateCommercialAffiliateLinkProvenance(context(), { candidateId: 'candidate-1', campaignId: 'campaign-1', groupId: 'group-1' });
    expect(r).toMatchObject({ valid: true, provenance: { source: 'OFFICIAL', productId: 'product-1', providerProductId: 'provider-1', snapshotId: 'snapshot-1', snapshotRevision: 1, candidateId: 'candidate-1', campaignId: 'campaign-1', groupId: 'group-1', productLink: 'https://shopee.com.br/product/1/100', affiliateLink: 'https://s.shopee.com.br/affiliate-1', origin: 'OFFICIAL_OFFER_LINK', validationState: 'VALID' } });
  });

  it('permanece valido apos round-trip de percentual semanticamente equivalente', () => {
    const c = context();
    const noisyCommission = Number('0.14') * 100;
    const persistedCommission = 14;
    const stableFingerprint = fingerprintCommercialOffer({
      source: c.product.source,
      providerProductId: c.product.providerProductId,
      productLink: c.product.productLink,
      affiliateLink: c.product.affiliateLink,
      price: c.product.price,
      priceMin: c.product.priceMin,
      priceMax: c.product.priceMax,
      discountRate: c.product.discountRate,
      commissionRate: noisyCommission,
      offerStartsAt: c.product.offerStartsAt,
      offerEndsAt: c.product.offerEndsAt,
      unavailableAt: c.product.unavailableAt,
    });
    c.product.commissionRate = persistedCommission;
    c.snapshot.commissionRate = persistedCommission;
    c.product.commercialSnapshotFingerprint = stableFingerprint;
    c.snapshot.fingerprint = stableFingerprint;

    expect(validateCommercialAffiliateLinkProvenance(c)).toMatchObject({
      valid: true,
    });

    c.product.affiliateLink = 'https://s.shopee.com.br/affiliate-changed';
    expect(code(c)).toBe(COMMERCIAL_AFFILIATE_LINK_SNAPSHOT_MISMATCH);
  });
  it('falha fechado com productLink valido sem affiliateLink', () => {
    expect(code(context({ affiliateLink: null }))).toBe(COMMERCIAL_AFFILIATE_LINK_REQUIRED);
  });

  it('separa link ausente de URL/protocolo invalido', () => {
    expect(code(context({ affiliateLink: 'ftp://s.shopee.com.br/x' }))).toBe(COMMERCIAL_AFFILIATE_LINK_INVALID);
    expect(code(context({ affiliateLink: 'not-a-url' }))).toBe(COMMERCIAL_AFFILIATE_LINK_INVALID);
  });

  it('rejeita dominio OFFICIAL e origem incompatíveis', () => {
    expect(code(context({ affiliateLink: 'https://evil.example/x' }))).toBe(COMMERCIAL_AFFILIATE_LINK_DOMAIN_UNAUTHORIZED);
    expect(code(context({ productLink: 'https://evil.example/product/1' }))).toBe(COMMERCIAL_AFFILIATE_LINK_DOMAIN_UNAUTHORIZED);
  });

  it('nao usa productLink como affiliateLink silenciosamente', () => {
    const link = 'https://shopee.com.br/product/1/100';
    expect(code(context({ productLink: link, affiliateLink: link }))).toBe(COMMERCIAL_AFFILIATE_LINK_NOT_AFFILIATE);
  });

  it('rejeita candidato, produto, campanha e snapshot de outra identidade', () => {
    const expected = { candidateId: 'candidate-other', campaignId: 'campaign-1', groupId: 'group-1' };
    expect(validateCommercialAffiliateLinkProvenance(context(), expected)).toMatchObject({ valid: false, code: COMMERCIAL_AFFILIATE_LINK_PROVENANCE_INVALID });
    expect(code(context({ candidateProductId: 'product-other' }))).toBe(COMMERCIAL_AFFILIATE_LINK_PROVENANCE_INVALID);
    expect(code(context({ candidateSnapshotId: 'snapshot-other' }))).toBe(COMMERCIAL_AFFILIATE_LINK_PROVENANCE_INVALID);
    expect(code(context({ candidateCampaignId: 'campaign-other' }))).toBe(COMMERCIAL_AFFILIATE_LINK_PROVENANCE_INVALID);
    expect(code(context({ snapshotProductId: 'product-other' }))).toBe(COMMERCIAL_AFFILIATE_LINK_PROVENANCE_INVALID);
  });

  it('rejeita revision e fingerprint divergentes', () => {
    expect(code(context({ productRevision: 2 }))).toBe(COMMERCIAL_AFFILIATE_LINK_SNAPSHOT_MISMATCH);
    expect(code(context({ productFingerprint: 'different' }))).toBe(COMMERCIAL_AFFILIATE_LINK_SNAPSHOT_MISMATCH);
  });

  it('rejeita link de outra observacao quando snapshot antigo e mantido', () => {
    const old = { source: 'OFFICIAL' as const, providerProductId: 'provider-1', productLink: 'https://shopee.com.br/product/1/100', affiliateLink: 'https://s.shopee.com.br/affiliate-1' };
    expect(code(context({ affiliateLink: 'https://s.shopee.com.br/affiliate-other', keepFingerprintFrom: old }))).toBe(COMMERCIAL_AFFILIATE_LINK_SNAPSHOT_MISMATCH);
  });

  it('aceita mudanca legitima somente com novo fingerprint e reexecuta deterministicamente', () => {
    const changed = context({ affiliateLink: 'https://s.shopee.com.br/affiliate-v2' });
    const first = validateCommercialAffiliateLinkProvenance(changed);
    expect(validateCommercialAffiliateLinkProvenance(changed)).toEqual(first);
    expect(first).toMatchObject({ valid: true });
    expect(changed.snapshot.fingerprint).not.toBe(context().snapshot.fingerprint);
  });

  it('mantem origem explicita para MANUAL e MOCK sem aplicar dominio OFFICIAL', () => {
    const manual = validateCommercialAffiliateLinkProvenance(context({ source: 'MANUAL', productLink: 'https://merchant.example/product/1', affiliateLink: 'https://affiliate.example/link/1' }));
    const mock = validateCommercialAffiliateLinkProvenance(context({ source: 'MOCK', productLink: 'https://example.invalid/product/1', affiliateLink: 'https://example.invalid/affiliate/1' }));
    expect(manual).toMatchObject({ valid: true, provenance: { origin: 'MANUAL_INPUT' } });
    expect(mock).toMatchObject({ valid: true, provenance: { origin: 'MOCK_FIXTURE' } });
  });
});