# Password Recovery Candidate — Final Security & Acceptance Audit

**Audit date:** 2026-11-23  
**Scope:** Experimental branch only; no production deployment or live SMS delivery.

## Reviewed revision

- Branch: `experiment/trainee-password-recovery-mock-20261122`
- Reviewed commit: `dc9de7d91b47ddb27bcd6f26653f681911b73872`
- Pull request: #260 — open, Draft, not merged.
- CI run: `45066698369` — completed successfully.

## Evidence from automated checks

All four jobs in the recorded CI run completed with conclusion `success`:

1. `mock-recovery-tests`
2. `deno-edge-candidate-check`
3. `postgres-concurrency-tests`
4. `supabase-local-auth-integration`

The disposable PostgreSQL job reported successful checks for:

- Concurrent request submission and atomic rate limiting.
- Coach reassignment/authorization race and duplicate approval.
- Concurrent wrong-code attempts capped at five.
- Single-use reset claim and active-request uniqueness while processing.
- Unknown Auth outcome cannot be reopened by retry.
- Confirmed success consumes the code; confirmed no-change is handled separately.
- Outbox enqueue is atomic with approval.
- Worker lease generation fences stale heartbeat, send-start, and completion.
- Expired lease after durable send-start becomes `unknown`; no automatic second claim.
- Anonymous/authenticated roles cannot read Outbox or execute worker RPCs.
- Ambiguous delivery remains `unknown` and is never automatically retried.
- HTTP request + authenticated coach approval + disposable PostgreSQL + encrypted Worker + fake SMS provider + terminal payload cleanup.
- HTTP reset handler + real disposable PostgreSQL claim/begin/finish RPCs + one mocked Auth password update.

The local Supabase Auth job used a disposable local stack and a disposable test user. It verified password update, rejection of the old password, acceptance of the new password, and session/refresh-token revocation behavior. It did not connect to the production Supabase project.

The mock Worker regression suite also covers definite provider rejection, ambiguous provider timeout/response, lost lease, database read failure, encrypted payload failure, and refusal to accept a real provider implementation.

## Security boundary review

- Candidate migrations and tests are run only against disposable CI PostgreSQL.
- Local Auth integration is isolated and loopback-only.
- Worker accepts only the fake SMS provider in this experiment.
- Recovery RPCs are service-role-only; direct table writes are restricted.
- Payload encryption uses AES-256-GCM with request/operation-bound AAD.
- Ambiguous delivery or Auth outcomes fail closed and are not automatically retried.
- The candidate Edge adapter is contract-checked and type-checked, but remains outside the deploy path.
- No production migration, production Auth account, live SMS provider, or production student data was touched.

## Acceptance decision

**Automated candidate checks: PASS.**  
**Production / limited-user release: NOT APPROVED YET.**

The following release gates remain open and require a separately approved staging environment:

1. Apply the reviewed migration sequence to a disposable Supabase staging project that matches the target schema/extensions/roles; verify migration ordering, rollback/recovery plan, and PostgREST RPC visibility.
2. Deploy the Edge candidate to staging only, with isolated secrets and no production credentials; exercise real HTTP requests through the deployed endpoint and confirm coach authorization and CORS.
3. Select and implement the approved SMS provider adapter. Verify the provider's actual idempotency semantics, delivery receipts, timeout behavior, and reconciliation procedure. No live SMS test has been performed.
4. Run end-to-end acceptance with dedicated test coach/trainee accounts: request, coach approval, queued delivery, code redemption, wrong-code cap, expiry, replay, archived/reassigned trainee, and Auth session behavior.
5. Complete operational controls: secret provisioning/rotation, log redaction review, alerts for `unknown` states, and a documented manual reconciliation procedure.
6. Obtain explicit approval before any production migration, deployment, real SMS, or main-branch merge.

A successful CI run is not evidence that production infrastructure, provider behavior, or real-user UX has been validated. Do not merge this Draft PR or deploy this candidate until the gates above are completed and approved.
