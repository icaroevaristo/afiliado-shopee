import type { Product } from '@shopee-auto-affiliate-ai/shared';
import type {
  ShopeeAffiliateOfferSource,
  ShopeeProductOffer,
} from '@shopee-auto-affiliate-ai/providers';

export const APPROVED_PRODUCT_MIN_SCORE = 70;

export type AnalyticsSnapshot = {
  totalProducts: number;
  totalApprovedProducts: number;
  totalGeneratedCopies: number;
  totalQueuedDispatches: number;
  totalSentDispatches: number;
  totalFailedDispatches: number;
  totalActiveDestinations: number;
};

export interface AnalyticsRepository {
  totalProducts(): Promise<number>;
  totalApprovedProducts(): Promise<number>;
  totalGeneratedCopies(): Promise<number>;
  totalQueuedDispatches(): Promise<number>;
  totalSentDispatches(): Promise<number>;
  totalFailedDispatches(): Promise<number>;
  totalActiveDestinations(): Promise<number>;
}

export type ProductLeadData = {
  providerProductId: string;
  nome: string;
  categoria: string;
  preco: number;
  desconto: number;
  nota: number;
  vendidos: number;
  comissao: number;
  loja: string;
  urlImagem: string;
  url?: string | null;
  title: string;
};

export type ProductLeadRecord = ProductLeadData & {
  id: string;
  source?: ShopeeAffiliateOfferSource;
  affiliateLink?: string | null;
  shopId?: string | null;
  shopType?: number[];
  categoryIds?: string[];
  commissionAmount?: string | null;
  sellerCommissionRate?: number | null;
  shopeeCommissionRate?: number | null;
  offerStartsAt?: Date | null;
  offerEndsAt?: Date | null;
  fetchedAt?: Date;
  lastSeenAt?: Date;
  unavailableAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  score?: number | null;
  scoreUpdatedAt?: Date | null;
};

export type ShopeeOfferStatus = 'ACTIVE' | 'EXPIRED' | 'UNAVAILABLE';

export type ShopeeOfferRecord = ShopeeProductOffer & {
  id: string;
  score: number | null;
  scoreUpdatedAt: Date | null;
  lastSeenAt: Date;
  unavailableAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type OfficialOfferSnapshotUpsertResult = {
  product: ShopeeOfferRecord;
  productAction: 'created' | 'updated';
  commercialStateChanged: boolean;
  snapshotCreated: boolean;
  snapshotRevision: number;
};

export type ShopeeOfferFilters = {
  source?: ShopeeAffiliateOfferSource;
  status?: ShopeeOfferStatus;
  affiliateLink?: 'present' | 'missing';
  keyword?: string;
  page: number;
  limit: number;
};

export type CommercialOfferCandidateFilters = {
  source: ShopeeAffiliateOfferSource;
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  minDiscountRate?: number;
  minRating?: number;
  minSales?: number;
  minCommissionRate?: number;
  limit: number;
};

export interface ShopeeOfferRepository {
  findBySourceAndProviderProductId(
    source: ShopeeAffiliateOfferSource,
    providerProductId: string,
  ): Promise<Pick<ShopeeOfferRecord, 'id'> | null>;
  createOffer(offer: ShopeeProductOffer): Promise<ShopeeOfferRecord>;
  updateOffer(
    id: string,
    offer: ShopeeProductOffer,
  ): Promise<ShopeeOfferRecord>;
  upsertOfficialOfferWithSnapshot(
    offer: ShopeeProductOffer,
  ): Promise<OfficialOfferSnapshotUpsertResult>;
  findOfferById(id: string): Promise<ShopeeOfferRecord | null>;
  listOffers(
    filters: ShopeeOfferFilters,
  ): Promise<{ items: ShopeeOfferRecord[]; total: number }>;
  listCommercialCandidates(
    filters: CommercialOfferCandidateFilters,
  ): Promise<ShopeeOfferRecord[]>;
}

export interface CommercialOfferSnapshotBackfillRepository {
  countOfficialProducts(): Promise<number>;
  countOfficialProductsPendingSnapshot(): Promise<number>;
  listOfficialProductIdsPendingSnapshot(limit: number): Promise<string[]>;
  initializeOfficialProductSnapshot(productId: string): Promise<boolean>;
}

export type CommercialPipelineRunMode = 'DRY_RUN' | 'CONFIRMED';
export type CommercialPipelineRunStatus =
  'STARTED' | 'COMPLETED' | 'BLOCKED' | 'FAILED';
export type CommercialPipelineFinalStatus =
  'PENDING' | 'SENT' | 'FAILED' | 'AMBIGUOUS';

export type CommercialPipelineRejectionCode =
  | 'MISSING_AFFILIATE_LINK'
  | 'INVALID_AFFILIATE_LINK'
  | 'OFFER_EXPIRED'
  | 'OFFER_UNAVAILABLE'
  | 'OFFER_NOT_STARTED'
  | 'INVALID_PRODUCT_NAME'
  | 'INVALID_PRICE'
  | 'INVALID_IMAGE'
  | 'INVALID_SHOP'
  | 'INVALID_RATING'
  | 'INVALID_SALES'
  | 'INVALID_COMMISSION_RATE'
  | 'SCORE_BELOW_MINIMUM'
  | 'ALREADY_SENT_TO_GROUP';

export type CommercialOfferScorePolicyVersion = 'legacy-v1' | 'official-v2';

export type CommercialPipelineScoreBreakdown = {
  policyVersion: CommercialOfferScorePolicyVersion;
  rawTotal: number;
  finalScore: number;
  components: Record<string, number>;
};

export type CommercialPipelineRunData = {
  mode: CommercialPipelineRunMode;
  status: CommercialPipelineRunStatus;
  executionId?: string | null;
  instanceName?: string | null;
  productId?: string | null;
  groupDestinationId?: string | null;
  productName?: string | null;
  productPrice?: string | null;
  groupName?: string | null;
  groupFingerprint?: string | null;
  score?: number | null;
  scorePolicyVersion?: CommercialOfferScorePolicyVersion | null;
  minimumScoreUsed?: number | null;
  maximumScoreObserved?: number | null;
  selectedScoreBreakdown?: CommercialPipelineScoreBreakdown | null;
  candidateCount: number;
  eligibleCount: number;
  rejectedCount: number;
  rejectionSummary: Record<string, number>;
  selectionReasons: string[];
  copyPreview?: string | null;
  plannedSubIds: string[];
  dispatchId?: string | null;
  jobId?: string | null;
  confirmedAt?: Date | null;
  finalStatus?: CommercialPipelineFinalStatus | null;
  investigationRequired?: boolean;
  failureCode?: string | null;
  createdAt?: Date;
  completedAt?: Date | null;
};

export type CommercialPipelineRunRecord = CommercialPipelineRunData & {
  id: string;
  createdAt: Date;
};

export type CommercialPipelineRunFilters = {
  status?: CommercialPipelineRunStatus;
  mode?: CommercialPipelineRunMode;
  productId?: string;
  page: number;
  limit: number;
};

export interface CommercialPipelineRunRepository {
  create(data: CommercialPipelineRunData): Promise<CommercialPipelineRunRecord>;
  update(
    id: string,
    data: Partial<CommercialPipelineRunData>,
  ): Promise<CommercialPipelineRunRecord>;
  list(
    filters: CommercialPipelineRunFilters,
  ): Promise<{ items: CommercialPipelineRunRecord[]; total: number }>;
  findById(id: string): Promise<CommercialPipelineRunRecord | null>;
  findByDispatchId(
    dispatchId: string,
  ): Promise<CommercialPipelineRunRecord | null>;
  findExecutionById?(id: string): Promise<{
    id: string;
    commercialRunId: string | null;
  } | null>;
}

export type CommercialPipelineRunFinalizationKind =
  | 'SENT'
  | 'FAILED'
  | 'AMBIGUOUS';

export type CommercialPipelineRunFinalization = {
  kind: CommercialPipelineRunFinalizationKind;
  transitioned: boolean;
};

export interface CommercialPipelineRunFinalizationRepository {
  finalizeByDispatchId(
    dispatchId: string,
    completedAt: Date,
  ): Promise<CommercialPipelineRunFinalization | null>;
}

export interface CommercialDeliveryHistoryRepository {
  wasProductSentToGroup(productId: string, groupId: string): Promise<boolean>;
  findLastSentAtByGroup(groupId: string): Promise<Date | null>;
}

export type CommercialDispatchOutboxStatus =
  'PENDING' | 'PUBLISHED' | 'AMBIGUOUS';

export type CommercialDispatchOutboxRecord = {
  id: string;
  commercialRunId: string;
  dispatchId: string;
  jobId: string;
  instanceName: string | null;
  status: CommercialDispatchOutboxStatus;
  failureCode: string | null;
  createdAt: Date;
  publishedAt: Date | null;
};

export type CommercialDispatchOutboxFilters = {
  status?: CommercialDispatchOutboxStatus;
  page: number;
  limit: number;
};

export type CommercialDispatchOutboxPublicationContext = {
  outbox: CommercialDispatchOutboxRecord;
  run: Pick<
    CommercialPipelineRunRecord,
    | 'id'
    | 'mode'
    | 'status'
    | 'dispatchId'
    | 'jobId'
    | 'instanceName'
    | 'finalStatus'
    | 'investigationRequired'
  >;
  dispatch: Pick<
    WhatsAppDispatchRecord,
    'id' | 'status' | 'attemptCount' | 'instanceName'
  >;
};

type CommercialConfirmationPersistenceInputBase = {
  outboxId: string;
  runId: string;
  confirmedAt: Date;
  dispatch: WhatsAppDispatchCreateData & { id: string };
  jobId: string;
  instanceName?: string | null;
};

export type CommercialConfirmationPersistenceInput =
  | (CommercialConfirmationPersistenceInputBase & {
      copy: GeneratedCopyData & { id: string };
      existingGeneratedCopyId?: never;
    })
  | (CommercialConfirmationPersistenceInputBase & {
      existingGeneratedCopyId: string;
      copy?: never;
    });

export interface CommercialDispatchOutboxRepository {
  createPendingConfirmation(
    input: CommercialConfirmationPersistenceInput,
  ): Promise<CommercialDispatchOutboxRecord | null>;
  list(
    filters: CommercialDispatchOutboxFilters,
  ): Promise<{ items: CommercialDispatchOutboxRecord[]; total: number }>;
  findById(id: string): Promise<CommercialDispatchOutboxRecord | null>;
  findByDispatchId?(
    dispatchId: string,
  ): Promise<CommercialDispatchOutboxRecord | null>;
  findPublicationContext(
    id: string,
  ): Promise<CommercialDispatchOutboxPublicationContext | null>;
  markPublished(
    id: string,
    publishedAt: Date,
  ): Promise<CommercialDispatchOutboxRecord | null>;
  markAmbiguous(
    id: string,
    failureCode: string,
    completedAt: Date,
  ): Promise<CommercialDispatchOutboxRecord | null>;
}

export type CommercialAutomationSettingsRecord = {
  paused: boolean;
  pausedAt: Date | null;
  resumedAt: Date | null;
  updatedAt: Date;
};

export interface CommercialAutomationSettingsRepository {
  get(): Promise<CommercialAutomationSettingsRecord | null>;
  getOrCreate(now: Date): Promise<CommercialAutomationSettingsRecord>;
  setPaused(
    paused: boolean,
    now: Date,
  ): Promise<CommercialAutomationSettingsRecord>;
}

export type CommercialAutomationHistorySnapshot = {
  globalSentToday: number;
  groupSentToday: number;
  lastSentAt: Date | null;
  globalLastSentAt?: Date | null;
  groupLastSentAt?: Date | null;
};

export type CommercialAutomationTarget = {
  groupId: string;
  groupName: string;
  instanceName?: string;
  logicalGroupFingerprint: string;
  campaignId: string;
  nicheId: string;
  dailyLimit: number;
  failureCount?: number;
  nextEligibleAt?: Date | null;
};

export interface CommercialAutomationHistoryRepository {
  getSnapshot(input: {
    groupId?: string;
    dayStartsAt: Date;
    dayEndsAt: Date;
  }): Promise<CommercialAutomationHistorySnapshot>;
  hasAmbiguousCommercialExecution(excludedRunId?: string): Promise<boolean>;
  hasActiveCommercialExecution(
    now: Date,
    excludedExecutionId?: string,
    excludedRunId?: string,
  ): Promise<boolean>;
  hasStaleCommercialExecution(now: Date): Promise<boolean>;
}

export type CommercialAutomationExecutionMode = 'PREVIEW' | 'SEND';
export type CommercialAutomationExecutionStatus =
  'STARTED' | 'BLOCKED' | 'PREVIEW_READY' | 'QUEUED' | 'FAILED' | 'AMBIGUOUS';
export type CommercialAutomationExecutionExternalStage =
  | 'NOT_REACHED'
  | 'EXTERNAL_MAY_HAVE_STARTED';

export type CommercialAutomationExecutionRecord = {
  id: string;
  schedulerJobId: string;
  bullMqJobId: string | null;
  activeKey: string | null;
  ownerId: string | null;
  heartbeatAt: Date | null;
  leaseExpiresAt: Date | null;
  mode: CommercialAutomationExecutionMode;
  status: CommercialAutomationExecutionStatus;
  externalStage: CommercialAutomationExecutionExternalStage;
  reasons: string[];
  commercialRunId: string | null;
  failureCode: string | null;
  startedAt: Date;
  completedAt: Date | null;
};

export type CommercialAutomationExecutionOwnership = {
  executionId: string;
  ownerId: string;
};

export type CommercialAutomationExecutionRecoveryContext = {
  execution: CommercialAutomationExecutionRecord;
  run:
    | (Pick<
        CommercialPipelineRunRecord,
        | 'id'
        | 'mode'
        | 'dispatchId'
        | 'jobId'
        | 'instanceName'
        | 'finalStatus'
        | 'investigationRequired'
      > & {
        dispatch: Pick<
          WhatsAppDispatchRecord,
          'id' | 'status' | 'attemptCount' | 'instanceName'
        > & {
          destinationId?: string;
          destinationType?: 'INDIVIDUAL' | 'GROUP';
          destinationAssignedInstanceName?: string | null;
        } | null;
        outbox: CommercialDispatchOutboxRecord | null;
      })
    | null;
};

export type CommercialPreMarkerReservationRecoveryResult =
  | {
      outcome: 'RECOVERED';
      execution: CommercialAutomationExecutionRecord;
      campaignId: string;
      failureCount: number;
      nextEligibleAt: Date;
    }
  | {
      outcome: 'ALREADY_RECOVERED';
      execution: CommercialAutomationExecutionRecord;
    }
  | {
      outcome: 'BLOCKED';
      reason:
        | 'INVALID_MINIMUM_INTERVAL'
        | 'EXECUTION_NOT_FOUND'
        | 'EXECUTION_NOT_STARTED'
        | 'EXECUTION_OWNERSHIP_INCOMPLETE'
        | 'EXECUTION_NOT_STALE'
        | 'EXTERNAL_STAGE_REACHED'
        | 'COMMERCIAL_RUN_LINKED'
        | 'RESERVATION_NOT_UNIQUE'
        | 'RESERVATION_INVALID'
        | 'RESERVATION_LEASE_ACTIVE'
        | 'RUN_EVIDENCE'
        | 'DISPATCH_EVIDENCE'
        | 'OUTBOX_EVIDENCE'
        | 'JOB_EVIDENCE'
        | 'COPY_ATTEMPT_EVIDENCE'
        | 'FAILURE_COUNT_INVALID'
        | 'CAS_CONFLICT'
        | 'LOOKUP_FAILED';
    };
export type StartCommercialAutomationExecutionResult =
  | {
      outcome: 'created';
      execution: CommercialAutomationExecutionRecord;
      ownership: CommercialAutomationExecutionOwnership;
    }
  | { outcome: 'existing'; execution: CommercialAutomationExecutionRecord }
  | { outcome: 'concurrent'; stale: boolean };

export interface CommercialAutomationExecutionRepository {
  start(input: {
    schedulerJobId: string;
    bullMqJobId?: string;
    mode: CommercialAutomationExecutionMode;
    startedAt: Date;
    ownerId: string;
    heartbeatAt: Date;
    leaseExpiresAt: Date;
  }): Promise<StartCommercialAutomationExecutionResult>;
  createBlocked(input: {
    schedulerJobId: string;
    bullMqJobId?: string;
    mode: CommercialAutomationExecutionMode;
    reasons: string[];
    completedAt: Date;
  }): Promise<CommercialAutomationExecutionRecord>;
  heartbeat(
    ownership: CommercialAutomationExecutionOwnership,
    input: { heartbeatAt: Date; leaseExpiresAt: Date },
  ): Promise<void>;
  markExternalMayHaveStarted(
    ownership: CommercialAutomationExecutionOwnership,
    input: { markedAt: Date },
  ): Promise<CommercialAutomationExecutionRecord>;
  finish(
    ownership: CommercialAutomationExecutionOwnership,
    input: {
      status: Exclude<CommercialAutomationExecutionStatus, 'STARTED'>;
      reasons?: string[];
      commercialRunId?: string;
      failureCode?: string;
      completedAt: Date;
    },
  ): Promise<CommercialAutomationExecutionRecord>;
  findRecoveryContext(
    id: string,
  ): Promise<CommercialAutomationExecutionRecoveryContext | null>;
  recoverStalePreMarkerReservation?(
    id: string,
    input: {
      completedAt: Date;
      minimumIntervalMinutes: number;
      failureCode: string;
    },
  ): Promise<CommercialPreMarkerReservationRecoveryResult>;
  recoverStale(
    id: string,
    input: {
      status: 'QUEUED' | 'FAILED' | 'AMBIGUOUS';
      failureCode?: string;
      completedAt: Date;
    },
  ): Promise<CommercialAutomationExecutionRecord>;
  list(input: {
    page: number;
    limit: number;
  }): Promise<{ items: CommercialAutomationExecutionRecord[]; total: number }>;
  findById(id: string): Promise<CommercialAutomationExecutionRecord | null>;
}

export type CommercialNicheData = {
  name: string;
  slug: string;
  active: boolean;
  categoryIds: string[];
  includeKeywords: string[];
  excludeKeywords: string[];
  minPrice: string | null;
  maxPrice: string | null;
  minDiscountRate: number;
  minRating: number;
  minSales: number;
  minCommissionRate: number;
  minimumScore: number;
};

export type CommercialNicheRecord = CommercialNicheData & {
  id: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CommercialNicheFilters = {
  page: number;
  limit: number;
  active?: boolean;
};

export interface CommercialNicheRepository {
  create(data: CommercialNicheData): Promise<CommercialNicheRecord>;
  list(
    filters: CommercialNicheFilters,
  ): Promise<{ items: CommercialNicheRecord[]; total: number }>;
  findById(id: string): Promise<CommercialNicheRecord | null>;
  update(
    id: string,
    data: Partial<Omit<CommercialNicheData, 'slug'>>,
  ): Promise<CommercialNicheRecord | null>;
}

export type CommercialCampaignGroupSummary = {
  id: string;
  name: string;
  fingerprint: string | null;
  active: boolean;
  available: boolean;
  assignedInstanceName?: string | null;
};

export type CommercialCampaignNicheSummary = Pick<
  CommercialNicheRecord,
  'id' | 'name' | 'slug' | 'active'
>;

export type CommercialGroupCampaignData = {
  name: string;
  logicalGroupFingerprint: string;
  anchorDestinationId: string | null;
  nicheId: string;
  active: boolean;
  cadenceMinutes: number;
  timezone: string;
  allowedStartTime: string;
  allowedEndTime: string;
  dailyLimit: number;
  failureCount: number;
  nextEligibleAt: Date | null;
  attemptExecutionId: string | null;
  attemptReservedAt: Date | null;
  attemptLeaseExpiresAt: Date | null;
  queueTargetSize: number;
  dedupeDays: number;
};

export type CommercialGroupCampaignRecord = CommercialGroupCampaignData & {
  id: string;
  niche: CommercialCampaignNicheSummary;
  anchorDestination: CommercialCampaignGroupSummary | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CommercialGroupCampaignCreateData = Pick<
  CommercialGroupCampaignData,
  | 'name'
  | 'nicheId'
  | 'cadenceMinutes'
  | 'timezone'
  | 'allowedStartTime'
  | 'allowedEndTime'
  | 'dailyLimit'
  | 'queueTargetSize'
  | 'dedupeDays'
> & { groupDestinationId: string };

export type CommercialGroupCampaignUpdateData = Partial<
  Pick<
    CommercialGroupCampaignData,
    | 'name'
    | 'nicheId'
    | 'active'
    | 'cadenceMinutes'
    | 'timezone'
    | 'allowedStartTime'
    | 'allowedEndTime'
    | 'dailyLimit'
    | 'queueTargetSize'
    | 'dedupeDays'
  >
>;

export type CommercialGroupCampaignFilters = {
  page: number;
  limit: number;
  active?: boolean;
};

export interface CommercialGroupCampaignRepository {
  createForGroup(
    data: CommercialGroupCampaignCreateData,
  ): Promise<CommercialGroupCampaignRecord>;
  list(
    filters: CommercialGroupCampaignFilters,
  ): Promise<{ items: CommercialGroupCampaignRecord[]; total: number }>;
  findById(id: string): Promise<CommercialGroupCampaignRecord | null>;
  findByLogicalGroupFingerprint?(
    logicalGroupFingerprint: string,
  ): Promise<CommercialGroupCampaignRecord | null>;
  update(
    id: string,
    data: CommercialGroupCampaignUpdateData,
  ): Promise<CommercialGroupCampaignRecord | null>;
  hasEligibleDestination(logicalGroupFingerprint: string): Promise<boolean>;
  activateIfEligible(id: string): Promise<CommercialGroupCampaignRecord | null>;
  reserveAttempt?(
    input: CommercialGroupCampaignAttemptReservationInput,
  ): Promise<CommercialGroupCampaignAttemptReservation>;
  releaseAttempt?(input: {
    campaignId: string;
    executionId: string;
  }): Promise<CommercialGroupCampaignAttemptRelease>;
  renewAttempt?(
    input: CommercialGroupCampaignAttemptRenewalInput,
  ): Promise<CommercialGroupCampaignAttemptRenewal>;
}

export type CommercialGroupCampaignAttemptReservationInput = {
  campaignId: string;
  executionId: string;
  reservedAt: Date;
  leaseExpiresAt: Date;
};

export type CommercialGroupCampaignAttemptReservation =
  | {
      kind: 'RESERVED';
      campaignId: string;
      executionId: string;
      reservedAt: Date | null;
      leaseExpiresAt: Date | null;
      acquired: boolean;
    }
  | { kind: 'CONFLICT'; campaignId: string; executionId: string };

export type CommercialGroupCampaignAttemptRelease =
  | {
      kind: 'RELEASED';
      campaignId: string;
      executionId: string;
      released: boolean;
    }
  | { kind: 'CONFLICT'; campaignId: string; executionId: string };

export type CommercialGroupCampaignAttemptRenewalInput = {
  campaignId: string;
  executionId: string;
  renewedAt: Date;
  leaseExpiresAt: Date;
};

export type CommercialGroupCampaignAttemptRenewal =
  | {
      kind: 'RENEWED';
      campaignId: string;
      executionId: string;
      leaseExpiresAt: Date | null;
      renewed: boolean;
    }
  | { kind: 'CONFLICT'; campaignId: string; executionId: string };

export interface CommercialGroupCampaignAttemptRepository {
  reserve(
    input: CommercialGroupCampaignAttemptReservationInput,
  ): Promise<CommercialGroupCampaignAttemptReservation>;
  release(input: {
    campaignId: string;
    executionId: string;
  }): Promise<CommercialGroupCampaignAttemptRelease>;
  renew(
    input: CommercialGroupCampaignAttemptRenewalInput,
  ): Promise<CommercialGroupCampaignAttemptRenewal>;
}

export type CommercialPromotionCandidateStatus =
  'QUEUED' | 'COPY_READY' | 'RESERVED' | 'DISPATCHED' | 'EXPIRED' | 'BLOCKED';

export type CommercialPromotionDispatchFinalization =
  | { kind: 'LEGACY' }
  | {
      kind: 'DISPATCHED';
      candidateId: string;
      campaignId: string;
      transitioned: boolean;
    };

export type CommercialPromotionFailureFinalization =
  | { kind: 'LEGACY' }
  | { kind: 'BLOCKED'; candidateId: string; transitioned: boolean };

export type CommercialPromotionCampaignFailureReset =
  | { kind: 'LEGACY' }
  | { kind: 'RESET'; campaignId: string; transitioned: boolean };

export type CommercialPromotionAttemptContext =
  | { kind: 'NONE' }
  | { kind: 'AMBIGUOUS' }
  | { kind: 'FOUND'; candidateId: string; campaignId: string; attemptExecutionId: string | null };

export type CommercialPromotionSignal =
  'PRICE_DROP' | 'DISCOUNT_INCREASE' | 'NEWLY_OBSERVED' | 'CURRENT_DISCOUNT';

export type CommercialPromotionRejectionCode =
  | 'CAMPAIGN_INACTIVE'
  | 'NICHE_INACTIVE'
  | 'GROUP_UNAVAILABLE'
  | 'OFFER_UNAVAILABLE'
  | 'OFFER_EXPIRED'
  | 'STRUCTURAL_REJECTION'
  | 'NICHE_NOT_MATCHED'
  | 'SCORE_BELOW_MINIMUM'
  | 'SNAPSHOT_MISSING'
  | 'SNAPSHOT_OUTDATED'
  | 'NO_PROMOTION_SIGNAL'
  | 'DEDUPE_ACTIVE'
  | 'RECENTLY_SENT_TO_LOGICAL_GROUP'
  | 'QUEUE_PROTECTED'
  | 'QUEUE_NOT_SELECTED'
  | 'COMMERCIAL_PROMOTION_EVALUATION_TRUNCATED';

export type CommercialPromotionSnapshotRecord = {
  id: string;
  productId: string;
  revision: number;
  fingerprint: string;
  price: string;
  priceMin: string | null;
  priceMax: string | null;
  discountRate: number;
  commissionRate: number;
  observedRating: number;
  observedSales: number;
  offerStartsAt: Date | null;
  offerEndsAt: Date | null;
  unavailableAt: Date | null;
  capturedAt: Date;
  createdAt: Date;
};

export type CommercialPromotionCatalogItem = {
  product: ShopeeOfferRecord;
  commercialSnapshotRevision: number;
  commercialSnapshotFingerprint: string | null;
  latestSnapshotRevision: number | null;
  currentSnapshot: CommercialPromotionSnapshotRecord | null;
  previousSnapshot: CommercialPromotionSnapshotRecord | null;
};

export interface CommercialPromotionCatalogRepository {
  listOfficialCatalogPage(input: { afterId?: string; limit: number }): Promise<{
    items: CommercialPromotionCatalogItem[];
    hasMore: boolean;
  }>;
}

export type CommercialPromotionCandidateRecord = {
  id: string;
  campaignId: string;
  productId: string;
  snapshotId: string;
  generatedCopyId?: string | null;
  status: CommercialPromotionCandidateStatus;
  rankPosition: number | null;
  commercialScore: number;
  scorePolicyVersion: CommercialOfferScorePolicyVersion;
  minimumScoreUsed: number;
  scoreBreakdown: CommercialPipelineScoreBreakdown;
  promotionSignals: CommercialPromotionSignal[];
  priceDropPercent: string | null;
  queuedAt: Date;
  lastEvaluatedAt: Date;
  expiresAt: Date | null;
  dedupeUntil: Date | null;
  blockedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CommercialPromotionRankedCandidate = {
  productId: string;
  snapshotId: string;
  snapshotRevision: number;
  snapshotFingerprint: string;
  expectedProductUpdatedAt: Date;
  commercialScore: number;
  scorePolicyVersion: CommercialOfferScorePolicyVersion;
  minimumScoreUsed: number;
  scoreBreakdown: CommercialPipelineScoreBreakdown;
  promotionSignals: CommercialPromotionSignal[];
  priceDropPercent: string | null;
  discountRate: number;
  commissionRate: number;
  sales: number;
  expiresAt: Date | null;
  expectedCandidateStatus: CommercialPromotionCandidateStatus | null;
  expectedDedupeUntil: Date | null;
  expectedCandidateUpdatedAt: Date | null;
};

export type CommercialPromotionMaterializationInput = {
  campaignId: string;
  expectedCampaignUpdatedAt: Date;
  nicheId: string;
  expectedNicheUpdatedAt: Date;
  logicalGroupFingerprint: string;
  dedupeSince: Date;
  now: Date;
  rankedCandidates: CommercialPromotionRankedCandidate[];
};

export type CommercialPromotionMaterializationResult = {
  protectedCount: number;
  queueCapacity: number;
  queuedBefore: number;
  queuedCreated: number;
  queuedReactivated: number;
  queuedUpdated: number;
  queuedBlocked: number;
  queuedExpired: number;
  queuedAfter: number;
  queueTargetSize: number;
  queueFull: boolean;
};

export type CommercialPromotionQueueItem = Omit<
  CommercialPromotionCandidateRecord,
  'scoreBreakdown'
> & {
  productName: string;
  price: string;
  discountRate: number;
  snapshotRevision: number;
};

export interface CommercialPromotionCandidateRepository {
  listCampaignCandidates(
    campaignId: string,
  ): Promise<CommercialPromotionCandidateRecord[]>;
  findRecentlySentProductIds(input: {
    productIds: string[];
    logicalGroupFingerprint: string;
    sentAtOrAfter: Date;
  }): Promise<Set<string>>;
  materialize(
    input: CommercialPromotionMaterializationInput,
  ): Promise<CommercialPromotionMaterializationResult>;
  listQueue(input: {
    campaignId: string;
    page: number;
    limit: number;
    status?: CommercialPromotionCandidateStatus;
  }): Promise<{ items: CommercialPromotionQueueItem[]; total: number }>;
  markDispatchedByGeneratedCopyId(
    generatedCopyId: string,
  ): Promise<CommercialPromotionDispatchFinalization>;
  markBlockedByGeneratedCopyId(
    generatedCopyId: string,
  ): Promise<CommercialPromotionFailureFinalization>;
  resetCampaignFailureStateByGeneratedCopyId(
    generatedCopyId: string,
    expectedAttempt?: { campaignId: string; executionId: string },
  ): Promise<CommercialPromotionCampaignFailureReset>;
  findAttemptContextByGeneratedCopyId?(
    generatedCopyId: string,
  ): Promise<CommercialPromotionAttemptContext>;
  releaseAttempt?(input: {
    campaignId: string;
    executionId: string;
  }): Promise<CommercialGroupCampaignAttemptRelease>;
}

export type CommercialCopyGenerationAttemptStatus =
  'STARTED' | 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS';

export type CommercialCopyGenerationAttemptRecord = {
  id: string;
  candidateId: string;
  snapshotId: string;
  inputFingerprint: string;
  provider: string;
  model: string;
  promptVersion: string;
  validationVersion: string;
  status: CommercialCopyGenerationAttemptStatus;
  generatedCopyId: string | null;
  failureCode: string | null;
  requestMayHaveStarted: boolean;
  providerHttpStatus: number | null;
  providerErrorCode: string | null;
  providerErrorType: string | null;
  providerErrorParam: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  validationFailureCodes: string[];
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CommercialCopyGenerationAttemptStatusRecord = Pick<
  CommercialCopyGenerationAttemptRecord,
  | 'id'
  | 'candidateId'
  | 'provider'
  | 'model'
  | 'promptVersion'
  | 'validationVersion'
  | 'status'
  | 'failureCode'
  | 'requestMayHaveStarted'
  | 'providerHttpStatus'
  | 'providerErrorCode'
  | 'providerErrorType'
  | 'providerErrorParam'
  | 'inputTokens'
  | 'outputTokens'
  | 'totalTokens'
  | 'validationFailureCodes'
  | 'startedAt'
  | 'completedAt'
  | 'createdAt'
>;

export type CommercialPromotionCopyContext = {
  candidate: CommercialPromotionCandidateRecord;
  campaign: CommercialGroupCampaignRecord;
  niche: CommercialNicheRecord;
  product: {
    id: string;
    source: ShopeeAffiliateOfferSource;
    providerProductId: string;
    productName: string;
    shopName: string;
    productLink: string | null;
    affiliateLink: string | null;
    price: string;
    priceMin: string | null;
    priceMax: string | null;
    discountRate: number;
    commissionRate: number;
    rating: number;
    sales: number;
    offerStartsAt: Date | null;
    urlImagem?: string;
    offerEndsAt: Date | null;
    unavailableAt: Date | null;
    commercialSnapshotRevision: number;
    commercialSnapshotFingerprint: string | null;
    updatedAt: Date;
  };
  snapshot: CommercialPromotionSnapshotRecord;
  previousSnapshot: CommercialPromotionSnapshotRecord | null;
};

export type CommercialAiCopyClaimInput = {
  candidateId: string;
  snapshotId: string;
  inputFingerprint: string;
  provider: string;
  model: string;
  promptVersion: string;
  validationVersion: string;
  startedAt: Date;
  expected: CommercialPromotionCopyContext;
  affiliateLinkHash: string;
  validatedAt: Date;
};

export type CommercialAiCopyCompletionInput = {
  expected: CommercialPromotionCopyContext;
  inputFingerprint: string;
  provider: string;
  model: string;
  promptVersion: string;
  validationVersion: string;
  affiliateLinkHash: string;
  copy: GeneratedCopyData;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
  completedAt: Date;
};

export type CommercialAiCopyCompletionResult =
  | { completed: true; copy: GeneratedCopyRecord }
  | { completed: false; failureCode: string };

export interface CommercialPromotionCopyRepository {
  loadContext(
    candidateId: string,
  ): Promise<CommercialPromotionCopyContext | null>;
  findCopyByInputFingerprint(
    inputFingerprint: string,
  ): Promise<GeneratedCopyRecord | null>;
  findAttemptByInputFingerprint(
    inputFingerprint: string,
  ): Promise<CommercialCopyGenerationAttemptRecord | null>;
  findAttemptByGenerationContract(input: {
    candidateId: string;
    snapshotId: string;
    inputFingerprint: string;
    provider: string;
    model: string;
    promptVersion: string;
    validationVersion: string;
  }): Promise<CommercialCopyGenerationAttemptRecord | null>;
  listAttemptsByCandidateId(
    candidateId: string,
  ): Promise<CommercialCopyGenerationAttemptStatusRecord[]>;
  claim(input: CommercialAiCopyClaimInput): Promise<boolean>;
  linkCachedCopy(input: {
    expected: CommercialPromotionCopyContext;
    copyId: string;
    inputFingerprint: string;
    affiliateLinkHash: string;
    validatedAt: Date;
    provider: string;
    model: string;
    promptVersion: string;
    validationVersion: string;
    maximumLength: number;
  }): Promise<boolean>;
  complete(
    input: CommercialAiCopyCompletionInput,
  ): Promise<CommercialAiCopyCompletionResult>;
  markAttemptTerminal(input: {
    inputFingerprint: string;
    status: 'FAILED' | 'AMBIGUOUS';
    failureCode: string;
    requestMayHaveStarted: boolean;
    providerHttpStatus?: number | null;
    providerErrorCode?: string | null;
    providerErrorType?: string | null;
    providerErrorParam?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
    validationFailureCodes?: string[];
    completedAt: Date;
  }): Promise<boolean>;
  findCopyForCandidate(candidateId: string): Promise<{
    candidate: CommercialPromotionCandidateRecord;
    copy: GeneratedCopyRecord;
    snapshotRevision: number;
  } | null>;
}

export type CouponSource = 'MANUAL' | 'OFFICIAL';
export type CouponDiscountType = 'PERCENTAGE' | 'FIXED_AMOUNT';

export type CouponData = {
  source: CouponSource;
  code: string;
  description: string;
  discountType: CouponDiscountType;
  discountValue: string;
  minPurchase?: string | null;
  maxDiscount?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  active: boolean;
  shopId?: string | null;
  productId?: string | null;
  terms?: string | null;
  lastValidatedAt?: Date | null;
};

export type CouponRecord = CouponData & {
  id: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface CouponRepository {
  create(data: CouponData): Promise<CouponRecord>;
  list(): Promise<CouponRecord[]>;
  findById(id: string): Promise<CouponRecord | null>;
  update(id: string, data: Partial<CouponData>): Promise<CouponRecord | null>;
  delete(id: string): Promise<boolean>;
}

export type GeneratedCopyData = {
  id?: string;
  productId: string;
  titulo: string;
  mensagem: string;
  cta: string;
  hashtags: string;
  source?: 'LEGACY_TEMPLATE' | 'AI';
  provider?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  validationVersion?: string | null;
  inputFingerprint?: string | null;
  snapshotId?: string | null;
  createdFromCandidateId?: string | null;
  usageInputTokens?: number | null;
  usageOutputTokens?: number | null;
  usageTotalTokens?: number | null;
};

export type GeneratedCopyRecord = GeneratedCopyData & {
  id: string;
  createdAt?: Date;
};

export type WhatsAppDestinationData = {
  id?: string;
  name: string;
  destination: string;
  active: boolean;
  type?: 'INDIVIDUAL' | 'GROUP';
  available?: boolean;
  fingerprint?: string | null;
  sourceInstanceName?: string | null;
  assignedInstanceName?: string | null;
  memberCount?: number | null;
  ownerIsParticipant?: boolean | null;
  discoveredAt?: Date | null;
  lastSyncedAt?: Date | null;
};

export type WhatsAppDestinationUpdate = Partial<WhatsAppDestinationData>;

export type WhatsAppDestinationRecord = WhatsAppDestinationData & {
  id: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export type WhatsAppGroupRecord = WhatsAppDestinationRecord & {
  type: 'GROUP';
  available: boolean;
  fingerprint: string;
  sourceInstanceName: string;
  assignedInstanceName?: string | null;
  discoveredAt: Date;
  lastSyncedAt: Date;
};

export type WhatsAppGroupCreateData = Omit<
  WhatsAppGroupRecord,
  'id' | 'createdAt' | 'updatedAt'
>;

export type WhatsAppGroupUpdate = Partial<
  Pick<
    WhatsAppGroupRecord,
    | 'name'
    | 'active'
    | 'available'
    | 'fingerprint'
    | 'memberCount'
    | 'ownerIsParticipant'
    | 'lastSyncedAt'
  >
>;

export type WhatsAppGroupFilters = {
  active?: boolean;
  available?: boolean;
};

export type WhatsAppDispatchStatus =
  'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';

export type WhatsAppDispatchCreateData = {
  id?: string;
  productId: string;
  generatedCopyId: string;
  destinationId: string;
  instanceName?: string | null;
};

export type WhatsAppDispatchFilters = {
  status?: string;
  destinationId?: string;
  productId?: string;
};

export type WhatsAppDispatchRecord = WhatsAppDispatchCreateData & {
  id: string;
  externalMessageId?: string | null;
  status: WhatsAppDispatchStatus;
  attemptCount: number;
  errorMessage?: string | null;
  sentAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
};

export type CommercialDispatchCandidateDetails = Omit<
  import('./commercial-message-draft-service').CommercialMessageDraftCandidate,
  'generatedCopy' | 'product' | 'snapshot'
> & {
  campaignId: string;
  campaign: Pick<CommercialGroupCampaignRecord, 'id' | 'logicalGroupFingerprint'>;
  product: CommercialPromotionCopyContext['product'] & { urlImagem: string };
  snapshot: Pick<
    CommercialPromotionSnapshotRecord,
    | 'id'
    | 'productId'
    | 'revision'
    | 'fingerprint'
    | 'unavailableAt'
    | 'offerEndsAt'
  >;
};

export type WhatsAppDispatchDetails = WhatsAppDispatchRecord & {
  generatedCopy: Pick<
    GeneratedCopyRecord,
    | 'id'
    | 'productId'
    | 'snapshotId'
    | 'titulo'
    | 'mensagem'
    | 'cta'
    | 'hashtags'
    | 'createdFromCandidateId'
    | 'source'
    | 'promptVersion'
    | 'validationVersion'
  > & {
    promotionCandidates?: CommercialDispatchCandidateDetails[];
  };
  destination: Pick<
    WhatsAppDestinationRecord,
    | 'destination'
    | 'type'
    | 'active'
    | 'available'
    | 'fingerprint'
    | 'sourceInstanceName'
    | 'assignedInstanceName'
  > & { id?: string };
  product?: Pick<
    ProductLeadRecord,
    'comissao' | 'urlImagem' | 'affiliateLink'
  > | null;
};
export interface ProductRepository {
  findById(id: string): Promise<ProductLeadRecord | null>;
  findByProviderProductId(
    providerProductId: string,
  ): Promise<Pick<ProductLeadRecord, 'id'> | null>;
  create(data: ProductLeadData): Promise<ProductLeadRecord>;
  updateByProviderProductId(
    providerProductId: string,
    data: ProductLeadData,
  ): Promise<ProductLeadRecord>;
  listForScoring(): Promise<ProductLeadRecord[]>;
  updateScore(
    id: string,
    score: number,
    scoreUpdatedAt: Date,
  ): Promise<ProductLeadRecord>;
  listApproved(minScore: number): Promise<ProductLeadRecord[]>;
}

export interface GeneratedCopyRepository {
  create(data: GeneratedCopyData): Promise<GeneratedCopyRecord>;
  findById(id: string): Promise<GeneratedCopyRecord | null>;
}

export interface WhatsAppDestinationRepository {
  findById(id: string): Promise<WhatsAppDestinationRecord | null>;
  listActive(): Promise<WhatsAppDestinationRecord[]>;
  create(data: WhatsAppDestinationData): Promise<WhatsAppDestinationRecord>;
  list(): Promise<WhatsAppDestinationRecord[]>;
  update(
    id: string,
    data: WhatsAppDestinationUpdate,
  ): Promise<WhatsAppDestinationRecord | null>;
  assignToInstance?(
    destinationId: string,
    instanceName: string,
  ): Promise<WhatsAppDestinationRecord | null>;
}

export type WhatsAppInstanceRecord = {
  name: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export interface WhatsAppInstanceRepository {
  list(): Promise<WhatsAppInstanceRecord[]>;
  findByName(name: string): Promise<WhatsAppInstanceRecord | null>;
  upsert(name: string): Promise<WhatsAppInstanceRecord>;
  setActive(
    name: string,
    active: boolean,
  ): Promise<WhatsAppInstanceRecord | null>;
}

export interface WhatsAppGroupDirectoryRepository {
  findById(id: string): Promise<WhatsAppGroupRecord | null>;
  findByExternalGroupId(
    sourceInstanceName: string,
    externalGroupId: string,
  ): Promise<WhatsAppGroupRecord | null>;
  listByInstance(sourceInstanceName: string): Promise<WhatsAppGroupRecord[]>;
  list(
    sourceInstanceName: string,
    filters?: WhatsAppGroupFilters,
  ): Promise<WhatsAppGroupRecord[]>;
  listAll?(filters?: WhatsAppGroupFilters): Promise<WhatsAppGroupRecord[]>;
  create(data: WhatsAppGroupCreateData): Promise<WhatsAppGroupRecord>;
  update(
    id: string,
    data: WhatsAppGroupUpdate,
  ): Promise<WhatsAppGroupRecord | null>;
}

export const WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION =
  'CONFIRMAR_NAO_ENTREGA_E_RETRY_UNICO' as const;

export type WhatsAppDispatchManualRecoveryRecord = {
  id: string;
  dispatchId: string;
  runId: string;
  executionId: string;
  candidateId: string;
  campaignId: string;
  jobId: string;
  decision: 'CONFIRMED_NON_DELIVERY';
  confirmation: string;
  attemptCountObserved: number;
  authorizedAt: Date;
  rearmedAt: Date | null;
  requeuedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type WhatsAppDispatchManualRecoveryInput = {
  dispatchId: string;
  expectedRunId: string;
  expectedExecutionId: string;
  confirmation: typeof WHATSAPP_DISPATCH_MANUAL_RECOVERY_CONFIRMATION;
};

export type WhatsAppDispatchManualRecoveryAuthorization = {
  kind: 'AUTHORIZED' | 'ALREADY_AUTHORIZED';
  recovery: WhatsAppDispatchManualRecoveryRecord;
  jobId: string;
  campaignId: string;
  candidateId: string;
};

export type WhatsAppDispatchManualRecoveryInspection = {
  recovery: WhatsAppDispatchManualRecoveryRecord;
  jobId: string;
  campaignId: string;
  candidateId: string;
  dispatchId: string;
  runId: string;
  executionId: string;
  dispatchStatus: WhatsAppDispatchStatus;
  attemptCount: number;
  externalMessageId: string | null;
  sentAt: Date | null;
  runStatus: CommercialPipelineRunStatus;
  runFinalStatus: CommercialPipelineFinalStatus | null;
  investigationRequired: boolean;
  instanceName: string | null;
  target: CommercialAutomationTarget;
};

export type WhatsAppDispatchManualRecoveryRequeueContext =
  WhatsAppDispatchManualRecoveryInspection;

export interface WhatsAppDispatchManualRecoveryRepository {
  authorizeConfirmedNonDelivery(
    input: WhatsAppDispatchManualRecoveryInput & { authorizedAt: Date },
  ): Promise<WhatsAppDispatchManualRecoveryAuthorization>;
  inspectAuthorizedRecovery(
    input: WhatsAppDispatchManualRecoveryInput,
  ): Promise<WhatsAppDispatchManualRecoveryInspection>;
  rearmAuthorizedRetry(
    input: WhatsAppDispatchManualRecoveryInput & {
      leaseExpiresAt: Date;
      checkedAt: Date;
    },
  ): Promise<WhatsAppDispatchManualRecoveryRequeueContext>;
  markManualRecoveryRequeued(input: {
    dispatchId: string;
    requeuedAt: Date;
  }): Promise<WhatsAppDispatchManualRecoveryRecord>;
}

export interface WhatsAppDispatchRepository {
  createPending(
    data: WhatsAppDispatchCreateData,
  ): Promise<WhatsAppDispatchRecord | null>;
  findByIdForSending(id: string): Promise<WhatsAppDispatchDetails | null>;
  findByIdWithDetails(id: string): Promise<WhatsAppDispatchDetails | null>;
  list(filters: WhatsAppDispatchFilters): Promise<WhatsAppDispatchDetails[]>;
  markAttemptPending(id: string): Promise<boolean>;
  markSent(
    id: string,
    data: { externalMessageId: string; sentAt: Date },
  ): Promise<WhatsAppDispatchRecord>;
  markFailed(id: string, errorMessage: string): Promise<WhatsAppDispatchRecord>;
}

export const toProductLeadData = (produto: Product): ProductLeadData => ({
  providerProductId: produto.id,
  nome: produto.nome,
  categoria: produto.categoria,
  preco: produto.preco,
  desconto: produto.desconto,
  nota: produto.nota,
  vendidos: produto.vendidos,
  comissao: produto.comissao,
  loja: produto.loja,
  urlImagem: produto.urlImagem,
  url: produto.url,
  title: produto.nome,
});
