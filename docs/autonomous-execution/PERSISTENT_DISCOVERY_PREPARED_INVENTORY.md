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
`CommercialPreparedMessage` in `READY` only when the candidate, current snapshot,
generated copy, campaign, group, assigned instance, and completed dry-run are
consistent. Snapshot or copy drift invalidates the row. Reservation leases are
recovered by reading the persisted run, dispatch, and outbox: a confirmed run or
dispatch/outbox evidence becomes `DISPATCHED`; only a dry-run with no such
evidence can return to `READY`.

The persisted settings expose separate usable-candidate and prepared-message
low/target watermarks. A target at or above the prepared watermark is left
alone; a deficit is filled from the local queue first, then local mining, and
only then bounded discovery.

Each heartbeat also has process-local caps of 32 targets, 6 discovery page
requests, and 16 preparation attempts. Discovery has no automatic retry;
checkpoint lease expiry replays the page, and the BullMQ heartbeat remains a
single-attempt job. Prepared run identities include the candidate snapshot, so
the same candidate can be prepared again after snapshot N+1 reactivation.

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
leases, and observability. No operational database, Redis, container, provider,
or send effect is part of the unit tests.
