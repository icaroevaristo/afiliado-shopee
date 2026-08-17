# Phase 7 destinations, intervals and publication policy contract

## Scope

Phase 7 consumes the certified Phase 1-6 chain and closes the policy boundary
before dispatch/provider work:

`PromotionCandidate -> deterministic target -> authorized physical group ->
campaign/group policy -> reservation/CAS -> certified CommercialMessageDraft ->
publication boundary`.

This phase does not send messages and does not change product identity, ranking,
Copy V10, affiliate-link provenance, media payload semantics or SenderService.

## Destination identity and authorization

A physical destination is eligible only when the existing group record satisfies
all of the following at the same time:

- `type === GROUP`;
- `active === true`;
- `available === true`;
- `sourceInstanceName` equals the configured instance;
- `fingerprint` matches the stable `grp_[a-f0-9]{12}` logical-group contract.

The group name is display evidence only. Selection and revalidation never resolve
a target by name. A selected target carries `groupId` and
`logicalGroupFingerprint`; immediately before use the group directory is read
again and both values must still identify the same authorized group in the same
configured instance. Campaign resolution is by logical fingerprint, and the
campaign fingerprint must agree with the physical group.

More than one authorized physical record carrying the same logical fingerprint
is ambiguous and fails closed. Inactive, unavailable, wrong-instance, malformed
fingerprint, missing campaign, inactive campaign and inactive niche records are
excluded or rejected before mining/copy/dispatch work.

## Deterministic fairness and target order

The authorized group set is canonicalized by logical fingerprint and then
`groupId`, so incidental repository/array order cannot influence selection.
Targets with `nextEligibleAt` in the future are removed before fairness.

For the remaining targets, Phase 3 fairness is preserved exactly:

1. groups with no previous `SENT` are ordered before groups with history;
2. otherwise the oldest per-group `lastSentAt` comes first;
3. ties use logical fingerprint and then `groupId`.

No product is reranked by this step. Candidate ranking remains the materialized
`rankPosition` within its campaign. `QUEUED` versus `COPY_READY` does not promote
a lower-ranked candidate. Tests explicitly permute the physical-group input and
obtain the same target order.

A target with no candidate is skipped without preparing artifacts for it, and
independent targets continue to be evaluated. One automation tick commits at most one
target: tests prove that the orchestrator evaluates ordered targets but confirms only
the first allowed target, so the per-execution publication limit is one without adding
a new configurable constant. Once preparation of a selected
candidate starts, an unexpected preparation/revalidation failure is fail-closed
rather than silently switching products.

## Campaign and group policies

The existing policy service is authoritative for publication eligibility. Phase
7 does not reinterpret `cadenceMinutes`, snapshot freshness or TTL.

The current policy inputs are:

- global automation enabled/disabled and persisted pause;
- configured timezone and allowed publication window;
- configured global daily limit;
- configured group daily limit;
- the selected campaign `dailyLimit`;
- configured `minimumIntervalMinutes`;
- per-group `groupLastSentAt` / per-group sent count;
- active, ambiguous and stale commercial-execution state;
- authorized-group count and duplicate logical-group detection.

The effective per-target daily quota is the minimum of campaign `dailyLimit` and
configured group daily limit. Queue capacity is not a publication quota. The
minimum interval is calculated only from the selected group's last `SENT`; a
send in one group does not cool down an independent group that has never sent.
When only time/window/quota constraints block a target, `nextAllowedAt` is the
latest applicable boundary adjusted to the next allowed publication window.

## nextEligibleAt, cooldown and backoff

`CommercialGroupCampaign.nextEligibleAt` is a persisted target-level eligibility
boundary. Targets whose value is in the future are excluded before fairness and
are rechecked immediately before attempt reservation.

The project has a separate, already implemented recovery backoff for failed
pre-marker recovery. Phase 7 preserves it rather than inventing another cooldown:
`failureCount` is incremented and the delay starts from the configured minimum
interval, doubles with consecutive failures, and is capped by the existing
24-hour maximum. A successful recovery resets `failureCount` to zero and
`nextEligibleAt` to null. Invalid recovery/backoff state fails closed instead of
manufacturing a new timing rule.

`cadenceMinutes` remains campaign configuration and is not silently repurposed as
this backoff or as the global minimum interval.

## Scheduler policy

Scheduler availability and automation policy are separate gates. Scheduler
status is read-only through the certified status routes; those routes neither
register nor trigger a tick and do not expose an endpoint that enables the
scheduler. A disabled scheduler therefore cannot be bypassed through the status
surface. Operational worker/scheduler execution is outside this certification.

## Reservation, CAS and independent targets

Before a send-mode target is prepared, the orchestrator validates its execution
lease and asks the existing campaign attempt repository to reserve that campaign.
The reservation is owner/execution scoped and idempotent for the same owner.
Another owner's reservation conflicts only for that target: the orchestrator
continues evaluating independent targets instead of sharing a global lock.

Campaign reservations are isolated from other groups. Release is owner-checked
and clears only the attempt fields. A target that becomes ineligible/backed off
between list and reservation is not prepared.

## Idempotency and publication boundary

Existing candidate/snapshot/campaign/group identity, copy-generation idempotency
and dispatch/outbox contracts are preserved. Phase 7 does not create a second
query to repair an inconsistent destination and does not change the destination
silently.

Downstream lifecycle contracts remain fail-closed:

- deterministic outbox/job identity prevents duplicate enqueue;
- concurrent publishers deduplicate the same job id;
- `PUBLISHED` reconciliation verifies the deterministic job instead of enqueueing
  again;
- uncertain enqueue/reconciliation becomes `AMBIGUOUS` and is not retried
  blindly;
- sender does not resend `SENT` or `PROCESSING` dispatches;
- only one concurrent sender can acquire a pending dispatch;
- uncertain provider outcome remains `PROCESSING` rather than being treated as a
  safe retry.

Phase 7 tests these boundaries with repositories, queues and providers mocked or
in memory. No dispatch/job is created in a real operational system and no
provider call is made.

## Safety and observability

Target/policy failures use stable reason/error codes. Status surfaces sanitize
lease/owner information and provider-facing preview contracts from Phase 6 stay
unchanged. Publication-policy certification must not log raw destination ids,
caption/affiliate URLs, tokens, secrets, database/Redis URLs or provider payloads.

## Deliberate non-rules

Phase 7 does not invent new semantics for `cadenceMinutes`, snapshot TTL,
freshness or provider retry timing. Where those concepts are not used by the
existing publication policy, they remain unchanged and are not converted into
new constants. End-to-end dispatch/outbox/Sender lifecycle execution belongs to
Phase 8 and remains outside this phase.