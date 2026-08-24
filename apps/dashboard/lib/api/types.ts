import type { Product, ProductFilters } from '@shopee-auto-affiliate-ai/shared';

export type { ProductFilters };

export type HealthResponse = {
  status: string;
  service: string;
};

export type AnalyticsSnapshot = {
  totalProducts: number;
  totalApprovedProducts: number;
  totalGeneratedCopies: number;
  totalQueuedDispatches: number;
  totalSentDispatches: number;
  totalFailedDispatches: number;
  totalActiveDestinations: number;
};

export type SchedulerStatusValue = 'disabled' | 'registered' | 'not-registered';

export type SchedulerStatus = {
  enabled: boolean;
  status: SchedulerStatusValue;
  jobId: string;
  queue: 'product-pipeline';
  jobName: 'pipeline-product';
  cronExpression: string | null;
  timezone: string | null;
  nextRunAt: string | null;
};

export type CommercialAutomationReason =
  | 'AUTOMATION_DISABLED'
  | 'AUTOMATION_PAUSED'
  | 'OUTSIDE_ALLOWED_WINDOW'
  | 'GLOBAL_DAILY_LIMIT_REACHED'
  | 'GROUP_DAILY_LIMIT_REACHED'
  | 'MINIMUM_INTERVAL_NOT_REACHED'
  | 'NO_AUTHORIZED_GROUP'
  | 'MULTIPLE_AUTHORIZED_GROUPS'
  | 'AMBIGUOUS_COMMERCIAL_RUN_EXISTS'
  | 'COMMERCIAL_EXECUTION_IN_PROGRESS'
  | 'STALE_COMMERCIAL_EXECUTION_EXISTS'
  | 'COMMERCIAL_AUTOMATION_DUPLICATE_LOGICAL_GROUP'
  | 'COMMERCIAL_AUTOMATION_TARGET_NOT_ELIGIBLE';

export type CommercialAutomationStatus = {
  enabled: boolean;
  allowed: boolean;
  reasons: CommercialAutomationReason[];
  nextAllowedAt: string | null;
  globalSentToday: number;
  globalRemainingToday: number;
  groupSentToday: number | null;
  groupRemainingToday: number | null;
  lastSentAt: string | null;
  paused: boolean;
  pausedAt: string | null;
  resumedAt: string | null;
  updatedAt: string;
  allowedStartTime: string;
  allowedEndTime: string;
  timezone: string;
  dailyGlobalLimit: number;
  dailyGroupLimit: number;
  minimumIntervalMinutes: number;
  authorizedGroupCount: number;
};

export type CommercialAutomationScheduleSettings = {
  timezone: string;
  allowedStartTime: string;
  allowedEndTime: string;
  minimumIntervalMinutes: number;
  staggerMinutes: number;
  scheduleRevision: number;
};

export type CommercialAutomationSchedulePreview = {
  scheduleRevision: number | null;
  plannedSlots: number;
  skippedTargets: string[];
  nextSlot: {
    slotKey: string;
    jobId: string;
    scheduledFor: string;
    campaignId: string;
    groupId: string;
    logicalGroupFingerprint: string;
    instanceName: string;
  } | null;
};

export type CommercialAutomationSchedulerStatus = {
  enabled: boolean;
  status: 'disabled' | 'registered' | 'not-registered';
  jobId: string;
  queue: string;
  jobName: string;
  cron: string;
  timezone: string;
  nextRunAt: string | null;
  mode: 'preview' | 'send';
};

export type CommercialAutomationExecution = {
  id: string;
  schedulerJobId: string;
  bullMqJobId: string | null;
  mode: 'preview' | 'send';
  status: string;
  reasons: string[];
  commercialRunId: string | null;
  failureCode: string | null;
  stale: boolean;
  heartbeatAt: string | null;
  leaseExpiresAt: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type CommercialAutomationExecutionPage = {
  items: CommercialAutomationExecution[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type CommercialDispatchOutbox = {
  id: string;
  runId?: string | null;
  dispatchId?: string | null;
  jobId?: string | null;
  status: string;
  attempts?: number;
  investigationRequired?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type CommercialDispatchOutboxPage = {
  items: CommercialDispatchOutbox[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type ApiErrorPayload = {
  error?: string;
  message?: string;
};

export type CopyResponse = {
  titulo: string;
  mensagem: string;
  cta: string;
  hashtags: string;
  id?: string;
  productId?: string;
  snapshotId?: string | null;
  createdFromCandidateId?: string | null;
};

export type PipelineRunResponse = {
  jobId?: string | number;
  status: 'queued';
};

export type PipelineJobStatus =
  | 'queued'
  | 'waiting'
  | 'delayed'
  | 'active'
  | 'completed'
  | 'failed'
  | 'unknown'
  | string;

export type PipelineJobResponse = {
  status: PipelineJobStatus;
  progress: unknown;
  startedAt: string | null;
  finishedAt: string | null;
  result: unknown;
  error: string | null;
};

export type WhatsAppDestination = {
  id: string;
  name: string;
  destination: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type WhatsAppDestinationInput = {
  name: string;
  destination: string;
  active?: boolean;
};

export type WhatsAppGroup = {
  id: string;
  name: string;
  fingerprint: string;
  memberCount: number | null;
  ownerIsParticipant: boolean | null;
  active: boolean;
  available: boolean;
  discoveredAt: string;
  lastSyncedAt: string;
  updatedAt: string | null;
};

export type WhatsAppGroupFilters = {
  active?: boolean;
  available?: boolean;
};

export type WhatsAppGroupSyncReport = {
  discovered: number;
  created: number;
  updated: number;
  unavailable: number;
  active: number;
};

export type WhatsAppDispatchStatus =
  'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';

export type DashboardProduct = Product & {
  providerProductId?: string;
  score?: number | null;
  scoreUpdatedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type ShopeeOfferSource = 'MOCK' | 'MANUAL' | 'OFFICIAL';
export type ShopeeOfferStatus = 'ACTIVE' | 'EXPIRED' | 'UNAVAILABLE';

export type ShopeeOffer = {
  id: string;
  source: ShopeeOfferSource;
  providerProductId: string;
  productName: string;
  shopId?: string;
  shopName: string;
  categoryIds: string[];
  price: string;
  priceMin: string;
  priceMax: string;
  discountRate: number;
  rating: number;
  sales: number;
  commissionRate: number;
  commissionAmount?: string;
  imageUrl: string;
  productLink: string;
  affiliateLink?: string;
  offerStartsAt?: string;
  offerEndsAt?: string;
  fetchedAt: string;
  lastSeenAt: string;
  unavailableAt?: string;
  score: number | null;
  scoreUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  status: ShopeeOfferStatus;
};

export type ShopeeOfferFilters = {
  keyword?: string;
  source?: ShopeeOfferSource | '';
  status?: ShopeeOfferStatus | '';
  affiliateLink?: 'present' | 'missing' | '';
  page?: number;
  limit?: number;
};

export type ShopeeOfferPage = {
  provider: 'mock' | 'manual' | 'official';
  items: ShopeeOffer[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type ShopeeOfferSyncReport = {
  source: 'mock' | 'manual' | 'official';
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  expired: number;
};

export type ManualOfferValidation = {
  valid: boolean;
  count: number;
  errors: { index: number; message: string }[];
  preview: Array<Record<string, unknown>>;
};

export type CopyPreview = {
  label: 'PREVIEW — NAO ENVIADO';
  titulo: string;
  mensagem: string;
  cta: string;
  affiliateLink: string;
  coupon: null;
};

export type Coupon = {
  id: string;
  source: 'MANUAL' | 'OFFICIAL';
  code: string;
  description: string;
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  discountValue: string;
  minPurchase?: string | null;
  maxDiscount?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  active: boolean;
  shopId?: string | null;
  productId?: string | null;
  terms?: string | null;
  lastValidatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ManualCouponInput = {
  code: string;
  description: string;
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  discountValue: string;
  minPurchase?: string;
  maxDiscount?: string;
  startsAt?: string;
  endsAt?: string;
  active?: boolean;
  terms?: string;
};

export type CommercialPipelineInput = {
  source?: 'MOCK' | 'MANUAL';
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  minDiscountRate?: number;
  minRating?: number;
  minSales?: number;
  minCommissionRate?: number;
  minimumScore?: number;
  campaign?: string;
  limitCandidates?: number;
};

export type CommercialSelectedProduct = {
  id: string;
  name: string;
  price: string;
  score: number;
  affiliateLinkPresent: boolean;
};

export type CommercialSelectedGroup = {
  id: string;
  name: string;
  fingerprint: string;
};

export type CommercialPipelineDryRunResult = {
  runId: string;
  mode: 'dry-run';
  status: 'ready';
  provider: 'mock' | 'manual';
  candidateCount: number;
  eligibleCount: number;
  rejectedCount: number;
  rejectionSummary: Record<string, number>;
  selectedProduct: CommercialSelectedProduct;
  selectedGroup: CommercialSelectedGroup;
  selectionReasons: string[];
  copyPreview: string;
  plannedSubIds: string[];
  dispatchWillBeCreated: false;
  jobWillBeCreated: false;
  messageWillBeSent: false;
};

export type CommercialPipelineRun = {
  id: string;
  mode: 'dry-run' | 'confirmed';
  status: 'started' | 'completed' | 'blocked' | 'failed';
  selectedProduct: CommercialSelectedProduct | null;
  selectedGroup: CommercialSelectedGroup | null;
  candidateCount: number;
  eligibleCount: number;
  rejectedCount: number;
  rejectionSummary: Record<string, number>;
  selectionReasons: string[];
  copyPreview: string | null;
  plannedSubIds: string[];
  failureCode: string | null;
  confirmedAt: string | null;
  finalStatus: 'pending' | 'sent' | 'failed' | 'ambiguous' | null;
  dispatchStatus: 'pending' | 'processing' | 'sent' | 'failed' | null;
  attemptCount: number;
  externalMessageIdRecorded: boolean;
  investigationRequired: boolean;
  createdAt: string;
  completedAt: string | null;
  dispatchWasCreated: boolean;
  jobWasCreated: boolean;
  messageWasSent: boolean;
  confirmationAvailable: boolean;
};

export type CommercialPipelineConfirmationResult = {
  runId: string;
  mode: 'confirmed';
  status: 'queued';
  selectedProduct: Pick<CommercialSelectedProduct, 'name' | 'price'>;
  selectedGroup: Pick<CommercialSelectedGroup, 'name' | 'fingerprint'>;
  copyPreview: string;
  dispatchWasCreated: true;
  jobWasCreated: true;
  messageWasSent: false;
  dispatchStatus: 'pending';
  attemptCount: 0;
  externalMessageIdRecorded: false;
  investigationRequired: false;
};

export type CommercialPipelineRunPage = {
  items: CommercialPipelineRun[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type CommercialCampaign = {
  id: string;
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
  queueTargetSize: number;
  dedupeDays: number;
  niche?: {
    id: string;
    name: string;
    slug: string;
    active: boolean;
  };
  anchorDestination?: {
    id: string;
    name: string;
    fingerprint: string | null;
    active: boolean;
    available: boolean;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type CommercialCampaignScheduleUpdate = {
  cadenceMinutes?: number;
  timezone?: string;
  allowedStartTime?: string;
  allowedEndTime?: string;
};

export type CommercialCampaignPage = {
  items: CommercialCampaign[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type CommercialCandidateStatus =
  | 'QUEUED'
  | 'COPY_READY'
  | 'RESERVED'
  | 'DISPATCHED'
  | 'EXPIRED'
  | 'BLOCKED';

export type CommercialQueueItem = {
  id: string;
  campaignId: string;
  productId: string;
  snapshotId: string;
  generatedCopyId: string | null;
  status: CommercialCandidateStatus;
  rankPosition: number | null;
  commercialScore: number;
  scorePolicyVersion: string;
  minimumScoreUsed: number;
  promotionSignals: string[];
  priceDropPercent: string | null;
  queuedAt: string;
  lastEvaluatedAt: string;
  expiresAt: string | null;
  dedupeUntil: string | null;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
  productName: string;
  price: string;
  discountRate: number;
  snapshotRevision: number;
};

export type CommercialQueuePage = {
  items: CommercialQueueItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type WhatsAppDispatch = {
  id: string;
  productId: string;
  generatedCopyId: string;
  destinationId: string;
  externalMessageId?: string | null;
  status: WhatsAppDispatchStatus;
  attemptCount: number;
  deliveryMode?: 'TEXT' | 'IMAGE' | null;
  provider?: string | null;
  errorMessage?: string | null;
  sentAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  generatedCopy?: CopyResponse;
  destination?: Pick<WhatsAppDestination, 'id' | 'name' | 'destination'>;
  product?: DashboardProduct | null;
};

export type DispatchFilters = {
  status?: WhatsAppDispatchStatus | '';
  destinationId?: string;
  productId?: string;
};
