# Phase 1 product identity and variant deduplication

## Provider contract

The current `productOfferV2` integration exposes `itemId` and `shopId`. It does
not expose a `variationId`, `modelId` or SKU in the application contract.
`itemId` is therefore treated as an opaque atomic provider identity. The
application never infers a variant from name, price, image, product URL or
affiliate URL.

## Persisted identities

- Provider item/product: `source + providerProductId`, where
  `providerProductId` is the mapped opaque `itemId`.
- `shopId`: an OFFICIAL identity consistency witness, not part of the persisted
  key. This preserves legacy rows while preventing the same provider identity
  from being silently reassigned to another shop.
- Variant: unavailable in the current provider contract. Different provider
  item IDs remain distinct even if all presentation fields are equal.
- Offer snapshot: `productId + revision`. Its fingerprint records mutable
  commercial state and must never be used as product identity.
- Promotion candidate: `campaignId + productId`.
- Generated copies and dispatches keep the stable selected `productId`.

## PRODUCT_VARIANT_DEDUPLICATION

- Same item repeated in a page or overlapping pages is deduplicated by the
  atomic provider identity after checking compatible identity witnesses.
- Repeated synchronization updates the same row through the existing unique
  constraint on `source + providerProductId`.
- Price, commission, availability and affiliate-link changes do not create a
  new product. Commercial-state changes may create a new snapshot revision.
- Same names, links, prices or images with different provider item IDs are not
  merged.
- Same provider item ID with two different non-empty `shopId` values fails
  closed with `PRODUCT_VARIANT_DEDUPLICATION`.
- A new OFFICIAL observation without `shopId` is rejected as
  `SHOPEE_PRODUCT_IDENTITY_INCOMPLETE`.
- A legacy persisted row without `shopId` remains readable and may be enriched
  by a later complete OFFICIAL observation; no heuristic variant key is made.
- Hunter defensively rejects two different persisted product IDs that claim the
  same provider identity, while an exact repeated catalog row is evaluated once.

A future provider contract that exposes a real variant/model identifier must
extend this contract explicitly rather than changing the meaning of `itemId`
implicitly.
