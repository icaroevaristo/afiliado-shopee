# SHOPEE SYSTEM RECOVERY — INTEGRATIONS

**Phase:** 0 — Forensic Recovery
**External effects:** prohibited during this phase.

## SHOPEE-PROD-001 — Official Shopee Affiliate API

**Type:** real external provider
**Status:** code contract `CONFIRMED`; current runtime readiness `UNKNOWN`

Versioned contract:
- authorized endpoint: `https://open-api.affiliate.shopee.com.br/graphql`;
- signed request contract uses Shopee app ID/secret;
- real-read safety limit exists in provider code;
- HTTP timeout and response-size limits are enforced.

Relevant configuration names:
- `SHOPEE_AFFILIATE_PROVIDER`;
- `SHOPEE_AFFILIATE_API_ENABLED`;
- `SHOPEE_AFFILIATE_API_URL`;
- `SHOPEE_AFFILIATE_APP_ID`;
- `SHOPEE_AFFILIATE_SECRET`;
- `SHOPEE_AFFILIATE_SUB_ID_PREFIX`;
- `SHOPEE_AFFILIATE_SYNC_LIMIT`;
- legacy/other Shopee names `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY` also exist in configuration surface.

Daily local profile intends `official` + API enabled, but Phase 0 has not confirmed:
- credential presence in the canonical runtime;
- whether current endpoint override equals the authorized endpoint;
- current API authorization health;
- quota/rate-limit state;
- which DB receives official catalog writes in normal operation.

No Shopee external request is required to finish Phase 0.

## EVOLUTION-LOCAL-001 — Evolution API

**Type:** local integration bridge to real WhatsApp
**Status:** `CONFIRMED`

Observed/runtime evidence:
- API: local `127.0.0.1:8080`;
- version: `2.3.7`;
- instance `afiliado-shopee-local` observed `open`;
- versioned stack has independent PostgreSQL and Redis;
- versioned compose keeps provider DB/Redis off host-published ports.

Relevant configuration names:
- `WHATSAPP_PROVIDER`;
- `EVOLUTION_API_URL`;
- `EVOLUTION_API_KEY`;
- `EVOLUTION_INSTANCE_NAME`;
- `EVOLUTION_SAFE_MODE`;
- `EVOLUTION_ALLOWED_DESTINATIONS`;
- `EVOLUTION_MAX_MESSAGES_PER_BOOT`;
- `EVOLUTION_SEND_TIMEOUT_MS`.

## WA-PROD-001 — Real WhatsApp instance/effect boundary

**Type:** real external effect
**Status:** instance identity/state `CONFIRMED`; use authorization currently revoked by recovery freeze

Canonical known instance identity:
- `afiliado-shopee-local`.

R8 target evidence exists in DB-UNKNOWN-001, but Phase 0 does not certify any fresh SEND readiness.

Rules during recovery:
- real SEND = 0 authorized;
- automatic retry = prohibited;
- R8 authorization/budget from prior work is suspended until baseline/SDD recovery completes.

## WA-WEBHOOK-001 — Delivery confirmation webhook

**Type:** Evolution per-instance callback to application API
**Status:** endpoint configuration `CONFIRMED`; data-plane binding `CONFLICTING`

Versioned contract:
- event: `MESSAGES_UPDATE`;
- path: `/whatsapp/events/messages.update`;
- host must be `host.docker.internal`;
- dedicated Bearer token required;
- callback port must match local API port when enforced.

Observed current R8-era configuration pointed to local API port `3433`.

Conflict:
- the API on `3433` was observed bound to DB-LOCAL-001 (`5432`);
- the R8 target and historical lifecycle records were confirmed in DB-UNKNOWN-001 (`55488` access path).

Therefore webhook delivery evidence cannot be considered canonically reconciled until Phase 1 chooses one application DB and proves callback runtime binding to it.

Important Phase 0 restriction:
- do **not** call webhook `ensureReady()` as a forensic probe because readiness can perform `find/set/find` and mutate Evolution webhook configuration.

## AI-UNKNOWN-001 — OpenAI commercial copy

**Type:** paid external provider
**Status:** implementation/profile `CONFIRMED`; runtime binding/use `UNKNOWN`

Relevant configuration names:
- `COMMERCIAL_AI_COPY_ENABLED`;
- `COMMERCIAL_AI_COPY_PROVIDER`;
- `COMMERCIAL_AI_COPY_MODEL`;
- `COMMERCIAL_AI_COPY_TIMEOUT_MS`;
- `COMMERCIAL_AI_COPY_MAX_OUTPUT_TOKENS`;
- `COMMERCIAL_AI_COPY_REASONING_EFFORT`;
- `OPENAI_API_KEY`.

Daily profile intends AI copy enabled. Phase 0 does not confirm current key, model, spend state, or which historical copies came from which exact runtime environment unless persisted metadata proves it.

No OpenAI call is required for Phase 0.

## VERCEL-NONE-001 — Vercel

**Type:** hosting/deployment platform
**Status:** `CONFIRMED` absent from accessible Afiliado Shopee inventory

Accessible team inventory on 2026-09-11 contained projects for IES Mídia and Sujeito Homem, but no project linked to `icaroevaristo/afiliado-shopee`.

Conclusion:
- no Vercel deployment is accepted as an Afiliado Shopee canonical runtime from current evidence;
- if another account/team exists outside the accessible inventory, it remains `UNKNOWN` until explicitly discovered.

## Other integration surfaces

The Evolution local `.env` template explicitly disables unrelated integrations such as RabbitMQ, SQS, Kafka, NATS, Typebot, Chatwoot, OpenAI, Dify, n8n, EvoAI, Flowise and S3 by default. Phase 0 has no evidence that any of them belongs to the current Shopee architecture.

## Canonical integration chain — not yet assigned

Target future baseline:

`ENV-* -> API runtime -> DB-PROD-* -> CACHE-* -> SHOPEE-PROD-001 -> AI-* -> EVOLUTION-LOCAL-001 -> WA-PROD-001 -> WA-WEBHOOK-001 -> same DB-PROD-*`

Current status: `NOT_CANONICALIZED`.
