import type { DatabaseClient } from '@shopee-auto-affiliate-ai/database';
import type {
  AnalyticsRepository,
  CommercialAutomationExecutionRecord,
  CommercialAutomationExecutionOwnership,
  CommercialAutomationExecutionRecoveryContext,
  CommercialAutomationExecutionRepository,
  CommercialAutomationHistoryRepository,
  CommercialAutomationSettingsRecord,
  CommercialAutomationSettingsRepository,
  CommercialDeliveryHistoryRepository,
  CommercialConfirmationPersistenceInput,
  CommercialDispatchOutboxFilters,
  CommercialDispatchOutboxPublicationContext,
  CommercialDispatchOutboxRecord,
  CommercialDispatchOutboxRepository,
  CommercialGroupCampaignCreateData,
  CommercialGroupCampaignFilters,
  CommercialGroupCampaignAttemptRelease,
  CommercialGroupCampaignAttemptRepository,
  CommercialGroupCampaignAttemptReservation,
  CommercialGroupCampaignAttemptReservationInput,
  CommercialGroupCampaignRecord,
  CommercialGroupCampaignRepository,
  CommercialGroupCampaignUpdateData,
  CommercialNicheData,
  CommercialNicheFilters,
  CommercialNicheRecord,
  CommercialNicheRepository,
  CommercialOfferCandidateFilters,
  CommercialOfferSnapshotBackfillRepository,
  CommercialPromotionCandidateRecord,
  CommercialPromotionCandidateRepository,
  CommercialPromotionAttemptContext,
  CommercialPromotionCatalogRepository,
  CommercialPromotionCopyContext,
  CommercialPromotionCopyRepository,
  CommercialCopyGenerationAttemptStatusRecord,
  CommercialPromotionMaterializationInput,
  CommercialPromotionSnapshotRecord,
  CommercialPipelineRunData,
  CommercialPipelineRunFilters,
  CommercialPipelineRunRecord,
  CommercialPipelineRunRepository,
  CommercialPipelineRunFinalizationRepository,
  CouponData,
  CouponRecord,
  CouponRepository,
  GeneratedCopyData,
  GeneratedCopyRecord,
  GeneratedCopyRepository,
  ProductLeadData,
  ProductLeadRecord,
  ProductRepository,
  ShopeeOfferFilters,
  ShopeeOfferRecord,
  ShopeeOfferRepository,
  WhatsAppDestinationData,
  WhatsAppDestinationRecord,
  WhatsAppDestinationRepository,
  WhatsAppDestinationUpdate,
  WhatsAppDispatchCreateData,
  WhatsAppDispatchDetails,
  WhatsAppDispatchFilters,
  WhatsAppDispatchRecord,
  WhatsAppDispatchRepository,
  WhatsAppDispatchStatus,
  WhatsAppGroupCreateData,
  WhatsAppGroupDirectoryRepository,
  WhatsAppGroupFilters,
  WhatsAppGroupRecord,
  WhatsAppGroupUpdate,
} from './repositories';
import {
  fingerprintWhatsAppGroupId,
  type ShopeeProductOffer,
} from '@shopee-auto-affiliate-ai/providers';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import { APPROVED_PRODUCT_MIN_SCORE } from './repositories';
import {
  COMMERCIAL_EXECUTION_OWNERSHIP_LOST,
  isCommercialAutomationExecutionStale,
} from './commercial-automation-execution-domain';
import {
  fingerprintCommercialOffer,
  type CommercialOfferFingerprintInput,
} from './commercial-offer-snapshot';
import { sha256 } from './commercial-ai-copy-fingerprint';
import { sanitizeCommercialAiCopyValidationFailureCodes } from './commercial-ai-copy-validator';
import { isSafeAssembledCommercialPromotionCopy } from './commercial-promotion-copy-assembler';

import {
  assertCompatibleShopeeProductIdentity,
  assertCompleteShopeeProductIdentity,
} from './shopee-product-identity';

const prismaErrorCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;

const isUniqueConstraintError = (error: unknown) =>
  prismaErrorCode(error) === 'P2002';

const isRecordNotFoundError = (error: unknown) =>
  prismaErrorCode(error) === 'P2025';

const isTransactionConflictError = (error: unknown) =>
  prismaErrorCode(error) === 'P2034';

const isPrismaKnownError = (error: unknown) =>
  /^P\d{4}$/.test(prismaErrorCode(error) ?? '');

const databaseErrorCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'meta' in error
    ? String((error as { meta?: { code?: unknown } }).meta?.code ?? '')
    : '';

class CommercialConfirmationNotClaimedError extends Error {}
class CommercialOutboxStateConflictError extends Error {}
class OfficialOfferSnapshotConflictError extends Error {}
class CommercialPromotionMiningConflictError extends Error {}

type PrismaDecimalLike = { toString(): string } | number | string;

const decimalString = (value: PrismaDecimalLike | null | undefined) =>
  value === null || value === undefined ? undefined : value.toString();

const decimalNumber = (value: PrismaDecimalLike | null | undefined) =>
  value === null || value === undefined ? 0 : Number(value.toString());

const mapProductLead = (record: Record<string, unknown>): ProductLeadRecord => {
  const publicRecord = { ...record };
  delete publicRecord.commercialSnapshotRevision;
  delete publicRecord.commercialSnapshotFingerprint;
  delete publicRecord.commercialOfferSnapshots;
  return {
    ...(publicRecord as unknown as ProductLeadRecord),
    preco: decimalNumber(record.preco as PrismaDecimalLike),
    comissao: Number(record.comissao),
    url: (record.productLink as string | null | undefined) ?? null,
    commissionAmount:
      decimalString(record.commissionAmount as PrismaDecimalLike | null) ??
      null,
  };
};

const toPrismaProductData = (data: ProductLeadData) => ({
  source: 'MOCK' as const,
  providerProductId: data.providerProductId,
  nome: data.nome,
  categoria: data.categoria,
  preco: data.preco,
  desconto: data.desconto,
  nota: data.nota,
  vendidos: data.vendidos,
  comissao: data.comissao,
  loja: data.loja,
  urlImagem: data.urlImagem,
  productLink: data.url,
  title: data.title,
  fetchedAt: new Date(),
  lastSeenAt: new Date(),
});

const mapShopeeOffer = (
  record: Record<string, unknown>,
): ShopeeOfferRecord => ({
  id: String(record.id),
  source: record.source as ShopeeOfferRecord['source'],
  providerProductId: String(record.providerProductId),
  productName: String(record.nome),
  shopId: (record.shopId as string | null) ?? undefined,
  shopType: (record.shopType as number[]) ?? [],
  shopName: String(record.loja),
  categoryIds: (record.categoryIds as string[]) ?? [],
  price: decimalString(record.preco as PrismaDecimalLike) as string,
  priceMin:
    decimalString(record.precoMin as PrismaDecimalLike | null) ??
    (decimalString(record.preco as PrismaDecimalLike) as string),
  priceMax:
    decimalString(record.precoMax as PrismaDecimalLike | null) ??
    (decimalString(record.preco as PrismaDecimalLike) as string),
  discountRate: Number(record.desconto),
  rating: Number(record.nota),
  sales: Number(record.vendidos),
  commissionRate: Number(record.comissao),
  commissionAmount: decimalString(
    record.commissionAmount as PrismaDecimalLike | null,
  ),
  sellerCommissionRate:
    (record.sellerCommissionRate as number | null) ?? undefined,
  shopeeCommissionRate:
    (record.shopeeCommissionRate as number | null) ?? undefined,
  imageUrl: String(record.urlImagem),
  productLink: String(record.productLink ?? ''),
  affiliateLink: (record.affiliateLink as string | null) ?? undefined,
  offerStartsAt: (record.offerStartsAt as Date | null) ?? undefined,
  offerEndsAt: (record.offerEndsAt as Date | null) ?? undefined,
  fetchedAt: record.fetchedAt as Date,
  lastSeenAt: record.lastSeenAt as Date,
  unavailableAt: (record.unavailableAt as Date | null) ?? undefined,
  score: (record.score as number | null) ?? null,
  scoreUpdatedAt: (record.scoreUpdatedAt as Date | null) ?? null,
  createdAt: record.createdAt as Date,
  updatedAt: record.updatedAt as Date,
});

const toPrismaShopeeOffer = (offer: ShopeeProductOffer) => ({
  source: offer.source,
  providerProductId: offer.providerProductId,
  nome: offer.productName,
  categoria: offer.categoryIds[0] ?? 'Sem categoria',
  categoryIds: offer.categoryIds,
  preco: offer.price,
  precoMin: offer.priceMin,
  precoMax: offer.priceMax,
  desconto: offer.discountRate,
  nota: offer.rating,
  vendidos: offer.sales,
  comissao: offer.commissionRate,
  commissionAmount: offer.commissionAmount,
  sellerCommissionRate: offer.sellerCommissionRate,
  shopeeCommissionRate: offer.shopeeCommissionRate,
  loja: offer.shopName,
  shopId: offer.shopId,
  shopType: offer.shopType ?? [],
  urlImagem: offer.imageUrl,
  productLink: offer.productLink,
  affiliateLink: offer.affiliateLink,
  offerStartsAt: offer.offerStartsAt,
  offerEndsAt: offer.offerEndsAt,
  fetchedAt: offer.fetchedAt,
  lastSeenAt: new Date(),
  unavailableAt: null,
  title: offer.productName,
});

const officialSnapshotConflict = () =>
  new AppError(
    'Estado do snapshot oficial mudou durante a atualizacao',
    'SHOPEE_OFFICIAL_SNAPSHOT_CONFLICT',
  );

type CommercialSnapshotMaterial = CommercialOfferFingerprintInput & {
  observedRating: number;
  observedSales: number;
  capturedAt: Date;
};

const snapshotMaterialFromOffer = (
  offer: ShopeeProductOffer,
): CommercialSnapshotMaterial => ({
  source: offer.source,
  providerProductId: offer.providerProductId,
  productLink: offer.productLink,
  affiliateLink: offer.affiliateLink ?? null,
  price: offer.price,
  priceMin: offer.priceMin,
  priceMax: offer.priceMax,
  discountRate: offer.discountRate,
  commissionRate: offer.commissionRate,
  observedRating: offer.rating,
  observedSales: offer.sales,
  offerStartsAt: offer.offerStartsAt,
  offerEndsAt: offer.offerEndsAt,
  unavailableAt: null,
  capturedAt: offer.fetchedAt,
});

const snapshotMaterialFromPersistedOffer = (
  record: Record<string, unknown>,
): CommercialSnapshotMaterial => ({
  source: record.source as CommercialOfferFingerprintInput['source'],
  providerProductId: String(record.providerProductId),
  productLink: (record.productLink as string | null) ?? null,
  affiliateLink: (record.affiliateLink as string | null) ?? null,
  price: decimalString(record.preco as PrismaDecimalLike) as string,
  priceMin: decimalString(record.precoMin as PrismaDecimalLike | null) ?? null,
  priceMax: decimalString(record.precoMax as PrismaDecimalLike | null) ?? null,
  discountRate: Number(record.desconto),
  commissionRate: Number(record.comissao),
  observedRating: Number(record.nota),
  observedSales: Number(record.vendidos),
  offerStartsAt: (record.offerStartsAt as Date | null) ?? null,
  offerEndsAt: (record.offerEndsAt as Date | null) ?? null,
  unavailableAt: (record.unavailableAt as Date | null) ?? null,
  capturedAt: record.fetchedAt as Date,
});

const snapshotData = (
  material: CommercialSnapshotMaterial,
  productId: string,
  revision: number,
  fingerprint: string,
) => ({
  productId,
  revision,
  fingerprint,
  price: material.price,
  priceMin: material.priceMin,
  priceMax: material.priceMax,
  discountRate: material.discountRate,
  commissionRate: material.commissionRate,
  observedRating: material.observedRating,
  observedSales: material.observedSales,
  offerStartsAt: material.offerStartsAt,
  offerEndsAt: material.offerEndsAt,
  unavailableAt: material.unavailableAt,
  capturedAt: material.capturedAt,
});

const throwOfficialSnapshotPersistenceError = (error: unknown): never => {
  if (
    error instanceof OfficialOfferSnapshotConflictError ||
    isUniqueConstraintError(error) ||
    isRecordNotFoundError(error) ||
    isTransactionConflictError(error)
  ) {
    throw officialSnapshotConflict();
  }
  if (isPrismaKnownError(error)) {
    throw new AppError(
      'Falha ao persistir snapshot oficial',
      'SHOPEE_OFFICIAL_SNAPSHOT_PERSISTENCE_FAILED',
    );
  }
  throw error;
};

export class PrismaAnalyticsRepository implements AnalyticsRepository {
  constructor(
    private readonly prisma: Pick<
      DatabaseClient,
      | 'productLead'
      | 'generatedCopy'
      | 'whatsAppDispatch'
      | 'whatsAppDestination'
    >,
  ) {}

  totalProducts(): Promise<number> {
    return this.prisma.productLead.count();
  }

  totalApprovedProducts(): Promise<number> {
    return this.prisma.productLead.count({
      where: { score: { gte: APPROVED_PRODUCT_MIN_SCORE } },
    });
  }

  totalGeneratedCopies(): Promise<number> {
    return this.prisma.generatedCopy.count();
  }

  totalQueuedDispatches(): Promise<number> {
    return this.prisma.whatsAppDispatch.count({
      where: { status: 'PENDING' },
    });
  }

  totalSentDispatches(): Promise<number> {
    return this.prisma.whatsAppDispatch.count({
      where: { status: 'SENT' },
    });
  }

  totalFailedDispatches(): Promise<number> {
    return this.prisma.whatsAppDispatch.count({
      where: { status: 'FAILED' },
    });
  }

  totalActiveDestinations(): Promise<number> {
    return this.prisma.whatsAppDestination.count({
      where: { active: true, type: 'INDIVIDUAL' },
    });
  }
}

export class PrismaProductRepository implements ProductRepository {
  constructor(private readonly prisma: Pick<DatabaseClient, 'productLead'>) {}

  async findById(id: string): Promise<ProductLeadRecord | null> {
    const record = await this.prisma.productLead.findUnique({
      where: { id },
    });
    return record
      ? mapProductLead(record as unknown as Record<string, unknown>)
      : null;
  }

  async findByProviderProductId(providerProductId: string) {
    return this.prisma.productLead.findUnique({
      where: {
        source_providerProductId: { source: 'MOCK', providerProductId },
      },
      select: { id: true },
    });
  }

  async create(data: ProductLeadData): Promise<ProductLeadRecord> {
    const record = await this.prisma.productLead.create({
      data: toPrismaProductData(data),
    });
    return mapProductLead(record as unknown as Record<string, unknown>);
  }

  async updateByProviderProductId(
    providerProductId: string,
    data: ProductLeadData,
  ): Promise<ProductLeadRecord> {
    const record = await this.prisma.productLead.update({
      where: {
        source_providerProductId: { source: 'MOCK', providerProductId },
      },
      data: toPrismaProductData(data),
    });
    return mapProductLead(record as unknown as Record<string, unknown>);
  }

  async listForScoring(): Promise<ProductLeadRecord[]> {
    const records = await this.prisma.productLead.findMany({
      where: {
        unavailableAt: null,
        OR: [{ offerEndsAt: null }, { offerEndsAt: { gt: new Date() } }],
      },
    });
    return records.map((record) =>
      mapProductLead(record as unknown as Record<string, unknown>),
    );
  }

  async updateScore(
    id: string,
    score: number,
    scoreUpdatedAt: Date,
  ): Promise<ProductLeadRecord> {
    const record = await this.prisma.productLead.update({
      where: { id },
      data: { score, scoreUpdatedAt },
    });
    return mapProductLead(record as unknown as Record<string, unknown>);
  }

  async listApproved(minScore: number): Promise<ProductLeadRecord[]> {
    const records = await this.prisma.productLead.findMany({
      where: { score: { gte: minScore } },
    });
    return records.map((record) =>
      mapProductLead(record as unknown as Record<string, unknown>),
    );
  }
}

export class PrismaShopeeOfferRepository
  implements ShopeeOfferRepository, CommercialOfferSnapshotBackfillRepository
{
  constructor(private readonly prisma: DatabaseClient) {}

  async findBySourceAndProviderProductId(
    source: ShopeeOfferRecord['source'],
    providerProductId: string,
  ) {
    return this.prisma.productLead.findUnique({
      where: { source_providerProductId: { source, providerProductId } },
      select: { id: true },
    });
  }

  async createOffer(offer: ShopeeProductOffer): Promise<ShopeeOfferRecord> {
    const record = await this.prisma.productLead.create({
      data: toPrismaShopeeOffer(offer),
    });
    return mapShopeeOffer(record as unknown as Record<string, unknown>);
  }

  async updateOffer(
    id: string,
    offer: ShopeeProductOffer,
  ): Promise<ShopeeOfferRecord> {
    const record = await this.prisma.productLead.update({
      where: { id },
      data: toPrismaShopeeOffer(offer),
    });
    return mapShopeeOffer(record as unknown as Record<string, unknown>);
  }

  async upsertOfficialOfferWithSnapshot(offer: ShopeeProductOffer) {
    if (offer.source !== 'OFFICIAL') {
      throw new AppError(
        'Snapshot comercial exige oferta oficial',
        'SHOPEE_OFFICIAL_SNAPSHOT_SOURCE_REQUIRED',
      );
    }
    assertCompleteShopeeProductIdentity(offer);
    const material = snapshotMaterialFromOffer(offer);
    const fingerprint = fingerprintCommercialOffer(material);
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const current = await transaction.productLead.findUnique({
            where: {
              source_providerProductId: {
                source: 'OFFICIAL',
                providerProductId: offer.providerProductId,
              },
            },
          });
          if (!current) {
            const product = await transaction.productLead.create({
              data: {
                ...toPrismaShopeeOffer(offer),
                commercialSnapshotRevision: 1,
                commercialSnapshotFingerprint: fingerprint,
              },
            });
            await transaction.commercialOfferSnapshot.create({
              data: snapshotData(material, product.id, 1, fingerprint),
            });
            return {
              product: mapShopeeOffer(
                product as unknown as Record<string, unknown>,
              ),
              productAction: 'created' as const,
              commercialStateChanged: true,
              snapshotCreated: true,
              snapshotRevision: 1,
            };
          }

          assertCompatibleShopeeProductIdentity(
            {
              source: 'OFFICIAL',
              providerProductId: current.providerProductId,
              shopId: current.shopId ?? undefined,
            },
            offer,
          );
          const currentRevision = current.commercialSnapshotRevision;
          const currentFingerprint = current.commercialSnapshotFingerprint;
          const lastSnapshot =
            await transaction.commercialOfferSnapshot.findFirst({
              where: { productId: current.id },
              orderBy: { revision: 'desc' },
              select: { revision: true, fingerprint: true },
            });
          const coherent =
            currentRevision === 0
              ? currentFingerprint === null && lastSnapshot === null
              : currentFingerprint !== null &&
                lastSnapshot?.revision === currentRevision &&
                lastSnapshot.fingerprint === currentFingerprint;
          if (!coherent) throw new OfficialOfferSnapshotConflictError();

          const commercialStateChanged = currentFingerprint !== fingerprint;
          const snapshotRevision = commercialStateChanged
            ? currentRevision + 1
            : currentRevision;
          const product = await transaction.productLead.update({
            where: {
              id: current.id,
              source: 'OFFICIAL',
              commercialSnapshotRevision: currentRevision,
              commercialSnapshotFingerprint: currentFingerprint,
            },
            data: {
              ...toPrismaShopeeOffer(offer),
              commercialSnapshotRevision: snapshotRevision,
              commercialSnapshotFingerprint: commercialStateChanged
                ? fingerprint
                : currentFingerprint,
            },
          });
          if (commercialStateChanged) {
            await transaction.commercialOfferSnapshot.create({
              data: snapshotData(
                material,
                current.id,
                snapshotRevision,
                fingerprint,
              ),
            });
          }
          return {
            product: mapShopeeOffer(
              product as unknown as Record<string, unknown>,
            ),
            productAction: 'updated' as const,
            commercialStateChanged,
            snapshotCreated: commercialStateChanged,
            snapshotRevision,
          };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      return throwOfficialSnapshotPersistenceError(error);
    }
  }

  countOfficialProducts() {
    return this.prisma.productLead.count({ where: { source: 'OFFICIAL' } });
  }

  countOfficialProductsPendingSnapshot() {
    return this.prisma.productLead.count({
      where: { source: 'OFFICIAL', commercialSnapshotRevision: 0 },
    });
  }

  async listOfficialProductIdsPendingSnapshot(limit: number) {
    const records = await this.prisma.productLead.findMany({
      where: { source: 'OFFICIAL', commercialSnapshotRevision: 0 },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return records.map(({ id }) => id);
  }

  async initializeOfficialProductSnapshot(productId: string) {
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const current = await transaction.productLead.findUnique({
            where: { id: productId },
          });
          if (!current || current.source !== 'OFFICIAL') return false;
          if (current.commercialSnapshotRevision > 0) return false;
          if (current.commercialSnapshotFingerprint !== null) {
            throw new OfficialOfferSnapshotConflictError();
          }
          const existingSnapshot =
            await transaction.commercialOfferSnapshot.findFirst({
              where: { productId },
              select: { id: true },
            });
          if (existingSnapshot) throw new OfficialOfferSnapshotConflictError();

          const record = current as unknown as Record<string, unknown>;
          const material = snapshotMaterialFromPersistedOffer(record);
          const fingerprint = fingerprintCommercialOffer(material);
          const updated = await transaction.productLead.updateMany({
            where: {
              id: productId,
              source: 'OFFICIAL',
              commercialSnapshotRevision: 0,
              commercialSnapshotFingerprint: null,
            },
            data: {
              commercialSnapshotRevision: 1,
              commercialSnapshotFingerprint: fingerprint,
            },
          });
          if (updated.count !== 1) return false;
          await transaction.commercialOfferSnapshot.create({
            data: snapshotData(material, productId, 1, fingerprint),
          });
          return true;
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      return throwOfficialSnapshotPersistenceError(error);
    }
  }

  async findOfferById(id: string): Promise<ShopeeOfferRecord | null> {
    const record = await this.prisma.productLead.findUnique({ where: { id } });
    return record
      ? mapShopeeOffer(record as unknown as Record<string, unknown>)
      : null;
  }

  async listOffers(filters: ShopeeOfferFilters) {
    const now = new Date();
    const statusWhere =
      filters.status === 'UNAVAILABLE'
        ? { unavailableAt: { not: null } }
        : filters.status === 'EXPIRED'
          ? { unavailableAt: null, offerEndsAt: { lte: now } }
          : filters.status === 'ACTIVE'
            ? {
                unavailableAt: null,
                OR: [{ offerEndsAt: null }, { offerEndsAt: { gt: now } }],
              }
            : {};
    const where = {
      source: filters.source,
      affiliateLink:
        filters.affiliateLink === 'present'
          ? { not: null }
          : filters.affiliateLink === 'missing'
            ? null
            : undefined,
      AND: [
        ...(filters.keyword
          ? [
              {
                OR: [
                  {
                    nome: {
                      contains: filters.keyword,
                      mode: 'insensitive' as const,
                    },
                  },
                  {
                    loja: {
                      contains: filters.keyword,
                      mode: 'insensitive' as const,
                    },
                  },
                ],
              },
            ]
          : []),
        statusWhere,
      ],
    };
    const [records, total] = await Promise.all([
      this.prisma.productLead.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.productLead.count({ where }),
    ]);
    return {
      items: records.map((record) =>
        mapShopeeOffer(record as unknown as Record<string, unknown>),
      ),
      total,
    };
  }

  async listCommercialCandidates(filters: CommercialOfferCandidateFilters) {
    const records = await this.prisma.productLead.findMany({
      where: {
        source: filters.source,
        categoryIds: filters.categoryId
          ? { has: filters.categoryId }
          : undefined,
        preco: {
          gte: filters.minPrice,
          lte: filters.maxPrice,
        },
        desconto:
          filters.minDiscountRate === undefined
            ? undefined
            : { gte: filters.minDiscountRate },
        nota:
          filters.minRating === undefined
            ? undefined
            : { gte: filters.minRating },
        vendidos:
          filters.minSales === undefined
            ? undefined
            : { gte: filters.minSales },
        comissao:
          filters.minCommissionRate === undefined
            ? undefined
            : { gte: filters.minCommissionRate },
      },
      orderBy: { providerProductId: 'asc' },
      take: filters.limit,
    });
    return records.map((record) =>
      mapShopeeOffer(record as unknown as Record<string, unknown>),
    );
  }
}

const mapCommercialNiche = (
  record: Record<string, unknown>,
): CommercialNicheRecord => ({
  ...(record as unknown as CommercialNicheRecord),
  minPrice: decimalString(record.minPrice as PrismaDecimalLike | null) ?? null,
  maxPrice: decimalString(record.maxPrice as PrismaDecimalLike | null) ?? null,
});

export class PrismaCommercialNicheRepository implements CommercialNicheRepository {
  constructor(
    private readonly prisma: Pick<DatabaseClient, 'commercialNiche'>,
  ) {}

  async create(data: CommercialNicheData): Promise<CommercialNicheRecord> {
    try {
      const record = await this.prisma.commercialNiche.create({ data });
      return mapCommercialNiche(record as unknown as Record<string, unknown>);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AppError(
          'Ja existe um nicho com este slug',
          'COMMERCIAL_NICHE_SLUG_CONFLICT',
        );
      }
      throw error;
    }
  }

  async list(filters: CommercialNicheFilters) {
    const where = { active: filters.active };
    const [records, total] = await Promise.all([
      this.prisma.commercialNiche.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.commercialNiche.count({ where }),
    ]);
    return {
      items: records.map((record) =>
        mapCommercialNiche(record as unknown as Record<string, unknown>),
      ),
      total,
    };
  }

  async findById(id: string) {
    const record = await this.prisma.commercialNiche.findUnique({
      where: { id },
    });
    return record
      ? mapCommercialNiche(record as unknown as Record<string, unknown>)
      : null;
  }

  async update(id: string, data: Partial<Omit<CommercialNicheData, 'slug'>>) {
    try {
      const record = await this.prisma.commercialNiche.update({
        where: { id },
        data,
      });
      return mapCommercialNiche(record as unknown as Record<string, unknown>);
    } catch (error) {
      if (isRecordNotFoundError(error)) return null;
      throw error;
    }
  }
}

const commercialCampaignInclude = {
  niche: { select: { id: true, name: true, slug: true, active: true } },
  anchorDestination: {
    select: {
      id: true,
      name: true,
      fingerprint: true,
      active: true,
      available: true,
    },
  },
};

type CommercialGroupCampaignPrismaClient = Pick<
  DatabaseClient,
  'commercialGroupCampaign'
>;

const findCommercialGroupCampaign = (
  client: CommercialGroupCampaignPrismaClient,
  where: { id: string } | { logicalGroupFingerprint: string },
) =>
  client.commercialGroupCampaign.findUnique({
    where,
    include: commercialCampaignInclude,
  });

type CommercialGroupCampaignWithRelations = NonNullable<
  Awaited<ReturnType<typeof findCommercialGroupCampaign>>
>;

const mapCommercialGroupCampaign = (
  record: CommercialGroupCampaignWithRelations,
): CommercialGroupCampaignRecord => {
  const anchor = record.anchorDestination;
  return {
    ...record,
    failureCount: record.failureCount,
    nextEligibleAt: record.nextEligibleAt,
    attemptExecutionId: record.attemptExecutionId,
    attemptReservedAt: record.attemptReservedAt,
    attemptLeaseExpiresAt: record.attemptLeaseExpiresAt,
    anchorDestination: anchor
      ? {
          id: anchor.id,
          name: anchor.name,
          fingerprint: anchor.fingerprint,
          active: anchor.active,
          available: anchor.available,
        }
      : null,
  };
};

export class PrismaCommercialGroupCampaignRepository implements CommercialGroupCampaignRepository {
  private readonly attemptRepository: PrismaCommercialGroupCampaignAttemptRepository;

  constructor(private readonly prisma: DatabaseClient) {
    this.attemptRepository = new PrismaCommercialGroupCampaignAttemptRepository(
      prisma.commercialGroupCampaign,
    );
  }

  async createForGroup(data: CommercialGroupCampaignCreateData) {
    try {
      const record = await this.prisma.$transaction(async (transaction) => {
        const destination = await transaction.whatsAppDestination.findUnique({
          where: { id: data.groupDestinationId },
          select: {
            id: true,
            destination: true,
            type: true,
            fingerprint: true,
          },
        });
        if (!destination) {
          throw new AppError(
            'Destino de grupo nao encontrado',
            'COMMERCIAL_GROUP_DESTINATION_NOT_FOUND',
          );
        }
        if (destination.type !== 'GROUP') {
          throw new AppError(
            'A campanha exige destino GROUP',
            'COMMERCIAL_GROUP_DESTINATION_REQUIRED',
          );
        }
        let logicalFingerprint: string;
        try {
          logicalFingerprint = fingerprintWhatsAppGroupId(
            destination.destination,
          );
        } catch {
          throw new AppError(
            'Identidade logica do grupo e invalida',
            'COMMERCIAL_GROUP_IDENTITY_INVALID',
          );
        }
        if (
          !destination.fingerprint ||
          destination.fingerprint !== logicalFingerprint
        ) {
          throw new AppError(
            'Identidade logica do grupo e inconsistente',
            'COMMERCIAL_GROUP_IDENTITY_INVALID',
          );
        }
        const niche = await transaction.commercialNiche.findUnique({
          where: { id: data.nicheId },
          select: { id: true },
        });
        if (!niche) {
          throw new AppError(
            'Nicho comercial nao encontrado',
            'COMMERCIAL_NICHE_NOT_FOUND',
          );
        }
        const configuration = {
          name: data.name,
          nicheId: data.nicheId,
          cadenceMinutes: data.cadenceMinutes,
          timezone: data.timezone,
          allowedStartTime: data.allowedStartTime,
          allowedEndTime: data.allowedEndTime,
          dailyLimit: data.dailyLimit,
          queueTargetSize: data.queueTargetSize,
          dedupeDays: data.dedupeDays,
        };
        return transaction.commercialGroupCampaign.create({
          data: {
            ...configuration,
            active: false,
            logicalGroupFingerprint: logicalFingerprint,
            anchorDestinationId: destination.id,
          },
          include: commercialCampaignInclude,
        });
      });
      return mapCommercialGroupCampaign(record);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AppError(
          'Ja existe campanha para este grupo logico',
          'COMMERCIAL_GROUP_CAMPAIGN_ALREADY_EXISTS',
        );
      }
      throw error;
    }
  }

  async list(filters: CommercialGroupCampaignFilters) {
    const where = { active: filters.active };
    const [records, total] = await Promise.all([
      this.prisma.commercialGroupCampaign.findMany({
        where,
        include: commercialCampaignInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.commercialGroupCampaign.count({ where }),
    ]);
    return {
      items: records.map((record) => mapCommercialGroupCampaign(record)),
      total,
    };
  }

  async findById(id: string) {
    const record = await findCommercialGroupCampaign(this.prisma, { id });
    return record
      ? mapCommercialGroupCampaign(record)
      : null;
  }

  async findByLogicalGroupFingerprint(logicalGroupFingerprint: string) {
    const record = await findCommercialGroupCampaign(this.prisma, {
      logicalGroupFingerprint,
    });
    return record
      ? mapCommercialGroupCampaign(record)
      : null;
  }

  async update(id: string, data: CommercialGroupCampaignUpdateData) {
    try {
      const updateCampaign = async (
        client: Pick<DatabaseClient, 'commercialGroupCampaign' | 'commercialNiche'>,
      ) => {
        if (data.nicheId) {
          const [campaign, niche] = await Promise.all([
            client.commercialGroupCampaign.findUnique({
              where: { id },
              select: { active: true },
            }),
            client.commercialNiche.findUnique({
              where: { id: data.nicheId },
              select: { active: true },
            }),
          ]);
          if (!campaign) return null;
          if (!niche) {
            throw new AppError(
              'Nicho comercial nao encontrado',
              'COMMERCIAL_NICHE_NOT_FOUND',
            );
          }
          if (campaign.active && !niche.active) {
            throw new AppError(
              'Campanha ativa exige nicho ativo',
              'COMMERCIAL_GROUP_CAMPAIGN_NICHE_INACTIVE',
            );
          }
        }
        return client.commercialGroupCampaign.update({
          where: { id },
          data,
          include: commercialCampaignInclude,
        });
      };
      const record = data.nicheId
        ? await this.prisma.$transaction(updateCampaign, {
            isolationLevel: 'Serializable',
          })
        : await updateCampaign(this.prisma);
      if (!record) return null;
      return mapCommercialGroupCampaign(record);
    } catch (error) {
      if (isRecordNotFoundError(error)) return null;
      if (isTransactionConflictError(error)) {
        throw new AppError(
          'Estado da campanha mudou durante a atualizacao',
          'COMMERCIAL_GROUP_CAMPAIGN_STATE_CONFLICT',
        );
      }
      throw error;
    }
  }

  async hasEligibleDestination(logicalGroupFingerprint: string) {
    const record = await this.prisma.whatsAppDestination.findFirst({
      where: {
        type: 'GROUP',
        fingerprint: logicalGroupFingerprint,
        active: true,
        available: true,
        sourceInstanceName: { not: null },
      },
      select: { id: true },
    });
    return Boolean(record);
  }

  async activateIfEligible(id: string) {
    try {
      const record = await this.prisma.$transaction(
        async (transaction) => {
          const campaign = await transaction.commercialGroupCampaign.findUnique(
            {
              where: { id },
              select: {
                logicalGroupFingerprint: true,
                niche: { select: { active: true } },
              },
            },
          );
          if (!campaign) return null;
          if (!campaign.niche.active) {
            throw new AppError(
              'Campanha exige nicho ativo',
              'COMMERCIAL_GROUP_CAMPAIGN_NICHE_INACTIVE',
            );
          }
          const eligible = await transaction.whatsAppDestination.findFirst({
            where: {
              type: 'GROUP',
              fingerprint: campaign.logicalGroupFingerprint,
              active: true,
              available: true,
              sourceInstanceName: { not: null },
            },
            select: { id: true },
          });
          if (!eligible) {
            throw new AppError(
              'Grupo logico nao possui destino elegivel',
              'COMMERCIAL_GROUP_CAMPAIGN_GROUP_UNAVAILABLE',
            );
          }
          return transaction.commercialGroupCampaign.update({
            where: { id },
            data: { active: true },
            include: commercialCampaignInclude,
          });
        },
        { isolationLevel: 'Serializable' },
      );
      return record ? mapCommercialGroupCampaign(record) : null;
    } catch (error) {
      if (isTransactionConflictError(error)) {
        throw new AppError(
          'Estado da campanha mudou durante a ativacao',
          'COMMERCIAL_GROUP_CAMPAIGN_STATE_CONFLICT',
        );
      }
      throw error;
    }
  }

  async reserveAttempt(input: CommercialGroupCampaignAttemptReservationInput) {
    return this.attemptRepository.reserve(input);
  }

  async releaseAttempt(input: {
    campaignId: string;
    executionId: string;
  }) {
    return this.attemptRepository.release(input);
  }
}

type CommercialGroupCampaignAttemptState = {
  attemptExecutionId: string | null;
  attemptReservedAt: Date | null;
  attemptLeaseExpiresAt: Date | null;
};

type CommercialGroupCampaignAttemptPrismaDelegate = {
  updateMany(input: {
    where: { id: string; attemptExecutionId: string | null };
    data: CommercialGroupCampaignAttemptState;
  }): Promise<{ count: number }>;
  findUnique(input: {
    where: { id: string };
    select: {
      attemptExecutionId: true;
      attemptReservedAt: true;
      attemptLeaseExpiresAt: true;
    };
  }): Promise<CommercialGroupCampaignAttemptState | null>;
};

export class PrismaCommercialGroupCampaignAttemptRepository
  implements CommercialGroupCampaignAttemptRepository
{
  constructor(
    private readonly campaigns: CommercialGroupCampaignAttemptPrismaDelegate,
  ) {}

  async reserve(
    input: CommercialGroupCampaignAttemptReservationInput,
  ): Promise<CommercialGroupCampaignAttemptReservation> {
    const reserved = await this.campaigns.updateMany({
      where: { id: input.campaignId, attemptExecutionId: null },
      data: {
        attemptExecutionId: input.executionId,
        attemptReservedAt: input.reservedAt,
        attemptLeaseExpiresAt: input.leaseExpiresAt,
      },
    });
    if (reserved.count === 1) {
      return {
        kind: 'RESERVED',
        campaignId: input.campaignId,
        executionId: input.executionId,
        reservedAt: input.reservedAt,
        leaseExpiresAt: input.leaseExpiresAt,
        acquired: true,
      };
    }

    const current = await this.findAttempt(input.campaignId);
    if (current?.attemptExecutionId === input.executionId) {
      return {
        kind: 'RESERVED',
        campaignId: input.campaignId,
        executionId: input.executionId,
        reservedAt: current.attemptReservedAt,
        leaseExpiresAt: current.attemptLeaseExpiresAt,
        acquired: false,
      };
    }
    return {
      kind: 'CONFLICT',
      campaignId: input.campaignId,
      executionId: input.executionId,
    };
  }

  async release(input: {
    campaignId: string;
    executionId: string;
  }): Promise<CommercialGroupCampaignAttemptRelease> {
    const released = await this.campaigns.updateMany({
      where: { id: input.campaignId, attemptExecutionId: input.executionId },
      data: {
        attemptExecutionId: null,
        attemptReservedAt: null,
        attemptLeaseExpiresAt: null,
      },
    });
    if (released.count === 1) {
      return {
        kind: 'RELEASED',
        campaignId: input.campaignId,
        executionId: input.executionId,
        released: true,
      };
    }

    const current = await this.findAttempt(input.campaignId);
    if (current?.attemptExecutionId === null) {
      return {
        kind: 'RELEASED',
        campaignId: input.campaignId,
        executionId: input.executionId,
        released: false,
      };
    }
    return {
      kind: 'CONFLICT',
      campaignId: input.campaignId,
      executionId: input.executionId,
    };
  }

  private findAttempt(campaignId: string) {
    return this.campaigns.findUnique({
      where: { id: campaignId },
      select: {
        attemptExecutionId: true,
        attemptReservedAt: true,
        attemptLeaseExpiresAt: true,
      },
    });
  }
}

const mapCommercialPromotionSnapshot = (
  record: Record<string, unknown>,
): CommercialPromotionSnapshotRecord => ({
  id: String(record.id),
  productId: String(record.productId),
  revision: Number(record.revision),
  fingerprint: String(record.fingerprint),
  price: decimalString(record.price as PrismaDecimalLike) as string,
  priceMin: decimalString(record.priceMin as PrismaDecimalLike | null) ?? null,
  priceMax: decimalString(record.priceMax as PrismaDecimalLike | null) ?? null,
  discountRate: Number(record.discountRate),
  commissionRate: Number(record.commissionRate),
  observedRating: Number(record.observedRating),
  observedSales: Number(record.observedSales),
  offerStartsAt: (record.offerStartsAt as Date | null) ?? null,
  offerEndsAt: (record.offerEndsAt as Date | null) ?? null,
  unavailableAt: (record.unavailableAt as Date | null) ?? null,
  capturedAt: record.capturedAt as Date,
  createdAt: record.createdAt as Date,
});

const mapCommercialPromotionCandidate = (
  record: Record<string, unknown>,
): CommercialPromotionCandidateRecord => ({
  id: String(record.id),
  campaignId: String(record.campaignId),
  productId: String(record.productId),
  snapshotId: String(record.snapshotId),
  generatedCopyId: (record.generatedCopyId as string | null) ?? null,
  status: record.status as CommercialPromotionCandidateRecord['status'],
  rankPosition: (record.rankPosition as number | null) ?? null,
  commercialScore: Number(record.commercialScore),
  scorePolicyVersion:
    record.scorePolicyVersion as CommercialPromotionCandidateRecord['scorePolicyVersion'],
  minimumScoreUsed: Number(record.minimumScoreUsed),
  scoreBreakdown:
    record.scoreBreakdown as CommercialPromotionCandidateRecord['scoreBreakdown'],
  promotionSignals:
    record.promotionSignals as CommercialPromotionCandidateRecord['promotionSignals'],
  priceDropPercent:
    decimalString(record.priceDropPercent as PrismaDecimalLike | null) ?? null,
  queuedAt: record.queuedAt as Date,
  lastEvaluatedAt: record.lastEvaluatedAt as Date,
  expiresAt: (record.expiresAt as Date | null) ?? null,
  dedupeUntil: (record.dedupeUntil as Date | null) ?? null,
  blockedReason: (record.blockedReason as string | null) ?? null,
  createdAt: record.createdAt as Date,
  updatedAt: record.updatedAt as Date,
});

const mapCommercialAiCopyAttempt = (record: Record<string, unknown>) => ({
  id: String(record.id),
  candidateId: String(record.candidateId),
  snapshotId: String(record.snapshotId),
  inputFingerprint: String(record.inputFingerprint),
  provider: String(record.provider),
  model: String(record.model),
  promptVersion: String(record.promptVersion),
  validationVersion: String(record.validationVersion),
  status: record.status as 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS',
  generatedCopyId: (record.generatedCopyId as string | null) ?? null,
  failureCode: (record.failureCode as string | null) ?? null,
  requestMayHaveStarted: Boolean(record.requestMayHaveStarted),
  providerHttpStatus: (record.providerHttpStatus as number | null) ?? null,
  providerErrorCode: (record.providerErrorCode as string | null) ?? null,
  providerErrorType: (record.providerErrorType as string | null) ?? null,
  providerErrorParam: (record.providerErrorParam as string | null) ?? null,
  inputTokens: (record.inputTokens as number | null) ?? null,
  outputTokens: (record.outputTokens as number | null) ?? null,
  totalTokens: (record.totalTokens as number | null) ?? null,
  validationFailureCodes: sanitizeCommercialAiCopyValidationFailureCodes(record.validationFailureCodes),
  startedAt: record.startedAt as Date,
  completedAt: (record.completedAt as Date | null) ?? null,
  createdAt: record.createdAt as Date,
  updatedAt: record.updatedAt as Date,
});

const mapCommercialAiCopyAttemptStatus = (
  record: Record<string, unknown>,
): CommercialCopyGenerationAttemptStatusRecord => ({
  id: String(record.id),
  candidateId: String(record.candidateId),
  provider: String(record.provider),
  model: String(record.model),
  promptVersion: String(record.promptVersion),
  validationVersion: String(record.validationVersion),
  status: record.status as CommercialCopyGenerationAttemptStatusRecord['status'],
  failureCode: (record.failureCode as string | null) ?? null,
  requestMayHaveStarted: Boolean(record.requestMayHaveStarted),
  providerHttpStatus: (record.providerHttpStatus as number | null) ?? null,
  providerErrorCode: (record.providerErrorCode as string | null) ?? null,
  providerErrorType: (record.providerErrorType as string | null) ?? null,
  providerErrorParam: (record.providerErrorParam as string | null) ?? null,
  inputTokens: (record.inputTokens as number | null) ?? null,
  outputTokens: (record.outputTokens as number | null) ?? null,
  totalTokens: (record.totalTokens as number | null) ?? null,
  validationFailureCodes: sanitizeCommercialAiCopyValidationFailureCodes(record.validationFailureCodes),
  startedAt: record.startedAt as Date,
  completedAt: (record.completedAt as Date | null) ?? null,
  createdAt: record.createdAt as Date,
});

const commercialPromotionCopyContextFromRecord = (
  record: Record<string, unknown>,
  previousSnapshot: CommercialPromotionSnapshotRecord | null,
): CommercialPromotionCopyContext => {
  const campaign = record.campaign as CommercialGroupCampaignWithRelations;
  const product = record.product as Record<string, unknown>;
  const snapshot = record.snapshot as Record<string, unknown>;
  return {
    candidate: mapCommercialPromotionCandidate(record),
    campaign: mapCommercialGroupCampaign(campaign),
    niche: mapCommercialNiche(campaign.niche as Record<string, unknown>),
    product: {
      id: String(product.id),
      source:
        product.source as CommercialPromotionCopyContext['product']['source'],
      providerProductId: String(product.providerProductId),
      productName: String(product.nome),
      shopName: String(product.loja),
      productLink: (product.productLink as string | null) ?? null,
      affiliateLink: (product.affiliateLink as string | null) ?? null,
      price: decimalString(product.preco as PrismaDecimalLike) as string,
      priceMin: decimalString(product.precoMin as PrismaDecimalLike | null) ?? null,
      priceMax: decimalString(product.precoMax as PrismaDecimalLike | null) ?? null,
      discountRate: Number(product.desconto),
      commissionRate: Number(product.comissao),
      rating: Number(product.nota),
      sales: Number(product.vendidos),
      offerStartsAt: (product.offerStartsAt as Date | null) ?? null,
      urlImagem: String(product.urlImagem ?? ''),
      offerEndsAt: (product.offerEndsAt as Date | null) ?? null,
      unavailableAt: (product.unavailableAt as Date | null) ?? null,
      commercialSnapshotRevision: Number(product.commercialSnapshotRevision),
      commercialSnapshotFingerprint:
        (product.commercialSnapshotFingerprint as string | null) ?? null,
      updatedAt: product.updatedAt as Date,
    },
    snapshot: mapCommercialPromotionSnapshot(snapshot),
    previousSnapshot,
  };
};

const sameDate = (left: Date, right: Date) =>
  left.getTime() === right.getTime();

const copyContextFailure = (
  current: CommercialPromotionCopyContext | null,
  expected: CommercialPromotionCopyContext,
  affiliateLinkHash: string,
  validatedAt: Date,
) => {
  if (!current) return 'COMMERCIAL_AI_COPY_CANDIDATE_CHANGED';
  if (
    current.candidate.status !== 'QUEUED' ||
    current.candidate.generatedCopyId !== null ||
    !sameDate(current.candidate.updatedAt, expected.candidate.updatedAt)
  ) {
    return 'COMMERCIAL_AI_COPY_CANDIDATE_CHANGED';
  }
  if (
    !current.campaign.active ||
    !current.niche.active ||
    !sameDate(current.campaign.updatedAt, expected.campaign.updatedAt) ||
    !sameDate(current.niche.updatedAt, expected.niche.updatedAt)
  ) {
    return 'COMMERCIAL_AI_COPY_CONFIGURATION_CHANGED';
  }
  if (
    current.product.source !== 'OFFICIAL' ||
    current.product.unavailableAt ||
    (current.product.offerEndsAt &&
      current.product.offerEndsAt <= validatedAt) ||
    (current.candidate.expiresAt &&
      current.candidate.expiresAt <= validatedAt) ||
    !sameDate(current.product.updatedAt, expected.product.updatedAt) ||
    current.product.commercialSnapshotRevision !== current.snapshot.revision ||
    current.product.commercialSnapshotFingerprint !==
      current.snapshot.fingerprint ||
    current.snapshot.id !== expected.snapshot.id ||
    current.snapshot.fingerprint !== expected.snapshot.fingerprint ||
    !current.product.affiliateLink ||
    sha256(current.product.affiliateLink) !== affiliateLinkHash
  ) {
    return 'COMMERCIAL_AI_COPY_CATALOG_CHANGED';
  }
  return null;
};

const sameGeneratedCopy = (
  record: Record<string, unknown>,
  expected: GeneratedCopyData,
) =>
  [
    'productId',
    'titulo',
    'mensagem',
    'cta',
    'hashtags',
    'source',
    'provider',
    'model',
    'promptVersion',
    'validationVersion',
    'inputFingerprint',
    'snapshotId',
    'createdFromCandidateId',
    'usageInputTokens',
    'usageOutputTokens',
    'usageTotalTokens',
  ].every(
    (field) =>
      (record[field] ?? null) ===
      (expected[field as keyof GeneratedCopyData] ?? null),
  );

const sameInstant = (left: Date | null, right: Date | null) =>
  left === null
    ? right === null
    : right !== null && left.getTime() === right.getTime();

const promotionPersistenceError = (error: unknown): never => {
  if (error instanceof AppError) throw error;
  if (
    error instanceof CommercialPromotionMiningConflictError ||
    isTransactionConflictError(error) ||
    isUniqueConstraintError(error) ||
    (prismaErrorCode(error) === 'P2010' && databaseErrorCode(error) === '55P03')
  ) {
    throw new AppError(
      'Outra mineracao alterou a campanha simultaneamente',
      'COMMERCIAL_PROMOTION_MINING_CONFLICT',
    );
  }
  throw new AppError(
    'Falha ao persistir fila promocional',
    'COMMERCIAL_PROMOTION_PERSISTENCE_FAILED',
  );
};

export class PrismaCommercialPromotionRepository
  implements
    CommercialPromotionCatalogRepository,
    CommercialPromotionCandidateRepository
{
  private readonly attemptRepository: PrismaCommercialGroupCampaignAttemptRepository;

  constructor(private readonly prisma: DatabaseClient) {
    this.attemptRepository = new PrismaCommercialGroupCampaignAttemptRepository(
      prisma.commercialGroupCampaign,
    );
  }

  async listOfficialCatalogPage(input: { afterId?: string; limit: number }) {
    const limit = Math.min(Math.max(input.limit, 1), 200);
    const records = await this.prisma.productLead.findMany({
      where: {
        source: 'OFFICIAL',
        id: input.afterId ? { gt: input.afterId } : undefined,
      },
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    const page = records.slice(0, limit);
    const snapshotSelectors = page.flatMap((product) => {
      const revisions = [product.commercialSnapshotRevision];
      if (product.commercialSnapshotRevision > 1) {
        revisions.push(product.commercialSnapshotRevision - 1);
      }
      return revisions
        .filter((revision) => revision > 0)
        .map((revision) => ({ productId: product.id, revision }));
    });
    const productIds = page.map(({ id }) => id);
    const [snapshots, latestSnapshotRevisions] = await Promise.all([
      snapshotSelectors.length === 0
        ? Promise.resolve([])
        : this.prisma.commercialOfferSnapshot.findMany({
            where: { OR: snapshotSelectors },
          }),
      productIds.length === 0
        ? Promise.resolve([])
        : this.prisma.commercialOfferSnapshot.groupBy({
            by: ['productId'],
            where: { productId: { in: productIds } },
            _max: { revision: true },
          }),
    ]);
    const latestRevisionByProduct = new Map(
      latestSnapshotRevisions.map(({ productId, _max }) => [
        productId,
        _max.revision,
      ]),
    );
    const snapshotByProductRevision = new Map(
      snapshots.map((snapshot) => [
        `${snapshot.productId}:${snapshot.revision}`,
        mapCommercialPromotionSnapshot(
          snapshot as unknown as Record<string, unknown>,
        ),
      ]),
    );
    return {
      items: page.map((product) => ({
        product: mapShopeeOffer(product as unknown as Record<string, unknown>),
        commercialSnapshotRevision: product.commercialSnapshotRevision,
        commercialSnapshotFingerprint: product.commercialSnapshotFingerprint,
        latestSnapshotRevision: latestRevisionByProduct.get(product.id) ?? null,
        currentSnapshot:
          snapshotByProductRevision.get(
            `${product.id}:${product.commercialSnapshotRevision}`,
          ) ?? null,
        previousSnapshot:
          product.commercialSnapshotRevision > 1
            ? (snapshotByProductRevision.get(
                `${product.id}:${product.commercialSnapshotRevision - 1}`,
              ) ?? null)
            : null,
      })),
      hasMore: records.length > limit,
    };
  }

  async listCampaignCandidates(campaignId: string) {
    const records = await this.prisma.commercialPromotionCandidate.findMany({
      where: { campaignId },
      orderBy: { id: 'asc' },
    });
    return records.map((record) =>
      mapCommercialPromotionCandidate(
        record as unknown as Record<string, unknown>,
      ),
    );
  }

  async findRecentlySentProductIds(input: {
    productIds: string[];
    logicalGroupFingerprint: string;
    sentAtOrAfter: Date;
  }) {
    if (input.productIds.length === 0) return new Set<string>();
    const rows = await this.prisma.whatsAppDispatch.findMany({
      where: {
        productId: { in: input.productIds },
        status: 'SENT',
        sentAt: { gte: input.sentAtOrAfter },
        destination: {
          type: 'GROUP',
          fingerprint: input.logicalGroupFingerprint,
        },
      },
      select: { productId: true },
      distinct: ['productId'],
    });
    return new Set(rows.map(({ productId }) => productId));
  }

  async materialize(input: CommercialPromotionMaterializationInput) {
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const locked = await transaction.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "CommercialGroupCampaign"
            WHERE "id" = ${input.campaignId}
            FOR UPDATE NOWAIT
          `;
          if (locked.length !== 1) {
            throw new AppError(
              'Configuracao comercial mudou antes da materializacao',
              'COMMERCIAL_PROMOTION_CONFIGURATION_CHANGED',
            );
          }
          const campaign = await transaction.commercialGroupCampaign.findUnique(
            {
              where: { id: input.campaignId },
              include: { niche: true },
            },
          );
          if (
            !campaign ||
            campaign.nicheId !== input.nicheId ||
            campaign.logicalGroupFingerprint !==
              input.logicalGroupFingerprint ||
            campaign.updatedAt.getTime() !==
              input.expectedCampaignUpdatedAt.getTime() ||
            campaign.niche.updatedAt.getTime() !==
              input.expectedNicheUpdatedAt.getTime()
          ) {
            throw new AppError(
              'Configuracao comercial mudou antes da materializacao',
              'COMMERCIAL_PROMOTION_CONFIGURATION_CHANGED',
            );
          }
          if (!campaign.active) {
            throw new AppError('Campanha inativa', 'CAMPAIGN_INACTIVE');
          }
          if (!campaign.niche.active) {
            throw new AppError('Nicho inativo', 'NICHE_INACTIVE');
          }
          const group = await transaction.whatsAppDestination.findFirst({
            where: {
              type: 'GROUP',
              fingerprint: input.logicalGroupFingerprint,
              active: true,
              available: true,
              sourceInstanceName: { not: null },
            },
            select: { id: true },
          });
          if (!group) {
            throw new AppError(
              'Grupo logico indisponivel',
              'GROUP_UNAVAILABLE',
            );
          }

          const currentCandidates =
            await transaction.commercialPromotionCandidate.findMany({
              where: { campaignId: input.campaignId },
              include: {
                product: {
                  select: { unavailableAt: true, offerEndsAt: true },
                },
              },
              orderBy: { id: 'asc' },
            });
          const protectedCount = currentCandidates.filter(
            ({ status }) => status === 'COPY_READY' || status === 'RESERVED',
          ).length;
          const queuedBefore = currentCandidates.filter(
            ({ status }) => status === 'QUEUED',
          ).length;
          const queueCapacity = Math.max(
            campaign.queueTargetSize - protectedCount,
            0,
          );
          const selected = input.rankedCandidates.slice(0, queueCapacity);
          const currentByProduct = new Map(
            currentCandidates.map((candidate) => [
              candidate.productId,
              candidate,
            ]),
          );

          for (const candidate of selected) {
            const current = currentByProduct.get(candidate.productId);
            if (
              (current?.status ?? null) !== candidate.expectedCandidateStatus ||
              !sameInstant(
                current?.dedupeUntil ?? null,
                candidate.expectedDedupeUntil,
              ) ||
              !sameInstant(
                current?.updatedAt ?? null,
                candidate.expectedCandidateUpdatedAt,
              ) ||
              current?.status === 'COPY_READY' ||
              current?.status === 'RESERVED'
            ) {
              throw new CommercialPromotionMiningConflictError();
            }
          }

          const selectedProductIds = selected.map(({ productId }) => productId);
          const [products, snapshots, recentlySent] = await Promise.all([
            transaction.productLead.findMany({
              where: { id: { in: selectedProductIds } },
              select: {
                id: true,
                source: true,
                commercialSnapshotRevision: true,
                commercialSnapshotFingerprint: true,
                updatedAt: true,
              },
            }),
            transaction.commercialOfferSnapshot.findMany({
              where: {
                id: { in: selected.map(({ snapshotId }) => snapshotId) },
              },
              select: {
                id: true,
                productId: true,
                revision: true,
                fingerprint: true,
              },
            }),
            transaction.whatsAppDispatch.findFirst({
              where: {
                productId: { in: selectedProductIds },
                status: 'SENT',
                sentAt: { gte: input.dedupeSince },
                destination: {
                  type: 'GROUP',
                  fingerprint: input.logicalGroupFingerprint,
                },
              },
              select: { id: true },
            }),
          ]);
          if (recentlySent) throw new CommercialPromotionMiningConflictError();
          const productById = new Map(
            products.map((product) => [product.id, product]),
          );
          const snapshotById = new Map(
            snapshots.map((snapshot) => [snapshot.id, snapshot]),
          );
          for (const candidate of selected) {
            const product = productById.get(candidate.productId);
            const snapshot = snapshotById.get(candidate.snapshotId);
            if (
              !product ||
              product.source !== 'OFFICIAL' ||
              product.commercialSnapshotRevision !==
                candidate.snapshotRevision ||
              product.commercialSnapshotFingerprint !==
                candidate.snapshotFingerprint ||
              product.updatedAt.getTime() !==
                candidate.expectedProductUpdatedAt.getTime() ||
              !snapshot ||
              snapshot.productId !== candidate.productId ||
              snapshot.revision !== candidate.snapshotRevision ||
              snapshot.fingerprint !== candidate.snapshotFingerprint
            ) {
              throw new AppError(
                'Produto ou snapshot mudou antes da materializacao',
                'COMMERCIAL_PROMOTION_CATALOG_CHANGED',
              );
            }
          }

          let queuedCreated = 0;
          let queuedReactivated = 0;
          let queuedUpdated = 0;
          for (const [index, candidate] of selected.entries()) {
            const current = currentByProduct.get(candidate.productId);
            const data = {
              snapshotId: candidate.snapshotId,
              status: 'QUEUED' as const,
              rankPosition: index + 1,
              commercialScore: candidate.commercialScore,
              scorePolicyVersion: candidate.scorePolicyVersion,
              minimumScoreUsed: candidate.minimumScoreUsed,
              scoreBreakdown: candidate.scoreBreakdown as never,
              promotionSignals: candidate.promotionSignals,
              priceDropPercent: candidate.priceDropPercent,
              lastEvaluatedAt: input.now,
              expiresAt: candidate.expiresAt,
              blockedReason: null,
            };
            if (!current) {
              await transaction.commercialPromotionCandidate.create({
                data: {
                  ...data,
                  campaignId: input.campaignId,
                  productId: candidate.productId,
                  queuedAt: input.now,
                },
              });
              queuedCreated += 1;
              continue;
            }
            const reactivated =
              current.status === 'BLOCKED' ||
              current.status === 'EXPIRED' ||
              current.status === 'DISPATCHED';
            const updated =
              await transaction.commercialPromotionCandidate.updateMany({
                where: {
                  id: current.id,
                  status: current.status,
                  updatedAt: current.updatedAt,
                },
                data: {
                  ...data,
                  queuedAt: reactivated ? input.now : current.queuedAt,
                },
              });
            if (updated.count !== 1) {
              throw new CommercialPromotionMiningConflictError();
            }
            if (reactivated) queuedReactivated += 1;
            else queuedUpdated += 1;
          }

          const selectedIds = new Set(
            selected.map(({ productId }) => productId),
          );
          let queuedBlocked = 0;
          let queuedExpired = 0;
          for (const candidate of currentCandidates) {
            if (
              candidate.status !== 'QUEUED' ||
              selectedIds.has(candidate.productId)
            ) {
              continue;
            }
            const expired =
              candidate.product.unavailableAt !== null ||
              (candidate.product.offerEndsAt !== null &&
                candidate.product.offerEndsAt <= input.now);
            const updated =
              await transaction.commercialPromotionCandidate.updateMany({
                where: {
                  id: candidate.id,
                  status: 'QUEUED',
                  updatedAt: candidate.updatedAt,
                },
                data: {
                  status: expired ? 'EXPIRED' : 'BLOCKED',
                  rankPosition: null,
                  blockedReason: expired ? null : 'QUEUE_NOT_SELECTED',
                  lastEvaluatedAt: input.now,
                },
              });
            if (updated.count !== 1) {
              throw new CommercialPromotionMiningConflictError();
            }
            if (expired) queuedExpired += 1;
            else queuedBlocked += 1;
          }
          const queuedAfter =
            await transaction.commercialPromotionCandidate.count({
              where: { campaignId: input.campaignId, status: 'QUEUED' },
            });
          return {
            protectedCount,
            queueCapacity,
            queuedBefore,
            queuedCreated,
            queuedReactivated,
            queuedUpdated,
            queuedBlocked,
            queuedExpired,
            queuedAfter,
            queueTargetSize: campaign.queueTargetSize,
            queueFull: protectedCount + queuedAfter >= campaign.queueTargetSize,
          };
        },
        { isolationLevel: 'Serializable', maxWait: 1_000, timeout: 10_000 },
      );
    } catch (error) {
      return promotionPersistenceError(error);
    }
  }

  async listQueue(input: {
    campaignId: string;
    page: number;
    limit: number;
    status?: CommercialPromotionCandidateRecord['status'];
  }) {
    const where = { campaignId: input.campaignId, status: input.status };
    const [records, total] = await Promise.all([
      this.prisma.commercialPromotionCandidate.findMany({
        where,
        include: {
          product: { select: { nome: true, preco: true, desconto: true } },
          snapshot: { select: { revision: true } },
        },
        orderBy: [
          { status: 'asc' },
          { rankPosition: 'asc' },
          { queuedAt: 'asc' },
          { id: 'asc' },
        ],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      this.prisma.commercialPromotionCandidate.count({ where }),
    ]);
    return {
      items: records.map((record) => {
        const mapped = mapCommercialPromotionCandidate(
          record as unknown as Record<string, unknown>,
        );
        const { scoreBreakdown: omittedScoreBreakdown, ...safeCandidate } =
          mapped;
        void omittedScoreBreakdown;
        return {
          ...safeCandidate,
          productName: record.product.nome,
          price: record.product.preco.toString(),
          discountRate: record.product.desconto,
          snapshotRevision: record.snapshot.revision,
        };
      }),
      total,
    };
  }

  async markDispatchedByGeneratedCopyId(generatedCopyId: string) {
    const candidates =
      await this.prisma.commercialPromotionCandidate.findMany({
        where: { generatedCopyId },
        select: { id: true, campaignId: true, status: true },
      });
    if (candidates.length === 0) return { kind: 'LEGACY' as const };
    if (candidates.length !== 1) {
      throw new AppError(
        'Copy candidate-scoped possui mais de um candidato',
        'COMMERCIAL_PROMOTION_CANDIDATE_FINALIZATION_INVALID',
      );
    }

    const [candidate] = candidates;
    if (candidate.status === 'DISPATCHED') {
      return {
        kind: 'DISPATCHED' as const,
        candidateId: candidate.id,
        campaignId: candidate.campaignId,
        transitioned: false,
      };
    }
    if (candidate.status !== 'RESERVED') {
      throw new AppError(
        'Candidato promocional nao esta reservado para finalizacao',
        'COMMERCIAL_PROMOTION_CANDIDATE_FINALIZATION_INVALID',
      );
    }

    const result = await this.prisma.commercialPromotionCandidate.updateMany({
      where: {
        id: candidate.id,
        generatedCopyId,
        status: 'RESERVED',
      },
      data: { status: 'DISPATCHED' },
    });
    if (result.count === 1) {
      return {
        kind: 'DISPATCHED' as const,
        candidateId: candidate.id,
        campaignId: candidate.campaignId,
        transitioned: true,
      };
    }

    const current =
      await this.prisma.commercialPromotionCandidate.findUnique({
        where: { id: candidate.id },
        select: { generatedCopyId: true, status: true },
      });
    if (
      current?.generatedCopyId === generatedCopyId &&
      current.status === 'DISPATCHED'
    ) {
      return {
        kind: 'DISPATCHED' as const,
        candidateId: candidate.id,
        campaignId: candidate.campaignId,
        transitioned: false,
      };
    }
    throw new AppError(
      'Candidato promocional mudou durante a finalizacao',
      'COMMERCIAL_PROMOTION_CANDIDATE_FINALIZATION_INVALID',
    );
  }

  async markBlockedByGeneratedCopyId(generatedCopyId: string) {
    const candidates =
      await this.prisma.commercialPromotionCandidate.findMany({
        where: { generatedCopyId },
        select: { id: true, status: true },
      });
    if (candidates.length === 0) return { kind: 'LEGACY' as const };
    if (candidates.length !== 1) {
      throw new AppError(
        'Copy candidate-scoped possui mais de um candidato',
        'COMMERCIAL_PROMOTION_CANDIDATE_FINALIZATION_INVALID',
      );
    }

    const [candidate] = candidates;
    if (candidate.status === 'BLOCKED') {
      return {
        kind: 'BLOCKED' as const,
        candidateId: candidate.id,
        transitioned: false,
      };
    }
    if (candidate.status !== 'RESERVED') {
      throw new AppError(
        'Candidato promocional nao esta reservado para bloqueio seguro',
        'COMMERCIAL_PROMOTION_CANDIDATE_FINALIZATION_INVALID',
      );
    }

    const result = await this.prisma.commercialPromotionCandidate.updateMany({
      where: {
        id: candidate.id,
        generatedCopyId,
        status: 'RESERVED',
      },
      data: { status: 'BLOCKED' },
    });
    if (result.count === 1) {
      return {
        kind: 'BLOCKED' as const,
        candidateId: candidate.id,
        transitioned: true,
      };
    }

    const current =
      await this.prisma.commercialPromotionCandidate.findUnique({
        where: { id: candidate.id },
        select: { generatedCopyId: true, status: true },
      });
    if (
      current?.generatedCopyId === generatedCopyId &&
      current.status === 'BLOCKED'
    ) {
      return {
        kind: 'BLOCKED' as const,
        candidateId: candidate.id,
        transitioned: false,
      };
    }
    throw new AppError(
      'Candidato promocional mudou durante o bloqueio seguro',
      'COMMERCIAL_PROMOTION_CANDIDATE_FINALIZATION_INVALID',
    );
  }

  async resetCampaignFailureStateByGeneratedCopyId(
    generatedCopyId: string,
    expectedAttempt?: { campaignId: string; executionId: string },
  ) {
    const candidates =
      await this.prisma.commercialPromotionCandidate.findMany({
        where: {
          generatedCopyId,
          ...(expectedAttempt
            ? {
                campaignId: expectedAttempt.campaignId,
                campaign: { attemptExecutionId: expectedAttempt.executionId },
              }
            : {}),
        },
        select: {
          campaignId: true,
          campaign: { select: { failureCount: true, nextEligibleAt: true } },
        },
      });
    if (candidates.length === 0) return { kind: 'LEGACY' as const };
    if (candidates.length !== 1) {
      throw new AppError(
        'Copy candidate-scoped possui mais de um candidato',
        'COMMERCIAL_PROMOTION_CANDIDATE_FINALIZATION_INVALID',
      );
    }

    const [candidate] = candidates;
    if (
      candidate.campaign.failureCount === 0 &&
      candidate.campaign.nextEligibleAt === null
    ) {
      return {
        kind: 'RESET' as const,
        campaignId: candidate.campaignId,
        transitioned: false,
      };
    }
    const reset = await this.prisma.commercialGroupCampaign.updateMany({
      where: {
        id: candidate.campaignId,
        ...(expectedAttempt
          ? { attemptExecutionId: expectedAttempt.executionId }
          : {}),
      },
      data: { failureCount: 0, nextEligibleAt: null },
    });
    if (reset.count !== 1) {
      throw new AppError(
        'Owner da reserva divergiu durante o reset da campanha',
        'COMMERCIAL_PROMOTION_CANDIDATE_FINALIZATION_INVALID',
      );
    }
    return {
      kind: 'RESET' as const,
      campaignId: candidate.campaignId,
      transitioned: true,
    };
  }

  async findAttemptContextByGeneratedCopyId(
    generatedCopyId: string,
  ): Promise<CommercialPromotionAttemptContext> {
    const candidates =
      await this.prisma.commercialPromotionCandidate.findMany({
        where: { generatedCopyId },
        select: {
          id: true,
          campaignId: true,
          campaign: { select: { attemptExecutionId: true } },
        },
      });
    if (candidates.length === 0) return { kind: 'NONE' };
    if (candidates.length !== 1) return { kind: 'AMBIGUOUS' };
    return {
      kind: 'FOUND',
      candidateId: candidates[0].id,
      campaignId: candidates[0].campaignId,
      attemptExecutionId: candidates[0].campaign.attemptExecutionId,
    };
  }

  async releaseAttempt(input: {
    campaignId: string;
    executionId: string;
  }) {
    return this.attemptRepository.release(input);
  }

}

type CommercialCopyPrismaClient = Pick<
  DatabaseClient,
  | 'commercialPromotionCandidate'
  | 'commercialOfferSnapshot'
  | 'commercialCopyGenerationAttempt'
  | 'generatedCopy'
>;

const commercialCopyCampaignInclude = {
  niche: true,
  anchorDestination: commercialCampaignInclude.anchorDestination,
};

const loadCommercialPromotionCopyContext = async (
  client: CommercialCopyPrismaClient,
  candidateId: string,
) => {
  const record = await client.commercialPromotionCandidate.findUnique({
    where: { id: candidateId },
    include: {
      campaign: { include: commercialCopyCampaignInclude },
      product: true,
      snapshot: true,
    },
  });
  if (!record) return null;
  const previous =
    record.snapshot.revision > 1
      ? await client.commercialOfferSnapshot.findUnique({
          where: {
            productId_revision: {
              productId: record.productId,
              revision: record.snapshot.revision - 1,
            },
          },
        })
      : null;
  return commercialPromotionCopyContextFromRecord(
    record as unknown as Record<string, unknown>,
    previous
      ? mapCommercialPromotionSnapshot(
          previous as unknown as Record<string, unknown>,
        )
      : null,
  );
};

export class PrismaCommercialPromotionCopyRepository implements CommercialPromotionCopyRepository {
  constructor(private readonly prisma: DatabaseClient) {}

  loadContext(candidateId: string) {
    return loadCommercialPromotionCopyContext(this.prisma, candidateId);
  }

  async findCopyByInputFingerprint(inputFingerprint: string) {
    return (await this.prisma.generatedCopy.findUnique({
      where: { inputFingerprint },
    })) as GeneratedCopyRecord | null;
  }

  async findAttemptByInputFingerprint(inputFingerprint: string) {
    const record = await this.prisma.commercialCopyGenerationAttempt.findUnique(
      {
        where: { inputFingerprint },
      },
    );
    return record
      ? mapCommercialAiCopyAttempt(record as unknown as Record<string, unknown>)
      : null;
  }

  async findAttemptByGenerationContract(
    input: Parameters<
      CommercialPromotionCopyRepository['findAttemptByGenerationContract']
    >[0],
  ) {
    const record = await this.prisma.commercialCopyGenerationAttempt.findFirst({
      where: {
        candidateId: input.candidateId,
        snapshotId: input.snapshotId,
        inputFingerprint: { not: input.inputFingerprint },
        provider: input.provider,
        model: input.model,
        promptVersion: input.promptVersion,
        validationVersion: input.validationVersion,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return record
      ? mapCommercialAiCopyAttempt(record as unknown as Record<string, unknown>)
      : null;
  }

  async listAttemptsByCandidateId(candidateId: string) {
    const records = await this.prisma.commercialCopyGenerationAttempt.findMany({
      where: { candidateId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        candidateId: true,
        provider: true,
        model: true,
        promptVersion: true,
        validationVersion: true,
        status: true,
        failureCode: true,
        requestMayHaveStarted: true,
        providerHttpStatus: true,
        providerErrorCode: true,
        providerErrorType: true,
        providerErrorParam: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        validationFailureCodes: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
      },
    });
    return records.map((record) =>
      mapCommercialAiCopyAttemptStatus(
        record as unknown as Record<string, unknown>,
      ),
    );
  }

  async claim(
    input: Parameters<CommercialPromotionCopyRepository['claim']>[0],
  ) {
    try {
      await this.prisma.$transaction(
        async (transaction) => {
          const current = await loadCommercialPromotionCopyContext(
            transaction as CommercialCopyPrismaClient,
            input.candidateId,
          );
          const failureCode = copyContextFailure(
            current,
            input.expected,
            input.affiliateLinkHash,
            input.validatedAt,
          );
          if (failureCode) {
            throw new AppError(
              'Contexto mudou antes da chamada ao provider',
              failureCode,
            );
          }
          await transaction.commercialCopyGenerationAttempt.create({
            data: {
              candidateId: input.candidateId,
              snapshotId: input.snapshotId,
              inputFingerprint: input.inputFingerprint,
              provider: input.provider,
              model: input.model,
              promptVersion: input.promptVersion,
              validationVersion: input.validationVersion,
              startedAt: input.startedAt,
              status: 'STARTED',
            },
          });
        },
        { isolationLevel: 'Serializable' },
      );
      return true;
    } catch (error) {
      if (isUniqueConstraintError(error)) return false;
      if (isTransactionConflictError(error)) {
        if (await this.findAttemptByInputFingerprint(input.inputFingerprint)) {
          return false;
        }
        throw new AppError(
          'Contexto mudou antes da chamada ao provider',
          'COMMERCIAL_AI_COPY_CANDIDATE_CHANGED',
        );
      }
      throw error;
    }
  }

  async linkCachedCopy(input: {
    expected: CommercialPromotionCopyContext;
    copyId: string;
    inputFingerprint: string;
    affiliateLinkHash: string;
    validatedAt: Date;
    provider: string;
    model: string;
    promptVersion: string;
    validationVersion: string;
    maximumLength: number;
  }) {
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const [current, copy] = await Promise.all([
            loadCommercialPromotionCopyContext(
              transaction as CommercialCopyPrismaClient,
              input.expected.candidate.id,
            ),
            transaction.generatedCopy.findUnique({
              where: { id: input.copyId },
            }),
          ]);
          if (
            copyContextFailure(
              current,
              input.expected,
              input.affiliateLinkHash,
              input.validatedAt,
            ) ||
            !copy ||
            copy.source !== 'AI' ||
            copy.inputFingerprint !== input.inputFingerprint ||
            copy.productId !== input.expected.product.id ||
            copy.snapshotId !== input.expected.snapshot.id ||
            copy.provider !== input.provider ||
            copy.model !== input.model ||
            copy.promptVersion !== input.promptVersion ||
            copy.validationVersion !== input.validationVersion ||
            !current?.product.affiliateLink ||
            !isSafeAssembledCommercialPromotionCopy(
              copy,
              current.product.affiliateLink,
              {
                productName: current.product.productName,
                shopName: current.product.shopName,
                price: current.product.price,
                discountRate: current.product.discountRate,
                promotionSignals: current.candidate.promotionSignals,
                priceDropPercent: current.candidate.priceDropPercent,
              },
              input.maximumLength,
            )
          ) {
            return false;
          }
          const updated =
            await transaction.commercialPromotionCandidate.updateMany({
              where: {
                id: input.expected.candidate.id,
                status: 'QUEUED',
                generatedCopyId: null,
                updatedAt: input.expected.candidate.updatedAt,
              },
              data: { status: 'COPY_READY', generatedCopyId: copy.id },
            });
          return updated.count === 1;
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (isTransactionConflictError(error)) return false;
      throw error;
    }
  }

  private async reconcileCompletion(
    input: Parameters<CommercialPromotionCopyRepository['complete']>[0],
  ) {
    return this.prisma.$transaction(
      async (transaction) => {
        const [current, copy, attempt] = await Promise.all([
          loadCommercialPromotionCopyContext(
            transaction as CommercialCopyPrismaClient,
            input.expected.candidate.id,
          ),
          transaction.generatedCopy.findUnique({
            where: { inputFingerprint: input.inputFingerprint },
          }),
          transaction.commercialCopyGenerationAttempt.findUnique({
            where: { inputFingerprint: input.inputFingerprint },
          }),
        ]);
        if (!current || !copy || !sameGeneratedCopy(copy, input.copy)) {
          return null;
        }
        if (
          current.candidate.status === 'COPY_READY' &&
          current.candidate.generatedCopyId === copy.id &&
          attempt?.status === 'SUCCEEDED' &&
          attempt.generatedCopyId === copy.id
        ) {
          return {
            completed: true as const,
            copy: copy as GeneratedCopyRecord,
          };
        }
        if (
          copyContextFailure(
            current,
            input.expected,
            input.affiliateLinkHash,
            input.completedAt,
          ) ||
          !attempt ||
          attempt.status !== 'STARTED'
        ) {
          return null;
        }
        await transaction.commercialCopyGenerationAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'SUCCEEDED',
            generatedCopyId: copy.id,
            failureCode: null,
            inputTokens: input.usage.inputTokens,
            outputTokens: input.usage.outputTokens,
            totalTokens: input.usage.totalTokens,
            completedAt: input.completedAt,
          },
        });
        const updated =
          await transaction.commercialPromotionCandidate.updateMany({
            where: {
              id: input.expected.candidate.id,
              status: 'QUEUED',
              generatedCopyId: null,
              updatedAt: input.expected.candidate.updatedAt,
            },
            data: { status: 'COPY_READY', generatedCopyId: copy.id },
          });
        if (updated.count !== 1) {
          throw new AppError(
            'Candidato mudou durante a reconciliacao',
            'COMMERCIAL_AI_COPY_CANDIDATE_CHANGED',
          );
        }
        return { completed: true as const, copy: copy as GeneratedCopyRecord };
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async complete(
    input: Parameters<CommercialPromotionCopyRepository['complete']>[0],
  ) {
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const current = await loadCommercialPromotionCopyContext(
            transaction as CommercialCopyPrismaClient,
            input.expected.candidate.id,
          );
          const failureCode = copyContextFailure(
            current,
            input.expected,
            input.affiliateLinkHash,
            input.completedAt,
          );
          const attempt =
            await transaction.commercialCopyGenerationAttempt.findUnique({
              where: { inputFingerprint: input.inputFingerprint },
            });
          const attemptChanged =
            !attempt ||
            attempt.status !== 'STARTED' ||
            attempt.candidateId !== input.expected.candidate.id ||
            attempt.snapshotId !== input.expected.snapshot.id ||
            attempt.provider !== input.provider ||
            attempt.model !== input.model ||
            attempt.promptVersion !== input.promptVersion ||
            attempt.validationVersion !== input.validationVersion;
          const terminalFailure =
            failureCode ??
            (attemptChanged
              ? 'COMMERCIAL_AI_COPY_CONFIGURATION_CHANGED'
              : null);
          if (terminalFailure) {
            if (attempt?.status === 'STARTED') {
              await transaction.commercialCopyGenerationAttempt.update({
                where: { id: attempt.id },
                data: {
                  status: 'FAILED',
                  failureCode: terminalFailure,
                  providerHttpStatus: null,
                  providerErrorCode: null,
                  providerErrorType: null,
                  providerErrorParam: null,
                  inputTokens: input.usage.inputTokens,
                  outputTokens: input.usage.outputTokens,
                  totalTokens: input.usage.totalTokens,
                  completedAt: input.completedAt,
                },
              });
            }
            return { completed: false as const, failureCode: terminalFailure };
          }

          let copy = await transaction.generatedCopy.findUnique({
            where: { inputFingerprint: input.inputFingerprint },
          });
          if (copy && !sameGeneratedCopy(copy, input.copy)) {
            await transaction.commercialCopyGenerationAttempt.update({
              where: { id: attempt!.id },
              data: {
                status: 'FAILED',
                failureCode: 'COMMERCIAL_AI_COPY_CACHE_INCONSISTENT',
                providerHttpStatus: null,
                providerErrorCode: null,
                providerErrorType: null,
                providerErrorParam: null,
                inputTokens: input.usage.inputTokens,
                outputTokens: input.usage.outputTokens,
                totalTokens: input.usage.totalTokens,
                completedAt: input.completedAt,
              },
            });
            return {
              completed: false as const,
              failureCode: 'COMMERCIAL_AI_COPY_CACHE_INCONSISTENT',
            };
          }
          copy ??= await transaction.generatedCopy.create({
            data: input.copy,
          });
          await transaction.commercialCopyGenerationAttempt.update({
            where: { id: attempt!.id },
            data: {
              status: 'SUCCEEDED',
              generatedCopyId: copy.id,
              failureCode: null,
              inputTokens: input.usage.inputTokens,
              outputTokens: input.usage.outputTokens,
              totalTokens: input.usage.totalTokens,
              completedAt: input.completedAt,
            },
          });
          const updated =
            await transaction.commercialPromotionCandidate.updateMany({
              where: {
                id: input.expected.candidate.id,
                status: 'QUEUED',
                generatedCopyId: null,
                updatedAt: input.expected.candidate.updatedAt,
              },
              data: { status: 'COPY_READY', generatedCopyId: copy.id },
            });
          if (updated.count !== 1) {
            throw new AppError(
              'Candidato mudou durante a persistencia',
              'COMMERCIAL_AI_COPY_CANDIDATE_CHANGED',
            );
          }
          return {
            completed: true as const,
            copy: copy as GeneratedCopyRecord,
          };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (isTransactionConflictError(error) || isUniqueConstraintError(error)) {
        const reconciled = await this.reconcileCompletion(input);
        if (reconciled) return reconciled;
        throw new AppError(
          'Persistencia da copy ficou inconclusiva',
          'COMMERCIAL_AI_COPY_PERSISTENCE_AMBIGUOUS',
        );
      }
      throw error;
    }
  }

  async markAttemptTerminal(input: {
    inputFingerprint: string;
    status: 'FAILED' | 'AMBIGUOUS';
    failureCode: string;
    requestMayHaveStarted: boolean;
    providerHttpStatus?: number | null;
    providerErrorCode?: string | null;
    providerErrorType?: string | null;
    providerErrorParam?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
    validationFailureCodes?: string[];
    completedAt: Date;
  }) {
    const result = await this.prisma.commercialCopyGenerationAttempt.updateMany(
      {
        where: { inputFingerprint: input.inputFingerprint, status: 'STARTED' },
        data: {
          status: input.status,
          failureCode: input.failureCode,
          requestMayHaveStarted: input.requestMayHaveStarted,
          providerHttpStatus: input.providerHttpStatus ?? null,
          providerErrorCode: input.providerErrorCode ?? null,
          providerErrorType: input.providerErrorType ?? null,
          providerErrorParam: input.providerErrorParam ?? null,
          inputTokens: input.inputTokens ?? null,
          outputTokens: input.outputTokens ?? null,
          totalTokens: input.totalTokens ?? null,
          validationFailureCodes: sanitizeCommercialAiCopyValidationFailureCodes(input.validationFailureCodes),
          completedAt: input.completedAt,
        },
      },
    );
    return result.count === 1;
  }

  async findCopyForCandidate(candidateId: string) {
    const record = await this.prisma.commercialPromotionCandidate.findUnique({
      where: { id: candidateId },
      include: {
        generatedCopy: true,
        snapshot: { select: { revision: true } },
      },
    });
    if (!record?.generatedCopy) return null;
    return {
      candidate: mapCommercialPromotionCandidate(
        record as unknown as Record<string, unknown>,
      ),
      copy: record.generatedCopy as GeneratedCopyRecord,
      snapshotRevision: record.snapshot.revision,
    };
  }
}

const mapCommercialPipelineRun = (
  record: Record<string, unknown>,
): CommercialPipelineRunRecord => ({
  ...(record as unknown as CommercialPipelineRunRecord),
  productPrice:
    decimalString(record.productPrice as PrismaDecimalLike | null) ?? null,
  rejectionSummary: record.rejectionSummary as Record<string, number>,
  selectionReasons: record.selectionReasons as string[],
  plannedSubIds: record.plannedSubIds as string[],
  selectedScoreBreakdown:
    (record.selectedScoreBreakdown as CommercialPipelineRunRecord['selectedScoreBreakdown']) ??
    null,
});

const toPrismaCommercialPipelineRun = (
  data: Partial<CommercialPipelineRunData>,
) => ({
  ...data,
  ...(data.productPrice === undefined
    ? {}
    : { productPrice: data.productPrice }),
});

export class PrismaCommercialPipelineRunRepository
  implements
    CommercialPipelineRunRepository,
    CommercialPipelineRunFinalizationRepository
{
  constructor(
    private readonly prisma: Pick<DatabaseClient, 'commercialPipelineRun'>,
  ) {}

  async create(
    data: CommercialPipelineRunData,
  ): Promise<CommercialPipelineRunRecord> {
    const record = await this.prisma.commercialPipelineRun.create({
      data: toPrismaCommercialPipelineRun(data) as never,
    });
    return mapCommercialPipelineRun(
      record as unknown as Record<string, unknown>,
    );
  }

  async update(
    id: string,
    data: Partial<CommercialPipelineRunData>,
  ): Promise<CommercialPipelineRunRecord> {
    const record = await this.prisma.commercialPipelineRun.update({
      where: { id },
      data: toPrismaCommercialPipelineRun(data) as never,
    });
    return mapCommercialPipelineRun(
      record as unknown as Record<string, unknown>,
    );
  }

  async list(filters: CommercialPipelineRunFilters) {
    const where = {
      status: filters.status,
      mode: filters.mode,
      productId: filters.productId,
    };
    const [records, total] = await Promise.all([
      this.prisma.commercialPipelineRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.commercialPipelineRun.count({ where }),
    ]);
    return {
      items: records.map((record) =>
        mapCommercialPipelineRun(record as unknown as Record<string, unknown>),
      ),
      total,
    };
  }

  async findById(id: string): Promise<CommercialPipelineRunRecord | null> {
    const record = await this.prisma.commercialPipelineRun.findUnique({
      where: { id },
    });
    return record
      ? mapCommercialPipelineRun(record as unknown as Record<string, unknown>)
      : null;
  }

  async findByDispatchId(
    dispatchId: string,
  ): Promise<CommercialPipelineRunRecord | null> {
    if (!this.prisma.commercialPipelineRun) return null;
    const record = await this.prisma.commercialPipelineRun.findUnique({
      where: { dispatchId } as never,
    });
    return record
      ? mapCommercialPipelineRun(record as unknown as Record<string, unknown>)
      : null;
  }

  async finalizeByDispatchId(
    dispatchId: string,
    completedAt: Date,
  ) {
    if (!this.prisma.commercialPipelineRun) return null;

    const readCurrent = async () =>
      this.prisma.commercialPipelineRun.findUnique({
        where: { dispatchId } as never,
        select: {
          id: true,
          mode: true,
          status: true,
          finalStatus: true,
          investigationRequired: true,
          dispatch: { select: { status: true } },
        },
      });

    // A CAS loser gets one bounded re-read to converge on a terminal winner.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await readCurrent();
      if (!current || current.mode !== 'CONFIRMED') return null;

      const kind = this.resolveFinalizationKind(current);
      if (this.isFinalizationPersisted(current, kind)) {
        return { kind, transitioned: false };
      }

      const data =
        kind === 'SENT'
          ? {
              status: 'COMPLETED' as const,
              finalStatus: 'SENT' as const,
              failureCode: null,
              investigationRequired: false,
              completedAt,
            }
          : kind === 'FAILED'
            ? {
                status: 'FAILED' as const,
                finalStatus: 'FAILED' as const,
                failureCode: 'COMMERCIAL_DISPATCH_FAILED',
                investigationRequired: false,
                completedAt,
              }
            : {
                status: 'FAILED' as const,
                finalStatus: 'AMBIGUOUS' as const,
                failureCode: 'COMMERCIAL_DISPATCH_FAILED',
                investigationRequired: true,
                completedAt,
              };

      const changed = await this.prisma.commercialPipelineRun.updateMany({
        where: {
          id: current.id,
          dispatchId,
          mode: 'CONFIRMED',
          ...(kind === 'SENT'
            ? {}
            : kind === 'FAILED'
              ? {
                  OR: [
                    { status: 'STARTED' },
                    {
                      status: 'FAILED',
                      finalStatus: 'AMBIGUOUS',
                      investigationRequired: true,
                    },
                    {
                      status: 'FAILED',
                      finalStatus: 'FAILED',
                      investigationRequired: true,
                    },
                  ],
                }
              : { status: 'STARTED' }),
        } as never,
        data: data as never,
      });
      if (changed.count === 1) return { kind, transitioned: true };
    }

    throw new AppError(
      'Finalizacao comercial nao convergiu para um estado terminal',
      'COMMERCIAL_PIPELINE_RUN_FINALIZATION_CONFLICT',
    );
  }

  private resolveFinalizationKind(current: {
    status: string;
    finalStatus: string | null;
    investigationRequired: boolean;
    dispatch: { status: string } | null;
  }) {
    if (current.finalStatus === 'SENT' || current.dispatch?.status === 'SENT') {
      return 'SENT' as const;
    }
    if (
      (current.finalStatus === 'FAILED' &&
        !current.investigationRequired) ||
      current.dispatch?.status === 'FAILED'
    ) {
      return 'FAILED' as const;
    }
    return 'AMBIGUOUS' as const;
  }

  private isFinalizationPersisted(
    current: {
      status: string;
      finalStatus: string | null;
      investigationRequired: boolean;
    },
    kind: 'SENT' | 'FAILED' | 'AMBIGUOUS',
  ) {
    return (
      (kind === 'SENT' &&
        current.status === 'COMPLETED' &&
        current.finalStatus === 'SENT' &&
        !current.investigationRequired) ||
      (kind === 'FAILED' &&
        current.status === 'FAILED' &&
        current.finalStatus === 'FAILED' &&
        !current.investigationRequired) ||
      (kind === 'AMBIGUOUS' &&
        current.status === 'FAILED' &&
        current.finalStatus === 'AMBIGUOUS' &&
        current.investigationRequired)
    );
  }
}

export class PrismaCommercialDeliveryHistoryRepository implements CommercialDeliveryHistoryRepository {
  constructor(
    private readonly prisma: Pick<
      DatabaseClient,
      'whatsAppDispatch' | 'commercialPipelineRun'
    >,
  ) {}

  async wasProductSentToGroup(
    productId: string,
    groupId: string,
  ): Promise<boolean> {
    const [sentDispatch, confirmedRun] = await Promise.all([
      this.prisma.whatsAppDispatch.findFirst({
        where: {
          productId,
          destinationId: groupId,
          status: 'SENT',
        },
        select: { id: true },
      }),
      this.prisma.commercialPipelineRun.findFirst({
        where: {
          productId,
          groupDestinationId: groupId,
          mode: 'CONFIRMED',
          status: 'COMPLETED',
        },
        select: { id: true },
      }),
    ]);
    return Boolean(sentDispatch || confirmedRun);
  }

  async findLastSentAtByGroup(groupId: string): Promise<Date | null> {
    const dispatch = await this.prisma.whatsAppDispatch.findFirst({
      where: {
        destinationId: groupId,
        status: 'SENT',
        sentAt: { not: null },
      },
      orderBy: { sentAt: 'desc' },
      select: { sentAt: true },
    });
    return dispatch?.sentAt ?? null;
  }
}

const mapCommercialDispatchOutbox = (
  record: Record<string, unknown>,
): CommercialDispatchOutboxRecord =>
  record as unknown as CommercialDispatchOutboxRecord;

export class PrismaCommercialDispatchOutboxRepository implements CommercialDispatchOutboxRepository {
  constructor(private readonly prisma: DatabaseClient) {}

  async createPendingConfirmation(
    input: CommercialConfirmationPersistenceInput,
  ): Promise<CommercialDispatchOutboxRecord | null> {
    try {
      const record = await this.prisma.$transaction(async (transaction) => {
        const claimed = await transaction.commercialPipelineRun.updateMany({
          where: {
            id: input.runId,
            mode: 'DRY_RUN',
            status: 'COMPLETED',
            confirmedAt: null,
            dispatchId: null,
            jobId: null,
          },
          data: {
            mode: 'CONFIRMED',
            status: 'STARTED',
            confirmedAt: input.confirmedAt,
            completedAt: null,
            finalStatus: 'PENDING',
            failureCode: null,
            investigationRequired: false,
          },
        });
        if (claimed.count !== 1) {
          throw new CommercialConfirmationNotClaimedError();
        }

        if ('existingGeneratedCopyId' in input) {
          const existingCopy = await transaction.generatedCopy.findUnique({
            where: { id: input.existingGeneratedCopyId },
            select: {
              id: true,
              productId: true,
              source: true,
              snapshotId: true,
              createdFromCandidateId: true,
            },
          });
          if (
            !existingCopy ||
            existingCopy.id !== input.dispatch.generatedCopyId ||
            existingCopy.productId !== input.dispatch.productId ||
            existingCopy.source !== 'AI' ||
            !existingCopy.snapshotId ||
            !existingCopy.createdFromCandidateId
          ) {
            throw new AppError(
              'Copy promocional candidate-scoped invalida',
              'COMMERCIAL_OUTBOX_CANDIDATE_COPY_INVALID',
            );
          }
          const candidate =
            await transaction.commercialPromotionCandidate.findFirst({
              where: {
                id: existingCopy.createdFromCandidateId,
                generatedCopyId: existingCopy.id,
                productId: input.dispatch.productId,
                snapshotId: existingCopy.snapshotId,
                status: 'COPY_READY',
              },
              select: { id: true },
            });
          if (!candidate) {
            throw new AppError(
              'Candidato promocional nao esta pronto para envio',
              'COMMERCIAL_OUTBOX_CANDIDATE_COPY_INVALID',
            );
          }
          const reserved =
            await transaction.commercialPromotionCandidate.updateMany({
              where: {
                id: candidate.id,
                generatedCopyId: existingCopy.id,
                status: 'COPY_READY',
              },
              data: { status: 'RESERVED' },
            });
          if (reserved.count !== 1) {
            throw new AppError(
              'Candidato promocional mudou antes da reserva',
              'COMMERCIAL_OUTBOX_CANDIDATE_COPY_INVALID',
            );
          }
        } else {
          await transaction.generatedCopy.create({ data: input.copy });
        }
        await transaction.whatsAppDispatch.create({
          data: { ...input.dispatch, status: 'PENDING', attemptCount: 0 },
        });
        const outbox = await transaction.commercialDispatchOutbox.create({
          data: {
            id: input.outboxId,
            commercialRunId: input.runId,
            dispatchId: input.dispatch.id,
            jobId: input.jobId,
            status: 'PENDING',
          },
        });
        await transaction.commercialPipelineRun.update({
          where: { id: input.runId },
          data: { dispatchId: input.dispatch.id },
        });
        return outbox;
      });
      return mapCommercialDispatchOutbox(
        record as unknown as Record<string, unknown>,
      );
    } catch (error) {
      if (error instanceof CommercialConfirmationNotClaimedError) {
        return null;
      }
      if (isUniqueConstraintError(error)) {
        throw new AppError(
          'Estado persistido da confirmacao comercial e inconsistente',
          'COMMERCIAL_OUTBOX_INCONSISTENT',
        );
      }
      throw error;
    }
  }

  async list(filters: CommercialDispatchOutboxFilters) {
    const where = { status: filters.status };
    const [records, total] = await Promise.all([
      this.prisma.commercialDispatchOutbox.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.commercialDispatchOutbox.count({ where }),
    ]);
    return {
      items: records.map((record) =>
        mapCommercialDispatchOutbox(
          record as unknown as Record<string, unknown>,
        ),
      ),
      total,
    };
  }

  async findById(id: string): Promise<CommercialDispatchOutboxRecord | null> {
    const record = await this.prisma.commercialDispatchOutbox.findUnique({
      where: { id },
    });
    return record
      ? mapCommercialDispatchOutbox(
          record as unknown as Record<string, unknown>,
        )
      : null;
  }

  async findPublicationContext(
    id: string,
  ): Promise<CommercialDispatchOutboxPublicationContext | null> {
    const record = await this.prisma.commercialDispatchOutbox.findUnique({
      where: { id },
      include: {
        commercialRun: {
          select: {
            id: true,
            mode: true,
            status: true,
            dispatchId: true,
            jobId: true,
            finalStatus: true,
            investigationRequired: true,
          },
        },
        dispatch: { select: { id: true, status: true, attemptCount: true } },
      },
    });
    if (!record) return null;
    const { commercialRun, dispatch, ...outbox } = record;
    return {
      outbox: mapCommercialDispatchOutbox(
        outbox as unknown as Record<string, unknown>,
      ),
      run: commercialRun,
      dispatch,
    };
  }

  async markPublished(
    id: string,
    publishedAt: Date,
  ): Promise<CommercialDispatchOutboxRecord | null> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const outbox = await transaction.commercialDispatchOutbox.findUnique({
          where: { id },
        });
        if (!outbox || outbox.status === 'AMBIGUOUS') return null;
        if (outbox.status === 'PUBLISHED') {
          return mapCommercialDispatchOutbox(
            outbox as unknown as Record<string, unknown>,
          );
        }
        const promoted = await transaction.commercialDispatchOutbox.updateMany({
          where: { id, status: 'PENDING' },
          data: {
            status: 'PUBLISHED',
            failureCode: null,
            publishedAt,
          },
        });
        if (promoted.count !== 1) return null;
        const runUpdated = await transaction.commercialPipelineRun.updateMany({
          where: {
            id: outbox.commercialRunId,
            mode: 'CONFIRMED',
            dispatchId: outbox.dispatchId,
            OR: [{ jobId: null }, { jobId: outbox.jobId }],
          },
          data: { jobId: outbox.jobId },
        });
        if (runUpdated.count !== 1) {
          throw new CommercialOutboxStateConflictError();
        }
        const published = await transaction.commercialDispatchOutbox.findUnique(
          {
            where: { id },
          },
        );
        if (!published) throw new CommercialOutboxStateConflictError();
        return mapCommercialDispatchOutbox(
          published as unknown as Record<string, unknown>,
        );
      });
    } catch (error) {
      if (error instanceof CommercialOutboxStateConflictError) {
        return null;
      }
      throw error;
    }
  }

  async markAmbiguous(
    id: string,
    failureCode: string,
    completedAt: Date,
  ): Promise<CommercialDispatchOutboxRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const outbox = await transaction.commercialDispatchOutbox.findUnique({
        where: { id },
      });
      if (!outbox) return null;
      if (outbox.status === 'AMBIGUOUS') {
        return mapCommercialDispatchOutbox(
          outbox as unknown as Record<string, unknown>,
        );
      }
      const changed = await transaction.commercialDispatchOutbox.updateMany({
        where: { id, status: { in: ['PENDING', 'PUBLISHED'] } },
        data: { status: 'AMBIGUOUS', failureCode },
      });
      if (changed.count !== 1) return null;
      await transaction.commercialPipelineRun.update({
        where: { id: outbox.commercialRunId },
        data: {
          status: 'FAILED',
          finalStatus: 'AMBIGUOUS',
          investigationRequired: true,
          failureCode,
          completedAt,
        },
      });
      const ambiguous = await transaction.commercialDispatchOutbox.findUnique({
        where: { id },
      });
      if (!ambiguous) return null;
      return mapCommercialDispatchOutbox(
        ambiguous as unknown as Record<string, unknown>,
      );
    });
  }
}

const COMMERCIAL_AUTOMATION_SETTINGS_ID = 'commercial-automation';

export class PrismaCommercialAutomationSettingsRepository implements CommercialAutomationSettingsRepository {
  constructor(
    private readonly prisma: Pick<
      DatabaseClient,
      'commercialAutomationSettings'
    >,
  ) {}

  async get(): Promise<CommercialAutomationSettingsRecord | null> {
    return this.prisma.commercialAutomationSettings.findUnique({
      where: { id: COMMERCIAL_AUTOMATION_SETTINGS_ID },
    });
  }

  async getOrCreate(now: Date): Promise<CommercialAutomationSettingsRecord> {
    return this.prisma.commercialAutomationSettings.upsert({
      where: { id: COMMERCIAL_AUTOMATION_SETTINGS_ID },
      create: {
        id: COMMERCIAL_AUTOMATION_SETTINGS_ID,
        paused: true,
        pausedAt: now,
      },
      update: {},
    });
  }

  async setPaused(
    paused: boolean,
    now: Date,
  ): Promise<CommercialAutomationSettingsRecord> {
    const current = await this.getOrCreate(now);
    if (current.paused === paused) return current;
    return this.prisma.commercialAutomationSettings.update({
      where: { id: COMMERCIAL_AUTOMATION_SETTINGS_ID },
      data: paused
        ? { paused: true, pausedAt: now }
        : { paused: false, resumedAt: now },
    });
  }
}

const COMMERCIAL_AUTOMATION_ACTIVE_KEY = 'commercial-automation';

const staleCommercialExecutionWhere = (at: Date) => ({
  status: 'STARTED' as const,
  OR: [
    { activeKey: null },
    { ownerId: null },
    { heartbeatAt: null },
    { leaseExpiresAt: null },
    { leaseExpiresAt: { lte: at } },
  ],
});

const ownedCommercialExecutionWhere = (
  ownership: CommercialAutomationExecutionOwnership,
  at: Date,
) => ({
  id: ownership.executionId,
  status: 'STARTED' as const,
  ownerId: ownership.ownerId,
  activeKey: { not: null },
  leaseExpiresAt: { gt: at },
});

export class PrismaCommercialAutomationHistoryRepository implements CommercialAutomationHistoryRepository {
  constructor(
    private readonly prisma: Pick<
      DatabaseClient,
      | 'whatsAppDispatch'
      | 'commercialPipelineRun'
      | 'commercialAutomationExecution'
    >,
  ) {}

  async getSnapshot({
    groupId,
    dayStartsAt,
    dayEndsAt,
  }: {
    groupId?: string;
    dayStartsAt: Date;
    dayEndsAt: Date;
  }) {
    const sentDuringDay = {
      status: 'SENT' as const,
      sentAt: { gte: dayStartsAt, lt: dayEndsAt },
      destination: { type: 'GROUP' as const },
    };
    const [countsByGroup, lastSent, groupLastSent] = await Promise.all([
      this.prisma.whatsAppDispatch.groupBy({
        by: ['destinationId'],
        where: sentDuringDay,
        _count: { _all: true },
      }),
      this.prisma.whatsAppDispatch.findFirst({
        where: {
          status: 'SENT',
          sentAt: { not: null },
          destination: { type: 'GROUP' },
        },
        orderBy: { sentAt: 'desc' },
        select: { sentAt: true },
      }),
      groupId
        ? this.prisma.whatsAppDispatch.findFirst({
            where: {
              status: 'SENT',
              sentAt: { not: null },
              destination: { type: 'GROUP' },
              destinationId: groupId,
            },
            orderBy: { sentAt: 'desc' },
            select: { sentAt: true },
          })
        : Promise.resolve(null),
    ]);
    const globalSentToday = countsByGroup.reduce(
      (total, row) => total + row._count._all,
      0,
    );
    const groupSentToday = groupId
      ? (countsByGroup.find((row) => row.destinationId === groupId)?._count
          ._all ?? 0)
      : 0;
    return {
      globalSentToday,
      groupSentToday,
      lastSentAt: lastSent?.sentAt ?? null,
      globalLastSentAt: lastSent?.sentAt ?? null,
      groupLastSentAt: groupLastSent?.sentAt ?? null,
    };
  }

  async hasAmbiguousCommercialExecution(): Promise<boolean> {
    const [run, execution] = await Promise.all([
      this.prisma.commercialPipelineRun.findFirst({
        where: {
          OR: [{ finalStatus: 'AMBIGUOUS' }, { investigationRequired: true }],
        },
        select: { id: true },
      }),
      this.prisma.commercialAutomationExecution.findFirst({
        where: { status: 'AMBIGUOUS' },
        select: { id: true },
      }),
    ]);
    return Boolean(run || execution);
  }

  async hasActiveCommercialExecution(
    now: Date,
    excludedExecutionId?: string,
  ): Promise<boolean> {
    const [run, execution] = await Promise.all([
      this.prisma.commercialPipelineRun.findFirst({
        where: {
          OR: [
            { mode: 'CONFIRMED', status: 'STARTED' },
            { finalStatus: 'PENDING' },
            { dispatch: { status: { in: ['PENDING', 'PROCESSING'] } } },
          ],
        },
        select: { id: true },
      }),
      this.prisma.commercialAutomationExecution.findFirst({
        where: {
          status: 'STARTED',
          activeKey: { not: null },
          ownerId: { not: null },
          heartbeatAt: { not: null },
          leaseExpiresAt: { gt: now },
          ...(excludedExecutionId ? { id: { not: excludedExecutionId } } : {}),
        },
        select: { id: true },
      }),
    ]);
    return Boolean(run || execution);
  }

  async hasStaleCommercialExecution(now: Date): Promise<boolean> {
    return Boolean(
      await this.prisma.commercialAutomationExecution.findFirst({
        where: staleCommercialExecutionWhere(now),
        select: { id: true },
      }),
    );
  }
}

const mapCommercialAutomationExecution = (
  record: Record<string, unknown>,
): CommercialAutomationExecutionRecord => ({
  id: record.id as string,
  schedulerJobId: record.schedulerJobId as string,
  bullMqJobId: (record.bullMqJobId as string | null) ?? null,
  activeKey: (record.activeKey as string | null) ?? null,
  ownerId: (record.ownerId as string | null) ?? null,
  heartbeatAt: (record.heartbeatAt as Date | null) ?? null,
  leaseExpiresAt: (record.leaseExpiresAt as Date | null) ?? null,
  mode: record.mode as CommercialAutomationExecutionRecord['mode'],
  status: record.status as CommercialAutomationExecutionRecord['status'],
  reasons: record.reasons as string[],
  commercialRunId: (record.commercialRunId as string | null) ?? null,
  failureCode: (record.failureCode as string | null) ?? null,
  startedAt: record.startedAt as Date,
  completedAt: (record.completedAt as Date | null) ?? null,
});

export class PrismaCommercialAutomationExecutionRepository implements CommercialAutomationExecutionRepository {
  constructor(
    private readonly prisma: Pick<
      DatabaseClient,
      'commercialAutomationExecution' | 'commercialPipelineRun'
    >,
  ) {}

  private async findByBullMqJobId(bullMqJobId: string) {
    const record = await this.prisma.commercialAutomationExecution.findUnique({
      where: { bullMqJobId },
    });
    return record
      ? mapCommercialAutomationExecution(
          record as unknown as Record<string, unknown>,
        )
      : null;
  }

  async start(input: {
    schedulerJobId: string;
    bullMqJobId?: string;
    mode: CommercialAutomationExecutionRecord['mode'];
    startedAt: Date;
    ownerId: string;
    heartbeatAt: Date;
    leaseExpiresAt: Date;
  }) {
    try {
      const record = await this.prisma.commercialAutomationExecution.create({
        data: {
          schedulerJobId: input.schedulerJobId,
          bullMqJobId: input.bullMqJobId,
          activeKey: COMMERCIAL_AUTOMATION_ACTIVE_KEY,
          ownerId: input.ownerId,
          heartbeatAt: input.heartbeatAt,
          leaseExpiresAt: input.leaseExpiresAt,
          mode: input.mode,
          status: 'STARTED',
          reasons: [],
          startedAt: input.startedAt,
        },
      });
      return {
        outcome: 'created' as const,
        execution: mapCommercialAutomationExecution(
          record as unknown as Record<string, unknown>,
        ),
        ownership: {
          executionId: record.id,
          ownerId: input.ownerId,
        },
      };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existing = input.bullMqJobId
        ? await this.findByBullMqJobId(input.bullMqJobId)
        : null;
      if (existing)
        return { outcome: 'existing' as const, execution: existing };
      const active = await this.prisma.commercialAutomationExecution.findUnique(
        {
          where: { activeKey: COMMERCIAL_AUTOMATION_ACTIVE_KEY },
        },
      );
      return {
        outcome: 'concurrent' as const,
        stale: active
          ? isCommercialAutomationExecutionStale(
              mapCommercialAutomationExecution(
                active as unknown as Record<string, unknown>,
              ),
              input.startedAt,
            )
          : false,
      };
    }
  }

  async createBlocked(input: {
    schedulerJobId: string;
    bullMqJobId?: string;
    mode: CommercialAutomationExecutionRecord['mode'];
    reasons: string[];
    completedAt: Date;
  }) {
    try {
      const record = await this.prisma.commercialAutomationExecution.create({
        data: {
          schedulerJobId: input.schedulerJobId,
          bullMqJobId: input.bullMqJobId,
          mode: input.mode,
          status: 'BLOCKED',
          reasons: input.reasons,
          startedAt: input.completedAt,
          completedAt: input.completedAt,
        },
      });
      return mapCommercialAutomationExecution(
        record as unknown as Record<string, unknown>,
      );
    } catch (error) {
      if (!isUniqueConstraintError(error) || !input.bullMqJobId) throw error;
      const existing = await this.findByBullMqJobId(input.bullMqJobId);
      if (!existing) throw error;
      return existing;
    }
  }

  async heartbeat(
    ownership: CommercialAutomationExecutionOwnership,
    input: { heartbeatAt: Date; leaseExpiresAt: Date },
  ) {
    const updated = await this.prisma.commercialAutomationExecution.updateMany({
      where: {
        ...ownedCommercialExecutionWhere(ownership, input.heartbeatAt),
      },
      data: {
        heartbeatAt: input.heartbeatAt,
        leaseExpiresAt: input.leaseExpiresAt,
      },
    });
    if (updated.count !== 1) this.throwOwnershipLost();
  }

  async finish(
    ownership: CommercialAutomationExecutionOwnership,
    input: {
      status: Exclude<CommercialAutomationExecutionRecord['status'], 'STARTED'>;
      reasons?: string[];
      commercialRunId?: string;
      failureCode?: string;
      completedAt: Date;
    },
  ) {
    const updated = await this.prisma.commercialAutomationExecution.updateMany({
      where: {
        ...ownedCommercialExecutionWhere(ownership, input.completedAt),
      },
      data: {
        activeKey: null,
        status: input.status,
        reasons: input.reasons,
        commercialRunId: input.commercialRunId,
        failureCode: input.failureCode,
        completedAt: input.completedAt,
      },
    });
    if (updated.count !== 1) this.throwOwnershipLost();
    return this.findExecutionAfterMutation(ownership.executionId);
  }

  async findRecoveryContext(
    id: string,
  ): Promise<CommercialAutomationExecutionRecoveryContext | null> {
    const execution = await this.findById(id);
    if (!execution) return null;
    if (!execution.commercialRunId) return { execution, run: null };
    const run = await this.prisma.commercialPipelineRun.findUnique({
      where: { id: execution.commercialRunId },
      include: { dispatch: true, dispatchOutbox: true },
    });
    if (!run) return { execution, run: null };
    return {
      execution,
      run: {
        id: run.id,
        mode: run.mode,
        dispatchId: run.dispatchId,
        jobId: run.jobId,
        finalStatus: run.finalStatus,
        investigationRequired: run.investigationRequired,
        dispatch: run.dispatch
          ? {
              id: run.dispatch.id,
              status: run.dispatch.status,
              attemptCount: run.dispatch.attemptCount,
            }
          : null,
        outbox: run.dispatchOutbox
          ? mapCommercialDispatchOutbox(
              run.dispatchOutbox as unknown as Record<string, unknown>,
            )
          : null,
      },
    };
  }

  async recoverStale(
    id: string,
    input: {
      status: 'QUEUED' | 'FAILED' | 'AMBIGUOUS';
      failureCode?: string;
      completedAt: Date;
    },
  ) {
    const updated = await this.prisma.commercialAutomationExecution.updateMany({
      where: {
        id,
        ...staleCommercialExecutionWhere(input.completedAt),
      },
      data: {
        activeKey: null,
        status: input.status,
        failureCode: input.failureCode,
        completedAt: input.completedAt,
      },
    });
    if (updated.count !== 1) {
      const current = await this.findById(id);
      if (current && current.status !== 'STARTED') return current;
      this.throwOwnershipLost();
    }
    return this.findExecutionAfterMutation(id);
  }

  private async findExecutionAfterMutation(id: string) {
    const record = await this.findById(id);
    if (!record) this.throwOwnershipLost();
    return record;
  }

  private throwOwnershipLost(): never {
    throw new AppError(
      'Ownership da execucao comercial foi perdido',
      COMMERCIAL_EXECUTION_OWNERSHIP_LOST,
    );
  }

  async list(input: { page: number; limit: number }) {
    const where = {};
    const [records, total] = await Promise.all([
      this.prisma.commercialAutomationExecution.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      this.prisma.commercialAutomationExecution.count({ where }),
    ]);
    return {
      items: records.map((record) =>
        mapCommercialAutomationExecution(
          record as unknown as Record<string, unknown>,
        ),
      ),
      total,
    };
  }

  async findById(id: string) {
    const record = await this.prisma.commercialAutomationExecution.findUnique({
      where: { id },
    });
    return record
      ? mapCommercialAutomationExecution(
          record as unknown as Record<string, unknown>,
        )
      : null;
  }
}

const mapCoupon = (record: Record<string, unknown>): CouponRecord => ({
  ...(record as unknown as CouponRecord),
  discountValue: decimalString(
    record.discountValue as PrismaDecimalLike,
  ) as string,
  minPurchase:
    decimalString(record.minPurchase as PrismaDecimalLike | null) ?? null,
  maxDiscount:
    decimalString(record.maxDiscount as PrismaDecimalLike | null) ?? null,
});

export class PrismaCouponRepository implements CouponRepository {
  constructor(private readonly prisma: Pick<DatabaseClient, 'coupon'>) {}

  async create(data: CouponData): Promise<CouponRecord> {
    const record = await this.prisma.coupon.create({ data });
    return mapCoupon(record as unknown as Record<string, unknown>);
  }

  async list(): Promise<CouponRecord[]> {
    const records = await this.prisma.coupon.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return records.map((record) =>
      mapCoupon(record as unknown as Record<string, unknown>),
    );
  }

  async findById(id: string): Promise<CouponRecord | null> {
    const record = await this.prisma.coupon.findUnique({ where: { id } });
    return record
      ? mapCoupon(record as unknown as Record<string, unknown>)
      : null;
  }

  async update(
    id: string,
    data: Partial<CouponData>,
  ): Promise<CouponRecord | null> {
    const existing = await this.prisma.coupon.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) return null;
    const record = await this.prisma.coupon.update({ where: { id }, data });
    return mapCoupon(record as unknown as Record<string, unknown>);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.prisma.coupon.deleteMany({ where: { id } });
    return result.count === 1;
  }
}

export class PrismaGeneratedCopyRepository implements GeneratedCopyRepository {
  constructor(private readonly prisma: Pick<DatabaseClient, 'generatedCopy'>) {}

  async create(data: GeneratedCopyData): Promise<GeneratedCopyRecord> {
    return (await this.prisma.generatedCopy.create({
      data,
    })) as GeneratedCopyRecord;
  }

  async findById(id: string): Promise<GeneratedCopyRecord | null> {
    return (await this.prisma.generatedCopy.findUnique({
      where: { id },
    })) as GeneratedCopyRecord | null;
  }
}

export class PrismaWhatsAppDestinationRepository implements WhatsAppDestinationRepository {
  constructor(
    private readonly prisma: Pick<DatabaseClient, 'whatsAppDestination'>,
  ) {}

  async findById(id: string): Promise<WhatsAppDestinationRecord | null> {
    return (await this.prisma.whatsAppDestination.findFirst({
      where: { id, type: 'INDIVIDUAL' },
    })) as WhatsAppDestinationRecord | null;
  }

  async listActive(): Promise<WhatsAppDestinationRecord[]> {
    return (await this.prisma.whatsAppDestination.findMany({
      // Groups are authorized separately and never participate in Pipeline.
      where: { active: true, type: 'INDIVIDUAL' },
    })) as WhatsAppDestinationRecord[];
  }

  async create(
    data: WhatsAppDestinationData,
  ): Promise<WhatsAppDestinationRecord> {
    return (await this.prisma.whatsAppDestination.create({
      data: { ...data, type: 'INDIVIDUAL', available: true },
    })) as WhatsAppDestinationRecord;
  }

  async list(): Promise<WhatsAppDestinationRecord[]> {
    return (await this.prisma.whatsAppDestination.findMany({
      where: { type: 'INDIVIDUAL' },
      orderBy: { createdAt: 'desc' },
    })) as WhatsAppDestinationRecord[];
  }

  async update(
    id: string,
    data: WhatsAppDestinationUpdate,
  ): Promise<WhatsAppDestinationRecord | null> {
    try {
      const existing = await this.prisma.whatsAppDestination.findFirst({
        where: { id, type: 'INDIVIDUAL' },
        select: { id: true },
      });
      if (!existing) return null;
      return (await this.prisma.whatsAppDestination.update({
        where: { id },
        data,
      })) as WhatsAppDestinationRecord;
    } catch {
      return null;
    }
  }
}

export class PrismaWhatsAppGroupDirectoryRepository implements WhatsAppGroupDirectoryRepository {
  constructor(
    private readonly prisma: Pick<DatabaseClient, 'whatsAppDestination'>,
  ) {}

  async findById(id: string): Promise<WhatsAppGroupRecord | null> {
    return (await this.prisma.whatsAppDestination.findFirst({
      where: { id, type: 'GROUP' },
    })) as WhatsAppGroupRecord | null;
  }

  async findByExternalGroupId(
    sourceInstanceName: string,
    externalGroupId: string,
  ): Promise<WhatsAppGroupRecord | null> {
    return (await this.prisma.whatsAppDestination.findFirst({
      where: {
        type: 'GROUP',
        sourceInstanceName,
        destination: externalGroupId,
      },
    })) as WhatsAppGroupRecord | null;
  }

  async listByInstance(
    sourceInstanceName: string,
  ): Promise<WhatsAppGroupRecord[]> {
    return (await this.prisma.whatsAppDestination.findMany({
      where: { type: 'GROUP', sourceInstanceName },
      orderBy: { name: 'asc' },
    })) as WhatsAppGroupRecord[];
  }

  async list(
    sourceInstanceName: string,
    filters: WhatsAppGroupFilters = {},
  ): Promise<WhatsAppGroupRecord[]> {
    return (await this.prisma.whatsAppDestination.findMany({
      where: {
        type: 'GROUP',
        sourceInstanceName,
        active: filters.active,
        available: filters.available,
      },
      orderBy: { name: 'asc' },
    })) as WhatsAppGroupRecord[];
  }

  async create(data: WhatsAppGroupCreateData): Promise<WhatsAppGroupRecord> {
    return (await this.prisma.whatsAppDestination.create({
      data,
    })) as WhatsAppGroupRecord;
  }

  async update(
    id: string,
    data: WhatsAppGroupUpdate,
  ): Promise<WhatsAppGroupRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    return (await this.prisma.whatsAppDestination.update({
      where: { id },
      data,
    })) as WhatsAppGroupRecord;
  }
}

export class PrismaWhatsAppDispatchRepository implements WhatsAppDispatchRepository {
  constructor(
    private readonly prisma: Pick<DatabaseClient, 'whatsAppDispatch'>,
  ) {}

  async createPending(
    data: WhatsAppDispatchCreateData,
  ): Promise<WhatsAppDispatchRecord | null> {
    try {
      return (await this.prisma.whatsAppDispatch.create({
        data: { ...data, status: 'PENDING' },
      })) as WhatsAppDispatchRecord;
    } catch (error) {
      if (isUniqueConstraintError(error)) return null;
      throw error;
    }
  }

  async findByIdForSending(
    id: string,
  ): Promise<WhatsAppDispatchDetails | null> {
    const record = await this.prisma.whatsAppDispatch.findUnique({
      where: { id },
      select: {
        id: true,
        productId: true,
        generatedCopyId: true,
        destinationId: true,
        externalMessageId: true,
        status: true,
        attemptCount: true,
        errorMessage: true,
        sentAt: true,
        createdAt: true,
        updatedAt: true,
        destination: {
          select: {
            destination: true,
            type: true,
            active: true,
            available: true,
            fingerprint: true,
            sourceInstanceName: true,
          },
        },
        product: {
          select: {
            comissao: true,
          },
        },
        generatedCopy: {
          select: {
            id: true,
            productId: true,
            snapshotId: true,
            titulo: true,
            mensagem: true,
            cta: true,
            hashtags: true,
            createdFromCandidateId: true,
            promotionCandidates: {
              select: {
                id: true,
                productId: true,
                snapshotId: true,
                generatedCopyId: true,
                status: true,
                expiresAt: true,
                product: {
                  select: {
                    id: true,
                    unavailableAt: true,
                    affiliateLink: true,
                    urlImagem: true,
                    commercialSnapshotRevision: true,
                  },
                },
                snapshot: {
                  select: {
                    id: true,
                    productId: true,
                    revision: true,
                    unavailableAt: true,
                    offerEndsAt: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!record) {
      return null;
    }

    return record as WhatsAppDispatchDetails;
  }

  async findByIdWithDetails(
    id: string,
  ): Promise<WhatsAppDispatchDetails | null> {
    return (await this.prisma.whatsAppDispatch.findUnique({
      where: { id },
      include: { product: true, generatedCopy: true, destination: true },
    })) as WhatsAppDispatchDetails | null;
  }

  async list(
    filters: WhatsAppDispatchFilters,
  ): Promise<WhatsAppDispatchDetails[]> {
    const status = (
      ['PENDING', 'PROCESSING', 'SENT', 'FAILED'] as WhatsAppDispatchStatus[]
    ).includes(filters.status as WhatsAppDispatchStatus)
      ? (filters.status as WhatsAppDispatchStatus)
      : undefined;

    return (await this.prisma.whatsAppDispatch.findMany({
      where: {
        status,
        destinationId: filters.destinationId,
        productId: filters.productId,
      } as never,
      include: { product: true, generatedCopy: true, destination: true },
      orderBy: { createdAt: 'desc' },
    })) as WhatsAppDispatchDetails[];
  }

  async markAttemptPending(id: string): Promise<boolean> {
    const result = await this.prisma.whatsAppDispatch.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: 'PROCESSING',
        attemptCount: { increment: 1 },
        errorMessage: null,
      } as never,
    });
    return result.count === 1;
  }

  async markSent(
    id: string,
    data: { externalMessageId: string; sentAt: Date },
  ): Promise<WhatsAppDispatchRecord> {
    return (await this.prisma.whatsAppDispatch.update({
      where: { id },
      data: {
        status: 'SENT',
        externalMessageId: data.externalMessageId,
        sentAt: data.sentAt,
        errorMessage: null,
      },
    })) as WhatsAppDispatchRecord;
  }

  async markFailed(
    id: string,
    errorMessage: string,
  ): Promise<WhatsAppDispatchRecord> {
    return (await this.prisma.whatsAppDispatch.update({
      where: { id },
      data: { status: 'FAILED', errorMessage },
    })) as WhatsAppDispatchRecord;
  }
}
