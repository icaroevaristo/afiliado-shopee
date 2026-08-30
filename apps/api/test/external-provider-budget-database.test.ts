import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';

import { PrismaCommercialExternalProviderUsageRepository } from '../src/prisma-repositories';

const enabled = process.env.RUN_EXTERNAL_BUDGET_DB_TEST === 'true';
const databaseUrl = process.env.DATABASE_URL;
const suite = enabled && databaseUrl ? describe : describe.skip;

suite('external provider budget PostgreSQL claim', () => {
  const first = createPrismaClient(databaseUrl);
  const second = createPrismaClient(databaseUrl);

  beforeAll(async () => {
    await first.$connect();
    await second.$connect();
  });

  afterAll(async () => {
    await Promise.all([first.$disconnect(), second.$disconnect()]);
  });

  it('concede somente uma de duas claims concorrentes no último slot', async () => {
    const one = new PrismaCommercialExternalProviderUsageRepository(first);
    const two = new PrismaCommercialExternalProviderUsageRepository(second);
    const input = {
      provider: 'SHOPEE' as const,
      dayKey: '2099-01-01',
      limit: 1,
      now: new Date('2099-01-01T12:00:00.000Z'),
    };
    const results = await Promise.all([one.claim(input), two.claim(input)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((result) => result === null)).toHaveLength(1);
    expect(await one.getUsage('SHOPEE', input.dayKey)).toMatchObject({
      usedCount: 1,
    });
  });

  it('preserva usage ao trocar de conexão/repository', async () => {
    const one = new PrismaCommercialExternalProviderUsageRepository(first);
    const two = new PrismaCommercialExternalProviderUsageRepository(second);
    const input = {
      provider: 'OPENAI' as const,
      dayKey: '2099-01-02',
      limit: 1,
      now: new Date('2099-01-02T12:00:00.000Z'),
    };
    await expect(one.claim(input)).resolves.toMatchObject({ usedCount: 1 });
    await expect(two.claim(input)).resolves.toBeNull();
  });

  it('usa dayKey distinto como novo orçamento', async () => {
    const repository = new PrismaCommercialExternalProviderUsageRepository(
      first,
    );
    await expect(
      repository.claim({
        provider: 'OPENAI',
        dayKey: '2099-01-03',
        limit: 1,
        now: new Date('2099-01-03T12:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ usedCount: 1 });
  });
});
