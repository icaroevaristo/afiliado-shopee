import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';
import {
  fingerprintWhatsAppGroupId,
  MockWhatsAppProvider,
} from '@shopee-auto-affiliate-ai/providers';
import {
  createRedisConnection,
  createWhatsAppDispatchQueue,
  enqueueControlledWhatsAppDispatch,
  JOB_NAMES,
} from '@shopee-auto-affiliate-ai/queue';

import {
  createCommercialPipelineConfirmationService,
  createPrismaRepositories,
} from '../../api/src/application-services';
import { COMMERCIAL_AI_COPY_PROMPT_VERSION, COMMERCIAL_AI_COPY_VALIDATION_VERSION } from '../../api/src/commercial-ai-copy-prompt';
import { COMMERCIAL_CONFIRMATION_TOKEN } from '../../api/src/commercial-pipeline-confirmation-service';
import { WhatsAppDeliveryConfirmationService } from '../../api/src/whatsapp-delivery-confirmation-service';
import {
  fingerprintCommercialOffer,
  fingerprintCommercialOfferProduct,
} from '../../api/src/commercial-offer-snapshot';
import { CommercialMessageDraftService } from '../../api/src/commercial-message-draft-service';
import { validateCommercialAffiliateLinkProvenance } from '../../api/src/commercial-affiliate-link-provenance';
import { WhatsAppGroupSendPolicy } from '../../api/src/whatsapp-group-send-policy';
import { createWhatsAppDispatchWorker } from '../src/whatsapp-dispatch-worker';

const enabled = process.env.RUN_COMMERCIAL_FULFILLMENT_DB_TEST === 'true';
const describeDatabase = enabled ? describe : describe.skip;
const NOW = new Date('2026-09-07T12:00:00.000Z');
const PREFIX = 'fulfillment-handoff-db-fixture';
const INSTANCE_A = `${PREFIX}-instance-a`;
const INSTANCE_B = `${PREFIX}-instance-b`;
const IDS = {
  niche: `${PREFIX}-niche`,
  campaign: `${PREFIX}-campaign`,
  destination: `${PREFIX}-destination`,
  product: `${PREFIX}-product`,
  snapshot: `${PREFIX}-snapshot`,
  candidate: `${PREFIX}-candidate`,
  copy: `${PREFIX}-copy`,
  execution: `${PREFIX}-execution`,
  competingCopy: `${PREFIX}-competing-copy`,
  competingDispatch: `${PREFIX}-competing-dispatch`,
};
const RACE = {
  campaign: `${PREFIX}-race-campaign`,
  destination: `${PREFIX}-race-destination`,
  product: `${PREFIX}-race-product`,
  snapshot: `${PREFIX}-race-snapshot`,
  candidate: `${PREFIX}-race-candidate`,
  copy: `${PREFIX}-race-copy`,
  execution: `${PREFIX}-race-execution`,
  manualRun: `${PREFIX}-race-manual-run`,
};
const GROUP_ID = '120363000000000000@g.us';
const GROUP_FINGERPRINT = fingerprintWhatsAppGroupId(GROUP_ID);
const RACE_GROUP_ID = '120363000000000001@g.us';
const RACE_GROUP_FINGERPRINT = fingerprintWhatsAppGroupId(RACE_GROUP_ID);
const PRODUCT_LINK = `https://shopee.com.br/product/1/${PREFIX}`;
const AFFILIATE_LINK = `https://s.shopee.com.br/${PREFIX}`;
const RACE_PRODUCT_LINK = `https://shopee.com.br/product/1/${PREFIX}-race`;
const RACE_AFFILIATE_LINK = `https://s.shopee.com.br/${PREFIX}-race`;
const SNAPSHOT_FINGERPRINT = fingerprintCommercialOffer({
  source: 'OFFICIAL',
  providerProductId: `${PREFIX}-provider`,
  productLink: PRODUCT_LINK,
  affiliateLink: AFFILIATE_LINK,
  price: '99.90',
  priceMin: '99.90',
  priceMax: '99.90',
  discountRate: 20,
  commissionRate: 10,
  offerStartsAt: null,
  offerEndsAt: null,
  unavailableAt: null,
});
const RACE_SNAPSHOT_FINGERPRINT = fingerprintCommercialOffer({
  source: 'OFFICIAL',
  providerProductId: `${PREFIX}-race-provider`,
  productLink: RACE_PRODUCT_LINK,
  affiliateLink: RACE_AFFILIATE_LINK,
  price: '89.90',
  priceMin: '89.90',
  priceMax: '89.90',
  discountRate: 25,
  commissionRate: 10,
  offerStartsAt: null,
  offerEndsAt: null,
  unavailableAt: null,
});

let nicheUpdatedAt: Date;

describeDatabase('commercial prepared handoff PostgreSQL fixture', () => {
  const prisma = createPrismaClient(process.env.DATABASE_URL);
  const repositories = createPrismaRepositories(prisma);
  const prepared = repositories.commercialPreparedMessages;
  const logger = { info: () => undefined, error: () => undefined };
  const leaseExpiresAt = new Date(NOW.getTime() + 120_000);

  const removeFixtures = async () => {
    await prisma.whatsAppDeliveryEventInbox.deleteMany({
      where: { instanceName: { in: [INSTANCE_A, INSTANCE_B] } },
    });
    await prisma.commercialPreparedMessage.deleteMany({
      where: { campaignId: { in: [IDS.campaign, RACE.campaign] } },
    });
    await prisma.commercialDispatchOutbox.deleteMany({
      where: {
        dispatch: {
          destinationId: { in: [IDS.destination, RACE.destination] },
        },
      },
    });
    await prisma.whatsAppDispatch.deleteMany({
      where: { destinationId: { in: [IDS.destination, RACE.destination] } },
    });
    await prisma.commercialPipelineRun.deleteMany({
      where: { instanceName: { in: [INSTANCE_A, INSTANCE_B] } },
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
    await prisma.commercialAutomationExecution.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    await prisma.commercialGroupCampaign.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    await prisma.whatsAppDestination.deleteMany({
      where: { id: { startsWith: PREFIX } },
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
        name: 'Fixture fulfillment',
        slug: IDS.niche,
        active: true,
        minimumScore: 60,
      },
    });
    const createdNiche = await prisma.commercialNiche.findUnique({
      where: { id: IDS.niche },
      select: { updatedAt: true },
    });
    if (!createdNiche) throw new Error('handoff niche fixture was not created');
    nicheUpdatedAt = createdNiche.updatedAt;
    await prisma.whatsAppInstance.createMany({
      data: [
        { name: INSTANCE_A, active: true, paused: false },
        { name: INSTANCE_B, active: true, paused: false },
      ],
    });
    await prisma.whatsAppDestination.create({
      data: {
        id: IDS.destination,
        name: 'Grupo fulfillment',
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
    await prisma.whatsAppDestination.create({
      data: {
        id: RACE.destination,
        name: 'Grupo fulfillment race',
        destination: RACE_GROUP_ID,
        type: 'GROUP',
        active: true,
        paused: false,
        available: true,
        fingerprint: RACE_GROUP_FINGERPRINT,
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
        name: 'Campaign fulfillment',
        logicalGroupFingerprint: GROUP_FINGERPRINT,
        anchorDestinationId: IDS.destination,
        nicheId: IDS.niche,
        active: true,
        dailyLimit: 100,
      },
    });
    await prisma.commercialGroupCampaign.create({
      data: {
        id: RACE.campaign,
        name: 'Campaign fulfillment race',
        logicalGroupFingerprint: RACE_GROUP_FINGERPRINT,
        anchorDestinationId: RACE.destination,
        nicheId: IDS.niche,
        active: true,
        dailyLimit: 100,
      },
    });
    await prisma.productLead.create({
      data: {
        id: IDS.product,
        source: 'OFFICIAL',
        providerProductId: `${PREFIX}-provider`,
        nome: 'Produto fulfillment',
        categoria: 'fixture',
        preco: 99.9,
        precoMin: 99.9,
        precoMax: 99.9,
        desconto: 20,
        nota: 4.8,
        vendidos: 100,
        comissao: 10,
        loja: 'Loja fulfillment',
        urlImagem: 'https://example.invalid/fulfillment.jpg',
        productLink: PRODUCT_LINK,
        affiliateLink: AFFILIATE_LINK,
        title: 'Produto fulfillment',
        commercialSnapshotRevision: 1,
        commercialSnapshotFingerprint: SNAPSHOT_FINGERPRINT,
        fetchedAt: NOW,
        lastSeenAt: NOW,
      },
    });
    await prisma.commercialOfferSnapshot.create({
      data: {
        id: IDS.snapshot,
        productId: IDS.product,
        revision: 1,
        fingerprint: SNAPSHOT_FINGERPRINT,
        price: 99.9,
        discountRate: 20,
        commissionRate: 10,
        observedRating: 4.8,
        observedSales: 100,
        capturedAt: NOW,
      },
    });
    await prisma.generatedCopy.create({
      data: {
        id: IDS.copy,
        productId: IDS.product,
        source: 'AI',
        provider: 'fixture',
        model: 'fixture-model',
        promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
        validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
        inputFingerprint: `${PREFIX}-input`,
        snapshotId: IDS.snapshot,
        createdFromCandidateId: IDS.candidate,
        titulo: 'Oferta factual',
        mensagem: 'Produto com dados atuais.',
        cta: `Confira ${AFFILIATE_LINK}`,
        hashtags: '#oferta',
      },
    });
    await prisma.commercialPromotionCandidate.create({
      data: {
        id: IDS.candidate,
        campaignId: IDS.campaign,
        productId: IDS.product,
        snapshotId: IDS.snapshot,
        generatedCopyId: IDS.copy,
        status: 'COPY_READY',
        rankPosition: 1,
        commercialScore: 82,
        scorePolicyVersion: 'official-v2',
        minimumScoreUsed: 60,
        scoreBreakdown: { policyVersion: 'official-v2', finalScore: 82 },
        promotionSignals: ['CURRENT_DISCOUNT'],
        queuedAt: NOW,
        lastEvaluatedAt: NOW,
        expiresAt: new Date(NOW.getTime() + 60 * 60_000),
      },
    });
    await prisma.commercialAutomationExecution.create({
      data: {
        id: IDS.execution,
        schedulerJobId: `${PREFIX}-scheduler`,
        bullMqJobId: `${PREFIX}-bullmq`,
        activeKey: `${PREFIX}-active`,
        ownerId: `${PREFIX}-owner`,
        heartbeatAt: NOW,
        leaseExpiresAt,
        mode: 'SEND',
        status: 'STARTED',
        externalStage: 'NOT_REACHED',
        reasons: [],
        startedAt: NOW,
      },
    });
    await prisma.productLead.create({
      data: {
        id: RACE.product,
        source: 'OFFICIAL',
        providerProductId: `${PREFIX}-race-provider`,
        nome: 'Produto fulfillment race',
        categoria: 'fixture',
        preco: 89.9,
        precoMin: 89.9,
        precoMax: 89.9,
        desconto: 25,
        nota: 4.8,
        vendidos: 100,
        comissao: 10,
        loja: 'Loja fulfillment race',
        urlImagem: 'https://example.invalid/fulfillment-race.jpg',
        productLink: RACE_PRODUCT_LINK,
        affiliateLink: RACE_AFFILIATE_LINK,
        title: 'Produto fulfillment race',
        commercialSnapshotRevision: 1,
        commercialSnapshotFingerprint: RACE_SNAPSHOT_FINGERPRINT,
        fetchedAt: NOW,
        lastSeenAt: NOW,
      },
    });
    await prisma.commercialOfferSnapshot.create({
      data: {
        id: RACE.snapshot,
        productId: RACE.product,
        revision: 1,
        fingerprint: RACE_SNAPSHOT_FINGERPRINT,
        price: 89.9,
        discountRate: 25,
        commissionRate: 10,
        observedRating: 4.8,
        observedSales: 100,
        capturedAt: NOW,
      },
    });
    await prisma.generatedCopy.create({
      data: {
        id: RACE.copy,
        productId: RACE.product,
        source: 'AI',
        provider: 'fixture',
        model: 'fixture-model',
        promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
        validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
        inputFingerprint: `${PREFIX}-race-input`,
        snapshotId: RACE.snapshot,
        createdFromCandidateId: RACE.candidate,
        titulo: 'Oferta factual race',
        mensagem: 'Produto com dados atuais para a disputa.',
        cta: `Confira ${RACE_AFFILIATE_LINK}`,
        hashtags: '#oferta',
      },
    });
    await prisma.commercialPromotionCandidate.create({
      data: {
        id: RACE.candidate,
        campaignId: RACE.campaign,
        productId: RACE.product,
        snapshotId: RACE.snapshot,
        generatedCopyId: RACE.copy,
        status: 'COPY_READY',
        rankPosition: 1,
        commercialScore: 82,
        scorePolicyVersion: 'official-v2',
        minimumScoreUsed: 60,
        scoreBreakdown: { policyVersion: 'official-v2', finalScore: 82 },
        promotionSignals: ['CURRENT_DISCOUNT'],
        queuedAt: NOW,
        lastEvaluatedAt: NOW,
        expiresAt: new Date(NOW.getTime() + 60 * 60_000),
      },
    });
    await prisma.commercialAutomationExecution.create({
      data: {
        id: RACE.execution,
        schedulerJobId: `${PREFIX}-race-scheduler`,
        bullMqJobId: `${PREFIX}-race-bullmq`,
        activeKey: `${PREFIX}-race-active`,
        ownerId: `${PREFIX}-race-owner`,
        heartbeatAt: NOW,
        leaseExpiresAt,
        mode: 'SEND',
        status: 'STARTED',
        externalStage: 'NOT_REACHED',
        reasons: [],
        startedAt: NOW,
      },
    });
    await prisma.commercialPipelineRun.create({
      data: {
        id: RACE.manualRun,
        instanceName: INSTANCE_A,
        mode: 'DRY_RUN',
        status: 'COMPLETED',
        productId: RACE.product,
        groupDestinationId: RACE.destination,
        productName: 'Produto fulfillment race',
        productPrice: 89.9,
        groupName: 'Grupo fulfillment race',
        groupFingerprint: RACE_GROUP_FINGERPRINT,
        score: 82,
        scorePolicyVersion: 'official-v2',
        minimumScoreUsed: 60,
        maximumScoreObserved: 82,
        candidateCount: 1,
        eligibleCount: 1,
        rejectedCount: 0,
        rejectionSummary: {},
        selectionReasons: ['Selecao manual de fixture'],
        copyPreview: `Oferta factual race ${RACE_AFFILIATE_LINK}`,
        plannedSubIds: [],
        completedAt: NOW,
      },
    });
  });

  afterAll(async () => {
    await removeFixtures();
    await prisma.$disconnect();
  });

  const handoffInput = (preparedId: string) => ({
    preparedId,
    executionId: IDS.execution,
    ownerId: `${PREFIX}-owner`,
    campaignId: IDS.campaign,
    groupDestinationId: IDS.destination,
    instanceName: INSTANCE_A,
    logicalGroupFingerprint: GROUP_FINGERPRINT,
    scheduleRevision: 1,
    assignmentRevision: 1,
    expectedNicheId: IDS.niche,
    expectedNicheUpdatedAt: nicheUpdatedAt,
    now: NOW,
    leaseExpiresAt,
  });

  const raceHandoffInput = (preparedId: string) => ({
    preparedId,
    executionId: RACE.execution,
    ownerId: `${PREFIX}-race-owner`,
    campaignId: RACE.campaign,
    groupDestinationId: RACE.destination,
    instanceName: INSTANCE_A,
    logicalGroupFingerprint: RACE_GROUP_FINGERPRINT,
    scheduleRevision: 1,
    assignmentRevision: 1,
    expectedNicheId: IDS.niche,
    expectedNicheUpdatedAt: nicheUpdatedAt,
    now: NOW,
    leaseExpiresAt,
  });

  it('mantem uma unica reserva quando confirmacao manual e automatica disputam o mesmo candidate', async () => {
    const ready = await prepared.createReady({
      campaignId: RACE.campaign,
      groupDestinationId: RACE.destination,
      instanceName: INSTANCE_A,
      logicalGroupFingerprint: RACE_GROUP_FINGERPRINT,
      candidateId: RACE.candidate,
      generatedCopyId: RACE.copy,
      copyPreview: `Oferta factual race ${RACE_AFFILIATE_LINK}`,
      scheduleRevision: 1,
      assignmentRevision: 1,
      expiresAt: new Date(NOW.getTime() + 30 * 60_000),
      now: NOW,
    });
    expect(ready).toMatchObject({ status: 'READY', runId: null });
    if (!ready) throw new Error('race prepared fixture was not created');
    const claimed = await prepared.claimReady({
      campaignId: RACE.campaign,
      groupDestinationId: RACE.destination,
      instanceName: INSTANCE_A,
      logicalGroupFingerprint: RACE_GROUP_FINGERPRINT,
      scheduleRevision: 1,
      assignmentRevision: 1,
      ownerId: `${PREFIX}-race-owner`,
      now: NOW,
      leaseExpiresAt,
    });
    expect(claimed?.id).toBe(ready.id);

    const confirmation = createCommercialPipelineConfirmationService({
      repositories,
      queue: {
        hasJob: async () => false,
        enqueue: async () => undefined,
      },
      instanceName: INSTANCE_A,
      maximumCopyLength: 1_000,
      environment: {
        groupSendEnabled: true,
        safeMode: true,
        schedulerEnabled: false,
        maximumMessagesPerRun: 1,
      },
      logger,
    });
    const [automatic, manual] = await Promise.allSettled([
      confirmation.confirmPrepared(
        raceHandoffInput(ready.id),
        COMMERCIAL_CONFIRMATION_TOKEN,
        { deferPublication: true },
      ),
      confirmation.confirm(
        RACE.manualRun,
        COMMERCIAL_CONFIRMATION_TOKEN,
        {
          manual: true,
          existingGeneratedCopyId: RACE.copy,
          deferPublication: true,
        },
      ),
    ]);
    expect(
      [automatic, manual].filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      await prisma.whatsAppDispatch.count({
        where: {
          productId: RACE.product,
          destinationId: RACE.destination,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.commercialPromotionCandidate.findUnique({
        where: { id: RACE.candidate },
        select: { status: true, generatedCopyId: true },
      }),
    ).toEqual({ status: 'RESERVED', generatedCopyId: RACE.copy });
    const persistedPrepared = await prisma.commercialPreparedMessage.findUnique({
      where: { id: ready.id },
      select: { status: true, runId: true },
    });
    expect(persistedPrepared?.status).toMatch(/^(RESERVED|DISPATCHED)$/);
    expect(
      await prisma.commercialPipelineRun.count({
        where: { productId: RACE.product, mode: 'CONFIRMED' },
      }),
    ).toBe(1);
  });

  it(
    'faz handoff atomico e idempotente, disputa envio paralelo e conclui no SERVER_ACK',
    async () => {
    const ready = await prepared.createReady({
      campaignId: IDS.campaign,
      groupDestinationId: IDS.destination,
      instanceName: INSTANCE_A,
      logicalGroupFingerprint: GROUP_FINGERPRINT,
      candidateId: IDS.candidate,
      generatedCopyId: IDS.copy,
      copyPreview: `Oferta factual ${AFFILIATE_LINK}`,
      scheduleRevision: 1,
      assignmentRevision: 1,
      expiresAt: new Date(NOW.getTime() + 30 * 60_000),
      now: NOW,
    });
    expect(ready).toMatchObject({ status: 'READY', runId: null });
    if (!ready) throw new Error('prepared fixture was not created');

    const claimed = await prepared.claimReady({
      campaignId: IDS.campaign,
      groupDestinationId: IDS.destination,
      instanceName: INSTANCE_A,
      logicalGroupFingerprint: GROUP_FINGERPRINT,
      scheduleRevision: 1,
      assignmentRevision: 1,
      ownerId: `${PREFIX}-owner`,
      now: NOW,
      leaseExpiresAt,
    });
    expect(claimed?.id).toBe(ready.id);

    await prisma.generatedCopy.create({
      data: {
        id: IDS.competingCopy,
        productId: IDS.product,
        source: 'LEGACY_TEMPLATE',
        titulo: 'Outra oferta',
        mensagem: 'Disputa de envio.',
        cta: AFFILIATE_LINK,
        hashtags: '#oferta',
      },
    });
    await prisma.whatsAppDispatch.create({
      data: {
        id: IDS.competingDispatch,
        productId: IDS.product,
        generatedCopyId: IDS.competingCopy,
        destinationId: IDS.destination,
        instanceName: INSTANCE_A,
        status: 'PENDING',
        attemptCount: 0,
      },
    });

    const competingHandoff = await prepared.handoff?.(handoffInput(ready.id));
    expect(competingHandoff).toEqual({
      outcome: 'PRECOMMIT_REJECTED',
      reason: 'COMMERCIAL_PREPARED_HANDOFF_PRODUCT_ALREADY_SENT',
      rollbackConfirmed: true,
    });
    expect(
      await prisma.commercialPreparedMessage.findUnique({
        where: { id: ready.id },
        select: { status: true, runId: true },
      }),
    ).toEqual({ status: 'RESERVED', runId: null });
    expect(
      await prisma.commercialPromotionCandidate.findUnique({
        where: { id: IDS.candidate },
        select: { status: true },
      }),
    ).toEqual({ status: 'COPY_READY' });
    expect(
      await prisma.commercialPipelineRun.count({ where: { productId: IDS.product } }),
    ).toBe(0);

    await prisma.whatsAppDispatch.delete({ where: { id: IDS.competingDispatch } });
    await prisma.generatedCopy.delete({ where: { id: IDS.competingCopy } });

    let nicheLockAcquired!: () => void;
    const nicheLocked = new Promise<void>((resolve) => {
      nicheLockAcquired = resolve;
    });
    let releaseNicheUpdate!: () => void;
    const continueNicheUpdate = new Promise<void>((resolve) => {
      releaseNicheUpdate = resolve;
    });
    const concurrentPolicyUpdate = prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "CommercialNiche"
        WHERE "id" = ${IDS.niche}
        FOR UPDATE
      `;
      if (locked.length !== 1) throw new Error('niche lock fixture was not found');
      nicheLockAcquired();
      await continueNicheUpdate;
      return transaction.commercialNiche.update({
        where: { id: IDS.niche },
        data: {
          maxPrice: 50,
          updatedAt: new Date(NOW.getTime() + 1_000),
        },
      });
    });
    await nicheLocked;
    const fencedHandoff = prepared.handoff?.(handoffInput(ready.id));
    if (!fencedHandoff) throw new Error('prepared handoff method is unavailable');
    releaseNicheUpdate();
    await concurrentPolicyUpdate;
    const fencedOutcome = await fencedHandoff;
    expect(fencedOutcome).toMatchObject({
      outcome: 'PRECOMMIT_REJECTED',
      rollbackConfirmed: true,
    });
    if (fencedOutcome.outcome !== 'PRECOMMIT_REJECTED') {
      throw new Error('fenced handoff unexpectedly became unknown');
    }
    expect([
      'COMMERCIAL_PREPARED_HANDOFF_TRANSACTION_CONFLICT',
      'COMMERCIAL_AUTOMATION_NICHE_POLICY_CHANGED',
    ]).toContain(fencedOutcome.reason);
    expect(
      await prisma.commercialPreparedMessage.findUnique({
        where: { id: ready.id },
        select: { status: true, runId: true },
      }),
    ).toEqual({ status: 'RESERVED', runId: null });
    expect(
      await prisma.commercialPipelineRun.count({ where: { productId: IDS.product } }),
    ).toBe(0);
    const restoredNiche = await prisma.commercialNiche.update({
      where: { id: IDS.niche },
      data: {
        maxPrice: null,
        updatedAt: new Date(NOW.getTime() + 2_000),
      },
    });
    nicheUpdatedAt = restoredNiche.updatedAt;

    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error('disposable Redis URL missing');
    const redisConnection = createRedisConnection(redisUrl);
    const dispatchQueue = createWhatsAppDispatchQueue(redisConnection);
    const provider = new MockWhatsAppProvider();
    const groupSendPolicy = new WhatsAppGroupSendPolicy({
      enabled: true,
      safeMode: true,
      instanceName: INSTANCE_A,
    });
    const dispatchWorker = createWhatsAppDispatchWorker(redisUrl, {
      connection: redisConnection,
      prisma,
      whatsAppProvider: provider,
      whatsAppProviderResolver: async (instanceName) => {
        if (instanceName !== INSTANCE_A) throw new Error('unexpected instance');
        return provider;
      },
      commercialAutomationMode: 'send',
      groupSendPolicy,
      draftService: new CommercialMessageDraftService(),
      reservationLeaseMilliseconds: 120_000,
      clock: () => NOW,
      logger,
    });
    const queue = {
      hasJob: async (jobId: string) => Boolean(await dispatchQueue.getJob(jobId)),
      getJob: async (jobId: string) => {
        const job = await dispatchQueue.getJob(jobId);
        if (!job) return null;
        return {
          id: String(job.id ?? jobId),
          dispatchId: job.data.dispatchId,
          instanceName: job.data.instanceName,
        };
      },
      enqueue: async (dispatchId: string, jobId: string, instanceName?: string | null) => {
        await enqueueControlledWhatsAppDispatch(
          dispatchQueue,
          {
            dispatchId,
            ...(instanceName ? { instanceName } : {}),
          },
          jobId,
        );
      },
    };
    try {
      const confirmationService = createCommercialPipelineConfirmationService({
        repositories,
        queue,
        instanceName: INSTANCE_A,
        maximumCopyLength: 1000,
        environment: {
          groupSendEnabled: true,
          safeMode: true,
          schedulerEnabled: false,
          maximumMessagesPerRun: 1,
        },
        logger,
      });
      const confirmed = await confirmationService.confirmPrepared(
        handoffInput(ready.id),
        COMMERCIAL_CONFIRMATION_TOKEN,
      );
      expect(confirmed).toMatchObject({
        outcome: 'HANDOFF_COMMITTED',
        publication: 'PUBLISHED',
      });
      if (confirmed.outcome !== 'HANDOFF_COMMITTED') {
        throw new Error('confirmation did not produce a durable handoff');
      }
      const handoff = confirmed.handoff;
      expect(handoff).toMatchObject({
        candidateId: IDS.candidate,
        generatedCopyId: IDS.copy,
        dispatchId: `commercial-prepared-${ready.id}-dispatch`,
        jobId: `commercial-prepared-${ready.id}-job`,
      });
      expect(confirmed).toMatchObject({
        handoff: { runId: handoff.runId, outbox: { id: handoff.outbox.id } },
        result: {
          runId: handoff.runId,
          outboxId: handoff.outbox.id,
          dispatchWasCreated: true,
          jobWasCreated: true,
        },
      });
      const repeated = await confirmationService.confirmPrepared(
        handoffInput(ready.id),
        COMMERCIAL_CONFIRMATION_TOKEN,
        { deferPublication: true },
      );
      if (repeated.outcome !== 'HANDOFF_COMMITTED') {
        throw new Error('repeated handoff did not remain durable');
      }
      expect(repeated).toMatchObject({
        outcome: 'HANDOFF_COMMITTED',
        publication: 'NOT_ATTEMPTED',
        handoff: { runId: handoff.runId, outbox: { id: handoff.outbox.id } },
        result: { runId: handoff.runId, outboxId: handoff.outbox.id },
      });

      const publishedJob = await dispatchQueue.getJob(handoff.jobId);
      expect(publishedJob).toMatchObject({
        id: handoff.jobId,
        name: JOB_NAMES.whatsappDispatch,
        data: { dispatchId: handoff.dispatchId, instanceName: INSTANCE_A },
      });

      expect(
        await prisma.commercialPreparedMessage.findUnique({
          where: { id: ready.id },
          select: { status: true, runId: true, reservationOwnerId: true },
        }),
      ).toEqual({ status: 'DISPATCHED', runId: handoff.runId, reservationOwnerId: null });
      expect(
        await prisma.commercialPromotionCandidate.findUnique({
          where: { id: IDS.candidate },
          select: { status: true },
        }),
      ).toEqual({ status: 'RESERVED' });
      expect(
        await prisma.commercialAutomationExecution.findUnique({
          where: { id: IDS.execution },
          select: { commercialRunId: true },
        }),
      ).toEqual({ commercialRunId: handoff.runId });
      expect(
        await prisma.commercialGroupCampaign.findUnique({
          where: { id: IDS.campaign },
          select: { attemptExecutionId: true },
        }),
      ).toEqual({ attemptExecutionId: IDS.execution });

      expect(
        await prisma.commercialDispatchOutbox.findUnique({
          where: { id: handoff.outbox.id },
          select: { status: true, jobId: true },
        }),
      ).toEqual({ status: 'PUBLISHED', jobId: handoff.jobId });

      const dispatchDetails = await repositories.whatsappDispatches.findByIdForSending(
        handoff.dispatchId,
      );
      if (!dispatchDetails) throw new Error('dispatch details missing');
      const [dispatchCandidate] = dispatchDetails.generatedCopy.promotionCandidates ?? [];
      if (!dispatchCandidate) throw new Error('dispatch candidate missing');
      expect(fingerprintCommercialOfferProduct(dispatchCandidate.product)).toBe(
        SNAPSHOT_FINGERPRINT,
      );
      const provenance = validateCommercialAffiliateLinkProvenance(
        {
          candidate: dispatchCandidate,
          campaign: dispatchCandidate.campaign,
          product: dispatchCandidate.product,
          snapshot: dispatchCandidate.snapshot,
        },
        {
          candidateId: IDS.candidate,
          campaignId: IDS.campaign,
          groupId: IDS.destination,
        },
      );
      if (!provenance.valid) {
        throw new Error(`Unexpected invalid affiliate-link provenance: ${provenance.code}`);
      }
      expect(provenance.provenance).toBeDefined();

      try {
        await vi.waitFor(
          async () => {
            expect(provider.sentMessages).toHaveLength(1);
            await expect(
              prisma.whatsAppDispatch.findUnique({
                where: { id: handoff.dispatchId },
                select: { status: true },
              }),
            ).resolves.toEqual({ status: 'SUBMITTED' });
          },
          { timeout: 15_000, interval: 50 },
        );
      } catch (error) {
        const failedJob = await dispatchQueue.getJob(handoff.jobId);
        const state = failedJob ? await failedJob.getState() : 'missing';
        const dispatchState = await prisma.whatsAppDispatch.findUnique({
          where: { id: handoff.dispatchId },
          select: { status: true, attemptCount: true, errorMessage: true },
        });
        throw new Error(
          `Dispatch worker did not submit: state=${state} failedReason=${failedJob?.failedReason ?? 'none'} dispatch=${JSON.stringify(dispatchState)} cause=${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
      expect(provider.sentMessages).toHaveLength(1);
      expect(provider.sentMessages[0]).toMatchObject({
        destination: GROUP_ID,
        destinationType: 'GROUP',
        imageUrl: 'https://example.invalid/fulfillment.jpg',
      });

      const deliveryEvents = repositories.whatsappDeliveryEvents;
      if (!deliveryEvents) throw new Error('delivery inbox repository missing');
      const confirmation = new WhatsAppDeliveryConfirmationService({
        dispatches: repositories.whatsappDispatches,
        deliveryEvents,
        runs: repositories.commercialRuns,
        promotionCandidates: repositories.commercialPromotions,
        logger,
        clock: () => NOW,
      });
      const externalMessageId = `mock-whatsapp-1`;
      const firstConfirmation = await confirmation.consume({
        instanceName: INSTANCE_A,
        externalMessageId,
        status: 'SERVER_ACK',
        occurredAt: NOW,
      });
      expect(firstConfirmation).toMatchObject({ kind: 'UPDATED' });
      expect(
        await prisma.whatsAppDispatch.findUnique({
          where: { id: handoff.dispatchId },
          select: { status: true, externalMessageId: true },
        }),
      ).toEqual({ status: 'SENT', externalMessageId });
      expect(
        await prisma.commercialPipelineRun.findUnique({
          where: { id: handoff.runId },
          select: { status: true, finalStatus: true, investigationRequired: true },
        }),
      ).toEqual({ status: 'COMPLETED', finalStatus: 'SENT', investigationRequired: false });
      expect(
        await prisma.commercialPromotionCandidate.findUnique({
          where: { id: IDS.candidate },
          select: { status: true },
        }),
      ).toEqual({ status: 'DISPATCHED' });
      expect(
        await prisma.commercialGroupCampaign.findUnique({
          where: { id: IDS.campaign },
          select: { attemptExecutionId: true, attemptLeaseExpiresAt: true },
        }),
      ).toEqual({ attemptExecutionId: null, attemptLeaseExpiresAt: null });

      await expect(
        confirmation.consume({
          instanceName: INSTANCE_A,
          externalMessageId,
          status: 'SERVER_ACK',
          occurredAt: NOW,
        }),
      ).resolves.toMatchObject({ kind: 'NOOP' });
      expect(provider.sentMessages).toHaveLength(1);
    } finally {
      await dispatchWorker.close();
      await dispatchQueue.obliterate({ force: true }).catch(() => undefined);
      await dispatchQueue.close();
      await redisConnection.quit();
    }
    },
    30_000,
  );
});
