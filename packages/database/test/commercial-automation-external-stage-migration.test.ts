import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  fileURLToPath(
    new URL(
      '../prisma/migrations/20260814150000_commercial_automation_external_stage/migration.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);
const schema = readFileSync(
  fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)),
  'utf8',
);

describe('commercial automation external stage migration', () => {
  it('adds a conservative legacy value and a safe default for new executions', () => {
    expect(sql).toContain(
      'CREATE TYPE "CommercialAutomationExecutionExternalStage" AS ENUM',
    );
    expect(sql).toContain(
      "NOT NULL DEFAULT 'EXTERNAL_MAY_HAVE_STARTED'",
    );
    expect(sql).toContain(
      "ALTER COLUMN \"externalStage\" SET DEFAULT 'NOT_REACHED'",
    );
    expect(sql).not.toMatch(/UPDATE|DELETE|DROP|INSERT/iu);
  });

  it('keeps lifecycle status separate from the external boundary', () => {
    expect(schema).toContain(
      'externalStage   CommercialAutomationExecutionExternalStage @default(NOT_REACHED)',
    );
    expect(schema).toContain('EXTERNAL_MAY_HAVE_STARTED');
  });
});