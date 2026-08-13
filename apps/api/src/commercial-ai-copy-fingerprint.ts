import { createHash } from 'node:crypto';

import type { CommercialPromotionSignal } from './repositories';

export type CommercialAiCopyFingerprintInput = {
  promptVersion: string;
  validationVersion: string;
  provider: string;
  model: string;
  campaignId: string;
  campaignUpdatedAt: Date;
  nicheId: string;
  nicheUpdatedAt: Date;
  candidateId: string;
  productId: string;
  snapshotId: string;
  snapshotRevision: number;
  snapshotFingerprint: string;
  commercialScore: number;
  promotionSignals: CommercialPromotionSignal[];
  priceDropPercent: string | null;
  productName: string;
  shopName: string;
  price: string;
  discountRate: number;
  rating: number;
  sales: number;
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
      input.provider,
      input.model,
      input.campaignId,
      input.campaignUpdatedAt.toISOString(),
      input.nicheId,
      input.nicheUpdatedAt.toISOString(),
      input.candidateId,
      input.productId,
      input.snapshotId,
      input.snapshotRevision,
      input.snapshotFingerprint,
      input.commercialScore,
      [...input.promotionSignals].sort(),
      input.priceDropPercent === null
        ? null
        : canonicalDecimal(input.priceDropPercent),
      input.productName,
      input.shopName,
      canonicalDecimal(input.price),
      input.discountRate,
      input.rating,
      input.sales,
      sha256(input.affiliateLink),
      input.maximumLength,
    ]),
  );
