import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import {
  COMMERCIAL_AUTOMATION_DEFAULTS,
  COMMERCIAL_AI_COPY_DEFAULT_REASONING_EFFORT,
  COMMERCIAL_SCHEDULER_DEFAULTS,
} from '@shopee-auto-affiliate-ai/config';
import {
  createPrismaClient,
  type DatabaseClient,
} from '@shopee-auto-affiliate-ai/database';
import {
  maskEvolutionDestination,
  MockShopeeProvider,
  MockShopeeAffiliateOfferProvider,
  ManualShopeeAffiliateOfferProvider,
  parseManualShopeeOffer,
  type ShopeeAffiliateOfferProvider,
  type ShopeeAffiliateOfferSource,
  type ShopeeProductOfferListInput,
  type WhatsAppGroupDirectoryProvider,
  type HunterProvider,
} from '@shopee-auto-affiliate-ai/providers';
import type { ProductFilters } from '@shopee-auto-affiliate-ai/shared';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import {
  createBullMqPipelineScheduler,
  createBullMqCommercialAutomationScheduler,
  createCommercialAutomationQueue,
  createProductPipelineQueue,
  createRedisConnection,
  createWhatsAppDispatchQueue,
  COMMERCIAL_AUTOMATION_HEARTBEAT_CRON,
  enqueueControlledWhatsAppDispatch,
  JOB_NAMES,
  type JobsOptions,
  type PipelineProductJob,
  type WhatsAppDispatchJob,
  type CommercialAutomationMode,
} from '@shopee-auto-affiliate-ai/queue';
import {
  createApplicationServices,
  createCommercialAutomationPolicyService,
  createCommercialPipelineConfirmationService,
  createCommercialPipelineService,
  createCommercialPromotionMiningService,
  createCommercialPromotionCopyGenerationService,
  createPrismaRepositories,
} from './application-services';
import {
  ManualPublicationService,
  type ManualPublicationInput,
  type ManualPublicationReconciliationInput,
  type ManualPublicationPreviewInput,
} from './manual-publication-service';
import type { AnalyticsService } from './analytics-service';
import { SchedulerStatusService } from './scheduler-status-service';
import {
  GroupDirectoryService,
  type WhatsAppGroupPublic,
} from './group-directory-service';
import { ShopeeOfferSyncService } from './shopee-offer-sync-service';
import type {
  CommercialPipelineInput,
  CommercialPipelineService,
} from './commercial-pipeline-service';
import type { CommercialPipelineConfirmationService } from './commercial-pipeline-confirmation-service';
import type {
  CommercialAutomationPolicyConfig,
  CommercialAutomationPolicyService,
  CommercialAutomationScheduleUpdate,
} from './commercial-automation-policy-service';
import { CommercialAutomationExecutionService } from './commercial-automation-execution-service';
import {
  CommercialAutomationSchedulerStatusService,
  type CommercialAutomationSchedulerStatusSnapshot,
} from './commercial-automation-scheduler-status-service';
import { CommercialDispatchOutboxService } from './commercial-dispatch-outbox-service';
import { CommercialNicheService } from './commercial-niche-service';
import { CommercialGroupCampaignService } from './commercial-group-campaign-service';
import { CommercialAutomationSchedulerPlanner } from './commercial-automation-scheduler-planner';
import { OperationalAdminService } from './operational-admin-service';
import type { CommercialPromotionMiningService } from './commercial-promotion-mining-service';
import type {
  CommercialAutomationTarget,
  CommercialPromotionCandidateStatus,
  OperationalCatalogDeliveryStatus,
  OperationalCatalogFilters,
  OperationalCatalogSort,
} from './repositories';
import type { CommercialAiCopyProvider } from './commercial-ai-copy-provider';
import {
  CommercialExternalProviderBudgetService,
  withOpenAiDailyBudget,
  withShopeeDailyBudget,
} from './commercial-external-provider-budget-service';
import type {
  CommercialAiCopyConfig,
  CommercialPromotionCopyGenerationService,
} from './commercial-promotion-copy-generation-service';
import { CommercialAutomationCandidateFlowService } from './commercial-automation-candidate-flow-service';
import { CommercialMessageDraftService } from './commercial-message-draft-service';

export type BuildAppOptions = {
  logger?: boolean;
  localApiAuthToken?: string;
  hunterProvider?: HunterProvider;
  prisma?: DatabaseClient;
  analyticsService?: Pick<AnalyticsService, 'getSnapshot'>;
  schedulerEnabled?: boolean;
  schedulerStatusServiceFactory?: () => Pick<
    SchedulerStatusService,
    'getStatus'
  >;
  pipelineQueue?: {
    add: (
      name: string,
      data: PipelineProductJob,
      opts?: JobsOptions,
    ) => Promise<{ id?: string | number }>;
    getJob?: (id: string) => Promise<PipelineJobLike | null | undefined>;
    getJobCounts?: (
      ...types: Array<'waiting' | 'active' | 'delayed' | 'prioritized'>
    ) => Promise<Record<string, number>>;
    close?: () => Promise<void>;
  };
  whatsappDispatchQueue?: {
    add: (
      name: string,
      data: WhatsAppDispatchJob,
      opts?: JobsOptions,
    ) => Promise<{ id?: string | number }>;
    getJob: (id: string) => Promise<unknown | null | undefined>;
    getJobCounts?: (
      ...types: Array<'waiting' | 'active' | 'delayed' | 'prioritized'>
    ) => Promise<Record<string, number>>;
    close?: () => Promise<void>;
  };
  redisUrl?: string;
  groupDirectoryProvider?: WhatsAppGroupDirectoryProvider;
  groupInstanceName?: string;
  groupDirectoryService?: Pick<
    GroupDirectoryService,
    'sync' | 'list' | 'find' | 'setActive'
  >;
  shopeeOfferProvider?: ShopeeAffiliateOfferProvider;
  shopeeMaxOffersPerSync?: number;
  shopeeSubIdPrefix?: string;
  commercialCopyMaxLength?: number;
  commercialPipelineService?: Pick<
    CommercialPipelineService,
    'dryRun' | 'listRuns' | 'findRun'
  >;
  commercialPipelineConfirmationService?: Pick<
    CommercialPipelineConfirmationService,
    'confirm'
  >;
  manualPublicationService?: Pick<
    ManualPublicationService,
    'getOptions' | 'create' | 'preview' | 'find'
  > &
    Partial<
      Pick<ManualPublicationService, 'reconcileSafePreProviderAmbiguity'>
    >;
  commercialConfirmationEnvironment?: {
    groupSendEnabled: boolean;
    safeMode: boolean;
    schedulerEnabled: boolean;
    maximumMessagesPerRun: number;
  };
  commercialAutomationPolicyService?: Pick<
    CommercialAutomationPolicyService,
    'evaluateAutomationReadiness' | 'setPaused'
  > &
    Partial<
      Pick<
        CommercialAutomationPolicyService,
        | 'getScheduleSettings'
        | 'updateScheduleSettings'
        | 'evaluateManualSendSafety'
      >
    >;
  commercialAutomationSchedulePlanner?: Pick<
    CommercialAutomationSchedulerPlanner,
    'preview'
  >;
  commercialAutomationConfig?: CommercialAutomationPolicyConfig;
  commercialAutomationExecutionService?: Pick<
    CommercialAutomationExecutionService,
    'list' | 'find'
  >;
  commercialDispatchOutboxService?: Pick<
    CommercialDispatchOutboxService,
    'list' | 'find'
  >;
  commercialNicheService?: Pick<
    CommercialNicheService,
    'create' | 'list' | 'find' | 'update'
  >;
  commercialGroupCampaignService?: Pick<
    CommercialGroupCampaignService,
    'create' | 'list' | 'find' | 'update' | 'activate' | 'deactivate'
  >;
  commercialPromotionMiningService?: Pick<
    CommercialPromotionMiningService,
    'preview' | 'mine' | 'listQueue'
  >;
  commercialPromotionCopyService?: Pick<
    CommercialPromotionCopyGenerationService,
    'preflight' | 'preview' | 'generate' | 'findCopy'
  >;
  commercialAiCopyProvider?: CommercialAiCopyProvider;
  commercialAiCopyConfig?: CommercialAiCopyConfig;
  commercialExternalBudgetConfig?: {
    timezone: string;
    fallbackDailyGlobalLimit: number;
  };
  commercialAutomationSchedulerStatusServiceFactory?: () => {
    getStatus(): Promise<CommercialAutomationSchedulerStatusSnapshot>;
  };
  operationalAdminService?: Pick<
    OperationalAdminService,
    | 'getOverview'
    | 'createInstance'
    | 'updateInstance'
    | 'updateGroup'
    | 'updateAutomationSettings'
  >;
  commercialSchedulerConfig?: {
    enabled: boolean;
    cron: string;
    timezone: string;
    mode: CommercialAutomationMode;
  };
};

type PipelineJobLike = {
  id?: string | number;
  data?: PipelineProductJob;
  progress?: unknown;
  timestamp?: number;
  processedOn?: number;
  finishedOn?: number;
  returnvalue?: unknown;
  failedReason?: string;
  getState: () => Promise<string>;
};

const parseNumberFilter = (value: unknown, field: string) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new AppError(`Filtro inválido: ${field}`, 'INVALID_HUNTER_FILTER');
  }
  return value;
};

const parsePositiveInteger = (
  value: unknown,
  fallback: number,
  maximum: number,
) => {
  if (value === undefined || value === '') return fallback;
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (
    typeof parsed !== 'number' ||
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > maximum
  ) {
    throw new AppError('Paginacao invalida', 'INVALID_PAGINATION');
  }
  return parsed;
};

const CATALOG_SORTS = new Set<OperationalCatalogSort>([
  'recent',
  'sales_desc',
  'score_desc',
  'discount_desc',
  'commission_desc',
  'price_asc',
  'price_desc',
]);

const CATALOG_DELIVERY_STATUSES = new Set<OperationalCatalogDeliveryStatus>([
  'any',
  'sent',
  'not_sent',
]);

const CATALOG_QUERY_FIELDS = new Set([
  'keyword',
  'source',
  'status',
  'availability',
  'affiliateLink',
  'categoryId',
  'minDiscount',
  'maxDiscount',
  'minScore',
  'maxScore',
  'minPrice',
  'maxPrice',
  'minCommission',
  'maxCommission',
  'deliveryStatus',
  'destinationId',
  'capturedFrom',
  'capturedTo',
  'sort',
  'page',
  'limit',
]);

const CATALOG_IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;

const catalogQueryError = (message: string) =>
  new AppError(message, 'INVALID_CATALOG_QUERY');

const parseCatalogNumber = (value: unknown, field: string) => {
  if (value === undefined || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw catalogQueryError(`Filtro inválido: ${field}`);
  }
  if (parsed < 0) {
    throw catalogQueryError(`Filtro inválido: ${field}`);
  }
  return parsed;
};

const parseCatalogIdentifier = (value: unknown, field: string) => {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !CATALOG_IDENTIFIER.test(value)) {
    throw catalogQueryError(`Identificador inválido: ${field}`);
  }
  return value;
};

const parseCatalogDate = (value: unknown, field: string) => {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') {
    throw catalogQueryError(`Data inválida: ${field}`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw catalogQueryError(`Data inválida: ${field}`);
  }
  return parsed;
};

const assertCatalogRange = (
  min: number | Date | undefined,
  max: number | Date | undefined,
  label: string,
) => {
  if (min !== undefined && max !== undefined && min.valueOf() > max.valueOf()) {
    throw catalogQueryError(`Faixa inválida: ${label}`);
  }
};

const parseCatalogEnum = <T extends string>(
  value: unknown,
  values: ReadonlySet<T>,
  field: string,
): T | undefined => {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !values.has(value as T)) {
    throw catalogQueryError(`Filtro inválido: ${field}`);
  }
  return value as T;
};

const parseCatalogQuery = (query: unknown): OperationalCatalogFilters => {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    throw catalogQueryError('Query inválida');
  }
  const record = query as Record<string, unknown>;
  if (Object.keys(record).some((key) => !CATALOG_QUERY_FIELDS.has(key))) {
    throw catalogQueryError('A query contém campos não permitidos');
  }
  const source = parseCatalogEnum(
    record.source,
    new Set<ShopeeAffiliateOfferSource>(['MOCK', 'MANUAL', 'OFFICIAL']),
    'source',
  );
  const status = parseCatalogEnum(
    record.status,
    new Set<'ACTIVE' | 'EXPIRED' | 'UNAVAILABLE'>([
      'ACTIVE',
      'EXPIRED',
      'UNAVAILABLE',
    ]),
    'status',
  );
  const availability = parseCatalogEnum(
    record.availability,
    new Set<'ACTIVE' | 'EXPIRED' | 'UNAVAILABLE'>([
      'ACTIVE',
      'EXPIRED',
      'UNAVAILABLE',
    ]),
    'availability',
  );
  if (status && availability && status !== availability) {
    throw catalogQueryError('status e availability não podem divergir');
  }
  const affiliateLink = parseCatalogEnum(
    record.affiliateLink,
    new Set<'present' | 'missing'>(['present', 'missing']),
    'affiliateLink',
  );
  const deliveryStatus =
    parseCatalogEnum(
      record.deliveryStatus,
      CATALOG_DELIVERY_STATUSES,
      'deliveryStatus',
    ) ?? 'any';
  const sort = parseCatalogEnum(record.sort, CATALOG_SORTS, 'sort') ?? 'recent';
  const minDiscount = parseCatalogNumber(record.minDiscount, 'minDiscount');
  const maxDiscount = parseCatalogNumber(record.maxDiscount, 'maxDiscount');
  const minScore = parseCatalogNumber(record.minScore, 'minScore');
  const maxScore = parseCatalogNumber(record.maxScore, 'maxScore');
  const minPrice = parseCatalogNumber(record.minPrice, 'minPrice');
  const maxPrice = parseCatalogNumber(record.maxPrice, 'maxPrice');
  const minCommission = parseCatalogNumber(
    record.minCommission,
    'minCommission',
  );
  const maxCommission = parseCatalogNumber(
    record.maxCommission,
    'maxCommission',
  );
  const capturedFrom = parseCatalogDate(record.capturedFrom, 'capturedFrom');
  const capturedTo = parseCatalogDate(record.capturedTo, 'capturedTo');
  if (record.keyword !== undefined && typeof record.keyword !== 'string') {
    throw catalogQueryError('Filtro inválido: keyword');
  }
  assertCatalogRange(minDiscount, maxDiscount, 'discount');
  assertCatalogRange(minScore, maxScore, 'score');
  assertCatalogRange(minPrice, maxPrice, 'price');
  assertCatalogRange(minCommission, maxCommission, 'commission');
  assertCatalogRange(capturedFrom, capturedTo, 'capturedAt');
  return {
    source,
    status: status ?? availability,
    affiliateLink,
    keyword:
      typeof record.keyword === 'string'
        ? record.keyword.trim() || undefined
        : undefined,
    categoryId: parseCatalogIdentifier(record.categoryId, 'categoryId'),
    minDiscount,
    maxDiscount,
    minScore,
    maxScore,
    minPrice,
    maxPrice,
    minCommission,
    maxCommission,
    deliveryStatus,
    destinationId: parseCatalogIdentifier(
      record.destinationId,
      'destinationId',
    ),
    capturedFrom,
    capturedTo,
    sort,
    page: parsePositiveInteger(record.page, 1, 100_000),
    limit: parsePositiveInteger(record.limit, 20, 100),
  };
};

const parseCatalogDetailQuery = (query: unknown) => {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    throw catalogQueryError('Query inválida');
  }
  const record = query as Record<string, unknown>;
  const allowed = new Set([
    'dispatchPage',
    'dispatchLimit',
    'snapshotPage',
    'snapshotLimit',
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw catalogQueryError('A query contém campos não permitidos');
  }
  return {
    dispatchPage: parsePositiveInteger(record.dispatchPage, 1, 100_000),
    dispatchLimit: parsePositiveInteger(record.dispatchLimit, 20, 100),
    snapshotPage: parsePositiveInteger(record.snapshotPage, 1, 100_000),
    snapshotLimit: parsePositiveInteger(record.snapshotLimit, 20, 100),
  };
};

const FLASH_DEAL_CAPABILITY = {
  status: 'UNSUPPORTED_CURRENT_PROVIDER_CONTRACT',
  reasonCode: 'OFFICIAL_SIGNAL_NOT_AVAILABLE',
} as const;

const parseCommercialConfigurationQuery = (query: unknown) => {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    throw new AppError(
      'Query invalida',
      'COMMERCIAL_CONFIGURATION_QUERY_INVALID',
    );
  }
  const record = query as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => !['page', 'limit', 'active'].includes(key),
    )
  ) {
    throw new AppError(
      'A query contem campos nao permitidos',
      'COMMERCIAL_CONFIGURATION_QUERY_INVALID',
    );
  }
  let active: boolean | undefined;
  if (record.active !== undefined) {
    if (record.active !== 'true' && record.active !== 'false') {
      throw new AppError(
        'Filtro active invalido',
        'COMMERCIAL_CONFIGURATION_QUERY_INVALID',
      );
    }
    active = record.active === 'true';
  }
  return {
    page: parsePositiveInteger(record.page, 1, 1_000_000),
    limit: parsePositiveInteger(record.limit, 20, 100),
    active,
  };
};

const COMMERCIAL_CONFIGURATION_ERROR_STATUS: Readonly<Record<string, number>> =
  {
    COMMERCIAL_NICHE_NOT_FOUND: 404,
    COMMERCIAL_GROUP_CAMPAIGN_NOT_FOUND: 404,
    COMMERCIAL_GROUP_DESTINATION_NOT_FOUND: 404,
    COMMERCIAL_NICHE_SLUG_CONFLICT: 409,
    COMMERCIAL_GROUP_CAMPAIGN_ALREADY_EXISTS: 409,
    COMMERCIAL_GROUP_CAMPAIGN_NICHE_INACTIVE: 409,
    COMMERCIAL_GROUP_CAMPAIGN_GROUP_UNAVAILABLE: 409,
    COMMERCIAL_GROUP_CAMPAIGN_STATE_CONFLICT: 409,
  };

const sendCommercialConfigurationError = (
  reply: FastifyReply,
  error: unknown,
) => {
  if (!(error instanceof AppError)) {
    return reply.code(500).send({ error: 'INTERNAL_SERVER_ERROR' });
  }
  const code = error.code;
  const status = COMMERCIAL_CONFIGURATION_ERROR_STATUS[code] ?? 400;
  return reply.code(status).send({ error: code, message: error.message });
};

const COMMERCIAL_PROMOTION_ERROR_STATUS: Readonly<Record<string, number>> = {
  COMMERCIAL_GROUP_CAMPAIGN_NOT_FOUND: 404,
  COMMERCIAL_NICHE_NOT_FOUND: 404,
  CAMPAIGN_INACTIVE: 409,
  NICHE_INACTIVE: 409,
  COMMERCIAL_PROMOTION_CATALOG_CHANGED: 409,
  COMMERCIAL_PROMOTION_CONFIGURATION_CHANGED: 409,
  COMMERCIAL_PROMOTION_EVALUATION_TRUNCATED: 409,
  COMMERCIAL_PROMOTION_MINING_CONFLICT: 409,
  GROUP_UNAVAILABLE: 503,
  COMMERCIAL_PROMOTION_PERSISTENCE_FAILED: 500,
};

const sendCommercialPromotionError = (reply: FastifyReply, error: unknown) => {
  if (!(error instanceof AppError)) {
    return reply.code(500).send({ error: 'INTERNAL_SERVER_ERROR' });
  }
  const status = COMMERCIAL_PROMOTION_ERROR_STATUS[error.code] ?? 400;
  if (status === 500) return reply.code(500).send({ error: error.code });
  return reply.code(status).send({ error: error.code, message: error.message });
};

const COMMERCIAL_AI_COPY_ERROR_STATUS: Readonly<Record<string, number>> = {
  COMMERCIAL_PROMOTION_CANDIDATE_NOT_FOUND: 404,
  COMMERCIAL_AI_COPY_NOT_FOUND: 404,
  COMMERCIAL_AI_COPY_CONFIRMATION_INVALID: 400,
  COMMERCIAL_AI_COPY_REQUEST_INVALID: 400,
  COMMERCIAL_AI_COPY_FACTS_INVALID: 400,
  COMMERCIAL_AI_COPY_TOO_LONG: 400,
  COMMERCIAL_AI_COPY_URL_INVALID: 400,
  COMMERCIAL_AI_COPY_OUTPUT_INVALID: 422,
  COMMERCIAL_AI_COPY_AUTHENTICATION_FAILED: 503,
  COMMERCIAL_AI_COPY_ACCESS_DENIED: 503,
  COMMERCIAL_AI_COPY_MODEL_UNAVAILABLE: 503,
  COMMERCIAL_AI_COPY_QUOTA_EXCEEDED: 503,
  COMMERCIAL_AI_COPY_RATE_LIMITED: 503,
  COMMERCIAL_AI_COPY_PROVIDER_SERVER_ERROR: 503,
  COMMERCIAL_AI_COPY_PROVIDER_DISABLED: 503,
  COMMERCIAL_AI_COPY_PROVIDER_NOT_CONFIGURED: 503,
  COMMERCIAL_AI_COPY_PROVIDER_FAILED: 503,
  COMMERCIAL_AI_COPY_OUTPUT_TOKEN_LIMIT: 503,
  COMMERCIAL_AI_COPY_CONTENT_FILTERED: 503,
  COMMERCIAL_AI_COPY_PROVIDER_REFUSED: 503,
  COMMERCIAL_AI_COPY_PROVIDER_INCOMPLETE: 503,
  COMMERCIAL_AI_COPY_PROVIDER_OUTPUT_INVALID: 503,
  COMMERCIAL_AI_COPY_CANDIDATE_NOT_QUEUED: 409,
  COMMERCIAL_AI_COPY_ALREADY_READY: 409,
  COMMERCIAL_AI_COPY_GENERATION_IN_PROGRESS: 409,
  COMMERCIAL_AI_COPY_PREVIOUSLY_FAILED: 409,
  COMMERCIAL_AI_COPY_RESULT_AMBIGUOUS: 409,
  COMMERCIAL_AI_COPY_CONFIGURATION_CHANGED: 409,
  COMMERCIAL_AI_COPY_CATALOG_CHANGED: 409,
  COMMERCIAL_AI_COPY_CANDIDATE_CHANGED: 409,
  COMMERCIAL_AI_COPY_SNAPSHOT_OUTDATED: 409,
};

const sendCommercialAiCopyError = (reply: FastifyReply, error: unknown) => {
  if (!(error instanceof AppError)) {
    return reply.code(500).send({ error: 'COMMERCIAL_AI_COPY_FAILED' });
  }
  const status = COMMERCIAL_AI_COPY_ERROR_STATUS[error.code] ?? 409;
  return reply.code(status).send({ error: error.code, message: error.message });
};

const assertEmptyCopyPreviewBody = (body: unknown) => {
  if (
    body !== undefined &&
    (body === null ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length > 0)
  ) {
    throw new AppError(
      'Body do preview de copy invalido',
      'COMMERCIAL_AI_COPY_REQUEST_INVALID',
    );
  }
};

const parseCopyGenerateConfirmation = (body: unknown) => {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    (body as Record<string, unknown>).confirm !== 'GERAR_COPY_COM_IA'
  ) {
    throw new AppError(
      'Confirmacao de geracao invalida',
      'COMMERCIAL_AI_COPY_CONFIRMATION_INVALID',
    );
  }
  return 'GERAR_COPY_COM_IA';
};

const COMMERCIAL_PROMOTION_STATUSES =
  new Set<CommercialPromotionCandidateStatus>([
    'QUEUED',
    'COPY_READY',
    'RESERVED',
    'DISPATCHED',
    'EXPIRED',
    'BLOCKED',
  ]);

const parseCommercialPromotionQueueQuery = (query: unknown) => {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    throw new AppError(
      'Query da fila promocional invalida',
      'COMMERCIAL_PROMOTION_QUEUE_QUERY_INVALID',
    );
  }
  const record = query as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => !['page', 'limit', 'status'].includes(key),
    )
  ) {
    throw new AppError(
      'A query da fila contem campos nao permitidos',
      'COMMERCIAL_PROMOTION_QUEUE_QUERY_INVALID',
    );
  }
  const status =
    record.status === undefined ? undefined : String(record.status);
  if (
    status !== undefined &&
    !COMMERCIAL_PROMOTION_STATUSES.has(
      status as CommercialPromotionCandidateStatus,
    )
  ) {
    throw new AppError(
      'Status da fila promocional invalido',
      'COMMERCIAL_PROMOTION_QUEUE_QUERY_INVALID',
    );
  }
  return {
    page: parsePositiveInteger(record.page, 1, 1_000_000),
    limit: parsePositiveInteger(record.limit, 20, 100),
    status: status as CommercialPromotionCandidateStatus | undefined,
  };
};

const offerStatus = (offer: { unavailableAt?: Date; offerEndsAt?: Date }) =>
  offer.unavailableAt
    ? ('UNAVAILABLE' as const)
    : offer.offerEndsAt && offer.offerEndsAt <= new Date()
      ? ('EXPIRED' as const)
      : ('ACTIVE' as const);

const COMMERCIAL_INPUT_FIELDS = new Set([
  'source',
  'categoryId',
  'minPrice',
  'maxPrice',
  'minDiscountRate',
  'minRating',
  'minSales',
  'minCommissionRate',
  'minimumScore',
  'campaign',
  'limitCandidates',
]);

const parseCommercialPipelineInput = (
  body: unknown,
): CommercialPipelineInput => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(
      'Body do pipeline comercial e invalido',
      'INVALID_PIPELINE_FILTERS',
    );
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !COMMERCIAL_INPUT_FIELDS.has(key))) {
    throw new AppError(
      'O body contem campos nao permitidos',
      'INVALID_PIPELINE_FILTERS',
    );
  }
  const input: CommercialPipelineInput = {};
  if (record.source !== undefined) {
    if (
      !['MOCK', 'MANUAL', 'OFFICIAL'].includes(
        String(record.source).toUpperCase(),
      )
    )
      throw new AppError('source invalido', 'INVALID_PIPELINE_FILTERS');
    input.source = String(record.source).toUpperCase() as
      'MOCK' | 'MANUAL' | 'OFFICIAL';
  }
  for (const field of [
    'minPrice',
    'maxPrice',
    'minDiscountRate',
    'minRating',
    'minSales',
    'minCommissionRate',
    'minimumScore',
    'limitCandidates',
  ] as const) {
    if (record[field] === undefined) continue;
    if (typeof record[field] !== 'number' || !Number.isFinite(record[field]))
      throw new AppError(`${field} invalido`, 'INVALID_PIPELINE_FILTERS');
    input[field] = record[field];
  }
  for (const field of ['categoryId', 'campaign'] as const) {
    if (record[field] === undefined) continue;
    if (typeof record[field] !== 'string')
      throw new AppError(`${field} invalido`, 'INVALID_PIPELINE_FILTERS');
    input[field] = record[field];
  }
  return input;
};

export const sanitizeDispatchDestination = (destination: {
  destination: string;
  type?: 'INDIVIDUAL' | 'GROUP';
  active?: boolean;
  available?: boolean;
  fingerprint?: string | null;
  sourceInstanceName?: string | null;
}) =>
  destination.type === 'GROUP'
    ? {
        type: destination.type,
        active: destination.active ?? false,
        available: destination.available ?? false,
        fingerprint: destination.fingerprint,
        destination: destination.fingerprint,
      }
    : {
        ...destination,
        destination: maskEvolutionDestination(destination.destination),
      };

export const buildApp = async (options: BuildAppOptions = {}) => {
  const app = Fastify({ logger: options.logger ?? true });
  const localApiAuthToken = options.localApiAuthToken?.trim();
  const prisma = options.prisma ?? createPrismaClient();
  const hunterProvider = options.hunterProvider ?? new MockShopeeProvider();
  const rawShopeeOfferProvider =
    options.shopeeOfferProvider ?? new MockShopeeAffiliateOfferProvider();
  const repositories = createPrismaRepositories(prisma);
  const externalBudget = options.commercialExternalBudgetConfig
    ? new CommercialExternalProviderBudgetService({
        settings: repositories.commercialAutomationSettings,
        usage: repositories.commercialExternalProviderUsage,
        timezone: options.commercialExternalBudgetConfig.timezone,
        fallbackDailyGlobalLimit:
          options.commercialExternalBudgetConfig.fallbackDailyGlobalLimit,
      })
    : undefined;
  const shopeeOfferProvider =
    externalBudget && rawShopeeOfferProvider.source === 'OFFICIAL'
      ? withShopeeDailyBudget(rawShopeeOfferProvider, externalBudget)
      : rawShopeeOfferProvider;
  const commercialAiCopyProvider =
    externalBudget && options.commercialAiCopyProvider
      ? withOpenAiDailyBudget(options.commercialAiCopyProvider, externalBudget)
      : options.commercialAiCopyProvider;
  const groupDirectoryService =
    options.groupDirectoryService ??
    (options.groupDirectoryProvider && options.groupInstanceName
      ? new GroupDirectoryService({
          provider: options.groupDirectoryProvider,
          groups: repositories.whatsappGroups,
          instanceName: options.groupInstanceName,
          logger: app.log,
        })
      : undefined);
  let redisConnection: ReturnType<typeof createRedisConnection> | undefined;
  const getRedisConnection = () => {
    redisConnection ??= createRedisConnection(
      options.redisUrl ?? process.env.REDIS_URL ?? 'redis://localhost:6379',
    );
    return redisConnection;
  };
  let pipelineQueue = options.pipelineQueue;
  const getPipelineQueue = () => {
    if (!pipelineQueue) {
      pipelineQueue = createProductPipelineQueue(getRedisConnection());
    }
    return pipelineQueue as NonNullable<typeof pipelineQueue>;
  };
  let whatsappDispatchQueue = options.whatsappDispatchQueue;
  const getWhatsAppDispatchQueue = () => {
    whatsappDispatchQueue ??= createWhatsAppDispatchQueue(getRedisConnection());
    return whatsappDispatchQueue as NonNullable<typeof whatsappDispatchQueue>;
  };
  let commercialAutomationQueue:
    ReturnType<typeof createCommercialAutomationQueue> | undefined;
  const getCommercialAutomationQueue = () => {
    commercialAutomationQueue ??=
      createCommercialAutomationQueue(getRedisConnection());
    return commercialAutomationQueue;
  };
  let pipelineScheduler:
    ReturnType<typeof createBullMqPipelineScheduler> | undefined;
  const schedulerReader = {
    getState: (jobId: string) => {
      pipelineScheduler ??= createBullMqPipelineScheduler(
        getPipelineQueue() as ReturnType<typeof createProductPipelineQueue>,
      );
      return pipelineScheduler.getState(jobId);
    },
  };
  const schedulerStatusService = options.schedulerStatusServiceFactory
    ? options.schedulerStatusServiceFactory()
    : new SchedulerStatusService(
        schedulerReader,
        options.schedulerEnabled ?? false,
      );
  const commercialSchedulerConfig = options.commercialSchedulerConfig ?? {
    enabled: COMMERCIAL_SCHEDULER_DEFAULTS.enabled,
    cron: COMMERCIAL_AUTOMATION_HEARTBEAT_CRON,
    timezone: COMMERCIAL_SCHEDULER_DEFAULTS.timezone,
    mode: COMMERCIAL_SCHEDULER_DEFAULTS.mode,
  };
  let commercialAutomationScheduler:
    ReturnType<typeof createBullMqCommercialAutomationScheduler> | undefined;
  const commercialSchedulerStatusService =
    options.commercialAutomationSchedulerStatusServiceFactory?.() ??
    new CommercialAutomationSchedulerStatusService(
      {
        getState: (jobId, mode) => {
          commercialAutomationScheduler ??=
            createBullMqCommercialAutomationScheduler(
              getCommercialAutomationQueue(),
            );
          return commercialAutomationScheduler.getState(jobId, mode);
        },
      },
      commercialSchedulerConfig,
    );
  const commercialAutomationExecutionService =
    options.commercialAutomationExecutionService ??
    new CommercialAutomationExecutionService(
      repositories.commercialAutomationExecutions,
    );
  const commercialDispatchOutboxService =
    options.commercialDispatchOutboxService ??
    new CommercialDispatchOutboxService(
      repositories.commercialDispatchOutboxes,
    );
  const commercialNicheService =
    options.commercialNicheService ??
    new CommercialNicheService(repositories.commercialNiches);
  const commercialGroupCampaignService =
    options.commercialGroupCampaignService ??
    new CommercialGroupCampaignService(
      repositories.commercialGroupCampaigns,
      repositories.commercialNiches,
    );
  let commercialPromotionMiningService =
    options.commercialPromotionMiningService;
  let commercialPromotionCopyService = options.commercialPromotionCopyService;
  const getApplicationServices = () =>
    createApplicationServices({
      repositories,
      hunterProvider,
      shopeeOfferProvider,
      shopeeMaxOffersPerSync: options.shopeeMaxOffersPerSync ?? 20,
      logger: app.log,
    });
  let commercialPipelineService = options.commercialPipelineService;
  const getCommercialPipelineService = () => {
    commercialPipelineService ??= createCommercialPipelineService({
      repositories,
      score: getApplicationServices().score,
      instanceName: options.groupInstanceName ?? 'affiliate-bot',
      subIdPrefix: options.shopeeSubIdPrefix ?? 'whatsapp',
      maximumCopyLength: options.commercialCopyMaxLength ?? 1000,
      logger: app.log,
    });
    return commercialPipelineService;
  };
  const getCommercialPromotionMiningService = () => {
    commercialPromotionMiningService ??= createCommercialPromotionMiningService(
      {
        repositories,
        score: getApplicationServices().score,
        logger: app.log,
      },
    );
    return commercialPromotionMiningService;
  };
  const getCommercialPromotionCopyService = () => {
    commercialPromotionCopyService ??=
      createCommercialPromotionCopyGenerationService({
        repositories,
        provider: commercialAiCopyProvider,
        config: options.commercialAiCopyConfig ?? {
          enabled: false,
          provider: 'openai',
          model: null,
          apiKeyConfigured: false,
          timeoutMs: 30000,
          maxOutputTokens: 1000,
          reasoningEffort: COMMERCIAL_AI_COPY_DEFAULT_REASONING_EFFORT,
          maximumCopyLength: options.commercialCopyMaxLength ?? 1000,
        },
        logger: app.log,
      });
    return commercialPromotionCopyService;
  };
  let commercialPipelineConfirmationService =
    options.commercialPipelineConfirmationService;
  const getCommercialPipelineConfirmationService = () => {
    commercialPipelineConfirmationService ??=
      createCommercialPipelineConfirmationService({
        repositories,
        queue: {
          hasJob: async (jobId) =>
            Boolean(await getWhatsAppDispatchQueue().getJob(jobId)),
          getJob: async (jobId) => {
            const job: unknown = await getWhatsAppDispatchQueue().getJob(jobId);
            if (typeof job !== 'object' || job === null) {
              return null;
            }
            const rawJob = job as { data?: unknown; id?: unknown };
            if (typeof rawJob.data !== 'object' || rawJob.data === null) {
              return null;
            }
            const data = rawJob.data as {
              dispatchId?: unknown;
              instanceName?: unknown;
            };
            if (typeof data.dispatchId !== 'string') return null;
            return {
              id: String(rawJob.id ?? jobId),
              dispatchId: data.dispatchId,
              ...(typeof data.instanceName === 'string'
                ? { instanceName: data.instanceName }
                : {}),
            };
          },
          enqueue: async (dispatchId, jobId, instanceName) => {
            await enqueueControlledWhatsAppDispatch(
              getWhatsAppDispatchQueue() as ReturnType<
                typeof createWhatsAppDispatchQueue
              >,
              { dispatchId, ...(instanceName ? { instanceName } : {}) },
              jobId,
            );
          },
        },
        instanceName: options.groupInstanceName ?? 'affiliate-bot',
        maximumCopyLength: options.commercialCopyMaxLength ?? 1000,
        environment: options.commercialConfirmationEnvironment ?? {
          groupSendEnabled: false,
          safeMode: true,
          schedulerEnabled: options.schedulerEnabled ?? false,
          maximumMessagesPerRun: 1,
        },
        logger: app.log,
      });
    return commercialPipelineConfirmationService;
  };
  let commercialAutomationPolicyService =
    options.commercialAutomationPolicyService;
  const getCommercialAutomationPolicyService = () => {
    commercialAutomationPolicyService ??=
      createCommercialAutomationPolicyService({
        repositories,
        instanceName: options.groupInstanceName ?? 'affiliate-bot',
        config:
          options.commercialAutomationConfig ?? COMMERCIAL_AUTOMATION_DEFAULTS,
      });
    return commercialAutomationPolicyService;
  };
  let manualPublicationService = options.manualPublicationService;
  const getManualPublicationService = () => {
    const configuredPolicy = getCommercialAutomationPolicyService();
    const manualPolicy = {
      evaluateManualSendSafety: async (target: CommercialAutomationTarget) => {
        if (!configuredPolicy.evaluateManualSendSafety) {
          throw new AppError(
            'Policy de envio manual indisponivel',
            'MANUAL_PUBLICATION_POLICY_UNAVAILABLE',
          );
        }
        return configuredPolicy.evaluateManualSendSafety(target);
      },
    };
    const configuredPipeline = getCommercialPipelineService() as Partial<
      Pick<CommercialPipelineService, 'dryRunFromPromotionCandidate'>
    >;
    manualPublicationService ??= new ManualPublicationService({
      requests: repositories.manualPublicationRequests,
      offers: repositories.shopeeOffers,
      catalog: repositories.commercialPromotions,
      groups: repositories.whatsappGroups,
      campaigns: repositories.commercialGroupCampaigns,
      instances: repositories.whatsappInstances,
      candidates: repositories.commercialPromotions,
      copies: repositories.commercialPromotionCopies,
      deliveryHistory: repositories.commercialDeliveryHistory,
      policy: manualPolicy,
      candidateFlow: new CommercialAutomationCandidateFlowService({
        groups: repositories.whatsappGroups,
        instances: repositories.whatsappInstances,
        campaigns: repositories.commercialGroupCampaigns,
        candidates: repositories.commercialPromotions,
        deliveryHistory: repositories.commercialDeliveryHistory,
        copies: repositories.commercialPromotionCopies,
        mining: getCommercialPromotionMiningService(),
        copyGeneration: getCommercialPromotionCopyService(),
        draft: new CommercialMessageDraftService(),
        pipeline: {
          dryRunFromPromotionCandidate: (...args) => {
            if (!configuredPipeline.dryRunFromPromotionCandidate) {
              throw new AppError(
                'Pipeline manual indisponivel',
                'MANUAL_PUBLICATION_PIPELINE_UNAVAILABLE',
              );
            }
            return configuredPipeline.dryRunFromPromotionCandidate(...args);
          },
        },
        instanceName: options.groupInstanceName ?? 'affiliate-bot',
        logger: app.log,
      }),
      confirmation: getCommercialPipelineConfirmationService(),
      executions: repositories.commercialAutomationExecutions,
      runs: repositories.commercialRuns,
      outboxes: repositories.commercialDispatchOutboxes,
      dispatches: repositories.whatsappDispatches,
      environment: options.commercialConfirmationEnvironment ?? {
        groupSendEnabled: false,
        safeMode: true,
        schedulerEnabled: options.schedulerEnabled ?? false,
        maximumMessagesPerRun: 1,
      },
      logger: app.log,
    });
    return manualPublicationService;
  };
  const commercialAutomationSchedulePlanner =
    options.commercialAutomationSchedulePlanner ??
    new CommercialAutomationSchedulerPlanner({
      settings: repositories.commercialAutomationSettings,
      campaigns: repositories.commercialGroupCampaigns,
      groups: repositories.whatsappGroups,
      instances: repositories.whatsappInstances,
      history: repositories.commercialAutomationHistory,
      policy: getCommercialAutomationPolicyService(),
      config:
        options.commercialAutomationConfig ?? COMMERCIAL_AUTOMATION_DEFAULTS,
    });
  let operationalAdminService = options.operationalAdminService;
  const getOperationalAdminService = () => {
    operationalAdminService ??= new OperationalAdminService({
      instances: repositories.whatsappInstances,
      groups: repositories.whatsappGroups,
      campaigns: repositories.commercialGroupCampaigns,
      dispatches: repositories.whatsappDispatches,
      history: repositories.commercialAutomationHistory,
      settings: repositories.commercialAutomationSettings,
      status: repositories.operationalStatus,
      policy: {
        evaluateAutomationReadiness: async (input) => {
          const service = getCommercialAutomationPolicyService();
          if (!service.evaluateAutomationReadiness) {
            throw new AppError(
              'Status operacional indisponivel',
              'OPERATIONAL_STATUS_UNAVAILABLE',
            );
          }
          return service.evaluateAutomationReadiness(input);
        },
        updateScheduleSettings: async (input) => {
          const service = getCommercialAutomationPolicyService();
          if (!service.updateScheduleSettings) {
            throw new AppError(
              'Configuracao operacional indisponivel',
              'OPERATIONAL_SETTINGS_UNAVAILABLE',
            );
          }
          return service.updateScheduleSettings(input);
        },
      },
      planner: commercialAutomationSchedulePlanner,
      config:
        options.commercialAutomationConfig ?? COMMERCIAL_AUTOMATION_DEFAULTS,
      queues: {
        productPipeline: getPipelineQueue(),
        whatsappDispatch: getWhatsAppDispatchQueue(),
        commercialAutomation: getCommercialAutomationQueue(),
      },
      scheduler: commercialSchedulerStatusService,
      maxMessagesPerRun:
        options.commercialConfirmationEnvironment?.maximumMessagesPerRun ?? 1,
      externalBudget,
      environment: {
        groupSendEnabled:
          options.commercialConfirmationEnvironment?.groupSendEnabled ?? false,
        safeMode: options.commercialConfirmationEnvironment?.safeMode ?? true,
      },
    });
    return operationalAdminService;
  };

  const allowedDashboardOrigin = 'http://127.0.0.1:3000';
  await app.register(cors, {
    origin: (origin, callback) =>
      callback(null, origin === allowedDashboardOrigin),
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type'],
    optionsSuccessStatus: 204,
    preflightContinue: true,
  });

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && origin !== allowedDashboardOrigin) {
      return reply.code(403).send({
        error: 'CORS_ORIGIN_FORBIDDEN',
        message: 'Origem nao permitida',
      });
    }

    if (request.method === 'OPTIONS' && origin === allowedDashboardOrigin) {
      return reply.code(204).send();
    }

    if (request.method === 'GET' && request.url.split('?')[0] === '/health') {
      return;
    }

    if (!localApiAuthToken) {
      return reply.code(503).send({
        error: 'LOCAL_API_AUTH_NOT_CONFIGURED',
        message: 'Autenticacao local indisponivel',
      });
    }

    const authorization = request.headers.authorization;
    const bearerMatch = /^Bearer ([^\s]+)$/.exec(authorization ?? '');
    if (!bearerMatch) {
      return reply.code(401).send({
        error: 'LOCAL_API_AUTH_REQUIRED',
        message: 'Autenticacao local obrigatoria',
      });
    }

    const expected = Buffer.from(localApiAuthToken);
    const received = Buffer.from(bearerMatch[1]);
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      return reply.code(401).send({
        error: 'LOCAL_API_AUTH_REQUIRED',
        message: 'Autenticacao local obrigatoria',
      });
    }
  });

  app.get('/health', async () => ({ status: 'ok', service: 'api' }));

  app.post('/commercial/niches', async (request, reply) => {
    try {
      return reply
        .code(201)
        .send(await commercialNicheService.create(request.body));
    } catch (error) {
      return sendCommercialConfigurationError(reply, error);
    }
  });

  app.get('/commercial/niches', async (request, reply) => {
    try {
      return await commercialNicheService.list(
        parseCommercialConfigurationQuery(request.query),
      );
    } catch (error) {
      return sendCommercialConfigurationError(reply, error);
    }
  });

  app.get('/commercial/niches/:id', async (request, reply) => {
    try {
      return await commercialNicheService.find(
        (request.params as { id: string }).id,
      );
    } catch (error) {
      return sendCommercialConfigurationError(reply, error);
    }
  });

  app.patch('/commercial/niches/:id', async (request, reply) => {
    try {
      return await commercialNicheService.update(
        (request.params as { id: string }).id,
        request.body,
      );
    } catch (error) {
      return sendCommercialConfigurationError(reply, error);
    }
  });

  app.post('/commercial/campaigns', async (request, reply) => {
    try {
      return reply
        .code(201)
        .send(await commercialGroupCampaignService.create(request.body));
    } catch (error) {
      return sendCommercialConfigurationError(reply, error);
    }
  });

  app.get('/commercial/campaigns', async (request, reply) => {
    try {
      return await commercialGroupCampaignService.list(
        parseCommercialConfigurationQuery(request.query),
      );
    } catch (error) {
      return sendCommercialConfigurationError(reply, error);
    }
  });

  app.get('/commercial/campaigns/:id', async (request, reply) => {
    try {
      return await commercialGroupCampaignService.find(
        (request.params as { id: string }).id,
      );
    } catch (error) {
      return sendCommercialConfigurationError(reply, error);
    }
  });

  app.patch('/commercial/campaigns/:id', async (request, reply) => {
    try {
      return await commercialGroupCampaignService.update(
        (request.params as { id: string }).id,
        request.body,
      );
    } catch (error) {
      return sendCommercialConfigurationError(reply, error);
    }
  });

  app.post('/commercial/campaigns/:id/activate', async (request, reply) => {
    try {
      return await commercialGroupCampaignService.activate(
        (request.params as { id: string }).id,
        request.body,
      );
    } catch (error) {
      return sendCommercialConfigurationError(reply, error);
    }
  });

  app.post('/commercial/campaigns/:id/deactivate', async (request, reply) => {
    try {
      return await commercialGroupCampaignService.deactivate(
        (request.params as { id: string }).id,
        request.body,
      );
    } catch (error) {
      return sendCommercialConfigurationError(reply, error);
    }
  });

  app.post(
    '/commercial/campaigns/:id/mining-preview',
    async (request, reply) => {
      try {
        return await getCommercialPromotionMiningService().preview(
          (request.params as { id: string }).id,
          request.body,
        );
      } catch (error) {
        return sendCommercialPromotionError(reply, error);
      }
    },
  );

  app.post('/commercial/campaigns/:id/mine', async (request, reply) => {
    try {
      return await getCommercialPromotionMiningService().mine(
        (request.params as { id: string }).id,
        request.body,
      );
    } catch (error) {
      return sendCommercialPromotionError(reply, error);
    }
  });

  app.get('/commercial/campaigns/:id/queue', async (request, reply) => {
    try {
      return await getCommercialPromotionMiningService().listQueue(
        (request.params as { id: string }).id,
        parseCommercialPromotionQueueQuery(request.query),
      );
    } catch (error) {
      return sendCommercialPromotionError(reply, error);
    }
  });

  app.post(
    '/commercial/promotion-candidates/:id/copy-preview',
    async (request, reply) => {
      try {
        assertEmptyCopyPreviewBody(request.body);
        return await getCommercialPromotionCopyService().preview(
          (request.params as { id: string }).id,
        );
      } catch (error) {
        return sendCommercialAiCopyError(reply, error);
      }
    },
  );

  app.post(
    '/commercial/promotion-candidates/:id/copy-generate',
    async (request, reply) => {
      try {
        return await getCommercialPromotionCopyService().generate(
          (request.params as { id: string }).id,
          parseCopyGenerateConfirmation(request.body),
        );
      } catch (error) {
        return sendCommercialAiCopyError(reply, error);
      }
    },
  );

  app.get(
    '/commercial/promotion-candidates/:id/copy',
    async (request, reply) => {
      try {
        return await getCommercialPromotionCopyService().findCopy(
          (request.params as { id: string }).id,
        );
      } catch (error) {
        return sendCommercialAiCopyError(reply, error);
      }
    },
  );

  app.get('/analytics', async (request, reply) => {
    try {
      const analyticsService =
        options.analyticsService ?? getApplicationServices().analytics;
      return await analyticsService.getSnapshot();
    } catch (error) {
      request.log.error(
        { event: 'analytics.route.failed', error },
        'Analytics route failed',
      );
      return reply.status(500).send({
        error: 'ANALYTICS_FETCH_FAILED',
        message: 'Falha ao consultar analytics',
      });
    }
  });

  app.get('/scheduler', async (request, reply) => {
    try {
      return await schedulerStatusService.getStatus();
    } catch (error) {
      request.log.error(
        {
          event: 'scheduler.status.route.failed',
          errorType: error instanceof Error ? error.name : 'UnknownError',
        },
        'Scheduler status route failed',
      );
      return reply.status(503).send({
        error: 'SCHEDULER_STATUS_UNAVAILABLE',
        message: 'Estado do Scheduler indisponivel',
      });
    }
  });

  const operationalAdminError = (reply: FastifyReply, error: unknown) => {
    const code =
      error instanceof AppError ? error.code : 'OPERATIONAL_ADMIN_UNAVAILABLE';
    const status = code.endsWith('NOT_FOUND')
      ? 404
      : code.includes('CONFLICT') ||
          code.includes('ACTIVE') ||
          code.includes('BLOCKED')
        ? 409
        : error instanceof AppError
          ? 400
          : 503;
    return reply.status(status).send({
      error: code,
      message:
        error instanceof AppError
          ? error.message
          : 'Estado operacional indisponivel',
    });
  };

  app.get('/operational-admin', async (request, reply) => {
    try {
      return await getOperationalAdminService().getOverview();
    } catch (error) {
      request.log.error(
        {
          event: 'operational-admin.overview.failed',
          errorType: error instanceof Error ? error.name : 'UnknownError',
        },
        'Operational admin overview failed',
      );
      return operationalAdminError(reply, error);
    }
  });

  app.get('/whatsapp/instances', async (request, reply) => {
    try {
      const overview = await getOperationalAdminService().getOverview();
      return overview.instances;
    } catch (error) {
      return operationalAdminError(reply, error);
    }
  });

  app.post('/whatsapp/instances', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (
      Object.keys(body).some(
        (key) => !['name', 'confirmation'].includes(key),
      ) ||
      typeof body.name !== 'string' ||
      (body.confirmation !== undefined && typeof body.confirmation !== 'string')
    ) {
      return reply.status(400).send({
        error: 'OPERATIONAL_INSTANCE_CREATE_INVALID',
        message: 'Cadastro de instancia invalido',
      });
    }
    try {
      return reply.status(201).send(
        await getOperationalAdminService().createInstance({
          name: body.name,
          confirmation: body.confirmation as string | undefined,
        }),
      );
    } catch (error) {
      return operationalAdminError(reply, error);
    }
  });

  app.patch('/whatsapp/instances/:name', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const allowed = new Set([
      'active',
      'paused',
      'expectedUpdatedAt',
      'confirmation',
    ]);
    if (
      Object.keys(body).some((key) => !allowed.has(key)) ||
      typeof body.expectedUpdatedAt !== 'string' ||
      (body.active !== undefined && typeof body.active !== 'boolean') ||
      (body.paused !== undefined && typeof body.paused !== 'boolean') ||
      (body.confirmation !== undefined && typeof body.confirmation !== 'string')
    ) {
      return reply.status(400).send({
        error: 'OPERATIONAL_INSTANCE_UPDATE_INVALID',
        message: 'Atualizacao de instancia invalida',
      });
    }
    try {
      return await getOperationalAdminService().updateInstance({
        name: (request.params as { name: string }).name,
        active: body.active as boolean | undefined,
        paused: body.paused as boolean | undefined,
        expectedUpdatedAt: body.expectedUpdatedAt,
        confirmation: body.confirmation as string | undefined,
      });
    } catch (error) {
      return operationalAdminError(reply, error);
    }
  });

  app.get('/whatsapp/groups/admin', async (request, reply) => {
    try {
      const overview = await getOperationalAdminService().getOverview();
      return overview.groups;
    } catch (error) {
      return operationalAdminError(reply, error);
    }
  });

  app.patch('/whatsapp/groups/:id/admin', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const allowed = new Set([
      'active',
      'paused',
      'assignedInstanceName',
      'assignedInstanceNames',
      'expectedUpdatedAt',
      'confirmation',
    ]);
    if (
      Object.keys(body).some((key) => !allowed.has(key)) ||
      typeof body.expectedUpdatedAt !== 'string' ||
      (body.active !== undefined && typeof body.active !== 'boolean') ||
      (body.paused !== undefined && typeof body.paused !== 'boolean') ||
      (body.assignedInstanceName !== undefined &&
        body.assignedInstanceName !== null &&
        typeof body.assignedInstanceName !== 'string') ||
      (body.assignedInstanceNames !== undefined &&
        (!Array.isArray(body.assignedInstanceNames) ||
          body.assignedInstanceNames.length > 32 ||
          body.assignedInstanceNames.some(
            (name) => typeof name !== 'string' || name.trim() === '',
          ))) ||
      (body.confirmation !== undefined && typeof body.confirmation !== 'string')
    ) {
      return reply.status(400).send({
        error: 'OPERATIONAL_GROUP_UPDATE_INVALID',
        message: 'Atualizacao de grupo invalida',
      });
    }
    try {
      return await getOperationalAdminService().updateGroup({
        id: (request.params as { id: string }).id,
        active: body.active as boolean | undefined,
        paused: body.paused as boolean | undefined,
        assignedInstanceName: body.assignedInstanceName as
          string | null | undefined,
        ...(body.assignedInstanceNames === undefined
          ? {}
          : { assignedInstanceNames: body.assignedInstanceNames as string[] }),
        expectedUpdatedAt: body.expectedUpdatedAt,
        confirmation: body.confirmation as string | undefined,
      });
    } catch (error) {
      return operationalAdminError(reply, error);
    }
  });

  app.patch('/commercial-automation/settings/admin', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const allowed = new Set([
      'allowedStartTime',
      'allowedEndTime',
      'timezone',
      'minimumIntervalMinutes',
      'staggerMinutes',
      'dailyGlobalLimit',
      'dailyGroupLimit',
      'dailyShopeeHttpLimit',
      'dailyOpenAiGenerationLimit',
      'expectedRevision',
      'confirmation',
    ]);
    if (
      Object.keys(body).some((key) => !allowed.has(key)) ||
      typeof body.expectedRevision !== 'number' ||
      typeof body.confirmation !== 'string'
    ) {
      return reply.status(400).send({
        error: 'OPERATIONAL_SETTINGS_UPDATE_INVALID',
        message: 'Atualizacao de configuracao invalida',
      });
    }
    for (const key of ['allowedStartTime', 'allowedEndTime', 'timezone'] as const) {
      if (
        body[key] !== undefined &&
        body[key] !== null &&
        typeof body[key] !== 'string'
      ) {
        return reply.status(400).send({
          error: 'OPERATIONAL_SETTINGS_UPDATE_INVALID',
          message: 'Atualizacao de configuracao invalida',
        });
      }
    }
    for (const key of [
      'minimumIntervalMinutes',
      'staggerMinutes',
      'dailyGlobalLimit',
      'dailyGroupLimit',
      'dailyShopeeHttpLimit',
      'dailyOpenAiGenerationLimit',
    ] as const) {
      if (
        body[key] !== undefined &&
        body[key] !== null &&
        typeof body[key] !== 'number'
      ) {
        return reply.status(400).send({
          error: 'OPERATIONAL_SETTINGS_UPDATE_INVALID',
          message: 'Atualizacao de configuracao invalida',
        });
      }
    }
    try {
      return await getOperationalAdminService().updateAutomationSettings({
        allowedStartTime: body.allowedStartTime as string | null | undefined,
        allowedEndTime: body.allowedEndTime as string | null | undefined,
        timezone: body.timezone as string | null | undefined,
        minimumIntervalMinutes: body.minimumIntervalMinutes as
          number | null | undefined,
        staggerMinutes: body.staggerMinutes as number | null | undefined,
        dailyGlobalLimit: body.dailyGlobalLimit as number | null | undefined,
        dailyGroupLimit: body.dailyGroupLimit as number | null | undefined,
        dailyShopeeHttpLimit: body.dailyShopeeHttpLimit as
          number | null | undefined,
        dailyOpenAiGenerationLimit: body.dailyOpenAiGenerationLimit as
          number | null | undefined,
        expectedRevision: body.expectedRevision,
        confirmation: body.confirmation,
      });
    } catch (error) {
      return operationalAdminError(reply, error);
    }
  });

  app.get('/commercial-automation/status', async (request, reply) => {
    try {
      return await getCommercialAutomationPolicyService().evaluateAutomationReadiness();
    } catch (error) {
      request.log.error(
        {
          event: 'commercial-automation.status.failed',
          errorType: error instanceof Error ? error.name : 'UnknownError',
        },
        'Commercial automation status failed',
      );
      return reply.status(500).send({
        error: 'COMMERCIAL_AUTOMATION_STATUS_FAILED',
        message: 'Falha ao consultar controle da automacao comercial',
      });
    }
  });

  app.get('/commercial-automation/scheduler', async (request, reply) => {
    try {
      return await commercialSchedulerStatusService.getStatus();
    } catch (error) {
      request.log.error(
        {
          event: 'commercial-automation.scheduler-status.failed',
          errorType: error instanceof Error ? error.name : 'UnknownError',
        },
        'Commercial automation scheduler status failed',
      );
      return reply.status(503).send({
        error: 'COMMERCIAL_AUTOMATION_SCHEDULER_STATUS_UNAVAILABLE',
        message: 'Status do Scheduler comercial indisponivel',
      });
    }
  });

  app.get('/commercial-automation/settings', async (request, reply) => {
    const service = getCommercialAutomationPolicyService();
    if (!service.getScheduleSettings) {
      return reply.status(503).send({
        error: 'COMMERCIAL_AUTOMATION_SETTINGS_UNAVAILABLE',
        message: 'Configuracao persistida da agenda indisponivel',
      });
    }
    try {
      return await service.getScheduleSettings();
    } catch (error) {
      request.log.error(
        {
          event: 'commercial-automation.schedule-settings.failed',
          errorType: error instanceof Error ? error.name : 'UnknownError',
        },
        'Commercial automation schedule settings failed',
      );
      return reply.status(503).send({
        error: 'COMMERCIAL_AUTOMATION_SETTINGS_UNAVAILABLE',
        message: 'Configuracao persistida da agenda indisponivel',
      });
    }
  });

  app.get('/commercial-automation/schedule/preview', async (request, reply) => {
    try {
      const result = await commercialAutomationSchedulePlanner.preview();
      const first = result.slots[0];
      return {
        scheduleRevision: first?.target.scheduleRevision ?? null,
        plannedSlots: result.slots.length,
        skippedTargets: result.skippedTargets,
        nextSlot: first
          ? {
              slotKey: first.slotKey,
              jobId: first.jobId,
              scheduledFor: first.target.scheduledFor,
              campaignId: first.target.campaignId,
              groupId: first.target.groupId,
              logicalGroupFingerprint: first.target.logicalGroupFingerprint,
              instanceName: first.target.instanceName,
            }
          : null,
      };
    } catch (error) {
      request.log.error(
        {
          event: 'commercial-automation.schedule-preview.failed',
          errorType: error instanceof Error ? error.name : 'UnknownError',
        },
        'Commercial automation schedule preview failed',
      );
      return reply.status(503).send({
        error: 'COMMERCIAL_AUTOMATION_SCHEDULE_PREVIEW_UNAVAILABLE',
        message: 'Previa da agenda comercial indisponivel',
      });
    }
  });

  app.patch(
    '/commercial-automation/settings/schedule',
    async (request, reply) => {
      const service = getCommercialAutomationPolicyService();
      if (!service.updateScheduleSettings) {
        return reply.status(503).send({
          error: 'COMMERCIAL_AUTOMATION_SETTINGS_UNAVAILABLE',
          message: 'Configuracao persistida da agenda indisponivel',
        });
      }
      const body = request.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return reply.status(400).send({
          error: 'COMMERCIAL_AUTOMATION_SCHEDULE_INVALID',
          message: 'Atualizacao de agenda invalida',
        });
      }
      const record = body as Record<string, unknown>;
      const allowedKeys = new Set([
        'allowedStartTime',
        'allowedEndTime',
        'timezone',
        'minimumIntervalMinutes',
        'staggerMinutes',
        'expectedRevision',
      ]);
      if (
        Object.keys(record).length === 0 ||
        Object.keys(record).some((key) => !allowedKeys.has(key))
      ) {
        return reply.status(400).send({
          error: 'COMMERCIAL_AUTOMATION_SCHEDULE_INVALID',
          message: 'Atualizacao de agenda invalida',
        });
      }
      const update: CommercialAutomationScheduleUpdate = {};
      for (const key of ['allowedStartTime', 'allowedEndTime', 'timezone'] as const) {
        const value = record[key];
        if (value !== undefined) {
          if (value !== null && typeof value !== 'string') {
            return reply.status(400).send({
              error: 'COMMERCIAL_AUTOMATION_SCHEDULE_INVALID',
              message: 'Atualizacao de agenda invalida',
            });
          }
          update[key] = value;
        }
      }
      for (const key of ['minimumIntervalMinutes', 'staggerMinutes'] as const) {
        const value = record[key];
        if (value !== undefined) {
          if (value !== null && typeof value !== 'number') {
            return reply.status(400).send({
              error: 'COMMERCIAL_AUTOMATION_SCHEDULE_INVALID',
              message: 'Atualizacao de agenda invalida',
            });
          }
          update[key] = value;
        }
      }
      if (record.expectedRevision !== undefined) {
        if (typeof record.expectedRevision !== 'number') {
          return reply.status(400).send({
            error: 'COMMERCIAL_AUTOMATION_SCHEDULE_INVALID',
            message: 'Atualizacao de agenda invalida',
          });
        }
        update.expectedRevision = record.expectedRevision;
      }
      try {
        return await service.updateScheduleSettings(update);
      } catch (error) {
        if (error instanceof AppError) {
          const status =
            error.code === 'COMMERCIAL_AUTOMATION_SCHEDULE_REVISION_CONFLICT'
              ? 409
              : 400;
          return reply
            .status(status)
            .send({ error: error.code, message: error.message });
        }
        request.log.error(
          {
            event: 'commercial-automation.schedule-settings.update-failed',
            errorType: error instanceof Error ? error.name : 'UnknownError',
          },
          'Commercial automation schedule settings update failed',
        );
        return reply.status(500).send({
          error: 'COMMERCIAL_AUTOMATION_SETTINGS_FAILED',
          message: 'Falha ao atualizar agenda comercial',
        });
      }
    },
  );

  app.get('/commercial-automation/executions', async (request, reply) => {
    try {
      const query = request.query as { page?: string; limit?: string };
      return await commercialAutomationExecutionService.list({
        page: parsePositiveInteger(query.page, 1, 10_000),
        limit: parsePositiveInteger(query.limit, 20, 100),
      });
    } catch (error) {
      const status =
        error instanceof AppError && error.code === 'INVALID_PAGINATION'
          ? 400
          : 500;
      return reply.status(status).send({
        error:
          status === 400
            ? 'INVALID_PAGINATION'
            : 'COMMERCIAL_AUTOMATION_EXECUTIONS_UNAVAILABLE',
        message:
          status === 400
            ? 'Paginacao invalida'
            : 'Historico da automacao comercial indisponivel',
      });
    }
  });

  app.get('/commercial-automation/outbox', async (request, reply) => {
    try {
      const query = request.query as {
        page?: string;
        limit?: string;
        status?: string;
      };
      const status = query.status?.toUpperCase();
      if (status && !['PENDING', 'PUBLISHED', 'AMBIGUOUS'].includes(status)) {
        throw new AppError(
          'Status de outbox invalido',
          'INVALID_OUTBOX_FILTER',
        );
      }
      return await commercialDispatchOutboxService.list({
        status: status as 'PENDING' | 'PUBLISHED' | 'AMBIGUOUS' | undefined,
        page: parsePositiveInteger(query.page, 1, 10_000),
        limit: parsePositiveInteger(query.limit, 20, 100),
      });
    } catch (error) {
      const invalid =
        error instanceof AppError &&
        ['INVALID_PAGINATION', 'INVALID_OUTBOX_FILTER'].includes(error.code);
      return reply.status(invalid ? 400 : 500).send({
        error: invalid ? error.code : 'COMMERCIAL_OUTBOX_HISTORY_UNAVAILABLE',
        message: invalid
          ? error.message
          : 'Historico do outbox comercial indisponivel',
      });
    }
  });

  app.get('/commercial-automation/outbox/:id', async (request, reply) => {
    try {
      return await commercialDispatchOutboxService.find(
        (request.params as { id: string }).id,
      );
    } catch (error) {
      const notFound =
        error instanceof AppError &&
        error.code === 'COMMERCIAL_OUTBOX_NOT_FOUND';
      return reply.status(notFound ? 404 : 500).send({
        error: notFound
          ? 'COMMERCIAL_OUTBOX_NOT_FOUND'
          : 'COMMERCIAL_OUTBOX_UNAVAILABLE',
        message: notFound
          ? 'Outbox comercial nao encontrado'
          : 'Outbox comercial indisponivel',
      });
    }
  });

  app.get('/commercial-automation/executions/:id', async (request, reply) => {
    try {
      return await commercialAutomationExecutionService.find(
        (request.params as { id: string }).id,
      );
    } catch (error) {
      const notFound =
        error instanceof AppError &&
        error.code === 'COMMERCIAL_AUTOMATION_EXECUTION_NOT_FOUND';
      return reply.status(notFound ? 404 : 500).send({
        error: notFound
          ? 'COMMERCIAL_AUTOMATION_EXECUTION_NOT_FOUND'
          : 'COMMERCIAL_AUTOMATION_EXECUTION_UNAVAILABLE',
        message: notFound
          ? 'Execucao da automacao comercial nao encontrada'
          : 'Execucao da automacao comercial indisponivel',
      });
    }
  });

  app.patch('/commercial-automation/settings', async (request, reply) => {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.status(400).send({
        error: 'INVALID_COMMERCIAL_AUTOMATION_SETTINGS',
        message: 'Configuracao da automacao comercial invalida',
      });
    }
    const record = body as Record<string, unknown>;
    const keys = Object.keys(record);
    const isPause = keys.length === 1 && record.paused === true;
    const isResume =
      keys.length === 3 &&
      keys.includes('paused') &&
      keys.includes('confirmation') &&
      keys.includes('expectedUpdatedAt') &&
      record.paused === false &&
      typeof record.confirmation === 'string' &&
      typeof record.expectedUpdatedAt === 'string';
    if (!isPause && !isResume) {
      return reply.status(400).send({
        error: 'INVALID_COMMERCIAL_AUTOMATION_SETTINGS',
        message: 'Configuracao da automacao comercial invalida',
      });
    }
    try {
      return await getCommercialAutomationPolicyService().setPaused({
        paused: record.paused as boolean,
        confirmation:
          typeof record.confirmation === 'string'
            ? record.confirmation
            : undefined,
        expectedUpdatedAt:
          typeof record.expectedUpdatedAt === 'string'
            ? record.expectedUpdatedAt
            : undefined,
      });
    } catch (error) {
      if (error instanceof AppError) {
        const conflict = error.code === 'COMMERCIAL_AUTOMATION_RESUME_CONFLICT';
        return reply.status(conflict ? 409 : 400).send({
          error: error.code,
          message: error.message,
        });
      }
      request.log.error(
        {
          event: 'commercial-automation.settings.failed',
          errorType: error instanceof Error ? error.name : 'UnknownError',
        },
        'Commercial automation settings update failed',
      );
      return reply.status(500).send({
        error: 'COMMERCIAL_AUTOMATION_SETTINGS_FAILED',
        message: 'Falha ao atualizar controle da automacao comercial',
      });
    }
  });

  app.post('/hunter/run', async (request, reply) => {
    try {
      const body = (request.body ?? {}) as ProductFilters;
      const filters: ProductFilters = {
        categoria:
          typeof body.categoria === 'string' ? body.categoria : undefined,
        precoMin: parseNumberFilter(body.precoMin, 'precoMin'),
        precoMax: parseNumberFilter(body.precoMax, 'precoMax'),
        descontoMin: parseNumberFilter(body.descontoMin, 'descontoMin'),
        notaMin: parseNumberFilter(body.notaMin, 'notaMin'),
        vendidosMin: parseNumberFilter(body.vendidosMin, 'vendidosMin'),
        comissaoMin: parseNumberFilter(body.comissaoMin, 'comissaoMin'),
      };

      return await getApplicationServices().hunter.run(filters);
    } catch (error) {
      request.log.error(
        { event: 'hunter.route.failed', error },
        'Hunter route failed',
      );
      if (error instanceof AppError && error.code === 'INVALID_HUNTER_FILTER') {
        return reply
          .status(400)
          .send({ error: error.code, message: error.message });
      }
      return reply.status(500).send({
        error: 'HUNTER_RUN_FAILED',
        message: 'Falha ao executar Hunter Agent',
      });
    }
  });

  app.post('/score/run', async (request, reply) => {
    try {
      return await getApplicationServices().score.run();
    } catch (error) {
      request.log.error(
        { event: 'score.route.failed', error },
        'Score route failed',
      );
      return reply.status(500).send({
        error: 'SCORE_RUN_FAILED',
        message: 'Falha ao executar Score Engine',
      });
    }
  });

  app.post('/copy/generate', async (request, reply) => {
    try {
      const body = (request.body ?? {}) as { productId?: unknown };
      if (
        typeof body.productId !== 'string' ||
        body.productId.trim().length === 0
      ) {
        return reply.status(400).send({
          error: 'INVALID_PRODUCT_ID',
          message: 'productId é obrigatório',
        });
      }

      return await getApplicationServices().copy.generate(body.productId);
    } catch (error) {
      request.log.error(
        { event: 'copy.route.failed', error },
        'Copy route failed',
      );
      if (error instanceof AppError && error.code === 'PRODUCT_NOT_FOUND') {
        return reply
          .status(404)
          .send({ error: error.code, message: error.message });
      }
      return reply.status(500).send({
        error: 'COPY_GENERATE_FAILED',
        message: 'Falha ao gerar copy',
      });
    }
  });

  app.post('/shopee/offers/sync', async (request, reply) => {
    try {
      if (shopeeOfferProvider.source === 'OFFICIAL') {
        throw new AppError(
          'Sync official permitido somente pelo CLI controlado',
          'SHOPEE_OFFICIAL_SYNC_CLI_REQUIRED',
        );
      }
      const body = (request.body ?? {}) as Record<string, unknown>;
      const input: ShopeeProductOfferListInput = {
        keyword:
          typeof body.keyword === 'string' ? body.keyword.trim() : undefined,
        categoryId:
          typeof body.categoryId === 'string'
            ? body.categoryId.trim()
            : undefined,
        minPrice:
          typeof body.minPrice === 'string' || typeof body.minPrice === 'number'
            ? String(body.minPrice)
            : undefined,
        maxPrice:
          typeof body.maxPrice === 'string' || typeof body.maxPrice === 'number'
            ? String(body.maxPrice)
            : undefined,
        minCommissionRate: parseNumberFilter(
          body.minCommissionRate,
          'minCommissionRate',
        ),
        minDiscountRate: parseNumberFilter(
          body.minDiscountRate,
          'minDiscountRate',
        ),
        minRating: parseNumberFilter(body.minRating, 'minRating'),
        limit: parsePositiveInteger(
          body.limit,
          options.shopeeMaxOffersPerSync ?? 20,
          options.shopeeMaxOffersPerSync ?? 20,
        ),
      };
      return await getApplicationServices().shopeeOfferSync.run(input);
    } catch (error) {
      const code =
        error instanceof AppError ? error.code : 'SHOPEE_SYNC_FAILED';
      const status =
        code === 'SHOPEE_OFFICIAL_SYNC_CLI_REQUIRED'
          ? 403
          : code === 'SHOPEE_API_NOT_CONFIGURED' ||
              code === 'SHOPEE_API_TRANSPORT_PENDING'
            ? 503
            : code === 'SHOPEE_MANUAL_INPUT_REQUIRED' ||
                code === 'INVALID_PAGINATION' ||
                code === 'INVALID_HUNTER_FILTER'
              ? 400
              : 500;
      return reply.status(status).send({
        error: code,
        message:
          error instanceof AppError
            ? error.message
            : 'Falha ao sincronizar ofertas da Shopee',
      });
    }
  });

  app.get('/shopee/offers', async (request, reply) => {
    try {
      const filters = parseCatalogQuery(request.query);
      const result =
        await repositories.shopeeOffers.listOperationalCatalog(filters);
      return {
        provider: shopeeOfferProvider.source.toLocaleLowerCase(),
        items: result.items.map((item) => ({
          ...item,
          status: offerStatus(item),
        })),
        flashDealCapability: FLASH_DEAL_CAPABILITY,
        page: filters.page,
        limit: filters.limit,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / filters.limit)),
        hasNextPage: filters.page * filters.limit < result.total,
        hasPreviousPage: filters.page > 1,
      };
    } catch (error) {
      if (
        error instanceof AppError &&
        (error.code === 'INVALID_PAGINATION' ||
          error.code === 'INVALID_CATALOG_QUERY')
      ) {
        return reply
          .status(400)
          .send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.get('/shopee/offers/categories', async () => ({
    items: await repositories.shopeeOffers.listObservedCategories(),
    hierarchyStatus: 'NOT_AVAILABLE_FROM_CURRENT_PROVIDER_CONTRACT' as const,
  }));

  app.get('/shopee/offers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!CATALOG_IDENTIFIER.test(id)) {
      return reply.status(400).send({
        error: 'INVALID_CATALOG_QUERY',
        message: 'Identificador inválido: id',
      });
    }
    let pagination: ReturnType<typeof parseCatalogDetailQuery>;
    try {
      pagination = parseCatalogDetailQuery(request.query);
    } catch (error) {
      if (error instanceof AppError && error.code === 'INVALID_CATALOG_QUERY') {
        return reply
          .status(400)
          .send({ error: error.code, message: error.message });
      }
      throw error;
    }
    const offer = await repositories.shopeeOffers.findOperationalCatalogOffer({
      id,
      ...pagination,
    });
    if (!offer) {
      return reply.status(404).send({
        error: 'OFFER_NOT_FOUND',
        message: 'Oferta nao encontrada',
      });
    }
    return {
      ...offer,
      status: offerStatus(offer),
      flashDealCapability: FLASH_DEAL_CAPABILITY,
    };
  });

  app.post('/shopee/offers/import/validate', async (request, reply) => {
    const body = request.body as unknown;
    const records = Array.isArray(body)
      ? body
      : body && typeof body === 'object' && 'records' in body
        ? (body as { records: unknown }).records
        : [body];
    if (
      !Array.isArray(records) ||
      records.length === 0 ||
      records.length > 100
    ) {
      return reply.status(400).send({
        error: 'INVALID_MANUAL_SHOPEE_OFFER',
        message: 'Envie entre 1 e 100 ofertas para validacao',
      });
    }
    const valid: ReturnType<typeof parseManualShopeeOffer>[] = [];
    const errors: { index: number; message: string }[] = [];
    records.forEach((record, index) => {
      try {
        valid.push(parseManualShopeeOffer(record));
      } catch (error) {
        errors.push({
          index,
          message:
            error instanceof AppError ? error.message : 'Registro invalido',
        });
      }
    });
    return {
      valid: errors.length === 0,
      count: valid.length,
      errors,
      preview: valid.map((offer) => ({
        ...offer,
        fetchedAt: offer.fetchedAt.toISOString(),
        offerStartsAt: offer.offerStartsAt?.toISOString(),
        offerEndsAt: offer.offerEndsAt?.toISOString(),
      })),
    };
  });

  app.post('/shopee/offers/import', async (request, reply) => {
    const body = (request.body ?? {}) as {
      records?: unknown;
      confirm?: unknown;
    };
    if (body.confirm !== 'CONFIRMAR_IMPORTACAO') {
      return reply.status(400).send({
        error: 'SHOPEE_IMPORT_CONFIRMATION_REQUIRED',
        message: 'Confirmacao explicita obrigatoria',
      });
    }
    if (!Array.isArray(body.records) || body.records.length < 1) {
      return reply.status(400).send({
        error: 'INVALID_MANUAL_SHOPEE_OFFER',
        message: 'Informe ao menos uma oferta manual',
      });
    }
    try {
      const service = new ShopeeOfferSyncService({
        provider: new ManualShopeeAffiliateOfferProvider(body.records),
        offers: repositories.shopeeOffers,
        maxOffersPerSync: options.shopeeMaxOffersPerSync ?? 20,
        logger: app.log,
      });
      return await service.run({ limit: body.records.length });
    } catch (error) {
      return reply.status(400).send({
        error:
          error instanceof AppError
            ? error.code
            : 'INVALID_MANUAL_SHOPEE_OFFER',
        message:
          error instanceof AppError ? error.message : 'Oferta manual invalida',
      });
    }
  });

  app.post('/shopee/offers/:id/copy-preview', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return await getApplicationServices().copyPreview.preview(id);
    } catch (error) {
      if (error instanceof AppError) {
        const status = error.code === 'OFFER_NOT_FOUND' ? 404 : 409;
        return reply
          .status(status)
          .send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.post('/commercial-pipeline/dry-run', async (request, reply) => {
    try {
      const input = parseCommercialPipelineInput(request.body ?? {});
      return await getCommercialPipelineService().dryRun(input);
    } catch (error) {
      const code =
        error instanceof AppError ? error.code : 'COMMERCIAL_PIPELINE_FAILED';
      const status =
        code === 'INVALID_PIPELINE_FILTERS'
          ? 400
          : [
                'NO_ELIGIBLE_PRODUCT',
                'NO_AUTHORIZED_GROUP',
                'MULTIPLE_AUTHORIZED_GROUPS',
                'COMMERCIAL_AUTOMATION_DUPLICATE_LOGICAL_GROUP',
                'PRODUCT_ALREADY_SENT',
              ].includes(code)
            ? 409
            : 500;
      request.log.error(
        { event: 'commercial-pipeline.route.failed', code },
        'Commercial pipeline route failed',
      );
      return reply.status(status).send({
        error: code,
        message:
          error instanceof AppError
            ? error.message
            : 'Falha segura no pipeline comercial',
      });
    }
  });

  app.post('/commercial-pipeline/runs/:id/confirm', async (request, reply) => {
    const body = request.body;
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      typeof (body as Record<string, unknown>).confirmation !== 'string'
    ) {
      return reply.status(400).send({
        error: 'COMMERCIAL_CONFIRMATION_INVALID',
        message: 'Confirmacao comercial invalida',
      });
    }
    try {
      const { id } = request.params as { id: string };
      return await getCommercialPipelineConfirmationService().confirm(
        id,
        (body as { confirmation: string }).confirmation,
      );
    } catch (error) {
      const code =
        error instanceof AppError ? error.code : 'COMMERCIAL_DISPATCH_FAILED';
      const status =
        code === 'COMMERCIAL_CONFIRMATION_INVALID'
          ? 400
          : code === 'COMMERCIAL_RUN_NOT_READY'
            ? 404
            : code === 'COMMERCIAL_DISPATCH_FAILED'
              ? 500
              : 409;
      request.log.error(
        { event: 'commercial-pipeline.confirm.route.failed', code },
        'Commercial pipeline confirmation route failed',
      );
      return reply.status(status).send({
        error: code,
        message:
          error instanceof AppError
            ? error.message
            : 'Falha segura ao confirmar pipeline comercial',
      });
    }
  });

  app.get('/commercial-publications/manual/options', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    if (typeof query.productId !== 'string' || !query.productId.trim()) {
      return reply.status(400).send({
        error: 'MANUAL_PUBLICATION_INVALID',
        message: 'productId obrigatorio',
      });
    }
    try {
      return await getManualPublicationService().getOptions(query.productId);
    } catch (error) {
      const code =
        error instanceof AppError ? error.code : 'MANUAL_PUBLICATION_FAILED';
      const status =
        code === 'OFFER_NOT_FOUND'
          ? 404
          : code.startsWith('MANUAL_PUBLICATION_')
            ? 409
            : 500;
      return reply.status(status).send({
        error: code,
        message:
          error instanceof AppError
            ? error.message
            : 'Falha ao consultar opcoes de publicacao manual',
      });
    }
  });

  app.post(
    '/commercial-publications/manual/preview',
    async (request, reply) => {
      const body = request.body;
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).sort().join('|') !==
          'destinationIds|idempotencyKey|productId'
      ) {
        return reply.status(400).send({
          error: 'MANUAL_PUBLICATION_INVALID',
          message: 'Payload de preview manual invalido',
        });
      }
      try {
        const result = await getManualPublicationService().preview(
          body as ManualPublicationPreviewInput,
        );
        return reply.status(result.created ? 201 : 200).send(result.request);
      } catch (error) {
        const code =
          error instanceof AppError ? error.code : 'MANUAL_PUBLICATION_FAILED';
        const status =
          code === 'MANUAL_PUBLICATION_INVALID' ||
          code === 'MANUAL_PUBLICATION_DESTINATION_LIMIT'
            ? 400
            : code === 'OFFER_NOT_FOUND'
              ? 404
              : code.startsWith('MANUAL_PUBLICATION_') ||
                  code.startsWith('COMMERCIAL_') ||
                  code === 'CAMPAIGN_INACTIVE' ||
                  code === 'NICHE_INACTIVE'
                ? 409
                : 500;
        request.log.error(
          { event: 'manual-publication.preview.route.failed', code },
          'Manual publication preview route failed',
        );
        return reply.status(status).send({
          error: code,
          message:
            error instanceof AppError
              ? error.message
              : 'Falha segura no preview de publicacao manual',
        });
      }
    },
  );

  app.post('/commercial-publications/manual', async (request, reply) => {
    const body = request.body;
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).sort().join('|') !==
        'confirm|destinationIds|idempotencyKey|productId'
    ) {
      return reply.status(400).send({
        error: 'MANUAL_PUBLICATION_INVALID',
        message: 'Payload de publicacao manual invalido',
      });
    }
    try {
      const result = await getManualPublicationService().create(
        body as ManualPublicationInput,
      );
      return reply.status(result.created ? 201 : 200).send(result.request);
    } catch (error) {
      const code =
        error instanceof AppError ? error.code : 'MANUAL_PUBLICATION_FAILED';
      const status =
        code === 'MANUAL_PUBLICATION_INVALID' ||
        code === 'MANUAL_PUBLICATION_CONFIRMATION_INVALID' ||
        code === 'MANUAL_PUBLICATION_DESTINATION_LIMIT'
          ? 400
          : code === 'OFFER_NOT_FOUND'
            ? 404
            : code === 'MANUAL_PUBLICATION_IDEMPOTENCY_CONFLICT' ||
                code.startsWith('MANUAL_PUBLICATION_') ||
                code.startsWith('COMMERCIAL_') ||
                code === 'PRODUCT_ALREADY_SENT'
              ? 409
              : 500;
      request.log.error(
        { event: 'manual-publication.route.failed', code },
        'Manual publication route failed',
      );
      return reply.status(status).send({
        error: code,
        message:
          error instanceof AppError
            ? error.message
            : 'Falha segura na publicacao manual',
      });
    }
  });

  app.get(
    '/commercial-publications/manual/:requestId',
    async (request, reply) => {
      try {
        const { requestId } = request.params as { requestId: string };
        return await getManualPublicationService().find(requestId);
      } catch (error) {
        const code =
          error instanceof AppError ? error.code : 'MANUAL_PUBLICATION_FAILED';
        return reply
          .status(code === 'MANUAL_PUBLICATION_NOT_FOUND' ? 404 : 500)
          .send({
            error: code,
            message:
              error instanceof AppError
                ? error.message
                : 'Falha ao consultar publicacao manual',
          });
      }
    },
  );

  app.post(
    '/commercial-publications/manual/:requestId/reconcile',
    async (request, reply) => {
      const body = request.body;
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).sort().join('|') !==
          'confirmation|executionId|resolution|targetId'
      ) {
        return reply.status(400).send({
          error: 'MANUAL_PUBLICATION_RECOVERY_INVALID',
          message: 'Payload de reconciliation manual invalido',
        });
      }
      try {
        const service = getManualPublicationService();
        if (!service.reconcileSafePreProviderAmbiguity) {
          throw new AppError(
            'Recovery de ambiguidade manual indisponivel',
            'MANUAL_PUBLICATION_RECOVERY_UNAVAILABLE',
          );
        }
        const { requestId } = request.params as { requestId: string };
        return await service.reconcileSafePreProviderAmbiguity(
          requestId,
          body as ManualPublicationReconciliationInput,
        );
      } catch (error) {
        const code =
          error instanceof AppError
            ? error.code
            : 'MANUAL_PUBLICATION_RECOVERY_FAILED';
        const status =
          code === 'MANUAL_PUBLICATION_RECOVERY_INVALID' ||
          code === 'MANUAL_PUBLICATION_RECOVERY_RESOLUTION_INVALID' ||
          code === 'MANUAL_PUBLICATION_RECOVERY_CONFIRMATION_INVALID' ||
          code === 'MANUAL_PUBLICATION_INVALID'
            ? 400
            : code === 'MANUAL_PUBLICATION_NOT_FOUND'
              ? 404
              : code === 'MANUAL_PUBLICATION_RECOVERY_UNAVAILABLE'
                ? 503
                : code === 'RECOVERY_NOT_SAFE' ||
                    code === 'RECOVERY_RESERVATION_OWNERSHIP_MISMATCH' ||
                    code === 'RECOVERY_CAS_CONFLICT'
                  ? 409
                  : 500;
        request.log.error(
          { event: 'manual-publication.reconcile.route.failed', code },
          'Manual publication reconciliation route failed',
        );
        return reply.status(status).send({
          error: code,
          message:
            error instanceof AppError
              ? error.message
              : 'Falha segura na reconciliation da publicacao manual',
        });
      }
    },
  );

  app.get('/commercial-pipeline/runs', async (request, reply) => {
    try {
      const query = request.query as Record<string, unknown>;
      const status =
        query.status === undefined
          ? undefined
          : String(query.status).toUpperCase();
      const mode =
        query.mode === undefined
          ? undefined
          : String(query.mode).toUpperCase().replace('-', '_');
      if (
        (status &&
          !['STARTED', 'COMPLETED', 'BLOCKED', 'FAILED'].includes(status)) ||
        (mode && !['DRY_RUN', 'CONFIRMED'].includes(mode)) ||
        (query.productId !== undefined && typeof query.productId !== 'string')
      ) {
        throw new AppError(
          'Filtros de historico invalidos',
          'INVALID_PIPELINE_FILTERS',
        );
      }
      return await getCommercialPipelineService().listRuns({
        status: status as
          'STARTED' | 'COMPLETED' | 'BLOCKED' | 'FAILED' | undefined,
        mode: mode as 'DRY_RUN' | 'CONFIRMED' | undefined,
        productId:
          typeof query.productId === 'string'
            ? query.productId.trim() || undefined
            : undefined,
        page: parsePositiveInteger(query.page, 1, 100000),
        limit: parsePositiveInteger(query.limit, 20, 100),
      });
    } catch (error) {
      if (error instanceof AppError) {
        return reply.status(400).send({
          error: 'INVALID_PIPELINE_FILTERS',
          message: 'Filtros de historico invalidos',
        });
      }
      return reply.status(500).send({
        error: 'COMMERCIAL_PIPELINE_FAILED',
        message: 'Falha ao consultar historico comercial',
      });
    }
  });

  app.get('/commercial-pipeline/runs/:id', async (request, reply) => {
    try {
      return await getCommercialPipelineService().findRun(
        (request.params as { id: string }).id,
      );
    } catch (error) {
      if (
        error instanceof AppError &&
        error.code === 'COMMERCIAL_PIPELINE_RUN_NOT_FOUND'
      ) {
        return reply.status(404).send({
          error: error.code,
          message: error.message,
        });
      }
      return reply.status(500).send({
        error: 'COMMERCIAL_PIPELINE_FAILED',
        message: 'Falha ao consultar execucao comercial',
      });
    }
  });

  app.get('/coupons', async () => getApplicationServices().coupons.list());

  app.get('/coupons/:id', async (request, reply) => {
    try {
      return await getApplicationServices().coupons.find(
        (request.params as { id: string }).id,
      );
    } catch (error) {
      return reply.status(404).send({
        error: 'COUPON_NOT_FOUND',
        message:
          error instanceof AppError ? error.message : 'Cupom nao encontrado',
      });
    }
  });

  app.post('/coupons', async (request, reply) => {
    try {
      const coupon = await getApplicationServices().coupons.create(
        (request.body ?? {}) as Record<string, unknown>,
      );
      return reply.status(201).send(coupon);
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof AppError ? error.code : 'INVALID_COUPON',
        message: error instanceof AppError ? error.message : 'Cupom invalido',
      });
    }
  });

  app.patch('/coupons/:id', async (request, reply) => {
    try {
      return await getApplicationServices().coupons.update(
        (request.params as { id: string }).id,
        (request.body ?? {}) as Record<string, unknown>,
      );
    } catch (error) {
      const status =
        error instanceof AppError && error.code === 'COUPON_NOT_FOUND'
          ? 404
          : 400;
      return reply.status(status).send({
        error: error instanceof AppError ? error.code : 'INVALID_COUPON',
        message: error instanceof AppError ? error.message : 'Cupom invalido',
      });
    }
  });

  app.delete('/coupons/:id', async (request, reply) => {
    try {
      await getApplicationServices().coupons.delete(
        (request.params as { id: string }).id,
        (request.body ?? {}) && (request.body as { confirm?: unknown }).confirm,
      );
      return reply.status(204).send();
    } catch (error) {
      const status =
        error instanceof AppError && error.code === 'COUPON_NOT_FOUND'
          ? 404
          : 400;
      return reply.status(status).send({
        error: error instanceof AppError ? error.code : 'COUPON_DELETE_FAILED',
        message:
          error instanceof AppError ? error.message : 'Falha ao excluir cupom',
      });
    }
  });

  app.post('/pipeline/run', async (request, reply) => {
    const body = (request.body ?? {}) as PipelineProductJob;
    const queue = getPipelineQueue();
    const job = await queue.add(
      JOB_NAMES.pipelineProduct,
      { filters: body.filters },
      undefined,
    );
    return reply.status(202).send({ jobId: job.id, status: 'queued' });
  });

  app.get('/pipeline/jobs/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const queue = getPipelineQueue();
    const job = await queue.getJob?.(params.id);
    if (!job)
      return reply
        .status(404)
        .send({ error: 'JOB_NOT_FOUND', message: 'Job não encontrado' });
    return {
      status: await job.getState(),
      progress: job.progress,
      startedAt: job.processedOn
        ? new Date(job.processedOn).toISOString()
        : null,
      finishedAt: job.finishedOn
        ? new Date(job.finishedOn).toISOString()
        : null,
      result: job.returnvalue ?? null,
      error: job.failedReason ?? null,
    };
  });

  app.post('/whatsapp/destinations', async (request, reply) => {
    const body = (request.body ?? {}) as {
      name?: unknown;
      destination?: unknown;
      active?: unknown;
    };
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return reply.status(400).send({
        error: 'INVALID_DESTINATION_NAME',
        message: 'name é obrigatório',
      });
    }
    if (
      typeof body.destination !== 'string' ||
      body.destination.trim().length === 0
    ) {
      return reply.status(400).send({
        error: 'INVALID_DESTINATION',
        message: 'destination é obrigatório',
      });
    }
    if (body.destination.trim().toLowerCase().endsWith('@g.us')) {
      return reply.status(400).send({
        error: 'GROUP_DESTINATION_REQUIRES_SYNC',
        message: 'Grupos devem ser descobertos pela sincronizacao segura',
      });
    }
    return repositories.whatsappDestinations.create({
      name: body.name.trim(),
      destination: body.destination.trim(),
      active: typeof body.active === 'boolean' ? body.active : true,
    });
  });

  app.get('/whatsapp/destinations', async () =>
    repositories.whatsappDestinations.list(),
  );

  app.patch('/whatsapp/destinations/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const body = (request.body ?? {}) as {
      name?: unknown;
      destination?: unknown;
      active?: unknown;
    };
    const data: { name?: string; destination?: string; active?: boolean } = {};
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0)
        return reply.status(400).send({
          error: 'INVALID_DESTINATION_NAME',
          message: 'name não pode ser vazio',
        });
      data.name = body.name.trim();
    }
    if (body.destination !== undefined) {
      if (
        typeof body.destination !== 'string' ||
        body.destination.trim().length === 0
      )
        return reply.status(400).send({
          error: 'INVALID_DESTINATION',
          message: 'destination não pode ser vazio',
        });
      data.destination = body.destination.trim();
      if (data.destination.toLowerCase().endsWith('@g.us')) {
        return reply.status(400).send({
          error: 'GROUP_DESTINATION_REQUIRES_SYNC',
          message: 'Grupos devem ser descobertos pela sincronizacao segura',
        });
      }
    }
    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean')
        return reply.status(400).send({
          error: 'INVALID_ACTIVE',
          message: 'active deve ser boolean',
        });
      data.active = body.active;
    }
    const updated = await repositories.whatsappDestinations.update(
      params.id,
      data,
    );
    if (!updated) {
      return reply.status(404).send({
        error: 'DESTINATION_NOT_FOUND',
        message: 'Destino não encontrado',
      });
    }
    return updated;
  });

  const unavailableGroupDirectory = (reply: {
    status(code: number): { send(payload: unknown): unknown };
  }) =>
    reply.status(503).send({
      error: 'WHATSAPP_GROUP_DIRECTORY_UNAVAILABLE',
      message: 'Diretorio de grupos indisponivel',
    });

  app.post('/whatsapp/groups/sync', async (request, reply) => {
    if (!groupDirectoryService) return unavailableGroupDirectory(reply);
    try {
      return await groupDirectoryService.sync();
    } catch (error) {
      request.log.error(
        {
          event: 'whatsapp.groups.sync-route-failed',
          errorType: error instanceof Error ? error.name : 'UnknownError',
          code: error instanceof AppError ? error.code : 'UNKNOWN',
        },
        'WhatsApp group sync route failed',
      );
      return unavailableGroupDirectory(reply);
    }
  });

  const parseBooleanQuery = (value: unknown, field: string) => {
    if (value === undefined) return undefined;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new AppError(
      `${field} deve ser true ou false`,
      'INVALID_GROUP_FILTER',
    );
  };

  app.get('/whatsapp/groups', async (request, reply) => {
    if (!groupDirectoryService) return unavailableGroupDirectory(reply);
    try {
      const query = request.query as { active?: unknown; available?: unknown };
      return await groupDirectoryService.list({
        active: parseBooleanQuery(query.active, 'active'),
        available: parseBooleanQuery(query.available, 'available'),
      });
    } catch (error) {
      if (error instanceof AppError && error.code === 'INVALID_GROUP_FILTER') {
        return reply
          .status(400)
          .send({ error: error.code, message: error.message });
      }
      return unavailableGroupDirectory(reply);
    }
  });

  app.get('/whatsapp/groups/:id', async (request, reply) => {
    if (!groupDirectoryService) return unavailableGroupDirectory(reply);
    try {
      const params = request.params as { id: string };
      return await groupDirectoryService.find(params.id);
    } catch (error) {
      if (
        error instanceof AppError &&
        error.code === 'WHATSAPP_GROUP_NOT_FOUND'
      ) {
        return reply
          .status(404)
          .send({ error: error.code, message: error.message });
      }
      return unavailableGroupDirectory(reply);
    }
  });

  app.patch('/whatsapp/groups/:id', async (request, reply) => {
    if (!groupDirectoryService) return unavailableGroupDirectory(reply);
    const params = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (
      Object.keys(body).some((key) => !['active', 'confirm'].includes(key)) ||
      typeof body.active !== 'boolean' ||
      (body.confirm !== undefined && typeof body.confirm !== 'string')
    ) {
      return reply.status(400).send({
        error: 'INVALID_GROUP_UPDATE',
        message: 'Somente o campo active pode ser alterado',
      });
    }
    try {
      return (await groupDirectoryService.setActive(
        params.id,
        body.active,
        body.confirm as string | undefined,
      )) satisfies WhatsAppGroupPublic;
    } catch (error) {
      if (error instanceof AppError) {
        const status =
          error.code === 'WHATSAPP_GROUP_NOT_FOUND'
            ? 404
            : error.code === 'WHATSAPP_GROUP_UNAVAILABLE'
              ? 409
              : 400;
        return reply
          .status(status)
          .send({ error: error.code, message: error.message });
      }
      return unavailableGroupDirectory(reply);
    }
  });

  app.get('/whatsapp/dispatches', async (request) => {
    const query = request.query as {
      status?: string;
      destinationId?: string;
      productId?: string;
    };
    const dispatches = await repositories.whatsappDispatches.list({
      status: query.status,
      destinationId: query.destinationId,
      productId: query.productId,
    });
    return dispatches.map((dispatch) => ({
      ...dispatch,
      destination: sanitizeDispatchDestination(dispatch.destination),
    }));
  });

  app.get('/whatsapp/dispatches/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const dispatch = await repositories.whatsappDispatches.findByIdWithDetails(
      params.id,
    );
    if (!dispatch)
      return reply
        .status(404)
        .send({ error: 'DISPATCH_NOT_FOUND', message: 'Envio não encontrado' });
    return {
      ...dispatch,
      destination: sanitizeDispatchDestination(dispatch.destination),
    };
  });

  app.addHook('onClose', async () => {
    const cleanups = [
      async () => pipelineQueue?.close?.(),
      async () => {
        if (whatsappDispatchQueue !== pipelineQueue) {
          await whatsappDispatchQueue?.close?.();
        }
      },
      async () => {
        if (
          commercialAutomationQueue !== pipelineQueue &&
          commercialAutomationQueue !== whatsappDispatchQueue
        ) {
          await commercialAutomationQueue?.close();
        }
      },
      async () => redisConnection?.quit(),
      async () => {
        if (!options.prisma) await prisma.$disconnect();
      },
    ];
    let firstError: unknown;
    for (const cleanup of cleanups) {
      try {
        await cleanup();
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  });

  return app;
};
