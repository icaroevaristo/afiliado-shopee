# Phase 2 filters, scoring, ranking and selection contract

## Scope

Phase 2 consumes the stable Phase 1 `productId`, commercial snapshot and
`PromotionCandidate`. Product identity is never reconstructed from name, price,
link, image or other mutable fields.

## Filter and eligibility order

1. Repository filters bound the deterministic raw candidate pool by source,
   category, price, discount, rating, sales and commission.
2. Structural eligibility rejects unavailable, expired, not-yet-started or
   malformed offers before scoring.
3. OFFICIAL products are scored with `official-v2`; MOCK/MANUAL standalone
   dry-runs retain `legacy-v1`.
4. The promotion miner applies niche constraints after the OFFICIAL score.
5. Snapshot revision/fingerprint/product linkage must be current before a
   promotion is eligible.
6. Promotion signals and sent/dedupe state are evaluated before ranking.

No arbitrary age TTL is inferred from `fetchedAt`/`lastSeenAt`: the current
provider contract defines no freshness SLA. A stale commercial selection is
therefore detected by explicit availability/offer windows and by snapshot or
product CAS mismatch during materialization and downstream revalidation.

## Scoring policies

- `official-v2` is a pure deterministic score computed from current commission,
  rating, sales and discount. Persisted legacy `ProductLead.score` is not an
  input to this policy.
- `legacy-v1` is retained only for MOCK/MANUAL and legacy standalone dry-run
  compatibility.
- The automation/Hunter path never silently falls back from `official-v2` to
  `legacy-v1`.

## Ranking

Promotion/Hunter ranking is deterministic and ordered by:

1. presence of `PRICE_DROP`;
2. larger price-drop percentage;
3. larger `commercialScore`;
4. larger discount;
5. larger commission;
6. larger sales count;
7. stable `productId` ascending.

The standalone pipeline dry-run uses its legacy ranking dimensions and now also
uses stable `productId` as the final deterministic tie-breaker. It is diagnostic
and does not replace the promotion ranking.

`dryRunFromPromotionCandidate` consumes the already-ranked PromotionCandidate
and must not rerank it.

## Queue selection and capacity

Materialization subtracts protected `COPY_READY`/`RESERVED` candidates from the
campaign target capacity and takes exactly the top remaining ranked candidates.
The repository locks per campaign and revalidates campaign, niche, product,
snapshot, recent-send state and expected candidate state before writing.

The automation preflight preserves the persisted queue order across both
`QUEUED` and `COPY_READY`: `rankPosition`, then `queuedAt`, then candidate `id`.
Copy readiness is not allowed to jump ahead of a better-ranked queued candidate.

The existing campaign+product uniqueness and transactional CAS make repeated
materialization idempotent; an identical rerun updates the existing candidate
instead of creating a duplicate. Concurrent mining of one campaign fails
closed, while different campaigns remain independent.

## Phase boundary

Fairness and integrated multi-group selection remain Phase 3 concerns. Phase 2
only guarantees deterministic ranking and selection inside the already chosen
campaign/group context.
