import { COMMERCIAL_AI_COPY_BODY_MAX_LENGTH } from './commercial-ai-copy-policy';
import type { CommercialAiCopyOutput } from './commercial-ai-copy-provider';
import { CommercialAiCopyValidator } from './commercial-ai-copy-validator';
import { COMMERCIAL_AI_COPY_PROMPT_VERSION, COMMERCIAL_AI_COPY_VALIDATION_VERSION, normalizeUntrustedCommercialText } from './commercial-ai-copy-prompt';
import { cleanCommercialPromotionBody, extractCachedCommercialAiCopyOutput, isSafeAssembledCommercialPromotionCopy,
  type AssembledCommercialPromotionCopy, type CommercialPromotionCopyTrustedFacts } from './commercial-promotion-copy-assembler';

export const COMMERCIAL_COPY_FALLBACK_PROVIDER = 'deterministic-safe-fallback';
export const COMMERCIAL_COPY_FALLBACK_MODEL = 'commercial-safe-fallback-v1';

export const COMMERCIAL_COPY_FALLBACK_HEADLINE = 'OFERTA SELECIONADA';

// Only this exact canonical identity may use the deterministic contract. Provider
// output still goes through the unchanged creative-output validator.
const validateExactIdentityOutput = (
  validator: CommercialAiCopyValidator,
  output: CommercialAiCopyOutput,
  productName: string,
  shopNames: string[],
) => {
  const validation = validator.validate(output, productName, shopNames);
  if (
    output.headline !== COMMERCIAL_COPY_FALLBACK_HEADLINE ||
    output.body !== productName ||
    !productName.trim() ||
    productName.length > COMMERCIAL_AI_COPY_BODY_MAX_LENGTH
  ) {
    return { valid: false as const, publicFailureCodes: ['AI_OUTPUT_STRUCTURE_INVALID'] };
  }
  const failureCodes = validation.publicFailureCodes.filter((code) => {
    // A catalog identity can be one character long and need not have a lexical
    // token longer than two characters (e.g. "TV"). No factual claim is inferred.
    if (code === 'AI_BODY_LENGTH' && productName.length < 10) return false;
    if (
      code === 'AI_FACTUAL_VALUE_FORBIDDEN' &&
      validation.auditFailureCodes?.length === 1 &&
      validation.auditFailureCodes[0] === 'AI_FACTUAL_CAUSE_MISSING_IDENTITY'
    ) {
      return false;
    }
    return true;
  });
  return failureCodes.length
    ? { valid: false as const, publicFailureCodes: failureCodes }
    : { valid: true as const, sanitizedOutput: output, publicFailureCodes: [] };
};

// Catalog titles are untrusted, not a source of certified commercial claims.
// Preserve a bounded identity when safe; otherwise refer neutrally to the item
// identified by the certified affiliate link. Price/discount remain assembled.
export const buildCommercialPromotionFallbackOutput = (
  validator: CommercialAiCopyValidator,
  productName: string,
  shopNames: string[],
): CommercialAiCopyOutput => {
  let body = '';
  try {
    body = cleanCommercialPromotionBody(normalizeUntrustedCommercialText(productName, Number.MAX_SAFE_INTEGER));
    if (body.length > COMMERCIAL_AI_COPY_BODY_MAX_LENGTH) {
      // Truncation could alter a model, quantity or unit at the boundary.
      return { headline: COMMERCIAL_COPY_FALLBACK_HEADLINE, body: 'Produto selecionado' };
    }
    const output = { headline: COMMERCIAL_COPY_FALLBACK_HEADLINE, body };
    if (validateExactIdentityOutput(validator, output, body, shopNames).valid) return output;
  } catch {
    // No title fragment is safe; no product characteristic is inferred.
  }
  return { headline: COMMERCIAL_COPY_FALLBACK_HEADLINE, body: 'Produto selecionado' };
};

export const validateCommercialPromotionFallbackOutput = (
  validator: CommercialAiCopyValidator,
  output: CommercialAiCopyOutput,
  productName: string,
  shopNames: string[],
) => {
  const expected = buildCommercialPromotionFallbackOutput(validator, productName, shopNames);
  if (output.headline !== expected.headline || output.body !== expected.body) {
    return { valid: false as const, publicFailureCodes: ['AI_OUTPUT_STRUCTURE_INVALID'] };
  }
  return validateExactIdentityOutput(validator, output, expected.body, []);
};

export const isCommercialPromotionFallbackCopy = (copy: {
  source?: string;
  provider?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  validationVersion?: string | null;
}) =>
  copy.source === 'LEGACY_TEMPLATE' &&
  copy.provider === COMMERCIAL_COPY_FALLBACK_PROVIDER &&
  copy.model === COMMERCIAL_COPY_FALLBACK_MODEL &&
  copy.promptVersion === COMMERCIAL_AI_COPY_PROMPT_VERSION &&
  copy.validationVersion === COMMERCIAL_AI_COPY_VALIDATION_VERSION;

export const isSafeStoredCommercialPromotionCopy = (
  copy: AssembledCommercialPromotionCopy & {
    source?: string; provider?: string | null; model?: string | null;
    promptVersion?: string | null; validationVersion?: string | null;
  },
  facts: CommercialPromotionCopyTrustedFacts,
  affiliateLink: string,
  maximumLength: number,
) => {
  const output = extractCachedCommercialAiCopyOutput(copy);
  if (!output) return false;
  const validator = new CommercialAiCopyValidator();
  const fallback = isCommercialPromotionFallbackCopy(copy);
  if (!fallback && copy.source !== 'AI') return false;
  const validation = fallback
    ? validateCommercialPromotionFallbackOutput(validator, output, facts.productName, [facts.shopName])
    : validator.validate(output, facts.productName, [facts.shopName]);
  return validation.valid && isSafeAssembledCommercialPromotionCopy(copy, affiliateLink,
    fallback ? { ...facts, productName: output.body, shopName: '' } : facts, maximumLength);
};
