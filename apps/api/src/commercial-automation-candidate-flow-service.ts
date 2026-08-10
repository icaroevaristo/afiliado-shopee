import { AppError } from '@shopee-auto-affiliate-ai/shared';

import {
  COMMERCIAL_PROMOTION_MINING_CONFIRMATION,
  type CommercialPromotionMiningReport,
  type CommercialPromotionMiningService,
} from './commercial-promotion-mining-service';
import {
  COMMERCIAL_AI_COPY_CONFIRMATION,
  type CommercialPromotionCopyGenerationService,
} from './commercial-promotion-copy-generation-service';
import {
  CommercialMessageDraftService,
  COMMERCIAL_AUTOMATION_IMAGE_REQUIRED as COMMERCIAL_IMAGE_REQUIRED,
  type CommercialMessageDraft,
} from './commercial-message-draft-service';
import {
  duplicateLogicalGroupFingerprints,
  isCommercialAuthorizedGroup,
} from './commercial-group-selection';
import type {
  CommercialAutomationTarget,
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

export type CommercialAutomationCandidateRevalidation = Pick<
  CommercialAutomationCandidateFlowResult,
  'candidateId' | 'generatedCopyId' | 'campaignId' | 'groupId'
> & {
  logicalGroupFingerprint?: string;
  nicheId?: string;
};

type CandidateFlowOptions = {
  groups: Pick<WhatsAppGroupDirectoryRepository, 'list'>;
  campaigns: Pick<
    CommercialGroupCampaignRepository,
    'list' | 'findByLogicalGroupFingerprint'
  >;
  candidates: Pick<CommercialPromotionCandidateRepository, 'listQueue'>;
  deliveryHistory: Pick<
    CommercialDeliveryHistoryRepository,
    'wasProductSentToGroup' | 'findLastSentAtByGroup'
  >;
  copies: Pick<
    CommercialPromotionCopyRepository,
    'loadContext' | 'findCopyForCandidate'
  >;
  mining: Pick<CommercialPromotionMiningService, 'mine'>;
  copyGeneration: Pick<
    CommercialPromotionCopyGenerationService,
    'preview' | 'generate' | 'findCopy'
  >;
  draft: Pick<CommercialMessageDraftService, 'createDraft'>;
  pipeline: Pick<CommercialPipelineService, 'dryRunFromPromotionCandidate'>;
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

export class CommercialAutomationCandidateFlowService {
  private readonly clock: () => Date;

  constructor(private readonly options: CandidateFlowOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  private async listAuthorizedGroups(): Promise<WhatsAppGroupRecord[]> {
    const groups = (await this.options.groups.list(this.options.instanceName, {
      active: true,
      available: true,
    })).filter((group) =>
      isCommercialAuthorizedGroup(group, this.options.instanceName),
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
        candidate.fingerprint === target.logicalGroupFingerprint,
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
      campaign.nicheId !== target.nicheId
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
          logicalGroupFingerprint: group.fingerprint,
          campaignId: campaign.id,
          nicheId: campaign.nicheId,
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

    const withLastSent = await Promise.all(
      targets.map(async (target) => ({
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
        continue;
      }
      try {
        const copyResult = await this.options.copyGeneration.findCopy(item.id);
        if (copyResult.status !== 'COPY_READY') continue;
        const loaded = await this.loadCandidate(item.id);
        if (
          loaded &&
          loaded.context.campaign.id === campaign.id &&
          loaded.context.campaign.logicalGroupFingerprint ===
            campaign.logicalGroupFingerprint
        ) {
          return loaded;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  private async findQueuedCandidate(
    items: CommercialPromotionQueueItem[],
    campaign: CommercialGroupCampaignRecord,
    groupId: string,
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
        continue;
      }
      const preview = await this.options.copyGeneration.preview(item.id);
      if (!preview.eligible) continue;
      await this.options.copyGeneration.generate(
        item.id,
        COMMERCIAL_AI_COPY_CONFIRMATION,
      );
      const loaded = await this.loadCandidate(item.id);
      if (
        !loaded ||
        loaded.context.campaign.id !== campaign.id ||
        loaded.context.campaign.logicalGroupFingerprint !==
          campaign.logicalGroupFingerprint
      ) {
        throw appError(
          'Copy gerada para campanha divergente',
          'COMMERCIAL_GROUP_CAMPAIGN_FINGERPRINT_MISMATCH',
        );
      }
      return loaded;
    }
    return null;
  }

  async prepare(
    target: CommercialAutomationTarget,
  ): Promise<CommercialAutomationCandidateFlowResult> {
    const { group, campaign } = await this.resolveTarget(target);
    const miningReport = await this.options.mining.mine(campaign.id, {
      confirm: COMMERCIAL_PROMOTION_MINING_CONFIRMATION,
    });
    const queue = await this.options.candidates.listQueue({
      campaignId: campaign.id,
      page: 1,
      limit: campaign.queueTargetSize,
    });
    const loaded =
      (await this.findReadyCandidate(queue.items, campaign, group.id)) ??
      (await this.findQueuedCandidate(queue.items, campaign, group.id));
    if (!loaded) {
      throw appError(
        'Nenhum candidato promocional elegivel',
        'COMMERCIAL_AUTOMATION_NO_ELIGIBLE_CANDIDATE',
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
      campaign: 'commercial-automation',
      copyPreview: draft.caption,
      candidateCount: queue.total,
      eligibleCount: queue.items.filter(
        ({ status }) => status === 'QUEUED' || status === 'COPY_READY',
      ).length,
      rejectedCount: Math.max(
        queue.total -
          queue.items.filter(
            ({ status }) => status === 'QUEUED' || status === 'COPY_READY',
          ).length,
        0,
      ),
      rejectionSummary: toPipelineRejectionSummary(
        miningReport.rejectionSummary,
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
