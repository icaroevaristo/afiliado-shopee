import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';

const enabled = process.env.RUN_OPERATIONAL_CATALOG_ENUM_DB_TEST === 'true';
const describeDatabase = enabled ? describe : describe.skip;

describeDatabase('operational catalog source enum database regression', () => {
  const prisma = createPrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each(['OFFICIAL', 'MOCK', 'MANUAL'] as const)(
    'compara source %s como ShopeeOfferSource sem converter o bind em text',
    async (source) => {
      const rows = await prisma.$queryRaw<Array<{ source: typeof source }>>`
        SELECT catalog."source"
        FROM (
          VALUES
            ('OFFICIAL'::"ShopeeOfferSource"),
            ('MOCK'::"ShopeeOfferSource"),
            ('MANUAL'::"ShopeeOfferSource")
        ) AS catalog("source")
        WHERE catalog."source" = ${source}::"ShopeeOfferSource"
      `;

      expect(rows).toEqual([{ source }]);
    },
  );
});
