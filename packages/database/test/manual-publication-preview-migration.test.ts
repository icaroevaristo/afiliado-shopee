import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  fileURLToPath(
    new URL(
      '../prisma/migrations/20260826100000_phase17_manual_publication_preview_mode/migration.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);
const schema = readFileSync(
  fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)),
  'utf8',
);

describe('manual publication preview migration', () => {
  it('is additive, preserves legacy SEND rows, and is not applied by the test', () => {
    expect(sql).toContain(
      'CREATE TYPE "ManualPublicationRequestMode" AS ENUM',
    );
    expect(sql).toContain(
      'ALTER TYPE "ManualPublicationRequestStatus" ADD VALUE \'PREVIEW_READY\'',
    );
    expect(sql).toContain(
      'ADD COLUMN "mode" "ManualPublicationRequestMode" NOT NULL DEFAULT \'SEND\'',
    );
    expect(sql).not.toMatch(/UPDATE|DELETE|DROP|INSERT/iu);
  });

  it('persists operation mode and a terminal preview-ready status in the schema', () => {
    expect(schema).toContain(
      'mode                       ManualPublicationRequestMode  @default(SEND)',
    );
    expect(schema).toContain('PREVIEW_READY');
    expect(schema).toContain('enum ManualPublicationRequestMode');
  });
});
