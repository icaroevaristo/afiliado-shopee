import type { ShopeeProductOffer } from '@shopee-auto-affiliate-ai/providers';
import { AppError } from '@shopee-auto-affiliate-ai/shared';

/**
 * Phase 1 identity contract.
 * productOfferV2 exposes itemId and shopId, but no variationId/modelId/SKU.
 * itemId stays opaque and atomic; variant identity is never inferred from
 * mutable presentation fields such as name, price, image or URLs.
 */
export const PRODUCT_VARIANT_DEDUPLICATION =
  'PRODUCT_VARIANT_DEDUPLICATION' as const;
export const SHOPEE_PRODUCT_IDENTITY_INCOMPLETE =
  'SHOPEE_PRODUCT_IDENTITY_INCOMPLETE' as const;

export type ShopeeProductIdentityInput = Pick<
  ShopeeProductOffer,
  'source' | 'providerProductId' | 'shopId'
>;

export type ShopeeProductIdentity = {
  key: string;
  source: ShopeeProductOffer['source'];
  providerProductId: string;
  shopId: string | null;
  variantIdentity: 'UNAVAILABLE';
};

const normalized = (value: string | undefined) => value?.trim() || null;

export const resolveShopeeProductIdentity = (
  input: ShopeeProductIdentityInput,
): ShopeeProductIdentity => {
  const providerProductId = input.providerProductId.trim();
  const shopId = normalized(input.shopId);
  if (!providerProductId) {
    throw new AppError(
      'Identidade de produto Shopee incompleta',
      SHOPEE_PRODUCT_IDENTITY_INCOMPLETE,
    );
  }
  return {
    key: `${input.source}:${providerProductId}`,
    source: input.source,
    providerProductId,
    shopId,
    variantIdentity: 'UNAVAILABLE',
  };
};

export const assertCompleteShopeeProductIdentity = (
  input: ShopeeProductIdentityInput,
): ShopeeProductIdentity => {
  const identity = resolveShopeeProductIdentity(input);
  if (identity.source === 'OFFICIAL' && !identity.shopId) {
    throw new AppError(
      'Identidade oficial de produto sem loja',
      SHOPEE_PRODUCT_IDENTITY_INCOMPLETE,
    );
  }
  return identity;
};

export const assertCompatibleShopeeProductIdentity = (
  existing: ShopeeProductIdentityInput,
  incoming: ShopeeProductIdentityInput,
) => {
  const current = resolveShopeeProductIdentity(existing);
  const next = resolveShopeeProductIdentity(incoming);
  if (current.key !== next.key) return;
  if (current.shopId && next.shopId && current.shopId !== next.shopId) {
    throw new AppError(
      'Identidade atomica do produto divergiu entre lojas',
      PRODUCT_VARIANT_DEDUPLICATION,
    );
  }
};
