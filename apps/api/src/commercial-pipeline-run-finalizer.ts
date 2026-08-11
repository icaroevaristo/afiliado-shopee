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
    'markDispatchedByGeneratedCopyId' | 'markBlockedByGeneratedCopyId'
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

  if (sent && promotionCandidates) {
    await promotionCandidates.markDispatchedByGeneratedCopyId(
      dispatch.generatedCopyId,
    );
  }
  if (failedSafely && promotionCandidates) {
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
