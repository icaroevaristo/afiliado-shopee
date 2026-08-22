import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import {
  BASELINE_CONFIRMATION,
  BASELINE_MIGRATION,
  DatabaseBaselineError,
  adoptBaseline,
  createBaselineRuntime,
  evaluateBaselineStatus,
  listRepositoryMigrations,
  parseBaselineArgs,
  runPrismaCommand,
  runSanitizedCommand,
  type BaselineRuntime,
  type DatabaseInspection,
  type ProtectionSnapshot,
} from '../src/migration-baseline';
import { MigrationBaselineSubstageError } from '../src/index';
import { runMigrationBaselineCli } from '../src/migration-baseline-cli';
import {
  assertTemporaryDatabaseName,
  parseCleanVerificationArgs,
  runCleanMigrationVerification,
} from '../src/migration-clean-verifier';

const ROOT = resolve(import.meta.dirname, '../../..');
const MIGRATIONS = resolve(ROOT, 'packages/database/prisma/migrations');
const POSTERIOR_MIGRATIONS = [
  '20260724000000_whatsapp_dispatch',
  '20260724190000_whatsapp_group_directory',
  '20260724230000_shopee_affiliate_foundation',
  '20260725210000_commercial_pipeline_dry_run',
  '20260725230000_commercial_pipeline_confirmed',
  '20260726120000_commercial_automation_guardrails',
  '20260726123000_commercial_automation_guardrail_indexes',
  '20260726200000_commercial_automation_scheduler',
  '20260728120000_commercial_dispatch_outbox',
  '20260728160000_commercial_execution_leases',
  '20260728190000_shopee_official_shop_type',
  '20260729100000_official_offer_scoring_v2',
  '20260729150000_niche_group_campaign_foundation',
  '20260729190000_official_offer_snapshots',
  '20260729210000_campaign_promotion_mining_queue',
  '20260801120000_validated_ai_promotion_copies',
  '20260801130000_openai_copy_attempt_diagnostics',
  '20260801152023_persist_validation_diagnostics',
  '20260814120000_commercial_campaign_anti_starvation_state',
  '20260814130000_commercial_campaign_attempt_reservation',
  '20260814140000_commercial_pipeline_run_execution_link',
  '20260814150000_commercial_automation_external_stage',
  '20260818213000_whatsapp_dispatch_manual_recovery',
  '20260822120000_phase14_instance_assignment_stickiness',
] as const;

const HISTORICAL_HASHES: Record<string, string> = {
  '20260724000000_whatsapp_dispatch':
    '1ab160ded4df9a8af18d73989ee6d95bd480d0ca59294aacd559ca2495fa44e6',
  '20260724190000_whatsapp_group_directory':
    'ea05d2898148d470602227762024eb7dd3fdd6ed4d7586165f649d1a9f690fa2',
  '20260724230000_shopee_affiliate_foundation':
    'f4f050643767c1a1eabbaca749952639e959afe79c03fdd4a67b741ea409b368',
  '20260725210000_commercial_pipeline_dry_run':
    '99a383c7a7e9a1a8fb5260c4fab89b83b9261d476dc97e148ea14fb04d1367fa',
  '20260725230000_commercial_pipeline_confirmed':
    '5dbc94979e9e1a088e5546c643c5c07e8caa0174937bda776cf474ed27ccaf6e',
  '20260726120000_commercial_automation_guardrails':
    '5acecb56633cb596ed1cfa1120932b13054b420ddc8903b29a7b7a7b316db640',
  '20260726123000_commercial_automation_guardrail_indexes':
    'b9f93a7163a52c22536ffd625aefd7417712b8c7d5621013b009bf1382885485',
  '20260726200000_commercial_automation_scheduler':
    'a1aef61c6faf5d3fba1faa9a933a4203817229ec94f13a15d781c510f27e78d9',
  '20260728120000_commercial_dispatch_outbox':
    '08e10ab2a397c099ab5005ee4f614a5792379ba2a0b9950b93de075e769ba1c9',
  '20260728160000_commercial_execution_leases':
    '2305ac810e858a51496d3562dd0c522283b1443efdf261090c799ac0a27292e4',
  '20260728190000_shopee_official_shop_type':
    'a8e4cf128f2712d2b2855f4a1e4ab00806e0b2905133f115d40f96ddf2aac475',
  '20260729100000_official_offer_scoring_v2':
    '8595134062a8131fb69ab0577741583b3dcb2b2a16dd71e896370d9839f59e4d',
  '20260729150000_niche_group_campaign_foundation':
    'ff97df171b7278eb9cfd17b16d09fe3fd23e413721363a978373c4f8d01b0767',
  '20260729190000_official_offer_snapshots':
    '075ec6a4977f7bb9913da33c292d41e20a457f6e616991981b0aca874aef9a93',
  '20260729210000_campaign_promotion_mining_queue':
    'c0e0812bb9cc77e4cdf4e79254d0e1f0380e1d5fdef5807dec4110ddfba9275e',
  '20260801120000_validated_ai_promotion_copies':
    '1a7bf364968a91ead0e0c8a50cf7ea81302487621d24c66bfaf072b4e89b4713',
  '20260801130000_openai_copy_attempt_diagnostics':
    'e4c7bfedb74d1b7f3fe11cee73f79cd823030c20a31b9c4d77f9e81a825612c8',
  '20260801152023_persist_validation_diagnostics':
    'eaa580c91c8ef215e29b7d4bb9fc7153597a23fdeb2ae463145892133f3a0176',
  '20260814120000_commercial_campaign_anti_starvation_state':
    '4bd28e0c9820eadaf11229bf5a7e426e1a79f5ef2f3e64c67eacf7d11dc72b7c',
  '20260814130000_commercial_campaign_attempt_reservation':
    'a48a76c254acf38284ee406f83460a1af7eada76b603925034822fd213ffafc5',
  '20260814140000_commercial_pipeline_run_execution_link':
    'f3b83703e311590d608724f649091acd3de3336c13c07b854db4107402ca2a0d',
  '20260814150000_commercial_automation_external_stage':
    '60aaf58aed648d03ed0fd9e8aef91217d88857be08f33536772a6742e189c07a',
  '20260818213000_whatsapp_dispatch_manual_recovery':
    'ebc61617b41bd1409087742146ee5ab40ad1277ea9bd2be041e08a2b2b1980a2',
  '20260822120000_phase14_instance_assignment_stickiness':
    'b51a3477c0f13527937dc2403191de5320a22a2cf82239f229d4d8a1eff5147b',
};

const migration = (migrationName: string, finished = true) => ({
  migrationName,
  checksum: `checksum-${migrationName}`,
  finishedAt: finished ? new Date('2026-07-28T12:00:00.000Z') : null,
  rolledBackAt: null,
});

const inspection = (
  overrides: Partial<DatabaseInspection> = {},
): DatabaseInspection => ({
  migrationRows: POSTERIOR_MIGRATIONS.map((name) => migration(name)),
  applicationTables: ['ProductLead', 'GeneratedCopy'],
  missingBaselineObjects: [],
  schemaMatchesCurrent: true,
  ...overrides,
});

const snapshot = (
  overrides: Partial<ProtectionSnapshot> = {},
): ProtectionSnapshot => ({
  migrationRowCount: POSTERIOR_MIGRATIONS.length,
  appliedMigrations: Object.fromEntries(
    POSTERIOR_MIGRATIONS.map((name) => [name, `checksum-${name}`]),
  ),
  dataCounts: { ProductLead: '3', GeneratedCopy: '2' },
  schemaFingerprint: 'schema-fingerprint',
  ...overrides,
});

const runtime = (
  inspections: DatabaseInspection[],
  snapshots: ProtectionSnapshot[] = [],
) => {
  const markBaselineApplied = vi.fn(async () => undefined);
  const value: BaselineRuntime = {
    inspect: vi.fn(async () => inspections.shift() ?? inspection()),
    captureProtectionSnapshot: vi.fn(
      async () => snapshots.shift() ?? snapshot(),
    ),
    markBaselineApplied,
    close: vi.fn(async () => undefined),
  };
  return { value, markBaselineApplied };
};

describe('Prisma legacy baseline', () => {
  it('is lexicographically first and creates only the historical objects', () => {
    const migrations = listRepositoryMigrations(MIGRATIONS);
    expect(migrations).toEqual([BASELINE_MIGRATION, ...POSTERIOR_MIGRATIONS]);
    const sql = readFileSync(
      resolve(MIGRATIONS, BASELINE_MIGRATION, 'migration.sql'),
      'utf8',
    );
    expect(
      [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1]),
    ).toEqual(['ProductLead', 'GeneratedCopy']);
    expect(sql).not.toMatch(/WhatsApp|Coupon|Commercial|Shopee/);
    expect(sql).not.toMatch(/IF NOT EXISTS|IF EXISTS/);
  });

  it('preserves every historical migration byte for byte', () => {
    expect(Object.keys(HISTORICAL_HASHES).sort()).toEqual([
      ...POSTERIOR_MIGRATIONS,
    ]);
    for (const [name, expectedHash] of Object.entries(HISTORICAL_HASHES)) {
      const sql = readFileSync(
        resolve(MIGRATIONS, name, 'migration.sql'),
        'utf8',
      ).replace(/\r\n/g, '\n');
      expect(createHash('sha256').update(sql).digest('hex')).toBe(expectedHash);
    }
  });

  it('reports an existing pre-baseline database as ready', () => {
    expect(
      evaluateBaselineStatus(
        listRepositoryMigrations(MIGRATIONS),
        inspection(),
      ),
    ).toMatchObject({
      baselinePresentInRepository: true,
      baselineRegistered: false,
      baselinePending: true,
      appliedMigrationCount: POSTERIOR_MIGRATIONS.length,
      failedMigrations: [],
      database: 'existing',
      readyForAdoption: true,
    });
  });

  it('adopts only the history row and proves schema and data preservation', async () => {
    const afterInspection = inspection({
      migrationRows: [
        migration(BASELINE_MIGRATION),
        ...POSTERIOR_MIGRATIONS.map((name) => migration(name)),
      ],
    });
    const afterSnapshot = snapshot({
      migrationRowCount: POSTERIOR_MIGRATIONS.length + 1,
      appliedMigrations: {
        [BASELINE_MIGRATION]: 'baseline-checksum',
        ...snapshot().appliedMigrations,
      },
    });
    const mocked = runtime(
      [inspection(), afterInspection],
      [snapshot(), afterSnapshot],
    );

    await expect(
      adoptBaseline(listRepositoryMigrations(MIGRATIONS), mocked.value),
    ).resolves.toEqual({
      adopted: true,
      alreadyRegistered: false,
      dataPreserved: true,
    });
    expect(mocked.markBaselineApplied).toHaveBeenCalledOnce();
  });

  it('is idempotent when the baseline is already registered', async () => {
    const mocked = runtime([
      inspection({
        migrationRows: [
          migration(BASELINE_MIGRATION),
          ...POSTERIOR_MIGRATIONS.map((name) => migration(name)),
        ],
      }),
    ]);
    await expect(
      adoptBaseline(listRepositoryMigrations(MIGRATIONS), mocked.value),
    ).resolves.toMatchObject({ adopted: false, alreadyRegistered: true });
    expect(mocked.markBaselineApplied).not.toHaveBeenCalled();
  });

  it.each([
    [
      'failed migration',
      inspection({
        migrationRows: [migration(POSTERIOR_MIGRATIONS[0], false)],
      }),
    ],
    [
      'empty database',
      inspection({
        applicationTables: [],
        missingBaselineObjects: ['table:ProductLead'],
      }),
    ],
    [
      'pending posterior migration',
      inspection({
        migrationRows: POSTERIOR_MIGRATIONS.slice(1).map((name) =>
          migration(name),
        ),
      }),
    ],
    ['schema drift', inspection({ schemaMatchesCurrent: false })],
  ])('blocks adoption for %s', async (_label, currentInspection) => {
    const mocked = runtime([currentInspection]);
    await expect(
      adoptBaseline(listRepositoryMigrations(MIGRATIONS), mocked.value),
    ).rejects.toMatchObject({ code: 'DATABASE_BASELINE_ADOPTION_BLOCKED' });
    expect(mocked.markBaselineApplied).not.toHaveBeenCalled();
  });

  it('blocks an inconsistent database even when the baseline is registered', async () => {
    const mocked = runtime([
      inspection({
        migrationRows: [
          migration(BASELINE_MIGRATION),
          migration(BASELINE_MIGRATION, false),
          ...POSTERIOR_MIGRATIONS.map((name) => migration(name)),
        ],
      }),
    ]);
    await expect(
      adoptBaseline(listRepositoryMigrations(MIGRATIONS), mocked.value),
    ).rejects.toMatchObject({ code: 'DATABASE_BASELINE_ADOPTION_BLOCKED' });
    expect(mocked.markBaselineApplied).not.toHaveBeenCalled();
  });

  it('accepts only the exact adoption confirmation', () => {
    expect(parseBaselineArgs(['status'])).toEqual({ command: 'status' });
    expect(parseBaselineArgs(['adopt', '--', BASELINE_CONFIRMATION])).toEqual({
      command: 'adopt',
    });
    for (const args of [
      ['adopt'],
      ['adopt', '--confirm'],
      ['adopt', BASELINE_CONFIRMATION, '--extra'],
      ['adopt', '--', '--', BASELINE_CONFIRMATION],
    ]) {
      expect(() => parseBaselineArgs(args)).toThrow(DatabaseBaselineError);
    }
  });

  it('uses node plus pnpm.cjs on Windows without Corepack or direct .cmd execution', async () => {
    const commandRunner = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));
    const environment = { Path: 'C:\\pnpm-home;C:\\other', DATABASE_URL: 'postgresql://not-used' };
    const pnpmCommand = 'C:\\pnpm-home\\pnpm.cmd';
    const pnpmEntrypoint = 'C:\\pnpm-home\\node_modules\\pnpm\\bin\\pnpm.cjs';
    const fileExists = vi.fn((path: string) => path === pnpmCommand || path === pnpmEntrypoint);
    await runPrismaCommand(
      ['migrate', 'diff', '--from-schema-datasource', 'prisma/schema.prisma', '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'],
      { root: 'C:\\repo', environment },
      commandRunner,
      { platform: 'win32', execPath: 'C:\\node\\node.exe', fileExists },
    );
    expect(commandRunner).toHaveBeenCalledWith(
      'C:\\node\\node.exe',
      [pnpmEntrypoint, '--filter', '@shopee-auto-affiliate-ai/database', 'exec', 'prisma', 'migrate', 'diff', '--from-schema-datasource', 'prisma/schema.prisma', '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'],
      { cwd: 'C:\\repo', env: environment },
    );
    expect(JSON.stringify(commandRunner.mock.calls[0])).not.toMatch(/corepack/i);
    expect(commandRunner.mock.calls[0]?.[0]).not.toMatch(/\.cmd$/i);
  });

  it.each(['linux', 'darwin'] as const)('uses pnpm directly on %s', async (platform) => {
    const commandRunner = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));
    const fileExists = vi.fn(() => false);
    await runPrismaCommand(
      ['migrate', 'diff', '--exit-code'],
      { root: '/repo', environment: { PATH: '/tools' } },
      commandRunner,
      { platform, execPath: '/node', fileExists },
    );
    expect(commandRunner).toHaveBeenCalledWith(
      'pnpm',
      ['--filter', '@shopee-auto-affiliate-ai/database', 'exec', 'prisma', 'migrate', 'diff', '--exit-code'],
      { cwd: '/repo', env: { PATH: '/tools' } },
    );
    expect(fileExists).not.toHaveBeenCalled();
  });

  it('fails closed when Windows pnpm.cjs cannot be resolved', () => {
    const commandRunner = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));
    let error: unknown;
    try {
      runPrismaCommand(
        ['migrate', 'diff', '--exit-code'],
        { root: 'C:\\sensitive-root', environment: { Path: 'C:\\sensitive-user\\pnpm-home', DATABASE_URL: 'postgresql://user:password@host/db?token=secret' } },
        commandRunner,
        { platform: 'win32', execPath: 'C:\\node\\node.exe', fileExists: () => false },
      );
    } catch (caught: unknown) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DatabaseBaselineError);
    expect(error).toMatchObject({ code: 'DATABASE_BASELINE_DRIFT_CHECK_FAILED' });
    expect(commandRunner).not.toHaveBeenCalled();
    expect(JSON.stringify(error)).not.toMatch(/sensitive-user|sensitive-root|password|token|secret|postgresql:\/\//i);
  });

  it('keeps shell, stdio, cwd and env fixed in the sanitized subprocess', async () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
    const spawnProcess = vi.fn(() => child);
    const environment = { SAFE_TEST_VALUE: 'kept-in-memory' };
    const pending = runSanitizedCommand(
      'C:\\node\\node.exe',
      ['C:\\pnpm\\pnpm.cjs', '--version'],
      { cwd: 'C:\\repo', env: environment },
      spawnProcess,
    );
    queueMicrotask(() => child.emit('close', 0));
    await expect(pending).resolves.toEqual({ code: 0, stdout: '', stderr: '' });
    expect(spawnProcess).toHaveBeenCalledWith(
      'C:\\node\\node.exe',
      ['C:\\pnpm\\pnpm.cjs', '--version'],
      { cwd: 'C:\\repo', env: environment, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  });

  it('does not serialize sensitive spawn failures', async () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
    const pending = runSanitizedCommand(
      'node', [],
      { cwd: 'C:\\repo', env: { TOKEN: 'secret-token' } },
      vi.fn(() => child),
    ).catch((value: unknown) => value);
    queueMicrotask(() => child.emit('error', new Error('C:\\secret\\path token=secret-token')));
    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect(JSON.stringify(error)).not.toMatch(/secret|token/i);
  });

  it('marks inspect failures with the inspect substage without serializing the cause', async () => {
    const originalError = Object.assign(new Error('postgresql://secret SELECT token'), { code: 'P1001' });
    const query = vi.spyOn(PrismaClient.prototype, '$queryRawUnsafe').mockRejectedValue(originalError);
    const disconnect = vi.spyOn(PrismaClient.prototype, '$disconnect').mockResolvedValue(undefined);
    const commandRunner = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));
    const baselineRuntime = createBaselineRuntime({ root: ROOT, environment: { DATABASE_URL: 'postgresql://not-used' }, commandRunner });
    try {
      const error = await baselineRuntime.inspect().catch((value: unknown) => value);
      expect(error).toBeInstanceOf(MigrationBaselineSubstageError);
      expect(error).toMatchObject({ substage: 'inspect', cause: originalError });
      expect(JSON.stringify(error)).not.toMatch(/secret|SELECT|token|postgresql:\/\//i);
    } finally {
      await baselineRuntime.close();
      query.mockRestore();
      disconnect.mockRestore();
    }
  });

  it('marks migrate diff failures with the diff substage and preserves its command', async () => {
    const originalError = Object.assign(new Error('sensitive stderr'), { code: 'ENOENT' });
    const query = vi.spyOn(PrismaClient.prototype, '$queryRawUnsafe').mockResolvedValue([]);
    const disconnect = vi.spyOn(PrismaClient.prototype, '$disconnect').mockResolvedValue(undefined);
    const commandRunner = vi.fn(async () => { throw originalError; });
    const baselineRuntime = createBaselineRuntime({
      root: ROOT,
      environment: { Path: 'C:\\pnpm-home', DATABASE_URL: 'postgresql://not-used' },
      commandRunner,
      commandDependencies: {
        platform: 'win32',
        execPath: 'C:\\node\\node.exe',
        fileExists: (path) =>
          path === 'C:\\pnpm-home\\pnpm.cmd' ||
          path === 'C:\\pnpm-home\\node_modules\\pnpm\\bin\\pnpm.cjs',
      },
    });
    try {
      const error = await baselineRuntime.inspect().catch((value: unknown) => value);
      expect(error).toBeInstanceOf(MigrationBaselineSubstageError);
      expect(error).toMatchObject({ substage: 'diff', cause: originalError });
      expect(commandRunner.mock.calls[0]?.[0]).toBe('C:\\node\\node.exe');
      expect(commandRunner.mock.calls[0]?.[1]).toEqual([
        'C:\\pnpm-home\\node_modules\\pnpm\\bin\\pnpm.cjs',
        '--filter', '@shopee-auto-affiliate-ai/database', 'exec', 'prisma',
        'migrate', 'diff', '--from-schema-datasource', 'prisma/schema.prisma',
        '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code',
      ]);
    } finally {
      await baselineRuntime.close();
      query.mockRestore();
      disconnect.mockRestore();
    }
  });

  it('keeps runtime.inspect success compatible with the existing result', async () => {
    const query = vi.spyOn(PrismaClient.prototype, '$queryRawUnsafe').mockResolvedValue([]);
    const disconnect = vi.spyOn(PrismaClient.prototype, '$disconnect').mockResolvedValue(undefined);
    const commandRunner = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));
    const baselineRuntime = createBaselineRuntime({
      root: ROOT,
      environment: { Path: 'C:\\pnpm-home', DATABASE_URL: 'postgresql://not-used' },
      commandRunner,
      commandDependencies: {
        platform: 'win32',
        execPath: 'C:\\node\\node.exe',
        fileExists: (path) =>
          path === 'C:\\pnpm-home\\pnpm.cmd' ||
          path === 'C:\\pnpm-home\\node_modules\\pnpm\\bin\\pnpm.cjs',
      },
    });
    try {
      await expect(baselineRuntime.inspect()).resolves.toMatchObject({ migrationRows: [], applicationTables: [], schemaMatchesCurrent: true });
    } finally {
      await baselineRuntime.close();
      query.mockRestore();
      disconnect.mockRestore();
    }
  });

  it('keeps migrate diff exit code 2 as an expected non-error result', async () => {
    const query = vi.spyOn(PrismaClient.prototype, '$queryRawUnsafe').mockResolvedValue([]);
    const disconnect = vi.spyOn(PrismaClient.prototype, '$disconnect').mockResolvedValue(undefined);
    const commandRunner = vi.fn(async () => ({ code: 2, stdout: '', stderr: '' }));
    const baselineRuntime = createBaselineRuntime({
      root: ROOT,
      environment: { Path: 'C:\\pnpm-home', DATABASE_URL: 'postgresql://not-used' },
      commandRunner,
      commandDependencies: {
        platform: 'win32',
        execPath: 'C:\\node\\node.exe',
        fileExists: (path) => path.endsWith('pnpm.cmd') || path.endsWith('pnpm.cjs'),
      },
    });
    try {
      await expect(baselineRuntime.inspect()).resolves.toMatchObject({ schemaMatchesCurrent: false });
    } finally {
      await baselineRuntime.close();
      query.mockRestore();
      disconnect.mockRestore();
    }
  });

  it('keeps unexpected migrate diff exit codes as DatabaseBaselineError', async () => {
    const query = vi.spyOn(PrismaClient.prototype, '$queryRawUnsafe').mockResolvedValue([]);
    const disconnect = vi.spyOn(PrismaClient.prototype, '$disconnect').mockResolvedValue(undefined);
    const commandRunner = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'sensitive stderr' }));
    const baselineRuntime = createBaselineRuntime({
      root: ROOT,
      environment: { Path: 'C:\\pnpm-home', DATABASE_URL: 'postgresql://not-used' },
      commandRunner,
      commandDependencies: {
        platform: 'win32',
        execPath: 'C:\\node\\node.exe',
        fileExists: (path) => path.endsWith('pnpm.cmd') || path.endsWith('pnpm.cjs'),
      },
    });
    try {
      const error = await baselineRuntime.inspect().catch((value: unknown) => value);
      expect(error).toBeInstanceOf(MigrationBaselineSubstageError);
      expect(error).toMatchObject({
        substage: 'diff',
        cause: { code: 'DATABASE_BASELINE_DRIFT_CHECK_FAILED' },
      });
      expect(JSON.stringify(error)).not.toContain('sensitive stderr');
    } finally {
      await baselineRuntime.close();
      query.mockRestore();
      disconnect.mockRestore();
    }
  });

  it('uses only prisma migrate resolve for adoption', async () => {
    const commandRunner = vi.fn(async () => ({
      code: 0,
      stdout: '',
      stderr: '',
    }));
    const baselineRuntime = createBaselineRuntime({
      root: ROOT,
      environment: {
        DATABASE_URL: 'postgresql://user:secret@127.0.0.1:1/not-used',
      },
      commandRunner,
      commandDependencies: {
        platform: 'linux',
        execPath: '/node',
        fileExists: () => false,
      },
    });
    await baselineRuntime.markBaselineApplied();
    await baselineRuntime.close();
    const args = commandRunner.mock.calls[0]?.[1] as string[];
    expect(args).toContain('resolve');
    expect(args).toContain('--applied');
    expect(args).toContain(BASELINE_MIGRATION);
    expect(args).not.toContain('deploy');
    expect(args).not.toContain('db');
  });

  it('keeps credentials out of status output', async () => {
    const logs: unknown[] = [];
    const mocked = runtime([inspection()]);
    const result = await runMigrationBaselineCli({
      args: ['status'],
      environment: {
        DATABASE_URL:
          'postgresql://sensitive-user:sensitive-password@127.0.0.1:5432/app',
      },
      root: ROOT,
      migrationsDirectory: MIGRATIONS,
      logger: {
        info: (data) => logs.push(data),
        error: (data) => logs.push(data),
      },
      runtimeFactory: () => mocked.value,
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.stringify(logs)).not.toMatch(
      /sensitive-user|sensitive-password|postgresql:\/\//,
    );
  });

  it('sanitizes a connection close failure', async () => {
    const logs: unknown[] = [];
    const mocked = runtime([inspection()]);
    mocked.value.close = vi.fn(async () => {
      throw new Error(
        'postgresql://sensitive-user:sensitive-password@127.0.0.1/app',
      );
    });
    const result = await runMigrationBaselineCli({
      args: ['status'],
      environment: {
        DATABASE_URL:
          'postgresql://sensitive-user:sensitive-password@127.0.0.1:5432/app',
      },
      root: ROOT,
      migrationsDirectory: MIGRATIONS,
      logger: {
        info: (data) => logs.push(data),
        error: (data) => logs.push(data),
      },
      runtimeFactory: () => mocked.value,
    });
    expect(result).toMatchObject({
      exitCode: 1,
      result: { code: 'DATABASE_BASELINE_CLOSE_FAILED' },
    });
    expect(JSON.stringify(logs)).not.toMatch(
      /sensitive-user|sensitive-password|postgresql:\/\//,
    );
  });

  it('rejects clean verification arguments and unsafe database names', () => {
    expect(() => parseCleanVerificationArgs([])).not.toThrow();
    expect(() => parseCleanVerificationArgs(['--extra'])).toThrow(
      DatabaseBaselineError,
    );
    expect(() =>
      assertTemporaryDatabaseName(
        'shopee_migration_verify_00000000000000000000000000000000',
      ),
    ).not.toThrow();
    expect(() => assertTemporaryDatabaseName('production')).toThrow(
      DatabaseBaselineError,
    );
  });

  it('drops the temporary database after a deploy failure', async () => {
    const databaseName =
      'shopee_migration_verify_00000000000000000000000000000000';
    const adminQueries: string[] = [];
    const admin = {
      async $executeRawUnsafe(query: string) {
        adminQueries.push(query);
        return 0;
      },
      async $queryRawUnsafe<T>(query: string): Promise<T> {
        adminQueries.push(query);
        return [] as T;
      },
      async $disconnect() {},
    };
    const temporary = {
      async $executeRawUnsafe() {
        return 0;
      },
      async $queryRawUnsafe<T>(): Promise<T> {
        return [{ count: 0n }] as T;
      },
      async $disconnect() {},
    };
    const commandRunner = vi.fn(async () => ({
      code: 1,
      stdout: '',
      stderr: 'sensitive-password',
    }));
    const result = await runCleanMigrationVerification({
      args: [],
      environment: {
        DATABASE_URL:
          'postgresql://sensitive-user:sensitive-password@127.0.0.1:5432/app',
      },
      root: ROOT,
      migrationsDirectory: MIGRATIONS,
      logger: { info: vi.fn(), error: vi.fn() },
      databaseNameFactory: () => databaseName,
      clientFactory: vi
        .fn()
        .mockReturnValueOnce(admin)
        .mockReturnValueOnce(temporary),
      commandRunner,
    });
    expect(result).toMatchObject({
      exitCode: 1,
      result: { code: 'CLEAN_DATABASE_DEPLOY_FAILED' },
    });
    expect(adminQueries).toContain(
      `CREATE DATABASE "${databaseName}" TEMPLATE template0`,
    );
    expect(adminQueries).toContain(`DROP DATABASE "${databaseName}"`);
  });
});
