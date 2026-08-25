import { describe, expect, it, vi } from 'vitest';
import { PrismaShopeeOfferRepository } from '../src/prisma-repositories';

const capturedAt = new Date('2026-08-24T12:00:00.000Z');
const sentAt = new Date('2026-08-24T13:00:00.000Z');

const snapshot = {
  id: 'snapshot-current',
  productId: 'product-1',
  revision: 2,
  fingerprint: 'fingerprint-current',
  price: '99.90',
  priceMin: '89.90',
  priceMax: '109.90',
  discountRate: 30,
  commissionRate: 8,
  observedRating: 4.8,
  observedSales: 900,
  offerStartsAt: null,
  offerEndsAt: null,
  unavailableAt: null,
  capturedAt,
  createdAt: capturedAt,
};

const product = {
  id: 'product-1',
  source: 'OFFICIAL',
  providerProductId: '123',
  nome: '#OfertaRelâmpago com desconto 90 em período promocional',
  categoria: '100',
  price: '99.90',
  preco: '99.90',
  precoMin: '89.90',
  precoMax: '109.90',
  desconto: 90,
  nota: 4.8,
  vendidos: 900,
  comissao: 8,
  commissionAmount: null,
  sellerCommissionRate: null,
  shopeeCommissionRate: null,
  loja: 'Loja oficial',
  shopId: 'shop-1',
  shopType: [],
  categoryIds: ['100', '200'],
  urlImagem: 'https://example.invalid/product.jpg',
  productLink: 'https://example.invalid/product',
  affiliateLink: 'https://example.invalid/affiliate',
  offerStartsAt: capturedAt,
  offerEndsAt: new Date('2026-08-24T14:00:00.000Z'),
  fetchedAt: capturedAt,
  lastSeenAt: capturedAt,
  unavailableAt: null,
  commercialSnapshotRevision: 2,
  commercialSnapshotFingerprint: 'fingerprint-current',
  title: '#OfertaRelâmpago com desconto 90 em período promocional',
  score: null,
  scoreUpdatedAt: null,
  createdAt: capturedAt,
  updatedAt: capturedAt,
  commercialOfferSnapshots: [snapshot],
  commercialPromotionCandidates: [
    {
      id: 'candidate-stale',
      productId: 'product-1',
      snapshotId: 'snapshot-stale',
      campaignId: 'campaign-old',
      generatedCopyId: null,
      status: 'QUEUED',
      rankPosition: 1,
      commercialScore: 99,
      scorePolicyVersion: 'official-v2',
      minimumScoreUsed: 60,
      scoreBreakdown: {},
      promotionSignals: ['PROMOTION_CANDIDATE'],
      priceDropPercent: null,
      queuedAt: capturedAt,
      lastEvaluatedAt: capturedAt,
      expiresAt: null,
      dedupeUntil: null,
      blockedReason: null,
      createdAt: capturedAt,
      updatedAt: capturedAt,
      snapshot: {
        ...snapshot,
        id: 'snapshot-stale',
        revision: 1,
        fingerprint: 'old',
      },
      campaign: {
        id: 'campaign-old',
        name: 'Campanha antiga',
        nicheId: 'niche-old',
      },
    },
    {
      id: 'candidate-b',
      productId: 'product-1',
      snapshotId: 'snapshot-current',
      campaignId: 'campaign-b',
      generatedCopyId: null,
      status: 'COPY_READY',
      rankPosition: 2,
      commercialScore: 80,
      scorePolicyVersion: 'official-v2',
      minimumScoreUsed: 60,
      scoreBreakdown: {},
      promotionSignals: ['CURRENT_DISCOUNT'],
      priceDropPercent: null,
      queuedAt: capturedAt,
      lastEvaluatedAt: capturedAt,
      expiresAt: null,
      dedupeUntil: null,
      blockedReason: null,
      createdAt: capturedAt,
      updatedAt: capturedAt,
      snapshot,
      campaign: { id: 'campaign-b', name: 'Campanha B', nicheId: 'niche-b' },
    },
    {
      id: 'candidate-a',
      productId: 'product-1',
      snapshotId: 'snapshot-current',
      campaignId: 'campaign-a',
      generatedCopyId: null,
      status: 'QUEUED',
      rankPosition: 3,
      commercialScore: 80,
      scorePolicyVersion: 'official-v2',
      minimumScoreUsed: 60,
      scoreBreakdown: {},
      promotionSignals: ['CURRENT_DISCOUNT'],
      priceDropPercent: null,
      queuedAt: capturedAt,
      lastEvaluatedAt: capturedAt,
      expiresAt: null,
      dedupeUntil: null,
      blockedReason: null,
      createdAt: capturedAt,
      updatedAt: capturedAt,
      snapshot,
      campaign: { id: 'campaign-a', name: 'Campanha A', nicheId: 'niche-a' },
    },
  ],
};

const selection = {
  id: 'product-1',
  bestCurrentCommercialScore: 80,
  globalEverSent: true,
  globalSentDestinationCount: BigInt(1),
  globalLastSentAt: sentAt,
  scopedEverSent: false,
  scopedLastSentAt: null,
};

const candidateAggregate = {
  productId: 'product-1',
  currentCandidateCount: BigInt(2),
  queued: BigInt(1),
  copyReady: BigInt(1),
  reserved: BigInt(0),
  dispatched: BigInt(0),
  blocked: BigInt(0),
  expired: BigInt(0),
  bestCurrentCommercialScore: 80,
};

const currentCandidates = [
  {
    productId: 'product-1',
    candidateId: 'candidate-a',
    campaignId: 'campaign-a',
    campaignName: 'Campanha A',
    nicheId: 'niche-a',
    score: 80,
    rankPosition: 3,
    candidateStatus: 'QUEUED',
  },
  {
    productId: 'product-1',
    candidateId: 'candidate-b',
    campaignId: 'campaign-b',
    campaignName: 'Campanha B',
    nicheId: 'niche-b',
    score: 80,
    rankPosition: 2,
    candidateStatus: 'COPY_READY',
  },
];

const queryText = (query: { strings?: readonly string[] }) =>
  query.strings?.join('') ?? '';

const currentCandidatesOrAggregate = (query: {
  strings?: readonly string[];
}) =>
  queryText(query).includes('FROM current_candidates')
    ? currentCandidates
    : [candidateAggregate];

const catalogFilters = {
  page: 1,
  limit: 20,
  sort: 'score_desc' as const,
  deliveryStatus: 'not_sent' as const,
  destinationId: 'destination-b',
};

describe('PrismaShopeeOfferRepository operational catalog', () => {
  it('tipa source como ShopeeOfferSource e mantém o valor parametrizado', async () => {
    const rawQueries: Array<{
      strings?: readonly string[];
      values?: readonly unknown[];
    }> = [];
    const queryRaw = vi.fn(
      async (query: { strings?: readonly string[]; values?: readonly unknown[] }) => {
        rawQueries.push(query);
        const text = queryText(query);
        if (text.includes('COUNT(*) AS "total"')) return [{ total: BigInt(0) }];
        return [];
      },
    );
    const repository = new PrismaShopeeOfferRepository({ $queryRaw: queryRaw } as never);

    await repository.listOperationalCatalog({
      page: 1,
      limit: 20,
      sort: 'recent',
      deliveryStatus: 'any',
      source: 'OFFICIAL',
    });

    const catalogQuery = rawQueries.find((query) =>
      queryText(query).includes('FROM catalog'),
    );
    expect(queryText(catalogQuery ?? {})).toContain(
      'p."source" = ::"ShopeeOfferSource"',
    );
    expect(queryText(catalogQuery ?? {})).not.toContain('OFFICIAL');
    expect(catalogQuery?.values).toContain('OFFICIAL');
  });

  it('ignora candidate stale e mantém semantics global e por destino para SENT', async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([selection])
      .mockResolvedValueOnce([{ total: BigInt(1) }])
      .mockResolvedValueOnce([candidateAggregate])
      .mockResolvedValueOnce(currentCandidates);
    const repository = new PrismaShopeeOfferRepository({
      $queryRaw: queryRaw,
      productLead: { findMany: vi.fn(async () => [product]) },
    } as never);

    const result = await repository.listOperationalCatalog(catalogFilters);

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      referencePrice: null,
      referencePriceUnavailableReason: 'OFFICIAL_REFERENCE_PRICE_NOT_AVAILABLE',
      bestCurrentCommercialScore: 80,
      affiliateLinkPresent: true,
      everSent: true,
      sentDestinationCount: 1,
      destinationDelivery: {
        destinationId: 'destination-b',
        everSent: false,
      },
    });
    expect(
      result.items[0]?.commercialScores.map(({ campaignId }) => campaignId),
    ).toEqual(['campaign-a', 'campaign-b']);
    expect(result.items[0]?.commercialStateSummary).toMatchObject({
      currentCandidateCount: 2,
      queued: 1,
      copyReady: 1,
      bestCurrentCommercialScore: 80,
    });
    expect(result.items[0]).not.toHaveProperty('isFlashDeal');
  });

  it('pagina histórico de dispatches e snapshots sem alterar lifecycle', async () => {
    const dispatchHistory = [
      {
        id: 'dispatch-sent',
        status: 'SENT',
        instanceName: 'instance-a',
        sentAt,
        attemptCount: 1,
        destination: {
          id: 'destination-a',
          name: 'Grupo A',
          fingerprint: 'group-a',
          type: 'GROUP',
        },
        commercialPipelineRun: {
          id: 'run-1',
          finalStatus: 'SENT',
          investigationRequired: false,
        },
      },
      {
        id: 'dispatch-failed',
        status: 'FAILED',
        instanceName: null,
        sentAt: null,
        attemptCount: 1,
        destination: {
          id: 'destination-b',
          name: 'Grupo B',
          fingerprint: 'group-b',
          type: 'GROUP',
        },
        commercialPipelineRun: null,
      },
      {
        id: 'dispatch-pending',
        status: 'PENDING',
        instanceName: null,
        sentAt: null,
        attemptCount: 0,
        destination: {
          id: 'destination-c',
          name: 'Grupo C',
          fingerprint: 'group-c',
          type: 'GROUP',
        },
        commercialPipelineRun: null,
      },
    ];
    const repository = new PrismaShopeeOfferRepository({
      productLead: { findUnique: vi.fn(async () => product) },
      whatsAppDispatch: {
        aggregate: vi.fn(async () => ({
          _count: { _all: 1 },
          _max: { sentAt },
        })),
        groupBy: vi.fn(async () => [{ destinationId: 'destination-a' }]),
        findMany: vi.fn(async ({ skip }: { skip: number }) =>
          dispatchHistory.slice(skip),
        ),
      },
      $queryRaw: vi.fn(currentCandidatesOrAggregate),
      commercialOfferSnapshot: {
        findMany: vi.fn(async () => [
          snapshot,
          { ...snapshot, id: 'snapshot-old', revision: 1 },
        ]),
      },
    } as never);

    const detail = await repository.findOperationalCatalogOffer({
      id: 'product-1',
      dispatchPage: 1,
      dispatchLimit: 1,
      snapshotPage: 1,
      snapshotLimit: 1,
    });

    expect(detail?.dispatchHistory).toMatchObject({
      page: 1,
      hasNextPage: true,
      items: [{ dispatchId: 'dispatch-sent', status: 'SENT' }],
    });
    expect(detail?.snapshotHistory).toMatchObject({
      page: 1,
      hasNextPage: true,
      items: [{ id: 'snapshot-current', revision: 2 }],
    });
    expect(detail?.everSent).toBe(true);
    expect(detail?.affiliateLinkPresent).toBe(true);
    expect(detail).not.toHaveProperty('isFlashDeal');

    const secondPage = await repository.findOperationalCatalogOffer({
      id: 'product-1',
      dispatchPage: 2,
      dispatchLimit: 1,
      snapshotPage: 2,
      snapshotLimit: 1,
    });
    expect(secondPage?.dispatchHistory).toMatchObject({
      page: 2,
      hasPreviousPage: true,
      hasNextPage: true,
      items: [{ dispatchId: 'dispatch-failed', status: 'FAILED' }],
    });

    const thirdPage = await repository.findOperationalCatalogOffer({
      id: 'product-1',
      dispatchPage: 3,
      dispatchLimit: 1,
      snapshotPage: 1,
      snapshotLimit: 1,
    });
    expect(thirdPage?.dispatchHistory).toMatchObject({
      page: 3,
      hasPreviousPage: true,
      hasNextPage: false,
      items: [{ dispatchId: 'dispatch-pending', status: 'PENDING' }],
    });
  });

  it('preserva ordem e não repete itens entre páginas', async () => {
    const secondProduct = {
      ...product,
      id: 'product-2',
      providerProductId: '124',
      commercialOfferSnapshots: [],
      commercialPromotionCandidates: [],
    };
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ ...selection, id: 'product-1' }])
      .mockResolvedValueOnce([{ total: BigInt(2) }])
      .mockResolvedValueOnce([candidateAggregate])
      .mockResolvedValueOnce(currentCandidates)
      .mockResolvedValueOnce([
        {
          ...selection,
          id: 'product-2',
          bestCurrentCommercialScore: null,
          globalEverSent: false,
          globalSentDestinationCount: BigInt(0),
          globalLastSentAt: null,
          scopedEverSent: false,
          scopedLastSentAt: null,
        },
      ])
      .mockResolvedValueOnce([{ total: BigInt(2) }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const repository = new PrismaShopeeOfferRepository({
      $queryRaw: queryRaw,
      productLead: {
        findMany: vi.fn(
          async ({ where }: { where: { id: { in: string[] } } }) =>
            where.id.in[0] === 'product-1' ? [product] : [secondProduct],
        ),
      },
    } as never);

    const firstPage = await repository.listOperationalCatalog({
      ...catalogFilters,
      page: 1,
      limit: 1,
    });
    const secondPage = await repository.listOperationalCatalog({
      ...catalogFilters,
      page: 2,
      limit: 1,
    });

    expect(firstPage.items.map(({ id }) => id)).toEqual(['product-1']);
    expect(secondPage.items.map(({ id }) => id)).toEqual(['product-2']);
    expect(
      new Set([...firstPage.items, ...secondPage.items].map(({ id }) => id)),
    ).toHaveProperty('size', 2);
  });

  it.each([
    ['no SENT, only FAILED/PENDING', false, false],
    ['SENT to destination A', true, true],
    ['SENT to destination B only', true, false],
  ] as const)(
    'mantém matriz global/destino de SENT: %s',
    async (_label, global, scoped) => {
      const queryRaw = vi
        .fn()
        .mockResolvedValueOnce([
          {
            ...selection,
            globalEverSent: global,
            scopedEverSent: scoped,
            globalSentDestinationCount: global ? BigInt(1) : BigInt(0),
            globalLastSentAt: global ? sentAt : null,
          },
        ])
        .mockResolvedValueOnce([{ total: BigInt(1) }])
        .mockResolvedValueOnce([candidateAggregate])
        .mockResolvedValueOnce(currentCandidates);
      const repository = new PrismaShopeeOfferRepository({
        $queryRaw: queryRaw,
        productLead: { findMany: vi.fn(async () => [product]) },
      } as never);

      const result = await repository.listOperationalCatalog(catalogFilters);

      expect(result.items[0]).toMatchObject({
        everSent: global,
        destinationDelivery: { everSent: scoped },
      });
    },
  );

  it('não produz score nem passa filtro sem candidate da revision atual', async () => {
    const noCandidateProduct = {
      ...product,
      id: 'product-no-candidate',
      commercialSnapshotRevision: 0,
      commercialSnapshotFingerprint: null,
      commercialOfferSnapshots: [],
      commercialPromotionCandidates: [],
    };
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: BigInt(0) }]);
    const repository = new PrismaShopeeOfferRepository({
      $queryRaw: queryRaw,
      productLead: { findMany: vi.fn(async () => [noCandidateProduct]) },
    } as never);

    const result = await repository.listOperationalCatalog({
      ...catalogFilters,
      minScore: 80,
    });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('filtra candidates atuais antes do limite bounded, preservando os atuais após stale de score maior', async () => {
    const rawQueries: Array<{ strings?: readonly string[] }> = [];
    const queryRaw = vi.fn(async (query: { strings?: readonly string[] }) => {
      rawQueries.push(query);
      const text = queryText(query);
      if (text.includes('COUNT(*) AS "total"')) return [{ total: BigInt(1) }];
      if (text.includes('COUNT(*) AS "currentCandidateCount"')) {
        return [candidateAggregate];
      }
      if (text.includes('FROM current_candidates')) return currentCandidates;
      return [selection];
    });
    const repository = new PrismaShopeeOfferRepository({
      $queryRaw: queryRaw,
      productLead: { findMany: vi.fn(async () => [product]) },
    } as never);

    const result = await repository.listOperationalCatalog(catalogFilters);

    expect(
      result.items[0]?.commercialScores.map(({ candidateId }) => candidateId),
    ).toEqual(['candidate-a', 'candidate-b']);
    const currentQuery = rawQueries.find((query) =>
      queryText(query).includes('FROM current_candidates'),
    );
    expect(queryText(currentQuery ?? {})).toContain('ROW_NUMBER() OVER');
    expect(queryText(currentQuery ?? {})).toContain(
      'snapshot."revision" = product."commercialSnapshotRevision"',
    );
    expect(queryText(currentQuery ?? {})).toContain(
      'snapshot."fingerprint" = product."commercialSnapshotFingerprint"',
    );
    expect(
      queryText(currentQuery ?? {}).indexOf('snapshot."fingerprint"'),
    ).toBeLessThan(
      queryText(currentQuery ?? {}).indexOf('WHERE "currentPosition" <= '),
    );
  });

  it('usa ShopeeCategory como source of truth e conta somente ProductLead OFFICIAL', async () => {
    const rawQueries: Array<{
      strings?: readonly string[];
      values?: readonly unknown[];
    }> = [];
    const queryRaw = vi.fn(
      async (query: {
        strings?: readonly string[];
        values?: readonly unknown[];
      }) => {
        rawQueries.push(query);
        return [
          {
            id: '100001',
            name: null,
            parentId: null,
            mappingSource: 'OFFICIAL_PRODUCT_CATEGORY_ID',
            productCount: BigInt(1),
          },
          {
            id: '100002',
            name: null,
            parentId: null,
            mappingSource: 'OFFICIAL_PRODUCT_CATEGORY_ID',
            productCount: BigInt(2),
          },
          {
            id: '100004',
            name: null,
            parentId: null,
            mappingSource: 'OFFICIAL_PRODUCT_CATEGORY_ID',
            productCount: BigInt(0),
          },
        ];
      },
    );
    const repository = new PrismaShopeeOfferRepository({
      $queryRaw: queryRaw,
    } as never);

    await expect(repository.listObservedCategories()).resolves.toEqual([
      {
        id: '100001',
        name: null,
        parentId: null,
        mappingSource: 'OFFICIAL_PRODUCT_CATEGORY_ID',
        productCount: 1,
        displayLabel: 'Categoria 100001',
      },
      {
        id: '100002',
        name: null,
        parentId: null,
        mappingSource: 'OFFICIAL_PRODUCT_CATEGORY_ID',
        productCount: 2,
        displayLabel: 'Categoria 100002',
      },
      {
        id: '100004',
        name: null,
        parentId: null,
        mappingSource: 'OFFICIAL_PRODUCT_CATEGORY_ID',
        productCount: 0,
        displayLabel: 'Categoria 100004',
      },
    ]);

    const query = rawQueries[0];
    expect(queryText(query)).toContain('FROM "ShopeeCategory" registry');
    expect(queryText(query)).toContain(
      'product."source" = ::"ShopeeOfferSource"',
    );
    expect(queryText(query)).toContain('COUNT(DISTINCT product."id")');
    expect(queryText(query)).not.toContain('FROM "ProductLead" product,');
    expect(query.values).toContain('OFFICIAL');
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('não expõe categoria de ProductLead ausente no registry', async () => {
    const queryRaw = vi.fn(async () => [
      {
        id: '100001',
        name: null,
        parentId: null,
        mappingSource: 'OFFICIAL_PRODUCT_CATEGORY_ID',
        productCount: BigInt(1),
      },
    ]);
    const repository = new PrismaShopeeOfferRepository({
      $queryRaw: queryRaw,
    } as never);

    const categories = await repository.listObservedCategories();

    expect(categories.map(({ id }) => id)).toEqual(['100001']);
    expect(categories.map(({ id }) => id)).not.toContain('100003');
  });

  it('mantém source OFFICIAL no filtro de todas as páginas do backfill', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'product-001', categoryIds: ['100001'] }])
      .mockResolvedValueOnce([{ id: 'product-003', categoryIds: ['100004'] }]);
    const repository = new PrismaShopeeOfferRepository({
      productLead: { findMany },
    } as never);

    await expect(
      repository.listProductCategoryIdsForBackfill({ limit: 1 }),
    ).resolves.toEqual([{ productId: 'product-001', categoryIds: ['100001'] }]);
    await expect(
      repository.listProductCategoryIdsForBackfill({
        afterProductId: 'product-001',
        limit: 1,
      }),
    ).resolves.toEqual([{ productId: 'product-003', categoryIds: ['100004'] }]);

    expect(findMany).toHaveBeenNthCalledWith(1, {
      where: { source: 'OFFICIAL', id: undefined },
      select: { id: true, categoryIds: true },
      orderBy: { id: 'asc' },
      take: 1,
    });
    expect(findMany).toHaveBeenNthCalledWith(2, {
      where: { source: 'OFFICIAL', id: { gt: 'product-001' } },
      select: { id: true, categoryIds: true },
      orderBy: { id: 'asc' },
      take: 1,
    });
  });
});
