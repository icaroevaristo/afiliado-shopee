import { isMainModule } from './main-module';
import { Worker, type Job } from 'bullmq';
import { loadConfig, type AppEnv } from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import {
  COMMERCIAL_AUTOMATION_JOB_OPTIONS,
  createBullMqCommercialAutomationScheduler,
  createCommercialAutomationQueue,
  createRedisConnection,
  createWhatsAppDispatchQueue,
  DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
  enqueueControlledWhatsAppDispatch,
  enqueueCommercialAutomationTarget,
  JOB_NAMES,
  QUEUE_NAMES,
  type CommercialAutomationJob,
  type CommercialAutomationTargetConstraint,
  type CommercialAutomationScheduler,
} from '@shopee-auto-affiliate-ai/queue';

import {
  commercialAutomationConsoleLogger,
  createCommercialAutomationOrchestratorRuntime,
  type CommercialAutomationRuntimeLogger,
} from './commercial-automation-runtime';

type CommercialWorkerInfrastructure = {
  connection: ReturnType<typeof createRedisConnection>;
  scheduler: CommercialAutomationScheduler;
  confirmationQueue?: {
    hasJob(jobId: string): Promise<boolean>;
    enqueue(
      dispatchId: string,
      jobId: string,
      instanceName?: string | null,
    ): Promise<void>;
  };
  enqueueTarget?: (
    data: Extract<CommercialAutomationJob, { kind: 'target' }>,
    jobId: string,
    delayMs: number,
  ) => Promise<void>;
  close(): Promise<void>;
};

type CommercialWorkerOptions = {
  prisma?: ReturnType<typeof createPrismaClient>;
  logger?: CommercialAutomationRuntimeLogger;
  infrastructureFactory?: (
    redisUrl: string,
    mode: 'preview' | 'send',
  ) => CommercialWorkerInfrastructure;
  workerFactory?: typeof createCommercialAutomationWorker;
};

export const COMMERCIAL_AUTOMATION_WORKER_CONCURRENCY = 1;

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isCommercialAutomationTargetConstraint = (
  value: unknown,
): value is CommercialAutomationTargetConstraint => {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.campaignId) &&
    isNonEmptyString(value.groupId) &&
    isNonEmptyString(value.logicalGroupFingerprint) &&
    isNonEmptyString(value.instanceName) &&
    isNonEmptyString(value.scheduledFor) &&
    Number.isFinite(Date.parse(value.scheduledFor)) &&
    isNonEmptyString(value.slotKey) &&
    Number.isSafeInteger(value.scheduleRevision)
  );
};

export const processCommercialAutomationJob = async (
  job: Pick<Job<CommercialAutomationJob>, 'id' | 'name' | 'data'>,
  options: {
    orchestrator: Pick<
      ReturnType<typeof createCommercialAutomationOrchestratorRuntime>['orchestrator'],
      'executeTick'
    >;
    provider: 'mock' | 'manual' | 'official';
    mode: 'preview' | 'send';
    planner?: {
      plan(input: {
        now?: Date;
        mode: 'preview' | 'send';
        enqueue: (
          data: Extract<CommercialAutomationJob, { kind: 'target' }>,
          jobId: string,
          delayMs: number,
        ) => Promise<void>;
      }): Promise<unknown>;
    };
    enqueueTarget?: CommercialWorkerInfrastructure['enqueueTarget'];
    getScheduleRevision?: () => Promise<number>;
    clock?: () => Date;
  },
) => {
  if (
    job.name !== JOB_NAMES.commercialAutomationTick &&
    job.name !== JOB_NAMES.commercialAutomationTarget
  ) {
    return { skipped: true };
  }
  if (!job.id) {
    throw new AppError(
      'Job da automacao comercial sem identidade BullMQ',
      'COMMERCIAL_AUTOMATION_JOB_ID_REQUIRED',
    );
  }
  const jobData: unknown = job.data;
  if (!isRecord(jobData) || jobData.mode !== options.mode) {
    throw new AppError(
      'Modo do job comercial diverge da configuracao carregada',
      'COMMERCIAL_AUTOMATION_JOB_MODE_MISMATCH',
    );
  }
  if (job.name === JOB_NAMES.commercialAutomationTarget) {
    if (job.data.kind !== 'target') {
      throw new AppError(
        'Job target da automacao comercial sem constraint',
        'COMMERCIAL_AUTOMATION_TARGET_CONSTRAINT_REQUIRED',
      );
    }
    if (!isCommercialAutomationTargetConstraint(jobData.target)) {
      throw new AppError(
        'Job target da automacao comercial com constraint invalida',
        'COMMERCIAL_AUTOMATION_TARGET_CONSTRAINT_INVALID',
      );
    }
    const target = jobData.target;
    if (!Number.isSafeInteger(target.scheduleRevision)) {
      throw new AppError(
        'Job target da automacao comercial sem revisao valida',
        'COMMERCIAL_AUTOMATION_SCHEDULE_REVISION_REQUIRED',
      );
    }
    if (`commercial-target-${target.slotKey}` !== job.id) {
      throw new AppError(
        'Job target da automacao comercial com identidade divergente',
        'COMMERCIAL_AUTOMATION_TARGET_JOB_ID_MISMATCH',
      );
    }
    if (options.getScheduleRevision) {
      const currentRevision = await options.getScheduleRevision();
      if (currentRevision !== target.scheduleRevision) {
        return { skipped: true, reason: 'SCHEDULE_REVISION_STALE' };
      }
    }
    return options.orchestrator.executeTick({
      schedulerJobId: DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
      bullMqJobId: job.id,
      mode: options.mode,
      provider: options.provider,
      targetConstraint: target,
    });
  }
  if (options.planner) {
    if (!options.enqueueTarget) {
      throw new AppError(
        'Planner comercial sem destino de enfileiramento',
        'COMMERCIAL_AUTOMATION_TARGET_ENQUEUE_REQUIRED',
      );
    }
    return options.planner.plan({
      now: options.clock?.() ?? new Date(),
      mode: options.mode,
      enqueue: options.enqueueTarget,
    });
  }
  return options.orchestrator.executeTick({
    schedulerJobId: DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
    bullMqJobId: job.id,
    mode: options.mode,
    provider: options.provider,
  });
};

export const createCommercialAutomationWorker = (
  config: AppEnv,
  options: {
    connection: ReturnType<typeof createRedisConnection>;
    prisma?: ReturnType<typeof createPrismaClient>;
    confirmationQueue?: CommercialWorkerInfrastructure['confirmationQueue'];
    enqueueTarget?: CommercialWorkerInfrastructure['enqueueTarget'];
    logger: CommercialAutomationRuntimeLogger;
  },
) => {
  const runtime = createCommercialAutomationOrchestratorRuntime(config, {
    prisma: options.prisma,
    confirmationQueue: options.confirmationQueue,
    logger: options.logger,
  });
  const worker = new Worker<CommercialAutomationJob>(
    QUEUE_NAMES.commercialAutomation,
    (job) =>
      processCommercialAutomationJob(job, {
        orchestrator: runtime.orchestrator,
        planner: runtime.planner,
        enqueueTarget: options.enqueueTarget,
        getScheduleRevision: () => runtime.planner.getScheduleRevision(),
        provider: config.SHOPEE_AFFILIATE_PROVIDER,
        mode: config.COMMERCIAL_AUTOMATION_MODE,
      }),
    {
      connection: options.connection,
      concurrency: COMMERCIAL_AUTOMATION_WORKER_CONCURRENCY,
    },
  );
  let closePromise: Promise<void> | undefined;
  return {
    worker,
    close: () => {
      closePromise ??= closeResources([
        () => worker.close(),
        ...(runtime.ownsPrisma ? [() => runtime.prisma.$disconnect()] : []),
      ]);
      return closePromise;
    },
  };
};

export const createCommercialWorkerInfrastructure = (
  redisUrl: string,
  mode: 'preview' | 'send',
): CommercialWorkerInfrastructure => {
  const connection = createRedisConnection(redisUrl);
  const commercialQueue = createCommercialAutomationQueue(connection);
  const whatsappQueue =
    mode === 'send' ? createWhatsAppDispatchQueue(connection) : undefined;
  const scheduler = createBullMqCommercialAutomationScheduler(commercialQueue);
  let closePromise: Promise<void> | undefined;
  return {
    connection,
    scheduler,
    confirmationQueue: whatsappQueue
      ? {
          async hasJob(jobId) {
            return Boolean(await whatsappQueue.getJob(jobId));
          },
          async enqueue(dispatchId, jobId, instanceName) {
            await enqueueControlledWhatsAppDispatch(
              whatsappQueue,
              { dispatchId, ...(instanceName ? { instanceName } : {}) },
              jobId,
            );
          },
        }
      : undefined,
    enqueueTarget: async (data, jobId, delayMs) => {
      await enqueueCommercialAutomationTarget(
        commercialQueue,
        data,
        jobId,
        delayMs,
      );
    },
    close: () => {
      closePromise ??= closeResources([
        () => commercialQueue.close(),
        ...(whatsappQueue ? [() => whatsappQueue.close()] : []),
        () => connection.quit().then(() => undefined),
      ]);
      return closePromise;
    },
  };
};

export const startCommercialAutomationWorker = async (
  config: AppEnv,
  options: CommercialWorkerOptions = {},
) => {
  const logger = options.logger ?? commercialAutomationConsoleLogger;
  const infrastructure = (
    options.infrastructureFactory ?? createCommercialWorkerInfrastructure
  )(config.REDIS_URL, config.COMMERCIAL_AUTOMATION_MODE);
  try {
    if (config.COMMERCIAL_SCHEDULER_ENABLED) {
      await infrastructure.scheduler.register({
        enabled: true,
        cronExpression: config.COMMERCIAL_SCHEDULER_CRON,
        timezone: config.COMMERCIAL_SCHEDULER_TIMEZONE,
        mode: config.COMMERCIAL_AUTOMATION_MODE,
        jobId: DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
      });
    } else {
      await infrastructure.scheduler.remove(
        DEFAULT_COMMERCIAL_AUTOMATION_SCHEDULER_JOB_ID,
      );
    }
  } catch (error) {
    await infrastructure.close().catch(() => undefined);
    throw error;
  }

  const workerFactory =
    options.workerFactory ?? createCommercialAutomationWorker;
  let worker: ReturnType<typeof createCommercialAutomationWorker>;
  try {
    worker = workerFactory(config, {
      connection: infrastructure.connection,
      prisma: options.prisma,
      confirmationQueue: infrastructure.confirmationQueue,
      enqueueTarget: infrastructure.enqueueTarget,
      logger,
    });
  } catch (error) {
    await infrastructure.close().catch(() => undefined);
    throw error;
  }
  logger.info(
    {
      event: 'commercial-automation.worker.started',
      queue: QUEUE_NAMES.commercialAutomation,
      job: JOB_NAMES.commercialAutomationTick,
      concurrency: COMMERCIAL_AUTOMATION_WORKER_CONCURRENCY,
      jobOptions: COMMERCIAL_AUTOMATION_JOB_OPTIONS,
    },
    'Commercial automation worker started',
  );
  let closePromise: Promise<void> | undefined;
  return {
    worker: worker.worker,
    close: () => {
      closePromise ??= closeResources([
        () => worker.close(),
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
  const runtime = await startCommercialAutomationWorker(loadConfig());
  const shutdown = () => void runtime.close();
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
