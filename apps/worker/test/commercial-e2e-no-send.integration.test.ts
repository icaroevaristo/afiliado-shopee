import { describe, expect, it, vi } from 'vitest';
import { fingerprintWhatsAppGroupId, MockWhatsAppProvider } from '@shopee-auto-affiliate-ai/providers';
import {
  COMMERCIAL_AUTOMATION_JOB_OPTIONS,
  JOB_NAMES,
  type WhatsAppDispatchJob,
} from '@shopee-auto-affiliate-ai/queue';
import type { CommercialAiCopyProvider } from '../../api/src/commercial-ai-copy-provider';
import { CommercialAiCopyValidator } from '../../api/src/commercial-ai-copy-validator';
import { CommercialMessageDraftService } from '../../api/src/commercial-message-draft-service';
import { CommercialPromotionCopyGenerationService } from '../../api/src/commercial-promotion-copy-generation-service';
import { CommercialAutomationCandidateFlowService } from '../../api/src/commercial-automation-candidate-flow-service';
import { CommercialAutomationPolicyService } from '../../api/src/commercial-automation-policy-service';
import { validateCommercialAffiliateLinkProvenance } from '../../api/src/commercial-affiliate-link-provenance';
import { commercialProductRejections } from '../../api/src/commercial-offer-eligibility';
import { rankCommercialPromotionCandidates } from '../../api/src/commercial-promotion-ranking';
import { resolveShopeeProductIdentity } from '../../api/src/shopee-product-identity';
import { fingerprintCommercialOffer } from '../../api/src/commercial-offer-snapshot';
import {
  COMMERCIAL_AI_COPY_PROMPT_VERSION,
  COMMERCIAL_AI_COPY_VALIDATION_VERSION,
} from '../../api/src/commercial-ai-copy-prompt';
import { CommercialDispatchOutboxPublisher } from '../../api/src/commercial-dispatch-outbox-publisher';
import {
  COMMERCIAL_CONFIRMATION_TOKEN,
  CommercialPipelineConfirmationService,
} from '../../api/src/commercial-pipeline-confirmation-service';
import { WhatsAppGroupSendPolicy } from '../../api/src/whatsapp-group-send-policy';
import { processWhatsAppDispatchJob } from '../src/whatsapp-dispatch-worker';
import type { WhatsAppDispatchProcessorRepositories } from '../src/whatsapp-dispatch-worker';
import type {
  CommercialAiCopyClaimInput,
  CommercialAiCopyCompletionInput,
  CommercialCopyGenerationAttemptRecord,
  CommercialDispatchOutboxRecord,
  CommercialDispatchOutboxRepository,
  CommercialGroupCampaignRecord,
  CommercialPromotionCopyContext,
  CommercialPromotionCopyRepository,
  CommercialPipelineRunFinalizationRepository,
  CommercialPipelineRunRecord,
  CommercialPipelineRunRepository,
  CommercialPromotionRankedCandidate,
  GeneratedCopyRecord,
  ShopeeOfferRecord,
  WhatsAppDispatchDetails,
  WhatsAppDispatchRepository,
  WhatsAppDispatchRecord,
  WhatsAppGroupRecord,
} from '../../api/src/repositories';

const now = new Date('2026-08-08T12:00:00.000Z');
const productLink = 'https://shopee.com.br/product/1/1';
const affiliateLink = 'https://shope.ee/affiliate-product-1';
const groupDestination = '120363000000000000@g.us';

const group: WhatsAppGroupRecord = {
  id: 'group-1',
  name: 'Grupo comercial',
  destination: groupDestination,
  type: 'GROUP',
  active: true,
  available: true,
  fingerprint: fingerprintWhatsAppGroupId(groupDestination),
  sourceInstanceName: 'affiliate-bot',
  assignedInstanceName: 'affiliate-bot',
  discoveredAt: now,
  lastSyncedAt: now,
};

const offer: ShopeeOfferRecord = {
  id: 'product-1',
  source: 'OFFICIAL',
  providerProductId: 'official-product-1',
  productName: 'Produto comercial',
  shopName: 'Loja comercial',
  categoryIds: ['cat-1'],
  price: '99.90',
  priceMin: '99.90',
  priceMax: '99.90',
  discountRate: 20,
  rating: 4.8,
  sales: 100,
  commissionRate: 10,
  imageUrl: 'https://example.invalid/image.jpg',
  productLink,
  affiliateLink,
  fetchedAt: now,
  lastSeenAt: now,
  createdAt: now,
  updatedAt: now,
  score: 88,
  scoreUpdatedAt: now,
};

const createRun = (copyPreview: string): CommercialPipelineRunRecord => ({
  id: 'run-1',
  executionId: null,
  mode: 'DRY_RUN',
  status: 'COMPLETED',
  productId: offer.id,
  groupDestinationId: group.id,
  instanceName: 'affiliate-bot',
  productName: offer.productName,
  productPrice: offer.price,
  groupName: group.name,
  groupFingerprint: group.fingerprint,
  score: 88,
  candidateCount: 1,
  eligibleCount: 1,
  rejectedCount: 0,
  rejectionSummary: {},
  selectionReasons: ['candidate-flow'],
  copyPreview,
  plannedSubIds: [],
  dispatchId: null,
  jobId: null,
  confirmedAt: null,
  finalStatus: null,
  investigationRequired: false,
  failureCode: null,
  createdAt: now,
  completedAt: now,
});

const commercialFingerprint = fingerprintCommercialOffer({
  source: 'OFFICIAL',
  providerProductId: offer.providerProductId,
  productLink,
  affiliateLink,
  price: offer.price,
  priceMin: offer.priceMin,
  priceMax: offer.priceMax,
  discountRate: offer.discountRate,
  commissionRate: offer.commissionRate,
  offerStartsAt: null,
  offerEndsAt: null,
  unavailableAt: null,
});
const provenanceContext = () => ({
  candidate: {
    id: 'candidate-1',
    campaignId: 'campaign-1',
    productId: offer.id,
    snapshotId: 'snapshot-1',
  },
  campaign: { id: 'campaign-1' },
  product: {
    id: offer.id,
    source: offer.source,
    providerProductId: offer.providerProductId,
    productName: offer.productName,
    shopName: offer.shopName,
    productLink,
    affiliateLink,
    price: offer.price,
    priceMin: offer.priceMin,
    priceMax: offer.priceMax,
    discountRate: offer.discountRate,
    commissionRate: offer.commissionRate,
    rating: offer.rating,
    sales: offer.sales,
    offerStartsAt: null,
    offerEndsAt: null,
    unavailableAt: null,
    commercialSnapshotRevision: 1,
    commercialSnapshotFingerprint: commercialFingerprint,
    updatedAt: now,
  },
  snapshot: {
    id: 'snapshot-1',
    productId: offer.id,
    revision: 1,
    fingerprint: commercialFingerprint,
  },
});

const policyTarget = {
  groupId: group.id,
  groupName: group.name,
  instanceName: 'affiliate-bot',
  logicalGroupFingerprint: group.fingerprint,
  campaignId: 'campaign-1',
  nicheId: 'niche-1',
  dailyLimit: 5,
};

const policyStatus = async ({
  selectedGroup = group,
  globalSentToday = 0,
  groupSentToday = 0,
  groupLastSentAt = null,
}: {
  selectedGroup?: WhatsAppGroupRecord;
  globalSentToday?: number;
  groupSentToday?: number;
  groupLastSentAt?: Date | null;
} = {}) => {
  const settings = {
    paused: false,
    pausedAt: null,
    resumedAt: now,
    updatedAt: now,
  };
  const policy = new CommercialAutomationPolicyService({
    settings: {
      get: async () => settings,
      getOrCreate: async () => settings,
      setPaused: async () => settings,
    },
    history: {
      getSnapshot: async () => ({
        globalSentToday,
        groupSentToday,
        lastSentAt: groupLastSentAt,
        globalLastSentAt: groupLastSentAt,
        groupLastSentAt,
      }),
      hasAmbiguousCommercialExecution: async () => false,
      hasActiveCommercialExecution: async () => false,
      hasStaleCommercialExecution: async () => false,
    },
    groups: { list: async () => [selectedGroup] },
    instances: {
      findByName: async (name: string) => ({
        name,
        active: true,
        createdAt: now,
        updatedAt: now,
      }),
    },
    instanceName: 'affiliate-bot',
    config: {
      enabled: true,
      timezone: 'America/Sao_Paulo',
      allowedStartTime: '00:00',
      allowedEndTime: '23:59',
      dailyGlobalLimit: 10,
      dailyGroupLimit: 5,
      minimumIntervalMinutes: 15,
    },
    clock: () => now,
  });
  return policy.evaluateAutomationReadiness({ target: policyTarget });
};
const campaignFor = (
  targetGroup: WhatsAppGroupRecord,
  overrides: Partial<CommercialGroupCampaignRecord> = {},
): CommercialGroupCampaignRecord => ({
  id: `campaign-${targetGroup.id}`,
  name: `Campanha ${targetGroup.name}`,
  logicalGroupFingerprint: targetGroup.fingerprint,
  anchorDestinationId: targetGroup.id,
  nicheId: 'niche-1',
  active: true,
  cadenceMinutes: 15,
  timezone: 'America/Sao_Paulo',
  allowedStartTime: '00:00',
  allowedEndTime: '23:59',
  dailyLimit: 5,
  failureCount: 0,
  nextEligibleAt: null,
  attemptExecutionId: null,
  attemptReservedAt: null,
  attemptLeaseExpiresAt: null,
  queueTargetSize: 10,
  dedupeDays: 30,
  niche: { id: 'niche-1', name: 'Ofertas', slug: 'ofertas', active: true },
  anchorDestination: {
    id: targetGroup.id,
    name: targetGroup.name,
    fingerprint: targetGroup.fingerprint,
    active: targetGroup.active,
    available: targetGroup.available,
  },
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const listTargetsWithRealFairness = async ({
  groups,
  campaigns,
  lastSentAtByGroup = new Map<string, Date | null>(),
}: {
  groups: WhatsAppGroupRecord[];
  campaigns: CommercialGroupCampaignRecord[];
  lastSentAtByGroup?: Map<string, Date | null>;
}) => {
  const flow = new CommercialAutomationCandidateFlowService({
    groups: { list: async () => groups },
    campaigns: {
      list: vi.fn(),
      findByLogicalGroupFingerprint: async (fingerprint: string) =>
        campaigns.find(
          (campaign) => campaign.logicalGroupFingerprint === fingerprint,
        ) ?? null,
    },
    candidates: { listQueue: vi.fn() },
    deliveryHistory: {
      wasProductSentToGroup: vi.fn(),
      findLastSentAtByGroup: async (groupId: string) =>
        lastSentAtByGroup.get(groupId) ?? null,
    },
    copies: { loadContext: vi.fn(), findCopyForCandidate: vi.fn() },
    mining: { mine: vi.fn() },
    copyGeneration: {
      preview: vi.fn(),
      generate: vi.fn(),
      findCopy: vi.fn(),
    },
    draft: { createDraft: vi.fn() },
    pipeline: { dryRunFromPromotionCandidate: vi.fn() },
    instances: {
      findByName: async (name: string) => ({
        name,
        active: true,
        createdAt: now,
        updatedAt: now,
      }),
    },
    instanceName: 'affiliate-bot',
    clock: () => now,
  });
  return flow.listTargets();
};
const copyContextFixture = (deliveryImageUrl = offer.imageUrl): CommercialPromotionCopyContext => {
  const niche = {
    id: 'niche-1', name: 'Ofertas', slug: 'ofertas', active: true,
    categoryIds: [], includeKeywords: [], excludeKeywords: [],
    minPrice: null, maxPrice: null, minDiscountRate: 0, minRating: 0,
    minSales: 0, minCommissionRate: 0, minimumScore: 60,
    createdAt: now, updatedAt: now,
  };
  return {
    candidate: {
      id: 'candidate-1', campaignId: 'campaign-1', productId: offer.id,
      snapshotId: 'snapshot-1', generatedCopyId: null, status: 'QUEUED',
      rankPosition: 1, commercialScore: 88, scorePolicyVersion: 'official-v2',
      minimumScoreUsed: 60,
      scoreBreakdown: { policyVersion: 'official-v2', rawTotal: 88, finalScore: 88, components: { promotion: 88 } },
      promotionSignals: ['PRICE_DROP'], priceDropPercent: '10', queuedAt: now,
      lastEvaluatedAt: now, expiresAt: null, dedupeUntil: null,
      blockedReason: null, createdAt: now, updatedAt: now,
    },
    campaign: {
      ...campaignFor(group), id: 'campaign-1',
      niche: { id: niche.id, name: niche.name, slug: niche.slug, active: true },
    },
    niche,
    product: {
      id: offer.id, source: offer.source, providerProductId: offer.providerProductId,
      productName: offer.productName, shopName: offer.shopName, productLink,
      affiliateLink, price: offer.price, priceMin: offer.priceMin ?? null,
      priceMax: offer.priceMax ?? null, discountRate: offer.discountRate,
      commissionRate: offer.commissionRate, rating: offer.rating, sales: offer.sales,
      offerStartsAt: null, urlImagem: deliveryImageUrl, offerEndsAt: null,
      unavailableAt: null, commercialSnapshotRevision: 1,
      commercialSnapshotFingerprint: commercialFingerprint, updatedAt: now,
    },
    snapshot: {
      id: 'snapshot-1', productId: offer.id, revision: 1,
      fingerprint: commercialFingerprint, price: offer.price,
      priceMin: offer.priceMin ?? null, priceMax: offer.priceMax ?? null,
      discountRate: offer.discountRate, commissionRate: offer.commissionRate,
      observedRating: offer.rating, observedSales: offer.sales,
      offerStartsAt: null, offerEndsAt: null, unavailableAt: null,
      capturedAt: now, createdAt: now,
    },
    previousSnapshot: null,
  };
};
class MemoryE2ECopyRepository implements CommercialPromotionCopyRepository {
  readonly copies = new Map<string, GeneratedCopyRecord>();
  readonly attempts = new Map<string, CommercialCopyGenerationAttemptRecord>();

  constructor(readonly context: CommercialPromotionCopyContext) {}

  async loadContext(candidateId: string) {
    return candidateId === this.context.candidate.id ? this.context : null;
  }
  async findCopyByInputFingerprint(inputFingerprint: string) {
    return this.copies.get(inputFingerprint) ?? null;
  }
  async findAttemptByInputFingerprint(inputFingerprint: string) {
    return this.attempts.get(inputFingerprint) ?? null;
  }
  async findAttemptByGenerationContract(input: {
    candidateId: string; snapshotId: string; inputFingerprint: string;
    provider: string; model: string; promptVersion: string; validationVersion: string;
  }) {
    const attempt = this.attempts.get(input.inputFingerprint) ?? null;
    if (!attempt) return null;
    return attempt.candidateId === input.candidateId &&
      attempt.snapshotId === input.snapshotId &&
      attempt.provider === input.provider &&
      attempt.model === input.model &&
      attempt.promptVersion === input.promptVersion &&
      attempt.validationVersion === input.validationVersion ? attempt : null;
  }
  async listAttemptsByCandidateId(candidateId: string) {
    return [...this.attempts.values()].filter((attempt) => attempt.candidateId === candidateId);
  }
  async claim(input: CommercialAiCopyClaimInput) {
    if (this.attempts.has(input.inputFingerprint)) return false;
    this.attempts.set(input.inputFingerprint, {
      id: 'attempt-phase9', candidateId: input.candidateId, snapshotId: input.snapshotId,
      inputFingerprint: input.inputFingerprint, provider: input.provider, model: input.model,
      promptVersion: input.promptVersion, validationVersion: input.validationVersion,
      startedAt: input.startedAt, status: 'STARTED', generatedCopyId: null,
      failureCode: null, requestMayHaveStarted: false, providerHttpStatus: null,
      providerErrorCode: null, providerErrorType: null, providerErrorParam: null,
      inputTokens: null, outputTokens: null, totalTokens: null,
      validationFailureCodes: [], completedAt: null,
      createdAt: input.startedAt, updatedAt: input.startedAt,
    });
    return true;
  }
  async linkCachedCopy(input: Parameters<CommercialPromotionCopyRepository['linkCachedCopy']>[0]) {
    this.context.candidate.status = 'COPY_READY';
    this.context.candidate.generatedCopyId = input.copyId;
    return true;
  }  async complete(input: CommercialAiCopyCompletionInput) {
    const attempt = this.attempts.get(input.inputFingerprint);
    if (!attempt) return { completed: false as const, failureCode: 'PHASE9_ATTEMPT_MISSING' };
    const copy: GeneratedCopyRecord = {
      id: 'copy-phase9',
      ...input.copy,
      createdAt: input.completedAt,
    };
    this.copies.set(input.inputFingerprint, copy);
    attempt.status = 'SUCCEEDED';
    attempt.generatedCopyId = copy.id;
    attempt.completedAt = input.completedAt;
    attempt.updatedAt = input.completedAt;
    this.context.candidate.status = 'COPY_READY';
    this.context.candidate.generatedCopyId = copy.id;
    return { completed: true as const, copy };
  }

  async markAttemptTerminal(
    input: Parameters<CommercialPromotionCopyRepository['markAttemptTerminal']>[0],
  ) {
    const attempt = this.attempts.get(input.inputFingerprint);
    if (!attempt || attempt.status !== 'STARTED') return false;
    Object.assign(attempt, input, { updatedAt: input.completedAt });
    return true;
  }

  async findCopyForCandidate(candidateId: string) {
    if (candidateId !== this.context.candidate.id || !this.context.candidate.generatedCopyId) return null;
    const copy = [...this.copies.values()].find(
      ({ id }) => id === this.context.candidate.generatedCopyId,
    );
    return copy
      ? { candidate: this.context.candidate, copy, snapshotRevision: this.context.snapshot.revision }
      : null;
  }
}

const phase9CopyProvider = (): CommercialAiCopyProvider => ({
  generate: vi.fn().mockResolvedValue({
    output: {
      headline: 'OFERTA CONFIÁVEL',
      body: 'Uma escolha prática para sua rotina.',
    },
    provider: 'openai',
    model: 'phase9-model',
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, reasoningTokens: 0 },
  }),
});

const phase9CopyService = (
  repository: CommercialPromotionCopyRepository,
  provider: CommercialAiCopyProvider,
) => new CommercialPromotionCopyGenerationService({
  repository,
  provider,
  config: {
    enabled: true,
    provider: 'openai',
    model: 'phase9-model',
    apiKeyConfigured: true,
    timeoutMs: 30_000,
    maxOutputTokens: 300,
    reasoningEffort: 'minimal',
    maximumCopyLength: 1_000,
  },
  clock: () => now,
});
const phase9DraftFor = (
  context: CommercialPromotionCopyContext,
  copy: GeneratedCopyRecord,
) =>
  new CommercialMessageDraftService().createDraft({
    id: context.candidate.id,
    productId: context.candidate.productId,
    snapshotId: context.candidate.snapshotId,
    generatedCopyId: context.candidate.generatedCopyId ?? null,
    status: context.candidate.status,
    expiresAt: context.candidate.expiresAt,
    product: {
      id: context.product.id,
      unavailableAt: context.product.unavailableAt,
      affiliateLink: context.product.affiliateLink,
      urlImagem: context.product.urlImagem ?? '',
      commercialSnapshotRevision: context.product.commercialSnapshotRevision,
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
  });
describe('Phase 9 E2E local sem SEND', () => {
  it.each([
    { deliveryMode: 'IMAGE' as const, imageUrl: offer.imageUrl },
    { deliveryMode: 'TEXT' as const, imageUrl: '' },
  ])('gera Copy V10 real e draft $deliveryMode com provider AI mockado', async ({ deliveryMode, imageUrl }) => {
    const repository = new MemoryE2ECopyRepository(copyContextFixture(imageUrl));
    const provider = phase9CopyProvider();
    const copyService = phase9CopyService(repository, provider);

    const first = await copyService.generate('candidate-1', 'GERAR_COPY_COM_IA');
    const second = await copyService.generate('candidate-1', 'GERAR_COPY_COM_IA');
    expect(first).toMatchObject({ status: 'COPY_READY', cacheHit: false });
    expect(second).toMatchObject({ status: 'COPY_READY', cacheHit: true });
    expect(provider.generate).toHaveBeenCalledTimes(1);

    const linked = await repository.findCopyForCandidate('candidate-1');
    expect(linked).not.toBeNull();
    const context = repository.context;
    const copy = linked?.copy;
    if (!copy) throw new Error('phase9 generated copy missing');
    expect(copy.promptVersion).toBe(COMMERCIAL_AI_COPY_PROMPT_VERSION);
    expect(copy.validationVersion).toBe(COMMERCIAL_AI_COPY_VALIDATION_VERSION);
    expect(copy.createdFromCandidateId).toBe('candidate-1');
    expect(copy.productId).toBe(offer.id);
    expect(copy.snapshotId).toBe('snapshot-1');

    const draft = new CommercialMessageDraftService().createDraft({
      id: context.candidate.id,
      productId: context.candidate.productId,
      snapshotId: context.candidate.snapshotId,
      generatedCopyId: context.candidate.generatedCopyId ?? null,
      status: context.candidate.status,
      expiresAt: context.candidate.expiresAt,
      product: {
        id: context.product.id,
        unavailableAt: context.product.unavailableAt,
        affiliateLink: context.product.affiliateLink,
        urlImagem: context.product.urlImagem ?? '',
        commercialSnapshotRevision: context.product.commercialSnapshotRevision,
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
    });
    expect(draft.deliveryMode).toBe(deliveryMode);
    expect(draft.candidateId).toBe('candidate-1');
    expect(draft.generatedCopyId).toBe(copy.id);
    expect(draft.caption.split(affiliateLink)).toHaveLength(2);
    if (deliveryMode === 'IMAGE') expect(draft.imageUrl).toBe(imageUrl);
    else expect(draft.imageUrl).toBeNull();
  });
  describe('fail-closed upstream e target policy', () => {
    it('1 produto inelegivel para antes de candidate', () => {
      const invalidOffer = { ...offer, affiliateLink: undefined };
      expect(commercialProductRejections(invalidOffer, now)).toContain(
        'MISSING_AFFILIATE_LINK',
      );
    });

    it('2 nenhum candidate elegivel permanece vazio', () => {
      expect(rankCommercialPromotionCandidates([])).toEqual([]);
    });

    it('3 target inativo falha antes do provider', () => {
      const policy = new WhatsAppGroupSendPolicy({
        enabled: true,
        safeMode: true,
        instanceName: 'affiliate-bot',
      });
      expect(() => policy.assertAuthorized({ ...group, active: false })).toThrow();
    });

    it('4 target indisponivel falha antes do provider', () => {
      const policy = new WhatsAppGroupSendPolicy({
        enabled: true,
        safeMode: true,
        instanceName: 'affiliate-bot',
      });
      expect(() => policy.assertAuthorized({ ...group, available: false })).toThrow();
    });

    it('5 instance divergente falha antes do provider', () => {
      const policy = new WhatsAppGroupSendPolicy({
        enabled: true,
        safeMode: true,
        instanceName: 'affiliate-bot',
      });
      expect(() =>
        policy.assertAuthorized({
          ...group,
          assignedInstanceName: 'other-instance',
        }),
      ).toThrow();
    });

    it('6 fingerprint fisico divergente falha antes do provider', () => {
      const policy = new WhatsAppGroupSendPolicy({
        enabled: true,
        safeMode: true,
        instanceName: 'affiliate-bot',
      });
      expect(() =>
        policy.assertAuthorized({ ...group, fingerprint: 'grp_aaaaaaaaaaaa' }),
      ).toThrow();
    });

    it('7 daily limit bloqueia o target', async () => {
      const status = await policyStatus({ groupSentToday: 5 });
      expect(status.allowed).toBe(false);
      expect(status.reasons).toContain('GROUP_DAILY_LIMIT_REACHED');
    });

    it('8 minimum interval bloqueia o target', async () => {
      const status = await policyStatus({
        groupLastSentAt: new Date(now.getTime() - 5 * 60_000),
      });
      expect(status.allowed).toBe(false);
      expect(status.reasons).toContain('MINIMUM_INTERVAL_NOT_REACHED');
    });

    it('9 nextEligibleAt futuro remove o target sem trocar silenciosamente', async () => {
      const campaign = campaignFor(group, {
        nextEligibleAt: new Date(now.getTime() + 60_000),
      });
      await expect(
        listTargetsWithRealFairness({ groups: [group], campaigns: [campaign] }),
      ).rejects.toMatchObject({ code: 'COMMERCIAL_AUTOMATION_NO_ELIGIBLE_TARGET' });
    });

    it('fairness real independe da ordem fisica dos grupos', async () => {
      const secondDestination = '120363000000000001@g.us';
      const secondGroup: WhatsAppGroupRecord = {
        ...group,
        id: 'group-2',
        name: 'Grupo comercial 2',
        destination: secondDestination,
        fingerprint: fingerprintWhatsAppGroupId(secondDestination),
      };
      const campaigns = [campaignFor(group), campaignFor(secondGroup)];
      const lastSent = new Map<string, Date | null>([
        [group.id, new Date(now.getTime() - 60_000)],
        [secondGroup.id, null],
      ]);
      const forward = await listTargetsWithRealFairness({
        groups: [group, secondGroup],
        campaigns,
        lastSentAtByGroup: lastSent,
      });
      const reversed = await listTargetsWithRealFairness({
        groups: [secondGroup, group],
        campaigns,
        lastSentAtByGroup: lastSent,
      });
      expect(forward.map(({ groupId }) => groupId)).toEqual([
        secondGroup.id,
        group.id,
      ]);
      expect(reversed.map(({ groupId }) => groupId)).toEqual(
        forward.map(({ groupId }) => groupId),
      );
    });
  });

  describe('fail-closed provenance e copy', () => {
    it('10 affiliateLink ausente falha provenance', () => {
      const context = provenanceContext();
      context.product.affiliateLink = '';
      expect(validateCommercialAffiliateLinkProvenance(context)).toMatchObject({
        valid: false,
      });
    });

    it('11 affiliateLink com provenance invalida falha fechado', () => {
      const context = provenanceContext();
      context.product.productLink = 'ftp://invalid.local/product';
      expect(validateCommercialAffiliateLinkProvenance(context)).toMatchObject({
        valid: false,
      });
    });

    it('12 snapshot fingerprint divergente falha fechado', () => {
      const context = provenanceContext();
      context.snapshot.fingerprint = 'fingerprint-divergente';
      expect(validateCommercialAffiliateLinkProvenance(context)).toMatchObject({
        valid: false,
      });
    });

    it('13 Copy V10 invalida e rejeitada pelo validator real', () => {
      const result = new CommercialAiCopyValidator().validate(
        {
          headline: 'Oferta',
          body: 'Corpo valido',
          cta: 'Confira',
          hashtags: ['#Oferta'],
          inventedField: 'nao permitido',
        },
        offer.productName,
      );
      expect(result.valid).toBe(false);
    });
  });
  it.each([
    { deliveryMode: 'IMAGE' as const, deliveryImageUrl: offer.imageUrl },
    { deliveryMode: 'TEXT' as const, deliveryImageUrl: '' },
  ])(
    'compoe identidade, ranking e lifecycle $deliveryMode sem efeito externo',
    async ({ deliveryMode, deliveryImageUrl }) => {
      const identity = resolveShopeeProductIdentity(offer);
      expect(identity).toMatchObject({
        key: 'OFFICIAL:' + offer.providerProductId,
        source: 'OFFICIAL',
        providerProductId: offer.providerProductId,
      });
      expect(commercialProductRejections(offer, now)).toEqual([]);
      const rankedBase: CommercialPromotionRankedCandidate = {
        productId: offer.id,
        snapshotId: 'snapshot-1',
        snapshotRevision: 1,
        snapshotFingerprint: commercialFingerprint,
        expectedProductUpdatedAt: offer.updatedAt,
        commercialScore: 88,
        scorePolicyVersion: 'official-v2',
        minimumScoreUsed: 60,
        scoreBreakdown: {
          policyVersion: 'official-v2',
          rawTotal: 88,
          finalScore: 88,
          components: { promotion: 88 },
        },
        promotionSignals: ['PRICE_DROP'],
        priceDropPercent: '10',
        discountRate: offer.discountRate,
        commissionRate: offer.commissionRate,
        sales: offer.sales,
        expiresAt: null,
        expectedCandidateStatus: null,
        expectedDedupeUntil: null,
        expectedCandidateUpdatedAt: null,
      };
      const lowerRanked: CommercialPromotionRankedCandidate = {
        ...rankedBase,
        productId: 'product-lower-ranked',
        snapshotId: 'snapshot-lower-ranked',
        commercialScore: 70,
        priceDropPercent: '5',
      };
      const forward = rankCommercialPromotionCandidates([lowerRanked, rankedBase]);
      const reversed = rankCommercialPromotionCandidates([rankedBase, lowerRanked]);
      expect(forward.map(({ productId }) => productId)).toEqual([
        offer.id,
        'product-lower-ranked',
      ]);
      expect(reversed.map(({ productId }) => productId)).toEqual(
        forward.map(({ productId }) => productId),
      );
    const endToEndCopyRepository = new MemoryE2ECopyRepository(
      copyContextFixture(deliveryImageUrl),
    );
    const endToEndCopyProvider = phase9CopyProvider();
    const endToEndCopyService = phase9CopyService(
      endToEndCopyRepository,
      endToEndCopyProvider,
    );
    const generated = await endToEndCopyService.generate(
      'candidate-1',
      'GERAR_COPY_COM_IA',
    );
    expect(generated).toMatchObject({ status: 'COPY_READY', cacheHit: false });
    expect(endToEndCopyProvider.generate).toHaveBeenCalledOnce();
    const linkedEndToEndCopy = await endToEndCopyRepository.findCopyForCandidate(
      'candidate-1',
    );
    if (!linkedEndToEndCopy) throw new Error('phase9 linked E2E copy missing');
    const endToEndCopy = linkedEndToEndCopy.copy;
    const generatedCopyId = endToEndCopy.id;
    const endToEndDraft = phase9DraftFor(
      endToEndCopyRepository.context,
      endToEndCopy,
    );
    expect(endToEndDraft.deliveryMode).toBe(deliveryMode);
    expect(endToEndCopy.productId).toBe(offer.id);
    expect(endToEndCopy.snapshotId).toBe('snapshot-1');
    expect(endToEndCopy.createdFromCandidateId).toBe('candidate-1');
    let candidateStatus: 'COPY_READY' | 'RESERVED' | 'DISPATCHED' =
      'COPY_READY';
    const caption = `Oferta validada\n\nConfira: ${affiliateLink}`;
    let run = createRun(caption);
    let dispatch: WhatsAppDispatchRecord | null = null;
    let outbox: CommercialDispatchOutboxRecord | null = null;
    const legacyCopies: unknown[] = [];
    const jobs = new Set<string>();

    const candidate = () => ({
      id: 'candidate-1',
      campaignId: 'campaign-1',
      campaign: {
        id: 'campaign-1',
        logicalGroupFingerprint: group.fingerprint,
      },
      productId: offer.id,
      snapshotId: 'snapshot-1',
      generatedCopyId: generatedCopyId,
      status: candidateStatus,
      expiresAt: null,
      product: {
        id: offer.id,
        source: offer.source,
        providerProductId: offer.providerProductId,
        productName: offer.productName,
        shopName: offer.shopName,
        productLink,
        affiliateLink,
        price: offer.price,
        priceMin: offer.priceMin,
        priceMax: offer.priceMax,
        discountRate: offer.discountRate,
        commissionRate: offer.commissionRate,
        rating: offer.rating,
        sales: offer.sales,
        offerStartsAt: null,
        urlImagem: deliveryImageUrl,
        offerEndsAt: null,
        unavailableAt: null,
        commercialSnapshotRevision: 1,
        commercialSnapshotFingerprint: commercialFingerprint,
        updatedAt: now,
      },
      snapshot: {
        id: 'snapshot-1',
        productId: offer.id,
        revision: 1,
        fingerprint: commercialFingerprint,
        unavailableAt: null,
        offerEndsAt: null,
      },
    });
    const generatedCopy = (): WhatsAppDispatchDetails['generatedCopy'] => ({
      id: generatedCopyId,
      productId: offer.id,
      snapshotId: 'snapshot-1',
      createdFromCandidateId: 'candidate-1',
      source: 'AI',
      promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
      validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
      titulo: 'Oferta validada',
      mensagem: 'Produto com dados atuais.',
      cta: `Confira: ${affiliateLink}`,
      hashtags: '#oferta',
      promotionCandidates: [candidate()],
    });

    const dispatchDetails = (): WhatsAppDispatchDetails => ({
      id: dispatch?.id ?? 'dispatch-1',
      productId: offer.id,
      generatedCopyId: generatedCopyId,
      destinationId: group.id,
      instanceName: 'affiliate-bot',
      status: dispatch?.status ?? 'PENDING',
      attemptCount: dispatch?.attemptCount ?? 0,
      errorMessage: dispatch?.errorMessage ?? null,
      sentAt: dispatch?.sentAt ?? null,
      externalMessageId: dispatch?.externalMessageId ?? null,
      createdAt: now,
      updatedAt: now,
      destination: group,
      product: {
        comissao: offer.commissionRate,
        urlImagem: deliveryImageUrl,
        affiliateLink: offer.affiliateLink,
      },
      generatedCopy: generatedCopy(),
    });

    const runs: CommercialPipelineRunRepository &
      CommercialPipelineRunFinalizationRepository = {
      create: vi.fn(),
      update: vi.fn(async (_id, data) => {
        run = { ...run, ...data };
        return run;
      }),
      list: vi.fn(),
      findById: vi.fn(async (id) => (id === run.id ? run : null)),
      findByDispatchId: vi.fn(async (id) =>
        id === (dispatch?.id ?? 'dispatch-1') ? run : null,
      ),
      finalizeByDispatchId: vi.fn(async (_dispatchId, completedAt) => {
        if (!dispatch || dispatch.status !== 'SENT') {
          return { kind: 'AMBIGUOUS' as const, transitioned: false };
        }
        run = {
          ...run,
          status: 'COMPLETED',
          finalStatus: 'SENT',
          investigationRequired: false,
          failureCode: null,
          completedAt,
        };
        return { kind: 'SENT' as const, transitioned: true };
      }),
    };

    const outboxes: CommercialDispatchOutboxRepository = {
      createPendingConfirmation: vi.fn(async (input) => {
        if (
          run.mode !== 'DRY_RUN' ||
          run.status !== 'COMPLETED' ||
          candidateStatus !== 'COPY_READY'
        ) {
          return null;
        }
        if ('copy' in input) legacyCopies.push(input.copy);
        if (
          !('existingGeneratedCopyId' in input) ||
          input.existingGeneratedCopyId !== generatedCopyId
        ) {
          throw new Error('candidate copy was not reused');
        }
        candidateStatus = 'RESERVED';
        dispatch = {
          ...input.dispatch,
          status: 'PENDING',
          attemptCount: 0,
          errorMessage: null,
          sentAt: null,
          externalMessageId: null,
          createdAt: now,
          updatedAt: now,
        };
        outbox = {
          id: input.outboxId,
          commercialRunId: input.runId,
          dispatchId: input.dispatch.id,
          jobId: input.jobId,
      status: 'PENDING',
      instanceName: input.instanceName,
      failureCode: null,
          createdAt: input.confirmedAt,
          publishedAt: null,
        };
        run = {
          ...run,
          mode: 'CONFIRMED',
          status: 'STARTED',
          confirmedAt: input.confirmedAt,
          completedAt: null,
          dispatchId: input.dispatch.id,
          jobId: null,
          finalStatus: 'PENDING',
          investigationRequired: false,
          failureCode: null,
        };
        return outbox;
      }),
      list: vi.fn(async () => ({
        items: outbox ? [outbox] : [],
        total: outbox ? 1 : 0,
      })),
      findById: vi.fn(async (id) => (outbox?.id === id ? outbox : null)),
      findByDispatchId: vi.fn(async (id) =>
        outbox?.dispatchId === id ? outbox : null,
      ),
      findPublicationContext: vi.fn(async () =>
        outbox && dispatch
          ? { outbox, run, dispatch }
          : null,
      ),
      markPublished: vi.fn(async (id, publishedAt) => {
        if (!outbox || outbox.id !== id) return null;
        outbox = { ...outbox, status: 'PUBLISHED', publishedAt };
        run = { ...run, jobId: outbox.jobId };
        return outbox;
      }),
      markAmbiguous: vi.fn(async () => outbox),
    };

    const queue = {
      hasJob: vi.fn(async (jobId: string) => jobs.has(jobId)),
      enqueue: vi.fn(async (_dispatchId: string, jobId: string) => {
        jobs.add(jobId);
      }),
    };
    const confirmation = new CommercialPipelineConfirmationService({
      runs,
      offers: { findOfferById: vi.fn(async () => offer) } as never,
      groups: { list: vi.fn(async () => [group]) } as never,
      instances: {
        findByName: vi.fn(async (name: string) => ({
          name,
          active: true,
          createdAt: now,
          updatedAt: now,
        })),
      },
      outboxes,
      deliveryHistory: {
        wasProductSentToGroup: vi.fn(async () => false),
        findLastSentAtByGroup: vi.fn(async () => null),
      },
      copy: { generate: vi.fn(() => caption) },
      publisher: new CommercialDispatchOutboxPublisher({
        outboxes,
        queue,
        logger: { info: vi.fn(), error: vi.fn() },
        clock: () => now,
      }),
      instanceName: 'affiliate-bot',
      environment: {
        groupSendEnabled: true,
        safeMode: true,
        schedulerEnabled: false,
        maximumMessagesPerRun: 1,
      },
      logger: { info: vi.fn(), error: vi.fn() },
      clock: () => now,
    });

    await confirmation.confirm('run-1', COMMERCIAL_CONFIRMATION_TOKEN, {
      existingGeneratedCopyId: generatedCopyId,
    });

    expect(candidateStatus).toBe('RESERVED');
    expect(outbox).toMatchObject({ status: 'PUBLISHED' });
    expect(legacyCopies).toHaveLength(0);

    const markAttemptPending = vi.fn(async () => {
      if (!dispatch || dispatch.status !== 'PENDING') return false;
      dispatch = { ...dispatch, status: 'PROCESSING', attemptCount: 1 };
      return true;
    });
    const markSent = vi.fn(
      async (
        _id: string,
        data: Parameters<WhatsAppDispatchRepository['markSent']>[1],
      ): Promise<WhatsAppDispatchRecord> => {
        const currentDispatch = dispatch;
        if (!currentDispatch) throw new Error('dispatch missing');
        const updatedDispatch: WhatsAppDispatchRecord = {
          ...currentDispatch,
          ...data,
          status: 'SENT',
          attemptCount: 1,
        };
        dispatch = updatedDispatch;
        return updatedDispatch;
      },
    );
    const markDispatchedByGeneratedCopyId = vi.fn(async () => {
      if (candidateStatus !== 'RESERVED') {
        throw new Error('unexpected candidate lifecycle');
      }
      candidateStatus = 'DISPATCHED';
      return {
        kind: 'DISPATCHED' as const,
        candidateId: 'candidate-1',
        campaignId: 'campaign-1',
        transitioned: true,
      };
    });
    const markBlockedByGeneratedCopyId = vi.fn(async () => {
      throw new Error('unexpected safe failure finalization');
    });
    const resetCampaignFailureStateByGeneratedCopyId = vi.fn(async () => ({
      kind: 'RESET' as const,
      campaignId: 'campaign-1',
      transitioned: true,
    }));
    const whatsappDispatches = {
      findByIdForSending: vi.fn(async () => dispatchDetails()),
      findByIdWithDetails: vi.fn(async () => dispatchDetails()),
      markAttemptPending,
      markSent,
      markFailed: vi.fn(),
      createPending: vi.fn(),
      list: vi.fn(),
    };
    const repositories: WhatsAppDispatchProcessorRepositories = {
      whatsappDispatches,
      commercialRuns: runs,
      commercialDispatchOutboxes: outboxes,
      whatsappInstances: {
        findByName: vi.fn(async (name: string) => ({
          name,
          active: true,
          createdAt: now,
          updatedAt: now,
        })),
      },
      commercialPromotions: {
        markDispatchedByGeneratedCopyId,
        markBlockedByGeneratedCopyId,
        resetCampaignFailureStateByGeneratedCopyId,
      },
    };
    const provider = new MockWhatsAppProvider();
    const groupSendPolicy = new WhatsAppGroupSendPolicy({
      enabled: true,
      safeMode: true,
      instanceName: 'affiliate-bot',
    });
    vi.spyOn(groupSendPolicy, 'assertAuthorized').mockImplementation(
      () => undefined,
    );
    const job: Pick<
      import('bullmq').Job<WhatsAppDispatchJob>,
      'id' | 'name' | 'data'
    > = {
      id: 'job-1',
      name: JOB_NAMES.whatsappDispatch,
      data: {
        dispatchId: 'commercial-run-1-dispatch',
        instanceName: 'affiliate-bot',
      },
    };

    await processWhatsAppDispatchJob(job, {
      repositories,
      whatsAppProvider: provider,
      whatsAppProviderResolver: vi.fn().mockResolvedValue(provider),
      groupSendPolicy,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(candidateStatus).toBe('DISPATCHED');
    expect(dispatch).toMatchObject({ status: 'SENT', attemptCount: 1 });
    expect(run).toMatchObject({
      status: 'COMPLETED',
      finalStatus: 'SENT',
      investigationRequired: false,
    });
    expect(provider.sentMessages).toHaveLength(1);
    expect(provider.sentMessages[0]).toMatchObject({
      destination: groupDestination,
      destinationType: 'GROUP',
      ...(deliveryMode === 'IMAGE' ? { imageUrl: deliveryImageUrl } : {}),
    });
    if (deliveryMode === 'TEXT') {
      expect(provider.sentMessages[0]?.imageUrl).toBeUndefined();
    }
    expect(markAttemptPending).toHaveBeenCalledOnce();
    expect(markDispatchedByGeneratedCopyId).toHaveBeenCalledWith(generatedCopyId);
    expect(COMMERCIAL_AUTOMATION_JOB_OPTIONS.attempts).toBe(1);
    },
  );
});
