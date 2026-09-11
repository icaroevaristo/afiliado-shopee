# SHOPEE SYSTEM RECOVERY — SYSTEM MAP

**Fase:** 0 — Forensic Recovery (READ-ONLY)
**Data do snapshot:** 2026-09-11
**Repository baseline:** `main@9f23b09e35a9e917f3ca8205b34a90dc362b9b2d`
**Tree:** `5e3f405b334dda1831ae83dbbb3d9787d7a575ff`
**Status:** `RECOVERY_IN_PROGRESS`

Este documento registra o que pode ser sustentado pelo repositório e pelas evidências operacionais disponíveis. Ele não escolhe ainda um banco canônico e não autoriza R8, migration, SEND, deploy, alteração de secrets ou mudança de infraestrutura.

## 1. Regra de classificação

Cada conclusão usa somente um destes estados:

- `CONFIRMED`: sustentado por evidência direta atual.
- `PROBABLE`: hipótese forte, ainda sem prova suficiente.
- `UNKNOWN`: não determinado com segurança.
- `CONFLICTING`: duas ou mais evidências materiais apontam para estados incompatíveis.

`PROBABLE` nunca deve ser promovido a `CONFIRMED` por conveniência.

## 2. Topologia observada

```text
Windows host local
|
+-- ENV-LOCAL-001  Daily local operational profile
|   +-- API runtime (design: 127.0.0.1:3433)
|   +-- Dashboard (127.0.0.1:3000)
|   +-- commercial-worker
|   +-- whatsapp-dispatch-worker
|   +-- DB binding inherited from .env/process environment
|   +-- CACHE-LOCAL-001 via REDIS_URL
|
+-- DB-LOCAL-001
|   +-- PostgreSQL application compose project: afiliado-shopee
|   +-- host port: 5432
|   +-- database: shopee_auto_affiliate_ai
|   +-- schema: public
|   +-- volume: afiliado-shopee_postgres_data
|
+-- DB-UNKNOWN-001
|   +-- R8 recovery dataset access observed on 127.0.0.1:55488
|   +-- volume: afiliado-shopee-r8-recovery-20260910_postgres_data
|   +-- contains R8 target and historical commercial lifecycle data
|   +-- lineage relative to DB-LOCAL-001: UNKNOWN
|
+-- EVOLUTION-LOCAL-001
|   +-- Evolution API v2.3.7 at 127.0.0.1:8080
|   +-- WA-PROD-001 instance: afiliado-shopee-local
|   +-- DB-LOCAL-002 internal Evolution PostgreSQL
|   +-- CACHE-LOCAL-002 internal Evolution Redis
|   +-- WA-WEBHOOK-001 -> host callback path /whatsapp/events/messages.update
|
+-- CACHE-LOCAL-001
    +-- application Redis at host port 6379
    +-- BullMQ queues for application runtime
```

## 3. Environment IDs

| ID | Purpose | Classification | Status |
| --- | --- | --- | --- |
| `ENV-LOCAL-001` | Official daily local runtime profile on Windows | LOCAL | `CONFIRMED` design; current installed profile values not fully re-audited |
| `ENV-LOCAL-002` | Manual R8 investigation runtimes on ports 3433/3434 | LOCAL | `CONFIRMED` |
| `ENV-TEST-001` | Safe-certification profile with external providers disabled/mocked | STAGING/TEST | `CONFIRMED` |
| `ENV-UNKNOWN-001` | Codex sandbox/workspace runtime with different host permissions/credential visibility | UNKNOWN | `CONFIRMED` existence; role `UNKNOWN` |
| `ENV-PROD-001` | Distinct production environment | PROD | `UNKNOWN` — no separate production host has been identified |
| `ENV-STAGING-001` | Distinct staging environment | STAGING/TEST | `UNKNOWN` — no permanent staging environment has been identified |

Important: `NODE_ENV=production` in the daily profile means production build/runtime mode. It does **not** prove that `ENV-LOCAL-001` is a distinct production environment.

## 4. Database IDs

| ID | Identity | Status | Canonical role |
| --- | --- | --- | --- |
| `DB-LOCAL-001` | Application PostgreSQL at host `5432`, volume `afiliado-shopee_postgres_data` | `CONFIRMED` identity | `CONFLICTING` |
| `DB-UNKNOWN-001` | R8 recovery dataset, access observed at `55488`, recovery volume | `CONFIRMED` identity/data presence | `CONFLICTING` |
| `DB-LOCAL-002` | Evolution internal PostgreSQL | `CONFIRMED` architecture/runtime | Independent provider store |
| `DB-UNKNOWN-002` | `phase17-gap-audit-postgres-1` | `UNKNOWN` | Unassigned |
| `DB-UNKNOWN-003` | `shopee-postgres-recovery` | `UNKNOWN` | Unassigned |
| `DB-UNKNOWN-004` | `phase12-clean-cycle-main-postgres-1` | `UNKNOWN` | Unassigned |
| `DB-UNKNOWN-005` | `commercial-copy-post-v10-worktree-postgres-1` | `UNKNOWN` | Unassigned |
| `DB-UNKNOWN-006` | `infra-postgres-1` | `UNKNOWN` | Unassigned |

No application database is assigned `DB-PROD-*` or declared source of truth during Phase 0.

## 5. Integration IDs

| ID | Integration | Status |
| --- | --- | --- |
| `SHOPEE-PROD-001` | Official Shopee Affiliate GraphQL endpoint | Code contract `CONFIRMED`; runtime credentials/readiness `UNKNOWN` |
| `EVOLUTION-LOCAL-001` | Local Evolution API stack v2.3.7 | `CONFIRMED` |
| `WA-PROD-001` | Real WhatsApp instance `afiliado-shopee-local` | instance `open` was `CONFIRMED`; external-effect path remains paused |
| `WA-WEBHOOK-001` | Per-instance delivery webhook | endpoint identity `CONFIRMED`; application DB binding `CONFLICTING` |
| `AI-UNKNOWN-001` | OpenAI commercial copy provider | code/profile present; runtime key/model/use `UNKNOWN` |
| `VERCEL-NONE-001` | Vercel deployment for this repo | no Afiliado Shopee project found in accessible Vercel inventory |

## 6. Runtime source-of-truth precedence

The supervisor resolves environment in this order:

```text
.env
  -> runtime.env overrides
     -> process environment overrides
```

Therefore a repository checkout alone is insufficient to prove a runtime's database, Redis, provider or secret binding.

The daily profile sets send-mode operational flags but does not set `DATABASE_URL`, `REDIS_URL` or secret values. Those bindings remain inherited.

## 7. Critical conflict

The code's operational Compose identity expects volume:

`afiliado-shopee_postgres_data`

However current R8 historical target/lifecycle evidence is present in:

`afiliado-shopee-r8-recovery-20260910_postgres_data`

This is **not** sufficient to rename either volume as production/canonical. Phase 1 must establish lineage, migration history, schema fingerprints, timestamps and backup state before assigning a canonical role.

## 8. Evidence register

- `E-GIT-001`: current GitHub `main` SHA/tree and merge of PR #162.
- `E-CODE-ENV-001`: `apps/system-supervisor/src/environment.ts` environment precedence.
- `E-CODE-RUNTIME-001`: `scripts/windows/launcher-common.ps1` daily runtime profile.
- `E-CODE-IDENTITY-001`: `apps/system-supervisor/src/runtime-identity.ts` Compose/volume identity.
- `E-CODE-DB-001`: root `docker-compose.yml` application PostgreSQL/Redis design.
- `E-CODE-EVO-001`: `infra/evolution/docker-compose.yml` isolated Evolution stack.
- `E-HOST-001`: owner-provided Docker container/port/mount inventory on 2026-09-11.
- `E-HOST-R8DB-001`: owner-provided read-only R8 recovery DB query/dump on 2026-09-11.
- `E-R8-CONT-001`: prior continuity packet explicitly distinguishing TEST evidence from live operational proof.
- `E-VERCEL-001`: accessible Vercel team project inventory; no Afiliado Shopee project observed.

## 9. Phase 0 safety status

- WhatsApp SEND: **PROHIBITED**
- Shopee real call: **PROHIBITED unless later separately authorized for read-only baseline evidence**
- Migrations: **PROHIBITED**
- Database writes: **PROHIBITED**
- Redis writes: **PROHIBITED**
- Secret changes: **PROHIBITED**
- Infrastructure mutations: **PROHIBITED**
- R8 lifecycle mutations: **PROHIBITED**
- R9: **PROHIBITED**

`SAFE_TO_RESUME_R8=false`
