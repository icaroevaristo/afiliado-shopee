export type CommercialLifecycleListInput = {
  page: number;
  limit: number;
  now: Date;
  todayStart: Date;
};

export type CommercialLifecycleExecutionRecord = {
  id: string;
  bullMqJobId: string | null;
  mode: string;
  status: string;
  externalStage: string;
  commercialRunId: string | null;
  failureCode: string | null;
  leaseExpiresAt: Date | null;
  startedAt: Date;
  completedAt: Date | null;
};

export type CommercialLifecycleRunRecord = {
  id: string;
  executionId: string | null;
  mode: string;
  status: string;
  productId: string | null;
  productName: string | null;
  productPrice: string | null;
  groupDestinationId: string | null;
  groupName: string | null;
  groupFingerprint: string | null;
  score: number | null;
  candidateCount: number;
  eligibleCount: number;
  rejectedCount: number;
  dispatchId: string | null;
  jobId: string | null;
  confirmedAt: Date | null;
  finalStatus: string | null;
  investigationRequired: boolean;
  failureCode: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

export type CommercialLifecycleCandidateRecord = {
  id: string;
  campaignId: string;
  campaignName: string;
  productId: string;
  productName: string;
  providerProductId: string;
  status: string;
  rankPosition: number | null;
  score: number;
  scorePolicyVersion: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CommercialLifecycleCopyRecord = {
  id: string;
  productId: string;
  snapshotId: string | null;
  createdFromCandidateId: string | null;
  source: string;
  createdAt: Date;
};

export type CommercialLifecycleCopyAttemptRecord = {
  id: string;
  status: string;
  failureCode: string | null;
  requestMayHaveStarted: boolean;
  startedAt: Date;
  completedAt: Date | null;
};

export type CommercialLifecycleDispatchRecord = {
  id: string;
  destinationId: string;
  destinationName: string;
  destinationFingerprint: string | null;
  status: string;
  attemptCount: number;
  externalMessageId: string | null;
  errorMessage: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CommercialLifecycleOutboxRecord = {
  id: string;
  dispatchId: string;
  jobId: string;
  status: string;
  failureCode: string | null;
  createdAt: Date;
  publishedAt: Date | null;
};

export type CommercialLifecycleReservationRecord = {
  campaignId: string;
  campaignName: string;
  attemptExecutionId: string | null;
  attemptReservedAt: Date | null;
  attemptLeaseExpiresAt: Date | null;
  state: 'ACTIVE' | 'EXPIRED' | 'ABSENT' | 'CONFLICT' | 'AMBIGUOUS' | 'UNKNOWN';
};

export type CommercialLifecycleRecoveryRecord = {
  id: string;
  dispatchId: string;
  runId: string;
  executionId: string;
  candidateId: string;
  campaignId: string;
  jobId: string;
  decision: string;
  attemptCountObserved: number;
  authorizedAt: Date;
  rearmedAt: Date | null;
  requeuedAt: Date | null;
};

export type CommercialLifecycleRecord = {
  lifecycleId: string;
  createdAt: Date;
  execution: CommercialLifecycleExecutionRecord | null;
  run: CommercialLifecycleRunRecord | null;
  candidate: CommercialLifecycleCandidateRecord | null;
  copy: CommercialLifecycleCopyRecord | null;
  copyAttempt: CommercialLifecycleCopyAttemptRecord | null;
  copyAttemptState: 'PRESENT' | 'ABSENT' | 'UNKNOWN';
  dispatch: CommercialLifecycleDispatchRecord | null;
  outbox: CommercialLifecycleOutboxRecord | null;
  reservation: CommercialLifecycleReservationRecord | null;
  recovery: CommercialLifecycleRecoveryRecord | null;
};

export type CommercialLifecycleSummaryRecord = {
  activeExecutions: number;
  sentToday: number;
  failed: number;
  ambiguous: number;
  investigationRequired: number;
  activeReservations: number;
  pendingDispatches: number;
  pendingOutboxes: number;
  manualRecoveries: number;
};

export type CommercialLifecycleListResult = {
  items: CommercialLifecycleRecord[];
  total: number;
  summary: CommercialLifecycleSummaryRecord;
};

export interface CommercialLifecycleRepository {
  list(
    input: CommercialLifecycleListInput,
  ): Promise<CommercialLifecycleListResult>;
}
