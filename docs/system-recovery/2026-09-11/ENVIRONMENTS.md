# SHOPEE SYSTEM RECOVERY — ENVIRONMENTS

**Phase:** 0 — Forensic Recovery
**Repository baseline:** `9f23b09e35a9e917f3ca8205b34a90dc362b9b2d`

No environment in this document is authorized for R8 SEND during recovery.

## ENV-LOCAL-001 — Daily local operational profile

**Classification:** LOCAL
**Conclusion:** `CONFIRMED` design / `UNKNOWN` current exact installed values

Purpose:
- normal personal-use runtime on the owner's Windows host;
- API, dashboard, commercial worker and WhatsApp dispatch worker managed by the system supervisor.

Versioned daily profile establishes:
- `NODE_ENV=production`;
- API port `3433`;
- dashboard target `http://127.0.0.1:3433`;
- commercial automation intended enabled;
- commercial scheduler intended enabled;
- legacy scheduler disabled;
- automation mode `send`;
- Shopee provider intended `official`;
- WhatsApp provider intended `evolution`;
- Evolution safe mode enabled;
- group SEND capability intended enabled.

The profile does **not** define:
- `DATABASE_URL`;
- `REDIS_URL`;
- `LOCAL_API_AUTH_TOKEN`;
- Shopee credentials;
- OpenAI key;
- Evolution API key;
- webhook token.

Environment precedence is:

`.env` -> `runtime.env` -> process environment.

Consequences:
- two processes in the same checkout can use different DB/provider bindings if their process environment differs;
- `NODE_ENV=production` must not be used as evidence for a distinct production environment;
- exact current `runtime.env` content and supervisor state still require read-only host inventory.

## ENV-LOCAL-002 — R8 forensic/investigation runtime

**Classification:** LOCAL
**Conclusion:** `CONFIRMED`

Observed properties:
- clean worktree based on current main;
- manual API process observed on port `3433`;
- temporary API process was also exercised on `3434`;
- scheduler flags were manually overridden off during R8 diagnosis;
- manual API on `3433` was observed using the application DB exposed on host port `5432`;
- a temporary `3434` health check succeeded, but protected endpoint/database binding could not be fully confirmed because authentication/DB credentials were unavailable to the Codex sandbox.

This environment is diagnostic only and must not be promoted to canonical operation.

## ENV-TEST-001 — Safe certification profile

**Classification:** STAGING/TEST
**Conclusion:** `CONFIRMED`

The versioned `safe-certification` profile overrides external-effect settings and strips external credentials. It forces:
- automation mode `preview`;
- commercial automation disabled;
- commercial scheduler disabled;
- legacy scheduler disabled;
- Shopee provider `mock`;
- Shopee external API disabled;
- OpenAI commercial copy disabled;
- WhatsApp provider `mock`;
- WhatsApp group SEND disabled;
- Evolution safe mode enabled.

This is the strongest versioned TEST identity currently available, but individual disposable DB/Redis fixtures used by tests still need permanent DB/CACHE IDs when material to evidence.

## ENV-UNKNOWN-001 — Codex sandbox/workspace

**Classification:** UNKNOWN
**Conclusion:** `CONFIRMED` existence / role `UNKNOWN`

Observed differences from owner host:
- cannot execute Docker CLI because of sandbox ACL;
- can reach some localhost services;
- does not automatically inherit all host secrets/credentials;
- PostgreSQL `55488` TCP was reachable but authentication failed when the required credential was not available to the session.

It is an execution environment, not an authoritative operational environment.

## ENV-PROD-001 — Distinct production environment

**Classification:** PROD
**Conclusion:** `UNKNOWN`

No separate cloud/server production runtime has been identified from:
- current repository configuration;
- accessible Vercel inventory;
- current host evidence.

Do not equate ENV-LOCAL-001 with ENV-PROD-001 until the owner deliberately defines the production model.

## ENV-STAGING-001 — Persistent staging environment

**Classification:** STAGING/TEST
**Conclusion:** `UNKNOWN`

No persistent staging deployment or database has been identified. Existing test/audit containers are not automatically staging.

## Vercel

Accessible Vercel inventory contains IES Mídia and Sujeito Homem projects but no project linked to `icaroevaristo/afiliado-shopee`.

Conclusion:
- Afiliado Shopee on accessible Vercel account: `CONFIRMED` not present in current inventory;
- Vercel as project runtime: not canonical based on current evidence.

## Required Phase 1 resolution

Phase 1 must produce an explicit mapping:

`Environment ID -> code revision -> runtime profile -> API -> DB -> Redis -> Evolution -> external providers`

No environment may be called PROD or canonical until all of those bindings are proven and recorded without exposing secret values.
