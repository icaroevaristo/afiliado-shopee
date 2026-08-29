import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig, type AppEnv } from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import {
  createRedisConnection,
  createWhatsAppDispatchQueue,
  enqueueControlledWhatsAppDispatch,
} from '@shopee-auto-affiliate-ai/queue';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import { createPrismaRepositories } from '../../api/src/application-services';
import { CommercialDispatchOutboxPublisher } from '../../api/src/commercial-dispatch-outbox-publisher';
import { sanitizeCommercialDispatchOutbox } from '../../api/src/commercial-dispatch-outbox-service';
import { parseLocalDotEnv } from './local-env';

const ROOT_ENV_PATH = fileURLToPath(new URL('../../../.env', import.meta.url));
export const COMMERCIAL_OUTBOX_RECONCILE_CONFIRMATION =
  '--confirm-safe-publication';

type SafeLogger = {
  info(data: Record<string, unknown>, message?: string): void;
  error(data: Record<string, unknown>, message?: string): void;
};

const consoleLogger: SafeLogger = {
  info: (data) => console.log(JSON.stringify(data)),
  error: (data) => console.error(JSON.stringify(data)),
};

const safeErrorCode = (error: unknown) =>
  error instanceof AppError ? error.code : 'COMMERCIAL_OUTBOX_OPERATION_FAILED';

export const parseCommercialOutboxArgs = (args: readonly string[]) => {
  const separators = args.filter((argument) => argument === '--').length;
  const normalized = args.filter((argument) => argument !== '--');
  if (separators > 1 || normalized[0] === undefined) {
    throw new AppError(
      'Argumentos do outbox comercial invalidos',
      'COMMERCIAL_OUTBOX_ARGUMENTS_INVALID',
    );
  }
  if (normalized[0] === 'status' && normalized.length === 1) {
    return { command: 'status' as const };
  }
  if (normalized[0] === 'reconcile' && normalized.length === 3) {
    const outboxArguments = normalized.filter((argument) =>
      argument.startsWith('--outbox-id='),
    );
    if (
      outboxArguments.length === 1 &&
      normalized.filter(
        (argument) => argument === COMMERCIAL_OUTBOX_RECONCILE_CONFIRMATION,
      ).length === 1
    ) {
      const outboxId = outboxArguments[0].slice('--outbox-id='.length);
      if (/^[A-Za-z0-9_-]{1,200}$/.test(outboxId)) {
        return { command: 'reconcile' as const, outboxId };
      }
    }
  }
  throw new AppError(
    'Argumentos do outbox comercial invalidos',
    'COMMERCIAL_OUTBOX_ARGUMENTS_INVALID',
  );
};

export const assertCommercialOutboxEnvironment = (config: AppEnv) => {
  if (config.COMMERCIAL_AUTOMATION_MODE !== 'preview') {
    throw new AppError(
      'Outbox comercial exige modo preview',
      'COMMERCIAL_OUTBOX_PREVIEW_REQUIRED',
    );
  }
  if (config.COMMERCIAL_SCHEDULER_ENABLED) {
    throw new AppError(
      'Scheduler comercial deve permanecer desligado',
      'COMMERCIAL_AUTOMATION_SCHEDULER_MUST_BE_DISABLED',
    );
  }
  if (config.SCHEDULER_ENABLED) {
    throw new AppError(
      'Scheduler legado deve permanecer desligado',
      'LEGACY_SCHEDULER_MUST_BE_DISABLED',
    );
  }
};

export type CommercialOutboxCliRuntime = {
  status(): Promise<Record<string, unknown>>;
  reconcile(outboxId: string): Promise<Record<string, unknown>>;
  close(): Promise<void>;
};

export const createCommercialOutboxCliRuntime = (
  config: AppEnv,
  logger: SafeLogger,
): CommercialOutboxCliRuntime => {
  const prisma = createPrismaClient();
  const repositories = createPrismaRepositories(prisma);
  let redis: ReturnType<typeof createRedisConnection> | undefined;
  let queue: ReturnType<typeof createWhatsAppDispatchQueue> | undefined;
  const getQueue = () => {
    redis ??= createRedisConnection(config.REDIS_URL);
    queue ??= createWhatsAppDispatchQueue(redis);
    return queue;
  };

  return {
    async status() {
      const result = await repositories.commercialDispatchOutboxes.list({
        page: 1,
        limit: 100,
      });
      return {
        total: result.total,
        items: result.items.map(sanitizeCommercialDispatchOutbox),
      };
    },
    async reconcile(outboxId) {
      const whatsappQueue = getQueue();
      const [workers, activeJobs] = await Promise.all([
        whatsappQueue.getWorkers(),
        whatsappQueue.getActiveCount(),
      ]);
      if (workers.length > 0 || activeJobs > 0) {
        throw new AppError(
          'Ha worker de dispatch ativo',
          'COMMERCIAL_OUTBOX_ACTIVE_WORKER_BLOCKED',
        );
      }
      const publisher = new CommercialDispatchOutboxPublisher({
        outboxes: repositories.commercialDispatchOutboxes,
        queue: {
          hasJob: async (jobId) => Boolean(await whatsappQueue.getJob(jobId)),
          getJob: async (jobId) => {
            const job = await whatsappQueue.getJob(jobId);
            if (!job || typeof job.data !== 'object' || job.data === null) {
              return null;
            }
            const data = job.data as {
              dispatchId?: unknown;
              instanceName?: unknown;
            };
            if (typeof data.dispatchId !== 'string') return null;
            return {
              id: String(job.id ?? jobId),
              dispatchId: data.dispatchId,
              ...(typeof data.instanceName === 'string'
                ? { instanceName: data.instanceName }
                : {}),
            };
          },
          enqueue: async (dispatchId, jobId, instanceName) => {
            await enqueueControlledWhatsAppDispatch(
              whatsappQueue,
              { dispatchId, ...(instanceName ? { instanceName } : {}) },
              jobId,
            );
          },
        },
        logger,
      });
      return sanitizeCommercialDispatchOutbox(
        await publisher.publish(outboxId),
      );
    },
    async close() {
      await Promise.allSettled([
        queue?.close() ?? Promise.resolve(),
        redis?.quit().then(() => undefined) ?? Promise.resolve(),
        prisma.$disconnect(),
      ]);
    },
  };
};

export const runCommercialOutboxCli = async ({
  args = process.argv.slice(2),
  env = process.env,
  envPath = ROOT_ENV_PATH,
  logger = consoleLogger,
  runtimeFactory = createCommercialOutboxCliRuntime,
}: {
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  envPath?: string;
  logger?: SafeLogger;
  runtimeFactory?: (
    config: AppEnv,
    logger: SafeLogger,
  ) => CommercialOutboxCliRuntime;
} = {}) => {
  let runtime: CommercialOutboxCliRuntime | undefined;
  try {
    const command = parseCommercialOutboxArgs(args);
    const fileEnv = existsSync(envPath)
      ? parseLocalDotEnv(readFileSync(envPath, 'utf8'))
      : {};
    const config = loadConfig({ ...fileEnv, ...env });
    if (command.command === 'reconcile') {
      assertCommercialOutboxEnvironment(config);
    }
    process.env.DATABASE_URL ??= config.DATABASE_URL;
    runtime = runtimeFactory(config, logger);
    const result =
      command.command === 'status'
        ? await runtime.status()
        : await runtime.reconcile(command.outboxId);
    logger.info({
      event: `commercial-outbox.${command.command}.completed`,
      result,
    });
    return { exitCode: 0, result };
  } catch (error) {
    const result = {
      code: safeErrorCode(error),
      message:
        error instanceof AppError
          ? error.message
          : 'Operacao do outbox comercial falhou com seguranca',
    };
    logger.error({ event: 'commercial-outbox.operation.failed', ...result });
    return { exitCode: 1, result };
  } finally {
    await runtime?.close();
  }
};

const isDirectExecution =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  void runCommercialOutboxCli().then(({ exitCode }) => {
    process.exitCode = exitCode;
  });
}
