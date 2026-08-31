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
  /**
   * Snapshot fields are retained only for compatibility with callers that
   * also carry provenance. They are not part of the AI generation contract:
   * the prompt sends only the sanitized product identity.
   */
  snapshotId?: string;
  snapshotRevision?: number;
  snapshotFingerprint?: string;
  /**
   * Legacy assembly fields remain accepted for source compatibility only.
   * They are deliberately excluded from the generation-contract hash below.
   */
  promotionSignals?: readonly CommercialPromotionSignal[];
  priceDropPercent?: string | null;
  productName?: string;
  shopName?: string;
  price?: string;
  discountRate?: number;
  affiliateLink?: string;
  maximumLength?: number;
};

export const sha256 = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');

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
    ]),
  );
