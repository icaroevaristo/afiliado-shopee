# SHOPEE SYSTEM RECOVERY — TEST EVIDENCE

**Phase:** 0 — Forensic Recovery

This inventory distinguishes source-code tests, disposable TEST execution, host runtime checks and real external effects. A passing test is only evidence for the environment it actually exercised.

## TE-001 — Current repository identity

**Status:** `CONFIRMED`

- GitHub main SHA: `9f23b09e35a9e917f3ca8205b34a90dc362b9b2d`.
- Tree: `5e3f405b334dda1831ae83dbbb3d9787d7a575ff`.
- PR #162 is part of current main history.

Meaning: valid code baseline for this forensic snapshot.

## TE-002 — R1–R7/R8A disposable/local certification

**Status:** `CONFIRMED` as historical TEST evidence; live operational applicability limited

Prior project evidence reports broad local test suites, PostgreSQL/Redis/BullMQ disposable fixtures, fake/in-memory Evolution transport and pre-SEND R8 fencing/recovery tests.

Prior continuity explicitly states:
- R7/browser evidence used test/synthetic data;
- R8A pre-SEND evidence used TEST infrastructure/fake provider;
- those proofs did not authorize or prove live SEND;
- GitHub status/workflow checks were not available for the R8A candidate.

Do not restate these as production certification.

## TE-003 — Latest local regression report around PR #162

**Status:** `PROBABLE/REPORTED`, not independent GitHub CI

Codex reported local passes including API/worker suites, typecheck, lint, build and focused tests before PR #162 merge.

This evidence is useful for code confidence, but:
- no GitHub Actions workflow run/status was found for the latest R8 candidate/current main;
- the repo has no `.github` directory at the forensic baseline;
- therefore `GITHUB_CI_PASS` must not be asserted.

## TE-004 — Evolution local runtime

**Status:** `CONFIRMED` for observed host runtime

Observed during R8 investigation:
- Evolution root endpoint returned HTTP 200;
- version `2.3.7`;
- instance `afiliado-shopee-local` returned `open`;
- provider PostgreSQL/Redis containers were healthy;
- container-to-host callback TCP reachability to port 3433 was confirmed.

This proves infrastructure reachability, not application DB correctness.

## TE-005 — API 3433 against DB-LOCAL-001

**Status:** `CONFIRMED`

Codex/owner evidence showed:
- API reachable;
- application DB/Redis reachable;
- `/whatsapp/groups` did not contain the authorized R8 target;
- offer preparation returned `404 OFFER_NOT_FOUND`;
- operational admin returned unavailable in that dataset context.

Meaning: DB-LOCAL-001 did not expose the data needed for the R8 state being investigated.

This does **not** prove DB-LOCAL-001 is empty, disposable or obsolete.

## TE-006 — DB-UNKNOWN-001 R8 historical anchors

**Status:** `CONFIRMED`

Owner read-only access to recovery PostgreSQL showed:
- authorized target `cmrzkc0210000ai0rezdw5hza`;
- group fingerprint `grp_3ae3f9f1fbd4`;
- assignment to `afiliado-shopee-local` with revision 2;
- campaign and prepared-message data;
- historical R8 authorization/execution;
- two later safe-pre-external-failure executions;
- historical pipeline/dispatch/outbox/manual-publication rows.

Meaning: this DB contains business/lifecycle history and must be preserved.

## TE-007 — Temporary API 3434

**Status:** `CONFLICTING/INCOMPLETE`

Observed:
- TCP reachable;
- `/health` returned `{status: ok, service: api}`.

Protected endpoints were not successfully proven against DB-UNKNOWN-001 because:
- local API auth token source was unavailable in a separate shell;
- later Codex access to PostgreSQL 55488 reached TCP but failed authentication.

Therefore health 200 cannot be used to claim `READINESS_DATASET_CONFIRMED=true`.

## TE-008 — Historical application `SENT` rows

**Status:** `CONFIRMED` as persisted application state; external delivery evidence `UNKNOWN`

DB-UNKNOWN-001 contains historical `CommercialPipelineRun` rows marked `SENT`.

Current project contract states provider HTTP acceptance/submission is not terminal delivery proof and durable delivery progresses through delivery confirmation events.

Therefore old `SENT` database rows must not be upgraded to canonical external delivery evidence without correlated webhook/provider evidence.

## TE-009 — R8 historical ambiguous boundary

**Status:** `CONFIRMED` from project continuity/current recovery history

A historical R8 SEND reached the provider boundary and returned HTTP 500; non-delivery was never proven. The project correctly preserves no-retry semantics.

Later two R8 lifecycles were classified safe-pre-external failures and did not consume a fresh actual SEND request according to the recorded evidence.

R8 is now frozen regardless; no remaining budget is executable until recovery/baseline/SDD gates complete.

## TE-010 — GitHub CI/CD

**Status:** `CONFIRMED ABSENT` from current repository evidence

At forensic baseline:
- `.github` directory lookup returned not found;
- current main combined GitHub status contained no statuses;
- latest R8 candidate had no PR-triggered workflow runs returned.

Conclusion: CI/CD on GitHub is not currently a verified gate. Local test reports remain local evidence.

## TE-011 — Vercel

**Status:** `CONFIRMED` for accessible account inventory

No Vercel project linked to `afiliado-shopee` was found in the accessible team inventory.

## Evidence quality scale for Phase 1

Preferred order:
1. direct read-only runtime/DB query with identity binding;
2. immutable GitHub commit/file evidence;
3. sanitized host inventory;
4. test artifact tied to exact commit/environment;
5. agent textual report;
6. naming inference only.

No lower-tier evidence may silently override a higher-tier conflict.
