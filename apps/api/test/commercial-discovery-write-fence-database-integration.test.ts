import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ShopeeProductOffer } from '@shopee-auto-affiliate-ai/providers';
import { createPrismaClient } from '@shopee-auto-affiliate-ai/database';

import {
  PrismaCommercialDiscoveryCheckpointRepository,
  PrismaShopeeOfferRepository,
} from '../src/prisma-repositories';
import { fingerprintCommercialOffer } from '../src/commercial-offer-snapshot';

const enabled = process.env.RUN_COMMERCIAL_DISCOVERY_FENCE_DB_TEST === 'true';
const describeDatabase = enabled ? describe : describe.skip;
const PREFIX = 'discovery-fence-db-fixture';
const CHECKPOINT_IDENTITY = `${PREFIX}-identity`;
const EXPIRY_CHECKPOINT_IDENTITY = `${PREFIX}-expiry-identity`;
const CROSS_QUERY_NEW_IDENTITY = `${PREFIX}-cross-new-identity`;
const CROSS_QUERY_OLD_IDENTITY = `${PREFIX}-cross-old-identity`;
const CAMPAIGN_ID = `${PREFIX}-campaign`;
const NICHE_ID = `${PREFIX}-niche`;
const PRODUCT_PROVIDER_ID = `${PREFIX}-provider`;
const CATEGORY_ID = `${PREFIX}-category`;
const NOW = new Date();

const offer = (price: string, fetchedAt: Date): ShopeeProductOffer => {
  const productLink = `https://shopee.com.br/product/1/${PREFIX}`;
  const affiliateLink = `https://s.shopee.com.br/${PREFIX}`;
  return {
    source: 'OFFICIAL',
    providerProductId: `${PREFIX}-provider`,
    productName: 'Produto fenced',
    shopId: `${PREFIX}-shop`,
    shopName: 'Loja fenced',
    categoryIds: [CATEGORY_ID],
    price,
    priceMin: price,
    priceMax: price,
    discountRate: 20,
    rating: 4.8,
    sales: 100,
    commissionRate: 10,
    imageUrl: 'https://example.invalid/fenced.jpg',
    productLink,
    affiliateLink,
    fetchedAt,
  };
};

describeDatabase('commercial discovery write fence PostgreSQL fixture', () => {
  const prisma = createPrismaClient();
  const checkpoints = new PrismaCommercialDiscoveryCheckpointRepository(prisma);
  const offers = new PrismaShopeeOfferRepository(prisma);

  const removeFixtures = async () => {
    await prisma.commercialDiscoveryCheckpoint.deleteMany({
      where: { identityFingerprint: { startsWith: PREFIX } },
    });
    const products = await prisma.productLead.findMany({
      where: { source: 'OFFICIAL', providerProductId: PRODUCT_PROVIDER_ID },
      select: { id: true },
    });
    const productIds = products.map((product) => product.id);
    if (productIds.length > 0) {
      await prisma.commercialOfferSnapshot.deleteMany({
        where: { productId: { in: productIds } },
      });
      await prisma.productLead.deleteMany({ where: { id: { in: productIds } } });
    }
    await prisma.shopeeCategory.deleteMany({ where: { id: CATEGORY_ID } });
    await prisma.commercialGroupCampaign.deleteMany({ where: { id: CAMPAIGN_ID } });
    await prisma.commercialNiche.deleteMany({ where: { id: NICHE_ID } });
  };

  beforeAll(async () => {
    await removeFixtures();
    await prisma.commercialNiche.create({
      data: { id: NICHE_ID, name: 'Fenced', slug: NICHE_ID, active: true },
    });
    await prisma.commercialGroupCampaign.create({
      data: {
        id: CAMPAIGN_ID,
        name: 'Fenced campaign',
        logicalGroupFingerprint: `${PREFIX}-group`,
        nicheId: NICHE_ID,
        active: true,
      },
    });
  });

  afterAll(async () => {
    await removeFixtures();
    await prisma.$disconnect();
  });

  it('rejeita owner stale antes de persistir e permite replay do owner novo sem duplicar revision', async () => {
    const leaseA = await checkpoints.acquire({
      identityFingerprint: CHECKPOINT_IDENTITY,
      source: 'OFFICIAL',
      campaignId: CAMPAIGN_ID,
      nicheId: NICHE_ID,
      query: { categoryId: CATEGORY_ID, sort: 'commission_desc' },
      ownerId: `${PREFIX}-owner-a`,
      now: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + 60_000),
    });
    if (!leaseA) throw new Error('lease A missing');

    const ownerBNow = new Date(NOW.getTime() + 120_000);
    const leaseB = await checkpoints.acquire({
      identityFingerprint: CHECKPOINT_IDENTITY,
      source: 'OFFICIAL',
      campaignId: CAMPAIGN_ID,
      nicheId: NICHE_ID,
      query: { categoryId: CATEGORY_ID, sort: 'commission_desc' },
      ownerId: `${PREFIX}-owner-b`,
      now: ownerBNow,
      leaseExpiresAt: new Date(ownerBNow.getTime() + 120_000),
    });
    expect(leaseB).toMatchObject({
      id: leaseA.id,
      leaseOwnerId: `${PREFIX}-owner-b`,
      leaseRevision: leaseA.leaseRevision + 1,
    });
    if (!leaseB) throw new Error('lease B missing');

    const currentOffer = offer('20.00', ownerBNow);
    const currentFingerprint = fingerprintCommercialOffer({
      source: 'OFFICIAL',
      providerProductId: currentOffer.providerProductId,
      productLink: currentOffer.productLink ?? null,
      affiliateLink: currentOffer.affiliateLink ?? null,
      price: currentOffer.price,
      priceMin: currentOffer.priceMin,
      priceMax: currentOffer.priceMax,
      discountRate: currentOffer.discountRate,
      commissionRate: currentOffer.commissionRate,
      offerStartsAt: currentOffer.offerStartsAt,
      offerEndsAt: currentOffer.offerEndsAt,
      unavailableAt: null,
    });
    await expect(
      offers.upsertOfficialOfferWithSnapshot(currentOffer, {
        checkpointId: leaseB.id,
        ownerId: `${PREFIX}-owner-b`,
        leaseRevision: leaseB.leaseRevision,
        now: ownerBNow,
      }),
    ).resolves.toMatchObject({ snapshotRevision: 1, snapshotCreated: true });

    await expect(
      offers.upsertOfficialOfferWithSnapshot(offer('10.00', NOW), {
        checkpointId: leaseA.id,
        ownerId: `${PREFIX}-owner-a`,
        leaseRevision: leaseA.leaseRevision,
        now: ownerBNow,
      }),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_DISCOVERY_CHECKPOINT_FENCE_LOST',
    });
    const persistedProduct = await prisma.productLead.findUnique({
      where: {
        source_providerProductId: {
          source: 'OFFICIAL',
          providerProductId: PRODUCT_PROVIDER_ID,
        },
      },
      select: {
        id: true,
        preco: true,
        commercialSnapshotRevision: true,
        commercialSnapshotFingerprint: true,
      },
    });
    if (!persistedProduct) throw new Error('persisted product missing');
    expect(persistedProduct.preco.toString()).toBe('20');
    expect(persistedProduct).toMatchObject({
      commercialSnapshotRevision: 1,
      commercialSnapshotFingerprint: currentFingerprint,
    });
    expect(
      await prisma.commercialOfferSnapshot.count({
        where: { productId: persistedProduct.id },
      }),
    ).toBe(1);

    const advanced = await checkpoints.advance({
      id: leaseB.id,
      ownerId: `${PREFIX}-owner-b`,
      leaseRevision: leaseB.leaseRevision,
      now: new Date(ownerBNow.getTime() + 1_000),
      leaseExpiresAt: new Date(ownerBNow.getTime() + 120_000),
      page: 2,
      cursor: 'page-2',
      hasNextPage: true,
      fetchedProducts: 1,
      nextRefreshAt: null,
    });
    expect(advanced).toMatchObject({
      page: 2,
      cursor: 'page-2',
      leaseOwnerId: `${PREFIX}-owner-b`,
      leaseRevision: leaseB.leaseRevision,
    });

    await expect(
      offers.upsertOfficialOfferWithSnapshot(offer('20.0000', new Date(ownerBNow.getTime() + 2_000)), {
        checkpointId: leaseB.id,
        ownerId: `${PREFIX}-owner-b`,
        leaseRevision: leaseB.leaseRevision,
        now: new Date(ownerBNow.getTime() + 2_000),
      }),
    ).resolves.toMatchObject({ snapshotRevision: 1, snapshotCreated: false });
    expect(
      await prisma.commercialOfferSnapshot.count({
        where: { productId: persistedProduct.id },
      }),
    ).toBe(1);
    expect(
      await prisma.commercialDiscoveryCheckpoint.findUnique({
        where: { id: leaseB.id },
        select: { page: true, cursor: true, leaseOwnerId: true, leaseRevision: true },
      }),
    ).toEqual({
      page: 2,
      cursor: 'page-2',
      leaseOwnerId: `${PREFIX}-owner-b`,
      leaseRevision: leaseB.leaseRevision,
    });
  });

  it('ignora observacao antiga de outra query quando ambas as leases continuam validas', async () => {
    const leaseNow = new Date(NOW.getTime() + 180_000);
    const leaseExpiresAt = new Date(leaseNow.getTime() + 600_000);
    const newLease = await checkpoints.acquire({
      identityFingerprint: CROSS_QUERY_NEW_IDENTITY,
      source: 'OFFICIAL',
      campaignId: CAMPAIGN_ID,
      nicheId: NICHE_ID,
      query: { categoryId: CATEGORY_ID, sort: 'commission_desc' },
      ownerId: `${PREFIX}-cross-new-owner`,
      now: leaseNow,
      leaseExpiresAt,
    });
    const oldLease = await checkpoints.acquire({
      identityFingerprint: CROSS_QUERY_OLD_IDENTITY,
      source: 'OFFICIAL',
      campaignId: CAMPAIGN_ID,
      nicheId: NICHE_ID,
      query: { categoryId: CATEGORY_ID, sort: 'sales_desc' },
      ownerId: `${PREFIX}-cross-old-owner`,
      now: leaseNow,
      leaseExpiresAt,
    });
    if (!newLease || !oldLease) throw new Error('cross-query lease missing');

    const newestObservedAt = new Date(NOW.getTime() + 240_000);
    const olderObservedAt = new Date(NOW.getTime() + 210_000);
    await expect(
      offers.upsertOfficialOfferWithSnapshot(
        offer('40.00', newestObservedAt),
        {
          checkpointId: newLease.id,
          ownerId: `${PREFIX}-cross-new-owner`,
          leaseRevision: newLease.leaseRevision,
          now: newestObservedAt,
        },
      ),
    ).resolves.toMatchObject({
      snapshotRevision: 2,
      snapshotCreated: true,
    });
    await expect(
      offers.upsertOfficialOfferWithSnapshot(
        offer('10.00', olderObservedAt),
        {
          checkpointId: oldLease.id,
          ownerId: `${PREFIX}-cross-old-owner`,
          leaseRevision: oldLease.leaseRevision,
          now: newestObservedAt,
        },
      ),
    ).resolves.toMatchObject({
      snapshotRevision: 2,
      commercialStateChanged: false,
      snapshotCreated: false,
    });

    const persistedProduct = await prisma.productLead.findUnique({
      where: {
        source_providerProductId: {
          source: 'OFFICIAL',
          providerProductId: PRODUCT_PROVIDER_ID,
        },
      },
      select: {
        preco: true,
        fetchedAt: true,
        commercialSnapshotRevision: true,
      },
    });
    if (!persistedProduct) throw new Error('cross-query product missing');
    expect(persistedProduct.fetchedAt).toEqual(newestObservedAt);
    expect(persistedProduct.commercialSnapshotRevision).toBe(2);
    expect(persistedProduct?.preco.toString()).toBe('40');
    const snapshots = await prisma.commercialOfferSnapshot.findMany({
      where: {
        product: {
          source: 'OFFICIAL',
          providerProductId: PRODUCT_PROVIDER_ID,
        },
      },
      orderBy: { revision: 'asc' },
      select: { revision: true, price: true, capturedAt: true },
    });
    expect(snapshots.map((snapshot) => ({
      revision: snapshot.revision,
      price: snapshot.price.toString(),
      capturedAt: snapshot.capturedAt,
    }))).toEqual([
      expect.objectContaining({ revision: 1, price: '20' }),
      expect.objectContaining({
        revision: 2,
        price: '40',
        capturedAt: newestObservedAt,
      }),
    ]);
    const checkpointsState = await prisma.commercialDiscoveryCheckpoint.findMany({
      where: { id: { in: [newLease.id, oldLease.id] } },
      orderBy: { identityFingerprint: 'asc' },
      select: {
        id: true,
        identityFingerprint: true,
        leaseOwnerId: true,
        leaseRevision: true,
        leaseExpiresAt: true,
        status: true,
        page: true,
        cursor: true,
      },
    });
    expect(checkpointsState).toEqual([
      expect.objectContaining({
        id: newLease.id,
        identityFingerprint: CROSS_QUERY_NEW_IDENTITY,
        leaseOwnerId: `${PREFIX}-cross-new-owner`,
        leaseRevision: newLease.leaseRevision,
        status: 'ACTIVE',
        page: 1,
        cursor: null,
      }),
      expect.objectContaining({
        id: oldLease.id,
        identityFingerprint: CROSS_QUERY_OLD_IDENTITY,
        leaseOwnerId: `${PREFIX}-cross-old-owner`,
        leaseRevision: oldLease.leaseRevision,
        status: 'ACTIVE',
        page: 1,
        cursor: null,
      }),
    ]);
  });

  it('rejeita a escrita quando o lease expira durante a janela externa mesmo com now antigo', async () => {
    const fenceNow = new Date();
    const leaseExpiresAt = new Date(fenceNow.getTime() + 100);
    const lease = await checkpoints.acquire({
      identityFingerprint: EXPIRY_CHECKPOINT_IDENTITY,
      source: 'OFFICIAL',
      campaignId: CAMPAIGN_ID,
      nicheId: NICHE_ID,
      query: { categoryId: CATEGORY_ID, sort: 'commission_desc' },
      ownerId: `${PREFIX}-expiry-owner`,
      now: fenceNow,
      leaseExpiresAt,
    });
    if (!lease) throw new Error('expiry lease missing');
    const before = await prisma.productLead.findUnique({
      where: {
        source_providerProductId: {
          source: 'OFFICIAL',
          providerProductId: PRODUCT_PROVIDER_ID,
        },
      },
      select: { preco: true, commercialSnapshotRevision: true },
    });

    await new Promise((resolve) => setTimeout(resolve, 250));

    await expect(
      offers.upsertOfficialOfferWithSnapshot(offer('30.00', new Date(fenceNow.getTime() + 1)), {
        checkpointId: lease.id,
        ownerId: `${PREFIX}-expiry-owner`,
        leaseRevision: lease.leaseRevision,
        now: fenceNow,
      }),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_DISCOVERY_CHECKPOINT_FENCE_LOST',
    });
    const after = await prisma.productLead.findUnique({
      where: {
        source_providerProductId: {
          source: 'OFFICIAL',
          providerProductId: PRODUCT_PROVIDER_ID,
        },
      },
      select: { preco: true, commercialSnapshotRevision: true },
    });
    expect(after).toEqual(before);
  });
});
