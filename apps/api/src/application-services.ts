import type { FastifyBaseLogger } from 'fastify';
import type { DatabaseClient } from '@shopee-auto-affiliate-ai/database';
import type {
  HunterProvider,
  ShopeeAffiliateOfferProvider,
  WhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';
import { MockShopeeAffiliateOfferProvider } from '@shopee-auto-affiliate-ai/providers';
import type { WhatsAppDispatchJob } from '@shopee-auto-affiliate-ai/queue';
import { HunterService } from './hunter-service';
import { ScoreService } from './score-service';
import { CopyService } from './copy-service';
import { SenderService } from './sender-service';
import { PipelineService } from './pipeline-service';
import { AnalyticsService } from './analytics-service';
import { ShopeeOfferSyncService } from './shopee-offer-sync-service';
import { CouponService } from './coupon-service';
import { CopyPreviewService } from './copy-preview-service';
import { CommercialCopyService } from './commercial-copy-service';
import { CommercialPipelineService } from './commercial-pipeline-service';
import { CommercialMessageDraftService } from './commercial-message-draft-service';
import { createCommercialPromotionMiningDomainService } from './commercial-promotion-mining-service';
import {
  CommercialPipelineConfirmationService,
  type CommercialConfirmationEnvironment,
} from './commercial-pipeline-confirmation-service';
import {
  CommercialDispatchOutboxPublisher,
  type CommercialDispatchOutboxQueue,
} from './commercial-dispatch-outbox-publisher';
import {
  PrismaCommercialAutomationHistoryRepository,
  PrismaCommercialAutomationExecutionRepository,
  PrismaCommercialAutomationSettingsRepository,
  PrismaAnalyticsRepository,
  PrismaCommercialDeliveryHistoryRepository,
  PrismaCommercialDispatchOutboxRepository,
  PrismaCommercialGroupCampaignRepository,
  PrismaCommercialNicheRepository,
  PrismaCommercialPipelineRunRepository,
  PrismaCommercialPromotionRepository,
  PrismaCommercialPromotionCopyRepository,
  PrismaCouponRepository,
  PrismaGeneratedCopyRepository,
  PrismaProductRepository,
  PrismaShopeeOfferRepository,
  PrismaWhatsAppDestinationRepository,
  PrismaWhatsAppDispatchRepository,
  PrismaWhatsAppGroupDirectoryRepository,
} from './prisma-repositories';
import type {
  AnalyticsRepository,
  CommercialAutomationHistoryRepository,
  CommercialAutomationExecutionRepository,
  CommercialAutomationSettingsRepository,
  CommercialDeliveryHistoryRepository,
  CommercialDispatchOutboxRepository,
  CommercialGroupCampaignRepository,
  CommercialNicheRepository,
  CommercialPipelineRunRepository,
  CommercialPipelineRunFinalizationRepository,
  CommercialPromotionCandidateRepository,
  CommercialPromotionCatalogRepository,
  CommercialPromotionCopyRepository,
  CouponRepository,
  GeneratedCopyRepository,
  ProductRepository,
  ShopeeOfferRepository,
  WhatsAppDestinationRepository,
  WhatsAppDispatchRepository,
  WhatsAppGroupDirectoryRepository,
} from './repositories';
import {
  CommercialAutomationPolicyService,
  type CommercialAutomationPolicyConfig,
} from './commercial-automation-policy-service';
import type { WhatsAppGroupSendPolicy } from './whatsapp-group-send-policy';
import type { CommercialAiCopyProvider } from './commercial-ai-copy-provider';
import {
  CommercialPromotionCopyGenerationService,
  type CommercialAiCopyConfig,
} from './commercial-promotion-copy-generation-service';

type DispatchQueue = {
  add: (
    name: string,
    data: WhatsAppDispatchJob,
    opts?: unknown,
  ) => Promise<unknown>;
};

export type ApplicationRepositories = {
  analytics: AnalyticsRepository;
  products: ProductRepository;
  generatedCopies: GeneratedCopyRepository;
  whatsappDestinations: WhatsAppDestinationRepository;
  whatsappDispatches: WhatsAppDispatchRepository;
  whatsappGroups: WhatsAppGroupDirectoryRepository;
  shopeeOffers: ShopeeOfferRepository;
  coupons: CouponRepository;
  commercialRuns: CommercialPipelineRunRepository &
    CommercialPipelineRunFinalizationRepository;
  commercialDeliveryHistory: CommercialDeliveryHistoryRepository;
  commercialDispatchOutboxes: CommercialDispatchOutboxRepository;
  commercialNiches: CommercialNicheRepository;
  commercialGroupCampaigns: CommercialGroupCampaignRepository;
  commercialPromotions: CommercialPromotionCatalogRepository &
    CommercialPromotionCandidateRepository;
  commercialPromotionCopies: CommercialPromotionCopyRepository;
  commercialAutomationSettings: CommercialAutomationSettingsRepository;
  commercialAutomationHistory: CommercialAutomationHistoryRepository;
  commercialAutomationExecutions: CommercialAutomationExecutionRepository;
};

export type ApplicationServices = {
  analytics: AnalyticsService;
  hunter: HunterService;
  score: ScoreService;
  copy: CopyService;
  sender?: SenderService;
  pipeline: PipelineService;
  shopeeOfferSync: ShopeeOfferSyncService;
  coupons: CouponService;
  copyPreview: CopyPreviewService;
};

export const createCommercialPipelineService = ({
  repositories,
  score,
  instanceName,
  subIdPrefix,
  maximumCopyLength,
  logger,
}: {
  repositories: Pick<
    ApplicationRepositories,
    | 'shopeeOffers'
    | 'whatsappGroups'
    | 'commercialGroupCampaigns'
    | 'whatsappDispatches'
    | 'commercialRuns'
    | 'commercialDeliveryHistory'
  >;
  score: Pick<ScoreService, 'calculate'>;
  instanceName: string;
  subIdPrefix: string;
  maximumCopyLength: number;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
}) =>
  new CommercialPipelineService({
    offers: repositories.shopeeOffers,
    groups: repositories.whatsappGroups,
    campaigns: repositories.commercialGroupCampaigns,
    score,
    copy: new CommercialCopyService(maximumCopyLength),
    runs: repositories.commercialRuns,
    deliveryHistory: repositories.commercialDeliveryHistory,
    dispatches: repositories.whatsappDispatches,
    instanceName,
    subIdPrefix,
    logger,
  });

export const createCommercialPipelineConfirmationService = ({
  repositories,
  queue,
  instanceName,
  maximumCopyLength,
  environment,
  logger,
}: {
  repositories: Pick<
    ApplicationRepositories,
    | 'shopeeOffers'
    | 'whatsappGroups'
    | 'commercialRuns'
    | 'commercialDeliveryHistory'
    | 'commercialDispatchOutboxes'
  >;
  queue: CommercialDispatchOutboxQueue;
  instanceName: string;
  maximumCopyLength: number;
  environment: CommercialConfirmationEnvironment;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
}) =>
  new CommercialPipelineConfirmationService({
    offers: repositories.shopeeOffers,
    groups: repositories.whatsappGroups,
    outboxes: repositories.commercialDispatchOutboxes,
    runs: repositories.commercialRuns,
    deliveryHistory: repositories.commercialDeliveryHistory,
    copy: new CommercialCopyService(maximumCopyLength),
    publisher: new CommercialDispatchOutboxPublisher({
      outboxes: repositories.commercialDispatchOutboxes,
      queue,
      logger,
    }),
    instanceName,
    environment,
    logger,
  });

export const createCommercialPromotionMiningService = ({
  repositories,
  score,
  logger,
  clock,
}: {
  repositories: Pick<
    ApplicationRepositories,
    'commercialGroupCampaigns' | 'commercialNiches' | 'commercialPromotions'
  >;
  score: Pick<ScoreService, 'calculate'>;
  logger: Pick<FastifyBaseLogger, 'info'>;
  clock?: () => Date;
}) =>
  createCommercialPromotionMiningDomainService({
    campaigns: repositories.commercialGroupCampaigns,
    niches: repositories.commercialNiches,
    promotions: repositories.commercialPromotions,
    score,
    logger,
    clock,
  });

export const createCommercialPromotionCopyGenerationService = ({
  repositories,
  provider,
  config,
  logger,
  clock,
}: {
  repositories: Pick<ApplicationRepositories, 'commercialPromotionCopies'>;
  provider?: CommercialAiCopyProvider;
  config: CommercialAiCopyConfig;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
  clock?: () => Date;
}) =>
  new CommercialPromotionCopyGenerationService({
    repository: repositories.commercialPromotionCopies,
    provider,
    config,
    logger,
    clock,
  });

export const createCommercialAutomationPolicyService = ({
  repositories,
  instanceName,
  config,
  clock,
}: {
  repositories: Pick<
    ApplicationRepositories,
    | 'commercialAutomationSettings'
    | 'commercialAutomationHistory'
    | 'whatsappGroups'
  >;
  instanceName: string;
  config: CommercialAutomationPolicyConfig;
  clock?: () => Date;
}) =>
  new CommercialAutomationPolicyService({
    settings: repositories.commercialAutomationSettings,
    history: repositories.commercialAutomationHistory,
    groups: repositories.whatsappGroups,
    instanceName,
    config,
    clock,
  });

export const createSenderService = ({
  repositories,
  whatsAppProvider,
  logger,
  messageBuilder,
  draftService,
  groupSendPolicy,
}: {
  repositories: Pick<ApplicationRepositories, 'whatsappDispatches'>;
  whatsAppProvider: WhatsAppProvider;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
  messageBuilder?: ConstructorParameters<
    typeof SenderService
  >[0]['messageBuilder'];
  draftService?: CommercialMessageDraftService;
  groupSendPolicy?: WhatsAppGroupSendPolicy;
}) =>
  new SenderService({
    dispatches: repositories.whatsappDispatches,
    provider: whatsAppProvider,
    logger,
    messageBuilder,
    draftService,
    groupSendPolicy,
  });

export const createPrismaRepositories = (
  prisma: DatabaseClient,
): ApplicationRepositories => {
  const commercialPromotions = new PrismaCommercialPromotionRepository(prisma);
  return {
    analytics: new PrismaAnalyticsRepository(prisma),
    products: new PrismaProductRepository(prisma),
    generatedCopies: new PrismaGeneratedCopyRepository(prisma),
    whatsappDestinations: new PrismaWhatsAppDestinationRepository(prisma),
    whatsappDispatches: new PrismaWhatsAppDispatchRepository(prisma),
    whatsappGroups: new PrismaWhatsAppGroupDirectoryRepository(prisma),
    shopeeOffers: new PrismaShopeeOfferRepository(prisma),
    coupons: new PrismaCouponRepository(prisma),
    commercialRuns: new PrismaCommercialPipelineRunRepository(prisma),
    commercialDeliveryHistory: new PrismaCommercialDeliveryHistoryRepository(
      prisma,
    ),
    commercialDispatchOutboxes: new PrismaCommercialDispatchOutboxRepository(
      prisma,
    ),
    commercialNiches: new PrismaCommercialNicheRepository(prisma),
    commercialGroupCampaigns: new PrismaCommercialGroupCampaignRepository(
      prisma,
    ),
    commercialPromotions,
    commercialPromotionCopies: new PrismaCommercialPromotionCopyRepository(
      prisma,
    ),
    commercialAutomationSettings:
      new PrismaCommercialAutomationSettingsRepository(prisma),
    commercialAutomationHistory:
      new PrismaCommercialAutomationHistoryRepository(prisma),
    commercialAutomationExecutions:
      new PrismaCommercialAutomationExecutionRepository(prisma),
  };
};

export const createApplicationServices = ({
  repositories,
  hunterProvider,
  whatsAppProvider,
  whatsappDispatchQueue,
  logger,
  shopeeOfferProvider = new MockShopeeAffiliateOfferProvider(),
  shopeeMaxOffersPerSync = 20,
}: {
  repositories: ApplicationRepositories;
  hunterProvider: HunterProvider;
  whatsAppProvider?: WhatsAppProvider;
  whatsappDispatchQueue?: DispatchQueue;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
  shopeeOfferProvider?: ShopeeAffiliateOfferProvider;
  shopeeMaxOffersPerSync?: number;
}): ApplicationServices => {
  const analytics = new AnalyticsService(repositories.analytics);
  const hunter = new HunterService({
    provider: hunterProvider,
    products: repositories.products,
    logger,
  });
  const score = new ScoreService({ products: repositories.products, logger });
  const copy = new CopyService({
    products: repositories.products,
    generatedCopies: repositories.generatedCopies,
    logger,
  });
  const sender = whatsAppProvider
    ? createSenderService({
        repositories,
        whatsAppProvider,
        logger,
        draftService: new CommercialMessageDraftService(),
      })
    : undefined;
  const shopeeOfferSync = new ShopeeOfferSyncService({
    provider: shopeeOfferProvider,
    offers: repositories.shopeeOffers,
    maxOffersPerSync: shopeeMaxOffersPerSync,
    logger,
  });

  return {
    analytics,
    hunter,
    score,
    copy,
    sender,
    shopeeOfferSync,
    coupons: new CouponService(repositories.coupons),
    copyPreview: new CopyPreviewService(repositories.shopeeOffers),
    pipeline: new PipelineService({
      provider: hunterProvider,
      products: repositories.products,
      generatedCopies: repositories.generatedCopies,
      whatsappDestinations: repositories.whatsappDestinations,
      whatsappDispatches: repositories.whatsappDispatches,
      logger,
      hunterService: hunter,
      scoreService: score,
      copyService: copy,
      whatsappDispatchQueue,
    }),
  };
};
