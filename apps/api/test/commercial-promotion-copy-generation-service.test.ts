import { describe, expect, it, vi } from 'vitest';

import {
  CommercialAiCopyProviderError,
  type CommercialAiCopyProvider,
} from '../src/commercial-ai-copy-provider';
import { commercialAiCopyInputFingerprint } from '../src/commercial-ai-copy-fingerprint';
import {
  CommercialExternalProviderBudgetService,
  withOpenAiDailyBudget,
} from '../src/commercial-external-provider-budget-service';
import {
  COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED,
  CommercialPromotionCopyGenerationService,
} from '../src/commercial-promotion-copy-generation-service';
import { CommercialAiCopyValidator } from '../src/commercial-ai-copy-validator';
import { fingerprintCommercialOffer } from '../src/commercial-offer-snapshot';
import type {
  CommercialAiCopyClaimInput,
  CommercialAiCopyCompletionInput,
  CommercialAutomationSettingsRepository,
  CommercialCopyGenerationAttemptRecord,
  CommercialExternalProviderUsageRepository,
  CommercialPromotionCopyContext,
  CommercialPromotionCopyRepository,
  GeneratedCopyRecord,
} from '../src/repositories';

const now = new Date('2026-08-01T12:00:00.000Z');
const productLink = 'https://shopee.com.br/product/1/internal';
const affiliateLink = 'https://s.shopee.com.br/affiliate/internal';
const providerProductId = 'provider-internal';
const snapshotFingerprint = fingerprintCommercialOffer({
  source: 'OFFICIAL',
  providerProductId,
  productLink,
  affiliateLink,
  price: '99.90',
  priceMin: null,
  priceMax: null,
  discountRate: 20,
  commissionRate: 10,
  offerStartsAt: null,
  offerEndsAt: new Date('2999-12-31T23:59:59.000Z'),
  unavailableAt: null,
});

const contextFixture = (): CommercialPromotionCopyContext => ({
  candidate: {
    id: 'candidate-internal',
    campaignId: 'campaign-internal',
    productId: 'product-internal',
    snapshotId: 'snapshot-internal',
    generatedCopyId: null,
    status: 'QUEUED',
    rankPosition: 1,
    commercialScore: 82,
    scorePolicyVersion: 'official-v2',
    minimumScoreUsed: 60,
    scoreBreakdown: {
      policyVersion: 'official-v2',
      rawTotal: 82,
      finalScore: 82,
      components: { commission: 20, rating: 20, sales: 20, discount: 22 },
    },
    promotionSignals: ['PRICE_DROP', 'CURRENT_DISCOUNT'],
    priceDropPercent: '12.5',
    queuedAt: now,
    lastEvaluatedAt: now,
    expiresAt: new Date('2026-08-02T12:00:00.000Z'),
    dedupeUntil: null,
    blockedReason: null,
    createdAt: now,
    updatedAt: now,
  },
  campaign: {
    id: 'campaign-internal',
    name: 'Campanha local',
    logicalGroupFingerprint: 'grp_internal',
    anchorDestinationId: null,
    nicheId: 'niche-internal',
    active: true,
    cadenceMinutes: 15,
    timezone: 'America/Sao_Paulo',
    allowedStartTime: '07:00',
    allowedEndTime: '22:00',
    dailyLimit: 10,
    failureCount: 0,
    nextEligibleAt: null,
    attemptExecutionId: null,
    attemptReservedAt: null,
    attemptLeaseExpiresAt: null,
    queueTargetSize: 40,
    dedupeDays: 30,
    niche: { id: 'niche-internal', name: 'Casa', slug: 'casa', active: true },
    anchorDestination: null,
    createdAt: now,
    updatedAt: now,
  },
  niche: {
    id: 'niche-internal',
    name: 'Casa',
    slug: 'casa',
    active: true,
    categoryIds: [],
    includeKeywords: [],
    excludeKeywords: [],
    minPrice: null,
    maxPrice: null,
    minDiscountRate: 5,
    minRating: 0,
    minSales: 0,
    minCommissionRate: 0,
    minimumScore: 60,
    createdAt: now,
    updatedAt: now,
  },
  product: {
    id: 'product-internal',
    source: 'OFFICIAL',
    providerProductId,
    productLink,
    productName: 'Produto verificado',
    shopName: 'Loja verificada',
    price: '99.90',
    priceMin: null,
    priceMax: null,
    discountRate: 20,
    commissionRate: 10,
    rating: 4.8,
    sales: 500,
    affiliateLink,
    offerStartsAt: null,
    offerEndsAt: new Date('2999-12-31T23:59:59.000Z'),
    unavailableAt: null,
    commercialSnapshotRevision: 2,
    commercialSnapshotFingerprint: snapshotFingerprint,
    updatedAt: now,
  },
  snapshot: {
    id: 'snapshot-internal',
    productId: 'product-internal',
    revision: 2,
    fingerprint: snapshotFingerprint,
    price: '99.90',
    priceMin: null,
    priceMax: null,
    discountRate: 20,
    commissionRate: 10,
    observedRating: 4.8,
    observedSales: 500,
    offerStartsAt: null,
    offerEndsAt: new Date('2999-12-31T23:59:59.000Z'),
    unavailableAt: null,
    capturedAt: now,
    createdAt: now,
  },
  previousSnapshot: null,
});

class MemoryCopyRepository implements CommercialPromotionCopyRepository {
  context: CommercialPromotionCopyContext | null = contextFixture();
  copies = new Map<string, GeneratedCopyRecord>();
  attempts = new Map<string, CommercialCopyGenerationAttemptRecord>();
  claimInputs: CommercialAiCopyClaimInput[] = [];
  completionFailure: string | null = null;

  constructor(private readonly copyId = 'copy-internal') {}

  async loadContext() {
    return this.context;
  }
  async findCopyByInputFingerprint(fingerprint: string) {
    return this.copies.get(fingerprint) ?? null;
  }
  async findAttemptByInputFingerprint(fingerprint: string) {
    return this.attempts.get(fingerprint) ?? null;
  }
  async findAttemptByGenerationContract(
    input: Parameters<
      CommercialPromotionCopyRepository['findAttemptByGenerationContract']
    >[0],
  ) {
    return (
      [...this.attempts.values()].find(
        (attempt) =>
          attempt.candidateId === input.candidateId &&
          attempt.snapshotId === input.snapshotId &&
          attempt.inputFingerprint !== input.inputFingerprint &&
          attempt.provider === input.provider &&
          attempt.model === input.model &&
          attempt.promptVersion === input.promptVersion &&
          attempt.validationVersion === input.validationVersion,
      ) ?? null
    );
  }
  async listAttemptsByCandidateId(candidateId: string) {
    return [...this.attempts.values()].filter(
      (attempt) => attempt.candidateId === candidateId,
    );
  }
  async claim(input: CommercialAiCopyClaimInput) {
    this.claimInputs.push(input);
    const existing = this.attempts.get(input.inputFingerprint);
    if (existing) {
      if (
        existing.status === 'FAILED' &&
        existing.failureCode === 'COMMERCIAL_OPENAI_DAILY_BUDGET_REACHED' &&
        !existing.requestMayHaveStarted &&
        !existing.generatedCopyId
      ) {
        Object.assign(existing, {
          status: 'STARTED' as const,
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
          updatedAt: input.startedAt,
        });
        return true;
      }
      return false;
    }
    this.attempts.set(input.inputFingerprint, {
      id: 'attempt-internal',
      candidateId: input.candidateId,
      snapshotId: input.snapshotId,
      inputFingerprint: input.inputFingerprint,
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion,
      validationVersion: input.validationVersion,
      startedAt: input.startedAt,
      status: 'STARTED',
      generatedCopyId: null,
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
      completedAt: null,
      createdAt: input.startedAt,
      updatedAt: input.startedAt,
    });
    return true;
  }
  async linkCachedCopy(
    input: Parameters<CommercialPromotionCopyRepository['linkCachedCopy']>[0],
  ) {
    if (!this.context) return false;
    this.context.candidate.status = 'COPY_READY';
    this.context.candidate.generatedCopyId = input.copyId;
    return true;
  }
  async complete(input: CommercialAiCopyCompletionInput) {
    const attempt = this.attempts.get(input.inputFingerprint)!;
    if (this.completionFailure) {
      attempt.status = 'FAILED';
      attempt.failureCode = this.completionFailure;
      attempt.requestMayHaveStarted = true;
      attempt.inputTokens = input.usage.inputTokens;
      attempt.outputTokens = input.usage.outputTokens;
      attempt.totalTokens = input.usage.totalTokens;
      attempt.completedAt = input.completedAt;
      return { completed: false as const, failureCode: this.completionFailure };
    }
    const copy: GeneratedCopyRecord = {
      id: this.copyId,
      ...input.copy,
      createdAt: input.completedAt,
    };
    this.copies.set(input.inputFingerprint, copy);
    attempt.status = 'SUCCEEDED';
    attempt.generatedCopyId = copy.id;
    attempt.completedAt = input.completedAt;
    if (this.context) {
      this.context.candidate.status = 'COPY_READY';
      this.context.candidate.generatedCopyId = copy.id;
    }
    return { completed: true as const, copy };
  }
  async markAttemptTerminal(
    input: Parameters<
      CommercialPromotionCopyRepository['markAttemptTerminal']
    >[0],
  ) {
    const attempt = this.attempts.get(input.inputFingerprint);
    if (!attempt || attempt.status !== 'STARTED') return false;
    Object.assign(attempt, input);
    return true;
  }
  async findCopyForCandidate() {
    if (!this.context?.candidate.generatedCopyId) return null;
    const copy = [...this.copies.values()].find(
      ({ id }) => id === this.context?.candidate.generatedCopyId,
    );
    return copy
      ? {
          candidate: this.context.candidate,
          copy,
          snapshotRevision: this.context.snapshot.revision,
        }
      : null;
  }
}

const validProvider = (): CommercialAiCopyProvider => ({
  generate: vi.fn().mockResolvedValue({
    output: {
      headline: 'OFERTA CONFIÁVEL',
      body: 'Uma escolha prática para sua rotina.',
    },
    provider: 'openai',
    model: 'selected-model',
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      reasoningTokens: 4,
    },
  }),
});

const legacyAttempt = (
  status: CommercialCopyGenerationAttemptRecord['status'],
  inputFingerprint = `legacy-fingerprint-${status.toLowerCase()}`,
): CommercialCopyGenerationAttemptRecord => ({
  id: `attempt-${status.toLowerCase()}`,
  candidateId: 'candidate-internal',
  snapshotId: 'snapshot-internal',
  inputFingerprint,
  provider: 'openai',
  model: 'selected-model',
  promptVersion: 'commercial-promotion-copy-v3',
  validationVersion: 'commercial-promotion-copy-validation-v2',
  status,
  generatedCopyId: status === 'SUCCEEDED' ? 'copy-legacy' : null,
  failureCode:
    status === 'FAILED' ? 'COMMERCIAL_AI_COPY_PROVIDER_FAILED' : null,
  requestMayHaveStarted: status !== 'STARTED',
  providerHttpStatus: null,
  providerErrorCode: null,
  providerErrorType: null,
  providerErrorParam: null,
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  validationFailureCodes: [],
  startedAt: now,
  completedAt: status === 'STARTED' ? null : now,
  createdAt: now,
  updatedAt: now,
});

const legacyCopy = (inputFingerprint: string): GeneratedCopyRecord => ({
  id: 'copy-legacy',
  productId: 'product-internal',
  titulo: 'Oferta anterior',
  mensagem: 'Produto anterior que nao pode ser reaproveitado.',
  cta: `Confira os detalhes\n${affiliateLink}`,
  hashtags: '#Oferta',
  source: 'AI',
  provider: 'openai',
  model: 'selected-model',
  promptVersion: 'commercial-promotion-copy-v2',
  validationVersion: 'commercial-promotion-copy-validation-v2',
  inputFingerprint,
  snapshotId: 'snapshot-internal',
  createdFromCandidateId: 'candidate-internal',
  usageInputTokens: null,
  usageOutputTokens: null,
  usageTotalTokens: null,
  createdAt: now,
});

const service = (
  repository: MemoryCopyRepository,
  provider: CommercialAiCopyProvider = validProvider(),
  validator?: CommercialAiCopyValidator,
) =>
  new CommercialPromotionCopyGenerationService({
    repository,
    provider,
    validator,
    config: {
      enabled: true,
      provider: 'openai',
      model: 'selected-model',
      apiKeyConfigured: true,
      timeoutMs: 30000,
      maxOutputTokens: 300,
      reasoningEffort: 'minimal',
      maximumCopyLength: 1000,
    },
    clock: () => now,
  });

describe('CommercialPromotionCopyGenerationService', () => {
  it('preserva budget esgotado como falha pre-provider e permite o mesmo contract no proximo dayKey', async () => {
    const repository = new MemoryCopyRepository();
    let budgetNow = new Date('2026-08-01T12:00:00.000Z');
    const settingsRecord = {
      paused: false,
      pausedAt: null,
      resumedAt: budgetNow,
      allowedStartTime: null,
      allowedEndTime: null,
      minimumIntervalMinutes: null,
      staggerMinutes: null,
      dailyGlobalLimit: 1,
      dailyGroupLimit: 1,
      dailyShopeeHttpLimit: 1,
      dailyOpenAiGenerationLimit: 1,
      scheduleRevision: 1,
      updatedAt: budgetNow,
    };
    const settings: CommercialAutomationSettingsRepository = {
      get: async () => settingsRecord,
      getOrCreate: async () => settingsRecord,
      setPaused: async () => settingsRecord,
      updateSchedule: async () => settingsRecord,
    };
    const usageRows = new Map<string, number>();
    const usage: CommercialExternalProviderUsageRepository = {
      async claim(input) {
        const key = `${input.provider}:${input.dayKey}`;
        const usedCount = usageRows.get(key) ?? 0;
        if (usedCount >= input.limit) return null;
        const claimed = usedCount + 1;
        usageRows.set(key, claimed);
        return { ...input, usedCount: claimed, updatedAt: input.now };
      },
      async getUsage(provider, dayKey) {
        const usedCount = usageRows.get(`${provider}:${dayKey}`);
        return usedCount === undefined
          ? null
          : { provider, dayKey, usedCount, updatedAt: budgetNow };
      },
    };
    const budget = new CommercialExternalProviderBudgetService({
      settings,
      usage,
      timezone: 'America/Sao_Paulo',
      fallbackDailyGlobalLimit: 1,
      clock: () => budgetNow,
    });
    await budget.claim('OPENAI');
    const actualProvider = validProvider();
    const copyService = service(
      repository,
      withOpenAiDailyBudget(actualProvider, budget),
    );

    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_OPENAI_DAILY_BUDGET_REACHED',
    });
    expect(actualProvider.generate).not.toHaveBeenCalled();
    expect([...repository.attempts.values()][0]).toMatchObject({
      status: 'FAILED',
      failureCode: 'COMMERCIAL_OPENAI_DAILY_BUDGET_REACHED',
      requestMayHaveStarted: false,
    });

    budgetNow = new Date('2026-08-02T12:00:00.000Z');
    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).resolves.toMatchObject({ status: 'COPY_READY' });
    expect(actualProvider.generate).toHaveBeenCalledTimes(1);
    expect([...repository.attempts.values()][0]).toMatchObject({
      status: 'SUCCEEDED',
      requestMayHaveStarted: false,
    });
  });

  it('aprova preflight configurado sem construir ou chamar provider', () => {
    const repository = new MemoryCopyRepository();
    const copyService = new CommercialPromotionCopyGenerationService({
      repository,
      config: {
        enabled: true,
        provider: 'openai',
        model: 'selected-model',
        apiKeyConfigured: true,
        timeoutMs: 30_000,
        maxOutputTokens: 300,
        reasoningEffort: 'minimal',
        maximumCopyLength: 1_000,
      },
    });
    expect(copyService.preflight()).toMatchObject({
      approved: true,
      enabled: true,
      modelConfigured: true,
      apiKeyConfigured: true,
      inputSanitizationVersion:
        'commercial-promotion-copy-input-sanitization-v1',
      reasoningEffort: 'minimal',
    });
  });

  it('mantém preview read-only e sanitizado', async () => {
    const repository = new MemoryCopyRepository();
    const before = JSON.stringify(repository.context);
    const report = await service(repository).preview('candidate-internal');
    expect(report.eligible).toBe(true);
    expect(JSON.stringify(report)).not.toContain(affiliateLink);
    expect(JSON.stringify(report)).toContain('[LINK_AFILIADO]');
    expect(JSON.stringify(repository.context)).toBe(before);
    expect(repository.attempts.size).toBe(0);
  });

  it('envia ao provider o nome sanitizado e preserva a fonte original no contexto', async () => {
    const repository = new MemoryCopyRepository();
    const originalProductName = 'Air Fryer 6,5L 1700W 127V Original';
    repository.context!.product.productName = originalProductName;
    const provider = validProvider();
    const validator = new CommercialAiCopyValidator();
    const validate = vi.spyOn(validator, 'validate');

    await service(repository, provider, validator).generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );
    const affiliateLink = repository.context!.product.affiliateLink;
    if (!affiliateLink) throw new Error('test fixture affiliate link missing');

    expect(provider.generate).toHaveBeenCalledWith({
      productName: 'Air Fryer 6,5L 1700W 127V',
    });
    expect(validate).toHaveBeenCalledWith(
      expect.anything(),
      originalProductName,
      ['Loja verificada'],
    );
    expect(repository.context!.product.productName).toBe(originalProductName);
    expect(repository.claimInputs[0]?.inputFingerprint).toBe(
      commercialAiCopyInputFingerprint({
        promptVersion: 'commercial-promotion-copy-v13',
        validationVersion: 'commercial-promotion-copy-validation-v4',
        inputSanitizationVersion:
          'commercial-promotion-copy-input-sanitization-v1',
        modelProductName: 'Air Fryer 6,5L 1700W 127V',
        provider: 'openai',
        model: 'selected-model',
        campaignId: repository.context!.campaign.id,
        nicheId: repository.context!.niche.id,
        candidateId: repository.context!.candidate.id,
        productId: repository.context!.product.id,
        snapshotId: repository.context!.snapshot.id,
        snapshotRevision: repository.context!.snapshot.revision,
        snapshotFingerprint: repository.context!.snapshot.fingerprint,
        promotionSignals: repository.context!.candidate.promotionSignals,
        priceDropPercent: repository.context!.candidate.priceDropPercent,
        productName: originalProductName,
        shopName: repository.context!.product.shopName,
        price: repository.context!.product.price,
        discountRate: repository.context!.product.discountRate,
        affiliateLink,
        maximumLength: 1000,
      }),
    );
  });

  it('falha fechado antes do provider quando a sanitização remove toda a identidade', async () => {
    const repository = new MemoryCopyRepository();
    repository.context!.product.productName = 'Original';
    const provider = validProvider();

    await expect(
      service(repository, provider).generate(
        'candidate-internal',
        'GERAR_COPY_COM_IA',
      ),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_AI_COPY_MODEL_PRODUCT_NAME_INVALID',
    });

    expect(provider.generate).not.toHaveBeenCalled();
    expect(repository.claimInputs).toHaveLength(0);
    expect(repository.attempts.size).toBe(0);
  });

  it('marca output terminal rejeitado como inelegivel somente no fingerprint atual', async () => {
    const repository = new MemoryCopyRepository();
    let rejectedFingerprint: string | null = null;
    repository.findAttemptByInputFingerprint = vi.fn(
      async (fingerprint: string) => {
        rejectedFingerprint ??= fingerprint;
        if (fingerprint !== rejectedFingerprint) return null;
        return {
          ...legacyAttempt('FAILED', fingerprint),
          failureCode: 'COMMERCIAL_AI_COPY_OUTPUT_INVALID',
          validationFailureCodes: ['AI_PROHIBITED_CLAIM'],
        };
      },
    );
    const copyService = service(repository);

    await expect(
      copyService.preview('candidate-internal'),
    ).resolves.toMatchObject({
      eligible: false,
      blockers: [COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED],
    });
    await expect(
      copyService.preview('candidate-internal'),
    ).resolves.toMatchObject({
      eligible: false,
      blockers: [COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED],
    });

    repository.context!.candidate.snapshotId = 'snapshot-current-2';
    repository.context!.snapshot.id = 'snapshot-current-2';
    repository.context!.snapshot.revision = 3;
    repository.context!.product.commercialSnapshotRevision = 3;

    await expect(
      copyService.preview('candidate-internal'),
    ).resolves.toMatchObject({
      eligible: true,
      blockers: [],
    });
  });

  it.each([
    ['STARTED', null, 'COMMERCIAL_AI_COPY_GENERATION_IN_PROGRESS'],
    ['AMBIGUOUS', null, 'COMMERCIAL_AI_COPY_RESULT_AMBIGUOUS'],
    [
      'FAILED',
      'COMMERCIAL_AI_COPY_PROVIDER_FAILED',
      'COMMERCIAL_AI_COPY_PREVIOUSLY_FAILED',
    ],
  ] as const)(
    'mantem attempt %s fail-closed no preview',
    async (status, failureCode, expectedBlocker) => {
      const repository = new MemoryCopyRepository();
      repository.findAttemptByInputFingerprint = vi.fn(
        async (fingerprint: string) => ({
          ...legacyAttempt(status, fingerprint),
          failureCode,
        }),
      );
      await expect(
        service(repository).preview('candidate-internal'),
      ).resolves.toMatchObject({
        eligible: false,
        blockers: [expectedBlocker],
      });
    },
  );
  it.each([
    ['LF', '\n'],
    ['CR', '\r'],
    ['TAB', '\t'],
    ['NUL', '\u0000'],
    ['DEL', '\u007F'],
  ])(
    'bloqueia link afiliado com %s no preflight de candidato, preview e geração',
    async (_name, control) => {
      const repository = new MemoryCopyRepository();
      repository.context!.product.affiliateLink = `https://example.invalid/affiliate${control}https://evil.example/second`;
      const provider = validProvider();
      const copyService = service(repository, provider);

      await expect(
        copyService.preview('candidate-internal'),
      ).resolves.toMatchObject({
        eligible: false,
        blockers: ['COMMERCIAL_AI_COPY_AFFILIATE_LINK_INVALID'],
        sanitizedPreview: null,
      });
      await expect(
        copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
      ).rejects.toMatchObject({
        code: 'COMMERCIAL_AI_COPY_AFFILIATE_LINK_INVALID',
      });

      expect(provider.generate).not.toHaveBeenCalled();
      expect(repository.attempts.size).toBe(0);
    },
  );

  it('gera uma copy AI, vincula snapshot e reutiliza COPY_READY sem nova chamada', async () => {
    const repository = new MemoryCopyRepository();
    repository.context!.snapshot.priceMax = '199.90';
    const provider = validProvider();
    const copyService = service(repository, provider);
    const first = await copyService.generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );
    const second = await copyService.generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );
    expect(first).toMatchObject({ status: 'COPY_READY', cacheHit: false });
    expect(second).toMatchObject({ status: 'COPY_READY', cacheHit: true });
    expect(first.promptVersion).toBe('commercial-promotion-copy-v13');
    expect(repository.claimInputs[0]?.inputFingerprint).toBeTruthy();
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(repository.copies.size).toBe(1);
    expect(repository.attempts.size).toBe(1);
    expect(JSON.stringify(first)).not.toContain(affiliateLink);
    expect(first.sanitizedCopy).toEqual({
      titulo: 'OFERTA CONFIÁVEL',
      mensagem:
        'Uma escolha prática para sua rotina.\n\u{1F525} POR R$ 99,90\n\u{1F4B8} 20% OFF',
      cta: '\u{1F6D2} Ver oferta:\n[LINK_AFILIADO]',
      hashtags:
        '\u{1F4F2} Curtiu o achado? Compartilhe o grupo com alguém que também gosta de economizar.',
    });
    expect(JSON.stringify(first.sanitizedCopy)).not.toContain(
      'Produto verificado',
    );
    expect(JSON.stringify(first.sanitizedCopy)).not.toContain(
      'Loja verificada',
    );
  });

  it('mantém candidate MANUAL com link válido fora da Copy V10 por contrato OFFICIAL-only', async () => {
    const repository = new MemoryCopyRepository();
    const provider = validProvider();
    const productLinkManual = 'https://merchant.example/product/manual-1';
    const affiliateLinkManual = 'https://affiliate.example/manual-1';
    const fingerprint = fingerprintCommercialOffer({
      source: 'MANUAL',
      providerProductId,
      productLink: productLinkManual,
      affiliateLink: affiliateLinkManual,
      price: '99.90',
      priceMin: null,
      priceMax: null,
      discountRate: 20,
      commissionRate: 10,
      offerStartsAt: null,
      offerEndsAt: new Date('2999-12-31T23:59:59.000Z'),
      unavailableAt: null,
    });
    repository.context!.product.source = 'MANUAL';
    repository.context!.product.productLink = productLinkManual;
    repository.context!.product.affiliateLink = affiliateLinkManual;
    repository.context!.product.commercialSnapshotFingerprint = fingerprint;
    repository.context!.snapshot.fingerprint = fingerprint;

    await expect(
      service(repository, provider).generate(
        'candidate-internal',
        'GERAR_COPY_COM_IA',
      ),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_AI_COPY_SOURCE_INVALID' });

    expect(provider.generate).not.toHaveBeenCalled();
    expect(repository.context!.product.affiliateLink).toBe(affiliateLinkManual);
    expect(repository.copies.size).toBe(0);
  });
  it('mantém candidate MOCK explícito fora da Copy V10 por contrato OFFICIAL-only', async () => {
    const repository = new MemoryCopyRepository();
    const provider = validProvider();
    const productLinkMock = 'https://example.invalid/product/mock-1';
    const affiliateLinkMock = 'https://example.invalid/affiliate/mock-1';
    const fingerprint = fingerprintCommercialOffer({
      source: 'MOCK',
      providerProductId,
      productLink: productLinkMock,
      affiliateLink: affiliateLinkMock,
      price: '99.90',
      priceMin: null,
      priceMax: null,
      discountRate: 20,
      commissionRate: 10,
      offerStartsAt: null,
      offerEndsAt: new Date('2999-12-31T23:59:59.000Z'),
      unavailableAt: null,
    });
    repository.context!.product.source = 'MOCK';
    repository.context!.product.productLink = productLinkMock;
    repository.context!.product.affiliateLink = affiliateLinkMock;
    repository.context!.product.commercialSnapshotFingerprint = fingerprint;
    repository.context!.snapshot.fingerprint = fingerprint;

    await expect(
      service(repository, provider).generate(
        'candidate-internal',
        'GERAR_COPY_COM_IA',
      ),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_AI_COPY_SOURCE_INVALID' });

    expect(provider.generate).not.toHaveBeenCalled();
    expect(repository.context!.product.affiliateLink).toBe(affiliateLinkMock);
    expect(repository.copies.size).toBe(0);
  });
  it('reutiliza cache válido com HOKON.br em fato confiável', async () => {
    const repository = new MemoryCopyRepository();
    repository.context!.product.shopName = 'HOKON.br';
    const provider = validProvider();
    const copyService = service(repository, provider);

    const first = await copyService.generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );
    repository.context!.candidate.status = 'QUEUED';
    repository.context!.candidate.generatedCopyId = null;
    const second = await copyService.generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );

    expect(first).toMatchObject({ status: 'COPY_READY', cacheHit: false });
    expect(second).toMatchObject({ status: 'COPY_READY', cacheHit: true });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(repository.context?.candidate.generatedCopyId).toBe('copy-internal');
    expect([...repository.copies.values()][0]?.mensagem).not.toContain(
      'HOKON.br',
    );
  });

  it.each([
    ['FAILED', 'COMMERCIAL_AI_COPY_PROVIDER_FAILED'],
    ['AMBIGUOUS', 'COMMERCIAL_AI_COPY_RESULT_AMBIGUOUS'],
  ] as const)(
    'prioriza cache atual válido sobre histórico %s',
    async (status, failureCode) => {
      const repository = new MemoryCopyRepository();
      const provider = validProvider();
      const copyService = service(repository, provider);

      await copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA');
      repository.context!.candidate.status = 'QUEUED';
      repository.context!.candidate.generatedCopyId = null;
      const historicalFingerprint = `historical-cache-${status.toLowerCase()}`;
      repository.attempts.set(historicalFingerprint, {
        ...legacyAttempt(status, historicalFingerprint),
        promptVersion: 'commercial-promotion-copy-v11',
        validationVersion: 'commercial-promotion-copy-validation-v4',
        failureCode,
      });

      await expect(
        copyService.preview('candidate-internal'),
      ).resolves.toMatchObject({
        eligible: true,
        cacheAvailable: true,
        blockers: [],
      });
      await expect(
        copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
      ).resolves.toMatchObject({
        status: 'COPY_READY',
        cacheHit: true,
      });

      expect(provider.generate).toHaveBeenCalledOnce();
      expect(repository.attempts.get(historicalFingerprint)).toMatchObject({
        status,
        failureCode,
      });
    },
  );

  it('limpa faixa de tamanho de copy cacheada sem uma segunda chamada ao provider', async () => {
    const repository = new MemoryCopyRepository();
    repository.context!.product.productName =
      'Tênis de Corrida com Placa de Carbono Profissional 33-44';
    const provider = validProvider();
    vi.mocked(provider.generate).mockResolvedValue({
      output: {
        headline: 'SOLA QUE PARECE JET!',
        body: 'Tênis de Corrida com Placa de Carbono Profissional 33-44',
      },
      provider: 'openai',
      model: 'selected-model',
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        reasoningTokens: 4,
      },
    });
    const copyService = service(repository, provider);

    await copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA');
    repository.context!.candidate.status = 'QUEUED';
    repository.context!.candidate.generatedCopyId = null;
    const cached = await copyService.generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );

    expect(cached).toMatchObject({ status: 'COPY_READY', cacheHit: true });
    expect(cached.sanitizedCopy.mensagem).toContain(
      'Tênis de Corrida com Placa de Carbono Profissional',
    );
    expect(cached.sanitizedCopy.mensagem).not.toContain('33-44');
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it('reutiliza cache quando o preço muda somente na forma canônica do assembler', async () => {
    const repository = new MemoryCopyRepository();
    const provider = validProvider();
    const copyService = service(repository, provider);
    await copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA');
    repository.context!.candidate.status = 'QUEUED';
    repository.context!.candidate.generatedCopyId = null;
    repository.context!.product.price = ' 00099.9000 ';

    const cached = await copyService.generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );

    expect(cached).toMatchObject({ status: 'COPY_READY', cacheHit: true });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(repository.copies.size).toBe(1);
  });

  it('falha fechado quando copy concluída deixa de corresponder ao fingerprint atual', async () => {
    const repository = new MemoryCopyRepository();
    repository.context!.product.productName = `Produto ${'x'.repeat(250)} A`;
    repository.context!.product.shopName = `Loja ${'y'.repeat(120)} A`;
    const provider = validProvider();
    const copyService = service(repository, provider);
    const first = await copyService.generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );
    repository.context!.candidate.status = 'QUEUED';
    repository.context!.candidate.generatedCopyId = null;
    repository.context!.product.productName = `Produto ${'x'.repeat(250)} B`;
    repository.context!.product.shopName = `Loja ${'y'.repeat(120)} B`;

    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_AI_COPY_CACHE_INCONSISTENT' });

    expect(first.cacheHit).toBe(false);
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(repository.copies.size).toBe(1);
    expect([...repository.copies.values()][0]?.mensagem).not.toContain(
      `Produto ${'x'.repeat(250)} A`,
    );
  });

  it('mantem copy candidate-scoped separada para o mesmo produto em grupos diferentes', async () => {
    const groupA = new MemoryCopyRepository('copy-group-a');
    const groupB = new MemoryCopyRepository('copy-group-b');
    const contextB = groupB.context!;
    groupB.context = {
      ...contextB,
      candidate: {
        ...contextB.candidate,
        id: 'candidate-group-b',
        campaignId: 'campaign-group-b',
      },
      campaign: {
        ...contextB.campaign,
        id: 'campaign-group-b',
        logicalGroupFingerprint: 'grp_group_b',
        nicheId: 'niche-group-b',
        niche: {
          ...contextB.campaign.niche,
          id: 'niche-group-b',
        },
      },
      niche: {
        ...contextB.niche,
        id: 'niche-group-b',
      },
    };
    const providerA = validProvider();
    const providerB = validProvider();

    const resultA = await service(groupA, providerA).generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );
    const resultB = await service(groupB, providerB).generate(
      'candidate-group-b',
      'GERAR_COPY_COM_IA',
    );

    expect(resultA.generatedCopyId).toBe('copy-group-a');
    expect(resultB.generatedCopyId).toBe('copy-group-b');
    expect(resultA.generatedCopyId).not.toBe(resultB.generatedCopyId);
    expect([...groupA.copies.values()][0]?.createdFromCandidateId).toBe(
      'candidate-internal',
    );
    expect([...groupB.copies.values()][0]?.createdFromCandidateId).toBe(
      'candidate-group-b',
    );
    expect(providerA.generate).toHaveBeenCalledOnce();
    expect(providerB.generate).toHaveBeenCalledOnce();
  });

  it('normaliza fatos antes da fronteira do provider', async () => {
    const repository = new MemoryCopyRepository();
    repository.context!.product.productName = '\u0000 Produto   seguro ';
    repository.context!.product.shopName = ' Loja\tsegura ';
    const provider = validProvider();
    await service(repository, provider).generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );
    expect(provider.generate).toHaveBeenCalledWith({
      productName: 'Produto seguro',
    });
    expect(vi.mocked(provider.generate).mock.calls[0]?.[0]).not.toHaveProperty(
      'shopName',
    );
  });

  it('mantém shopName somente no contexto de validação, fora do provider', async () => {
    const repository = new MemoryCopyRepository();
    const provider = validProvider();
    const validate = vi.fn().mockReturnValue({
      valid: true,
      sanitizedOutput: {
        headline: 'OFERTA CONFIÁVEL',
        body: 'Uma escolha prática para sua rotina.',
      },
      publicFailureCodes: [],
    });
    const validator = { validate } as unknown as CommercialAiCopyValidator;

    await service(repository, provider, validator).generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );

    expect(validate).toHaveBeenCalledWith(
      expect.any(Object),
      'Produto verificado',
      ['Loja verificada'],
    );
  });

  it('bloqueia copy pronta quando o link atual diverge do snapshot gerado', async () => {
    const repository = new MemoryCopyRepository();
    const copyService = service(repository);
    await copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA');
    repository.context!.product.affiliateLink =
      'https://s.shopee.com.br/affiliate/changed';
    repository.context!.product.updatedAt = new Date('2026-08-01T12:00:01Z');
    await expect(
      copyService.findCopy('candidate-internal'),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_AI_COPY_AFFILIATE_LINK_SNAPSHOT_MISMATCH',
    });
  });

  it('deduplica falha terminal quando somente product.updatedAt muda', async () => {
    const repository = new MemoryCopyRepository();
    const provider: CommercialAiCopyProvider = {
      generate: vi
        .fn()
        .mockRejectedValue(
          new CommercialAiCopyProviderError(
            'FAILED_CONFIRMED',
            'COMMERCIAL_AI_COPY_PROVIDER_FAILED',
          ),
        ),
    };
    const copyService = service(repository, provider);
    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_AI_COPY_PROVIDER_FAILED' });
    const [fingerprint] = repository.attempts.keys();
    repository.context!.product.updatedAt = new Date('2026-08-01T12:00:01Z');
    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_AI_COPY_PREVIOUSLY_FAILED' });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect([...repository.attempts.keys()]).toEqual([fingerprint]);
    expect(repository.context?.candidate.status).toBe('QUEUED');
    expect([...repository.attempts.values()][0]).toMatchObject({
      status: 'FAILED',
      failureCode: 'COMMERCIAL_AI_COPY_PROVIDER_FAILED',
      requestMayHaveStarted: false,
    });
    expect(repository.copies.size).toBe(0);
  });

  it.each([
    ['FAILED', 'COMMERCIAL_AI_COPY_PREVIOUSLY_FAILED'],
    ['AMBIGUOUS', 'COMMERCIAL_AI_COPY_RESULT_AMBIGUOUS'],
    ['STARTED', 'COMMERCIAL_AI_COPY_GENERATION_IN_PROGRESS'],
  ] as const)(
    'bloqueia attempt legado %s do mesmo contrato sem nova chamada ao provider',
    async (status, code) => {
      const repository = new MemoryCopyRepository();
      const fingerprint = `legacy-hash-${status.toLowerCase()}`;
      repository.attempts.set(fingerprint, {
        ...legacyAttempt(status, fingerprint),
        promptVersion: 'commercial-promotion-copy-v13',
        validationVersion: 'commercial-promotion-copy-validation-v4',
      });
      const provider = validProvider();

      await expect(
        service(repository, provider).generate(
          'candidate-internal',
          'GERAR_COPY_COM_IA',
        ),
      ).rejects.toMatchObject({ code });

      expect(provider.generate).not.toHaveBeenCalled();
      expect(repository.attempts.size).toBe(1);
      expect(repository.context?.candidate.status).toBe('QUEUED');
    },
  );

  it('mantem output invalid terminal no fingerprint atual sem chamar provider', async () => {
    const repository = new MemoryCopyRepository();
    let currentFingerprint: string | null = null;
    repository.findAttemptByInputFingerprint = vi.fn(
      async (fingerprint: string) => {
        currentFingerprint ??= fingerprint;
        return {
          ...legacyAttempt('FAILED', fingerprint),
          promptVersion: 'commercial-promotion-copy-v13',
          validationVersion: 'commercial-promotion-copy-validation-v4',
          failureCode: 'COMMERCIAL_AI_COPY_OUTPUT_INVALID',
        };
      },
    );
    repository.claim = vi.fn().mockResolvedValue(false);
    const provider = validProvider();
    const copyService = service(repository, provider);

    await expect(
      copyService.preview('candidate-internal'),
    ).resolves.toMatchObject({
      eligible: false,
      blockers: [COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED],
    });
    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).rejects.toMatchObject({
      code: COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED,
    });
    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).rejects.toMatchObject({
      code: COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED,
    });

    expect(currentFingerprint).toBeTruthy();
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('ignora output invalid historico de fingerprint diferente e gera o fingerprint novo', async () => {
    const repository = new MemoryCopyRepository();
    const historicalFingerprint = 'historical-output-invalid-fingerprint';
    repository.attempts.set(historicalFingerprint, {
      ...legacyAttempt('FAILED', historicalFingerprint),
      promptVersion: 'commercial-promotion-copy-v12',
      validationVersion: 'commercial-promotion-copy-validation-v4',
      failureCode: 'COMMERCIAL_AI_COPY_OUTPUT_INVALID',
      validationFailureCodes: ['AI_PROHIBITED_CLAIM'],
      requestMayHaveStarted: true,
    });
    const provider = validProvider();
    const copyService = service(repository, provider);

    await expect(
      copyService.preview('candidate-internal'),
    ).resolves.toMatchObject({
      eligible: true,
      blockers: [],
    });
    const result = await copyService.generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );

    expect(result.status).toBe('COPY_READY');
    expect(provider.generate).toHaveBeenCalledOnce();
    expect(repository.attempts.get(historicalFingerprint)).toMatchObject({
      status: 'FAILED',
      failureCode: 'COMMERCIAL_AI_COPY_OUTPUT_INVALID',
      inputFingerprint: historicalFingerprint,
    });
    const currentAttempt = [...repository.attempts.values()].find(
      (attempt) => attempt.inputFingerprint !== historicalFingerprint,
    );
    expect(currentAttempt).toMatchObject({
      promptVersion: 'commercial-promotion-copy-v13',
      validationVersion: 'commercial-promotion-copy-validation-v4',
      status: 'SUCCEEDED',
    });
    expect(currentAttempt?.inputFingerprint).not.toBe(historicalFingerprint);
    expect(repository.attempts.size).toBe(2);
  });

  it('alinha preview e generate para copy historica SUCCEEDED com fingerprint diferente', async () => {
    const repository = new MemoryCopyRepository();
    const historicalFingerprint = 'historical-succeeded-fingerprint';
    repository.attempts.set(historicalFingerprint, {
      ...legacyAttempt('SUCCEEDED', historicalFingerprint),
      promptVersion: 'commercial-promotion-copy-v13',
      validationVersion: 'commercial-promotion-copy-validation-v4',
    });
    const provider = validProvider();
    const copyService = service(repository, provider);

    await expect(
      copyService.preview('candidate-internal'),
    ).resolves.toMatchObject({
      eligible: false,
      blockers: ['COMMERCIAL_AI_COPY_CACHE_INCONSISTENT'],
    });
    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_AI_COPY_CACHE_INCONSISTENT',
    });

    expect(provider.generate).not.toHaveBeenCalled();
    expect(repository.attempts.size).toBe(1);
  });

  it.each([
    ['STARTED', null, 'COMMERCIAL_AI_COPY_GENERATION_IN_PROGRESS'],
    [
      'AMBIGUOUS',
      'COMMERCIAL_AI_COPY_PROVIDER_RESULT_AMBIGUOUS',
      'COMMERCIAL_AI_COPY_RESULT_AMBIGUOUS',
    ],
    [
      'FAILED',
      'COMMERCIAL_AI_COPY_PROVIDER_FAILED',
      'COMMERCIAL_AI_COPY_PREVIOUSLY_FAILED',
    ],
  ] as const)(
    'mantem preview e generate coerentes para tentativa historica %s',
    async (status, failureCode, expectedCode) => {
      const repository = new MemoryCopyRepository();
      const historicalFingerprint = `historical-${status.toLowerCase()}-fingerprint`;
      repository.attempts.set(historicalFingerprint, {
        ...legacyAttempt(status, historicalFingerprint),
        promptVersion: 'commercial-promotion-copy-v13',
        validationVersion: 'commercial-promotion-copy-validation-v4',
        failureCode,
      });
      const provider = validProvider();
      const copyService = service(repository, provider);

      await expect(
        copyService.preview('candidate-internal'),
      ).resolves.toMatchObject({
        eligible: false,
        blockers: [expectedCode],
      });
      await expect(
        copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
      ).rejects.toMatchObject({ code: expectedCode });

      expect(provider.generate).not.toHaveBeenCalled();
      expect(repository.attempts.size).toBe(1);
    },
  );

  it('não permite que uma tentativa FAILED v9/v4 bloqueie a geração v13/v4', async () => {
    const repository = new MemoryCopyRepository();
    const v9Fingerprint = 'v9-fingerprint-mock-hash';
    repository.attempts.set(v9Fingerprint, {
      ...legacyAttempt('FAILED', v9Fingerprint),
      promptVersion: 'commercial-promotion-copy-v9',
      validationVersion: 'commercial-promotion-copy-validation-v4',
    });
    const provider = validProvider();

    const result = await service(repository, provider).generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );

    expect(result).toMatchObject({
      status: 'COPY_READY',
      promptVersion: 'commercial-promotion-copy-v13',
      validationVersion: 'commercial-promotion-copy-validation-v4',
    });
    expect(provider.generate).toHaveBeenCalledOnce();
    expect(repository.attempts.get(v9Fingerprint)).toMatchObject({
      promptVersion: 'commercial-promotion-copy-v9',
      validationVersion: 'commercial-promotion-copy-validation-v4',
      status: 'FAILED',
    });
  });

  it('não reutiliza copy legada v2 com fingerprint diferente e preserva o histórico', async () => {
    const repository = new MemoryCopyRepository();
    const fingerprint = 'legacy-hash-succeeded';
    repository.attempts.set(
      fingerprint,
      legacyAttempt('SUCCEEDED', fingerprint),
    );
    repository.copies.set(fingerprint, legacyCopy(fingerprint));
    const provider = validProvider();

    const result = await service(repository, provider).generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );

    expect(result).toMatchObject({
      status: 'COPY_READY',
      cacheHit: false,
      promptVersion: 'commercial-promotion-copy-v13',
    });
    expect(provider.generate).toHaveBeenCalledOnce();
    expect(repository.copies.size).toBe(2);
    expect(repository.context?.candidate.generatedCopyId).toBe('copy-internal');
    expect(repository.copies.get(fingerprint)?.mensagem).toContain(
      'Produto anterior',
    );
  });

  it('não permite que uma tentativa FAILED v3 bloqueie a geração v13', async () => {
    const repository = new MemoryCopyRepository();
    const v3Fingerprint = 'v3-fingerprint-mock-hash';
    repository.attempts.set(
      v3Fingerprint,
      legacyAttempt('FAILED', v3Fingerprint),
    );
    const provider = validProvider();

    const result = await service(repository, provider).generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );

    expect(result).toMatchObject({
      status: 'COPY_READY',
      promptVersion: 'commercial-promotion-copy-v13',
    });
    expect(provider.generate).toHaveBeenCalledOnce();
    expect(repository.attempts.size).toBe(2);
    expect(repository.attempts.get(v3Fingerprint)?.promptVersion).toBe(
      'commercial-promotion-copy-v3',
    );
  });

  it('não permite que uma tentativa FAILED v6/v3 bloqueie a geração v13/v4', async () => {
    const repository = new MemoryCopyRepository();
    const v6Fingerprint = 'v6-fingerprint-mock-hash';
    repository.attempts.set(v6Fingerprint, {
      ...legacyAttempt('FAILED', v6Fingerprint),
      promptVersion: 'commercial-promotion-copy-v6',
      validationVersion: 'commercial-promotion-copy-validation-v3',
    });
    const provider = validProvider();

    const result = await service(repository, provider).generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );

    expect(result).toMatchObject({
      status: 'COPY_READY',
      promptVersion: 'commercial-promotion-copy-v13',
      validationVersion: 'commercial-promotion-copy-validation-v4',
    });
    expect(provider.generate).toHaveBeenCalledOnce();
    expect(repository.attempts.get(v6Fingerprint)).toMatchObject({
      promptVersion: 'commercial-promotion-copy-v6',
      validationVersion: 'commercial-promotion-copy-validation-v3',
      status: 'FAILED',
    });
  });

  it('não permite que um attempt FAILED v1 bloqueie a geração v13, gerando um fingerprint diferente e não o apagando', async () => {
    const repository = new MemoryCopyRepository();
    // Simulate a failed attempt from v1
    const v1Fingerprint = 'v1-fingerprint-mock-hash';
    repository.attempts.set(v1Fingerprint, {
      id: 'attempt-v1-failed',
      candidateId: 'candidate-internal',
      snapshotId: 'snapshot-internal',
      inputFingerprint: v1Fingerprint,
      provider: 'openai',
      model: 'selected-model',
      promptVersion: 'commercial-promotion-copy-v1', // Historical v1
      validationVersion: 'commercial-promotion-copy-validation-v2',
      startedAt: now,
      status: 'FAILED',
      generatedCopyId: null,
      failureCode: 'COMMERCIAL_AI_COPY_OUTPUT_INVALID',
      requestMayHaveStarted: true,
      providerHttpStatus: null,
      providerErrorCode: null,
      providerErrorType: null,
      providerErrorParam: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      validationFailureCodes: [],
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const provider = validProvider();
    const copyService = service(repository, provider);

    const report = await copyService.preview('candidate-internal');
    expect(report.cacheAvailable).toBe(false); // v13 preview não encontra cache de v1

    const result = await copyService.generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );
    expect(result.status).toBe('COPY_READY');
    expect(provider.generate).toHaveBeenCalledTimes(1); // provider called for v13

    const attempts = [...repository.attempts.values()];
    expect(attempts.length).toBe(2); // v1 and v13 attempts
    expect(attempts.find((a) => a.id === 'attempt-v1-failed')).toBeDefined(); // V1 attempt is preserved

    const newAttempt = attempts.find((a) => a.id !== 'attempt-v1-failed')!;
    expect(newAttempt.promptVersion).toBe('commercial-promotion-copy-v13');
    expect(newAttempt.status).toBe('SUCCEEDED');
    expect(newAttempt.inputFingerprint).not.toBe(v1Fingerprint);
  });

  it('não permite que um attempt FAILED com validationVersion anterior bloqueie a geração atual', async () => {
    const repository = new MemoryCopyRepository();
    const fingerprint = 'legacy-validation-v1-fingerprint';
    repository.attempts.set(fingerprint, {
      ...legacyAttempt('FAILED', fingerprint),
      validationVersion: 'commercial-promotion-copy-validation-v1',
    });
    const provider = validProvider();

    const result = await service(repository, provider).generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );

    expect(result.status).toBe('COPY_READY');
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(repository.attempts.size).toBe(2);
  });

  it('registra somente diagnóstico sanitizado para falha do provider', async () => {
    const repository = new MemoryCopyRepository();
    const logger = { info: vi.fn(), error: vi.fn() };
    const provider: CommercialAiCopyProvider = {
      generate: vi.fn().mockRejectedValue(
        new CommercialAiCopyProviderError(
          'FAILED_CONFIRMED',
          'COMMERCIAL_AI_COPY_QUOTA_EXCEEDED',
          {
            httpStatus: 429,
            providerErrorCode: 'insufficient_quota',
            providerErrorType: 'insufficient_quota',
            providerErrorParam: 'model',
          },
          { inputTokens: 12, outputTokens: 34, totalTokens: 46 },
          true,
        ),
      ),
    };
    const copyService = new CommercialPromotionCopyGenerationService({
      repository,
      provider,
      config: {
        enabled: true,
        provider: 'openai',
        model: 'Selected-Model',
        apiKeyConfigured: true,
        timeoutMs: 30_000,
        maxOutputTokens: 300,
        reasoningEffort: 'minimal',
        maximumCopyLength: 1_000,
      },
      logger,
      clock: () => now,
    });

    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_AI_COPY_QUOTA_EXCEEDED' });

    const fields = logger.error.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(fields).toEqual({
      event: 'commercial-ai-copy.provider-failed',
      candidateId: 'candidate-internal',
      provider: 'openai',
      model: 'selected-model',
      publicCode: 'COMMERCIAL_AI_COPY_QUOTA_EXCEEDED',
      failureKind: 'FAILED_CONFIRMED',
      requestMayHaveStarted: true,
      inputTokens: 12,
      outputTokens: 34,
      totalTokens: 46,
      reasoningTokens: null,
      providerErrorCode: 'insufficient_quota',
    });
    expect(JSON.stringify(fields)).not.toContain('affiliate');
    expect(JSON.stringify(fields)).not.toContain('inputFingerprint');
    expect([...repository.attempts.values()][0]).toMatchObject({
      status: 'FAILED',
      failureCode: 'COMMERCIAL_AI_COPY_QUOTA_EXCEEDED',
      providerHttpStatus: 429,
      providerErrorCode: 'insufficient_quota',
      providerErrorType: 'insufficient_quota',
      providerErrorParam: 'model',
      inputTokens: 12,
      outputTokens: 34,
      totalTokens: 46,
    });
  });

  it('marca timeout/rede incerta como AMBIGUOUS e bloqueia repetição', async () => {
    const repository = new MemoryCopyRepository();
    const provider: CommercialAiCopyProvider = {
      generate: vi.fn().mockRejectedValue(
        new CommercialAiCopyProviderError(
          'AMBIGUOUS',
          'COMMERCIAL_AI_COPY_PROVIDER_RESULT_AMBIGUOUS',
          {
            httpStatus: 503,
            providerErrorCode: 'server_error',
            providerErrorType: 'server_error',
            providerErrorParam: 'request',
          },
        ),
      ),
    };
    const copyService = service(repository, provider);
    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_AI_COPY_PROVIDER_RESULT_AMBIGUOUS',
    });
    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_AI_COPY_RESULT_AMBIGUOUS' });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect([...repository.attempts.values()][0]).toMatchObject({
      status: 'AMBIGUOUS',
      requestMayHaveStarted: true,
      providerHttpStatus: 503,
      providerErrorCode: 'server_error',
      providerErrorType: 'server_error',
      providerErrorParam: 'request',
    });
  });

  it('permite somente um provider em duas gerações concorrentes', async () => {
    const repository = new MemoryCopyRepository();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const provider = validProvider();
    vi.mocked(provider.generate).mockImplementation(async () => {
      await gate;
      return {
        output: {
          headline: 'OFERTA CONFIÁVEL',
          body: 'Uma escolha prática para sua rotina.',
        },
        provider: 'openai',
        model: 'selected-model',
        usage: {
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          reasoningTokens: null,
        },
      };
    });
    const copyService = service(repository, provider);
    const first = copyService.generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );
    await Promise.resolve();
    const second = copyService.generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );
    await expect(second).rejects.toMatchObject({
      code: 'COMMERCIAL_AI_COPY_GENERATION_IN_PROGRESS',
    });
    release();
    await expect(first).resolves.toMatchObject({ status: 'COPY_READY' });
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it('marca falha se snapshot mudar durante a chamada', async () => {
    const repository = new MemoryCopyRepository();
    repository.completionFailure = 'COMMERCIAL_AI_COPY_CATALOG_CHANGED';
    await expect(
      service(repository).generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_AI_COPY_CATALOG_CHANGED' });
    expect(repository.copies.size).toBe(0);
    expect(repository.context?.candidate.status).toBe('QUEUED');
    expect([...repository.attempts.values()][0]).toMatchObject({
      requestMayHaveStarted: true,
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    });
  });

  it('falha local persiste somente códigos permitidos, ordenados e deduplicados', async () => {
    const repository = new MemoryCopyRepository();
    const p = validProvider();
    p.generate = vi.fn().mockResolvedValue({
      output: {
        headline: 'x'.repeat(91), // AI_HEADLINE_LENGTH
        body: 'x'.repeat(261), // AI_BODY_LENGTH
        extra1: 1, // AI_OUTPUT_EXTRA_PROPERTY
        extra2: 2,
      },
      provider: 'openai',
      model: 'm',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    });
    const s = service(repository, p);
    await expect(
      s.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).rejects.toThrow('Output da IA rejeitado');
    const attempt = [...repository.attempts.values()][0];
    expect(attempt?.status).toBe('FAILED');
    expect(attempt?.failureCode).toBe('COMMERCIAL_AI_COPY_OUTPUT_INVALID');
    expect(attempt?.validationFailureCodes).toEqual([
      'AI_BODY_LENGTH',
      'AI_HEADLINE_LENGTH',
      'AI_HEADLINE_UPPERCASE',
      'AI_OUTPUT_EXTRA_PROPERTY',
    ]);
  });
});
