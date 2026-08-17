
import type {
  OfficialShopeeAffiliateOfferProvider,
  ShopeeOfferSort,
} from '@shopee-auto-affiliate-ai/providers';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import { setTimeout } from 'timers/promises';
import {
  countShopeeOfferRejections,
  isValidShopeeProductOffer,
  type ShopeeOfferSyncReport,
} from './shopee-offer-sync-service';
import type { ShopeeOfferRepository } from './repositories';
import {
  assertCompatibleShopeeProductIdentity,
  assertCompleteShopeeProductIdentity,
  SHOPEE_PRODUCT_IDENTITY_INCOMPLETE,
  type ShopeeProductIdentityInput,
} from './shopee-product-identity';
import type { FastifyBaseLogger } from 'fastify';

export type SanitizedShopeeOfficialSyncReport = Pick<
  ShopeeOfferSyncReport,
  | 'fetched'
  | 'valid'
  | 'created'
  | 'updated'
  | 'rejected'
  | 'skipped'
  | 'expired'
  | 'affiliateLinkPresentCount'
  | 'snapshotsCreated'
  | 'snapshotsUnchanged'
  | 'rejectionSummary'
> & {
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  completed: boolean;
  pagesRequested: number;
  pagesCompleted: number;
  pageSize: number;
  maxPages: number;
  duplicatedAcrossPages: number;
  hasNextPage: boolean;
  truncated: boolean;
  failureCode?: string;
  keywordPresent: boolean;
  categoryId?: number;
  sort?: ShopeeOfferSort;
};

export type ShopeeOfficialCatalogSyncOptions = {
  keyword?: string;
  categoryId?: number;
  sort?: ShopeeOfferSort;
  pageSize: number;
  maxPages: number;
  minimumIntervalMs: number;
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

import type { ShopeeOfficialCatalogSyncLock } from './shopee-official-catalog-sync-lock';

export class ShopeeOfficialCatalogSyncService {
  constructor(
    private readonly provider: OfficialShopeeAffiliateOfferProvider,
    private readonly offers: ShopeeOfferRepository,
    private readonly lock: ShopeeOfficialCatalogSyncLock,
    private readonly logger: Pick<FastifyBaseLogger, 'info' | 'error'>,
    private readonly now?: () => Date,
    private readonly sleep?: (ms: number) => Promise<void>,
  ) {}

  async sync(
    options: ShopeeOfficialCatalogSyncOptions,
  ): Promise<SanitizedShopeeOfficialSyncReport> {
    const { pageSize, maxPages } = options;

    if (pageSize * maxPages > 500) {
      throw new AppError(
        'Limite total excede operacao segura',
        'SHOPEE_OFFICIAL_CATALOG_TOTAL_LIMIT_INVALID',
      );
    }

    return await this.lock.runExclusive(async () => {
      return await this._doSync(options);
    });
  }

  private async _doSync(
    options: ShopeeOfficialCatalogSyncOptions,
  ): Promise<SanitizedShopeeOfficialSyncReport> {
    const { pageSize, maxPages, minimumIntervalMs, keyword, categoryId, sort } =
      options;

    const report: SanitizedShopeeOfficialSyncReport = {
      status: 'FAILED',
      completed: false,
      pagesRequested: 0,
      pagesCompleted: 0,
      pageSize,
      maxPages,
      fetched: 0,
      valid: 0,
      created: 0,
      updated: 0,
      rejected: 0,
      skipped: 0,
      expired: 0,
      affiliateLinkPresentCount: 0,
      snapshotsCreated: 0,
      snapshotsUnchanged: 0,
      duplicatedAcrossPages: 0,
      hasNextPage: true,
      truncated: false,
      rejectionSummary: {},
      keywordPresent: Boolean(keyword?.trim()),
      categoryId,
      sort,
    };
    const seenProviderProductIds = new Map<string, ShopeeProductIdentityInput>();
    let hasError = false;

    try {
      let currentPage = 1;
      let currentCursor: string | undefined = undefined;
      const previousCursors = new Set<string>();
      const currentTime = this.now?.() ?? new Date();

      while (currentPage <= maxPages && report.hasNextPage) {
        if (currentPage > 1 && minimumIntervalMs > 0) {
          if (this.sleep) {
            await this.sleep(minimumIntervalMs);
          } else {
            await setTimeout(minimumIntervalMs);
          }
        }

        report.pagesRequested++;



        try {
          const providerPage = await this.provider.listProductOffers({
            keyword,
            categoryId: categoryId ? String(categoryId) : undefined,
            sort,
            page: currentPage,
            cursor: currentCursor,
            limit: pageSize,
          });

          if (providerPage.page !== currentPage) {
            report.failureCode = 'SHOPEE_OFFICIAL_CATALOG_PAGE_SEQUENCE_INVALID';
            throw new AppError(
              'Pagina fora de sequencia detectada',
              'SHOPEE_OFFICIAL_CATALOG_PAGE_SEQUENCE_INVALID',
            );
          }

          if (providerPage.hasNextPage && providerPage.nextCursor !== undefined) {
            if (
              previousCursors.has(providerPage.nextCursor) ||
              providerPage.nextCursor === currentCursor
            ) {
              report.failureCode = 'SHOPEE_OFFICIAL_CATALOG_CURSOR_REPEATED';
              throw new AppError(
                'Cursor repetido detectado na paginacao',
                'SHOPEE_OFFICIAL_CATALOG_CURSOR_REPEATED',
              );
            }
            previousCursors.add(providerPage.nextCursor);
          }

          report.fetched += providerPage.fetchedCount ?? providerPage.items.length;

          for (const rejection of providerPage.rejected ?? []) {
            incrementSanitizedRejection(report.rejectionSummary, rejection.code);
          }

          for (const offer of providerPage.items) {
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
            const previous = seenProviderProductIds.get(identity.key);
            if (previous) {
              assertCompatibleShopeeProductIdentity(previous, offer);
              report.duplicatedAcrossPages++;
              continue;
            }
            seenProviderProductIds.set(identity.key, offer);

            report.valid += 1;
            if (offer.affiliateLink) report.affiliateLinkPresentCount += 1;

            if (offer.offerEndsAt && offer.offerEndsAt <= currentTime) {
              report.expired += 1;
              continue;
            }

            if (offer.source === 'OFFICIAL') {
              const outcome = await this.offers.upsertOfficialOfferWithSnapshot(offer);
              report[outcome.productAction] += 1;
              if (outcome.snapshotCreated) report.snapshotsCreated += 1;
              else report.snapshotsUnchanged += 1;
            }
          }

          report.rejected = countShopeeOfferRejections(report.rejectionSummary);
          report.pagesCompleted++;
          report.hasNextPage = providerPage.hasNextPage;

          if (providerPage.hasNextPage) {
            if (currentPage >= maxPages) {
              report.truncated = true;
            } else {
              currentCursor = providerPage.nextCursor;
            }
          }

          currentPage++;
        } catch (error) {
          if (!report.failureCode) {
            if (error instanceof AppError) {
              report.failureCode = error.code;
            } else {
              report.failureCode = 'SHOPEE_OFFICIAL_CATALOG_SYNC_UNKNOWN_ERROR';
            }
          }
          throw error;
        }
      }
    } catch {
      hasError = true;
      report.status = report.pagesCompleted > 0 ? 'PARTIAL' : 'FAILED';
      this.logger.error(
        { event: 'shopee.official.catalog.sync.failed', code: report.failureCode },
        'Shopee official catalog sync failed',
      );
    }

    if (!hasError) {
      report.status = 'SUCCEEDED';
      report.completed = true;
    }

    this.logger.info(
      { event: 'shopee.official.catalog.sync.finished', ...report },
      'Shopee official catalog sync finished',
    );

    return report;
  }
}
