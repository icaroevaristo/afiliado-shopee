import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  fileURLToPath(
    new URL(
      '../prisma/migrations/20260814120000_commercial_campaign_anti_starvation_state/migration.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);
const schema = readFileSync(
  fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)),
  'utf8',
);

describe('commercial campaign anti-starvation persistence migration', () => {
  it('adiciona somente os campos aditivos com defaults seguros', () => {
    expect(sql).toContain('ALTER TABLE "CommercialGroupCampaign"');
    expect(sql).toContain('"failureCount" INTEGER NOT NULL DEFAULT 0');
    expect(sql).toContain('"nextEligibleAt" TIMESTAMP(3)');
    expect(sql).not.toMatch(/DROP\s+(?:TABLE|COLUMN|TYPE)/iu);
    expect(sql).not.toMatch(/DELETE\s+FROM|UPDATE\s+"|INSERT\s+INTO/iu);
  });

  it('mantem os tipos de contrato sem alterar dailyLimit', () => {
    expect(schema).toContain('failureCount            Int                  @default(0)');
    expect(schema).toContain('nextEligibleAt          DateTime?');
    expect(schema).toContain('dailyLimit              Int                  @default(60)');
  });
});
