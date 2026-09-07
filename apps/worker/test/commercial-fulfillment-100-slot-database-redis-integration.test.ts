import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import { loadConfig } from '@shopee-auto-affiliate-ai/config';
import {
  fingerprintWhatsAppGroupId,
  type WhatsAppProvider,
  type WhatsAppSendInput,
  type WhatsAppSendResult,
} from '@shopee-auto-affiliate-ai/providers';
import {
  createCommercialAutomationQueue,
  createCommercialInventoryRefillQueue,
  createRedisConnection,
  createWhatsAppDispatchQueue,
  enqueueCommercialAutomationTarget,
  enqueueCommercialInventoryRefill,
  JOB_NAMES,
  type CommercialAutomationJob,
  type CommercialInventoryRefillJob,
} from '@shopee-auto-affiliate-ai/queue';

import { createPrismaRepositories } from '../../api/src/application-services';
import {
  COMMERCIAL_AI_COPY_PROMPT_VERSION,
  COMMERCIAL_AI_COPY_VALIDATION_VERSION,
} from '../../api/src/commercial-ai-copy-prompt';
import {
  COMMERCIAL_COPY_FALLBACK_MODEL,
  COMMERCIAL_COPY_FALLBACK_PROVIDER,
  buildCommercialPromotionFallbackOutput,
} from '../../api/src/commercial-promotion-copy-fallback';
import { CommercialAiCopyValidator } from '../../api/src/commercial-ai-copy-validator';
import { CommercialPromotionCopyAssembler } from '../../api/src/commercial-promotion-copy-assembler';
import { fingerprintCommercialOffer } from '../../api/src/commercial-offer-snapshot';
import { WhatsAppDeliveryConfirmationService } from '../../api/src/whatsapp-delivery-confirmation-service';
import { WhatsAppGroupSendPolicy } from '../../api/src/whatsapp-group-send-policy';
import {
  createCommercialAutomationOrchestratorRuntime,
} from '../src/commercial-automation-runtime';
import {
  createCommercialAutomationWorker,
  createCommercialWorkerInfrastructure,
} from '../src/commercial-automation-worker';
import { createWhatsAppDispatchWorker } from '../src/whatsapp-dispatch-worker';

const enabled =
  process.env.RUN_COMMERCIAL_100_SLOT_DB_REDIS_TEST === 'true' &&
  process.env.DATABASE_URL !== undefined &&
  process.env.REDIS_URL !== undefined;
const describeIntegration = enabled ? describe : describe.skip;

const PREFIX = 'pr141-100-slot-real';
const BASE = new Date('2026-09-07T12:00:00.000Z');
const INSTANCE_A = `${PREFIX}-instance-a`;
const INSTANCE_B = `${PREFIX}-instance-b`;
const GROUP_ID = '120363141000000001@g.us';
const GROUP_FINGERPRINT = fingerprintWhatsAppGroupId(GROUP_ID);
const IDS = {
  niche: `${PREFIX}-niche`,
  campaign: `${PREFIX}-campaign`,
  destination: `${PREFIX}-destination`,
  specialProduct: `${PREFIX}-special-product`,
  specialSnapshot: `${PREFIX}-special-snapshot`,
  specialCandidate: `${PREFIX}-special-candidate`,
  specialCopy: `${PREFIX}-special-copy`,
};

const productIdFor = (index: number) =>
  `${PREFIX}-product-${String(index + 1).padStart(3, '0')}`;
const snapshotIdFor = (index: number) =>
  `${PREFIX}-snapshot-${String(index + 1).padStart(3, '0')}`;
const candidateIdFor = (index: number) =>
  `${PREFIX}-candidate-${String(index + 1).padStart(3, '0')}`;
const copyIdFor = (index: number) =>
  `${PREFIX}-copy-${String(index + 1).padStart(3, '0')}`;
const providerProductIdFor = (index: number) =>
  `${PREFIX}-provider-${String(index + 1).padStart(3, '0')}`;
const productLinkFor = (index: number) =>
  `https://shopee.com.br/product/141/${PREFIX}-${index + 1}`;
const affiliateLinkFor = (index: number) =>
  `https://s.shopee.com.br/${PREFIX}-${index + 1}`;

const logger = {
  info: () => undefined,
  error: () => undefined,
};

const waitUntil = async (
  predicate: () => Promise<boolean>,
  timeoutMs = 30_000,
  intervalMs = 25,
) => {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error(`Timed out after ${timeoutMs}ms`);
};

const waitForCompletedJob = async (
  queue: ReturnType<typeof createCommercialAutomationQueue> | ReturnType<typeof createCommercialInventoryRefillQueue>,
  jobId: string,
) => {
  await waitUntil(async () => {
    const job = await queue.getJob(jobId);
    if (!job) return false;
    const state = await job.getState();
    if (state === 'failed') {
      throw new Error(`BullMQ job ${jobId} failed: ${job.failedReason ?? 'unknown'}`);
    }
    return state === 'completed';
  });
};

class RecordingWhatsAppProvider implements WhatsAppProvider {
  readonly calls: WhatsAppSendInput[] = [];
  private sequence = 0;

  constructor(private readonly clock: () => Date) {}

  async sendMessage(input: WhatsAppSendInput): Promise<WhatsAppSendResult> {
    this.calls.push(input);
    this.sequence += 1;
    return {
      externalMessageId: `${PREFIX}-external-${String(this.sequence).padStart(3, '0')}`,
      status: 'sent',
      sentAt: this.clock(),
    };
  }
}

const makeConfig = (databaseUrl: string, redisUrl: string) =>
  loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    COMMERCIAL_AUTOMATION_ENABLED: 'true',
    COMMERCIAL_TIMEZONE: 'UTC',
    COMMERCIAL_ALLOWED_START_TIME: '00:00',
    COMMERCIAL_ALLOWED_END_TIME: '23:59',
    COMMERCIAL_DAILY_GLOBAL_LIMIT: '100',
    COMMERCIAL_DAILY_GROUP_LIMIT: '100',
    COMMERCIAL_MIN_INTERVAL_MINUTES: '1',
    COMMERCIAL_AUTOMATION_MODE: 'send',
    COMMERCIAL_SCHEDULER_ENABLED: 'false',
    COMMERCIAL_SCHEDULER_CRON: '* * * * *',
    COMMERCIAL_SCHEDULER_TIMEZONE: 'UTC',
    COMMERCIAL_EXECUTION_LEASE_SECONDS: '120',
    COMMERCIAL_EXECUTION_HEARTBEAT_SECONDS: '10',
    SHOPEE_AFFILIATE_PROVIDER: 'official',
    SHOPEE_AFFILIATE_API_ENABLED: 'true',
    SHOPEE_AFFILIATE_API_URL: 'https://example.invalid/shopee',
    SHOPEE_AFFILIATE_APP_ID: `${PREFIX}-app`,
    SHOPEE_AFFILIATE_SECRET: `${PREFIX}-secret`,
    WHATSAPP_PROVIDER: 'evolution',
    EVOLUTION_API_URL: 'http://127.0.0.1:9',
    EVOLUTION_API_KEY: `${PREFIX}-key`,
    EVOLUTION_INSTANCE_NAME: INSTANCE_A,
    EVOLUTION_SAFE_MODE: 'true',
    WHATSAPP_GROUP_SEND_ENABLED: 'true',
    WHATSAPP_GROUP_MAX_MESSAGES_PER_RUN: '1',
    SCHEDULER_ENABLED: 'false',
  });

describeIntegration('commercial fulfillment 100-slot disposable certification', () => {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const redisUrl = process.env.REDIS_URL ?? '';

  const prisma = createPrismaClient(databaseUrl);
  const repositories = createPrismaRepositories(prisma);
  const prepared = repositories.commercialPreparedMessages;
  const copyValidator = new CommercialAiCopyValidator();
  const copyAssembler = new CommercialPromotionCopyAssembler();
  let infrastructure: ReturnType<typeof createCommercialWorkerInfrastructure> | undefined;
  let automationQueue: ReturnType<typeof createCommercialAutomationQueue> | undefined;
  let refillQueue: ReturnType<typeof createCommercialInventoryRefillQueue> | undefined;
  let dispatchQueue: ReturnType<typeof createWhatsAppDispatchQueue> | undefined;
  let automationWorker: ReturnType<typeof createCommercialAutomationWorker> | undefined;
  let dispatchWorker: ReturnType<typeof createWhatsAppDispatchWorker> | undefined;

  const removeFixtures = async () => {
    await prisma.whatsAppDeliveryEventInbox.deleteMany({
      where: { instanceName: { in: [INSTANCE_A, INSTANCE_B] } },
    });
    const fixtureRunIds = (
      await prisma.commercialPipelineRun.findMany({
        where: {
          OR: [
            { id: { startsWith: PREFIX } },
            { groupDestinationId: IDS.destination },
          ],
        },
        select: { id: true },
      })
    ).map(({ id }) => id);
    await prisma.commercialAutomationExecution.deleteMany({
      where: {
        OR: [
          { id: { startsWith: PREFIX } },
          { bullMqJobId: { startsWith: 'commercial-target-' } },
          ...(fixtureRunIds.length > 0
            ? [{ commercialRunId: { in: fixtureRunIds } }]
            : []),
        ],
      },
    });
    await prisma.commercialPreparedMessage.deleteMany({
      where: { campaignId: IDS.campaign },
    });
    await prisma.commercialDispatchOutbox.deleteMany({
      where: {
        OR: [
          { id: { startsWith: PREFIX } },
          { commercialRun: { groupDestinationId: IDS.destination } },
          { dispatch: { destinationId: IDS.destination } },
        ],
      },
    });
    await prisma.commercialPipelineRun.deleteMany({
      where: {
        OR: [
          { id: { startsWith: PREFIX } },
          { groupDestinationId: IDS.destination },
        ],
      },
    });
    await prisma.whatsAppDispatchManualRecovery.deleteMany({
      where: { dispatch: { destinationId: IDS.destination } },
    });
    await prisma.whatsAppDispatch.deleteMany({
      where: {
        OR: [
          { id: { startsWith: PREFIX } },
          { destinationId: IDS.destination },
        ],
      },
    });
    await prisma.commercialCopyGenerationAttempt.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    await prisma.commercialPromotionCandidate.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    await prisma.generatedCopy.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    await prisma.commercialOfferSnapshot.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    await prisma.productLead.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    await prisma.commercialDiscoveryCheckpoint.deleteMany({
      where: { identityFingerprint: { startsWith: PREFIX } },
    });
    await prisma.commercialGroupCampaign.deleteMany({
      where: { id: IDS.campaign },
    });
    await prisma.whatsAppDestination.deleteMany({
      where: { id: IDS.destination },
    });
    await prisma.whatsAppInstance.deleteMany({
      where: { name: { in: [INSTANCE_A, INSTANCE_B] } },
    });
    await prisma.commercialNiche.deleteMany({
      where: { id: IDS.niche },
    });
  };

  beforeAll(async () => {
    await removeFixtures();
    await prisma.commercialNiche.create({
      data: {
        id: IDS.niche,
        name: '100 slot fixture',
        slug: IDS.niche,
        active: true,
        minimumScore: 60,
      },
    });
    await prisma.whatsAppInstance.createMany({
      data: [
        { name: INSTANCE_A, active: true, paused: false },
        { name: INSTANCE_B, active: true, paused: false },
      ],
    });
    await prisma.whatsAppDestination.create({
      data: {
        id: IDS.destination,
        name: 'Grupo 100 slots',
        destination: GROUP_ID,
        type: 'GROUP',
        active: true,
        paused: false,
        available: true,
        fingerprint: GROUP_FINGERPRINT,
        sourceInstanceName: INSTANCE_A,
        assignedInstanceName: INSTANCE_A,
        assignmentRevision: 1,
        instanceAssignments: {
          create: [
            { instanceName: INSTANCE_A, position: 0 },
            { instanceName: INSTANCE_B, position: 1 },
          ],
        },
      },
    });
    await prisma.commercialGroupCampaign.create({
      data: {
        id: IDS.campaign,
        name: 'Campaign 100 slots',
        logicalGroupFingerprint: GROUP_FINGERPRINT,
        anchorDestinationId: IDS.destination,
        nicheId: IDS.niche,
        active: true,
        cadenceMinutes: 1,
        timezone: 'UTC',
        allowedStartTime: '00:00',
        allowedEndTime: '23:59',
        dailyLimit: 100,
        queueTargetSize: 100,
      },
    });
    await prisma.commercialAutomationSettings.upsert({
      where: { id: 'commercial-automation' },
      create: {
        id: 'commercial-automation',
        paused: false,
        pausedAt: null,
        resumedAt: BASE,
        allowedStartTime: '00:00',
        allowedEndTime: '23:59',
        timezone: 'UTC',
        minimumIntervalMinutes: 1,
        staggerMinutes: 0,
        dailyGlobalLimit: 100,
        dailyGroupLimit: 100,
        dailyShopeeHttpLimit: 100,
        dailyOpenAiGenerationLimit: 100,
        usableCandidateLowWatermark: 1,
        usableCandidateTarget: 4,
        preparedLowWatermark: 1,
        preparedTarget: 4,
        discoveryPagesPerRun: 1,
        discoveryRefreshCooldownMinutes: 60,
        scheduleRevision: 1,
        updatedAt: BASE,
      },
      update: {
        paused: false,
        pausedAt: null,
        resumedAt: BASE,
        allowedStartTime: '00:00',
        allowedEndTime: '23:59',
        timezone: 'UTC',
        minimumIntervalMinutes: 1,
        staggerMinutes: 0,
        dailyGlobalLimit: 100,
        dailyGroupLimit: 100,
        dailyShopeeHttpLimit: 100,
        dailyOpenAiGenerationLimit: 100,
        usableCandidateLowWatermark: 1,
        usableCandidateTarget: 4,
        preparedLowWatermark: 1,
        preparedTarget: 4,
        discoveryPagesPerRun: 1,
        discoveryRefreshCooldownMinutes: 60,
        scheduleRevision: 1,
        updatedAt: BASE,
      },
    });

    const productRows = Array.from({ length: 100 }, (_, index) => {
      const productId = productIdFor(index);
      const providerProductId = providerProductIdFor(index);
      const productLink = productLinkFor(index);
      const affiliateLink = affiliateLinkFor(index);
      const fingerprint = fingerprintCommercialOffer({
        source: 'OFFICIAL',
        providerProductId,
        productLink,
        affiliateLink,
        price: '99.90',
        priceMin: '99.90',
        priceMax: '99.90',
        discountRate: 20,
        commissionRate: 10,
        offerStartsAt: null,
        offerEndsAt: null,
        unavailableAt: null,
      });
      return {
        id: productId,
        source: 'OFFICIAL' as const,
        providerProductId,
        nome: `Produto slot ${index + 1}`,
        categoria: 'fixture',
        preco: 99.9,
        precoMin: 99.9,
        precoMax: 99.9,
        desconto: 20,
        nota: 4.8,
        vendidos: 1000,
        comissao: 10,
        loja: 'Loja fixture',
        urlImagem: `https://example.invalid/${PREFIX}-${index + 1}.jpg`,
        productLink,
        affiliateLink,
        title: `Produto slot ${index + 1}`,
        categoryIds: [],
        shopType: [],
        commercialSnapshotRevision: 1,
        commercialSnapshotFingerprint: fingerprint,
        fetchedAt: BASE,
        lastSeenAt: BASE,
      };
    });
    await prisma.productLead.createMany({ data: productRows });
    await prisma.commercialOfferSnapshot.createMany({
      data: productRows.map((product, index) => ({
        id: snapshotIdFor(index),
        productId: product.id,
        revision: 1,
        fingerprint: product.commercialSnapshotFingerprint ?? '',
        price: 99.9,
        priceMin: 99.9,
        priceMax: 99.9,
        discountRate: 20,
        commissionRate: 10,
        observedRating: 4.8,
        observedSales: 1000,
        capturedAt: BASE,
      })),
    });
    await prisma.generatedCopy.createMany({
      data: productRows.map((product, index) => ({
        id: copyIdFor(index),
        productId: product.id,
        source: 'LEGACY_TEMPLATE' as const,
        provider: COMMERCIAL_COPY_FALLBACK_PROVIDER,
        model: COMMERCIAL_COPY_FALLBACK_MODEL,
        promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
        validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
        snapshotId: snapshotIdFor(index),
        createdFromCandidateId: candidateIdFor(index),
        inputFingerprint: `${PREFIX}-input-${index + 1}`,
        ...copyAssembler.assemble({
          output: buildCommercialPromotionFallbackOutput(
            copyValidator,
            product.nome,
            [product.loja],
          ),
          productName: product.nome,
          shopName: '',
          price: '99.90',
          discountRate: 20,
          promotionSignals: ['CURRENT_DISCOUNT'],
          priceDropPercent: null,
          affiliateLink: affiliateLinkFor(index),
          maximumLength: 1000,
        }),
      })),
    });
    await prisma.commercialPromotionCandidate.createMany({
      data: productRows.map((product, index) => ({
        id: candidateIdFor(index),
        campaignId: IDS.campaign,
        productId: product.id,
        snapshotId: snapshotIdFor(index),
        generatedCopyId: copyIdFor(index),
        status: 'COPY_READY' as const,
        rankPosition: index + 1,
        commercialScore: 82,
        scorePolicyVersion: 'official-v2',
        minimumScoreUsed: 60,
        scoreBreakdown: {
          policyVersion: 'official-v2',
          rawTotal: 82,
          finalScore: 82,
        },
        promotionSignals: ['CURRENT_DISCOUNT' as const],
        queuedAt: BASE,
        lastEvaluatedAt: BASE,
        expiresAt: new Date(BASE.getTime() + 24 * 60 * 60_000),
        dedupeUntil: new Date(BASE.getTime() + 30 * 24 * 60 * 60_000),
      })),
    });
    await prisma.commercialCopyGenerationAttempt.createMany({
      data: productRows.map((product, index) => ({
        id: `${PREFIX}-attempt-${String(index + 1).padStart(3, '0')}`,
        candidateId: candidateIdFor(index),
        snapshotId: snapshotIdFor(index),
        inputFingerprint: `${PREFIX}-input-${index + 1}`,
        provider: COMMERCIAL_COPY_FALLBACK_PROVIDER,
        model: COMMERCIAL_COPY_FALLBACK_MODEL,
        promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
        validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
        status: 'SUCCEEDED' as const,
        generatedCopyId: copyIdFor(index),
        validationFailureCodes: [],
        startedAt: BASE,
        completedAt: BASE,
      })),
    });

    const specialProductLink = `https://shopee.com.br/product/141/${PREFIX}-special`;
    const specialAffiliateLink = `https://s.shopee.com.br/${PREFIX}-special`;
    const specialFingerprint = fingerprintCommercialOffer({
      source: 'OFFICIAL',
      providerProductId: `${PREFIX}-special-provider`,
      productLink: specialProductLink,
      affiliateLink: specialAffiliateLink,
      price: '99.90',
      priceMin: '99.90',
      priceMax: '99.90',
      discountRate: 20,
      commissionRate: 10,
      offerStartsAt: null,
      offerEndsAt: null,
      unavailableAt: null,
    });
    await prisma.productLead.create({
      data: {
        id: IDS.specialProduct,
        source: 'OFFICIAL',
        providerProductId: `${PREFIX}-special-provider`,
        nome: 'Produto especial de expiracao',
        categoria: 'fixture',
        preco: 99.9,
        precoMin: 99.9,
        precoMax: 99.9,
        desconto: 20,
        nota: 4.8,
        vendidos: 1000,
        comissao: 10,
        loja: 'Loja fixture',
        urlImagem: `https://example.invalid/${PREFIX}-special.jpg`,
        productLink: specialProductLink,
        affiliateLink: specialAffiliateLink,
        title: 'Produto especial de expiracao',
        commercialSnapshotRevision: 1,
        commercialSnapshotFingerprint: specialFingerprint,
        fetchedAt: BASE,
        lastSeenAt: BASE,
      },
    });
    await prisma.commercialOfferSnapshot.create({
      data: {
        id: IDS.specialSnapshot,
        productId: IDS.specialProduct,
        revision: 1,
        fingerprint: specialFingerprint,
        price: 99.9,
        priceMin: 99.9,
        priceMax: 99.9,
        discountRate: 20,
        commissionRate: 10,
        observedRating: 4.8,
        observedSales: 1000,
        capturedAt: BASE,
      },
    });
    await prisma.generatedCopy.create({
      data: {
        id: IDS.specialCopy,
        productId: IDS.specialProduct,
        source: 'LEGACY_TEMPLATE',
        provider: COMMERCIAL_COPY_FALLBACK_PROVIDER,
        model: COMMERCIAL_COPY_FALLBACK_MODEL,
        promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
        validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
        snapshotId: IDS.specialSnapshot,
        createdFromCandidateId: IDS.specialCandidate,
        inputFingerprint: `${PREFIX}-special-input`,
        ...copyAssembler.assemble({
          output: buildCommercialPromotionFallbackOutput(
            copyValidator,
            'Produto especial de expiracao',
            ['Loja fixture'],
          ),
          productName: 'Produto especial de expiracao',
          shopName: '',
          price: '99.90',
          discountRate: 20,
          promotionSignals: ['CURRENT_DISCOUNT'],
          priceDropPercent: null,
          affiliateLink: specialAffiliateLink,
          maximumLength: 1000,
        }),
      },
    });
    await prisma.commercialPromotionCandidate.create({
      data: {
        id: IDS.specialCandidate,
        campaignId: IDS.campaign,
        productId: IDS.specialProduct,
        snapshotId: IDS.specialSnapshot,
        generatedCopyId: IDS.specialCopy,
        status: 'COPY_READY',
        rankPosition: 1001,
        commercialScore: 82,
        scorePolicyVersion: 'official-v2',
        minimumScoreUsed: 60,
        scoreBreakdown: { policyVersion: 'official-v2', finalScore: 82 },
        promotionSignals: ['CURRENT_DISCOUNT'],
        queuedAt: BASE,
        lastEvaluatedAt: BASE,
        expiresAt: new Date(BASE.getTime() + 24 * 60 * 60_000),
        dedupeUntil: new Date(BASE.getTime() + 30 * 24 * 60 * 60_000),
      },
    });
    await prisma.commercialCopyGenerationAttempt.create({
      data: {
        id: `${PREFIX}-special-attempt`,
        candidateId: IDS.specialCandidate,
        snapshotId: IDS.specialSnapshot,
        inputFingerprint: `${PREFIX}-special-input`,
        provider: COMMERCIAL_COPY_FALLBACK_PROVIDER,
        model: COMMERCIAL_COPY_FALLBACK_MODEL,
        promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
        validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
        status: 'SUCCEEDED',
        generatedCopyId: IDS.specialCopy,
        validationFailureCodes: [],
        startedAt: BASE,
        completedAt: BASE,
      },
    });
    const specialPrepared = await prepared.createReady({
      campaignId: IDS.campaign,
      groupDestinationId: IDS.destination,
      instanceName: INSTANCE_A,
      logicalGroupFingerprint: GROUP_FINGERPRINT,
      candidateId: IDS.specialCandidate,
      generatedCopyId: IDS.specialCopy,
      copyPreview: `Oferta especial ${specialAffiliateLink}`,
      scheduleRevision: 1,
      assignmentRevision: 1,
      expiresAt: new Date(BASE.getTime() + 30_000),
      now: BASE,
    });
    expect(specialPrepared).toMatchObject({
      candidateId: IDS.specialCandidate,
      status: 'READY',
      preparationRevision: 1,
    });
  });

  afterAll(async () => {
    await dispatchWorker?.close().catch(() => undefined);
    await automationWorker?.close().catch(() => undefined);
    await dispatchQueue?.close().catch(() => undefined);
    await automationQueue?.close().catch(() => undefined);
    await refillQueue?.close().catch(() => undefined);
    await infrastructure?.close().catch(() => undefined);
    await removeFixtures().catch(() => undefined);
    await prisma.$disconnect();
  }, 120_000);

  it('executa 100 dispatches reais com rotacao derivada de ACK persistido', async () => {
    let currentNow = new Date(BASE.getTime() + 2 * 60_000);
    const clock = () => new Date(currentNow.getTime());
    const config = makeConfig(databaseUrl, redisUrl);
    const provider = new RecordingWhatsAppProvider(clock);
    infrastructure = createCommercialWorkerInfrastructure(redisUrl, 'send');
    automationQueue = createCommercialAutomationQueue(infrastructure.connection);
    refillQueue = createCommercialInventoryRefillQueue(infrastructure.connection);
    dispatchQueue = createWhatsAppDispatchQueue(infrastructure.connection);
    await Promise.all([
      automationQueue.waitUntilReady(),
      refillQueue.waitUntilReady(),
      dispatchQueue.waitUntilReady(),
    ]);
    await Promise.all([
      automationQueue.obliterate({ force: true }),
      refillQueue.obliterate({ force: true }),
      dispatchQueue.obliterate({ force: true }),
    ]);
    const automationJobs = automationQueue;
    const refillJobs = refillQueue;
    const dispatchJobs = dispatchQueue;

    const schedulerJobId = `${PREFIX}-heartbeat`;
    const registered = await infrastructure.scheduler.register({
      enabled: true,
      cronExpression: '0 0 1 1 *',
      timezone: 'UTC',
      mode: 'send',
      jobId: schedulerJobId,
    });
    expect(registered.status).toBe('registered');
    const schedulerRecord = await automationJobs.getJobScheduler(schedulerJobId);
    expect(schedulerRecord?.template?.opts).toMatchObject({
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    });
    await infrastructure.scheduler.remove(schedulerJobId);
    expect(
      (await infrastructure.scheduler.getState(schedulerJobId, 'send')).status,
    ).toBe('not-registered');

    automationWorker = createCommercialAutomationWorker(config, {
      connection: infrastructure.connection,
      prisma,
      clock,
      confirmationQueue: infrastructure.confirmationQueue,
      enqueueTarget: infrastructure.enqueueTarget,
      enqueueInventoryRefill: infrastructure.enqueueInventoryRefill,
      logger,
    });
    dispatchWorker = createWhatsAppDispatchWorker(redisUrl, {
      connection: infrastructure.connection,
      prisma,
      whatsAppProvider: provider,
      whatsAppProviderResolver: async () => provider,
      commercialAutomationMode: 'send',
      groupSendPolicy: new WhatsAppGroupSendPolicy({
        enabled: true,
        safeMode: true,
      }),
      reservationLeaseMilliseconds: 120_000,
      deliveryConfirmationTimeoutMs: 900_000,
      logger,
      clock,
    });
    const plannerRuntime = createCommercialAutomationOrchestratorRuntime(
      config,
      {
        prisma,
        clock,
        confirmationQueue: infrastructure.confirmationQueue,
        logger,
      },
    );
    const deliveryEvents = repositories.whatsappDeliveryEvents;
    if (!deliveryEvents) throw new Error('delivery inbox repository missing');
    const confirmation = new WhatsAppDeliveryConfirmationService({
      dispatches: repositories.whatsappDispatches,
      deliveryEvents,
      runs: repositories.commercialRuns,
      promotionCandidates: repositories.commercialPromotions,
      logger,
      clock,
    });

    try {
      const expectedInstances: string[] = [];
      const selectedCandidateIds: string[] = [];
      for (let index = 0; index < 100; index += 1) {
        const refillJobId = `commercial-inventory-refill-${PREFIX}-${String(index + 1).padStart(3, '0')}`;
        await enqueueCommercialInventoryRefill(
          refillJobs,
          { mode: 'send', provider: 'official' },
          refillJobId,
        );
        await waitForCompletedJob(refillJobs, refillJobId);
        if (index === 0) {
          expect(
            await prisma.commercialPreparedMessage.findFirst({
              where: { candidateId: IDS.specialCandidate },
              select: { status: true, invalidatedReason: true },
            }),
          ).toEqual({
            status: 'INVALIDATED',
            invalidatedReason: 'PREPARED_EXPIRED',
          });
          expect(
            await prisma.commercialPromotionCandidate.findUnique({
              where: { id: IDS.specialCandidate },
              select: { status: true },
            }),
          ).toEqual({ status: 'COPY_READY' });
        }

        const planned = await plannerRuntime.planner.plan({
          now: clock(),
          mode: 'send',
          enqueue: async (
            data: Extract<CommercialAutomationJob, { kind: 'target' }>,
            jobId: string,
            delayMs: number,
          ) => {
            await enqueueCommercialAutomationTarget(
              automationJobs,
              data,
              jobId,
              delayMs,
            );
          },
        });
        expect(planned.slots).toHaveLength(1);
        const slot = planned.slots[0];
        const expectedInstance = index % 2 === 0 ? INSTANCE_A : INSTANCE_B;
        expectedInstances.push(expectedInstance);
        expect(slot.target.instanceName).toBe(expectedInstance);
        expect(slot.target.assignmentRevision).toBe(1);

        await waitForCompletedJob(automationJobs, slot.jobId);
        const execution = await prisma.commercialAutomationExecution.findUnique({
          where: { bullMqJobId: slot.jobId },
          select: { status: true, commercialRunId: true },
        });
        if (!execution) throw new Error(`execution missing for ${slot.jobId}`);
        expect(execution.status).toBe('QUEUED');
        if (!execution.commercialRunId) {
          throw new Error(`commercial run missing for ${slot.jobId}`);
        }
        const run = await prisma.commercialPipelineRun.findUnique({
          where: { id: execution.commercialRunId },
          select: { id: true, dispatchId: true },
        });
        if (!run?.dispatchId) throw new Error(`dispatch missing for ${slot.jobId}`);

        let submittedExternalMessageId: string | null = null;
        await waitUntil(async () => {
          const dispatch = await prisma.whatsAppDispatch.findUnique({
            where: { id: run.dispatchId ?? '' },
            select: { status: true, externalMessageId: true },
          });
          if (!dispatch) return false;
          if (dispatch.status === 'FAILED' || dispatch.status === 'AMBIGUOUS') {
            throw new Error(`dispatch ${run.dispatchId} reached ${dispatch.status}`);
          }
          if (dispatch.status !== 'SUBMITTED' || !dispatch.externalMessageId) {
            return false;
          }
          submittedExternalMessageId = dispatch.externalMessageId;
          return true;
        });
        expect(provider.calls).toHaveLength(index + 1);
        const submittedId = submittedExternalMessageId;
        if (!submittedId) throw new Error('provider external ID missing');
        expect(provider.calls[index]).toMatchObject({
          destination: GROUP_ID,
          destinationType: 'GROUP',
        });

          const ack = {
            instanceName: expectedInstance,
            externalMessageId: submittedId,
            status: 'SERVER_ACK' as const,
            occurredAt: clock(),
          };
          const dispatchBeforeAck = await prisma.whatsAppDispatch.findUnique({
            where: { id: run.dispatchId },
            select: { status: true, externalMessageId: true, instanceName: true },
          });
          const existingAck = await prisma.whatsAppDeliveryEventInbox.findFirst({
            where: {
              instanceName: expectedInstance,
              externalMessageId: submittedId,
            },
            select: { state: true, status: true },
          });
          const ackResult = await confirmation.consume(ack);
          expect(
            ackResult,
            `ACK slot ${index + 1} expected UPDATED; before=${JSON.stringify({ dispatchBeforeAck, existingAck, expectedInstance, submittedId })}`,
          ).toMatchObject({ kind: 'UPDATED' });
        expect(await confirmation.consume(ack)).toMatchObject({ kind: 'NOOP' });
        await waitUntil(async () => {
          const dispatch = await prisma.whatsAppDispatch.findUnique({
            where: { id: run.dispatchId ?? '' },
            select: { status: true },
          });
          const persistedRun = await prisma.commercialPipelineRun.findUnique({
            where: { id: run.id },
            select: { status: true, finalStatus: true, investigationRequired: true },
          });
          return (
            dispatch?.status === 'SENT' &&
            persistedRun?.status === 'COMPLETED' &&
            persistedRun.finalStatus === 'SENT' &&
            persistedRun.investigationRequired === false
          );
        });

        const finalDispatch = await prisma.whatsAppDispatch.findUnique({
          where: { id: run.dispatchId },
          select: { productId: true, generatedCopyId: true, destinationId: true, status: true, errorMessage: true },
        });
        if (!finalDispatch) throw new Error('final dispatch disappeared');
        const dispatchedProduct = await prisma.productLead.findUnique({
          where: { id: finalDispatch.productId },
          select: { urlImagem: true },
        });
        expect(provider.calls[index].imageUrl).toBe(dispatchedProduct?.urlImagem);
        expect(finalDispatch).toMatchObject({
          destinationId: IDS.destination,
          status: 'SENT',
          errorMessage: null,
        });
        const candidate = await prisma.commercialPromotionCandidate.findFirst({
          where: {
            campaignId: IDS.campaign,
            productId: finalDispatch.productId,
          },
          select: { id: true, generatedCopyId: true, status: true },
        });
        if (!candidate) throw new Error('candidate for dispatch missing');
        selectedCandidateIds.push(candidate.id);
        expect(candidate.status).toBe('DISPATCHED');
        expect(candidate.generatedCopyId).toBe(finalDispatch.generatedCopyId);
        const preparedRow = await prisma.commercialPreparedMessage.findUnique({
          where: { runId: run.id },
          select: { candidateId: true, status: true },
        });
        expect(preparedRow).toEqual({ candidateId: candidate.id, status: 'DISPATCHED' });
        const inbox = await prisma.whatsAppDeliveryEventInbox.findFirst({
          where: {
            instanceName: expectedInstance,
            externalMessageId: submittedId,
            status: 'SERVER_ACK',
          },
          select: { state: true },
        });
        expect(inbox).toEqual({ state: 'APPLIED' });
        expect(
          await prisma.commercialGroupCampaign.findUnique({
            where: { id: IDS.campaign },
            select: { attemptExecutionId: true, attemptReservedAt: true, attemptLeaseExpiresAt: true },
          }),
        ).toEqual({
          attemptExecutionId: null,
          attemptReservedAt: null,
          attemptLeaseExpiresAt: null,
        });

        currentNow = new Date(BASE.getTime() + (index + 3) * 60_000);
      }

      expect(provider.calls).toHaveLength(100);
      expect(selectedCandidateIds).toHaveLength(100);
      expect(new Set(selectedCandidateIds).size).toBe(100);
      expect(expectedInstances.filter((name) => name === INSTANCE_A)).toHaveLength(50);
      expect(expectedInstances.filter((name) => name === INSTANCE_B)).toHaveLength(50);
      expect(
        await prisma.whatsAppDispatch.count({
          where: { destinationId: IDS.destination, status: 'SENT' },
        }),
      ).toBe(100);
      expect(
        await prisma.commercialPipelineRun.count({
          where: {
            groupDestinationId: IDS.destination,
            status: 'COMPLETED',
            finalStatus: 'SENT',
            investigationRequired: false,
          },
        }),
      ).toBe(100);
      expect(
        await prisma.commercialPromotionCandidate.count({
          where: { campaignId: IDS.campaign, status: 'DISPATCHED' },
        }),
      ).toBe(100);
      expect(
        await prisma.commercialCopyGenerationAttempt.count({
          where: { id: { startsWith: PREFIX } },
        }),
      ).toBe(101);
      expect(
        await prisma.commercialDiscoveryCheckpoint.count({
          where: { identityFingerprint: { startsWith: PREFIX } },
        }),
      ).toBe(0);
      expect(
        await prisma.commercialDispatchOutbox.count({
          where: {
            commercialRun: { groupDestinationId: IDS.destination },
            status: 'PUBLISHED',
          },
        }),
      ).toBe(100);
      expect(
        await prisma.commercialAutomationExecution.count({
          where: { bullMqJobId: { startsWith: 'commercial-target-' }, status: 'QUEUED' },
        }),
      ).toBe(100);
      const lastSent = await prisma.whatsAppDispatch.findFirst({
        where: { destinationId: IDS.destination, status: 'SENT' },
        orderBy: { sentAt: 'desc' },
        select: { instanceName: true },
      });
      expect(lastSent?.instanceName).toBe(INSTANCE_B);
      expect(await refillJobs.getJob(`commercial-inventory-refill-${PREFIX}-001`)).toBeDefined();
      expect(await automationJobs.getJob('commercial-target-invalid')).toBeUndefined();
    } finally {
      await dispatchWorker.close();
      await automationWorker.close();
      await dispatchJobs.close();
      await automationJobs.close();
      await refillJobs.close();
      await infrastructure.close();
      dispatchWorker = undefined;
      automationWorker = undefined;
      dispatchQueue = undefined;
      automationQueue = undefined;
      refillQueue = undefined;
      infrastructure = undefined;
    }
  }, 600_000);

  afterAll(async () => {
    await removeFixtures();
    await prisma.$disconnect();
  });
});
