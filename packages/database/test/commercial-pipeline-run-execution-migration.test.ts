import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  fileURLToPath(
    new URL(
      '../prisma/migrations/20260814140000_commercial_pipeline_run_execution_link/migration.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);
const schema = readFileSync(
  fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)),
  'utf8',
);
const executionModel = schema.slice(
  schema.indexOf('model CommercialAutomationExecution'),
  schema.indexOf('enum WhatsAppDispatchStatus'),
);

describe('commercial pipeline run execution link migration', () => {
  it('adds a nullable unique execution link without backfill', () => {
    expect(sql).toContain('ADD COLUMN "executionId" TEXT');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "CommercialPipelineRun_executionId_key"',
    );
    expect(sql).not.toMatch(/UPDATE|DELETE|DROP|INSERT/iu);
  });

  it('keeps the link nullable and preserves the existing execution contract', () => {
    expect(schema).toContain('executionId           String?');
    expect(executionModel).toContain('commercialRunId String?');
    expect(executionModel).not.toContain('commercialRun   CommercialPipelineRun');
  });
});
