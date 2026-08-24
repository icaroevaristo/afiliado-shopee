import { describe, expect, it, vi } from 'vitest';
import {
  MockShopeeAffiliateOfferProvider,
  OfficialShopeeAffiliateOfferProvider,
} from '@shopee-auto-affiliate-ai/providers';
import { buildAuthenticatedTestApp } from './authenticated-test-app';

const createPrismaMock = () => {
  const store = new Map<string, Record<string, unknown>>();
  const catalogRecord = (record: Record<string, unknown>) => ({
    ...record,
    commercialOfferSnapshots: [],
    commercialPromotionCandidates: [],
  });
  const findByWhere = (where: Record<string, unknown>) => {
    if (typeof where.id === 'string') return store.get(where.id) ?? null;
    const logical = where.source_providerProductId as
      { source: string; providerProductId: string } | undefined;
    return logical
      ? ([...store.values()].find(
          (record) =>
            record.source === logical.source &&
            record.providerProductId === logical.providerProductId,
        ) ?? null)
      : null;
  };
  const productLead = {
    findUnique: vi.fn(
      async ({
        where,
        select,
      }: {
        where: Record<string, unknown>;
        select?: unknown;
        include?: unknown;
      }) => {
        const record = findByWhere(where);
        if (!record) return null;
        if (select) return { id: record.id };
        return catalogRecord(record);
      },
    ),
    findMany: vi.fn(async () => [...store.values()].map(catalogRecord)),
    count: vi.fn(async () => store.size),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const record = {
        ...data,
        id: `offer-${store.size + 1}`,
        score: null,
        scoreUpdatedAt: null,
        commercialSnapshotRevision: 0,
        commercialSnapshotFingerprint: null,
        createdAt: now,
        updatedAt: now,
      };
      store.set(String(record.id), record);
      return record;
    }),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const current = findByWhere(where);
        if (!current) throw new Error('not found');
        const record: Record<string, unknown> = {
          ...current,
          ...data,
          updatedAt: new Date(),
        };
        store.set(String(record.id), record);
        return record;
      },
    ),
  };
  const whatsAppDispatch = {
    aggregate: vi.fn(async () => ({
      _count: { _all: 0 },
      _max: { sentAt: null },
    })),
    groupBy: vi.fn(async () => []),
    findMany: vi.fn(async () => []),
  };
  const commercialOfferSnapshot = { findMany: vi.fn(async () => []) };
  const prisma = {
    productLead,
    whatsAppDispatch,
    commercialOfferSnapshot,
    $queryRaw: vi.fn(async (query: { strings?: readonly string[] }) => {
      const sql = query.strings?.join('') ?? '';
      if (sql.includes('"ShopeeCategory"')) {
        return [
          {
            id: '100001',
            name: null,
            parentId: null,
            mappingSource: 'OFFICIAL_PRODUCT_CATEGORY_ID',
            productCount: BigInt(1),
          },
        ];
      }
      if (sql.includes('COUNT(*) AS "total"')) {
        return [{ total: BigInt(store.size) }];
      }
      return [...store.values()].map((record) => ({
        id: String(record.id),
        bestCurrentCommercialScore: null,
        globalEverSent: false,
        globalSentDestinationCount: BigInt(0),
        globalLastSentAt: null,
        scopedEverSent: false,
        scopedLastSentAt: null,
      }));
    }),
  };
  return { store, prisma };
};

const manualRecord = {
  providerProductId: 'manual-001',
  productName: 'Produto manual ficticio',
  shopName: 'Loja ficticia',
  price: '42.90',
  discountRate: 15,
  rating: 4.7,
  sales: 200,
  commissionRate: 7,
  imageUrl: 'https://example.invalid/manual.jpg',
  productLink: 'https://example.invalid/product/manual-001',
  affiliateLink: 'https://example.invalid/affiliate/manual-001',
};

type CatalogFixture = {
  record: Record<string, unknown>;
  currentScore: number | null;
  sentDestinationIds: string[];
  dispatchStatuses: Array<'SENT' | 'FAILED' | 'PENDING'>;
};

const catalogFixture = (
  id: string,
  categoryId: string,
  input: {
    price: number;
    discount: number;
    commission: number;
    sales: number;
    score: number | null;
    sentDestinationIds: string[];
    dispatchStatuses: Array<'SENT' | 'FAILED' | 'PENDING'>;
  },
): CatalogFixture => {
  const capturedAt = new Date('2026-08-24T12:00:00.000Z');
  const fingerprint = `fingerprint-${id}`;
  return {
    currentScore: input.score,
    sentDestinationIds: input.sentDestinationIds,
    dispatchStatuses: input.dispatchStatuses,
    record: {
      id,
      source: 'OFFICIAL',
      providerProductId: `provider-${id}`,
      nome: `Produto ${id}`,
      categoria: categoryId,
      categoryIds: [categoryId],
      preco: String(input.price),
      precoMin: String(input.price),
      precoMax: String(input.price),
      desconto: input.discount,
      nota: 4.8,
      vendidos: input.sales,
      comissao: input.commission,
      commissionAmount: null,
      sellerCommissionRate: null,
      shopeeCommissionRate: null,
      loja: `Loja ${id}`,
      shopId: `shop-${id}`,
      shopType: [],
      urlImagem: 'https://example.invalid/catalog.jpg',
      productLink: `https://example.invalid/product/${id}`,
      affiliateLink: `https://example.invalid/affiliate/${id}`,
      offerStartsAt: null,
      offerEndsAt: null,
      fetchedAt: capturedAt,
      lastSeenAt: capturedAt,
      unavailableAt: null,
      commercialSnapshotRevision: input.score === null ? 0 : 1,
      commercialSnapshotFingerprint: input.score === null ? null : fingerprint,
      title: `Produto ${id}`,
      score: null,
      scoreUpdatedAt: null,
      createdAt: capturedAt,
      updatedAt: capturedAt,
      commercialOfferSnapshots:
        input.score === null
          ? []
          : [
              {
                id: `snapshot-${id}`,
                productId: id,
                revision: 1,
                fingerprint,
                price: String(input.price),
                priceMin: null,
                priceMax: null,
                discountRate: input.discount,
                commissionRate: input.commission,
                observedRating: 4.8,
                observedSales: input.sales,
                offerStartsAt: null,
                offerEndsAt: null,
                unavailableAt: null,
                capturedAt,
              },
            ],
    },
  };
};

const queryText = (query: { strings?: readonly string[] }) =>
  query.strings?.join('') ?? '';

const valueAfter = (
  query: { strings?: readonly string[]; values?: readonly unknown[] },
  marker: string,
) => {
  const index = query.strings?.findIndex((part) => part.includes(marker)) ?? -1;
  return index >= 0 ? query.values?.[index] : undefined;
};

const createFilteredCatalogPrismaMock = (fixtures: CatalogFixture[]) => {
  const recordsById = new Map(
    fixtures.map((fixture) => [String(fixture.record.id), fixture.record]),
  );
  const filteredFixtures = (query: {
    strings?: readonly string[];
    values?: readonly unknown[];
  }) => {
    const sql = queryText(query);
    const destinationId = query.values?.[0] as string | null | undefined;
    return fixtures.filter((fixture) => {
      const record = fixture.record;
      const sentToScopedDestination =
        fixture.dispatchStatuses.includes('SENT') &&
        fixture.sentDestinationIds.includes(String(destinationId));
      if (
        sql.includes('p."categoryIds" @> ARRAY[') &&
        !(record.categoryIds as string[]).includes(
          String(valueAfter(query, 'p."categoryIds" @> ARRAY[')),
        )
      ) {
        return false;
      }
      const numericFilters: Array<
        [string, keyof typeof record, 'min' | 'max']
      > = [
        ['p."desconto" >= ', 'desconto', 'min'],
        ['p."desconto" <= ', 'desconto', 'max'],
        ['p."preco" >= ', 'preco', 'min'],
        ['p."preco" <= ', 'preco', 'max'],
        ['p."comissao" >= ', 'comissao', 'min'],
        ['p."comissao" <= ', 'comissao', 'max'],
        [
          'score."bestCurrentCommercialScore" >= ',
          'commercialSnapshotRevision',
          'min',
        ],
        [
          'score."bestCurrentCommercialScore" <= ',
          'commercialSnapshotRevision',
          'max',
        ],
      ];
      for (const [marker, field, direction] of numericFilters) {
        if (!sql.includes(marker)) continue;
        const value = Number(valueAfter(query, marker));
        const actual = marker.includes('bestCurrentCommercialScore')
          ? fixture.currentScore
          : Number(record[field]);
        if (
          actual === null ||
          (direction === 'min' ? actual < value : actual > value)
        ) {
          return false;
        }
      }
      if (sql.includes('delivery."scopedEverSent" = true')) {
        if (!sentToScopedDestination) return false;
      }
      if (sql.includes('delivery."scopedEverSent" = false')) {
        if (sentToScopedDestination) return false;
      }
      return true;
    });
  };
  const sortFixtures = (
    fixturesToSort: CatalogFixture[],
    query: { strings?: readonly string[] },
  ) => {
    const sql = queryText(query);
    return [...fixturesToSort].sort((left, right) => {
      if (sql.includes('catalog."bestCurrentCommercialScore" DESC')) {
        return (right.currentScore ?? -1) - (left.currentScore ?? -1);
      }
      if (sql.includes('catalog."sales" DESC')) {
        return Number(right.record.vendidos) - Number(left.record.vendidos);
      }
      return String(left.record.id).localeCompare(String(right.record.id));
    });
  };
  const prisma = {
    productLead: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => recordsById.get(id)).filter(Boolean),
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          recordsById.get(where.id) ?? null,
      ),
    },
    whatsAppDispatch: {
      aggregate: vi.fn(async () => ({
        _count: { _all: 0 },
        _max: { sentAt: null },
      })),
      groupBy: vi.fn(async () => []),
      findMany: vi.fn(async () => []),
    },
    commercialOfferSnapshot: { findMany: vi.fn(async () => []) },
    $queryRaw: vi.fn(
      async (query: {
        strings?: readonly string[];
        values?: readonly unknown[];
      }) => {
        const sql = queryText(query);
        if (sql.includes('"ShopeeCategory"')) {
          return ['category-a', 'category-b', 'category-c'].map((id) => ({
            id,
            name: null,
            parentId: null,
            mappingSource: 'OFFICIAL_PRODUCT_CATEGORY_ID',
            productCount: BigInt(
              fixtures.filter((fixture) =>
                (fixture.record.categoryIds as string[]).includes(id),
              ).length,
            ),
          }));
        }
        if (sql.includes('COUNT(*) AS "total"')) {
          return [{ total: BigInt(filteredFixtures(query).length) }];
        }
        if (sql.includes('FROM catalog')) {
          const values = query.values ?? [];
          const limit = Number(values.at(-1));
          const offset = Number(values.at(-2));
          return sortFixtures(filteredFixtures(query), query)
            .slice(offset, offset + limit)
            .map((fixture) => ({
              id: fixture.record.id,
              bestCurrentCommercialScore: fixture.currentScore,
              globalEverSent: fixture.dispatchStatuses.includes('SENT'),
              globalSentDestinationCount: BigInt(
                fixture.dispatchStatuses.includes('SENT')
                  ? fixture.sentDestinationIds.length
                  : 0,
              ),
              globalLastSentAt: null,
              scopedEverSent:
                fixture.dispatchStatuses.includes('SENT') &&
                fixture.sentDestinationIds.includes(String(values[0])),
              scopedLastSentAt: null,
            }));
        }
        if (sql.includes('COUNT(*) AS "currentCandidateCount"')) {
          return fixtures
            .filter((fixture) => query.values?.includes(fixture.record.id))
            .filter((fixture) => fixture.currentScore !== null)
            .map((fixture) => ({
              productId: fixture.record.id,
              currentCandidateCount: BigInt(1),
              queued: BigInt(1),
              copyReady: BigInt(0),
              reserved: BigInt(0),
              dispatched: BigInt(0),
              blocked: BigInt(0),
              expired: BigInt(0),
              bestCurrentCommercialScore: fixture.currentScore,
            }));
        }
        if (sql.includes('FROM current_candidates')) {
          return fixtures
            .filter((fixture) => query.values?.includes(fixture.record.id))
            .filter((fixture) => fixture.currentScore !== null)
            .map((fixture) => ({
              productId: fixture.record.id,
              candidateId: `candidate-${fixture.record.id}`,
              campaignId: `campaign-${fixture.record.id}`,
              campaignName: `Campaign ${fixture.record.id}`,
              nicheId: `niche-${fixture.record.id}`,
              score: fixture.currentScore,
              rankPosition: 1,
              candidateStatus: 'QUEUED',
            }));
        }
        throw new Error(`Unexpected catalog query: ${sql}`);
      },
    ),
  };
  return prisma;
};

describe('Shopee offer API', () => {
  it('sincroniza mock, lista, detalha e gera apenas preview', async () => {
    const { store, prisma } = createPrismaMock();
    const app = await buildAuthenticatedTestApp({
      logger: false,
      prisma: prisma as never,
      shopeeOfferProvider: new MockShopeeAffiliateOfferProvider(),
      shopeeMaxOffersPerSync: 2,
    });

    const sync = await app.inject({
      method: 'POST',
      url: '/shopee/offers/sync',
    });
    expect(sync.statusCode).toBe(200);
    expect(sync.json()).toMatchObject({ fetched: 2, created: 2, updated: 0 });
    expect(store.size).toBe(2);

    const list = await app.inject({
      method: 'GET',
      url: '/shopee/offers?status=ACTIVE',
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ provider: 'mock', total: 2 });
    const offer = list.json().items[0];
    expect(offer.affiliateLinkPresent).toBe(true);
    expect(offer).not.toHaveProperty('isFlashDeal');

    const detail = await app.inject({
      method: 'GET',
      url: `/shopee/offers/${offer.id}`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      id: offer.id,
      status: 'ACTIVE',
      affiliateLinkPresent: true,
    });

    const preview = await app.inject({
      method: 'POST',
      url: `/shopee/offers/${offer.id}/copy-preview`,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      label: 'PREVIEW — NAO ENVIADO',
      coupon: null,
    });
    expect(JSON.stringify(preview.json())).not.toContain('commission');
    expect(JSON.stringify(preview.json())).not.toContain('dispatch');
    await app.close();
  });

  it('valida importacao sem gravar e exige confirmacao para persistir', async () => {
    const { store, prisma } = createPrismaMock();
    const app = await buildAuthenticatedTestApp({
      logger: false,
      prisma: prisma as never,
    });

    const validation = await app.inject({
      method: 'POST',
      url: '/shopee/offers/import/validate',
      payload: { records: [manualRecord] },
    });
    expect(validation.statusCode).toBe(200);
    expect(validation.json()).toMatchObject({ valid: true, count: 1 });
    expect(store.size).toBe(0);

    const blocked = await app.inject({
      method: 'POST',
      url: '/shopee/offers/import',
      payload: { records: [manualRecord] },
    });
    expect(blocked.statusCode).toBe(400);
    expect(store.size).toBe(0);

    const confirmed = await app.inject({
      method: 'POST',
      url: '/shopee/offers/import',
      payload: { records: [manualRecord], confirm: 'CONFIRMAR_IMPORTACAO' },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ source: 'manual', created: 1 });
    expect(store.size).toBe(1);
    await app.close();
  });

  it('bloqueia sync official pela API e nao chama transport ou signer', async () => {
    const transport = { execute: vi.fn() };
    const signer = { sign: vi.fn() };
    const { prisma } = createPrismaMock();
    const app = await buildAuthenticatedTestApp({
      logger: false,
      prisma: prisma as never,
      shopeeOfferProvider: new OfficialShopeeAffiliateOfferProvider({
        transport,
        signer,
      }),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/shopee/offers/sync',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: 'SHOPEE_OFFICIAL_SYNC_CLI_REQUIRED',
    });
    expect(transport.execute).not.toHaveBeenCalled();
    expect(signer.sign).not.toHaveBeenCalled();
    await app.close();
  });

  it('materializa filtros combinados, categorias A/B/C, entrega e paginação de forma determinística', async () => {
    const prisma = createFilteredCatalogPrismaMock([
      catalogFixture('product-a', 'category-a', {
        price: 50,
        discount: 30,
        commission: 8,
        sales: 900,
        score: 90,
        sentDestinationIds: ['destination-a'],
        dispatchStatuses: ['SENT'],
      }),
      catalogFixture('product-b', 'category-b', {
        price: 35,
        discount: 20,
        commission: 6,
        sales: 500,
        score: 80,
        sentDestinationIds: [],
        dispatchStatuses: ['FAILED', 'PENDING'],
      }),
      catalogFixture('product-c', 'category-c', {
        price: 15,
        discount: 10,
        commission: 3,
        sales: 100,
        score: null,
        sentDestinationIds: [],
        dispatchStatuses: ['PENDING'],
      }),
    ]);
    const app = await buildAuthenticatedTestApp({
      logger: false,
      prisma: prisma as never,
    });

    const invalid = await app.inject({
      method: 'GET',
      url: '/shopee/offers?minPrice=100&maxPrice=10',
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: 'INVALID_CATALOG_QUERY' });

    for (const invalidQuery of [
      'minDiscount=-0.01',
      'maxScore=Infinity',
      'minPrice=-1',
      'minCommission=-0.01',
      'capturedFrom=not-a-date',
      'categoryId=category%2Funsafe',
      'destinationId=destination%20unsafe',
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: `/shopee/offers?${invalidQuery}`,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: 'INVALID_CATALOG_QUERY',
      });
    }

    const catalog = await app.inject({
      method: 'GET',
      url: '/shopee/offers?categoryId=category-a&minDiscount=20&minScore=80&minPrice=40&maxPrice=60&minCommission=5&deliveryStatus=sent&destinationId=destination-a&sort=score_desc',
    });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json()).toMatchObject({
      total: 1,
      items: [
        expect.objectContaining({
          id: 'product-a',
          bestCurrentCommercialScore: 90,
        }),
      ],
      hasNextPage: false,
      hasPreviousPage: false,
      flashDealCapability: {
        status: 'UNSUPPORTED_CURRENT_PROVIDER_CONTRACT',
        reasonCode: 'OFFICIAL_SIGNAL_NOT_AVAILABLE',
      },
    });
    expect(catalog.json().items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ isFlashDeal: expect.anything() }),
      ]),
    );

    for (const [query, expectedIds] of [
      ['categoryId=category-a', ['product-a']],
      ['categoryId=category-b', ['product-b']],
      ['categoryId=category-c', ['product-c']],
      ['minScore=1&sort=score_desc', ['product-a', 'product-b']],
      [
        'deliveryStatus=not_sent&destinationId=destination-a&sort=score_desc',
        ['product-b', 'product-c'],
      ],
      ['sort=score_desc&page=1&limit=1', ['product-a']],
      ['sort=score_desc&page=2&limit=1', ['product-b']],
      ['sort=score_desc&page=3&limit=1', ['product-c']],
    ] as const) {
      const response = await app.inject({
        method: 'GET',
        url: `/shopee/offers?${query}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().items.map(({ id }: { id: string }) => id)).toEqual(
        expectedIds,
      );
    }

    expect(
      prisma.$queryRaw.mock.calls.some(([query]) =>
        queryText(query).includes('p."categoryIds" @> ARRAY['),
      ),
    ).toBe(true);
    expect(
      prisma.$queryRaw.mock.calls.some(([query]) =>
        queryText(query).includes('score."bestCurrentCommercialScore" >= '),
      ),
    ).toBe(true);

    const categories = await app.inject({
      method: 'GET',
      url: '/shopee/offers/categories',
    });
    expect(categories.statusCode).toBe(200);
    expect(categories.json()).toMatchObject({
      hierarchyStatus: 'NOT_AVAILABLE_FROM_CURRENT_PROVIDER_CONTRACT',
      items: [
        { id: 'category-a', displayLabel: 'Categoria category-a' },
        { id: 'category-b', displayLabel: 'Categoria category-b' },
        { id: 'category-c', displayLabel: 'Categoria category-c' },
      ],
    });
    await app.close();
  });
});
