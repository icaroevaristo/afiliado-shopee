import { describe, expect, it, vi } from 'vitest';
import {
  MockShopeeAffiliateOfferProvider,
  OfficialShopeeAffiliateOfferProvider,
} from '@shopee-auto-affiliate-ai/providers';
import { buildAuthenticatedTestApp } from './authenticated-test-app';

const createPrismaMock = () => {
  const store = new Map<string, Record<string, unknown>>();
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
      }) => {
        const record = findByWhere(where);
        return record && select ? { id: record.id } : record;
      },
    ),
    findMany: vi.fn(async () => [...store.values()]),
    count: vi.fn(async () => store.size),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const record = {
        ...data,
        id: `offer-${store.size + 1}`,
        score: null,
        scoreUpdatedAt: null,
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
  return { store, prisma: { productLead } };
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

    const detail = await app.inject({
      method: 'GET',
      url: `/shopee/offers/${offer.id}`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ id: offer.id, status: 'ACTIVE' });

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
    const app = await buildAuthenticatedTestApp({ logger: false, prisma: prisma as never });

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
});
