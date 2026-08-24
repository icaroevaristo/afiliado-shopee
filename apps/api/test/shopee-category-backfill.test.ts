import { describe, expect, it, vi } from 'vitest';
import {
  assertShopeeCategoryBackfillArgs,
  executeShopeeCategoryBackfill,
  SHOPEE_CATEGORY_BACKFILL_CONFIRMATION,
} from '../src/shopee-category-backfill';
import { PrismaShopeeOfferRepository } from '../src/prisma-repositories';

describe('Shopee category backfill', () => {
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
