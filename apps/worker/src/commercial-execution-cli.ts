import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig, type AppEnv } from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import {
  createRedisConnection,
  createWhatsAppDispatchQueue,
} from '@shopee-auto-affiliate-ai/queue';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import { createPrismaRepositories } from '../../api/src/application-services';
import { CommercialAutomationExecutionRecoveryService } from '../../api/src/commercial-automation-execution-recovery-service';
import { CommercialAutomationExecutionService } from '../../api/src/commercial-automation-execution-service';
import { parseLocalDotEnv } from './local-env';

const ROOT_ENV_PATH = fileURLToPath(new URL('../../../.env', import.meta.url));
export const COMMERCIAL_EXECUTION_RECOVERY_CONFIRMATION =
  '--confirm-stale-recovery';

type SafeLogger = {
  info(data: Record<string, unknown>, message?: string): void;
  error(data: Record<string, unknown>, message?: string): void;
};

const consoleLogger: SafeLogger = {
  info: (data) => console.log(JSON.stringify(data)),
  error: (data) => console.error(JSON.stringify(data)),
};

const safeErrorCode = (error: unknown) =>
  error instanceof AppError
    ? error.code
    : 'COMMERCIAL_EXECUTION_OPERATION_FAILED';

export const parseCommercialExecutionArgs = (args: readonly string[]) => {
  const separators = args.filter((argument) => argument === '--').length;
  const normalized = args.filter((argument) => argument !== '--');
  if (separators > 1 || normalized[0] === undefined) {
    throw new AppError(
      'Argumentos da execucao comercial invalidos',
      'COMMERCIAL_EXECUTION_ARGUMENTS_INVALID',
    );
  }
  if (normalized[0] === 'status' && normalized.length === 1) {
    return { command: 'status' as const };
  }
  if (normalized[0] === 'recover' && normalized.length === 3) {
    const executionArguments = normalized.filter((argument) =>
      argument.startsWith('--execution-id='),
    );
    const confirmations = normalized.filter(
      (argument) => argument === COMMERCIAL_EXECUTION_RECOVERY_CONFIRMATION,
    );
    if (executionArguments.length === 1 && confirmations.length === 1) {
      const executionId = executionArguments[0].slice('--execution-id='.length);
      if (/^[A-Za-z0-9_-]{1,200}$/.test(executionId)) {
        return { command: 'recover' as const, executionId };
      }
    }
  }
  throw new AppError(
    'Argumentos da execucao comercial invalidos',
    'COMMERCIAL_EXECUTION_ARGUMENTS_INVALID',
  );
};

export const assertCommercialExecutionRecoveryEnvironment = (
  config: AppEnv,
) => {
  if (config.COMMERCIAL_AUTOMATION_MODE !== 'preview') {
    throw new AppError(
      'Recuperacao comercial exige modo preview',
      'COMMERCIAL_EXECUTION_PREVIEW_REQUIRED',
    );
  }
  if (config.COMMERCIAL_AUTOMATION_ENABLED) {
    throw new AppError(
      'Automacao comercial deve permanecer desabilitada',
      'COMMERCIAL_AUTOMATION_MUST_BE_DISABLED',
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

export const assertCommercialExecutionRecoveryPaused = (
  paused: boolean | undefined,
) => {
  if (!paused) {
    throw new AppError(
      'Automacao comercial deve permanecer pausada',
      'COMMERCIAL_AUTOMATION_PAUSED_REQUIRED',
    );
  }
};

export type CommercialExecutionCliRuntime = {
  status(): Promise<Record<string, unknown>>;
  recover(executionId: string): Promise<Record<string, unknown>>;
  close(): Promise<void>;
};

export const createCommercialExecutionCliRuntime = (
  config: AppEnv,
): CommercialExecutionCliRuntime => {
  const prisma = createPrismaClient();
  const repositories = createPrismaRepositories(prisma);
  const executionService = new CommercialAutomationExecutionService(
    repositories.commercialAutomationExecutions,
  );
  let redis: ReturnType<typeof createRedisConnection> | undefined;
  let queue: ReturnType<typeof createWhatsAppDispatchQueue> | undefined;
  const recoveryService = new CommercialAutomationExecutionRecoveryService({
    executions: repositories.commercialAutomationExecutions,
    instances: repositories.whatsappInstances,
    resolveMinimumIntervalMinutes: async () => {
      const settings = await repositories.commercialAutomationSettings.get();
      return (
        settings?.minimumIntervalMinutes ??
        config.COMMERCIAL_MIN_INTERVAL_MINUTES
      );
    },
    jobs: {
      async findJob(jobId) {
        redis ??= createRedisConnection(config.REDIS_URL);
        queue ??= createWhatsAppDispatchQueue(redis);
        const job = await queue.getJob(jobId);
        return job
          ? {
              id: job.id ?? jobId,
              dispatchId: job.data.dispatchId,
              instanceName: job.data.instanceName ?? null,
            }
          : null;
      },
    },
  });

  return {
    async status() {
      return executionService.list({ page: 1, limit: 100 });
    },
    async recover(executionId) {
      const settings = await repositories.commercialAutomationSettings.get();
      assertCommercialExecutionRecoveryPaused(settings?.paused);
      return recoveryService.recover(executionId);
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

export const runCommercialExecutionCli = async ({
  args = process.argv.slice(2),
  env = process.env,
  envPath = ROOT_ENV_PATH,
  logger = consoleLogger,
  runtimeFactory = createCommercialExecutionCliRuntime,
}: {
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  envPath?: string;
  logger?: SafeLogger;
  runtimeFactory?: (config: AppEnv) => CommercialExecutionCliRuntime;
} = {}) => {
  let runtime: CommercialExecutionCliRuntime | undefined;
  try {
    const command = parseCommercialExecutionArgs(args);
    const fileEnv = existsSync(envPath)
      ? parseLocalDotEnv(readFileSync(envPath, 'utf8'))
      : {};
    const config = loadConfig({ ...fileEnv, ...env });
    if (command.command === 'recover') {
      assertCommercialExecutionRecoveryEnvironment(config);
    }
    process.env.DATABASE_URL ??= config.DATABASE_URL;
    runtime = runtimeFactory(config);
    const result =
      command.command === 'status'
        ? await runtime.status()
        : await runtime.recover(command.executionId);
    logger.info({
      event: `commercial-execution.${command.command}.completed`,
      result,
    });
    return { exitCode: 0, result };
  } catch (error) {
    const result = {
      code: safeErrorCode(error),
      message:
        error instanceof AppError
          ? error.message
          : 'Operacao da execucao comercial falhou com seguranca',
    };
    logger.error({ event: 'commercial-execution.operation.failed', ...result });
    return { exitCode: 1, result };
  } finally {
    await runtime?.close();
  }
};

const isDirectExecution =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  void runCommercialExecutionCli().then(({ exitCode }) => {
    process.exitCode = exitCode;
  });
}
