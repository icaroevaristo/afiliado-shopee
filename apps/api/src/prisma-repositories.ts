import {
  Prisma,
  type DatabaseClient,
} from '@shopee-auto-affiliate-ai/database';
import type {
  AnalyticsRepository,
  CommercialAutomationExecutionRecord,
  CommercialAutomationExecutionOwnership,
  CommercialAutomationExecutionRecoveryContext,
  CommercialAutomationExecutionRepository,
  CommercialPreConfirmationReservationRecoveryResult,
  CommercialAutomationHistoryRepository,
  CommercialAutomationSettingsRecord,
  CommercialAutomationScheduleUpdate,
  CommercialAutomationSettingsRepository,
  CommercialExternalProviderUsageRecord,
  CommercialExternalProviderUsageRepository,
  OperationalStatusCounts,
  OperationalStatusRepository,
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
  CommercialGroupCampaignAttemptRenewal,
  CommercialGroupCampaignAttemptRenewalInput,
  CommercialGroupCampaignRecord,
  CommercialGroupCampaignRepository,
  CommercialGroupCampaignUpdateData,
  CommercialNicheData,
  CommercialNicheFilters,
  CommercialNicheRecord,
  CommercialNicheRepository,
  CommercialOfferCandidateFilters,
  CommercialOfferSnapshotBackfillRepository,
  CatalogDispatchHistory,
  CatalogSnapshot,
  CommercialStateSummary,
  OperationalCatalogDetail,
  OperationalCatalogFilters,
  OperationalCatalogOffer,
  OperationalCatalogRepository,
  OperationalCatalogScore,
  CommercialPromotionCandidateRecord,
  CommercialPromotionCandidateRepository,
  CommercialPromotionAttemptContext,
  CommercialPromotionCatalogRepository,
  CommercialPromotionCopyContext,
  CommercialPromotionCopyRepository,
  CommercialCopyGenerationAttemptStatusRecord,
  CommercialPromotionMaterializationInput,
  CommercialPromotionSnapshotRecord,
  CommercialManualCandidateMaterializationInput,
  ManualPublicationAcceptance,
  ManualPublicationQuotaReservation,
  ManualPublicationQuotaReservationInput,
  ManualPublicationRequestCreateData,
  ManualPublicationRequestMode,
  ManualPublicationRequestRecord,
  ManualPublicationRequestRepository,
  ManualPublicationLifecycleFinalizationInput,
  ManualPublicationLifecycleFinalizationResult,
  ManualPublicationSafePreProviderReconciliationInput,
  ManualPublicationSafePreProviderReconciliationResult,
  ManualPublicationRequestUpdate,
  ManualPublicationTargetRecord,
  ManualPublicationTargetUpdate,
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
  ShopeeCategoryRecord,
  ShopeeCategoryBackfillRepository,
  WhatsAppDestinationData,
  WhatsAppDestinationRecord,
  WhatsAppDestinationRepository,
  WhatsAppDestinationUpdate,
  WhatsAppInstanceRecord,
  WhatsAppInstanceRepository,
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
  COMMERCIAL_AUTOMATION_SCHEDULE_REVISION_STALE,
  isCommercialAutomationExecutionStale,
} from './commercial-automation-execution-domain';
import {
  fingerprintCommercialOffer,
  type CommercialOfferFingerprintInput,
} from './commercial-offer-snapshot';
import {
  aggregateManualPublicationRequestStatus,
  isManualPublicationRequestTerminal,
  resolveManualPublicationTerminalStatus,
  type ManualPublicationLifecycleObservation,
} from './manual-publication-lifecycle-finalizer';
import {
  assertCompatibleShopeeProductIdentity,
  assertCompleteShopeeProductIdentity,
} from './shopee-product-identity';
import { sha256 } from './commercial-ai-copy-fingerprint';
import { sanitizeCommercialAiCopyValidationFailureCodes } from './commercial-ai-copy-validator';
import { isSafeAssembledCommercialPromotionCopy } from './commercial-promotion-copy-assembler';

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

const whatsappGroupAssignmentInclude = {
  instanceAssignments: {
    select: { instanceName: true, position: true },
    orderBy: { position: 'asc' as const },
  },
} as const;

const mapWhatsAppGroupRecord = (
  record: Record<string, unknown>,
): WhatsAppGroupRecord => {
  const publicRecord = { ...record };
  const assignments = Array.isArray(publicRecord.instanceAssignments)
    ? publicRecord.instanceAssignments
        .filter(
          (
            assignment,
          ): assignment is { instanceName: string; position: number } =>
            typeof assignment === 'object' &&
            assignment !== null &&
            typeof (assignment as { instanceName?: unknown }).instanceName ===
              'string' &&
            typeof (assignment as { position?: unknown }).position === 'number',
        )
        .sort((left, right) => left.position - right.position)
    : [];
  delete publicRecord.instanceAssignments;
  const legacyAssignment = publicRecord.assignedInstanceName;
  const assignmentNames = assignments.map(
    (assignment) => assignment.instanceName,
  );
  return {
    ...(publicRecord as unknown as WhatsAppGroupRecord),
    ...(assignmentNames.length > 0
      ? { assignedInstanceNames: assignmentNames }
      : {}),
    ...(typeof publicRecord.assignmentRevision === 'number'
      ? { assignmentRevision: publicRecord.assignmentRevision }
      : {}),
    ...(assignmentNames.length === 0 &&
    typeof legacyAssignment === 'string' &&
    legacyAssignment.trim() !== ''
      ? { assignedInstanceNames: [legacyAssignment] }
      : {}),
  };
};

const mapWhatsAppDestinationWithAssignments = (
  record: Record<string, unknown>,
): WhatsAppDispatchDetails['destination'] => {
  const publicRecord = { ...record };
  const assignments = Array.isArray(publicRecord.instanceAssignments)
    ? publicRecord.instanceAssignments
        .filter(
          (assignment) =>
            typeof assignment === 'object' &&
            assignment !== null &&
            typeof (assignment as { instanceName?: unknown }).instanceName ===
              'string' &&
            typeof (assignment as { position?: unknown }).position === 'number',
        )
        .sort(
          (left, right) =>
            Number((left as { position: number }).position) -
            Number((right as { position: number }).position),
        )
    : [];
  delete publicRecord.instanceAssignments;
  const assignedInstanceNames = assignments.map((assignment) =>
    String((assignment as { instanceName: string }).instanceName),
  );
  return {
    ...publicRecord,
    ...(assignedInstanceNames.length > 0 ? { assignedInstanceNames } : {}),
  } as unknown as WhatsAppDispatchDetails['destination'];
};

const normalizeGroupAssignmentNames = (
  value: unknown,
  options: { allowEmpty: boolean },
) => {
  if (!Array.isArray(value)) {
    throw new AppError(
      'Lista ordenada de instancias do grupo e invalida',
      'WHATSAPP_GROUP_ASSIGNMENT_INVALID',
    );
  }
  const names = value.map((name) =>
    typeof name === 'string' ? name.trim() : '',
  );
  if (
    (!options.allowEmpty && names.length === 0) ||
    names.some((name) => name === '') ||
    new Set(names).size !== names.length
  ) {
    throw new AppError(
      'Lista ordenada de instancias do grupo e invalida',
      'WHATSAPP_GROUP_ASSIGNMENT_INVALID',
    );
  }
  return names;
};

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
  record:
    | Record<string, unknown>
    | Prisma.ProductLeadGetPayload<Prisma.ProductLeadDefaultArgs>,
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

const catalogProductInclude = {
  commercialOfferSnapshots: {
    orderBy: [{ revision: 'desc' }, { id: 'asc' }],
    take: 1,
  },
} satisfies Prisma.ProductLeadInclude;

type CatalogProductRow = Prisma.ProductLeadGetPayload<{
  include: typeof catalogProductInclude;
}>;

type CatalogSelectionRow = {
  id: string;
  bestCurrentCommercialScore: number | null;
  globalEverSent: boolean;
  globalSentDestinationCount: bigint | number;
  globalLastSentAt: Date | null;
  scopedEverSent: boolean;
  scopedLastSentAt: Date | null;
};

type CatalogCandidateAggregateRow = {
  productId: string;
  currentCandidateCount: bigint | number;
  queued: bigint | number;
  copyReady: bigint | number;
  reserved: bigint | number;
  dispatched: bigint | number;
  blocked: bigint | number;
  expired: bigint | number;
  bestCurrentCommercialScore: number | null;
};

type CatalogCurrentCandidateRow = {
  productId: string;
  candidateId: string;
  campaignId: string;
  campaignName: string;
  nicheId: string;
  score: number;
  rankPosition: number | null;
  candidateStatus: OperationalCatalogScore['candidateStatus'];
};

const CATALOG_CURRENT_CANDIDATE_LIMIT = 100;

const catalogCandidateAggregateSql = (productIds: string[]) => Prisma.sql`
  SELECT
    candidate."productId" AS "productId",
    COUNT(*) AS "currentCandidateCount",
    COUNT(*) FILTER (WHERE candidate."status" = 'QUEUED') AS "queued",
    COUNT(*) FILTER (WHERE candidate."status" = 'COPY_READY') AS "copyReady",
    COUNT(*) FILTER (WHERE candidate."status" = 'RESERVED') AS "reserved",
    COUNT(*) FILTER (WHERE candidate."status" = 'DISPATCHED') AS "dispatched",
    COUNT(*) FILTER (WHERE candidate."status" = 'BLOCKED') AS "blocked",
    COUNT(*) FILTER (WHERE candidate."status" = 'EXPIRED') AS "expired",
    MAX(candidate."commercialScore") AS "bestCurrentCommercialScore"
  FROM "ProductLead" product
  INNER JOIN "CommercialOfferSnapshot" snapshot
    ON snapshot."productId" = product."id"
    AND snapshot."revision" = product."commercialSnapshotRevision"
    AND snapshot."fingerprint" = product."commercialSnapshotFingerprint"
  INNER JOIN "CommercialPromotionCandidate" candidate
    ON candidate."productId" = product."id"
    AND candidate."snapshotId" = snapshot."id"
  WHERE product."id" IN (${Prisma.join(productIds)})
  GROUP BY candidate."productId"
`;

const catalogCurrentCandidatesSql = (productIds: string[]) => Prisma.sql`
  WITH current_candidates AS (
    SELECT
      candidate."productId" AS "productId",
      candidate."id" AS "candidateId",
      campaign."id" AS "campaignId",
      campaign."name" AS "campaignName",
      campaign."nicheId" AS "nicheId",
      candidate."commercialScore" AS "score",
      candidate."rankPosition" AS "rankPosition",
      candidate."status" AS "candidateStatus",
      ROW_NUMBER() OVER (
        PARTITION BY candidate."productId"
        ORDER BY
          candidate."commercialScore" DESC,
          candidate."campaignId" ASC,
          candidate."id" ASC
      ) AS "currentPosition"
    FROM "ProductLead" product
    INNER JOIN "CommercialOfferSnapshot" snapshot
      ON snapshot."productId" = product."id"
      AND snapshot."revision" = product."commercialSnapshotRevision"
      AND snapshot."fingerprint" = product."commercialSnapshotFingerprint"
    INNER JOIN "CommercialPromotionCandidate" candidate
      ON candidate."productId" = product."id"
      AND candidate."snapshotId" = snapshot."id"
    INNER JOIN "CommercialGroupCampaign" campaign
      ON campaign."id" = candidate."campaignId"
    WHERE product."id" IN (${Prisma.join(productIds)})
  )
  SELECT
    "productId",
    "candidateId",
    "campaignId",
    "campaignName",
    "nicheId",
    "score",
    "rankPosition",
    "candidateStatus"
  FROM current_candidates
  WHERE "currentPosition" <= ${CATALOG_CURRENT_CANDIDATE_LIMIT}
  ORDER BY
    "productId" ASC,
    "score" DESC,
    "campaignId" ASC,
    "candidateId" ASC
`;

const catalogSnapshotFromRecord = (
  snapshot: Prisma.CommercialOfferSnapshotGetPayload<Prisma.CommercialOfferSnapshotDefaultArgs>,
): CatalogSnapshot => ({
  id: snapshot.id,
  revision: snapshot.revision,
  fingerprint: snapshot.fingerprint,
  price: snapshot.price.toString(),
  priceMin: snapshot.priceMin?.toString() ?? null,
  priceMax: snapshot.priceMax?.toString() ?? null,
  discountRate: snapshot.discountRate,
  commissionRate: snapshot.commissionRate,
  observedRating: snapshot.observedRating,
  observedSales: snapshot.observedSales,
  offerStartsAt: snapshot.offerStartsAt,
  offerEndsAt: snapshot.offerEndsAt,
  unavailableAt: snapshot.unavailableAt,
  capturedAt: snapshot.capturedAt,
});

const countAsNumber = (value: bigint | number) => Number(value);

const catalogScoresByProductId = (
  candidates: CatalogCurrentCandidateRow[],
): Map<string, OperationalCatalogScore[]> => {
  const scoresByProductId = new Map<string, OperationalCatalogScore[]>();
  for (const candidate of candidates) {
    const scores = scoresByProductId.get(candidate.productId) ?? [];
    scores.push({
      candidateId: candidate.candidateId,
      campaignId: candidate.campaignId,
      campaignName: candidate.campaignName,
      nicheId: candidate.nicheId,
      score: candidate.score,
      rankPosition: candidate.rankPosition,
      candidateStatus: candidate.candidateStatus,
    });
    scoresByProductId.set(candidate.productId, scores);
  }
  return scoresByProductId;
};

const commercialStateSummaryFromAggregate = (
  aggregate: CatalogCandidateAggregateRow | undefined,
): CommercialStateSummary => ({
  currentCandidateCount: countAsNumber(aggregate?.currentCandidateCount ?? 0),
  queued: countAsNumber(aggregate?.queued ?? 0),
  copyReady: countAsNumber(aggregate?.copyReady ?? 0),
  reserved: countAsNumber(aggregate?.reserved ?? 0),
  dispatched: countAsNumber(aggregate?.dispatched ?? 0),
  blocked: countAsNumber(aggregate?.blocked ?? 0),
  expired: countAsNumber(aggregate?.expired ?? 0),
  bestCurrentCommercialScore: aggregate?.bestCurrentCommercialScore ?? null,
});

const catalogOfferFromRecord = (
  product: CatalogProductRow,
  selection: CatalogSelectionRow,
  destinationId: string | undefined,
  candidateAggregate: CatalogCandidateAggregateRow | undefined,
  commercialScores: OperationalCatalogScore[],
): OperationalCatalogOffer => {
  const latestSnapshot = product.commercialOfferSnapshots[0] ?? null;
  return {
    ...mapShopeeOffer(product),
    affiliateLinkPresent: Boolean(product.affiliateLink),
    referencePrice: null,
    referencePriceUnavailableReason: 'OFFICIAL_REFERENCE_PRICE_NOT_AVAILABLE',
    commercialSnapshotRevision: product.commercialSnapshotRevision,
    commercialSnapshotFingerprint: product.commercialSnapshotFingerprint,
    snapshot: latestSnapshot ? catalogSnapshotFromRecord(latestSnapshot) : null,
    capturedAt: latestSnapshot?.capturedAt ?? product.fetchedAt,
    capturedAtSource: latestSnapshot
      ? 'LATEST_SNAPSHOT'
      : 'FALLBACK_FETCHED_AT',
    commercialScores,
    bestCurrentCommercialScore:
      candidateAggregate?.bestCurrentCommercialScore ?? null,
    commercialStateSummary:
      commercialStateSummaryFromAggregate(candidateAggregate),
    everSent: selection.globalEverSent,
    sentDestinationCount: countAsNumber(selection.globalSentDestinationCount),
    lastSentAt: selection.globalLastSentAt,
    destinationDelivery: destinationId
      ? {
          destinationId,
          everSent: selection.scopedEverSent,
          lastSentAt: selection.scopedLastSentAt,
        }
      : null,
  };
};

const sqlAnd = (conditions: Prisma.Sql[]) =>
  conditions.length === 0 ? Prisma.empty : Prisma.join(conditions, ' AND ');

const catalogOrderBy = (sort: OperationalCatalogFilters['sort']) => {
  const orderBy: Record<OperationalCatalogFilters['sort'], Prisma.Sql> = {
    recent: Prisma.sql`catalog."capturedAt" DESC NULLS LAST, catalog."id" ASC`,
    sales_desc: Prisma.sql`catalog."sales" DESC, catalog."id" ASC`,
    score_desc: Prisma.sql`catalog."bestCurrentCommercialScore" DESC NULLS LAST, catalog."id" ASC`,
    discount_desc: Prisma.sql`catalog."discountRate" DESC, catalog."id" ASC`,
    commission_desc: Prisma.sql`catalog."commissionRate" DESC, catalog."id" ASC`,
    price_asc: Prisma.sql`catalog."price" ASC, catalog."id" ASC`,
    price_desc: Prisma.sql`catalog."price" DESC, catalog."id" ASC`,
  };
  return orderBy[sort];
};

const catalogSql = (filters: OperationalCatalogFilters) => {
  const now = new Date();
  const destinationId = filters.destinationId ?? null;
  const conditions: Prisma.Sql[] = [];
  if (filters.source)
    conditions.push(
      Prisma.sql`p."source" = ${filters.source}::"ShopeeOfferSource"`,
    );
  if (filters.affiliateLink === 'present') {
    conditions.push(Prisma.sql`p."affiliateLink" IS NOT NULL`);
  }
  if (filters.affiliateLink === 'missing') {
    conditions.push(Prisma.sql`p."affiliateLink" IS NULL`);
  }
  if (filters.keyword) {
    const keyword = `%${filters.keyword}%`;
    conditions.push(
      Prisma.sql`(p."nome" ILIKE ${keyword} OR p."loja" ILIKE ${keyword})`,
    );
  }
  if (filters.categoryId) {
    conditions.push(
      Prisma.sql`p."categoryIds" @> ARRAY[${filters.categoryId}]::text[]`,
    );
  }
  if (filters.minDiscount !== undefined) {
    conditions.push(Prisma.sql`p."desconto" >= ${filters.minDiscount}`);
  }
  if (filters.maxDiscount !== undefined) {
    conditions.push(Prisma.sql`p."desconto" <= ${filters.maxDiscount}`);
  }
  if (filters.minPrice !== undefined) {
    conditions.push(Prisma.sql`p."preco" >= ${filters.minPrice}`);
  }
  if (filters.maxPrice !== undefined) {
    conditions.push(Prisma.sql`p."preco" <= ${filters.maxPrice}`);
  }
  if (filters.minCommission !== undefined) {
    conditions.push(Prisma.sql`p."comissao" >= ${filters.minCommission}`);
  }
  if (filters.maxCommission !== undefined) {
    conditions.push(Prisma.sql`p."comissao" <= ${filters.maxCommission}`);
  }
  if (filters.minScore !== undefined) {
    conditions.push(
      Prisma.sql`score."bestCurrentCommercialScore" >= ${filters.minScore}`,
    );
  }
  if (filters.maxScore !== undefined) {
    conditions.push(
      Prisma.sql`score."bestCurrentCommercialScore" <= ${filters.maxScore}`,
    );
  }
  if (filters.capturedFrom) {
    conditions.push(
      Prisma.sql`COALESCE(latest."capturedAt", p."fetchedAt") >= ${filters.capturedFrom}`,
    );
  }
  if (filters.capturedTo) {
    conditions.push(
      Prisma.sql`COALESCE(latest."capturedAt", p."fetchedAt") <= ${filters.capturedTo}`,
    );
  }
  if (filters.status === 'UNAVAILABLE') {
    conditions.push(Prisma.sql`p."unavailableAt" IS NOT NULL`);
  }
  if (filters.status === 'EXPIRED') {
    conditions.push(
      Prisma.sql`p."unavailableAt" IS NULL AND p."offerEndsAt" <= ${now}`,
    );
  }
  if (filters.status === 'ACTIVE') {
    conditions.push(
      Prisma.sql`p."unavailableAt" IS NULL AND (p."offerEndsAt" IS NULL OR p."offerEndsAt" > ${now})`,
    );
  }
  if (filters.deliveryStatus === 'sent') {
    conditions.push(Prisma.sql`delivery."scopedEverSent" = true`);
  }
  if (filters.deliveryStatus === 'not_sent') {
    conditions.push(Prisma.sql`delivery."scopedEverSent" = false`);
  }
  const where = sqlAnd(conditions);
  const whereClause =
    conditions.length === 0 ? Prisma.empty : Prisma.sql`WHERE ${where}`;
  return Prisma.sql`
    WITH catalog AS (
      SELECT
        p."id" AS "id",
        p."preco" AS "price",
        p."vendidos" AS "sales",
        p."desconto" AS "discountRate",
        p."comissao" AS "commissionRate",
        COALESCE(latest."capturedAt", p."fetchedAt") AS "capturedAt",
        score."bestCurrentCommercialScore" AS "bestCurrentCommercialScore",
        global_delivery."globalEverSent" AS "globalEverSent",
        global_delivery."globalSentDestinationCount" AS "globalSentDestinationCount",
        global_delivery."globalLastSentAt" AS "globalLastSentAt",
        delivery."scopedEverSent" AS "scopedEverSent",
        delivery."scopedLastSentAt" AS "scopedLastSentAt"
      FROM "ProductLead" p
      LEFT JOIN LATERAL (
        SELECT snapshot."capturedAt"
        FROM "CommercialOfferSnapshot" snapshot
        WHERE snapshot."productId" = p."id"
        ORDER BY snapshot."revision" DESC, snapshot."id" ASC
        LIMIT 1
      ) latest ON true
      LEFT JOIN LATERAL (
        SELECT MAX(candidate."commercialScore") AS "bestCurrentCommercialScore"
        FROM "CommercialOfferSnapshot" snapshot
        INNER JOIN "CommercialPromotionCandidate" candidate
          ON candidate."snapshotId" = snapshot."id"
          AND candidate."productId" = p."id"
        INNER JOIN "CommercialGroupCampaign" campaign
          ON campaign."id" = candidate."campaignId"
        WHERE snapshot."productId" = p."id"
          AND snapshot."revision" = p."commercialSnapshotRevision"
          AND snapshot."fingerprint" = p."commercialSnapshotFingerprint"
      ) score ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) > 0 AS "globalEverSent",
          COUNT(DISTINCT dispatch."destinationId") AS "globalSentDestinationCount",
          MAX(dispatch."sentAt") AS "globalLastSentAt"
        FROM "WhatsAppDispatch" dispatch
        WHERE dispatch."productId" = p."id" AND dispatch."status" = 'SENT'
      ) global_delivery ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) > 0 AS "scopedEverSent",
          MAX(dispatch."sentAt") AS "scopedLastSentAt"
        FROM "WhatsAppDispatch" dispatch
        WHERE dispatch."productId" = p."id"
          AND dispatch."status" = 'SENT'
          AND (${destinationId}::text IS NULL OR dispatch."destinationId" = ${destinationId})
      ) delivery ON true
      ${whereClause}
    )
  `;
};

const registerObservedOfficialCategories = async (
  client: Pick<DatabaseClient, 'shopeeCategory'>,
  categoryIds: string[],
  discoveredAt: Date,
) => {
  const uniqueCategoryIds = [...new Set(categoryIds.filter(Boolean))];
  if (uniqueCategoryIds.length === 0) return;
  await client.shopeeCategory.createMany({
    data: uniqueCategoryIds.map((id) => ({
      id,
      mappingSource: 'OFFICIAL_PRODUCT_CATEGORY_ID',
      discoveredAt,
    })),
    skipDuplicates: true,
  });
};

const catalogDispatchInclude = {
  destination: {
    select: {
      id: true,
      name: true,
      fingerprint: true,
      type: true,
    },
  },
  commercialPipelineRun: {
    select: {
      id: true,
      finalStatus: true,
      investigationRequired: true,
    },
  },
} satisfies Prisma.WhatsAppDispatchInclude;

type CatalogDispatchRow = Prisma.WhatsAppDispatchGetPayload<{
  include: typeof catalogDispatchInclude;
}>;

const catalogDispatchFromRecord = (
  dispatch: CatalogDispatchRow,
): CatalogDispatchHistory => ({
  dispatchId: dispatch.id,
  status: dispatch.status,
  destination: {
    id: dispatch.destination.id,
    name: dispatch.destination.name,
    fingerprint: dispatch.destination.fingerprint,
    type: dispatch.destination.type,
  },
  instanceName: dispatch.instanceName,
  sentAt: dispatch.sentAt,
  attemptCount: dispatch.attemptCount,
  run: dispatch.commercialPipelineRun
    ? {
        id: dispatch.commercialPipelineRun.id,
        finalStatus: dispatch.commercialPipelineRun.finalStatus,
        investigationRequired:
          dispatch.commercialPipelineRun.investigationRequired,
      }
    : null,
});

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
  implements
    ShopeeOfferRepository,
    OperationalCatalogRepository,
    CommercialOfferSnapshotBackfillRepository,
    ShopeeCategoryBackfillRepository
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
            await registerObservedOfficialCategories(
              transaction,
              offer.categoryIds,
              offer.fetchedAt,
            );
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
          await registerObservedOfficialCategories(
            transaction,
            offer.categoryIds,
            offer.fetchedAt,
          );
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

  async listOperationalCatalog(filters: OperationalCatalogFilters) {
    const catalog = catalogSql(filters);
    const skip = (filters.page - 1) * filters.limit;
    const [selection, totals] = await Promise.all([
      this.prisma.$queryRaw<CatalogSelectionRow[]>(Prisma.sql`
        ${catalog}
        SELECT
          catalog."id",
          catalog."bestCurrentCommercialScore",
          COALESCE(catalog."globalEverSent", false) AS "globalEverSent",
          COALESCE(catalog."globalSentDestinationCount", 0) AS "globalSentDestinationCount",
          catalog."globalLastSentAt",
          COALESCE(catalog."scopedEverSent", false) AS "scopedEverSent",
          catalog."scopedLastSentAt"
        FROM catalog
        ORDER BY ${catalogOrderBy(filters.sort)}
        OFFSET ${skip}
        LIMIT ${filters.limit}
      `),
      this.prisma.$queryRaw<Array<{ total: bigint | number }>>(Prisma.sql`
        ${catalog}
        SELECT COUNT(*) AS "total" FROM catalog
      `),
    ]);
    if (selection.length === 0) {
      return { items: [], total: countAsNumber(totals[0]?.total ?? 0) };
    }
    const productIds = selection.map(({ id }) => id);
    const records = await this.prisma.productLead.findMany({
      where: { id: { in: productIds } },
      include: catalogProductInclude,
    });
    const [candidateAggregates, currentCandidates] = await Promise.all([
      this.prisma.$queryRaw<CatalogCandidateAggregateRow[]>(
        catalogCandidateAggregateSql(productIds),
      ),
      this.prisma.$queryRaw<CatalogCurrentCandidateRow[]>(
        catalogCurrentCandidatesSql(productIds),
      ),
    ]);
    const aggregateByProductId = new Map(
      candidateAggregates.map((row) => [row.productId, row]),
    );
    const scoresByProductId = catalogScoresByProductId(currentCandidates);
    const recordById = new Map(records.map((record) => [record.id, record]));
    return {
      items: selection.flatMap((row) => {
        const product = recordById.get(row.id);
        return product
          ? [
              catalogOfferFromRecord(
                product,
                row,
                filters.destinationId,
                aggregateByProductId.get(row.id),
                scoresByProductId.get(row.id) ?? [],
              ),
            ]
          : [];
      }),
      total: countAsNumber(totals[0]?.total ?? 0),
    };
  }

  async findOperationalCatalogOffer(input: {
    id: string;
    dispatchPage: number;
    dispatchLimit: number;
    snapshotPage: number;
    snapshotLimit: number;
  }): Promise<OperationalCatalogDetail | null> {
    const product = await this.prisma.productLead.findUnique({
      where: { id: input.id },
      include: catalogProductInclude,
    });
    if (!product) return null;
    const [
      candidateAggregates,
      currentCandidates,
      sentStats,
      destinations,
      dispatches,
      snapshots,
    ] = await Promise.all([
      this.prisma.$queryRaw<CatalogCandidateAggregateRow[]>(
        catalogCandidateAggregateSql([input.id]),
      ),
      this.prisma.$queryRaw<CatalogCurrentCandidateRow[]>(
        catalogCurrentCandidatesSql([input.id]),
      ),
      this.prisma.whatsAppDispatch.aggregate({
        where: { productId: input.id, status: 'SENT' },
        _count: { _all: true },
        _max: { sentAt: true },
      }),
      this.prisma.whatsAppDispatch.groupBy({
        by: ['destinationId'],
        where: { productId: input.id, status: 'SENT' },
      }),
      this.prisma.whatsAppDispatch.findMany({
        where: { productId: input.id },
        include: catalogDispatchInclude,
        orderBy: [{ sentAt: 'desc' }, { id: 'asc' }],
        skip: (input.dispatchPage - 1) * input.dispatchLimit,
        take: input.dispatchLimit + 1,
      }),
      this.prisma.commercialOfferSnapshot.findMany({
        where: { productId: input.id },
        orderBy: [{ revision: 'desc' }, { id: 'asc' }],
        skip: (input.snapshotPage - 1) * input.snapshotLimit,
        take: input.snapshotLimit + 1,
      }),
    ]);
    const candidateAggregate = candidateAggregates[0];
    const dispatchPage = dispatches.slice(0, input.dispatchLimit);
    const snapshotPage = snapshots.slice(0, input.snapshotLimit);
    const selection: CatalogSelectionRow = {
      id: product.id,
      bestCurrentCommercialScore:
        candidateAggregate?.bestCurrentCommercialScore ?? null,
      globalEverSent: sentStats._count._all > 0,
      globalSentDestinationCount: destinations.length,
      globalLastSentAt: sentStats._max.sentAt,
      scopedEverSent: sentStats._count._all > 0,
      scopedLastSentAt: sentStats._max.sentAt,
    };
    return {
      ...catalogOfferFromRecord(
        product,
        selection,
        undefined,
        candidateAggregate,
        catalogScoresByProductId(currentCandidates).get(product.id) ?? [],
      ),
      dispatchHistory: {
        items: dispatchPage.map(catalogDispatchFromRecord),
        page: input.dispatchPage,
        limit: input.dispatchLimit,
        hasNextPage: dispatches.length > input.dispatchLimit,
        hasPreviousPage: input.dispatchPage > 1,
      },
      snapshotHistory: {
        items: snapshotPage.map(catalogSnapshotFromRecord),
        page: input.snapshotPage,
        limit: input.snapshotLimit,
        hasNextPage: snapshots.length > input.snapshotLimit,
        hasPreviousPage: input.snapshotPage > 1,
      },
    };
  }

  async listObservedCategories(): Promise<ShopeeCategoryRecord[]> {
    type CategoryRow = {
      id: string;
      name: string | null;
      parentId: string | null;
      mappingSource: 'OFFICIAL_PRODUCT_CATEGORY_ID';
      productCount: bigint | number;
    };
    const officialSource = 'OFFICIAL' as const;
    const rows = await this.prisma.$queryRaw<CategoryRow[]>(Prisma.sql`
      WITH official_category_counts AS (
        SELECT
          category_id AS "id",
          COUNT(DISTINCT product."id") AS "productCount"
        FROM "ProductLead" product
        CROSS JOIN LATERAL unnest(product."categoryIds") AS category_id
        WHERE product."source" = ${officialSource}::"ShopeeOfferSource"
          AND btrim(category_id) <> ''
        GROUP BY category_id
      )
      SELECT
        registry."id",
        registry."name",
        registry."parentId",
        registry."mappingSource",
        COALESCE(counts."productCount", 0) AS "productCount"
      FROM "ShopeeCategory" registry
      LEFT JOIN official_category_counts counts
        ON counts."id" = registry."id"
      ORDER BY
        CASE WHEN registry."name" IS NULL THEN 1 ELSE 0 END ASC,
        registry."name" ASC NULLS LAST,
        registry."id" ASC
    `);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      mappingSource: row.mappingSource,
      productCount: countAsNumber(row.productCount),
      displayLabel: row.name ?? `Categoria ${row.id}`,
    }));
  }

  async listProductCategoryIdsForBackfill({
    afterProductId,
    limit,
  }: {
    afterProductId?: string;
    limit: number;
  }) {
    const records = await this.prisma.productLead.findMany({
      where: {
        source: 'OFFICIAL',
        id: afterProductId ? { gt: afterProductId } : undefined,
      },
      select: { id: true, categoryIds: true },
      orderBy: { id: 'asc' },
      take: Math.min(Math.max(limit, 1), 500),
    });
    return records.map((record) => ({
      productId: record.id,
      categoryIds: record.categoryIds,
    }));
  }

  async createObservedCategories(categoryIds: string[], discoveredAt: Date) {
    const normalizedCategoryIds = [
      ...new Set(
        categoryIds
          .map((categoryId) => categoryId.trim())
          .filter((categoryId) => categoryId.length > 0),
      ),
    ].sort((left, right) => left.localeCompare(right));
    if (normalizedCategoryIds.length === 0) return 0;
    const result = await this.prisma.shopeeCategory.createMany({
      data: normalizedCategoryIds.map((id) => ({
        id,
        name: null,
        parentId: null,
        mappingSource: 'OFFICIAL_PRODUCT_CATEGORY_ID',
        discoveredAt,
      })),
      skipDuplicates: true,
    });
    return result.count;
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
      assignedInstanceName: true,
      assignmentRevision: true,
      instanceAssignments: whatsappGroupAssignmentInclude.instanceAssignments,
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
          assignedInstanceName: anchor.assignedInstanceName,
          assignedInstanceNames: anchor.instanceAssignments?.map(
            (assignment) => assignment.instanceName,
          ),
          assignmentRevision: anchor.assignmentRevision,
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
    return record ? mapCommercialGroupCampaign(record) : null;
  }

  async findByLogicalGroupFingerprint(logicalGroupFingerprint: string) {
    const record = await findCommercialGroupCampaign(this.prisma, {
      logicalGroupFingerprint,
    });
    return record ? mapCommercialGroupCampaign(record) : null;
  }

  async update(id: string, data: CommercialGroupCampaignUpdateData) {
    try {
      const scheduleChanged = [
        'cadenceMinutes',
        'timezone',
        'allowedStartTime',
        'allowedEndTime',
      ].some((field) => field in data);
      const updateCampaign = async (
        client: Pick<
          DatabaseClient,
          'commercialGroupCampaign' | 'commercialNiche'
        >,
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
      const record =
        data.nicheId || scheduleChanged
          ? await this.prisma.$transaction(
              async (transaction) => {
                const updated = await updateCampaign(transaction);
                if (updated && scheduleChanged) {
                  await transaction.commercialAutomationSettings.upsert({
                    where: { id: COMMERCIAL_AUTOMATION_SETTINGS_ID },
                    create: {
                      id: COMMERCIAL_AUTOMATION_SETTINGS_ID,
                      scheduleRevision: 1,
                    },
                    update: {
                      scheduleRevision: { increment: 1 },
                      updatedAt: new Date(),
                    },
                  });
                }
                return updated;
              },
              { isolationLevel: 'Serializable' },
            )
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
        assignedInstanceName: { not: null },
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
              assignedInstanceName: { not: null },
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

  async releaseAttempt(input: { campaignId: string; executionId: string }) {
    return this.attemptRepository.release(input);
  }

  async renewAttempt(input: CommercialGroupCampaignAttemptRenewalInput) {
    return this.attemptRepository.renew(input);
  }
}

type CommercialGroupCampaignAttemptState = {
  attemptExecutionId: string | null;
  attemptReservedAt: Date | null;
  attemptLeaseExpiresAt: Date | null;
};

type CommercialGroupCampaignAttemptPrismaDelegate = {
  updateMany(input: {
    where: {
      id: string;
      attemptExecutionId: string | null;
      attemptReservedAt?: Date | null;
      attemptLeaseExpiresAt?: Date | null | { gt?: Date; lt?: Date };
    };
    data:
      | CommercialGroupCampaignAttemptState
      | Pick<CommercialGroupCampaignAttemptState, 'attemptLeaseExpiresAt'>;
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

export class PrismaCommercialGroupCampaignAttemptRepository implements CommercialGroupCampaignAttemptRepository {
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

  async renew(
    input: CommercialGroupCampaignAttemptRenewalInput,
  ): Promise<CommercialGroupCampaignAttemptRenewal> {
    if (input.leaseExpiresAt.getTime() <= input.renewedAt.getTime()) {
      throw new AppError(
        'A nova expiracao da reserva deve estar no futuro',
        'COMMERCIAL_GROUP_CAMPAIGN_ATTEMPT_RENEWAL_LEASE_INVALID',
      );
    }

    const current = await this.findAttempt(input.campaignId);
    if (
      !current?.attemptExecutionId ||
      current.attemptExecutionId !== input.executionId ||
      !current.attemptReservedAt ||
      !current.attemptLeaseExpiresAt
    ) {
      return {
        kind: 'CONFLICT',
        campaignId: input.campaignId,
        executionId: input.executionId,
      };
    }
    if (
      current.attemptLeaseExpiresAt.getTime() >= input.leaseExpiresAt.getTime()
    ) {
      return {
        kind: 'RENEWED',
        campaignId: input.campaignId,
        executionId: input.executionId,
        leaseExpiresAt: current.attemptLeaseExpiresAt,
        renewed: false,
      };
    }

    const renewed = await this.campaigns.updateMany({
      where: {
        id: input.campaignId,
        attemptExecutionId: input.executionId,
        attemptReservedAt: current.attemptReservedAt,
        attemptLeaseExpiresAt: current.attemptLeaseExpiresAt,
      },
      data: { attemptLeaseExpiresAt: input.leaseExpiresAt },
    });
    if (renewed.count === 1) {
      return {
        kind: 'RENEWED',
        campaignId: input.campaignId,
        executionId: input.executionId,
        leaseExpiresAt: input.leaseExpiresAt,
        renewed: true,
      };
    }

    const afterRace = await this.findAttempt(input.campaignId);
    if (
      afterRace?.attemptExecutionId === input.executionId &&
      afterRace.attemptReservedAt &&
      afterRace.attemptLeaseExpiresAt &&
      afterRace.attemptLeaseExpiresAt.getTime() >=
        input.leaseExpiresAt.getTime()
    ) {
      return {
        kind: 'RENEWED',
        campaignId: input.campaignId,
        executionId: input.executionId,
        leaseExpiresAt: afterRace.attemptLeaseExpiresAt,
        renewed: false,
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
  manualSelectionOverride: Boolean(record.manualSelectionOverride),
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
  validationFailureCodes: sanitizeCommercialAiCopyValidationFailureCodes(
    record.validationFailureCodes,
  ),
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
  status:
    record.status as CommercialCopyGenerationAttemptStatusRecord['status'],
  failureCode: (record.failureCode as string | null) ?? null,
  requestMayHaveStarted: Boolean(record.requestMayHaveStarted),
  providerHttpStatus: (record.providerHttpStatus as number | null) ?? null,
  providerErrorCode: (record.providerErrorCode as string | null) ?? null,
  providerErrorType: (record.providerErrorType as string | null) ?? null,
  providerErrorParam: (record.providerErrorParam as string | null) ?? null,
  inputTokens: (record.inputTokens as number | null) ?? null,
  outputTokens: (record.outputTokens as number | null) ?? null,
  totalTokens: (record.totalTokens as number | null) ?? null,
  validationFailureCodes: sanitizeCommercialAiCopyValidationFailureCodes(
    record.validationFailureCodes,
  ),
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
      priceMin:
        decimalString(product.precoMin as PrismaDecimalLike | null) ?? null,
      priceMax:
        decimalString(product.precoMax as PrismaDecimalLike | null) ?? null,
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
  expectedCandidateState: 'QUEUED' | 'COPY_READY' = 'QUEUED',
) => {
  if (!current) return 'COMMERCIAL_AI_COPY_CANDIDATE_CHANGED';
  const candidateStateChanged =
    expectedCandidateState === 'QUEUED'
      ? current.candidate.status !== 'QUEUED' ||
        current.candidate.generatedCopyId !== null
      : current.candidate.status !== 'COPY_READY' ||
        current.candidate.generatedCopyId !==
          expected.candidate.generatedCopyId ||
        expected.candidate.generatedCopyId === null;
  if (
    candidateStateChanged ||
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

  async findOfficialCatalogItem(productId: string) {
    const product = await this.prisma.productLead.findFirst({
      where: { id: productId, source: 'OFFICIAL' },
    });
    if (!product) return null;
    const currentRevision = product.commercialSnapshotRevision;
    const [currentSnapshot, previousSnapshot, latestSnapshotRevision] =
      await Promise.all([
        currentRevision > 0
          ? this.prisma.commercialOfferSnapshot.findUnique({
              where: {
                productId_revision: {
                  productId,
                  revision: currentRevision,
                },
              },
            })
          : Promise.resolve(null),
        currentRevision > 1
          ? this.prisma.commercialOfferSnapshot.findUnique({
              where: {
                productId_revision: {
                  productId,
                  revision: currentRevision - 1,
                },
              },
            })
          : Promise.resolve(null),
        this.prisma.commercialOfferSnapshot.aggregate({
          where: { productId },
          _max: { revision: true },
        }),
      ]);
    return {
      product: mapShopeeOffer(product),
      commercialSnapshotRevision: currentRevision,
      commercialSnapshotFingerprint: product.commercialSnapshotFingerprint,
      latestSnapshotRevision: latestSnapshotRevision._max.revision ?? null,
      currentSnapshot: currentSnapshot
        ? mapCommercialPromotionSnapshot({ ...currentSnapshot })
        : null,
      previousSnapshot: previousSnapshot
        ? mapCommercialPromotionSnapshot({ ...previousSnapshot })
        : null,
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

  async findByCampaignAndProduct(campaignId: string, productId: string) {
    const record = await this.prisma.commercialPromotionCandidate.findUnique({
      where: { campaignId_productId: { campaignId, productId } },
    });
    return record ? mapCommercialPromotionCandidate({ ...record }) : null;
  }

  async ensureManualCandidate(
    input: CommercialManualCandidateMaterializationInput,
  ) {
    try {
      const record = await this.prisma.$transaction(
        async (transaction) => {
          const [campaign, product, snapshot, current] = await Promise.all([
            transaction.commercialGroupCampaign.findUnique({
              where: { id: input.campaignId },
              include: { niche: { select: { active: true } } },
            }),
            transaction.productLead.findUnique({
              where: { id: input.productId },
              select: {
                id: true,
                source: true,
                commercialSnapshotRevision: true,
                commercialSnapshotFingerprint: true,
                unavailableAt: true,
                offerEndsAt: true,
              },
            }),
            transaction.commercialOfferSnapshot.findUnique({
              where: { id: input.snapshotId },
              select: {
                id: true,
                productId: true,
                revision: true,
                fingerprint: true,
              },
            }),
            transaction.commercialPromotionCandidate.findUnique({
              where: {
                campaignId_productId: {
                  campaignId: input.campaignId,
                  productId: input.productId,
                },
              },
            }),
          ]);
          if (
            !campaign ||
            !campaign.active ||
            !campaign.niche.active ||
            !product ||
            product.source !== 'OFFICIAL' ||
            !snapshot ||
            snapshot.productId !== input.productId ||
            snapshot.revision !== input.snapshotRevision ||
            snapshot.fingerprint !== input.snapshotFingerprint ||
            product.commercialSnapshotRevision !== input.snapshotRevision ||
            product.commercialSnapshotFingerprint !== input.snapshotFingerprint
          ) {
            throw new AppError(
              'Produto ou campanha mudou antes da selecao manual',
              'MANUAL_PUBLICATION_STATE_CHANGED',
            );
          }
          if (
            product.unavailableAt ||
            (product.offerEndsAt && product.offerEndsAt <= input.now)
          ) {
            throw new AppError(
              'Produto oficial indisponivel para publicacao manual',
              'MANUAL_PUBLICATION_PRODUCT_INELIGIBLE',
            );
          }
          if (current?.status === 'RESERVED') {
            throw new AppError(
              'Produto e grupo ja possuem uma reserva ativa',
              'MANUAL_PUBLICATION_TARGET_CONFLICT',
            );
          }
          if (
            current?.status === 'DISPATCHED' &&
            current.dedupeUntil !== null &&
            current.dedupeUntil > input.now
          ) {
            throw new AppError(
              'Produto ja possui deduplicacao ativa para a campanha',
              'PRODUCT_ALREADY_SENT',
            );
          }

          const data = {
            snapshotId: input.snapshotId,
            status:
              current?.status === 'COPY_READY'
                ? ('COPY_READY' as const)
                : ('QUEUED' as const),
            rankPosition: null,
            commercialScore: input.commercialScore,
            scorePolicyVersion: input.scorePolicyVersion,
            minimumScoreUsed: input.minimumScoreUsed,
            scoreBreakdown: input.scoreBreakdown as never,
            promotionSignals: input.promotionSignals,
            priceDropPercent: input.priceDropPercent,
            lastEvaluatedAt: input.now,
            expiresAt: input.expiresAt,
            dedupeUntil: null,
            blockedReason: null,
            manualSelectionOverride: true,
          };
          const updated = current
            ? await transaction.commercialPromotionCandidate.update({
                where: { id: current.id },
                data: {
                  ...data,
                  generatedCopyId:
                    current.status === 'COPY_READY'
                      ? current.generatedCopyId
                      : null,
                  queuedAt:
                    current.status === 'COPY_READY'
                      ? current.queuedAt
                      : input.now,
                },
              })
            : await transaction.commercialPromotionCandidate.create({
                data: {
                  ...data,
                  campaignId: input.campaignId,
                  productId: input.productId,
                  queuedAt: input.now,
                },
              });
          return updated;
        },
        { isolationLevel: 'Serializable', maxWait: 1_000, timeout: 10_000 },
      );
      return mapCommercialPromotionCandidate({ ...record });
    } catch (error) {
      if (isUniqueConstraintError(error) || isTransactionConflictError(error)) {
        throw new AppError(
          'Outra selecao manual alterou o mesmo produto e grupo',
          'MANUAL_PUBLICATION_TARGET_CONFLICT',
        );
      }
      throw error;
    }
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
            ({ status, manualSelectionOverride }) =>
              status === 'COPY_READY' ||
              status === 'RESERVED' ||
              (status === 'QUEUED' && manualSelectionOverride),
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
              selectedIds.has(candidate.productId) ||
              candidate.manualSelectionOverride
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
    const candidates = await this.prisma.commercialPromotionCandidate.findMany({
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

    const current = await this.prisma.commercialPromotionCandidate.findUnique({
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
    const candidates = await this.prisma.commercialPromotionCandidate.findMany({
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

    const current = await this.prisma.commercialPromotionCandidate.findUnique({
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
    const candidates = await this.prisma.commercialPromotionCandidate.findMany({
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
    const candidates = await this.prisma.commercialPromotionCandidate.findMany({
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

  async releaseAttempt(input: { campaignId: string; executionId: string }) {
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
          const restartedBudgetAttempt =
            await transaction.commercialCopyGenerationAttempt.updateMany({
              where: {
                inputFingerprint: input.inputFingerprint,
                status: 'FAILED',
                failureCode: 'COMMERCIAL_OPENAI_DAILY_BUDGET_REACHED',
                requestMayHaveStarted: false,
                generatedCopyId: null,
              },
              data: {
                status: 'STARTED',
                failureCode: null,
                requestMayHaveStarted: false,
                providerHttpStatus: null,
                providerErrorCode: null,
                providerErrorType: null,
                providerErrorParam: null,
                inputTokens: null,
                outputTokens: null,
                totalTokens: null,
                validationFailureCodes: [],
                startedAt: input.startedAt,
                completedAt: null,
              },
            });
          if (restartedBudgetAttempt.count === 1) return;
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

  async linkCachedCopy(
    input: Parameters<CommercialPromotionCopyRepository['linkCachedCopy']>[0],
  ) {
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
            copy.createdFromCandidateId !== input.expected.candidate.id ||
            copy.provider !== input.provider ||
            copy.model !== input.model ||
            copy.promptVersion !== input.promptVersion ||
            copy.validationVersion !== input.validationVersion ||
            !current?.product.affiliateLink ||
            !isSafeAssembledCommercialPromotionCopy(
              input.assembled,
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
          if (updated.count !== 1) return false;
          await transaction.generatedCopy.update({
            where: { id: copy.id },
            data: {
              ...input.assembled,
              snapshotId: input.expected.snapshot.id,
              createdFromCandidateId: input.expected.candidate.id,
            },
          });
          return true;
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (isTransactionConflictError(error)) return false;
      throw error;
    }
  }

  async refreshCachedCopy(
    input: Parameters<
      CommercialPromotionCopyRepository['refreshCachedCopy']
    >[0],
  ) {
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const lockedCandidate = await transaction.$queryRaw<
            Array<{ id: string }>
          >`
            SELECT "id"
            FROM "CommercialPromotionCandidate"
            WHERE "id" = ${input.expected.candidate.id}
            FOR UPDATE
          `;
          if (lockedCandidate.length !== 1) return false;
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
              'COPY_READY',
            ) ||
            !copy ||
            copy.source !== 'AI' ||
            copy.inputFingerprint !== input.inputFingerprint ||
            copy.productId !== input.expected.product.id ||
            copy.snapshotId !== input.expected.snapshot.id ||
            copy.createdFromCandidateId !== input.expected.candidate.id ||
            copy.provider !== input.provider ||
            copy.model !== input.model ||
            copy.promptVersion !== input.promptVersion ||
            copy.validationVersion !== input.validationVersion ||
            !current?.product.affiliateLink ||
            !isSafeAssembledCommercialPromotionCopy(
              input.assembled,
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
          const updated = await transaction.generatedCopy.updateMany({
            where: {
              id: copy.id,
              inputFingerprint: input.inputFingerprint,
            },
            data: input.assembled,
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
          validationFailureCodes:
            sanitizeCommercialAiCopyValidationFailureCodes(
              input.validationFailureCodes,
            ),
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
    private readonly prisma: Pick<DatabaseClient, 'commercialPipelineRun'> &
      Partial<Pick<DatabaseClient, 'commercialAutomationExecution'>>,
  ) {}

  async create(
    data: CommercialPipelineRunData,
  ): Promise<CommercialPipelineRunRecord> {
    try {
      const record = await this.prisma.commercialPipelineRun.create({
        data: toPrismaCommercialPipelineRun(data) as never,
      });
      return mapCommercialPipelineRun(
        record as unknown as Record<string, unknown>,
      );
    } catch (error) {
      if (data.executionId && isUniqueConstraintError(error)) {
        throw new AppError(
          'A execucao ja esta associada a um run comercial',
          'COMMERCIAL_PIPELINE_RUN_EXECUTION_CONFLICT',
        );
      }
      throw error;
    }
  }

  async update(
    id: string,
    data: Partial<CommercialPipelineRunData>,
  ): Promise<CommercialPipelineRunRecord> {
    if (data.executionId !== undefined) {
      const current = await this.prisma.commercialPipelineRun.findUnique({
        where: { id },
        select: { executionId: true },
      });
      if (current && current.executionId !== data.executionId) {
        throw new AppError(
          'O vinculo da execucao do run comercial e imutavel',
          'COMMERCIAL_PIPELINE_RUN_EXECUTION_LINK_IMMUTABLE',
        );
      }
    }
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

  async findByExecutionId(
    executionId: string,
  ): Promise<CommercialPipelineRunRecord | null> {
    const record = await this.prisma.commercialPipelineRun.findUnique({
      where: { executionId } as never,
    });
    return record ? mapCommercialPipelineRun({ ...record }) : null;
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

  async findExecutionById(id: string) {
    if (!this.prisma.commercialAutomationExecution) return null;
    const record = await this.prisma.commercialAutomationExecution.findUnique({
      where: { id },
      select: { id: true, commercialRunId: true },
    });
    return record;
  }

  async finalizeByDispatchId(dispatchId: string, completedAt: Date) {
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
      (current.finalStatus === 'FAILED' && !current.investigationRequired) ||
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

        const currentRun = await transaction.commercialPipelineRun.findUnique({
          where: { id: input.runId },
          select: { executionId: true, instanceName: true },
        });
        const requestedInstanceName = input.instanceName ?? null;
        if (
          !currentRun ||
          (currentRun.executionId !== null &&
            (!currentRun.instanceName ||
              currentRun.instanceName !== requestedInstanceName)) ||
          (currentRun.executionId === null &&
            currentRun.instanceName !== requestedInstanceName)
        ) {
          throw new AppError(
            'Identidade da instancia do lifecycle comercial e inconsistente',
            'COMMERCIAL_INSTANCE_LIFECYCLE_MISMATCH',
          );
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
          data: {
            ...input.dispatch,
            instanceName: requestedInstanceName,
            status: 'PENDING',
            attemptCount: 0,
          },
        });
        const outbox = await transaction.commercialDispatchOutbox.create({
          data: {
            id: input.outboxId,
            commercialRunId: input.runId,
            dispatchId: input.dispatch.id,
            jobId: input.jobId,
            instanceName: requestedInstanceName,
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

  async findByDispatchId(
    dispatchId: string,
  ): Promise<CommercialDispatchOutboxRecord | null> {
    const record = await this.prisma.commercialDispatchOutbox.findUnique({
      where: { dispatchId },
    });
    return record ? { ...record } : null;
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
            instanceName: true,
            status: true,
            dispatchId: true,
            jobId: true,
            executionId: true,
            finalStatus: true,
            investigationRequired: true,
          },
        },
        dispatch: {
          select: {
            id: true,
            status: true,
            attemptCount: true,
            instanceName: true,
            externalMessageId: true,
            sentAt: true,
          },
        },
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

const manualPublicationTargetInclude = {
  destination: {
    select: {
      id: true,
      name: true,
      type: true,
      fingerprint: true,
      active: true,
      available: true,
    },
  },
  campaign: {
    select: {
      id: true,
      name: true,
      active: true,
      niche: { select: { id: true, active: true } },
      dailyLimit: true,
      cadenceMinutes: true,
      timezone: true,
      allowedStartTime: true,
      allowedEndTime: true,
      failureCount: true,
      nextEligibleAt: true,
    },
  },
  candidate: {
    select: { id: true, generatedCopyId: true, status: true },
  },
  run: {
    select: {
      id: true,
      status: true,
      finalStatus: true,
      investigationRequired: true,
    },
  },
  dispatch: {
    select: { id: true, status: true, sentAt: true },
  },
  outbox: {
    select: { id: true, status: true },
  },
} as const;

const manualPublicationRequestInclude = {
  targets: {
    orderBy: [{ logicalGroupFingerprint: 'asc' }, { destinationId: 'asc' }],
    include: manualPublicationTargetInclude,
  },
} as const;

const manualPublicationLifecycleTargetSelect = {
  id: true,
  requestId: true,
  destinationId: true,
  campaignId: true,
  logicalGroupFingerprint: true,
  assignedInstanceName: true,
  candidateId: true,
  runId: true,
  dispatchId: true,
  outboxId: true,
  status: true,
  blockedReason: true,
  investigationRequired: true,
  createdAt: true,
  updatedAt: true,
} as const;

const manualPublicationLifecycleRequestSelect = {
  id: true,
  idempotencyKey: true,
  payloadHash: true,
  mode: true,
  productId: true,
  requestedSnapshotId: true,
  requestedSnapshotRevision: true,
  requestedSnapshotFingerprint: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  processingOwnerId: true,
  processingLeaseExpiresAt: true,
  targets: {
    orderBy: { id: 'asc' },
    select: manualPublicationLifecycleTargetSelect,
  },
} as const;

const mapManualPublicationTarget = (
  record: Record<string, unknown>,
): ManualPublicationTargetRecord => {
  const destination = record.destination as Record<string, unknown> | null;
  const campaign = record.campaign as Record<string, unknown> | null;
  const niche = campaign?.niche as Record<string, unknown> | null;
  return {
    id: String(record.id),
    requestId: String(record.requestId),
    destinationId: String(record.destinationId),
    campaignId: String(record.campaignId),
    logicalGroupFingerprint: String(record.logicalGroupFingerprint),
    assignedInstanceName: String(record.assignedInstanceName),
    candidateId: (record.candidateId as string | null) ?? null,
    runId: (record.runId as string | null) ?? null,
    dispatchId: (record.dispatchId as string | null) ?? null,
    outboxId: (record.outboxId as string | null) ?? null,
    status: record.status as ManualPublicationTargetRecord['status'],
    blockedReason: (record.blockedReason as string | null) ?? null,
    investigationRequired: Boolean(record.investigationRequired),
    createdAt: record.createdAt as Date,
    updatedAt: record.updatedAt as Date,
    destination: destination
      ? {
          id: String(destination.id),
          name: String(destination.name),
          type: destination.type as 'GROUP' | 'INDIVIDUAL',
          fingerprint: (destination.fingerprint as string | null) ?? null,
          active: Boolean(destination.active),
          available: Boolean(destination.available),
        }
      : undefined,
    campaign: campaign
      ? {
          id: String(campaign.id),
          name: String(campaign.name),
          active: Boolean(campaign.active),
          nicheId: String(niche?.id),
          nicheActive: Boolean(niche?.active),
          dailyLimit: Number(campaign.dailyLimit),
          cadenceMinutes: Number(campaign.cadenceMinutes),
          timezone: String(campaign.timezone),
          allowedStartTime: String(campaign.allowedStartTime),
          allowedEndTime: String(campaign.allowedEndTime),
          failureCount: Number(campaign.failureCount),
          nextEligibleAt: (campaign.nextEligibleAt as Date | null) ?? null,
        }
      : undefined,
    candidate: record.candidate
      ? (record.candidate as ManualPublicationTargetRecord['candidate'])
      : null,
    run: record.run
      ? (record.run as ManualPublicationTargetRecord['run'])
      : null,
    dispatch: record.dispatch
      ? (record.dispatch as ManualPublicationTargetRecord['dispatch'])
      : null,
    outbox: record.outbox
      ? (record.outbox as ManualPublicationTargetRecord['outbox'])
      : null,
  };
};

const mapManualPublicationRequest = (
  record: Record<string, unknown>,
): ManualPublicationRequestRecord => ({
  id: String(record.id),
  idempotencyKey: String(record.idempotencyKey),
  payloadHash: String(record.payloadHash),
  mode: record.mode as ManualPublicationRequestMode,
  productId: String(record.productId),
  requestedSnapshotId: String(record.requestedSnapshotId),
  requestedSnapshotRevision: Number(record.requestedSnapshotRevision),
  requestedSnapshotFingerprint: String(record.requestedSnapshotFingerprint),
  status: record.status as ManualPublicationRequestRecord['status'],
  createdAt: record.createdAt as Date,
  updatedAt: record.updatedAt as Date,
  completedAt: (record.completedAt as Date | null) ?? null,
  processingOwnerId: (record.processingOwnerId as string | null) ?? null,
  processingLeaseExpiresAt:
    (record.processingLeaseExpiresAt as Date | null) ?? null,
  targets: Array.isArray(record.targets)
    ? record.targets.map((target) => mapManualPublicationTarget({ ...target }))
    : [],
});

const manualPublicationRequestMatches = (
  record: Record<string, unknown>,
  input: ManualPublicationRequestCreateData,
) =>
  record.mode === input.mode &&
  record.productId === input.productId &&
  (record.payloadHash === input.payloadHash ||
    (input.mode === 'SEND' &&
      Boolean(input.legacyPayloadHash) &&
      record.payloadHash === input.legacyPayloadHash));

const MANUAL_PUBLICATION_HTTP_URL = /^https?:\/\//iu;

const loadManualPublicationRequest = (
  client: Pick<DatabaseClient, 'manualPublicationRequest'>,
  where: { id: string } | { idempotencyKey: string },
) =>
  client.manualPublicationRequest.findUnique({
    where,
    include: manualPublicationRequestInclude,
  } as never);

const loadManualPublicationLifecycleRequest = (
  client: Pick<DatabaseClient, 'manualPublicationRequest'>,
  id: string,
) =>
  client.manualPublicationRequest.findUnique({
    where: { id },
    select: manualPublicationLifecycleRequestSelect,
  } as never);

const manualPublicationRecoverySchedulerJobId = (
  requestId: string,
  targetId: string,
) => `manual-publication:${requestId}:${targetId}`;

type ManualPublicationRecoveryClient = Pick<
  DatabaseClient,
  | 'manualPublicationRequest'
  | 'manualPublicationTarget'
  | 'commercialAutomationExecution'
  | 'commercialGroupCampaign'
  | 'commercialPromotionCandidate'
  | 'commercialPipelineRun'
  | 'whatsAppDispatch'
  | 'commercialDispatchOutbox'
  | 'commercialCopyGenerationAttempt'
  | 'generatedCopy'
>;

type ManualPublicationRecoveryCampaign = {
  id: string;
  attemptExecutionId: string | null;
  attemptReservedAt: Date | null;
  attemptLeaseExpiresAt: Date | null;
};

type ManualPublicationRecoveryCandidate = {
  id: string;
  campaignId: string;
  productId: string;
  snapshotId: string;
  generatedCopyId: string | null;
  status: string;
};

type ManualPublicationRecoveryReservation = {
  id: string;
  attemptExecutionId: string | null;
  attemptReservedAt: Date | null;
  attemptLeaseExpiresAt: Date | null;
};

type ManualPublicationRecoveryState = {
  request: ManualPublicationRequestRecord;
  target: ManualPublicationTargetRecord;
  execution: CommercialAutomationExecutionRecord;
  campaign: ManualPublicationRecoveryCampaign;
  candidate: ManualPublicationRecoveryCandidate | null;
  campaignReservations: ManualPublicationRecoveryReservation[];
  linkedRun: { id: string } | null;
  linkedDispatch: { id: string } | null;
  linkedOutbox: { id: string } | null;
  copyAttempt: { id: string } | null;
  generatedCopy: { id: string } | null;
};

const readManualPublicationRecoveryState = async (
  client: ManualPublicationRecoveryClient,
  input: ManualPublicationSafePreProviderReconciliationInput,
): Promise<ManualPublicationRecoveryState | null> => {
  const requestRaw = await loadManualPublicationRequest(client, {
    id: input.requestId,
  });
  if (!requestRaw) return null;
  const request = mapManualPublicationRequest({ ...requestRaw });
  const target = request.targets.find(({ id }) => id === input.targetId);
  if (!target) return null;

  const executionRaw = await client.commercialAutomationExecution.findUnique({
    where: { id: input.executionId },
  });
  if (!executionRaw) return null;
  const execution = mapCommercialAutomationExecution(executionRaw);
  const campaignRaw = await client.commercialGroupCampaign.findUnique({
    where: { id: target.campaignId },
    select: {
      id: true,
      attemptExecutionId: true,
      attemptReservedAt: true,
      attemptLeaseExpiresAt: true,
    },
  });
  if (!campaignRaw) return null;

  const candidate = target.candidateId
    ? await client.commercialPromotionCandidate.findUnique({
        where: { id: target.candidateId },
        select: {
          id: true,
          campaignId: true,
          productId: true,
          snapshotId: true,
          generatedCopyId: true,
          status: true,
        },
      })
    : await client.commercialPromotionCandidate.findUnique({
        where: {
          campaignId_productId: {
            campaignId: target.campaignId,
            productId: request.productId,
          },
        },
        select: {
          id: true,
          campaignId: true,
          productId: true,
          snapshotId: true,
          generatedCopyId: true,
          status: true,
        },
      });

  const [
    campaignReservations,
    linkedRun,
    linkedDispatch,
    linkedOutbox,
    copyAttempt,
    generatedCopy,
  ] = await Promise.all([
    client.commercialGroupCampaign.findMany({
      where: { attemptExecutionId: input.executionId },
      take: 2,
      select: {
        id: true,
        attemptExecutionId: true,
        attemptReservedAt: true,
        attemptLeaseExpiresAt: true,
      },
    }),
    client.commercialPipelineRun.findUnique({
      where: { executionId: input.executionId },
      select: { id: true },
    }),
    client.whatsAppDispatch.findFirst({
      where: {
        productId: request.productId,
        destinationId: target.destinationId,
        createdAt: { gte: execution.startedAt },
      },
      select: { id: true },
    }),
    client.commercialDispatchOutbox.findFirst({
      where: { commercialRun: { executionId: input.executionId } },
      select: { id: true },
    } as never),
    candidate
      ? client.commercialCopyGenerationAttempt.findFirst({
          where: { candidateId: candidate.id },
          select: { id: true },
        })
      : Promise.resolve(null),
    candidate
      ? client.generatedCopy.findFirst({
          where: { createdFromCandidateId: candidate.id },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  return {
    request,
    target,
    execution,
    campaign: campaignRaw,
    candidate,
    campaignReservations,
    linkedRun,
    linkedDispatch,
    linkedOutbox,
    copyAttempt,
    generatedCopy,
  };
};

const safePreProviderReplayMatches = (
  state: ManualPublicationRecoveryState,
  input: ManualPublicationSafePreProviderReconciliationInput,
) => {
  const { request, target, execution, campaign, candidate } = state;
  if (
    request.mode !== 'SEND' ||
    target.requestId !== input.requestId ||
    target.status !== 'BLOCKED' ||
    target.investigationRequired ||
    target.runId !== null ||
    target.dispatchId !== null ||
    target.outboxId !== null ||
    execution.id !== input.executionId ||
    execution.mode !== 'SEND' ||
    execution.status !== 'BLOCKED' ||
    execution.schedulerJobId !==
      manualPublicationRecoverySchedulerJobId(
        input.requestId,
        input.targetId,
      ) ||
    execution.externalStage !== 'EXTERNAL_MAY_HAVE_STARTED' ||
    execution.commercialRunId !== null ||
    !execution.failureCode ||
    target.blockedReason !== execution.failureCode ||
    campaign.attemptExecutionId !== null ||
    campaign.attemptReservedAt !== null ||
    campaign.attemptLeaseExpiresAt !== null ||
    state.campaignReservations.length !== 0 ||
    !candidate ||
    candidate.id !== (target.candidateId ?? candidate.id) ||
    candidate.campaignId !== target.campaignId ||
    candidate.productId !== request.productId ||
    candidate.snapshotId !== request.requestedSnapshotId ||
    candidate.status !== 'QUEUED' ||
    candidate.generatedCopyId !== null ||
    state.linkedRun ||
    state.linkedDispatch ||
    state.linkedOutbox ||
    state.copyAttempt ||
    state.generatedCopy ||
    request.processingOwnerId !== null ||
    request.processingLeaseExpiresAt !== null ||
    isManualPublicationRequestTerminal(request.status) !==
      Boolean(request.completedAt)
  ) {
    return false;
  }
  return (
    request.status ===
    aggregateManualPublicationRequestStatus(
      request.targets.map((item) => item.status),
    )
  );
};

class ManualPublicationRecoveryCasConflictError extends Error {}

export class PrismaManualPublicationRequestRepository implements ManualPublicationRequestRepository {
  constructor(private readonly prisma: DatabaseClient) {}

  private async assertCurrentState(
    transaction: Pick<
      DatabaseClient,
      | 'productLead'
      | 'commercialOfferSnapshot'
      | 'whatsAppDestination'
      | 'commercialGroupCampaign'
      | 'whatsAppInstance'
    >,
    input: ManualPublicationRequestCreateData,
  ) {
    const [product, snapshot, destinations, campaigns, instances] =
      await Promise.all([
        transaction.productLead.findUnique({
          where: { id: input.productId },
          select: {
            id: true,
            source: true,
            affiliateLink: true,
            productLink: true,
            unavailableAt: true,
            offerStartsAt: true,
            offerEndsAt: true,
            commercialSnapshotRevision: true,
            commercialSnapshotFingerprint: true,
          },
        }),
        transaction.commercialOfferSnapshot.findUnique({
          where: { id: input.requestedSnapshotId },
          select: {
            id: true,
            productId: true,
            revision: true,
            fingerprint: true,
            offerStartsAt: true,
            offerEndsAt: true,
            unavailableAt: true,
          },
        }),
        transaction.whatsAppDestination.findMany({
          where: {
            id: { in: input.targets.map((target) => target.destinationId) },
          },
          select: {
            id: true,
            type: true,
            active: true,
            paused: true,
            available: true,
            fingerprint: true,
            assignedInstanceName: true,
          },
        }),
        transaction.commercialGroupCampaign.findMany({
          where: {
            id: { in: input.targets.map((target) => target.campaignId) },
          },
          select: {
            id: true,
            logicalGroupFingerprint: true,
            active: true,
            niche: { select: { active: true } },
          },
        }),
        transaction.whatsAppInstance.findMany({
          where: {
            name: {
              in: input.targets.map((target) => target.assignedInstanceName),
            },
          },
          select: { name: true, active: true },
        }),
      ]);
    const destinationById = new Map(destinations.map((row) => [row.id, row]));
    const campaignById = new Map(campaigns.map((row) => [row.id, row]));
    const instanceByName = new Map(instances.map((row) => [row.name, row]));
    const now = new Date();
    const validProduct =
      product?.source === 'OFFICIAL' &&
      !product.unavailableAt &&
      (!product.offerEndsAt || product.offerEndsAt > now) &&
      Boolean(product.affiliateLink) &&
      Boolean(product.productLink) &&
      (input.mode !== 'PREVIEW' ||
        (MANUAL_PUBLICATION_HTTP_URL.test(product.affiliateLink ?? '') &&
          MANUAL_PUBLICATION_HTTP_URL.test(product.productLink ?? ''))) &&
      (input.mode !== 'PREVIEW' ||
        !product.offerStartsAt ||
        product.offerStartsAt <= now) &&
      product.commercialSnapshotRevision === input.requestedSnapshotRevision &&
      product.commercialSnapshotFingerprint ===
        input.requestedSnapshotFingerprint;
    const validSnapshot =
      snapshot?.id === input.requestedSnapshotId &&
      snapshot.productId === input.productId &&
      snapshot.revision === input.requestedSnapshotRevision &&
      snapshot.fingerprint === input.requestedSnapshotFingerprint &&
      (input.mode !== 'PREVIEW' ||
        (!snapshot.unavailableAt &&
          (!snapshot.offerStartsAt || snapshot.offerStartsAt <= now) &&
          (!snapshot.offerEndsAt || snapshot.offerEndsAt > now)));
    const validTargets = input.targets.every((target) => {
      const destination = destinationById.get(target.destinationId);
      const campaign = campaignById.get(target.campaignId);
      const instance = instanceByName.get(target.assignedInstanceName);
      return Boolean(
        destination &&
        destination.type === 'GROUP' &&
        (input.mode !== 'PREVIEW' ||
          (destination.active && destination.available)) &&
        destination.fingerprint === target.logicalGroupFingerprint &&
        destination.assignedInstanceName === target.assignedInstanceName &&
        campaign &&
        campaign.logicalGroupFingerprint === target.logicalGroupFingerprint &&
        (input.mode !== 'PREVIEW' ||
          (campaign.active && campaign.niche.active)) &&
        instance &&
        (input.mode !== 'PREVIEW' || instance.active),
      );
    });
    if (!validProduct || !validSnapshot || !validTargets) {
      throw new AppError(
        'Produto, snapshot ou destino mudou antes da aceitacao manual',
        'MANUAL_PUBLICATION_STATE_CHANGED',
      );
    }
  }

  async accept(
    input: ManualPublicationRequestCreateData,
  ): Promise<ManualPublicationAcceptance> {
    try {
      const record = await this.prisma.$transaction(
        async (transaction) => {
          const existing = await loadManualPublicationRequest(transaction, {
            idempotencyKey: input.idempotencyKey,
          });
          if (existing) {
            if (!manualPublicationRequestMatches(existing, input)) {
              throw new AppError(
                'A chave de idempotencia ja representa outra operacao ou payload',
                'MANUAL_PUBLICATION_IDEMPOTENCY_CONFLICT',
              );
            }
            return {
              created: false,
              request: mapManualPublicationRequest({ ...existing }),
            };
          }
          await this.assertCurrentState(transaction, input);
          const request = await transaction.manualPublicationRequest.create({
            data: {
              id: input.id,
              idempotencyKey: input.idempotencyKey,
              payloadHash: input.payloadHash,
              mode: input.mode,
              productId: input.productId,
              requestedSnapshotId: input.requestedSnapshotId,
              requestedSnapshotRevision: input.requestedSnapshotRevision,
              requestedSnapshotFingerprint: input.requestedSnapshotFingerprint,
              status: input.status ?? 'ACCEPTED',
              createdAt: input.createdAt,
            },
          });
          await transaction.manualPublicationTarget.createMany({
            data: input.targets.map((target) => ({
              id: target.id,
              requestId: request.id,
              destinationId: target.destinationId,
              campaignId: target.campaignId,
              logicalGroupFingerprint: target.logicalGroupFingerprint,
              assignedInstanceName: target.assignedInstanceName,
              status: target.status ?? 'ACCEPTED',
            })),
          });
          const accepted = await loadManualPublicationRequest(transaction, {
            id: request.id,
          });
          if (!accepted) throw new Error('manual request disappeared');
          return {
            created: true,
            request: mapManualPublicationRequest({ ...accepted }),
          };
        },
        { isolationLevel: 'Serializable', maxWait: 1_000, timeout: 10_000 },
      );
      return record;
    } catch (error) {
      if (isUniqueConstraintError(error) || isTransactionConflictError(error)) {
        const existing = await this.findByIdempotencyKey(input.idempotencyKey);
        if (!existing) throw error;
        if (!manualPublicationRequestMatches(existing, input)) {
          throw new AppError(
            'A chave de idempotencia ja representa outra operacao ou payload',
            'MANUAL_PUBLICATION_IDEMPOTENCY_CONFLICT',
          );
        }
        return { request: existing, created: false };
      }
      throw error;
    }
  }

  async findById(id: string) {
    const record = await loadManualPublicationRequest(this.prisma, { id });
    return record ? mapManualPublicationRequest({ ...record }) : null;
  }

  async findByIdempotencyKey(idempotencyKey: string) {
    const record = await loadManualPublicationRequest(this.prisma, {
      idempotencyKey,
    });
    return record ? mapManualPublicationRequest({ ...record }) : null;
  }

  async claimProcessing(
    id: string,
    ownerId: string,
    now: Date,
    leaseExpiresAt: Date,
  ) {
    const claimed = await this.prisma.manualPublicationRequest.updateMany({
      where: {
        id,
        OR: [
          { status: 'ACCEPTED' },
          {
            status: 'PROCESSING',
            OR: [
              { processingLeaseExpiresAt: null },
              { processingLeaseExpiresAt: { lte: now } },
            ],
          },
        ],
      },
      data: {
        status: 'PROCESSING',
        processingOwnerId: ownerId,
        processingLeaseExpiresAt: leaseExpiresAt,
        completedAt: null,
      },
    } as never);
    if (claimed.count !== 1) return null;
    return this.findById(id);
  }

  async renewProcessing(id: string, ownerId: string, leaseExpiresAt: Date) {
    const renewed = await this.prisma.manualPublicationRequest.updateMany({
      where: {
        id,
        status: 'PROCESSING',
        processingOwnerId: ownerId,
      },
      data: { processingLeaseExpiresAt: leaseExpiresAt },
    } as never);
    return renewed.count === 1;
  }

  async reserveSendSlot(
    input: ManualPublicationQuotaReservationInput,
  ): Promise<ManualPublicationQuotaReservation> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id"
        FROM "CommercialAutomationSettings"
        WHERE "id" = 'commercial-automation'
        FOR UPDATE
      `;
      const target = await transaction.manualPublicationTarget.findUnique({
        where: { id: input.targetId },
        select: { id: true, destinationId: true, status: true },
      });
      if (!target || !['ACCEPTED', 'PROCESSING'].includes(target.status)) {
        return {
          kind: 'BLOCKED' as const,
          reason: 'MANUAL_PUBLICATION_TARGET_CONFLICT',
        };
      }
      const sentWhere = {
        status: 'SENT' as const,
        sentAt: { gte: input.dayStartsAt, lt: input.dayEndsAt },
        destination: { type: 'GROUP' as const },
      };
      const activeWhere = {
        id: { not: input.targetId },
        status: { in: ['PROCESSING', 'QUEUED'] as const },
        OR: [
          { dispatchId: null },
          { dispatch: { status: { not: 'SENT' as const } } },
        ],
      };
      const [sentGlobal, sentGroup, activeGlobal, activeGroup] =
        await Promise.all([
          transaction.whatsAppDispatch.count({ where: sentWhere }),
          transaction.whatsAppDispatch.count({
            where: { ...sentWhere, destinationId: target.destinationId },
          }),
          transaction.manualPublicationTarget.count({
            where: activeWhere,
          } as never),
          transaction.manualPublicationTarget.count({
            where: { ...activeWhere, destinationId: target.destinationId },
          } as never),
        ]);
      if (
        input.globalDailyLimit <= 0 ||
        sentGlobal + activeGlobal >= input.globalDailyLimit
      ) {
        return {
          kind: 'BLOCKED' as const,
          reason: 'GLOBAL_DAILY_LIMIT_REACHED',
        };
      }
      if (
        input.groupDailyLimit <= 0 ||
        sentGroup + activeGroup >= input.groupDailyLimit
      ) {
        return {
          kind: 'BLOCKED' as const,
          reason: 'GROUP_DAILY_LIMIT_REACHED',
        };
      }
      const claimed = await transaction.manualPublicationTarget.updateMany({
        where: {
          id: input.targetId,
          status: { in: ['ACCEPTED', 'PROCESSING'] as const },
        },
        data: { status: 'PROCESSING' },
      });
      return claimed.count === 1
        ? { kind: 'RESERVED' as const }
        : {
            kind: 'BLOCKED' as const,
            reason: 'MANUAL_PUBLICATION_TARGET_CONFLICT',
          };
    });
  }

  async releaseSendSlot(targetId: string): Promise<void> {
    await this.prisma.manualPublicationTarget.updateMany({
      where: {
        id: targetId,
        status: 'PROCESSING',
        candidateId: null,
        runId: null,
        dispatchId: null,
        outboxId: null,
      },
      data: { status: 'ACCEPTED' },
    });
  }

  async updateTarget(id: string, data: ManualPublicationTargetUpdate) {
    try {
      const record = await this.prisma.manualPublicationTarget.update({
        where: { id },
        data,
        include: manualPublicationTargetInclude,
      } as never);
      return mapManualPublicationTarget({ ...record });
    } catch (error) {
      if (isRecordNotFoundError(error)) return null;
      throw error;
    }
  }

  async updateRequest(id: string, data: ManualPublicationRequestUpdate) {
    try {
      const record = await this.prisma.manualPublicationRequest.update({
        where: { id },
        data,
        include: manualPublicationRequestInclude,
      } as never);
      return mapManualPublicationRequest({ ...record });
    } catch (error) {
      if (isRecordNotFoundError(error)) return null;
      throw error;
    }
  }

  async finalizeAfterCommercialDispatch(
    input: ManualPublicationLifecycleFinalizationInput,
  ): Promise<ManualPublicationLifecycleFinalizationResult> {
    return this.prisma.$transaction(
      async (transaction) => {
        const run = await transaction.commercialPipelineRun.findUnique({
          where: { dispatchId: input.dispatchId },
          select: {
            id: true,
            dispatchId: true,
            status: true,
            finalStatus: true,
            investigationRequired: true,
          },
        });
        if (!run) {
          return {
            outcome: 'NO_MANUAL_LIFECYCLE' as const,
            writes: 0 as const,
          };
        }

        const dispatch = await transaction.whatsAppDispatch.findUnique({
          where: { id: input.dispatchId },
          select: {
            id: true,
            status: true,
            attemptCount: true,
            externalMessageId: true,
            sentAt: true,
          },
        });
        if (!dispatch) {
          throw new AppError(
            'Dispatch comercial ausente durante a finalizacao manual',
            'MANUAL_PUBLICATION_LIFECYCLE_CONTEXT_MISSING',
          );
        }
        if (run.dispatchId !== dispatch.id) {
          throw new AppError(
            'Run comercial nao corresponde ao dispatch manual',
            'MANUAL_PUBLICATION_LIFECYCLE_CONTEXT_MISMATCH',
          );
        }

        const outbox = await transaction.commercialDispatchOutbox.findUnique({
          where: { dispatchId: dispatch.id },
          select: {
            id: true,
            commercialRunId: true,
            dispatchId: true,
            status: true,
          },
        });
        if (
          outbox &&
          (outbox.commercialRunId !== run.id ||
            outbox.dispatchId !== dispatch.id)
        ) {
          throw new AppError(
            'Outbox comercial nao corresponde ao run/dispatch manual',
            'MANUAL_PUBLICATION_LIFECYCLE_CONTEXT_MISMATCH',
          );
        }

        const relationFilters = [
          { runId: run.id },
          { dispatchId: dispatch.id },
          ...(outbox ? [{ outboxId: outbox.id }] : []),
        ];
        const linkedTargets =
          await transaction.manualPublicationTarget.findMany({
            where: { OR: relationFilters },
            take: 2,
            orderBy: { id: 'asc' },
            select: manualPublicationLifecycleTargetSelect,
          } as never);
        if (linkedTargets.length === 0) {
          return {
            outcome: 'NO_MANUAL_LIFECYCLE' as const,
            writes: 0 as const,
          };
        }
        if (linkedTargets.length !== 1) {
          throw new AppError(
            'Mais de um target manual corresponde ao mesmo dispatch comercial',
            'MANUAL_PUBLICATION_LIFECYCLE_TARGET_AMBIGUOUS',
          );
        }

        const linkedTarget = linkedTargets[0];
        if (!linkedTarget) {
          throw new AppError(
            'Target manual desapareceu durante a finalizacao',
            'MANUAL_PUBLICATION_LIFECYCLE_CONTEXT_MISSING',
          );
        }
        if (
          (linkedTarget.runId !== null && linkedTarget.runId !== run.id) ||
          (linkedTarget.dispatchId !== null &&
            linkedTarget.dispatchId !== dispatch.id) ||
          (linkedTarget.outboxId !== null &&
            (!outbox || linkedTarget.outboxId !== outbox.id))
        ) {
          throw new AppError(
            'Target manual possui vinculos comerciais divergentes',
            'MANUAL_PUBLICATION_LIFECYCLE_CONTEXT_MISMATCH',
          );
        }

        const requestRaw = await loadManualPublicationLifecycleRequest(
          transaction,
          linkedTarget.requestId,
        );
        if (!requestRaw) {
          throw new AppError(
            'Request manual ausente durante a finalizacao',
            'MANUAL_PUBLICATION_LIFECYCLE_CONTEXT_MISSING',
          );
        }
        const request = mapManualPublicationRequest({ ...requestRaw });
        if (request.mode !== 'SEND') {
          throw new AppError(
            'Target de preview nao pode ser finalizado pelo worker comercial',
            'MANUAL_PUBLICATION_LIFECYCLE_MODE_MISMATCH',
          );
        }
        const target = request.targets.find(
          (item) => item.id === linkedTarget.id,
        );
        if (!target || target.requestId !== request.id) {
          throw new AppError(
            'Target manual nao pertence a request carregada',
            'MANUAL_PUBLICATION_LIFECYCLE_CONTEXT_MISMATCH',
          );
        }

        const observation: ManualPublicationLifecycleObservation = {
          hasRun: true,
          runStatus: run.status,
          runFinalStatus: run.finalStatus,
          runInvestigationRequired: run.investigationRequired,
          hasDispatch: true,
          dispatchStatus: dispatch.status,
          hasOutbox: Boolean(outbox),
          outboxStatus: outbox?.status ?? null,
        };
        const terminalStatus =
          resolveManualPublicationTerminalStatus(observation);
        if (!terminalStatus) {
          return { outcome: 'NOT_TERMINAL' as const, writes: 0 as const };
        }

        const nextTargetStatus =
          target.status === 'AMBIGUOUS' ? 'AMBIGUOUS' : terminalStatus;
        const nextTargetInvestigationRequired =
          nextTargetStatus === 'AMBIGUOUS';
        const nextTargets = request.targets.map((item) =>
          item.id === target.id
            ? {
                ...item,
                status: nextTargetStatus,
                investigationRequired: nextTargetInvestigationRequired,
              }
            : item,
        );
        const nextRequestStatus = aggregateManualPublicationRequestStatus(
          nextTargets.map((item) => item.status),
        );
        const requestTerminal =
          isManualPublicationRequestTerminal(nextRequestStatus);
        const nextCompletedAt = requestTerminal
          ? (request.completedAt ?? input.now)
          : null;
        const targetNeedsUpdate =
          target.status !== nextTargetStatus ||
          target.investigationRequired !== nextTargetInvestigationRequired;
        const requestNeedsUpdate =
          request.status !== nextRequestStatus ||
          request.completedAt?.getTime() !== nextCompletedAt?.getTime() ||
          (requestTerminal &&
            (request.processingOwnerId !== null ||
              request.processingLeaseExpiresAt !== null));

        let writes = 0;
        if (targetNeedsUpdate) {
          const updatedTarget =
            await transaction.manualPublicationTarget.updateMany({
              where: {
                id: target.id,
                requestId: target.requestId,
                candidateId: target.candidateId,
                runId: target.runId,
                dispatchId: target.dispatchId,
                outboxId: target.outboxId,
                status: target.status,
                investigationRequired: target.investigationRequired,
              },
              data: {
                status: nextTargetStatus,
                investigationRequired: nextTargetInvestigationRequired,
              },
            } as never);
          if (updatedTarget.count !== 1) {
            throw new AppError(
              'Target manual mudou durante a finalizacao',
              'MANUAL_PUBLICATION_LIFECYCLE_CAS_CONFLICT',
            );
          }
          writes += 1;
        }

        if (requestNeedsUpdate) {
          const updatedRequest =
            await transaction.manualPublicationRequest.updateMany({
              where: {
                id: request.id,
                status: request.status,
                completedAt: request.completedAt,
                processingOwnerId: request.processingOwnerId,
                processingLeaseExpiresAt: request.processingLeaseExpiresAt,
              },
              data: {
                status: nextRequestStatus,
                completedAt: nextCompletedAt,
                ...(requestTerminal
                  ? {
                      processingOwnerId: null,
                      processingLeaseExpiresAt: null,
                    }
                  : {}),
              },
            } as never);
          if (updatedRequest.count !== 1) {
            throw new AppError(
              'Request manual mudou durante a finalizacao',
              'MANUAL_PUBLICATION_LIFECYCLE_CAS_CONFLICT',
            );
          }
          writes += 1;
        }

        return {
          outcome:
            writes === 0
              ? ('ALREADY_FINALIZED' as const)
              : ('FINALIZED' as const),
          requestId: request.id,
          targetId: target.id,
          targetStatus: nextTargetStatus,
          requestStatus: nextRequestStatus,
          writes,
        };
      },
      { isolationLevel: 'Serializable', maxWait: 1_000, timeout: 10_000 },
    );
  }

  async reconcileSafePreProviderAmbiguity(
    input: ManualPublicationSafePreProviderReconciliationInput,
  ): Promise<ManualPublicationSafePreProviderReconciliationResult> {
    const reconcile = async (client: ManualPublicationRecoveryClient) => {
      const state = await readManualPublicationRecoveryState(client, input);
      if (!state) {
        throw new AppError(
          'Lifecycle de publicacao manual nao encontrado',
          'RECOVERY_NOT_SAFE',
        );
      }

      if (safePreProviderReplayMatches(state, input)) {
        return {
          outcome: 'ALREADY_RECONCILED' as const,
          request: state.request,
          writes: 0 as const,
        };
      }

      const { request, target, execution, campaign, candidate } = state;
      if (
        request.mode !== 'SEND' ||
        request.status !== 'AMBIGUOUS' ||
        target.requestId !== input.requestId ||
        target.status !== 'AMBIGUOUS' ||
        !target.investigationRequired ||
        target.runId !== null ||
        target.dispatchId !== null ||
        target.outboxId !== null ||
        execution.id !== input.executionId ||
        execution.mode !== 'SEND' ||
        execution.status !== 'AMBIGUOUS' ||
        execution.schedulerJobId !==
          manualPublicationRecoverySchedulerJobId(
            input.requestId,
            input.targetId,
          ) ||
        execution.externalStage !== 'EXTERNAL_MAY_HAVE_STARTED' ||
        execution.commercialRunId !== null ||
        execution.activeKey !== null ||
        !execution.failureCode ||
        target.blockedReason !== execution.failureCode ||
        request.processingOwnerId !== null ||
        request.processingLeaseExpiresAt !== null
      ) {
        throw new AppError(
          'Lifecycle ambiguo nao corresponde ao recovery seguro pre-provider',
          'RECOVERY_NOT_SAFE',
        );
      }

      if (
        state.linkedRun ||
        state.linkedDispatch ||
        state.linkedOutbox ||
        state.copyAttempt ||
        state.generatedCopy
      ) {
        throw new AppError(
          'Evidencia downstream impede o recovery pre-provider',
          'RECOVERY_NOT_SAFE',
        );
      }

      if (
        !candidate ||
        candidate.id !== (target.candidateId ?? candidate.id) ||
        candidate.campaignId !== target.campaignId ||
        candidate.productId !== request.productId ||
        candidate.snapshotId !== request.requestedSnapshotId ||
        candidate.status !== 'QUEUED' ||
        candidate.generatedCopyId !== null
      ) {
        throw new AppError(
          'Candidate nao esta intacto para o recovery pre-provider',
          'RECOVERY_NOT_SAFE',
        );
      }

      if (campaign.attemptExecutionId !== input.executionId) {
        if (campaign.attemptExecutionId) {
          throw new AppError(
            'A reservation comercial pertence a outra execution',
            'RECOVERY_RESERVATION_OWNERSHIP_MISMATCH',
          );
        }
        throw new AppError(
          'A reservation comercial nao esta presente',
          'RECOVERY_NOT_SAFE',
        );
      }
      if (
        state.campaignReservations.length !== 1 ||
        state.campaignReservations[0]?.id !== campaign.id ||
        !campaign.attemptReservedAt ||
        !campaign.attemptLeaseExpiresAt ||
        state.campaignReservations[0]?.attemptReservedAt?.getTime() !==
          campaign.attemptReservedAt.getTime() ||
        state.campaignReservations[0]?.attemptLeaseExpiresAt?.getTime() !==
          campaign.attemptLeaseExpiresAt.getTime() ||
        campaign.attemptReservedAt.getTime() >
          campaign.attemptLeaseExpiresAt.getTime()
      ) {
        throw new AppError(
          'A reservation comercial nao e unica ou valida',
          'RECOVERY_NOT_SAFE',
        );
      }
      if (campaign.attemptLeaseExpiresAt.getTime() > input.now.getTime()) {
        throw new AppError(
          'A lease da reservation comercial ainda esta ativa',
          'RECOVERY_NOT_SAFE',
        );
      }

      const nextRequestStatus = aggregateManualPublicationRequestStatus(
        request.targets.map((item) =>
          item.id === target.id ? ('BLOCKED' as const) : item.status,
        ),
      );
      const nextCompletedAt = isManualPublicationRequestTerminal(
        nextRequestStatus,
      )
        ? (request.completedAt ?? input.now)
        : null;

      const campaignUpdated = await client.commercialGroupCampaign.updateMany({
        where: {
          id: campaign.id,
          attemptExecutionId: input.executionId,
          attemptReservedAt: campaign.attemptReservedAt,
          attemptLeaseExpiresAt: campaign.attemptLeaseExpiresAt,
        },
        data: {
          attemptExecutionId: null,
          attemptReservedAt: null,
          attemptLeaseExpiresAt: null,
        },
      });
      if (campaignUpdated.count !== 1) {
        throw new ManualPublicationRecoveryCasConflictError();
      }

      const executionUpdated =
        await client.commercialAutomationExecution.updateMany({
          where: {
            id: execution.id,
            schedulerJobId: execution.schedulerJobId,
            bullMqJobId: execution.bullMqJobId,
            activeKey: execution.activeKey,
            ownerId: execution.ownerId,
            heartbeatAt: execution.heartbeatAt,
            leaseExpiresAt: execution.leaseExpiresAt,
            mode: 'SEND',
            status: 'AMBIGUOUS',
            externalStage: 'EXTERNAL_MAY_HAVE_STARTED',
            commercialRunId: null,
            failureCode: execution.failureCode,
            startedAt: execution.startedAt,
            completedAt: execution.completedAt,
          },
          data: { status: 'BLOCKED' },
        });
      if (executionUpdated.count !== 1) {
        throw new ManualPublicationRecoveryCasConflictError();
      }

      const targetUpdated = await client.manualPublicationTarget.updateMany({
        where: {
          id: target.id,
          requestId: input.requestId,
          candidateId: target.candidateId,
          runId: null,
          dispatchId: null,
          outboxId: null,
          status: 'AMBIGUOUS',
          blockedReason: target.blockedReason,
          investigationRequired: true,
        },
        data: { status: 'BLOCKED', investigationRequired: false },
      });
      if (targetUpdated.count !== 1) {
        throw new ManualPublicationRecoveryCasConflictError();
      }

      const requestUpdated = await client.manualPublicationRequest.updateMany({
        where: {
          id: request.id,
          mode: 'SEND',
          productId: request.productId,
          requestedSnapshotId: request.requestedSnapshotId,
          requestedSnapshotRevision: request.requestedSnapshotRevision,
          requestedSnapshotFingerprint: request.requestedSnapshotFingerprint,
          status: 'AMBIGUOUS',
          completedAt: request.completedAt,
          processingOwnerId: null,
          processingLeaseExpiresAt: null,
        },
        data: {
          status: nextRequestStatus,
          completedAt: nextCompletedAt,
        },
      });
      if (requestUpdated.count !== 1) {
        throw new ManualPublicationRecoveryCasConflictError();
      }

      const recoveredRaw = await loadManualPublicationRequest(client, {
        id: request.id,
      });
      if (!recoveredRaw) throw new ManualPublicationRecoveryCasConflictError();
      return {
        outcome: 'RECONCILED' as const,
        request: mapManualPublicationRequest({ ...recoveredRaw }),
        writes: 4 as const,
      };
    };

    try {
      return await this.prisma.$transaction(reconcile, {
        isolationLevel: 'Serializable',
      });
    } catch (error) {
      if (
        !(error instanceof ManualPublicationRecoveryCasConflictError) &&
        !isTransactionConflictError(error)
      ) {
        throw error;
      }
      try {
        const state = await readManualPublicationRecoveryState(
          this.prisma,
          input,
        );
        if (state && safePreProviderReplayMatches(state, input)) {
          return {
            outcome: 'ALREADY_RECONCILED',
            request: state.request,
            writes: 0,
          };
        }
      } catch {
        // The original CAS/Serializable conflict remains authoritative.
      }
      throw new AppError(
        'O recovery pre-provider perdeu o CAS durante a reconciliacao',
        'RECOVERY_CAS_CONFLICT',
      );
    }
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
        dailyGlobalLimit: null,
        dailyGroupLimit: null,
      },
      update: {},
    });
  }

  async setPaused(
    paused: boolean,
    now: Date,
    expectedUpdatedAt?: Date,
  ): Promise<CommercialAutomationSettingsRecord> {
    const current = await this.getOrCreate(now);
    if (current.paused === paused) return current;
    if (!paused) {
      if (!expectedUpdatedAt) {
        throw new AppError(
          'A configuracao observada e obrigatoria para retomar a automacao',
          'COMMERCIAL_AUTOMATION_RESUME_CAS_REQUIRED',
        );
      }
      const result = await this.prisma.commercialAutomationSettings.updateMany({
        where: {
          id: COMMERCIAL_AUTOMATION_SETTINGS_ID,
          paused: true,
          updatedAt: expectedUpdatedAt,
        },
        data: { paused: false, resumedAt: now },
      });
      if (result.count !== 1) {
        throw new AppError(
          'A configuracao mudou desde que esta tela foi carregada. Atualize e confirme novamente.',
          'COMMERCIAL_AUTOMATION_RESUME_CONFLICT',
        );
      }
      const updated = await this.get();
      if (!updated) {
        throw new AppError(
          'A configuracao da automacao ficou indisponivel apos a retomada',
          'COMMERCIAL_AUTOMATION_SETTINGS_UNAVAILABLE',
        );
      }
      return updated;
    }
    return this.prisma.commercialAutomationSettings.update({
      where: { id: COMMERCIAL_AUTOMATION_SETTINGS_ID },
      data: { paused: true, pausedAt: now },
    });
  }

  async updateSchedule(
    input: CommercialAutomationScheduleUpdate,
    now: Date,
  ): Promise<CommercialAutomationSettingsRecord> {
    const { expectedRevision, ...schedule } = input;
    try {
      return await this.prisma.commercialAutomationSettings.update({
        where:
          expectedRevision === undefined
            ? { id: COMMERCIAL_AUTOMATION_SETTINGS_ID }
            : {
                id: COMMERCIAL_AUTOMATION_SETTINGS_ID,
                scheduleRevision: expectedRevision,
              },
        data: {
          ...schedule,
          scheduleRevision: { increment: 1 },
          updatedAt: now,
        },
      });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        throw new AppError(
          'A configuracao de agenda mudou durante a atualizacao',
          'COMMERCIAL_AUTOMATION_SCHEDULE_REVISION_CONFLICT',
        );
      }
      throw error;
    }
  }
}

export class PrismaCommercialExternalProviderUsageRepository implements CommercialExternalProviderUsageRepository {
  constructor(private readonly prisma: DatabaseClient) {}

  async claim(input: {
    provider: 'SHOPEE' | 'OPENAI';
    dayKey: string;
    limit: number;
    now: Date;
  }): Promise<CommercialExternalProviderUsageRecord | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        provider: 'SHOPEE' | 'OPENAI';
        dayKey: string;
        usedCount: number;
        updatedAt: Date;
      }>
    >(Prisma.sql`
      INSERT INTO "CommercialExternalProviderUsage"
        ("provider", "dayKey", "usedCount", "updatedAt")
      VALUES (${input.provider}, ${input.dayKey}, 1, ${input.now})
      ON CONFLICT ("provider", "dayKey") DO UPDATE
      SET "usedCount" = "CommercialExternalProviderUsage"."usedCount" + 1,
          "updatedAt" = ${input.now}
      WHERE "CommercialExternalProviderUsage"."usedCount" < ${input.limit}
      RETURNING "provider", "dayKey", "usedCount", "updatedAt"
    `);
    return rows[0] ?? null;
  }

  async getUsage(
    provider: 'SHOPEE' | 'OPENAI',
    dayKey: string,
  ): Promise<CommercialExternalProviderUsageRecord | null> {
    const usage = await this.prisma.commercialExternalProviderUsage.findUnique({
      where: { provider_dayKey: { provider, dayKey } },
    });
    return usage ? { ...usage, provider } : null;
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

export class PrismaOperationalStatusRepository implements OperationalStatusRepository {
  constructor(
    private readonly prisma: Pick<
      DatabaseClient,
      | 'commercialAutomationExecution'
      | 'commercialGroupCampaign'
      | 'commercialPipelineRun'
      | 'whatsAppDispatch'
      | 'commercialDispatchOutbox'
      | 'manualPublicationTarget'
    >,
  ) {}

  async getCounts(now: Date): Promise<OperationalStatusCounts> {
    const [
      activeExecutions,
      activeReservations,
      ambiguity,
      investigationRequired,
      pendingDispatches,
      pendingOutboxes,
    ] = await Promise.all([
      this.prisma.commercialAutomationExecution.count({
        where: {
          status: 'STARTED',
          activeKey: { not: null },
          leaseExpiresAt: { gt: now },
        },
      }),
      this.prisma.commercialGroupCampaign.count({
        where: {
          attemptExecutionId: { not: null },
          attemptLeaseExpiresAt: { gt: now },
        },
      }),
      this.prisma.commercialPipelineRun.count({
        where: {
          OR: [{ finalStatus: 'AMBIGUOUS' }, { investigationRequired: true }],
        },
      }),
      this.prisma.commercialPipelineRun.count({
        where: { investigationRequired: true },
      }),
      this.prisma.whatsAppDispatch.count({
        where: { status: { in: ['PENDING', 'PROCESSING'] } },
      }),
      this.prisma.commercialDispatchOutbox.count({
        where: { status: 'PENDING' },
      }),
    ]);

    return {
      activeExecutions,
      activeReservations,
      ambiguity,
      investigationRequired,
      pendingDispatches,
      pendingOutboxes,
    };
  }

  async hasActiveGroupLifecycle(
    destinationId: string,
    now: Date,
  ): Promise<boolean> {
    const [dispatches, runs, outboxes, reservations, manualTargets] =
      await Promise.all([
        this.prisma.whatsAppDispatch.count({
          where: {
            destinationId,
            status: { in: ['PENDING', 'PROCESSING'] },
          },
        }),
        this.prisma.commercialPipelineRun.count({
          where: {
            groupDestinationId: destinationId,
            status: 'STARTED',
          },
        }),
        this.prisma.commercialDispatchOutbox.count({
          where: {
            dispatch: {
              destinationId,
              status: { in: ['PENDING', 'PROCESSING'] },
            },
          },
        }),
        this.prisma.commercialGroupCampaign.count({
          where: {
            anchorDestinationId: destinationId,
            attemptExecutionId: { not: null },
            attemptLeaseExpiresAt: { gt: now },
          },
        }),
        this.prisma.manualPublicationTarget.count({
          where: {
            destinationId,
            status: { in: ['ACCEPTED', 'PROCESSING', 'QUEUED'] },
            request: { mode: 'SEND' },
          },
        }),
      ]);
    return dispatches + runs + outboxes + reservations + manualTargets > 0;
  }
}

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

  async hasAmbiguousCommercialExecution(
    excludedRunId?: string,
  ): Promise<boolean> {
    const [run, execution] = await Promise.all([
      this.prisma.commercialPipelineRun.findFirst({
        where: {
          OR: [{ finalStatus: 'AMBIGUOUS' }, { investigationRequired: true }],
          ...(excludedRunId ? { id: { not: excludedRunId } } : {}),
        },
        select: { id: true },
      }),
      this.prisma.commercialAutomationExecution.findFirst({
        where: {
          status: 'AMBIGUOUS',
          ...(excludedRunId ? { commercialRunId: { not: excludedRunId } } : {}),
        },
        select: { id: true },
      }),
    ]);
    return Boolean(run || execution);
  }

  async hasActiveCommercialExecution(
    now: Date,
    excludedExecutionId?: string,
    excludedRunId?: string,
  ): Promise<boolean> {
    const [run, execution] = await Promise.all([
      this.prisma.commercialPipelineRun.findFirst({
        where: {
          OR: [
            { mode: 'CONFIRMED', status: 'STARTED' },
            { finalStatus: 'PENDING' },
            { dispatch: { status: { in: ['PENDING', 'PROCESSING'] } } },
          ],
          ...(excludedRunId ? { id: { not: excludedRunId } } : {}),
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

type CommercialAutomationExecutionSource = {
  id: unknown;
  schedulerJobId: unknown;
  bullMqJobId: unknown;
  activeKey: unknown;
  ownerId: unknown;
  heartbeatAt: unknown;
  leaseExpiresAt: unknown;
  mode: unknown;
  status: unknown;
  externalStage: unknown;
  reasons: unknown;
  commercialRunId: unknown;
  failureCode: unknown;
  startedAt: unknown;
  completedAt: unknown;
};

const mapCommercialAutomationExecution = (
  record: Record<string, unknown> | CommercialAutomationExecutionSource,
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
  externalStage:
    record.externalStage as CommercialAutomationExecutionRecord['externalStage'],
  reasons: record.reasons as string[],
  commercialRunId: (record.commercialRunId as string | null) ?? null,
  failureCode: (record.failureCode as string | null) ?? null,
  startedAt: record.startedAt as Date,
  completedAt: (record.completedAt as Date | null) ?? null,
});

const COMMERCIAL_PREMARKER_MAX_BACKOFF_MINUTES = 24 * 60;
const COMMERCIAL_PREMARKER_MAX_FAILURE_COUNT = 2_147_483_647;

class CommercialPreMarkerRecoveryCasConflictError extends Error {}
class CommercialPreMarkerRecoveryLookupError extends Error {}
class CommercialPreConfirmationRecoveryCasConflictError extends Error {}

const commercialPreMarkerRecoveryLookup = async <T>(
  lookup: () => Promise<T>,
) => {
  try {
    return await lookup();
  } catch {
    throw new CommercialPreMarkerRecoveryLookupError();
  }
};

const calculateCommercialPreMarkerBackoff = (
  failureCount: number,
  minimumIntervalMinutes: number,
  now: Date,
) => {
  if (
    !Number.isSafeInteger(minimumIntervalMinutes) ||
    minimumIntervalMinutes <= 0
  ) {
    return null;
  }
  if (
    !Number.isSafeInteger(failureCount) ||
    failureCount < 0 ||
    failureCount >= COMMERCIAL_PREMARKER_MAX_FAILURE_COUNT
  ) {
    return null;
  }

  const newFailureCount = failureCount + 1;
  const exponent = newFailureCount - 1;
  let delayMinutes = COMMERCIAL_PREMARKER_MAX_BACKOFF_MINUTES;
  if (minimumIntervalMinutes < COMMERCIAL_PREMARKER_MAX_BACKOFF_MINUTES) {
    const doublingsToCap = Math.ceil(
      Math.log2(
        COMMERCIAL_PREMARKER_MAX_BACKOFF_MINUTES / minimumIntervalMinutes,
      ),
    );
    if (exponent < doublingsToCap) {
      delayMinutes = Math.min(
        minimumIntervalMinutes * 2 ** exponent,
        COMMERCIAL_PREMARKER_MAX_BACKOFF_MINUTES,
      );
    }
  }

  return {
    newFailureCount,
    nextEligibleAt: new Date(now.getTime() + delayMinutes * 60_000),
  };
};
export class PrismaCommercialAutomationExecutionRepository implements CommercialAutomationExecutionRepository {
  constructor(
    private readonly prisma: Pick<
      DatabaseClient,
      | '$transaction'
      | 'commercialAutomationExecution'
      | 'commercialAutomationSettings'
      | 'commercialPipelineRun'
      | 'commercialGroupCampaign'
      | 'commercialPromotionCandidate'
      | 'commercialCopyGenerationAttempt'
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

  async findBySchedulerJobId(schedulerJobId: string) {
    const record = await this.prisma.commercialAutomationExecution.findFirst({
      where: { schedulerJobId, bullMqJobId: null },
      orderBy: { startedAt: 'asc' },
    });
    return record ? mapCommercialAutomationExecution(record) : null;
  }

  async start(input: {
    schedulerJobId: string;
    bullMqJobId?: string;
    mode: CommercialAutomationExecutionRecord['mode'];
    startedAt: Date;
    ownerId: string;
    heartbeatAt: Date;
    leaseExpiresAt: Date;
    expectedScheduleRevision?: number;
  }) {
    const createExecution = (
      client: Pick<DatabaseClient, 'commercialAutomationExecution'>,
    ) =>
      client.commercialAutomationExecution.create({
        data: {
          schedulerJobId: input.schedulerJobId,
          bullMqJobId: input.bullMqJobId,
          activeKey: COMMERCIAL_AUTOMATION_ACTIVE_KEY,
          ownerId: input.ownerId,
          heartbeatAt: input.heartbeatAt,
          leaseExpiresAt: input.leaseExpiresAt,
          mode: input.mode,
          status: 'STARTED',
          externalStage: 'NOT_REACHED',
          reasons: [],
          startedAt: input.startedAt,
        },
      });

    try {
      // Manual publication has no schema-level unique key for its logical
      // scheduler identity. Keep the lookup and create in one Serializable
      // transaction so a concurrent retry cannot create a second execution
      // after the first one releases the global active key.
      const started =
        input.expectedScheduleRevision === undefined
          ? !input.bullMqJobId
            ? await this.prisma.$transaction(
                async (transaction) => {
                  const existing =
                    await transaction.commercialAutomationExecution.findFirst({
                      where: {
                        schedulerJobId: input.schedulerJobId,
                        bullMqJobId: null,
                      },
                      orderBy: { startedAt: 'asc' },
                    });
                  if (existing) {
                    return { outcome: 'existing' as const, record: existing };
                  }
                  return {
                    outcome: 'created' as const,
                    record: await createExecution(transaction),
                  };
                },
                { isolationLevel: 'Serializable' },
              )
            : {
                outcome: 'created' as const,
                record: await createExecution(this.prisma),
              }
          : await this.prisma.$transaction(
              async (transaction) => {
                if (input.bullMqJobId) {
                  const existing =
                    await transaction.commercialAutomationExecution.findUnique({
                      where: { bullMqJobId: input.bullMqJobId },
                    });
                  if (existing) {
                    return { outcome: 'existing' as const, record: existing };
                  }
                }
                const settings =
                  await transaction.commercialAutomationSettings.findUnique({
                    where: { id: COMMERCIAL_AUTOMATION_SETTINGS_ID },
                    select: { scheduleRevision: true },
                  });
                const currentScheduleRevision = settings?.scheduleRevision ?? 0;
                if (
                  currentScheduleRevision !== input.expectedScheduleRevision
                ) {
                  throw new AppError(
                    'A agenda comercial mudou antes da aceitacao da execucao',
                    COMMERCIAL_AUTOMATION_SCHEDULE_REVISION_STALE,
                  );
                }
                return {
                  outcome: 'created' as const,
                  record: await createExecution(transaction),
                };
              },
              { isolationLevel: 'Serializable' },
            );
      if (started.outcome === 'existing') {
        return {
          outcome: 'existing' as const,
          execution: mapCommercialAutomationExecution(
            started.record as unknown as Record<string, unknown>,
          ),
        };
      }
      const record = started.record;
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
      if (
        !isUniqueConstraintError(error) &&
        !isTransactionConflictError(error)
      ) {
        throw error;
      }
      if (!input.bullMqJobId) {
        const existing = await this.findBySchedulerJobId(input.schedulerJobId);
        if (existing)
          return { outcome: 'existing' as const, execution: existing };
      }
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
          externalStage: 'NOT_REACHED',
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

  async markExternalMayHaveStarted(
    ownership: CommercialAutomationExecutionOwnership,
    input: { markedAt: Date },
  ) {
    const updated = await this.prisma.commercialAutomationExecution.updateMany({
      where: {
        ...ownedCommercialExecutionWhere(ownership, input.markedAt),
      },
      data: { externalStage: 'EXTERNAL_MAY_HAVE_STARTED' },
    });
    if (updated.count !== 1) this.throwOwnershipLost();
    return this.findExecutionAfterMutation(ownership.executionId);
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

  async markQueuedAmbiguous(
    executionId: string,
    input: {
      commercialRunId: string;
      failureCode: string;
      completedAt: Date;
    },
  ) {
    const updated = await this.prisma.commercialAutomationExecution.updateMany({
      where: {
        id: executionId,
        status: 'QUEUED',
        commercialRunId: input.commercialRunId,
      },
      data: {
        activeKey: null,
        status: 'AMBIGUOUS',
        failureCode: input.failureCode,
        completedAt: input.completedAt,
      },
    });
    if (updated.count !== 1) {
      const current = await this.findById(executionId);
      if (
        current?.status === 'AMBIGUOUS' &&
        current.commercialRunId === input.commercialRunId &&
        current.failureCode === input.failureCode
      ) {
        return current;
      }
      this.throwOwnershipLost();
    }
    return this.findExecutionAfterMutation(executionId);
  }

  async findRecoveryContext(
    id: string,
  ): Promise<CommercialAutomationExecutionRecoveryContext | null> {
    const execution = await this.findById(id);
    if (!execution) return null;
    if (!execution.commercialRunId) return { execution, run: null };
    const run = await this.prisma.commercialPipelineRun.findUnique({
      where: { id: execution.commercialRunId },
      include: {
        dispatch: {
          include: { destination: { include: whatsappGroupAssignmentInclude } },
        },
        dispatchOutbox: true,
      },
    });
    if (!run) return { execution, run: null };
    const destination = run.dispatch?.destination
      ? mapWhatsAppDestinationWithAssignments(
          run.dispatch.destination as unknown as Record<string, unknown>,
        )
      : null;
    return {
      execution,
      run: {
        id: run.id,
        mode: run.mode,
        dispatchId: run.dispatchId,
        jobId: run.jobId,
        instanceName: run.instanceName,
        finalStatus: run.finalStatus,
        investigationRequired: run.investigationRequired,
        dispatch: run.dispatch
          ? {
              id: run.dispatch.id,
              status: run.dispatch.status,
              attemptCount: run.dispatch.attemptCount,
              instanceName: run.dispatch.instanceName,
              destinationId: run.dispatch.destinationId,
              destinationType: destination?.type,
              destinationAssignedInstanceName:
                destination?.assignedInstanceNames === undefined
                  ? destination?.assignedInstanceName
                  : undefined,
              destinationAssignedInstanceNames:
                destination?.assignedInstanceNames,
              externalMessageId: run.dispatch.externalMessageId,
              sentAt: run.dispatch.sentAt,
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

  async recoverStalePreMarkerReservation(
    id: string,
    input: {
      completedAt: Date;
      minimumIntervalMinutes: number;
      failureCode: string;
    },
  ) {
    if (
      !Number.isSafeInteger(input.minimumIntervalMinutes) ||
      input.minimumIntervalMinutes <= 0
    ) {
      return {
        outcome: 'BLOCKED' as const,
        reason: 'INVALID_MINIMUM_INTERVAL' as const,
      };
    }

    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const execution = await commercialPreMarkerRecoveryLookup(() =>
            transaction.commercialAutomationExecution.findUnique({
              where: { id },
            }),
          );
          if (!execution) {
            return {
              outcome: 'BLOCKED' as const,
              reason: 'EXECUTION_NOT_FOUND' as const,
            };
          }
          if (execution.status !== 'STARTED') {
            if (
              execution.status === 'FAILED' &&
              execution.failureCode === input.failureCode
            ) {
              return {
                outcome: 'ALREADY_RECOVERED' as const,
                execution: mapCommercialAutomationExecution(
                  execution as unknown as Record<string, unknown>,
                ),
              };
            }
            return {
              outcome: 'BLOCKED' as const,
              reason: 'EXECUTION_NOT_STARTED' as const,
            };
          }
          if (
            !execution.ownerId ||
            !execution.activeKey ||
            !execution.heartbeatAt ||
            !execution.leaseExpiresAt
          ) {
            return {
              outcome: 'BLOCKED' as const,
              reason: 'EXECUTION_OWNERSHIP_INCOMPLETE' as const,
            };
          }
          if (
            execution.leaseExpiresAt.getTime() > input.completedAt.getTime()
          ) {
            return {
              outcome: 'BLOCKED' as const,
              reason: 'EXECUTION_NOT_STALE' as const,
            };
          }
          if (execution.externalStage !== 'NOT_REACHED') {
            return {
              outcome: 'BLOCKED' as const,
              reason: 'EXTERNAL_STAGE_REACHED' as const,
            };
          }
          if (execution.commercialRunId !== null) {
            return {
              outcome: 'BLOCKED' as const,
              reason: 'COMMERCIAL_RUN_LINKED' as const,
            };
          }

          const linkedRun = await commercialPreMarkerRecoveryLookup(() =>
            transaction.commercialPipelineRun.findUnique({
              where: { executionId: id },
              select: {
                id: true,
                dispatchId: true,
                jobId: true,
                dispatch: { select: { id: true } },
                dispatchOutbox: { select: { id: true, status: true } },
              },
            }),
          );
          if (linkedRun) {
            if (linkedRun.dispatchId || linkedRun.dispatch) {
              return {
                outcome: 'BLOCKED' as const,
                reason: 'DISPATCH_EVIDENCE' as const,
              };
            }
            if (linkedRun.dispatchOutbox) {
              return {
                outcome: 'BLOCKED' as const,
                reason: 'OUTBOX_EVIDENCE' as const,
              };
            }
            if (linkedRun.jobId) {
              return {
                outcome: 'BLOCKED' as const,
                reason: 'JOB_EVIDENCE' as const,
              };
            }
            return {
              outcome: 'BLOCKED' as const,
              reason: 'RUN_EVIDENCE' as const,
            };
          }

          const reservations = await commercialPreMarkerRecoveryLookup(() =>
            transaction.commercialGroupCampaign.findMany({
              where: { attemptExecutionId: id },
              take: 2,
              select: {
                id: true,
                failureCount: true,
                attemptExecutionId: true,
                attemptReservedAt: true,
                attemptLeaseExpiresAt: true,
              },
            }),
          );
          if (reservations.length !== 1) {
            return {
              outcome: 'BLOCKED' as const,
              reason: 'RESERVATION_NOT_UNIQUE' as const,
            };
          }
          const campaign = reservations[0];
          if (
            campaign.attemptExecutionId !== id ||
            !campaign.attemptReservedAt ||
            !campaign.attemptLeaseExpiresAt ||
            campaign.attemptReservedAt.getTime() >
              campaign.attemptLeaseExpiresAt.getTime()
          ) {
            return {
              outcome: 'BLOCKED' as const,
              reason: 'RESERVATION_INVALID' as const,
            };
          }
          if (
            campaign.attemptLeaseExpiresAt.getTime() >
            input.completedAt.getTime()
          ) {
            return {
              outcome: 'BLOCKED' as const,
              reason: 'RESERVATION_LEASE_ACTIVE' as const,
            };
          }

          const candidates = await commercialPreMarkerRecoveryLookup(() =>
            transaction.commercialPromotionCandidate.findMany({
              where: { campaignId: campaign.id },
              select: { id: true },
            }),
          );
          if (candidates.length === 0) {
            return {
              outcome: 'BLOCKED' as const,
              reason: 'RESERVATION_INVALID' as const,
            };
          }
          const copyAttempt = await commercialPreMarkerRecoveryLookup(() =>
            transaction.commercialCopyGenerationAttempt.findFirst({
              where: {
                candidateId: {
                  in: candidates.map((candidate) => candidate.id),
                },
                status: { in: ['STARTED', 'AMBIGUOUS'] },
              },
              select: { id: true },
            }),
          );
          if (copyAttempt) {
            return {
              outcome: 'BLOCKED' as const,
              reason: 'COPY_ATTEMPT_EVIDENCE' as const,
            };
          }

          const backoff = calculateCommercialPreMarkerBackoff(
            campaign.failureCount,
            input.minimumIntervalMinutes,
            input.completedAt,
          );
          if (!backoff) {
            return {
              outcome: 'BLOCKED' as const,
              reason: 'FAILURE_COUNT_INVALID' as const,
            };
          }

          const campaignUpdated =
            await transaction.commercialGroupCampaign.updateMany({
              where: {
                id: campaign.id,
                attemptExecutionId: id,
                attemptReservedAt: campaign.attemptReservedAt,
                attemptLeaseExpiresAt: campaign.attemptLeaseExpiresAt,
                failureCount: campaign.failureCount,
              },
              data: {
                failureCount: backoff.newFailureCount,
                nextEligibleAt: backoff.nextEligibleAt,
                attemptExecutionId: null,
                attemptReservedAt: null,
                attemptLeaseExpiresAt: null,
              },
            });
          if (campaignUpdated.count !== 1) {
            throw new CommercialPreMarkerRecoveryCasConflictError();
          }

          const executionUpdated =
            await transaction.commercialAutomationExecution.updateMany({
              where: {
                id,
                status: 'STARTED',
                externalStage: 'NOT_REACHED',
                commercialRunId: null,
                ownerId: execution.ownerId,
                activeKey: execution.activeKey,
                heartbeatAt: execution.heartbeatAt,
                leaseExpiresAt: execution.leaseExpiresAt,
              },
              data: {
                activeKey: null,
                status: 'FAILED',
                failureCode: input.failureCode,
                completedAt: input.completedAt,
              },
            });
          if (executionUpdated.count !== 1) {
            throw new CommercialPreMarkerRecoveryCasConflictError();
          }

          const recovered = await commercialPreMarkerRecoveryLookup(() =>
            transaction.commercialAutomationExecution.findUnique({
              where: { id },
            }),
          );
          if (!recovered) {
            throw new CommercialPreMarkerRecoveryCasConflictError();
          }
          return {
            outcome: 'RECOVERED' as const,
            execution: mapCommercialAutomationExecution(
              recovered as unknown as Record<string, unknown>,
            ),
            campaignId: campaign.id,
            failureCount: backoff.newFailureCount,
            nextEligibleAt: backoff.nextEligibleAt,
          };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (
        error instanceof CommercialPreMarkerRecoveryCasConflictError ||
        isTransactionConflictError(error)
      ) {
        try {
          const current = await this.findById(id);
          if (
            current?.status === 'FAILED' &&
            current.failureCode === input.failureCode
          ) {
            return {
              outcome: 'ALREADY_RECOVERED' as const,
              execution: current,
            };
          }
        } catch {
          // A transaction conflict remains authoritative even if the
          // follow-up idempotency lookup cannot be completed.
        }
        return {
          outcome: 'BLOCKED' as const,
          reason: 'CAS_CONFLICT' as const,
        };
      }
      if (error instanceof CommercialPreMarkerRecoveryLookupError) {
        return {
          outcome: 'BLOCKED' as const,
          reason: 'LOOKUP_FAILED' as const,
        };
      }
      throw error;
    }
  }

  async recoverStalePreConfirmationReservation(
    id: string,
    input: { completedAt: Date; failureCode: string },
  ): Promise<CommercialPreConfirmationReservationRecoveryResult> {
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const execution =
            await transaction.commercialAutomationExecution.findUnique({
              where: { id },
            });
          if (!execution) {
            return {
              outcome: 'BLOCKED' as const,
              reason: 'EXECUTION_NOT_FOUND' as const,
            };
          }
          if (execution.status !== 'STARTED') {
            if (
              execution.status === 'FAILED' &&
              execution.failureCode === input.failureCode
            ) {
              return {
                outcome: 'ALREADY_RECOVERED' as const,
                execution: mapCommercialAutomationExecution(
                  execution as unknown as Record<string, unknown>,
                ),
              };
            }
            return {
              outcome: 'BLOCKED' as const,
              reason: 'EXECUTION_NOT_STARTED' as const,
            };
          }
          if (
            !execution.ownerId ||
            !execution.activeKey ||
            !execution.heartbeatAt ||
            !execution.leaseExpiresAt
          ) {
            return {
              outcome: 'BLOCKED' as const,
              reason: 'EXECUTION_OWNERSHIP_INCOMPLETE' as const,
            };
          }
          if (
            execution.leaseExpiresAt.getTime() > input.completedAt.getTime()
          ) {
            return {
              outcome: 'BLOCKED' as const,
              reason: 'EXECUTION_NOT_STALE' as const,
            };
          }
          if (!execution.commercialRunId) {
            return {
              outcome: 'BLOCKED' as const,
              reason: 'RUN_EVIDENCE' as const,
            };
          }

          const run = await transaction.commercialPipelineRun.findUnique({
            where: { id: execution.commercialRunId },
            select: {
              id: true,
              executionId: true,
              mode: true,
              dispatchId: true,
              jobId: true,
              dispatch: { select: { id: true } },
              dispatchOutbox: { select: { id: true } },
            },
          });
          if (
            !run ||
            run.executionId !== id ||
            run.mode !== 'DRY_RUN' ||
            run.dispatchId ||
            run.jobId ||
            run.dispatch ||
            run.dispatchOutbox
          ) {
            return {
              outcome: 'BLOCKED' as const,
              reason: 'RUN_EVIDENCE' as const,
            };
          }

          const reservations =
            await transaction.commercialGroupCampaign.findMany({
              where: { attemptExecutionId: id },
              take: 2,
              select: {
                id: true,
                attemptExecutionId: true,
                attemptReservedAt: true,
                attemptLeaseExpiresAt: true,
              },
            });
          if (reservations.length > 1) {
            return {
              outcome: 'BLOCKED' as const,
              reason: 'RESERVATION_NOT_UNIQUE' as const,
            };
          }
          const reservation = reservations[0];
          if (
            reservation &&
            (reservation.attemptExecutionId !== id ||
              !reservation.attemptReservedAt ||
              !reservation.attemptLeaseExpiresAt)
          ) {
            return {
              outcome: 'BLOCKED' as const,
              reason: 'RESERVATION_INVALID' as const,
            };
          }
          if (reservation) {
            const released =
              await transaction.commercialGroupCampaign.updateMany({
                where: {
                  id: reservation.id,
                  attemptExecutionId: id,
                  attemptReservedAt: reservation.attemptReservedAt,
                  attemptLeaseExpiresAt: reservation.attemptLeaseExpiresAt,
                },
                data: {
                  attemptExecutionId: null,
                  attemptReservedAt: null,
                  attemptLeaseExpiresAt: null,
                },
              });
            if (released.count !== 1) {
              throw new CommercialPreConfirmationRecoveryCasConflictError();
            }
          }

          const updated =
            await transaction.commercialAutomationExecution.updateMany({
              where: {
                id,
                status: 'STARTED',
                externalStage: execution.externalStage,
                commercialRunId: execution.commercialRunId,
                ownerId: execution.ownerId,
                activeKey: execution.activeKey,
                heartbeatAt: execution.heartbeatAt,
                leaseExpiresAt: execution.leaseExpiresAt,
              },
              data: {
                activeKey: null,
                status: 'FAILED',
                failureCode: input.failureCode,
                completedAt: input.completedAt,
              },
            });
          if (updated.count !== 1) {
            throw new CommercialPreConfirmationRecoveryCasConflictError();
          }

          const recovered =
            await transaction.commercialAutomationExecution.findUnique({
              where: { id },
            });
          if (!recovered) {
            throw new CommercialPreConfirmationRecoveryCasConflictError();
          }
          return {
            outcome: 'RECOVERED' as const,
            execution: mapCommercialAutomationExecution(
              recovered as unknown as Record<string, unknown>,
            ),
          };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (
        error instanceof CommercialPreConfirmationRecoveryCasConflictError ||
        isTransactionConflictError(error)
      ) {
        try {
          const current = await this.findById(id);
          if (
            current?.status === 'FAILED' &&
            current.failureCode === input.failureCode
          ) {
            return {
              outcome: 'ALREADY_RECOVERED' as const,
              execution: current,
            };
          }
        } catch {
          // A transaction conflict remains authoritative when the
          // follow-up idempotency lookup is unavailable.
        }
        return { outcome: 'BLOCKED' as const, reason: 'CAS_CONFLICT' as const };
      }
      throw error;
    }
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
    private readonly prisma: Pick<DatabaseClient, 'whatsAppDestination'> &
      Partial<Pick<DatabaseClient, 'whatsAppInstance'>>,
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

  async assignToInstance(
    destinationId: string,
    instanceName: string,
    expectedUpdatedAt?: Date,
  ): Promise<WhatsAppDestinationRecord | null> {
    if (!this.prisma.whatsAppInstance) return null;
    const instance = await this.prisma.whatsAppInstance.findUnique({
      where: { name: instanceName },
      select: { name: true },
    });
    if (!instance) return null;
    const destination = await this.prisma.whatsAppDestination.findFirst({
      where: { id: destinationId },
      select: { id: true, type: true },
    });
    if (!destination || destination.type !== 'GROUP') return null;
    if (!expectedUpdatedAt) {
      try {
        return (await this.prisma.whatsAppDestination.update({
          where: { id: destinationId },
          data: { assignedInstanceName: instanceName },
        })) as WhatsAppDestinationRecord;
      } catch {
        return null;
      }
    }
    const result = await this.prisma.whatsAppDestination.updateMany({
      where: {
        id: destinationId,
        type: 'GROUP',
        ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}),
      },
      data: { assignedInstanceName: instanceName },
    });
    if (result.count !== 1) return null;
    return (await this.prisma.whatsAppDestination.findFirst({
      where: { id: destinationId, type: 'GROUP' },
    })) as WhatsAppDestinationRecord | null;
  }

  async updateAdministrative(
    id: string,
    data: {
      active?: boolean;
      paused?: boolean;
      assignedInstanceName?: string | null;
      expectedUpdatedAt: Date;
    },
  ): Promise<WhatsAppDestinationRecord | null> {
    const { expectedUpdatedAt, ...changes } = data;
    const result = await this.prisma.whatsAppDestination.updateMany({
      where: { id, type: 'GROUP', updatedAt: expectedUpdatedAt },
      data: changes,
    });
    if (result.count !== 1) return null;
    return (await this.prisma.whatsAppDestination.findFirst({
      where: { id, type: 'GROUP' },
    })) as WhatsAppDestinationRecord | null;
  }
}

export class PrismaWhatsAppInstanceRepository implements WhatsAppInstanceRepository {
  constructor(
    private readonly prisma: Pick<DatabaseClient, 'whatsAppInstance'>,
  ) {}

  async list(): Promise<WhatsAppInstanceRecord[]> {
    return (await this.prisma.whatsAppInstance.findMany({
      orderBy: { name: 'asc' },
    })) as WhatsAppInstanceRecord[];
  }

  async findByName(name: string): Promise<WhatsAppInstanceRecord | null> {
    return (await this.prisma.whatsAppInstance.findUnique({
      where: { name },
    })) as WhatsAppInstanceRecord | null;
  }

  async upsert(name: string): Promise<WhatsAppInstanceRecord> {
    return (await this.prisma.whatsAppInstance.upsert({
      where: { name },
      create: { name },
      update: {},
    })) as WhatsAppInstanceRecord;
  }

  async create(name: string): Promise<WhatsAppInstanceRecord> {
    return (await this.prisma.whatsAppInstance.create({
      // A newly registered provider is not trusted until an operator activates it.
      data: { name, active: false, paused: false },
    })) as WhatsAppInstanceRecord;
  }

  async setActive(
    name: string,
    active: boolean,
    expectedUpdatedAt?: Date,
  ): Promise<WhatsAppInstanceRecord | null> {
    try {
      if (!expectedUpdatedAt) {
        return (await this.prisma.whatsAppInstance.update({
          where: { name },
          data: { active },
        })) as WhatsAppInstanceRecord;
      }
      const result = await this.prisma.whatsAppInstance.updateMany({
        where: {
          name,
          ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}),
        },
        data: { active },
      });
      if (result.count !== 1) return null;
      return (await this.findByName(name)) as WhatsAppInstanceRecord | null;
    } catch (error) {
      if (isRecordNotFoundError(error)) return null;
      throw error;
    }
  }

  async setPaused(
    name: string,
    paused: boolean,
    expectedUpdatedAt?: Date,
  ): Promise<WhatsAppInstanceRecord | null> {
    const result = await this.prisma.whatsAppInstance.updateMany({
      where: {
        name,
        ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}),
      },
      data: { paused },
    });
    if (result.count !== 1) return null;
    return (await this.findByName(name)) as WhatsAppInstanceRecord | null;
  }

  async updateAdministrative(
    name: string,
    data: {
      active?: boolean;
      paused?: boolean;
      expectedUpdatedAt: Date;
    },
  ): Promise<WhatsAppInstanceRecord | null> {
    const { expectedUpdatedAt, ...changes } = data;
    const result = await this.prisma.whatsAppInstance.updateMany({
      where: { name, updatedAt: expectedUpdatedAt },
      data: changes,
    });
    if (result.count !== 1) return null;
    return (await this.findByName(name)) as WhatsAppInstanceRecord | null;
  }
}

export class PrismaWhatsAppGroupDirectoryRepository implements WhatsAppGroupDirectoryRepository {
  constructor(private readonly prisma: DatabaseClient) {}

  async findById(id: string): Promise<WhatsAppGroupRecord | null> {
    const record = await this.prisma.whatsAppDestination.findFirst({
      where: { id, type: 'GROUP' },
      include: whatsappGroupAssignmentInclude,
    });
    return record ? mapWhatsAppGroupRecord(record) : null;
  }

  async findByExternalGroupId(
    sourceInstanceName: string,
    externalGroupId: string,
  ): Promise<WhatsAppGroupRecord | null> {
    const record = await this.prisma.whatsAppDestination.findFirst({
      where: {
        type: 'GROUP',
        sourceInstanceName,
        destination: externalGroupId,
      },
      include: whatsappGroupAssignmentInclude,
    });
    return record ? mapWhatsAppGroupRecord(record) : null;
  }

  async listByInstance(
    sourceInstanceName: string,
  ): Promise<WhatsAppGroupRecord[]> {
    const records = await this.prisma.whatsAppDestination.findMany({
      where: { type: 'GROUP', sourceInstanceName },
      orderBy: { name: 'asc' },
      include: whatsappGroupAssignmentInclude,
    });
    return records.map((record) => mapWhatsAppGroupRecord(record));
  }

  async list(
    sourceInstanceName: string,
    filters: WhatsAppGroupFilters = {},
  ): Promise<WhatsAppGroupRecord[]> {
    const records = await this.prisma.whatsAppDestination.findMany({
      where: {
        type: 'GROUP',
        sourceInstanceName,
        active: filters.active,
        available: filters.available,
      },
      orderBy: { name: 'asc' },
      include: whatsappGroupAssignmentInclude,
    });
    return records.map((record) => mapWhatsAppGroupRecord(record));
  }

  async listAll(
    filters: WhatsAppGroupFilters = {},
  ): Promise<WhatsAppGroupRecord[]> {
    const records = await this.prisma.whatsAppDestination.findMany({
      where: {
        type: 'GROUP',
        active: filters.active,
        available: filters.available,
      },
      orderBy: { name: 'asc' },
      include: whatsappGroupAssignmentInclude,
    });
    return records.map((record) => mapWhatsAppGroupRecord(record));
  }

  async create(data: WhatsAppGroupCreateData): Promise<WhatsAppGroupRecord> {
    const fallbackAssignment =
      data.assignedInstanceName ?? data.sourceInstanceName;
    const orderedInstanceNames =
      data.assignedInstanceNames !== undefined
        ? normalizeGroupAssignmentNames(data.assignedInstanceNames, {
            allowEmpty: true,
          })
        : normalizeGroupAssignmentNames(
            fallbackAssignment ? [fallbackAssignment] : [],
            { allowEmpty: true },
          );
    const assignedInstanceName = orderedInstanceNames[0] || null;
    const destinationData = { ...data };
    delete destinationData.assignedInstanceNames;
    delete destinationData.assignmentRevision;
    return this.prisma.$transaction(async (transaction) => {
      for (const instanceName of orderedInstanceNames.filter(Boolean)) {
        await transaction.whatsAppInstance.upsert({
          where: { name: instanceName },
          create: { name: instanceName },
          update: {},
        });
      }
      const record = await transaction.whatsAppDestination.create({
        data: { ...destinationData, assignedInstanceName },
      });
      if (record.type === 'GROUP') {
        await transaction.whatsAppGroupInstanceAssignment.createMany({
          data: orderedInstanceNames
            .filter(Boolean)
            .map((instanceName, position) => ({
              destinationId: record.id,
              instanceName,
              position,
            })),
        });
      }
      const withAssignments = await transaction.whatsAppDestination.findUnique({
        where: { id: record.id },
        include: whatsappGroupAssignmentInclude,
      });
      if (!withAssignments)
        throw new AppError('Grupo nao encontrado', 'WHATSAPP_GROUP_NOT_FOUND');
      return mapWhatsAppGroupRecord(withAssignments);
    });
  }

  async update(
    id: string,
    data: WhatsAppGroupUpdate,
  ): Promise<WhatsAppGroupRecord | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    await this.prisma.whatsAppDestination.update({
      where: { id },
      data,
    });
    return this.findById(id);
  }

  async updateAdministrative(
    id: string,
    data: {
      active?: boolean;
      paused?: boolean;
      assignedInstanceName?: string | null;
      assignedInstanceNames?: string[];
      expectedUpdatedAt: Date;
    },
  ): Promise<WhatsAppGroupRecord | null> {
    if (data.assignedInstanceNames !== undefined) return null;
    const { expectedUpdatedAt, ...changes } = data;
    const result = await this.prisma.whatsAppDestination.updateMany({
      where: { id, type: 'GROUP', updatedAt: expectedUpdatedAt },
      data: changes,
    });
    if (result.count !== 1) return null;
    return this.findById(id);
  }

  async updateAdministrativeWithLifecycleGuard(
    id: string,
    data: {
      active?: boolean;
      paused?: boolean;
      assignedInstanceName?: string | null;
      assignedInstanceNames?: string[];
      expectedUpdatedAt: Date;
      now: Date;
    },
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "WhatsAppDestination"
        WHERE "id" = ${id}
        FOR UPDATE
      `;
      if (locked.length !== 1) return { kind: 'CAS_CONFLICT' as const };

      const current = await transaction.whatsAppDestination.findFirst({
        where: { id, type: 'GROUP' },
        include: whatsappGroupAssignmentInclude,
      });
      if (
        !current ||
        current.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()
      ) {
        return { kind: 'CAS_CONFLICT' as const };
      }

      const dispatches = await transaction.whatsAppDispatch.count({
        where: { destinationId: id, status: { in: ['PENDING', 'PROCESSING'] } },
      });
      const runs = await transaction.commercialPipelineRun.count({
        where: { groupDestinationId: id, status: 'STARTED' },
      });
      const outboxes = await transaction.commercialDispatchOutbox.count({
        where: {
          dispatch: {
            destinationId: id,
            status: { in: ['PENDING', 'PROCESSING'] },
          },
        },
      });
      const reservations = await transaction.commercialGroupCampaign.count({
        where: {
          anchorDestinationId: id,
          attemptExecutionId: { not: null },
          attemptLeaseExpiresAt: { gt: data.now },
        },
      });
      const manualTargets = await transaction.manualPublicationTarget.count({
        where: {
          destinationId: id,
          status: { in: ['ACCEPTED', 'PROCESSING', 'QUEUED'] },
          request: { mode: 'SEND' },
        },
      });
      if (dispatches + runs + outboxes + reservations + manualTargets > 0) {
        return { kind: 'ACTIVE_LIFECYCLE' as const };
      }

      const currentGroup = mapWhatsAppGroupRecord(current);
      const currentNames =
        currentGroup.assignedInstanceNames ??
        (currentGroup.assignedInstanceName
          ? [currentGroup.assignedInstanceName]
          : []);
      const nextNames =
        data.assignedInstanceNames !== undefined
          ? normalizeGroupAssignmentNames(data.assignedInstanceNames, {
              allowEmpty: true,
            })
          : data.assignedInstanceName !== undefined
            ? data.assignedInstanceName === null
              ? []
              : normalizeGroupAssignmentNames([data.assignedInstanceName], {
                  allowEmpty: false,
                })
            : currentNames;
      const assignmentChanged =
        currentNames.length !== nextNames.length ||
        currentNames.some((name, index) => name !== nextNames[index]);

      const updated = await transaction.whatsAppDestination.updateMany({
        where: { id, type: 'GROUP', updatedAt: data.expectedUpdatedAt },
        data: {
          ...(data.active === undefined ? {} : { active: data.active }),
          ...(data.paused === undefined ? {} : { paused: data.paused }),
          assignedInstanceName: nextNames[0] ?? null,
          ...(assignmentChanged
            ? { assignmentRevision: { increment: 1 } }
            : {}),
        },
      });
      if (updated.count !== 1) return { kind: 'CAS_CONFLICT' as const };
      if (assignmentChanged) {
        await transaction.whatsAppGroupInstanceAssignment.deleteMany({
          where: { destinationId: id },
        });
        if (nextNames.length > 0) {
          await transaction.whatsAppGroupInstanceAssignment.createMany({
            data: nextNames.map((instanceName, position) => ({
              destinationId: id,
              instanceName,
              position,
            })),
          });
        }
      }
      const group = await transaction.whatsAppDestination.findUnique({
        where: { id },
        include: whatsappGroupAssignmentInclude,
      });
      if (!group) return { kind: 'CAS_CONFLICT' as const };
      return {
        kind: 'UPDATED' as const,
        group: mapWhatsAppGroupRecord(group),
      };
    });
  }
}

export class PrismaWhatsAppDispatchRepository implements WhatsAppDispatchRepository {
  constructor(private readonly prisma: DatabaseClient) {}

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
        instanceName: true,
        externalMessageId: true,
        status: true,
        attemptCount: true,
        errorMessage: true,
        sentAt: true,
        createdAt: true,
        updatedAt: true,
        destination: {
          select: {
            id: true,
            destination: true,
            type: true,
            active: true,
            paused: true,
            available: true,
            fingerprint: true,
            sourceInstanceName: true,
            assignedInstanceName: true,
            assignmentRevision: true,
            instanceAssignments: {
              select: { instanceName: true, position: true },
              orderBy: { position: 'asc' },
            },
          },
        },
        product: {
          select: {
            comissao: true,
            urlImagem: true,
            affiliateLink: true,
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
            source: true,
            promptVersion: true,
            validationVersion: true,
            promotionCandidates: {
              select: {
                id: true,
                campaignId: true,
                productId: true,
                snapshotId: true,
                generatedCopyId: true,
                status: true,
                expiresAt: true,
                campaign: {
                  select: {
                    id: true,
                    logicalGroupFingerprint: true,
                  },
                },
                product: {
                  select: {
                    id: true,
                    source: true,
                    providerProductId: true,
                    nome: true,
                    loja: true,
                    productLink: true,
                    affiliateLink: true,
                    preco: true,
                    precoMin: true,
                    precoMax: true,
                    desconto: true,
                    comissao: true,
                    nota: true,
                    vendidos: true,
                    offerStartsAt: true,
                    urlImagem: true,
                    offerEndsAt: true,
                    unavailableAt: true,
                    commercialSnapshotRevision: true,
                    commercialSnapshotFingerprint: true,
                    updatedAt: true,
                  },
                },
                snapshot: {
                  select: {
                    id: true,
                    productId: true,
                    revision: true,
                    fingerprint: true,
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

    const promotionCandidates = record.generatedCopy.promotionCandidates ?? [];
    return {
      ...record,
      destination: mapWhatsAppDestinationWithAssignments(
        record.destination as unknown as Record<string, unknown>,
      ),
      generatedCopy: {
        ...record.generatedCopy,
        promotionCandidates: promotionCandidates.map((candidate) => ({
          ...candidate,
          product: {
            id: candidate.product.id,
            source:
              candidate.product.source === 'OFFICIAL'
                ? 'OFFICIAL'
                : candidate.product.source === 'MANUAL'
                  ? 'MANUAL'
                  : 'MOCK',
            providerProductId: candidate.product.providerProductId,
            productName: candidate.product.nome,
            shopName: candidate.product.loja,
            productLink: candidate.product.productLink,
            affiliateLink: candidate.product.affiliateLink,
            price: decimalString(candidate.product.preco) ?? '',
            priceMin: decimalString(candidate.product.precoMin) ?? null,
            priceMax: decimalString(candidate.product.precoMax) ?? null,
            discountRate: Number(candidate.product.desconto),
            commissionRate: Number(candidate.product.comissao),
            rating: Number(candidate.product.nota),
            sales: Number(candidate.product.vendidos),
            offerStartsAt: candidate.product.offerStartsAt,
            urlImagem: candidate.product.urlImagem,
            offerEndsAt: candidate.product.offerEndsAt,
            unavailableAt: candidate.product.unavailableAt,
            commercialSnapshotRevision:
              candidate.product.commercialSnapshotRevision,
            commercialSnapshotFingerprint:
              candidate.product.commercialSnapshotFingerprint,
            updatedAt: candidate.product.updatedAt,
          },
        })),
      },
    };
  }

  async findByIdWithDetails(
    id: string,
  ): Promise<WhatsAppDispatchDetails | null> {
    const record = await this.prisma.whatsAppDispatch.findUnique({
      where: { id },
      include: {
        product: true,
        generatedCopy: true,
        destination: { include: whatsappGroupAssignmentInclude },
      },
    });
    return record
      ? ({
          ...record,
          destination: mapWhatsAppDestinationWithAssignments(
            record.destination as unknown as Record<string, unknown>,
          ),
        } as unknown as WhatsAppDispatchDetails)
      : null;
  }

  async list(
    filters: WhatsAppDispatchFilters,
  ): Promise<WhatsAppDispatchDetails[]> {
    const status = (
      ['PENDING', 'PROCESSING', 'SENT', 'FAILED'] as WhatsAppDispatchStatus[]
    ).includes(filters.status as WhatsAppDispatchStatus)
      ? (filters.status as WhatsAppDispatchStatus)
      : undefined;

    const records = await this.prisma.whatsAppDispatch.findMany({
      where: {
        status,
        destinationId: filters.destinationId,
        productId: filters.productId,
      } as never,
      include: {
        product: true,
        generatedCopy: true,
        destination: { include: whatsappGroupAssignmentInclude },
      },
      orderBy: { createdAt: 'desc' },
    });
    return records.map((record) => ({
      ...record,
      destination: mapWhatsAppDestinationWithAssignments(
        record.destination as unknown as Record<string, unknown>,
      ),
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

  async claimPendingForSending(
    id: string,
    expectedAssignedInstanceName: string,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT destination."id"
        FROM "WhatsAppDestination" AS destination
        INNER JOIN "WhatsAppDispatch" AS dispatch
          ON dispatch."destinationId" = destination."id"
        WHERE dispatch."id" = ${id}
        FOR UPDATE OF destination
      `;
      if (locked.length !== 1) return { kind: 'NOT_PENDING' as const };

      const dispatch = await transaction.whatsAppDispatch.findUnique({
        where: { id },
        select: {
          status: true,
          instanceName: true,
          destination: {
            select: {
              type: true,
              assignedInstanceName: true,
              instanceAssignments: {
                select: { instanceName: true, position: true },
                orderBy: { position: 'asc' },
              },
            },
          },
        },
      });
      if (!dispatch || dispatch.status !== 'PENDING') {
        return { kind: 'NOT_PENDING' as const };
      }
      const assignedInstanceNames =
        dispatch.destination.instanceAssignments?.map(
          (assignment) => assignment.instanceName,
        ) ?? [];
      const assignmentMatches =
        assignedInstanceNames.length > 0
          ? assignedInstanceNames.includes(expectedAssignedInstanceName)
          : dispatch.destination.assignedInstanceName ===
            expectedAssignedInstanceName;
      if (
        dispatch.destination.type === 'GROUP' &&
        (dispatch.instanceName !== expectedAssignedInstanceName ||
          !assignmentMatches)
      ) {
        await transaction.whatsAppDispatch.updateMany({
          where: { id, status: 'PENDING' },
          data: {
            status: 'FAILED',
            errorMessage: 'Identidade sticky da instancia comercial divergente',
          },
        });
        return { kind: 'STICKY_INSTANCE_MISMATCH' as const };
      }
      const claimed = await transaction.whatsAppDispatch.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'PROCESSING',
          attemptCount: { increment: 1 },
          errorMessage: null,
        },
      });
      return claimed.count === 1
        ? { kind: 'CLAIMED' as const }
        : { kind: 'NOT_PENDING' as const };
    });
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
