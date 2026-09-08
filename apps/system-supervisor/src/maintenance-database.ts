import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import { LocalSystemError } from './types';

export type MaintenanceDatabaseSnapshot = {
  systemIdentifier: string;
  database: string;
  schema: string;
  paused: boolean | null;
  otherSessions: number;
  pending: string[];
};
export type MaintenanceDatabaseReader = (
  root: string,
  databaseUrl: string,
) => Promise<MaintenanceDatabaseSnapshot>;

export const assertMaintenanceDatabaseUrl = (
  value: string | undefined,
  port: number,
) => {
  try {
    const url = new URL(value ?? '');
    if (
      !['postgresql:', 'postgres:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      Number(url.port || '5432') !== port ||
      url.pathname !== '/shopee_auto_affiliate_ai' ||
      (url.searchParams.get('schema') ?? 'public') !== 'public' ||
      [...url.searchParams.keys()].some((key) => key !== 'schema')
    )
      throw new Error();
    return url.toString();
  } catch {
    throw new LocalSystemError(
      'Identidade de banco local invalida',
      'SYSTEM_MAINTENANCE_DATABASE_IDENTITY',
    );
  }
};

export const readMaintenanceDatabase: MaintenanceDatabaseReader = async (
  root,
  databaseUrl,
) => {
  const client = createPrismaClient(databaseUrl);
  try {
    return await client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const control = await tx.$queryRaw<Array<{ identifier: string }>>`
        SELECT system_identifier::text AS identifier FROM pg_control_system()`;
        const identity = await tx.$queryRaw<
          Array<{ database: string; schema: string }>
        >`
        SELECT current_database() AS database, current_schema() AS schema`;
        const settings = await tx.$queryRaw<Array<{ paused: boolean }>>`
        SELECT "paused" FROM public."CommercialAutomationSettings" WHERE id = 'commercial-automation'`;
        const activity = await tx.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::integer AS count FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()`;
        const history = await tx.$queryRaw<
          Array<{
            migration_name: string;
            checksum: string;
            finished_at: Date | null;
            rolled_back_at: Date | null;
          }>
        >`SELECT migration_name, checksum, finished_at, rolled_back_at
          FROM public._prisma_migrations ORDER BY started_at, migration_name`;
        const directory = resolve(root, 'packages/database/prisma/migrations');
        const names = readdirSync(directory, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort();
        const applied = new Set<string>();
        for (const row of history) {
          if (
            !names.includes(row.migration_name) ||
            (!row.finished_at && !row.rolled_back_at)
          ) {
            throw new Error('history');
          }
          if (row.rolled_back_at) continue;
          if (applied.has(row.migration_name)) throw new Error('duplicate');
          const sql = readFileSync(
            resolve(directory, row.migration_name, 'migration.sql'),
            'utf8',
          );
          const lf = sql.replace(/\r\n/g, '\n');
          const hashes = [sql, lf, lf.replace(/\n/g, '\r\n')].map((text) =>
            createHash('sha256').update(text).digest('hex'),
          );
          if (!hashes.includes(row.checksum)) throw new Error('checksum');
          applied.add(row.migration_name);
        }
        if (
          control.length !== 1 ||
          identity.length !== 1 ||
          activity.length !== 1
        )
          throw new Error('identity');
        return {
          systemIdentifier: control[0].identifier,
          database: identity[0].database,
          schema: identity[0].schema,
          paused:
            settings.length === 1 && typeof settings[0].paused === 'boolean'
              ? settings[0].paused
              : null,
          otherSessions: activity[0].count,
          pending: names.filter((name) => !applied.has(name)),
        };
      },
      { timeout: 15_000 },
    );
  } catch {
    throw new LocalSystemError(
      'Leitura de pausa, identidade ou historico indisponivel/inconsistente',
      'SYSTEM_MAINTENANCE_DATABASE_PRECHECK',
    );
  } finally {
    await client.$disconnect();
  }
};
