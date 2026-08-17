import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, win32 } from 'node:path';
import { spawn } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

export const BASELINE_MIGRATION = '0_legacy_baseline';
export const BASELINE_CONFIRMATION = '--confirm-existing-database';

export const APPLICATION_TABLES = [
  'ProductLead',
  'GeneratedCopy',
  'WhatsAppDestination',
  'WhatsAppDispatch',
  'Coupon',
  'CommercialPipelineRun',
  'CommercialDispatchOutbox',
  'CommercialAutomationSettings',
  'CommercialAutomationExecution',
  'CommercialOfferSnapshot',
  'CommercialNiche',
  'CommercialGroupCampaign',
  'CommercialPromotionCandidate',
] as const;

const BASELINE_COLUMNS = {
  ProductLead: [
    'id',
    'providerProductId',
    'nome',
    'categoria',
    'preco',
    'desconto',
    'nota',
    'vendidos',
    'comissao',
    'loja',
    'urlImagem',
    'url',
    'title',
    'score',
    'scoreUpdatedAt',
    'createdAt',
    'updatedAt',
  ],
  GeneratedCopy: [
    'id',
    'productId',
    'titulo',
    'mensagem',
    'cta',
    'hashtags',
    'createdAt',
  ],
} as const;

const BASELINE_SURVIVING_CONSTRAINTS = [
  'ProductLead_pkey',
  'GeneratedCopy_pkey',
  'GeneratedCopy_productId_fkey',
] as const;
const BASELINE_SURVIVING_INDEXES = ['GeneratedCopy_productId_idx'] as const;

const parseDatabaseDotEnv = (contents: string): NodeJS.ProcessEnv => {
  const parsed: NodeJS.ProcessEnv = {};
  for (const rawLine of contents.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      line,
    );
    if (!match || match[1] !== 'DATABASE_URL') continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    parsed.DATABASE_URL = value;
  }
  return parsed;
};

export class DatabaseBaselineError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'DatabaseBaselineError';
  }
}

export type MigrationBaselineSubstage = 'inspect' | 'diff';

export class MigrationBaselineSubstageError extends Error {
  declare readonly cause: unknown;

  constructor(
    readonly substage: MigrationBaselineSubstage,
    cause: unknown,
  ) {
    super('migration baseline substage failed');
    this.name = 'MigrationBaselineSubstageError';
    Object.defineProperty(this, 'cause', {
      value: cause,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
}

export type MigrationRecord = {
  migrationName: string;
  checksum: string;
  finishedAt: Date | null;
  rolledBackAt: Date | null;
};

export type DatabaseInspection = {
  migrationRows: MigrationRecord[];
  applicationTables: string[];
  missingBaselineObjects: string[];
  schemaMatchesCurrent: boolean;
};

export type BaselineStatus = {
  baselinePresentInRepository: boolean;
  baselineRegistered: boolean;
  baselinePending: boolean;
  appliedMigrationCount: number;
  failedMigrations: string[];
  database: 'empty' | 'existing';
  readyForAdoption: boolean;
};

export type ProtectionSnapshot = {
  migrationRowCount: number;
  appliedMigrations: Record<string, string>;
  dataCounts: Record<string, string>;
  schemaFingerprint: string;
};

export type BaselineRuntime = {
  inspect(): Promise<DatabaseInspection>;
  captureProtectionSnapshot(
    inspection?: DatabaseInspection,
  ): Promise<ProtectionSnapshot>;
  markBaselineApplied(): Promise<void>;
  close(): Promise<void>;
};

const successfulMigrations = (inspection: DatabaseInspection) =>
  inspection.migrationRows.filter(
    (migration) => migration.finishedAt && !migration.rolledBackAt,
  );

const failedMigrationNames = (inspection: DatabaseInspection) =>
  inspection.migrationRows
    .filter((migration) => !migration.finishedAt && !migration.rolledBackAt)
    .map((migration) => migration.migrationName)
    .sort();

export const evaluateBaselineStatus = (
  repositoryMigrations: readonly string[],
  inspection: DatabaseInspection,
): BaselineStatus => {
  const baselinePresentInRepository =
    repositoryMigrations[0] === BASELINE_MIGRATION;
  const applied = new Set(
    successfulMigrations(inspection).map(
      (migration) => migration.migrationName,
    ),
  );
  const baselineRegistered = applied.has(BASELINE_MIGRATION);
  const posteriorMigrations = repositoryMigrations.filter(
    (migration) => migration !== BASELINE_MIGRATION,
  );
  const pendingPosterior = posteriorMigrations.filter(
    (migration) => !applied.has(migration),
  );
  const unexpectedApplied = [...applied].filter(
    (migration) => !repositoryMigrations.includes(migration),
  );
  const failedMigrations = failedMigrationNames(inspection);
  const database =
    inspection.applicationTables.length === 0 ? 'empty' : 'existing';
  return {
    baselinePresentInRepository,
    baselineRegistered,
    baselinePending: baselinePresentInRepository && !baselineRegistered,
    appliedMigrationCount: applied.size,
    failedMigrations,
    database,
    readyForAdoption:
      baselinePresentInRepository &&
      !baselineRegistered &&
      database === 'existing' &&
      failedMigrations.length === 0 &&
      pendingPosterior.length === 0 &&
      unexpectedApplied.length === 0 &&
      inspection.missingBaselineObjects.length === 0 &&
      inspection.schemaMatchesCurrent,
  };
};

export const parseBaselineArgs = (args: readonly string[]) => {
  const separators = args.filter((argument) => argument === '--').length;
  const normalized = args.filter((argument) => argument !== '--');
  if (separators > 1) {
    throw new DatabaseBaselineError(
      'Argumentos da baseline invalidos',
      'DATABASE_BASELINE_ARGUMENTS_INVALID',
    );
  }
  if (normalized.length === 1 && normalized[0] === 'status') {
    return { command: 'status' as const };
  }
  if (
    normalized.length === 2 &&
    normalized[0] === 'adopt' &&
    normalized[1] === BASELINE_CONFIRMATION
  ) {
    return { command: 'adopt' as const };
  }
  throw new DatabaseBaselineError(
    'Argumentos da baseline invalidos',
    'DATABASE_BASELINE_ARGUMENTS_INVALID',
  );
};

export const listRepositoryMigrations = (migrationsDirectory: string) =>
  readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(resolve(migrationsDirectory, entry.name, 'migration.sql')),
    )
    .map((entry) => entry.name)
    .sort();

const sameRecord = (
  left: Record<string, string>,
  right: Record<string, string>,
) =>
  Object.keys(left).length === Object.keys(right).length &&
  Object.entries(left).every(([key, value]) => right[key] === value);

export const adoptBaseline = async (
  repositoryMigrations: readonly string[],
  runtime: BaselineRuntime,
) => {
  const inspection = await runtime.inspect();
  const status = evaluateBaselineStatus(repositoryMigrations, inspection);
  if (status.baselineRegistered) {
    if (status.failedMigrations.length > 0) {
      throw new DatabaseBaselineError(
        'Banco com baseline registrada possui divergencias',
        'DATABASE_BASELINE_ADOPTION_BLOCKED',
      );
    }
    const statusWithoutBaseline = evaluateBaselineStatus(repositoryMigrations, {
      ...inspection,
      migrationRows: inspection.migrationRows.filter(
        (migration) => migration.migrationName !== BASELINE_MIGRATION,
      ),
    });
    if (!statusWithoutBaseline.readyForAdoption) {
      throw new DatabaseBaselineError(
        'Banco com baseline registrada possui divergencias',
        'DATABASE_BASELINE_ADOPTION_BLOCKED',
      );
    }
    return { adopted: false, alreadyRegistered: true, dataPreserved: true };
  }
  if (!status.readyForAdoption) {
    throw new DatabaseBaselineError(
      'Banco existente nao esta pronto para adocao segura da baseline',
      'DATABASE_BASELINE_ADOPTION_BLOCKED',
    );
  }

  const before = await runtime.captureProtectionSnapshot(inspection);
  await runtime.markBaselineApplied();
  const afterInspection = await runtime.inspect();
  const afterStatus = evaluateBaselineStatus(
    repositoryMigrations,
    afterInspection,
  );
  const after = await runtime.captureProtectionSnapshot(afterInspection);
  const beforePosterior = { ...before.appliedMigrations };
  delete beforePosterior[BASELINE_MIGRATION];
  const afterPosterior = { ...after.appliedMigrations };
  delete afterPosterior[BASELINE_MIGRATION];
  if (
    !afterStatus.baselineRegistered ||
    after.migrationRowCount !== before.migrationRowCount + 1 ||
    !sameRecord(beforePosterior, afterPosterior) ||
    !sameRecord(before.dataCounts, after.dataCounts) ||
    before.schemaFingerprint !== after.schemaFingerprint
  ) {
    throw new DatabaseBaselineError(
      'A verificacao posterior da baseline encontrou divergencia',
      'DATABASE_BASELINE_POSTCHECK_FAILED',
    );
  }
  return { adopted: true, alreadyRegistered: false, dataPreserved: true };
};

const safeMigrationName = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value)
    ? value
    : 'invalid-migration-name';

const catalogFingerprint = async (prisma: PrismaClient) => {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT 'column' AS kind, table_name AS parent, column_name AS name,
           concat_ws('|', data_type, udt_schema, udt_name, is_nullable,
                     coalesce(column_default, '')) AS detail
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = ANY (ARRAY[${APPLICATION_TABLES.map((table) => `'${table}'`).join(',')}])
    UNION ALL
    SELECT 'constraint' AS kind, cls.relname AS parent, con.conname AS name,
           pg_get_constraintdef(con.oid) AS detail
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    WHERE ns.nspname = current_schema()
      AND cls.relname = ANY (ARRAY[${APPLICATION_TABLES.map((table) => `'${table}'`).join(',')}])
    UNION ALL
    SELECT 'index' AS kind, tablename AS parent, indexname AS name, indexdef AS detail
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = ANY (ARRAY[${APPLICATION_TABLES.map((table) => `'${table}'`).join(',')}])
    UNION ALL
    SELECT 'enum' AS kind, typ.typname AS parent, enum.enumlabel AS name,
           enum.enumsortorder::text AS detail
    FROM pg_type typ
    JOIN pg_enum enum ON enum.enumtypid = typ.oid
    JOIN pg_namespace ns ON ns.oid = typ.typnamespace
    WHERE ns.nspname = current_schema()
    ORDER BY kind, parent, name, detail
  `);
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
};

const missingBaselineObjects = async (
  prisma: PrismaClient,
  applicationTables: readonly string[],
) => {
  const missing: string[] = [];
  const tableSet = new Set(applicationTables);
  for (const [table, columns] of Object.entries(BASELINE_COLUMNS)) {
    if (!tableSet.has(table)) {
      missing.push(`table:${table}`);
      continue;
    }
    const rows = await prisma.$queryRawUnsafe<Array<{ columnName: string }>>(
      `SELECT column_name AS "columnName" FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`,
    );
    const present = new Set(rows.map((row) => row.columnName));
    for (const column of columns) {
      if (!present.has(column)) missing.push(`column:${table}.${column}`);
    }
  }
  const constraintRows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`
    SELECT con.conname AS name
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    WHERE ns.nspname = current_schema()
      AND con.conname = ANY (ARRAY[${BASELINE_SURVIVING_CONSTRAINTS.map((name) => `'${name}'`).join(',')}])
  `);
  const constraints = new Set(constraintRows.map((row) => row.name));
  for (const constraint of BASELINE_SURVIVING_CONSTRAINTS) {
    if (!constraints.has(constraint)) missing.push(`constraint:${constraint}`);
  }
  const indexRows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`
    SELECT indexname AS name FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = ANY (ARRAY[${BASELINE_SURVIVING_INDEXES.map((name) => `'${name}'`).join(',')}])
  `);
  const indexes = new Set(indexRows.map((row) => row.name));
  for (const index of BASELINE_SURVIVING_INDEXES) {
    if (!indexes.has(index)) missing.push(`index:${index}`);
  }
  return missing.sort();
};

const inspectWithPrisma = async (
  prisma: PrismaClient,
): Promise<DatabaseInspection> => {
  const migrationTable = await prisma.$queryRawUnsafe<
    Array<{ present: boolean }>
  >(`SELECT to_regclass('"_prisma_migrations"') IS NOT NULL AS present`);
  const migrationTableExists = migrationTable[0]?.present === true;
  const migrationRows = migrationTableExists
    ? await prisma.$queryRawUnsafe<
        Array<{
          migrationName: string;
          checksum: string;
          finishedAt: Date | null;
          rolledBackAt: Date | null;
        }>
      >(`
        SELECT migration_name AS "migrationName", checksum,
               finished_at AS "finishedAt", rolled_back_at AS "rolledBackAt"
        FROM "_prisma_migrations"
        ORDER BY started_at, id
      `)
    : [];
  const tableRows = await prisma.$queryRawUnsafe<Array<{ tableName: string }>>(`
    SELECT tablename AS "tableName"
    FROM pg_tables
    WHERE schemaname = current_schema()
      AND tablename = ANY (ARRAY[${APPLICATION_TABLES.map((table) => `'${table}'`).join(',')}])
    ORDER BY tablename
  `);
  const applicationTables = tableRows.map((row) => row.tableName);
  return {
    migrationRows: migrationRows.map((migration) => ({
      ...migration,
      migrationName: safeMigrationName(migration.migrationName),
    })),
    applicationTables,
    missingBaselineObjects: await missingBaselineObjects(
      prisma,
      applicationTables,
    ),
    schemaMatchesCurrent: true,
  };
};

type CommandResult = { code: number; stdout: string; stderr: string };

type CommandOutputStream = {
  setEncoding(encoding: 'utf8'): void;
  on(event: 'data', listener: (chunk: string) => void): void;
};

type SanitizedChildProcess = {
  stdout: CommandOutputStream;
  stderr: CommandOutputStream;
  once(event: 'error', listener: (error: Error) => void): void;
  once(event: 'close', listener: (code: number | null) => void): void;
};

type SpawnCommand = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    shell: false;
    windowsHide: true;
    stdio: ['ignore', 'pipe', 'pipe'];
  },
) => SanitizedChildProcess;

const spawnCommand: SpawnCommand = (command, args, options) =>
  spawn(command, args, options);

export const runSanitizedCommand = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
  spawnProcess: SpawnCommand = spawnCommand,
): Promise<CommandResult> =>
  new Promise((resolveCommand, reject) => {
    const child = spawnProcess(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < 100_000) stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 100_000) stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) =>
      resolveCommand({ code: code ?? 1, stdout, stderr }),
    );
  });

type PrismaCommandDependencies = {
  platform: NodeJS.Platform;
  execPath: string;
  fileExists: (path: string) => boolean;
};

const defaultPrismaCommandDependencies: PrismaCommandDependencies = {
  platform: process.platform,
  execPath: process.execPath,
  fileExists: existsSync,
};

const resolveWindowsPnpmEntrypoint = (
  environment: NodeJS.ProcessEnv,
  dependencies: PrismaCommandDependencies,
) => {
  const pathValue =
    environment.Path ??
    environment.PATH ??
    process.env.Path ??
    process.env.PATH ??
    '';
  for (const pathEntry of pathValue.split(win32.delimiter)) {
    if (!pathEntry) continue;
    const pnpmCommand = win32.resolve(pathEntry, 'pnpm.cmd');
    const pnpmEntrypoint = win32.resolve(
      pathEntry,
      'node_modules/pnpm/bin/pnpm.cjs',
    );
    if (
      dependencies.fileExists(pnpmCommand) &&
      dependencies.fileExists(pnpmEntrypoint)
    ) {
      return pnpmEntrypoint;
    }
  }
  throw new DatabaseBaselineError(
    'pnpm nao esta disponivel para validar o migration diff',
    'DATABASE_BASELINE_DRIFT_CHECK_FAILED',
  );
};

export const runPrismaCommand = (
  args: readonly string[],
  options: { root: string; environment: NodeJS.ProcessEnv },
  commandRunner: typeof runSanitizedCommand = runSanitizedCommand,
  dependencies: PrismaCommandDependencies = defaultPrismaCommandDependencies,
) => {
  const pnpmArgs = [
    '--filter',
    '@shopee-auto-affiliate-ai/database',
    'exec',
    'prisma',
    ...args,
  ];
  return dependencies.platform === 'win32'
    ? commandRunner(
        dependencies.execPath,
        [
          resolveWindowsPnpmEntrypoint(options.environment, dependencies),
          ...pnpmArgs,
        ],
        { cwd: options.root, env: options.environment },
      )
    : commandRunner('pnpm', pnpmArgs, {
        cwd: options.root,
        env: options.environment,
      });
};

export const loadDatabaseEnvironment = (
  root: string,
  environment: NodeJS.ProcessEnv = process.env,
) => {
  const envPath = resolve(root, '.env');
  const fileEnvironment = existsSync(envPath)
    ? parseDatabaseDotEnv(readFileSync(envPath, 'utf8'))
    : {};
  const merged = { ...fileEnvironment, ...environment };
  const databaseUrl = merged.DATABASE_URL;
  if (!databaseUrl) {
    throw new DatabaseBaselineError(
      'DATABASE_URL nao configurada',
      'DATABASE_URL_REQUIRED',
    );
  }
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
      throw new Error('invalid protocol');
    }
  } catch {
    throw new DatabaseBaselineError(
      'DATABASE_URL invalida',
      'DATABASE_URL_INVALID',
    );
  }
  return { ...merged, DATABASE_URL: databaseUrl };
};

export const createBaselineRuntime = ({
  root,
  environment,
  commandRunner = runSanitizedCommand,
  commandDependencies = defaultPrismaCommandDependencies,
}: {
  root: string;
  environment: NodeJS.ProcessEnv;
  commandRunner?: typeof runSanitizedCommand;
  commandDependencies?: PrismaCommandDependencies;
}): BaselineRuntime => {
  const prisma = new PrismaClient({
    datasources: { db: { url: environment.DATABASE_URL } },
  });
  const inspect = async () => {
    const [inspection, drift] = await Promise.all([
      inspectWithPrisma(prisma).catch((error: unknown) => {
        throw new MigrationBaselineSubstageError('inspect', error);
      }),
      runPrismaCommand(
        [
          'migrate',
          'diff',
          '--from-schema-datasource',
          'prisma/schema.prisma',
          '--to-schema-datamodel',
          'prisma/schema.prisma',
          '--exit-code',
        ],
        { root, environment },
        commandRunner,
        commandDependencies,
      ).catch((error: unknown) => {
        throw new MigrationBaselineSubstageError('diff', error);
      }),
    ]);
    if (drift.code !== 0 && drift.code !== 2) {
      throw new MigrationBaselineSubstageError(
        'diff',
        new DatabaseBaselineError(
          'Nao foi possivel validar drift do banco existente',
          'DATABASE_BASELINE_DRIFT_CHECK_FAILED',
        ),
      );
    }
    return { ...inspection, schemaMatchesCurrent: drift.code === 0 };
  };
  return {
    inspect,
    async captureProtectionSnapshot(existingInspection) {
      const inspection = existingInspection ?? (await inspect());
      const countedTables = APPLICATION_TABLES.filter((table) =>
        inspection.applicationTables.includes(table),
      );
      const countEntries = await Promise.all(
        countedTables.map(async (table) => {
          const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
            `SELECT COUNT(*) AS count FROM "${table}"`,
          );
          return [table, String(rows[0]?.count ?? 0)] as const;
        }),
      );
      return {
        migrationRowCount: inspection.migrationRows.length,
        appliedMigrations: Object.fromEntries(
          successfulMigrations(inspection).map((migration) => [
            migration.migrationName,
            migration.checksum,
          ]),
        ),
        dataCounts: Object.fromEntries(countEntries),
        schemaFingerprint: await catalogFingerprint(prisma),
      };
    },
    async markBaselineApplied() {
      const result = await runPrismaCommand(
        [
          'migrate',
          'resolve',
          '--applied',
          BASELINE_MIGRATION,
          '--schema',
          'prisma/schema.prisma',
        ],
        { root, environment },
        commandRunner,
        commandDependencies,
      );
      if (result.code !== 0) {
        throw new DatabaseBaselineError(
          'Prisma nao conseguiu registrar a baseline',
          'DATABASE_BASELINE_RESOLVE_FAILED',
        );
      }
    },
    close: () => prisma.$disconnect(),
  };
};
