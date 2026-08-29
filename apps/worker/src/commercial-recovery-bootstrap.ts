import type { AppEnv } from '@shopee-auto-affiliate-ai/config';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import {
  createWhatsAppDispatchQueue,
  enqueueControlledWhatsAppDispatch,
} from '@shopee-auto-affiliate-ai/queue';

import { createPrismaRepositories } from '../../api/src/application-services';
import { CommercialDispatchOutboxPublisher } from '../../api/src/commercial-dispatch-outbox-publisher';
import { CommercialAutomationExecutionRecoveryService } from '../../api/src/commercial-automation-execution-recovery-service';
import {
  CommercialRecoveryCoordinator,
  type CommercialRecoveryQueue,
} from '../../api/src/commercial-recovery-coordinator';
import { finalizeCommercialPipelineRun } from '../../api/src/commercial-pipeline-run-finalizer';
import { ManualPublicationLifecycleFinalizer } from '../../api/src/manual-publication-lifecycle-finalizer';
import type { CommercialAutomationRuntimeLogger } from './commercial-automation-runtime';

const recoveryLogger = (logger: CommercialAutomationRuntimeLogger) => ({
  info: (data: Record<string, unknown>, message?: string) =>
    logger.info(data, message),
  error: (data: Record<string, unknown>, message?: string) =>
    logger.error(data, message),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const createCommercialRecoveryQueue = (
  queue: ReturnType<typeof createWhatsAppDispatchQueue>,
): CommercialRecoveryQueue => ({
  hasJob: async (jobId) => Boolean(await queue.getJob(jobId)),
  getJob: async (jobId) => {
    const job = await queue.getJob(jobId);
    if (!job || !isRecord(job.data) || typeof job.data.dispatchId !== 'string') {
      return null;
    }
    return {
      id: String(job.id ?? jobId),
      dispatchId: job.data.dispatchId,
      ...(typeof job.data.instanceName === 'string'
        ? { instanceName: job.data.instanceName }
        : {}),
    };
  },
  enqueue: async (dispatchId, jobId, instanceName) => {
    await enqueueControlledWhatsAppDispatch(
      queue,
      { dispatchId, ...(instanceName ? { instanceName } : {}) },
      jobId,
    );
  },
});

export const createCommercialRecoveryCoordinator = (input: {
  config: AppEnv;
  prisma: ReturnType<typeof createPrismaClient>;
  queue?: CommercialRecoveryQueue;
  logger: CommercialAutomationRuntimeLogger;
}) => {
  const repositories = createPrismaRepositories(input.prisma);
  const logger = recoveryLogger(input.logger);
  const publisher = input.queue
    ? new CommercialDispatchOutboxPublisher({
        outboxes: repositories.commercialDispatchOutboxes,
        queue: input.queue,
        logger,
      })
    : undefined;
  const recoveryService = new CommercialAutomationExecutionRecoveryService({
    executions: repositories.commercialAutomationExecutions,
    jobs: {
      async findJob(jobId) {
        const job = input.queue?.getJob
          ? await input.queue.getJob(jobId)
          : null;
        return job
          ? {
              id: job.id,
              dispatchId: job.dispatchId,
              ...(job.instanceName ? { instanceName: job.instanceName } : {}),
            }
          : null;
      },
    },
    instances: repositories.whatsappInstances,
    minimumIntervalMinutes: input.config.COMMERCIAL_MIN_INTERVAL_MINUTES,
  });
  const manualFinalizerMethod =
    repositories.manualPublicationRequests.finalizeAfterCommercialDispatch;
  const manualFinalizer = manualFinalizerMethod
    ? new ManualPublicationLifecycleFinalizer(
        {
          finalizeAfterCommercialDispatch: manualFinalizerMethod.bind(
            repositories.manualPublicationRequests,
          ),
        },
        { logger: input.logger },
      )
    : undefined;

  return new CommercialRecoveryCoordinator({
    settings: repositories.commercialAutomationSettings,
    executions: repositories.commercialAutomationExecutions,
    outboxes: repositories.commercialDispatchOutboxes,
    queue: input.queue,
    recoverExecution: (executionId) => recoveryService.recover(executionId),
    publishOutbox: publisher
      ? async (outboxId) => {
          const before = await repositories.commercialDispatchOutboxes.findById(
            outboxId,
          );
          const existingJob =
            before && input.queue?.getJob
              ? await input.queue.getJob(before.jobId)
              : null;
          const published = await publisher.publish(outboxId);
          let jobCreated = false;
          if (!existingJob && input.queue?.getJob) {
            const after = await repositories.commercialDispatchOutboxes.findById(
              outboxId,
            );
            if (after) jobCreated = Boolean(await input.queue.getJob(after.jobId));
          }
          return {
            outbox: published,
            jobCreated,
            jobReused: Boolean(existingJob),
          };
        }
      : undefined,
    finalizeAfterDispatch: async (dispatchId) => {
      const dispatch = await repositories.whatsappDispatches.findByIdWithDetails(
        dispatchId,
      );
      if (!dispatch) {
        throw new Error('Dispatch comercial ausente durante o recovery');
      }
      await finalizeCommercialPipelineRun({
        runs: repositories.commercialRuns,
        promotionCandidates: repositories.commercialPromotions,
        dispatch,
        failed: false,
        logger: input.logger,
      });
      if (manualFinalizer) {
        await manualFinalizer.finalizeAfterDispatch(dispatchId);
      }
    },
    logger,
  });
};
