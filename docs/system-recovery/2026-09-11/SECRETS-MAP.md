# SHOPEE SYSTEM RECOVERY — SECRETS MAP

**Phase:** 0 — Forensic Recovery
**Policy:** this file records variable names and ownership only. Secret values, connection strings with credentials, tokens and API keys are forbidden in recovery documentation.

## Application/runtime secret names

| Variable | Purpose | Expected scope/source | Current status |
| --- | --- | --- | --- |
| `DATABASE_URL` | Application PostgreSQL connection | root `.env` and/or process environment | binding differs by runtime; `CONFLICTING` |
| `REDIS_URL` | Application Redis/BullMQ connection | root `.env` and/or process environment | host 6379 observed; credential requirements `UNKNOWN` |
| `LOCAL_API_AUTH_TOKEN` | Local API/dashboard Bearer boundary | local secret environment | API required it; source for manual runtime `UNKNOWN` |
| `OPENAI_API_KEY` | Commercial AI copy provider | local secret environment | presence `UNKNOWN` |
| `SHOPEE_AFFILIATE_APP_ID` | Shopee Affiliate signing identity | local secret environment | presence `UNKNOWN` |
| `SHOPEE_AFFILIATE_SECRET` | Shopee Affiliate signing secret | local secret environment | presence `UNKNOWN` |
| `SHOPEE_PARTNER_ID` | Shopee legacy/alternate credential surface | local secret environment | use/presence `UNKNOWN` |
| `SHOPEE_PARTNER_KEY` | Shopee legacy/alternate credential surface | local secret environment | use/presence `UNKNOWN` |
| `EVOLUTION_API_KEY` | Evolution API authentication | root local secret environment / Evolution config | operational value exists but is not documented |
| `WHATSAPP_DELIVERY_WEBHOOK_TOKEN` | Dedicated delivery callback Bearer token | local secret environment | operational value exists/was required; exact source `UNKNOWN` |

## Evolution local infrastructure secret names

| Variable | Purpose | Scope | Current status |
| --- | --- | --- | --- |
| `POSTGRES_PASSWORD` | Evolution internal PostgreSQL password | `infra/evolution/.env.local` | file is ignored; value not inspected |
| `AUTHENTICATION_API_KEY` | Evolution API key | `infra/evolution/.env.local` | file is ignored; value not inspected |
| `DATABASE_CONNECTION_URI` | Evolution internal PostgreSQL URI | `infra/evolution/.env.local` | contains credential material; never log full value |

Related non-secret/sensitive configuration names that should still be inventoried without values in public artifacts:
- `POSTGRES_DB`
- `POSTGRES_USER`
- `EVOLUTION_API_URL`
- `EVOLUTION_INSTANCE_NAME`
- `WHATSAPP_DELIVERY_WEBHOOK_URL`
- `SHOPEE_AFFILIATE_API_URL`
- `COMMERCIAL_AI_COPY_MODEL`

## Files and precedence

### `.env`

- ignored by Git;
- may contain database/provider bindings and secrets;
- exact current file must be inventoried by **key names and file hash only**, not values.

### `runtime.env`

- ignored by Git;
- installer describes it as non-secret process overrides;
- daily profile sets operational mode flags and ports but should not be trusted to contain no secret until current file is inspected by key name only;
- process environment overrides it.

### `infra/evolution/.env.local`

- ignored by Git;
- generated local Evolution configuration;
- contains provider DB/API credentials;
- inspect names/fingerprint only during recovery.

### Process environment

- highest precedence in supervisor environment merge;
- can silently change `DATABASE_URL`, `REDIS_URL`, provider modes and secret bindings relative to files;
- must be mapped per process by variable **name/presence**, never value.

## Phase 1 secret-handling evidence

For each runtime process, record only:
- whether each expected variable name is present;
- source layer if determinable (`.env`, `runtime.env`, process, generated provider env);
- sanitized endpoint identity where not secret;
- SHA-256 fingerprint of local config files if useful for drift detection;
- whether two runtimes use the same secret/config generation without revealing material.

## Prohibited reporting

Never place in Git, issue, PR, log or ChatGPT report:
- database passwords;
- full `DATABASE_URL`/`DATABASE_CONNECTION_URI` containing credentials;
- `LOCAL_API_AUTH_TOKEN`;
- Shopee secret/key values;
- OpenAI API key;
- Evolution API key;
- webhook Bearer token.

If a tool output accidentally exposes a secret, do not copy it into the recovery artifacts; treat exposure/rotation as a separate security incident decision.
