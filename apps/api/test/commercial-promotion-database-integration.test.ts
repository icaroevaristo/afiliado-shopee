import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';

import { createCommercialPromotionMiningDomainService } from '../src/commercial-promotion-mining-service';
import { fingerprintCommercialOffer } from '../src/commercial-offer-snapshot';
import {
  PrismaCommercialGroupCampaignRepository,
  PrismaCommercialNicheRepository,
  PrismaCommercialPromotionRepository,
} from '../src/prisma-repositories';

const enabled = process.env.RUN_COMMERCIAL_PROMOTION_DB_TEST === 'true';
const describeDatabase = enabled ? describe : describe.skip;
const NOW = new Date('2026-07-29T15:00:00.000Z');
const IDS = {
  niche: 'promotion-fixture-niche',
  campaign: 'promotion-fixture-campaign',
  destination: 'promotion-fixture-destination',
  productA: 'promotion-fixture-product-a',
  productB: 'promotion-fixture-product-b',
  productC: 'promotion-fixture-product-c',
};

const fingerprintFor = (id: string, discountRate: number) =>
  fingerprintCommercialOffer({
    source: 'OFFICIAL',
    providerProductId: `provider-${id}`,
    productLink: `https://shopee.com.br/product/1/${id}`,
    affiliateLink: `https://s.shopee.com.br/affiliate-${id}`,
    price: '80',
    priceMin: '80',
    priceMax: '80',
    discountRate,
    commissionRate: 20,
    offerStartsAt: null,
    offerEndsAt: null,
    unavailableAt: null,
  });

describeDatabase('commercial promotion database fixture', () => {
  const prisma = createPrismaClient();
  const promotions = new PrismaCommercialPromotionRepository(prisma);
  const service = createCommercialPromotionMiningDomainService({
    campaigns: new PrismaCommercialGroupCampaignRepository(prisma),
    niches: new PrismaCommercialNicheRepository(prisma),
    promotions,
    score: { calculate: () => 0 },
    clock: () => NOW,
  });

  const createProduct = async ({
    id,
    discountRate,
    createdAt,
    revision,
    fingerprint,
  }: {
    id: string;
    discountRate: number;
    createdAt: Date;
    revision: number;
    fingerprint: string;
  }) =>
    prisma.productLead.create({
      data: {
        id,
        source: 'OFFICIAL',
        providerProductId: `provider-${id}`,
        nome: `Produto ${id}`,
        categoria: 'fixture',
        preco: 80,
        precoMin: 80,
        precoMax: 80,
        desconto: discountRate,
        nota: 5,
        vendidos: 10_000,
        comissao: 20,
        loja: 'Loja fixture',
        categoryIds: ['fixture'],
        urlImagem: 'https://example.invalid/image',
        productLink: `https://shopee.com.br/product/1/${id}`,
        affiliateLink: `https://s.shopee.com.br/affiliate-${id}`,
        fetchedAt: createdAt,
        lastSeenAt: createdAt,
        commercialSnapshotRevision: revision,
        commercialSnapshotFingerprint: fingerprint,
        title: `Produto ${id}`,
        createdAt,
      },
    });

  beforeAll(async () => {
    await prisma.commercialNiche.create({
      data: {
        id: IDS.niche,
        name: 'Fixture',
        slug: 'promotion-fixture',
        active: true,
        categoryIds: ['fixture'],
        minDiscountRate: 0,
        minimumScore: 0,
      },
    });
    await prisma.whatsAppInstance.create({
      data: { name: 'fixture-instance', active: true },
    });
    await prisma.whatsAppDestination.create({
      data: {
        id: IDS.destination,
        name: 'Grupo fixture',
        destination: 'fixture@g.us',
        type: 'GROUP',
        active: true,
        available: true,
        fingerprint: 'grp_promotion_fixture',
        sourceInstanceName: 'fixture-instance',
        assignedInstanceName: 'fixture-instance',
      },
    });
    await prisma.commercialGroupCampaign.create({
      data: {
        id: IDS.campaign,
        name: 'Campanha fixture',
        logicalGroupFingerprint: 'grp_promotion_fixture',
        anchorDestinationId: IDS.destination,
        nicheId: IDS.niche,
        active: true,
        dailyLimit: 1,
        queueTargetSize: 2,
      },
    });
    await createProduct({
      id: IDS.productA,
      discountRate: 20,
      createdAt: new Date(NOW.getTime() - 60 * 60 * 1_000),
      revision: 2,
      fingerprint: fingerprintFor(IDS.productA, 20),
    });
    await createProduct({
      id: IDS.productB,
      discountRate: 10,
      createdAt: new Date(NOW.getTime() - 60 * 60 * 1_000),
      revision: 1,
      fingerprint: fingerprintFor(IDS.productB, 10),
    });
    await createProduct({
      id: IDS.productC,
      discountRate: 0,
      createdAt: new Date(NOW.getTime() - 48 * 60 * 60 * 1_000),
      revision: 1,
      fingerprint: fingerprintFor(IDS.productC, 0),
    });
    await prisma.commercialOfferSnapshot.createMany({
      data: [
        {
          id: 'promotion-fixture-snapshot-a-1',
          productId: IDS.productA,
          revision: 1,
          fingerprint: 'fingerprint-a-1',
          price: 100,
          discountRate: 10,
          commissionRate: 20,
          observedRating: 5,
          observedSales: 10_000,
          capturedAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1_000),
        },
        {
          id: 'promotion-fixture-snapshot-a-2',
          productId: IDS.productA,
          revision: 2,
          fingerprint: fingerprintFor(IDS.productA, 20),
          price: 80,
          discountRate: 20,
          commissionRate: 20,
          observedRating: 5,
          observedSales: 10_000,
          capturedAt: new Date(NOW.getTime() - 60 * 60 * 1_000),
        },
        {
          id: 'promotion-fixture-snapshot-b-1',
          productId: IDS.productB,
          revision: 1,
          fingerprint: fingerprintFor(IDS.productB, 10),
          price: 80,
          discountRate: 10,
          commissionRate: 20,
          observedRating: 5,
          observedSales: 10_000,
          capturedAt: new Date(NOW.getTime() - 60 * 60 * 1_000),
        },
        {
          id: 'promotion-fixture-snapshot-c-1',
          productId: IDS.productC,
          revision: 1,
          fingerprint: fingerprintFor(IDS.productC, 0),
          price: 80,
          discountRate: 0,
          commissionRate: 20,
          observedRating: 5,
          observedSales: 10_000,
          capturedAt: new Date(NOW.getTime() - 48 * 60 * 60 * 1_000),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.commercialPromotionCandidate.deleteMany({
      where: { campaignId: IDS.campaign },
    });
    await prisma.commercialGroupCampaign.delete({ where: { id: IDS.campaign } });
    await prisma.commercialNiche.delete({ where: { id: IDS.niche } });
    await prisma.commercialOfferSnapshot.deleteMany({
      where: { productId: { in: [IDS.productA, IDS.productB, IDS.productC] } },
    });
    await prisma.productLead.deleteMany({
      where: { id: { in: [IDS.productA, IDS.productB, IDS.productC] } },
    });
    await prisma.whatsAppDestination.delete({ where: { id: IDS.destination } });
    await prisma.whatsAppInstance.delete({ where: { name: 'fixture-instance' } });
    await prisma.$disconnect();
  });

  it('executa preview read-only e projeta dois candidatos', async () => {
    const report = await service.preview(IDS.campaign, {});
    expect(report).toMatchObject({
      preview: true,
      evaluatedCount: 3,
      evaluationTruncated: false,
      promotionMatchedCount: 2,
      queuedBefore: 0,
    });
    expect(report.projectedCandidates).toHaveLength(2);
    expect(await prisma.commercialPromotionCandidate.count()).toBe(0);
  });

  it('materializa top N e preserva o snapshot avaliado', async () => {
    const report = await service.mine(IDS.campaign, {
      confirm: 'MINERAR_PROMOCOES',
    });
    expect(report).toMatchObject({
      queuedCreated: 2,
      queuedAfter: 2,
      queueFull: true,
    });
    const rows = await prisma.commercialPromotionCandidate.findMany({
      where: { campaignId: IDS.campaign },
      orderBy: { rankPosition: 'asc' },
      include: { snapshot: true },
    });
    expect(rows.map(({ rankPosition }) => rankPosition)).toEqual([1, 2]);
    expect(rows.every(({ productId, snapshot }) => snapshot.productId === productId)).toBe(
      true,
    );
  });

  it('repete de forma idempotente sem recriar e preserva queuedAt', async () => {
    const before = await prisma.commercialPromotionCandidate.findMany({
      where: { campaignId: IDS.campaign },
      orderBy: { productId: 'asc' },
    });
    const report = await service.mine(IDS.campaign, {
      confirm: 'MINERAR_PROMOCOES',
    });
    const after = await prisma.commercialPromotionCandidate.findMany({
      where: { campaignId: IDS.campaign },
      orderBy: { productId: 'asc' },
    });
    expect(report).toMatchObject({ queuedCreated: 0, queuedUpdated: 2 });
    expect(after.map(({ id }) => id)).toEqual(before.map(({ id }) => id));
    expect(after.map(({ queuedAt }) => queuedAt)).toEqual(
      before.map(({ queuedAt }) => queuedAt),
    );
  });
});
