# SHOPEE SYSTEM RECOVERY — MIGRATIONS STATE

**Phase:** 0 — Forensic Recovery
**Repository baseline:** `main@9f23b09e35a9e917f3ca8205b34a90dc362b9b2d`

## 1. Repository migration model

The application uses Prisma migrations under:

`packages/database/prisma/migrations`

The chain begins with:

`0_legacy_baseline`

and the current repository contains migrations through:

`20260910110000_ambiguity_no_retry_closeout`

The Prisma datasource is PostgreSQL and resolves through `DATABASE_URL`.

## 2. Migration commands and Phase 0 safety

| Command/path | Effect | Phase 0 status |
| --- | --- | --- |
| `db:baseline:status` | inspection + schema diff | potentially READ-ONLY when explicitly bound to an identified DB | allowed only as controlled Phase 1 census, not run automatically in Phase 0 |
| `db:baseline:adopt -- --confirm-existing-database` | records baseline as applied | WRITE | **PROHIBITED** |
| `db:deploy` | `prisma migrate deploy` | DDL/WRITE | **PROHIBITED** |
| `db:migrate` | `prisma migrate dev` | DDL/WRITE | **PROHIBITED** |
| `db:migrations:verify-clean` | creates a temporary database, applies migrations, drops temporary DB | CREATE/DDL/DELETE | **PROHIBITED** in Phase 0 |
| `system:maintenance:migrate` | controlled operational migration workflow | infrastructure + DDL | **PROHIBITED** in Phase 0 |

Important: a command called “verify” is not necessarily read-only. `db:migrations:verify-clean` creates and later drops a database.

## 3. Per-database state

### DB-LOCAL-001

**Migration state:** `UNKNOWN`

Known:
- application API could start against the database;
- current schema supports enough of the application to answer health/protected routes;
- R8 target was not present through the API bound to this dataset.

Not yet proven:
- exact `_prisma_migrations` rows;
- failed/rolled-back migration rows;
- checksums against repository migration files;
- current schema diff/fingerprint;
- whether baseline `0_legacy_baseline` is registered;
- whether all latest migrations are applied.

Conclusion: schema compatibility is at most `PROBABLE`, not `CONFIRMED`.

### DB-UNKNOWN-001

**Migration state:** `UNKNOWN`

Known:
- read-only dump shows modern R8-era columns and lifecycle data;
- target, assignments, prepared messages, automation executions and other modern entities are present.

This supports `PROBABLE` compatibility with a recent application schema, but does not establish:
- exact migration history;
- checksums;
- absence of drift;
- whether the latest repository migration is registered.

### DB-LOCAL-002 — Evolution PostgreSQL

**Migration system:** Evolution's own migration mechanism, independent from application Prisma.

Runtime evidence from Evolution startup reported:
- 57 migrations found;
- no pending migration;
- migration startup completed.

Classification: `CONFIRMED` for that observed Evolution startup, not a substitute for application Prisma state.

### DB-UNKNOWN-002 .. DB-UNKNOWN-006

**Migration state:** `UNKNOWN`

No assumptions from container names.

## 4. Baseline mechanism in code

The repository has a legacy-baseline adoption mechanism that:
1. inspects application tables and `_prisma_migrations`;
2. verifies baseline objects;
3. performs a Prisma schema diff;
4. determines whether an existing DB is eligible for adoption;
5. only on explicit `adopt` performs `prisma migrate resolve --applied 0_legacy_baseline`;
6. verifies data counts and schema fingerprint around that write.

This is useful for recovery, but Phase 0 does not authorize step 5.

## 5. Phase 1 census contract

For every application DB candidate, Phase 1 should run a strictly read-only evidence collection before any baseline/adoption decision:

```text
DATABASE_ID
current_database
current_schema
server_version
cluster/system identity where safely available
_prisma_migrations rows:
  migration_name
  checksum
  finished_at presence
  rolled_back_at presence
repository migration set comparison
schema fingerprint
application table list
row counts
minimum/maximum business timestamps
anchor records present/absent
```

No migration should be executed merely to make two databases look alike.

## 6. Current conclusion

```text
REPOSITORY_MIGRATION_CHAIN ........ CONFIRMED
DB-LOCAL-001 MIGRATIONS ........... UNKNOWN
DB-UNKNOWN-001 MIGRATIONS ......... UNKNOWN
DB-LOCAL-002 EVOLUTION MIGRATIONS . CONFIRMED_FOR_OBSERVED_STARTUP
OTHER APP DB MIGRATIONS ........... UNKNOWN
SAFE_TO_MIGRATE ................... NO
SAFE_TO_ADOPT_BASELINE ............ NO
```
