# SHOPEE SYSTEM RECOVERY — RUNTIME PATHS

**Phase:** 0 — Forensic Recovery

## 1. Environment loading paths

### Supervisor-managed runtime

`loadLocalSystemEnvironment()` resolves:

```text
root .env
  -> root runtime.env
     -> process.env
```

Later layers override earlier ones.

This is the most important runtime fact for database recovery: source files alone do not prove the active `DATABASE_URL` or `REDIS_URL`.

### API direct development/runtime script

`apps/api/src/server.ts` reads configuration from `process.env` through the config package.

The normal API `dev` script executes `tsx ... src/server.ts` and does not itself force an env file.

One notable exception is `commercial:message:preview`, which explicitly runs with `--env-file=../../.env`.

Conclusion: command invocation path can change the effective datasource.

### Worker CLI/runtime

Worker scripts execute through `tsx` and inherit process environment. Important entrypoints include:
- `commercial-automation-worker.ts`;
- `whatsapp-dispatch-runtime.ts`;
- one-shot/test/recovery CLIs.

They must be tied to the same canonical `DATABASE_URL` + `REDIS_URL` pair as the API before daily operation is considered safe.

## 2. Supervisor service topology

Versioned service specs start:

```text
API
  apps/api/src/server.ts

Dashboard
  next start apps/dashboard

Commercial worker
  apps/worker/src/commercial-automation-worker.ts

WhatsApp dispatch worker
  apps/worker/src/whatsapp-dispatch-runtime.ts
```

All share the supervisor runtime environment except dashboard additionally forces `NODE_ENV=production`.

## 3. Daily local profile

Versioned profile:

```text
PORT=3433
DASHBOARD_API_URL=http://127.0.0.1:3433
COMMERCIAL_AUTOMATION_ENABLED=true
COMMERCIAL_SCHEDULER_ENABLED=true
SCHEDULER_ENABLED=false
COMMERCIAL_AUTOMATION_MODE=send
SHOPEE_AFFILIATE_PROVIDER=official
SHOPEE_AFFILIATE_API_ENABLED=true
COMMERCIAL_AI_COPY_ENABLED=true
WHATSAPP_PROVIDER=evolution
EVOLUTION_SAFE_MODE=true
WHATSAPP_GROUP_SEND_ENABLED=true
```

This profile contains operational switches, not DB or provider secret bindings.

## 4. Database/cache routing

### Intended main local path

```text
ENV-LOCAL-001
 -> DATABASE_URL
 -> DB-LOCAL-001 (default localhost:5432)

ENV-LOCAL-001
 -> REDIS_URL
 -> CACHE-LOCAL-001 (default localhost:6379)
```

Status: physical default `CONFIRMED`; actual canonical business role `CONFLICTING`.

### R8 recovery path

```text
ENV-LOCAL-002 / recovery access
 -> DB-UNKNOWN-001
 -> observed access port 55488
 -> recovery volume with R8 history
```

Status: data presence `CONFIRMED`; official runtime binding `UNKNOWN`.

### Evolution provider path

```text
EVOLUTION-LOCAL-001 (:8080)
 -> DB-LOCAL-002 (internal PostgreSQL)
 -> CACHE-LOCAL-002 (internal Redis)
 -> WA-PROD-001
 -> WA-WEBHOOK-001
 -> host application API callback
```

The application callback must ultimately resolve back to the **same canonical application DB** used by dispatch/lifecycle processing.

## 5. Dashboard path

The dashboard proxy:
- accepts only loopback/local API targets;
- obtains API URL from `DASHBOARD_API_URL`;
- obtains server-side Bearer secret from `LOCAL_API_AUTH_TOKEN`;
- checks `/health` before proxying;
- does not expose the API token to browser-side `NEXT_PUBLIC_*` variables.

Operational implication: `/health` success alone proves only API process compatibility, not that protected routes use the intended database.

## 6. Migration path

Database migration commands resolve `DATABASE_URL` from:

```text
root .env
 -> process environment override
```

This differs from the supervisor because the migration loader does not merge `runtime.env` itself.

Operational implication: `system runtime DB` and `manual Prisma CLI DB` can differ unless the command environment is explicitly bound and recorded.

## 7. Observed R8 path conflict

On 2026-09-11:

```text
API :3433
 -> DATABASE_URL using localhost:5432
 -> DB-LOCAL-001
 -> /whatsapp/groups returned no authorized R8 group

DB-UNKNOWN-001 via :55488
 -> contained the authorized target and R8 historical lifecycle data

Evolution webhook
 -> callback :3433
 -> therefore callback application writes/read path followed DB-LOCAL-001
```

Classification: `CONFLICTING`.

## 8. Runtime identity still unknown

Phase 1 must determine:
- current installed `runtime.env` key set/fingerprint;
- supervisor state/ownership files;
- exact command line identity and worktree of each running Shopee process;
- key presence/source for DB, Redis, local API auth and provider configuration;
- whether the owner daily shortcut currently launches the same checkout as the forensic baseline;
- whether any old manually started process remains outside supervisor ownership.

Until then:

`CANONICAL_API_RUNTIME=UNKNOWN`
