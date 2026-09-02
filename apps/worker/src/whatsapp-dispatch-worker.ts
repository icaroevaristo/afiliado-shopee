import type { Job } from 'bullmq';
import { UnrecoverableError, Worker } from 'bullmq';
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
import {
  ManualPublicationLifecycleFinalizer,
  type ManualPublicationLifecycleFinalizerPort,
} from '../../api/src/manual-publication-lifecycle-finalizer';
import { CommercialMessageDraftService } from '../../api/src/commercial-message-draft-service';
import type { ApplicationRepositories } from '../../api/src/application-services';
import {
  assertCommercialStickyIdentity,
  isCommercialInstanceAssigned,
} from '../../api/src/commercial-instance-stickiness';

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
  commercialDispatchOutboxes?: Pick<
    ApplicationRepositories['commercialDispatchOutboxes'],
    'findByDispatchId'
  >;
  manualPublicationRequests?: Pick<
    ApplicationRepositories['manualPublicationRequests'],
    'finalizeAfterCommercialDispatch'
  >;
  whatsappInstances?: Pick<
    ApplicationRepositories['whatsappInstances'],
    'findByName'
  >;
};

type WhatsAppDispatchProcessorBaseOptions = {
  logger: WhatsAppDispatchWorkerLogger;
  whatsAppProvider: WhatsAppProvider;
  commercialAutomationMode?: 'preview' | 'send';
  whatsAppProviderResolver?: (
    instanceName: string,
  ) => WhatsAppProvider | Promise<WhatsAppProvider>;
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
  manualLifecycleFinalizer?: ManualPublicationLifecycleFinalizerPort;
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

type WhatsAppDispatchJobInput = Pick<
  Job<WhatsAppDispatchJob>,
  'id' | 'name' | 'data'
> & {
  opts?: Pick<Job<WhatsAppDispatchJob>['opts'], 'attempts'>;
};

type CreateWhatsAppDispatchWorkerOptions = {
  connection?: ReturnType<typeof createRedisConnection>;
  prisma?: ReturnType<typeof createPrismaClient>;
  logger?: WhatsAppDispatchWorkerLogger;
  whatsAppProvider: WhatsAppProvider;
  commercialAutomationMode?: 'preview' | 'send';
  whatsAppProviderResolver?: (
    instanceName: string,
  ) => WhatsAppProvider | Promise<WhatsAppProvider>;
  messageBuilder?: WhatsAppDispatchProcessorOptions['messageBuilder'];
  groupSendPolicy?: WhatsAppGroupSendPolicy;
  draftService?: Pick<CommercialMessageDraftService, 'createDraft'>;
  reservationLeaseMilliseconds?: number;
  manualLifecycleFinalizer?: ManualPublicationLifecycleFinalizerPort;
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
    execution.commercialRunId !== run.id
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

const resolveCommercialDispatchProvider = async (input: {
  job: Pick<Job<WhatsAppDispatchJob>, 'data'>;
  repositories: WhatsAppDispatchProcessorRepositories;
  defaultProvider: WhatsAppProvider;
  providerResolver?: (
    instanceName: string,
  ) => WhatsAppProvider | Promise<WhatsAppProvider>;
}) => {
  const run = await input.repositories.commercialRuns.findByDispatchId(
    input.job.data.dispatchId,
  );
  if (!run) {
    if (input.job.data.instanceName) {
      throw reservationHandoffError(
        'Job comercial possui instancia sticky sem run associado',
        'COMMERCIAL_INSTANCE_LIFECYCLE_MISMATCH',
      );
    }
    return { provider: input.defaultProvider, instanceName: undefined };
  }
  const dispatch =
    await input.repositories.whatsappDispatches.findByIdWithDetails(
      input.job.data.dispatchId,
    );
  if (!dispatch) {
    throw reservationHandoffError(
      'Dispatch comercial nao encontrado para validar a instancia',
      'COMMERCIAL_INSTANCE_LIFECYCLE_MISMATCH',
    );
  }
  const outbox =
    await input.repositories.commercialDispatchOutboxes?.findByDispatchId?.(
      dispatch.id,
    );
  const stickyInstanceName = assertCommercialStickyIdentity({
    runInstanceName: run.instanceName,
    dispatchInstanceName: dispatch.instanceName,
    outboxInstanceName: outbox?.instanceName,
    jobInstanceName: input.job.data.instanceName,
  });
  if (!stickyInstanceName) {
    return { provider: input.defaultProvider, instanceName: undefined };
  }
  if (!outbox) {
    throw reservationHandoffError(
      'Outbox comercial ausente para lifecycle sticky',
      'COMMERCIAL_INSTANCE_LIFECYCLE_MISMATCH',
    );
  }
  if (outbox.commercialRunId !== run.id || outbox.dispatchId !== dispatch.id) {
    throw reservationHandoffError(
      'Outbox comercial nao pertence ao run/dispatch do lifecycle',
      'COMMERCIAL_INSTANCE_LIFECYCLE_MISMATCH',
    );
  }
  if (
    run.groupDestinationId !== dispatch.destinationId ||
    !isCommercialInstanceAssigned(dispatch.destination, stickyInstanceName)
  ) {
    throw reservationHandoffError(
      'Assignment da instancia mudou durante o lifecycle comercial',
      'COMMERCIAL_INSTANCE_ASSIGNMENT_CHANGED',
    );
  }
  const instance =
    await input.repositories.whatsappInstances?.findByName(stickyInstanceName);
  if (!instance || !instance.active || instance.paused === true) {
    throw reservationHandoffError(
      'Instancia do lifecycle comercial esta ausente ou inativa',
      'COMMERCIAL_INSTANCE_INACTIVE',
    );
  }
  if (!input.providerResolver) {
    throw reservationHandoffError(
      'Resolver de provider por instancia indisponivel',
      'COMMERCIAL_INSTANCE_PROVIDER_RESOLVER_UNAVAILABLE',
    );
  }
  return {
    provider: await input.providerResolver(stickyInstanceName),
    instanceName: stickyInstanceName,
  };
};

const revalidateCommercialDispatchBeforeSend = async (input: {
  job: Pick<Job<WhatsAppDispatchJob>, 'data'>;
  repositories: WhatsAppDispatchProcessorRepositories;
  resolvedProvider: {
    provider: WhatsAppProvider;
    instanceName: string | undefined;
  };
}) => {
  const revalidated = await resolveCommercialDispatchProvider({
    job: input.job,
    repositories: input.repositories,
    defaultProvider: input.resolvedProvider.provider,
    providerResolver: input.resolvedProvider.instanceName
      ? (instanceName) => {
          if (instanceName !== input.resolvedProvider.instanceName) {
            throw reservationHandoffError(
              'Instancia do provider mudou antes do envio comercial',
              'COMMERCIAL_INSTANCE_ASSIGNMENT_CHANGED',
            );
          }
          return input.resolvedProvider.provider;
        }
      : undefined,
  });
  if (revalidated.instanceName !== input.resolvedProvider.instanceName) {
    throw reservationHandoffError(
      'Identidade sticky mudou antes do envio comercial',
      'COMMERCIAL_INSTANCE_LIFECYCLE_MISMATCH',
    );
  }
};

export const processWhatsAppDispatchJob = async (
  job: WhatsAppDispatchJobInput,
  options: WhatsAppDispatchProcessorOptions,
) => {
  if (job.name !== JOB_NAMES.whatsappDispatch) return { skipped: true };

  if (options.commercialAutomationMode === 'preview') {
    options.logger.error(
      {
        event: 'commercial-dispatch.preview-fence-rejected',
        dispatchId: job.data.dispatchId,
        providerCallAllowed: false,
        retryAllowed: false,
        requeueAllowed: false,
      },
      'WhatsApp dispatch rejected before provider because preview mode is active',
    );
    throw new UnrecoverableError(
      'Dispatch WhatsApp comercial indisponivel em modo preview',
    );
  }

  const repositories =
    options.repositories ?? createPrismaRepositories(options.prisma);
  const commercialRun = await repositories.commercialRuns.findByDispatchId(
    job.data.dispatchId,
  );
  if (
    commercialRun?.mode === 'CONFIRMED' &&
    job.opts?.attempts !== undefined &&
    job.opts.attempts > 1
  ) {
    options.logger.error(
      {
        event: 'commercial-dispatch.attempt-policy-rejected',
        dispatchId: job.data.dispatchId,
        configuredAttempts: job.opts.attempts,
        providerCallAllowed: false,
        retryAllowed: false,
        requeueAllowed: false,
      },
      'Commercial dispatch job rejected before provider because attempts exceed one',
    );
    throw new UnrecoverableError(
      'Dispatch comercial exige exatamente uma tentativa BullMQ',
    );
  }
  const clock = options.clock ?? (() => new Date());
  const supportsLifecycleTransactions =
    !options.prisma || typeof options.prisma.$transaction === 'function';
  const finalizeAfterCommercialDispatch = supportsLifecycleTransactions
    ? repositories.manualPublicationRequests?.finalizeAfterCommercialDispatch
    : undefined;
  const manualLifecycleFinalizer =
    options.manualLifecycleFinalizer ??
    (finalizeAfterCommercialDispatch
      ? new ManualPublicationLifecycleFinalizer(
          {
            finalizeAfterCommercialDispatch:
              finalizeAfterCommercialDispatch.bind(
                repositories.manualPublicationRequests,
              ),
          },
          { clock, logger: options.logger },
        )
      : undefined);
  const finalizeManualLifecycle = async (
    dispatchId: string,
    providerAlreadyCalled: boolean,
  ) => {
    if (!manualLifecycleFinalizer) return;
    try {
      await manualLifecycleFinalizer.finalizeAfterDispatch(dispatchId);
    } catch (error) {
      options.logger.error(
        {
          event: providerAlreadyCalled
            ? 'manual-publication.lifecycle.finalization.failed-after-send'
            : 'manual-publication.lifecycle.finalization.failed-after-provider-error',
          dispatchId,
          providerAlreadyCalled,
          providerRetryAllowed: false,
          requeueAllowed: false,
          errorType: errorType(error),
          errorCode: errorCode(error),
        },
        providerAlreadyCalled
          ? 'Manual publication lifecycle finalization failed after dispatch SENT'
          : 'Manual publication lifecycle finalization failed after provider error',
      );
      throw error;
    }
  };
  const resolvedProvider = await resolveCommercialDispatchProvider({
    job,
    repositories,
    defaultProvider: options.whatsAppProvider,
    providerResolver: options.whatsAppProviderResolver,
  });
  await renewCommercialReservationForDispatch({
    dispatchId: job.data.dispatchId,
    repositories,
    clock,
    reservationLeaseMilliseconds: options.reservationLeaseMilliseconds,
  });
  const sender = createSenderService({
    repositories,
    whatsAppProvider: resolvedProvider.provider,
    instanceName: resolvedProvider.instanceName,
    logger: options.logger,
    messageBuilder: options.messageBuilder,
    groupSendPolicy: options.groupSendPolicy,
    draftService: options.draftService ?? new CommercialMessageDraftService(),
  });
  await revalidateCommercialDispatchBeforeSend({
    job,
    repositories,
    resolvedProvider,
  });
  resolvedProvider.provider.beginRun?.(job.id ?? job.data.dispatchId);
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
      if (manualLifecycleFinalizer) {
        try {
          await finalizeManualLifecycle(
            failedDispatch.id,
            failedDispatch.status !== 'PENDING',
          );
        } catch (manualFinalizationError) {
          options.logger.error(
            {
              event:
                'manual-publication.lifecycle.finalization.failure-path-preserved',
              dispatchId: failedDispatch.id,
              senderErrorType: errorType(error),
              senderErrorCode: errorCode(error),
              finalizationErrorType: errorType(manualFinalizationError),
              finalizationErrorCode: errorCode(manualFinalizationError),
              providerRetryAllowed: false,
              requeueAllowed: false,
            },
            'Manual publication lifecycle finalization failed after provider error',
          );
        }
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
  await finalizeManualLifecycle(dispatch.id, true);
  return dispatch;
};

export const createWhatsAppDispatchWorker = (
  redisUrl: string,
  options: CreateWhatsAppDispatchWorkerOptions,
) => {
  if (options.commercialAutomationMode === 'preview') {
    throw new AppError(
      'O worker de dispatch WhatsApp nao pode iniciar em modo preview',
      'WHATSAPP_DISPATCH_WORKER_PREVIEW_MODE_FORBIDDEN',
    );
  }
  const ownsConnection = !options.connection;
  const ownsPrisma = !options.prisma;
  const connection = options.connection ?? createRedisConnection(redisUrl);
  const prisma = options.prisma ?? createPrismaClient();
  const processorOptions: WhatsAppDispatchProcessorOptions = {
    prisma,
    logger: options.logger ?? consoleLogger,
    commercialAutomationMode: options.commercialAutomationMode,
    whatsAppProvider: options.whatsAppProvider,
    whatsAppProviderResolver: options.whatsAppProviderResolver,
    messageBuilder: options.messageBuilder,
    groupSendPolicy: options.groupSendPolicy,
    draftService: options.draftService,
    reservationLeaseMilliseconds: options.reservationLeaseMilliseconds,
    manualLifecycleFinalizer: options.manualLifecycleFinalizer,
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
