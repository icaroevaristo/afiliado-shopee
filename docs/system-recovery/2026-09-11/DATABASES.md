# SHOPEE SYSTEM RECOVERY — DATABASES

**Phase:** 0 — Forensic Recovery
**Policy:** no database listed here may be reset, dropped, migrated or discarded during Phase 0.

## Classification rule

A database's container/volume name is evidence of identity, not evidence of business role. `PROD`, `TEST`, `LEGACY` or `CANONICAL` require runtime/lineage evidence.

## Database inventory

### DB-LOCAL-001 — Main application Compose PostgreSQL

**Environment classification:** LOCAL
**Identity status:** `CONFIRMED`
**Canonical/source-of-truth role:** `CONFLICTING`

- Provider: PostgreSQL 16 Alpine.
- Host exposure: local host port `5432`.
- Database: `shopee_auto_affiliate_ai`.
- Schema: `public` by versioned application URL.
- Connection variable: `DATABASE_URL`.
- Compose project: `afiliado-shopee`.
- Compose service: `postgres`.
- Volume: `afiliado-shopee_postgres_data`.
- Expected runtimes: API, commercial worker, dispatch worker, Prisma CLIs when they inherit the default local environment.
- Historical data: `UNKNOWN`; current R8 target was not visible through the API instance bound to this dataset.
- Migration state: `UNKNOWN` until `_prisma_migrations` and schema fingerprint are read directly.
- Reset allowed: **NO**.
- Last direct evidence: host container/mount/port inventory, 2026-09-11.
- Confidence: HIGH for physical identity; LOW for business role.

Conflict:
- supervisor code labels this Compose volume as the expected operational/canonical volume by project identity;
- current R8 historical target/lifecycle evidence was found in DB-UNKNOWN-001 instead.

### DB-UNKNOWN-001 — R8 recovery application dataset

**Environment classification:** UNKNOWN / recovery
**Identity status:** `CONFIRMED`
**Canonical/source-of-truth role:** `CONFLICTING`

- Provider: PostgreSQL 16 Alpine based on access container evidence.
- Host access observed: `127.0.0.1:55488` while recovery access container was running.
- Database name: `UNKNOWN` in sanitized recovery report.
- Schema: application data observed in `public`; full datasource identity still requires direct read-only census.
- Connection variable for application use: `DATABASE_URL`.
- Volume: `afiliado-shopee-r8-recovery-20260910_postgres_data`.
- Known access containers:
  - `r8-04-recovery-postgres-access`;
  - `afiliado-shopee-r8-recovery-20260910-postgres`.
- Historical data: `CONFIRMED`.
- Confirmed anchors include:
  - authorized WhatsAppDestination ID `cmrzkc0210000ai0rezdw5hza`;
  - logical group fingerprint `grp_3ae3f9f1fbd4`;
  - historical R8 authorization/execution identity;
  - later safe-pre-external-failure executions;
  - historical commercial pipeline/dispatch/outbox/manual publication records.
- Migration state: `UNKNOWN`; modern R8 columns/data make near-current schema compatibility `PROBABLE`, not `CONFIRMED`.
- Reset allowed: **NO**.
- Last direct evidence: read-only `psql`/data dump evidence, 2026-09-11.
- Confidence: HIGH for data presence; UNKNOWN for lineage and canonical role.

Required lineage questions:
1. Was this volume copied from DB-LOCAL-001 or from another prior operational volume?
2. At what timestamp/commit/migration state did the fork occur?
3. Which writes occurred on each side after the fork?
4. Which one is authoritative for all non-R8 business history?

### DB-LOCAL-002 — Evolution internal PostgreSQL

**Environment classification:** LOCAL provider infrastructure
**Identity status:** `CONFIRMED`
**Canonical role:** provider-owned local store, separate from application DB

- Provider: PostgreSQL 16.4 Alpine in Evolution Compose.
- Host port: not published by versioned compose.
- Versioned default database: `evolution`.
- Versioned schema in connection URI: `evolution_api`.
- Runtime variables: `DATABASE_CONNECTION_URI`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` inside Evolution local config.
- Volume: `shopee-evolution-postgres-data` by versioned compose.
- Runtimes: Evolution API only.
- Historical data: instance/provider state; preserve.
- Migration state: Evolution startup previously reported 57 migrations found and no pending migration; this is runtime evidence for that startup only.
- Reset allowed: **NO**.
- Confidence: HIGH architecture; actual current DB identifiers should still be sanitized-confirmed in Phase 1.

### DB-UNKNOWN-002 — phase17-gap-audit-postgres-1

**Classification:** `UNKNOWN` (`PROBABLE` TEST/audit from name only)
- Current container state observed: exited.
- Database/schema/volume: `UNKNOWN`.
- Runtimes: `UNKNOWN`.
- Historical importance: `UNKNOWN`.
- Migration state: `UNKNOWN`.
- Reset allowed: **NO**.

### DB-UNKNOWN-003 — shopee-postgres-recovery

**Classification:** `UNKNOWN` (`PROBABLE` recovery/legacy from name only)
- Current container state observed: exited.
- Database/schema/volume: `UNKNOWN`.
- Runtimes: `UNKNOWN`.
- Historical importance: `UNKNOWN`.
- Migration state: `UNKNOWN`.
- Reset allowed: **NO**.

### DB-UNKNOWN-004 — phase12-clean-cycle-main-postgres-1

**Classification:** `UNKNOWN` (`PROBABLE` disposable/test from name only)
- Current container state observed: exited.
- Database/schema/volume: `UNKNOWN`.
- Historical importance: `UNKNOWN`.
- Migration state: `UNKNOWN`.
- Reset allowed: **NO** until disposable provenance is proven.

### DB-UNKNOWN-005 — commercial-copy-post-v10-worktree-postgres-1

**Classification:** `UNKNOWN` (`PROBABLE` worktree/test from name only)
- Current container state observed: created.
- Database/schema/volume: `UNKNOWN`.
- Historical importance: `UNKNOWN`.
- Migration state: `UNKNOWN`.
- Reset allowed: **NO** until disposable provenance is proven.

### DB-UNKNOWN-006 — infra-postgres-1

**Classification:** `UNKNOWN`
- Current container state observed: created.
- Database/schema/volume: `UNKNOWN`.
- Historical importance: `UNKNOWN`.
- Migration state: `UNKNOWN`.
- Reset allowed: **NO**.

## Cache/data-plane stores

### CACHE-LOCAL-001 — Application Redis/BullMQ

- Host port: `6379`.
- Connection variable: `REDIS_URL`.
- Main container: `afiliado-shopee-redis-1`.
- Observed volume: `0cb7a32c58cce24719cffaecd2e9f7cb069c6d49bd00b25a713c26c7c9df6fe5`.
- Recovery Redis access container was observed mounting the **same** volume.
- Role: BullMQ queues/schedulers/runtime state.
- Canonical alignment with DB-LOCAL-001 vs DB-UNKNOWN-001: `CONFLICTING/UNKNOWN` because the Redis volume is shared while application PostgreSQL history is forked.
- Reset allowed: **NO**.

### CACHE-LOCAL-002 — Evolution internal Redis

- Versioned provider: Redis 7.2.5 Alpine.
- Host port: not published by versioned compose.
- Versioned connection: internal `evolution-redis` and logical DB `/6`.
- Volume: `shopee-evolution-redis-data`.
- Reset allowed: **NO**.

## Excluded host databases

Containers clearly scoped to other projects (for example IES Agent/IES Mídia) are not included as Shopee databases without contrary evidence. Their presence on the same Docker host does not make them part of this system.

## Phase 1 read-only census required for every DB-* candidate

Record without secret values:
- `current_database()`;
- `current_schema()`;
- PostgreSQL server version;
- cluster/system identifier where safely obtainable;
- `_prisma_migrations` names/checksums/finished/rolled-back state;
- schema fingerprint;
- table row counts and min/max business timestamps;
- presence of canonical anchor records;
- mounted volume identity and creation metadata;
- latest known writer/runtime;
- backup/restoration evidence.

Until that census is complete, `DB-PROD-001` remains **UNASSIGNED**.
