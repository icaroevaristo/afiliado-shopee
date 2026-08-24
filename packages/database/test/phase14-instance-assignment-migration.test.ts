import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  fileURLToPath(
    new URL(
      '../prisma/migrations/20260822120000_phase14_instance_assignment_stickiness/migration.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);
const schema = readFileSync(
  fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)),
  'utf8',
);

describe('phase 14 instance assignment migration', () => {
  it('adds the registry and nullable lifecycle assignments', () => {
    expect(schema).toContain('model WhatsAppInstance');
    expect(schema).toContain('assignedInstanceName   String?');
    expect(schema).toContain('instanceName          String?');
    expect(sql).toContain('CREATE TABLE "WhatsAppInstance"');
    expect(sql).toContain('ADD COLUMN "assignedInstanceName" TEXT');
    expect(sql).toContain('ADD COLUMN "instanceName" TEXT');
  });

  it('backfills only the new registry/assignment from discovery provenance', () => {
    expect(sql).toContain('SELECT DISTINCT "sourceInstanceName"');
    expect(sql).toContain('SET "assignedInstanceName" = "sourceInstanceName"');
    expect(sql).toContain('ON CONFLICT ("name") DO NOTHING');
    expect(sql).not.toMatch(/DELETE\s+FROM|DROP\s+(?:TABLE|COLUMN)/iu);
    expect(sql).not.toMatch(
      /UPDATE\s+"(?:CommercialPipelineRun|WhatsAppDispatch|CommercialDispatchOutbox)"/iu,
    );
  });

  it('adds foreign keys without making legacy rows require an instance', () => {
    expect(sql).toContain('ON DELETE RESTRICT');
    expect(sql).not.toContain('ON DELETE SET NULL');
    expect(schema).toMatch(/assignedInstanceName\s+String\?/);
    expect(schema).toMatch(/instanceName\s+String\?/);
  });
});
