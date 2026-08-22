import { createHash } from 'node:crypto';

import type { CommercialPromotionSignal } from './repositories';

export type CommercialAiCopyFingerprintInput = {
  // Version/provider and stable identity fields protect request and cache
  // isolation. Operational timestamps are intentionally excluded.
  promptVersion: string;
  validationVersion: string;
  inputSanitizationVersion: string;
  modelProductName: string;
  provider: string;
  model: string;
  campaignId: string;
  nicheId: string;
  candidateId: string;
  productId: string;
  snapshotId: string;
  snapshotRevision: number;
  snapshotFingerprint: string;
  // These fields affect the trusted assembled message or cache acceptance.
  promotionSignals: CommercialPromotionSignal[];
  priceDropPercent: string | null;
  productName: string;
  shopName: string;
  price: string;
  discountRate: number;
  affiliateLink: string;
  maximumLength: number;
};

export const sha256 = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const canonicalDecimal = (value: string) => {
  const [integer = '0', fraction = ''] = value.trim().split('.');
  const canonicalInteger = integer.replace(/^(-?)0+(?=\d)/u, '$1');
  const canonicalFraction = fraction.replace(/0+$/u, '');
  return canonicalFraction
    ? `${canonicalInteger}.${canonicalFraction}`
    : canonicalInteger;
};

export const commercialAiCopyInputFingerprint = (
  input: CommercialAiCopyFingerprintInput,
) =>
  sha256(
    JSON.stringify([
      input.promptVersion,
      input.validationVersion,
      input.inputSanitizationVersion,
      input.modelProductName,
      input.provider,
      input.model,
      input.campaignId,
      input.nicheId,
      input.candidateId,
      input.productId,
      input.snapshotId,
      input.snapshotRevision,
      input.snapshotFingerprint,
      // Keep deterministic assembly and cache-acceptance inputs in the key.
      [...input.promotionSignals].sort(),
      input.priceDropPercent === null
        ? null
        : canonicalDecimal(input.priceDropPercent),
      input.productName,
      input.shopName,
      canonicalDecimal(input.price),
      input.discountRate,
      sha256(input.affiliateLink),
      input.maximumLength,
    ]),
  );
