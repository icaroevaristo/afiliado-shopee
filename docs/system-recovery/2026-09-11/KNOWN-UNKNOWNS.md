# SHOPEE SYSTEM RECOVERY — KNOWN UNKNOWNS

**Phase:** 0 — Forensic Recovery
**Rule:** every material unknown blocks silent promotion to canonical baseline.

## KU-001 — Application database source of truth

**Status:** `CONFLICTING`

DB-LOCAL-001 is the volume expected by current supervisor identity logic, while DB-UNKNOWN-001 contains the R8 target and historical lifecycle state required by recent operation.

Required proof: lineage comparison and business-history coverage.

## KU-002 — Prisma migration history per application database

**Status:** `UNKNOWN`

Exact `_prisma_migrations` rows/checksums/drift are not yet recorded for DB-LOCAL-001, DB-UNKNOWN-001 or the other candidate databases.

## KU-003 — Current `.env` / `runtime.env` / process bindings

**Status:** `UNKNOWN`

Need sanitized key-presence/source/fingerprint inventory. Values must remain secret.

## KU-004 — Local API authentication secret ownership

**Status:** `UNKNOWN`

The running API required local Bearer authentication, but a separate owner shell could not recover `LOCAL_API_AUTH_TOKEN` from the copied worktree `.env` or shell environment. Exact runtime source remains unknown.

## KU-005 — Shopee official runtime readiness

**Status:** `UNKNOWN`

Code endpoint is known; actual credential presence, authorization health, current quota and canonical DB binding are not proven.

## KU-006 — OpenAI runtime binding

**Status:** `UNKNOWN`

Daily profile enables AI copy, but active key/model/current paid-use state is not recovered.

## KU-007 — Delivery webhook canonical consumer

**Status:** `CONFLICTING`

Evolution callback points to API port 3433, which was observed using DB-LOCAL-001, while recent R8 lifecycle state exists in DB-UNKNOWN-001.

## KU-008 — Historical/test PostgreSQL containers

**Status:** `UNKNOWN`

Roles, volumes, DB names, schemas, migration history and data importance are not proven for DB-UNKNOWN-002 through DB-UNKNOWN-006.

## KU-009 — DB-UNKNOWN-001 creation lineage

**Status:** `UNKNOWN`

Need to establish whether recovery volume is:
- copy/snapshot of DB-LOCAL-001;
- copy of another older operational volume;
- independent fork;
- or a reconstructed dataset.

## KU-010 — Separate production/staging host

**Status:** `UNKNOWN`

No remote production/staging deployment is currently evidenced. Accessible Vercel inventory does not contain this project.

## KU-011 — Redis/BullMQ alignment with forked PostgreSQL state

**Status:** `CONFLICTING/UNKNOWN`

The application Redis volume is shared by the main and recovery access paths, while PostgreSQL has at least two distinct volumes. Queue/job references may correspond to only one DB history.

## KU-012 — Supervisor state ownership

**Status:** `UNKNOWN`

Need to inspect `.runtime/local-system` state/locks/log identity and determine whether current or last daily processes were supervisor-owned or manually started.

## KU-013 — Restorable backup status

**Status:** `UNKNOWN`

No candidate production DB can be migrated until a restorable backup and restoration evidence are identified.

## KU-014 — Running API 3433 provenance

**Status:** `PROBABLE` manual investigation runtime / not canonical

Process was observed as Node on 3433 during manual R8 work. Need exact checkout/command/start ownership if it is still running when Phase 1 begins.

## KU-015 — Stale Git branches/PRs

**Status:** `CONFIRMED` existence; disposition `UNKNOWN`

An old open PR #90 and multiple historical R8/recovery branches remain. They are not canonical merely because they exist. Close/archive decisions should occur only after baseline history is captured.

## KU-016 — Historical external delivery evidence

**Status:** `UNKNOWN`

Database rows marked `SENT` exist, but exact provider/webhook evidence for historical deliveries has not been correlated in this recovery.

## KU-017 — Current state of recovery access runtime

**Status:** `UNKNOWN` after Phase 0 freeze

The recovery access PostgreSQL container had been started before the recovery directive. Phase 0 deliberately does not stop/start/mutate it further. Phase 1 must re-inventory state rather than assume it is still running.

## KU-018 — Canonical code/documentation relationship

**Status:** `CONFLICTING`

Current docs include:
- macro `PROJECT_DONE=true` historical certification;
- `DAILY_USE_READY=false` current activation predicate;
- stale `CURRENT_STATE_AND_GAPS` references to older main/R8 candidate state.

A canonical baseline must explicitly separate historical completion claims from current operational readiness.

## KU-019 — GitHub CI/CD gate

**Status:** `CONFIRMED` no current GitHub workflow/status evidence

Need a deliberate SDD/release decision whether local gates remain authoritative or repository CI should be introduced. Do not add CI during Phase 0.

## Material blockers

The following unknowns alone are sufficient to make baseline selection unsafe:

- KU-001 application DB source of truth;
- KU-002 migration state;
- KU-003 runtime datasource bindings;
- KU-007 webhook consumer DB;
- KU-011 Redis/DB alignment;
- KU-013 restorable backup.

Therefore:

`SAFE_TO_DEFINE_BASELINE=NO`

`SAFE_TO_RESUME_R8=NO`
