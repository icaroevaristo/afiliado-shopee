import type { FastifyBaseLogger } from 'fastify';
import type { CommercialAiCopyReasoningEffort } from '@shopee-auto-affiliate-ai/config';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

import {
  CommercialAiCopyProviderError,
  normalizeCommercialAiCopyModel,
  type CommercialAiCopyProvider,
  type CommercialAiCopyProviderErrorMetadata,
  type CommercialAiCopyProviderResult,
} from './commercial-ai-copy-provider';
import {
  commercialAiCopyInputFingerprint,
  sha256,
} from './commercial-ai-copy-fingerprint';
import {
  COMMERCIAL_AI_COPY_PROMPT_VERSION,
  COMMERCIAL_AI_COPY_VALIDATION_VERSION,
  COMMERCIAL_AI_COPY_INPUT_SANITIZATION_VERSION,
  normalizeUntrustedCommercialText,
} from './commercial-ai-copy-prompt';
import { sanitizeCommercialAiCopyProductNameForModel } from './commercial-ai-copy-policy';
import {
  CommercialAiCopyValidator,
  sanitizeCommercialAiCopyValidationFailureCodes,
} from './commercial-ai-copy-validator';
import { validateCommercialAffiliateLinkProvenance } from './commercial-affiliate-link-provenance';
import {
  CommercialPromotionCopyAssembler,
  extractCachedCommercialAiCopyOutput,
  hasAsciiControlOrDel,
  isSafeAssembledCommercialPromotionCopy,
  sanitizeCommercialPromotionCopy,
  type AssembledCommercialPromotionCopy,
} from './commercial-promotion-copy-assembler';
import type {
  CommercialPromotionCopyContext,
  CommercialPromotionCopyRepository,
  CommercialAiCopyCompletionResult,
  CommercialCopyGenerationAttemptRecord,
  GeneratedCopyRecord,
} from './repositories';

export const COMMERCIAL_AI_COPY_CONFIRMATION = 'GERAR_COPY_COM_IA';
export const COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED =
  'COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED';

export type CommercialAiCopyConfig = {
  enabled: boolean;
  provider: 'openai';
  model: string | null;
  apiKeyConfigured: boolean;
  timeoutMs: number;
  maxOutputTokens: number;
  reasoningEffort: CommercialAiCopyReasoningEffort;
  maximumCopyLength: number;
};

type ServiceOptions = {
  repository: CommercialPromotionCopyRepository;
  provider?: CommercialAiCopyProvider;
  config: CommercialAiCopyConfig;
  validator?: CommercialAiCopyValidator;
  assembler?: CommercialPromotionCopyAssembler;
  clock?: () => Date;
  logger?: Pick<FastifyBaseLogger, 'info' | 'error'>;
};

const fail = (message: string, code: string): never => {
  throw new AppError(message, code);
};

const validAffiliateLink = (value: string | null) => {
  if (!value || hasAsciiControlOrDel(value)) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
};

const candidateBlockers = (
  context: CommercialPromotionCopyContext,
  now: Date,
) => {
  const blockers: string[] = [];
  const { candidate, campaign, niche, product, snapshot } = context;
  if (candidate.status === 'COPY_READY' || candidate.generatedCopyId) {
    blockers.push('COMMERCIAL_AI_COPY_ALREADY_READY');
  } else if (candidate.status !== 'QUEUED') {
    blockers.push('COMMERCIAL_AI_COPY_CANDIDATE_NOT_QUEUED');
  }
  if (!campaign.active) blockers.push('COMMERCIAL_AI_COPY_CAMPAIGN_INACTIVE');
  if (!niche.active) blockers.push('COMMERCIAL_AI_COPY_NICHE_INACTIVE');
  if (product.source !== 'OFFICIAL')
    blockers.push('COMMERCIAL_AI_COPY_SOURCE_INVALID');
  if (product.unavailableAt)
    blockers.push('COMMERCIAL_AI_COPY_OFFER_UNAVAILABLE');
  if (
    (product.offerEndsAt && product.offerEndsAt <= now) ||
    (candidate.expiresAt && candidate.expiresAt <= now)
  ) {
    blockers.push('COMMERCIAL_AI_COPY_OFFER_EXPIRED');
  }
  const affiliateLinkValidation =
    validateCommercialAffiliateLinkProvenance(context);
  if (!affiliateLinkValidation.valid) {
    blockers.push(affiliateLinkValidation.code);
  }
  if (
    candidate.snapshotId !== snapshot.id ||
    snapshot.productId !== product.id ||
    product.commercialSnapshotRevision !== snapshot.revision ||
    product.commercialSnapshotFingerprint !== snapshot.fingerprint
  ) {
    blockers.push('COMMERCIAL_AI_COPY_SNAPSHOT_OUTDATED');
  }
  if (candidate.commercialScore < niche.minimumScore) {
    blockers.push('COMMERCIAL_AI_COPY_SCORE_BELOW_MINIMUM');
  }
  return [...new Set(blockers)];
};

const assertNoBlockers = (blockers: string[]) => {
  if (blockers[0]) fail('Candidato indisponivel para geracao', blockers[0]);
};

export class CommercialPromotionCopyGenerationService {
  private readonly validator: CommercialAiCopyValidator;
  private readonly assembler: CommercialPromotionCopyAssembler;
  private readonly clock: () => Date;

  constructor(private readonly options: ServiceOptions) {
    this.validator = options.validator ?? new CommercialAiCopyValidator();
    this.assembler =
      options.assembler ?? new CommercialPromotionCopyAssembler();
    this.clock = options.clock ?? (() => new Date());
  }

  private providerConfigured() {
    return (
      Boolean(this.options.config.model) &&
      this.options.config.apiKeyConfigured &&
      this.options.config.provider === 'openai'
    );
  }

  preflight() {
    const providerConfigured = this.providerConfigured();
    return {
      approved: this.options.config.enabled && providerConfigured,
      enabled: this.options.config.enabled,
      provider: this.options.config.provider,
      modelConfigured: Boolean(this.options.config.model),
      apiKeyConfigured: this.options.config.apiKeyConfigured,
      promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
      validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
      inputSanitizationVersion: COMMERCIAL_AI_COPY_INPUT_SANITIZATION_VERSION,
      timeoutMs: this.options.config.timeoutMs,
      maxOutputTokens: this.options.config.maxOutputTokens,
      reasoningEffort: this.options.config.reasoningEffort,
      maximumCopyLength: this.options.config.maximumCopyLength,
    };
  }

  private async context(
    candidateId: string,
  ): Promise<CommercialPromotionCopyContext> {
    const context = await this.options.repository.loadContext(candidateId);
    if (!context) {
      throw new AppError(
        'Candidato promocional nao encontrado',
        'COMMERCIAL_PROMOTION_CANDIDATE_NOT_FOUND',
      );
    }
    return context;
  }

  private fingerprint(
    context: CommercialPromotionCopyContext,
    configuration: {
      provider: string;
      model: string | null;
    } = this.options.config,
  ) {
    const model = configuration.model;
    if (!model || !context.product.affiliateLink) return null;
    return commercialAiCopyInputFingerprint({
      promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
      validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
      inputSanitizationVersion: COMMERCIAL_AI_COPY_INPUT_SANITIZATION_VERSION,
      modelProductName: this.modelProductName(context),
      provider: configuration.provider,
      model,
      campaignId: context.campaign.id,
      nicheId: context.niche.id,
      candidateId: context.candidate.id,
      productId: context.product.id,
      snapshotId: context.snapshot.id,
      snapshotRevision: context.snapshot.revision,
      snapshotFingerprint: context.snapshot.fingerprint,
    });
  }

  private assembleCachedCopy(
    copy: GeneratedCopyRecord,
    context: CommercialPromotionCopyContext,
  ): AssembledCommercialPromotionCopy | null {
    if (!context.product.affiliateLink) return null;
    const output = extractCachedCommercialAiCopyOutput(copy);
    if (!output) return null;
    const facts = this.validationFacts(context);
    const validation = this.validator.validate(
      output,
      facts.productName,
      [facts.shopName],
    );
    if (!validation.valid || !validation.sanitizedOutput) return null;
    try {
      const assembled = this.assembler.assemble({
        output: validation.sanitizedOutput,
        productName: context.product.productName,
        shopName: context.product.shopName,
        price: context.product.price,
        discountRate: context.product.discountRate,
        promotionSignals: context.candidate.promotionSignals,
        priceDropPercent: context.candidate.priceDropPercent,
        affiliateLink: context.product.affiliateLink,
        maximumLength: this.options.config.maximumCopyLength,
      });
      return isSafeAssembledCommercialPromotionCopy(
        assembled,
        context.product.affiliateLink,
        {
          productName: context.product.productName,
          shopName: context.product.shopName,
          price: context.product.price,
          discountRate: context.product.discountRate,
          promotionSignals: context.candidate.promotionSignals,
          priceDropPercent: context.candidate.priceDropPercent,
        },
        this.options.config.maximumCopyLength,
      )
        ? assembled
        : null;
    } catch {
      return null;
    }
  }

  private validCache(
    copy: GeneratedCopyRecord | null,
    context: CommercialPromotionCopyContext,
    fingerprint: string,
  ): AssembledCommercialPromotionCopy | null {
    if (
      !copy ||
      copy.source !== 'AI' ||
      copy.provider !== this.options.config.provider ||
      copy.model !== this.options.config.model ||
      copy.promptVersion !== COMMERCIAL_AI_COPY_PROMPT_VERSION ||
      copy.validationVersion !== COMMERCIAL_AI_COPY_VALIDATION_VERSION ||
      copy.inputFingerprint !== fingerprint ||
      copy.productId !== context.product.id ||
      copy.createdFromCandidateId !== context.candidate.id
    ) {
      return null;
    }
    return this.assembleCachedCopy(copy, context);
  }

  private validLinkedCopy(
    copy: GeneratedCopyRecord,
    context: CommercialPromotionCopyContext,
  ): AssembledCommercialPromotionCopy | null {
    const model = this.options.config.model ?? copy.model ?? null;
    const provider = this.options.config.provider ?? copy.provider ?? '';
    const fingerprint = model
      ? this.fingerprint(context, { provider, model })
      : null;
    if (
      !model ||
      copy.id !== context.candidate.generatedCopyId ||
      copy.source !== 'AI' ||
      copy.provider !== provider ||
      copy.model !== model ||
      copy.promptVersion !== COMMERCIAL_AI_COPY_PROMPT_VERSION ||
      copy.validationVersion !== COMMERCIAL_AI_COPY_VALIDATION_VERSION ||
      (fingerprint
        ? copy.inputFingerprint !== fingerprint
        : !copy.inputFingerprint) ||
      copy.snapshotId !== context.snapshot.id ||
      copy.productId !== context.product.id ||
      copy.createdFromCandidateId !== context.candidate.id
    ) {
      return null;
    }
    return this.assembleCachedCopy(copy, context);
  }

  private assemblePreview(
    context: CommercialPromotionCopyContext,
    facts: ReturnType<
      CommercialPromotionCopyGenerationService['validationFacts']
    >,
  ) {
    if (!context.product.affiliateLink) return null;
    const copy = this.assembler.assemble({
      output: {
        headline: 'Oferta selecionada',
        body: 'Uma escolha com informações comerciais verificadas.',
      },
      productName: facts.productName,
      shopName: facts.shopName,
      price: context.product.price,
      discountRate: context.product.discountRate,
      promotionSignals: context.candidate.promotionSignals,
      priceDropPercent: context.candidate.priceDropPercent,
      affiliateLink: context.product.affiliateLink,
      maximumLength: this.options.config.maximumCopyLength,
    });
    return sanitizeCommercialPromotionCopy(copy, context.product.affiliateLink);
  }

  private attemptBlocker(
    attempt: CommercialCopyGenerationAttemptRecord | null,
    scope: 'current' | 'historical',
  ): string | null {
    if (!attempt) return null;
    if (attempt.status === 'SUCCEEDED') {
      return scope === 'historical'
        ? 'COMMERCIAL_AI_COPY_CACHE_INCONSISTENT'
        : null;
    }
    if (attempt.status === 'STARTED') {
      return 'COMMERCIAL_AI_COPY_GENERATION_IN_PROGRESS';
    }
    if (attempt.status === 'AMBIGUOUS') {
      return 'COMMERCIAL_AI_COPY_RESULT_AMBIGUOUS';
    }
    if (
      attempt.failureCode === 'COMMERCIAL_OPENAI_DAILY_BUDGET_REACHED' &&
      !attempt.requestMayHaveStarted
    ) {
      return null;
    }
    if (attempt.failureCode === 'COMMERCIAL_AI_COPY_OUTPUT_INVALID') {
      return scope === 'current'
        ? COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED
        : null;
    }
    return 'COMMERCIAL_AI_COPY_PREVIOUSLY_FAILED';
  }

  private async findHistoricalAttempt(
    context: CommercialPromotionCopyContext,
    fingerprint: string,
  ) {
    const { model } = this.options.config;
    if (!model) return null;
    return this.options.repository.findAttemptByGenerationContract({
      candidateId: context.candidate.id,
      snapshotId: context.snapshot.id,
      inputFingerprint: fingerprint,
      provider: this.options.config.provider,
      model,
      promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
      validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
    });
  }

  async preview(candidateId: string) {
    const context = await this.context(candidateId);
    const validationFacts = this.validationFacts(context);
    const fingerprint = this.fingerprint(context);
    const cache = fingerprint
      ? await this.options.repository.findCopyByInputFingerprint(fingerprint)
      : null;
    const cacheAvailable = Boolean(
      fingerprint && this.validCache(cache, context, fingerprint),
    );
    const blockers = [...candidateBlockers(context, this.clock())];
    if (!cacheAvailable && fingerprint) {
      const [attempt, historicalAttempt] = await Promise.all([
        this.options.repository.findAttemptByInputFingerprint(fingerprint),
        this.findHistoricalAttempt(context, fingerprint),
      ]);
      const attemptBlocker = this.attemptBlocker(attempt, 'current');
      const historicalAttemptBlocker = this.attemptBlocker(
        historicalAttempt,
        'historical',
      );
      if (attemptBlocker) blockers.push(attemptBlocker);
      if (historicalAttemptBlocker) blockers.push(historicalAttemptBlocker);
    }
    return {
      candidateId: context.candidate.id,
      status: context.candidate.status,
      eligible: blockers.length === 0,
      cacheAvailable,
      providerConfigured: this.providerConfigured(),
      promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
      validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
      promotionSignals: context.candidate.promotionSignals,
      commercialScore: context.candidate.commercialScore,
      snapshotRevision: context.snapshot.revision,
      blockers,
      sanitizedPreview: validAffiliateLink(context.product.affiliateLink)
        ? this.assemblePreview(context, validationFacts)
        : null,
    };
  }

  private assertProvider(): CommercialAiCopyProvider {
    if (!this.options.config.enabled) {
      throw new AppError(
        'Geracao de copy por IA desabilitada',
        'COMMERCIAL_AI_COPY_PROVIDER_DISABLED',
      );
    }
    if (
      !this.options.config.model ||
      !this.options.config.apiKeyConfigured ||
      !this.options.provider
    ) {
      throw new AppError(
        'Provider de copy por IA nao configurado',
        'COMMERCIAL_AI_COPY_PROVIDER_NOT_CONFIGURED',
      );
    }
    return this.options.provider;
  }

  private providerFacts(context: CommercialPromotionCopyContext) {
    return { productName: this.modelProductName(context) };
  }

  private sourceProductName(context: CommercialPromotionCopyContext) {
    try {
      return normalizeUntrustedCommercialText(context.product.productName, 250);
    } catch {
      throw new AppError(
        'Fatos comerciais invalidos',
        'COMMERCIAL_AI_COPY_FACTS_INVALID',
      );
    }
  }

  private modelProductName(context: CommercialPromotionCopyContext) {
    const sourceProductName = this.sourceProductName(context);
    try {
      return sanitizeCommercialAiCopyProductNameForModel(sourceProductName);
    } catch {
      throw new AppError(
        'Nome do produto sem identidade segura para a IA',
        'COMMERCIAL_AI_COPY_MODEL_PRODUCT_NAME_INVALID',
      );
    }
  }

  private validationFacts(context: CommercialPromotionCopyContext) {
    try {
      return {
        productName: this.sourceProductName(context),
        shopName: normalizeUntrustedCommercialText(
          context.product.shopName,
          120,
        ),
      };
    } catch {
      throw new AppError(
        'Fatos comerciais invalidos',
        'COMMERCIAL_AI_COPY_FACTS_INVALID',
      );
    }
  }

  private result(
    context: CommercialPromotionCopyContext,
    copy: GeneratedCopyRecord,
    cacheHit: boolean,
  ) {
    return {
      candidateId: context.candidate.id,
      generatedCopyId: copy.id,
      status: 'COPY_READY' as const,
      cacheHit,
      provider: copy.provider,
      model: copy.model,
      promptVersion: copy.promptVersion,
      validationVersion: copy.validationVersion,
      usage: {
        inputTokens: copy.usageInputTokens ?? null,
        outputTokens: copy.usageOutputTokens ?? null,
        totalTokens: copy.usageTotalTokens ?? null,
      },
      sanitizedCopy: sanitizeCommercialPromotionCopy(
        copy as AssembledCommercialPromotionCopy,
        context.product.affiliateLink as string,
      ),
    };
  }

  private async useCache(
    context: CommercialPromotionCopyContext,
    fingerprint: string,
    copy: GeneratedCopyRecord,
    assembled: AssembledCommercialPromotionCopy,
  ) {
    const linked = await this.options.repository.linkCachedCopy({
      expected: context,
      copyId: copy.id,
      inputFingerprint: fingerprint,
      affiliateLinkHash: sha256(context.product.affiliateLink as string),
      validatedAt: this.clock(),
      provider: this.options.config.provider,
      model: this.options.config.model as string,
      promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
      validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
      maximumLength: this.options.config.maximumCopyLength,
      assembled,
    });
    if (!linked) {
      fail(
        'Candidato mudou antes do uso do cache',
        'COMMERCIAL_AI_COPY_CANDIDATE_CHANGED',
      );
    }
    return this.result(context, { ...copy, ...assembled }, true);
  }

  private async classifyExistingClaim(
    context: CommercialPromotionCopyContext,
    fingerprint: string,
  ) {
    const attempt =
      await this.options.repository.findAttemptByInputFingerprint(fingerprint);
    if (!attempt) {
      throw new AppError(
        'Geracao ja esta em andamento',
        'COMMERCIAL_AI_COPY_GENERATION_IN_PROGRESS',
      );
    }
    if (attempt.status === 'STARTED') {
      throw new AppError(
        'Geracao ja esta em andamento',
        'COMMERCIAL_AI_COPY_GENERATION_IN_PROGRESS',
      );
    }
    const blocker = this.attemptBlocker(attempt, 'current');
    if (blocker) {
      fail(
        blocker === COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED
          ? 'Output anterior da IA foi rejeitado'
          : blocker === 'COMMERCIAL_AI_COPY_RESULT_AMBIGUOUS'
            ? 'Resultado anterior e ambiguo'
            : blocker === 'COMMERCIAL_AI_COPY_GENERATION_IN_PROGRESS'
              ? 'Geracao ja esta em andamento'
              : 'Tentativa anterior falhou',
        blocker,
      );
    }
    const copy = attempt.generatedCopyId
      ? await this.options.repository.findCopyByInputFingerprint(fingerprint)
      : null;
    const assembled = this.validCache(copy, context, fingerprint);
    if (!assembled) {
      fail(
        'Cache de copy inconsistente',
        'COMMERCIAL_AI_COPY_CACHE_INCONSISTENT',
      );
    }
    return this.useCache(
      context,
      fingerprint,
      copy as GeneratedCopyRecord,
      assembled as AssembledCommercialPromotionCopy,
    );
  }

  private classifyHistoricalAttempt(
    attempt: CommercialCopyGenerationAttemptRecord,
  ): void {
    const blocker = this.attemptBlocker(attempt, 'historical');
    if (blocker) {
      fail(
        blocker === 'COMMERCIAL_AI_COPY_CACHE_INCONSISTENT'
          ? 'Copy historica nao pode ser reutilizada com fingerprint diferente'
          : blocker === 'COMMERCIAL_AI_COPY_RESULT_AMBIGUOUS'
            ? 'Resultado historico e ambiguo'
            : blocker === 'COMMERCIAL_AI_COPY_GENERATION_IN_PROGRESS'
              ? 'Geracao historica ainda esta em andamento'
              : 'Tentativa historica falhou',
        blocker,
      );
    }
  }

  private async terminalFailure(
    fingerprint: string,
    status: 'FAILED' | 'AMBIGUOUS',
    failureCode: string,
    requestMayHaveStarted: boolean,
    providerMetadata: CommercialAiCopyProviderErrorMetadata = {},
    usage?: {
      inputTokens: number | null;
      outputTokens: number | null;
      totalTokens: number | null;
    },
    validationFailureCodes: string[] = [],
  ) {
    await this.options.repository.markAttemptTerminal({
      inputFingerprint: fingerprint,
      status,
      failureCode,
      requestMayHaveStarted,
      providerHttpStatus: providerMetadata.httpStatus,
      providerErrorCode: providerMetadata.providerErrorCode,
      providerErrorType: providerMetadata.providerErrorType,
      providerErrorParam: providerMetadata.providerErrorParam,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
      validationFailureCodes,
      completedAt: this.clock(),
    });
  }

  async generate(candidateId: string, confirmation: string) {
    if (confirmation !== COMMERCIAL_AI_COPY_CONFIRMATION) {
      fail(
        'Confirmacao de geracao invalida',
        'COMMERCIAL_AI_COPY_CONFIRMATION_INVALID',
      );
    }
    const context = await this.context(candidateId);
    if (
      context.candidate.status === 'COPY_READY' &&
      context.candidate.generatedCopyId
    ) {
      const linked =
        await this.options.repository.findCopyForCandidate(candidateId);
      const blockers = candidateBlockers(context, this.clock()).filter(
        (code) => code !== 'COMMERCIAL_AI_COPY_ALREADY_READY',
      );
      assertNoBlockers(blockers);
      const linkedAssembly = linked
        ? this.validLinkedCopy(linked.copy, context)
        : null;
      if (linked && linkedAssembly) {
        const refreshed = await this.options.repository.refreshCachedCopy({
          expected: context,
          copyId: linked.copy.id,
          inputFingerprint: linked.copy.inputFingerprint as string,
          affiliateLinkHash: sha256(context.product.affiliateLink as string),
          validatedAt: this.clock(),
          provider: linked.copy.provider as string,
          model: linked.copy.model as string,
          promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
          validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
          maximumLength: this.options.config.maximumCopyLength,
          assembled: linkedAssembly,
        });
        if (!refreshed) {
          fail(
            'Candidato mudou antes da atualizacao do cache',
            'COMMERCIAL_AI_COPY_CANDIDATE_CHANGED',
          );
        }
        return this.result(context, { ...linked.copy, ...linkedAssembly }, true);
      }
      throw new AppError(
        'Copy pronta esta inconsistente',
        'COMMERCIAL_AI_COPY_CACHE_INCONSISTENT',
      );
    }
    assertNoBlockers(candidateBlockers(context, this.clock()));
    const providerFacts = this.providerFacts(context);
    const validationFacts = this.validationFacts(context);
    const fingerprint = this.fingerprint(context);
    if (!fingerprint) {
      this.assertProvider();
      throw new AppError(
        'Configuracao de copy por IA incompleta',
        'COMMERCIAL_AI_COPY_PROVIDER_NOT_CONFIGURED',
      );
    }
    const cached =
      await this.options.repository.findCopyByInputFingerprint(fingerprint);
    const cachedAssembly = this.validCache(cached, context, fingerprint);
    if (cachedAssembly) {
      return this.useCache(
        context,
        fingerprint,
        cached as GeneratedCopyRecord,
        cachedAssembly,
      );
    }
    if (!cached) {
      const historicalAttempt = await this.findHistoricalAttempt(
        context,
        fingerprint,
      );
      if (historicalAttempt) this.classifyHistoricalAttempt(historicalAttempt);
    }
    const provider = this.assertProvider();
    const claimed = await this.options.repository.claim({
      candidateId: context.candidate.id,
      snapshotId: context.snapshot.id,
      inputFingerprint: fingerprint,
      provider: this.options.config.provider,
      model: this.options.config.model as string,
      promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
      validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
      startedAt: this.clock(),
      expected: context,
      affiliateLinkHash: sha256(context.product.affiliateLink as string),
      validatedAt: this.clock(),
    });
    if (!claimed) return this.classifyExistingClaim(context, fingerprint);

    let providerResult: CommercialAiCopyProviderResult;
    try {
      providerResult = await provider.generate(providerFacts);
    } catch (error) {
      const providerError =
        error instanceof CommercialAiCopyProviderError
          ? error
          : new CommercialAiCopyProviderError(
              'AMBIGUOUS',
              'COMMERCIAL_AI_COPY_PROVIDER_RESULT_AMBIGUOUS',
            );
      const ambiguous = providerError.kind === 'AMBIGUOUS';
      this.options.logger?.error(
        {
          event: 'commercial-ai-copy.provider-failed',
          candidateId: context.candidate.id,
          provider: this.options.config.provider,
          model: normalizeCommercialAiCopyModel(this.options.config.model),
          publicCode: providerError.publicCode,
          failureKind: providerError.kind,
          requestMayHaveStarted: providerError.requestMayHaveStarted,
          inputTokens: providerError.inputTokens,
          outputTokens: providerError.outputTokens,
          totalTokens: providerError.totalTokens,
          reasoningTokens: providerError.reasoningTokens,
          ...(providerError.providerErrorCode && {
            providerErrorCode: providerError.providerErrorCode,
          }),
        },
        'Commercial AI copy provider failed',
      );
      await this.terminalFailure(
        fingerprint,
        ambiguous ? 'AMBIGUOUS' : 'FAILED',
        providerError.publicCode,
        providerError.requestMayHaveStarted,
        {
          httpStatus: providerError.httpStatus,
          providerErrorCode: providerError.providerErrorCode,
          providerErrorType: providerError.providerErrorType,
          providerErrorParam: providerError.providerErrorParam,
        },
        {
          inputTokens: providerError.inputTokens,
          outputTokens: providerError.outputTokens,
          totalTokens: providerError.totalTokens,
        },
      );
      throw new AppError(
        ambiguous ? 'Resultado do provider e ambiguo' : 'Provider de IA falhou',
        providerError.publicCode,
      );
    }

    const validation = this.validator.validate(
      providerResult.output,
      validationFacts.productName,
      [validationFacts.shopName],
    );
    if (!validation.valid || !validation.sanitizedOutput) {
      const validationFailureCodes =
        sanitizeCommercialAiCopyValidationFailureCodes(
          validation.publicFailureCodes,
        );
      this.options.logger?.error(
        {
          event: 'commercial-ai-copy.validation-failed',
          candidateId: context.candidate.id,
          provider: providerResult.provider,
          model: normalizeCommercialAiCopyModel(providerResult.model),
          failureCode: 'COMMERCIAL_AI_COPY_OUTPUT_INVALID',
          validationFailureCodes,
          inputTokens: providerResult.usage.inputTokens,
          outputTokens: providerResult.usage.outputTokens,
          totalTokens: providerResult.usage.totalTokens,
        },
        'Commercial AI copy validation failed',
      );
      await this.terminalFailure(
        fingerprint,
        'FAILED',
        'COMMERCIAL_AI_COPY_OUTPUT_INVALID',
        true,
        {},
        providerResult.usage,
        validationFailureCodes,
      );
      throw new AppError(
        'Output da IA rejeitado',
        'COMMERCIAL_AI_COPY_OUTPUT_INVALID',
      );
    }
    const validatedOutput = validation.sanitizedOutput;

    let assembled: AssembledCommercialPromotionCopy;
    try {
      assembled = this.assembler.assemble({
        output: validatedOutput,
        productName: context.product.productName,
        shopName: context.product.shopName,
        price: context.product.price,
        discountRate: context.product.discountRate,
        promotionSignals: context.candidate.promotionSignals,
        priceDropPercent: context.candidate.priceDropPercent,
        affiliateLink: context.product.affiliateLink as string,
        maximumLength: this.options.config.maximumCopyLength,
      });
    } catch (error) {
      const code =
        error instanceof AppError
          ? error.code
          : 'COMMERCIAL_AI_COPY_OUTPUT_INVALID';
      await this.terminalFailure(
        fingerprint,
        'FAILED',
        code,
        true,
        {},
        providerResult.usage,
      );
      throw error instanceof AppError
        ? error
        : new AppError('Copy montada invalida', code);
    }

    let completed: CommercialAiCopyCompletionResult;
    try {
      completed = await this.options.repository.complete({
        expected: context,
        inputFingerprint: fingerprint,
        provider: providerResult.provider,
        model: providerResult.model,
        promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
        validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
        affiliateLinkHash: sha256(context.product.affiliateLink as string),
        copy: {
          productId: context.product.id,
          ...assembled,
          source: 'AI',
          provider: providerResult.provider,
          model: providerResult.model,
          promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
          validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
          inputFingerprint: fingerprint,
          snapshotId: context.snapshot.id,
          createdFromCandidateId: context.candidate.id,
          usageInputTokens: providerResult.usage.inputTokens,
          usageOutputTokens: providerResult.usage.outputTokens,
          usageTotalTokens: providerResult.usage.totalTokens,
        },
        usage: providerResult.usage,
        completedAt: this.clock(),
      });
    } catch {
      const [proved, attempt, currentContext] = await Promise.all([
        this.options.repository.findCopyForCandidate(context.candidate.id),
        this.options.repository.findAttemptByInputFingerprint(fingerprint),
        this.options.repository.loadContext(context.candidate.id),
      ]);
      if (
        proved &&
        currentContext &&
        proved.candidate.status === 'COPY_READY' &&
        attempt?.status === 'SUCCEEDED' &&
        attempt.generatedCopyId === proved.copy.id &&
        this.validLinkedCopy(proved.copy, currentContext)
      ) {
        return this.result(currentContext, proved.copy, false);
      }
      await this.terminalFailure(
        fingerprint,
        'AMBIGUOUS',
        'COMMERCIAL_AI_COPY_PERSISTENCE_AMBIGUOUS',
        true,
        {},
        providerResult.usage,
      );
      this.options.logger?.error(
        {
          event: 'commercial-ai-copy.persistence-ambiguous',
          candidateId: context.candidate.id,
          provider: this.options.config.provider,
          model: normalizeCommercialAiCopyModel(this.options.config.model),
          publicCode: 'COMMERCIAL_AI_COPY_PERSISTENCE_AMBIGUOUS',
          failureKind: 'AMBIGUOUS',
        },
        'Commercial AI copy persistence is ambiguous',
      );
      throw new AppError(
        'Persistencia da copy ficou ambigua',
        'COMMERCIAL_AI_COPY_PERSISTENCE_AMBIGUOUS',
      );
    }
    if (!completed.completed) {
      throw new AppError(
        'Estado mudou durante a geracao',
        completed.failureCode,
      );
    }
    this.options.logger?.info(
      {
        event: 'commercial-ai-copy.generated',
        candidateId: context.candidate.id,
        provider: providerResult.provider,
        model: normalizeCommercialAiCopyModel(providerResult.model),
      },
      'Commercial AI copy generated',
    );
    return this.result(context, completed.copy, false);
  }

  async findCopy(candidateId: string) {
    const found =
      await this.options.repository.findCopyForCandidate(candidateId);
    if (!found || found.copy.source !== 'AI') {
      throw new AppError(
        'Copy promocional nao encontrada',
        'COMMERCIAL_AI_COPY_NOT_FOUND',
      );
    }
    const context = await this.context(candidateId);
    const blockers = candidateBlockers(context, this.clock()).filter(
      (code) => code !== 'COMMERCIAL_AI_COPY_ALREADY_READY',
    );
    assertNoBlockers(blockers);
    const linkedAssembly = this.validLinkedCopy(found.copy, context);
    if (!linkedAssembly)
      fail(
        'Copy pronta esta inconsistente',
        'COMMERCIAL_AI_COPY_CACHE_INCONSISTENT',
      );
    const currentAssembly = linkedAssembly as AssembledCommercialPromotionCopy;
    const needsRefresh =
      found.copy.titulo !== currentAssembly.titulo ||
      found.copy.mensagem !== currentAssembly.mensagem ||
      found.copy.cta !== currentAssembly.cta ||
      found.copy.hashtags !== currentAssembly.hashtags;
    if (needsRefresh) {
      const refreshed = await this.options.repository.refreshCachedCopy({
        expected: context,
        copyId: found.copy.id,
        inputFingerprint: found.copy.inputFingerprint as string,
        affiliateLinkHash: sha256(context.product.affiliateLink as string),
        validatedAt: this.clock(),
        provider: found.copy.provider as string,
        model: found.copy.model as string,
        promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
        validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
        maximumLength: this.options.config.maximumCopyLength,
        assembled: currentAssembly,
      });
      if (!refreshed) {
        fail(
          'Candidato mudou antes da atualizacao do cache',
          'COMMERCIAL_AI_COPY_CANDIDATE_CHANGED',
        );
      }
    }
    const currentCopy = { ...found.copy, ...currentAssembly };
    return {
      candidateId,
      status: found.candidate.status,
      generatedCopyId: found.copy.id,
      source: found.copy.source,
      provider: found.copy.provider,
      model: found.copy.model,
      promptVersion: found.copy.promptVersion,
      validationVersion: found.copy.validationVersion,
      snapshotRevision: found.snapshotRevision,
      sanitizedCopy: sanitizeCommercialPromotionCopy(
        currentCopy,
        context.product.affiliateLink as string,
      ),
      createdAt: currentCopy.createdAt,
    };
  }
}
