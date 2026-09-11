# SHOPEE SYSTEM RECOVERY — CANONICAL BASELINE

**Document state:** `DRAFT_RECOVERY_CHECKPOINT`
**Phase:** 0 — Forensic Recovery
**Date:** 2026-09-11
**Repository baseline:** `main@9f23b09e35a9e917f3ca8205b34a90dc362b9b2d`

This file intentionally does **not** declare a canonical production database yet.

## 1. Recovery status

```text
RECOVERY STATUS

Repository .............. CONFIRMED
Runtime environments .... PARTIAL / CONFLICTING
Databases ............... 8 FOUND / 3 IDENTITIES CONFIRMED / 5 UNKNOWN
Production database ..... UNKNOWN / UNASSIGNED
Test database ........... MULTIPLE PROBABLE / NOT FULLY CLASSIFIED
Legacy databases ........ MULTIPLE UNKNOWN
Shopee API .............. CODE CONTRACT CONFIRMED / RUNTIME READINESS UNKNOWN
WhatsApp provider ....... EVOLUTION/INSTANCE CONFIRMED / DATA PATH CONFLICTING
Canonical API runtime ... UNKNOWN / CONFLICTING
Migrations .............. REPOSITORY CHAIN CONFIRMED / APP DB STATE UNKNOWN
Historical data ......... CONFIRMED IN DB-UNKNOWN-001
Test evidence ........... LOCAL/TEST EVIDENCE CONFIRMED / GITHUB CI ABSENT
Known unknowns .......... 19

SAFE TO DEFINE BASELINE .. NO
SAFE TO RESUME R8 ........ NO
```

## 2. What is confirmed enough to preserve

### Repository

`main@9f23b09e35a9e917f3ca8205b34a90dc362b9b2d` is the forensic code baseline.

This is a recovery reference, not a claim that runtime data is aligned with it.

### DB-LOCAL-001

Physical identity is known and current code considers its Compose volume the expected operational volume. It must be preserved until lineage is established.

### DB-UNKNOWN-001

Contains recent R8 target/lifecycle and historical commercial data. It must be preserved. Its name “recovery” does not make it disposable or non-production.

### DB-LOCAL-002 / Evolution

Provider infrastructure is separate from the application database and must be preserved independently.

### CACHE-LOCAL-001

Contains application Redis/BullMQ state and has been shared by main/recovery access paths. Preserve until DB/queue alignment is reconciled.

## 3. Baseline assignments deliberately withheld

The following aliases are **UNASSIGNED**:

```text
ENV-PROD-001 -> UNASSIGNED
DB-PROD-001 -> UNASSIGNED
CACHE-PROD-001 -> UNASSIGNED
API-PROD-001 -> UNASSIGNED
WEBHOOK-PROD-001 -> UNASSIGNED
```

`SHOPEE-PROD-001` and `WA-PROD-001` identify real external-effect providers/boundaries; they do not imply the application itself has a cloud PROD environment.

## 4. Conflicts that block baseline selection

1. **Database identity vs business history**
   - supervisor expects `afiliado-shopee_postgres_data`;
   - recent R8 business/lifecycle history is in the recovery volume.

2. **Webhook vs lifecycle DB**
   - Evolution callback targets API 3433;
   - API 3433 was bound to DB-LOCAL-001;
   - recent R8 lifecycle anchors are in DB-UNKNOWN-001.

3. **Redis shared while PostgreSQL forked**
   - one application Redis volume was observed across main/recovery access paths;
   - this can leave queue IDs pointing at only one side of the DB fork.

4. **Runtime environment precedence**
   - process env can override `.env` and `runtime.env`;
   - current process-level bindings are not yet inventoried.

5. **Migration state unknown per application DB**
   - repository migrations are known;
   - applied histories/checksums/drift are not.

6. **Backup readiness unknown**
   - no candidate can be promoted to migration target without restorable backup proof.

## 5. Exact Phase 1 proposal — CANONICAL BASELINE

Phase 1 remains **NO SEND** and begins only after owner accepts this recovery checkpoint.

### CB-01 — Operational freeze and evidence boundary

Keep:
- R8 suspended;
- R9 suspended;
- commercial scheduler/send disabled for recovery processes;
- no database migration/adoption/reset;
- no provider configuration changes.

Record a Phase 1 run ID and evidence timestamp before inspection.

### CB-02 — Host topology census, read-only

Inventory all Shopee-scoped:
- containers;
- volumes;
- image IDs/digests;
- labels;
- mounts;
- creation timestamps;
- published ports;
- running/stopped/created status;
- process command identity;
- supervisor state/lock ownership.

Do not start a stopped DB merely to classify it unless a separately approved safe inspection procedure is defined.

### CB-03 — Environment/config census, secret-safe

For `.env`, `runtime.env`, Evolution `.env.local` and relevant process environments record only:
- variable name present/absent;
- source layer;
- sanitized host/port/db/schema when non-secret;
- config-file SHA-256 fingerprint;
- process/worktree binding.

Never record secret values.

### CB-04 — Application database census, read-only

For each accessible DB candidate record:
- DB permanent ID;
- PostgreSQL version;
- database/schema names;
- cluster/system identifier if safely available;
- `_prisma_migrations` name/checksum/status;
- schema fingerprint;
- table counts;
- min/max timestamps for core historical tables;
- anchor IDs from R8 and earlier operation;
- read-only comparison against current Prisma schema.

No `migrate deploy`, `migrate dev`, `migrate resolve`, baseline adoption, CREATE/DROP or UPDATE.

### CB-05 — Lineage matrix

Compare DB-LOCAL-001, DB-UNKNOWN-001 and every other candidate using:
- cluster identity;
- volume metadata;
- migration history;
- schema fingerprint;
- row counts;
- oldest/latest timestamps;
- shared and divergent business anchors.

Output one of:
- ancestor/snapshot;
- descendant;
- divergent fork;
- unrelated test DB;
- unresolved.

No classification by container name alone.

### CB-06 — Redis/BullMQ census

Without mutating queue state, record:
- Redis identity/config;
- BullMQ queue names;
- counts/state where safe to read;
- job IDs that correlate to DB lifecycle anchors;
- scheduler metadata;
- whether Redis state aligns with the selected DB history.

### CB-07 — External integration binding

Record sanitized effective binding for:
- Shopee official endpoint + credential variable presence;
- OpenAI provider/model + key variable presence;
- Evolution URL/version/instance;
- webhook URL identity and callback API process;
- callback API database binding.

No external SEND and no webhook `set` during baseline inspection.

### CB-08 — Backup gate

Before any future DB write/migration:
- identify backup method for selected candidate;
- create/validate only in the later authorized write phase;
- establish restoration procedure and evidence requirements.

Phase 1 may design this gate but should not mutate databases unless explicitly authorized after the read-only census.

### CB-09 — Canonical role assignment

Only after CB-02..CB-07 evidence is complete, propose exactly one mapping:

```text
ENV-PROD-001 or explicitly LOCAL-PRODUCTION model
API-PROD-001
DB-PROD-001
CACHE-PROD-001
EVOLUTION-LOCAL-001
WA-PROD-001
WA-WEBHOOK-001
SHOPEE-PROD-001
AI-* if enabled
CODE_BASELINE_SHA
```

Owner approves this mapping before it becomes authoritative.

### CB-10 — Quarantine non-canonical assets

Classify every other DB/volume as TEST, LEGACY, RECOVERY or UNKNOWN.

“Quarantine” initially means **do not use**, not delete.
No volume/container/data deletion is part of baseline definition.

### CB-11 — Documentation convergence

After canonical roles are proven:
- update stale runtime/readiness docs;
- separate historical `PROJECT_DONE` from current operational readiness;
- make the canonical environment/database mapping explicit;
- keep IDs stable across future phases.

## 6. Phase 2 proposal — SDD baseline/migration (not started)

Only after Phase 1 owner approval:
1. define SDD specs for environment identity, DB identity, migration policy, webhook/database consistency, secrets ownership, test-environment isolation and release evidence;
2. define acceptance tests before implementation/migration;
3. map existing code to each spec and identify true gaps;
4. prepare migration/adoption plan from proven canonical DB state;
5. require backup/restoration proof and owner authorization before DDL;
6. execute changes only after SDD review.

No code fix should be pulled forward merely because Phase 0 found a conflict.

## 7. R8 resumption gate

R8 may only be reconsidered after:

```text
FORENSIC_RECOVERY=PASS
CANONICAL_BASELINE=APPROVED
SDD_BASELINE=APPROVED
CANONICAL_DB_IDENTIFIED=true
CANONICAL_REDIS_IDENTIFIED=true
CANONICAL_API_RUNTIME_IDENTIFIED=true
WEBHOOK_DB_CONSISTENT=true
MIGRATION_STATE_KNOWN=true
BACKUP_GATE_DEFINED=true
MATERIAL_UNKNOWNS=0 for R8 path
```

Then, and only then, reassess remaining R8 blockers from fresh evidence.

`R8_RESUME_AUTHORIZATION=NOT_GRANTED`
