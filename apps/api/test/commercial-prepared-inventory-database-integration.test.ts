import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';

import {
  createCommercialPromotionCopyGenerationService,
  createCommercialPromotionMiningService,
  createPrismaRepositories,
} from '../src/application-services';
import { CommercialAutomationCandidateFlowService } from '../src/commercial-automation-candidate-flow-service';
import { CommercialInventorySupervisor } from '../src/commercial-inventory-supervisor';
import { CommercialMessageDraftService } from '../src/commercial-message-draft-service';
import {
  PrismaCommercialDiscoveryCheckpointRepository,
  PrismaCommercialPreparedMessageRepository,
} from '../src/prisma-repositories';
import {
  COMMERCIAL_AI_COPY_PROMPT_VERSION,
  COMMERCIAL_AI_COPY_VALIDATION_VERSION,
} from '../src/commercial-ai-copy-prompt';
import { fingerprintCommercialOffer } from '../src/commercial-offer-snapshot';

const enabled = process.env.RUN_COMMERCIAL_INVENTORY_DB_TEST === 'true';
const describeDatabase = enabled ? describe : describe.skip;
const NOW = new Date('2026-09-06T12:00:00.000Z');
const PREFIX = 'persistent-inventory-db-fixture';
const IDS = {
  niche: `${PREFIX}-niche`,
  campaign: `${PREFIX}-campaign`,
  destination: `${PREFIX}-destination`,
  instance: `${PREFIX}-instance`,
};
const REPREPARE = {
  niche: `${PREFIX}-reprepare-niche`,
  campaign: `${PREFIX}-reprepare-campaign`,
  destination: `${PREFIX}-reprepare-destination`,
  instance: `${PREFIX}-reprepare-instance`,
  fingerprint: 'grp_123456789abc',
};

type Fixture = {
  productId: string;
  snapshotId: string;
  candidateId: string;
  copyId: string;
  runId: string;
};

describeDatabase('persistent commercial inventory PostgreSQL fixture', () => {
  const prisma = createPrismaClient();
  const repositories = createPrismaRepositories(prisma);
  const checkpoints = new PrismaCommercialDiscoveryCheckpointRepository(prisma);
  const prepared = new PrismaCommercialPreparedMessageRepository(prisma);
  const fixtures: Fixture[] = [];

  const removeFixtures = async () => {
    await prisma.commercialPreparedMessage.deleteMany({
      where: { campaignId: { in: [IDS.campaign, REPREPARE.campaign] } },
    });
    await prisma.commercialDispatchOutbox.deleteMany({
      where: { commercialRun: { id: { startsWith: PREFIX } } },
    });
    await prisma.whatsAppDispatch.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    await prisma.commercialPipelineRun.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    await prisma.commercialCopyGenerationAttempt.deleteMany({
      where: { candidateId: { startsWith: PREFIX } },
    });
    await prisma.commercialPromotionCandidate.deleteMany({
      where: { id: { startsWith: PREFIX } },
    });
    await prisma.generatedCopy.deleteMany({
      where: {
        OR: [
          { id: { startsWith: PREFIX } },
          { snapshotId: { startsWith: PREFIX } },
          { createdFromCandidateId: { startsWith: PREFIX } },
        ],
      },
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
      where: { id: { in: [IDS.campaign, REPREPARE.campaign] } },
    });
    await prisma.whatsAppDestination.deleteMany({
      where: { id: { in: [IDS.destination, REPREPARE.destination] } },
    });
    await prisma.whatsAppInstance.deleteMany({
      where: { name: { in: [IDS.instance, REPREPARE.instance] } },
    });
    await prisma.commercialNiche.deleteMany({
      where: { id: { in: [IDS.niche, REPREPARE.niche] } },
    });
  };

  const createFixture = async (
    name: string,
    options: {
      campaignId?: string;
      destinationId?: string;
      instanceName?: string;
      groupFingerprint?: string;
    } = {},
  ): Promise<Fixture> => {
    const campaignId = options.campaignId ?? IDS.campaign;
    const destinationId = options.destinationId ?? IDS.destination;
    const instanceName = options.instanceName ?? IDS.instance;
    const groupFingerprint =
      options.groupFingerprint ?? 'persistent-inventory-group';
    const fixture = {
      productId: `${PREFIX}-${name}-product`,
      snapshotId: `${PREFIX}-${name}-snapshot`,
      candidateId: `${PREFIX}-${name}-candidate`,
      copyId: `${PREFIX}-${name}-copy`,
      runId: `${PREFIX}-${name}-run`,
    };
    const productLink =
      name === 'reprepare'
        ? 'https://shopee.com.br/product/fixture/123'
        : 'https://example.invalid/product';
    const affiliateLink =
      name === 'reprepare'
        ? 'https://s.shopee.com.br/fixture-affiliate'
        : 'https://example.invalid/affiliate';
    const fingerprint = `${PREFIX}-${name}-fingerprint`;
    await prisma.productLead.create({
      data: {
        id: fixture.productId,
        source: 'OFFICIAL',
        providerProductId: `${PREFIX}-${name}-provider`,
        nome: `Produto ${name}`,
        categoria: 'fixture',
        preco: 99.9,
        precoMin: 99.9,
        precoMax: 99.9,
        desconto: 20,
        nota: 4.8,
        vendidos: 100,
        comissao: 10,
        loja: 'Loja fixture',
        urlImagem: 'https://example.invalid/image',
        productLink,
        affiliateLink,
        title: `Produto ${name}`,
        commercialSnapshotRevision: 1,
        commercialSnapshotFingerprint: fingerprint,
        fetchedAt: NOW,
        lastSeenAt: NOW,
      },
    });
    await prisma.commercialOfferSnapshot.create({
      data: {
        id: fixture.snapshotId,
        productId: fixture.productId,
        revision: 1,
        fingerprint,
        price: 99.9,
        priceMin: 99.9,
        priceMax: 99.9,
        discountRate: 20,
        commissionRate: 10,
        observedRating: 4.8,
        observedSales: 100,
        capturedAt: NOW,
      },
    });
    await prisma.commercialPromotionCandidate.create({
      data: {
        id: fixture.candidateId,
        campaignId,
        productId: fixture.productId,
        snapshotId: fixture.snapshotId,
        status: 'QUEUED',
        commercialScore: 82,
        scorePolicyVersion: 'official-v2',
        minimumScoreUsed: 60,
        scoreBreakdown: { policyVersion: 'official-v2', finalScore: 82 },
        promotionSignals: ['CURRENT_DISCOUNT'],
        queuedAt: NOW,
        lastEvaluatedAt: NOW,
      },
    });
    await prisma.generatedCopy.create({
      data: {
        id: fixture.copyId,
        productId: fixture.productId,
        source: 'AI',
        provider: 'fixture',
        model: 'fixture-model',
        promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
        validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
        snapshotId: fixture.snapshotId,
        createdFromCandidateId: fixture.candidateId,
        inputFingerprint: `${PREFIX}-${name}-input`,
        titulo: 'Oferta',
        mensagem: 'Mensagem factual',
        cta: 'Confira',
        hashtags: '#Oferta',
      },
    });
    await prisma.commercialPromotionCandidate.update({
      where: { id: fixture.candidateId },
      data: { status: 'COPY_READY', generatedCopyId: fixture.copyId },
    });
    await prisma.commercialPipelineRun.create({
      data: {
        id: fixture.runId,
        mode: 'DRY_RUN',
        status: 'COMPLETED',
        productId: fixture.productId,
        groupDestinationId: destinationId,
        instanceName,
        productName: `Produto ${name}`,
        productPrice: 99.9,
        groupName: 'Grupo fixture',
        groupFingerprint,
        rejectionSummary: {},
        selectionReasons: {},
        plannedSubIds: {},
        completedAt: NOW,
      },
    });
    fixtures.push(fixture);
    return fixture;
  };

  beforeAll(async () => {
    await removeFixtures();
    await prisma.commercialNiche.create({
      data: {
        id: IDS.niche,
        name: 'Fixture',
        slug: IDS.niche,
        active: true,
      },
    });
    await prisma.whatsAppInstance.create({
      data: { name: IDS.instance, active: true, paused: false },
    });
    await prisma.whatsAppDestination.create({
      data: {
        id: IDS.destination,
        name: 'Grupo fixture',
        destination: 'persistent-inventory-fixture@g.us',
        type: 'GROUP',
        active: true,
        paused: false,
        available: true,
        fingerprint: 'persistent-inventory-group',
        sourceInstanceName: IDS.instance,
        assignedInstanceName: IDS.instance,
      },
    });
    await prisma.commercialGroupCampaign.create({
      data: {
        id: IDS.campaign,
        name: 'Campaign fixture',
        logicalGroupFingerprint: 'persistent-inventory-group',
        anchorDestinationId: IDS.destination,
        nicheId: IDS.niche,
        active: true,
      },
    });
    await prisma.commercialNiche.create({
      data: {
        id: REPREPARE.niche,
        name: 'Fixture reprepare',
        slug: REPREPARE.niche,
        active: true,
        includeKeywords: ['reprepare'],
        minDiscountRate: 5,
        minimumScore: 50,
      },
    });
    await prisma.whatsAppInstance.create({
      data: { name: REPREPARE.instance, active: true, paused: false },
    });
    await prisma.whatsAppDestination.create({
      data: {
        id: REPREPARE.destination,
        name: 'Grupo reprepare',
        destination: 'persistent-reprepare-fixture@g.us',
        type: 'GROUP',
        active: true,
        paused: false,
        available: true,
        fingerprint: REPREPARE.fingerprint,
        sourceInstanceName: REPREPARE.instance,
        assignedInstanceName: REPREPARE.instance,
      },
    });
    await prisma.commercialGroupCampaign.create({
      data: {
        id: REPREPARE.campaign,
        name: 'Campaign reprepare',
        logicalGroupFingerprint: REPREPARE.fingerprint,
        anchorDestinationId: REPREPARE.destination,
        nicheId: REPREPARE.niche,
        active: true,
        queueTargetSize: 1,
        dailyLimit: 1,
      },
    });
    await createFixture('claim');
    await createFixture('recovery');
    await createFixture('effect');
    await createFixture('stale');
    await createFixture('expiry-first');
    await createFixture('expiry-second');
    await createFixture('reprepare', {
      campaignId: REPREPARE.campaign,
      destinationId: REPREPARE.destination,
      instanceName: REPREPARE.instance,
      groupFingerprint: REPREPARE.fingerprint,
    });
  });

  afterAll(async () => {
    await removeFixtures();
    await prisma.$disconnect();
  });

  it('persiste checkpoint, mantém lease entre paginas e respeita cooldown', async () => {
    const firstAt = NOW;
    const acquired = await checkpoints.acquire({
      identityFingerprint: `${PREFIX}-checkpoint`,
      source: 'OFFICIAL',
      campaignId: IDS.campaign,
      nicheId: IDS.niche,
      query: { categoryId: '123', sort: 'commission_desc' },
      ownerId: 'inventory-owner-a',
      now: firstAt,
      leaseExpiresAt: new Date(firstAt.getTime() + 120_000),
    });
    expect(acquired).toMatchObject({ page: 1, cursor: null, status: 'ACTIVE' });
    await expect(
      checkpoints.acquire({
        identityFingerprint: `${PREFIX}-checkpoint`,
        source: 'OFFICIAL',
        campaignId: IDS.campaign,
        nicheId: IDS.niche,
        query: { categoryId: '123', sort: 'commission_desc' },
        ownerId: 'inventory-owner-b',
        now: firstAt,
        leaseExpiresAt: new Date(firstAt.getTime() + 120_000),
      }),
    ).resolves.toBeNull();
    const continued = await checkpoints.advance({
      id: acquired?.id ?? '',
      ownerId: 'inventory-owner-a',
      leaseRevision: acquired?.leaseRevision ?? 1,
      now: new Date(firstAt.getTime() + 1_000),
      leaseExpiresAt: new Date(firstAt.getTime() + 120_000),
      page: 2,
      cursor: 'cursor-2',
      hasNextPage: true,
      fetchedProducts: 2,
      nextRefreshAt: null,
    });
    expect(continued).toMatchObject({
      page: 2,
      cursor: 'cursor-2',
      status: 'ACTIVE',
      leaseOwnerId: 'inventory-owner-a',
    });
    const exhausted = await checkpoints.advance({
      id: acquired?.id ?? '',
      ownerId: 'inventory-owner-a',
      leaseRevision: acquired?.leaseRevision ?? 1,
      now: new Date(firstAt.getTime() + 2_000),
      leaseExpiresAt: new Date(firstAt.getTime() + 120_000),
      page: 2,
      cursor: null,
      hasNextPage: false,
      fetchedProducts: 1,
      nextRefreshAt: new Date(firstAt.getTime() + 60 * 60_000),
    });
    expect(exhausted).toMatchObject({ status: 'EXHAUSTED', leaseOwnerId: null });
    await expect(
      checkpoints.acquire({
        identityFingerprint: `${PREFIX}-checkpoint`,
        source: 'OFFICIAL',
        campaignId: IDS.campaign,
        nicheId: IDS.niche,
        query: { categoryId: '123', sort: 'commission_desc' },
        ownerId: 'inventory-owner-c',
        now: new Date(firstAt.getTime() + 30 * 60_000),
        leaseExpiresAt: new Date(firstAt.getTime() + 30 * 60_000 + 120_000),
      }),
    ).resolves.toBeNull();
    const refreshed = await checkpoints.acquire({
      identityFingerprint: `${PREFIX}-checkpoint`,
      source: 'OFFICIAL',
      campaignId: IDS.campaign,
      nicheId: IDS.niche,
      query: { categoryId: '123', sort: 'commission_desc' },
      ownerId: 'inventory-owner-c',
      now: new Date(firstAt.getTime() + 61 * 60_000),
      leaseExpiresAt: new Date(firstAt.getTime() + 61 * 60_000 + 120_000),
    });
    expect(refreshed).toMatchObject({ page: 1, cursor: null, status: 'ACTIVE' });

    const leaseStart = new Date(firstAt.getTime() + 120 * 60_000);
    const leaseOwnerA = await checkpoints.acquire({
      identityFingerprint: `${PREFIX}-stale-owner`,
      source: 'OFFICIAL',
      campaignId: IDS.campaign,
      nicheId: IDS.niche,
      query: { categoryId: '456', sort: 'commission_desc' },
      ownerId: 'stale-owner-a',
      now: leaseStart,
      leaseExpiresAt: new Date(leaseStart.getTime() + 1_000),
    });
    if (!leaseOwnerA) throw new Error('lease owner A missing');
    const leaseOwnerB = await checkpoints.acquire({
      identityFingerprint: `${PREFIX}-stale-owner`,
      source: 'OFFICIAL',
      campaignId: IDS.campaign,
      nicheId: IDS.niche,
      query: { categoryId: '456', sort: 'commission_desc' },
      ownerId: 'stale-owner-b',
      now: new Date(leaseStart.getTime() + 2_000),
      leaseExpiresAt: new Date(leaseStart.getTime() + 122_000),
    });
    expect(leaseOwnerB?.leaseOwnerId).toBe('stale-owner-b');
    await expect(
      checkpoints.advance({
        id: leaseOwnerA.id,
        ownerId: 'stale-owner-a',
        leaseRevision: leaseOwnerA.leaseRevision,
        now: new Date(leaseStart.getTime() + 3_000),
        leaseExpiresAt: new Date(leaseStart.getTime() + 123_000),
        page: 2,
        cursor: 'stale-cursor',
        hasNextPage: true,
        fetchedProducts: 1,
        nextRefreshAt: null,
      }),
    ).resolves.toBeNull();
    await expect(
      checkpoints.fail({
        id: leaseOwnerA.id,
        ownerId: 'stale-owner-a',
        now: new Date(leaseStart.getTime() + 3_000),
        errorCode: 'STALE_OWNER',
      }),
    ).resolves.toBe(false);
    await expect(
      checkpoints.advance({
        id: leaseOwnerA.id,
        ownerId: 'stale-owner-b',
        leaseRevision: leaseOwnerB?.leaseRevision ?? 2,
        now: new Date(leaseStart.getTime() + 3_000),
        leaseExpiresAt: new Date(leaseStart.getTime() + 123_000),
        page: 2,
        cursor: 'owner-b-cursor',
        hasNextPage: true,
        fetchedProducts: 1,
        nextRefreshAt: null,
      }),
    ).resolves.toMatchObject({ page: 2, leaseOwnerId: 'stale-owner-b' });
  });

  it('faz claim concorrente único, release e recovery antes/depois de efeito', async () => {
    const claimFixture = fixtures.find(({ candidateId }) => candidateId.endsWith('-claim-candidate'));
    const recoveryFixture = fixtures.find(({ candidateId }) => candidateId.endsWith('-recovery-candidate'));
    const effectFixture = fixtures.find(({ candidateId }) => candidateId.endsWith('-effect-candidate'));
    if (!claimFixture || !recoveryFixture || !effectFixture) throw new Error('fixture missing');

    const created = await prepared.createReady({
      campaignId: IDS.campaign,
      groupDestinationId: IDS.destination,
      instanceName: IDS.instance,
      logicalGroupFingerprint: 'persistent-inventory-group',
      candidateId: claimFixture.candidateId,
      generatedCopyId: claimFixture.copyId,
      copyPreview: 'Oferta https://example.invalid/affiliate',
      runId: claimFixture.runId,
      now: NOW,
    });
    expect(created).toMatchObject({ status: 'READY', candidateId: claimFixture.candidateId });
    const duplicate = await prepared.createReady({
      campaignId: IDS.campaign,
      groupDestinationId: IDS.destination,
      instanceName: IDS.instance,
      logicalGroupFingerprint: 'persistent-inventory-group',
      candidateId: claimFixture.candidateId,
      generatedCopyId: claimFixture.copyId,
      copyPreview: 'Oferta https://example.invalid/affiliate',
      runId: claimFixture.runId,
      now: NOW,
    });
    expect(duplicate?.id).toBe(created?.id);

    const claims = await Promise.all([
      prepared.claimReady({
        campaignId: IDS.campaign,
        groupDestinationId: IDS.destination,
        instanceName: IDS.instance,
        logicalGroupFingerprint: 'persistent-inventory-group',
        ownerId: 'slot-owner-a',
        now: NOW,
        leaseExpiresAt: new Date(NOW.getTime() + 60_000),
      }),
      prepared.claimReady({
        campaignId: IDS.campaign,
        groupDestinationId: IDS.destination,
        instanceName: IDS.instance,
        logicalGroupFingerprint: 'persistent-inventory-group',
        ownerId: 'slot-owner-b',
        now: NOW,
        leaseExpiresAt: new Date(NOW.getTime() + 60_000),
      }),
    ]);
    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
    expect(claims.filter((claim) => claim === null)).toHaveLength(1);
    const owner = claims.find((claim) => claim !== null)?.reservationOwnerId;
    const claimedId = claims.find((claim) => claim !== null)?.id;
    if (!owner || !claimedId) throw new Error('claim missing');
    await expect(prepared.release({ id: claimedId, ownerId: owner, now: NOW })).resolves.toBe(true);
    const releasedClaim = await prepared.claimReady({
      campaignId: IDS.campaign,
      groupDestinationId: IDS.destination,
      instanceName: IDS.instance,
      logicalGroupFingerprint: 'persistent-inventory-group',
      ownerId: 'slot-owner-release',
      now: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + 60_000),
    });
    expect(releasedClaim?.id).toBe(claimedId);
    await expect(
      prepared.markDispatched({ id: claimedId, ownerId: 'slot-owner-release', now: NOW }),
    ).resolves.toBe(true);

    const recoveryReady = await prepared.createReady({
      campaignId: IDS.campaign,
      groupDestinationId: IDS.destination,
      instanceName: IDS.instance,
      logicalGroupFingerprint: 'persistent-inventory-group',
      candidateId: recoveryFixture.candidateId,
      generatedCopyId: recoveryFixture.copyId,
      copyPreview: 'Oferta https://example.invalid/affiliate',
      runId: recoveryFixture.runId,
      now: NOW,
    });
    expect(recoveryReady).not.toBeNull();
    const recoveryClaim = await prepared.claimReady({
      campaignId: IDS.campaign,
      groupDestinationId: IDS.destination,
      instanceName: IDS.instance,
      logicalGroupFingerprint: 'persistent-inventory-group',
      ownerId: 'recovery-owner',
      now: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + 10_000),
    });
    expect(recoveryClaim).not.toBeNull();
    await expect(
      prepared.recoverExpired({ now: new Date(NOW.getTime() + 20_000), limit: 10 }),
    ).resolves.toBe(1);
    const reopened = await prepared.claimReady({
      campaignId: IDS.campaign,
      groupDestinationId: IDS.destination,
      instanceName: IDS.instance,
      logicalGroupFingerprint: 'persistent-inventory-group',
      ownerId: 'recovery-owner-2',
      now: new Date(NOW.getTime() + 20_000),
      leaseExpiresAt: new Date(NOW.getTime() + 80_000),
    });
    expect(reopened?.candidateId).toBe(recoveryFixture.candidateId);
    if (!reopened) throw new Error('reopened recovery fixture missing');
    await expect(
      prepared.markDispatched({
        id: reopened.id,
        ownerId: 'recovery-owner-2',
        now: new Date(NOW.getTime() + 20_000),
      }),
    ).resolves.toBe(true);

    const effectReady = await prepared.createReady({
      campaignId: IDS.campaign,
      groupDestinationId: IDS.destination,
      instanceName: IDS.instance,
      logicalGroupFingerprint: 'persistent-inventory-group',
      candidateId: effectFixture.candidateId,
      generatedCopyId: effectFixture.copyId,
      copyPreview: 'Oferta https://example.invalid/affiliate',
      runId: effectFixture.runId,
      now: NOW,
    });
    expect(effectReady).not.toBeNull();
    const effectClaim = await prepared.claimReady({
      campaignId: IDS.campaign,
      groupDestinationId: IDS.destination,
      instanceName: IDS.instance,
      logicalGroupFingerprint: 'persistent-inventory-group',
      ownerId: 'effect-owner',
      now: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + 10_000),
    });
    expect(effectClaim).not.toBeNull();
    await prisma.commercialPipelineRun.update({
      where: { id: effectFixture.runId },
      data: { mode: 'CONFIRMED' },
    });
    await expect(
      prepared.recoverExpired({ now: new Date(NOW.getTime() + 20_000), limit: 10 }),
    ).resolves.toBe(1);
    expect(
      await prisma.commercialPreparedMessage.findUnique({
        where: { id: effectClaim?.id },
        select: { status: true },
      }),
    ).toEqual({ status: 'DISPATCHED' });
  });

  it('invalida READY quando o snapshot atual muda e não o reabre', async () => {
    const staleFixture = fixtures.find(({ candidateId }) => candidateId.endsWith('-stale-candidate'));
    if (!staleFixture) throw new Error('stale fixture missing');
    await prepared.createReady({
      campaignId: IDS.campaign,
      groupDestinationId: IDS.destination,
      instanceName: IDS.instance,
      logicalGroupFingerprint: 'persistent-inventory-group',
      candidateId: staleFixture.candidateId,
      generatedCopyId: staleFixture.copyId,
      copyPreview: 'Oferta https://example.invalid/affiliate',
      runId: staleFixture.runId,
      now: NOW,
    });
    await prisma.productLead.update({
      where: { id: staleFixture.productId },
      data: { commercialSnapshotFingerprint: `${PREFIX}-changed` },
    });
    await expect(prepared.invalidateStale({ now: NOW, limit: 10 })).resolves.toBe(1);
    expect(
      await prisma.commercialPreparedMessage.findFirst({
        where: { candidateId: staleFixture.candidateId },
        select: { status: true, invalidatedReason: true },
      }),
    ).toEqual({ status: 'INVALIDATED', invalidatedReason: 'SNAPSHOT_OR_COPY_STALE' });
    await expect(
      prisma.commercialPreparedMessage.count({
        where: { candidateId: staleFixture.candidateId, status: 'READY' },
      }),
    ).resolves.toBe(0);

    await expect(
      prepared.createReady({
        campaignId: IDS.campaign,
        groupDestinationId: IDS.destination,
        instanceName: IDS.instance,
        logicalGroupFingerprint: 'persistent-inventory-group',
        candidateId: staleFixture.candidateId,
        generatedCopyId: staleFixture.copyId,
        copyPreview: 'Oferta https://example.invalid/affiliate',
        runId: staleFixture.runId,
        now: NOW,
      }),
    ).resolves.toBeNull();

    const nextSnapshotId = `${PREFIX}-stale-snapshot-2`;
    const nextCopyId = `${PREFIX}-stale-copy-2`;
    const nextFingerprint = `${PREFIX}-stale-fingerprint-2`;
    await prisma.commercialOfferSnapshot.create({
      data: {
        id: nextSnapshotId,
        productId: staleFixture.productId,
        revision: 2,
        fingerprint: nextFingerprint,
        price: 89.9,
        priceMin: 89.9,
        priceMax: 89.9,
        discountRate: 25,
        commissionRate: 10,
        observedRating: 4.8,
        observedSales: 100,
        capturedAt: new Date(NOW.getTime() + 1_000),
      },
    });
    await prisma.productLead.update({
      where: { id: staleFixture.productId },
      data: {
        preco: 89.9,
        precoMin: 89.9,
        precoMax: 89.9,
        desconto: 25,
        commercialSnapshotRevision: 2,
        commercialSnapshotFingerprint: nextFingerprint,
      },
    });
    await prisma.generatedCopy.create({
      data: {
        id: nextCopyId,
        productId: staleFixture.productId,
        source: 'AI',
        provider: 'fixture',
        model: 'fixture-model',
        promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
        validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
        snapshotId: nextSnapshotId,
        createdFromCandidateId: staleFixture.candidateId,
        inputFingerprint: `${PREFIX}-stale-input-2`,
        titulo: 'Oferta N+1',
        mensagem: 'Mensagem factual N+1',
        cta: 'Confira https://example.invalid/affiliate',
        hashtags: '#Oferta',
      },
    });
    await prisma.commercialPromotionCandidate.update({
      where: { id: staleFixture.candidateId },
      data: {
        snapshotId: nextSnapshotId,
        generatedCopyId: nextCopyId,
        status: 'COPY_READY',
        rankPosition: 1,
        blockedReason: null,
        expiresAt: new Date(NOW.getTime() + 60 * 60_000),
        lastEvaluatedAt: NOW,
      },
    });
    const reactivated = await prepared.createReady({
      campaignId: IDS.campaign,
      groupDestinationId: IDS.destination,
      instanceName: IDS.instance,
      logicalGroupFingerprint: 'persistent-inventory-group',
      candidateId: staleFixture.candidateId,
      generatedCopyId: nextCopyId,
      copyPreview: 'Oferta N+1 https://example.invalid/affiliate',
      scheduleRevision: 1,
      assignmentRevision: 1,
      now: NOW,
    });
    expect(reactivated).toMatchObject({
      status: 'READY',
      snapshotId: nextSnapshotId,
      generatedCopyId: nextCopyId,
    });
    await expect(
      prepared.listProtectedCandidateIds?.({
        campaignId: IDS.campaign,
        groupDestinationId: IDS.destination,
        instanceName: IDS.instance,
        logicalGroupFingerprint: 'persistent-inventory-group',
        scheduleRevision: 1,
        assignmentRevision: 1,
        now: NOW,
      }),
    ).resolves.toContain(staleFixture.candidateId);
    if (!reactivated) throw new Error('reactivated fixture missing');
    const reactivatedClaim = await prepared.claimReady({
      campaignId: IDS.campaign,
      groupDestinationId: IDS.destination,
      instanceName: IDS.instance,
      logicalGroupFingerprint: 'persistent-inventory-group',
      scheduleRevision: 1,
      assignmentRevision: 1,
      ownerId: 'snapshot-n-plus-one-owner',
      now: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + 60_000),
    });
    expect(reactivatedClaim?.id).toBe(reactivated.id);
    await expect(
      prepared.markDispatched({
        id: reactivated.id,
        ownerId: 'snapshot-n-plus-one-owner',
        now: NOW,
      }),
    ).resolves.toBe(true);
    await expect(
      prepared.listProtectedCandidateIds?.({
        campaignId: IDS.campaign,
        groupDestinationId: IDS.destination,
        instanceName: IDS.instance,
        logicalGroupFingerprint: 'persistent-inventory-group',
        scheduleRevision: 1,
        assignmentRevision: 1,
        now: NOW,
      }),
    ).resolves.not.toContain(staleFixture.candidateId);
  });

  it('descarta a primeira READY expirada e reivindica a segunda ainda materialmente válida', async () => {
    const expiredFixture = fixtures.find(({ candidateId }) =>
      candidateId.endsWith('-expiry-first-candidate'),
    );
    const validFixture = fixtures.find(({ candidateId }) =>
      candidateId.endsWith('-expiry-second-candidate'),
    );
    if (!expiredFixture || !validFixture) throw new Error('expiry fixtures missing');

    await prisma.commercialPreparedMessage.create({
      data: {
        id: `${PREFIX}-prepared-expired`,
        campaignId: IDS.campaign,
        groupDestinationId: IDS.destination,
        instanceName: IDS.instance,
        logicalGroupFingerprint: 'persistent-inventory-group',
        candidateId: expiredFixture.candidateId,
        snapshotId: expiredFixture.snapshotId,
        generatedCopyId: expiredFixture.copyId,
        copyPreview: 'Oferta https://example.invalid/affiliate',
        status: 'READY',
        scheduleRevision: 1,
        assignmentRevision: 1,
        expiresAt: NOW,
        offerEndsAt: null,
        createdAt: new Date(NOW.getTime() - 1_000),
        updatedAt: new Date(NOW.getTime() - 1_000),
      },
    });
    const valid = await prepared.createReady({
      campaignId: IDS.campaign,
      groupDestinationId: IDS.destination,
      instanceName: IDS.instance,
      logicalGroupFingerprint: 'persistent-inventory-group',
      candidateId: validFixture.candidateId,
      generatedCopyId: validFixture.copyId,
      copyPreview: 'Oferta https://example.invalid/affiliate',
      scheduleRevision: 1,
      assignmentRevision: 1,
      expiresAt: new Date(NOW.getTime() + 30 * 60_000),
      now: NOW,
    });
    expect(valid).toMatchObject({ status: 'READY', candidateId: validFixture.candidateId });
    await expect(
      prepared.invalidateStale({ now: NOW, limit: 10 }),
    ).resolves.toBe(1);
    expect(
      await prisma.commercialPreparedMessage.findUnique({
        where: { id: `${PREFIX}-prepared-expired` },
        select: { status: true, invalidatedReason: true },
      }),
    ).toEqual({ status: 'INVALIDATED', invalidatedReason: 'PREPARED_EXPIRED' });
    expect(
      await prisma.commercialPromotionCandidate.findUnique({
        where: { id: expiredFixture.candidateId },
        select: { status: true },
      }),
    ).toEqual({ status: 'EXPIRED' });
    await expect(
      prepared.countReady({
        campaignId: IDS.campaign,
        groupDestinationId: IDS.destination,
        instanceName: IDS.instance,
        logicalGroupFingerprint: 'persistent-inventory-group',
        scheduleRevision: 1,
        assignmentRevision: 1,
        now: NOW,
      }),
    ).resolves.toBe(1);
    const claimed = await prepared.claimReady({
      campaignId: IDS.campaign,
      groupDestinationId: IDS.destination,
      instanceName: IDS.instance,
      logicalGroupFingerprint: 'persistent-inventory-group',
      scheduleRevision: 1,
      assignmentRevision: 1,
      ownerId: 'expiry-owner',
      now: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + 60_000),
    });
    expect(claimed?.candidateId).toBe(validFixture.candidateId);
  });

  it('reminera e reprepara automaticamente um candidate após a invalidação do snapshot', async () => {
    const fixture = fixtures.find(({ candidateId }) =>
      candidateId.endsWith('-reprepare-candidate'),
    );
    if (!fixture) throw new Error('reprepare fixture missing');

    const preparedBeforeChange = await prepared.createReady({
      campaignId: REPREPARE.campaign,
      groupDestinationId: REPREPARE.destination,
      instanceName: REPREPARE.instance,
      logicalGroupFingerprint: REPREPARE.fingerprint,
      candidateId: fixture.candidateId,
      generatedCopyId: fixture.copyId,
      copyPreview: 'Oferta https://s.shopee.com.br/fixture-affiliate',
      scheduleRevision: 1,
      assignmentRevision: 1,
      expiresAt: new Date(NOW.getTime() + 30 * 60_000),
      now: NOW,
    });
    expect(preparedBeforeChange).toMatchObject({
      status: 'READY',
      snapshotId: fixture.snapshotId,
      generatedCopyId: fixture.copyId,
    });

    const nextSnapshotId = `${PREFIX}-reprepare-snapshot-2`;
    const nextProductFingerprint = fingerprintCommercialOffer({
      source: 'OFFICIAL',
      providerProductId: `${PREFIX}-reprepare-provider`,
      productLink: 'https://shopee.com.br/product/fixture/123',
      affiliateLink: 'https://s.shopee.com.br/fixture-affiliate',
      price: '89.9',
      priceMin: '89.9',
      priceMax: '89.9',
      discountRate: 25,
      commissionRate: 10,
      offerStartsAt: null,
      offerEndsAt: null,
      unavailableAt: null,
    });
    await prisma.commercialOfferSnapshot.create({
      data: {
        id: nextSnapshotId,
        productId: fixture.productId,
        revision: 2,
        fingerprint: nextProductFingerprint,
        price: 89.9,
        discountRate: 25,
        commissionRate: 10,
        observedRating: 4.8,
        observedSales: 100,
        capturedAt: new Date(NOW.getTime() + 1_000),
      },
    });
    await prisma.productLead.update({
      where: { id: fixture.productId },
      data: {
        preco: 89.9,
        precoMin: 89.9,
        precoMax: 89.9,
        desconto: 25,
        commercialSnapshotRevision: 2,
        commercialSnapshotFingerprint: nextProductFingerprint,
      },
    });

    await expect(
      prepared.invalidateStale({ now: NOW, limit: 10 }),
    ).resolves.toBe(1);
    expect(
      await prisma.commercialPromotionCandidate.findUnique({
        where: { id: fixture.candidateId },
        select: { status: true, snapshotId: true, generatedCopyId: true },
      }),
    ).toEqual({
      status: 'BLOCKED',
      snapshotId: fixture.snapshotId,
      generatedCopyId: fixture.copyId,
    });

    const previousSettings =
      await prisma.commercialAutomationSettings.findUnique({
        where: { id: 'commercial-automation' },
      });
    await prisma.commercialAutomationSettings.upsert({
      where: { id: 'commercial-automation' },
      create: {
        id: 'commercial-automation',
        paused: false,
        pausedAt: null,
        resumedAt: NOW,
        preparedLowWatermark: 1,
        preparedTarget: 1,
        usableCandidateLowWatermark: 1,
        usableCandidateTarget: 1,
        discoveryPagesPerRun: 1,
        discoveryRefreshCooldownMinutes: 60,
        scheduleRevision: 1,
      },
      update: {
        paused: false,
        pausedAt: null,
        resumedAt: NOW,
        preparedLowWatermark: 1,
        preparedTarget: 1,
        usableCandidateLowWatermark: 1,
        usableCandidateTarget: 1,
        discoveryPagesPerRun: 1,
        discoveryRefreshCooldownMinutes: 60,
        scheduleRevision: 1,
      },
    });

    try {
      const mining = createCommercialPromotionMiningService({
        repositories,
        score: { calculate: () => 0 },
        logger: { info: () => undefined },
        clock: () => NOW,
      });
      const copyGeneration = createCommercialPromotionCopyGenerationService({
        repositories,
        config: {
          enabled: false,
          provider: 'openai',
          model: null,
          apiKeyConfigured: false,
          timeoutMs: 30_000,
          maxOutputTokens: 300,
          reasoningEffort: 'minimal',
          maximumCopyLength: 1_000,
        },
        logger: { info: () => undefined, error: () => undefined },
        clock: () => NOW,
      });
      const reprepareGroup = await repositories.whatsappGroups.findById(
        REPREPARE.destination,
      );
      if (!reprepareGroup) throw new Error('reprepare group missing');
      const candidateFlow = new CommercialAutomationCandidateFlowService({
        groups: {
          list: async () => [reprepareGroup],
          listAll: async () => [reprepareGroup],
        },
        instances: repositories.whatsappInstances,
        campaigns: repositories.commercialGroupCampaigns,
        candidates: repositories.commercialPromotions,
        deliveryHistory: repositories.commercialDeliveryHistory,
        copies: repositories.commercialPromotionCopies,
        mining,
        copyGeneration,
        draft: new CommercialMessageDraftService(),
        pipeline: {
          dryRunFromPromotionCandidate: async () => {
            throw new Error('pipeline must not be called by prepareInventory');
          },
        },
        instanceName: REPREPARE.instance,
        clock: () => NOW,
      });
      const syncOffers = {
        run: vi.fn(async () => ({
          fetched: 0,
          created: 0,
          hasNextPage: false,
        })),
      };
      const supervisor = new CommercialInventorySupervisor({
        candidateFlow,
        preparedMessages: prepared,
        checkpoints,
        settings: repositories.commercialAutomationSettings,
        niches: repositories.commercialNiches,
        syncOffers,
        logger: { info: () => undefined, error: () => undefined },
        clock: () => NOW,
      });

      const preview = await mining.preview(REPREPARE.campaign, {});
      expect(preview.projectedCandidates).toHaveLength(1);
      const report = await supervisor.run({
        mode: 'send',
        provider: 'official',
      });
      expect(report).toMatchObject({
        targets: 1,
        mined: 1,
        preparedMessages: 1,
        preparedReady: 1,
        fetchedProducts: 0,
      });
      expect(syncOffers.run).not.toHaveBeenCalled();

      const preparedRows = await prisma.commercialPreparedMessage.findMany({
        where: { campaignId: REPREPARE.campaign },
        orderBy: { createdAt: 'asc' },
        select: {
          status: true,
          snapshotId: true,
          generatedCopyId: true,
          invalidatedReason: true,
        },
      });
      expect(preparedRows).toHaveLength(2);
      expect(preparedRows[0]).toEqual({
        status: 'INVALIDATED',
        snapshotId: fixture.snapshotId,
        generatedCopyId: fixture.copyId,
        invalidatedReason: 'SNAPSHOT_OR_COPY_STALE',
      });
      expect(preparedRows[1]).toMatchObject({
        status: 'READY',
        snapshotId: nextSnapshotId,
        invalidatedReason: null,
      });
      expect(typeof preparedRows[1]?.generatedCopyId).toBe('string');
      const candidate = await prisma.commercialPromotionCandidate.findUnique({
        where: { id: fixture.candidateId },
        select: { status: true, snapshotId: true, generatedCopyId: true },
      });
      expect(candidate).toMatchObject({
        status: 'COPY_READY',
        snapshotId: nextSnapshotId,
      });
      expect(candidate?.generatedCopyId).not.toBe(fixture.copyId);
      expect(
        await prisma.commercialCopyGenerationAttempt.count({
          where: { candidateId: fixture.candidateId, snapshotId: nextSnapshotId },
        }),
      ).toBe(1);
    } finally {
      if (previousSettings) {
        await prisma.commercialAutomationSettings.update({
          where: { id: 'commercial-automation' },
          data: {
            paused: previousSettings.paused,
            pausedAt: previousSettings.pausedAt,
            resumedAt: previousSettings.resumedAt,
            allowedStartTime: previousSettings.allowedStartTime,
            allowedEndTime: previousSettings.allowedEndTime,
            timezone: previousSettings.timezone,
            minimumIntervalMinutes: previousSettings.minimumIntervalMinutes,
            staggerMinutes: previousSettings.staggerMinutes,
            dailyGlobalLimit: previousSettings.dailyGlobalLimit,
            dailyGroupLimit: previousSettings.dailyGroupLimit,
            dailyShopeeHttpLimit: previousSettings.dailyShopeeHttpLimit,
            dailyOpenAiGenerationLimit:
              previousSettings.dailyOpenAiGenerationLimit,
            usableCandidateLowWatermark:
              previousSettings.usableCandidateLowWatermark,
            usableCandidateTarget: previousSettings.usableCandidateTarget,
            preparedLowWatermark: previousSettings.preparedLowWatermark,
            preparedTarget: previousSettings.preparedTarget,
            discoveryPagesPerRun: previousSettings.discoveryPagesPerRun,
            discoveryRefreshCooldownMinutes:
              previousSettings.discoveryRefreshCooldownMinutes,
            scheduleRevision: previousSettings.scheduleRevision,
          },
        });
      } else {
        await prisma.commercialAutomationSettings.deleteMany({
          where: { id: 'commercial-automation' },
        });
      }
    }
  });
});
