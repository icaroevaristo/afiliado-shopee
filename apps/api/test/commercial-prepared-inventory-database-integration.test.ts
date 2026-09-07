import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';

import {
  PrismaCommercialDiscoveryCheckpointRepository,
  PrismaCommercialPreparedMessageRepository,
} from '../src/prisma-repositories';
import {
  COMMERCIAL_AI_COPY_PROMPT_VERSION,
  COMMERCIAL_AI_COPY_VALIDATION_VERSION,
} from '../src/commercial-ai-copy-prompt';

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

type Fixture = {
  productId: string;
  snapshotId: string;
  candidateId: string;
  copyId: string;
  runId: string;
};

describeDatabase('persistent commercial inventory PostgreSQL fixture', () => {
  const prisma = createPrismaClient();
  const checkpoints = new PrismaCommercialDiscoveryCheckpointRepository(prisma);
  const prepared = new PrismaCommercialPreparedMessageRepository(prisma);
  const fixtures: Fixture[] = [];

  const removeFixtures = async () => {
    await prisma.commercialPreparedMessage.deleteMany({
      where: { campaignId: IDS.campaign },
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
      where: { name: IDS.instance },
    });
    await prisma.commercialNiche.deleteMany({ where: { id: IDS.niche } });
  };

  const createFixture = async (name: string): Promise<Fixture> => {
    const fixture = {
      productId: `${PREFIX}-${name}-product`,
      snapshotId: `${PREFIX}-${name}-snapshot`,
      candidateId: `${PREFIX}-${name}-candidate`,
      copyId: `${PREFIX}-${name}-copy`,
      runId: `${PREFIX}-${name}-run`,
    };
    const fingerprint = `${PREFIX}-${name}-fingerprint`;
    await prisma.productLead.create({
      data: {
        id: fixture.productId,
        source: 'OFFICIAL',
        providerProductId: `${PREFIX}-${name}-provider`,
        nome: `Produto ${name}`,
        categoria: 'fixture',
        preco: 99.9,
        desconto: 20,
        nota: 4.8,
        vendidos: 100,
        comissao: 10,
        loja: 'Loja fixture',
        urlImagem: 'https://example.invalid/image',
        productLink: 'https://example.invalid/product',
        affiliateLink: 'https://example.invalid/affiliate',
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
        campaignId: IDS.campaign,
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
        groupDestinationId: IDS.destination,
        instanceName: IDS.instance,
        productName: `Produto ${name}`,
        productPrice: 99.9,
        groupName: 'Grupo fixture',
        groupFingerprint: 'persistent-inventory-group',
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
    await createFixture('claim');
    await createFixture('recovery');
    await createFixture('effect');
    await createFixture('stale');
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
  });
});
