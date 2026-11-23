# Password recovery: isolated Outbox/Worker test plan (2026-11-22)

Status: design only. This document does not deploy or execute a migration, connect to Supabase, call Auth, or send SMS.

Target branch: `experiment/trainee-password-recovery-mock-20261122`

## Safety boundary

- All integration tests run against a disposable PostgreSQL 16 service created by GitHub Actions.
- Fixtures use synthetic coach, trainee, request, and Outbox identifiers and synthetic phone numbers.
- Never connect the test suite to the production Supabase project or production Auth.
- No test may call an Auth password mutation endpoint. Auth is represented only by a deterministic fake adapter.
- SMS is represented only by a fake provider. Medina remains disabled/unconfigured in this experiment.
- The production branch, real trainee rows, real passwords, and Supabase schema remain untouched.

## Important distinction: existing candidate is not yet a durable Outbox

The current SQL candidate stores delivery operation fields on
`trainee_password_recovery_requests` (`delivery_operation_id`,
`delivery_outcome`, `delivery_attempted_at`). That is not yet a separate
Outbox table or a complete multi-worker lease protocol. The tests below must
not claim to validate Outbox/Worker safety until the dedicated table, claim
function, fenced completion function, and fake-provider harness exist.

## Proposed Outbox record

Minimum fields for the isolated candidate:

- `id` UUID primary key; `recovery_request_id` unique foreign key.
- `status`: `pending | processing | sent | failed | unknown`.
- `attempt_count`, `next_attempt_at`, `created_at`, `updated_at`.
- `lock_owner`, `locked_until`, `lease_generation BIGINT NOT NULL DEFAULT 0`.
- `send_started_at`, `provider_message_id`, `last_safe_error_code`.
- A stable `provider_idempotency_key` derived from the immutable Outbox ID, not from a lease generation.

The request and Outbox transitions must be committed transactionally. Claiming a
pending row increments `lease_generation` and returns the new generation to
that worker. A worker must carry both `lock_owner` and
`lease_generation` through every heartbeat and finalization call.

## Fencing and delivery semantics

1. Claim is a single atomic SQL operation (row lock / `SKIP LOCKED` or an
   equivalent conditional update). Exactly one worker receives a given
   generation.
2. Every heartbeat and completion update is conditional on Outbox ID,
   lock owner, current generation, and eligible state. A stale generation
   must update zero rows.
3. A new claim increments the generation. Worker A with generation N can
   never overwrite state written by worker B with generation N+1.
4. The provider idempotency key remains stable across lease generations so a
   provider that supports idempotency can suppress duplicate delivery.
5. Fencing protects database state; it cannot retract an external SMS. If a
   worker has crossed the durable `send_started_at` boundary and then loses
   its lease or crashes, the outcome is ambiguous. Do not blindly resend.
   Move/reconcile the item as `unknown`, query provider status when supported,
   or require a documented manual resolution. If the provider lacks
   idempotency/status lookup, fail closed rather than claim exactly-once SMS.
6. Lease extension must happen while the send is in progress. A worker that
   cannot renew its lease must not start a new external send. A lease expiring
   during an already-started send still requires the ambiguity rule above.

## Part A — pure Node.js unit tests (no network, no database)

Create a deterministic Outbox/Worker model with injected clock, fake provider,
and controllable worker pause points. Do not use real timers or real SMS.

| Case | Setup / fault injection | Required assertion |
|---|---|---|
| Provider accepts with empty successful body | fake returns success with empty body | state `sent`; no response-body parsing assumption |
| Provider accepts with JSON success | fake returns valid success JSON | state `sent`; message ID stored only if validated |
| Definite rejection | fake returns documented non-acceptance | state `failed` (or retryable pending under explicit policy); never `sent` |
| Malformed JSON | response indicates success but body cannot be parsed | `unknown`, unless transport contract independently proves rejection |
| Timeout before authoritative response | provider may have accepted | `unknown`; no blind resend |
| Worker stops before durable send-start | claim exists, send-start absent | lease may expire; another worker can claim a higher generation |
| Worker stops after provider acceptance | fake records acceptance, worker dies before DB finalization | `unknown`/reconcile; automatic duplicate send forbidden |
| Two workers claim concurrently | synchronized claim barrier | one claim winner for a lease generation; one active owner |
| Lease expires during send | worker A pauses after send-start; B attempts reclaim | B must not send merely because time elapsed; reconciliation or provider idempotency required |
| Stale worker finalizes | B obtains generation N+1; A submits generation N | A updates zero rows; B's state remains authoritative |
| Stale heartbeat | A renews using generation N after N+1 exists | zero rows; no lease extension |
| Duplicate job delivery | same Outbox ID delivered twice | stable provider idempotency key; no second accepted send |
| Worker retries after definite failure | prior attempt definitely not accepted | bounded retry/backoff; attempt cap enforced |
| Worker retries after unknown | prior attempt ambiguous | retry blocked until reconciliation resolves outcome |

The fake provider should record call count, idempotency keys, accepted message
IDs, and scripted response/timeout behavior. Tests must assert both state and
external-call count.

## Part B — disposable PostgreSQL integration tests

Use only the PostgreSQL service container in the isolated GitHub Actions job.
Build synthetic schema/rows from scratch; do not import production data or
secrets. Use at least two independent PostgreSQL sessions for races.

Required database assertions:

1. Concurrent claims: two sessions racing for one pending Outbox row produce
   exactly one current owner and one generation increment.
2. Sequential reclaim before send-start: expired lease can be reclaimed and
   generation increments monotonically.
3. Fenced completion: old owner/generation updates zero rows after reclaim;
   current owner/generation can complete.
4. Fenced heartbeat: old generation cannot extend a new worker's lease.
5. No duplicate active processing: database constraints/claim SQL prevent two
   current owners for one Outbox item.
6. Transaction rollback: if claim transaction aborts, no partial ownership or
   generation-visible state remains.
7. Durable send-start: once send-start is committed, an expired lease cannot
   be treated as safe-to-send again; item is routed to unknown/reconciliation.
8. Atomic attempt count and retry cap remain correct under concurrent calls.
9. Outbox/request consistency: sent, failed, and unknown transitions update
   only the intended synthetic recovery request.
10. Role/privilege checks: only the server-side service role can execute
    claim/heartbeat/finalize RPCs; anon/authenticated cannot.

The SQL test must verify actual candidate functions, not merely reproduce their
intended behavior with unrelated ad-hoc UPDATE statements.

## CI wiring and acceptance

- Add a separate Node unit-test command for the Outbox model.
- Add a separate disposable-PostgreSQL integration-test command.
- Keep both jobs scoped to the experimental branch and its files.
- Use Node.js 22 and PostgreSQL 16, with no production secrets in workflow
  environment variables.
- A green run proves only the synthetic model and disposable SQL candidate.
  It does not prove Medina compatibility, live Supabase behavior, Auth
  password mutation, or production readiness.

## Exit criteria for this stage

This design is accepted only when all cases above have executable tests and
the migration/functions under test implement the same state model. Until then,
the recovery Outbox/Worker design is not approved for deployment or merge.
