import { isMainModule } from './main-module';
import { loadConfig, type AppEnv } from '@shopee-auto-affiliate-ai/config';
import {
  createWhatsAppProvider,
  type WhatsAppProviderFactoryOptions,
} from '@shopee-auto-affiliate-ai/providers';
import { QUEUE_NAMES } from '@shopee-auto-affiliate-ai/queue';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import { WhatsAppGroupSendPolicy } from '../../api/src/whatsapp-group-send-policy';
import {
  createWhatsAppDispatchWorker,
  type WhatsAppDispatchWorkerLogger,
} from './whatsapp-dispatch-worker';

const consoleLogger: WhatsAppDispatchWorkerLogger = {
  info: (data, message) => console.info(message, data),
  error: (data, message) => console.error(message, data),
};

export const startIsolatedWhatsAppDispatchWorker = (
  config: AppEnv,
  options: {
    logger?: WhatsAppDispatchWorkerLogger;
    providerFactory?: typeof createWhatsAppProvider;
    providerFactoryOptions?: WhatsAppProviderFactoryOptions;
    workerFactory?: typeof createWhatsAppDispatchWorker;
  } = {},
) => {
  if (config.COMMERCIAL_AUTOMATION_MODE !== 'send') {
    throw new AppError(
      'O worker isolado de dispatch exige modo send',
      'WHATSAPP_DISPATCH_WORKER_SEND_MODE_REQUIRED',
    );
  }
  const logger = options.logger ?? consoleLogger;
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
  const runtime = (options.workerFactory ?? createWhatsAppDispatchWorker)(
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

if (
  process.env.NODE_ENV !== 'test' &&
  isMainModule(import.meta.url)
) {
  const runtime = startIsolatedWhatsAppDispatchWorker(loadConfig());
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
