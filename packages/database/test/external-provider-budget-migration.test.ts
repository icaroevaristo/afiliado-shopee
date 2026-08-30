import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    '../prisma/migrations/20260830143000_phase23_external_provider_budgets/migration.sql',
  ),
  'utf8',
);

describe('external provider daily budget migration', () => {
  it('adds nullable backward-compatible limits with positive constraints', () => {
    expect(migration).toContain('ADD COLUMN "dailyShopeeHttpLimit" INTEGER');
    expect(migration).toContain(
      'ADD COLUMN "dailyOpenAiGenerationLimit" INTEGER',
    );
    expect(migration).toContain(
      '"dailyShopeeHttpLimit" IS NULL OR "dailyShopeeHttpLimit" > 0',
    );
    expect(migration).toContain(
      '"dailyOpenAiGenerationLimit" IS NULL OR "dailyOpenAiGenerationLimit" > 0',
    );
    expect(migration).not.toMatch(/NOT NULL[^;]*daily(?:Shopee|OpenAi)/u);
  });

  it('creates one atomic daily ledger key per supported provider', () => {
    expect(migration).toContain(
      'CREATE TABLE "CommercialExternalProviderUsage"',
    );
    expect(migration).toContain('PRIMARY KEY ("provider", "dayKey")');
    expect(migration).toContain("CHECK (\"provider\" IN ('SHOPEE', 'OPENAI'))");
    expect(migration).toContain('CHECK ("usedCount" >= 0)');
  });
});
