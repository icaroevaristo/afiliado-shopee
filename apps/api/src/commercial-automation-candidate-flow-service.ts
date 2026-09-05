import { AppError } from '@shopee-auto-affiliate-ai/shared';

import {
  COMMERCIAL_AFFILIATE_LINK_SNAPSHOT_MISMATCH,
  validateCommercialAffiliateLinkProvenance,
} from './commercial-affiliate-link-provenance';
import {
  COMMERCIAL_PROMOTION_MINING_CONFIRMATION,
  type CommercialPromotionMiningReport,
  type CommercialPromotionMiningService,
} from './commercial-promotion-mining-service';
import {
  COMMERCIAL_AI_COPY_CONFIRMATION,
  COMMERCIAL_AI_COPY_SNAPSHOT_OUTDATED,
  COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED,
  type CommercialPromotionCopyGenerationService,
} from './commercial-promotion-copy-generation-service';
import {
  CommercialMessageDraftService,
  COMMERCIAL_AUTOMATION_IMAGE_REQUIRED as COMMERCIAL_IMAGE_REQUIRED,
  type CommercialMessageDraft,
} from './commercial-message-draft-service';
import {
  duplicateLogicalGroupFingerprints,
  isCommercialAssignedGroup,
  isCommercialAuthorizedGroup,
} from './commercial-group-selection';
import {
  filterExecutableCommercialGroups,
  getOrderedAssignedInstanceNames,
  isCommercialInstanceAssigned,
  requireAssignedInstanceName,
} from './commercial-instance-stickiness';
import type {
  CommercialAutomationTarget,
  CommercialGroupCampaignAttemptReservation,
  CommercialGroupCampaignAttemptReservationInput,
  CommercialGroupCampaignAttemptRelease,
  CommercialGroupCampaignAttemptRenewal,
  CommercialGroupCampaignAttemptRenewalInput,
  CommercialGroupCampaignRecord,
  CommercialGroupCampaignRepository,
  CommercialDeliveryHistoryRepository,
  CommercialPipelineRejectionCode,
  CommercialPromotionCandidateRepository,
  CommercialPromotionCopyRepository,
  CommercialPromotionQueueItem,
  CommercialPromotionCopyContext,
  GeneratedCopyRecord,
  WhatsAppGroupDirectoryRepository,
  WhatsAppGroupRecord,
  WhatsAppInstanceRepository,
} from './repositories';
import {
  type CommercialPipelineDryRunResult,
  type CommercialPipelineService,
} from './commercial-pipeline-service';

export { COMMERCIAL_AUTOMATION_IMAGE_REQUIRED } from './commercial-message-draft-service';

type CandidateFlowLogger = {
  info: (obj: unknown, message?: string) => void;
};

export type CommercialAutomationCandidateFlowResult = {
  runId: string;
  candidateId: string;
  generatedCopyId: string;
  campaignId: string;
  groupId: string;
  logicalGroupFingerprint: string;
  nicheId: string;
  deliveryMode: 'IMAGE';
  copyPreview: string;
  pipeline: CommercialPipelineDryRunResult;
};

export type CommercialAutomationCandidatePreparationOptions = {
  executionId: string;
  existingRunId?: string;
  manualSelection?: boolean;
  beforeExternalCopyGeneration?: () => Promise<void>;
  miningReport?: Pick<
    CommercialPromotionMiningReport,
    'rejectionSummary'
  >;
};

export type CommercialAutomationCandidateRevalidation = Pick<
  CommercialAutomationCandidateFlowResult,
  'candidateId' | 'generatedCopyId' | 'campaignId' | 'groupId'
> & {
  logicalGroupFingerprint?: string;
  nicheId?: string;
};

export type CommercialAutomationCandidatePreflight =
  | {
      outcome: 'READY';
      candidateId: string;
      candidateStatus: 'COPY_READY' | 'QUEUED';
      queue?: {
        candidateCount: number;
        eligibleCount: number;
        rejectedCount: number;
        rejectionSummary?: Record<string, number>;
      };
    }
  | {
      outcome: 'NO_CANDIDATE';
      queue?: {
        candidateCount: number;
        eligibleCount: number;
        rejectedCount: number;
        rejectionSummary?: Record<string, number>;
      };
    };

export type CommercialAutomationCandidateSelection = {
  target: CommercialAutomationTarget;
  candidateId: string;
  candidateStatus: 'COPY_READY' | 'QUEUED';
  queue: {
    candidateCount: number;
    eligibleCount: number;
    rejectedCount: number;
    rejectionSummary?: Record<string, number>;
  };
};

export type CommercialAutomationCandidateAttemptReservationResult =
  | CommercialGroupCampaignAttemptReservation
  | { kind: 'INELIGIBLE'; campaignId: string };

export type CommercialAutomationCandidateAttemptReleaseResult =
  CommercialGroupCampaignAttemptRelease;

export type CommercialAutomationCandidateAttemptRenewalResult =
  CommercialGroupCampaignAttemptRenewal;

export const COMMERCIAL_AUTOMATION_BENIGN_NO_CANDIDATE_CODES = [
  'COMMERCIAL_AI_COPY_OFFER_EXPIRED',
  'COMMERCIAL_AI_COPY_OFFER_UNAVAILABLE',
  'COMMERCIAL_AI_COPY_AFFILIATE_LINK_REQUIRED',
  'COMMERCIAL_AI_COPY_SCORE_BELOW_MINIMUM',
  'COMMERCIAL_MESSAGE_CANDIDATE_EXPIRED',
  'COMMERCIAL_MESSAGE_PRODUCT_UNAVAILABLE',
  'COMMERCIAL_MESSAGE_SNAPSHOT_EXPIRED',
  'COMMERCIAL_MESSAGE_SNAPSHOT_UNAVAILABLE',
  // The provenance validator has already checked candidate/snapshot/product
  // identity before returning this code. It means the product advanced to a
  // newer official snapshot after this queue entry was materialized.
  COMMERCIAL_AFFILIATE_LINK_SNAPSHOT_MISMATCH,
  COMMERCIAL_AI_COPY_SNAPSHOT_OUTDATED,
  COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED,
  COMMERCIAL_IMAGE_REQUIRED,
] as const;

export type CommercialAutomationBenignNoCandidateCode =
  (typeof COMMERCIAL_AUTOMATION_BENIGN_NO_CANDIDATE_CODES)[number];

type CandidateFlowOptions = {
  groups: Pick<WhatsAppGroupDirectoryRepository, 'list'> &
    Partial<Pick<WhatsAppGroupDirectoryRepository, 'listAll'>>;
  campaigns: Pick<
    CommercialGroupCampaignRepository,
    'list' | 'findByLogicalGroupFingerprint'
  > &
    Partial<
      Pick<
        CommercialGroupCampaignRepository,
        'reserveAttempt' | 'releaseAttempt' | 'renewAttempt'
      >
    >;
  candidates: Pick<CommercialPromotionCandidateRepository, 'listQueue'> &
    Partial<Pick<CommercialPromotionCandidateRepository, 'blockCandidate'>>;
  deliveryHistory: Pick<
    CommercialDeliveryHistoryRepository,
    'wasProductSentToGroup' | 'findLastSentAtByGroup'
  >;
  copies: Pick<
    CommercialPromotionCopyRepository,
    'loadContext' | 'findCopyForCandidate'
  >;
  mining: Pick<CommercialPromotionMiningService, 'mine'> &
    Partial<Pick<CommercialPromotionMiningService, 'selectManualCandidate'>>;
  copyGeneration: Pick<
    CommercialPromotionCopyGenerationService,
    'preview' | 'generate' | 'findCopy'
  >;
  draft: Pick<CommercialMessageDraftService, 'createDraft'>;
  pipeline: Pick<CommercialPipelineService, 'dryRunFromPromotionCandidate'>;
  instances?: Pick<WhatsAppInstanceRepository, 'findByName'>;
  instanceName: string;
  logger?: CandidateFlowLogger;
  clock?: () => Date;
};

type CandidateWithContext = {
  context: CommercialPromotionCopyContext;
  copy: GeneratedCopyRecord;
};

const appError = (message: string, code: string) =>
  new AppError(message, code);

const queueOrder = (left: CommercialPromotionQueueItem, right: CommercialPromotionQueueItem) =>
  (left.rankPosition ?? Number.MAX_SAFE_INTEGER) -
    (right.rankPosition ?? Number.MAX_SAFE_INTEGER) ||
  left.queuedAt.getTime() - right.queuedAt.getTime() ||
  left.id.localeCompare(right.id);

const toPipelineRejectionSummary = (
  summary: CommercialPromotionMiningReport['rejectionSummary'],
) => {
  const result: Partial<
    Record<CommercialPipelineRejectionCode, number>
  > = {};
  for (const [code, count] of Object.entries(summary)) {
    if (
      code === 'RECENTLY_SENT_TO_LOGICAL_GROUP' ||
      code === 'DEDUPE_ACTIVE'
    ) {
      result.ALREADY_SENT_TO_GROUP =
        (result.ALREADY_SENT_TO_GROUP ?? 0) + count;
      continue;
    }
    if (
      code === 'OFFER_EXPIRED' ||
      code === 'OFFER_UNAVAILABLE' ||
      code === 'SCORE_BELOW_MINIMUM'
    ) {
      result[code] = count;
    }
  }
  return result;
};

const safeMessageCode = (error: unknown) => {
  if (error instanceof AppError) return error.code;
  if (
    error instanceof Error &&
    /^COMMERCIAL_MESSAGE_[A-Z0-9_]+$/u.test(error.message)
  ) {
    return error.message;
  }
  return 'COMMERCIAL_AUTOMATION_CANDIDATE_INVALID';
};

const isBenignNoCandidateCode = (
  code: string,
): code is CommercialAutomationBenignNoCandidateCode =>
  (COMMERCIAL_AUTOMATION_BENIGN_NO_CANDIDATE_CODES as readonly string[]).includes(
    code,
  );

const isExpectedNoCandidate = (error: unknown) =>
  error instanceof AppError && isBenignNoCandidateCode(error.code);

const isTerminalCandidateFailure = (code: string) =>
  code === 'COMMERCIAL_AI_COPY_OUTPUT_INVALID' || isBenignNoCandidateCode(code);

const incrementReason = (summary: Record<string, number>, code: string) => {
  summary[code] = (summary[code] ?? 0) + 1;
};

const MAX_PREPARE_CANDIDATE_ATTEMPTS = 4;

export class CommercialAutomationCandidateFlowService {
  private readonly clock: () => Date;

  constructor(private readonly options: CandidateFlowOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  private async listAuthorizedGroups(): Promise<WhatsAppGroupRecord[]> {
    const candidates = this.options.groups.listAll
      ? (await this.options.groups.listAll({ active: true, available: true })).filter(
        (group) => {
          try {
            const names = getOrderedAssignedInstanceNames(group);
            return names.length > 0 && isCommercialAssignedGroup(group, names[0]);
          } catch {
            return false;
          }
        },
      )
      : (await this.options.groups.list(this.options.instanceName, {
          active: true,
          available: true,
        })).filter((group) =>
        isCommercialAuthorizedGroup(group, this.options.instanceName),
        );
    const groups = await filterExecutableCommercialGroups(
      candidates,
      this.options.instances,
    );
    if (groups.length === 0) {
      throw appError(
        'Nenhum grupo autorizado disponivel',
        'NO_AUTHORIZED_GROUP',
      );
    }
    if (duplicateLogicalGroupFingerprints(groups).length > 0) {
      throw appError(
        'Mais de um destino representa o mesmo grupo logico',
        'COMMERCIAL_AUTOMATION_DUPLICATE_LOGICAL_GROUP',
      );
    }
    return groups.sort(
      (left, right) =>
        left.fingerprint.localeCompare(right.fingerprint) ||
        left.id.localeCompare(right.id),
    );
  }

  private async resolveTarget(
    target: CommercialAutomationTarget,
  ): Promise<{
    group: WhatsAppGroupRecord;
    campaign: CommercialGroupCampaignRecord;
  }> {
    const groups = await this.listAuthorizedGroups();
    const group = groups.find(
      (candidate) =>
        candidate.id === target.groupId &&
        candidate.fingerprint === target.logicalGroupFingerprint &&
        (!target.instanceName ||
          isCommercialInstanceAssigned(candidate, target.instanceName)) &&
        (target.assignmentRevision === undefined ||
          candidate.assignmentRevision === target.assignmentRevision),
    );
    if (!group) {
      throw appError(
        'Grupo selecionado mudou desde a resolucao',
        'COMMERCIAL_AUTOMATION_TARGET_CHANGED',
      );
    }
    const campaign = await this.resolveCampaign(group.fingerprint);
    if (
      campaign.id !== target.campaignId ||
      campaign.nicheId !== target.nicheId ||
      campaign.dailyLimit !== target.dailyLimit ||
      (target.cadenceMinutes !== undefined &&
        campaign.cadenceMinutes !== target.cadenceMinutes) ||
      (target.timezone !== undefined && campaign.timezone !== target.timezone) ||
      (target.allowedStartTime !== undefined &&
        campaign.allowedStartTime !== target.allowedStartTime) ||
      (target.allowedEndTime !== undefined &&
        campaign.allowedEndTime !== target.allowedEndTime) ||
      (target.failureCount !== undefined &&
        campaign.failureCount !== target.failureCount) ||
      (target.nextEligibleAt !== undefined &&
        campaign.nextEligibleAt?.getTime() !== target.nextEligibleAt?.getTime())
    ) {
      throw appError(
        'Campanha selecionada mudou desde a resolucao',
        'COMMERCIAL_AUTOMATION_TARGET_CHANGED',
      );
    }
    return { group, campaign };
  }

  async listTargets(): Promise<CommercialAutomationTarget[]> {
    const groups = await this.listAuthorizedGroups();
    const targets: CommercialAutomationTarget[] = [];
    let firstEligibilityError: AppError | undefined;
    for (const group of groups) {
      try {
        const campaign = await this.resolveCampaign(group.fingerprint);
        targets.push({
          groupId: group.id,
          groupName: group.name,
          instanceName: requireAssignedInstanceName(group),
          orderedInstanceNames: getOrderedAssignedInstanceNames(group),
          assignmentRevision: group.assignmentRevision,
          logicalGroupFingerprint: group.fingerprint,
          campaignId: campaign.id,
          nicheId: campaign.nicheId,
          dailyLimit: campaign.dailyLimit,
          cadenceMinutes: campaign.cadenceMinutes,
          timezone: campaign.timezone,
          allowedStartTime: campaign.allowedStartTime,
          allowedEndTime: campaign.allowedEndTime,
          failureCount: campaign.failureCount,
          nextEligibleAt: campaign.nextEligibleAt,
        });
      } catch (error) {
        if (
          error instanceof AppError &&
          [
            'COMMERCIAL_GROUP_CAMPAIGN_NOT_FOUND',
            'CAMPAIGN_INACTIVE',
            'NICHE_INACTIVE',
            'COMMERCIAL_GROUP_CAMPAIGN_FINGERPRINT_MISMATCH',
          ].includes(error.code)
        ) {
          firstEligibilityError ??= error;
          continue;
        }
        throw error;
      }
    }
    if (targets.length === 0) {
      if (firstEligibilityError) throw firstEligibilityError;
      throw appError(
        'Nenhum alvo comercial elegivel disponivel',
        'COMMERCIAL_AUTOMATION_NO_ELIGIBLE_TARGET',
      );
    }

    const now = this.clock();
    const eligibleTargets = targets.filter(
      (target) =>
        target.nextEligibleAt === undefined ||
        target.nextEligibleAt === null ||
        target.nextEligibleAt.getTime() <= now.getTime(),
    );
    if (eligibleTargets.length === 0) {
      throw appError(
        'Nenhum alvo comercial esta elegivel neste instante',
        'COMMERCIAL_AUTOMATION_NO_ELIGIBLE_TARGET',
      );
    }

    const withLastSent = await Promise.all(
      eligibleTargets.map(async (target) => ({
        target,
        lastSentAt: await this.options.deliveryHistory.findLastSentAtByGroup(
          target.groupId,
        ),
      })),
    );
    withLastSent.sort(
      (left, right) =>
        (left.lastSentAt === null ? -1 : 0) -
          (right.lastSentAt === null ? -1 : 0) ||
        (left.lastSentAt?.getTime() ?? Number.MIN_SAFE_INTEGER) -
          (right.lastSentAt?.getTime() ?? Number.MIN_SAFE_INTEGER) ||
        left.target.logicalGroupFingerprint.localeCompare(
          right.target.logicalGroupFingerprint,
        ) ||
        left.target.groupId.localeCompare(right.target.groupId),
    );
    return withLastSent.map(({ target }) => target);
  }

  async reserveAttempt(
    target: CommercialAutomationTarget,
    input: Omit<CommercialGroupCampaignAttemptReservationInput, 'campaignId'>,
  ): Promise<CommercialAutomationCandidateAttemptReservationResult> {
    const { campaign } = await this.resolveTarget(target);
    const now = this.clock();
    const nextEligibleAt = campaign.nextEligibleAt ?? target.nextEligibleAt;
    if (nextEligibleAt && nextEligibleAt.getTime() > now.getTime()) {
      return { kind: 'INELIGIBLE', campaignId: campaign.id };
    }
    if (!this.options.campaigns.reserveAttempt) {
      throw appError(
        'Reserva de tentativa comercial indisponivel',
        'COMMERCIAL_AUTOMATION_ATTEMPT_RESERVATION_UNAVAILABLE',
      );
    }
    return this.options.campaigns.reserveAttempt({
      ...input,
      campaignId: campaign.id,
    });
  }

  async releaseAttempt(input: {
    campaignId: string;
    executionId: string;
  }): Promise<CommercialAutomationCandidateAttemptReleaseResult> {
    if (!this.options.campaigns.releaseAttempt) {
      throw appError(
        'Liberacao de reserva de tentativa comercial indisponivel',
        'COMMERCIAL_AUTOMATION_ATTEMPT_RELEASE_UNAVAILABLE',
      );
    }
    return this.options.campaigns.releaseAttempt(input);
  }

  async renewAttempt(
    input: CommercialGroupCampaignAttemptRenewalInput,
  ): Promise<CommercialAutomationCandidateAttemptRenewalResult> {
    if (!this.options.campaigns.renewAttempt) {
      throw appError(
        'Renovacao de reserva de tentativa comercial indisponivel',
        'COMMERCIAL_AUTOMATION_ATTEMPT_RENEWAL_UNAVAILABLE',
      );
    }
    return this.options.campaigns.renewAttempt(input);
  }

  private async resolveCampaign(
    logicalGroupFingerprint: string,
  ): Promise<CommercialGroupCampaignRecord> {
    let campaign: CommercialGroupCampaignRecord | null;
    if (this.options.campaigns.findByLogicalGroupFingerprint) {
      campaign =
        await this.options.campaigns.findByLogicalGroupFingerprint(
          logicalGroupFingerprint,
        );
    } else {
      const matches = (
        await this.options.campaigns.list({ page: 1, limit: 100 })
      ).items.filter(
        ({ logicalGroupFingerprint: fingerprint }) =>
          fingerprint === logicalGroupFingerprint,
      );
      if (matches.length > 1) {
        throw appError(
          'Mais de uma campanha comercial corresponde ao grupo',
          'COMMERCIAL_GROUP_CAMPAIGN_FINGERPRINT_MISMATCH',
        );
      }
      campaign = matches[0] ?? null;
    }
    if (!campaign) {
      throw appError(
        'Campanha comercial nao encontrada para o grupo',
        'COMMERCIAL_GROUP_CAMPAIGN_NOT_FOUND',
      );
    }
    if (campaign.logicalGroupFingerprint !== logicalGroupFingerprint) {
      throw appError(
        'Campanha comercial diverge do grupo',
        'COMMERCIAL_GROUP_CAMPAIGN_FINGERPRINT_MISMATCH',
      );
    }
    if (!campaign.active) {
      throw appError('Campanha inativa', 'CAMPAIGN_INACTIVE');
    }
    if (!campaign.niche.active) {
      throw appError('Nicho inativo', 'NICHE_INACTIVE');
    }
    return campaign;
  }

  private async loadCandidate(candidateId: string) {
    const context = await this.options.copies.loadContext(candidateId);
    const found = await this.options.copies.findCopyForCandidate(candidateId);
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
    return { context, copy: found.copy } satisfies CandidateWithContext;
  }

  private draft(
    loaded: CandidateWithContext,
  ): CommercialMessageDraft {
    const { context, copy } = loaded;
    let draft: CommercialMessageDraft;
    try {
      draft = this.options.draft.createDraft(
        {
          id: context.candidate.id,
          productId: context.product.id,
          snapshotId: context.snapshot.id,
          generatedCopyId: copy.id,
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
            id: copy.id,
            productId: copy.productId,
            snapshotId: copy.snapshotId ?? null,
            createdFromCandidateId: copy.createdFromCandidateId ?? null,
            titulo: copy.titulo,
            mensagem: copy.mensagem,
            cta: copy.cta,
            hashtags: copy.hashtags,
          },
        },
        { now: this.clock },
      );
    } catch (error) {
      throw appError(
        'Candidato promocional invalido para envio',
        safeMessageCode(error),
      );
    }
    if (
      draft.deliveryMode !== 'IMAGE' ||
      !draft.imageUrl ||
      draft.warnings.length > 0
    ) {
      throw appError(
        'Automacao comercial exige rascunho de imagem',
        COMMERCIAL_IMAGE_REQUIRED,
      );
    }
    return draft;
  }

  private async findReadyCandidate(
    items: CommercialPromotionQueueItem[],
    campaign: CommercialGroupCampaignRecord,
    groupId: string,
    onRejected: (item: CommercialPromotionQueueItem, code: string) => Promise<void>,
  ) {
    for (const item of items
      .filter(({ status }) => status === 'COPY_READY')
      .sort(queueOrder)) {
      if (
        await this.options.deliveryHistory.wasProductSentToGroup(
          item.productId,
          groupId,
        )
      ) {
        await onRejected(item, 'ALREADY_SENT_TO_GROUP');
        continue;
      }
      try {
        const copyResult = await this.options.copyGeneration.findCopy(item.id);
        if (copyResult.status !== 'COPY_READY') {
          throw appError(
            'Copy pronta possui status inconsistente',
            'COMMERCIAL_AI_COPY_CACHE_INCONSISTENT',
          );
        }
        const loaded = await this.loadCandidate(item.id);
        if (!loaded) {
          throw appError(
            'Copy pronta nao corresponde ao candidato',
            'COMMERCIAL_AI_COPY_CACHE_INCONSISTENT',
          );
        }
        if (
          loaded.context.campaign.id !== campaign.id ||
          loaded.context.campaign.logicalGroupFingerprint !==
            campaign.logicalGroupFingerprint
        ) {
          throw appError(
            'Copy pronta pertence a uma campanha divergente',
            'COMMERCIAL_GROUP_CAMPAIGN_FINGERPRINT_MISMATCH',
          );
        }
        this.assertAffiliateLinkEligible(loaded.context, {
          candidateId: item.id,
          campaignId: campaign.id,
          groupId,
        });
        this.assertImageEligible(loaded.context);
        this.draft(loaded);
        return loaded;
      } catch (error) {
        if (isExpectedNoCandidate(error)) {
          await onRejected(item, safeMessageCode(error));
          continue;
        }
        throw error;
      }
    }
    return null;
  }

  private async findQueuedCandidate(
    items: CommercialPromotionQueueItem[],
    campaign: CommercialGroupCampaignRecord,
    groupId: string,
    onRejected: (item: CommercialPromotionQueueItem, code: string) => Promise<void>,
  ) {
    for (const item of items
      .filter(({ status }) => status === 'QUEUED')
      .sort(queueOrder)) {
      if (
        await this.options.deliveryHistory.wasProductSentToGroup(
          item.productId,
          groupId,
        )
      ) {
        await onRejected(item, 'ALREADY_SENT_TO_GROUP');
        continue;
      }
      try {
        const context = await this.options.copies.loadContext(item.id);
        if (!context) {
          throw appError(
            'Candidato enfileirado nao possui contexto',
            'COMMERCIAL_AI_COPY_CACHE_INCONSISTENT',
          );
        }
        if (
          context.candidate.status !== 'QUEUED' ||
          context.candidate.generatedCopyId ||
          context.campaign.id !== campaign.id ||
          context.campaign.logicalGroupFingerprint !==
            campaign.logicalGroupFingerprint
        ) {
          throw appError(
            'Candidato enfileirado pertence a uma campanha divergente',
            'COMMERCIAL_GROUP_CAMPAIGN_FINGERPRINT_MISMATCH',
          );
        }
        this.assertAffiliateLinkEligible(context, {
          candidateId: item.id,
          campaignId: campaign.id,
          groupId,
        });
        this.assertImageEligible(context);
        const preview = await this.options.copyGeneration.preview(item.id);
        if (!preview.eligible) {
          const unexpectedBlocker = preview.blockers.find(
            (blocker) => !isBenignNoCandidateCode(blocker),
          );
          if (unexpectedBlocker) {
            throw appError(
              'Preflight da copy encontrou bloqueio inesperado',
              unexpectedBlocker,
            );
          }
          if (preview.blockers.length === 0) {
            throw appError(
              'Preflight da copy inelegivel sem motivo conhecido',
              'COMMERCIAL_AI_COPY_PREVIEW_INVALID',
            );
          }
          await onRejected(item, preview.blockers[0] ?? 'COMMERCIAL_AI_COPY_PREVIEW_INVALID');
          continue;
        }
        return context;
      } catch (error) {
        if (isExpectedNoCandidate(error)) {
          await onRejected(item, safeMessageCode(error));
          continue;
        }
        throw error;
      }
    }
    return null;
  }

  private async loadSelectedQueuedCandidate(
    selection: CommercialAutomationCandidateSelection,
    campaign: CommercialGroupCampaignRecord,
    group: WhatsAppGroupRecord,
  ) {
    const context = await this.options.copies.loadContext(selection.candidateId);
    if (
      !context ||
      context.candidate.id !== selection.candidateId ||
      context.candidate.status !== 'QUEUED' ||
      context.candidate.generatedCopyId ||
      context.campaign.id !== campaign.id ||
      context.campaign.logicalGroupFingerprint !== campaign.logicalGroupFingerprint
    ) {
      throw appError(
        'Candidato selecionado mudou desde o preflight',
        'COMMERCIAL_AUTOMATION_CANDIDATE_CHANGED',
      );
    }
    if (
      await this.options.deliveryHistory.wasProductSentToGroup(
        context.product.id,
        group.id,
      )
    ) {
      throw appError(
        'Candidato selecionado ja foi entregue ao grupo',
        'COMMERCIAL_AUTOMATION_NO_ELIGIBLE_CANDIDATE',
      );
    }
    try {
      this.assertAffiliateLinkEligible(context, {
        candidateId: selection.candidateId,
        campaignId: campaign.id,
        groupId: group.id,
      });
      this.assertImageEligible(context);
    } catch (error) {
      if (isExpectedNoCandidate(error)) {
        throw appError(
          'Candidato selecionado ficou inelegivel desde o preflight',
          'COMMERCIAL_AUTOMATION_NO_ELIGIBLE_CANDIDATE',
        );
      }
      throw error;
    }
    return context;
  }

  private async loadSelectedReadyCandidate(
    selection: CommercialAutomationCandidateSelection,
    campaign: CommercialGroupCampaignRecord,
    group: WhatsAppGroupRecord,
  ) {
    const loaded = await this.loadCandidate(selection.candidateId);
    if (
      !loaded ||
      loaded.context.candidate.id !== selection.candidateId ||
      loaded.context.campaign.id !== campaign.id ||
      loaded.context.campaign.logicalGroupFingerprint !==
        campaign.logicalGroupFingerprint
    ) {
      throw appError(
        'Candidato selecionado mudou desde o preflight',
        'COMMERCIAL_AUTOMATION_CANDIDATE_CHANGED',
      );
    }
    if (
      await this.options.deliveryHistory.wasProductSentToGroup(
        loaded.context.product.id,
        group.id,
      )
    ) {
      throw appError(
        'Candidato selecionado ja foi entregue ao grupo',
        'COMMERCIAL_AUTOMATION_NO_ELIGIBLE_CANDIDATE',
      );
    }
    try {
      this.assertAffiliateLinkEligible(loaded.context, {
        candidateId: selection.candidateId,
        campaignId: campaign.id,
        groupId: group.id,
      });
      this.assertImageEligible(loaded.context);
      this.draft(loaded);
    } catch (error) {
      if (isExpectedNoCandidate(error)) {
        throw appError(
          'Candidato selecionado ficou inelegivel desde o preflight',
          'COMMERCIAL_AUTOMATION_NO_ELIGIBLE_CANDIDATE',
        );
      }
      throw error;
    }
    return loaded;
  }

  private assertImageEligible(context: CommercialPromotionCopyContext) {
    const imageUrl = context.product.urlImagem?.trim();
    if (!imageUrl || imageUrl === context.product.affiliateLink) {
      throw appError(
        'Automacao comercial exige imagem valida',
        COMMERCIAL_IMAGE_REQUIRED,
      );
    }
    try {
      const url = new URL(imageUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('invalid image protocol');
      }
    } catch {
      throw appError(
        'Automacao comercial exige imagem valida',
        COMMERCIAL_IMAGE_REQUIRED,
      );
    }
  }

  private assertAffiliateLinkEligible(
    context: CommercialPromotionCopyContext,
    expected: { candidateId: string; campaignId: string; groupId: string },
  ) {
    const validation = validateCommercialAffiliateLinkProvenance(context, expected);
    if (!validation.valid) {
      throw appError(
        'Automacao comercial exige link de afiliado com proveniencia valida',
        validation.code,
      );
    }
  }

  async preflight(
    target: CommercialAutomationTarget,
    options: { excludeCandidateIds?: readonly string[] } = {},
  ): Promise<CommercialAutomationCandidatePreflight> {
    const { group, campaign } = await this.resolveTarget(target);
    const queue = await this.options.candidates.listQueue({
      campaignId: campaign.id,
      page: 1,
      limit: campaign.queueTargetSize,
    });
    const rejectionSummary: Record<string, number> = {};
    const excluded = new Set(options.excludeCandidateIds ?? []);
    const onRejected = async (
      item: CommercialPromotionQueueItem,
      code: string,
    ) => {
      incrementReason(rejectionSummary, code);
      if (
        !isTerminalCandidateFailure(code) ||
        !this.options.candidates.blockCandidate
      ) {
        return;
      }
      const expectedStatus = item.status;
      if (expectedStatus !== 'QUEUED' && expectedStatus !== 'COPY_READY') {
        return;
      }
      const blocked = await this.options.candidates.blockCandidate({
        candidateId: item.id,
        expectedStatus,
        reason: code,
        now: this.clock(),
      });
      if (blocked.kind === 'CONFLICT') {
        throw appError(
          'Candidato mudou durante o descarte terminal',
          'COMMERCIAL_AUTOMATION_CANDIDATE_CHANGED',
        );
      }
    };
    const orderedCandidates = queue.items
      .filter(
        ({ id, status }) =>
          !excluded.has(id) &&
          (status === 'COPY_READY' || status === 'QUEUED'),
      )
      .sort(queueOrder);
    let selected:
      | { candidateId: string; candidateStatus: 'COPY_READY' | 'QUEUED' }
      | undefined;
    let usefulCount = 0;
    for (const item of orderedCandidates) {
      if (item.status === 'COPY_READY') {
        const ready = await this.findReadyCandidate(
          [item],
          campaign,
          group.id,
          onRejected,
        );
        if (ready) {
          usefulCount += 1;
          selected ??= {
            candidateId: ready.context.candidate.id,
            candidateStatus: 'COPY_READY',
          };
        }
        continue;
      }
      const queued = await this.findQueuedCandidate(
        [item],
        campaign,
        group.id,
        onRejected,
      );
      if (queued) {
        usefulCount += 1;
        selected ??= {
          candidateId: queued.candidate.id,
          candidateStatus: 'QUEUED',
        };
      }
    }
    const queueSummary = {
      candidateCount: queue.total,
      eligibleCount: usefulCount,
      rejectedCount: Math.max(queue.total - usefulCount, 0),
      rejectionSummary,
    };
    if (selected) return { outcome: 'READY', ...selected, queue: queueSummary };
    return { outcome: 'NO_CANDIDATE', queue: queueSummary };
  }

  async replenish(
    target: CommercialAutomationTarget,
  ): Promise<CommercialPromotionMiningReport> {
    const { campaign } = await this.resolveTarget(target);
    return this.options.mining.mine(campaign.id, {
      confirm: COMMERCIAL_PROMOTION_MINING_CONFIRMATION,
    });
  }

  async prepare(
    selection: CommercialAutomationCandidateSelection,
    options: CommercialAutomationCandidatePreparationOptions,
  ): Promise<CommercialAutomationCandidateFlowResult> {
    const { group, campaign } = await this.resolveTarget(selection.target);
    let currentSelection = selection;
    const terminalCandidateIds = new Set<string>();
    let loaded: CandidateWithContext | null = null;
    for (
      let attempt = 0;
      attempt < MAX_PREPARE_CANDIDATE_ATTEMPTS;
      attempt += 1
    ) {
      try {
        if (currentSelection.candidateStatus === 'QUEUED') {
          await this.loadSelectedQueuedCandidate(currentSelection, campaign, group);
          await options.beforeExternalCopyGeneration?.();
          await this.options.copyGeneration.generate(
            currentSelection.candidateId,
            COMMERCIAL_AI_COPY_CONFIRMATION,
          );
        }
        loaded = await this.loadSelectedReadyCandidate(
          currentSelection,
          campaign,
          group,
        );
        break;
      } catch (error) {
        const code = safeMessageCode(error);
        if (
          code !== 'COMMERCIAL_AI_COPY_OUTPUT_INVALID' &&
          code !== COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED
        ) {
          throw error;
        }
        if (!this.options.candidates.blockCandidate) {
          throw appError(
            'Descarte terminal de candidate indisponivel',
            'COMMERCIAL_AUTOMATION_CANDIDATE_BLOCK_UNAVAILABLE',
          );
        }
        const blocked = await this.options.candidates.blockCandidate({
          candidateId: currentSelection.candidateId,
          expectedStatus:
            currentSelection.candidateStatus === 'QUEUED'
              ? 'QUEUED'
              : 'COPY_READY',
          reason: code,
          now: this.clock(),
        });
        if (blocked.kind === 'CONFLICT') throw error;
        terminalCandidateIds.add(currentSelection.candidateId);
        const next = await this.preflight(selection.target, {
          excludeCandidateIds: [...terminalCandidateIds],
        });
        if (next.outcome === 'NO_CANDIDATE') {
          throw appError(
            'Nenhum candidate util restou para o slot',
            'COMMERCIAL_AUTOMATION_NO_ELIGIBLE_CANDIDATE',
          );
        }
        currentSelection = {
          target: selection.target,
          candidateId: next.candidateId,
          candidateStatus: next.candidateStatus,
          queue: next.queue ?? {
            candidateCount: 0,
            eligibleCount: 0,
            rejectedCount: 0,
          },
        };
      }
    }
    if (!loaded) {
      throw appError(
        'Limite de substituicoes de candidate atingido',
        'COMMERCIAL_AUTOMATION_CANDIDATE_FALLBACK_EXHAUSTED',
      );
    }
    if (
      loaded.context.campaign.id !== campaign.id ||
      loaded.context.campaign.logicalGroupFingerprint !==
        campaign.logicalGroupFingerprint
    ) {
      throw appError(
        'Copy preparada para campanha divergente',
        'COMMERCIAL_GROUP_CAMPAIGN_FINGERPRINT_MISMATCH',
      );
    }
    const draft = this.draft(loaded);
    const pipeline = await this.options.pipeline.dryRunFromPromotionCandidate({
      candidate: {
        id: loaded.context.candidate.id,
        productId: loaded.context.product.id,
        productName: loaded.context.product.productName,
        price: loaded.context.product.price,
        commercialScore: loaded.context.candidate.commercialScore,
        scorePolicyVersion: loaded.context.candidate.scorePolicyVersion,
        minimumScoreUsed: loaded.context.candidate.minimumScoreUsed,
        rankPosition: loaded.context.candidate.rankPosition,
        scoreBreakdown: loaded.context.candidate.scoreBreakdown,
      },
      group,
      executionId: options.executionId,
      existingRunId: options.existingRunId,
      instanceName:
        currentSelection.target.instanceName ?? requireAssignedInstanceName(group),
      campaign: 'commercial-automation',
      manualSelection: options.manualSelection ?? false,
      copyPreview: draft.caption,
      candidateCount: currentSelection.queue.candidateCount,
      eligibleCount: currentSelection.queue.eligibleCount,
      rejectedCount: currentSelection.queue.rejectedCount,
      rejectionSummary: toPipelineRejectionSummary(
        {
          ...(currentSelection.queue.rejectionSummary ?? {}),
          ...(options.miningReport?.rejectionSummary ?? {}),
        },
      ),
    });
    this.options.logger?.info(
      {
        event: 'commercial-automation.candidate-flow.prepared',
        campaignId: campaign.id,
        candidateId: loaded.context.candidate.id,
        generatedCopyId: loaded.copy.id,
      },
      'Commercial automation candidate flow prepared',
    );
    return {
      runId: pipeline.runId,
      candidateId: loaded.context.candidate.id,
      generatedCopyId: loaded.copy.id,
      campaignId: campaign.id,
      groupId: group.id,
      logicalGroupFingerprint: group.fingerprint,
      nicheId: campaign.nicheId,
      deliveryMode: 'IMAGE',
      copyPreview: draft.caption,
      pipeline,
    };
  }

  async prepareManual(
    productId: string,
    target: CommercialAutomationTarget,
    options: Pick<
      CommercialAutomationCandidatePreparationOptions,
      'executionId' | 'existingRunId' | 'beforeExternalCopyGeneration'
    >,
  ): Promise<CommercialAutomationCandidateFlowResult> {
    if (!this.options.mining.selectManualCandidate) {
      throw appError(
        'Selecao manual de candidate indisponivel',
        'MANUAL_PUBLICATION_CANDIDATE_UNAVAILABLE',
      );
    }
    const candidate = await this.options.mining.selectManualCandidate({
      campaignId: target.campaignId,
      productId,
      logicalGroupFingerprint: target.logicalGroupFingerprint,
    });
    if (candidate.status !== 'QUEUED' && candidate.status !== 'COPY_READY') {
      throw appError(
        'Candidate manual nao esta pronto para preparacao',
        'MANUAL_PUBLICATION_CANDIDATE_NOT_READY',
      );
    }
    return this.prepare(
      {
        target,
        candidateId: candidate.id,
        candidateStatus: candidate.status,
        queue: { candidateCount: 1, eligibleCount: 1, rejectedCount: 0 },
      },
      {
        executionId: options.executionId,
        existingRunId: options.existingRunId,
        manualSelection: true,
        beforeExternalCopyGeneration: options.beforeExternalCopyGeneration,
      },
    );
  }

  async revalidate(input: CommercialAutomationCandidateRevalidation) {
    const groups = await this.listAuthorizedGroups();
    const group = groups.find((candidate) => candidate.id === input.groupId);
    if (
      !group ||
      (input.logicalGroupFingerprint &&
        group.fingerprint !== input.logicalGroupFingerprint)
    ) {
      throw appError('Grupo mudou desde o preparo', 'COMMERCIAL_GROUP_CHANGED');
    }
    const campaign = await this.resolveCampaign(group.fingerprint);
    if (
      campaign.id !== input.campaignId ||
      (input.nicheId && campaign.nicheId !== input.nicheId)
    ) {
      throw appError(
        'Campanha mudou desde o preparo',
        'COMMERCIAL_GROUP_CAMPAIGN_CHANGED',
      );
    }
    const copyResult = await this.options.copyGeneration.findCopy(
      input.candidateId,
    );
    if (
      copyResult.generatedCopyId !== input.generatedCopyId ||
      copyResult.status !== 'COPY_READY'
    ) {
      throw appError(
        'Copy candidate-scoped mudou desde o preparo',
        'COMMERCIAL_AI_COPY_CACHE_INCONSISTENT',
      );
    }
    const loaded = await this.loadCandidate(input.candidateId);
    if (
      !loaded ||
      loaded.copy.id !== input.generatedCopyId ||
      loaded.context.campaign.id !== campaign.id ||
      loaded.context.campaign.logicalGroupFingerprint !== group.fingerprint
    ) {
      throw appError(
        'Candidato promocional mudou desde o preparo',
        'COMMERCIAL_AUTOMATION_CANDIDATE_CHANGED',
      );
    }
    this.draft(loaded);
  }
}
