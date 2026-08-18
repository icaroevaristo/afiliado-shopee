import { commercialOfferSnapshotMatchesProduct } from './commercial-offer-snapshot';
import type { CommercialPromotionCopyContext } from './repositories';

export const COMMERCIAL_AFFILIATE_LINK_REQUIRED =
  'COMMERCIAL_AI_COPY_AFFILIATE_LINK_REQUIRED';
export const COMMERCIAL_AFFILIATE_LINK_INVALID =
  'COMMERCIAL_AI_COPY_AFFILIATE_LINK_INVALID';
export const COMMERCIAL_AFFILIATE_LINK_DOMAIN_UNAUTHORIZED =
  'COMMERCIAL_AI_COPY_AFFILIATE_LINK_DOMAIN_UNAUTHORIZED';
export const COMMERCIAL_AFFILIATE_LINK_NOT_AFFILIATE =
  'COMMERCIAL_AI_COPY_AFFILIATE_LINK_NOT_AFFILIATE';
export const COMMERCIAL_AFFILIATE_LINK_PROVENANCE_INVALID =
  'COMMERCIAL_AI_COPY_AFFILIATE_LINK_PROVENANCE_INVALID';
export const COMMERCIAL_AFFILIATE_LINK_SNAPSHOT_MISMATCH =
  'COMMERCIAL_AI_COPY_AFFILIATE_LINK_SNAPSHOT_MISMATCH';

export type CommercialAffiliateLinkOrigin =
  | 'OFFICIAL_OFFER_LINK'
  | 'MANUAL_INPUT'
  | 'MOCK_FIXTURE';

export type CommercialAffiliateLinkProvenance = {
  source: CommercialPromotionCopyContext['product']['source'];
  productId: string;
  providerProductId: string;
  snapshotId: string;
  snapshotRevision: number;
  snapshotFingerprint: string;
  candidateId: string;
  campaignId: string;
  groupId: string | null;
  productLink: string;
  affiliateLink: string;
  origin: CommercialAffiliateLinkOrigin;
  validationState: 'VALID';
};

export type CommercialAffiliateLinkValidationContext = {
  candidate: Pick<
    CommercialPromotionCopyContext['candidate'],
    'id' | 'campaignId' | 'productId' | 'snapshotId'
  >;
  campaign: Pick<CommercialPromotionCopyContext['campaign'], 'id'>;
  product: CommercialPromotionCopyContext['product'];
  snapshot: Pick<
    CommercialPromotionCopyContext['snapshot'],
    'id' | 'productId' | 'revision' | 'fingerprint'
  >;
};

export type CommercialAffiliateLinkValidation =
  | { valid: true; provenance: CommercialAffiliateLinkProvenance }
  | { valid: false; code: string };

const parseHttpUrl = (value: string | null) => {
  if (!value || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
};

const isShopeeBrazilHost = (hostname: string) =>
  hostname === 'shopee.com.br' || hostname.endsWith('.shopee.com.br');

const officialLinkHostsAreCompatible = (
  productLink: URL,
  affiliateLink: URL,
) =>
  isShopeeBrazilHost(productLink.hostname.toLowerCase()) &&
  (isShopeeBrazilHost(affiliateLink.hostname.toLowerCase()) ||
    affiliateLink.hostname.toLowerCase() === 'shope.ee');

const originForSource = (
  source: CommercialPromotionCopyContext['product']['source'],
): CommercialAffiliateLinkOrigin => {
  switch (source) {
    case 'OFFICIAL':
      return 'OFFICIAL_OFFER_LINK';
    case 'MANUAL':
      return 'MANUAL_INPUT';
    case 'MOCK':
      return 'MOCK_FIXTURE';
  }
};

export const validateCommercialAffiliateLinkProvenance = (
  context: CommercialAffiliateLinkValidationContext,
  expected: {
    candidateId?: string;
    campaignId?: string;
    groupId?: string;
  } = {},
): CommercialAffiliateLinkValidation => {
  const { candidate, campaign, product, snapshot } = context;

  if (
    (expected.candidateId !== undefined && candidate.id !== expected.candidateId) ||
    (expected.campaignId !== undefined && campaign.id !== expected.campaignId) ||
    candidate.productId !== product.id ||
    candidate.snapshotId !== snapshot.id ||
    candidate.campaignId !== campaign.id ||
    snapshot.productId !== product.id ||
    !product.providerProductId
  ) {
    return { valid: false, code: COMMERCIAL_AFFILIATE_LINK_PROVENANCE_INVALID };
  }

  const productLinkValue = product.productLink;
  const productLink = parseHttpUrl(productLinkValue);
  if (!productLink || productLinkValue === null) {
    return { valid: false, code: COMMERCIAL_AFFILIATE_LINK_PROVENANCE_INVALID };
  }

  if (!product.affiliateLink) {
    return { valid: false, code: COMMERCIAL_AFFILIATE_LINK_REQUIRED };
  }
  const affiliateLink = parseHttpUrl(product.affiliateLink);
  if (!affiliateLink) {
    return { valid: false, code: COMMERCIAL_AFFILIATE_LINK_INVALID };
  }
  if (product.affiliateLink === product.productLink) {
    return { valid: false, code: COMMERCIAL_AFFILIATE_LINK_NOT_AFFILIATE };
  }
  if (
    product.source === 'OFFICIAL' &&
    !officialLinkHostsAreCompatible(productLink, affiliateLink)
  ) {
    return {
      valid: false,
      code: COMMERCIAL_AFFILIATE_LINK_DOMAIN_UNAUTHORIZED,
    };
  }

  if (
    !commercialOfferSnapshotMatchesProduct({
      product,
      productSnapshotRevision: product.commercialSnapshotRevision,
      productSnapshotFingerprint: product.commercialSnapshotFingerprint,
      snapshot,
    })
  ) {
    return { valid: false, code: COMMERCIAL_AFFILIATE_LINK_SNAPSHOT_MISMATCH };
  }

  return {
    valid: true,
    provenance: {
      source: product.source,
      productId: product.id,
      providerProductId: product.providerProductId,
      snapshotId: snapshot.id,
      snapshotRevision: snapshot.revision,
      snapshotFingerprint: snapshot.fingerprint,
      candidateId: candidate.id,
      campaignId: campaign.id,
      groupId: expected.groupId ?? null,
      productLink: productLinkValue,
      affiliateLink: product.affiliateLink,
      origin: originForSource(product.source),
      validationState: 'VALID',
    },
  };
};
