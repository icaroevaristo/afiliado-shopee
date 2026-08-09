import type { Job } from 'bullmq';
import { Worker } from 'bullmq';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import type {
  HunterProvider,
  WhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';
import {
  createRedisConnection,
  JOB_NAMES,
  QUEUE_NAMES,
  type WhatsAppDispatchJob,
} from '@shopee-auto-affiliate-ai/queue';
import {
  createPrismaRepositories,
  createSenderService,
} from '../../api/src/application-services';
import type { WhatsAppGroupSendPolicy } from '../../api/src/whatsapp-group-send-policy';
import { finalizeCommercialPipelineRun } from '../../api/src/commercial-pipeline-run-finalizer';
import { CommercialMessageDraftService } from '../../api/src/commercial-message-draft-service';
import type { ApplicationRepositories } from '../../api/src/application-services';

export type WhatsAppDispatchWorkerLogger = {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export type WhatsAppDispatchProcessorRepositories = Pick<
  ApplicationRepositories,
  'whatsappDispatches' | 'commercialRuns'
> & {
  commercialPromotions?: Pick<
    ApplicationRepositories['commercialPromotions'],
    'markDispatchedByGeneratedCopyId'
  >;
};

type WhatsAppDispatchProcessorBaseOptions = {
  logger: WhatsAppDispatchWorkerLogger;
  whatsAppProvider: WhatsAppProvider;
  messageBuilder?: (copy: {
    titulo: string;
    mensagem: string;
    cta: string;
    hashtags: string;
  }) => string;
  // Mantido apenas para compatibilidade com os callers existentes. O consumer
  // isolado nao instancia nem usa Hunter, Score, Copy ou Pipeline.
  hunterProvider?: HunterProvider;
  groupSendPolicy?: WhatsAppGroupSendPolicy;
  draftService?: Pick<CommercialMessageDraftService, 'createDraft'>;
};

export type WhatsAppDispatchProcessorOptions =
  | (WhatsAppDispatchProcessorBaseOptions & {
      prisma: ReturnType<typeof createPrismaClient>;
      repositories?: never;
    })
  | (WhatsAppDispatchProcessorBaseOptions & {
      prisma?: never;
      repositories: WhatsAppDispatchProcessorRepositories;
    });

type CreateWhatsAppDispatchWorkerOptions = {
  connection?: ReturnType<typeof createRedisConnection>;
  prisma?: ReturnType<typeof createPrismaClient>;
  logger?: WhatsAppDispatchWorkerLogger;
  whatsAppProvider: WhatsAppProvider;
  messageBuilder?: WhatsAppDispatchProcessorOptions['messageBuilder'];
  groupSendPolicy?: WhatsAppGroupSendPolicy;
  draftService?: Pick<CommercialMessageDraftService, 'createDraft'>;
};

const consoleLogger: WhatsAppDispatchWorkerLogger = {
  info: (obj, msg) => console.info(msg, obj),
  error: (obj, msg) => console.error(msg, obj),
};

export const processWhatsAppDispatchJob = async (
  job: Pick<Job<WhatsAppDispatchJob>, 'id' | 'name' | 'data'>,
  options: WhatsAppDispatchProcessorOptions,
) => {
  if (job.name !== JOB_NAMES.whatsappDispatch) return { skipped: true };

  options.whatsAppProvider.beginRun?.(job.id ?? job.data.dispatchId);
  const repositories =
    options.repositories ?? createPrismaRepositories(options.prisma);
  const sender = createSenderService({
    repositories,
    whatsAppProvider: options.whatsAppProvider,
    logger: options.logger,
    messageBuilder: options.messageBuilder,
    groupSendPolicy: options.groupSendPolicy,
    draftService: options.draftService ?? new CommercialMessageDraftService(),
  });
  try {
    const dispatch = await sender.sendDispatch(job.data.dispatchId);
    await finalizeCommercialPipelineRun({
      runs: repositories.commercialRuns,
      promotionCandidates: repositories.commercialPromotions,
      dispatch,
      failed: false,
      logger: options.logger,
    });
    return dispatch;
  } catch (error) {
    const dispatch = await repositories.whatsappDispatches.findByIdWithDetails(
      job.data.dispatchId,
    );
    if (dispatch) {
      await finalizeCommercialPipelineRun({
        runs: repositories.commercialRuns,
        promotionCandidates: repositories.commercialPromotions,
        dispatch,
        failed: true,
        logger: options.logger,
      }).catch((finalizationError) => {
        options.logger.error(
          {
            event: 'commercial-pipeline.finalization.error',
            dispatchId: job.data.dispatchId,
            errorType:
              finalizationError instanceof Error
                ? finalizationError.name
                : 'UnknownError',
          },
          'Commercial pipeline finalization failed',
        );
      });
    }
    throw error;
  }
};

export const createWhatsAppDispatchWorker = (
  redisUrl: string,
  options: CreateWhatsAppDispatchWorkerOptions,
) => {
  const ownsConnection = !options.connection;
  const ownsPrisma = !options.prisma;
  const connection = options.connection ?? createRedisConnection(redisUrl);
  const prisma = options.prisma ?? createPrismaClient();
  const processorOptions: WhatsAppDispatchProcessorOptions = {
    prisma,
    logger: options.logger ?? consoleLogger,
    whatsAppProvider: options.whatsAppProvider,
    messageBuilder: options.messageBuilder,
    groupSendPolicy: options.groupSendPolicy,
    draftService: options.draftService,
  };
  const worker = new Worker<WhatsAppDispatchJob>(
    QUEUE_NAMES.whatsappDispatch,
    async (job) => processWhatsAppDispatchJob(job, processorOptions),
    { connection },
  );
  let closePromise: Promise<void> | undefined;

  return {
    whatsappDispatchWorker: worker,
    close: (force = false) => {
      closePromise ??= (async () => {
        let firstError: unknown;
        for (const cleanup of [
          () => worker.close(force),
          ...(ownsPrisma ? [() => prisma.$disconnect()] : []),
          ...(ownsConnection
            ? [() => connection.quit().then(() => undefined)]
            : []),
        ]) {
          try {
            await cleanup();
          } catch (error) {
            firstError ??= error;
          }
        }
        if (firstError) throw firstError;
      })();
      return closePromise;
    },
  };
};
