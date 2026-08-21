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
import { AppError } from '@shopee-auto-affiliate-ai/shared';
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
    | 'markDispatchedByGeneratedCopyId'
    | 'markBlockedByGeneratedCopyId'
    | 'resetCampaignFailureStateByGeneratedCopyId'
    | 'findAttemptContextByGeneratedCopyId'
    | 'releaseAttempt'
  >;
  commercialAutomationExecutions?: Pick<
    ApplicationRepositories['commercialAutomationExecutions'],
    'findById'
  >;
  commercialGroupCampaigns?: Pick<
    ApplicationRepositories['commercialGroupCampaigns'],
    'renewAttempt'
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
  clock?: () => Date;
  reservationLeaseMilliseconds?: number;
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
  reservationLeaseMilliseconds?: number;
};

const consoleLogger: WhatsAppDispatchWorkerLogger = {
  info: (obj, msg) => console.info(msg, obj),
  error: (obj, msg) => console.error(msg, obj),
};

const errorType = (error: unknown) =>
  error instanceof Error ? error.name : 'UnknownError';

const errorCode = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  typeof error.code === 'string'
    ? error.code
    : 'UNKNOWN';

const preserveCause = (error: unknown, cause: unknown) => {
  if (error instanceof Error && !('cause' in error)) {
    Object.defineProperty(error, 'cause', {
      value: cause,
      configurable: true,
    });
  }
  return error;
};

const reservationHandoffError = (message: string, code: string) =>
  new AppError(message, code);

const renewCommercialReservationForDispatch = async (input: {
  dispatchId: string;
  repositories: WhatsAppDispatchProcessorRepositories;
  clock: () => Date;
  reservationLeaseMilliseconds?: number;
}) => {
  const run = await input.repositories.commercialRuns.findByDispatchId(
    input.dispatchId,
  );
  if (!run?.executionId) return;

  const dispatch =
    await input.repositories.whatsappDispatches.findByIdWithDetails(
      input.dispatchId,
    );
  if (!dispatch) {
    throw reservationHandoffError(
      'Dispatch comercial nao encontrado para o handoff da reserva',
      'COMMERCIAL_DISPATCH_RESERVATION_CONTEXT_UNAVAILABLE',
    );
  }
  if (
    run.mode !== 'CONFIRMED' ||
    run.status !== 'STARTED' ||
    run.finalStatus !== 'PENDING' ||
    dispatch.status !== 'PENDING' ||
    dispatch.attemptCount !== 0 ||
    dispatch.externalMessageId !== null
  ) {
    throw reservationHandoffError(
      'Lifecycle comercial nao esta no estado seguro para handoff da reserva',
      'COMMERCIAL_DISPATCH_RESERVATION_LIFECYCLE_INVALID',
    );
  }

  const executions = input.repositories.commercialAutomationExecutions;
  const campaigns = input.repositories.commercialGroupCampaigns;
  const promotions = input.repositories.commercialPromotions;
  if (!executions?.findById || !campaigns?.renewAttempt) {
    throw reservationHandoffError(
      'Repositorios de ownership e reserva indisponiveis para dispatch comercial',
      'COMMERCIAL_DISPATCH_RESERVATION_HANDOFF_UNAVAILABLE',
    );
  }
  if (!promotions?.findAttemptContextByGeneratedCopyId) {
    throw reservationHandoffError(
      'Contexto do candidato comercial indisponivel para dispatch',
      'COMMERCIAL_DISPATCH_RESERVATION_CONTEXT_UNAVAILABLE',
    );
  }
  const reservationLeaseMilliseconds = input.reservationLeaseMilliseconds;
  if (
    typeof reservationLeaseMilliseconds !== 'number' ||
    !Number.isSafeInteger(reservationLeaseMilliseconds) ||
    reservationLeaseMilliseconds <= 0
  ) {
    throw reservationHandoffError(
      'Lease de handoff da reserva invalido',
      'COMMERCIAL_DISPATCH_RESERVATION_LEASE_INVALID',
    );
  }
  const now = input.clock();
  const execution = await executions.findById(run.executionId);
  if (
    !execution ||
    execution.id !== run.executionId ||
    execution.mode !== 'SEND' ||
    execution.status !== 'QUEUED' ||
    execution.commercialRunId !== run.id ||
    !execution.leaseExpiresAt ||
    execution.leaseExpiresAt.getTime() <= now.getTime()
  ) {
    throw reservationHandoffError(
      'Ownership da execution comercial nao esta valido para handoff',
      'COMMERCIAL_DISPATCH_EXECUTION_OWNERSHIP_INVALID',
    );
  }

  const context = await promotions.findAttemptContextByGeneratedCopyId(
    dispatch.generatedCopyId,
  );
  if (
    context.kind !== 'FOUND' ||
    context.attemptExecutionId !== run.executionId ||
    (dispatch.generatedCopy.createdFromCandidateId !== null &&
      dispatch.generatedCopy.createdFromCandidateId !== context.candidateId)
  ) {
    throw reservationHandoffError(
      'Reserva comercial nao corresponde inequivocamente ao dispatch',
      'COMMERCIAL_DISPATCH_RESERVATION_OWNERSHIP_CONFLICT',
    );
  }

  const leaseExpiresAt = new Date(now.getTime() + reservationLeaseMilliseconds);
  const renewal = await campaigns.renewAttempt({
    campaignId: context.campaignId,
    executionId: run.executionId,
    renewedAt: now,
    leaseExpiresAt,
  });
  if (renewal.kind === 'CONFLICT') {
    throw reservationHandoffError(
      'Reserva comercial pertence a outro owner ou nao esta mais valida',
      'COMMERCIAL_DISPATCH_RESERVATION_CONFLICT',
    );
  }
};

export const processWhatsAppDispatchJob = async (
  job: Pick<Job<WhatsAppDispatchJob>, 'id' | 'name' | 'data'>,
  options: WhatsAppDispatchProcessorOptions,
) => {
  if (job.name !== JOB_NAMES.whatsappDispatch) return { skipped: true };

  const repositories =
    options.repositories ?? createPrismaRepositories(options.prisma);
  await renewCommercialReservationForDispatch({
    dispatchId: job.data.dispatchId,
    repositories,
    clock: options.clock ?? (() => new Date()),
    reservationLeaseMilliseconds: options.reservationLeaseMilliseconds,
  });
  options.whatsAppProvider.beginRun?.(job.id ?? job.data.dispatchId);
  const sender = createSenderService({
    repositories,
    whatsAppProvider: options.whatsAppProvider,
    logger: options.logger,
    messageBuilder: options.messageBuilder,
    groupSendPolicy: options.groupSendPolicy,
    draftService: options.draftService ?? new CommercialMessageDraftService(),
  });
  let dispatch;
  try {
    dispatch = await sender.sendDispatch(job.data.dispatchId);
  } catch (error) {
    const failedDispatch =
      await repositories.whatsappDispatches.findByIdWithDetails(
        job.data.dispatchId,
      );
    if (failedDispatch) {
      try {
        await finalizeCommercialPipelineRun({
          runs: repositories.commercialRuns,
          promotionCandidates: repositories.commercialPromotions,
          dispatch: failedDispatch,
          failed: true,
          logger: options.logger,
        });
      } catch (finalizationError) {
        options.logger.error(
          {
            event: 'commercial-pipeline.finalization.error',
            dispatchId: job.data.dispatchId,
            senderErrorType: errorType(error),
            senderErrorCode: errorCode(error),
            finalizationErrorType: errorType(finalizationError),
            finalizationErrorCode: errorCode(finalizationError),
          },
          'Commercial pipeline finalization failed',
        );
        throw preserveCause(finalizationError, error);
      }
    }
    throw error;
  }
  await finalizeCommercialPipelineRun({
    runs: repositories.commercialRuns,
    promotionCandidates: repositories.commercialPromotions,
    dispatch,
    failed: false,
    logger: options.logger,
  });
  return dispatch;
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
    reservationLeaseMilliseconds: options.reservationLeaseMilliseconds,
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
