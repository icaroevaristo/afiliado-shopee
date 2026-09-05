import type { FastifyBaseLogger } from 'fastify';
import type {
  ShopeeAffiliateOfferProvider,
  ShopeeProductOffer,
  ShopeeProductOfferListInput,
} from '@shopee-auto-affiliate-ai/providers';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type { ShopeeOfferRepository } from './repositories';
import {
  assertCompatibleShopeeProductIdentity,
  assertCompleteShopeeProductIdentity,
  SHOPEE_PRODUCT_IDENTITY_INCOMPLETE,
  type ShopeeProductIdentityInput,
} from './shopee-product-identity';

export type ShopeeOfferSyncReport = {
  source: 'mock' | 'manual' | 'official';
  fetched: number;
  valid: number;
  created: number;
  updated: number;
  rejected: number;
  skipped: number;
  expired: number;
  hasNextPage: boolean;
  page?: number;
  nextCursor?: string;
  affiliateLinkPresentCount: number;
  snapshotsCreated: number;
  snapshotsUnchanged: number;
  rejectionSummary: Record<string, number>;
};

const incrementSanitizedRejection = (
  summary: Record<string, number>,
  code: string,
) => {
  const publicCode = /^[A-Z][A-Z0-9_]{0,99}$/.test(code)
    ? code
    : 'SHOPEE_ITEM_REJECTED';
  summary[publicCode] = (summary[publicCode] ?? 0) + 1;
};

export const countShopeeOfferRejections = (
  summary: Readonly<Record<string, number>>,
) => Object.values(summary).reduce((total, count) => total + count, 0);

const isHttpUrl = (value: string) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

const isDecimal = (value: string) => /^\d+(?:\.\d{1,4})?$/.test(value);

export const isValidShopeeProductOffer = (offer: ShopeeProductOffer): boolean =>
  Boolean(offer.providerProductId.trim()) &&
  Boolean(offer.productName.trim()) &&
  Boolean(offer.shopName.trim()) &&
  isDecimal(offer.price) &&
  isDecimal(offer.priceMin) &&
  isDecimal(offer.priceMax) &&
  Number(offer.priceMin) <= Number(offer.priceMax) &&
  offer.discountRate >= 0 &&
  offer.discountRate <= 100 &&
  offer.rating >= 0 &&
  offer.rating <= 5 &&
  Number.isInteger(offer.sales) &&
  offer.sales >= 0 &&
  offer.commissionRate >= 0 &&
  offer.commissionRate <= 100 &&
  isHttpUrl(offer.imageUrl) &&
  isHttpUrl(offer.productLink) &&
  (!offer.affiliateLink || isHttpUrl(offer.affiliateLink)) &&
  offer.fetchedAt instanceof Date &&
  !Number.isNaN(offer.fetchedAt.getTime());

export class ShopeeOfferSyncService {
  constructor(
    private readonly options: {
      provider: ShopeeAffiliateOfferProvider;
      offers: ShopeeOfferRepository;
      maxOffersPerSync: number;
      logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
      now?: () => Date;
    },
  ) {}

  async run(
    input: ShopeeProductOfferListInput = {},
  ): Promise<ShopeeOfferSyncReport> {
    const limit = Math.min(
      Math.max(input.limit ?? this.options.maxOffersPerSync, 1),
      this.options.maxOffersPerSync,
    );
    const source = this.options.provider.source.toLocaleLowerCase() as
      'mock' | 'manual' | 'official';
    const report: ShopeeOfferSyncReport = {
      source,
      fetched: 0,
      valid: 0,
      created: 0,
      updated: 0,
      rejected: 0,
      skipped: 0,
      expired: 0,
      hasNextPage: false,
      affiliateLinkPresentCount: 0,
      snapshotsCreated: 0,
      snapshotsUnchanged: 0,
      rejectionSummary: {},
    };

    this.options.logger.info(
      { event: 'shopee.offers.sync.started', source, limit },
      'Shopee offer sync started',
    );

    try {
      const page = await this.options.provider.listProductOffers({
        ...input,
        limit,
      });
      report.fetched = page.fetchedCount ?? page.items.length;
      for (const rejection of page.rejected ?? []) {
        incrementSanitizedRejection(report.rejectionSummary, rejection.code);
      }
      report.hasNextPage = page.hasNextPage;
      report.page = page.page;
      report.nextCursor = page.nextCursor;
      const seen = new Map<string, ShopeeProductIdentityInput>();
      const now = this.options.now?.() ?? new Date();

      for (const offer of page.items.slice(0, limit)) {
        if (!isValidShopeeProductOffer(offer)) {
          report.skipped += 1;
          incrementSanitizedRejection(
            report.rejectionSummary,
            'SHOPEE_OFFER_INVALID',
          );
          continue;
        }
        let identity: ReturnType<typeof assertCompleteShopeeProductIdentity>;
        try {
          identity = assertCompleteShopeeProductIdentity(offer);
        } catch (error) {
          if (
            error instanceof AppError &&
            error.code === SHOPEE_PRODUCT_IDENTITY_INCOMPLETE
          ) {
            report.skipped += 1;
            incrementSanitizedRejection(report.rejectionSummary, error.code);
            continue;
          }
          throw error;
        }
        const previous = seen.get(identity.key);
        if (previous) {
          assertCompatibleShopeeProductIdentity(previous, offer);
          report.skipped += 1;
          incrementSanitizedRejection(
            report.rejectionSummary,
            'SHOPEE_OFFER_DUPLICATE',
          );
          continue;
        }
        seen.set(identity.key, offer);
        report.valid += 1;
        if (offer.affiliateLink) report.affiliateLinkPresentCount += 1;
        if (offer.offerEndsAt && offer.offerEndsAt <= now) {
          report.expired += 1;
          continue;
        }

        if (offer.source === 'OFFICIAL') {
          const outcome =
            await this.options.offers.upsertOfficialOfferWithSnapshot(offer);
          report[outcome.productAction] += 1;
          if (outcome.snapshotCreated) report.snapshotsCreated += 1;
          else report.snapshotsUnchanged += 1;
          continue;
        }

        const existing =
          await this.options.offers.findBySourceAndProviderProductId(
            offer.source,
            offer.providerProductId,
          );
        if (existing) {
          await this.options.offers.updateOffer(existing.id, offer);
          report.updated += 1;
        } else {
          await this.options.offers.createOffer(offer);
          report.created += 1;
        }
      }

      report.rejected = countShopeeOfferRejections(report.rejectionSummary);

      this.options.logger.info(
        { event: 'shopee.offers.sync.completed', ...report },
        'Shopee offer sync completed',
      );
      return report;
    } catch (error) {
      this.options.logger.error(
        {
          event: 'shopee.offers.sync.failed',
          source,
          code: error instanceof AppError ? error.code : 'UNKNOWN',
        },
        'Shopee offer sync failed',
      );
      throw error;
    }
  }
}
