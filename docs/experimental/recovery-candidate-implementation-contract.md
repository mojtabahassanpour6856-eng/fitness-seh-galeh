# Password recovery candidate implementation contract

Status: **DESIGN ONLY — NOT DEPLOYABLE** (2026-11-22)

This contract translates the release-gate findings into implementation and test requirements. It intentionally contains no real credentials, no deployable Edge Function, and no SQL intended for a live Supabase project.

## Non-negotiable safety boundary

- Implement and test only on the existing experiment branch and disposable PostgreSQL.
- Do not run migrations against Supabase Test or Production without explicit approval.
- Do not deploy any Edge Function without explicit approval.
- Do not mutate real trainee records, Auth passwords, sessions, or send real SMS.
- Mediana remains out of scope while its IP restriction is unresolved. Use a test-only delivery adapter that captures a synthetic destination and code in an isolated test process; never log either value.
- Keep the release status **NOT READY** until all gates in the release report are evidenced.

## Required state machine

The request lifecycle must distinguish the delivery and Auth update phases. Suggested states:

`pending` → coach decision → `approved` → code delivery → `code_issued` → valid code claim → `processing` → Auth update outcome.

Terminal outcomes: `completed`, `rejected`, `expired`, `cancelled`.
Exceptional outcome: `auth_update_unknown` (locked; never reusable).

Every transition must be a conditional database write that checks the expected prior state and actor authorization. A second approval, code claim, or completion attempt must not win after the first successful transition.

### Ambiguous Auth outcome rule (P0)

1. Persist a unique operation ID and transition to a locked processing state before calling Supabase Auth.
2. Make exactly one Auth password-update attempt for that operation.
3. On a definite success response, persist `completed` with the operation ID.
4. On a definite pre-commit rejection, record a safe failure outcome according to verified Auth semantics.
5. On timeout, connection loss, or any outcome where commit status is uncertain, transition to `auth_update_unknown` (or leave the durable locked state if persistence is unavailable). Never revert to `approved`, never reissue the same code, and never automatically retry the password update.
6. Reconciliation must not infer success merely from an HTTP timeout or from a second attempt. Because the stored password is not readable, a support process must use a separately designed, auditable recovery path; until then the request stays locked.

Do not claim exactly-once semantics across Postgres and Supabase Auth: there is no shared transaction. The goal is fail-closed behavior and prevention of code replay.

## Cryptographic requirements

### Uniform four-digit code generation

If product UX requires exactly four decimal digits, use rejection sampling over a cryptographically secure 16-bit value:

- Accept only samples in [0, 59999].
- Reject values in [60000, 65535].
- Map accepted values to sample modulo 10000 and zero-pad to four digits.
- Use a vetted Web Crypto source and test distribution boundaries with deterministic injected samples.
- Do not use `random % 10000` without rejection sampling.

Four digits provide only 10,000 possibilities; compensate with short expiry, strict atomic attempt caps, rate limiting, one-time claim, and no code in logs. Consider a longer code in a future UX review.

### Code digest

- Compute HMAC-SHA-256 using a dedicated high-entropy secret supplied only through the Edge Function secret environment.
- Do not store the secret in Git, SQL, app bundles, logs, or database rows.
- Store a key-version identifier with the digest so rotation can be planned.
- Compare digests in constant time where supported.
- Missing secret must fail closed; never silently fall back to plain SHA-256.

## Atomic wrong-code attempts

- Replace read-then-write counter logic with one database operation that increments only while the request is in the expected state and below the single authoritative cap.
- The same threshold must be used by handler, database operation, tests, and documentation.
- The database operation must return only a boolean/result needed by the caller, not sensitive row contents.
- Restrict execution to the server's service role; revoke execution from anon/authenticated. Review SECURITY DEFINER, fixed search_path, schema-qualified references, ownership, and grants.
- Test concurrent invalid attempts from independent PostgreSQL sessions and prove the counter never exceeds the cap and no attempt is lost.

## Active-request uniqueness

The partial unique index must treat `pending`, `approved`, and `processing` (including any locked unknown state) as active. Before a live migration:
- check for duplicate active rows immediately before applying;
- review lock duration and index build strategy against actual table size;
- define a rollback that does not reopen a second active flow;
- verify the exact predicate and constraints after migration.

The existing disposable migration test is evidence only for the isolated fixture, not authorization to apply it to Supabase.

## Public API and privacy

- Public request submission returns identical HTTP status, response shape, and generic text for registered, unregistered, inactive, and ineligible numbers.
- Resolve trainee identity and verified destination exclusively server-side. Ignore client-supplied trainee/coach IDs as authority.
- Apply abuse controls before account lookup where feasible.
- Never expose request IDs, internal state, coach identity, account eligibility, code digest, delivery provider errors, or retry counters publicly.
- Coach reads/actions must be scoped to the authenticated coach's currently assigned trainees and rechecked on every operation.
- Restrict CORS to known app origins where feasible; CORS is not authentication.
- Logs must exclude codes, passwords, secrets, and full phone numbers.

## Required candidate test matrix

| Area | Required assertion | Test layer |
|---|---|---|
| State transitions | duplicate approval/claim/completion has exactly one winner | disposable PostgreSQL + handler |
| Unknown Auth outcome | timeout never reopens code and never retries update | injected Auth adapter + handler |
| Confirmed Auth outcome | confirmed success completes exactly once | isolated Auth test account |
| Code generation | rejection boundary and zero-padding are correct | deterministic unit tests |
| Digest | HMAC key separation, key version, missing-secret fail-closed | unit + handler |
| Wrong-code cap | parallel attempts are atomic and share one cap | disposable PostgreSQL |
| Enumeration | all account eligibility cases return identical public response | real HTTP endpoint |
| Authorization | wrong coach and reassignment cannot access/approve | real HTTP endpoint |
| Delivery | destination is the verified stored phone only | test-only provider |
| Expiry/replay | expired and consumed codes cannot be claimed | handler + PostgreSQL |
| Session behavior | old sessions' validity/revocation is observed and documented | isolated Auth account |
| Operations | stuck processing/unknown states are visible to authorized support only | integration + monitoring |

## Exit criteria

A candidate is not ready until the corrected source is reviewed, unit and disposable PostgreSQL tests pass, real Test HTTP/Auth tests pass with isolated accounts, test-only delivery is verified, session behavior is documented, logs are reviewed, and rollback/reconciliation are exercised. Separate explicit approval is required before any Supabase Test write/deploy and again before Production.

## Current evidence boundary

Existing Mock assertions and disposable PostgreSQL concurrency runs do not exercise the real Edge Function HTTP layer, Supabase Auth, coach authorization, or SMS provider. This contract does not change that status.


## Live Test schema facts and atomic coach-review design (read-only, 2026-11-22)

A read-only `information_schema.columns` query against the Test project confirmed the current recovery table has only:
`id`, `trainee_id`, `phone_normalized`, `status`, `requested_at`, `reviewed_at`, `reviewed_by`, `token_hash`, `token_expires_at`, `token_attempts`, `completed_at`, and `updated_at`.
It does **not** currently have durable `operation_id`, processing-start timestamp, Auth outcome, delivery outcome, or key-version columns. The live table was not changed.

The `trainees` table has `coach_user_id`, `auth_user_id`, `approval_status`, `phone_normalized`, and `archived_at`; the coach assignment is therefore available for a database-side ownership predicate. The `profiles` table exposes `id` and `role`.

### Required atomic coach review operation

Do not implement review as a separate ownership SELECT followed by an UPDATE. The candidate must perform a single database-side operation/transaction that:
1. receives request ID, authenticated actor UUID, and decision;
2. verifies actor profile role is coach;
3. joins the request's trainee and checks the trainee's *current* `coach_user_id = actor UUID`, active status and non-archived state;
4. conditionally changes only a `pending` request and records `reviewed_by = actor UUID`;
5. returns only a minimal success/result marker, never phone, code, or trainee data.

The Edge Function must derive actor UUID from a validated Supabase Auth user, never from request JSON. The RPC/table operation must be inaccessible to anon/authenticated callers and executable only by the server service role. Review its privileges, fixed search_path, schema qualification, and SECURITY DEFINER necessity before writing SQL. The exact function signature and migration are intentionally not supplied as deployable SQL until the candidate schema and grants are reviewed.

### Candidate schema additions to design (not applied)

- Unique operation identifier for each Auth password-update attempt.
- Processing-start timestamp and terminal/unknown Auth outcome marker.
- Delivery attempt/operation identity and delivery outcome marker (without plaintext code).
- HMAC key-version identifier.
- One authoritative attempt cap and an atomic counter operation.

Do not assume the database and Supabase Auth can share a transaction. An Auth timeout or transport error must leave the operation locked as unknown; no blind retry and no reopening of the same code.

### Delivery provider decision

The current Test function contains a direct Mediana request; the current Production function instead returns the plaintext code to the coach. Neither is acceptable as the candidate delivery contract. Keep delivery behind an injected provider interface. In automated tests, use a capture-only fake provider that records only synthetic test fixtures in isolated memory. Production delivery cannot be implemented until the user chooses an available provider and its delivery semantics (especially timeout/accepted-but-response-lost behavior) are verified.


## Atomic RPC candidate drafted and exercised on disposable PostgreSQL (2026-11-22)

Candidate SQL (documentation/experiment only):
`docs/experimental/migrations/20261122_recovery_atomic_rpc_candidate.sql`

Candidate test:
`docs/experimental/test-recovery-atomic-rpc-candidate.js`

The draft adds durable operation metadata (`operation_id`, `processing_started_at`, `auth_outcome`, `auth_attempted_at`, safe error code, and HMAC key version), extends active uniqueness to include `processing`, and creates server-only functions in a non-exposed `recovery_private` schema. Function execution is granted only to `service_role`; schema usage and function execution are revoked from `PUBLIC`, `anon`, and `authenticated`. All SECURITY DEFINER functions pin an empty search_path and schema-qualify relations.

Tested behaviors on a disposable PostgreSQL 16 service:
- a former coach cannot approve after a concurrent reassignment commits; the RPC locks the trainee row and evaluates the current assignment;
- archived/inactive trainees are rejected;
- coach RPC response is minimal (no phone/code/trainee details);
- nine concurrent invalid-code attempts admit exactly five increments and expire/clear the token at the cap;
- two concurrent correct-code claims have exactly one winner;
- a processing request remains protected by the active-request unique index;
- the Auth operation can transition from attempting to unknown and remains locked; only an explicit authoritative reconciliation outcome can return it to approved or completed;
- confirmed completion consumes the code;
- null/invalid transitions fail closed;
- anon cannot use the private schema/functions; service_role can.

Full experiment workflow run `45047881214` completed **success**. The job log confirms it checked out the latest candidate SQL commit `9745175f69d93e2eb2a113ee3250782c3f11fe70`, not merely the workflow-trigger commit.

Evidence boundary:
- This is a candidate SQL draft exercised against fixture tables on disposable PostgreSQL 16 only.
- It has not been applied to Supabase Test or Production.
- It does not yet implement the Edge Function adapter, real Supabase Auth calls, SMS delivery, or real HTTP authorization.
- The operation ID is a durable marker, not proof of exactly-once semantics across Postgres and Auth. An unknown outcome remains locked until a separately verified authoritative reconciliation procedure is available.
- Delivery needs its own durable idempotency/outcome design before coach approval can safely trigger a real provider.
- No live project data or passwords were changed.


## Delivery idempotency and legacy-row migration guard (2026-11-22)

The disposable PostgreSQL candidate now also models SMS delivery separately from code approval:
- approval creates a unique `delivery_operation_id` and sets `delivery_outcome='pending'`;
- `begin_recovery_delivery` allows one provider attempt for that operation;
- confirmed provider acceptance records `sent`;
- confirmed non-delivery clears the code and returns the request to `pending`;
- timeout/uncertain provider result records `unknown`; the code cannot be redeemed while delivery is unknown;
- only authoritative reconciliation can change unknown delivery to sent or confirmed failure;
- `claim_recovery_reset` requires `delivery_outcome='sent'`.

The candidate migration now refuses to run if legacy rows are already `approved` or `processing`. This is intentional: their delivery/Auth outcomes cannot be reconstructed from the current schema. A live migration must first receive an explicit, reviewed disposition for each such row; it must not silently strand or reopen existing requests.

The latest disposable PostgreSQL test run also proves the preflight guard, one-attempt delivery, unknown-delivery redemption lockout, confirmed-failure reset, and authoritative delivery reconciliation. The provider itself is still not integrated; no live SMS has been sent.


## Atomic public request submission candidate (2026-11-22; CI verification pending)

Added `recovery_private.submit_recovery_request(text)` to the experimental SQL draft. It accepts only a normalized Iranian mobile, requires exactly one active non-archived trainee with an Auth user, refuses ambiguous duplicate phone records, locks the trainee row, and inserts one pending request with conflict handling against the active-request partial unique index. It returns only an internal boolean and is intended for the Edge Function's service-role client after rate limiting. The public handler must return the same generic 202 response for eligible, ineligible, duplicate, and unknown accounts.

The disposable test now covers eight concurrent submissions for one synthetic account (exactly one row), ambiguous duplicate numbers, unknown numbers, and the function privilege boundary. The latest workflow is running; do not mark this new request-RPC test passed until its PostgreSQL job completes.
