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
import type { CommercialRecoveryCoordinator } from '../../api/src/commercial-recovery-coordinator';
import {
  createWhatsAppDispatchWorker,
  type WhatsAppDispatchWorkerLogger,
} from './whatsapp-dispatch-worker';

export type WhatsAppDispatchWorkerFactory = (
  redisUrl: string,
  options: Parameters<typeof createWhatsAppDispatchWorker>[1],
) => Pick<ReturnType<typeof createWhatsAppDispatchWorker>, 'close'>;

const consoleLogger: WhatsAppDispatchWorkerLogger = {
  info: (data, message) => console.info(message, data),
  error: (data, message) => console.error(message, data),
};

export const startIsolatedWhatsAppDispatchWorker = async (
  config: AppEnv,
  options: {
    logger?: WhatsAppDispatchWorkerLogger;
    providerFactory?: typeof createWhatsAppProvider;
    providerFactoryOptions?: WhatsAppProviderFactoryOptions;
    workerFactory?: WhatsAppDispatchWorkerFactory;
    recoveryCoordinator?: Pick<CommercialRecoveryCoordinator, 'run'>;
  } = {},
) => {
  if (config.COMMERCIAL_AUTOMATION_MODE !== 'send') {
    throw new AppError(
      'O worker isolado de dispatch exige modo send',
      'WHATSAPP_DISPATCH_WORKER_SEND_MODE_REQUIRED',
    );
  }
  const logger = options.logger ?? consoleLogger;
  if (options.recoveryCoordinator) {
    const recovery = await options.recoveryCoordinator.run();
    logger.info(
      {
        event: 'commercial-recovery.coordinator.startup-complete',
        ...recovery,
      },
      'Commercial recovery coordinator completed before WhatsApp worker startup',
    );
  } else if (process.env.NODE_ENV !== 'test') {
    const recovery = await runDefaultRecoveryCoordinator(config, logger);
    logger.info(
      {
        event: 'commercial-recovery.coordinator.startup-complete',
        ...recovery,
      },
      'Commercial recovery coordinator completed before WhatsApp worker startup',
    );
  }
  const provider = (options.providerFactory ?? createWhatsAppProvider)(config, {
    ...options.providerFactoryOptions,
    logger,
  });
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
  const workerFactory = options.workerFactory ?? createWhatsAppDispatchWorker;
  const runtime = workerFactory(
    config.REDIS_URL,
    {
      logger,
      whatsAppProvider: provider,
      whatsAppProviderResolver: providerResolver,
      groupSendPolicy,
      reservationLeaseMilliseconds:
        config.COMMERCIAL_EXECUTION_LEASE_SECONDS * 1000,
    },
  );

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
