import { describe, expect, it, vi } from 'vitest';
import {
  assertShopeeCategoryBackfillArgs,
  executeShopeeCategoryBackfill,
  SHOPEE_CATEGORY_BACKFILL_CONFIRMATION,
} from '../src/shopee-category-backfill';
import { PrismaShopeeOfferRepository } from '../src/prisma-repositories';

describe('Shopee category backfill', () => {
  it('materializa somente observacoes OFFICIAL em paginas intercaladas', async () => {
    type ProductFixture = {
      id: string;
      source: 'OFFICIAL' | 'MOCK';
      categoryIds: string[];
    };
    type FindManyInput = {
      where?: {
        source?: 'OFFICIAL' | 'MOCK';
        id?: { gt?: string };
      };
      take?: number;
    };

    const products: ProductFixture[] = [
      {
        id: 'product-001-official',
        source: 'OFFICIAL',
        categoryIds: ['100001', '100002'],
      },
      {
        id: 'product-002-mock',
        source: 'MOCK',
        categoryIds: ['100003'],
      },
      {
        id: 'product-003-official',
        source: 'OFFICIAL',
        categoryIds: ['100002', '100004'],
      },
    ];
    const findMany = vi.fn(async (input: FindManyInput) => {
      expect(input.where?.source).toBe('OFFICIAL');
      const afterProductId = input.where?.id?.gt;
      return products
        .filter(
          (product) =>
            product.source === input.where?.source &&
            (!afterProductId || product.id > afterProductId),
        )
        .sort((left, right) => left.id.localeCompare(right.id))
        .slice(0, input.take ?? 0)
        .map(({ id, categoryIds }) => ({ id, categoryIds }));
    });
    const createMany = vi.fn(
      async ({ data }: { data: Array<{ id: string }> }) => ({
        count: data.length,
      }),
    );
    const repository = new PrismaShopeeOfferRepository({
      productLead: { findMany },
      shopeeCategory: { createMany },
    } as never);

    await expect(
      executeShopeeCategoryBackfill({
        args: [SHOPEE_CATEGORY_BACKFILL_CONFIRMATION],
        repository,
        batchSize: 1,
        now: () => new Date('2026-08-24T12:00:00.000Z'),
      }),
    ).resolves.toEqual({
      productsScanned: 2,
      observedCategoryIds: 3,
      categoriesCreated: 3,
      completed: true,
    });

    expect(findMany).toHaveBeenCalledTimes(3);
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { source: 'OFFICIAL', id: undefined },
      orderBy: { id: 'asc' },
      take: 1,
    });
    expect(findMany.mock.calls[1]?.[0]).toMatchObject({
      where: { source: 'OFFICIAL', id: { gt: 'product-001-official' } },
    });
    expect(findMany.mock.calls[2]?.[0]).toMatchObject({
      where: { source: 'OFFICIAL', id: { gt: 'product-003-official' } },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          id: '100001',
          name: null,
          parentId: null,
          mappingSource: 'OFFICIAL_PRODUCT_CATEGORY_ID',
          discoveredAt: new Date('2026-08-24T12:00:00.000Z'),
        },
        {
          id: '100002',
          name: null,
          parentId: null,
          mappingSource: 'OFFICIAL_PRODUCT_CATEGORY_ID',
          discoveredAt: new Date('2026-08-24T12:00:00.000Z'),
        },
        {
          id: '100004',
          name: null,
          parentId: null,
          mappingSource: 'OFFICIAL_PRODUCT_CATEGORY_ID',
          discoveredAt: new Date('2026-08-24T12:00:00.000Z'),
        },
      ],
      skipDuplicates: true,
    });
  });

  it('falha fechado quando a pagina nao progride', async () => {
    const repository = {
      listProductCategoryIdsForBackfill: vi
        .fn()
        .mockResolvedValueOnce([
          { productId: 'product-a', categoryIds: ['100001'] },
        ])
        .mockResolvedValueOnce([
          { productId: 'product-a', categoryIds: ['100001'] },
        ]),
      createObservedCategories: vi.fn(async () => 0),
    };

    await expect(
      executeShopeeCategoryBackfill({
        args: [SHOPEE_CATEGORY_BACKFILL_CONFIRMATION],
        repository,
        batchSize: 1,
      }),
    ).rejects.toMatchObject({
      code: 'SHOPEE_CATEGORY_BACKFILL_NO_PROGRESS',
    });
    expect(repository.createObservedCategories).not.toHaveBeenCalled();
  });

  it('lê páginas ordenadas, deduplica/sort os IDs e grava uma vez', async () => {
    const createObservedCategories = vi.fn(async () => 3);
    const repository = {
      listProductCategoryIdsForBackfill: vi
        .fn()
        .mockResolvedValueOnce([
          { productId: 'product-a', categoryIds: ['20', '10', '20'] },
          { productId: 'product-b', categoryIds: ['30', '10'] },
        ])
        .mockResolvedValueOnce([
          { productId: 'product-c', categoryIds: ['30', ''] },
        ])
        .mockResolvedValueOnce([]),
      createObservedCategories,
    };

    await expect(
      executeShopeeCategoryBackfill({
        args: [SHOPEE_CATEGORY_BACKFILL_CONFIRMATION],
        repository,
        batchSize: 2,
        now: () => new Date('2026-08-24T12:00:00.000Z'),
      }),
    ).resolves.toEqual({
      productsScanned: 3,
      observedCategoryIds: 3,
      categoriesCreated: 3,
      completed: true,
    });
    expect(repository.listProductCategoryIdsForBackfill).toHaveBeenNthCalledWith(
      2,
      { afterProductId: 'product-b', limit: 2 },
    );
    expect(createObservedCategories).toHaveBeenCalledWith(
      ['10', '20', '30'],
      new Date('2026-08-24T12:00:00.000Z'),
    );
  });

  it('exige a confirmação exata', () => {
    expect(() => assertShopeeCategoryBackfillArgs([])).toThrowError(
      expect.objectContaining({
        code: 'SHOPEE_CATEGORY_BACKFILL_CONFIRMATION_REQUIRED',
      }),
    );
    expect(() =>
      assertShopeeCategoryBackfillArgs([SHOPEE_CATEGORY_BACKFILL_CONFIRMATION]),
    ).not.toThrow();
  });

  it('repository envia campos aditivos neutros com skipDuplicates', async () => {
    const createMany = vi.fn(async () => ({ count: 2 }));
    const repository = new PrismaShopeeOfferRepository({
      shopeeCategory: { createMany },
    } as never);

    await expect(
      repository.createObservedCategories(
        ['20', '10', '20', ''],
        new Date('2026-08-24T12:00:00.000Z'),
      ),
    ).resolves.toBe(2);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          id: '10',
          name: null,
          parentId: null,
          mappingSource: 'OFFICIAL_PRODUCT_CATEGORY_ID',
          discoveredAt: new Date('2026-08-24T12:00:00.000Z'),
        },
        {
          id: '20',
          name: null,
          parentId: null,
          mappingSource: 'OFFICIAL_PRODUCT_CATEGORY_ID',
          discoveredAt: new Date('2026-08-24T12:00:00.000Z'),
        },
      ],
      skipDuplicates: true,
    });
  });
});
