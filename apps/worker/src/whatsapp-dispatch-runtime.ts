import { isMainModule } from './main-module';
import { loadConfig, type AppEnv } from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import {
  createWhatsAppProvider,
  type WhatsAppProviderFactoryOptions,
} from '@shopee-auto-affiliate-ai/providers';
import {
  createRedisConnection,
  createWhatsAppDispatchQueue,
  QUEUE_NAMES,
} from '@shopee-auto-affiliate-ai/queue';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import { WhatsAppGroupSendPolicy } from '../../api/src/whatsapp-group-send-policy';
import {
  createCommercialRecoveryQueue,
  createCommercialRecoveryCoordinator,
} from './commercial-recovery-bootstrap';
import {
  assertCommercialRecoveryStartupSafe,
  type CommercialRecoveryCoordinator,
  type CommercialRecoveryReport,
} from '../../api/src/commercial-recovery-coordinator';
import {
  createWhatsAppDispatchWorker,
  processWhatsAppDispatchJob,
  type WhatsAppDispatchWorkerLogger,
  type WhatsAppDispatchProcessorOptions,
} from './whatsapp-dispatch-worker';
import type { R8OneShotAuthorizationFence } from './r8-one-shot-authorization-fence';

export type WhatsAppDispatchWorkerFactory = (
  redisUrl: string,
  options: Parameters<typeof createWhatsAppDispatchWorker>[1],
) => Pick<ReturnType<typeof createWhatsAppDispatchWorker>, 'close'>;

export type R8OneShotQueuePreflight = (
  config: AppEnv,
  fence: R8OneShotAuthorizationFence,
) => Promise<{ hasAuthorizedProcessableJob: boolean }>;

export type R8ClosedHistoricalDispatchEvidence = {
  dispatchId: string;
  runId: string;
  executionId: string;
  jobId: string;
  decision: string;
  attemptCountObserved: number;
  rearmedAt: Date | null;
  requeuedAt: Date | null;
  dispatch: {
    id: string;
    instanceName: string | null;
    status: string;
    attemptCount: number;
    externalMessageId: string | null;
    sentAt: Date | null;
    commercialPipelineRun: {
      id: string;
      executionId: string | null;
      jobId: string | null;
      status: string;
      finalStatus: string | null;
      investigationRequired: boolean;
    } | null;
  } | null;
};

export const isClosedHistoricalR8OneShotJob = (input: {
  jobId: string | undefined;
  dispatchId: string;
  instanceName: string | undefined;
  evidence: R8ClosedHistoricalDispatchEvidence | null;
}) => {
  const { evidence } = input;
  const dispatch = evidence?.dispatch;
  const run = dispatch?.commercialPipelineRun;
  return Boolean(
    evidence &&
      dispatch &&
      run &&
      input.jobId &&
      input.instanceName &&
      evidence.decision === 'AMBIGUITY_ACCEPTED_NO_RETRY' &&
      evidence.dispatchId === input.dispatchId &&
      evidence.jobId === input.jobId &&
      dispatch.id === evidence.dispatchId &&
      dispatch.instanceName === input.instanceName &&
      evidence.runId === run.id &&
      evidence.executionId === run.executionId &&
      evidence.jobId === run.jobId &&
      evidence.attemptCountObserved === 1 &&
      evidence.rearmedAt === null &&
      evidence.requeuedAt === null &&
      dispatch.status === 'PROCESSING' &&
      dispatch.attemptCount === 1 &&
      dispatch.externalMessageId === null &&
      dispatch.sentAt === null &&
      run.status === 'FAILED' &&
      run.finalStatus === 'AMBIGUOUS' &&
      run.investigationRequired === true,
  );
};

export type R8OneShotExecutor = (input: {
  config: AppEnv;
  fence: R8OneShotAuthorizationFence;
  logger: WhatsAppDispatchWorkerLogger;
  workerOptions: Parameters<typeof createWhatsAppDispatchWorker>[1];
}) => Promise<{ close: () => Promise<void>; done: Promise<void> }>;

const ONE_SHOT_PENDING_QUEUE_STATES = [
  'waiting',
  'active',
  'delayed',
  'prioritized',
  'waiting-children',
  'paused',
] as const;

const consoleLogger: WhatsAppDispatchWorkerLogger = {
  info: (data, message) => console.info(message, data),
  error: (data, message) => console.error(message, data),
};

const logRecoveryStartupResult = (
  recovery: CommercialRecoveryReport,
  logger: WhatsAppDispatchWorkerLogger,
) => {
  try {
    assertCommercialRecoveryStartupSafe(recovery);
  } catch (error) {
    logger.error(
      {
        event: 'commercial-recovery.coordinator.startup-blocked',
        ...recovery,
        errorCode: error instanceof AppError ? error.code : 'APP_ERROR',
      },
      'Commercial recovery requires human intervention before startup',
    );
    throw error;
  }
  logger.info(
    {
      event: 'commercial-recovery.coordinator.startup-complete',
      ...recovery,
    },
    'Commercial recovery coordinator completed before WhatsApp worker startup',
  );
};

export const startIsolatedWhatsAppDispatchWorker = async (
  config: AppEnv,
  options: {
    logger?: WhatsAppDispatchWorkerLogger;
    providerFactory?: typeof createWhatsAppProvider;
    providerFactoryOptions?: WhatsAppProviderFactoryOptions;
    workerFactory?: WhatsAppDispatchWorkerFactory;
    recoveryCoordinator?: Pick<CommercialRecoveryCoordinator, 'run'>;
    oneShotAuthorizationFence?: R8OneShotAuthorizationFence;
    oneShotQueuePreflight?: R8OneShotQueuePreflight;
    oneShotExecutor?: R8OneShotExecutor;
  } = {},
) => {
  if (config.COMMERCIAL_AUTOMATION_MODE !== 'send') {
    throw new AppError(
      'O worker isolado de dispatch exige modo send',
      'WHATSAPP_DISPATCH_WORKER_SEND_MODE_REQUIRED',
    );
  }
  options.oneShotAuthorizationFence?.assertRuntime({
    instanceName: config.EVOLUTION_INSTANCE_NAME,
    allowedDestinations: config.EVOLUTION_ALLOWED_DESTINATIONS,
    groupSendEnabled: config.WHATSAPP_GROUP_SEND_ENABLED,
    safeMode: config.EVOLUTION_SAFE_MODE,
    maxMessagesPerRun: config.WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN,
    schedulerEnabled: config.SCHEDULER_ENABLED,
    commercialSchedulerEnabled: config.COMMERCIAL_SCHEDULER_ENABLED,
  });
  const logger = options.logger ?? consoleLogger;
  if (options.oneShotAuthorizationFence) {
    const preflight = await (
      options.oneShotQueuePreflight ?? preflightOneShotDispatchQueue
    )(
      config,
      options.oneShotAuthorizationFence,
    );
    if (!preflight.hasAuthorizedProcessableJob) {
      logger.info(
        {
          event: 'whatsapp-dispatch.one-shot.queue-idle',
          queue: QUEUE_NAMES.whatsappDispatch,
        },
        'One-shot authorization has no processable exact job',
      );
      return { close: async () => undefined };
    }
  } else {
    const recovery = options.recoveryCoordinator
      ? await options.recoveryCoordinator.run()
      : process.env.NODE_ENV !== 'test'
        ? await runDefaultRecoveryCoordinator(config, logger)
        : undefined;
    if (recovery) {
      logRecoveryStartupResult(recovery, logger);
    }
  }
  const provider = (options.providerFactory ?? createWhatsAppProvider)(config, {
    ...options.providerFactoryOptions,
    logger,
  });
  if (!options.oneShotAuthorizationFence) {
    await provider.assertReady?.();
  }
  const providerResolver = (instanceName: string) =>
    (options.providerFactory ?? createWhatsAppProvider)(
      { ...config, EVOLUTION_INSTANCE_NAME: instanceName },
      {
        ...options.providerFactoryOptions,
        logger,
      },
    );
  const groupSendPolicy = new WhatsAppGroupSendPolicy({
    enabled: config.WHATSAPP_GROUP_SEND_ENABLED,
    safeMode: config.EVOLUTION_SAFE_MODE,
    instanceName: config.EVOLUTION_INSTANCE_NAME,
  });
  const workerOptions = {
      logger,
      commercialAutomationMode: config.COMMERCIAL_AUTOMATION_MODE,
      whatsAppProvider: provider,
      whatsAppProviderResolver: providerResolver,
      groupSendPolicy,
      reservationLeaseMilliseconds:
        config.COMMERCIAL_EXECUTION_LEASE_SECONDS * 1000,
      deliveryConfirmationTimeoutMs:
        config.WHATSAPP_DELIVERY_CONFIRMATION_TIMEOUT_SECONDS * 1000,
      deliveryConfirmationExpiryIntervalMs:
        config.WHATSAPP_DELIVERY_CONFIRMATION_EXPIRY_INTERVAL_SECONDS * 1000,
      oneShotAuthorizationFence: options.oneShotAuthorizationFence,
    };
  if (options.oneShotAuthorizationFence) {
    const runtime = await (options.oneShotExecutor ?? executeOneShotDispatch)({
      config,
      fence: options.oneShotAuthorizationFence,
      logger,
      workerOptions,
    });
    logger.info(
      {
        event: 'whatsapp-dispatch.one-shot.started',
        queue: QUEUE_NAMES.whatsappDispatch,
        provider: config.WHATSAPP_PROVIDER,
      },
      'One-shot WhatsApp dispatch executor started',
    );
    return runtime;
  }
  const workerFactory = options.workerFactory ?? createWhatsAppDispatchWorker;
  const runtime = workerFactory(config.REDIS_URL, workerOptions);

  logger.info(
    {
      event: 'whatsapp-dispatch.worker.started',
      queue: QUEUE_NAMES.whatsappDispatch,
      provider: config.WHATSAPP_PROVIDER,
    },
    'Isolated WhatsApp dispatch worker started',
  );
  return runtime;
};

const waitUntilDue = async (input: {
  timestamp: number;
  delay: number | undefined;
  cancelled: () => boolean;
}) => {
  const dueAt = input.timestamp + (input.delay ?? 0);
  const remaining = dueAt - Date.now();
  if (remaining <= 0 || input.cancelled()) return;
  await new Promise<void>((resolve) => setTimeout(resolve, remaining));
};

const executeOneShotDispatch: R8OneShotExecutor = async (input) => {
  const connection = createRedisConnection(input.config.REDIS_URL);
  const queue = createWhatsAppDispatchQueue(connection);
  const prisma = createPrismaClient(input.config.DATABASE_URL);
  let closed = false;
  let exactJob: Awaited<ReturnType<typeof queue.getJob>>;
  const done = (async () => {
    try {
      const job = await queue.getJob(input.fence.authorizedJob.jobId);
      input.fence.assertJob({
        jobId: job?.id,
        dispatchId: job?.data.dispatchId ?? '',
        instanceName: job?.data.instanceName,
      });
      if (!job) return;
      const initialState = await job.getState();
      if (!['waiting', 'delayed', 'prioritized'].includes(initialState)) {
        input.fence.assertJob({
          jobId: undefined,
          dispatchId: job.data.dispatchId,
          instanceName: job.data.instanceName,
        });
      }
      await waitUntilDue({
        timestamp: job.timestamp,
        delay: job.opts.delay,
        cancelled: () => closed,
      });
      if (closed) return;
      exactJob = await queue.getJob(input.fence.authorizedJob.jobId);
      input.fence.assertJob({
        jobId: exactJob?.id,
        dispatchId: exactJob?.data.dispatchId ?? '',
        instanceName: exactJob?.data.instanceName,
      });
      if (!exactJob) return;
      const state = await exactJob.getState();
      if (state === 'delayed') await exactJob.promote();
      if (!['waiting', 'prioritized', 'delayed'].includes(state)) {
        input.fence.assertJob({
          jobId: undefined,
          dispatchId: exactJob.data.dispatchId,
          instanceName: exactJob.data.instanceName,
        });
      }
      const processorOptions: WhatsAppDispatchProcessorOptions = {
        prisma,
        logger: input.logger,
        commercialAutomationMode: input.workerOptions.commercialAutomationMode,
        whatsAppProvider: input.workerOptions.whatsAppProvider,
        whatsAppProviderResolver:
          input.workerOptions.whatsAppProviderResolver,
        clock: input.workerOptions.clock,
        messageBuilder: input.workerOptions.messageBuilder,
        groupSendPolicy: input.workerOptions.groupSendPolicy,
        draftService: input.workerOptions.draftService,
        reservationLeaseMilliseconds:
          input.workerOptions.reservationLeaseMilliseconds,
        deliveryConfirmationTimeoutMs:
          input.workerOptions.deliveryConfirmationTimeoutMs,
        manualLifecycleFinalizer:
          input.workerOptions.manualLifecycleFinalizer,
        oneShotAuthorizationFence:
          input.workerOptions.oneShotAuthorizationFence,
      };
      await processWhatsAppDispatchJob(exactJob, processorOptions);
      await exactJob.remove();
    } catch (error) {
      if (exactJob && input.fence.sendBudgetConsumed === 0) {
        await exactJob.remove().catch(() => undefined);
      }
      input.logger.error(
        {
          event: 'whatsapp-dispatch.one-shot.execution-failed',
          errorCode: error instanceof AppError ? error.code : 'UNKNOWN',
        },
        'One-shot WhatsApp dispatch execution failed closed',
      );
    }
  })();
  return {
    done,
    close: async () => {
      closed = true;
      await done;
      await Promise.allSettled([
        queue.close(),
        connection.quit(),
        prisma.$disconnect(),
      ]);
    },
  };
};

const preflightOneShotDispatchQueue: R8OneShotQueuePreflight = async (
  config,
  fence,
) => {
  const connection = createRedisConnection(config.REDIS_URL);
  const queue = createWhatsAppDispatchQueue(connection);
  const prisma = createPrismaClient(config.DATABASE_URL);
  try {
    const jobs = await queue.getJobs([...ONE_SHOT_PENDING_QUEUE_STATES], 0, -1);
    let hasAuthorizedProcessableJob = false;
    for (const job of jobs) {
      const state = await job.getState();
      const isAuthorizedJob =
        job.id === fence.authorizedJob.jobId &&
        job.data.dispatchId === fence.authorizedJob.dispatchId &&
        job.data.instanceName === fence.authorizedJob.instanceName;
      if (!isAuthorizedJob && state !== 'active') {
        const evidence = job.data.dispatchId
          ? await prisma.whatsAppDispatchManualRecovery.findUnique({
              where: { dispatchId: job.data.dispatchId },
              select: {
                dispatchId: true,
                runId: true,
                executionId: true,
                jobId: true,
                decision: true,
                attemptCountObserved: true,
                rearmedAt: true,
                requeuedAt: true,
                dispatch: {
                  select: {
                    id: true,
                    instanceName: true,
                    status: true,
                    attemptCount: true,
                    externalMessageId: true,
                    sentAt: true,
                    commercialPipelineRun: {
                      select: {
                        id: true,
                        executionId: true,
                        jobId: true,
                        status: true,
                        finalStatus: true,
                        investigationRequired: true,
                      },
                    },
                  },
                },
              },
            })
          : null;
        if (
          isClosedHistoricalR8OneShotJob({
            jobId: job.id,
            dispatchId: job.data.dispatchId,
            instanceName: job.data.instanceName,
            evidence,
          })
        ) {
          continue;
        }
      }
      fence.assertJob({
        jobId: job.id,
        dispatchId: job.data.dispatchId,
        instanceName: job.data.instanceName,
      });
      if (
        job.id &&
        (state === 'waiting' || state === 'delayed' || state === 'prioritized')
      ) {
        hasAuthorizedProcessableJob = true;
      }
    }
    return { hasAuthorizedProcessableJob };
  } finally {
    await Promise.allSettled([
      queue.close(),
      connection.quit(),
      prisma.$disconnect(),
    ]);
  }
};

const runDefaultRecoveryCoordinator = async (
  config: AppEnv,
  logger: WhatsAppDispatchWorkerLogger,
) => {
  const prisma = createPrismaClient(config.DATABASE_URL);
  const connection = createRedisConnection(config.REDIS_URL);
  const queue = createWhatsAppDispatchQueue(connection);
  try {
    const coordinator = createCommercialRecoveryCoordinator({
      config,
      prisma,
      queue: createCommercialRecoveryQueue(queue),
      logger,
    });
    return await coordinator.run();
  } finally {
    await Promise.allSettled([
      queue.close(),
      connection.quit().then(() => undefined),
      prisma.$disconnect(),
    ]);
  }
};

if (
  process.env.NODE_ENV !== 'test' &&
  isMainModule(import.meta.url)
) {
  const runtime = await startIsolatedWhatsAppDispatchWorker(loadConfig());
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => {
    shutdownPromise ??= runtime.close().catch((error) => {
      consoleLogger.error(
        {
          event: 'whatsapp-dispatch.worker.shutdown-failed',
          errorType: error instanceof Error ? error.name : 'UnknownError',
        },
        'Isolated WhatsApp dispatch worker shutdown failed',
      );
      process.exitCode = 1;
    });
    return shutdownPromise;
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}
