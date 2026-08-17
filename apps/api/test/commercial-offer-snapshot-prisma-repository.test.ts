import { describe, expect, it } from 'vitest';
import type { ShopeeProductOffer } from '@shopee-auto-affiliate-ai/providers';
import { PrismaShopeeOfferRepository } from '../src/prisma-repositories';

const observedAt = new Date('2026-07-29T15:00:00.000Z');
const offer = (
  price = '10.00',
  overrides: Partial<ShopeeProductOffer> = {},
): ShopeeProductOffer => ({
  source: 'OFFICIAL',
  providerProductId: 'official-1',
  productName: 'Produto sanitizado',
  shopId: 'shop-1',
  shopName: 'Loja sanitizada',
  categoryIds: ['category-1'],
  price,
  priceMin: price,
  priceMax: price,
  discountRate: 10,
  rating: 4.5,
  sales: 100,
  commissionRate: 5,
  imageUrl: 'https://example.invalid/image',
  productLink: 'https://example.invalid/product',
  affiliateLink: 'https://example.invalid/affiliate',
  fetchedAt: observedAt,
  ...overrides,
});

type ProductState = Record<string, unknown> & {
  id: string;
  source: 'OFFICIAL';
  providerProductId: string;
  commercialSnapshotRevision: number;
  commercialSnapshotFingerprint: string | null;
};
type SnapshotState = Record<string, unknown> & {
  id: string;
  productId: string;
  revision: number;
  fingerprint: string;
};
type State = { products: ProductState[]; snapshots: SnapshotState[] };

const createTransactionalPrisma = (
  failure?: 'product-create' | 'product-update' | 'snapshot-create',
) => {
  let injectedFailure = failure;
  let state: State = { products: [], snapshots: [] };
  let version = 0;
  const productFromData = (data: Record<string, unknown>): ProductState =>
    ({
      id: `product-${state.products.length + 1}`,
      score: null,
      scoreUpdatedAt: null,
      createdAt: observedAt,
      updatedAt: observedAt,
      ...data,
    }) as unknown as ProductState;
  const prisma = {
    async $transaction<T>(callback: (transaction: unknown) => Promise<T>) {
      const initialVersion = version;
      const draft = structuredClone(state) as State;
      const transaction = {
        productLead: {
          findUnique: async ({ where }: { where: Record<string, unknown> }) => {
            if ('id' in where) {
              return (
                draft.products.find((item) => item.id === where.id) ?? null
              );
            }
            const key = where.source_providerProductId as {
              source: string;
              providerProductId: string;
            };
            return (
              draft.products.find(
                (item) =>
                  item.source === key.source &&
                  item.providerProductId === key.providerProductId,
              ) ?? null
            );
          },
          create: async ({ data }: { data: Record<string, unknown> }) => {
            if (injectedFailure === 'product-create')
              throw new Error('product create failed');
            const product = productFromData(data);
            draft.products.push(product);
            return product;
          },
          update: async ({
            where,
            data,
          }: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }) => {
            if (injectedFailure === 'product-update')
              throw new Error('product update failed');
            const product = draft.products.find(
              (item) =>
                item.id === where.id &&
                item.source === where.source &&
                item.commercialSnapshotRevision ===
                  where.commercialSnapshotRevision &&
                item.commercialSnapshotFingerprint ===
                  where.commercialSnapshotFingerprint,
            );
            if (!product) {
              throw Object.assign(new Error('record not found'), {
                code: 'P2025',
              });
            }
            Object.assign(product, data, { updatedAt: observedAt });
            return product;
          },
          updateMany: async ({
            where,
            data,
          }: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }) => {
            if (injectedFailure === 'product-update')
              throw new Error('product update failed');
            const product = draft.products.find(
              (item) =>
                item.id === where.id &&
                item.source === where.source &&
                item.commercialSnapshotRevision ===
                  where.commercialSnapshotRevision &&
                item.commercialSnapshotFingerprint ===
                  where.commercialSnapshotFingerprint,
            );
            if (!product) return { count: 0 };
            Object.assign(product, data, { updatedAt: observedAt });
            return { count: 1 };
          },
          count: async () => 0,
          findMany: async () => [],
        },
        commercialOfferSnapshot: {
          findFirst: async ({ where }: { where: { productId: string } }) =>
            [...draft.snapshots]
              .filter((item) => item.productId === where.productId)
              .sort((left, right) => right.revision - left.revision)[0] ?? null,
          create: async ({ data }: { data: Record<string, unknown> }) => {
            if (injectedFailure === 'snapshot-create')
              throw new Error('snapshot create failed');
            const snapshot = {
              id: `snapshot-${draft.snapshots.length + 1}`,
              createdAt: observedAt,
              ...data,
            } as unknown as SnapshotState;
            if (
              draft.snapshots.some(
                (item) =>
                  item.productId === snapshot.productId &&
                  item.revision === snapshot.revision,
              )
            ) {
              throw Object.assign(new Error('unique conflict'), {
                code: 'P2002',
              });
            }
            draft.snapshots.push(snapshot);
            return snapshot;
          },
        },
      };
      const result = await callback(transaction);
      if (version !== initialVersion) {
        throw Object.assign(new Error('transaction conflict'), {
          code: 'P2034',
        });
      }
      state = draft;
      version += 1;
      return result;
    },
  };
  return {
    prisma,
    readState: () => state,
    setFailure: (
      next?: 'product-create' | 'product-update' | 'snapshot-create',
    ) => {
      injectedFailure = next;
    },
    resetSnapshotBaseline: () => {
      state.snapshots = [];
      for (const product of state.products) {
        product.commercialSnapshotRevision = 0;
        product.commercialSnapshotFingerprint = null;
      }
      version += 1;
    },
  };
};

describe('PrismaShopeeOfferRepository official snapshots', () => {
  it('cria revision 1 atomicamente e usa fetchedAt como capturedAt', async () => {
    const fake = createTransactionalPrisma();
    const repository = new PrismaShopeeOfferRepository(fake.prisma as never);
    const result = await repository.upsertOfficialOfferWithSnapshot(offer());
    expect(result).toMatchObject({
      productAction: 'created',
      commercialStateChanged: true,
      snapshotCreated: true,
      snapshotRevision: 1,
    });
    expect(result.product).not.toHaveProperty('commercialSnapshotRevision');
    expect(result.product).not.toHaveProperty('commercialSnapshotFingerprint');
    expect(fake.readState().snapshots).toHaveLength(1);
    expect(fake.readState().snapshots[0]?.capturedAt).toEqual(observedAt);
    expect(fake.readState().products[0]?.commercialSnapshotRevision).toBe(1);
    expect(fake.readState().products[0]?.commercialSnapshotFingerprint).toBe(
      fake.readState().snapshots[0]?.fingerprint,
    );
  });

  it('mantem A -> A e mudancas isoladas de rating/sales na mesma revision', async () => {
    const fake = createTransactionalPrisma();
    const repository = new PrismaShopeeOfferRepository(fake.prisma as never);
    await repository.upsertOfficialOfferWithSnapshot(offer());
    await expect(
      repository.upsertOfficialOfferWithSnapshot(
        offer('10.0000', { rating: 5, sales: 999 }),
      ),
    ).resolves.toMatchObject({
      productAction: 'updated',
      commercialStateChanged: false,
      snapshotCreated: false,
      snapshotRevision: 1,
    });
    expect(fake.readState().snapshots).toHaveLength(1);
    expect(fake.readState().products[0]).toMatchObject({
      nota: 5,
      vendidos: 999,
    });
  });

  it('preserva A -> B -> A em revisions monotonicas', async () => {
    const fake = createTransactionalPrisma();
    const repository = new PrismaShopeeOfferRepository(fake.prisma as never);
    await repository.upsertOfficialOfferWithSnapshot(offer('10'));
    await repository.upsertOfficialOfferWithSnapshot(offer('20'));
    await expect(
      repository.upsertOfficialOfferWithSnapshot(offer('10')),
    ).resolves.toMatchObject({
      snapshotRevision: 3,
    });
    expect(fake.readState().snapshots.map((item) => item.revision)).toEqual([
      1, 2, 3,
    ]);
    expect(fake.readState().products[0]?.commercialSnapshotFingerprint).toBe(
      fake.readState().snapshots[2]?.fingerprint,
    );
  });

  it.each(['snapshot-create', 'product-update'] as const)(
    'reverte integralmente quando falha %s',
    async (failure) => {
      const fake = createTransactionalPrisma(
        failure === 'snapshot-create' ? failure : undefined,
      );
      const repository = new PrismaShopeeOfferRepository(fake.prisma as never);
      if (failure === 'product-update') {
        await repository.upsertOfficialOfferWithSnapshot(offer());
        fake.setFailure(failure);
      }
      const before = structuredClone(fake.readState());
      await expect(
        repository.upsertOfficialOfferWithSnapshot(
          failure === 'product-update' ? offer('20') : offer(),
        ),
      ).rejects.toThrow();
      expect(fake.readState()).toEqual(before);
    },
  );

  it('bloqueia uma de duas atualizacoes concorrentes sem duplicar revision', async () => {
    const fake = createTransactionalPrisma();
    const repository = new PrismaShopeeOfferRepository(fake.prisma as never);
    await repository.upsertOfficialOfferWithSnapshot(offer('10'));
    const outcomes = await Promise.allSettled([
      repository.upsertOfficialOfferWithSnapshot(offer('20')),
      repository.upsertOfficialOfferWithSnapshot(offer('30')),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejected).toMatchObject({
      reason: { code: 'SHOPEE_OFFICIAL_SNAPSHOT_CONFLICT' },
    });
    expect(String((rejected as PromiseRejectedResult).reason)).not.toContain(
      'P2034',
    );
    expect(fake.readState().snapshots.map((item) => item.revision)).toEqual([
      1, 2,
    ]);
  });

  it('sanitiza erros Prisma nao classificados sem expor o codigo bruto', async () => {
    const repository = new PrismaShopeeOfferRepository({
      $transaction: async () =>
        Promise.reject(
          Object.assign(new Error('raw prisma detail'), { code: 'P2028' }),
        ),
    } as never);
    const caught = await repository
      .upsertOfficialOfferWithSnapshot(offer())
      .catch((error: unknown) => error);
    expect(caught).toMatchObject({
      code: 'SHOPEE_OFFICIAL_SNAPSHOT_PERSISTENCE_FAILED',
    });
    expect(JSON.stringify(caught)).not.toContain('P2028');
    expect(String(caught)).not.toContain('raw prisma detail');
  });

  it('inicializa o baseline persistido com fetchedAt e sem alterar dados comerciais', async () => {
    const fake = createTransactionalPrisma();
    const repository = new PrismaShopeeOfferRepository(fake.prisma as never);
    await repository.upsertOfficialOfferWithSnapshot(offer());
    fake.resetSnapshotBaseline();
    const commercialBefore = {
      preco: fake.readState().products[0]?.preco,
      affiliateLink: fake.readState().products[0]?.affiliateLink,
      nome: fake.readState().products[0]?.nome,
      fetchedAt: fake.readState().products[0]?.fetchedAt,
    };

    await expect(
      repository.initializeOfficialProductSnapshot('product-1'),
    ).resolves.toBe(true);
    await expect(
      repository.initializeOfficialProductSnapshot('product-1'),
    ).resolves.toBe(false);
    expect(fake.readState().products[0]).toMatchObject(commercialBefore);
    expect(fake.readState().snapshots).toHaveLength(1);
    expect(fake.readState().snapshots[0]).toMatchObject({
      productId: 'product-1',
      revision: 1,
      capturedAt: observedAt,
    });
  });

  it('nao sobrescreve produto quando o mesmo providerProductId muda de loja', async () => {
    const fake = createTransactionalPrisma();
    const repository = new PrismaShopeeOfferRepository(fake.prisma as never);
    await repository.upsertOfficialOfferWithSnapshot(offer());
    const before = structuredClone(fake.readState());

    await expect(
      repository.upsertOfficialOfferWithSnapshot(offer('10.00', { shopId: 'shop-2' })),
    ).rejects.toMatchObject({ code: 'PRODUCT_VARIANT_DEDUPLICATION' });
    expect(fake.readState()).toEqual(before);
  });

  it('atualiza affiliate link em nova revision sem criar novo produto', async () => {
    const fake = createTransactionalPrisma();
    const repository = new PrismaShopeeOfferRepository(fake.prisma as never);
    await repository.upsertOfficialOfferWithSnapshot(offer());

    await expect(
      repository.upsertOfficialOfferWithSnapshot(
        offer('10.00', { affiliateLink: 'https://example.invalid/affiliate-v2' }),
      ),
    ).resolves.toMatchObject({
      productAction: 'updated',
      commercialStateChanged: true,
      snapshotCreated: true,
      snapshotRevision: 2,
    });
    expect(fake.readState().products).toHaveLength(1);
    expect(fake.readState().snapshots).toHaveLength(2);
    expect(fake.readState().products[0]?.affiliateLink).toBe(
      'https://example.invalid/affiliate-v2',
    );
  });

  it('preserva providerProductIds distintos como produtos atomicos distintos', async () => {
    const fake = createTransactionalPrisma();
    const repository = new PrismaShopeeOfferRepository(fake.prisma as never);
    await repository.upsertOfficialOfferWithSnapshot(offer());
    await repository.upsertOfficialOfferWithSnapshot(
      offer('10.00', { providerProductId: 'official-2' }),
    );

    expect(fake.readState().products).toHaveLength(2);
    expect(fake.readState().snapshots).toHaveLength(2);
    expect(new Set(fake.readState().products.map((item) => item.providerProductId))).toEqual(
      new Set(['official-1', 'official-2']),
    );
  });


  it('enriquece registro legado sem shopId na proxima observacao OFFICIAL completa', async () => {
    const fake = createTransactionalPrisma();
    const repository = new PrismaShopeeOfferRepository(fake.prisma as never);
    await repository.upsertOfficialOfferWithSnapshot(offer());
    fake.readState().products[0]!.shopId = null;

    await expect(repository.upsertOfficialOfferWithSnapshot(offer())).resolves.toMatchObject({
      productAction: 'updated',
      commercialStateChanged: false,
      snapshotCreated: false,
      snapshotRevision: 1,
    });
    expect(fake.readState().products[0]?.shopId).toBe('shop-1');
    expect(fake.readState().products).toHaveLength(1);
    expect(fake.readState().snapshots).toHaveLength(1);
  });

});
