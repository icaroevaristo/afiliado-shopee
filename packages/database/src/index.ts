import { PrismaClient } from '@prisma/client';
export const createPrismaClient = (databaseUrl?: string) =>
  new PrismaClient(
    databaseUrl
      ? {
          datasources: {
            db: {
              url: databaseUrl,
            },
          },
        }
      : undefined,
  );
export type DatabaseClient = ReturnType<typeof createPrismaClient>;

export {
  APPLICATION_TABLES,
  BASELINE_MIGRATION,
  createBaselineRuntime,
  listRepositoryMigrations,
  MigrationBaselineSubstageError,
} from './migration-baseline.js';
