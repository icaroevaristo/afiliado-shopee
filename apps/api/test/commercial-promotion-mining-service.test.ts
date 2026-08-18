import { describe, expect, it, vi } from 'vitest';

import { CommercialNicheMatcher } from '../src/commercial-niche-matcher';
import { fingerprintCommercialOfferProduct } from '../src/commercial-offer-snapshot';
import { CommercialOfferScorePolicyResolver } from '../src/commercial-offer-score-policy';
import { CommercialPromotionMiningService } from '../src/commercial-promotion-mining-service';
import { CommercialPromotionSignalDetector } from '../src/commercial-promotion-signal-detector';
import type {
  CommercialGroupCampaignRecord,
  CommercialNicheRecord,
  CommercialPromotionCandidateRecord,
  CommercialPromotionCatalogItem,
  CommercialPromotionMaterializationResult,
  ShopeeOfferRecord,
} from '../src/repositories';

const NOW = new Date('2026-07-29T15:00:00.000Z');

const campaign = (
  overrides: Partial<CommercialGroupCampaignRecord> = {},
): CommercialGroupCampaignRecord => ({
  id: 'campaign-1',
  name: 'Campanha',
  logicalGroupFingerprint: 'grp_safe',
  anchorDestinationId: 'destination-1',
  nicheId: 'niche-1',
  active: true,
  cadenceMinutes: 15,
  timezone: 'America/Sao_Paulo',
  allowedStartTime: '07:00',
  allowedEndTime: '22:00',
  dailyLimit: 10,
  failureCount: 0,
  nextEligibleAt: null,
  attemptExecutionId: null,
  attemptReservedAt: null,
  attemptLeaseExpiresAt: null,
  queueTargetSize: 2,
  dedupeDays: 30,
  niche: { id: 'niche-1', name: 'Nicho', slug: 'nicho', active: true },
  anchorDestination: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const niche = (
  overrides: Partial<CommercialNicheRecord> = {},
): CommercialNicheRecord => ({
  id: 'niche-1',
  name: 'Nicho',
  slug: 'nicho',
  active: true,
  categoryIds: [],
  includeKeywords: [],
  excludeKeywords: [],
  minPrice: null,
  maxPrice: null,
  minDiscountRate: 5,
  minRating: 0,
  minSales: 0,
  minCommissionRate: 0,
  minimumScore: 0,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const product = (
  id: string,
  overrides: Partial<ShopeeOfferRecord> = {},
): ShopeeOfferRecord => ({
  id,
  source: 'OFFICIAL',
  providerProductId: `external-${id}`,
  productName: `Produto ${id}`,
  shopId: 'shop-1',
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
  score: 1,
  scoreUpdatedAt: NOW,
  createdAt: new Date(NOW.getTime() - 60_000),
  updatedAt: NOW,
  ...overrides,
});

const productFingerprint = (value: ShopeeOfferRecord) =>
  fingerprintCommercialOfferProduct(value);

const catalogItem = (
  id: string,
  overrides: Partial<CommercialPromotionCatalogItem> = {},
): CommercialPromotionCatalogItem => {
  const currentProduct = overrides.product ?? product(id);
  const currentSnapshot = {
    id: `snapshot-${id}`,
    productId: id,
    revision: 1,
    fingerprint: productFingerprint(currentProduct),
    price: '80',
    priceMin: '80',
    priceMax: '80',
    discountRate: 20,
    commissionRate: 10,
    observedRating: 4.8,
    observedSales: 500,
    offerStartsAt: null,
    offerEndsAt: null,
    unavailableAt: null,
    capturedAt: new Date(NOW.getTime() - 60_000),
    createdAt: NOW,
  };
  return {
    product: currentProduct,
    commercialSnapshotRevision: 1,
    commercialSnapshotFingerprint: currentSnapshot.fingerprint,
    latestSnapshotRevision: 1,
    currentSnapshot,
    previousSnapshot: null,
    ...overrides,
  };
};

const existingCandidate = (
  productId: string,
  overrides: Partial<CommercialPromotionCandidateRecord> = {},
): CommercialPromotionCandidateRecord => ({
  id: `candidate-${productId}`,
  campaignId: 'campaign-1',
  productId,
  snapshotId: `snapshot-${productId}`,
  status: 'QUEUED',
  rankPosition: 1,
  commercialScore: 70,
  scorePolicyVersion: 'official-v2',
  minimumScoreUsed: 0,
  scoreBreakdown: {
    policyVersion: 'official-v2',
    rawTotal: 70,
    finalScore: 70,
    components: {},
  },
  promotionSignals: ['CURRENT_DISCOUNT'],
  priceDropPercent: null,
  queuedAt: NOW,
  lastEvaluatedAt: NOW,
  expiresAt: null,
  dedupeUntil: null,
  blockedReason: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const materialized = (
  overrides: Partial<CommercialPromotionMaterializationResult> = {},
): CommercialPromotionMaterializationResult => ({
  protectedCount: 0,
  queueCapacity: 2,
  queuedBefore: 0,
  queuedCreated: 2,
  queuedReactivated: 0,
  queuedUpdated: 0,
  queuedBlocked: 0,
  queuedExpired: 0,
  queuedAfter: 2,
  queueTargetSize: 2,
  queueFull: true,
  ...overrides,
});

const setup = ({
  products = [catalogItem('product-a'), catalogItem('product-b')],
  campaignRecord = campaign(),
  nicheRecord = niche(),
  candidates = [],
  recentlySent = new Set<string>(),
  groupAvailable = true,
}: {
  products?: CommercialPromotionCatalogItem[];
  campaignRecord?: CommercialGroupCampaignRecord;
  nicheRecord?: CommercialNicheRecord;
  candidates?: CommercialPromotionCandidateRecord[];
  recentlySent?: Set<string>;
  groupAvailable?: boolean;
} = {}) => {
  const materialize = vi.fn(async () => materialized());
  const listOfficialCatalogPage = vi.fn(async ({ afterId, limit }) => {
    const start = afterId
      ? products.findIndex(({ product }) => product.id === afterId) + 1
      : 0;
    const items = products.slice(start, start + limit);
    return { items, hasMore: start + limit < products.length };
  });
  const repository = {
    listCampaignCandidates: vi.fn(async () => candidates),
    findRecentlySentProductIds: vi.fn(async () => recentlySent),
    materialize,
    listQueue: vi.fn(async () => ({ items: [], total: 0 })),
    markDispatchedByGeneratedCopyId: vi.fn(async () => ({
      kind: 'LEGACY' as const,
    })),
    markBlockedByGeneratedCopyId: vi.fn(async () => ({
      kind: 'LEGACY' as const,
    })),
    resetCampaignFailureStateByGeneratedCopyId: vi.fn(async () => ({
      kind: 'LEGACY' as const,
    })),
  };
  const scorePolicies = new CommercialOfferScorePolicyResolver({
    calculate: () => 0,
  } as never);
  const forSource = vi.spyOn(scorePolicies, 'forSource');
  const service = new CommercialPromotionMiningService({
    campaigns: {
      createForGroup: vi.fn(),
      list: vi.fn(),
      findById: vi.fn(async () => campaignRecord),
      update: vi.fn(),
      hasEligibleDestination: vi.fn(async () => groupAvailable),
      activateIfEligible: vi.fn(),
    },
    niches: {
      create: vi.fn(),
      list: vi.fn(),
      findById: vi.fn(async () => nicheRecord),
      update: vi.fn(),
    },
    catalog: { listOfficialCatalogPage },
    candidates: repository,
    scorePolicies,
    matcher: new CommercialNicheMatcher(),
    signalDetector: new CommercialPromotionSignalDetector(),
    clock: () => NOW,
  });
  return {
    service,
    materialize,
    repository,
    listOfficialCatalogPage,
    forSource,
  };
};

describe('CommercialPromotionMiningService', () => {
  it('faz preview read-only com official-v2, matcher e resposta sanitizada', async () => {
    const { service, materialize, forSource } = setup();
    const report = await service.preview('campaign-1', {});
    expect(report).toMatchObject({
      preview: true,
      evaluatedCount: 2,
      structurallyEligibleCount: 2,
      nicheMatchedCount: 2,
      promotionMatchedCount: 2,
      queuedCreated: 0,
      signalSummary: { NEWLY_OBSERVED: 2, CURRENT_DISCOUNT: 2 },
    });
    expect(report.projectedCandidates).toHaveLength(2);
    expect(materialize).not.toHaveBeenCalled();
    expect(forSource).toHaveBeenCalledWith('OFFICIAL');
    expect(JSON.stringify(report)).not.toMatch(
      /affiliate|productLink|providerProductId|shopId|fingerprint-/i,
    );
  });

  it('usa o ranking promocional no entrypoint de candidatos mesmo quando o score legado favoreceria outro', async () => {
    const priceDropLowScore = catalogItem('price-drop-low-score', {
      product: product('price-drop-low-score', {
        rating: 0,
        sales: 0,
        commissionRate: 0,
        discountRate: 5,
      }),
      commercialSnapshotRevision: 2,
      commercialSnapshotFingerprint: 'fingerprint-price-drop-2',
      latestSnapshotRevision: 2,
    });
    const priceDropFingerprint = productFingerprint(priceDropLowScore.product);
    priceDropLowScore.commercialSnapshotFingerprint = priceDropFingerprint;
    priceDropLowScore.currentSnapshot = {
      ...priceDropLowScore.currentSnapshot!,
      id: 'snapshot-price-drop-2',
      revision: 2,
      fingerprint: priceDropFingerprint,
      price: '80',
      discountRate: 5,
      commissionRate: 0,
    };
    priceDropLowScore.previousSnapshot = {
      ...priceDropLowScore.currentSnapshot,
      id: 'snapshot-price-drop-1',
      revision: 1,
      fingerprint: 'fingerprint-price-drop-1',
      price: '100',
    };

    const scoreFirst = catalogItem('score-first', {
      product: product('score-first', {
        rating: 5,
        sales: 10_000,
        commissionRate: 20,
        discountRate: 100,
      }),
    });
    const { service } = setup({
      products: [scoreFirst, priceDropLowScore],
      campaignRecord: campaign({ queueTargetSize: 1 }),
    });

    const report = await service.preview('campaign-1');

    expect(report.projectedCandidates?.[0]).toMatchObject({
      productId: 'price-drop-low-score',
      promotionSignals: expect.arrayContaining(['PRICE_DROP']),
    });
  });

  it('informa campanha inativa e grupo indisponivel sem impedir a analise do preview', async () => {
    const { service } = setup({
      campaignRecord: campaign({ active: false }),
      groupAvailable: false,
    });
    await expect(service.preview('campaign-1')).resolves.toMatchObject({
      campaignActive: false,
      groupAvailable: false,
      evaluatedCount: 2,
      rejectionSummary: { CAMPAIGN_INACTIVE: 1, GROUP_UNAVAILABLE: 1 },
    });
  });

  it('bloqueia elegibilidade quando o nicho esta inativo', async () => {
    const { service } = setup({ nicheRecord: niche({ active: false }) });
    await expect(service.preview('campaign-1')).resolves.toMatchObject({
      nicheActive: false,
      evaluatedCount: 0,
      projectedCandidates: [],
      rejectionSummary: { NICHE_INACTIVE: 1 },
    });
  });

  it('isola rejeicoes estruturais, de nicho e de snapshot', async () => {
    const invalidStructure = catalogItem('invalid-structure', {
      product: product('invalid-structure', { affiliateLink: undefined }),
    });
    const belowScore = catalogItem('below-score', {
      product: product('below-score', {
        rating: 0,
        sales: 0,
        commissionRate: 0,
        discountRate: 5,
      }),
    });
    const missingSnapshot = catalogItem('missing-snapshot', {
      currentSnapshot: null,
      commercialSnapshotRevision: 0,
      commercialSnapshotFingerprint: null,
      latestSnapshotRevision: null,
    });
    const outdatedSnapshot = catalogItem('outdated-snapshot', {
      commercialSnapshotFingerprint: 'different',
    });
    const { service } = setup({
      products: [
        invalidStructure,
        belowScore,
        missingSnapshot,
        outdatedSnapshot,
      ],
      nicheRecord: niche({ minimumScore: 55 }),
    });
    await expect(service.preview('campaign-1')).resolves.toMatchObject({
      evaluatedCount: 4,
      rejectionSummary: {
        STRUCTURAL_REJECTION: 1,
        SCORE_BELOW_MINIMUM: 1,
        SNAPSHOT_MISSING: 1,
        SNAPSHOT_OUTDATED: 1,
      },
    });
  });

  it('deduplica por SENT no fingerprint logico e por candidato DISPATCHED ativo', async () => {
    const candidates = [
      existingCandidate('product-b', {
        status: 'DISPATCHED',
        dedupeUntil: new Date(NOW.getTime() + 60_000),
      }),
    ];
    const { service, repository } = setup({
      candidates,
      recentlySent: new Set(['product-a']),
    });
    const report = await service.preview('campaign-1');
    expect(report).toMatchObject({
      recentlySentRejectedCount: 1,
      dedupeRejectedCount: 1,
      rejectionSummary: {
        RECENTLY_SENT_TO_LOGICAL_GROUP: 1,
        DEDUPE_ACTIVE: 1,
      },
    });
    expect(repository.findRecentlySentProductIds).toHaveBeenCalledWith(
      expect.objectContaining({ logicalGroupFingerprint: 'grp_safe' }),
    );
  });

  it('usa exatamente o snapshot anterior e bloqueia uma cadeia incompleta', async () => {
    const current = catalogItem('changed', {
      commercialSnapshotRevision: 2,
      commercialSnapshotFingerprint: 'fingerprint-changed-2',
      latestSnapshotRevision: 2,
    });
    const currentFingerprint = productFingerprint(current.product);
    current.commercialSnapshotFingerprint = currentFingerprint;
    current.currentSnapshot = {
      ...current.currentSnapshot!,
      id: 'snapshot-changed-2',
      revision: 2,
      fingerprint: currentFingerprint,
      price: '80',
    };
    current.previousSnapshot = {
      ...current.currentSnapshot,
      id: 'snapshot-changed-1',
      revision: 1,
      fingerprint: 'fingerprint-changed-1',
      price: '100',
    };
    const missingPrevious = catalogItem('missing-previous', {
      commercialSnapshotRevision: 2,
      commercialSnapshotFingerprint: 'fingerprint-missing-previous',
      latestSnapshotRevision: 2,
    });
    const missingPreviousFingerprint = productFingerprint(missingPrevious.product);
    missingPrevious.commercialSnapshotFingerprint = missingPreviousFingerprint;
    missingPrevious.currentSnapshot = {
      ...missingPrevious.currentSnapshot!,
      revision: 2,
      fingerprint: missingPreviousFingerprint,
    };
    const { service } = setup({ products: [current, missingPrevious] });
    const report = await service.preview('campaign-1');
    expect(report.projectedCandidates?.[0]).toMatchObject({
      productId: 'changed',
      promotionSignals: expect.arrayContaining(['PRICE_DROP']),
      priceDropPercent: '20',
    });
    expect(report.rejectionSummary.SNAPSHOT_OUTDATED).toBe(1);
  });

  it('rejeita revision do produto que nao seja o ultimo snapshot', async () => {
    const { service } = setup({
      products: [
        catalogItem('stale', { latestSnapshotRevision: 2 }),
        catalogItem('unlinked', {
          commercialSnapshotRevision: 0,
          commercialSnapshotFingerprint: null,
          currentSnapshot: null,
          latestSnapshotRevision: 1,
        }),
      ],
    });
    await expect(service.preview('campaign-1')).resolves.toMatchObject({
      promotionMatchedCount: 0,
      rejectionSummary: { SNAPSHOT_OUTDATED: 2 },
    });
  });

  it('preserva protegidos, reduz a capacidade e limita o preview a 20', async () => {
    const products = Array.from({ length: 30 }, (_, index) =>
      catalogItem(`product-${String(index).padStart(2, '0')}`),
    );
    const { service } = setup({
      products,
      campaignRecord: campaign({ queueTargetSize: 25 }),
      candidates: [existingCandidate('protected', { status: 'COPY_READY' })],
    });
    const report = await service.preview('campaign-1');
    expect(report.protectedCount).toBe(1);
    expect(report.queueCapacity).toBe(24);
    expect(report.projectedCandidates).toHaveLength(20);
    expect(report.rejectionSummary.QUEUE_NOT_SELECTED).toBe(6);
  });

  it('detecta o 2001o item, informa truncamento e impede escrita no mine', async () => {
    const products = Array.from({ length: 2_001 }, (_, index) =>
      catalogItem(`p${String(index).padStart(4, '0')}`),
    );
    const { service, materialize, listOfficialCatalogPage } = setup({
      products,
    });
    const preview = await service.preview('campaign-1');
    expect(preview).toMatchObject({
      evaluatedCount: 2_000,
      evaluationTruncated: true,
      rejectionSummary: { COMMERCIAL_PROMOTION_EVALUATION_TRUNCATED: 1 },
    });
    expect(listOfficialCatalogPage).toHaveBeenCalledTimes(10);
    await expect(
      service.mine('campaign-1', { confirm: 'MINERAR_PROMOCOES' }),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_PROMOTION_EVALUATION_TRUNCATED',
    });
    expect(materialize).not.toHaveBeenCalled();
  });

  it('materializa fora da avaliacao e passa snapshots/configuracao para revalidacao', async () => {
    const { service, materialize } = setup();
    const report = await service.mine('campaign-1', {
      confirm: 'MINERAR_PROMOCOES',
    });
    expect(materialize).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 'campaign-1',
        nicheId: 'niche-1',
        logicalGroupFingerprint: 'grp_safe',
        rankedCandidates: expect.arrayContaining([
          expect.objectContaining({
            snapshotId: 'snapshot-product-a',
            snapshotRevision: 1,
          }),
        ]),
      }),
    );
    expect(report).toMatchObject({
      preview: false,
      queuedCreated: 2,
      queuedAfter: 2,
    });
  });

  it('exige confirmacao exata e bloqueia mine inativo ou sem grupo', async () => {
    const active = setup().service;
    await expect(active.mine('campaign-1', {})).rejects.toMatchObject({
      code: 'COMMERCIAL_PROMOTION_CONFIRMATION_REQUIRED',
    });
    await expect(
      setup({ campaignRecord: campaign({ active: false }) }).service.mine(
        'campaign-1',
        { confirm: 'MINERAR_PROMOCOES' },
      ),
    ).rejects.toMatchObject({ code: 'CAMPAIGN_INACTIVE' });
    await expect(
      setup({ groupAvailable: false }).service.mine('campaign-1', {
        confirm: 'MINERAR_PROMOCOES',
      }),
    ).rejects.toMatchObject({ code: 'GROUP_UNAVAILABLE' });
  });

  it('deduplica repeticao exata do mesmo produto no catalogo antes do ranking', async () => {
    const repeated = catalogItem('product-a');
    const { service } = setup({ products: [repeated, repeated, catalogItem('product-b')] });

    const report = await service.preview('campaign-1');

    expect(report.evaluatedCount).toBe(2);
    expect(report.projectedCandidates?.map(({ productId }) => productId)).toEqual([
      'product-a',
      'product-b',
    ]);
  });

  it('falha fechado se dois ProductLead diferentes reivindicam a mesma identidade do provider', async () => {
    const first = catalogItem('product-a');
    const duplicateIdentity = catalogItem('product-b', {
      product: product('product-b', {
        providerProductId: first.product.providerProductId,
        shopId: first.product.shopId,
      }),
    });
    const { service } = setup({ products: [first, duplicateIdentity] });

    await expect(service.preview('campaign-1')).rejects.toMatchObject({
      code: 'PRODUCT_VARIANT_DEDUPLICATION',
    });
  });

  it('falha fechado se a mesma identidade atomica aparece com outra loja', async () => {
    const first = catalogItem('product-a');
    const conflictingShop = catalogItem('product-b', {
      product: product('product-b', {
        providerProductId: first.product.providerProductId,
        shopId: 'shop-2',
      }),
    });
    const { service } = setup({ products: [first, conflictingShop] });

    await expect(service.preview('campaign-1')).rejects.toMatchObject({
      code: 'PRODUCT_VARIANT_DEDUPLICATION',
    });
  });


  it('ignora score legado persistido e ranqueia pelo official-v2 recalculado', async () => {
    const persistedHigh = catalogItem('product-b', {
      product: product('product-b', { score: 100 }),
    });
    const persistedLow = catalogItem('product-a', {
      product: product('product-a', { score: 1 }),
    });
    const { service } = setup({ products: [persistedHigh, persistedLow] });

    const report = await service.preview('campaign-1');

    expect(report.projectedCandidates?.map(({ productId }) => productId)).toEqual([
      'product-a',
      'product-b',
    ]);
    expect(report.projectedCandidates?.[0]?.commercialScore).toBe(
      report.projectedCandidates?.[1]?.commercialScore,
    );
  });

  it('rejeita snapshot stale recalculado antes do ranking e promove o proximo elegivel', async () => {
    const stale = catalogItem('stale');
    stale.product.price = '79';
    stale.product.priceMin = '79';
    stale.product.priceMax = '79';
    const next = catalogItem('next');
    const staleCandidate = existingCandidate('stale', { rankPosition: 1 });
    const { service, materialize } = setup({
      products: [stale, next],
      candidates: [staleCandidate],
      campaignRecord: campaign({ queueTargetSize: 1 }),
    });

    const preview = await service.preview('campaign-1');
    expect(preview.rejectionSummary.SNAPSHOT_OUTDATED).toBe(1);
    expect(preview.projectedCandidates).toEqual([
      expect.objectContaining({ productId: 'next', projectedRank: 1 }),
    ]);

    await service.mine('campaign-1', { confirm: 'MINERAR_PROMOCOES' });
    expect(materialize).toHaveBeenCalledWith(
      expect.objectContaining({
        rankedCandidates: [expect.objectContaining({ productId: 'next' })],
      }),
    );
  });

  it('preserva snapshot atual e torna o produto reelegivel apos snapshot novo coerente', async () => {
    const current = catalogItem('current');
    const currentPreview = await setup({ products: [current] }).service.preview(
      'campaign-1',
    );
    expect(currentPreview.rejectionSummary.SNAPSHOT_OUTDATED).toBeUndefined();
    expect(currentPreview.projectedCandidates?.[0]).toMatchObject({
      productId: 'current',
      projectedRank: 1,
    });

    const stale = catalogItem('reeligible');
    stale.product.price = '70';
    stale.product.priceMin = '70';
    stale.product.priceMax = '70';
    const stalePreview = await setup({ products: [stale] }).service.preview(
      'campaign-1',
    );
    expect(stalePreview.projectedCandidates).toEqual([]);
    expect(stalePreview.rejectionSummary.SNAPSHOT_OUTDATED).toBe(1);

    const refreshed = catalogItem('reeligible', {
      product: product('reeligible', {
        price: '70',
        priceMin: '70',
        priceMax: '70',
      }),
    });
    const refreshedPreview = await setup({ products: [refreshed] }).service.preview(
      'campaign-1',
    );
    expect(refreshedPreview.rejectionSummary.SNAPSHOT_OUTDATED).toBeUndefined();
    expect(refreshedPreview.projectedCandidates?.[0]).toMatchObject({
      productId: 'reeligible',
      projectedRank: 1,
    });
  });
});
