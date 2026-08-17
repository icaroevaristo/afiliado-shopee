import { AppError } from '@shopee-auto-affiliate-ai/shared';

import { commercialProductRejections } from './commercial-offer-eligibility';
import {
  CommercialOfferScorePolicyResolver,
  sanitizeCommercialScoreBreakdown,
} from './commercial-offer-score-policy';
import { CommercialNicheMatcher } from './commercial-niche-matcher';
import { rankCommercialPromotionCandidates } from './commercial-promotion-ranking';
import { CommercialPromotionSignalDetector } from './commercial-promotion-signal-detector';
import type {
  CommercialGroupCampaignRepository,
  CommercialNicheRepository,
  CommercialPromotionCandidateRecord,
  CommercialPromotionCandidateRepository,
  CommercialPromotionCatalogRepository,
  CommercialPromotionRankedCandidate,
  CommercialPromotionRejectionCode,
  CommercialPromotionSignal,
  CommercialPromotionSnapshotRecord,
  ShopeeOfferRecord,
} from './repositories';
import type { ScoreService } from './score-service';
import {
  assertCompatibleShopeeProductIdentity,
  PRODUCT_VARIANT_DEDUPLICATION,
  resolveShopeeProductIdentity,
  type ShopeeProductIdentityInput,
} from './shopee-product-identity';

const CATALOG_BATCH_SIZE = 200;
const MAX_EVALUATED_PRODUCTS = 2_000;
const MAX_PREVIEW_CANDIDATES = 20;
const PROTECTED_STATUSES = new Set(['COPY_READY', 'RESERVED']);

export const COMMERCIAL_PROMOTION_MINING_CONFIRMATION =
  'MINERAR_PROMOCOES';

type PromotionSummary = Partial<
  Record<CommercialPromotionRejectionCode, number>
>;
type SignalSummary = Partial<Record<CommercialPromotionSignal, number>>;

type EvaluatedCandidate = CommercialPromotionRankedCandidate & {
  productName: string;
  price: string;
};

export type CommercialPromotionPreviewCandidate = {
  productId: string;
  productName: string;
  price: string;
  discountRate: number;
  commercialScore: number;
  promotionSignals: CommercialPromotionSignal[];
  priceDropPercent: string | null;
  projectedRank: number;
  snapshotRevision: number;
};

export type CommercialPromotionMiningReport = {
  campaignId: string;
  preview: boolean;
  campaignActive: boolean;
  nicheActive: boolean;
  groupAvailable: boolean;
  evaluatedCount: number;
  evaluationTruncated: boolean;
  structurallyEligibleCount: number;
  nicheMatchedCount: number;
  promotionMatchedCount: number;
  recentlySentRejectedCount: number;
  dedupeRejectedCount: number;
  protectedCount: number;
  queueCapacity: number;
  queuedBefore: number;
  queuedCreated: number;
  queuedReactivated: number;
  queuedUpdated: number;
  queuedBlocked: number;
  queuedExpired: number;
  queuedAfter: number;
  rejectionSummary: PromotionSummary;
  signalSummary: SignalSummary;
  queueTargetSize: number;
  queueFull: boolean;
  projectedCandidates?: CommercialPromotionPreviewCandidate[];
};

export const createCommercialPromotionMiningDomainService = ({
  campaigns,
  niches,
  promotions,
  score,
  logger,
  clock,
}: {
  campaigns: CommercialGroupCampaignRepository;
  niches: CommercialNicheRepository;
  promotions: CommercialPromotionCatalogRepository &
    CommercialPromotionCandidateRepository;
  score: Pick<ScoreService, 'calculate'>;
  logger?: { info(data: unknown, message?: string): void };
  clock?: () => Date;
}) =>
  new CommercialPromotionMiningService({
    campaigns,
    niches,
    catalog: promotions,
    candidates: promotions,
    scorePolicies: new CommercialOfferScorePolicyResolver(score),
    matcher: new CommercialNicheMatcher(),
    signalDetector: new CommercialPromotionSignalDetector(),
    logger,
    clock,
  });

const promotionError = (message: string, code: string): never => {
  throw new AppError(message, code);
};

const increment = <T extends string>(
  summary: Partial<Record<T, number>>,
  code: T,
) => {
  summary[code] = (summary[code] ?? 0) + 1;
};

const addProductRejection = (
  summary: PromotionSummary,
  productCodes: Set<CommercialPromotionRejectionCode>,
  code: CommercialPromotionRejectionCode,
) => {
  if (productCodes.has(code)) return;
  productCodes.add(code);
  increment(summary, code);
};

const snapshotState = ({
  product,
  revision,
  fingerprint,
  latestSnapshotRevision,
  currentSnapshot,
  previousSnapshot,
}: {
  product: ShopeeOfferRecord;
  revision: number;
  fingerprint: string | null;
  latestSnapshotRevision: number | null;
  currentSnapshot: CommercialPromotionSnapshotRecord | null;
  previousSnapshot: CommercialPromotionSnapshotRecord | null;
}) => {
  if (
    latestSnapshotRevision !== null &&
    latestSnapshotRevision !== revision
  ) {
    return 'SNAPSHOT_OUTDATED' as const;
  }
  if (revision <= 0 || !currentSnapshot) return 'SNAPSHOT_MISSING' as const;
  if (
    !fingerprint ||
    latestSnapshotRevision === null ||
    currentSnapshot.productId !== product.id ||
    currentSnapshot.revision !== revision ||
    currentSnapshot.fingerprint !== fingerprint
  ) {
    return 'SNAPSHOT_OUTDATED' as const;
  }
  if (
    revision > 1 &&
    (!previousSnapshot ||
      previousSnapshot.productId !== product.id ||
      previousSnapshot.revision !== revision - 1)
  ) {
    return 'SNAPSHOT_OUTDATED' as const;
  }
  return null;
};

const parseMineConfirmation = (input: unknown) => {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    (input as Record<string, unknown>).confirm !==
      COMMERCIAL_PROMOTION_MINING_CONFIRMATION
  ) {
    promotionError(
      'Confirmacao de mineracao invalida',
      'COMMERCIAL_PROMOTION_CONFIRMATION_REQUIRED',
    );
  }
};

export const parseCommercialPromotionPreviewBody = (input: unknown) => {
  if (
    input !== undefined &&
    (input === null ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).length > 0)
  ) {
    promotionError(
      'Preview de mineracao nao aceita campos',
      'COMMERCIAL_PROMOTION_PREVIEW_INVALID',
    );
  }
};

const dedupeSince = (now: Date, days: number) =>
  new Date(now.getTime() - days * 24 * 60 * 60 * 1_000);

export class CommercialPromotionMiningService {
  constructor(
    private readonly dependencies: {
      campaigns: CommercialGroupCampaignRepository;
      niches: CommercialNicheRepository;
      catalog: CommercialPromotionCatalogRepository;
      candidates: CommercialPromotionCandidateRepository;
      scorePolicies: Pick<CommercialOfferScorePolicyResolver, 'forSource'>;
      matcher: Pick<CommercialNicheMatcher, 'match'>;
      signalDetector: Pick<CommercialPromotionSignalDetector, 'detect'>;
      clock?: () => Date;
      logger?: { info(data: unknown, message?: string): void };
    },
  ) {}

  private async loadConfiguration(campaignId: string) {
    const campaign = await this.dependencies.campaigns.findById(campaignId);
    if (!campaign) {
      return promotionError(
        'Campanha comercial nao encontrada',
        'COMMERCIAL_GROUP_CAMPAIGN_NOT_FOUND',
      );
    }
    const niche = await this.dependencies.niches.findById(campaign.nicheId);
    if (!niche) {
      return promotionError(
        'Nicho comercial nao encontrado',
        'COMMERCIAL_NICHE_NOT_FOUND',
      );
    }
    const groupAvailable =
      await this.dependencies.campaigns.hasEligibleDestination(
        campaign.logicalGroupFingerprint,
      );
    return { campaign, niche, groupAvailable };
  }

  private async evaluate(campaignId: string, preview: boolean) {
    const now = this.dependencies.clock?.() ?? new Date();
    const { campaign, niche, groupAvailable } =
      await this.loadConfiguration(campaignId);
    const existingCandidates =
      await this.dependencies.candidates.listCampaignCandidates(campaignId);
    const existingByProduct = new Map(
      existingCandidates.map((candidate) => [candidate.productId, candidate]),
    );
    const protectedCount = existingCandidates.filter((candidate) =>
      PROTECTED_STATUSES.has(candidate.status),
    ).length;
    const queuedBefore = existingCandidates.filter(
      ({ status }) => status === 'QUEUED',
    ).length;
    const queueCapacity = Math.max(
      campaign.queueTargetSize - protectedCount,
      0,
    );
    const rejectionSummary: PromotionSummary = {};
    const signalSummary: SignalSummary = {};

    if (!campaign.active) increment(rejectionSummary, 'CAMPAIGN_INACTIVE');
    if (!groupAvailable) increment(rejectionSummary, 'GROUP_UNAVAILABLE');
    if (!niche.active) {
      increment(rejectionSummary, 'NICHE_INACTIVE');
      return {
        campaign,
        niche,
        now,
        ranked: [] as EvaluatedCandidate[],
        report: {
          campaignId,
          preview,
          campaignActive: campaign.active,
          nicheActive: false,
          groupAvailable,
          evaluatedCount: 0,
          evaluationTruncated: false,
          structurallyEligibleCount: 0,
          nicheMatchedCount: 0,
          promotionMatchedCount: 0,
          recentlySentRejectedCount: 0,
          dedupeRejectedCount: 0,
          protectedCount,
          queueCapacity,
          queuedBefore,
          queuedCreated: 0,
          queuedReactivated: 0,
          queuedUpdated: 0,
          queuedBlocked: 0,
          queuedExpired: 0,
          queuedAfter: queuedBefore,
          rejectionSummary,
          signalSummary,
          queueTargetSize: campaign.queueTargetSize,
          queueFull: protectedCount >= campaign.queueTargetSize,
          projectedCandidates: preview ? [] : undefined,
        } satisfies CommercialPromotionMiningReport,
      };
    }

    let cursor: string | undefined;
    let evaluatedCount = 0;
    let structurallyEligibleCount = 0;
    let nicheMatchedCount = 0;
    let promotionMatchedCount = 0;
    let evaluationTruncated = false;
    const seenCatalogIdentities = new Map<
      string,
      { productId: string; identity: ShopeeProductIdentityInput }
    >();
    const promotionMatches: Array<{
      candidate: EvaluatedCandidate;
      productCodes: Set<CommercialPromotionRejectionCode>;
      existing: CommercialPromotionCandidateRecord | null;
    }> = [];

    while (evaluatedCount < MAX_EVALUATED_PRODUCTS) {
      const remaining = MAX_EVALUATED_PRODUCTS - evaluatedCount;
      const page = await this.dependencies.catalog.listOfficialCatalogPage({
        afterId: cursor,
        limit: Math.min(CATALOG_BATCH_SIZE, remaining),
      });
      for (const item of page.items) {
        const identity = resolveShopeeProductIdentity(item.product);
        const previousIdentity = seenCatalogIdentities.get(identity.key);
        if (previousIdentity) {
          assertCompatibleShopeeProductIdentity(
            previousIdentity.identity,
            item.product,
          );
          if (previousIdentity.productId !== item.product.id) {
            promotionError(
              'Catalogo contem identidade de produto duplicada',
              PRODUCT_VARIANT_DEDUPLICATION,
            );
          }
          continue;
        }
        seenCatalogIdentities.set(identity.key, {
          productId: item.product.id,
          identity: item.product,
        });
        evaluatedCount += 1;
        const productCodes = new Set<CommercialPromotionRejectionCode>();
        const structural = commercialProductRejections(item.product, now);
        if (structural.includes('OFFER_UNAVAILABLE')) {
          addProductRejection(
            rejectionSummary,
            productCodes,
            'OFFER_UNAVAILABLE',
          );
        }
        if (structural.includes('OFFER_EXPIRED')) {
          addProductRejection(rejectionSummary, productCodes, 'OFFER_EXPIRED');
        }
        if (
          structural.some(
            (code) => code !== 'OFFER_UNAVAILABLE' && code !== 'OFFER_EXPIRED',
          )
        ) {
          addProductRejection(
            rejectionSummary,
            productCodes,
            'STRUCTURAL_REJECTION',
          );
        }
        if (productCodes.size > 0) continue;
        structurallyEligibleCount += 1;

        const scoreBreakdown = sanitizeCommercialScoreBreakdown(
          this.dependencies.scorePolicies
            .forSource('OFFICIAL')
            .score(item.product),
        );
        if (scoreBreakdown.policyVersion !== 'official-v2') {
          return promotionError(
            'Politica de score oficial inesperada',
            'COMMERCIAL_PROMOTION_SCORE_POLICY_INVALID',
          );
        }
        const match = this.dependencies.matcher.match({
          product: item.product,
          niche,
          finalScore: scoreBreakdown.finalScore,
        });
        if (!match.matched) {
          if (match.reasonCodes.includes('SCORE_BELOW_MINIMUM')) {
            addProductRejection(
              rejectionSummary,
              productCodes,
              'SCORE_BELOW_MINIMUM',
            );
          }
          if (
            match.reasonCodes.some((code) => code !== 'SCORE_BELOW_MINIMUM')
          ) {
            addProductRejection(
              rejectionSummary,
              productCodes,
              'NICHE_NOT_MATCHED',
            );
          }
          continue;
        }
        nicheMatchedCount += 1;

        const invalidSnapshot = snapshotState({
          product: item.product,
          revision: item.commercialSnapshotRevision,
          fingerprint: item.commercialSnapshotFingerprint,
          latestSnapshotRevision: item.latestSnapshotRevision,
          currentSnapshot: item.currentSnapshot,
          previousSnapshot: item.previousSnapshot,
        });
        if (invalidSnapshot) {
          addProductRejection(rejectionSummary, productCodes, invalidSnapshot);
          continue;
        }
        const signalResult = this.dependencies.signalDetector.detect({
          product: item.product,
          currentSnapshot: item.currentSnapshot!,
          previousSnapshot: item.previousSnapshot,
          now,
        });
        if (signalResult.signals.length === 0) {
          addProductRejection(
            rejectionSummary,
            productCodes,
            'NO_PROMOTION_SIGNAL',
          );
          continue;
        }
        promotionMatchedCount += 1;
        const existing = existingByProduct.get(item.product.id) ?? null;
        promotionMatches.push({
          productCodes,
          existing,
          candidate: {
            productId: item.product.id,
            productName: item.product.productName,
            price: item.product.price,
            snapshotId: item.currentSnapshot!.id,
            snapshotRevision: item.currentSnapshot!.revision,
            snapshotFingerprint: item.currentSnapshot!.fingerprint,
            expectedProductUpdatedAt: item.product.updatedAt,
            commercialScore: scoreBreakdown.finalScore,
            scorePolicyVersion: 'official-v2',
            minimumScoreUsed: niche.minimumScore,
            scoreBreakdown,
            promotionSignals: signalResult.signals,
            priceDropPercent: signalResult.priceDropPercent,
            discountRate: item.product.discountRate,
            commissionRate: item.product.commissionRate,
            sales: item.product.sales,
            expiresAt: item.product.offerEndsAt ?? null,
            expectedCandidateStatus: existing?.status ?? null,
            expectedDedupeUntil: existing?.dedupeUntil ?? null,
            expectedCandidateUpdatedAt: existing?.updatedAt ?? null,
          },
        });
      }
      cursor = page.items.at(-1)?.product.id;
      if (!page.hasMore || !cursor) break;
      if (evaluatedCount >= MAX_EVALUATED_PRODUCTS) {
        evaluationTruncated = true;
        increment(
          rejectionSummary,
          'COMMERCIAL_PROMOTION_EVALUATION_TRUNCATED',
        );
      }
    }

    const recentlySent =
      await this.dependencies.candidates.findRecentlySentProductIds({
        productIds: promotionMatches.map(
          ({ candidate }) => candidate.productId,
        ),
        logicalGroupFingerprint: campaign.logicalGroupFingerprint,
        sentAtOrAfter: dedupeSince(now, campaign.dedupeDays),
      });
    let recentlySentRejectedCount = 0;
    let dedupeRejectedCount = 0;
    const eligible: EvaluatedCandidate[] = [];
    for (const match of promotionMatches) {
      if (recentlySent.has(match.candidate.productId)) {
        recentlySentRejectedCount += 1;
        addProductRejection(
          rejectionSummary,
          match.productCodes,
          'RECENTLY_SENT_TO_LOGICAL_GROUP',
        );
        continue;
      }
      if (
        match.existing?.status === 'DISPATCHED' &&
        match.existing.dedupeUntil !== null &&
        match.existing.dedupeUntil > now
      ) {
        dedupeRejectedCount += 1;
        addProductRejection(
          rejectionSummary,
          match.productCodes,
          'DEDUPE_ACTIVE',
        );
        continue;
      }
      if (match.existing && PROTECTED_STATUSES.has(match.existing.status)) {
        addProductRejection(
          rejectionSummary,
          match.productCodes,
          'QUEUE_PROTECTED',
        );
        continue;
      }
      for (const signal of match.candidate.promotionSignals) {
        increment(signalSummary, signal);
      }
      eligible.push(match.candidate);
    }

    const ranked = rankCommercialPromotionCandidates(
      eligible,
    ) as EvaluatedCandidate[];
    const notSelectedCount = Math.max(ranked.length - queueCapacity, 0);
    if (notSelectedCount > 0) {
      rejectionSummary.QUEUE_NOT_SELECTED =
        (rejectionSummary.QUEUE_NOT_SELECTED ?? 0) + notSelectedCount;
    }
    const projected = ranked.slice(
      0,
      Math.min(queueCapacity, MAX_PREVIEW_CANDIDATES),
    );
    const queuedAfter = projected.length;
    const report: CommercialPromotionMiningReport = {
      campaignId,
      preview,
      campaignActive: campaign.active,
      nicheActive: niche.active,
      groupAvailable,
      evaluatedCount,
      evaluationTruncated,
      structurallyEligibleCount,
      nicheMatchedCount,
      promotionMatchedCount,
      recentlySentRejectedCount,
      dedupeRejectedCount,
      protectedCount,
      queueCapacity,
      queuedBefore,
      queuedCreated: 0,
      queuedReactivated: 0,
      queuedUpdated: 0,
      queuedBlocked: 0,
      queuedExpired: 0,
      queuedAfter: preview ? queuedBefore : queuedAfter,
      rejectionSummary,
      signalSummary,
      queueTargetSize: campaign.queueTargetSize,
      queueFull:
        protectedCount + Math.min(ranked.length, queueCapacity) >=
        campaign.queueTargetSize,
      projectedCandidates: preview
        ? projected.map((candidate, index) => ({
            productId: candidate.productId,
            productName: candidate.productName,
            price: candidate.price,
            discountRate: candidate.discountRate,
            commercialScore: candidate.commercialScore,
            promotionSignals: candidate.promotionSignals,
            priceDropPercent: candidate.priceDropPercent,
            projectedRank: index + 1,
            snapshotRevision: candidate.snapshotRevision,
          }))
        : undefined,
    };
    return { campaign, niche, now, ranked, report };
  }

  async preview(campaignId: string, body?: unknown) {
    parseCommercialPromotionPreviewBody(body);
    const result = await this.evaluate(campaignId, true);
    this.dependencies.logger?.info(
      {
        event: 'commercial.promotion.preview.completed',
        evaluatedCount: result.report.evaluatedCount,
        evaluationTruncated: result.report.evaluationTruncated,
        promotionMatchedCount: result.report.promotionMatchedCount,
      },
      'Commercial promotion preview completed',
    );
    return result.report;
  }

  async mine(campaignId: string, body: unknown) {
    parseMineConfirmation(body);
    const result = await this.evaluate(campaignId, false);
    if (!result.campaign.active) {
      return promotionError('Campanha inativa', 'CAMPAIGN_INACTIVE');
    }
    if (!result.niche.active) {
      return promotionError('Nicho inativo', 'NICHE_INACTIVE');
    }
    if (!result.report.groupAvailable) {
      return promotionError('Grupo logico indisponivel', 'GROUP_UNAVAILABLE');
    }
    if (result.report.evaluationTruncated) {
      return promotionError(
        'Catalogo oficial excede o limite seguro de avaliacao',
        'COMMERCIAL_PROMOTION_EVALUATION_TRUNCATED',
      );
    }
    const materialized = await this.dependencies.candidates.materialize({
      campaignId,
      expectedCampaignUpdatedAt: result.campaign.updatedAt,
      nicheId: result.niche.id,
      expectedNicheUpdatedAt: result.niche.updatedAt,
      logicalGroupFingerprint: result.campaign.logicalGroupFingerprint,
      dedupeSince: dedupeSince(result.now, result.campaign.dedupeDays),
      now: result.now,
      rankedCandidates: result.ranked,
    });
    const report = {
      ...result.report,
      ...materialized,
      projectedCandidates: undefined,
    };
    this.dependencies.logger?.info(
      {
        event: 'commercial.promotion.mine.completed',
        evaluatedCount: report.evaluatedCount,
        queuedCreated: report.queuedCreated,
        queuedUpdated: report.queuedUpdated,
        queuedAfter: report.queuedAfter,
      },
      'Commercial promotion mining completed',
    );
    return report;
  }

  async listQueue(
    campaignId: string,
    filters: {
      page: number;
      limit: number;
      status?: CommercialPromotionCandidateRecord['status'];
    },
  ) {
    const campaign = await this.dependencies.campaigns.findById(campaignId);
    if (!campaign) {
      return promotionError(
        'Campanha comercial nao encontrada',
        'COMMERCIAL_GROUP_CAMPAIGN_NOT_FOUND',
      );
    }
    const result = await this.dependencies.candidates.listQueue({
      campaignId,
      ...filters,
    });
    return {
      items: result.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        price: item.price,
        discountRate: item.discountRate,
        commercialScore: item.commercialScore,
        scorePolicyVersion: item.scorePolicyVersion,
        promotionSignals: item.promotionSignals,
        priceDropPercent: item.priceDropPercent,
        rankPosition: item.rankPosition,
        status: item.status,
        snapshotRevision: item.snapshotRevision,
        queuedAt: item.queuedAt.toISOString(),
        expiresAt: item.expiresAt?.toISOString() ?? null,
        dedupeUntil: item.dedupeUntil?.toISOString() ?? null,
        blockedReason: item.blockedReason,
      })),
      page: filters.page,
      limit: filters.limit,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / filters.limit)),
    };
  }
}
