import { isMainModule } from './main-module';
import type { Job } from 'bullmq';
import { Worker } from 'bullmq';
import { loadConfig, type AppEnv } from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import {
  createWhatsAppProvider,
  MockShopeeProvider,
  type HunterProvider,
  type WhatsAppProviderFactoryOptions,
  type WhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';
import {
  createBullMqPipelineScheduler,
  createProductPipelineQueue,
  createRedisConnection,
  DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
  JOB_NAMES,
  QUEUE_NAMES,
  type PipelineScheduler,
  type PipelineProductJob,
  type SchedulerConfig,
  type WhatsAppDispatchJob,
} from '@shopee-auto-affiliate-ai/queue';
import {
  createApplicationServices,
  createPrismaRepositories,
} from '../../api/src/application-services';
import { processWhatsAppDispatchJob } from './whatsapp-dispatch-worker';
import { WhatsAppGroupSendPolicy } from '../../api/src/whatsapp-group-send-policy';

export { processWhatsAppDispatchJob } from './whatsapp-dispatch-worker';

type WorkerLogger = {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

type CreatePipelineProductWorkerOptions = {
  connection?: ReturnType<typeof createRedisConnection>;
  prisma?: ReturnType<typeof createPrismaClient>;
  hunterProvider?: HunterProvider;
  logger?: WorkerLogger;
  whatsAppProvider: WhatsAppProvider;
  whatsAppProviderResolver?: (
    instanceName: string,
  ) => WhatsAppProvider | Promise<WhatsAppProvider>;
  groupSendPolicy?: WhatsAppGroupSendPolicy;
  reservationLeaseMilliseconds?: number;
};

type WorkerProcessorOptions = Required<
  Omit<
    CreatePipelineProductWorkerOptions,
    | 'connection'
    | 'groupSendPolicy'
    | 'reservationLeaseMilliseconds'
    | 'whatsAppProviderResolver'
  >
> &
  Pick<
    CreatePipelineProductWorkerOptions,
    | 'whatsAppProviderResolver'
    | 'groupSendPolicy'
    | 'reservationLeaseMilliseconds'
  >;

type WorkerFactory = typeof createPipelineProductWorker;

type WorkerInfrastructure = {
  connection: ReturnType<typeof createRedisConnection>;
  scheduler: PipelineScheduler;
  close: () => Promise<void>;
};

type StartWorkerOptions = {
  prisma?: ReturnType<typeof createPrismaClient>;
  hunterProvider?: HunterProvider;
  logger?: WorkerLogger;
  providerFactory?: typeof createWhatsAppProvider;
  providerFactoryOptions?: WhatsAppProviderFactoryOptions;
  infrastructureFactory?: (redisUrl: string) => WorkerInfrastructure;
  workerFactory?: WorkerFactory;
};

const consoleLogger: WorkerLogger = {
  info: (obj, msg) => console.info(msg, obj),
  error: (obj, msg) => console.error(msg, obj),
};

export const processPipelineProductJob = async (
  job: Pick<Job<PipelineProductJob>, 'id' | 'name' | 'data' | 'updateProgress'>,
  options: WorkerProcessorOptions,
) => {
  if (job.name !== JOB_NAMES.pipelineProduct) return { skipped: true };

  options.logger.info(
    { event: 'pipeline.job.received', jobId: job.id, data: job.data },
    'Job recebido',
  );
  await job.updateProgress(10);
  options.logger.info(
    { event: 'pipeline.job.started', jobId: job.id },
    'Pipeline iniciado',
  );

  try {
    const repositories = createPrismaRepositories(options.prisma);
    const services = createApplicationServices({
      repositories,
      hunterProvider: options.hunterProvider,
      whatsAppProvider: options.whatsAppProvider,
      logger: options.logger,
    });
    const result = await services.pipeline.run(job.data.filters);
    await job.updateProgress(100);
    options.logger.info(
      { event: 'pipeline.job.completed', jobId: job.id, result },
      'Pipeline concluído',
    );
    return result;
  } catch (error) {
    options.logger.error(
      { event: 'pipeline.job.failed', jobId: job.id, error },
      'Pipeline falhou',
    );
    throw error;
  }
};

export const createPipelineProductWorker = (
  redisUrl: string,
  options: CreatePipelineProductWorkerOptions,
) => {
  const ownsConnection = !options.connection;
  const connection = options.connection ?? createRedisConnection(redisUrl);
  const prisma = options.prisma ?? createPrismaClient();
  const workerOptions = {
    prisma,
    hunterProvider: options.hunterProvider ?? new MockShopeeProvider(),
    logger: options.logger ?? consoleLogger,
    whatsAppProvider: options.whatsAppProvider,
    whatsAppProviderResolver: options.whatsAppProviderResolver,
    groupSendPolicy: options.groupSendPolicy,
  };

  const worker = new Worker<PipelineProductJob>(
    QUEUE_NAMES.productPipeline,
    async (job) => processPipelineProductJob(job, workerOptions),
    { connection },
  );

  const whatsappWorker = new Worker<WhatsAppDispatchJob>(
    QUEUE_NAMES.whatsappDispatch,
    async (job) => processWhatsAppDispatchJob(job, workerOptions),
    { connection },
  );

  let closePromise: Promise<void> | undefined;

  return {
    productPipelineWorker: worker,
    whatsappDispatchWorker: whatsappWorker,
    close: () => {
      closePromise ??= closeResources([
        () => worker.close(),
        () => whatsappWorker.close(),
        ...(!options.prisma ? [() => prisma.$disconnect()] : []),
        ...(ownsConnection
          ? [() => connection.quit().then(() => undefined)]
          : []),
      ]);
      return closePromise;
    },
  };
};

const closeResources = async (cleanups: Array<() => Promise<unknown>>) => {
  let firstError: unknown;

  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch (error) {
      firstError ??= error;
    }
  }

  if (firstError) throw firstError;
};

export const createWorkerInfrastructure = (
  redisUrl: string,
): WorkerInfrastructure => {
  const connection = createRedisConnection(redisUrl);
  const productPipelineQueue = createProductPipelineQueue(connection);
  const scheduler = createBullMqPipelineScheduler(productPipelineQueue);
  let closePromise: Promise<void> | undefined;

  return {
    connection,
    scheduler,
    close: () => {
      closePromise ??= closeResources([
        () => productPipelineQueue.close(),
        () => connection.quit().then(() => undefined),
      ]);
      return closePromise;
    },
  };
};

const safeBaseUrl = (baseUrl: string) => {
  const url = new URL(baseUrl);
  url.username = '';
  url.password = '';
  return url.toString().replace(/\/$/, '');
};

export const startWorker = async (
  config: AppEnv,
  options: StartWorkerOptions = {},
) => {
  const logger = options.logger ?? consoleLogger;
  const providerFactory = options.providerFactory ?? createWhatsAppProvider;
  const whatsAppProvider = providerFactory(config, {
    ...options.providerFactoryOptions,
    logger,
  });
  const groupSendPolicy = new WhatsAppGroupSendPolicy({
    enabled: config.WHATSAPP_GROUP_SEND_ENABLED,
    safeMode: config.EVOLUTION_SAFE_MODE,
    instanceName: config.EVOLUTION_INSTANCE_NAME,
  });
  const providerResolver = (instanceName: string) =>
    providerFactory(
      { ...config, EVOLUTION_INSTANCE_NAME: instanceName },
      {
        ...options.providerFactoryOptions,
        logger,
      },
    );

  logger.info(
    {
      event: 'worker.whatsapp-provider.selected',
      provider: config.WHATSAPP_PROVIDER,
      queue: QUEUE_NAMES.whatsappDispatch,
      ...(config.WHATSAPP_PROVIDER === 'evolution'
        ? {
            instanceName: config.EVOLUTION_INSTANCE_NAME,
            baseUrl: safeBaseUrl(config.EVOLUTION_API_URL as string),
          }
        : {}),
    },
    'WhatsApp provider selected',
  );

  const infrastructureFactory =
    options.infrastructureFactory ?? createWorkerInfrastructure;
  const infrastructure = infrastructureFactory(config.REDIS_URL);

  try {
    if (config.SCHEDULER_ENABLED) {
      if (!config.SCHEDULER_CRON || !config.SCHEDULER_TIMEZONE) {
        throw new Error('Enabled scheduler configuration is incomplete');
      }
      const schedulerConfig: SchedulerConfig = {
        enabled: true,
        cronExpression: config.SCHEDULER_CRON,
        timezone: config.SCHEDULER_TIMEZONE,
        jobId: DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
      };
      const state = await infrastructure.scheduler.register(schedulerConfig);
      logger.info(
        {
          event: 'worker.scheduler.registered',
          status: state.status,
          cron: schedulerConfig.cronExpression,
          timezone: schedulerConfig.timezone,
          jobId: schedulerConfig.jobId,
          queue: QUEUE_NAMES.productPipeline,
        },
        'Pipeline scheduler registered',
      );
    } else {
      const state = await infrastructure.scheduler.remove(
        DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
      );
      logger.info(
        {
          event: 'worker.scheduler.disabled',
          status: 'disabled',
          schedulerState: state.status,
          jobId: DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
          queue: QUEUE_NAMES.productPipeline,
        },
        'Pipeline scheduler disabled',
      );
    }
  } catch (error) {
    logger.error(
      {
        event: 'worker.scheduler.configuration-failed',
        operation: config.SCHEDULER_ENABLED ? 'register' : 'remove',
        jobId: DEFAULT_PIPELINE_SCHEDULER_JOB_ID,
        queue: QUEUE_NAMES.productPipeline,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      },
      'Pipeline scheduler configuration failed',
    );
    await infrastructure.close().catch(() => undefined);
    throw error;
  }

  const workerFactory = options.workerFactory ?? createPipelineProductWorker;
  let workers: ReturnType<WorkerFactory>;

  try {
    workers = workerFactory(config.REDIS_URL, {
      connection: infrastructure.connection,
      prisma: options.prisma,
      hunterProvider: options.hunterProvider,
      logger,
      whatsAppProvider,
      whatsAppProviderResolver: providerResolver,
      groupSendPolicy,
      reservationLeaseMilliseconds:
        config.COMMERCIAL_EXECUTION_LEASE_SECONDS * 1000,
    });
  } catch (error) {
    await infrastructure.close().catch(() => undefined);
    throw error;
  }

  let closePromise: Promise<void> | undefined;
  return {
    ...workers,
    close: () => {
      closePromise ??= closeResources([
        () => workers.close(),
        () => infrastructure.close(),
      ]);
      return closePromise;
    },
  };
};

if (
  process.env.NODE_ENV !== 'test' &&
  isMainModule(import.meta.url)
) {
  const config = loadConfig();
  const runtime = await startWorker(config);
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => {
    shutdownPromise ??= runtime.close().catch((error) => {
      consoleLogger.error(
        {
          event: 'worker.shutdown.failed',
          errorType: error instanceof Error ? error.name : 'UnknownError',
        },
        'Worker shutdown failed',
      );
      process.exitCode = 1;
    });
    return shutdownPromise;
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}
