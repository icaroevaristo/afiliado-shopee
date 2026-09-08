# Persistent discovery and prepared inventory

The commercial automation heartbeat owns inventory replenishment. It advances
durable `CommercialDiscoveryCheckpoint` rows only after a provider page has
been persisted, and it replays a page safely when a worker stops before the
checkpoint CAS. Each run is bounded to at most three pages and uses the normal
per-request external budget wrapper. Exhausted checkpoints remain dormant until
their refresh cooldown expires.

The official `ProductOfferV2` boundary receives only confirmed provider
parameters (keyword/category, sort, page, and cursor). Commercial thresholds
from a niche are applied by local catalog eligibility and mining, so unsupported
remote filters cannot turn discovery into an invalid provider request.

The supervisor fills local candidate queues, prepares final copy, and persists a
`CommercialPreparedMessage` in `READY` only when the candidate is
`COPY_READY` and the candidate, current snapshot, generated copy, campaign,
group, assigned instance, and completed dry-run are consistent. A `READY` row
whose candidate is `QUEUED`, `RESERVED`, `DISPATCHED`, `EXPIRED`, or `BLOCKED`
is not materially ready. Snapshot or copy drift invalidates the row. Local
prepared TTL expiry invalidates only the prepared row while the candidate stays
`COPY_READY`, allowing same-snapshot preparation to create a new preparation
revision. Commercial content validity is evaluated before local TTL, so a
TTL-expired row with a newer snapshot or an unavailable product is invalidated
as `SNAPSHOT_OR_COPY_STALE` and its candidate is terminalized. TTL alone remains
`PREPARED_EXPIRED` and preserves the candidate for same-snapshot preparation.
Offer expiry or snapshot/copy drift terminalizes the candidate with the
corresponding reason. Reservation leases are recovered by reading the
persisted run, dispatch, and outbox: a confirmed run or dispatch/outbox
evidence becomes `DISPATCHED`; only a dry-run with no such evidence can return
to `READY`.

The persisted settings expose separate usable-candidate and prepared-message
low/target watermarks. A target at or above the prepared watermark is left
alone; a deficit is filled from the local queue first, then local mining, and
only then bounded discovery.

Each heartbeat also has process-local caps of 32 targets, 6 discovery page
requests, and 16 preparation attempts. Discovery has no automatic retry;
checkpoint lease expiry replays the page, and the BullMQ heartbeat remains a
single-attempt job. Prepared run identities include the candidate snapshot, so
the same candidate can be prepared again after local TTL expiry and after
snapshot N+1 reactivation without reopening a sent or ambiguous lifecycle.

Prepared invalidation uses a keyset cursor over `(updatedAt, id)` and continues
past materially valid rows until its invalidation limit is reached. Candidate
policy is revalidated immediately before a prepared confirmation, including
price, category, keyword, and minimum-score rules. A lower current
`minimumScore` does not reject a candidate that still matches the effective
policy; a higher threshold is applied by the matcher. If a prepared candidate
fails a material policy check, the reserved row is invalidated with an explicit
policy reason and a bounded search claims the next local `READY` row in the
same execution, instance, assignment, and slot. No preparation or provider
call is made for that replacement. For an ordered A/B assignment, the
supervisor preloads protected candidate identities for the complete route
before filling either instance; the slot keeps its persisted instance and
assignment revision. The handoff locks the niche row and compares its
`updatedAt` fence, so a policy update racing the transaction rolls back the
handoff before a run, dispatch, outbox, or job is created.

Across independent discovery checkpoint leases, `fetchedAt` is treated as the
provider observation time. A strictly older observation is an acknowledged
no-op after a newer observation, including its product and snapshot state; the
checkpoint leases remain independently fenced. Equal observation times remain
a provider tie and do not establish ordering. Receipt time is not a provider
version, so this protection depends on a trustworthy provider observation time.

The scheduled target path is intentionally DB-only:

```text
planner heartbeat
  -> inventory supervisor (background discovery/mining/copy)
  -> deterministic target job
  -> policy and sticky target validation
  -> PostgreSQL READY claim (CAS/lease)
  -> existing confirmation/outbox publisher
  -> BullMQ dispatch -> SenderService -> Evolution boundary
```

The target does not call the Shopee provider, OpenAI, mining, or copy
generation. An empty prepared queue ends with
`COMMERCIAL_READY_INVENTORY_EMPTY` before an external provider boundary.

```text
SHOPEE_IN_SLOT_PATH=false
OPENAI_IN_SLOT_PATH=false
```

Background discovery and WhatsApp dispatch use separate budgets, retry policy,
leases, and observability. The current branch includes a disposable
PostgreSQL/Redis certification of the real refill, planner, orchestrator,
outbox, BullMQ, worker, Sender, fake provider, confirmation, and inbox path for
100 healthy logical slots. That certification does not exercise provider
timeout, worker crash, or restart recovery; those cases remain mapped to their
separate focused tests and are not inferred from the 100-slot count.
Operational infrastructure and external providers remain outside that
certification.
