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
  sanitizeCommercialAiCopyValidationAuditEvidence,
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
import {
  COMMERCIAL_AI_COPY_TERMINAL_ATTEMPT_REJECTED,
  COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED,
  isCommercialPromotionTerminalCandidateBlockReason,
} from './commercial-promotion-candidate-terminal';
import {
  buildCommercialPromotionFallbackOutput,
  COMMERCIAL_COPY_FALLBACK_MODEL,
  COMMERCIAL_COPY_FALLBACK_PROVIDER,
  isCommercialPromotionFallbackCopy,
  validateCommercialPromotionFallbackOutput,
} from './commercial-promotion-copy-fallback';
import type {
  CommercialPromotionCopyContext,
  CommercialCopyGenerationAttemptStatusRecord,
  CommercialPromotionCopyRepository,
  CommercialAiCopyCompletionResult,
  CommercialCopyGenerationAttemptRecord,
  GeneratedCopyRecord,
} from './repositories';

export const COMMERCIAL_AI_COPY_CONFIRMATION = 'GERAR_COPY_COM_IA';
export {
  COMMERCIAL_COPY_FALLBACK_MODEL,
  COMMERCIAL_COPY_FALLBACK_PROVIDER,
} from './commercial-promotion-copy-fallback';

const supportedPromotionCopySource = (copy: GeneratedCopyRecord) =>
  copy.source === 'AI' || isCommercialPromotionFallbackCopy(copy);

const matchesConfiguredAiContract = (
  copy: GeneratedCopyRecord,
  config: CommercialAiCopyConfig,
) =>
  copy.source === 'AI'
    ? copy.provider === config.provider && copy.model === config.model
    : isCommercialPromotionFallbackCopy(copy);

const terminalCandidateBlockReasonForAttempt = (
  attempt: Pick<CommercialCopyGenerationAttemptRecord, 'status' | 'failureCode'> | null,
) => {
  if (
    !attempt ||
    !['FAILED', 'AMBIGUOUS'].includes(attempt.status)
  ) {
    return null;
  }
  return attempt.failureCode === 'COMMERCIAL_AI_COPY_OUTPUT_INVALID'
    ? COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED
    : COMMERCIAL_AI_COPY_TERMINAL_ATTEMPT_REJECTED;
};
export { COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED } from './commercial-promotion-candidate-terminal';
export const COMMERCIAL_AI_COPY_SNAPSHOT_OUTDATED =
  'COMMERCIAL_AI_COPY_SNAPSHOT_OUTDATED';

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
  } else if (
    candidate.status === 'BLOCKED' &&
    isCommercialPromotionTerminalCandidateBlockReason(candidate.blockedReason)
  ) {
    blockers.push(candidate.blockedReason);
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
    blockers.push(COMMERCIAL_AI_COPY_SNAPSHOT_OUTDATED);
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
      approved: true,
      enabled: this.options.config.enabled,
      fallbackAvailable: true,
      provider: this.options.config.provider,
      providerConfigured,
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
      modelProductName: configuration.provider === COMMERCIAL_COPY_FALLBACK_PROVIDER
        ? this.sourceProductName(context)
        : this.modelProductName(context),
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

  private fallbackFingerprint(context: CommercialPromotionCopyContext) {
    return this.fingerprint(context, {
      provider: COMMERCIAL_COPY_FALLBACK_PROVIDER,
      model: COMMERCIAL_COPY_FALLBACK_MODEL,
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
    const assemblyIdentity = isCommercialPromotionFallbackCopy(copy)
      ? { productName: output.body, shopName: '' }
      : { productName: context.product.productName, shopName: context.product.shopName };
    const validation = isCommercialPromotionFallbackCopy(copy)
      ? validateCommercialPromotionFallbackOutput(
          this.validator, output, facts.productName, [facts.shopName],
        )
      : this.validator.validate(output, facts.productName, [facts.shopName]);
    if (!validation.valid || !validation.sanitizedOutput) return null;
    try {
      const assembled = this.assembler.assemble({
        output: validation.sanitizedOutput,
        ...assemblyIdentity,
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
          ...assemblyIdentity,
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
      !supportedPromotionCopySource(copy) ||
      !matchesConfiguredAiContract(copy, this.options.config) ||
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
    const fallback = isCommercialPromotionFallbackCopy(copy);
    const model = this.options.config.model;
    const provider = this.options.config.provider;
    const fingerprint = !fallback && model
      ? this.fingerprint(context, { provider, model })
      : null;
    if (
      (!fallback && !model) ||
      copy.id !== context.candidate.generatedCopyId ||
      !supportedPromotionCopySource(copy) ||
      !matchesConfiguredAiContract(copy, this.options.config) ||
      copy.promptVersion !== COMMERCIAL_AI_COPY_PROMPT_VERSION ||
      copy.validationVersion !== COMMERCIAL_AI_COPY_VALIDATION_VERSION ||
      (fallback
        ? !copy.inputFingerprint
        : fingerprint
          ? copy.inputFingerprint !== fingerprint
          : true) ||
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
    const output = buildCommercialPromotionFallbackOutput(this.validator, facts.productName, [facts.shopName]);
    const copy = this.assembler.assemble({
      output,
      productName: output.body,
      shopName: '',
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
    const terminalCandidateBlockReason =
      terminalCandidateBlockReasonForAttempt(attempt);
    if (terminalCandidateBlockReason) {
      return terminalCandidateBlockReason;
    }
    if (attempt.status === 'AMBIGUOUS') {
      return 'COMMERCIAL_AI_COPY_RESULT_AMBIGUOUS';
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

  private async snapshotTerminalAttempt(context: CommercialPromotionCopyContext) {
    const attempts = await this.options.repository.listAttemptsByCandidateId(context.candidate.id);
    return attempts.find((attempt) => attempt.snapshotId === context.snapshot.id &&
      terminalCandidateBlockReasonForAttempt(attempt)) ?? null;
  }

  private async repairTerminalCandidate(
    context: CommercialPromotionCopyContext,
    attempt: CommercialCopyGenerationAttemptStatusRecord,
  ) {
    const candidateBlockReason = terminalCandidateBlockReasonForAttempt(attempt);
    if (
      !candidateBlockReason ||
      (attempt.status !== 'FAILED' && attempt.status !== 'AMBIGUOUS')
    ) {
      return;
    }
    const result = await this.options.repository.markAttemptTerminal({
      candidateId: context.candidate.id,
      snapshotId: context.snapshot.id,
      inputFingerprint: attempt.inputFingerprint,
      status: attempt.status,
      failureCode:
        attempt.failureCode ?? COMMERCIAL_AI_COPY_TERMINAL_ATTEMPT_REJECTED,
      requestMayHaveStarted: attempt.requestMayHaveStarted,
      providerHttpStatus: attempt.providerHttpStatus,
      providerErrorCode: attempt.providerErrorCode,
      providerErrorType: attempt.providerErrorType,
      providerErrorParam: attempt.providerErrorParam,
      inputTokens: attempt.inputTokens,
      outputTokens: attempt.outputTokens,
      totalTokens: attempt.totalTokens,
      validationFailureCodes: attempt.validationFailureCodes,
      candidateBlockReason,
      completedAt: attempt.completedAt ?? this.clock(),
    });
    if (result.kind === 'CONFLICT') {
      throw new AppError(
        'Reparo terminal da copy ficou inconclusivo',
        'COMMERCIAL_AI_COPY_PERSISTENCE_AMBIGUOUS',
      );
    }
  }

  async preview(candidateId: string) {
    const context = await this.context(candidateId);
    const snapshotTerminal = await this.snapshotTerminalAttempt(context);
    const validationFacts = this.validationFacts(context);
    let fingerprint = this.fallbackFingerprint(context);
    if (this.options.config.enabled && this.providerConfigured()) {
      try { fingerprint = this.fingerprint(context) ?? fingerprint; } catch {
        // A title unsuitable for creative generation still permits factual preview.
      }
    }
    const linked = context.candidate.generatedCopyId
      ? await this.options.repository.findCopyForCandidate(candidateId) : null;
    const cache = linked?.copy ?? (fingerprint
      ? await this.options.repository.findCopyByInputFingerprint(fingerprint)
      : null);
    const cacheAvailable = Boolean(
      linked ? this.validLinkedCopy(linked.copy, context)
        : fingerprint && this.validCache(cache, context, fingerprint),
    );
    const blockers = [...candidateBlockers(context, this.clock())];
    if (snapshotTerminal) blockers.push(terminalCandidateBlockReasonForAttempt(snapshotTerminal)!);
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
      if (attemptBlocker) {
        blockers.push(attemptBlocker);
      }
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
      blockers: [...new Set(blockers)],
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
      provider: copy.provider as string,
      model: copy.model as string,
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
      if (terminalCandidateBlockReasonForAttempt(attempt)) {
        await this.repairTerminalCandidate(context, attempt);
      }
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

  private async classifyHistoricalAttempt(
    context: CommercialPromotionCopyContext,
    attempt: CommercialCopyGenerationAttemptRecord,
  ): Promise<void> {
    const blocker = this.attemptBlocker(attempt, 'historical');
    if (blocker) {
      if (terminalCandidateBlockReasonForAttempt(attempt)) {
        await this.repairTerminalCandidate(context, attempt);
      }
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
    context: CommercialPromotionCopyContext,
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
    const result = await this.options.repository.markAttemptTerminal({
      candidateId: context.candidate.id,
      snapshotId: context.snapshot.id,
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
      candidateBlockReason:
        failureCode === 'COMMERCIAL_AI_COPY_OUTPUT_INVALID'
          ? COMMERCIAL_AI_COPY_TERMINAL_OUTPUT_REJECTED
          : COMMERCIAL_AI_COPY_TERMINAL_ATTEMPT_REJECTED,
      completedAt: this.clock(),
    });
    if (result.kind === 'CONFLICT') {
      throw new AppError(
        'Estado mudou durante a terminalizacao da copy',
        'COMMERCIAL_AI_COPY_PERSISTENCE_AMBIGUOUS',
      );
    }
  }

  private async deterministicFallback(
    context: CommercialPromotionCopyContext,
    fingerprint: string,
    status: 'FAILED' | 'AMBIGUOUS',
    failureCode: string,
    requestMayHaveStarted: boolean,
    usage: {
      inputTokens: number | null;
      outputTokens: number | null;
      totalTokens: number | null;
    },
    providerMetadata: CommercialAiCopyProviderErrorMetadata = {},
    validationFailureCodes: string[] = [],
  ) {
    const fallbackFacts = this.validationFacts(context);
    const fallbackOutput = buildCommercialPromotionFallbackOutput(
      this.validator, fallbackFacts.productName, [fallbackFacts.shopName],
    );
    const fallbackValidation = validateCommercialPromotionFallbackOutput(
      this.validator,
      fallbackOutput,
      fallbackFacts.productName,
      [fallbackFacts.shopName],
    );
    if (!fallbackValidation.valid || !fallbackValidation.sanitizedOutput) {
      await this.terminalFailure(
        context,
        fingerprint,
        status,
        failureCode,
        requestMayHaveStarted,
        providerMetadata,
        usage,
        validationFailureCodes,
      );
      throw new AppError(
        'Fallback deterministico invalido',
        'COMMERCIAL_AI_COPY_FALLBACK_INVALID',
      );
    }
    let assembled: AssembledCommercialPromotionCopy;
    try {
      assembled = this.assembler.assemble({
        output: fallbackValidation.sanitizedOutput,
        productName: fallbackOutput.body,
        shopName: '',
        price: context.product.price,
        discountRate: context.product.discountRate,
        promotionSignals: context.candidate.promotionSignals,
        priceDropPercent: context.candidate.priceDropPercent,
        affiliateLink: context.product.affiliateLink as string,
        maximumLength: this.options.config.maximumCopyLength,
      });
    } catch (error) {
      await this.terminalFailure(
        context,
        fingerprint,
        status,
        failureCode,
        requestMayHaveStarted,
        providerMetadata,
        usage,
        validationFailureCodes,
      );
      throw error;
    }
    let completed: CommercialAiCopyCompletionResult;
    try {
      completed = await this.options.repository.completeFallback({
        expected: context,
        inputFingerprint: fingerprint,
        provider: COMMERCIAL_COPY_FALLBACK_PROVIDER,
        model: COMMERCIAL_COPY_FALLBACK_MODEL,
        promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
        validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
        affiliateLinkHash: sha256(context.product.affiliateLink as string),
        copy: {
          productId: context.product.id,
          ...assembled,
          source: 'LEGACY_TEMPLATE',
          provider: COMMERCIAL_COPY_FALLBACK_PROVIDER,
          model: COMMERCIAL_COPY_FALLBACK_MODEL,
          promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
          validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
          inputFingerprint: fingerprint,
          snapshotId: context.snapshot.id,
          createdFromCandidateId: context.candidate.id,
          usageInputTokens: usage.inputTokens,
          usageOutputTokens: usage.outputTokens,
          usageTotalTokens: usage.totalTokens,
        },
        usage,
        status,
        failureCode,
        requestMayHaveStarted,
        providerHttpStatus: providerMetadata.httpStatus,
        providerErrorCode: providerMetadata.providerErrorCode,
        providerErrorType: providerMetadata.providerErrorType,
        providerErrorParam: providerMetadata.providerErrorParam,
        validationFailureCodes,
        completedAt: this.clock(),
      });
    } catch {
      throw new AppError(
        'Persistencia do fallback ficou ambigua',
        'COMMERCIAL_AI_COPY_PERSISTENCE_AMBIGUOUS',
      );
    }
    if (!completed.completed) {
      throw new AppError(
        'Estado mudou durante o fallback',
        completed.failureCode,
      );
    }
    return this.result(context, completed.copy, false);
  }

  async generate(
    candidateId: string,
    confirmation: string,
    beforeExternalProviderCall?: () => Promise<void>,
  ) {
    if (confirmation !== COMMERCIAL_AI_COPY_CONFIRMATION) {
      fail(
        'Confirmacao de geracao invalida',
        'COMMERCIAL_AI_COPY_CONFIRMATION_INVALID',
      );
    }
    const context = await this.context(candidateId);
    const snapshotTerminal = await this.snapshotTerminalAttempt(context);
    if (snapshotTerminal) {
      await this.repairTerminalCandidate(context, snapshotTerminal);
      fail('Snapshot possui falha terminal de copy', terminalCandidateBlockReasonForAttempt(snapshotTerminal)!);
    }
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
    const validationFacts = this.validationFacts(context);
    let providerReady = this.options.config.enabled &&
      this.providerConfigured() && Boolean(this.options.provider);
    if (providerReady) {
      try {
        this.modelProductName(context);
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== 'COMMERCIAL_AI_COPY_MODEL_PRODUCT_NAME_INVALID') throw error;
        // A numeric catalog identity may be valid for deterministic assembly
        // even when it cannot supply the lexical identity required by OpenAI.
        providerReady = false;
      }
    }
    const fingerprint = providerReady
      ? this.fingerprint(context)
      : this.fallbackFingerprint(context);
    if (!fingerprint) {
      throw new AppError(
        'Fatos comerciais incompletos para copy segura',
        'COMMERCIAL_AI_COPY_FACTS_INVALID',
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
    if (!cached && providerReady) {
      const historicalAttempt = await this.findHistoricalAttempt(
        context,
        fingerprint,
      );
      if (historicalAttempt) {
        await this.classifyHistoricalAttempt(context, historicalAttempt);
      }
    }
    if (!providerReady) {
      const claimed = await this.options.repository.claim({
        candidateId: context.candidate.id,
        snapshotId: context.snapshot.id,
        inputFingerprint: fingerprint,
        provider: COMMERCIAL_COPY_FALLBACK_PROVIDER,
        model: COMMERCIAL_COPY_FALLBACK_MODEL,
        promptVersion: COMMERCIAL_AI_COPY_PROMPT_VERSION,
        validationVersion: COMMERCIAL_AI_COPY_VALIDATION_VERSION,
        startedAt: this.clock(),
        expected: context,
        affiliateLinkHash: sha256(context.product.affiliateLink as string),
        validatedAt: this.clock(),
      });
      if (!claimed) return this.classifyExistingClaim(context, fingerprint);
      return this.deterministicFallback(
        context,
        fingerprint,
        'FAILED',
        'COMMERCIAL_AI_COPY_PROVIDER_NOT_CONFIGURED',
        false,
        { inputTokens: null, outputTokens: null, totalTokens: null },
      );
    }
    const providerFacts = this.providerFacts(context);
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
      // Mark the external boundary only after the copy path has selected the
      // real provider and claimed the attempt. Deterministic fallback copies
      // never invoke this hook.
      await beforeExternalProviderCall?.();
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
      return this.deterministicFallback(
        context,
        fingerprint,
        ambiguous ? 'AMBIGUOUS' : 'FAILED',
        providerError.publicCode,
        providerError.requestMayHaveStarted,
        {
          inputTokens: providerError.inputTokens,
          outputTokens: providerError.outputTokens,
          totalTokens: providerError.totalTokens,
        },
        {
          httpStatus: providerError.httpStatus,
          providerErrorCode: providerError.providerErrorCode,
          providerErrorType: providerError.providerErrorType,
          providerErrorParam: providerError.providerErrorParam,
        },
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
      const auditFailureCodes =
        sanitizeCommercialAiCopyValidationFailureCodes(
          validation.auditFailureCodes,
        );
      const auditEvidence = sanitizeCommercialAiCopyValidationAuditEvidence(
        validation.auditEvidence,
      );
      this.options.logger?.error(
        {
          event: 'commercial-ai-copy.validation-failed',
          candidateId: context.candidate.id,
          provider: providerResult.provider,
          model: normalizeCommercialAiCopyModel(providerResult.model),
          failureCode: 'COMMERCIAL_AI_COPY_OUTPUT_INVALID',
          validationFailureCodes,
          auditFailureCodes,
          auditEvidence,
          inputTokens: providerResult.usage.inputTokens,
          outputTokens: providerResult.usage.outputTokens,
          totalTokens: providerResult.usage.totalTokens,
        },
        'Commercial AI copy validation failed',
      );
      return this.deterministicFallback(
        context,
        fingerprint,
        'FAILED',
        'COMMERCIAL_AI_COPY_OUTPUT_INVALID',
        true,
        providerResult.usage,
        {},
        [...validationFailureCodes, ...auditFailureCodes],
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
      if (code === 'COMMERCIAL_AI_COPY_URL_INVALID' || code === 'COMMERCIAL_AI_COPY_BODY_TOO_LONG') {
        return this.deterministicFallback(context, fingerprint, 'FAILED', code, true, providerResult.usage);
      }
      await this.terminalFailure(
        context,
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
        context,
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
    if (!found || !supportedPromotionCopySource(found.copy)) {
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
