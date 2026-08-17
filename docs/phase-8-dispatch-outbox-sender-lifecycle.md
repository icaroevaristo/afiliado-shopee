# Phase 8 dispatch, outbox, sender and lifecycle contract

## Scope

Phase 8 certifies the closed lifecycle:
`authorized target -> PromotionCandidate -> validated snapshot/provenance -> CommercialMessageDraft -> idempotent dispatch -> outbox -> deterministic enqueue -> SenderService -> mocked provider -> SENT / FAILED / ambiguous outcome -> recovery/reconciliation`.

This phase preserves the closed contracts from Phases 1-7 and does not execute real SEND.

## Call graph

1. Candidate-scoped commercial automation reaches the dispatch/outbox repository with the already selected candidate, snapshot, generated copy and authorized target.
2. Candidate reservation, dispatch and commercial outbox confirmation are created under the existing transaction/CAS contract.
3. The outbox publisher derives the existing deterministic job id and reconciles queue state before enqueue.
4. `SenderService` loads the complete candidate-scoped boundary through a single `findByIdForSending()` query.
5. Destination, copy, candidate, snapshot, provenance and draft invariants are revalidated before `markAttemptPending` and before the provider boundary.
6. Only the successful CAS claimant may call the provider.
7. The mocked provider result is persisted as `SENT`/`FAILED`; uncertain delivery or post-provider persistence uncertainty remains reconciliation-safe rather than blindly retried.

## Dispatch, outbox and idempotency

The repository contract creates the reservation, dispatch and outbox confirmation atomically. Transactional failure rolls the unit back; compatible reexecution does not create a second effective dispatch/outbox pair. Existing deterministic identity, uniqueness constraints and owner/execution scope are preserved.

The publisher uses the existing stable job id. Concurrent publishers produce at most one enqueue; already `PUBLISHED` work is reconciled without enqueue; an existing deterministic job is reconciled instead of duplicated; uncertainty after a possible enqueue uses the existing `AMBIGUOUS` contract. No new retry/backoff policy is introduced.

All publisher tests use local fakes/mocks; no operational BullMQ or Redis job is created.

## Single Sender query and relations loaded

`findByIdForSending()` remains one Prisma query. It loads dispatch identity/state; destination id/type/active/available/source instance/logical fingerprint; generated-copy identity, `createdFromCandidateId`, source/prompt/validation versions; all related promotion candidates; candidate campaign id/logical group fingerprint; candidate product source/provider id, product/shop names, product and affiliate links, price/discount/commission/rating/sales, offer dates, image, commercial snapshot revision/fingerprint and update time; and candidate snapshot id/product/revision/fingerprint/availability dates.

The repository maps Prisma product field names into the existing commercial product contract. Repository tests assert one dispatch `findUnique` and no second promotion-candidate query.

## Fail-closed validation before claim/provider

For candidate-scoped commercial dispatches, `SenderService` validates before `markAttemptPending`: dispatch/generated-copy/product identity; exactly one `createdFromCandidateId` candidate; candidate generated-copy/product/snapshot/campaign relations; dispatch destination id; GROUP destination; campaign logical fingerprint matching the group; group active/available, configured instance and physical fingerprint through the existing group-send policy; AI Copy V10 prompt and validation versions; Phase 4 affiliate-link provenance; snapshot revision/fingerprint and product commercial snapshot fingerprint; and draft candidate/generated-copy identity. IMAGE/TEXT structural validity remains governed by the certified Phase 6 contract.

Any mismatch fails before claim and provider. The negative matrix asserts one repository read, zero `markAttemptPending`, zero provider calls and sanitized logs.

## Sender claim and provider outcome

`markAttemptPending` is the existing CAS. Only one concurrent sender may proceed. `SENT` is idempotent and not resent; `PROCESSING` is not blindly redelivered; a losing concurrent sender does not call the provider; the provider is called at most once for the successful claim; success persists the external message id and `SENT`; deterministic no-effect failures follow the existing `FAILED` path; uncertain provider or post-provider persistence outcomes are not converted into a safe retry.

## States and recovery

The certified dispatch states are `PENDING`, `PROCESSING`, `SENT` and `FAILED`. Delivery uncertainty uses the existing ambiguous-delivery/recovery contract instead of inventing a retry state. The commercial outbox uses `PENDING`, `PUBLISHED` and `AMBIGUOUS`. Recovery/reconciliation tests prove that stale or ambiguous records are inspected without assuming that another send/enqueue is safe; existing `investigationRequired` behavior is preserved.

## GROUP / INDIVIDUAL and IMAGE / TEXT

A dispatch with `createdFromCandidateId` is candidate-scoped commercial work and must resolve to GROUP. It cannot fall back to the legacy/individual path. The legacy path remains only where the preexisting non-candidate-scoped contract explicitly allows it. `INDIVIDUAL` is not represented as `WhatsAppGroupRecord`, and Phase 8 adds no unsafe cast to bypass this separation.

Phase 8 does not reinterpret the Phase 6 draft: valid IMAGE preserves media/caption to the mocked provider; TEXT preserves the text-only shape; structurally invalid IMAGE fails before claim/provider. Affiliate link, caption and destination remain tied to the validated candidate/draft.

## Safety and evidence

Boundary failures use stable error codes and sanitized messages. Negative Sender tests assert that failure logs do not contain the affiliate link, raw physical destination or full commercial caption used by the fixture.

The Phase 8 focal certifies atomic dispatch/outbox creation and rollback; candidate reservation; deterministic job id; publisher concurrency/idempotency; `PUBLISHED` reconciliation; ambiguous enqueue handling; one-query Sender load; 16 explicit pre-claim mismatch cases; CAS sender concurrency; no resend of `SENT`/`PROCESSING`; deterministic `FAILED`; ambiguous provider/post-provider persistence handling; external-message-id persistence; IMAGE/TEXT and GROUP/INDIVIDUAL separation; and recovery/reconciliation.

This certification uses only local tests, mocks and fakes. It does not call Evolution, WhatsApp, Shopee or OpenAI; start operational workers/schedulers; access operational Redis/BullMQ/PostgreSQL; execute SEND, migration, seed or SQL; or publish repository/deployment changes.

Phase 9 E2E certification remains outside Phase 8.
