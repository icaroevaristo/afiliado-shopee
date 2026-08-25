import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type {
  ShopeeCategoryBackfillRepository,
  ShopeeCategoryBackfillProduct,
} from './repositories';

export const SHOPEE_CATEGORY_BACKFILL_CONFIRMATION =
  '--confirm-local-category-backfill';
const DEFAULT_BATCH_SIZE = 100;

export type ShopeeCategoryBackfillReport = {
  /** Number of OFFICIAL ProductLead records effectively read by the backfill. */
  productsScanned: number;
  observedCategoryIds: number;
  categoriesCreated: number;
  completed: boolean;
};

const blocked = (code: string, message: string) => new AppError(message, code);

export const assertShopeeCategoryBackfillArgs = (
  rawArgs: readonly string[],
) => {
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
  if (
    args.length !== 1 ||
    args[0] !== SHOPEE_CATEGORY_BACKFILL_CONFIRMATION
  ) {
    throw blocked(
      'SHOPEE_CATEGORY_BACKFILL_CONFIRMATION_REQUIRED',
      `Backfill exige somente ${SHOPEE_CATEGORY_BACKFILL_CONFIRMATION}`,
    );
  }
};

const normalizedCategoryIds = (products: ShopeeCategoryBackfillProduct[]) =>
  [...new Set(
    products.flatMap(({ categoryIds }) =>
      categoryIds
        .map((categoryId) => categoryId.trim())
        .filter((categoryId) => categoryId.length > 0),
    ),
  )].sort((left, right) => left.localeCompare(right));

export const executeShopeeCategoryBackfill = async ({
  args,
  repository,
  now = () => new Date(),
  batchSize = DEFAULT_BATCH_SIZE,
}: {
  args: readonly string[];
  repository: ShopeeCategoryBackfillRepository;
  now?: () => Date;
  batchSize?: number;
}): Promise<ShopeeCategoryBackfillReport> => {
  assertShopeeCategoryBackfillArgs(args);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw blocked(
      'SHOPEE_CATEGORY_BACKFILL_INVALID_BATCH',
      'Backfill exige lote entre 1 e 500 produtos',
    );
  }

  const products: ShopeeCategoryBackfillProduct[] = [];
  let afterProductId: string | undefined;
  while (true) {
    const page = await repository.listProductCategoryIdsForBackfill({
      afterProductId,
      limit: batchSize,
    });
    if (page.length === 0) break;
    products.push(...page);
    const nextProductId = page[page.length - 1]?.productId;
    if (!nextProductId || nextProductId === afterProductId) {
      throw blocked(
        'SHOPEE_CATEGORY_BACKFILL_NO_PROGRESS',
        'Backfill nao avancou sobre ProductLead',
      );
    }
    afterProductId = nextProductId;
    if (page.length < batchSize) break;
  }

  const categoryIds = normalizedCategoryIds(products);
  const categoriesCreated = await repository.createObservedCategories(
    categoryIds,
    now(),
  );
  return {
    productsScanned: products.length,
    observedCategoryIds: categoryIds.length,
    categoriesCreated,
    completed: true,
  };
};
