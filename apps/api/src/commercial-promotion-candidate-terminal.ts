export const COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED =
  'COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED';

export const COMMERCIAL_PROMOTION_TERMINAL_CANDIDATE_BLOCK_REASONS = [
  'COMMERCIAL_AI_COPY_OUTPUT_INVALID',
  COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED,
] as const;

export type CommercialPromotionTerminalCandidateBlockReason =
  (typeof COMMERCIAL_PROMOTION_TERMINAL_CANDIDATE_BLOCK_REASONS)[number];

export const isCommercialPromotionTerminalCandidateBlockReason = (
  reason: string | null | undefined,
): reason is CommercialPromotionTerminalCandidateBlockReason =>
  (COMMERCIAL_PROMOTION_TERMINAL_CANDIDATE_BLOCK_REASONS as readonly string[]).includes(
    reason ?? '',
  );

export const isCommercialPromotionTerminalCandidateForSnapshot = (input: {
  status: string;
  blockedReason: string | null | undefined;
  currentSnapshotId: string;
  nextSnapshotId: string;
}) =>
  input.status === 'BLOCKED' &&
  isCommercialPromotionTerminalCandidateBlockReason(input.blockedReason) &&
  input.currentSnapshotId === input.nextSnapshotId;

export const canReactivateCommercialPromotionCandidate = (input: {
  status: string;
  blockedReason: string | null | undefined;
  currentSnapshotId: string;
  nextSnapshotId: string;
}) => {
  if (input.status === 'BLOCKED') {
    return !isCommercialPromotionTerminalCandidateForSnapshot(input);
  }
  return input.status === 'EXPIRED' || input.status === 'DISPATCHED';
};
