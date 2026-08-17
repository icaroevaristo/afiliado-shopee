import type { FastifyBaseLogger } from 'fastify';

import type {
  CommercialPromotionCandidateRepository,
  CommercialPipelineRunRepository,
  CommercialPipelineRunFinalizationRepository,
  WhatsAppDispatchRecord,
} from './repositories';

export const finalizeCommercialPipelineRun = async ({
  runs,
  promotionCandidates,
  dispatch,
  failed,
  logger,
  clock = () => new Date(),
}: {
  runs: CommercialPipelineRunRepository &
    CommercialPipelineRunFinalizationRepository;
  promotionCandidates?: Pick<
    CommercialPromotionCandidateRepository,
    | 'markDispatchedByGeneratedCopyId'
    | 'markBlockedByGeneratedCopyId'
    | 'resetCampaignFailureStateByGeneratedCopyId'
    | 'findAttemptContextByGeneratedCopyId'
    | 'releaseAttempt'
  >;
  dispatch: WhatsAppDispatchRecord;
  failed: boolean;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
  clock?: () => Date;
}) => {
  const finalization = await runs.finalizeByDispatchId(
    dispatch.id,
    clock(),
  );
  if (!finalization) return;

  const sent = finalization.kind === 'SENT';
  const failedSafely = finalization.kind === 'FAILED';
  const run = sent ? await runs.findByDispatchId(dispatch.id) : null;

  if (sent && promotionCandidates) {

    if (!run) {
      logger.error(
        {
          event: 'commercial-pipeline.attempt-release.blocked',
          dispatchId: dispatch.id,
          reason: 'RUN_LINK_MISSING',
        },
        'Commercial pipeline attempt release blocked',
      );
    } else if (run.executionId === null) {
      await promotionCandidates.markDispatchedByGeneratedCopyId(
        dispatch.generatedCopyId,
      );
      await promotionCandidates.resetCampaignFailureStateByGeneratedCopyId(
        dispatch.generatedCopyId,
      );
    } else if (!run.executionId) {
      logger.error(
        {
          event: 'commercial-pipeline.attempt-release.blocked',
          dispatchId: dispatch.id,
          runId: run.id,
          reason: 'EXECUTION_LINK_MISSING',
        },
        'Commercial pipeline attempt release blocked',
      );
    } else {
      const findExecutionById = runs.findExecutionById;
      const findAttemptContext =
        promotionCandidates.findAttemptContextByGeneratedCopyId;
      const releaseAttempt = promotionCandidates.releaseAttempt;
      const logBlocked = (reason: string, campaignId?: string) =>
        logger.error(
          {
            event: 'commercial-pipeline.attempt-release.blocked',
            dispatchId: dispatch.id,
            runId: run.id,
            executionId: run.executionId,
            ...(campaignId ? { campaignId } : {}),
            reason,
          },
          'Commercial pipeline attempt release blocked',
        );

      if (!findExecutionById || !findAttemptContext || !releaseAttempt) {
        logBlocked('RESERVATION_CONTRACT_UNAVAILABLE');
      } else {
        const execution = await findExecutionById(run.executionId);
        if (!execution || execution.id !== run.executionId) {
          logBlocked('EXECUTION_LINK_MISSING');
        } else if (execution.commercialRunId !== run.id) {
          logBlocked('EXECUTION_RUN_LINK_MISMATCH');
        } else {
          const context = await findAttemptContext(dispatch.generatedCopyId);
          if (context.kind !== 'FOUND') {
            logBlocked(
              context.kind === 'AMBIGUOUS'
                ? 'CANDIDATE_LINK_AMBIGUOUS'
                : 'CANDIDATE_LINK_MISSING',
            );
          } else if (context.attemptExecutionId !== run.executionId) {
            logBlocked('RESERVATION_OWNER_MISMATCH', context.campaignId);
          } else {
            const dispatched =
              await promotionCandidates.markDispatchedByGeneratedCopyId(
                dispatch.generatedCopyId,
              );
            if (
              dispatched.kind !== 'DISPATCHED' ||
              dispatched.candidateId !== context.candidateId
            ) {
              logBlocked('CANDIDATE_LINK_MISMATCH', context.campaignId);
            } else if (dispatched.campaignId !== context.campaignId) {
              logBlocked('CAMPAIGN_LINK_MISMATCH', context.campaignId);
            } else {
              const reset =
                await promotionCandidates.resetCampaignFailureStateByGeneratedCopyId(
                  dispatch.generatedCopyId,
                  {
                    campaignId: context.campaignId,
                    executionId: run.executionId,
                  },
                );
              if (
                reset.kind !== 'RESET' ||
                reset.campaignId !== context.campaignId
              ) {
                logBlocked('CAMPAIGN_LINK_MISMATCH', context.campaignId);
              } else {
                const release = await releaseAttempt({
                  campaignId: context.campaignId,
                  executionId: run.executionId,
                });
                if (release.kind === 'CONFLICT') {
                  logBlocked('RESERVATION_OWNER_MISMATCH', context.campaignId);
                }
              }
            }
          }
        }
      }
    }
  }  if (failedSafely && promotionCandidates) {
    await promotionCandidates.markBlockedByGeneratedCopyId(
      dispatch.generatedCopyId,
    );
  }
  (sent ? logger.info : logger.error)(
    {
      event: sent
        ? 'commercial-pipeline.finalization.sent'
        : 'commercial-pipeline.finalization.failed',
      dispatchId: dispatch.id,
      dispatchStatus: dispatch.status,
      attemptCount: dispatch.attemptCount,
      failureObserved: failed,
      investigationRequired: finalization.kind === 'AMBIGUOUS',
    },
    sent
      ? 'Commercial pipeline dispatch sent'
      : failedSafely
        ? 'Commercial pipeline dispatch failed safely'
        : 'Commercial pipeline dispatch requires investigation',
  );
};
