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

## CI verification refresh — 2026-11-23 (run #324)

The current branch head `75c07269452a2dc18786965566cf3a368e12c61b` triggered GitHub Actions run `45117908781` (#324) via the Draft PR. The run completed with conclusion `success`; all four jobs and their listed steps completed successfully:

- `mock-recovery-tests`
- `deno-edge-candidate-check`
- `postgres-concurrency-tests`
- `supabase-local-auth-integration`

This confirms the current branch's existing mock/crypto/handler/authorization checks, disposable PostgreSQL concurrency and PostgREST contracts, Deno type-check, and isolated local Auth probe. It does **not** add a unified request-to-redemption E2E job: the four jobs remain separate, and the local Auth job explicitly starts the disposable Auth stack only. The PostgREST old-access-JWT observation remains unresolved.

No application code, migration, main branch, hosted Supabase project, Auth account, or SMS provider was changed or exercised by this verification. PR #260 remains open and Draft. **Release decision remains NOT APPROVED.**

## CI verification refresh — 2026-11-23 (run #325)

The documentation-only audit update at branch commit `8551e35125dcfdb3a44d6972e396401249a186de` triggered run `45118331680` (#325). GitHub Actions reports `success` for all four jobs: mock recovery tests, Deno candidate type-check, disposable PostgreSQL/PostgREST contracts, and disposable local Auth integration. All listed steps completed successfully, including container shutdown.

This is a repeatability check of the existing separate suites, not the missing unified lifecycle E2E. In particular, the Auth integration still starts an Auth-only disposable Supabase stack; it does not run the recovery HTTP handler, Outbox worker, and Auth password update together against one shared stack/database.

The unresolved PostgREST old-access-JWT behavior, absent SMS provider adapter, and staging/operational acceptance gates remain unchanged. No live endpoint, hosted project, main branch, production data, or SMS provider was accessed. PR #260 remains Draft. **NOT APPROVED FOR RELEASE.**

## Full-E2E implementation preflight — 2026-11-23

A read-only dependency review was performed before changing the workflow:

- The current local Supabase integration starts an Auth-only stack and creates only a temporary JWT probe table; it does not initialize the recovery schema or run the HTTP handler/Outbox worker.
- The PostgreSQL candidate tests create their own synthetic `profiles`, `trainees`, and `trainee_password_recovery_requests` base tables, then apply the three candidate migrations. That fixture is not currently reusable by the local Auth test.
- The handler requires a real local Auth coach bearer token, a `profiles.role='coach'` row, and a trainee record linked to the coach. Its public request path calls the rate-limit and submit RPCs; approval uses the encrypted-review RPC and enqueues Outbox atomically.
- The Worker requires the same database, service-role Supabase client, encrypted delivery keys, and the fake-only provider. Reset must then use the same handler and real disposable local Auth Admin password update.

Therefore the missing E2E must be a new, single job—not a composition of the existing four jobs. Its runner needs to start the full disposable local Supabase stack (including Postgres and PostgREST), create Auth coach/trainee fixtures, create the minimal synthetic base schema with matching foreign-key relationships, apply the atomic/Outbox/encrypted candidate migrations in order, then run one loopback HTTP server around the dependency-injected handler. The test should request recovery as the trainee phone, authenticate the coach through local Auth, list and approve, process exactly one Outbox item with `FakeRecoverySmsProvider`, redeem the captured code over HTTP, and verify old-password rejection/new-password acceptance, wrong-code cap, expiry/replay behavior, and final request/Outbox state. Every resource must be synthetic and cleaned in `finally`; startup and teardown must be guarded, and all URLs must be loopback-only.

No existing base-schema migration for the recovery candidate was found under `supabase/migrations`; the only recovery base-schema fixture located is embedded in the disposable PostgreSQL test. This is a concrete fixture-integration task, not evidence that the full E2E already exists.

## CI verification refresh — 2026-11-23 (run #326)

Run `45118731576` (#326) completed successfully on branch commit `0ebe8b73973738bcf18e29143f2519a0d61dca51`. All four existing jobs passed. The local Auth job still explicitly starts an Auth-only disposable stack; no unified lifecycle E2E was added by this run.

PR #260 remains open and Draft. The E2E, provider, old-JWT, and staging/operational gates remain open. **NOT APPROVED FOR RELEASE.**

## Bounded access-token lifetime decision review — 2026-11-23

Official Supabase session documentation was reviewed against the local Auth/PostgREST observation:

- Supabase access tokens are self-contained JWTs. Global sign-out/password change revokes refresh/session state, but already-issued access JWTs remain usable by APIs that validate signature/expiry locally until `exp`.
- Supabase documents JWT expiry as configurable, with a general recommendation of 1 hour for most applications; it advises not going below 5 minutes because of clock skew, refresh traffic, and long-running requests.
- Supabase also documents checking the JWT `session_id` against `auth.sessions` for endpoints that require stronger immediate revocation guarantees. This is a targeted authorization check, not a reason to weaken RLS or blindly query session state for every ordinary read.

Repository inspection found no tracked `supabase/config.toml` in this experiment branch. The current CI creates a temporary project with `supabase init` in `/tmp`, so its default Auth configuration is not an explicit, versioned candidate policy.

Decision for this stage:
1. Do not change hosted Auth settings or production JWT lifetime.
2. Do not claim that password reset instantly invalidates all access JWTs.
3. For general app traffic, use bounded JWT expiry as the baseline; test a 15-minute (900-second) candidate in disposable local Auth first, including refresh behavior, long-running requests, clock-skew tolerance, and mobile reconnect/offline behavior. This is a proposed test value, not an approved production setting. Supabase's documented 5-minute lower guidance remains a hard floor for any candidate.
4. For truly sensitive operations that require immediate revocation, evaluate a narrow server-side `session_id`/active-session check against Auth session state (or an equivalent trusted revocation/version mechanism), with explicit performance and failure-mode tests. Do not weaken RLS, and do not add a broad per-query DB dependency without measurement.
5. A disposable proof must show: newly issued JWT contains the expected bounded `exp`; after password change/global sign-out, refresh fails; PostgREST accepts the old JWT only until expiry and rejects it afterwards; a newly refreshed/reauthenticated session works; and ordinary app refresh flows remain stable.

This resolves the architectural direction but does not close the JWT gate: the expiry value and any sensitive-route session check still require executable disposable tests and a staging decision. Sources reviewed: Supabase User Sessions, Signing Out, and CLI `auth.jwt_expiry` documentation.

## Disposable 15-minute JWT configuration probe — 2026-11-23 (CI #333)

The experimental Auth integration was extended without changing any hosted settings:

- The CI creates a fresh, unlinked project under `/tmp` and explicitly sets local `[auth].jwt_expiry = 900` before starting Supabase.
- The test decodes access-token claims and requires `exp - iat = 900` seconds for initial sessions and a newly authenticated session.
- A refresh performed before password change must succeed and the refreshed token must retain the 900-second lifetime.
- Password update must reject the old password, accept the new password, and revoke existing refresh tokens; Auth `getUser` rejects the old access JWT.
- The PostgREST probe continues to demonstrate the important residual behavior: it accepts the still-unexpired signed old JWT after password change/global sign-out. This is expected for local signature/expiry validation and is not evidence of immediate access-token revocation.

GitHub Actions run #333 (`45119214105`) completed successfully on branch head `e8cefa3db97e2376eb027617490c6ea278895259`; all four jobs passed, including the new 900-second claim assertions and the disposable local Auth/PostgREST probe. The test does **not** wait 15 minutes to observe actual expiry rejection, nor does it yet prove PostgREST rejects that same old JWT after expiry. Those remain explicit follow-up assertions. The session-id check for sensitive endpoints also remains design-only.

Clarification: the local Supabase command excludes auxiliary services (Studio, Realtime, Storage, Edge Runtime, etc.) but keeps the disposable Postgres and PostgREST services alongside Auth for this probe. It still does not run the complete recovery HTTP handler → coach approval → Outbox worker → redemption lifecycle against that same stack; unified recovery E2E remains open.

No production or hosted Auth setting was changed. No real trainee account, password, or SMS provider was used. **JWT gate remains open pending expiry-boundary/PostgREST rejection testing and a separate sensitive-operation revocation decision.**
## Targeted session_id/RLS revocation proof — 2026-11-23 (CI #336)

The disposable local Auth/PostgREST probe now tests the documented targeted session-control pattern on a synthetic protected table:

- It reads the session_id UUID from the signed access-token claims.
- It creates a uniquely named, non-exposed private schema and a SECURITY DEFINER SQL helper with an empty search_path.
- The helper checks that the matching auth.sessions row belongs to auth.uid() and is still within not_after (when set).
- Execute/usage grants are limited to authenticated; the synthetic RLS policy requires both row ownership and an active session.
- Before global sign-out, the still-valid token can read the synthetic row. After global sign-out, Auth rejects the token and the same unexpired JWT receives an empty result under the session-aware policy.
- The test drops its synthetic table and private schema and deletes the disposable Auth user in cleanup.

GitHub Actions run #336 (45119868125) completed successfully on commit 4fd4fd1dc884173a908c1cc29e2ea779b1441b78; all four jobs passed. The Auth job explicitly logged that the active session was allowed before sign-out and denied after sign-out, despite the JWT remaining unexpired.

This is a proof of a narrow RLS/session-check pattern in the local disposable stack, not an app-wide implementation or approval to add the check to every endpoint. Any production adoption must be limited to sensitive operations, review query cost/failure behavior, and verify the relevant coach/trainee authorization policies remain intact.

Still open:
1. Test PostgREST rejection of the same old token after its actual 900-second expiry; current test asserts the 900-second exp - iat claim but does not wait for expiry.
2. Decide whether 900 seconds is acceptable for real mobile/offline/reconnect behavior; it remains a candidate, not a production setting.
3. Implement and run the unified recovery HTTP → coach approval → fake Outbox delivery → redeem → local Auth password update E2E on one disposable stack.
4. Select and stage-test a real SMS provider adapter; no provider is currently enabled.
5. Complete staging security, observability, rollback, and operational acceptance.

No hosted Auth setting, production DB, main branch, real account, or live SMS was touched. PR #260 remains open and Draft. NOT APPROVED FOR RELEASE.
## Unified E2E fixture preflight — 2026-11-23

A closer read of the existing disposable PostgreSQL suite found a useful partial lifecycle test in test-recovery-outbox-postgres.js: it already drives the real candidate HTTP handler's request/review paths, executes the Outbox worker with FakeRecoverySmsProvider, checks encrypted payload clearing, and invokes the reset path. However, it injects a fake coach identity, hand-written admin RPC/query adapters, and a mocked Auth Admin password update. It does not use local Auth or PostgREST for that lifecycle, so it is not the required unified E2E.

The base-schema fixture is in test-recovery-atomic-rpc-candidate.js, not in the Outbox test. It currently drops/recreates public profiles, trainees, and recovery requests, and seeds static synthetic IDs. It must not be run against the same database as another suite or copied as a destructive setup step into a persistent environment.

Implementation requirements for the next isolated runner:
- Start one fresh local Supabase project/stack and use its own Postgres, PostgREST, and Auth together.
- Create two disposable Auth users (coach and trainee) through local Auth Admin, then create their matching profiles and one trainee row with coach_user_id, auth_user_id, active approval, normalized phone, and full_name (the HTTP coach-list query requires full_name).
- Build the minimal recovery base schema in that empty disposable database, then apply the atomic RPC, Outbox worker, and encrypted payload candidate migrations in dependency order. Never run the existing DROP/CREATE fixture against a non-empty or hosted DB.
- Replace the fake handler admin adapter with a real service-role supabase-js client; createUserClient must validate the actual coach bearer token against local Auth.
- Run request over loopback HTTP; list and approve as the coach; process the queued item with FakeRecoverySmsProvider; capture the synthetic code only in test memory; redeem via HTTP; verify old password fails, new password succeeds, refresh/session revocation, replay rejection, and final request/Outbox states.
- Keep all fixture credentials and key material generated per job, reject non-loopback URLs, prohibit real provider instances, and clean up both Auth users, fixture rows/schemas, server, and local stack in finally/always teardown.

Existing coverage can be reused conceptually, but no shared runner has been created yet. The next implementation must preserve the separate existing suites and must not falsely count their combined green status as full E2E.
## Actual JWT expiry-boundary test added — 2026-11-23

The local Auth/PostgREST test now retains the exact access JWT used for the session-revocation probe, reads its signed exp claim, waits until exp + 2.5 seconds, and sends that same token to the disposable PostgREST endpoint. It requires HTTP 401 or 403 after actual expiry. This complements the existing assertion that exp - iat equals 900 seconds and the pre-expiry acceptance/session-aware RLS checks.

The Auth integration job timeout is 25 minutes, sufficient for the 15-minute expiry wait plus setup and teardown. The workflow path filter now explicitly includes test-recovery-auth-local-stack.mjs so changes to this test cannot silently skip CI. Runs #340 and #341 were triggered by the test and workflow changes; their Auth jobs are still running at the time of this note. Actual expiry rejection is therefore implemented as an assertion but is NOT yet marked proven until a complete green run finishes.

No hosted JWT setting or application runtime behavior was changed. The 900-second value remains local experimental configuration only.

## Actual JWT expiry result — 2026-11-23 (CI run 45125079476)

The corrected disposable Auth/PostgREST integration test completed successfully on commit `934f7b6a1917c235ea4d1c2d7075908e1d74fb29`:

- The test configured only its disposable local Auth stack with a 900-second JWT lifetime and verified the issued token's `exp - iat` claim.
- It retained the exact access JWT from an active synthetic session, waited approximately 903 seconds until after its signed expiry, and verified the targeted session-aware RLS policy denied access to the synthetic protected row.
- The earlier run demonstrated that the same expired JWT could still receive HTTP 200 under baseline ownership-only RLS in this local setup. The corrected test therefore adds an explicit JWT `exp` comparison to the synthetic session-aware policy, in addition to checking `auth.sessions`.
- The same job also passed the password-update, old/new password, refresh-token revocation, Auth `getUser` rejection, and global-sign-out session checks.
- All five jobs in run `45125079476` passed, including the unified disposable local recovery E2E, PostgreSQL concurrency/Outbox tests, mock recovery tests, Deno candidate check, and Auth integration test.

**Scope limitation:** this proves the explicit `exp` + `session_id` predicate only on a synthetic disposable table and local stack. It does not mean application RLS policies have been updated, that every app table/RPC/Storage surface is covered, or that 900 seconds has been approved for real mobile sessions. No hosted Supabase project, main branch, mirror branch, production data, real user, or SMS provider was changed.

Remaining release blockers:
1. Inventory and review all application data surfaces and RLS/Storage/RPC policies; decide where targeted session and expiry enforcement is required.
2. Validate JWT lifetime and refresh behavior for real Android/iOS/web clients in an isolated staging environment before choosing a production value.
3. Select and stage-test a real SMS provider alternative; Mediana remains excluded and no provider is enabled.
4. Complete staging security, monitoring, secret rotation, rollback/reconciliation rehearsal, and explicit release approval.

CI run `45125079476` is a successful candidate test run, **not production release approval**. PR #260 remains open and Draft. Release remains **NOT READY FOR PRODUCTION**.

## Main-branch application RLS inventory — partial repository audit — 2026-11-23

Read-only review of the complete Git tree on main (101 tracked paths) found 10 Supabase migration files, one Edge Function, and no checked-in base schema/dump or general-purpose RLS baseline migration. All 10 migration files were opened; relevant policy/function definitions in the nine security/data migrations were inspected. The CERELAC migration is an intentionally non-automatic reference-data INSERT and does not define access controls.

### Findings visible in the checked-in migrations

- trainee_push_subscriptions: RLS is enabled; authenticated CRUD grants are constrained by four trainee-owner policies joining trainees.auth_user_id to auth.uid(). The policies are ownership-based and do not independently check JWT exp or an active Auth session row.
- trainee_body_analysis_publications: RLS is enabled; table access is revoked from anon/public; authenticated receives SELECT/INSERT and later DELETE. Coach policies require coach role, matching coach_user_id, and current trainee assignment. Trainee SELECT delegates to private.can_access_trainee. No trainee write policy is created.
- trainee-health-reports Storage read policy: restricts to active trainee and exact folder identity, with own-trainee or assigned-coach checks. Coach DELETE policy is limited to the assigned trainee's published folder. The report migration only appends text/html to the existing bucket MIME allow-list; it does not define the bucket's full policy set.
- Workout and nutrition atomic RPCs use SECURITY DEFINER for coach writes, check authenticated identity, coach role, and private.can_access_trainee, and revoke PUBLIC/anon execution while granting authenticated execution. Experimental workout RPCs follow similar checks. These functions still depend on correctness and security configuration of private helper functions and underlying grants.
- record_trainee_progress is SECURITY INVOKER, rejects coach callers, and checks that the caller is the active trainee owning the exact trainee row. It relies on underlying table RLS/grants.
- send-coach-chat-push uses a service-role admin client after validating the caller with Auth and checking that the authenticated user is the trainee's assigned coach before reading subscriptions and sending pushes. Because service role bypasses RLS, the function's explicit authorization check is security-critical.

### Material gaps / not yet verified

1. The repository does not contain the complete foundational schema or all historical migrations. Base RLS policies for core tables such as trainees, weight_logs, body_analyses, nutrition_plans, workout tables, foods, and private helper functions private.is_coach() / private.can_access_trainee() cannot be established from this repository snapshot.
2. The full Storage policy set, bucket configuration, and policies for existing archived PDF/report objects are not reconstructible from additive migrations alone.
3. A complete inventory of public views, materialized views, exposed RPCs, table grants, default privileges, or direct client PostgREST access cannot be claimed from this partial migration history.
4. The ownership-only policies noted above do not themselves enforce JWT expiry or Auth session revocation. The local synthetic proof described earlier demonstrates one possible targeted predicate, not app-wide coverage.
5. Runtime verification against hosted Supabase was deliberately not performed. No SQL was run against either hosted project and no policy, grant, Auth setting, storage object, or user data was changed.

### Audit status

This is a first-pass inventory of checked-in additive migrations, not a complete RLS/security sign-off. Production release remains NOT READY. Next required evidence is the actual schema/policy/grant inventory from a disposable or explicitly approved staging database, including pg_policies, table/sequence/function privileges, views and Storage policies, followed by per-surface ownership and session/expiry tests. Do not infer missing policies from absence in this repository, and do not apply policy changes based on this partial review.