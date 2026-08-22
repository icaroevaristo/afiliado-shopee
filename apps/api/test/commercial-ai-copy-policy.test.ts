import { describe, expect, it } from 'vitest';

import {
  hasCommercialAiCopyProhibitedClaim,
  normalizeCommercialAiCopyPolicyText,
  sanitizeCommercialAiCopyProductNameForModel,
} from '../src/commercial-ai-copy-policy';

describe('commercial AI copy policy and model input sanitization', () => {
  it.each([
    ['Nike Original', 'Nike'],
    ['MEDICUBE zero pore pad 2.0,zero pore pad mild 3types(original pad/refill)', 'MEDICUBE zero pore pad 2.0,zero pore pad mild 3types(pad/refill)'],
    ['Kit com frete grátis e loja oficial', 'Kit com e'],
    ['Produto exclusivo, Autêntico e FRETE GRATIS', 'Produto, e'],
  ])('remove claims without rewriting identity: %s', (source, expected) => {
    const sanitized = sanitizeCommercialAiCopyProductNameForModel(source);
    expect(sanitized).toBe(expected);
    expect(hasCommercialAiCopyProhibitedClaim(sanitized)).toBe(false);
  });

  it('uses the same accent-insensitive, case-insensitive policy matcher', () => {
    expect(sanitizeCommercialAiCopyProductNameForModel('Produto limpo')).toBe(
      'Produto limpo',
    );
    expect(normalizeCommercialAiCopyPolicyText(' ORIGINAL  Autêntico ')).toBe(
      'original autentico',
    );
    expect(
      sanitizeCommercialAiCopyProductNameForModel(
        'Produto ORIGINAL Autêntico FRETE GRATIS',
      ),
    ).toBe('Produto');
  });

  it('keeps the special imperdível plus urgency rule aligned with validation', () => {
    const source = 'Produto imperdível só hoje';
    expect(hasCommercialAiCopyProhibitedClaim(source)).toBe(true);
    const sanitized = sanitizeCommercialAiCopyProductNameForModel(source);
    expect(sanitized).toBe(
      'Produto imperdível',
    );
    expect(hasCommercialAiCopyProhibitedClaim(sanitized)).toBe(false);
  });

  it('is deterministic and idempotent', () => {
    const source = 'Air Fryer 6,5L 1700W 127V Original';
    const first = sanitizeCommercialAiCopyProductNameForModel(source);
    const second = sanitizeCommercialAiCopyProductNameForModel(first);
    expect(first).toBe('Air Fryer 6,5L 1700W 127V');
    expect(second).toBe(first);
  });

  it('fails closed when sanitization removes the whole identity', () => {
    expect(() =>
      sanitizeCommercialAiCopyProductNameForModel('Original'),
    ).toThrow('COMMERCIAL_AI_COPY_MODEL_PRODUCT_NAME_EMPTY');
  });
});
