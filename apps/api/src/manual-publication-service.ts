import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import {
  commercialProductRejections,
} from './commercial-offer-eligibility';
import type { CommercialMessageDraft } from './commercial-message-draft-service';
import { CommercialMessageDraftService } from './commercial-message-draft-service';
import {
  COMMERCIAL_CONFIRMATION_TOKEN,
  commercialConfirmationIds,
  type CommercialConfirmationEnvironment,
  type CommercialPipelineConfirmationService,
} from './commercial-pipeline-confirmation-service';
import type { CommercialAutomationCandidateFlowService } from './commercial-automation-candidate-flow-service';
import type {
  CommercialAutomationPolicyService,
} from './commercial-automation-policy-service';
import { getLocalDayRange } from './commercial-automation-policy-service';
import type {
  CommercialGroupCampaignRepository,
  CommercialPromotionCandidateRepository,
  CommercialPromotionCatalogItem,
  CommercialPromotionCatalogRepository,
  CommercialPromotionCopyRepository,
  CommercialPipelineRunRepository,
  CommercialDispatchOutboxRepository,
  CommercialDeliveryHistoryRepository,
  ManualPublicationRequestCreateData,
  ManualPublicationRequestMode,
  ManualPublicationRequestRecord,
  ManualPublicationRequestRepository,
  ManualPublicationTargetRecord,
  ShopeeOfferRepository,
  WhatsAppDispatchRepository,
  WhatsAppGroupDirectoryRepository,
  WhatsAppGroupRecord,
  WhatsAppInstanceRepository,
  CommercialAutomationTarget,
} from './repositories';

export const MANUAL_PUBLICATION_CONFIRMATION = 'ENVIAR_PUBLICACAO_MANUAL';
export const MANUAL_PUBLICATION_MAX_GROUPS = 5;
export const MANUAL_PUBLICATION_CONTRACT_VERSION = 'phase17-manual-v1';
const MANUAL_PUBLICATION_PROCESSING_LEASE_SECONDS = 300;

export type ManualPublicationInput = {
  idempotencyKey: string;
  productId: string;
  destinationIds: string[];
  confirm: string;
};

export type ManualPublicationPreviewInput = {
  idempotencyKey: string;
  productId: string;
  destinationIds: string[];
};

export type ManualPublicationGroupOption = {
  destinationId: string;
  displayName: string;
  fingerprint: string | null;
  campaignId: string | null;
  assignedInstanceName: string | null;
  eligible: boolean;
  blockers: string[];
  copyStatus: 'AVAILABLE' | 'READY' | 'BLOCKED' | 'UNKNOWN';
  draftPreview: ManualPublicationDraftPreview | null;
};

export type ManualPublicationDraftPreview = Pick<
  CommercialMessageDraft,
  'generatedCopyId' | 'imageUrl' | 'caption' | 'deliveryMode' | 'warnings'
> & {
  title: string;
  message: string;
  cta: string;
  hashtags: string;
};

export type ManualPublicationOptions = {
  product: {
    id: string;
    name: string;
    source: string | null;
    price: string;
    affiliateLinkPresent: boolean;
    available: boolean;
    snapshot: {
      id: string;
      revision: number;
      fingerprint: string;
      capturedAt: Date;
    } | null;
  };
  candidate: {
    available: boolean;
    copyReady: boolean;
  };
  groups: ManualPublicationGroupOption[];
};

export type ManualPublicationResult = {
  request: ManualPublicationRequestView;
  created: boolean;
};

export type ManualPublicationTargetView = ManualPublicationTargetRecord & {
  sentAt: Date | null;
};

export type ManualPublicationRequestView = Omit<
  ManualPublicationRequestRecord,
  'targets' | 'processingOwnerId' | 'processingLeaseExpiresAt'
> & {
  product: {
    id: string;
    name: string;
    source: string | null;
  };
  targets: ManualPublicationTargetView[];
};

type ManualPublicationServiceOptions = {
  requests: ManualPublicationRequestRepository;
  offers: Pick<ShopeeOfferRepository, 'findOfferById'>;
  catalog: Pick<CommercialPromotionCatalogRepository, 'findOfficialCatalogItem'> &
    Partial<Pick<CommercialPromotionCatalogRepository, 'listOfficialCatalogPage'>>;
  groups: Pick<WhatsAppGroupDirectoryRepository, 'findById'> &
    Partial<Pick<WhatsAppGroupDirectoryRepository, 'listAll'>>;
  campaigns: Pick<
    CommercialGroupCampaignRepository,
    'findByLogicalGroupFingerprint' | 'list'
  >;
  instances: Pick<WhatsAppInstanceRepository, 'findByName'>;
  candidates: Pick<
    CommercialPromotionCandidateRepository,
    'findByCampaignAndProduct' | 'listCampaignCandidates'
  >;
  copies: Pick<
    CommercialPromotionCopyRepository,
    'loadContext' | 'findCopyForCandidate'
  >;
  deliveryHistory: Pick<
    CommercialDeliveryHistoryRepository,
    'wasProductSentToGroup'
  >;
  policy: Pick<CommercialAutomationPolicyService, 'evaluateManualSendSafety'>;
  candidateFlow: Pick<
    CommercialAutomationCandidateFlowService,
    'prepareManual' | 'reserveAttempt' | 'releaseAttempt' | 'renewAttempt'
  >;
  confirmation: Pick<CommercialPipelineConfirmationService, 'confirm'>;
  runs: Pick<
    CommercialPipelineRunRepository,
    'findById' | 'findByExecutionId'
  >;
  outboxes: Pick<CommercialDispatchOutboxRepository, 'findById'>;
  dispatches: Pick<WhatsAppDispatchRepository, 'findByIdWithDetails'>;
  environment: CommercialConfirmationEnvironment;
  leaseSeconds?: number;
  clock?: () => Date;
  logger?: { info(data: unknown, message?: string): void; error(data: unknown, message?: string): void };
};

const fail = (message: string, code: string): never => {
  throw new AppError(message, code);
};

const normalizeId = (value: unknown, field: string) => {
  if (typeof value !== 'string') return fail(`${field} invalido`, 'MANUAL_PUBLICATION_INVALID');
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) {
    return fail(`${field} invalido`, 'MANUAL_PUBLICATION_INVALID');
  }
  return normalized;
};

export const canonicalManualPublicationPayload = (input: {
  mode?: ManualPublicationRequestMode;
  productId: string;
  destinationIds: string[];
}) =>
  JSON.stringify({
    version: MANUAL_PUBLICATION_CONTRACT_VERSION,
    mode: input.mode ?? 'SEND',
    productId: input.productId.trim(),
    destinationIds: [...new Set(input.destinationIds.map((id) => id.trim()))].sort(),
  });

const legacyCanonicalManualPublicationPayload = (input: {
  productId: string;
  destinationIds: string[];
}) =>
  JSON.stringify({
    version: MANUAL_PUBLICATION_CONTRACT_VERSION,
    productId: input.productId.trim(),
    destinationIds: [...new Set(input.destinationIds.map((id) => id.trim()))].sort(),
  });

export const manualPublicationPayloadHash = (payload: string) =>
  createHash('sha256').update(payload, 'utf8').digest('hex');

const uniqueDestinationIds = (value: unknown) => {
  if (!Array.isArray(value)) {
    return fail('destinationIds deve ser uma lista', 'MANUAL_PUBLICATION_INVALID');
  }
  const ids = value.map((item) => normalizeId(item, 'destinationId'));
  const unique = [...new Set(ids)].sort();
  if (
    unique.length < 1 ||
    unique.length > MANUAL_PUBLICATION_MAX_GROUPS ||
    unique.length !== ids.length
  ) {
    return fail(
      'Selecione entre 1 e 5 grupos unicos',
      'MANUAL_PUBLICATION_DESTINATION_LIMIT',
    );
  }
  return unique;
};

const assertStrictPreviewInput = (input: ManualPublicationPreviewInput) => {
  if (
    Object.keys(input).sort().join('|') !==
    'destinationIds|idempotencyKey|productId'
  ) {
    return fail(
      'Payload de preview manual invalido',
      'MANUAL_PUBLICATION_INVALID',
    );
  }
  return input;
};

const currentSnapshot = (item: CommercialPromotionCatalogItem | null) =>
  item?.currentSnapshot && item.product.source === 'OFFICIAL'
    ? {
        id: item.currentSnapshot.id,
        revision: item.currentSnapshot.revision,
        fingerprint: item.currentSnapshot.fingerprint,
        capturedAt: item.currentSnapshot.capturedAt,
      }
    : null;

const productIsAvailable = (item: CommercialPromotionCatalogItem | null, now: Date) =>
  Boolean(
    item &&
      item.product.source === 'OFFICIAL' &&
      item.currentSnapshot &&
      item.commercialSnapshotRevision === item.currentSnapshot.revision &&
      item.commercialSnapshotFingerprint === item.currentSnapshot.fingerprint &&
      commercialProductRejections(item.product, now).length === 0,
  );

const previewProductIsAvailable = (
  item: CommercialPromotionCatalogItem | null,
  now: Date,
) =>
  Boolean(
    item &&
      productIsAvailable(item, now) &&
      item.currentSnapshot &&
      !item.currentSnapshot.unavailableAt &&
      (!item.currentSnapshot.offerStartsAt ||
        item.currentSnapshot.offerStartsAt <= now) &&
      (!item.currentSnapshot.offerEndsAt || item.currentSnapshot.offerEndsAt > now) &&
      /^https?:\/\//iu.test(item.product.productLink),
  );

const requestMatchesOperation = (
  request: ManualPublicationRequestRecord,
  input: {
    mode: ManualPublicationRequestMode;
    productId: string;
    payloadHash: string;
    legacyPayloadHash?: string;
  },
) =>
  request.mode === input.mode &&
  request.productId === input.productId &&
  (request.payloadHash === input.payloadHash ||
    (input.mode === 'SEND' &&
      Boolean(input.legacyPayloadHash) &&
      request.payloadHash === input.legacyPayloadHash));

const targetFromRecord = (
  target: ManualPublicationTargetRecord,
): CommercialAutomationTarget => ({
  groupId: target.destinationId,
  groupName: target.destination?.name ?? target.destinationId,
  instanceName: target.assignedInstanceName,
  logicalGroupFingerprint: target.logicalGroupFingerprint,
  campaignId: target.campaignId,
  nicheId: target.campaign?.nicheId ?? '',
  dailyLimit: target.campaign?.dailyLimit ?? 1,
  cadenceMinutes: target.campaign?.cadenceMinutes,
  timezone: target.campaign?.timezone,
  allowedStartTime: target.campaign?.allowedStartTime,
  allowedEndTime: target.campaign?.allowedEndTime,
  failureCount: target.campaign?.failureCount,
  nextEligibleAt: target.campaign?.nextEligibleAt,
});

const knownBlocker = (error: unknown) =>
  error instanceof AppError &&
  (error.code.startsWith('MANUAL_PUBLICATION_') ||
    [
      'CAMPAIGN_INACTIVE',
      'NICHE_INACTIVE',
      'GROUP_UNAVAILABLE',
      'GROUP_SEND_DISABLED',
      'COMMERCIAL_SAFE_MODE_REQUIRED',
      'COMMERCIAL_AUTOMATION_TARGET_NOT_ELIGIBLE',
      'NO_AUTHORIZED_GROUP',
      'MULTIPLE_AUTHORIZED_GROUPS',
      'COMMERCIAL_AUTOMATION_ATTEMPT_RESERVATION_UNAVAILABLE',
      'COMMERCIAL_AUTOMATION_ATTEMPT_RENEWAL_CONFLICT',
      'COMMERCIAL_AUTOMATION_ATTEMPT_RELEASE_UNAVAILABLE',
      'COMMERCIAL_AUTOMATION_ATTEMPT_RENEWAL_UNAVAILABLE',
      'COMMERCIAL_AUTOMATION_CANDIDATE_CHANGED',
      'COMMERCIAL_AUTOMATION_CANDIDATE_INVALID',
      'COMMERCIAL_AUTOMATION_NO_ELIGIBLE_CANDIDATE',
      'COMMERCIAL_AUTOMATION_NO_ELIGIBLE_TARGET',
      'COMMERCIAL_AUTOMATION_TARGET_CHANGED',
      'COMMERCIAL_AUTOMATION_DUPLICATE_LOGICAL_GROUP',
      'COMMERCIAL_GROUP_CHANGED',
      'COMMERCIAL_GROUP_CAMPAIGN_CHANGED',
      'COMMERCIAL_GROUP_CAMPAIGN_FINGERPRINT_MISMATCH',
      'COMMERCIAL_GROUP_CAMPAIGN_NOT_FOUND',
      'COMMERCIAL_GROUP_CAMPAIGN_NICHE_INACTIVE',
      'COMMERCIAL_GROUP_CAMPAIGN_GROUP_UNAVAILABLE',
      'COMMERCIAL_IMAGE_REQUIRED',
      'COMMERCIAL_AI_COPY_CACHE_INCONSISTENT',
      'COMMERCIAL_AI_COPY_PREVIEW_INVALID',
      'COMMERCIAL_INSTANCE_ASSIGNMENT_CHANGED',
      'COMMERCIAL_INSTANCE_ASSIGNMENT_INVALID',
      'COMMERCIAL_INSTANCE_INACTIVE',
      'COMMERCIAL_PROMOTION_CONFIGURATION_CHANGED',
      'COMMERCIAL_PROMOTION_CATALOG_CHANGED',
      'COMMERCIAL_PROMOTION_SCORE_POLICY_INVALID',
      'COMMERCIAL_PIPELINE_RUN_RECOVERY_CONFLICT',
      'COMMERCIAL_PIPELINE_RUN_EXECUTION_CONFLICT',
      'COMMERCIAL_EXECUTION_IN_PROGRESS',
      'COMMERCIAL_AI_COPY_PROVIDER_DISABLED',
      'COMMERCIAL_AI_COPY_PROVIDER_NOT_CONFIGURED',
      'COMMERCIAL_AI_COPY_PREVIOUSLY_FAILED',
      'COMMERCIAL_AI_COPY_RESULT_AMBIGUOUS',
      'COMMERCIAL_AI_COPY_GENERATION_IN_PROGRESS',
      'COMMERCIAL_AI_COPY_PERSISTENCE_AMBIGUOUS',
      'COMMERCIAL_AI_COPY_OUTPUT_INVALID',
      'COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED',
      'COMMERCIAL_OUTBOX_AMBIGUOUS',
      'COMMERCIAL_OUTBOX_INCONSISTENT',
      'COMMERCIAL_OUTBOX_PUBLICATION_UNCERTAIN',
      'COMMERCIAL_OUTBOX_DISPATCH_UNSAFE',
      'COMMERCIAL_OUTBOX_NOT_FOUND',
      'COMMERCIAL_DISPATCH_FAILED',
      'COMMERCIAL_RUN_ALREADY_CONFIRMED',
      'COMMERCIAL_OUTBOX_CANDIDATE_COPY_INVALID',
      'PRODUCT_ALREADY_SENT',
      'SCORE_BELOW_MINIMUM',
      'NO_PROMOTION_SIGNAL',
      'MANUAL_PUBLICATION_SNAPSHOT_STALE',
      'MANUAL_PUBLICATION_SOURCE_UNSUPPORTED',
    ].includes(error.code));

const isAmbiguousBlocker = (error: unknown) =>
  error instanceof AppError &&
  [
    'COMMERCIAL_OUTBOX_AMBIGUOUS',
    'COMMERCIAL_OUTBOX_INCONSISTENT',
    'COMMERCIAL_OUTBOX_PUBLICATION_UNCERTAIN',
    'COMMERCIAL_OUTBOX_DISPATCH_UNSAFE',
    'COMMERCIAL_DISPATCH_FAILED',
    'COMMERCIAL_AI_COPY_RESULT_AMBIGUOUS',
    'COMMERCIAL_AI_COPY_PERSISTENCE_AMBIGUOUS',
  ].includes(error.code);

export class ManualPublicationService {
  private readonly clock: () => Date;

  constructor(private readonly options: ManualPublicationServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  private async catalogItem(productId: string) {
    if (this.options.catalog.findOfficialCatalogItem) {
      return this.options.catalog.findOfficialCatalogItem(productId);
    }
    if (!this.options.catalog.listOfficialCatalogPage) return null;
    let afterId: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await this.options.catalog.listOfficialCatalogPage({
        ...(afterId ? { afterId } : {}),
        limit: 200,
      });
      const found = result.items.find(({ product }) => product.id === productId);
      if (found) return found;
      if (!result.hasMore) return null;
      afterId = result.items.at(-1)?.product.id;
      if (!afterId) return null;
    }
    return null;
  }

  private async campaignForGroup(group: WhatsAppGroupRecord) {
    if (this.options.campaigns.findByLogicalGroupFingerprint) {
      return this.options.campaigns.findByLogicalGroupFingerprint(group.fingerprint);
    }
    const matches = (
      await this.options.campaigns.list({ page: 1, limit: 100 })
    ).items.filter(
      (campaign) => campaign.logicalGroupFingerprint === group.fingerprint,
    );
    return matches.length === 1 ? matches[0] : null;
  }

  private async existingDraftPreview(
    candidateId: string,
  ): Promise<ManualPublicationDraftPreview | null> {
    const [context, found] = await Promise.all([
      this.options.copies.loadContext(candidateId),
      this.options.copies.findCopyForCandidate(candidateId),
    ]);
    if (
      !context ||
      !found ||
      found.candidate.id !== context.candidate.id ||
      found.candidate.status !== 'COPY_READY' ||
      found.candidate.generatedCopyId !== found.copy.id ||
      found.copy.source !== 'AI' ||
      found.candidate.snapshotId !== context.snapshot.id ||
      found.copy.productId !== context.product.id ||
      found.copy.snapshotId !== context.snapshot.id ||
      found.copy.createdFromCandidateId !== candidateId
    ) {
      return null;
    }
    try {
      const draft = new CommercialMessageDraftService().createDraft(
        {
          id: context.candidate.id,
          productId: context.product.id,
          snapshotId: context.snapshot.id,
          generatedCopyId: found.copy.id,
          status: context.candidate.status,
          expiresAt: context.candidate.expiresAt,
          product: {
            id: context.product.id,
            unavailableAt: context.product.unavailableAt,
            affiliateLink: context.product.affiliateLink,
            urlImagem: context.product.urlImagem ?? '',
            commercialSnapshotRevision:
              context.product.commercialSnapshotRevision,
          },
          snapshot: {
            id: context.snapshot.id,
            productId: context.snapshot.productId,
            revision: context.snapshot.revision,
            unavailableAt: context.snapshot.unavailableAt,
            offerEndsAt: context.snapshot.offerEndsAt,
          },
          generatedCopy: {
            id: found.copy.id,
            productId: found.copy.productId,
            snapshotId: found.copy.snapshotId ?? null,
            createdFromCandidateId: found.copy.createdFromCandidateId ?? null,
            titulo: found.copy.titulo,
            mensagem: found.copy.mensagem,
            cta: found.copy.cta,
            hashtags: found.copy.hashtags,
          },
        },
        { now: this.clock },
      );
      return {
        generatedCopyId: draft.generatedCopyId,
        imageUrl: draft.imageUrl,
        caption: draft.caption,
        deliveryMode: draft.deliveryMode,
        warnings: draft.warnings,
        title: found.copy.titulo,
        message: found.copy.mensagem,
        cta: found.copy.cta,
        hashtags: found.copy.hashtags,
      };
    } catch {
      return null;
    }
  }

  private async groupsByIds(destinationIds: string[]) {
    if (this.options.groups.listAll) {
      const groups = await this.options.groups.listAll();
      return destinationIds.map(
        (id) => groups.find((group) => group.id === id) ?? null,
      );
    }
    return Promise.all(destinationIds.map((id) => this.options.groups.findById(id)));
  }

  private async optionForGroup(
    productId: string,
    group: WhatsAppGroupRecord | null,
    productItem: CommercialPromotionCatalogItem | null,
    now: Date,
  ): Promise<ManualPublicationGroupOption> {
    if (!group) {
      return {
        destinationId: '',
        displayName: 'Destino nao encontrado',
        fingerprint: null,
        campaignId: null,
        assignedInstanceName: null,
        eligible: false,
        blockers: ['MANUAL_PUBLICATION_DESTINATION_NOT_FOUND'],
        copyStatus: 'UNKNOWN',
        draftPreview: null,
      };
    }
    const blockers: string[] = [];
    if (group.type !== 'GROUP') blockers.push('MANUAL_PUBLICATION_GROUP_REQUIRED');
    if (!group.active) blockers.push('DESTINATION_INACTIVE');
    if (!group.available) blockers.push('DESTINATION_UNAVAILABLE');
    if (!group.fingerprint) blockers.push('MANUAL_PUBLICATION_GROUP_FINGERPRINT_INVALID');
    if (!group.assignedInstanceName) blockers.push('MANUAL_PUBLICATION_INSTANCE_ASSIGNMENT_REQUIRED');
    const campaign = group.fingerprint
      ? await this.campaignForGroup(group)
      : null;
    if (!campaign) blockers.push('COMMERCIAL_GROUP_CAMPAIGN_NOT_FOUND');
    if (campaign && !campaign.active) blockers.push('CAMPAIGN_INACTIVE');
    if (campaign && !campaign.niche.active) blockers.push('NICHE_INACTIVE');
    if (group.assignedInstanceName) {
      const instance = await this.options.instances.findByName(group.assignedInstanceName);
      if (!instance?.active) blockers.push('COMMERCIAL_INSTANCE_INACTIVE');
    }
    if (!productItem || productItem.product.source !== 'OFFICIAL') {
      blockers.push('MANUAL_PUBLICATION_SOURCE_UNSUPPORTED');
    } else if (!productIsAvailable(productItem, now)) {
      blockers.push('MANUAL_PUBLICATION_PRODUCT_INELIGIBLE');
    }
    if (campaign) {
      const candidate = this.options.candidates.findByCampaignAndProduct
        ? await this.options.candidates.findByCampaignAndProduct(campaign.id, productId)
        : (
            await this.options.candidates.listCampaignCandidates(campaign.id)
          ).find((item) => item.productId === productId) ?? null;
      const copyReady = Boolean(
        candidate?.status === 'COPY_READY' && candidate.generatedCopyId,
      );
      const draftPreview = candidate && copyReady
        ? await this.existingDraftPreview(candidate.id)
        : null;
      if (copyReady && !draftPreview) {
        blockers.push('COMMERCIAL_AI_COPY_CACHE_INCONSISTENT');
      }
      return {
        destinationId: group.id,
        displayName: group.name,
        fingerprint: group.fingerprint,
        campaignId: campaign.id,
        assignedInstanceName: group.assignedInstanceName ?? null,
        eligible: blockers.length === 0,
        blockers,
        copyStatus: copyReady && draftPreview
          ? 'READY'
          : copyReady
            ? 'BLOCKED'
          : candidate
            ? 'AVAILABLE'
            : 'UNKNOWN',
        draftPreview,
      };
    }
    return {
      destinationId: group.id,
      displayName: group.name,
      fingerprint: group.fingerprint ?? null,
      campaignId: null,
      assignedInstanceName: group.assignedInstanceName ?? null,
      eligible: false,
      blockers,
      copyStatus: 'UNKNOWN',
      draftPreview: null,
    };
  }

  async getOptions(productId: string): Promise<ManualPublicationOptions> {
    const normalizedProductId = normalizeId(productId, 'productId');
    const [product, item] = await Promise.all([
      this.options.offers.findOfferById(normalizedProductId),
      this.catalogItem(normalizedProductId),
    ]);
    if (!product) return fail('Oferta nao encontrada', 'OFFER_NOT_FOUND');
    const now = this.clock();
    const groups = this.options.groups.listAll
      ? await this.options.groups.listAll()
      : [];
    const groupOptions = await Promise.all(
      groups.map((group) =>
        this.optionForGroup(normalizedProductId, group, item, now),
      ),
    );
    const candidate = groupOptions.find((option) => option.eligible);
    const candidateRecord = candidate?.campaignId && this.options.candidates.findByCampaignAndProduct
      ? await this.options.candidates.findByCampaignAndProduct(
          candidate.campaignId,
          normalizedProductId,
        )
      : null;
    return {
      product: {
        id: product.id,
        name: product.productName,
        source: product.source ?? null,
        price: product.price,
        affiliateLinkPresent: Boolean(product.affiliateLink),
        available: productIsAvailable(item, now),
        snapshot: currentSnapshot(item),
      },
      candidate: {
        available: Boolean(candidateRecord || candidate),
        copyReady: Boolean(candidateRecord?.status === 'COPY_READY'),
      },
      groups: groupOptions,
    };
  }

  private async buildAcceptance(
    input: ManualPublicationInput | ManualPublicationPreviewInput,
    requestId: string,
    mode: ManualPublicationRequestMode,
  ): Promise<ManualPublicationRequestCreateData> {
    const productId = normalizeId(input.productId, 'productId');
    const destinationIds = uniqueDestinationIds(input.destinationIds);
    const [product, item, groups] = await Promise.all([
      this.options.offers.findOfferById(productId),
      this.catalogItem(productId),
      this.groupsByIds(destinationIds),
    ]);
    if (!product) return fail('Oferta nao encontrada', 'OFFER_NOT_FOUND');
    if (product.source !== 'OFFICIAL') {
      return fail(
        'A publicacao manual suporta somente ofertas OFFICIAL',
        'MANUAL_PUBLICATION_SOURCE_UNSUPPORTED',
      );
    }
    if (
      !item ||
      !(mode === 'PREVIEW'
        ? previewProductIsAvailable(item, this.clock())
        : productIsAvailable(item, this.clock()))
    ) {
      return fail(
        'Produto ou snapshot oficial inelegivel',
        'MANUAL_PUBLICATION_PRODUCT_INELIGIBLE',
      );
    }
    const snapshot = currentSnapshot(item);
    if (!snapshot) return fail('Snapshot oficial ausente', 'MANUAL_PUBLICATION_SNAPSHOT_STALE');
    const targets: ManualPublicationRequestCreateData['targets'] = [];
    const fingerprints = new Set<string>();
    for (const [index, group] of groups.entries()) {
      if (!group || group.type !== 'GROUP' || !group.fingerprint || !group.assignedInstanceName) {
        return fail(
          'Destino manual nao e um grupo atribuivel',
          'MANUAL_PUBLICATION_TARGET_INVALID',
        );
      }
      if (fingerprints.has(group.fingerprint)) {
        return fail(
          'A request nao pode repetir o mesmo grupo logico',
          'MANUAL_PUBLICATION_DUPLICATE_GROUP',
        );
      }
      fingerprints.add(group.fingerprint);
      const campaign = await this.campaignForGroup(group);
      if (!campaign) {
        return fail(
          'Grupo manual sem campanha comercial',
          'COMMERCIAL_GROUP_CAMPAIGN_NOT_FOUND',
        );
      }
      if (mode === 'PREVIEW') {
        if (!group.active || !group.available) {
          return fail(
            'Grupo manual inativo ou indisponivel',
            'MANUAL_PUBLICATION_TARGET_INVALID',
          );
        }
        if (!campaign.active) {
          return fail(
            'Campanha comercial inativa',
            'CAMPAIGN_INACTIVE',
          );
        }
        if (!campaign.niche.active) {
          return fail('Nicho comercial inativo', 'NICHE_INACTIVE');
        }
        const instance = await this.options.instances.findByName(
          group.assignedInstanceName,
        );
        if (!instance?.active) {
          return fail(
            'Instancia comercial inativa ou ausente',
            'COMMERCIAL_INSTANCE_INACTIVE',
          );
        }
      }
      targets.push({
        id: `${requestId}-target-${String(index + 1).padStart(2, '0')}`,
        requestId,
        destinationId: group.id,
        campaignId: campaign.id,
        logicalGroupFingerprint: group.fingerprint,
        assignedInstanceName: group.assignedInstanceName,
      });
    }
    const canonicalPayload = canonicalManualPublicationPayload({
      mode,
      productId,
      destinationIds,
    });
    const legacyPayload = legacyCanonicalManualPublicationPayload({
      productId,
      destinationIds,
    });
    return {
      id: requestId,
      idempotencyKey: normalizeId(input.idempotencyKey, 'idempotencyKey'),
      payloadHash: manualPublicationPayloadHash(canonicalPayload),
      mode,
      ...(mode === 'SEND'
        ? { legacyPayloadHash: manualPublicationPayloadHash(legacyPayload) }
        : {}),
      productId,
      requestedSnapshotId: snapshot.id,
      requestedSnapshotRevision: snapshot.revision,
      requestedSnapshotFingerprint: snapshot.fingerprint,
      status: mode === 'PREVIEW' ? 'PREVIEW_READY' : 'ACCEPTED',
      createdAt: this.clock(),
      targets,
    };
  }

  private async assertRequestSnapshot(request: ManualPublicationRequestRecord) {
    const item = await this.catalogItem(request.productId);
    if (
      !item ||
      item.product.source !== 'OFFICIAL' ||
      item.currentSnapshot?.id !== request.requestedSnapshotId ||
      item.commercialSnapshotRevision !== request.requestedSnapshotRevision ||
      item.commercialSnapshotFingerprint !== request.requestedSnapshotFingerprint
    ) {
      throw new AppError(
        'Snapshot oficial mudou desde a aceitacao manual',
        'MANUAL_PUBLICATION_SNAPSHOT_STALE',
      );
    }
    return item;
  }

  private async updateTargetState(
    target: ManualPublicationTargetRecord,
  ): Promise<ManualPublicationTargetRecord> {
    let nextStatus = target.status;
    let investigationRequired = target.investigationRequired;
    const run = target.runId ? await this.options.runs.findById(target.runId) : null;
    const dispatch = target.dispatchId
      ? await this.options.dispatches.findByIdWithDetails(target.dispatchId)
      : null;
    const outbox = target.outboxId ? await this.options.outboxes.findById(target.outboxId) : null;
    if (dispatch?.status === 'SENT' || run?.finalStatus === 'SENT') {
      nextStatus = 'SENT';
      investigationRequired = false;
    } else if (
      outbox?.status === 'AMBIGUOUS' ||
      run?.finalStatus === 'AMBIGUOUS' ||
      run?.investigationRequired
    ) {
      nextStatus = 'AMBIGUOUS';
      investigationRequired = true;
    } else if (dispatch?.status === 'FAILED' || run?.finalStatus === 'FAILED') {
      nextStatus = 'FAILED';
      investigationRequired = false;
    } else if (outbox || dispatch) {
      nextStatus = 'QUEUED';
    } else if (run) {
      nextStatus = 'PROCESSING';
    }
    if (
      nextStatus !== target.status ||
      investigationRequired !== target.investigationRequired
    ) {
      return (
        (await this.options.requests.updateTarget(target.id, {
          status: nextStatus,
          investigationRequired,
        })) ?? target
      );
    }
    return target;
  }

  private async candidateForTarget(
    request: ManualPublicationRequestRecord,
    target: ManualPublicationTargetRecord,
  ) {
    if (target.candidate) return target.candidate;
    if (!this.options.candidates.findByCampaignAndProduct) return null;
    return this.options.candidates.findByCampaignAndProduct(
      target.campaignId,
      request.productId,
    );
  }

  private assertRunMatchesTarget(
    run: Awaited<ReturnType<NonNullable<ManualPublicationServiceOptions['runs']['findById']>>>,
    request: ManualPublicationRequestRecord,
    target: ManualPublicationTargetRecord,
    executionId: string,
  ) {
    if (
      !run ||
      run.executionId !== executionId ||
      (run.productId !== null && run.productId !== request.productId) ||
      (run.groupDestinationId !== null &&
        run.groupDestinationId !== target.destinationId) ||
      (run.groupFingerprint !== null &&
        run.groupFingerprint !== target.logicalGroupFingerprint) ||
      (run.instanceName !== null &&
        run.instanceName !== target.assignedInstanceName)
    ) {
      throw new AppError(
        'Run comercial nao corresponde ao target manual',
        'MANUAL_PUBLICATION_EXECUTION_CONFLICT',
      );
    }
  }

  private async reconcileOutboxForRun(
    target: ManualPublicationTargetRecord,
    run: NonNullable<Awaited<ReturnType<CommercialPipelineRunRepository['findById']>>>,
    candidateId?: string,
  ) {
    const { dispatchId, outboxId } = commercialConfirmationIds(run.id);
    const outbox = await this.options.outboxes.findById(outboxId);
    const hasConfirmationEvidence = Boolean(
      outbox ||
        run.mode === 'CONFIRMED' ||
        run.confirmedAt ||
        run.dispatchId ||
        run.jobId ||
        run.finalStatus,
    );
    if (!hasConfirmationEvidence) return null;
    if (
      !outbox ||
      outbox.commercialRunId !== run.id ||
      outbox.dispatchId !== dispatchId
    ) {
      throw new AppError(
        'A confirmacao manual possui evidencia incompleta',
        'COMMERCIAL_OUTBOX_INCONSISTENT',
      );
    }
    const updated =
      (await this.options.requests.updateTarget(target.id, {
        ...(candidateId ? { candidateId } : {}),
        runId: run.id,
        dispatchId,
        outboxId,
        status: outbox.status === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'QUEUED',
        blockedReason: outbox.status === 'AMBIGUOUS' ? outbox.failureCode : null,
        investigationRequired: outbox.status === 'AMBIGUOUS',
      })) ?? target;
    return this.updateTargetState(updated);
  }

  private async confirmPreparedTarget(
    target: ManualPublicationTargetRecord,
    runId: string,
    generatedCopyId: string,
  ) {
    const run = await this.options.runs.findById(runId);
    const reconciled = run
      ? await this.reconcileOutboxForRun(target, run, target.candidateId ?? undefined)
      : null;
    if (reconciled) return reconciled;
    if (
      run &&
      (run.mode !== 'DRY_RUN' ||
        run.status !== 'COMPLETED' ||
        run.confirmedAt ||
        run.dispatchId ||
        run.jobId)
    ) {
      throw new AppError(
        'Run comercial nao esta pronto para confirmacao manual',
        'COMMERCIAL_OUTBOX_INCONSISTENT',
      );
    }
    try {
      await this.options.confirmation.confirm(
        runId,
        COMMERCIAL_CONFIRMATION_TOKEN,
        { existingGeneratedCopyId: generatedCopyId, manual: true },
      );
    } catch (error) {
      if (
        error instanceof AppError &&
        error.code === 'COMMERCIAL_RUN_ALREADY_CONFIRMED'
      ) {
        const afterRace = await this.options.runs.findById(runId);
        if (afterRace) {
          const recovered = await this.reconcileOutboxForRun(
            target,
            afterRace,
            target.candidateId ?? undefined,
          );
          if (recovered) return recovered;
        }
        throw new AppError(
          'Confirmacao manual possui resultado ambiguo',
          'COMMERCIAL_OUTBOX_INCONSISTENT',
        );
      }
      throw error;
    }
    const { dispatchId, outboxId } = commercialConfirmationIds(runId);
    const outbox = await this.options.outboxes.findById(outboxId);
    if (
      !outbox ||
      outbox.commercialRunId !== runId ||
      outbox.dispatchId !== dispatchId
    ) {
      return (
        (await this.options.requests.updateTarget(target.id, {
          status: 'AMBIGUOUS',
          blockedReason: 'MANUAL_PUBLICATION_OUTBOX_EVIDENCE_MISSING',
          investigationRequired: true,
        })) ?? target
      );
    }
    return (
      (await this.options.requests.updateTarget(target.id, {
        dispatchId,
        outboxId,
        status: 'QUEUED',
        blockedReason: null,
      })) ?? target
    );
  }

  private async recoverExistingExecution(
    request: ManualPublicationRequestRecord,
    target: ManualPublicationTargetRecord,
    executionId: string,
  ) {
    const run = await this.options.runs.findByExecutionId(executionId);
    if (!run) return null;
    this.assertRunMatchesTarget(run, request, target, executionId);
    const candidate = await this.candidateForTarget(request, target);
    const reconciled = await this.reconcileOutboxForRun(
      target,
      run,
      candidate?.id,
    );
    if (reconciled) return reconciled;
    if (
      run.mode === 'DRY_RUN' &&
      run.status === 'COMPLETED' &&
      candidate?.status === 'COPY_READY' &&
      candidate.generatedCopyId
    ) {
      const preparedTarget =
        (await this.options.requests.updateTarget(target.id, {
          candidateId: candidate.id,
          runId: run.id,
          status: 'PROCESSING',
        })) ?? target;
      const renewedAt = this.clock();
      const renewal = await this.options.candidateFlow.renewAttempt({
        campaignId: target.campaignId,
        executionId,
        renewedAt,
        leaseExpiresAt: new Date(
          renewedAt.getTime() + (this.options.leaseSeconds ?? 120) * 1_000,
        ),
      });
      if (renewal.kind === 'CONFLICT') {
        throw new AppError(
          'A reserva manual mudou durante a recuperacao',
          'COMMERCIAL_AUTOMATION_ATTEMPT_RENEWAL_CONFLICT',
        );
      }
      return this.confirmPreparedTarget(
        preparedTarget,
        run.id,
        candidate.generatedCopyId,
      );
    }
    if (
      run.mode === 'DRY_RUN' &&
      ['STARTED', 'FAILED'].includes(run.status) &&
      !run.confirmedAt &&
      !run.dispatchId &&
      !run.jobId &&
      !run.finalStatus &&
      !run.investigationRequired
    ) {
      if (!candidate) {
        throw new AppError(
          'Candidato ausente durante a recuperacao manual',
          'COMMERCIAL_AUTOMATION_CANDIDATE_CHANGED',
        );
      }
      const prepared = await this.options.candidateFlow.prepareManual(
        request.productId,
        targetFromRecord(target),
        { executionId, existingRunId: run.id },
      );
      const preparedTarget =
        (await this.options.requests.updateTarget(target.id, {
          candidateId: prepared.candidateId,
          runId: prepared.runId,
          status: 'PROCESSING',
        })) ?? target;
      const renewedAt = this.clock();
      const renewal = await this.options.candidateFlow.renewAttempt({
        campaignId: prepared.campaignId,
        executionId,
        renewedAt,
        leaseExpiresAt: new Date(
          renewedAt.getTime() + (this.options.leaseSeconds ?? 120) * 1_000,
        ),
      });
      if (renewal.kind === 'CONFLICT') {
        throw new AppError(
          'A reserva manual mudou durante a recuperacao',
          'COMMERCIAL_AUTOMATION_ATTEMPT_RENEWAL_CONFLICT',
        );
      }
      return this.confirmPreparedTarget(
        preparedTarget,
        prepared.runId,
        prepared.generatedCopyId,
      );
    }
    throw new AppError(
      'A execucao manual existente nao pode ser reconciliada',
      'COMMERCIAL_OUTBOX_INCONSISTENT',
    );
  }

  private async reconcileExistingExecutionOutbox(
    request: ManualPublicationRequestRecord,
    target: ManualPublicationTargetRecord,
    executionId: string,
  ) {
    const run = await this.options.runs.findByExecutionId(executionId);
    if (!run) return null;
    this.assertRunMatchesTarget(run, request, target, executionId);
    return this.reconcileOutboxForRun(
      target,
      run,
      target.candidate?.id,
    );
  }

  private async aggregate(request: ManualPublicationRequestRecord) {
    if (request.mode === 'PREVIEW') return request;
    const refreshedTargets = [] as ManualPublicationTargetRecord[];
    for (const target of request.targets) {
      refreshedTargets.push(await this.updateTargetState(target));
    }
    const statuses = refreshedTargets.map(({ status }) => status);
    const hasAmbiguous = statuses.includes('AMBIGUOUS');
    const hasActive = statuses.some((status) =>
      ['ACCEPTED', 'PROCESSING', 'QUEUED'].includes(status),
    );
    const sentCount = statuses.filter((status) => status === 'SENT').length;
    const terminalCount = statuses.filter((status) =>
      ['SENT', 'BLOCKED', 'FAILED'].includes(status),
    ).length;
    const status = hasAmbiguous
      ? ('AMBIGUOUS' as const)
      : hasActive
        ? ('PROCESSING' as const)
        : sentCount === statuses.length
          ? ('COMPLETED' as const)
          : sentCount > 0
            ? ('PARTIAL' as const)
            : terminalCount === statuses.length &&
                statuses.every((value) => value === 'BLOCKED')
              ? ('BLOCKED' as const)
              : ('FAILED' as const);
    const completedAt = ['COMPLETED', 'PARTIAL', 'BLOCKED', 'FAILED', 'AMBIGUOUS'].includes(
      status,
    )
      ? this.clock()
      : null;
    const terminal = ['COMPLETED', 'PARTIAL', 'BLOCKED', 'FAILED', 'AMBIGUOUS'].includes(
      status,
    );
    const updated = await this.options.requests.updateRequest(request.id, {
      status,
      completedAt,
      ...(terminal
        ? {
            processingOwnerId: null,
            processingLeaseExpiresAt: null,
          }
        : {}),
    });
    return (
      updated ?? {
        ...request,
        status,
        completedAt,
        targets: refreshedTargets,
      }
    );
  }

  private async processTarget(
    request: ManualPublicationRequestRecord,
    target: ManualPublicationTargetRecord,
    options: { deferIfActive?: boolean } = {},
  ) {
    if (['SENT', 'BLOCKED', 'FAILED', 'AMBIGUOUS'].includes(target.status)) return target;
    try {
      const executionId = `manual-publication:${request.id}:${target.id}`;
      const outboxRecovery = await this.reconcileExistingExecutionOutbox(
        request,
        target,
        executionId,
      );
      if (outboxRecovery) return outboxRecovery;
      if (
        target.runId &&
        !target.dispatchId &&
        !target.outboxId &&
        target.candidate?.generatedCopyId
      ) {
        const renewedAt = this.clock();
        const renewal = await this.options.candidateFlow.renewAttempt({
          campaignId: target.campaignId,
          executionId,
          renewedAt,
          leaseExpiresAt: new Date(
            renewedAt.getTime() + (this.options.leaseSeconds ?? 120) * 1_000,
          ),
        });
        if (renewal.kind === 'CONFLICT') {
          return (
            (await this.options.requests.updateTarget(target.id, {
              status: 'BLOCKED',
              blockedReason: 'COMMERCIAL_AUTOMATION_ATTEMPT_RENEWAL_CONFLICT',
            })) ?? target
          );
        }
        return this.confirmPreparedTarget(
          target,
          target.runId,
          target.candidate.generatedCopyId,
        );
      }
      if (target.runId || target.dispatchId || target.outboxId) {
        return this.updateTargetState(target);
      }
      await this.assertRequestSnapshot(request);
      const automationTarget = targetFromRecord(target);
      const safety = await this.options.policy.evaluateManualSendSafety(
        automationTarget,
      );
      if (
        options.deferIfActive &&
        safety.reasons.length === 1 &&
        safety.reasons[0] === 'COMMERCIAL_EXECUTION_IN_PROGRESS'
      ) {
        return target;
      }
      if (!safety.allowed) {
        return (
          (await this.options.requests.updateTarget(target.id, {
            status: 'BLOCKED',
            blockedReason: safety.reasons[0] ?? 'MANUAL_PUBLICATION_POLICY_BLOCKED',
          })) ?? target
        );
      }
      if (!this.options.environment.groupSendEnabled) {
        return (
          (await this.options.requests.updateTarget(target.id, {
            status: 'BLOCKED',
            blockedReason: 'GROUP_SEND_DISABLED',
          })) ?? target
        );
      }
      if (!this.options.environment.safeMode) {
        return (
          (await this.options.requests.updateTarget(target.id, {
            status: 'BLOCKED',
            blockedReason: 'COMMERCIAL_SAFE_MODE_REQUIRED',
          })) ?? target
        );
      }
      if (options.deferIfActive) return target;
      const now = this.clock();
      const quotaWindow = getLocalDayRange(now, safety.timezone);
      const quotaReservation = await this.options.requests.reserveSendSlot({
        targetId: target.id,
        now,
        ...quotaWindow,
        globalDailyLimit: safety.dailyGlobalLimit,
        groupDailyLimit: Math.min(
          safety.dailyGroupLimit,
          automationTarget.dailyLimit,
        ),
      });
      if (quotaReservation.kind === 'BLOCKED') {
        return (
          (await this.options.requests.updateTarget(target.id, {
            status: 'BLOCKED',
            blockedReason: quotaReservation.reason,
          })) ?? target
        );
      }
      const reservation = await this.options.candidateFlow.reserveAttempt(
        automationTarget,
        {
          executionId,
          reservedAt: now,
          leaseExpiresAt: new Date(
            now.getTime() + (this.options.leaseSeconds ?? 120) * 1_000,
          ),
        },
      );
      if (reservation.kind === 'CONFLICT') {
        await this.options.requests.releaseSendSlot(target.id);
        return (
          (await this.options.requests.updateTarget(target.id, {
            status: 'BLOCKED',
            blockedReason: 'MANUAL_PUBLICATION_TARGET_CONFLICT',
          })) ?? target
        );
      }
      if (reservation.kind === 'INELIGIBLE') {
        await this.options.requests.releaseSendSlot(target.id);
        return (
          (await this.options.requests.updateTarget(target.id, {
            status: 'BLOCKED',
            blockedReason: 'MANUAL_PUBLICATION_TARGET_NOT_ELIGIBLE',
          })) ?? target
        );
      }
      const recovered = await this.recoverExistingExecution(
        request,
        target,
        executionId,
      );
      if (recovered) return recovered;
      let prepared;
      try {
        prepared = await this.options.candidateFlow.prepareManual(
          request.productId,
          automationTarget,
          { executionId },
        );
      } catch (error) {
        const release = await this.options.candidateFlow.releaseAttempt({
          campaignId: reservation.campaignId,
          executionId,
        });
        if (release.kind !== 'RELEASED' || !release.released) {
          return (
            (await this.options.requests.updateTarget(target.id, {
              status: 'AMBIGUOUS',
              blockedReason: 'MANUAL_PUBLICATION_RESERVATION_RELEASE_AMBIGUOUS',
              investigationRequired: true,
            })) ?? target
          );
        }
        await this.options.requests.releaseSendSlot(target.id);
        if (knownBlocker(error)) {
          return (
            (await this.options.requests.updateTarget(target.id, {
              status: 'BLOCKED',
              blockedReason: error instanceof AppError ? error.code : 'MANUAL_PUBLICATION_BLOCKED',
            })) ?? target
          );
        }
        throw error;
      }
      const preparedTarget =
        (await this.options.requests.updateTarget(target.id, {
          candidateId: prepared.candidateId,
          runId: prepared.runId,
          status: 'PROCESSING',
        })) ?? target;
      const renewedAt = this.clock();
      const renewal = await this.options.candidateFlow.renewAttempt({
        campaignId: prepared.campaignId,
        executionId,
        renewedAt,
        leaseExpiresAt: new Date(
          renewedAt.getTime() + (this.options.leaseSeconds ?? 120) * 1_000,
        ),
      });
      if (renewal.kind === 'CONFLICT') {
        return (
          (await this.options.requests.updateTarget(preparedTarget.id, {
            status: 'BLOCKED',
            blockedReason: 'COMMERCIAL_AUTOMATION_ATTEMPT_RENEWAL_CONFLICT',
          })) ?? preparedTarget
        );
      }
      return this.confirmPreparedTarget(
        preparedTarget,
        prepared.runId,
        prepared.generatedCopyId,
      );
    } catch (error) {
      if (knownBlocker(error)) {
        return (
          (await this.options.requests.updateTarget(target.id, {
            status: isAmbiguousBlocker(error) ? 'AMBIGUOUS' : 'BLOCKED',
            blockedReason: error instanceof AppError ? error.code : 'MANUAL_PUBLICATION_BLOCKED',
            investigationRequired: isAmbiguousBlocker(error),
          })) ?? target
        );
      }
      this.options.logger?.error(
        { event: 'manual-publication.target.failed', targetId: target.id },
        'Manual publication target failed',
      );
      return (
        (await this.options.requests.updateTarget(target.id, {
          status: 'AMBIGUOUS',
          blockedReason: 'MANUAL_PUBLICATION_UNEXPECTED_FAILURE',
          investigationRequired: true,
        })) ?? target
      );
    }
  }

  private async process(
    request: ManualPublicationRequestRecord,
    ownerId: string,
  ) {
    if (request.mode === 'PREVIEW') return request;
    const now = this.clock();
    const leaseExpiresAt = new Date(
      now.getTime() + MANUAL_PUBLICATION_PROCESSING_LEASE_SECONDS * 1_000,
    );
    const claimed = await this.options.requests.claimProcessing(
      request.id,
      ownerId,
      now,
      leaseExpiresAt,
    );
    if (!claimed) {
      return (await this.options.requests.findById(request.id)) ?? request;
    }
    let current = claimed;
    const orderedTargets = [...claimed.targets].sort(
      (left, right) =>
        left.logicalGroupFingerprint.localeCompare(right.logicalGroupFingerprint) ||
        left.destinationId.localeCompare(right.destinationId),
    );
    for (const [index, target] of orderedTargets.entries()) {
      const renewed = await this.options.requests.renewProcessing(
        current.id,
        ownerId,
        new Date(
          this.clock().getTime() + MANUAL_PUBLICATION_PROCESSING_LEASE_SECONDS * 1_000,
        ),
      );
      if (!renewed) {
        return (await this.options.requests.findById(request.id)) ?? current;
      }
      if (current.targets.some((item) => item.status === 'AMBIGUOUS')) {
        for (const remaining of orderedTargets.slice(index)) {
          if (['ACCEPTED', 'PROCESSING'].includes(remaining.status)) {
            await this.options.requests.updateTarget(remaining.id, {
              status: 'BLOCKED',
              blockedReason: 'MANUAL_PUBLICATION_BLOCKED_BY_AMBIGUITY',
              investigationRequired: true,
            });
          }
        }
        break;
      }
      const siblingExecutionActive = current.targets.some(
        (sibling) =>
          sibling.id !== target.id &&
          ['PROCESSING', 'QUEUED'].includes(sibling.status),
      );
      if (siblingExecutionActive) {
        await this.processTarget(current, target, { deferIfActive: true });
        current = (await this.options.requests.findById(request.id)) ?? current;
        const refreshed = current.targets.find((item) => item.id === target.id);
        if (
          refreshed &&
          ['ACCEPTED', 'PROCESSING', 'QUEUED'].includes(refreshed.status)
        ) {
          break;
        }
        continue;
      }
      await this.processTarget(current, target);
      current = (await this.options.requests.findById(request.id)) ?? current;
    }
    current = (await this.options.requests.findById(request.id)) ?? current;
    return this.aggregate(current);
  }

  private async view(
    request: ManualPublicationRequestRecord,
  ): Promise<ManualPublicationRequestView> {
    const product = await this.options.offers.findOfferById(request.productId);
    const publicRequest = {
      id: request.id,
      idempotencyKey: request.idempotencyKey,
      payloadHash: request.payloadHash,
      mode: request.mode,
      productId: request.productId,
      requestedSnapshotId: request.requestedSnapshotId,
      requestedSnapshotRevision: request.requestedSnapshotRevision,
      requestedSnapshotFingerprint: request.requestedSnapshotFingerprint,
      status: request.status,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      completedAt: request.completedAt,
    };
    return {
      ...publicRequest,
      product: {
        id: request.productId,
        name: product?.productName ?? request.productId,
        source: product?.source ?? null,
      },
      targets: request.targets.map((target) => ({
        ...target,
        sentAt: target.dispatch?.sentAt ?? null,
      })),
    };
  }

  async create(input: ManualPublicationInput): Promise<ManualPublicationResult> {
    if (input.confirm !== MANUAL_PUBLICATION_CONFIRMATION) {
      return fail(
        'Confirmacao de publicacao manual invalida',
        'MANUAL_PUBLICATION_CONFIRMATION_INVALID',
      );
    }
    const normalizedProductId = normalizeId(input.productId, 'productId');
    const normalizedDestinationIds = uniqueDestinationIds(input.destinationIds);
    const normalizedKey = normalizeId(input.idempotencyKey, 'idempotencyKey');
    const expectedHash = manualPublicationPayloadHash(
      canonicalManualPublicationPayload({
        mode: 'SEND',
        productId: normalizedProductId,
        destinationIds: normalizedDestinationIds,
      }),
    );
    const legacyHash = manualPublicationPayloadHash(
      legacyCanonicalManualPublicationPayload({
        productId: normalizedProductId,
        destinationIds: normalizedDestinationIds,
      }),
    );
    const existing = await this.options.requests.findByIdempotencyKey(
      normalizedKey,
    );
    if (existing) {
      if (
        !requestMatchesOperation(existing, {
          mode: 'SEND',
          productId: normalizedProductId,
          payloadHash: expectedHash,
          legacyPayloadHash: legacyHash,
        })
      ) {
        return fail(
          'A chave de idempotencia ja representa outro payload',
          'MANUAL_PUBLICATION_IDEMPOTENCY_CONFLICT',
        );
      }
      if (
        ['COMPLETED', 'PARTIAL', 'BLOCKED', 'FAILED', 'AMBIGUOUS'].includes(
          existing.status,
        )
      ) {
        return {
          request: await this.view(await this.aggregate(existing)),
          created: false,
        };
      }
      const request = await this.process(existing, randomUUID());
      return { request: await this.view(request), created: false };
    }
    const requestId = `manual-publication-${randomUUID()}`;
    const acceptance = await this.buildAcceptance(input, requestId, 'SEND');
    const accepted = await this.options.requests.accept(acceptance);
    const request = await this.process(accepted.request, randomUUID());
    this.options.logger?.info(
      {
        event: 'manual-publication.request.accepted',
        requestId: request.id,
        created: accepted.created,
        targetCount: request.targets.length,
      },
      'Manual publication request accepted',
    );
    return { request: await this.view(request), created: accepted.created };
  }

  async preview(
    input: ManualPublicationPreviewInput,
  ): Promise<ManualPublicationResult> {
    assertStrictPreviewInput(input);
    const normalizedProductId = normalizeId(input.productId, 'productId');
    const normalizedDestinationIds = uniqueDestinationIds(input.destinationIds);
    const normalizedKey = normalizeId(input.idempotencyKey, 'idempotencyKey');
    const expectedHash = manualPublicationPayloadHash(
      canonicalManualPublicationPayload({
        mode: 'PREVIEW',
        productId: normalizedProductId,
        destinationIds: normalizedDestinationIds,
      }),
    );
    const existing = await this.options.requests.findByIdempotencyKey(
      normalizedKey,
    );
    if (existing) {
      if (
        !requestMatchesOperation(existing, {
          mode: 'PREVIEW',
          productId: normalizedProductId,
          payloadHash: expectedHash,
        })
      ) {
        return fail(
          'A chave de idempotencia ja representa outra operacao ou payload',
          'MANUAL_PUBLICATION_IDEMPOTENCY_CONFLICT',
        );
      }
      if (existing.status !== 'PREVIEW_READY') {
        return fail(
          'A request de preview possui estado invalido',
          'MANUAL_PUBLICATION_PREVIEW_STATE_INVALID',
        );
      }
      return { request: await this.view(existing), created: false };
    }
    const requestId = `manual-publication-preview-${randomUUID()}`;
    const acceptance = await this.buildAcceptance(input, requestId, 'PREVIEW');
    const accepted = await this.options.requests.accept(acceptance);
    if (
      accepted.request.mode !== 'PREVIEW' ||
      accepted.request.status !== 'PREVIEW_READY'
    ) {
      return fail(
        'A request de preview nao possui estado persistido seguro',
        'MANUAL_PUBLICATION_PREVIEW_STATE_INVALID',
      );
    }
    this.options.logger?.info(
      {
        event: 'manual-publication.preview.ready',
        requestId: accepted.request.id,
        created: accepted.created,
        targetCount: accepted.request.targets.length,
      },
      'Manual publication preview ready',
    );
    return {
      request: await this.view(accepted.request),
      created: accepted.created,
    };
  }

  async find(requestId: string) {
    const request = await this.options.requests.findById(
      normalizeId(requestId, 'requestId'),
    );
    if (!request) return fail('Request manual nao encontrada', 'MANUAL_PUBLICATION_NOT_FOUND');
    if (request.mode === 'PREVIEW') {
      if (request.status !== 'PREVIEW_READY') {
        return fail(
          'A request de preview possui estado invalido',
          'MANUAL_PUBLICATION_PREVIEW_STATE_INVALID',
        );
      }
      return this.view(request);
    }
    return this.view(await this.aggregate(request));
  }
}
