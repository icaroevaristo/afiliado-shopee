import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  APPLICATION_TABLES,
  BASELINE_MIGRATION,
  createBaselineRuntime,
  createPrismaClient,
  listRepositoryMigrations,
  MigrationBaselineSubstageError,
} from '@shopee-auto-affiliate-ai/database';

import type {
  PreviewExecutionEvidence,
  PreviewStabilityEvidence,
} from './preview-stability';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MIGRATIONS_DIRECTORY = resolve(
  ROOT,
  'packages/database/prisma/migrations',
);


export type PreviewStabilityDatabaseHelperOperation =
  | 'capture'
  | 'executions'
  | 'group-instance'
  | 'force-pause'
  | 'unknown';

export const CAPTURE_STAGES = [
  'migrations', 'settings', 'executions', 'runs-total', 'runs-dry-run',
  'runs-ambiguous', 'runs-investigation', 'dispatch-total',
  'dispatch-processing', 'outbox-total', 'outbox-pending',
  'outbox-ambiguous', 'table-counts',
] as const;

export type PreviewStabilityDatabaseCaptureStage = (typeof CAPTURE_STAGES)[number];
export type PreviewStabilityDatabaseHelperErrorKind =
  | 'PRISMA' | 'PRISMA_VALIDATION' | 'PRISMA_UNKNOWN'
  | 'PRISMA_INITIALIZATION' | 'DATABASE_BASELINE' | 'SYSTEM' | 'UNKNOWN';

export type PreviewStabilityDatabaseHelperFailure = {
  code: 'PREVIEW_STABILITY_DATABASE_HELPER_FAILED';
  operation: PreviewStabilityDatabaseHelperOperation;
  captureStage?: PreviewStabilityDatabaseCaptureStage;
  captureSubstage?: 'inspect' | 'diff';
  errorKind: PreviewStabilityDatabaseHelperErrorKind;
  errorCode?: string;
  failed: true;
};

const SAFE_SYSTEM_ERROR_CODES = new Set(['ENOENT','EACCES','ETIMEDOUT','ECONNREFUSED','EPIPE']);
const SAFE_DATABASE_BASELINE_ERROR_CODES = new Set([
  'DATABASE_BASELINE_ADOPTION_BLOCKED',
  'DATABASE_BASELINE_ARGUMENTS_INVALID',
  'DATABASE_BASELINE_DRIFT_CHECK_FAILED',
  'DATABASE_BASELINE_POSTCHECK_FAILED',
  'DATABASE_BASELINE_RESOLVE_FAILED',
]);

class CaptureStageError extends Error {
  constructor(
    readonly captureStage: PreviewStabilityDatabaseCaptureStage,
    readonly originalError: unknown,
  ) {
    super('preview stability capture stage failed');
    this.name = 'CaptureStageError';
  }
}

export const withCaptureStage = async <T>(
  captureStage: PreviewStabilityDatabaseCaptureStage,
  operation: () => Promise<T>,
): Promise<T> => {
  try { return await operation(); }
  catch (error: unknown) { throw new CaptureStageError(captureStage, error); }
};

export const normalizeDatabaseHelperOperation = (
  operation: string | undefined,
): PreviewStabilityDatabaseHelperOperation => {
  switch (operation) {
    case 'capture': case 'executions': case 'group-instance': case 'force-pause':
      return operation;
    default: return 'unknown';
  }
};

const safeStringProperty = (error: unknown, property: string) => {
  if (typeof error !== 'object' || error === null) return null;
  const value = Reflect.get(error, property);
  return typeof value === 'string' ? value : null;
};

const classifyDatabaseHelperError = (
  error: unknown,
): Pick<PreviewStabilityDatabaseHelperFailure, 'errorKind' | 'errorCode'> => {
  const code = safeStringProperty(error, 'code');
  const name = safeStringProperty(error, 'name');
  if (code && /^P\d{4}$/.test(code)) return { errorKind: 'PRISMA', errorCode: code };
  if (name === 'PrismaClientValidationError') return { errorKind: 'PRISMA_VALIDATION' };
  if (name === 'PrismaClientUnknownRequestError') return { errorKind: 'PRISMA_UNKNOWN' };
  if (name === 'PrismaClientInitializationError') {
    const initCode = safeStringProperty(error, 'errorCode');
    return { errorKind: 'PRISMA_INITIALIZATION', ...(initCode && /^P\d{4}$/.test(initCode) ? { errorCode: initCode } : {}) };
  }
  if (name === 'DatabaseBaselineError') {
    return { errorKind: 'DATABASE_BASELINE', ...(code && SAFE_DATABASE_BASELINE_ERROR_CODES.has(code) ? { errorCode: code } : {}) };
  }
  if (code && SAFE_SYSTEM_ERROR_CODES.has(code)) return { errorKind: 'SYSTEM', errorCode: code };
  return { errorKind: 'UNKNOWN' };
};

export const createDatabaseHelperFailureDiagnostic = (
  operation: string | undefined,
  error: unknown,
): PreviewStabilityDatabaseHelperFailure => {
  const normalizedOperation = normalizeDatabaseHelperOperation(operation);
  const staged = error instanceof CaptureStageError ? error : null;
  const migrationSubstage =
    staged?.captureStage === 'migrations' &&
    staged.originalError instanceof MigrationBaselineSubstageError
      ? staged.originalError
      : null;
  const classified = classifyDatabaseHelperError(
    migrationSubstage?.cause ?? (staged ? staged.originalError : error),
  );
  return {
    code: 'PREVIEW_STABILITY_DATABASE_HELPER_FAILED',
    operation: normalizedOperation,
    ...(normalizedOperation === 'capture' && staged ? { captureStage: staged.captureStage } : {}),
    ...(normalizedOperation === 'capture' && migrationSubstage
      ? { captureSubstage: migrationSubstage.substage }
      : {}),
    ...classified,
    failed: true,
  };
};

export const serializeDatabaseHelperSuccess = (result: unknown) => JSON.stringify(result);

export const emitDatabaseHelperFailure = (
  operation: string | undefined,
  error: unknown,
  output: { writeError(line: string): void; setExitCode(code: number): void } = {
    writeError: (line) => console.error(line),
    setExitCode: (code) => { process.exitCode = code; },
  },
) => {
  output.writeError(JSON.stringify(createDatabaseHelperFailureDiagnostic(operation, error)));
  output.setExitCode(1);
};
const executionIsStale = (
  execution: {
    status: string;
    activeKey: string | null;
    ownerId: string | null;
    heartbeatAt: Date | null;
    leaseExpiresAt: Date | null;
  },
  now: Date,
) =>
  execution.status === 'STARTED' &&
  (!execution.activeKey ||
    !execution.ownerId ||
    !execution.heartbeatAt ||
    !execution.leaseExpiresAt ||
    execution.leaseExpiresAt.getTime() <= now.getTime());

const readExecutions = async (
  prisma: ReturnType<typeof createPrismaClient>,
  now: Date,
) => {
  const executions = await prisma.commercialAutomationExecution.findMany({
    select: {
      id: true,
      bullMqJobId: true,
      status: true,
      activeKey: true,
      ownerId: true,
      heartbeatAt: true,
      leaseExpiresAt: true,
    },
    orderBy: { startedAt: 'asc' },
  });
  return executions.map((execution): PreviewExecutionEvidence => ({
    id: execution.id,
    bullMqJobId: execution.bullMqJobId,
    status: execution.status,
    stale: executionIsStale(execution, now),
  }));
};

const readMigrations = async (
  environment: NodeJS.ProcessEnv,
): Promise<PreviewStabilityEvidence['migrations']> => {
  const repositoryMigrations = listRepositoryMigrations(MIGRATIONS_DIRECTORY);
  const runtime = createBaselineRuntime({ root: ROOT, environment });
  try {
    const inspection = await runtime.inspect();
    const applied = inspection.migrationRows.filter(
      (migration) => migration.finishedAt && !migration.rolledBackAt,
    );
    const appliedNames = new Set(
      applied.map((migration) => migration.migrationName),
    );
    return {
      applied: applied.length,
      failed: inspection.migrationRows.filter(
        (migration) => !migration.finishedAt && !migration.rolledBackAt,
      ).length,
      pending: repositoryMigrations.filter((name) => !appliedNames.has(name))
        .length,
      unexpected: applied.filter(
        (migration) => !repositoryMigrations.includes(migration.migrationName),
      ).length,
      baselineRegistered: appliedNames.has(BASELINE_MIGRATION),
      schemaMatchesCurrent:
        inspection.schemaMatchesCurrent &&
        inspection.missingBaselineObjects.length === 0,
    };
  } finally {
    await runtime.close();
  }
};

const countTables = async (prisma: ReturnType<typeof createPrismaClient>) => {
  const entries = await Promise.all(
    APPLICATION_TABLES.map(async (table) => {
      const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) AS count FROM "${table}"`,
      );
      return [table, Number(rows[0]?.count ?? 0)] as const;
    }),
  );
  return Object.fromEntries(entries);
};

const captureDatabaseEvidence = async (
  environment: NodeJS.ProcessEnv,
): Promise<Omit<PreviewStabilityEvidence, 'queues'>> => {
  const prisma = createPrismaClient();
  try {
    const [
      migrations,
      settings,
      executions,
      totalRuns,
      dryRuns,
      ambiguousRuns,
      investigationRuns,
      dispatchTotal,
      processingDispatches,
      outboxTotal,
      pendingOutboxes,
      ambiguousOutboxes,
      tableCounts,
    ] = await Promise.all([
      withCaptureStage('migrations', () => readMigrations(environment)),
      withCaptureStage('settings', () =>
        prisma.commercialAutomationSettings.findUnique({
          where: { id: 'commercial-automation' },
          select: { paused: true },
        }),
      ),
      withCaptureStage('executions', () => readExecutions(prisma, new Date())),
      withCaptureStage('runs-total', () => prisma.commercialPipelineRun.count()),
      withCaptureStage('runs-dry-run', () =>
        prisma.commercialPipelineRun.count({ where: { mode: 'DRY_RUN' } }),
      ),
      withCaptureStage('runs-ambiguous', () =>
        prisma.commercialPipelineRun.count({ where: { finalStatus: 'AMBIGUOUS' } }),
      ),
      withCaptureStage('runs-investigation', () =>
        prisma.commercialPipelineRun.count({ where: { investigationRequired: true } }),
      ),
      withCaptureStage('dispatch-total', () => prisma.whatsAppDispatch.count()),
      withCaptureStage('dispatch-processing', () =>
        prisma.whatsAppDispatch.count({ where: { status: 'PROCESSING' } }),
      ),
      withCaptureStage('outbox-total', () => prisma.commercialDispatchOutbox.count()),
      withCaptureStage('outbox-pending', () =>
        prisma.commercialDispatchOutbox.count({ where: { status: 'PENDING' } }),
      ),
      withCaptureStage('outbox-ambiguous', () =>
        prisma.commercialDispatchOutbox.count({ where: { status: 'AMBIGUOUS' } }),
      ),
      withCaptureStage('table-counts', () => countTables(prisma)),
    ]);
    return {
      migrations,
      settings: {
        present: Boolean(settings),
        paused: settings?.paused ?? false,
      },
      executions,
      runs: {
        total: totalRuns,
        dryRun: dryRuns,
        ambiguous: ambiguousRuns,
        investigationRequired: investigationRuns,
      },
      dispatches: { total: dispatchTotal, processing: processingDispatches },
      outboxes: {
        total: outboxTotal,
        pending: pendingOutboxes,
        ambiguous: ambiguousOutboxes,
      },
      tableCounts,
    };
  } finally {
    await prisma.$disconnect();
  }
};

const run = async (command: string | undefined) => {
  if (command === 'capture') return captureDatabaseEvidence(process.env);

  const prisma = createPrismaClient();
  try {
    if (command === 'executions') return readExecutions(prisma, new Date());
    if (command === 'group-instance') {
      const groups = await prisma.whatsAppDestination.findMany({
        where: { type: 'GROUP', active: true, available: true },
        select: { sourceInstanceName: true, fingerprint: true },
      });
      const eligible = groups.filter(
        (group) =>
          Boolean(group.sourceInstanceName) &&
          /^grp_[a-f0-9]{12}$/.test(group.fingerprint ?? ''),
      );
      if (eligible.length !== 1 || !eligible[0].sourceInstanceName) {
        throw new Error('preview group instance is not unique');
      }
      return { instanceName: eligible[0].sourceInstanceName };
    }
    if (command === 'force-pause') {
      await prisma.commercialAutomationSettings.update({
        where: { id: 'commercial-automation' },
        data: { paused: true, pausedAt: new Date() },
      });
      return { paused: true };
    }
    throw new Error('invalid database helper command');
  } finally {
    await prisma.$disconnect();
  }
};

const currentFile = fileURLToPath(import.meta.url);
const isMainModule = Boolean(process.argv[1]) && resolve(process.argv[1]!) === currentFile;

if (isMainModule) {
  const operation = process.argv[2];
  void run(operation)
    .then((result) => console.log(serializeDatabaseHelperSuccess(result)))
    .catch((error: unknown) => emitDatabaseHelperFailure(operation, error));
}
