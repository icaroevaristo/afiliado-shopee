import type { FastifyBaseLogger } from 'fastify';
import {
  buildShopeeAffiliateTrackingMetadata,
  toPlannedShopeeSubIds,
} from '@shopee-auto-affiliate-ai/providers';
import { AppError } from '@shopee-auto-affiliate-ai/shared';
import type { CommercialCopyGenerator } from './commercial-copy-service';
import {
  duplicateLogicalGroupFingerprints,
  isCommercialAuthorizedGroup,
} from './commercial-group-selection';
import {
  commercialProductRejections,
  incrementCommercialRejectionSummary,
} from './commercial-offer-eligibility';
import {
  CommercialOfferScorePolicyResolver,
  sanitizeCommercialScoreBreakdown,
} from './commercial-offer-score-policy';
import {
  assertActiveCommercialInstance,
  filterExecutableCommercialGroups,
  requireAssignedInstanceName,
} from './commercial-instance-stickiness';
import type {
  CommercialDeliveryHistoryRepository,
  CommercialAutomationTarget,
  CommercialGroupCampaignRepository,
  CommercialOfferScorePolicyVersion,
  CommercialPipelineRejectionCode,
  CommercialPipelineScoreBreakdown,
  CommercialPipelineRunFilters,
  CommercialPipelineRunRecord,
  CommercialPipelineRunRepository,
  CommercialPromotionCandidateRecord,
  ShopeeOfferRecord,
  ShopeeOfferRepository,
  WhatsAppDispatchDetails,
  WhatsAppDispatchRepository,
  WhatsAppGroupDirectoryRepository,
  WhatsAppGroupRecord,
  WhatsAppInstanceRepository,
} from './repositories';
import type { ScoreService } from './score-service';

export type CommercialPipelineInput = {
  executionId?: string | null;
  instanceName?: string | null;
  source?: 'MOCK' | 'MANUAL' | 'OFFICIAL';
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  minDiscountRate?: number;
  minRating?: number;
  minSales?: number;
  minCommissionRate?: number;
  minimumScore?: number;
  campaign?: string;
  limitCandidates?: number;
  target?: CommercialAutomationTarget;
};

type NormalizedCommercialPipelineInput = Required<
  Pick<
    CommercialPipelineInput,
    'source' | 'minimumScore' | 'campaign' | 'limitCandidates'
  >
> &
  Omit<
    CommercialPipelineInput,
    'source' | 'minimumScore' | 'campaign' | 'limitCandidates'
  >;

export type CommercialPipelineDryRunResult = {
  runId: string;
  mode: 'dry-run';
  status: 'ready';
  provider: 'mock' | 'manual' | 'official';
  candidateCount: number;
  eligibleCount: number;
  rejectedCount: number;
  rejectionSummary: Partial<Record<CommercialPipelineRejectionCode, number>>;
  scorePolicyVersion: CommercialOfferScorePolicyVersion;
  minimumScoreUsed: number;
  maximumScoreObserved: number;
  selectedScoreBreakdown: CommercialPipelineScoreBreakdown;
  selectedProduct: {
    id: string;
    name: string;
    price: string;
    score: number;
    affiliateLinkPresent: true;
  };
  selectedGroup: {
    id: string;
    name: string;
    fingerprint: string;
  };
  selectionReasons: string[];
  copyPreview: string;
  plannedSubIds: string[];
  dispatchWillBeCreated: false;
  jobWillBeCreated: false;
  messageWillBeSent: false;
};

export type CommercialPromotionCandidatePipelineSelection = {
  executionId: string;
  instanceName?: string | null;
  candidate: Pick<
    CommercialPromotionCandidateRecord,
    | 'id'
    | 'productId'
    | 'commercialScore'
    | 'scorePolicyVersion'
    | 'minimumScoreUsed'
    | 'rankPosition'
    | 'scoreBreakdown'
  > & {
    productName: string;
    price: string;
  };
  group: Pick<
    WhatsAppGroupRecord,
    'id' | 'name' | 'fingerprint' | 'assignedInstanceName'
  >;
  campaign: string;
  copyPreview: string;
  candidateCount: number;
  eligibleCount: number;
  rejectedCount: number;
  rejectionSummary: Partial<
    Record<CommercialPipelineRejectionCode, number>
  >;
};

export type CommercialPipelineServiceOptions = {
  offers: ShopeeOfferRepository;
  groups: WhatsAppGroupDirectoryRepository;
  campaigns: Pick<CommercialGroupCampaignRepository, 'findById'>;
  score: Pick<ScoreService, 'calculate'>;
  copy: CommercialCopyGenerator;
  runs: CommercialPipelineRunRepository;
  deliveryHistory: CommercialDeliveryHistoryRepository;
  dispatches?: Pick<WhatsAppDispatchRepository, 'findByIdWithDetails'>;
  instances?: Pick<WhatsAppInstanceRepository, 'findByName'>;
  instanceName: string;
  subIdPrefix: string;
  logger: Pick<FastifyBaseLogger, 'info' | 'error'>;
  clock?: () => Date;
};

const MAXIMUM_CANDIDATES = 100;

export const defaultCommercialMinimumScore = (
  source: Exclude<CommercialPipelineInput['source'], undefined>,
) => (source === 'OFFICIAL' ? 60 : 70);

const normalizeInput = (
  input: CommercialPipelineInput,
): NormalizedCommercialPipelineInput => {
  const source = input.source ?? 'MOCK';
  const minimumScore =
    input.minimumScore ?? defaultCommercialMinimumScore(source);
  const limitCandidates = input.limitCandidates ?? 20;
  const campaign = input.campaign?.trim() || 'dry-run-local';
  const numericEntries = [
    ['minPrice', input.minPrice],
    ['maxPrice', input.maxPrice],
    ['minDiscountRate', input.minDiscountRate],
    ['minRating', input.minRating],
    ['minSales', input.minSales],
    ['minCommissionRate', input.minCommissionRate],
    ['minimumScore', minimumScore],
  ] as const;

  if (!['MOCK', 'MANUAL', 'OFFICIAL'].includes(source)) {
    throw new AppError('Origem comercial invalida', 'INVALID_PIPELINE_FILTERS');
  }
  if (
    numericEntries.some(
      ([, value]) =>
        value !== undefined && (!Number.isFinite(value) || value < 0),
    ) ||
    minimumScore > 100 ||
    (input.minRating !== undefined && input.minRating > 5) ||
    (input.minDiscountRate !== undefined && input.minDiscountRate > 100) ||
    (input.minCommissionRate !== undefined && input.minCommissionRate > 100) ||
    (input.minSales !== undefined && !Number.isInteger(input.minSales)) ||
    (input.minPrice !== undefined &&
      input.maxPrice !== undefined &&
      input.minPrice > input.maxPrice) ||
    !Number.isInteger(limitCandidates) ||
    limitCandidates < 1 ||
    limitCandidates > MAXIMUM_CANDIDATES ||
    campaign.length > 80 ||
    (input.categoryId !== undefined && !input.categoryId.trim())
  ) {
    throw new AppError(
      'Filtros do pipeline comercial sao invalidos',
      'INVALID_PIPELINE_FILTERS',
    );
  }

  return {
    ...input,
    source,
    minimumScore,
    campaign,
    limitCandidates,
    categoryId: input.categoryId?.trim(),
  };
};

const rankCandidates = (
  left: { product: ShopeeOfferRecord; score: CommercialPipelineScoreBreakdown },
  right: {
    product: ShopeeOfferRecord;
    score: CommercialPipelineScoreBreakdown;
  },
) =>
  right.score.finalScore - left.score.finalScore ||
  right.product.commissionRate - left.product.commissionRate ||
  right.product.sales - left.product.sales ||
  right.product.discountRate - left.product.discountRate ||
  right.product.rating - left.product.rating ||
  left.product.id.localeCompare(right.product.id);

export const sanitizeCommercialPipelineRun = (
  run: CommercialPipelineRunRecord,
  dispatch?: WhatsAppDispatchDetails | null,
) => ({
  id: run.id,
  mode: run.mode.toLocaleLowerCase().replace('_', '-'),
  status: run.status.toLocaleLowerCase(),
  selectedProduct: run.productId
    ? {
        id: run.productId,
        name: run.productName,
        price: run.productPrice,
        score: run.score,
        affiliateLinkPresent: Boolean(run.copyPreview),
      }
    : null,
  selectedGroup: run.groupDestinationId
    ? {
        id: run.groupDestinationId,
        name: run.groupName,
        fingerprint: run.groupFingerprint,
      }
    : null,
  candidateCount: run.candidateCount,
  eligibleCount: run.eligibleCount,
  rejectedCount: run.rejectedCount,
  rejectionSummary: run.rejectionSummary,
  scorePolicyVersion: run.scorePolicyVersion ?? null,
  minimumScoreUsed: run.minimumScoreUsed ?? null,
  maximumScoreObserved: run.maximumScoreObserved ?? null,
  selectedScoreBreakdown: run.selectedScoreBreakdown ?? null,
  selectionReasons: run.selectionReasons,
  copyPreview: run.copyPreview,
  plannedSubIds: run.plannedSubIds,
  failureCode: run.failureCode,
  confirmedAt: run.confirmedAt?.toISOString() ?? null,
  finalStatus: run.finalStatus?.toLocaleLowerCase() ?? null,
  dispatchStatus: dispatch?.status?.toLocaleLowerCase() ?? null,
  attemptCount: dispatch?.attemptCount ?? 0,
  externalMessageIdRecorded: Boolean(dispatch?.externalMessageId),
  investigationRequired: run.investigationRequired ?? false,
  createdAt: run.createdAt.toISOString(),
  completedAt: run.completedAt?.toISOString() ?? null,
  dispatchWasCreated: Boolean(run.dispatchId),
  jobWasCreated: Boolean(run.jobId),
  messageWasSent: run.finalStatus === 'SENT' || dispatch?.status === 'SENT',
  confirmationAvailable:
    run.mode === 'DRY_RUN' &&
    run.status === 'COMPLETED' &&
    !run.confirmedAt &&
    !run.dispatchId &&
    !run.jobId,
});

export class CommercialPipelineService {
  private readonly clock: () => Date;
  private readonly scorePolicies: CommercialOfferScorePolicyResolver;

  constructor(private readonly options: CommercialPipelineServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.scorePolicies = new CommercialOfferScorePolicyResolver(options.score);
  }

  async dryRun(
    rawInput: CommercialPipelineInput = {},
  ): Promise<CommercialPipelineDryRunResult> {
    const input = normalizeInput(rawInput);
    const startedAt = this.clock();
    const scorePolicy = this.scorePolicies.forSource(input.source);
    let maximumScoreObserved = 0;
    let run: CommercialPipelineRunRecord | null = null;
    const ensureRun = async (instanceName: string | null) => {
      if (run) return run;
      run = await this.options.runs.create({
        mode: 'DRY_RUN',
        status: 'STARTED',
        executionId: input.executionId ?? null,
        instanceName,
        candidateCount: 0,
        eligibleCount: 0,
        rejectedCount: 0,
        rejectionSummary: {},
        selectionReasons: [],
        plannedSubIds: [],
        createdAt: startedAt,
        completedAt: null,
      });
      return run;
    };
    let failureRecorded = false;

    const block = async (
      code:
        | 'NO_ELIGIBLE_PRODUCT'
        | 'NO_AUTHORIZED_GROUP'
        | 'MULTIPLE_AUTHORIZED_GROUPS'
        | 'COMMERCIAL_AUTOMATION_DUPLICATE_LOGICAL_GROUP'
        | 'COMMERCIAL_AUTOMATION_TARGET_NOT_ELIGIBLE'
        | 'PRODUCT_ALREADY_SENT',
      state: {
        candidateCount: number;
        eligibleCount: number;
        rejectedCount: number;
        rejectionSummary: Partial<
          Record<CommercialPipelineRejectionCode, number>
        >;
      },
    ): Promise<never> => {
      const currentRun = await ensureRun(input.instanceName ?? null);
      await this.options.runs.update(currentRun.id, {
        status: 'BLOCKED',
        ...state,
        scorePolicyVersion: scorePolicy.policyVersion,
        minimumScoreUsed: input.minimumScore,
        maximumScoreObserved,
        failureCode: code,
        completedAt: this.clock(),
      });
      failureRecorded = true;
      throw new AppError(
        {
          NO_ELIGIBLE_PRODUCT: 'Nenhum produto elegivel encontrado',
          NO_AUTHORIZED_GROUP: 'Nenhum grupo autorizado disponivel',
          MULTIPLE_AUTHORIZED_GROUPS:
            'Mais de um grupo autorizado esta disponivel',
          COMMERCIAL_AUTOMATION_DUPLICATE_LOGICAL_GROUP:
            'Mais de um destino representa o mesmo grupo logico',
          COMMERCIAL_AUTOMATION_TARGET_NOT_ELIGIBLE:
            'O alvo comercial selecionado nao esta elegivel',
          PRODUCT_ALREADY_SENT: 'Produtos elegiveis ja foram enviados ao grupo',
        }[code],
        code,
      );
    };

    try {
      const candidates = await this.options.offers.listCommercialCandidates({
        source: input.source,
        categoryId: input.categoryId,
        minPrice: input.minPrice,
        maxPrice: input.maxPrice,
        minDiscountRate: input.minDiscountRate,
        minRating: input.minRating,
        minSales: input.minSales,
        minCommissionRate: input.minCommissionRate,
        limit: input.limitCandidates,
      });
      const rejectionSummary: Partial<
        Record<CommercialPipelineRejectionCode, number>
      > = {};
      const ranked: Array<{
        product: ShopeeOfferRecord;
        score: CommercialPipelineScoreBreakdown;
      }> = [];

      for (const product of candidates) {
        const reasons = commercialProductRejections(product, startedAt);
        if (reasons.length > 0) {
          reasons.forEach((reason) =>
            incrementCommercialRejectionSummary(rejectionSummary, reason),
          );
          continue;
        }
        const score = scorePolicy.score(product);
        maximumScoreObserved = Math.max(maximumScoreObserved, score.finalScore);
        if (score.finalScore < input.minimumScore) {
          incrementCommercialRejectionSummary(
            rejectionSummary,
            'SCORE_BELOW_MINIMUM',
          );
          continue;
        }
        ranked.push({ product, score });
      }
      ranked.sort(rankCandidates);
      const initialRejectedCount = candidates.length - ranked.length;
      if (ranked.length === 0) {
        return await block('NO_ELIGIBLE_PRODUCT', {
          candidateCount: candidates.length,
          eligibleCount: 0,
          rejectedCount: initialRejectedCount,
          rejectionSummary,
        });
      }

      const groups = await filterExecutableCommercialGroups(
        (await this.options.groups.list(this.options.instanceName, {
          active: true,
          available: true,
        }))
        .filter((group): group is WhatsAppGroupRecord =>
          isCommercialAuthorizedGroup(group, this.options.instanceName),
        ),
        this.options.instances,
      );
      if (groups.length === 0) {
        return await block('NO_AUTHORIZED_GROUP', {
          candidateCount: candidates.length,
          eligibleCount: ranked.length,
          rejectedCount: initialRejectedCount,
          rejectionSummary,
        });
      }
      const duplicateFingerprints = duplicateLogicalGroupFingerprints(groups);
      if (duplicateFingerprints.length > 0) {
        return await block('COMMERCIAL_AUTOMATION_DUPLICATE_LOGICAL_GROUP', {
          candidateCount: candidates.length,
          eligibleCount: ranked.length,
          rejectedCount: initialRejectedCount,
          rejectionSummary,
        });
      }
      const target = input.target;
      const orderedGroups = [...groups].sort(
        (left, right) =>
          left.fingerprint.localeCompare(right.fingerprint) ||
          left.id.localeCompare(right.id),
      );
      const group = target
        ? orderedGroups.find(
            (candidate) =>
              candidate.id === target.groupId &&
              candidate.name === target.groupName &&
              candidate.fingerprint === target.logicalGroupFingerprint &&
              candidate.assignedInstanceName === target.instanceName,
          )
        : orderedGroups.length === 1
          ? orderedGroups[0]
          : undefined;
      if (!group) {
        return await block(
          target
            ? 'COMMERCIAL_AUTOMATION_TARGET_NOT_ELIGIBLE'
            : 'MULTIPLE_AUTHORIZED_GROUPS',
          {
            candidateCount: candidates.length,
            eligibleCount: ranked.length,
            rejectedCount: initialRejectedCount,
            rejectionSummary,
          },
        );
      }
      if (target) {
        const campaign = await this.options.campaigns.findById(
          target.campaignId,
        );
        if (
          !campaign ||
          !campaign.active ||
          !campaign.niche.active ||
          campaign.nicheId !== target.nicheId ||
          campaign.logicalGroupFingerprint !== group.fingerprint
        ) {
          return await block('COMMERCIAL_AUTOMATION_TARGET_NOT_ELIGIBLE', {
            candidateCount: candidates.length,
            eligibleCount: ranked.length,
            rejectedCount: initialRejectedCount,
            rejectionSummary,
          });
        }
      }
      const assignedInstanceName = requireAssignedInstanceName(group);
      await ensureRun(assignedInstanceName);
      const sentChecks = await Promise.all(
        ranked.map(({ product }) =>
          this.options.deliveryHistory.wasProductSentToGroup(
            product.id,
            group.id,
          ),
        ),
      );
      const neverSent = ranked.filter((_, index) => !sentChecks[index]);
      const alreadySentCount = ranked.length - neverSent.length;
      for (let index = 0; index < alreadySentCount; index += 1)
        incrementCommercialRejectionSummary(
          rejectionSummary,
          'ALREADY_SENT_TO_GROUP',
        );
      if (neverSent.length === 0) {
        return await block('PRODUCT_ALREADY_SENT', {
          candidateCount: candidates.length,
          eligibleCount: 0,
          rejectedCount: candidates.length,
          rejectionSummary,
        });
      }

      const selected = neverSent[0];
      const selectedScoreBreakdown = sanitizeCommercialScoreBreakdown(
        selected.score,
      );
      const affiliateLink = selected.product.affiliateLink as string;
      const copyPreview = this.options.copy.generate({
        productName: selected.product.productName,
        price: selected.product.price,
        discountRate: selected.product.discountRate,
        shopName: selected.product.shopName,
        affiliateLink,
      });
      const tracking = buildShopeeAffiliateTrackingMetadata({
        groupFingerprint: group.fingerprint,
        campaign: input.campaign,
        date: startedAt,
      });
      const plannedSubIds = toPlannedShopeeSubIds(
        this.options.subIdPrefix,
        tracking,
      );
      const selectionReasons = [
        `Politica de score: ${selectedScoreBreakdown.policyVersion}`,
        `Score final: ${selectedScoreBreakdown.finalScore}`,
        `Score minimo: ${input.minimumScore}`,
        ...Object.entries(selectedScoreBreakdown.components).map(
          ([name, value]) => `${name}: ${value}`,
        ),
        'Desempate deterministico por comissao, vendas, desconto, avaliacao e productId estavel',
        'Produto ainda nao enviado ao grupo autorizado',
      ];
      const rejectedCount = initialRejectedCount + alreadySentCount;

      const currentRun = await ensureRun(assignedInstanceName);
      await this.options.runs.update(currentRun.id, {
        status: 'COMPLETED',
        productId: selected.product.id,
        groupDestinationId: group.id,
        productName: selected.product.productName,
        productPrice: selected.product.price,
        groupName: group.name,
        groupFingerprint: group.fingerprint,
        instanceName: assignedInstanceName,
        score: selected.score.finalScore,
        scorePolicyVersion: scorePolicy.policyVersion,
        minimumScoreUsed: input.minimumScore,
        maximumScoreObserved,
        selectedScoreBreakdown,
        candidateCount: candidates.length,
        eligibleCount: neverSent.length,
        rejectedCount,
        rejectionSummary,
        selectionReasons,
        copyPreview,
        plannedSubIds,
        failureCode: null,
        completedAt: this.clock(),
      });
      this.options.logger.info(
        {
          event: 'commercial-pipeline.dry-run.completed',
          runId: currentRun.id,
          candidateCount: candidates.length,
          rejectedCount,
        },
        'Commercial pipeline dry-run completed',
      );

      return {
        runId: currentRun.id,
        mode: 'dry-run',
        status: 'ready',
        provider: input.source.toLocaleLowerCase() as
          'mock' | 'manual' | 'official',
        candidateCount: candidates.length,
        eligibleCount: neverSent.length,
        rejectedCount,
        rejectionSummary,
        scorePolicyVersion: scorePolicy.policyVersion,
        minimumScoreUsed: input.minimumScore,
        maximumScoreObserved,
        selectedScoreBreakdown,
        selectedProduct: {
          id: selected.product.id,
          name: selected.product.productName,
          price: selected.product.price,
          score: selected.score.finalScore,
          affiliateLinkPresent: true,
        },
        selectedGroup: {
          id: group.id,
          name: group.name,
          fingerprint: group.fingerprint,
        },
        selectionReasons,
        copyPreview,
        plannedSubIds,
        dispatchWillBeCreated: false,
        jobWillBeCreated: false,
        messageWillBeSent: false,
      };
    } catch (error) {
      if (!failureRecorded) {
        const failureCode =
          error instanceof AppError && error.code === 'INVALID_PIPELINE_FILTERS'
            ? error.code
            : 'COMMERCIAL_PIPELINE_FAILED';
        const currentRun = await ensureRun(input.instanceName ?? null);
        await this.options.runs.update(currentRun.id, {
          status: 'FAILED',
          failureCode,
          completedAt: this.clock(),
        });
        this.options.logger.error(
          {
            event: 'commercial-pipeline.dry-run.failed',
            runId: currentRun.id,
            code: failureCode,
          },
          'Commercial pipeline dry-run failed',
        );
      }
      if (error instanceof AppError) throw error;
      throw new AppError(
        'Falha segura no pipeline comercial',
        'COMMERCIAL_PIPELINE_FAILED',
      );
    }
  }

  async dryRunFromPromotionCandidate(
    input: CommercialPromotionCandidatePipelineSelection,
  ): Promise<CommercialPipelineDryRunResult> {
    const startedAt = this.clock();
    const tracking = buildShopeeAffiliateTrackingMetadata({
      groupFingerprint: input.group.fingerprint,
      campaign: input.campaign,
      date: startedAt,
    });
    const plannedSubIds = toPlannedShopeeSubIds(
      this.options.subIdPrefix,
      tracking,
    );
    const selectionReasons = [
      'Candidato selecionado pela fila de promocoes comerciais',
      `Politica de score: ${input.candidate.scorePolicyVersion}`,
      `Score final: ${input.candidate.commercialScore}`,
      `Score minimo: ${input.candidate.minimumScoreUsed}`,
      `Rank da fila: ${input.candidate.rankPosition ?? 'nao informado'}`,
    ];
    const assignedInstanceName = requireAssignedInstanceName(input.group);
    if (input.instanceName && input.instanceName !== assignedInstanceName) {
      throw new AppError(
        'Campanha comercial mudou de instancia atribuida',
        'COMMERCIAL_INSTANCE_ASSIGNMENT_CHANGED',
      );
    }
    await assertActiveCommercialInstance(
      this.options.instances,
      assignedInstanceName,
    );
    const run = await this.options.runs.create({
      mode: 'DRY_RUN',
      status: 'STARTED',
      executionId: input.executionId,
      instanceName: assignedInstanceName,
      candidateCount: input.candidateCount,
      eligibleCount: input.eligibleCount,
      rejectedCount: input.rejectedCount,
      rejectionSummary: input.rejectionSummary,
      selectionReasons: [],
      plannedSubIds: [],
      createdAt: startedAt,
      completedAt: null,
    });

    try {
      await this.options.runs.update(run.id, {
        status: 'COMPLETED',
        productId: input.candidate.productId,
        groupDestinationId: input.group.id,
        productName: input.candidate.productName,
        productPrice: input.candidate.price,
        groupName: input.group.name,
        groupFingerprint: input.group.fingerprint,
        score: input.candidate.commercialScore,
        scorePolicyVersion: input.candidate.scorePolicyVersion,
        minimumScoreUsed: input.candidate.minimumScoreUsed,
        maximumScoreObserved: input.candidate.commercialScore,
        selectedScoreBreakdown: input.candidate.scoreBreakdown,
        candidateCount: input.candidateCount,
        eligibleCount: input.eligibleCount,
        rejectedCount: input.rejectedCount,
        rejectionSummary: input.rejectionSummary,
        selectionReasons,
        copyPreview: input.copyPreview,
        plannedSubIds,
        failureCode: null,
        completedAt: this.clock(),
      });
      this.options.logger.info(
        {
          event: 'commercial-pipeline.candidate-dry-run.completed',
          runId: run.id,
          candidateId: input.candidate.id,
        },
        'Commercial pipeline candidate dry-run completed',
      );
      return {
        runId: run.id,
        mode: 'dry-run',
        status: 'ready',
        provider: 'official',
        candidateCount: input.candidateCount,
        eligibleCount: input.eligibleCount,
        rejectedCount: input.rejectedCount,
        rejectionSummary: input.rejectionSummary,
        scorePolicyVersion: input.candidate.scorePolicyVersion,
        minimumScoreUsed: input.candidate.minimumScoreUsed,
        maximumScoreObserved: input.candidate.commercialScore,
        selectedScoreBreakdown: input.candidate.scoreBreakdown,
        selectedProduct: {
          id: input.candidate.productId,
          name: input.candidate.productName,
          price: input.candidate.price,
          score: input.candidate.commercialScore,
          affiliateLinkPresent: true,
        },
        selectedGroup: input.group,
        selectionReasons,
        copyPreview: input.copyPreview,
        plannedSubIds,
        dispatchWillBeCreated: false,
        jobWillBeCreated: false,
        messageWillBeSent: false,
      };
    } catch (error) {
      await this.options.runs.update(run.id, {
        status: 'FAILED',
        failureCode: 'COMMERCIAL_PIPELINE_FAILED',
        completedAt: this.clock(),
      });
      this.options.logger.error(
        {
          event: 'commercial-pipeline.candidate-dry-run.failed',
          runId: run.id,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        },
        'Commercial pipeline candidate dry-run failed',
      );
      if (error instanceof AppError) throw error;
      throw new AppError(
        'Falha segura no pipeline comercial',
        'COMMERCIAL_PIPELINE_FAILED',
      );
    }
  }

  async listRuns(filters: CommercialPipelineRunFilters) {
    const result = await this.options.runs.list(filters);
    const items = await Promise.all(
      result.items.map(async (run) =>
        sanitizeCommercialPipelineRun(
          run,
          run.dispatchId && this.options.dispatches
            ? await this.options.dispatches.findByIdWithDetails(run.dispatchId)
            : null,
        ),
      ),
    );
    return {
      items,
      page: filters.page,
      limit: filters.limit,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / filters.limit)),
    };
  }

  async findRun(id: string) {
    const run = await this.options.runs.findById(id);
    if (!run)
      throw new AppError(
        'Execucao comercial nao encontrada',
        'COMMERCIAL_PIPELINE_RUN_NOT_FOUND',
      );
    const dispatch =
      run.dispatchId && this.options.dispatches
        ? await this.options.dispatches.findByIdWithDetails(run.dispatchId)
        : null;
    return sanitizeCommercialPipelineRun(run, dispatch);
  }
}
