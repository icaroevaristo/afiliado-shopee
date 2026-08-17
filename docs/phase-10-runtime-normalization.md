# Phase 10 - Runtime normalization without SEND

## Scope

This phase certifies the commercial runtime topology that will support a separately authorized Phase 11 pilot. It does not authorize SEND and does not validate operational infrastructure connectivity. All runtime behavior was exercised with unit/integration fakes, fake timers, mock providers, and the Phase 9 no-SEND E2E contract.

Runtime diagram:

`system-supervisor -> runtime environment -> commercial scheduler -> commercial-automation queue -> commercial worker -> execution lease/CAS -> commercial lifecycle -> whatsapp-dispatch queue -> isolated dispatch worker -> provider boundary (mocked in certification)`

The legacy `product-pipeline` queue/scheduler remains a separate, documented runtime. It is not part of the commercial automation topology used for Phase 11 and its scheduler must remain disabled in commercial send mode.

## Effective environment and runtime.env

`loadLocalSystemEnvironment()` now applies deterministic precedence:

`.env < runtime.env < process.env`

`runtime.env` is optional. No operational `runtime.env` file was created or overwritten by this phase. The loader uses the existing dotenv parser, and tests prove both precedence and fail-closed handling of an invalid effective `COMMERCIAL_AUTOMATION_MODE`.

The typed application configuration continues to be validated by `loadConfig()` / `envSchema`. Commercial defaults remain conservative: automation disabled, commercial scheduler disabled, mode `preview`, legacy scheduler disabled, Evolution safe mode enabled, and WhatsApp group sending disabled.

## Runtime processes and ownership

The normalized supervisor topology contains:

- `api`: API/read-only status and explicit control surfaces;
- `dashboard`: local dashboard;
- `commercial-worker`: the normal consumer of `commercial-automation` and the owner that registers/removes the commercial BullMQ Job Scheduler;
- `whatsapp-dispatch-worker`: isolated consumer of `whatsapp-dispatch`, required only in `send` mode.

The supervisor does not start `apps/worker/src/index.ts`. That file is the legacy worker for `product-pipeline` and legacy WhatsApp behavior and is outside the normalized commercial runtime.

Supervisor process ownership is persisted in `.runtime/local-system/state.json` with PID, process start time, service marker and sanitized log path. Re-starting the supervisor reuses healthy registered children instead of spawning duplicates. PID reuse or marker mismatch is not killed silently.

Supervisor start/stop serialization uses `.runtime/local-system/lock`. The lock includes process identity and an owner token. Active locks block concurrent operations; stale locks are recovered only after process identity is rechecked; invalid or uncertain locks fail closed and are preserved for investigation.

## Redis topology

The queue package creates an IORedis connection with `maxRetriesPerRequest: null`. Stable BullMQ queue names are `commercial-automation`, `whatsapp-dispatch`, and legacy `product-pipeline`.

The application does not define a custom BullMQ prefix or custom Redis lock namespace. Environment isolation therefore comes from the configured Redis URL/deployment, not from an invented project prefix. Phase 10 did not connect to operational Redis and did not inspect, delete or flush Redis keys.

There is no application-defined Redis scheduler lease. Scheduler uniqueness is the BullMQ Job Scheduler identity; commercial execution ownership uses the persisted execution lease/CAS contract; supervisor operation ownership uses the local filesystem lock.

## BullMQ topology

Commercial scheduler contract:

- queue: `commercial-automation`;
- job: `commercial-automation-tick`;
- scheduler ID: `scheduled-commercial-automation`;
- attempts: `1`;
- removeOnComplete: `false`;
- removeOnFail: `false`;
- no application retry/backoff.

The scheduler uses `upsertJobScheduler()` with the stable ID. Concurrent owners can both reach the upsert after reading the old state, but both target the same identity. The concurrency test proves convergence to one scheduler record and one natural logical tick; the contract is logical uniqueness, not a guarantee of one network upsert call.

Controlled WhatsApp enqueue retains the existing deterministic dispatch job ID and one-attempt contract. `PUBLISHED`, `PROCESSING`, `SENT` and `AMBIGUOUS` semantics remain those certified in Phases 8 and 9.

## Producers and consumers

Commercial path:

- scheduler producer: BullMQ Job Scheduler registered by `commercial-worker`;
- `commercial-automation` consumer: `commercial-worker`, concurrency 1 per process;
- controlled dispatch producers: existing confirmation/outbox publisher paths;
- `whatsapp-dispatch` consumer: isolated `whatsapp-dispatch-worker` in send mode.

The API retains the documented legacy `/pipeline/run` producer for `product-pipeline`. That queue belongs to the legacy runtime and is not used by the commercial scheduler. Phase 11 must not activate the legacy scheduler or use that path as a substitute for the certified commercial runtime.

## nextRunAt

Commercial scheduler `nextRunAt` is exactly the next BullMQ cron firing (`JobSchedulerJson.next`) converted to ISO. Tests prove deterministic projection and `null` when the scheduler is disabled.

Business eligibility is intentionally separate from scheduler `nextRunAt`: allowed window, daily limits, minimum interval, campaign `nextEligibleAt`, cooldown/backoff, paused/disabled automation and active/stale execution state are policy/execution gates. Their timing remains represented by policy/campaign state and is re-evaluated when the scheduler tick runs.

## Natural scheduler tick

`apps/worker/test/commercial-runtime-natural-tick.test.ts` uses fake timers and a BullMQ scheduler queue fake. It does not invoke `executeTick()` directly. The harness registers the real `BullMqCommercialAutomationScheduler`, obtains a deterministic `nextRunAt`, advances to one millisecond before it, proves no execution, advances the final millisecond and delivers the scheduled BullMQ-like job through the real `processCommercialAutomationJob()` processor.

The processor then invokes the orchestrator boundary exactly once with the stable scheduler ID, deterministic repeat job identity, `preview` mode and mock provider. Two concurrent scheduler owners plus a restart converge on one scheduler identity and one natural logical tick. Removing the scheduler cancels the wake-up.

The actual orchestrator test matrix proves that delivered ticks remain fail-closed when automation is paused, an execution is active/stale, a target is not eligible, or provider/mode contracts are invalid. In preview the result always has `messageSent: false`, and no confirmation/WhatsApp enqueue occurs.

## Execution uniqueness and leases

Commercial execution uniqueness is not based only on process concurrency. The persisted execution contract uses stable BullMQ job identity, one active commercial execution key, owner ID, heartbeat, lease expiry and CAS checks on heartbeat/finish. Re-delivery of the same completed BullMQ job returns the existing result. A duplicate while STARTED is active is blocked; stale state requires recovery. Losing ownership prevents the next stage.

Downstream uniqueness boundaries remain candidate reservation, campaign attempt lease, dispatch/outbox idempotency, deterministic publisher job ID and Sender claim/CAS.

## Orphans, stale state and recovery

Uncertain state is never deleted as if safe:

- stale supervisor operation lock is identity-checked before recovery;
- stale process registration is restarted without killing an unrelated or reused PID;
- stale commercial execution is classified by heartbeat/lease and routed through execution recovery;
- campaign attempt lease uses the existing recovery contract;
- dispatch `PROCESSING` is not blindly resent;
- outbox `AMBIGUOUS` is not treated as retryable success;
- existing BullMQ jobs are reconciled through deterministic identity;
- possible external effect followed by persistence failure remains in the ambiguous/reconciliation path.

The fake preview-stability matrix also injects commercial-worker, API, Redis and PostgreSQL interruptions and asserts no forbidden dispatch/outbox/WhatsApp job deltas, no duplicate BullMQ job IDs and no unclassified ambiguous state.

## Startup, restart and shutdown

Commercial worker bootstrap first reconciles the scheduler contract and only then creates the worker; it does not emit a bootstrap tick. Worker concurrency is 1. If the scheduler is disabled, bootstrap removes only `scheduled-commercial-automation`, preventing an old commercial cron from remaining registered.

Worker close paths use guarded close promises and close workers, queues and Redis connections. Supervisor tests prove idempotent start, reuse of healthy managed children, rollback of children started by a failed start, identity-safe stop and stale-process recovery.

The real supervisor `start()` also manages Docker/Evolution and executes database deployment. Those actions are prohibited in Phase 10, so this certification exercised the supervisor only through fake dependencies and did not run an operational supervisor, worker, scheduler, PostgreSQL or Redis instance.

## Supervisor and observability

Supervisor status exposes sanitized process state, legacy/commercial scheduler state, commercial `nextRunAt`, automation paused/allowed state and operation-lock classification without exposing the owner token. Scheduler/status routes are read-only; tests prove there is no API endpoint that directly triggers the commercial tick or enables the scheduler. Failures do not expose Redis URLs or internal details.

## No-SEND boundary

Phase 10 exercises preview/mock boundaries only. It does not instantiate or call a real Evolution send path, does not call Shopee/OpenAI providers and does not create an operational Redis/PostgreSQL/BullMQ connection. No operational worker or scheduler was started.

The downstream Phase 9 E2E remains the publication boundary contract: provider calls are mocked, IMAGE/TEXT and Sender lifecycle are preserved, and no real external message ID is produced.

## Certification matrix

The Phase 10 matrix covers: runtime environment precedence/invalid mode; commercial scheduler enabled/disabled; stable scheduler identity; deterministic `nextRunAt`; natural timer wake-up; concurrent scheduler registration; restart convergence; commercial worker job validation; worker concurrency contract; supervisor process reuse/rollback/identity checks; stale operation locks; duplicate BullMQ identities; policy blocks and active/stale executions; campaign-attempt leases; outbox publisher idempotency; Sender CAS; ambiguous recovery; fake Redis/PostgreSQL/process interruptions; and preview invariants that forbid dispatch, outbox or WhatsApp-job creation.

Policy tests separately cover commercial time windows, daily limits, minimum interval, campaign eligibility/cooldown/backoff and `nextEligibleAt`. These gates are re-evaluated on the tick and are not rewritten into the BullMQ cron `nextRunAt`.

## Requirements before Phase 11

Phase 10 certifies code-level runtime readiness only. A separately authorized Phase 11 must verify the intended operational configuration and infrastructure immediately before the single real pilot, including the selected runtime environment, actual Redis/PostgreSQL health, actual scheduler state, single authorized destination and explicit SEND authorization.

`READY_FOR_PHASE_11` means the runtime contract is ready for that separately authorized check. It does not authorize SEND.
