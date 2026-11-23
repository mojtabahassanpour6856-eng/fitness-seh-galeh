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


## Updated release decision — 2026-11-23 (CI #322)

Latest reviewed branch head before this note: `e31743a5df11b389488727930963eba84e222874`. GitHub Actions run #322 (`45116693142`) completed successfully on its tested code/documentation parent `d60221548ed4e9b8f3b0ad0d5d1ff078b1f0fe1b`; all four jobs passed. This confirms the existing isolated unit, SQL/PostgreSQL concurrency, PostgREST contract, Deno type-check, and disposable local Auth probes. It does **not** constitute a single-stack end-to-end recovery run or staging acceptance.

### Release-blocking facts re-confirmed

1. The Edge adapter remains in `docs/experimental`, not `supabase/functions`, and deliberately has no `deliveryAdapter`. Coach approval therefore cannot deliver a code. There is no selected, configured, or tested SMS provider. The previously deployed Test function's Mediana path is not an acceptable substitute while Mediana is unavailable/restricted.
2. Existing local Auth tests show refresh-token revocation and Auth `getUser` rejection after password change/global sign-out, but PostgREST still accepts an unexpired old JWT. No bounded JWT lifetime or server-side session/version enforcement has been implemented.
3. The requested single-stack E2E (one disposable Supabase stack/database running trainee request → authenticated coach approval → fake Outbox delivery → HTTP redemption → Auth password update → old/new password and replay assertions) is not present. Current CI jobs are separate.
4. No staging migration/deployment, real test-account end-to-end flow, real provider delivery, provider idempotency/reconciliation, mobile/desktop UX acceptance, operational alerts, or rollback rehearsal has been completed.
5. PR #260 remains **open and Draft**. It must not be merged or marked ready for release.

### Fastest safe path to a releasable candidate

- First, choose the SMS provider and verify delivery/idempotency/receipt semantics in an isolated staging account. Do not re-enable Mediana by assumption.
- In parallel, choose the explicit old-access-token guarantee and implement/test it without weakening RLS.
- Complete the single-stack disposable E2E and then run staging-only migrations, Edge deployment, dedicated test coach/trainee flow, security/log review, and rollback/reconciliation rehearsal.
- Only after those pass, request separate explicit approval for Production migration, provider credentials/live SMS, deployment, and merge.

**Final decision: NOT APPROVED FOR RELEASE.** A production-ready package cannot truthfully be declared while delivery is disabled, old JWT residual access is unresolved, and full E2E/staging acceptance is absent. No Production or Supabase hosted setting/data was changed by this update.
