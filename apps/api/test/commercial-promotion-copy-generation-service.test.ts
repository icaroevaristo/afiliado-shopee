import { describe, expect, it, vi } from 'vitest';

import {
  CommercialAiCopyProviderError,
  type CommercialAiCopyProvider,
} from '../src/commercial-ai-copy-provider';
import { CommercialPromotionCopyGenerationService } from '../src/commercial-promotion-copy-generation-service';
import type {
  CommercialAiCopyClaimInput,
  CommercialAiCopyCompletionInput,
  CommercialCopyGenerationAttemptRecord,
  CommercialPromotionCopyContext,
  CommercialPromotionCopyRepository,
  GeneratedCopyRecord,
} from '../src/repositories';

const now = new Date('2026-08-01T12:00:00.000Z');
const affiliateLink = 'https://example.invalid/affiliate/internal';

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
    productName: 'Produto verificado',
    shopName: 'Loja verificada',
    price: '99.90',
    discountRate: 20,
    rating: 4.8,
    sales: 500,
    affiliateLink,
    offerEndsAt: new Date('2999-12-31T23:59:59.000Z'),
    unavailableAt: null,
    commercialSnapshotRevision: 2,
    commercialSnapshotFingerprint: 'snapshot-fingerprint',
    updatedAt: now,
  },
  snapshot: {
    id: 'snapshot-internal',
    productId: 'product-internal',
    revision: 2,
    fingerprint: 'snapshot-fingerprint',
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
    if (this.attempts.has(input.inputFingerprint)) return false;
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
      headline: 'Oferta confiável',
      body: 'Uma escolha prática para sua rotina.',
      cta: 'Confira os detalhes',
      hashtags: ['#Oferta'],
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
  promptVersion: 'commercial-promotion-copy-v2',
  validationVersion: 'commercial-promotion-copy-validation-v2',
  status,
  generatedCopyId: status === 'SUCCEEDED' ? 'copy-legacy' : null,
  failureCode: status === 'FAILED' ? 'COMMERCIAL_AI_COPY_PROVIDER_FAILED' : null,
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
) =>
  new CommercialPromotionCopyGenerationService({
    repository,
    provider,
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

  it('gera uma copy AI, vincula snapshot e reutiliza COPY_READY sem nova chamada', async () => {
    const repository = new MemoryCopyRepository();
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
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(repository.copies.size).toBe(1);
    expect(repository.attempts.size).toBe(1);
    expect(JSON.stringify(first)).not.toContain(affiliateLink);
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
    expect([...repository.copies.values()][0]?.mensagem).toContain(
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
    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        productName: 'Produto seguro',
        shopName: 'Loja segura',
      }),
    );
  });

  it('bloqueia copy pronta quando o link atual diverge do snapshot gerado', async () => {
    const repository = new MemoryCopyRepository();
    const copyService = service(repository);
    await copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA');
    repository.context!.product.affiliateLink =
      'https://example.invalid/affiliate/changed';
    repository.context!.product.updatedAt = new Date('2026-08-01T12:00:01Z');
    await expect(
      copyService.findCopy('candidate-internal'),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_AI_COPY_CACHE_INCONSISTENT' });
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
      repository.attempts.set(fingerprint, legacyAttempt(status, fingerprint));
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

  it('não reutiliza copy legada com fingerprint diferente e falha fechado', async () => {
    const repository = new MemoryCopyRepository();
    const fingerprint = 'legacy-hash-succeeded';
    repository.attempts.set(
      fingerprint,
      legacyAttempt('SUCCEEDED', fingerprint),
    );
    repository.copies.set(fingerprint, legacyCopy(fingerprint));
    const provider = validProvider();

    await expect(
      service(repository, provider).generate(
        'candidate-internal',
        'GERAR_COPY_COM_IA',
      ),
    ).rejects.toMatchObject({ code: 'COMMERCIAL_AI_COPY_CACHE_INCONSISTENT' });

    expect(provider.generate).not.toHaveBeenCalled();
    expect(repository.context?.candidate.generatedCopyId).toBeNull();
    expect(repository.copies.get(fingerprint)?.mensagem).toContain(
      'Produto anterior',
    );
  });

  it('não permite que um attempt FAILED v1 bloqueie a geração v2, gerando um fingerprint diferente e não o apagando', async () => {
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
    expect(report.cacheAvailable).toBe(false); // v2 preview não encontra cache de v1

    const result = await copyService.generate('candidate-internal', 'GERAR_COPY_COM_IA');
    expect(result.status).toBe('COPY_READY');
    expect(provider.generate).toHaveBeenCalledTimes(1); // provider called for v2

    const attempts = [...repository.attempts.values()];
    expect(attempts.length).toBe(2); // v1 and v2 attempts
    expect(attempts.find(a => a.id === 'attempt-v1-failed')).toBeDefined(); // V1 attempt is preserved

    const newAttempt = attempts.find(a => a.id !== 'attempt-v1-failed')!;
    expect(newAttempt.promptVersion).toBe('commercial-promotion-copy-v2');
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
      generate: vi
        .fn()
        .mockRejectedValue(
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
          headline: 'Oferta confiável',
          body: 'Uma escolha prática para sua rotina.',
          cta: 'Confira os detalhes',
          hashtags: ['#Oferta'],
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
        cta: 'Valid CTA',
        hashtags: ['#Valid'],
        extra1: 1, // AI_OUTPUT_EXTRA_PROPERTY
        extra2: 2,
      },
      provider: 'openai',
      model: 'm',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    });
    const s = service(repository, p);
    await expect(s.generate('candidate-internal', 'GERAR_COPY_COM_IA')).rejects.toThrow(
      'Output da IA rejeitado',
    );
    const attempt = [...repository.attempts.values()][0];
    expect(attempt?.status).toBe('FAILED');
    expect(attempt?.failureCode).toBe('COMMERCIAL_AI_COPY_OUTPUT_INVALID');
    expect(attempt?.validationFailureCodes).toEqual([
      'AI_BODY_LENGTH',
      'AI_HEADLINE_LENGTH',
      'AI_OUTPUT_EXTRA_PROPERTY',
    ]);
  });
});
