# Phase 4 affiliate link provenance and validation contract

## Scope

Phase 4 preserves the selected Phase 1-3 identity chain and proves the affiliate
link before copy or publication preparation can proceed:

`PromotionCandidate -> productId -> snapshot revision/fingerprint -> productLink
-> affiliateLink -> provenance validation -> copy/publication artifact`.

The affiliate link does not create or replace product identity, does not affect
ranking or fairness, and is never synthesized from the product link.

## Source contracts

### OFFICIAL

The official Shopee affiliate offer provider maps `productLink` and `offerLink`
from the same provider observation. `offerLink` is persisted unchanged as
`affiliateLink`. Phase 4 does not shorten, rewrite, append parameters to, or
otherwise manufacture that URL.

An OFFICIAL product link must use `shopee.com.br` or one of its subdomains. The
affiliate link must use the same Shopee Brazil host family or `shope.ee`, as
already represented by the provider contract and fixtures. No additional query
parameter or path rule is invented by Phase 4.

### MANUAL

Manual ingestion requires an explicit `productLink` and an explicit
`affiliateLink`. The project contract forbids automatic conversion of the
normal product URL into an affiliate URL. Phase 4 therefore validates the two
values independently and rejects equality instead of applying a fallback.

### MOCK

MOCK data remains fixture-only and keeps its source explicit. It must still
provide an explicit affiliate link; MOCK does not mask an absent link or reuse
the product link silently.

## Snapshot identity

The commercial offer fingerprint now includes `source`, `providerProductId`,
`productLink`, and `affiliateLink` in addition to the existing commercial offer
material. Therefore a legitimate change to any of those provenance fields
creates a new commercial snapshot revision while retaining the same stable
`ProductLead.id` / product identity.

Repeated ingestion of the same provenance and commercial state retains the same
fingerprint and does not create a duplicate snapshot. An old candidate cannot
silently inherit a link observed in a newer snapshot because candidate,
product, and snapshot fingerprints are checked together at use time.

## Fail-closed validation

Before a QUEUED candidate can generate copy, and again on the candidate-flow
preparation path, Phase 4 verifies:

- candidate id, campaign id and selected group id when supplied by the caller;
- candidate -> product, candidate -> snapshot and candidate -> campaign links;
- snapshot -> product identity;
- persisted `source` and non-empty `providerProductId`;
- explicit `productLink` and explicit `affiliateLink`;
- HTTP or HTTPS syntax without control characters or hidden surrounding data;
- OFFICIAL host compatibility;
- `affiliateLink` is different from `productLink`;
- ProductLead snapshot revision/fingerprint equals the selected snapshot;
- a recomputed fingerprint from the current persisted provenance and commercial
  fields equals the selected snapshot fingerprint.

Failure is reported by sanitized public codes (`..._REQUIRED`, `..._INVALID`,
`..._DOMAIN_UNAUTHORIZED`, `..._NOT_AFFILIATE`, `..._PROVENANCE_INVALID`, or
`..._SNAPSHOT_MISMATCH`). URLs, provider payloads, credentials and tokens are
not included in those errors.

## Persisted provenance chain

The project already persists the evidence required for the chain rather than a
second arbitrary provenance row:

- `ProductLead`: source, stable product id, provider product id, product link,
  affiliate link, current commercial snapshot revision and fingerprint;
- commercial offer snapshot: snapshot id, product id, revision and fingerprint;
- promotion candidate: candidate id, product id, snapshot id and campaign id;
- campaign/group contracts from Phases 1-3: campaign id and stable physical /
  logical group identity;
- generated copy: candidate/product/snapshot association plus the existing
  affiliate-link hash / input fingerprint contract.

`validationState: VALID` and the link origin (`OFFICIAL_OFFER_LINK`,
`MANUAL_INPUT`, or `MOCK_FIXTURE`) are deterministic validation results derived
from that persisted chain; Phase 4 does not add a redundant database column.

## Idempotency and concurrency

The existing copy-generation input fingerprint includes the affiliate-link
hash and the candidate/snapshot contract. Existing cache lookup and generation
claim semantics remain the concurrency boundary: two equivalent concurrent
requests can make at most one provider generation, while reexecution of the
same valid state reuses the compatible copy. A changed affiliate link changes
the snapshot fingerprint and invalidates reuse of copy tied to the older
observation.

## Failure boundary and final artifact

Link/provenance blockers are evaluated before copy generation/provider access.
Candidate flow does not rerank, select another product to hide a link failure,
or fall through to a product URL. Only a candidate whose provenance remains
valid can reach copy preparation. The existing message-draft contract then
carries the validated affiliate link through the final commercial artifact
without replacing it with `productLink`.

Phase 4 does not create dispatch, outbox, jobs, executions, provider sends or
any Phase 5 behavior.