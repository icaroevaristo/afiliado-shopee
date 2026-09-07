export type CommercialPreparedRecoveryEvidence = {
  runMode: 'DRY_RUN' | 'CONFIRMED';
  dispatchId: string | null;
  dispatchExists: boolean;
  outboxExists: boolean;
};

export type CommercialPreparedRecoveryDecision = 'REOPEN_READY' | 'CLOSE_DISPATCHED';

export const decideCommercialPreparedRecovery = (
  evidence: CommercialPreparedRecoveryEvidence,
): CommercialPreparedRecoveryDecision =>
  evidence.runMode === 'CONFIRMED' ||
  evidence.dispatchId !== null ||
  evidence.dispatchExists ||
  evidence.outboxExists
    ? 'CLOSE_DISPATCHED'
    : 'REOPEN_READY';
