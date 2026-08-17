# Phase 3 fairness and multi-group selection contract

## Scope and stable inputs

Phase 3 chooses one eligible campaign/group target per automation tick from the
already-materialized Phase 2 queues. It consumes the stable logical group
fingerprint, physical group id, campaign id, niche id, `PromotionCandidate`
identity, stable `productId`, snapshot identity/revision and `rankPosition`.
It does not recompute commercial score or rank products across or inside
campaigns.

A target participates only when its physical destination is an authorized
GROUP for the configured Evolution instance, is active and available, has a
valid stable logical fingerprint, maps to exactly one active campaign with an
active niche, and the campaign is not in `nextEligibleAt` backoff. Duplicate
physical destinations for the same logical fingerprint fail closed.

## Deterministic target fairness

Authorized physical groups are normalized into a stable order by logical group
fingerprint and group id before campaign resolution. Eligible targets are then
ordered by persisted delivery history:

1. groups with no successful delivery history first;
2. otherwise the oldest `lastSentAt` first;
3. logical group fingerprint as the first stable tie-breaker;
4. physical group id as the final stable tie-breaker.

No random value, array position, process-local cursor or current timestamp is
used as a fairness tie-breaker. Reordering equivalent input arrays therefore
does not change the target order. A new eligible group enters with no delivery
history and is served before groups that already have successful deliveries;
after its first successful delivery it participates in the same oldest-first
rotation.

For N continuously eligible groups that each have an eligible candidate and no
quota/cooldown/backoff blocker, every successful selection moves the selected
group behind groups with older or missing delivery history. Consequently no
such group can be starved for more than N successful selections. Groups without
an eligible candidate are skipped for that tick and do not block later targets.

## Quotas, cadence and cooldowns

Operational guardrails are evaluated for each target before it can be selected.
The existing global daily quota is enforced together with the per-group limit,
where the effective group limit is the minimum of the automation group limit
and the campaign `dailyLimit`. The existing minimum send interval is evaluated
from the selected physical group's persisted `groupLastSentAt` before
selection.

Campaign `cadenceMinutes` is preserved exactly as its existing configuration
contract: together with the campaign window it determines the theoretical
number of daily slots and constrains `dailyLimit`. Existing project
documentation explicitly states that campaign cadence does not have a Scheduler
at this stage, so Phase 3 does not invent a second runtime cooldown from it.
Campaign failure cooldown/backoff remains represented by `nextEligibleAt` and
is checked both while listing targets and immediately before attempt
reservation.

## Candidate selection and Phase 2 ranking

Once a target is being evaluated, its queue is loaded by `campaignId` only.
Eligible `QUEUED` and `COPY_READY` candidates share the same ordering:
`rankPosition`, then `queuedAt`, then candidate id. Copy state therefore cannot
promote a lower-ranked product over a higher-ranked product. Phase 3 never
compares product ranks from different campaigns and never reranks the Phase 2
queue.

A candidate is skipped when its stable product was already sent to that
physical group. The candidate/copy/snapshot/product/campaign/group linkage is
revalidated before materialization. The same product may independently remain
eligible for a different group because delivery history and campaign queues are
scoped to their target identities.

## Idempotency and concurrency

Campaign attempt reservation is a per-campaign compare-and-set. A free campaign
accepts the requesting execution; a repeated reservation by the same execution
returns the existing reservation without reacquiring it; another execution
holding that campaign returns a conflict. A conflict or newly-active backoff on
one target removes only that target from the current ordered scan so an
independent campaign can still be selected. It does not become a global
campaign lock.

The selected candidate is fixed by preflight and revalidated rather than
silently replaced during preparation. Re-executing with the same persisted
history, campaign state, queue state and execution ownership therefore preserves
the same decision. Any material state change is detected by target/candidate
revalidation or by the per-campaign reservation CAS.

The automation execution ownership/lease remains the existing scheduler-level
safety boundary. Phase 3 does not weaken that contract and does not turn it into
shared mutable campaign selection state.

## Materialization boundary

Only the chosen target proceeds to candidate preparation/materialization. The
result retains campaign id, group id, logical group fingerprint, candidate id,
product id and snapshot/copy provenance already validated by the preceding
phases. No dispatch, outbox creation, provider call or message send is part of
this Phase 3 contract.