import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { QueueEvents } from 'bullmq';
import { loadConfig, type AppEnv } from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import { createWhatsAppProvider } from '@shopee-auto-affiliate-ai/providers';
import {
  createProductPipelineQueue,
  createRedisConnection,
  createWhatsAppDispatchQueue,
  enqueueControlledWhatsAppDispatch,
  QUEUE_NAMES,
} from '@shopee-auto-affiliate-ai/queue';

import {
  createCommercialPipelineConfirmationService,
  createPrismaRepositories,
} from '../../api/src/application-services';
import {
  COMMERCIAL_CONFIRMATION_TOKEN,
  commercialConfirmationIds,
} from '../../api/src/commercial-pipeline-confirmation-service';
import { sanitizeCommercialPipelineRun } from '../../api/src/commercial-pipeline-service';
import { WhatsAppGroupSendPolicy } from '../../api/src/whatsapp-group-send-policy';
import { createWhatsAppDispatchWorker } from './whatsapp-dispatch-worker';
import { parseLocalDotEnv } from './local-env';

export const COMMERCIAL_CONFIRM_REAL_FLAG =
  '--confirm-one-real-commercial-message';
const ROOT_ENV_PATH = fileURLToPath(new URL('../../../.env', import.meta.url));
const JOB_TIMEOUT_MS = 30_000;

type SafeLogger = {
  info(data: Record<string, unknown>): void;
  error(data: Record<string, unknown>): void;
};

const consoleLogger: SafeLogger = {
  info: (data) => console.log(JSON.stringify(data)),
  error: (data) => console.error(JSON.stringify(data)),
};

class CommercialConfirmError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

const publicError = (error: unknown) => {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
      ? error.code
      : 'COMMERCIAL_DISPATCH_FAILED';
  return {
    code,
    message:
      error instanceof Error
        ? error.message
        : 'Confirmacao comercial bloqueada com seguranca',
  };
};

const isCiActive = (value: string | undefined) =>
  value !== undefined &&
  value.trim() !== '' &&
  value.trim().toLowerCase() !== 'false';

export const parseCommercialConfirmArgs = (args: readonly string[]) => {
  const separators = args.filter((argument) => argument === '--').length;
  const normalized = args.filter((argument) => argument !== '--');
  if (separators > 1 || normalized.length !== 2) {
    throw new CommercialConfirmError(
      'Flags da confirmacao comercial sao invalidas',
      'COMMERCIAL_CONFIRM_FLAGS_INVALID',
    );
  }
  const runArguments = normalized.filter((argument) =>
    argument.startsWith('--run-id='),
  );
  if (
    runArguments.length !== 1 ||
    normalized.filter((argument) => argument === COMMERCIAL_CONFIRM_REAL_FLAG)
      .length !== 1
  ) {
    throw new CommercialConfirmError(
      'Flags da confirmacao comercial sao invalidas',
      'COMMERCIAL_CONFIRM_FLAGS_INVALID',
    );
  }
  const runId = runArguments[0].slice('--run-id='.length);
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(runId)) {
    throw new CommercialConfirmError(
      'run-id comercial invalido',
      'COMMERCIAL_CONFIRM_FLAGS_INVALID',
    );
  }
  return { runId };
};

export const assertCommercialConfirmEnvironment = (
  config: AppEnv,
  env: NodeJS.ProcessEnv,
) => {
  if (isCiActive(env.CI)) {
    throw new CommercialConfirmError(
      'Confirmacao comercial bloqueada em CI',
      'COMMERCIAL_CONFIRM_CI_BLOCKED',
    );
  }
  if (config.SHOPEE_AFFILIATE_PROVIDER === 'official') {
    throw new CommercialConfirmError(
      'Provider official bloqueado na confirmacao comercial',
      'SHOPEE_OFFICIAL_PROVIDER_BLOCKED',
    );
  }
  if (config.WHATSAPP_PROVIDER !== 'evolution') {
    throw new CommercialConfirmError(
      'Evolution e obrigatoria para confirmacao comercial real',
      'COMMERCIAL_CONFIRM_EVOLUTION_REQUIRED',
    );
  }
  if (!config.EVOLUTION_SAFE_MODE) {
    throw new CommercialConfirmError(
      'Safe mode e obrigatorio',
      'COMMERCIAL_SAFE_MODE_REQUIRED',
    );
  }
  if (config.SCHEDULER_ENABLED) {
    throw new CommercialConfirmError(
      'Scheduler deve permanecer desativado',
      'COMMERCIAL_SCHEDULER_BLOCKED',
    );
  }
  if (!config.WHATSAPP_GROUP_SEND_ENABLED) {
    throw new CommercialConfirmError(
      'Master switch de grupos esta desligado',
      'GROUP_SEND_DISABLED',
    );
  }
  if (
    config.WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN !== 1 ||
    config.EVOLUTION_MAX_MESSAGES_PER_BOOT !== 1
  ) {
    throw new CommercialConfirmError(
      'Limites devem permitir exatamente uma mensagem',
      'COMMERCIAL_MESSAGE_LIMIT_INVALID',
    );
  }
};

type PublicRun = ReturnType<typeof sanitizeCommercialPipelineRun>;

export type CommercialConfirmRuntime = {
  assertNoCompetingWork(): Promise<void>;
  confirm(runId: string): Promise<void>;
  startWorker(): Promise<void>;
  waitForJob(runId: string, timeoutMs: number): Promise<void>;
  readRun(runId: string): Promise<PublicRun>;
  markInvestigationRequired(runId: string): Promise<void>;
  close(force?: boolean): Promise<void>;
};

const safeWorkerData = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object') {
    return { event: 'commercial-pipeline.worker' };
  }
  const data = value as Record<string, unknown>;
  return {
    event:
      typeof data.event === 'string'
        ? data.event
        : 'commercial-pipeline.worker',
    ...(typeof data.runId === 'string' ? { runId: data.runId } : {}),
    ...(typeof data.dispatchStatus === 'string'
      ? { dispatchStatus: data.dispatchStatus }
      : {}),
    ...(typeof data.attemptCount === 'number'
      ? { attemptCount: data.attemptCount }
      : {}),
  };
};

export const createRealCommercialConfirmRuntime = async (
  config: AppEnv,
  logger: SafeLogger,
): Promise<CommercialConfirmRuntime> => {
  const prisma = createPrismaClient();
  const redis = createRedisConnection(config.REDIS_URL);
  const eventsRedis = createRedisConnection(config.REDIS_URL);
  const whatsappQueue = createWhatsAppDispatchQueue(redis);
  const pipelineQueue = createProductPipelineQueue(redis);
  const queueEvents = new QueueEvents(QUEUE_NAMES.whatsappDispatch, {
    connection: eventsRedis,
  });
  await queueEvents.waitUntilReady();
  const workerLogger = {
    info: (value: unknown) => logger.info(safeWorkerData(value)),
    error: (value: unknown) => logger.error(safeWorkerData(value)),
  };
  const repositories = createPrismaRepositories(prisma);
  const confirmation = createCommercialPipelineConfirmationService({
    repositories,
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
    instanceName: config.EVOLUTION_INSTANCE_NAME as string,
    maximumCopyLength: config.COMMERCIAL_COPY_MAX_LENGTH,
    environment: {
      groupSendEnabled: config.WHATSAPP_GROUP_SEND_ENABLED,
      safeMode: config.EVOLUTION_SAFE_MODE,
      schedulerEnabled: config.SCHEDULER_ENABLED,
      maximumMessagesPerRun: config.WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN,
    },
    logger: workerLogger,
  });
  const provider = createWhatsAppProvider(config, { logger: workerLogger });
  const providerResolver = (instanceName: string) =>
    createWhatsAppProvider(
      { ...config, EVOLUTION_INSTANCE_NAME: instanceName },
      { logger: workerLogger },
    );
  const groupSendPolicy = new WhatsAppGroupSendPolicy({
    enabled: config.WHATSAPP_GROUP_SEND_ENABLED,
    safeMode: config.EVOLUTION_SAFE_MODE,
    instanceName: config.EVOLUTION_INSTANCE_NAME,
  });
  let worker: ReturnType<typeof createWhatsAppDispatchWorker> | undefined;
  let closePromise: Promise<void> | undefined;

  return {
    async assertNoCompetingWork() {
      const [whatsappWorkers, pipelineWorkers, whatsappActive, pipelineActive] =
        await Promise.all([
          whatsappQueue.getWorkers(),
          pipelineQueue.getWorkers(),
          whatsappQueue.getActiveCount(),
          pipelineQueue.getActiveCount(),
        ]);
      if (
        whatsappWorkers.length > 0 ||
        pipelineWorkers.length > 0 ||
        whatsappActive > 0 ||
        pipelineActive > 0
      ) {
        throw new CommercialConfirmError(
          'Ha worker ou pipeline ativo',
          'COMMERCIAL_CONFIRM_COMPETING_WORK',
        );
      }
    },
    async confirm(runId) {
      await confirmation.confirm(runId, COMMERCIAL_CONFIRMATION_TOKEN);
    },
    async startWorker() {
      if (worker) {
        throw new CommercialConfirmError(
          'Worker comercial ja foi iniciado',
          'COMMERCIAL_CONFIRM_WORKER_ALREADY_STARTED',
        );
      }
      worker = createWhatsAppDispatchWorker(config.REDIS_URL, {
        connection: redis,
        prisma,
        logger: workerLogger,
        whatsAppProvider: provider,
        whatsAppProviderResolver: providerResolver,
        groupSendPolicy,
        reservationLeaseMilliseconds:
          config.COMMERCIAL_EXECUTION_LEASE_SECONDS * 1000,
      });
      await worker.whatsappDispatchWorker.waitUntilReady();
    },
    async waitForJob(runId, timeoutMs) {
      const job = await whatsappQueue.getJob(
        commercialConfirmationIds(runId).jobId,
      );
      if (!job) {
        throw new CommercialConfirmError(
          'Job comercial nao encontrado',
          'COMMERCIAL_DISPATCH_FAILED',
        );
      }
      await job.waitUntilFinished(queueEvents, timeoutMs);
    },
    async readRun(runId) {
      const run = await repositories.commercialRuns.findById(runId);
      if (!run) {
        throw new CommercialConfirmError(
          'Run comercial nao encontrado',
          'COMMERCIAL_RUN_NOT_READY',
        );
      }
      const dispatch = run.dispatchId
        ? await repositories.whatsappDispatches.findByIdWithDetails(
            run.dispatchId,
          )
        : null;
      return sanitizeCommercialPipelineRun(run, dispatch);
    },
    markInvestigationRequired: (runId) =>
      confirmation.markInvestigationRequired(runId),
    close(force = false) {
      closePromise ??= (async () => {
        await Promise.allSettled([
          worker?.close(force) ?? Promise.resolve(),
          queueEvents.close(),
          whatsappQueue.close(),
          pipelineQueue.close(),
        ]);
        await Promise.allSettled([
          eventsRedis.quit().then(() => undefined),
          redis.quit().then(() => undefined),
          prisma.$disconnect(),
        ]);
      })();
      return closePromise;
    },
  };
};

export const executeCommercialConfirm = async ({
  runId,
  runtime,
  timeoutMs = JOB_TIMEOUT_MS,
}: {
  runId: string;
  runtime: CommercialConfirmRuntime;
  timeoutMs?: number;
}) => {
  let forceClose = false;
  try {
    await runtime.assertNoCompetingWork();
    await runtime.confirm(runId);
    await runtime.startWorker();
    try {
      await runtime.waitForJob(runId, timeoutMs);
    } catch {
      forceClose = true;
      await runtime.markInvestigationRequired(runId);
    }
    const run = await runtime.readRun(runId);
    const sent =
      run.finalStatus === 'sent' &&
      run.dispatchStatus === 'sent' &&
      run.attemptCount === 1 &&
      run.externalMessageIdRecorded &&
      !run.investigationRequired;
    return {
      exitCode: sent ? 0 : 1,
      output: {
        runId,
        mode: 'confirmed' as const,
        status: run.finalStatus ?? 'ambiguous',
        fingerprint: run.selectedGroup?.fingerprint ?? null,
        dispatchCreated: run.dispatchWasCreated,
        jobCreated: run.jobWasCreated,
        attempts: run.attemptCount,
        retryEnabled: false,
        externalMessageIdRecorded: run.externalMessageIdRecorded,
        investigationRequired: run.investigationRequired || !sent,
        messagesSent: sent ? (1 as const) : ('unknown' as const),
      },
    };
  } finally {
    await runtime.close(forceClose);
  }
};

export const runCommercialConfirm = async ({
  args = process.argv.slice(2),
  env = process.env,
  envPath = ROOT_ENV_PATH,
  logger = consoleLogger,
  runtimeFactory = createRealCommercialConfirmRuntime,
}: {
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  envPath?: string;
  logger?: SafeLogger;
  runtimeFactory?: (
    config: AppEnv,
    logger: SafeLogger,
  ) => Promise<CommercialConfirmRuntime>;
} = {}) => {
  try {
    const { runId } = parseCommercialConfirmArgs(args);
    const fileEnv = existsSync(envPath)
      ? parseLocalDotEnv(readFileSync(envPath, 'utf8'))
      : {};
    const mergedEnv = { ...fileEnv, ...env };
    const config = loadConfig(mergedEnv);
    assertCommercialConfirmEnvironment(config, mergedEnv);
    process.env.DATABASE_URL ??= config.DATABASE_URL;
    logger.info({
      event: 'commercial-pipeline.confirm.config-ready',
      safeMode: config.EVOLUTION_SAFE_MODE,
      schedulerEnabled: config.SCHEDULER_ENABLED,
      groupSendEnabled: config.WHATSAPP_GROUP_SEND_ENABLED,
      maximumMessagesPerRun: config.WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN,
    });
    const result = await executeCommercialConfirm({
      runId,
      runtime: await runtimeFactory(config, logger),
    });
    (result.exitCode === 0 ? logger.info : logger.error)({
      event: 'commercial-pipeline.confirm.completed',
      ...result.output,
    });
    return result;
  } catch (error) {
    const output = {
      ...publicError(error),
      investigationRequired: false,
    };
    logger.error({ event: 'commercial-pipeline.confirm.blocked', ...output });
    return { exitCode: 1, output };
  }
};

const isDirectExecution =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  void runCommercialConfirm().then((result) => {
    process.exitCode = result.exitCode;
  });
}
