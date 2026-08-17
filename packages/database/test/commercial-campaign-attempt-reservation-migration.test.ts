import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  fileURLToPath(
    new URL(
      '../prisma/migrations/20260814130000_commercial_campaign_attempt_reservation/migration.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);
const schema = readFileSync(
  fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)),
  'utf8',
);

describe('commercial campaign attempt reservation migration', () => {
  it('adds only nullable attempt reservation columns', () => {
    expect(sql).toContain('ALTER TABLE "CommercialGroupCampaign"');
    expect(sql).toContain('"attemptExecutionId" TEXT');
    expect(sql).toContain('"attemptReservedAt" TIMESTAMP(3)');
    expect(sql).toContain('"attemptLeaseExpiresAt" TIMESTAMP(3)');
    expect(sql).not.toMatch(/DEFAULT|CREATE\s+(?:INDEX|UNIQUE|TYPE)/iu);
    expect(sql).not.toMatch(/DROP\s+(?:TABLE|COLUMN|TYPE)/iu);
    expect(sql).not.toMatch(/DELETE\s+FROM|UPDATE\s+"|INSERT\s+INTO/iu);
  });

  it('keeps every reservation field nullable in the Prisma model', () => {
    expect(schema).toContain('attemptExecutionId      String?');
    expect(schema).toContain('attemptReservedAt       DateTime?');
    expect(schema).toContain('attemptLeaseExpiresAt   DateTime?');
  });
});
