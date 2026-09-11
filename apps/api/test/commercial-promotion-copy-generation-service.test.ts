import { describe, expect, it, vi } from 'vitest';
import { PrismaCommercialPromotionCopyRepository } from '../src/prisma-repositories';
import { buildCommercialPromotionFallbackOutput, isSafeStoredCommercialPromotionCopy, validateCommercialPromotionFallbackOutput } from '../src/commercial-promotion-copy-fallback';
import { CommercialMessageDraftService } from '../src/commercial-message-draft-service';

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
import { COMMERCIAL_AI_COPY_TERMINAL_ATTEMPT_REJECTED } from '../src/commercial-promotion-candidate-terminal';
import { COMMERCIAL_AI_COPY_VALIDATION_VERSION } from '../src/commercial-ai-copy-prompt';
import {
  CommercialAiCopyValidator,
  sanitizeCommercialAiCopyValidationFailureCodes,
} from '../src/commercial-ai-copy-validator';
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
    if (existing) return false;
    if ([...this.attempts.values()].some((attempt) =>
      attempt.candidateId === input.candidateId && attempt.snapshotId === input.snapshotId &&
      ['STARTED', 'FAILED', 'AMBIGUOUS'].includes(attempt.status))) return false;
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
    const copy = [...this.copies.values()].find(({ id }) => id === input.copyId);
    if (!copy) return false;
    Object.assign(copy, input.assembled, {
      snapshotId: input.expected.snapshot.id,
      createdFromCandidateId: input.expected.candidate.id,
    });
    this.context.candidate.status = 'COPY_READY';
    this.context.candidate.generatedCopyId = input.copyId;
    return true;
  }
  async refreshCachedCopy(
    input: Parameters<
      CommercialPromotionCopyRepository['refreshCachedCopy']
    >[0],
  ) {
    if (
      !this.context ||
      this.context.candidate.status !== 'COPY_READY' ||
      this.context.candidate.generatedCopyId !== input.copyId
    ) {
      return false;
    }
    const copy = [...this.copies.values()].find(({ id }) => id === input.copyId);
    if (!copy) return false;
    Object.assign(copy, input.assembled);
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
  async completeFallback(
    input: Parameters<
      CommercialPromotionCopyRepository['completeFallback']
    >[0],
  ) {
    const attempt = this.attempts.get(input.inputFingerprint);
    if (
      !attempt ||
      attempt.status !== 'STARTED' ||
      !this.context ||
      this.context.candidate.id !== input.expected.candidate.id ||
      this.context.candidate.snapshotId !== input.expected.snapshot.id ||
      this.context.candidate.status !== 'QUEUED' ||
      this.context.candidate.generatedCopyId
    ) {
      return {
        completed: false as const,
        failureCode: 'COMMERCIAL_AI_COPY_CONFIGURATION_CHANGED',
      };
    }
    const copy: GeneratedCopyRecord = {
      id: this.copyId,
      ...input.copy,
      createdAt: input.completedAt,
    };
    this.copies.set(input.inputFingerprint, copy);
    Object.assign(attempt, {
      status: 'SUCCEEDED',
      generatedCopyId: copy.id,
      failureCode: null,
      requestMayHaveStarted: input.requestMayHaveStarted,
      providerHttpStatus: input.providerHttpStatus ?? null,
      providerErrorCode: input.providerErrorCode ?? input.failureCode,
      providerErrorType: input.providerErrorType ?? null,
      providerErrorParam: input.providerErrorParam ?? null,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      totalTokens: input.usage.totalTokens,
      validationFailureCodes:
        sanitizeCommercialAiCopyValidationFailureCodes(
          input.validationFailureCodes,
        ),
      completedAt: input.completedAt,
      updatedAt: input.completedAt,
    });
    this.context.candidate.status = 'COPY_READY';
    this.context.candidate.generatedCopyId = copy.id;
    this.context.candidate.blockedReason = null;
    return { completed: true as const, copy };
  }
  async markAttemptTerminal(
    input: Parameters<
      CommercialPromotionCopyRepository['markAttemptTerminal']
    >[0],
  ) {
    const attempt = this.attempts.get(input.inputFingerprint);
    if (
      !attempt ||
      attempt.candidateId !== input.candidateId ||
      attempt.snapshotId !== input.snapshotId
    ) {
      return { kind: 'CONFLICT' as const };
    }
    const kind =
      attempt.status === 'STARTED'
        ? ('TERMINALIZED' as const)
        : attempt.status === input.status &&
            (attempt.failureCode === input.failureCode ||
              (!attempt.failureCode &&
                input.failureCode ===
                  COMMERCIAL_AI_COPY_TERMINAL_ATTEMPT_REJECTED))
          ? ('REPAIRED' as const)
          : null;
    if (!kind) return { kind: 'CONFLICT' as const };
    if (kind === 'TERMINALIZED') {
      Object.assign(attempt, input, { updatedAt: input.completedAt });
    }
    if (!input.candidateBlockReason) {
      return { kind, candidateBlocked: false };
    }
    if (!this.context) return { kind: 'CONFLICT' as const };
    if (this.context.candidate.snapshotId !== input.snapshotId) {
      return { kind: 'CANDIDATE_ADVANCED' as const };
    }
    if (
      this.context.candidate.status === 'BLOCKED' &&
      [
        'COMMERCIAL_AI_COPY_OUTPUT_INVALID',
        COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED,
        COMMERCIAL_AI_COPY_TERMINAL_ATTEMPT_REJECTED,
      ].includes(this.context.candidate.blockedReason ?? '')
    ) {
      this.context.candidate.blockedReason = input.candidateBlockReason;
      return { kind, candidateBlocked: true };
    }
    if (
      !['QUEUED', 'COPY_READY'].includes(this.context.candidate.status)
    ) {
      return { kind: 'CONFLICT' as const };
    }
    this.context.candidate.status = 'BLOCKED';
    this.context.candidate.rankPosition = null;
    this.context.candidate.blockedReason = input.candidateBlockReason;
    this.context.candidate.lastEvaluatedAt = input.completedAt;
    return { kind, candidateBlocked: true };
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
      body: 'Produto verificado para sua rotina.',
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
  maximumCopyLength = 1_000,
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
       maximumCopyLength,
    },
    clock: () => now,
  });

describe('CommercialPromotionCopyGenerationService', () => {
  it('executa o marker somente imediatamente antes do provider externo', async () => {
    const repository = new MemoryCopyRepository();
    const events: string[] = [];
    const provider: CommercialAiCopyProvider = {
      generate: vi.fn(async () => {
        events.push('provider');
        return {
          output: {
            headline: 'OFERTA CONFIÁVEL',
            body: 'Produto verificado para sua rotina.',
          },
          provider: 'openai' as const,
          model: 'selected-model',
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
            reasoningTokens: 4,
          },
        };
      }),
    };
    const marker = vi.fn(async () => {
      events.push('marker');
    });

    await service(repository, provider).generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
      marker,
    );

    expect(events).toEqual(['marker', 'provider']);
    expect(marker).toHaveBeenCalledOnce();
  });

  it('nao marca fronteira externa quando usa fallback deterministico', async () => {
    const repository = new MemoryCopyRepository();
    const marker = vi.fn(async () => undefined);
    const provider = { generate: vi.fn() };
    const fallbackService = new CommercialPromotionCopyGenerationService({
      repository,
      provider,
      config: {
        enabled: false,
        provider: 'openai',
        model: null,
        apiKeyConfigured: false,
        timeoutMs: 30_000,
        maxOutputTokens: 300,
        reasoningEffort: 'minimal',
        maximumCopyLength: 1_000,
      },
      clock: () => now,
    });

    await fallbackService.generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
      marker,
    );

    expect(marker).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it.each(['FAILED', 'AMBIGUOUS', 'STARTED'] as const)('claim Prisma rejeita %s do snapshot inserido após precheck, mesmo com outro fingerprint', async (status) => {
    const repository = new MemoryCopyRepository();
    const expected = contextFixture();
    const prior = { ...legacyAttempt(status, 'other-generation-fingerprint') };
    const create = vi.fn();
    const findFirst = vi.fn(async () => prior);
    const transaction = {
      commercialPromotionCandidate: { findUnique: vi.fn(async () => ({
        ...expected.candidate, campaign: { ...expected.campaign, niche: expected.niche },
        snapshot: expected.snapshot,
        product: { ...expected.product, nome: expected.product.productName,
          loja: expected.product.shopName, preco: expected.product.price,
          precoMin: expected.product.priceMin, precoMax: expected.product.priceMax,
          desconto: expected.product.discountRate, comissao: expected.product.commissionRate,
          nota: expected.product.rating, vendidos: expected.product.sales },
      })) },
      commercialOfferSnapshot: { findUnique: vi.fn(async () => null) },
      commercialCopyGenerationAttempt: { findFirst, create },
    };
    const transact = vi.fn(
      async (
        callback: (tx: typeof transaction) => Promise<unknown>,
        options?: Record<string, unknown>,
      ) => {
        void options;
        return callback(transaction);
      },
    );
    const prismaRepository = new PrismaCommercialPromotionCopyRepository({ $transaction: transact } as never);
    vi.spyOn(repository, 'claim').mockImplementation((input) => prismaRepository.claim(input));
    const provider = validProvider();
    await expect(service(repository, provider).generate('candidate-internal', 'GERAR_COPY_COM_IA')).rejects.toMatchObject({
      code: status === 'STARTED' ? 'COMMERCIAL_AI_COPY_GENERATION_IN_PROGRESS' : COMMERCIAL_AI_COPY_TERMINAL_ATTEMPT_REJECTED,
    });
    expect(findFirst).toHaveBeenCalledWith({ where: { candidateId: expected.candidate.id,
      snapshotId: expected.snapshot.id, status: { in: ['STARTED', 'FAILED', 'AMBIGUOUS'] } }, select: { status: true } });
    expect(create).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
    expect(prior.status).toBe(status);
    expect(typeof transact.mock.calls[0]?.[0]).toBe('function');
    expect(transact.mock.calls[0]?.[1]).toEqual({ isolationLevel: 'Serializable' });
  });

  it('o contrato factual não permite usar fallback para texto inventado, URL ou claim', () => {
    const validator = new CommercialAiCopyValidator();
    expect(validateCommercialPromotionFallbackOutput(validator, {
      headline: 'OFERTA SELECIONADA', body: 'TV especial',
    }, 'TV', []).valid).toBe(false);
    for (const body of ['TV frete grátis', 'TV R$ 20', 'TV 50%', 'TV https://example.invalid/x']) {
      expect(validateCommercialPromotionFallbackOutput(validator, {
        headline: 'OFERTA SELECIONADA', body,
      }, body, []).valid).toBe(false);
    }
  });
  it.each(['FAILED_CONFIRMED', 'AMBIGUOUS'] as const)('fallback persiste com CHECK existente após provider %s', async (kind) => {
    const repository = new MemoryCopyRepository();
    const expected = contextFixture();
    const attempt = { ...legacyAttempt('STARTED'), promptVersion: 'commercial-promotion-copy-v14',
      validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION };
    const updateAttempt = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      // CommercialCopyGenerationAttempt_state_check, without a live database.
      const row = { ...attempt, ...data };
      const valid = (row.status === 'STARTED' && row.completedAt === null && row.generatedCopyId === null) ||
        (row.status === 'SUCCEEDED' && row.completedAt !== null && row.generatedCopyId !== null && row.failureCode === null) ||
        (['FAILED', 'AMBIGUOUS'].includes(row.status) && row.completedAt !== null && row.generatedCopyId === null);
      if (!valid) throw new Error('CommercialCopyGenerationAttempt_state_check');
      return { count: 1 };
    });
    const updateCandidate = vi.fn(async () => ({ count: 1 }));
    const transaction = {
      commercialPromotionCandidate: {
        findUnique: vi.fn(async () => ({
          ...expected.candidate,
          campaign: { ...expected.campaign, niche: expected.niche },
          snapshot: expected.snapshot,
          product: { ...expected.product, nome: expected.product.productName,
            loja: expected.product.shopName, preco: expected.product.price,
            precoMin: expected.product.priceMin, precoMax: expected.product.priceMax,
            desconto: expected.product.discountRate, comissao: expected.product.commissionRate,
            nota: expected.product.rating, vendidos: expected.product.sales },
        })),
        updateMany: updateCandidate,
      },
      commercialOfferSnapshot: { findUnique: vi.fn(async () => null) },
      commercialCopyGenerationAttempt: {
        findUnique: vi.fn(async () => attempt), updateMany: updateAttempt,
      },
      generatedCopy: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'copy-internal', ...data })),
      },
    };
    const transact = vi.fn(
      async (
        callback: (tx: typeof transaction) => Promise<unknown>,
        options?: Record<string, unknown>,
      ) => {
        void options;
        return callback(transaction);
      },
    );
    const prismaRepository = new PrismaCommercialPromotionCopyRepository({ $transaction: transact } as never);
    vi.spyOn(repository, 'completeFallback').mockImplementation((input) => prismaRepository.completeFallback(input));
    const provider = { generate: vi.fn().mockRejectedValue(new CommercialAiCopyProviderError(
      kind, 'COMMERCIAL_AI_COPY_PROVIDER_FAILED', {}, undefined, true,
    )) };
    const result = await service(repository, provider).generate('candidate-internal', 'GERAR_COPY_COM_IA');
    expect(result.status).toBe('COPY_READY');
    expect(updateAttempt).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: 'SUCCEEDED', failureCode: null, generatedCopyId: 'copy-internal',
      providerErrorCode: 'COMMERCIAL_AI_COPY_PROVIDER_FAILED', requestMayHaveStarted: true,
    }) }));
    expect(updateCandidate).toHaveBeenCalledWith(expect.objectContaining({ data: {
      status: 'COPY_READY', generatedCopyId: 'copy-internal', blockedReason: null,
    } }));
    expect(typeof transact.mock.calls[0]?.[0]).toBe('function');
    expect(transact.mock.calls[0]?.[1]).toEqual({ isolationLevel: 'Serializable' });
    expect(provider.generate).toHaveBeenCalledOnce();
  });
  it('T1 usa fallback determinístico quando o budget impede a chamada e preserva a tentativa', async () => {
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
    ).resolves.toMatchObject({
      status: 'COPY_READY',
      provider: 'deterministic-safe-fallback',
      model: 'commercial-safe-fallback-v1',
    });
    expect(actualProvider.generate).not.toHaveBeenCalled();
    expect([...repository.attempts.values()][0]).toMatchObject({
      status: 'SUCCEEDED',
      failureCode: null,
      providerErrorCode: 'COMMERCIAL_OPENAI_DAILY_BUDGET_REACHED',
      requestMayHaveStarted: false,
    });

    budgetNow = new Date('2026-08-02T12:00:00.000Z');
    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).resolves.toMatchObject({ status: 'COPY_READY', cacheHit: true });
    expect(actualProvider.generate).not.toHaveBeenCalled();
    expect([...repository.attempts.values()][0]).toMatchObject({
      status: 'SUCCEEDED',
      failureCode: null,
      providerErrorCode: 'COMMERCIAL_OPENAI_DAILY_BUDGET_REACHED',
      requestMayHaveStarted: false,
    });
  });

  it('T2 aprova preflight configurado sem construir ou chamar provider', () => {
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

  it('T3 mantém preview read-only e sanitizado', async () => {
    const repository = new MemoryCopyRepository();
    const before = JSON.stringify(repository.context);
    const report = await service(repository).preview('candidate-internal');
    expect(report.eligible).toBe(true);
    expect(JSON.stringify(report)).not.toContain(affiliateLink);
    expect(JSON.stringify(report)).toContain('[LINK_AFILIADO]');
    expect(JSON.stringify(repository.context)).toBe(before);
    expect(repository.attempts.size).toBe(0);
  });

  it('T4 envia ao provider somente o nome sanitizado e preserva a fonte original', async () => {
    const repository = new MemoryCopyRepository();
    const originalProductName = 'Air Fryer 6,5L 1700W 127V Original';
    repository.context!.product.productName = originalProductName;
    const provider = validProvider();
    vi.mocked(provider.generate).mockResolvedValue({
      output: {
        headline: 'OFERTA CONFIÁVEL',
        body: 'Air Fryer para sua rotina.',
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
    const validator = new CommercialAiCopyValidator();
    const validate = vi.spyOn(validator, 'validate');

    await service(repository, provider, validator).generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );
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
        promptVersion: 'commercial-promotion-copy-v14',
        validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
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
      }),
    );
  });

  it('usa referencia neutra sem claim ou provider quando a sanitização remove toda a identidade', async () => {
    const repository = new MemoryCopyRepository();
    repository.context!.product.productName = 'Original';
    const provider = validProvider();

    await expect(
      service(repository, provider).generate(
        'candidate-internal',
        'GERAR_COPY_COM_IA',
      ),
    ).resolves.toMatchObject({
      status: 'COPY_READY', provider: 'deterministic-safe-fallback',
    });

    expect(provider.generate).not.toHaveBeenCalled();
    expect(repository.claimInputs).toHaveLength(1);
    expect(repository.attempts.size).toBe(1);
    expect([...repository.copies.values()][0].mensagem).toContain('Produto selecionado');
  });

  it('T5 repara estado legado terminal no mesmo snapshot e libera N+1', async () => {
    const repository = new MemoryCopyRepository();
    let rejectedFingerprint: string | null = null;
    repository.findAttemptByInputFingerprint = vi.fn(
      async (fingerprint: string) => {
        rejectedFingerprint ??= fingerprint;
        if (fingerprint !== rejectedFingerprint) return null;
        const attempt = {
          ...legacyAttempt('FAILED', fingerprint),
          failureCode: 'COMMERCIAL_AI_COPY_OUTPUT_INVALID',
          validationFailureCodes: ['AI_PROHIBITED_CLAIM'],
        };
        repository.attempts.set(fingerprint, attempt);
        return attempt;
      },
    );
    const copyService = service(repository);

    await expect(
      copyService.preview('candidate-internal'),
    ).resolves.toMatchObject({
      eligible: false,
      blockers: [COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED],
    });
    expect(repository.context?.candidate.status).toBe('QUEUED');
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
    expect(repository.context?.candidate).toMatchObject({
      status: 'BLOCKED',
      rankPosition: null,
      blockedReason: COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED,
    });

    repository.context!.candidate.snapshotId = 'snapshot-current-2';
    repository.context!.candidate.status = 'QUEUED';
    repository.context!.candidate.blockedReason = null;
    repository.context!.snapshot.id = 'snapshot-current-2';
    repository.context!.snapshot.revision = 3;
    repository.context!.product.commercialSnapshotRevision = 3;
    repository.context!.product.productName = 'Produto verificado novo';

    await expect(
      copyService.preview('candidate-internal'),
    ).resolves.toMatchObject({
      eligible: true,
      blockers: [],
    });
  });

  it.each([
    ['STARTED', null, 'COMMERCIAL_AI_COPY_GENERATION_IN_PROGRESS'],
    ['AMBIGUOUS', null, 'COMMERCIAL_AI_COPY_TERMINAL_ATTEMPT_REJECTED'],
    [
      'FAILED',
      'COMMERCIAL_AI_COPY_PROVIDER_FAILED',
      'COMMERCIAL_AI_COPY_TERMINAL_ATTEMPT_REJECTED',
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

  it('T8 gera copy AI, vincula snapshot e reutiliza COPY_READY sem nova chamada', async () => {
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
    expect(first.promptVersion).toBe('commercial-promotion-copy-v14');
    expect(repository.claimInputs[0]?.inputFingerprint).toBeTruthy();
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(repository.copies.size).toBe(1);
    expect(repository.attempts.size).toBe(1);
    expect(JSON.stringify(first)).not.toContain(affiliateLink);
    expect(first.sanitizedCopy).toEqual({
      titulo: 'OFERTA CONFIÁVEL',
      mensagem:
        'Produto verificado para sua rotina.\n\u{1F525} POR: R$ 99,90\n\u{1F4B8} 20% OFF',
      cta: '\u{1F6D2} Compre aqui: [LINK_AFILIADO]',
      hashtags: '',
    });
    expect(JSON.stringify(first.sanitizedCopy)).toContain('Produto verificado');
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
    'cache atual válido não supera falha terminal %s do mesmo snapshot',
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
        eligible: false,
        cacheAvailable: true,
        blockers: [COMMERCIAL_AI_COPY_TERMINAL_ATTEMPT_REJECTED],
      });
      await expect(
        copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
      ).rejects.toMatchObject({
        code: COMMERCIAL_AI_COPY_TERMINAL_ATTEMPT_REJECTED,
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

  it('reutiliza cache quando apenas o contrato de montagem muda', async () => {
    const repository = new MemoryCopyRepository();
    const provider = validProvider();
    const copyService = service(repository, provider, undefined, 1_000);
    await copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA');
    repository.context!.candidate.status = 'QUEUED';
    repository.context!.candidate.generatedCopyId = null;
    const cached = await service(
      repository,
      provider,
      undefined,
      900,
    ).generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );

    expect(cached).toMatchObject({ status: 'COPY_READY', cacheHit: true });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(repository.copies.size).toBe(1);
  });

  it('T9 preserva histórico e reativa no snapshot N+1 sem segunda IA', async () => {
    const repository = new MemoryCopyRepository();
    const provider = validProvider();
    const copyService = service(repository, provider);
    await copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA');

    const nextSnapshotFingerprint = fingerprintCommercialOffer({
      source: 'OFFICIAL',
      providerProductId,
      productLink,
      affiliateLink,
      price: '89.90',
      priceMin: null,
      priceMax: null,
      discountRate: 30,
      commissionRate: 10,
      offerStartsAt: null,
      offerEndsAt: new Date('2999-12-31T23:59:59.000Z'),
      unavailableAt: null,
    });
    repository.context!.candidate.status = 'QUEUED';
    repository.context!.candidate.generatedCopyId = null;
    repository.context!.candidate.snapshotId = 'snapshot-internal-v2';
    repository.context!.product.price = '89.90';
    repository.context!.product.discountRate = 30;
    repository.context!.product.commercialSnapshotRevision = 3;
    repository.context!.product.commercialSnapshotFingerprint =
      nextSnapshotFingerprint;
    repository.context!.snapshot = {
      ...repository.context!.snapshot,
      id: 'snapshot-internal-v2',
      revision: 3,
      fingerprint: nextSnapshotFingerprint,
      price: '89.90',
      discountRate: 30,
    };

    await expect(
      copyService.preview('candidate-internal'),
    ).resolves.toMatchObject({ eligible: true, blockers: [] });
    const result = await copyService.generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );

    expect(result).toMatchObject({ status: 'COPY_READY', cacheHit: true });
    expect(provider.generate).toHaveBeenCalledOnce();
    expect(result.sanitizedCopy.mensagem).toContain('POR: R$ 89,90');
    expect(result.sanitizedCopy.mensagem).toContain('30% OFF');
    expect(repository.copies.values().next().value?.snapshotId).toBe(
      'snapshot-internal-v2',
    );
  });

  it('T10 falha fechado quando a copy diverge do fingerprint atual', async () => {
    const repository = new MemoryCopyRepository();
    repository.context!.product.productName = 'Produto Verificado A';
    repository.context!.product.shopName = 'Loja Verificada A';
    const provider = validProvider();
    const copyService = service(repository, provider);
    const first = await copyService.generate(
      'candidate-internal',
      'GERAR_COPY_COM_IA',
    );
    repository.context!.candidate.status = 'QUEUED';
    repository.context!.candidate.generatedCopyId = null;
    repository.context!.product.productName = 'Produto Verificado B';
    repository.context!.product.shopName = 'Loja Verificada B';

    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_AI_COPY_CACHE_INCONSISTENT' });

    expect(first.cacheHit).toBe(false);
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(repository.copies.size).toBe(1);
    expect([...repository.copies.values()][0]?.mensagem).not.toContain(
      'Produto Verificado A',
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
    vi.mocked(provider.generate).mockResolvedValue({
      output: {
        headline: 'OFERTA CONFIÁVEL',
        body: 'Produto seguro para sua rotina.',
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

  it('T6 reutiliza fallback sem nova chamada quando somente updatedAt muda', async () => {
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
    ).resolves.toMatchObject({
      status: 'COPY_READY',
      provider: 'deterministic-safe-fallback',
    });
    const [fingerprint] = repository.attempts.keys();
    repository.context!.product.updatedAt = new Date('2026-08-01T12:00:01Z');
    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).resolves.toMatchObject({ status: 'COPY_READY', cacheHit: true });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect([...repository.attempts.keys()]).toEqual([fingerprint]);
    expect(repository.context?.candidate.status).toBe('COPY_READY');
    expect([...repository.attempts.values()][0]).toMatchObject({
      status: 'SUCCEEDED',
      failureCode: null,
      providerErrorCode: 'COMMERCIAL_AI_COPY_PROVIDER_FAILED',
      requestMayHaveStarted: false,
    });
    expect(repository.copies.size).toBe(1);
  });

  it.each([
    ['FAILED', 'COMMERCIAL_AI_COPY_TERMINAL_ATTEMPT_REJECTED'],
    ['AMBIGUOUS', 'COMMERCIAL_AI_COPY_TERMINAL_ATTEMPT_REJECTED'],
    ['STARTED', 'COMMERCIAL_AI_COPY_GENERATION_IN_PROGRESS'],
  ] as const)(
    'bloqueia attempt legado %s do mesmo contrato sem nova chamada ao provider',
    async (status, code) => {
      const repository = new MemoryCopyRepository();
      const fingerprint = `legacy-hash-${status.toLowerCase()}`;
      repository.attempts.set(fingerprint, {
        ...legacyAttempt(status, fingerprint),
        promptVersion: 'commercial-promotion-copy-v14',
        validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
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
      expect(repository.context?.candidate.status).toBe(
        status === 'STARTED' ? 'QUEUED' : 'BLOCKED',
      );
      if (status !== 'STARTED') {
        expect(repository.context?.candidate.blockedReason).toBe(
          'COMMERCIAL_AI_COPY_TERMINAL_ATTEMPT_REJECTED',
        );
      }
    },
  );

  it('T7 torna o reparo legado idempotente sem chamar provider', async () => {
    const repository = new MemoryCopyRepository();
    let currentFingerprint: string | null = null;
    repository.findAttemptByInputFingerprint = vi.fn(
      async (fingerprint: string) => {
        currentFingerprint ??= fingerprint;
        const attempt = {
          ...legacyAttempt('FAILED', fingerprint),
          promptVersion: 'commercial-promotion-copy-v14',
          validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
          failureCode: 'COMMERCIAL_AI_COPY_OUTPUT_INVALID',
        };
        repository.attempts.set(fingerprint, attempt);
        return attempt;
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
    expect(repository.context?.candidate).toMatchObject({
      status: 'BLOCKED',
      blockedReason: COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED,
    });
  });

  it('preserva output invalid de snapshot anterior e permite o snapshot atual', async () => {
    const repository = new MemoryCopyRepository();
    const historicalFingerprint = 'historical-output-invalid-fingerprint';
    repository.attempts.set(historicalFingerprint, {
      ...legacyAttempt('FAILED', historicalFingerprint),
      snapshotId: 'snapshot-anterior',
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
      promptVersion: 'commercial-promotion-copy-v14',
      validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
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
      promptVersion: 'commercial-promotion-copy-v14',
      validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
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
      'COMMERCIAL_AI_COPY_TERMINAL_ATTEMPT_REJECTED',
    ],
    [
      'FAILED',
      'COMMERCIAL_AI_COPY_PROVIDER_FAILED',
      'COMMERCIAL_AI_COPY_TERMINAL_ATTEMPT_REJECTED',
    ],
  ] as const)(
    'mantem preview e generate coerentes para tentativa historica %s',
    async (status, failureCode, expectedCode) => {
      const repository = new MemoryCopyRepository();
      const historicalFingerprint = `historical-${status.toLowerCase()}-fingerprint`;
      repository.attempts.set(historicalFingerprint, {
        ...legacyAttempt(status, historicalFingerprint),
        promptVersion: 'commercial-promotion-copy-v14',
        validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
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

  it('snapshot terminal continua bloqueado na troca do contrato legado 1', async () => {
    const repository = new MemoryCopyRepository();
    const v9Fingerprint = 'v9-fingerprint-mock-hash';
    repository.attempts.set(v9Fingerprint, {
      ...legacyAttempt('FAILED', v9Fingerprint),
      promptVersion: 'commercial-promotion-copy-v9',
      validationVersion: 'commercial-promotion-copy-validation-v4',
    });
    const provider = validProvider();
    const history = structuredClone([...repository.attempts.values()]);
    await expect(service(repository, provider).generate(
      'candidate-internal', 'GERAR_COPY_COM_IA',
    )).rejects.toMatchObject({ code: expect.stringMatching(/^COMMERCIAL_AI_COPY_TERMINAL_/) });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(repository.context?.candidate.status).toBe('BLOCKED');
    expect([...repository.attempts.values()]).toEqual(history);
    expect(repository.copies.size).toBe(0);
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
      promptVersion: 'commercial-promotion-copy-v14',
    });
    expect(provider.generate).toHaveBeenCalledOnce();
    expect(repository.copies.size).toBe(2);
    expect(repository.context?.candidate.generatedCopyId).toBe('copy-internal');
    expect(repository.copies.get(fingerprint)?.mensagem).toContain(
      'Produto anterior',
    );
  });

  it('snapshot terminal continua bloqueado na troca do contrato legado 2', async () => {
    const repository = new MemoryCopyRepository();
    const v3Fingerprint = 'v3-fingerprint-mock-hash';
    repository.attempts.set(
      v3Fingerprint,
      legacyAttempt('FAILED', v3Fingerprint),
    );
    const provider = validProvider();
    const history = structuredClone([...repository.attempts.values()]);
    await expect(service(repository, provider).generate(
      'candidate-internal', 'GERAR_COPY_COM_IA',
    )).rejects.toMatchObject({ code: expect.stringMatching(/^COMMERCIAL_AI_COPY_TERMINAL_/) });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(repository.context?.candidate.status).toBe('BLOCKED');
    expect([...repository.attempts.values()]).toEqual(history);
    expect(repository.copies.size).toBe(0);
  });

  it('snapshot terminal continua bloqueado na troca do contrato legado 3', async () => {
    const repository = new MemoryCopyRepository();
    const v6Fingerprint = 'v6-fingerprint-mock-hash';
    repository.attempts.set(v6Fingerprint, {
      ...legacyAttempt('FAILED', v6Fingerprint),
      promptVersion: 'commercial-promotion-copy-v6',
      validationVersion: 'commercial-promotion-copy-validation-v3',
    });
    const provider = validProvider();
    const history = structuredClone([...repository.attempts.values()]);
    await expect(service(repository, provider).generate(
      'candidate-internal', 'GERAR_COPY_COM_IA',
    )).rejects.toMatchObject({ code: expect.stringMatching(/^COMMERCIAL_AI_COPY_TERMINAL_/) });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(repository.context?.candidate.status).toBe('BLOCKED');
    expect([...repository.attempts.values()]).toEqual(history);
    expect(repository.copies.size).toBe(0);
  });

  it('snapshot terminal continua bloqueado na troca do contrato legado 4', async () => {
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
    const history = structuredClone([...repository.attempts.values()]);
    await expect(service(repository, provider).generate(
      'candidate-internal', 'GERAR_COPY_COM_IA',
    )).rejects.toMatchObject({ code: expect.stringMatching(/^COMMERCIAL_AI_COPY_TERMINAL_/) });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(repository.context?.candidate.status).toBe('BLOCKED');
    expect([...repository.attempts.values()]).toEqual(history);
    expect(repository.copies.size).toBe(0);
  });

  it('snapshot terminal continua bloqueado na troca do contrato legado 5', async () => {
    const repository = new MemoryCopyRepository();
    const fingerprint = 'legacy-validation-v1-fingerprint';
    repository.attempts.set(fingerprint, {
      ...legacyAttempt('FAILED', fingerprint),
      validationVersion: 'commercial-promotion-copy-validation-v1',
    });
    const provider = validProvider();
    const history = structuredClone([...repository.attempts.values()]);
    await expect(service(repository, provider).generate(
      'candidate-internal', 'GERAR_COPY_COM_IA',
    )).rejects.toMatchObject({ code: expect.stringMatching(/^COMMERCIAL_AI_COPY_TERMINAL_/) });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(repository.context?.candidate.status).toBe('BLOCKED');
    expect([...repository.attempts.values()]).toEqual(history);
    expect(repository.copies.size).toBe(0);
  });

  it('T11 registra diagnóstico sanitizado e usa fallback após falha do provider', async () => {
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
    ).resolves.toMatchObject({
      status: 'COPY_READY',
      provider: 'deterministic-safe-fallback',
    });

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
      status: 'SUCCEEDED',
      failureCode: null,
      providerHttpStatus: 429,
      providerErrorCode: 'insufficient_quota',
      providerErrorType: 'insufficient_quota',
      providerErrorParam: 'model',
      inputTokens: 12,
      outputTokens: 34,
      totalTokens: 46,
    });
  });

  it('T12 usa fallback após timeout ambíguo e não repete o provider', async () => {
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
    ).resolves.toMatchObject({
      status: 'COPY_READY',
      provider: 'deterministic-safe-fallback',
    });
    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).resolves.toMatchObject({ status: 'COPY_READY', cacheHit: true });
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect([...repository.attempts.values()][0]).toMatchObject({
      status: 'SUCCEEDED',
      requestMayHaveStarted: true,
      providerHttpStatus: 503,
      providerErrorCode: 'server_error',
      providerErrorType: 'server_error',
      providerErrorParam: 'request',
    });
  });

  it.each([
    [
      'HTTP 500',
      new CommercialAiCopyProviderError(
        'FAILED_CONFIRMED',
        'COMMERCIAL_AI_COPY_PROVIDER_SERVER_ERROR',
        { httpStatus: 500, providerErrorType: 'server_error' },
        undefined,
        true,
      ),
    ],
    [
      'network/offline',
      new CommercialAiCopyProviderError(
        'AMBIGUOUS',
        'COMMERCIAL_AI_COPY_PROVIDER_RESULT_AMBIGUOUS',
        {},
        undefined,
        true,
      ),
    ],
    [
      'truncation/incomplete output',
      new CommercialAiCopyProviderError(
        'FAILED_CONFIRMED',
        'COMMERCIAL_AI_COPY_OUTPUT_TOKEN_LIMIT',
        { providerErrorCode: 'max_output_tokens' },
        { inputTokens: 11, outputTokens: 22, totalTokens: 33 },
        true,
      ),
    ],
    [
      'malformed structured output/invalid JSON',
      new CommercialAiCopyProviderError(
        'FAILED_CONFIRMED',
        'COMMERCIAL_AI_COPY_PROVIDER_OUTPUT_INVALID',
        {},
        { inputTokens: 7, outputTokens: 9, totalTokens: 16 },
        true,
      ),
    ],
  ] as const)('T13 usa fallback direto para %s', async (_label, providerError) => {
    const repository = new MemoryCopyRepository();
    const provider: CommercialAiCopyProvider = {
      generate: vi.fn().mockRejectedValue(providerError),
    };

    await expect(
      service(repository, provider).generate(
        'candidate-internal',
        'GERAR_COPY_COM_IA',
      ),
    ).resolves.toMatchObject({
      status: 'COPY_READY',
      provider: 'deterministic-safe-fallback',
      model: 'commercial-safe-fallback-v1',
    });

    expect(provider.generate).toHaveBeenCalledOnce();
    expect(repository.copies.size).toBe(1);
    expect([...repository.attempts.values()][0]).toMatchObject({
      status: 'SUCCEEDED',
      failureCode: null,
      requestMayHaveStarted: providerError.requestMayHaveStarted,
      providerHttpStatus: providerError.httpStatus ?? null,
      providerErrorCode: providerError.providerErrorCode ?? providerError.publicCode,
      inputTokens: providerError.inputTokens,
      outputTokens: providerError.outputTokens,
      totalTokens: providerError.totalTokens,
    });
  });

  it('T16 preserva STARTED se houver crash antes da persistência terminal do fallback', async () => {
    const repository = new MemoryCopyRepository();
    const provider: CommercialAiCopyProvider = {
      generate: vi.fn().mockRejectedValue(
        new CommercialAiCopyProviderError(
          'FAILED_CONFIRMED',
          'COMMERCIAL_AI_COPY_PROVIDER_SERVER_ERROR',
          { httpStatus: 500 },
          undefined,
          true,
        ),
      ),
    };
    vi.spyOn(repository, 'completeFallback').mockRejectedValueOnce(
      new Error('simulated crash before terminal persistence'),
    );
    const copyService = service(repository, provider);

    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_AI_COPY_PERSISTENCE_AMBIGUOUS',
    });
    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_AI_COPY_GENERATION_IN_PROGRESS',
    });

    expect(provider.generate).toHaveBeenCalledOnce();
    expect(repository.copies.size).toBe(0);
    expect(repository.context?.candidate).toMatchObject({
      status: 'QUEUED',
      generatedCopyId: null,
    });
    expect([...repository.attempts.values()][0]).toMatchObject({
      status: 'STARTED',
      failureCode: null,
      completedAt: null,
    });
  });

  it('T17 recupera copy persistida se houver crash depois da persistência terminal do fallback', async () => {
    const repository = new MemoryCopyRepository();
    const provider: CommercialAiCopyProvider = {
      generate: vi.fn().mockRejectedValue(
        new CommercialAiCopyProviderError(
          'FAILED_CONFIRMED',
          'COMMERCIAL_AI_COPY_PROVIDER_SERVER_ERROR',
          { httpStatus: 500 },
          undefined,
          true,
        ),
      ),
    };
    const completeFallback = repository.completeFallback.bind(repository);
    vi.spyOn(repository, 'completeFallback').mockImplementationOnce(
      async (input) => {
        await completeFallback(input);
        throw new Error('simulated crash after terminal persistence');
      },
    );
    const copyService = service(repository, provider);

    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_AI_COPY_PERSISTENCE_AMBIGUOUS',
    });
    expect(repository.context?.candidate).toMatchObject({
      status: 'COPY_READY',
      generatedCopyId: 'copy-internal',
    });
    expect([...repository.attempts.values()][0]).toMatchObject({
      status: 'SUCCEEDED',
      failureCode: null,
      providerErrorCode: 'COMMERCIAL_AI_COPY_PROVIDER_SERVER_ERROR',
      providerHttpStatus: 500,
    });

    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).resolves.toMatchObject({
      status: 'COPY_READY',
      provider: 'deterministic-safe-fallback',
      cacheHit: true,
    });
    expect(provider.generate).toHaveBeenCalledOnce();
    expect(repository.copies.size).toBe(1);
  });
  it('T15 permite somente um provider em duas gerações concorrentes', async () => {
    const repository = new MemoryCopyRepository();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const provider = validProvider();
    vi.mocked(provider.generate).mockImplementation(async () => {
      await gate;
      return {
        output: {
          headline: 'OFERTA CONFIÁVEL',
          body: 'Produto verificado para sua rotina.',
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

  it('T14 não usa fallback quando a persistência normal fica ambígua', async () => {
    const repository = new MemoryCopyRepository();
    const provider = validProvider();
    const fallback = vi.spyOn(repository, 'completeFallback');
    repository.complete = vi.fn().mockRejectedValue(new Error('db timeout'));

    await expect(
      service(repository, provider).generate(
        'candidate-internal',
        'GERAR_COPY_COM_IA',
      ),
    ).rejects.toMatchObject({
      code: 'COMMERCIAL_AI_COPY_PERSISTENCE_AMBIGUOUS',
    });

    expect(provider.generate).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
    expect(repository.copies.size).toBe(0);
    expect([...repository.attempts.values()][0]).toMatchObject({
      status: 'AMBIGUOUS',
      failureCode: 'COMMERCIAL_AI_COPY_PERSISTENCE_AMBIGUOUS',
    });
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

  it('audita output inválido com evidência sanitizada e usa fallback determinístico', async () => {
    const repository = new MemoryCopyRepository();
    const logger = { info: vi.fn(), error: vi.fn() };
    const p = validProvider();
    p.generate = vi.fn().mockResolvedValue({
      output: {
        headline: 'OFERTA SEGURA',
        body: 'Produto verificado por R$ especial',
      },
      provider: 'openai',
      model: 'm',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    });
    const s = new CommercialPromotionCopyGenerationService({
      repository,
      provider: p,
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
      logger,
      clock: () => now,
    });
    await expect(
      s.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).resolves.toMatchObject({
      status: 'COPY_READY',
      provider: 'deterministic-safe-fallback',
    });
    const attempt = [...repository.attempts.values()][0];
    expect(attempt?.status).toBe('SUCCEEDED');
    expect(attempt?.failureCode).toBeNull();
    expect(attempt?.providerErrorCode).toBe('COMMERCIAL_AI_COPY_OUTPUT_INVALID');
    expect(attempt?.validationFailureCodes).toEqual([
      'AI_FACTUAL_CAUSE_MONEY_OR_PERCENT',
      'AI_FACTUAL_CAUSE_UNSUPPORTED_IDENTITY',
      'AI_FACTUAL_VALUE_FORBIDDEN',
    ]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'commercial-ai-copy.validation-failed',
        failureCode: 'COMMERCIAL_AI_COPY_OUTPUT_INVALID',
        auditFailureCodes: expect.arrayContaining([
          'AI_FACTUAL_CAUSE_MONEY_OR_PERCENT',
          'AI_FACTUAL_CAUSE_UNSUPPORTED_IDENTITY',
        ]),
        auditEvidence: expect.arrayContaining([
          'money:R$',
          'identity:especial',
        ]),
      }),
      'Commercial AI copy validation failed',
    );
  });

  it('IA desabilitada com provider e credenciais configurados usa fallback sem chamada ou loop', async () => {
    const repository = new MemoryCopyRepository();
    const provider = validProvider();
    const copyService = new CommercialPromotionCopyGenerationService({
      repository,
      provider,
      config: {
        enabled: false,
        provider: 'openai',
        model: 'selected-model',
        apiKeyConfigured: true,
        timeoutMs: 30_000,
        maxOutputTokens: 300,
        reasoningEffort: 'minimal',
        maximumCopyLength: 1_000,
      },
      clock: () => now,
    });
    expect(copyService.preflight()).toMatchObject({
      enabled: false, providerConfigured: true, apiKeyConfigured: true,
    });
    const first = await copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA');
    expect(first).toMatchObject({
      status: 'COPY_READY', cacheHit: false,
      provider: 'deterministic-safe-fallback', model: 'commercial-safe-fallback-v1',
    });
    for (let replay = 0; replay < 2; replay += 1) {
      await expect(copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA')).resolves.toMatchObject({
        status: 'COPY_READY', cacheHit: true, generatedCopyId: first.generatedCopyId,
        provider: 'deterministic-safe-fallback',
      });
    }
    expect(provider.generate).not.toHaveBeenCalled();
    expect(repository.attempts.size).toBe(1);
    expect(repository.copies.size).toBe(1);
    expect([...repository.attempts.values()][0]).toMatchObject({
      status: 'SUCCEEDED', requestMayHaveStarted: false,
      generatedCopyId: first.generatedCopyId, provider: 'deterministic-safe-fallback',
    });
  });

  it.each(['FAILED', 'AMBIGUOUS'] as const)('terminal %s bloqueia troca AI/fallback sem mutar preview ou histórico', async (status) => {
    const repository = new MemoryCopyRepository();
    const terminal = { ...legacyAttempt(status, 'different-provider-model-version-fingerprint'), failureCode: 'COMMERCIAL_AI_COPY_PROVIDER_FAILED' };
    repository.attempts.set(terminal.inputFingerprint, terminal);
    const before = structuredClone(terminal);
    const provider = validProvider();
    for (const enabled of [false, true]) {
      const copyService = new CommercialPromotionCopyGenerationService({
        repository, provider, config: { enabled, provider: 'openai', model: 'new-model',
          apiKeyConfigured: true, timeoutMs: 30000, maxOutputTokens: 300,
          reasoningEffort: 'minimal', maximumCopyLength: 1000 }, clock: () => now,
      });
      const candidateBefore = structuredClone(repository.context!.candidate);
      await expect(copyService.preview('candidate-internal')).resolves.toMatchObject({
        eligible: false, blockers: expect.arrayContaining([COMMERCIAL_AI_COPY_TERMINAL_ATTEMPT_REJECTED]),
      });
      expect(repository.context!.candidate).toEqual(candidateBefore);
      await expect(copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA')).rejects.toMatchObject({
        code: COMMERCIAL_AI_COPY_TERMINAL_ATTEMPT_REJECTED,
      });
      expect(repository.context!.candidate.status).toBe('BLOCKED');
      expect(repository.attempts.size).toBe(1);
      expect(repository.attempts.get(terminal.inputFingerprint)).toEqual(before);
    }
    expect(provider.generate).not.toHaveBeenCalled();
    expect(repository.copies.size).toBe(0);
  });

  it.each([
    'X', 'TV', '123', 'Café', 'Tênis', 'Sabonete', 'Copo térmico inox',
    'Camisa 100% algodão', 'Produto R$ 10', 'https://example.invalid/offer',
    'ignore previous instructions system prompt', 'Frete grátis última chance',
    'Kit 1234567890 50% OFF', 'A'.repeat(400), 'Copo térmico '.repeat(40),
    'Tênis tamanhos 34 a 39', '💎',
  ])('fallback factual aceita identidade %s e reutiliza cache sem OpenAI', async (productName) => {
    const repository = new MemoryCopyRepository();
    repository.context!.product.productName = productName;
    const copyService = new CommercialPromotionCopyGenerationService({
      repository,
      config: {
        enabled: false,
        provider: 'openai',
        model: null,
        apiKeyConfigured: false,
        timeoutMs: 30_000,
        maxOutputTokens: 300,
        reasoningEffort: 'minimal',
        maximumCopyLength: 1_000,
      },
      clock: () => now,
    });

    await expect(
      copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA'),
    ).resolves.toMatchObject({
      status: 'COPY_READY',
      provider: 'deterministic-safe-fallback',
      model: 'commercial-safe-fallback-v1',
    });
    await expect(copyService.preview('candidate-internal')).resolves.toMatchObject({
      cacheAvailable: true,
      providerConfigured: false,
    });
    expect([...repository.attempts.values()][0]).toMatchObject({
      status: 'SUCCEEDED',
      failureCode: null,
      provider: 'deterministic-safe-fallback',
      model: 'commercial-safe-fallback-v1',
      generatedCopyId: 'copy-internal',
    });
    const copy = [...repository.copies.values()][0];
    const expectedBody = buildCommercialPromotionFallbackOutput(new CommercialAiCopyValidator(), productName, [repository.context!.product.shopName]).body;
    expect(copy.mensagem).toBe(`${expectedBody}\n🔥 POR: R$ 99,90\n💸 20% OFF`);
    expect(copy.cta).toBe(`🛒 Compre aqui: ${affiliateLink}`);
    await expect(copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA')).resolves.toMatchObject({
      cacheHit: true, generatedCopyId: copy.id,
    });
    expect(repository.attempts.size).toBe(1);
    const context = repository.context!;
    expect(isSafeStoredCommercialPromotionCopy(copy, {
      productName, shopName: context.product.shopName, price: context.product.price,
      discountRate: context.product.discountRate, promotionSignals: context.candidate.promotionSignals,
      priceDropPercent: context.candidate.priceDropPercent,
    }, affiliateLink, 1000)).toBe(true);
    const draft = new CommercialMessageDraftService().createDraft({
      ...context.candidate, generatedCopyId: context.candidate.generatedCopyId ?? null,
      generatedCopy: { ...copy, snapshotId: copy.snapshotId ?? null,
        createdFromCandidateId: copy.createdFromCandidateId ?? null },
      product: { ...context.product, urlImagem: context.product.urlImagem ?? '' }, snapshot: context.snapshot,
    }, { now: () => now });
    expect(draft.caption).toContain(copy.cta);
    expect(draft.caption.split(affiliateLink)).toHaveLength(2);
    if (productName.length < 10) {
      // OpenAI remains subject to the original creative-output minimum length.
      expect(new CommercialAiCopyValidator().validate({
        headline: 'OFERTA SELECIONADA', body: productName,
      }, productName).publicFailureCodes).toContain('AI_BODY_LENGTH');
    }
  });
});
