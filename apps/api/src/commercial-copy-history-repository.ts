export type CommercialCopyHistoryAttempt = {
  id: string;
  candidateId: string;
  snapshotId: string;
  inputFingerprint: string;
  provider: string;
  model: string;
  promptVersion: string;
  validationVersion: string;
  status: string;
  generatedCopyId: string | null;
  failureCode: string | null;
  validationFailureCodes: string[];
  requestMayHaveStarted: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
};

export type CommercialCopyHistoryCandidate = {
  id: string;
  campaignId: string;
  campaignName: string;
  productId: string;
  productName: string;
  status: string;
};

export type CommercialCopyHistoryDispatch = {
  id: string;
  status: string;
  runId: string | null;
  runStatus: string | null;
  finalStatus: string | null;
};

export type CommercialCopyHistoryCopy = {
  id: string;
  productId: string;
  productName: string;
  source: string;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  validationVersion: string | null;
  inputFingerprint: string | null;
  snapshotId: string | null;
  createdFromCandidateId: string | null;
  usageInputTokens: number | null;
  usageOutputTokens: number | null;
  usageTotalTokens: number | null;
  createdAt: Date;
  candidate: CommercialCopyHistoryCandidate | null;
  attempts: CommercialCopyHistoryAttempt[];
  dispatches: CommercialCopyHistoryDispatch[];
};

export type CommercialCopyHistoryRecord =
  | {
      kind: 'COPY';
      id: string;
      createdAt: Date;
      copy: CommercialCopyHistoryCopy;
      attempt: null;
      candidate: CommercialCopyHistoryCandidate | null;
    }
  | {
      kind: 'ATTEMPT';
      id: string;
      createdAt: Date;
      copy: null;
      attempt: CommercialCopyHistoryAttempt;
      candidate: CommercialCopyHistoryCandidate;
    };

export type CommercialCopyHistoryListInput = {
  page: number;
  limit: number;
};

export type CommercialCopyHistoryListResult = {
  items: CommercialCopyHistoryRecord[];
  total: number;
};

export interface CommercialCopyHistoryRepository {
  list(
    input: CommercialCopyHistoryListInput,
  ): Promise<CommercialCopyHistoryListResult>;
}
