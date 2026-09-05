import { commercialProductRejections } from './commercial-offer-eligibility';
import {
  OfficialCommercialOfferScorePolicy,
  sanitizeCommercialScoreBreakdown,
} from './commercial-offer-score-policy';
import { CommercialNicheMatcher } from './commercial-niche-matcher';
import { parseCommercialNicheCreate } from './commercial-niche-domain';
import type {
  CommercialNicheRecord,
  CommercialPromotionCatalogRepository,
} from './repositories';

const CATALOG_PAGE_SIZE = 200;
const MAX_EVALUATED_PRODUCTS = 2_000;
const MAX_SAMPLES = 10;

export type CommercialNichePreviewMatchSample = {
  productId: string;
  productName: string;
  price: string;
  discountRate: number;
  rating: number;
  sales: number;
  commissionRate: number;
  finalScore: number;
  categoryIds: string[];
};

export type CommercialNichePreviewRejectionSample = {
  productId: string;
  productName: string;
  reasons: string[];
};

export type CommercialNichePreviewReport = {
  preview: true;
  evaluatedCount: number;
  matchedCount: number;
  rejectedCount: number;
  evaluationTruncated: boolean;
  matchSummary: {
    matched: number;
    rejected: number;
  };
  rejectionSummary: Record<string, number>;
  matches: CommercialNichePreviewMatchSample[];
  rejections: CommercialNichePreviewRejectionSample[];
};

const increment = (summary: Record<string, number>, code: string) => {
  summary[code] = (summary[code] ?? 0) + 1;
};

const addReasonCodes = (
  summary: Record<string, number>,
  codes: readonly string[],
) => {
  const uniqueCodes = new Set(codes);
  for (const code of uniqueCodes) increment(summary, code);
};

const sampleRejection = (
  samples: CommercialNichePreviewRejectionSample[],
  product: CommercialNichePreviewRejectionSample,
) => {
  if (samples.length < MAX_SAMPLES) samples.push(product);
};

const sampleMatch = (
  samples: CommercialNichePreviewMatchSample[],
  product: CommercialNichePreviewMatchSample,
) => {
  if (samples.length < MAX_SAMPLES) samples.push(product);
};

const sourceRejection = 'COMMERCIAL_NICHE_OFFICIAL_PRODUCT_REQUIRED';

export class CommercialNichePreviewService {
  private readonly matcher = new CommercialNicheMatcher();
  private readonly scorePolicy = new OfficialCommercialOfferScorePolicy();

  constructor(
    private readonly catalog: CommercialPromotionCatalogRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async preview(input: unknown): Promise<CommercialNichePreviewReport> {
    const niche = parseCommercialNicheCreate(input);
    const rejectionSummary: Record<string, number> = {};
    const matches: CommercialNichePreviewMatchSample[] = [];
    const rejections: CommercialNichePreviewRejectionSample[] = [];
    const seenProductIds = new Set<string>();
    const now = this.clock();
    const nicheRecord: CommercialNicheRecord = {
      ...niche,
      id: 'preview',
      createdAt: now,
      updatedAt: now,
    };
    let cursor: string | undefined;
    let evaluatedCount = 0;
    let matchedCount = 0;
    let evaluationTruncated = false;

    while (evaluatedCount < MAX_EVALUATED_PRODUCTS) {
      const remaining = MAX_EVALUATED_PRODUCTS - evaluatedCount;
      const page = await this.catalog.listOfficialCatalogPage({
        ...(cursor ? { afterId: cursor } : {}),
        limit: Math.min(CATALOG_PAGE_SIZE, remaining),
      });
      if (page.items.length === 0) break;

      for (const item of page.items) {
        if (seenProductIds.has(item.product.id)) continue;
        seenProductIds.add(item.product.id);
        evaluatedCount += 1;

        if (item.product.source !== 'OFFICIAL') {
          increment(rejectionSummary, sourceRejection);
          sampleRejection(rejections, {
            productId: item.product.id,
            productName: item.product.productName,
            reasons: [sourceRejection],
          });
          continue;
        }

        const structuralReasons = commercialProductRejections(
          item.product,
          now,
        );
        if (structuralReasons.length > 0) {
          addReasonCodes(rejectionSummary, structuralReasons);
          sampleRejection(rejections, {
            productId: item.product.id,
            productName: item.product.productName,
            reasons: structuralReasons,
          });
          continue;
        }

        const score = sanitizeCommercialScoreBreakdown(
          this.scorePolicy.score(item.product),
        );
        const match = this.matcher.match({
          product: item.product,
          niche: nicheRecord,
          finalScore: score.finalScore,
        });
        if (!match.matched) {
          addReasonCodes(rejectionSummary, match.reasonCodes);
          sampleRejection(rejections, {
            productId: item.product.id,
            productName: item.product.productName,
            reasons: match.reasonCodes,
          });
          continue;
        }

        matchedCount += 1;
        sampleMatch(matches, {
          productId: item.product.id,
          productName: item.product.productName,
          price: item.product.price,
          discountRate: item.product.discountRate,
          rating: item.product.rating,
          sales: item.product.sales,
          commissionRate: item.product.commissionRate,
          finalScore: score.finalScore,
          categoryIds: [...item.product.categoryIds],
        });
      }

      const nextCursor = page.items.at(-1)?.product.id;
      if (!page.hasMore || !nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
      if (evaluatedCount >= MAX_EVALUATED_PRODUCTS) {
        evaluationTruncated = true;
        increment(
          rejectionSummary,
          'COMMERCIAL_NICHE_PREVIEW_EVALUATION_TRUNCATED',
        );
        break;
      }
    }

    const rejectedCount = evaluatedCount - matchedCount;
    return {
      preview: true,
      evaluatedCount,
      matchedCount,
      rejectedCount,
      evaluationTruncated,
      matchSummary: { matched: matchedCount, rejected: rejectedCount },
      rejectionSummary,
      matches,
      rejections,
    };
  }
}
