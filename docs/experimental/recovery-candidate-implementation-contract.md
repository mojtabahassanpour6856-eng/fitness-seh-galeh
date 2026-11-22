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
