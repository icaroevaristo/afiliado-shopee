import { describe, expect, it, vi } from 'vitest';
import {
  ManualShopeeAffiliateOfferProvider,
  MockShopeeAffiliateOfferProvider,
  OfficialShopeeAffiliateOfferProvider,
  SHOPEE_AFFILIATE_OFFICIAL_API_URL,
  type ShopeeProductOffer,
} from '@shopee-auto-affiliate-ai/providers';
import { ShopeeOfferSyncService } from '../src/shopee-offer-sync-service';
import { fingerprintCommercialOffer } from '../src/commercial-offer-snapshot';
import type {
  ShopeeOfferFilters,
  ShopeeOfferRecord,
  ShopeeOfferRepository,
} from '../src/repositories';

const logger = { info: vi.fn(), error: vi.fn() };
const observedAt = new Date('2026-07-29T15:00:00.000Z');

class MemoryOfferRepository implements ShopeeOfferRepository {
  readonly store = new Map<string, ShopeeOfferRecord>();
  readonly snapshots = new Map<
    string,
    { fingerprint: string; revision: number }
  >();

  async findBySourceAndProviderProductId(
    source: ShopeeProductOffer['source'],
    providerProductId: string,
  ) {
    const record = [...this.store.values()].find(
      (item) =>
        item.source === source && item.providerProductId === providerProductId,
    );
    return record ? { id: record.id } : null;
  }

  async createOffer(offer: ShopeeProductOffer) {
    const now = new Date();
    const record: ShopeeOfferRecord = {
      ...offer,
      id: `offer-${this.store.size + 1}`,
      score: null,
      scoreUpdatedAt: null,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(record.id, record);
    return record;
  }

  async updateOffer(id: string, offer: ShopeeProductOffer) {
    const current = this.store.get(id) as ShopeeOfferRecord;
    const updated = {
      ...current,
      ...offer,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    };
    this.store.set(id, updated);
    return updated;
  }

  async upsertOfficialOfferWithSnapshot(offer: ShopeeProductOffer) {
    const existing = [...this.store.values()].find(
      (item) =>
        item.source === 'OFFICIAL' &&
        item.providerProductId === offer.providerProductId,
    );
    const commercialFingerprint = fingerprintCommercialOffer({
      source: offer.source,
      providerProductId: offer.providerProductId,
      price: offer.price,
      priceMin: offer.priceMin,
      priceMax: offer.priceMax,
      discountRate: offer.discountRate,
      commissionRate: offer.commissionRate,
      offerStartsAt: offer.offerStartsAt,
      offerEndsAt: offer.offerEndsAt,
      unavailableAt: null,
    });
    if (!existing) {
      const product = await this.createOffer(offer);
      this.snapshots.set(product.id, {
        fingerprint: commercialFingerprint,
        revision: 1,
      });
      return {
        product,
        productAction: 'created' as const,
        commercialStateChanged: true,
        snapshotCreated: true,
        snapshotRevision: 1,
      };
    }
    const current = this.snapshots.get(existing.id) as {
      fingerprint: string;
      revision: number;
    };
    const changed = current.fingerprint !== commercialFingerprint;
    const revision = changed ? current.revision + 1 : current.revision;
    this.snapshots.set(existing.id, {
      fingerprint: changed ? commercialFingerprint : current.fingerprint,
      revision,
    });
    return {
      product: await this.updateOffer(existing.id, offer),
      productAction: 'updated' as const,
      commercialStateChanged: changed,
      snapshotCreated: changed,
      snapshotRevision: revision,
    };
  }

  async findOfferById(id: string) {
    return this.store.get(id) ?? null;
  }

  async listOffers(filters: ShopeeOfferFilters) {
    void filters;
    return { items: [...this.store.values()], total: this.store.size };
  }

  async listCommercialCandidates() {
    return [...this.store.values()];
  }
}

const manual = (overrides: Record<string, unknown> = {}) => ({
  providerProductId: 'manual-001',
  productName: 'Produto ficticio',
  shopId: 'shop-fixture',
  shopName: 'Loja ficticia',
  price: '99.90',
  discountRate: 20,
  rating: 4.8,
  sales: 1000,
  commissionRate: 8,
  imageUrl: 'https://example.invalid/image.jpg',
  productLink: 'https://example.invalid/product',
  affiliateLink: 'https://example.invalid/affiliate',
  ...overrides,
});

describe('ShopeeOfferSyncService', () => {
  it('usa somente o boundary atomico para OFFICIAL', async () => {
    const product = await new MemoryOfferRepository().createOffer({
      ...manual(),
      source: 'OFFICIAL',
      categoryIds: [],
      priceMin: '99.90',
      priceMax: '99.90',
      fetchedAt: observedAt,
    } as ShopeeProductOffer);
    const atomicUpsert = vi.fn(async () => ({
      product,
      productAction: 'created' as const,
      commercialStateChanged: true,
      snapshotCreated: true,
      snapshotRevision: 1,
    }));
    const separateFind = vi.fn();
    const separateCreate = vi.fn();
    const separateUpdate = vi.fn();
    const repository = {
      upsertOfficialOfferWithSnapshot: atomicUpsert,
      findBySourceAndProviderProductId: separateFind,
      createOffer: separateCreate,
      updateOffer: separateUpdate,
    } as unknown as ShopeeOfferRepository;
    const provider = {
      source: 'OFFICIAL' as const,
      listProductOffers: async () => ({
        items: [product],
        page: 1,
        limit: 1,
        hasNextPage: false,
      }),
    };
    const service = new ShopeeOfferSyncService({
      provider,
      offers: repository,
      maxOffersPerSync: 1,
      logger,
    });

    await expect(service.run()).resolves.toMatchObject({
      created: 1,
      snapshotsCreated: 1,
      snapshotsUnchanged: 0,
    });
    expect(atomicUpsert).toHaveBeenCalledOnce();
    expect(separateFind).not.toHaveBeenCalled();
    expect(separateCreate).not.toHaveBeenCalled();
    expect(separateUpdate).not.toHaveBeenCalled();
  });

  it('nao cria snapshot para oferta OFFICIAL invalida ou expirada', async () => {
    const atomicUpsert = vi.fn();
    const provider = {
      source: 'OFFICIAL' as const,
      listProductOffers: async () => ({
        items: [
          {
            ...manual({
              providerProductId: '',
              priceMin: '99.90',
              priceMax: '99.90',
            }),
            source: 'OFFICIAL' as const,
            categoryIds: [],
            fetchedAt: observedAt,
          },
          {
            ...manual({
              providerProductId: 'expired-official',
              priceMin: '99.90',
              priceMax: '99.90',
            }),
            source: 'OFFICIAL' as const,
            categoryIds: [],
            offerEndsAt: new Date('2026-07-28T00:00:00.000Z'),
            fetchedAt: observedAt,
          },
        ] as unknown as ShopeeProductOffer[],
        page: 1,
        limit: 2,
        hasNextPage: false,
      }),
    };
    const service = new ShopeeOfferSyncService({
      provider,
      offers: {
        upsertOfficialOfferWithSnapshot: atomicUpsert,
      } as unknown as ShopeeOfferRepository,
      maxOffersPerSync: 2,
      logger,
      now: () => new Date('2026-07-29T00:00:00.000Z'),
    });
    await expect(service.run()).resolves.toMatchObject({
      skipped: 1,
      expired: 1,
      snapshotsCreated: 0,
      snapshotsUnchanged: 0,
    });
    expect(atomicUpsert).not.toHaveBeenCalled();
  });

  it('cria, deduplica e atualiza preco e comissao sem dispatch ou fila', async () => {
    const offers = new MemoryOfferRepository();
    const first = new ShopeeOfferSyncService({
      provider: new ManualShopeeAffiliateOfferProvider([manual()]),
      offers,
      maxOffersPerSync: 5,
      logger,
    });
    expect(await first.run()).toMatchObject({ created: 1, updated: 0 });

    const second = new ShopeeOfferSyncService({
      provider: new ManualShopeeAffiliateOfferProvider([
        manual({ price: '79.90', commissionRate: 10 }),
      ]),
      offers,
      maxOffersPerSync: 5,
      logger,
    });
    expect(await second.run()).toMatchObject({ created: 0, updated: 1 });
    expect([...offers.store.values()][0]).toMatchObject({
      price: '79.90',
      commissionRate: 10,
    });
    expect(offers.store.size).toBe(1);
  });

  it('ignora oferta expirada e respeita limite baixo', async () => {
    const offers = new MemoryOfferRepository();
    const provider = new ManualShopeeAffiliateOfferProvider([
      manual({
        providerProductId: 'expired',
        offerEndsAt: '2025-01-01T00:00:00.000Z',
      }),
      manual({ providerProductId: 'active' }),
    ]);
    const service = new ShopeeOfferSyncService({
      provider,
      offers,
      maxOffersPerSync: 1,
      logger,
      now: () => new Date('2026-07-24T00:00:00.000Z'),
    });

    expect(await service.run({ limit: 100 })).toMatchObject({
      fetched: 1,
      created: 0,
      expired: 1,
    });
    expect(offers.store.size).toBe(0);
  });

  it('sincroniza mock deterministico sem acessar internet', async () => {
    const offers = new MemoryOfferRepository();
    const service = new ShopeeOfferSyncService({
      provider: new MockShopeeAffiliateOfferProvider(),
      offers,
      maxOffersPerSync: 3,
      logger,
    });
    expect(await service.run()).toMatchObject({
      source: 'mock',
      fetched: 3,
      created: 3,
    });
  });

  it('consolida rejeicoes estruturadas e campos do relatorio controlado', async () => {
    const offers = new MemoryOfferRepository();
    const provider = {
      source: 'OFFICIAL' as const,
      listProductOffers: vi.fn().mockResolvedValue({
        items: [
          {
            source: 'OFFICIAL' as const,
            providerProductId: 'official-1',
            shopId: 'shop-official-1',
            productName: 'Produto oficial ficticio',
            shopName: 'Loja ficticia',
            categoryIds: [],
            price: '10.00',
            priceMin: '10.00',
            priceMax: '10.00',
            discountRate: 0,
            rating: 5,
            sales: 1,
            commissionRate: 1,
            imageUrl: 'https://example.invalid/image',
            productLink: 'https://example.invalid/product',
            affiliateLink: 'https://example.invalid/affiliate',
            fetchedAt: new Date('2026-07-28T12:00:00.000Z'),
          },
        ],
        page: 1,
        limit: 5,
        hasNextPage: true,
        fetchedCount: 2,
        rejected: [{ index: 1, code: 'SHOPEE_OFFICIAL_PRICE_INVALID' }],
      }),
    };
    const service = new ShopeeOfferSyncService({
      provider,
      offers,
      maxOffersPerSync: 5,
      logger,
    });
    expect(await service.run({ limit: 5 })).toMatchObject({
      fetched: 2,
      valid: 1,
      created: 1,
      updated: 0,
      snapshotsCreated: 1,
      snapshotsUnchanged: 0,
      rejected: 1,
      expired: 0,
      hasNextPage: true,
      affiliateLinkPresentCount: 1,
      rejectionSummary: { SHOPEE_OFFICIAL_PRICE_INVALID: 1 },
    });
  });

  it('sincroniza em memoria cinco ofertas oficiais com periodEndTime far-future', async () => {
    const affiliateLink = 'https://example.invalid/affiliate-preserved';
    const nodes = Array.from({ length: 5 }, (_, index) => ({
      productName: `Produto sanitizado ${index}`,
      itemId: 1_000 + index,
      commissionRate: '0.10',
      commission: '10.00',
      price: '100.00',
      sales: 100,
      imageUrl: 'https://example.invalid/image',
      shopName: 'Loja sanitizada',
      productLink: 'https://example.invalid/product',
      offerLink: affiliateLink,
      periodStartTime: 1_785_196_800,
      periodEndTime: 32_503_651_199,
      priceMin: '100.00',
      priceMax: '100.00',
      productCatIds: [1],
      ratingStar: '4.50',
      priceDiscountRate: 10,
      shopId: 2_000 + index,
      shopType: [1],
      sellerCommissionRate: '0.05',
      shopeeCommissionRate: '0.05',
    }));
    const provider = new OfficialShopeeAffiliateOfferProvider({
      apiEnabled: true,
      apiUrl: SHOPEE_AFFILIATE_OFFICIAL_API_URL,
      appId: 'fixture-app-id',
      secret: 'fixture-secret',
      transport: {
        execute: vi.fn().mockResolvedValue({
          data: {
            productOfferV2: {
              nodes,
              pageInfo: {
                page: 1,
                limit: 5,
                hasNextPage: false,
                scrollId: null,
              },
            },
          },
        }),
      },
      clock: () => new Date('2026-07-28T12:00:00.000Z'),
    });
    const offers = new MemoryOfferRepository();
    const service = new ShopeeOfferSyncService({
      provider,
      offers,
      maxOffersPerSync: 5,
      logger,
    });

    const report = await service.run({ limit: 5, page: 1 });

    expect(report).toMatchObject({
      fetched: 5,
      valid: 5,
      created: 5,
      updated: 0,
      snapshotsCreated: 5,
      snapshotsUnchanged: 0,
      rejected: 0,
      rejectionSummary: {},
      affiliateLinkPresentCount: 5,
    });
    expect(offers.store.size).toBe(5);
    expect(
      [...offers.store.values()].every(
        (offer) => offer.affiliateLink === affiliateLink,
      ),
    ).toBe(true);

    await expect(service.run({ limit: 5, page: 1 })).resolves.toMatchObject({
      created: 0,
      updated: 5,
      snapshotsCreated: 0,
      snapshotsUnchanged: 5,
    });
    expect(offers.snapshots.size).toBe(5);
  });

  it('deduplica item OFFICIAL repetido na mesma pagina sem segunda persistencia', async () => {
    const offer = {
      ...manual({ providerProductId: 'same-item', shopId: 'shop-1' }),
      source: 'OFFICIAL' as const,
      categoryIds: [],
      priceMin: '99.90',
      priceMax: '99.90',
      fetchedAt: observedAt,
    } satisfies ShopeeProductOffer;
    const offers = new MemoryOfferRepository();
    const upsert = vi.spyOn(offers, 'upsertOfficialOfferWithSnapshot');
    const service = new ShopeeOfferSyncService({
      provider: {
        source: 'OFFICIAL',
        listProductOffers: async () => ({
          items: [offer, { ...offer, price: '89.90' }],
          page: 1,
          limit: 2,
          hasNextPage: false,
        }),
      },
      offers,
      maxOffersPerSync: 2,
      logger,
    });

    await expect(service.run()).resolves.toMatchObject({
      valid: 1,
      skipped: 1,
      rejectionSummary: { SHOPEE_OFFER_DUPLICATE: 1 },
    });
    expect(upsert).toHaveBeenCalledOnce();
  });

  it('falha fechado se o mesmo itemId OFFICIAL aparecer em lojas diferentes', async () => {
    const first = {
      ...manual({ providerProductId: 'same-item', shopId: 'shop-1' }),
      source: 'OFFICIAL' as const,
      categoryIds: [],
      priceMin: '99.90',
      priceMax: '99.90',
      fetchedAt: observedAt,
    } satisfies ShopeeProductOffer;
    const second = { ...first, shopId: 'shop-2' };
    const offers = new MemoryOfferRepository();
    const upsert = vi.spyOn(offers, 'upsertOfficialOfferWithSnapshot');
    const service = new ShopeeOfferSyncService({
      provider: {
        source: 'OFFICIAL',
        listProductOffers: async () => ({
          items: [first, second],
          page: 1,
          limit: 2,
          hasNextPage: false,
        }),
      },
      offers,
      maxOffersPerSync: 2,
      logger,
    });

    await expect(service.run()).rejects.toMatchObject({
      code: 'PRODUCT_VARIANT_DEDUPLICATION',
    });
    expect(upsert).toHaveBeenCalledOnce();
  });

  it('preserva itens distintos mesmo com nome, loja e links iguais', async () => {
    const base = {
      ...manual({ shopId: 'shop-1' }),
      source: 'OFFICIAL' as const,
      categoryIds: [],
      priceMin: '99.90',
      priceMax: '99.90',
      fetchedAt: observedAt,
    } satisfies ShopeeProductOffer;
    const items = [
      { ...base, providerProductId: 'variant-a' },
      { ...base, providerProductId: 'variant-b' },
    ];
    const offers = new MemoryOfferRepository();
    const upsert = vi.spyOn(offers, 'upsertOfficialOfferWithSnapshot');
    const service = new ShopeeOfferSyncService({
      provider: {
        source: 'OFFICIAL',
        listProductOffers: async () => ({
          items,
          page: 1,
          limit: 2,
          hasNextPage: false,
        }),
      },
      offers,
      maxOffersPerSync: 2,
      logger,
    });

    await expect(service.run()).resolves.toMatchObject({
      valid: 2,
      created: 2,
      skipped: 0,
    });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(offers.store.size).toBe(2);
  });

  it('rejeita observacao OFFICIAL sem shopId antes da persistencia', async () => {
    const offer = {
      ...manual({ providerProductId: 'missing-shop', shopId: undefined }),
      source: 'OFFICIAL' as const,
      categoryIds: [],
      priceMin: '99.90',
      priceMax: '99.90',
      fetchedAt: observedAt,
    } satisfies ShopeeProductOffer;
    const offers = new MemoryOfferRepository();
    const upsert = vi.spyOn(offers, 'upsertOfficialOfferWithSnapshot');
    const service = new ShopeeOfferSyncService({
      provider: {
        source: 'OFFICIAL',
        listProductOffers: async () => ({
          items: [offer],
          page: 1,
          limit: 1,
          hasNextPage: false,
        }),
      },
      offers,
      maxOffersPerSync: 1,
      logger,
    });

    await expect(service.run()).resolves.toMatchObject({
      valid: 0,
      skipped: 1,
      rejectionSummary: { SHOPEE_PRODUCT_IDENTITY_INCOMPLETE: 1 },
    });
    expect(upsert).not.toHaveBeenCalled();
  });

});
