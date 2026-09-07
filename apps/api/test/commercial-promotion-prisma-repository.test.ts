/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma test double mirrors the generated client's dynamic delegate surface. */
import { describe, expect, it, vi } from 'vitest';

import {
  PrismaCommercialDeliveryHistoryRepository,
  PrismaCommercialPromotionRepository,
} from '../src/prisma-repositories';
import { fingerprintCommercialOffer } from '../src/commercial-offer-snapshot';
import { COMMERCIAL_AI_COPY_PROMPT_VERSION, COMMERCIAL_AI_COPY_VALIDATION_VERSION } from '../src/commercial-ai-copy-prompt';
import type {
  CommercialPromotionCandidateRecord,
  CommercialPromotionMaterializationInput,
  CommercialPromotionRankedCandidate,
} from '../src/repositories';

const NOW = new Date('2026-07-29T15:00:00.000Z');

describe('materialização manual e histórico terminal', () => {
  it.each([
    ['BLOCKED', 'FAILED', false], ['QUEUED', 'FAILED', false],
    ['COPY_READY', 'AMBIGUOUS', false], ['BLOCKED', 'FAILED', true],
    ['COPY_READY', 'AMBIGUOUS', true],
  ] as const)('%s/%s com novo snapshot=%s', async (status, attemptStatus, nextSnapshot) => {
    const current = candidate('campaign-1', 'a', {
      status, generatedCopyId: status === 'COPY_READY' ? 'copy-history' : null,
      blockedReason: status === 'BLOCKED' ? 'COMMERCIAL_AI_COPY_TERMINAL_ATTEMPT_REJECTED' : null,
    });
    const history = [{ id: 'history', candidateId: current.id, snapshotId: current.snapshotId,
      status: attemptStatus, inputFingerprint: 'old-provider-version' }];
    const before = structuredClone(history);
    const selectedSnapshot = { ...snapshot('a'), ...(nextSnapshot ? {
      id: 'snapshot-a-v2', revision: 2, fingerprint: 'fingerprint-a-v2',
    } : {}) };
    const update = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...current,
        ...data,
      }),
    );
    const transaction = {
      commercialGroupCampaign: { findUnique: vi.fn(async () => campaign('campaign-1', 'niche-1')) },
      productLead: { findUnique: vi.fn(async () => product('a', {
        commercialSnapshotRevision: selectedSnapshot.revision,
        commercialSnapshotFingerprint: selectedSnapshot.fingerprint,
      })) },
      commercialOfferSnapshot: { findUnique: vi.fn(async () => selectedSnapshot) },
      commercialPromotionCandidate: { findUnique: vi.fn(async () => current), update, create: vi.fn() },
      commercialCopyGenerationAttempt: {
        findFirst: vi.fn(
          async ({ where }: { where: { candidateId: string; snapshotId: string } }) =>
            history.find(
              (attempt) =>
                attempt.candidateId === where.candidateId &&
                attempt.snapshotId === where.snapshotId,
            ) ?? null,
        ),
      },
    };
    const transact = vi.fn(
      async (
        callback: (tx: typeof transaction) => Promise<unknown>,
        options?: Record<string, unknown>,
      ) => {
        void options;
        return callback(transaction);
      },
    );
    const repository = new PrismaCommercialPromotionRepository({ $transaction: transact } as never);
    const result = repository.ensureManualCandidate({
      campaignId: current.campaignId, productId: current.productId,
      snapshotId: selectedSnapshot.id, snapshotRevision: selectedSnapshot.revision,
      snapshotFingerprint: selectedSnapshot.fingerprint,
      commercialScore: 70, scorePolicyVersion: 'official-v2', minimumScoreUsed: 60,
      scoreBreakdown: { ...current.scoreBreakdown, policyVersion: 'official-v2' }, promotionSignals: ['CURRENT_DISCOUNT'],
      priceDropPercent: null, expiresAt: null, now: NOW,
    });
    if (nextSnapshot) {
      await expect(result).resolves.toMatchObject({ status: 'QUEUED', snapshotId: 'snapshot-a-v2',
        generatedCopyId: null, blockedReason: null });
      expect(update).toHaveBeenCalledOnce();
    } else {
      await expect(result).rejects.toMatchObject({ code: 'COMMERCIAL_AI_COPY_TERMINAL_ATTEMPT_REJECTED' });
      expect(update).not.toHaveBeenCalled();
    }
    expect(transaction.commercialPromotionCandidate.create).not.toHaveBeenCalled();
    expect(history).toEqual(before);
    expect(transact).toHaveBeenCalledOnce();
    expect(typeof transact.mock.calls[0]?.[0]).toBe('function');
    expect(transact.mock.calls[0]?.[1]).toEqual({
      isolationLevel: 'Serializable', maxWait: 1000, timeout: 10000,
    });
  });
});

type State = {
  campaigns: any[];
  groups: any[];
  products: any[];
  snapshots: any[];
  candidates: any[];
  attempts: Record<string, unknown>[];
  copies: Record<string, unknown>[];
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
  attempts: [],
  copies: [],
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
    if (include.copyGenerationAttempts) {
      result.copyGenerationAttempts = this.state.attempts
        .filter(({ candidateId }) => candidateId === record.id)
        .map((attempt) => structuredClone(attempt));
    }
    if (include.generatedCopy) {
      result.generatedCopy = structuredClone(this.state.copies.find(({ id }) => id === record.generatedCopyId) ?? null);
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
              (typeof where.status === 'string'
                ? dispatch.status === where.status
                : where.status.in.includes(dispatch.status)) &&
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
              (typeof where.status === 'string'
                ? dispatch.status === where.status
                : where.status.in.includes(dispatch.status)) &&
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

  it('mantem blocker terminal BLOCKED no mesmo snapshot sem recolocar na fila', async () => {
    const state = initialState();
    state.campaigns[0].queueTargetSize = 1;
    addProducts(state, 'a');
    const blocked = candidate('campaign-1', 'a', {
      status: 'BLOCKED',
      blockedReason: 'COMMERCIAL_AI_COPY_OUTPUT_INVALID',
    });
    state.candidates.push(blocked);
    const fake = new PromotionPrismaFake(state);
    const repository = new PrismaCommercialPromotionRepository(fake.asClient());
    const result = await repository.materialize(
      materializationInput([
        ranked('a', blocked as CommercialPromotionCandidateRecord),
      ]),
    );

    expect(result.queuedReactivated).toBe(0);
    expect(fake.state.candidates[0]).toMatchObject({
      status: 'BLOCKED',
      snapshotId: 'snapshot-a',
      blockedReason: 'COMMERCIAL_AI_COPY_OUTPUT_INVALID',
    });
  });

  it('ignora terminais na capacidade util e permite que o rank 5 preencha a fila', async () => {
    const state = initialState();
    state.campaigns[0].queueTargetSize = 4;
    addProducts(state, 'a', 'b', 'c', 'd', 'e');
    for (const productId of ['a', 'b', 'c', 'd']) {
      state.candidates.push(
        candidate('campaign-1', productId, {
          status: 'BLOCKED',
          blockedReason: 'COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED',
        }),
      );
    }
    const fake = new PromotionPrismaFake(state);
    const repository = new PrismaCommercialPromotionRepository(fake.asClient());
    const result = await repository.materialize(
      materializationInput([
        ...['a', 'b', 'c', 'd'].map((productId) => {
          const current = fake.state.candidates.find(
            (entry) => entry.productId === productId,
          ) as CommercialPromotionCandidateRecord;
          return ranked(productId, current);
        }),
        ranked('e'),
      ]),
    );

    expect(result).toMatchObject({ queuedCreated: 1, queuedReactivated: 0 });
    expect(fake.state.candidates.find(({ productId }) => productId === 'e')).toMatchObject({
      status: 'QUEUED',
      rankPosition: 1,
    });
    for (const productId of ['a', 'b', 'c', 'd']) {
      expect(
        fake.state.candidates.find((entry) => entry.productId === productId),
      ).toMatchObject({
        status: 'BLOCKED',
        blockedReason: 'COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED',
      });
    }
  });

  it('reativa blocker terminal somente quando existe snapshot novo legitimo', async () => {
    const state = initialState();
    state.campaigns[0].queueTargetSize = 1;
    addProducts(state, 'a');
    const current = candidate('campaign-1', 'a', {
      status: 'BLOCKED',
      blockedReason: 'COMMERCIAL_AI_COPY_OUTPUT_INVALID',
    });
    state.candidates.push(current);
    state.products[0].commercialSnapshotRevision = 2;
    state.products[0].commercialSnapshotFingerprint = 'fingerprint-a-2';
    state.snapshots.push({
      ...snapshot('a'),
      id: 'snapshot-a-2',
      revision: 2,
      fingerprint: 'fingerprint-a-2',
    });
    const next = {
      ...ranked('a', current as CommercialPromotionCandidateRecord),
      snapshotId: 'snapshot-a-2',
      snapshotRevision: 2,
      snapshotFingerprint: 'fingerprint-a-2',
    };
    const fake = new PromotionPrismaFake(state);
    const repository = new PrismaCommercialPromotionRepository(fake.asClient());
    const result = await repository.materialize(materializationInput([next]));

    expect(result.queuedReactivated).toBe(1);
    expect(fake.state.candidates[0]).toMatchObject({
      status: 'QUEUED',
      snapshotId: 'snapshot-a-2',
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

  it('lista capacidade sem terminal e expõe contagens nominais separadas', async () => {
    const state = initialState();
    addProducts(state, 'terminal', 'ready', 'queued', 'sent');
    state.candidates.push(
      candidate('campaign-1', 'terminal', {
        status: 'BLOCKED',
        blockedReason: 'COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED',
      }),
      candidate('campaign-1', 'ready', { status: 'COPY_READY' }),
      candidate('campaign-1', 'queued', { status: 'QUEUED' }),
      candidate('campaign-1', 'sent', { status: 'DISPATCHED' }),
    );
    const repository = new PrismaCommercialPromotionRepository(
      new PromotionPrismaFake(state).asClient(),
    );

    const result = await repository.listQueue({
      campaignId: 'campaign-1',
      page: 1,
      limit: 200,
      capacityOnly: true,
    });

    expect(result.items.map(({ productId }) => productId).sort()).toEqual([
      'queued',
      'ready',
    ]);
    expect(result.total).toBe(2);
    expect(result.health).toEqual({
      nominalCount: 2,
      usableCount: 0,
      copyReadyCount: 0,
      nominalCopyReadyCount: 1,
      terminalCount: 1,
    });
  });

  it('conta como utilizável somente candidate publicável com snapshot, imagem e proveniência atuais', async () => {
    const state = initialState();
    addProducts(
      state,
      'valid',
      'expired',
      'unavailable',
      'no-image',
      'stale',
      'low-score',
      'terminal-attempt',
      'preparing', 'queued-copy', 'ready-valid', 'ready-wrong-product',
      'ready-wrong-snapshot', 'ready-wrong-candidate', 'ready-wrong-fingerprint',
      'ready-legacy', 'ready-wrong-version', 'ready-missing-copy', 'ready-missing-attempt',
      'ready-invalid-content', 'ready-stale-price',
    );
    for (const entry of state.products) {
      entry.productLink = `https://shopee.com.br/product/${entry.id}`;
      entry.affiliateLink = `https://s.shopee.com.br/${entry.id}`;
      entry.urlImagem = `https://images.example.invalid/${entry.id}.jpg`;
      const fingerprint = fingerprintCommercialOffer({
        source: 'OFFICIAL',
        providerProductId: entry.providerProductId,
        productLink: entry.productLink,
        affiliateLink: entry.affiliateLink,
        price: entry.preco,
        priceMin: entry.precoMin,
        priceMax: entry.precoMax,
        discountRate: entry.desconto,
        commissionRate: entry.comissao,
        offerStartsAt: entry.offerStartsAt,
        offerEndsAt: entry.offerEndsAt,
        unavailableAt: entry.unavailableAt,
      });
      entry.commercialSnapshotFingerprint = fingerprint;
      state.snapshots.find(({ productId }) => productId === entry.id).fingerprint =
        fingerprint;
    }
    state.products.find(({ id }) => id === 'unavailable').unavailableAt = NOW;
    state.products.find(({ id }) => id === 'no-image').urlImagem = '';
    state.products.find(({ id }) => id === 'stale').commercialSnapshotFingerprint =
      'different-fingerprint';
    state.candidates.push(
      candidate('campaign-1', 'valid'),
      candidate('campaign-1', 'expired', {
        expiresAt: new Date(NOW.getTime() - 1),
      }),
      candidate('campaign-1', 'unavailable'),
      candidate('campaign-1', 'no-image'),
      candidate('campaign-1', 'stale'),
      candidate('campaign-1', 'low-score', {
        commercialScore: 59,
        minimumScoreUsed: 60,
      }),
      candidate('campaign-1', 'terminal-attempt'),
    );
    state.attempts.push({
      candidateId: 'candidate-campaign-1-terminal-attempt',
      snapshotId: 'snapshot-terminal-attempt',
      status: 'FAILED',
      generatedCopyId: null,
    });
    state.candidates.push(candidate('campaign-1', 'preparing'),
      candidate('campaign-1', 'queued-copy', { generatedCopyId: 'orphan-copy' }));
    state.attempts.push({ candidateId: 'candidate-campaign-1-preparing', snapshotId: 'snapshot-preparing', status: 'STARTED' });
    for (const id of ['ready-valid', 'ready-wrong-product', 'ready-wrong-snapshot',
      'ready-wrong-candidate', 'ready-wrong-fingerprint', 'ready-legacy', 'ready-wrong-version',
      'ready-missing-copy', 'ready-missing-attempt', 'ready-invalid-content', 'ready-stale-price']) {
      state.candidates.push(candidate('campaign-1', id, { status: 'COPY_READY', generatedCopyId: `copy-${id}` }));
      if (id !== 'ready-missing-copy') state.copies.push({
        id: `copy-${id}`, productId: id === 'ready-wrong-product' ? 'other' : id,
        snapshotId: id === 'ready-wrong-snapshot' ? 'other' : `snapshot-${id}`,
        createdFromCandidateId: id === 'ready-wrong-candidate' ? 'other' : `candidate-campaign-1-${id}`,
        inputFingerprint: `input-${id}`, source: 'LEGACY_TEMPLATE',
        titulo: 'OFERTA SELECIONADA', mensagem: id === 'ready-invalid-content'
          ? 'Frete grátis garantido' : `Produto ${id}\n🔥 POR: R$ ${id === 'ready-stale-price' ? '70' : '80'},00\n💸 20% OFF`,
        cta: `🛒 Compre aqui: https://s.shopee.com.br/${id}`, hashtags: '',
        provider: id === 'ready-legacy' ? 'arbitrary-template' : 'deterministic-safe-fallback', model: 'commercial-safe-fallback-v1',
        promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
        validationVersion: id === 'ready-wrong-version' ? 'old' : COMMERCIAL_AI_COPY_VALIDATION_VERSION,
      });
      if (id !== 'ready-missing-attempt') state.attempts.push({
        candidateId: `candidate-campaign-1-${id}`, snapshotId: `snapshot-${id}`,
        generatedCopyId: `copy-${id}`, status: 'SUCCEEDED',
        inputFingerprint: id === 'ready-wrong-fingerprint' ? 'other' : `input-${id}`,
      });
    }
    const repository = new PrismaCommercialPromotionRepository(
      new PromotionPrismaFake(state).asClient(),
    );

    const result = await repository.listQueue({
      campaignId: 'campaign-1',
      page: 1,
      limit: 200,
      capacityOnly: true,
    });

    expect(result.health).toMatchObject({ nominalCount: 20, usableCount: 2, terminalCount: 1, copyReadyCount: 1 });
  });

  it('lê capacidade e delivery no mesmo snapshot RepeatableRead durante preparação concorrente', async () => {
    const state = initialState();
    addProducts(state, 'a');
    const entry = state.products[0];
    entry.productLink = 'https://shopee.com.br/product/a';
    entry.affiliateLink = 'https://s.shopee.com.br/a';
    const fingerprint = fingerprintCommercialOffer({
      source: 'OFFICIAL', providerProductId: entry.providerProductId,
      productLink: entry.productLink, affiliateLink: entry.affiliateLink,
      price: entry.preco, priceMin: entry.precoMin, priceMax: entry.precoMax,
      discountRate: entry.desconto, commissionRate: entry.comissao,
      offerStartsAt: null, offerEndsAt: null, unavailableAt: null,
    });
    entry.commercialSnapshotFingerprint = fingerprint;
    state.snapshots[0].fingerprint = fingerprint;
    state.candidates.push(candidate('campaign-1', 'a'));
    const snapshotClient = new PromotionPrismaFake(state).asClient();
    const readCapacity = snapshotClient.commercialPromotionCandidate.findMany;
    snapshotClient.commercialPromotionCandidate.findMany = vi.fn(async (args) => {
      const records = await readCapacity(args);
      // Concurrent STARTED claim after the snapshot has been acquired.
      state.attempts.push({ candidateId: 'candidate-campaign-1-a', snapshotId: 'snapshot-a', status: 'STARTED' });
      state.candidates.push(candidate('campaign-1', 'later'));
      return records;
    });
    snapshotClient.whatsAppDispatch.findMany = vi.fn(async () => [{ productId: 'a' }]);
    snapshotClient.commercialPipelineRun = { findMany: vi.fn(async () => [{ productId: 'a' }]) };
    const outsideRead = vi.fn(() => { throw new Error('read outside snapshot'); });
    const transact = vi.fn(
      async (
        callback: (tx: typeof snapshotClient) => Promise<unknown>,
        options?: Record<string, unknown>,
      ) => {
        void options;
        return callback(snapshotClient);
      },
    );
    const repository = new PrismaCommercialPromotionRepository({
      commercialPromotionCandidate: { findMany: outsideRead, count: outsideRead },
      whatsAppDispatch: { findMany: outsideRead }, commercialPipelineRun: { findMany: outsideRead },
      $transaction: transact,
    } as never);
    const result = await repository.listQueue({ campaignId: 'campaign-1', groupId: 'group-1', capacityOnly: true, page: 1, limit: 200 });
    expect(result.health).toEqual({ nominalCount: 1, usableCount: 0, copyReadyCount: 0, nominalCopyReadyCount: 0, terminalCount: 0,
      alreadySentCount: 1, usableAlreadySentCount: 1 });
    expect(result.total).toBe(1);
    expect(state.attempts.length).toBeGreaterThan(0);
    expect(outsideRead).not.toHaveBeenCalled();
    expect(transact).toHaveBeenCalledOnce();
    expect(typeof transact.mock.calls[0]?.[0]).toBe('function');
    expect(transact.mock.calls[0]?.[1]).toEqual({ isolationLevel: 'RepeatableRead' });
    expect(snapshotClient.commercialPromotionCandidate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: { product: true, snapshot: true, generatedCopy: true, copyGenerationAttempts: true },
    }));
  });

  it('conta produtos já enviados no grupo pela união de dispatch e run confirmado sem duplicar overlap', async () => {
    const candidateFindMany = vi.fn().mockResolvedValue([
      { productId: 'product-a' },
      { productId: 'product-b' },
      { productId: 'product-c' },
    ]);
    const dispatchFindMany = vi.fn().mockResolvedValue([
      { productId: 'product-a' },
      { productId: 'product-b' },
    ]);
    const runFindMany = vi.fn().mockResolvedValue([
      { productId: 'product-b' },
      { productId: 'product-c' },
    ]);
    const repository = new PrismaCommercialDeliveryHistoryRepository({
      commercialPromotionCandidate: { findMany: candidateFindMany },
      whatsAppDispatch: { findMany: dispatchFindMany },
      commercialPipelineRun: { findMany: runFindMany },
    } as never);

    await expect(
      repository.countSentCampaignProductsToGroup({
        campaignId: 'campaign-1',
        groupId: 'group-1',
      }),
    ).resolves.toBe(3);

    expect(candidateFindMany).toHaveBeenCalledWith({
      where: {
        campaignId: 'campaign-1',
        status: { in: ['QUEUED', 'COPY_READY'] },
      },
      select: { productId: true },
      distinct: ['productId'],
    });
    expect(dispatchFindMany).toHaveBeenCalledWith({
      where: {
        productId: { in: ['product-a', 'product-b', 'product-c'] },
        destinationId: 'group-1',
        status: { in: ['SENT', 'DELIVERED', 'READ'] },
      },
      select: { productId: true },
      distinct: ['productId'],
    });
    expect(runFindMany).toHaveBeenCalledWith({
      where: {
        productId: { in: ['product-a', 'product-b', 'product-c'] },
        groupDestinationId: 'group-1',
        mode: 'CONFIRMED',
        status: 'COMPLETED',
      },
      select: { productId: true },
      distinct: ['productId'],
    });
  });

  it('exclui do sent utilizável o candidato materialmente terminal sem apagar o sent nominal', async () => {
    const capacityRecord = (
      id: string,
      copyGenerationAttempts: Record<string, unknown>[] = [],
    ) => {
      const baseProduct = product(id, {
        productLink: `https://shopee.com.br/product/${id}`,
        affiliateLink: `https://s.shopee.com.br/${id}`,
        urlImagem: `https://images.example.invalid/${id}.jpg`,
      });
      const fingerprint = fingerprintCommercialOffer({
        source: 'OFFICIAL',
        providerProductId: baseProduct.providerProductId,
        productLink: baseProduct.productLink,
        affiliateLink: baseProduct.affiliateLink,
        price: baseProduct.preco,
        priceMin: baseProduct.precoMin,
        priceMax: baseProduct.precoMax,
        discountRate: baseProduct.desconto,
        commissionRate: baseProduct.comissao,
        offerStartsAt: baseProduct.offerStartsAt,
        offerEndsAt: baseProduct.offerEndsAt,
        unavailableAt: baseProduct.unavailableAt,
      });
      return {
        ...candidate('campaign-1', id),
        product: { ...baseProduct, commercialSnapshotFingerprint: fingerprint },
        snapshot: { ...snapshot(id), fingerprint },
        copyGenerationAttempts,
      };
    };
    const usable = capacityRecord('usable');
    const terminal = capacityRecord('terminal', [
      {
        snapshotId: 'snapshot-terminal',
        status: 'FAILED',
        generatedCopyId: null,
      },
    ]);
    const candidateFindMany = vi.fn(
      async ({ include }: { include?: unknown }) =>
        include
          ? [usable, terminal]
          : [{ productId: 'usable' }, { productId: 'terminal' }],
    );
    const dispatchFindMany = vi.fn(
      async ({ where }: { where: { productId: { in: string[] } } }) =>
        where.productId.in.includes('terminal')
          ? [{ productId: 'terminal' }]
          : [],
    );
    const runFindMany = vi.fn().mockResolvedValue([]);
    const repository = new PrismaCommercialDeliveryHistoryRepository({
      commercialPromotionCandidate: { findMany: candidateFindMany },
      whatsAppDispatch: { findMany: dispatchFindMany },
      commercialPipelineRun: { findMany: runFindMany },
    } as never);

    await expect(
      repository.countSentCampaignProductsToGroup({
        campaignId: 'campaign-1',
        groupId: 'group-1',
      }),
    ).resolves.toBe(1);
    await expect(
      repository.countSentCampaignProductsToGroup({
        campaignId: 'campaign-1',
        groupId: 'group-1',
        usableOnly: true,
      }),
    ).resolves.toBe(0);

    expect(dispatchFindMany).toHaveBeenLastCalledWith({
      where: {
        productId: { in: ['usable'] },
        destinationId: 'group-1',
        status: { in: ['SENT', 'DELIVERED', 'READ'] },
      },
      select: { productId: true },
      distinct: ['productId'],
    });
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
