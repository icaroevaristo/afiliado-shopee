/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma test double mirrors the generated client's dynamic delegate surface. */
import { describe, expect, it } from 'vitest';

import { PrismaCommercialPromotionRepository } from '../src/prisma-repositories';
import type {
  CommercialPromotionCandidateRecord,
  CommercialPromotionMaterializationInput,
  CommercialPromotionRankedCandidate,
} from '../src/repositories';

const NOW = new Date('2026-07-29T15:00:00.000Z');

type State = {
  campaigns: any[];
  groups: any[];
  products: any[];
  snapshots: any[];
  candidates: any[];
  dispatches: any[];
};

const product = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  source: 'OFFICIAL',
  providerProductId: `external-${id}`,
  nome: `Produto ${id}`,
  categoria: 'cat',
  preco: '80',
  precoMin: '80',
  precoMax: '80',
  desconto: 20,
  nota: 4.8,
  vendidos: 500,
  comissao: 10,
  commissionAmount: null,
  sellerCommissionRate: null,
  shopeeCommissionRate: null,
  loja: 'Loja',
  shopId: `shop-${id}`,
  shopType: [],
  categoryIds: ['cat'],
  urlImagem: 'https://example.invalid/image',
  productLink: 'https://example.invalid/product',
  affiliateLink: 'https://example.invalid/affiliate',
  offerStartsAt: null,
  offerEndsAt: null,
  fetchedAt: NOW,
  lastSeenAt: NOW,
  unavailableAt: null,
  commercialSnapshotRevision: 1,
  commercialSnapshotFingerprint: `fingerprint-${id}`,
  title: `Produto ${id}`,
  score: null,
  scoreUpdatedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const snapshot = (id: string) => ({
  id: `snapshot-${id}`,
  productId: id,
  revision: 1,
  fingerprint: `fingerprint-${id}`,
  price: '80',
  priceMin: '80',
  priceMax: '80',
  discountRate: 20,
  commissionRate: 10,
  observedRating: 4.8,
  observedSales: 500,
  offerStartsAt: null,
  offerEndsAt: null,
  unavailableAt: null,
  capturedAt: NOW,
  createdAt: NOW,
});

const campaign = (id: string, nicheId: string, queueTargetSize = 2) => ({
  id,
  nicheId,
  logicalGroupFingerprint: `grp-${id}`,
  active: true,
  queueTargetSize,
  updatedAt: NOW,
  niche: { id: nicheId, active: true, updatedAt: NOW },
});

const candidate = (
  campaignId: string,
  productId: string,
  overrides: Record<string, unknown> = {},
) => ({
  id: `candidate-${campaignId}-${productId}`,
  campaignId,
  productId,
  snapshotId: `snapshot-${productId}`,
  status: 'QUEUED',
  rankPosition: 1,
  commercialScore: 70,
  scorePolicyVersion: 'official-v2',
  minimumScoreUsed: 60,
  scoreBreakdown: {
    policyVersion: 'official-v2',
    rawTotal: 70,
    finalScore: 70,
    components: {},
  },
  promotionSignals: ['CURRENT_DISCOUNT'],
  priceDropPercent: null,
  queuedAt: new Date('2026-07-29T14:00:00.000Z'),
  lastEvaluatedAt: new Date('2026-07-29T14:00:00.000Z'),
  expiresAt: null,
  dedupeUntil: null,
  blockedReason: null,
  createdAt: new Date('2026-07-29T14:00:00.000Z'),
  updatedAt: new Date('2026-07-29T14:00:00.000Z'),
  ...overrides,
});

const initialState = (): State => ({
  campaigns: [campaign('campaign-1', 'niche-1')],
  groups: [
    {
      id: 'group-1',
      type: 'GROUP',
      fingerprint: 'grp-campaign-1',
      active: true,
      available: true,
      sourceInstanceName: 'instance-hidden',
    },
  ],
  products: [],
  snapshots: [],
  candidates: [],
  dispatches: [],
});

const matchesWhere = (record: any, where: any) => {
  if (!where) return true;
  for (const [key, expected] of Object.entries(where)) {
    const actual = record[key];
    if (expected === undefined) continue;
    if (expected && typeof expected === 'object' && 'in' in expected) {
      if (!(expected as any).in.includes(actual)) return false;
    } else if (expected && typeof expected === 'object' && 'gt' in expected) {
      if (!(actual > (expected as any).gt)) return false;
    } else if (expected instanceof Date) {
      if (
        !(actual instanceof Date) ||
        actual.getTime() !== expected.getTime()
      ) {
        return false;
      }
    } else if (actual !== expected) return false;
  }
  return true;
};

class PromotionPrismaFake {
  state: State;
  private readonly locks = new Set<string>();
  private sequence = 0;
  failCreateProductId: string | null = null;

  constructor(state: State) {
    this.state = structuredClone(state);
  }

  private nextUpdatedAt() {
    this.sequence += 1;
    return new Date(NOW.getTime() + this.sequence);
  }

  private relationCandidate(record: any, include: any) {
    if (!include) return structuredClone(record);
    const result = structuredClone(record);
    if (include.product) {
      const found = this.state.products.find(
        ({ id }) => id === record.productId,
      );
      result.product = include.product.select
        ? Object.fromEntries(
            Object.keys(include.product.select).map((key) => [
              key,
              found?.[key],
            ]),
          )
        : structuredClone(found);
    }
    if (include.snapshot) {
      const found = this.state.snapshots.find(
        ({ id }) => id === record.snapshotId,
      );
      result.snapshot = include.snapshot.select
        ? Object.fromEntries(
            Object.keys(include.snapshot.select).map((key) => [
              key,
              found?.[key],
            ]),
          )
        : structuredClone(found);
    }
    return result;
  }

  asClient() {
    const base: any = {};
    base.productLead = {
      findMany: async ({ where, orderBy, take, select }: any) => {
        let rows = this.state.products.filter((record) =>
          matchesWhere(record, where),
        );
        if (orderBy?.id === 'asc') {
          rows = [...rows].sort((a, b) => a.id.localeCompare(b.id));
        }
        if (take !== undefined) rows = rows.slice(0, take);
        if (select) {
          return rows.map((row) =>
            Object.fromEntries(
              Object.keys(select).map((key) => [key, row[key]]),
            ),
          );
        }
        return structuredClone(rows);
      },
    };
    base.commercialOfferSnapshot = {
      findMany: async ({ where, select }: any) => {
        let rows = this.state.snapshots.filter((record) => {
          if (where?.OR) {
            return where.OR.some((selector: any) =>
              matchesWhere(record, selector),
            );
          }
          return matchesWhere(record, where);
        });
        if (select) {
          rows = rows.map((row) =>
            Object.fromEntries(
              Object.keys(select).map((key) => [key, row[key]]),
            ),
          );
        }
        return structuredClone(rows);
      },
      groupBy: async () => {
        const maximumByProduct = new Map<string, number>();
        for (const record of this.state.snapshots) {
          const current = maximumByProduct.get(record.productId) ?? 0;
          maximumByProduct.set(record.productId, Math.max(current, record.revision));
        }
        return [...maximumByProduct].map(([productId, revision]) => ({
          productId,
          _max: { revision },
        }));
      },
    };
    base.commercialPromotionCandidate = {
      findMany: async ({ where, include }: any) =>
        this.state.candidates
          .filter((record) => matchesWhere(record, where))
          .map((record) => this.relationCandidate(record, include)),
      create: async ({ data }: any) => {
        if (data.productId === this.failCreateProductId) {
          throw new Error('simulated raw database failure');
        }
        if (
          this.state.candidates.some(
            (record) =>
              record.campaignId === data.campaignId &&
              record.productId === data.productId,
          )
        ) {
          throw { code: 'P2002' };
        }
        const created = {
          ...structuredClone(data),
          id: `created-${++this.sequence}`,
          createdAt: NOW,
          updatedAt: this.nextUpdatedAt(),
          dedupeUntil: data.dedupeUntil ?? null,
        };
        this.state.candidates.push(created);
        return structuredClone(created);
      },
      updateMany: async ({ where, data }: any) => {
        const matching = this.state.candidates.filter((record) =>
          matchesWhere(record, where),
        );
        for (const record of matching) {
          Object.assign(record, structuredClone(data), {
            updatedAt: this.nextUpdatedAt(),
          });
        }
        return { count: matching.length };
      },
      count: async ({ where }: any) =>
        this.state.candidates.filter((record) => matchesWhere(record, where))
          .length,
    };
    base.commercialGroupCampaign = {
      findUnique: async ({ where }: any) =>
        structuredClone(
          this.state.campaigns.find(({ id }) => id === where.id) ?? null,
        ),
    };
    base.whatsAppDestination = {
      findFirst: async ({ where }: any) =>
        structuredClone(
          this.state.groups.find(
            (group) =>
              group.type === where.type &&
              group.fingerprint === where.fingerprint &&
              group.active === where.active &&
              group.available === where.available &&
              group.sourceInstanceName !== null,
          ) ?? null,
        ),
    };
    base.whatsAppDispatch = {
      findMany: async ({ where }: any) =>
        this.state.dispatches
          .filter(
            (dispatch) =>
              where.productId.in.includes(dispatch.productId) &&
              dispatch.status === where.status &&
              dispatch.sentAt instanceof Date &&
              dispatch.sentAt >= where.sentAt.gte &&
              dispatch.type === where.destination.type &&
              dispatch.fingerprint === where.destination.fingerprint,
          )
          .map(({ productId }) => ({ productId })),
      findFirst: async ({ where }: any) =>
        structuredClone(
          this.state.dispatches.find(
            (dispatch) =>
              where.productId.in.includes(dispatch.productId) &&
              dispatch.status === where.status &&
              dispatch.sentAt instanceof Date &&
              dispatch.sentAt >= where.sentAt.gte &&
              dispatch.type === where.destination.type &&
              dispatch.fingerprint === where.destination.fingerprint,
          ) ?? null,
        ),
    };
    base.$transaction = async (
      callback: (transaction: any) => Promise<any>,
    ) => {
      const before = structuredClone(this.state);
      let lockedCampaign: string | null = null;
      const transaction = {
        ...base,
        $queryRaw: async (
          _strings: TemplateStringsArray,
          campaignId: string,
        ) => {
          if (this.locks.has(campaignId)) {
            throw { code: 'P2010', meta: { code: '55P03' } };
          }
          this.locks.add(campaignId);
          lockedCampaign = campaignId;
          await Promise.resolve();
          return this.state.campaigns.some(({ id }) => id === campaignId)
            ? [{ id: campaignId }]
            : [];
        },
      };
      try {
        return await callback(transaction);
      } catch (error) {
        this.state = before;
        throw error;
      } finally {
        if (lockedCampaign) this.locks.delete(lockedCampaign);
      }
    };
    return base;
  }
}

const ranked = (
  productId: string,
  existing: CommercialPromotionCandidateRecord | null = null,
): CommercialPromotionRankedCandidate => ({
  productId,
  snapshotId: `snapshot-${productId}`,
  snapshotRevision: 1,
  snapshotFingerprint: `fingerprint-${productId}`,
  expectedProductUpdatedAt: NOW,
  commercialScore: 70,
  scorePolicyVersion: 'official-v2',
  minimumScoreUsed: 60,
  scoreBreakdown: {
    policyVersion: 'official-v2',
    rawTotal: 70,
    finalScore: 70,
    components: {},
  },
  promotionSignals: ['CURRENT_DISCOUNT'],
  priceDropPercent: null,
  discountRate: 20,
  commissionRate: 10,
  sales: 500,
  expiresAt: null,
  expectedCandidateStatus: existing?.status ?? null,
  expectedDedupeUntil: existing?.dedupeUntil ?? null,
  expectedCandidateUpdatedAt: existing?.updatedAt ?? null,
});

const materializationInput = (
  rankedCandidates: CommercialPromotionRankedCandidate[],
  overrides: Partial<CommercialPromotionMaterializationInput> = {},
): CommercialPromotionMaterializationInput => ({
  campaignId: 'campaign-1',
  expectedCampaignUpdatedAt: NOW,
  nicheId: 'niche-1',
  expectedNicheUpdatedAt: NOW,
  logicalGroupFingerprint: 'grp-campaign-1',
  dedupeSince: new Date('2026-06-29T15:00:00.000Z'),
  now: NOW,
  rankedCandidates,
  ...overrides,
});

const addProducts = (state: State, ...ids: string[]) => {
  state.products.push(...ids.map((id) => product(id)));
  state.snapshots.push(...ids.map(snapshot));
};

describe('PrismaCommercialPromotionRepository', () => {
  it('pagina somente OFFICIAL por cursor e carrega snapshots atual/anterior', async () => {
    const state = initialState();
    state.products.push(
      product('a'),
      product('b', { source: 'MANUAL' }),
      product('c', {
        commercialSnapshotRevision: 2,
        commercialSnapshotFingerprint: 'fingerprint-c-2',
      }),
      product('d', {
        commercialSnapshotRevision: 0,
        commercialSnapshotFingerprint: null,
      }),
    );
    state.snapshots.push(
      snapshot('a'),
      { ...snapshot('c'), id: 'snapshot-c-1', fingerprint: 'fingerprint-c-1' },
      {
        ...snapshot('c'),
        id: 'snapshot-c-2',
        revision: 2,
        fingerprint: 'fingerprint-c-2',
      },
      snapshot('d'),
    );
    const repository = new PrismaCommercialPromotionRepository(
      new PromotionPrismaFake(state).asClient(),
    );
    const first = await repository.listOfficialCatalogPage({ limit: 1 });
    const second = await repository.listOfficialCatalogPage({
      afterId: first.items[0]?.product.id,
      limit: 1,
    });
    const third = await repository.listOfficialCatalogPage({
      afterId: second.items[0]?.product.id,
      limit: 200,
    });
    expect(first.items.map(({ product }) => product.id)).toEqual(['a']);
    expect(first.hasMore).toBe(true);
    expect(second.items.map(({ product }) => product.id)).toEqual(['c']);
    expect(second.items[0]).toMatchObject({
      latestSnapshotRevision: 2,
      currentSnapshot: { revision: 2 },
      previousSnapshot: { revision: 1 },
    });
    expect(third.items).toEqual([
      expect.objectContaining({
        product: expect.objectContaining({ id: 'd' }),
        latestSnapshotRevision: 1,
        currentSnapshot: null,
      }),
    ]);
  });

  it('materializa top N, preserva protegidos e queuedAt, e expira fila antiga', async () => {
    const state = initialState();
    state.campaigns[0].queueTargetSize = 3;
    addProducts(state, 'protected', 'a', 'b', 'old');
    state.products.find(({ id }) => id === 'old').unavailableAt = NOW;
    const protectedCandidate = candidate('campaign-1', 'protected', {
      status: 'COPY_READY',
      rankPosition: 8,
    });
    const queued = candidate('campaign-1', 'a');
    const old = candidate('campaign-1', 'old', { rankPosition: 2 });
    state.candidates.push(protectedCandidate, queued, old);
    const fake = new PromotionPrismaFake(state);
    const repository = new PrismaCommercialPromotionRepository(fake.asClient());
    const result = await repository.materialize(
      materializationInput([
        ranked('a', queued as CommercialPromotionCandidateRecord),
        ranked('b'),
      ]),
    );
    expect(result).toMatchObject({
      protectedCount: 1,
      queueCapacity: 2,
      queuedCreated: 1,
      queuedUpdated: 1,
      queuedExpired: 1,
      queuedAfter: 2,
      queueFull: true,
    });
    const byProduct = new Map(
      fake.state.candidates.map((entry) => [entry.productId, entry]),
    );
    expect(byProduct.get('protected')).toMatchObject({
      status: 'COPY_READY',
      rankPosition: 8,
    });
    expect(byProduct.get('a')?.queuedAt).toEqual(queued.queuedAt);
    expect(byProduct.get('a')?.rankPosition).toBe(1);
    expect(byProduct.get('b')?.rankPosition).toBe(2);
    expect(byProduct.get('old')).toMatchObject({
      status: 'EXPIRED',
      rankPosition: null,
      blockedReason: null,
    });
  });

  it('reativa BLOCKED e reinicia queuedAt', async () => {
    const state = initialState();
    state.campaigns[0].queueTargetSize = 1;
    addProducts(state, 'a');
    const blocked = candidate('campaign-1', 'a', {
      status: 'BLOCKED',
      blockedReason: 'QUEUE_NOT_SELECTED',
    });
    state.candidates.push(blocked);
    const fake = new PromotionPrismaFake(state);
    const repository = new PrismaCommercialPromotionRepository(fake.asClient());
    const result = await repository.materialize(
      materializationInput([
        ranked('a', blocked as CommercialPromotionCandidateRecord),
      ]),
    );
    expect(result.queuedReactivated).toBe(1);
    expect(fake.state.candidates[0]).toMatchObject({
      status: 'QUEUED',
      queuedAt: NOW,
      blockedReason: null,
    });
  });

  it('e idempotente e preserva queuedAt na segunda materializacao', async () => {
    const state = initialState();
    state.campaigns[0].queueTargetSize = 1;
    addProducts(state, 'a');
    const fake = new PromotionPrismaFake(state);
    const repository = new PrismaCommercialPromotionRepository(fake.asClient());
    const first = await repository.materialize(
      materializationInput([ranked('a')]),
    );
    const current = fake.state
      .candidates[0] as CommercialPromotionCandidateRecord;
    const originalQueuedAt = current.queuedAt;
    const second = await repository.materialize(
      materializationInput([ranked('a', current)]),
    );
    expect(first.queuedCreated).toBe(1);
    expect(second).toMatchObject({ queuedCreated: 0, queuedUpdated: 1 });
    expect(fake.state.candidates).toHaveLength(1);
    expect(fake.state.candidates[0].queuedAt).toEqual(originalQueuedAt);
  });

  it('reverte toda a transacao quando uma criacao falha', async () => {
    const state = initialState();
    addProducts(state, 'a', 'b');
    const fake = new PromotionPrismaFake(state);
    fake.failCreateProductId = 'b';
    const repository = new PrismaCommercialPromotionRepository(fake.asClient());
    await expect(
      repository.materialize(materializationInput([ranked('a'), ranked('b')])),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_PROMOTION_PERSISTENCE_FAILED',
    });
    expect(fake.state.candidates).toHaveLength(0);
  });

  it('detecta mudanca de configuracao e de snapshot antes da escrita', async () => {
    const state = initialState();
    addProducts(state, 'a');
    const fake = new PromotionPrismaFake(state);
    const repository = new PrismaCommercialPromotionRepository(fake.asClient());
    await expect(
      repository.materialize(
        materializationInput([ranked('a')], {
          expectedCampaignUpdatedAt: new Date(NOW.getTime() - 1),
        }),
      ),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_PROMOTION_CONFIGURATION_CHANGED',
    });
    fake.state.products[0].commercialSnapshotFingerprint = 'changed';
    await expect(
      repository.materialize(materializationInput([ranked('a')])),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_PROMOTION_CATALOG_CHANGED' });
    expect(fake.state.candidates).toHaveLength(0);
  });

  it('detecta mudanca A para A do produto antes da escrita', async () => {
    const state = initialState();
    addProducts(state, 'a');
    const fake = new PromotionPrismaFake(state);
    const repository = new PrismaCommercialPromotionRepository(fake.asClient());
    fake.state.products[0].updatedAt = new Date(NOW.getTime() + 1);
    await expect(
      repository.materialize(materializationInput([ranked('a')])),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_PROMOTION_CATALOG_CHANGED' });
    expect(fake.state.candidates).toHaveLength(0);
  });

  it('permite apenas uma mineracao concorrente da mesma campanha', async () => {
    const state = initialState();
    state.campaigns[0].queueTargetSize = 1;
    addProducts(state, 'a');
    const fake = new PromotionPrismaFake(state);
    const repository = new PrismaCommercialPromotionRepository(fake.asClient());
    const results = await Promise.allSettled([
      repository.materialize(materializationInput([ranked('a')])),
      repository.materialize(materializationInput([ranked('a')])),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    const rejected = results.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({
      reason: { code: 'COMMERCIAL_PROMOTION_MINING_CONFLICT' },
    });
    expect(fake.state.candidates).toHaveLength(1);
  });

  it('nao usa lock global entre campanhas diferentes', async () => {
    const state = initialState();
    state.campaigns.push(campaign('campaign-2', 'niche-2', 1));
    state.groups.push({
      id: 'group-2',
      type: 'GROUP',
      fingerprint: 'grp-campaign-2',
      active: true,
      available: true,
      sourceInstanceName: 'instance-hidden-2',
    });
    addProducts(state, 'a', 'b');
    const fake = new PromotionPrismaFake(state);
    const repository = new PrismaCommercialPromotionRepository(fake.asClient());
    const results = await Promise.allSettled([
      repository.materialize(materializationInput([ranked('a')])),
      repository.materialize(
        materializationInput([ranked('b')], {
          campaignId: 'campaign-2',
          nicheId: 'niche-2',
          logicalGroupFingerprint: 'grp-campaign-2',
        }),
      ),
    ]);
    expect(results.every(({ status }) => status === 'fulfilled')).toBe(true);
    expect(fake.state.candidates).toHaveLength(2);
  });

  it('deduplica apenas SENT recente no mesmo grupo logico', async () => {
    const state = initialState();
    state.dispatches.push(
      {
        id: 'sent-match',
        productId: 'a',
        status: 'SENT',
        sentAt: NOW,
        type: 'GROUP',
        fingerprint: 'grp-campaign-1',
      },
      {
        id: 'failed',
        productId: 'b',
        status: 'FAILED',
        sentAt: NOW,
        type: 'GROUP',
        fingerprint: 'grp-campaign-1',
      },
      {
        id: 'other-group',
        productId: 'c',
        status: 'SENT',
        sentAt: NOW,
        type: 'GROUP',
        fingerprint: 'grp-other',
      },
    );
    const repository = new PrismaCommercialPromotionRepository(
      new PromotionPrismaFake(state).asClient(),
    );
    await expect(
      repository.findRecentlySentProductIds({
        productIds: ['a', 'b', 'c'],
        logicalGroupFingerprint: 'grp-campaign-1',
        sentAtOrAfter: new Date(NOW.getTime() - 1),
      }),
    ).resolves.toEqual(new Set(['a']));
  });

  it('lista a fila sem links, IDs externos ou breakdown completo', async () => {
    const state = initialState();
    addProducts(state, 'a');
    state.candidates.push(candidate('campaign-1', 'a'));
    const repository = new PrismaCommercialPromotionRepository(
      new PromotionPrismaFake(state).asClient(),
    );
    const result = await repository.listQueue({
      campaignId: 'campaign-1',
      page: 1,
      limit: 20,
    });
    expect(result.items[0]).toMatchObject({
      productName: 'Produto a',
      price: '80',
      snapshotRevision: 1,
    });
    expect(JSON.stringify(result.items)).not.toMatch(
      /affiliate|productLink|providerProductId|shopId|fingerprint|scoreBreakdown/i,
    );
  });
  it('retira QUEUED stale da fila elegivel e deixa o proximo candidate assumir rank 1', async () => {
    const state = initialState();
    state.campaigns[0].queueTargetSize = 1;
    addProducts(state, 'stale', 'next');
    const stale = candidate('campaign-1', 'stale', { rankPosition: 1 });
    state.candidates.push(stale);
    const fake = new PromotionPrismaFake(state);
    const repository = new PrismaCommercialPromotionRepository(fake.asClient());

    const result = await repository.materialize(
      materializationInput([ranked('next')]),
    );

    expect(result).toMatchObject({ queuedBlocked: 1, queuedAfter: 1 });
    const byProduct = new Map(
      fake.state.candidates.map((entry) => [entry.productId, entry]),
    );
    expect(byProduct.get('stale')).toMatchObject({
      status: 'BLOCKED',
      rankPosition: null,
      blockedReason: 'QUEUE_NOT_SELECTED',
    });
    expect(byProduct.get('next')).toMatchObject({
      status: 'QUEUED',
      rankPosition: 1,
    });
  });

  it('mantem COPY_READY e RESERVED protegidos quando nao participam do novo ranking', async () => {
    const state = initialState();
    state.campaigns[0].queueTargetSize = 2;
    addProducts(state, 'copy-ready', 'reserved');
    state.candidates.push(
      candidate('campaign-1', 'copy-ready', {
        status: 'COPY_READY',
        rankPosition: 7,
      }),
      candidate('campaign-1', 'reserved', {
        status: 'RESERVED',
        rankPosition: 8,
      }),
    );
    const fake = new PromotionPrismaFake(state);
    const repository = new PrismaCommercialPromotionRepository(fake.asClient());

    const result = await repository.materialize(materializationInput([]));

    expect(result.protectedCount).toBe(2);
    expect(fake.state.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: 'copy-ready',
          status: 'COPY_READY',
          rankPosition: 7,
        }),
        expect.objectContaining({
          productId: 'reserved',
          status: 'RESERVED',
          rankPosition: 8,
        }),
      ]),
    );
  });
});
