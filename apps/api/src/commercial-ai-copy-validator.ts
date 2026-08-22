import type { CommercialAiCopyOutput } from './commercial-ai-copy-provider';
import { COMMERCIAL_AI_COPY_PROHIBITED_PHRASES } from './commercial-ai-copy-policy';

export type CommercialAiCopyValidationResult = {
  valid: boolean;
  sanitizedOutput?: CommercialAiCopyOutput;
  publicFailureCodes: string[];
};

export const COMMERCIAL_AI_COPY_VALIDATION_FAILURE_CODES = [
  'AI_OUTPUT_STRUCTURE_INVALID',
  'AI_OUTPUT_EXTRA_PROPERTY',
  'AI_HEADLINE_LENGTH',
  'AI_HEADLINE_UPPERCASE',
  'AI_BODY_LENGTH',
  'AI_CONTROL_CHARACTER',
  'AI_DIGIT_FORBIDDEN',
  'AI_URL_OR_CONTACT_FORBIDDEN',
  'AI_MARKDOWN_FORBIDDEN',
  'AI_FACTUAL_VALUE_FORBIDDEN',
  'AI_PROHIBITED_CLAIM',
  'AI_REPETITION_INVALID',
  'AI_CATALOG_FACT_REPEATED',
  'AI_EMOJI_LIMIT',
] as const;

export type CommercialAiCopyValidationFailureCode =
  (typeof COMMERCIAL_AI_COPY_VALIDATION_FAILURE_CODES)[number];

export const sanitizeCommercialAiCopyValidationFailureCodes = (
  input: unknown,
): string[] => {
  if (!Array.isArray(input)) return [];
  const validCodes = new Set<string>();
  for (const item of input) {
    if (typeof item === 'string' && item.length > 0 && item.length <= 100) {
      if (
        (COMMERCIAL_AI_COPY_VALIDATION_FAILURE_CODES as readonly string[]).includes(
          item,
        )
      ) {
        validCodes.add(item);
      }
    }
  }
  return Array.from(validCodes).sort().slice(0, 20);
};

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const DIGIT = /[0-9]/u;
const LETTER = /\p{L}/u;
const URL_OR_CONTACT =
  /(?:[a-z][a-z0-9+.-]*:\/\/|www\.|\b(?:[\p{L}0-9-]+\.)+[\p{L}]{2,63}\b|[\p{L}0-9._%+-]+@[\p{L}0-9.-]+\.[\p{L}]{2,}|\+?\d[\d\s().-]{6,}\d)/iu;
const MARKDOWN = /(?:\[[^\]]+\]\([^)]+\)|[*_~`]{1,3}\S)/u;
const MONEY_OR_PERCENT = /(?:R\s*\$|%)/iu;
const EMOJI = /\p{Extended_Pictographic}/gu;
const NUMERIC_CORE =
  /(?<![\p{L}\d])\d+(?:[.,]\d+)?(?:\s*[-–—]\s*\d+(?:[.,]\d+)?)?(?![\p{L}\d])/gu;
const NUMERIC_ATTACHED_UNIT =
  /(?<![\p{L}\d])\d+(?:[.,]\d+)?(?:\s*[-–—]\s*\d+(?:[.,]\d+)?)?[\p{L}]+/gu;
const NUMERIC_SPACED_UNIT =
  /(?<![\p{L}\d])\d+(?:[.,]\d+)?(?:\s*[-–—]\s*\d+(?:[.,]\d+)?)?\s+(?:ml|l|w|v|peças?|pecas?)\b/giu;

const normalize = (value: string) =>
  value.normalize('NFKC').replace(/\s+/gu, ' ').trim();

const normalizedForPolicy = (value: string) =>
  normalize(value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR');

const containsPhrase = (text: string, phrase: string) => {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}])${escaped}(?:$|[^\\p{L}])`, 'u').test(
    text,
  );
};

const hasProhibitedClaim = (value: string) => {
  const text = normalizedForPolicy(value);
  if (
    COMMERCIAL_AI_COPY_PROHIBITED_PHRASES.some((phrase) =>
      containsPhrase(text, normalizedForPolicy(phrase)),
    )
  ) {
    return true;
  }
  return (
    containsPhrase(text, 'imperdivel') &&
    ['so hoje', 'tempo limitado', 'acaba hoje', 'antes que acabe'].some(
      (phrase) => containsPhrase(text, phrase),
    )
  );
};

const repeatedWords = (value: string) =>
  /\b([\p{L}]{3,})(?:\s+\1){2,}\b/iu.test(normalizedForPolicy(value));

const normalizeNumericSpecification = (value: string) =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase('pt-BR')
    .replace(/[–—]/gu, '-')
    .replace(/(\d)[,.](?=\d)/gu, '$1.')
    .replace(/\s+/gu, ' ')
    .replace(/\s*-\s*/gu, '-')
    .replace(/(?<=\d)\s+(?=[\p{L}])/gu, '')
    .trim();

const numericSpecifications = (value: string) => {
  const specifications = new Set<string>();
  const addMatches = (expression: RegExp) => {
    for (const match of value.matchAll(expression)) {
      const token = match[0];
      const index = match.index ?? 0;
      const before = value.slice(Math.max(0, index - 4), index);
      const after = value.slice(index + token.length);
      if (/R\s*\$\s*$/iu.test(before) || /^\s*%/u.test(after)) continue;
      specifications.add(normalizeNumericSpecification(token));
    }
  };

  for (const match of value.matchAll(NUMERIC_CORE)) {
    const token = match[0];
    const index = match.index ?? 0;
    const before = value.slice(Math.max(0, index - 4), index);
    const after = value.slice(index + token.length);
    if (
      /R\s*\$\s*$/iu.test(before) ||
      /^\s*%/u.test(after) ||
      /^\s*(?:ml|l|w|v|peças?|pecas?)\b/iu.test(after)
    ) {
      continue;
    }
    specifications.add(normalizeNumericSpecification(token));
  }

  addMatches(NUMERIC_ATTACHED_UNIT);
  addMatches(NUMERIC_SPACED_UNIT);
  return specifications;
};

const add = (failures: Set<string>, condition: boolean, code: string) => {
  if (condition) failures.add(code);
};

export class CommercialAiCopyValidator {
  validate(
    output: unknown,
    productNameOrDisallowedCatalogFacts: string | readonly string[] = [],
    disallowedCatalogFacts: readonly string[] = [],
  ): CommercialAiCopyValidationResult {
    const productName =
      typeof productNameOrDisallowedCatalogFacts === 'string'
        ? productNameOrDisallowedCatalogFacts
        : '';
    const trustedFacts =
      typeof productNameOrDisallowedCatalogFacts === 'string'
        ? disallowedCatalogFacts
        : productNameOrDisallowedCatalogFacts;
    const failures = new Set<string>();
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
      return {
        valid: false,
        publicFailureCodes: ['AI_OUTPUT_STRUCTURE_INVALID'],
      };
    }
    const record = output as Record<string, unknown>;
    add(
      failures,
      Object.keys(record).some((key) => !['headline', 'body'].includes(key)),
      'AI_OUTPUT_EXTRA_PROPERTY',
    );
    const rawHeadline =
      typeof record.headline === 'string' ? record.headline : '';
    const rawBody = typeof record.body === 'string' ? record.body : '';
    const headline = normalize(rawHeadline);
    const body = normalize(rawBody);
    add(
      failures,
      headline.length < 5 || headline.length > 90,
      'AI_HEADLINE_LENGTH',
    );
    add(
      failures,
      LETTER.test(headline) && headline !== headline.toLocaleUpperCase('pt-BR'),
      'AI_HEADLINE_UPPERCASE',
    );
    add(failures, body.length < 10 || body.length > 260, 'AI_BODY_LENGTH');
    const headlineTextual = [headline];
    const textual = [headline, body];
    add(
      failures,
      [rawHeadline, rawBody].some((value) => CONTROL_CHARACTERS.test(value)),
      'AI_CONTROL_CHARACTER',
    );
    add(
      failures,
      headlineTextual.some((value) => DIGIT.test(value)) ||
        [...numericSpecifications(body)].some(
          (specification) =>
            !numericSpecifications(productName).has(specification),
        ),
      'AI_DIGIT_FORBIDDEN',
    );
    add(
      failures,
      textual.some((value) => URL_OR_CONTACT.test(value)),
      'AI_URL_OR_CONTACT_FORBIDDEN',
    );
    add(
      failures,
      textual.some((value) => MARKDOWN.test(value)),
      'AI_MARKDOWN_FORBIDDEN',
    );
    add(
      failures,
      textual.some((value) => MONEY_OR_PERCENT.test(value)),
      'AI_FACTUAL_VALUE_FORBIDDEN',
    );
    add(failures, textual.some(hasProhibitedClaim), 'AI_PROHIBITED_CLAIM');
    add(failures, textual.some(repeatedWords), 'AI_REPETITION_INVALID');
    const normalizedText = normalizedForPolicy(textual.join(' '));
    add(
      failures,
      trustedFacts.some((fact) => {
        const normalizedFact = normalizedForPolicy(fact);
        return (
          Boolean(normalizedFact) &&
          containsPhrase(normalizedText, normalizedFact)
        );
      }),
      'AI_CATALOG_FACT_REPEATED',
    );
    add(
      failures,
      (textual.join('').match(EMOJI)?.length ?? 0) > 6,
      'AI_EMOJI_LIMIT',
    );
    const publicFailureCodes = [...failures].sort();
    return publicFailureCodes.length > 0
      ? { valid: false, publicFailureCodes }
      : {
          valid: true,
          sanitizedOutput: { headline, body },
          publicFailureCodes,
        };
  }
}
