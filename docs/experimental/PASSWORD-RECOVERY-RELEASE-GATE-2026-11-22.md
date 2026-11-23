# Password recovery release gate — 2026-11-22

Status: **NOT READY FOR PRODUCTION**. This is a read-only audit report plus isolated test artifacts. No Supabase schema/function was changed and no live SMS was sent.

## Verified in isolated CI
- Mock state-machine suite passes.
- Disposable PostgreSQL tests use two independent sessions and pass the conditional claim race (exactly one winner).
- The existing partial unique index behavior was reproduced: `processing` is outside the active-state predicate and allows a second pending row.
- The exact draft migration in `migrations/20261122_include_processing_in_active_recovery_unique_index.sql` was executed against a disposable PostgreSQL table. It blocks a second active flow while processing and allows a new request after completion.
- Concurrent atomic counter fixture admits exactly the configured cap.
- Latest CI runs 45 and 46 succeeded. These are isolated CI results, not Supabase integration results.

## Read-only live environment checks
- Test and Production currently have zero trainees with more than one row in `pending`, `approved`, or `processing`.
- Both environments still have the old partial unique index that excludes `processing`.
- Test Edge Function `trainee-password-recovery` is ACTIVE at version 10. It is not the candidate branch code.
- The Test Edge Function source still contains a direct call to Mediana's pattern SMS endpoint. Do not approve or deploy this path while Mediana is unavailable/restricted.

## Blocking defects found in the currently deployed Test Edge Function source

### P0 — must fix before any release
1. **Ambiguous Auth outcome reopens the code.** On any `updateUserById` error, the handler changes `processing` back to `approved`. A transport failure may occur after Auth committed the new password; reopening the code can permit replay. The handler needs durable operation identity and authoritative reconciliation. Unknown must remain locked.
2. **No real provider path is currently releasable.** Coach approval calls Mediana directly. Mediana is currently unavailable for this deployment path. Do not send live messages or deploy a function that relies on it until a supported provider and credentials are explicitly selected and tested.
3. **The real Test HTTP/Auth flow has not been exercised.** No isolated test Auth account has completed request → coach review → delivery → reset → login with the new password. No wrong-coach/invalid-token endpoint tests have been completed.
4. **Session invalidation is unverified.** Password update success does not prove old refresh/access sessions are revoked. Test and document the actual Supabase Auth behavior and add explicit revocation if required.

### P1 — must fix before production
5. **Public response enumeration.** The request action returns different messages/statuses for no eligible account, existing open request, and inserted request (including 200 vs 201). Make public status, response shape, and message uniform.
6. **Request lookup omits processing.** The handler's duplicate lookup searches only pending/approved. The new database index would prevent a duplicate insert, but the handler should also treat processing as an active flow and return the same generic public response.
7. **Wrong-code counter is read-then-write.** Concurrent invalid attempts can overwrite each other's increments. Replace with a single atomic database operation and test concurrent requests against real Postgres.
8. **Token generation has modulo bias.** Replace the deployed four-digit generator with rejection sampling using cryptographically secure random bytes.
9. **Code digest uses plain SHA-256.** Use HMAC-SHA-256 with a dedicated high-entropy server secret, stored separately from database data, and plan secret rotation.
10. **Rate limit and lockout thresholds disagree.** Handler checks 5 attempts but the claim update permits values below 10. Define one authoritative threshold and enforce it atomically.
11. **CORS allows every origin.** Restrict to the actual app origins where practical; CORS is not authentication but should not be wildcard by default.
12. **Migration deployment strategy needs a lock/rollback review.** The draft is only for the isolated experiment. Before any real DB application, review table size, index build lock impact, migration transaction behavior, rollback, and verify no conflicting active rows immediately before deployment.

### P2 — hardening and operational readiness
13. Ensure logs never contain plaintext codes, full phone numbers, passwords, or secrets; inspect actual Edge Function logs.
14. Add durable processing timestamps, operation IDs, outcome/error fields and a reconciliation/admin recovery path for stuck processing rows.
15. Test expired code, replay, wrong code, request rate limits, coach reassignment, inactive trainee, malformed payloads, and duplicate approval against real HTTP handlers.
16. Add monitoring/alerting for stuck processing, failed delivery, repeated invalid attempts, and unexpected Auth outcomes.
17. Document support recovery procedure for ambiguous Auth outcomes without allowing blind code reuse.

## Required release gates
- [ ] Corrected candidate Edge Function reviewed and committed on the experiment branch.
- [ ] Mock suite passes.
- [ ] PostgreSQL migration and concurrency suite pass on disposable PostgreSQL.
- [ ] Migration applied to Supabase Test only after explicit approval; schema/index verification passes.
- [ ] Test-only SMS adapter/provider verified without exposing codes to coach or logs.
- [ ] Real Test Auth account completes full end-to-end flow.
- [ ] Wrong-coach, account-enumeration, replay, expiry and rate-limit HTTP tests pass.
- [ ] Old-session behavior verified.
- [ ] Security advisors and Edge Function logs reviewed.
- [ ] Rollback and stuck-operation reconciliation procedure tested.
- [ ] Separate explicit approval before any Production migration/deployment.

## Safety boundary
No Production changes, no Test schema writes, no Edge Function deployment, no password mutation, no trainee record mutation, and no live SMS were performed during this audit. The experimental migration is a draft and must not be applied directly to Production.


## Additional read-only Supabase Test checks (2026-11-22)
- Security Advisor returned: leaked-password protection disabled (project-wide Auth hardening); one externally executable SECURITY DEFINER function `public.save_coach_nutrition_builder_plan(jsonb)` (not part of password recovery); five RLS-enabled/no-policy informational findings in archive/experimental tables (not the recovery table).
- Performance Advisor returned unused-index and multiple-permissive-policy notices across other app tables. These are not a reason to change unrelated production policies during this recovery work.
- Unified logs query for the last 24 hours returned 2 edge log entries and zero entries whose message text mentioned `trainee-password-recovery`. This does not prove the endpoint is unused or working; it only means no matching function-name mention was found in that log window.
- No logs containing personal phone numbers or recovery codes were retrieved or displayed.
- The recovery-specific RLS state remains as previously verified: RLS enabled and deny-all policies for anon/authenticated; the function uses server-side service role access.

## Interpretation
The Test project's global security warnings must be triaged separately and not "fixed" wholesale as part of password recovery, because unrelated policy changes could affect existing app functionality. Leaked-password protection is a worthwhile Auth hardening item, but enabling it is a project setting change and has not been performed.


## Focused cryptographic regression tests added (2026-11-22)
- Added `docs/experimental/test-recovery-crypto.js` to exercise the 16-bit rejection-sampling boundary (reject 60000 and 65535; accept 59999), preservation of leading zeroes, HMAC-SHA-256 key separation, and malformed digest/short-secret rejection.
- Updated the experiment workflow to run this focused suite alongside the existing mock and disposable PostgreSQL jobs.
- The files were committed to the experiment branch and read back for verification. At the time of this report update, no workflow run or commit status for the latest commit was returned by the GitHub connector; therefore this new suite is **authored but not yet CI-verified**.
- These are cryptographic helper tests only. They do not establish production secret configuration, real Edge Function behavior, Auth outcome reconciliation, HTTP privacy, or provider delivery.


## Read-only review of the deployed Test function source (2026-11-22)
The active Test Edge Function was retrieved again (version 10, SHA `f9bbda8b8d0f38d266fe009a0492ca5008f7f1fc4bd531bf60f70ec302331678`). This was a read-only source inspection; no invocation, deploy, database write, password update, or SMS was performed.

Confirmed directly in the currently deployed source:
- Public `request` responses are not uniform: an ineligible/nonexistent account returns HTTP 200 with a generic message; an existing open request returns a different HTTP 200 message; a newly inserted request returns HTTP 201. This is a concrete account/request-state disclosure and remains P1.
- The public `reset` action looks up the newest `approved` row by phone, uses a plain SHA-256 code digest, and increments `token_attempts` with a read-then-write update. These confirm the previously recorded digest and concurrency findings.
- The claim changes `approved` to `processing`, but the claim filter still uses `token_attempts < 10` while the handler pre-check rejects at 5. This threshold mismatch remains.
- If `admin.auth.admin.updateUserById` returns an error, the handler unconditionally attempts to move `processing` back to `approved`. The source does not distinguish a definite no-commit rejection from a timeout/ambiguous outcome. This confirms the P0 replay risk.
- After Auth success, failure to persist `completed` is logged, but the endpoint still returns success. The durable row can remain `processing`; this requires an operation/reconciliation design and monitoring.
- Coach approval writes the code digest and `approved` state before contacting Mediana. On timeout or unsuccessful provider response it attempts to restore `pending` and clear the token. If the provider accepted the SMS but the response was lost, delivery outcome is ambiguous and the code is invalidated; a provider-outcome state/reconciliation path is needed.
- CORS remains wildcard. Coach actions do authenticate a Bearer token and check coach role/trainee assignment in the retrieved source, but no real HTTP authorization test has been performed.

## CI status caveat
The focused crypto test and workflow edits were committed to the experiment branch. The GitHub connector returned no workflow-run records or commit status for the latest push, so CI execution for that commit remains **unverified**. The test file and workflow configuration were read back successfully; this is not equivalent to a passing run.


## Additional fail-closed mock coverage (2026-11-22)
The in-memory experimental engine and its tests were extended on the experiment branch:
- `RESET_UNKNOWN` is verified to remain locked after advancing beyond the request TTL and running the generic expiry sweep; a new recovery request is rejected.
- An authoritative reconciliation lookup that throws leaves the Auth operation in `RESET_UNKNOWN`.
- A re-entrant second request is blocked while the Auth adapter is executing in `RESET_PENDING`.
- Repeated coach approval after successful mock delivery is idempotent and does not generate or deliver a second code.
- **Safety correction:** `DELIVERY_UNKNOWN` is no longer auto-expired by the generic request-TTL sweep. A potentially accepted-but-unacknowledged SMS must not silently release the trainee into a second recovery flow. The test now verifies that the state remains locked and neither a new request nor blind re-approval can proceed.

Commits:
- Engine fail-closed correction: `fa959b9aa995659345ddd2f0c1c61d5f817fa0df`
- Extended mock tests: `b187dbc52934cf87fcae417242a6d795d6c4148c`
- Ambiguous delivery assertion correction: `c70b82b16ee48b82f6875465b8cd487e3b62b6ca`
- Final assertion correction: `362910eb3af96516f84944850f2336ade9ce102a`

These are in-memory mock tests only. The actual deployed Edge Function still has no durable provider reconciliation mechanism. The GitHub Actions workflow is configured to run the expanded tests on pushes to this experiment branch, but the available GitHub run/status interface did not expose a run for the latest commits; execution remains **unverified** until the Actions run itself is inspected.


## Non-mutating real-HTTP smoke harness added (2026-11-22)
Added `docs/experimental/test-recovery-http-smoke.js` on the experiment branch. It is deliberately limited to:
- an OPTIONS CORS preflight using a synthetic origin;
- a GET method-rejection probe expecting HTTP 405.

It refuses non-Supabase hosts or an unexpected function path. It sends no POST action, creates no recovery row, does not approve/reject requests, does not change passwords, and cannot send SMS. It is a safe first HTTP probe, not an end-to-end recovery test.

The smoke harness asserts that CORS is an explicit allowlist and will correctly FAIL against the currently inspected Test source because that source returns `Access-Control-Allow-Origin: *`. It has not been run against the Test endpoint; no endpoint request was sent in this step. To run it after an approved CORS candidate is deployed to Test, set `RECOVERY_TEST_FUNCTION_URL` to the Test function URL and execute:
`node docs/experimental/test-recovery-http-smoke.js`

Commit: `964007729b590741fa5b6088d555c225aa8731bc`.

## Next real integration prerequisites
The full HTTP/Auth matrix must not be attempted using ordinary trainee accounts. It requires a dedicated disposable Test Auth user, a matching isolated trainee row and coach assignment, a test-only SMS adapter that cannot reach Mediana, and explicit approval for any Test database writes or function deployment. Until those prerequisites exist, only non-mutating HTTP probes and disposable local fixtures are appropriate.


## HTTP smoke harness review and execution limitation (2026-11-22)
- Reviewed the first smoke-test draft and tightened its CORS assertions: it now requires the exact configured app origin to be allowed and separately verifies that a synthetic unapproved origin is not granted access. This avoids the flawed assumption that a synthetic origin itself should be allowlisted.
- The harness still sends only OPTIONS and GET; it has no POST path and cannot create or mutate recovery requests.
- A live, non-mutating network probe was attempted from the available execution environment, but DNS resolution for the Supabase Test host failed before any HTTP connection could be established. Therefore no HTTP status/header result was obtained and no endpoint behavior is claimed as tested.
- Updated harness commit: `06bf7c89160100dab408c1e1209124ef870435a9`.
- Required environment variables when running from a network-enabled trusted environment: `RECOVERY_TEST_FUNCTION_URL` and `RECOVERY_ALLOWED_ORIGIN`. Use the actual approved Test app origin; do not use a wildcard.
- This does not alter the release gate: live HTTP/Auth integration remains unverified, and Production remains NOT READY.


## Static safety guard for the HTTP smoke harness (2026-11-22)
- Added `docs/experimental/test-recovery-http-smoke-contract.js`. It statically checks that the live smoke harness contains only OPTIONS and GET fetch methods, pins the expected Supabase function host/path, checks the explicit allowed-origin and denied-origin assertions, and contains no recovery action payload or POST method.
- Added this guard to the experiment GitHub Actions mock job and its path filters. This is a safety check for the test harness itself, not an endpoint integration test.
- Ran an equivalent local Node.js static contract check against an isolated copy of the harness structure; it passed. The GitHub Actions run for the resulting branch commit is not visible through the available workflow-run connector, so CI remains unverified.
- Contract test commit: `c0ea23b4d8b998f3daaae38da6a9767d3e708d94`.
- Workflow update commit: `b4617bed344d663a91514ee8dfdcad16439e5948`.
- No Supabase endpoint request, database write, password update, SMS, or deploy occurred.


## Focused authorization and abuse regression suite added (2026-11-22)
Added `docs/experimental/test-recovery-authorization-abuse.js` to the isolated experiment branch. The suite covers:
- identical generic denial text for wrong-owner versus unknown request reads (coach and trainee);
- wrong-coach approval/rejection attempts leave state unchanged and trigger no mock delivery;
- duplicate coach approval is idempotent and invokes the delivery adapter only once;
- the configured wrong-code attempt cap expires the code and clears its digest;
- expired codes cannot be replayed;
- idempotency-key reuse with different ownership data is rejected.

The suite uses only the in-memory MockRecovery engine and mock delivery adapter. It does not test HTTP response uniformity, JWT verification, Supabase RLS, database atomicity, real provider behavior, or production authorization. Those remain separate integration gates.

Added the suite to the experiment workflow and path filters. The new workflow execution has not been independently observed; combined status/workflow-run lookup for the current branch commit may be empty through the available connector. Do not treat the suite as passed until an actual run is visible.

Test file commit: `aa6ec9349d6f11f6592a40fb1fdefedff7b18a4c`.
Workflow update commit: `3fd444ba7ce7139f4d76a16a535bd2150b69d8a7`.
No Supabase endpoint, database, Auth user, password, SMS provider, or Production resource was accessed or changed.


## Reassignment read-access recheck added (2026-11-22)
A focused review found that the in-memory `getForCoach` read helper checked the request's stored coach ID but did not re-check the trainee's current coach assignment. The experimental helper now also compares the trusted current-assignment resolver with the request's coach before returning a snapshot. A regression case verifies that after reassignment the former coach cannot read the old request and the newly assigned coach cannot inherit that old request; a fresh request must be started under the new assignment.

This is an in-memory mock hardening only. It does not alter the deployed Edge Function, database queries, RLS, or live authorization. Production must independently enforce current assignment at the server/query boundary on every read and transition.

Engine change commit: `e798c40227b7f444757fc10edf9a2c7528bf040e`.
Regression test commit: `c26850fa2cf3da17223216d0d55985b547646b1d`.
CI execution for these latest commits remains unverified through the available status lookup.


## Live Edge Function reassignment and delivery-path review (read-only, 2026-11-22)

Read the active `trainee-password-recovery` Edge Function in both Supabase projects; no invocation or write was made.

- Test project `udptdznbvewkublvzmtm`: active version 10, source SHA `f9bbda8b8d0f38d266fe009a0492ca5008f7f1fc4bd531bf60f70ec302331678`.
- Production project `qfakyudgidsumeuoqoot`: active version 9, source SHA `993d0c3a3a7aa2e2083b80131753c7b25c7180768cd87e9ba0ad180cb5ca18ae`.

### Reassignment checks found
- Coach `list` query is scoped by `trainees.coach_user_id = authenticated coach user id`.
- Coach `review` fetches the linked trainee and checks current `coach_user_id` against the authenticated coach before approval/rejection.
- However, the subsequent UPDATE is conditional on request ID and pending status, not on the current trainee-to-coach assignment in the same atomic database operation. A reassignment between the ownership read and UPDATE can create a time-of-check/time-of-use race. Re-checking in application code alone does not close that race; the final write must be bound to current assignment atomically (for example through a carefully reviewed database-side condition/transaction or an RPC with trusted actor identity).
- The coach list query returns only pending requests, so approved/processing/ambiguous requests are not surfaced for operational recovery.

### Release-blocking differences and remaining issues
- Both active versions still use wildcard CORS and `verify_jwt=false`; the function performs its own coach Bearer-token validation for coach actions, while public request/reset actions are intentionally unauthenticated. Runtime authorization and CORS behavior remain untested.
- Public request response is not uniform: unknown/ineligible accounts, existing open requests, and newly inserted requests receive different messages and/or HTTP 200 vs 201. Account/request-state enumeration remains possible.
- New-request duplicate lookup includes only pending/approved and omits processing.
- The reset path still uses plain SHA-256 for code digests, modulo-based code generation, and a non-atomic read-then-write wrong-attempt counter.
- If Auth password update returns an error, the handler reopens the same code by changing processing back to approved. The error outcome may be ambiguous; this can permit replay after Auth may already have changed the password. This is a P0 blocker.
- Completion-marker failure after Auth success leaves a processing row; there is no durable operation identity or authoritative reconciliation.
- Test version attempts Mediana SMS delivery after approval; Production version returns the plaintext recovery code in the authenticated coach response instead. These are materially different delivery behaviors. Neither path is approved for release: Mediana remains unavailable/restricted for this project, and delivering the code to the coach is not the intended trainee-direct delivery flow.
- Production version and Test version both remain active at their existing versions; no function was deployed or invoked.

### Release distance estimate
The project is still **NOT READY FOR PRODUCTION**. Remaining gates are not just cosmetic: they include a redesigned fail-closed Auth operation/reconciliation flow, atomic assignment-safe coach review, uniform public responses, active-state uniqueness including processing, safe code generation/HMAC, atomic attempt accounting, approved delivery provider, CORS allowlist, isolated real HTTP/Auth tests, session invalidation verification, logging/monitoring, and a reviewed rollback/reconciliation plan. A calendar estimate is not reliable until the chosen delivery provider and Test Auth environment are available and the candidate implementation is agreed.


## Follow-up implementation preparation (2026-11-22)

- Read-only Test schema inspection confirmed the recovery request table lacks durable Auth operation identity, processing-start time, Auth outcome, delivery outcome, and HMAC key-version fields. No schema changes were made.
- The current `trainees.coach_user_id` column is available to support an atomic database-side coach assignment check. The candidate must replace the current read-then-update review sequence with one privileged, narrowly scoped database operation that checks current assignment and pending status in the same transaction.
- The implementation contract now records the required RPC/transaction authorization shape, required schema additions, and test-only delivery adapter boundary.
- No candidate Edge Function source has been deployed or substituted for the live function. No Test/Production migration, password update, trainee mutation, or SMS was performed.
- The report and contract are design artifacts only. They do not count as a live integration test or a completed fix.


## Candidate security primitives and CI regression (2026-11-22)

Added isolated, non-deployable candidate module:
- `docs/experimental/recovery-candidate-core.mjs`
- `docs/experimental/test-recovery-candidate-core.js`

Covered behaviors:
- unbiased four-digit generation by rejection sampling;
- HMAC-SHA-256 with key-version domain separation and fail-closed secret validation;
- constant-time digest comparison;
- Iranian mobile normalization;
- exact-origin allowlist matching;
- identical generic public request acceptance response;
- fail-closed classification of ambiguous Auth outcomes as `auth_update_unknown`.

The candidate test is now part of the experiment workflow. First run `45047322945` exposed an existing appended Mock regression test typo: two code-extraction regexes were double-escaped, so the suite stopped after its earlier assertions. Corrected both test expressions in commit `6e395b93a373261302e9384b24047e8ac29071cb`.

Follow-up run `45047406596`:
- Mock recovery suite: **success**.
- Existing crypto boundary suite: **success**.
- HTTP smoke static contract suite: **success**.
- Authorization/abuse suite: **success**.
- New candidate primitive suite: **success**.
- Disposable PostgreSQL concurrency job: **success**. The complete workflow run `45047406596` finished with conclusion **success** (both jobs successful).

These are isolated CI checks only. The candidate module is not an Edge Function and does not implement database RPCs, JWT middleware, real Auth, SMS, or persistence. The live Test/Production functions and schemas remain untouched; production release remains **NOT READY**.


## Atomic RPC candidate test evidence (2026-11-22)

Added a separate experimental SQL draft and disposable PostgreSQL 16 integration test:
- `docs/experimental/migrations/20261122_recovery_atomic_rpc_candidate.sql`
- `docs/experimental/test-recovery-atomic-rpc-candidate.js`

The draft includes operation metadata, a `processing`-inclusive active-request unique index, and service-role-only functions in a non-exposed schema. The functions pin an empty `search_path`, fully qualify relations, and deny schema/function access to anon/authenticated/public. Tests exercise row-lock-protected coach authorization during concurrent reassignment, atomic wrong-code limits, single-winner reset claims, active uniqueness during processing, fail-closed Auth ambiguity, authoritative reconciliation, completion, and privilege boundaries.

Workflow run `45047881214` completed **success**. The PostgreSQL job checked out candidate SQL commit `9745175f69d93e2eb2a113ee3250782c3f11fe70`; both workflow jobs succeeded.

**Updated release status: NOT READY FOR PRODUCTION.** These checks use disposable PostgreSQL fixture tables only. The candidate SQL has not been applied to Supabase Test or Production. Real Edge Function HTTP/Auth integration, test-only SMS delivery, delivery ambiguity/idempotency, session behavior, logs, monitoring, and rollback/reconciliation remain untested. No live database/function/auth/password/SMS changes were made.


## Delivery-state hardening and migration preflight (2026-11-22)

The experimental SQL candidate now includes durable delivery operation identity and outcome fields, with service-role-only RPCs:
- one delivery attempt per operation;
- `sent` is required before a code can be redeemed;
- `unknown` delivery blocks redemption and automatic retry;
- confirmed failure clears the code and returns the request to coach review;
- only authoritative reconciliation can resolve an unknown delivery.

The migration also refuses to proceed if any legacy request is already `approved` or `processing`, because the old schema cannot prove delivery or Auth outcome for those rows. This is especially important because Test currently has an approved request and Production has approved requests; the candidate migration would stop before altering either project. No attempt was made to apply it.

Workflow run `45048230786` completed **success**. Both jobs passed, including the disposable PostgreSQL candidate suite. The job checked out commit `11e099c25cbb9cccffafdf410c088e1e5d1496ad` and reported successful checks for migration preflight, restricted privileges, coach reassignment locking, atomic five-attempt limit, delivery unknown lockout/reconciliation, single reset claim, Auth unknown lockout/reconciliation, and confirmed completion.

**Release remains NOT READY.** Real Edge Function implementation, real Test Auth account/password reset, HTTP/auth middleware, actual provider integration and provider idempotency/timeout semantics, session behavior, logging/monitoring, and rollback/reconciliation remain untested. No Supabase Test/Production schema or function was changed; no real password or SMS was touched.


## Atomic request-submission RPC added (verification pending)

Added `recovery_private.submit_recovery_request(text)` to the experimental SQL draft. It refuses invalid, unknown, inactive, archived, or ambiguous duplicate phone matches; inserts at most one active pending request under the partial unique index; and returns only a boolean to the server-side caller. The intended public HTTP response remains generic and identical regardless of account eligibility. A concurrent-submission regression was added to the disposable PostgreSQL suite.

Workflow run `45048555639` completed **success** in both jobs. The PostgreSQL job checked out commit `d9c3a7b545607cd5300410b2acb19d2e1c292226` and confirmed eight concurrent submissions create exactly one pending row; ambiguous duplicate and unknown phone inputs create none. The complete atomic RPC, delivery, Auth-state, migration-preflight, and privilege tests all passed on disposable PostgreSQL 16.

Production release remains **NOT READY**. No Supabase project was modified, and no real SMS or password change occurred.


## Latest disposable PostgreSQL suite: PASS (2026-11-22)

Workflow run `45048555639` completed successfully. Both `mock-recovery-tests` and `postgres-concurrency-tests` passed. The PostgreSQL job checked out exact commit `d9c3a7b545607cd5300410b2acb19d2e1c292226`.

Verified on disposable PostgreSQL 16:
- candidate migration blocks legacy approved/processing rows;
- service_role-only schema/function privileges;
- eight concurrent request submissions produce exactly one row; ambiguous/unknown phone records create none;
- coach reassignment lock prevents former coach approval;
- wrong-code attempts cap atomically at five;
- delivery is single-attempt and unknown delivery blocks redemption until authoritative reconciliation;
- exactly one reset claim wins;
- Auth unknown remains locked; authoritative no-change and confirmed success transitions work;
- confirmed delivery failure clears code and returns request to pending;
- invalid/null transitions fail closed.

This is a meaningful candidate SQL milestone, not a real Supabase integration test. The Edge Function adapter, actual Test Auth password reset, actual HTTP/CORS/auth behavior, provider delivery, session invalidation, logging/monitoring and rollback remain outstanding. No Supabase project was changed and no live SMS/password reset occurred.

**Next safe work:** author a separately named non-deployable Edge Function candidate in this experiment branch, wiring only to the candidate RPC contracts and leaving provider delivery disabled. Then add static/unit tests before any Test-project migration or deployment is considered.


## PostgREST integration boundary: service-role-only public wrappers

A custom private schema may not be callable through Supabase PostgREST unless exposed in project API settings. To avoid changing API settings or exposing `recovery_private`, the candidate migration now adds schema-qualified public wrapper RPCs, with EXECUTE revoked from PUBLIC/anon/authenticated and granted only to `service_role`. The wrappers use invoker security and call the underlying private functions.

Workflow run `45049632108` completed **success**. Its PostgreSQL job exercised the wrappers under `SET ROLE service_role` and verified the restricted grants, along with all previous atomic request, delivery, reset, Auth ambiguity, migration preflight, and concurrency checks. This remains disposable PostgreSQL evidence only; actual PostgREST reachability and Edge Function integration are not yet tested.

No Supabase API settings, schemas, functions, or live data were changed.


## Candidate HTTP handler and Edge runtime adapter added — isolated tests PASS

A dependency-injected handler candidate now connects the proposed HTTP actions to the service-role-only RPC wrappers. A separate Deno/Supabase adapter is stored only under `docs/experimental`, not in the deployable `supabase/functions` tree. It has no SMS provider configured; coach approval fails closed before changing request state when no delivery adapter is injected. Unit tests use only an in-memory synthetic delivery adapter and never send a real message.

Workflow run `45050296581` completed **success** on commit `357852129e64ed3048a578161bcb8c20bf7eac07`; both jobs passed. The handler tests cover generic request responses, CORS rejection, disabled provider behavior, delivery to the database-verified phone only, no code disclosure to coach, wrong-code handling, one Auth update attempt, ambiguous Auth lockout, and confirmed success. The disposable PostgreSQL atomic RPC/concurrency suite also passed.

**Remaining integration gates:** compile/check in the actual Supabase Edge Runtime; validate PostgREST wrapper reachability and service-role grants in Supabase Test; run real HTTP/authentication and coach authorization tests with isolated test identities; select and approve a delivery provider; test Auth session invalidation; verify logs, monitoring, reconciliation, and rollback. No Supabase project was changed, no function deployed, no real SMS sent, and no trainee password/session changed.


## Delivery finalization failure is now fail-closed

Added a regression fix: a positive response from a delivery adapter is not reported as successful unless the database confirms the durable delivery-state transition. If provider acceptance is known but the state write fails, the handler returns a generic failure, does not retry delivery, and leaves the request non-redeemable pending reconciliation.

Workflow run `45050432795` completed **success** on commit `3f36873cb316b8d09d790b2c62133716f1160eb2`. Both jobs passed, including the new delivery-finalization failure test and the disposable PostgreSQL atomic RPC suite.


## Latest verification: Deno + SQL contract + PostgreSQL all PASS

Added static alignment checks between the handler's eight RPC calls and the candidate migration's public wrappers/service-role grants, plus a Deno 2 type-check of the isolated Edge adapter.

Workflow run `45050755303` completed **success** on commit `5b40c5c46bcf41e38fa573fddf0edeca11267f1e`. All three jobs passed: mock/handler/security/static contract checks, disposable PostgreSQL concurrency/RPC tests, and Deno type-check.

**Important remaining blocker found by read-only Test schema inspection:** the Test project's current recovery table still has only the pre-migration columns; the candidate handler's additional outcome/operation columns do not exist there yet. The Test database also has a legacy approved recovery request, and the candidate migration's preflight is designed to stop when approved/processing rows exist. Therefore no Test migration or live endpoint call is safe yet. The approved row must first be handled through a separately reviewed, explicit cleanup/reconciliation plan. No database write was performed.


## Additional blocker review and key-rotation fix (2026-11-22)

Read-only Test inspection confirmed the existing rate-limit function signature and candidate-referenced profile/trainee columns match. It also found exactly one legacy approved recovery request whose code is already expired, with no processing rows. Its linked trainee is currently active/non-archived. No identifying data is retained in this report.

A guarded, separate Test-only cleanup candidate was added at `docs/experimental/migrations/20261122_dispose_expired_legacy_approved_request.sql`. It aborts unless exactly one expired approved row exists and there are no unexpired approved or processing rows. If explicitly approved and executed, it changes only that recovery-request row to expired and clears the expired code hash/expiry. It does not modify trainee or Auth data. **It has not been run.**

Security review also found that the candidate recorded an HMAC key version but initially supported only one configured secret. The candidate now uses a validated versioned `RECOVERY_HMAC_KEYS` keyring, selects the exact historical key on reset, and fails closed if that version is unavailable. New tests cover both historical-key verification and missing-key refusal.

Before Test migration/endpoint work:
1. Explicit approval is required to execute the guarded expired-request cleanup in Test.
2. Then review and explicitly approve the candidate schema migration.
3. Only after migration should we run PostgREST RPC integration checks and isolated Test Auth account tests.
No Production changes are authorized by these steps.

## Follow-up verification and registration-limiter collision fix (2026-11-23)

The latest pre-fix CI run 45110566616 completed successfully on commit d0102f7f0e44e8ce1b064dd1c16d992f4dfbfba8: mock/handler tests, Deno type-check, disposable PostgreSQL candidate integration/concurrency tests, and disposable local Supabase Auth integration all passed. This is CI-only evidence; it does not establish that the candidate has been applied to Supabase Test or that a real Test Edge Function request flow works.

A fresh read-only inspection of Supabase Test (udptdznbvewkublvzmtm) confirmed:
- The recovery table still has only the legacy columns; candidate operation/delivery/Auth metadata columns are not installed.
- Current recovery request snapshot: one expired row, with its token hash and expiry cleared; zero approved or processing rows. This is an observation only. No database write was made in this session, and the cause/time of that state transition is not established.
- The active Test Edge Function remains version 10; the candidate is not deployed.
- No Supabase development branches currently exist for this project.

### New P0 migration collision found and fixed in the experiment branch

Reviewing the exact candidate SQL against the live Test schema exposed a serious name collision: Test already has public.consume_registration_rate_limit(text,integer,integer), used by the registration flow. The candidate migration had proposed CREATE OR REPLACE FUNCTION with that same signature, which would replace the registration limiter with recovery-specific behavior and could break or weaken registration rate limiting.

Fixed on the experiment branch only:
- Renamed the candidate RPC to public.recovery_consume_request_rate_limit.
- Updated the recovery handler to call only the dedicated recovery RPC.
- Updated disposable PostgreSQL tests and added a regression fixture that creates a pre-existing registration limiter and asserts the recovery migration leaves its definition unchanged.
- Added static contract assertions forbidding the old colliding function name in the recovery migration/handler.

Commits:
- b91df1478271780a15b9af707048f0ad9f6896fc — SQL RPC rename.
- 761368cf28bd255e5b6b852ec829c189c260888f — handler alignment.
- c9215a05d801ce048e08f8b01a12a442ee84f53c — SQL integration test rename.
- 3c560f8a3ee38dafd98c72fbe0d942106b1ed120 — static regression guard.
- 0c252c101826ef30e38c77aaf63dc53558e1fa42 — PostgreSQL regression preserving registration limiter.

The new CI run for these latest commits must finish successfully before proceeding. The candidate migration is still not applied to Test or Production, and no live Edge Function, Auth user, password, SMS provider, trainee record, or production resource was changed.

**Release remains NOT READY.** Next gate: confirm the new disposable PostgreSQL run passes the registration-limiter preservation test, then continue with read-only PostgREST/API compatibility checks and plan an explicitly approved, isolated Test migration only after the candidate migration has been reviewed in full.

## Regression run after limiter rename — follow-up still required (2026-11-23)

Run 45111044645 exposed two test-fixture issues after the isolated RPC rename:
- The handler unit test still expects the old RPC name consume_registration_rate_limit. The candidate handler correctly calls recovery_consume_request_rate_limit; the test assertion is stale and must be aligned before the mock job can pass.
- The disposable PostgreSQL fixture's new pre-existing registration limiter function used malformed dollar quoting. Corrected the fixture to use a standard SQL string literal in commit 189c6b74c50e489b03175925d60fdd8dcf57be44.

Run 45111142831 (commit 189c6b74c50e489b03175925d60fdd8dcf57be44) confirms Deno type-check passed, but the mock job still fails at the stale handler assertion. PostgreSQL and disposable local Auth jobs were still running at the time of this note; no final success is claimed.

Do not revert the dedicated recovery RPC name to satisfy the stale test: doing so would reintroduce the production registration-limiter collision. The test must be corrected to assert the new dedicated RPC name. The recovery migration remains unapplied to Test and Production.

## Atomic SQL regression passes; remaining consumer mocks still use old RPC name (2026-11-23)

Run 45111142831 checked commit 189c6b74c50e489b03175925d60fdd8dcf57be44. Results:
- Disposable PostgreSQL two-session concurrency checks: PASS.
- Atomic recovery RPC candidate suite, including the registration-limiter preservation regression: PASS.
- Deno Edge adapter type-check: PASS.
- Mock handler suite: FAIL only at the request-rate-limiter call assertion because its mock still expects consume_registration_rate_limit instead of recovery_consume_request_rate_limit.
- Outbox PostgreSQL end-to-end test: FAIL because its injected HTTP admin stub still maps the old consume_registration_rate_limit RPC. The candidate handler correctly calls the dedicated recovery RPC, so the test stub never submits the request.
- Disposable local Auth integration was still running when this note was recorded; no final result is claimed.

These failures identify two stale test doubles, not a failure in the renamed SQL RPC. Both consumer fixtures must be updated to map recovery_consume_request_rate_limit to public.recovery_consume_request_rate_limit before the full workflow can pass. Do not restore the old colliding function name.

Release remains NOT READY. No Test/Production schema or Edge Function has been changed.
## Consumer test doubles aligned; latest CI partially green (2026-11-23)

Updated the remaining stale rate-limiter references in the handler and Outbox PostgreSQL test doubles so they now call recovery_consume_request_rate_limit, which maps to public.recovery_consume_request_rate_limit. The SQL RPC name remains isolated and the existing registration limiter is not restored or overwritten.

Also corrected malformed over-escaped regular-expression literals in the static migration/handler contract test.

Latest observed CI run: 45111382201, head SHA 92c04a5469201e07fbe480ae637d9f324aeb97b3:
- Mock recovery tests: PASS.
- Deno Edge candidate type-check: PASS.
- Disposable PostgreSQL suite: still running at last check; atomic recovery RPC candidate test had started.
- Disposable local Supabase Auth integration: still running while starting the local Auth stack.
- Overall workflow: IN PROGRESS; no final green result claimed.

Important: the run was created while the branch was receiving adjacent test-only commits; re-check the branch head and require a fresh all-green workflow on the final branch SHA before any Test migration. No remote Supabase database, Edge Function, Auth account, password, trainee record, or provider was changed.

Release remains NOT READY.
## Full candidate CI green; disposable Auth session semantics recorded (2026-11-23)

Run 45111441369 completed with conclusion SUCCESS on commit 254c8c0f2522a48e4ab11dad10c9c1237160c6b9. All four jobs passed:
- mock-recovery-tests: PASS.
- postgres-concurrency-tests: PASS, including atomic RPC and registration-limiter preservation regression.
- deno-edge-candidate-check: PASS.
- supabase-local-auth-integration: PASS.

The disposable local Auth test created and deleted only its synthetic local user. It verified old-password rejection, new-password login, and global sign-out revoking other refresh tokens. Observed on the pinned local Auth version: password update alone revoked existing refresh tokens; old access JWT was rejected by Auth getUser after password update; old access JWT was also rejected after global sign-out. These observations are local disposable Auth evidence, not yet a live Supabase Test end-to-end recovery test.

### Read-only Supabase Test schema/API preflight
Read-only SQL against project udptdznbvewkublvzmtm reconfirmed that the existing public.consume_registration_rate_limit(text, integer, integer) is present, SECURITY DEFINER, executable by service_role, and not executable by anon or authenticated. The dedicated recovery_consume_request_rate_limit and candidate recovery RPCs are not installed. The recovery table still has only its legacy columns. No write, migration, cleanup, RPC mutation, Auth operation, or Edge deployment was performed.

Because the candidate RPCs/schema are intentionally not installed, a live PostgREST invocation of the new RPCs cannot yet be tested. That compatibility check belongs after a separately approved, isolated Test migration and must use only synthetic test data.

All automated candidate CI gates are green on the recorded commit, but the overall release remains NOT READY. Remaining gates include migration review and explicit approval, any required guarded cleanup approval, controlled Test migration, PostgREST RPC/schema-cache verification, and a complete synthetic Test recovery flow including coach authorization, delivery adapter, code replay/expiry/attempt limits, Auth password update, and session invalidation. Production remains out of scope.
## Coach-reassignment dispatch/redemption guard and latest green CI (2026-11-23)

Read-only inspection of the current Supabase Test schema confirmed that the existing recovery table has RLS enabled, its current partial unique index covers pending/approved but not processing, and its state/attempt constraints must be preserved. No schema, policy, data, Auth user, or Edge Function was changed by this inspection.

A further security gap was found in the candidate flow: a trainee could be reassigned after a coach approved recovery but before SMS dispatch or code redemption. The experimental branch now rechecks that the current trainee coach is the same non-null coach recorded as reviewer:
- Outbox claim excludes requests whose trainee is reassigned, inactive, or archived.
- Send-start locks and rechecks the trainee row; if the assignment changed before send-start, it expires the request, invalidates the code, and fails the Outbox item without sending.
- Encrypted payload retrieval independently rechecks current coach ownership.
- The Worker performs a final ownership check immediately before calling the fake provider.
- Reset claim expires and invalidates a code approved by a former coach.
- Disposable PostgreSQL and Worker tests cover reassignment before claim, between claim and send-start, after send-start before payload retrieval, and after delivery before redemption.

Test fixture cleanup was added so the reassignment test does not contaminate the following Outbox suite.

Latest complete candidate CI: run 45112328318, commit a3e305aa6b2533ed36915a434765f9e74569aa9f — SUCCESS. All four jobs passed: mock-recovery-tests, postgres-concurrency-tests, deno-edge-candidate-check, and supabase-local-auth-integration. The PostgreSQL suite includes the new reassignment cases; the local Auth suite remains disposable/loopback-only.

Migration sequencing note: the atomic RPC candidate already rebuilds the active-request unique index to include processing. The standalone include-processing index draft is redundant and must not be applied as a separate extra step. Candidate order for isolated staging review is atomic RPC/schema, Outbox worker, then encrypted delivery payload. This sequence has not been applied to Supabase Test.

Release remains NOT READY. Still required: a disposable Supabase staging project matching the real schema/roles/extensions; approved migration execution; PostgREST/schema-cache RPC verification; isolated Edge deployment with non-production secrets; real SMS provider adapter validation (Mediana remains disabled/unconfigured); synthetic coach/trainee end-to-end HTTP recovery; operational reconciliation/alerts/secret rotation/log review; and explicit approval before merge or production activity.
## Disposable PostgREST contract harness added (2026-11-23)

Added a CI-only PostgREST service alongside the disposable PostgreSQL concurrency job and a loopback-only contract test. The test runs immediately after the atomic candidate migration test and before the Outbox suite:
- Requests a schema-cache reload through `NOTIFY pgrst, 'reload schema'` after the candidate RPCs have been created.
- Calls `public.recovery_consume_request_rate_limit` over actual HTTP `/rpc/...` using the exact named arguments expected by PostgREST.
- Signs short-lived HS256 JWTs with a disposable CI-only secret; no Supabase project keys or production secrets are used.
- Confirms `service_role` can invoke the RPC, `anon` receives 401/403, and the SQL rate-limit result is preserved across HTTP.
- Restricts the harness URL to `127.0.0.1`; it cannot target a hosted Supabase endpoint.

This is a first real PostgREST transport/schema-cache/role-contract gate, not yet the complete PostgREST test of every recovery RPC or the hosted Supabase API gateway. It is not evidence of a live Test recovery flow. The new CI run must pass on the final branch head before the harness is considered validated. No remote database, Auth user, Edge Function, SMS provider, or production resource was changed.

Release remains NOT READY.
### Expanded PostgREST RPC surface coverage (2026-11-23)

The disposable HTTP contract test now invokes all eight public recovery RPCs defined by the atomic candidate migration using exact named JSON arguments. Seven state-transition RPCs are called only with synthetic, non-existent UUIDs; the rate-limit RPC uses a disposable hash. Each RPC is also called as `anon` and must deny execution with HTTP 401/403. This validates the HTTP/PostgREST name-resolution and role boundary for the complete public atomic RPC surface without touching a real recovery request.

Latest test-code commit: `96d1393de1d4390711e184a10182a52134f7169d`. The workflow path filter includes the contract test, so this push should schedule the disposable CI workflow. The available GitHub connector does not expose a repository-wide workflow-run listing/dispatch action here; do not infer a pass from the commit or from the earlier green run. Confirm the run in GitHub Actions before advancing.

Release remains NOT READY.
### Outbox and encrypted-review PostgREST coverage added (2026-11-23)

Added a second disposable PostgREST contract test, deliberately ordered after the Outbox PostgreSQL integration test has applied both Outbox and encrypted-payload candidate migrations. It reloads PostgREST schema cache and verifies named-argument HTTP resolution plus `service_role` execution / `anon` denial for heartbeat, begin-send, finish, encrypted payload fetch, and encrypted coach review. All calls use synthetic non-existent IDs; it deliberately does not invoke Outbox claim, delivery send, or expiry reconciliation, avoiding mutation of fixture work.

Workflow path filters and step ordering now include this second contract test. New commits: `cc7992363a416d0c6f75b9f3a22e51c42a18cb18` (test) and `d8544dde9894b054a0170a1e4a8f2dc1939834e1` (workflow). The new CI execution remains unverified; do not treat this addition as a passing test until the GitHub Actions run is inspected.

Release remains NOT READY.
### CI observation for the expanded PostgREST suite (2026-11-23)

GitHub Actions run `45113828197` (run #294) was found for the workflow-triggering code push. At the latest inspection:
- `mock-recovery-tests`: success.
- `deno-edge-candidate-check`: success.
- `postgres-concurrency-tests`: success, including atomic RPC candidate tests, the first PostgREST schema-cache/RPC contract test, Outbox/Worker PostgreSQL integration, and the second PostgREST Outbox/encrypted-review contract test.
- `supabase-local-auth-integration`: still in progress at disposable local Auth stack startup; no final result yet.

Therefore the new PostgREST HTTP tests are now confirmed green in disposable CI, but the overall workflow is not yet complete. Do not treat this as full release approval. No hosted Supabase project or real SMS provider was used.
### Final result for PostgREST + local Auth run (2026-11-23, supersedes the in-progress snapshot above)

GitHub Actions run `45113828197` / run #294 is now COMPLETED with overall conclusion `success`. All four jobs passed: `mock-recovery-tests`, `deno-edge-candidate-check`, `postgres-concurrency-tests`, and `supabase-local-auth-integration`.

The disposable local Auth job log confirms:
- Auth Admin password update succeeded for a disposable synthetic user.
- Login with the old password was rejected; login with the new password succeeded.
- Password update alone revoked previously issued refresh tokens (`yes`).
- The old access JWT was rejected by Auth `getUser` after password update (`no` longer accepted).
- Global sign-out also revoked other refresh tokens and the old access JWT was no longer accepted.
- The local Auth stack was stopped and the synthetic Auth user was deleted in `finally` cleanup.

This is a strong positive result for the tested local Supabase Auth version. The current handler's password-update call is therefore supported by this disposable Auth behavior, but the full recovery HTTP handler has not yet been exercised end-to-end against a database with the candidate migrations and real PostgREST/Auth wiring. That remains a separate release gate.

No hosted Supabase project, production account, live Edge Function, or real SMS provider was used. Release remains NOT READY.
### Follow-up hardening identified after green CI

Reviewing the local Auth test source after run #294 exposed a test-strength gap: the script prints the observed result for refresh-token revocation and old access-JWT rejection immediately after password update, but those two observations are not currently asserted as test failures. The run log showed the desired values (`refresh revoked: yes`; old access JWT accepted: no), so the observed behavior is positive, but a future regression could still leave the job green if those observations change.

Before treating session invalidation as a locked CI invariant, convert both post-password-update observations into explicit assertions. Keep the existing global sign-out assertions. This is test-only hardening; it does not require or authorize any hosted Auth change.

Also keep the larger end-to-end gate open: the handler, PostgREST RPCs, Outbox fake provider, and disposable Auth have passed component-level tests, but have not yet been exercised as one connected HTTP recovery transaction against the candidate schema and Auth stack.
### Auth session-revocation assertions strengthened (2026-11-23)

Updated `docs/experimental/test-recovery-auth-local-stack.mjs` in commit `3de356ecffef8029434c3d62618eb144d4f8b5d2`.

The local Auth integration test now fails unless all three conditions hold:
- Password update revokes a previously issued refresh token.
- Auth `getUser` rejects the old access JWT after password update.
- Global sign-out rejects the old access JWT as well as revoking other refresh tokens.

The workflow path filter already includes this test file, so the branch push should schedule the full disposable CI workflow. The new commit's run result has not yet been independently retrieved; treat this hardening as pending CI confirmation, not as a passing test. No hosted Supabase resources were changed.

## Auth revocation assertions: CI confirmed (2026-11-23)

The two commits that strengthened the local Auth session-revocation assertions have now been independently checked through GitHub Actions:
- Commit `3de356ecffef8029434c3d62618eb144d4f8b5d2`: run `45114205047`, run #300, completed SUCCESS.
- Commit `f5847aa324190135c9728352c8f9d3ddd10df57b`: run `45114240905`, run #301, completed SUCCESS.

The run #301 local Auth job log explicitly shows:
- password update revoked the old refresh token;
- Auth `getUser` rejected the old access JWT after password update;
- global sign-out rejected the old access JWT;
- the disposable local Auth test user was cleaned up.

This closes the previously pending CI confirmation for the session-revocation assertions. It does not close the full recovery E2E gate.

## Full E2E implementation audit (2026-11-23)

Reviewed the current candidate HTTP handler, Edge adapter, fake-provider worker, candidate SQL fixtures, and CI workflow. The integration boundary is now explicit:
- `recovery-candidate-handler.mjs` is dependency-injected and can be exercised as an HTTP handler, but its current tests inject a mocked admin/Auth surface.
- `recovery-outbox-worker-mock.mjs` uses the real candidate RPC contract but deliberately accepts only `FakeRecoverySmsProvider`; it is not connected to the handler test fixture.
- The disposable PostgreSQL + PostgREST job and the disposable local Auth job are separate CI jobs with separate databases/stacks. Their green results cannot be combined into evidence of one end-to-end transaction.
- `trainee-password-recovery-edge-candidate.ts` is deliberately under `docs/experimental`, not `supabase/functions`, and has no provider sender. It must remain non-deployable during this phase.

### Required next implementation slice

Build one dedicated disposable integration job that starts a single local Supabase stack (Auth + Postgres + PostgREST), seeds only synthetic `profiles`, `trainees`, and recovery fixtures, applies the three candidate migrations to that disposable database, and exposes the candidate handler through a loopback-only HTTP server. The test should then:
1. create disposable coach and trainee Auth users and bind their IDs to the synthetic profile/trainee rows;
2. submit the request through HTTP and verify the generic public response;
3. authenticate as the coach, list the request, and approve it through HTTP;
4. run the existing fake-only Outbox worker against the same local database and capture the delivered code only inside the test process;
5. redeem that code through the HTTP handler and let the real local Auth Admin API update the trainee password;
6. verify old-password rejection, new-password success, old refresh/access session rejection, code replay rejection, and final database states;
7. delete synthetic Auth users and all fixture rows in guaranteed cleanup, and stop the local stack even on failure.

The test must refuse non-loopback Supabase URLs, reject any non-fake provider, and never read hosted project secrets. Before coding the runner, the base schema fixture must be reconciled with the candidate migrations so the test exercises the exact RPC/table names without copying production data.

No E2E runner has been created or executed in this step. No Supabase hosted environment, database, Auth user, Edge Function, password, SMS provider, trainee record, or Production resource was accessed or changed.

Release remains **NOT READY**.


## Access-token revocation scope clarification (2026-11-23)

A further security distinction is required before closing the session-invalidation gate. The local Auth test proves that the Auth service's `getUser` endpoint rejects the old access JWT after password update/global sign-out, and that old refresh tokens are rejected. It does **not** prove that every API which validates JWTs locally (notably PostgREST/RLS requests) immediately rejects that same still-unexpired JWT.

The next integrated test must retain an old trainee access token, perform password recovery through the candidate HTTP handler, then issue a direct authenticated PostgREST read against a harmless synthetic RLS-protected fixture using that old token. It must separately verify:
- Auth `getUser(oldAccessToken)` rejects;
- refresh using the old refresh token rejects;
- PostgREST behavior for the old access JWT is measured and asserted against the intended security policy;
- a newly authenticated session with the new password succeeds.

Do not describe access-session invalidation as globally complete based only on Auth `getUser`. If PostgREST continues accepting the old JWT until expiry, decide whether the product's security requirement is satisfied by bounded JWT lifetime or whether an additional server-side session/version check is required. Do not weaken RLS or add a broad database lookup without a design review.

This is a test-plan clarification only. No code, migration, hosted Supabase setting, Auth user, trainee data, or Edge Function was changed. Release remains **NOT READY**.


## Local PostgREST old-access-JWT probe added (2026-11-23)

Extended `docs/experimental/test-recovery-auth-local-stack.mjs` to distinguish Auth revocation from API-side JWT validation:
- The test creates a uniquely named, synthetic RLS-protected probe table in the disposable local Supabase database.
- A disposable Auth user owns exactly one synthetic row; the RLS policy uses `auth.uid() = owner_id`.
- It retains an access JWT issued before password change, changes the password through local Auth Admin, then probes the row through the actual local PostgREST endpoint using the old JWT.
- It separately probes with a new-password session and after global sign-out.
- The test requires the old still-unexpired JWT to remain accepted by PostgREST in this local stack, documenting the distinction from Auth `getUser`; the fixture table and Auth user are cleaned up in `finally`.
- The script refuses hosted API and database URLs and requires loopback-only local credentials. No hosted secrets are read.

Workflow run `45115327425` / run #306 was triggered on commit `5e13780c59a3c3d6692aeb89e470cc0b785fd2d0`. At the latest observation, mock tests, Deno type-check, and PostgreSQL/PostgREST contract tests had passed; the disposable local Auth/PostgREST integration job was still running. Therefore the new old-JWT probe is **not yet CI-verified**.

This test is a focused session-semantics probe, not the complete password-recovery E2E flow. It does not touch hosted Supabase, real trainee data, Production, or a live SMS provider. Release remains **NOT READY**.


## Latest CI confirmation: Auth + PostgREST old-JWT probe (2026-11-23)

GitHub Actions run `45115491530` / run #309 completed with overall conclusion **SUCCESS** on exact branch head `e94de6d33bb02d4be44412b84687c6162032b2a3`.

All four jobs passed:
- `mock-recovery-tests`
- `deno-edge-candidate-check`
- `postgres-concurrency-tests`
- `supabase-local-auth-integration`

The local Auth/PostgREST job log explicitly confirms:
- disposable local Auth password update, old/new password behavior, refresh-token revocation, and Auth `getUser` rejection all passed;
- the old still-unexpired access JWT continued to be accepted by local PostgREST after password update and global sign-out;
- the test reported the security distinction: Auth-side revocation is not immediate revocation at locally validating PostgREST APIs; JWT expiry or an additional server-side session check is required for that guarantee.

The PostgreSQL job also completed successfully, including the atomic RPC, schema-cache/named-argument/role checks, Outbox/Worker integration, and encrypted-review PostgREST contract steps. The permission-denied SQL log entries are expected negative-role probes (for example, `anon` attempting service-role-only RPCs), not evidence of a failing job; the job conclusion is SUCCESS.

This run closes the previously pending CI confirmation for the local PostgREST old-JWT behavior. It does **not** resolve the architectural decision about acceptable old-token lifetime, nor does it exercise the full recovery handler + coach approval + fake delivery + redemption + real local Auth update as one connected transaction.

### Remaining blockers — unchanged

1. Decide and document the security policy for still-unexpired access JWTs at PostgREST: bounded JWT lifetime versus a reviewed server-side session/version check. Do not weaken RLS.
2. Build and pass the single-stack disposable full HTTP recovery E2E described above, using only synthetic coach/trainee identities and the fake-only provider.
3. Reconcile the disposable base-schema fixture with all three candidate migrations before attempting that E2E.
4. Only after those gates: review provider integration (Mediana remains disabled/unconfigured), operational controls, secret rotation, monitoring, staging migration plan, and explicit release approval.

No hosted Supabase project, Production database, real trainee record, deployed Edge Function, hosted Auth user, or real SMS provider was accessed or changed in run #309.

Release remains **NOT READY**.


## Full-E2E fixture compatibility audit (2026-11-23)

A read-only inspection of the atomic migration test fixture, Outbox integration test, HTTP handler, and fake worker identified the minimum integration fixture and the remaining wiring work.

### Disposable base-schema requirements

The current atomic RPC test fixture creates only synthetic rows and the following base columns before applying the atomic migration:
- `profiles(id uuid primary key, role text)`;
- `trainees(id, coach_user_id, auth_user_id, approval_status, phone_normalized, archived_at)`;
- `trainee_password_recovery_requests` with its existing state, token, timestamp, and foreign-key columns.

The HTTP handler and worker require additional fields/relations not present in that minimal SQL fixture:
- `profiles` must map the actual local Auth coach UUID to `role='coach'`;
- `trainees` must include `full_name` for the coach list relation, plus the coach/Auth user IDs, normalized phone, active/archived state;
- the request table must support the handler's selected fields (`requested_at`, `reviewed_at`, `delivery_outcome`, `auth_outcome`) and the migration-added token/operation fields;
- the local Auth trainee UUID must match `trainees.auth_user_id`;
- the Outbox base table must exist before the Outbox migration and include the fields that migration alters/uses.

The candidate migration's deliberate preflight rejection of legacy `approved`/`processing` rows must be preserved. The E2E fixture must start with no legacy open/approved requests, apply the atomic migration, then Outbox migration, then encrypted-payload migration in that exact order. The existing Outbox PostgreSQL test already validates atomic encrypted approval→Outbox enqueue and fake worker lease/send lifecycle, but currently it does so in its separate disposable PostgreSQL job.

### Runtime wiring still required for one-stack E2E

- Start one local Supabase stack and use its loopback API URL, anon key, service-role key, and local DB URL only.
- Create disposable coach and trainee Auth users; insert matching synthetic `profiles` and `trainees` rows with `full_name`.
- Construct the candidate handler with the local Supabase JS admin client and a bearer-forwarding user client; expose it only through a loopback HTTP bridge.
- Submit and list/review through HTTP, then call `processOneRecoveryOutboxItem` with the same admin client, configured test-only decryption key, worker UUID, and an instance of `FakeRecoverySmsProvider`.
- Capture the fake provider's four-digit code in memory inside the test process only; redeem through the HTTP handler; verify local Auth password change and final SQL state.
- Retain a pre-recovery access/refresh session and test Auth and PostgREST behavior separately. The already-confirmed old-JWT observation must be asserted/documented, not misreported as immediate global API revocation.
- Clean all fixture rows and Auth users in `finally`, and stop the local stack even if setup or assertions fail.

The current separate jobs do not share a database or Auth service. No full-E2E runner was created or executed in this audit. No hosted credentials or data were accessed. This is a compatibility/design inventory only.

Release remains **NOT READY**.


## 24-hour recovery-code policy alignment and CI run #320 (2026-11-23)

The candidate implementation had an unintended policy mismatch: the HTTP handler generated a 15-minute expiry while the SQL approval RPCs capped expiry at 20 minutes, despite the documented recovery-code policy being 24 hours. This is now aligned on the isolated experiment branch:

- `docs/experimental/recovery-candidate-handler.mjs` generates an expiry exactly 24 hours after issuance.
- `20261122_recovery_atomic_rpc_candidate.sql` rejects expiry values beyond 24 hours.
- `20261122_recovery_encrypted_delivery_payload_candidate.sql` applies the same 24-hour maximum to encrypted approval.
- `test-recovery-candidate-handler.js` asserts the exact 24-hour timestamp.

CI run #320 completed successfully on commit `78055425856e38703ad5dddccff5740a644f7564`: all four jobs passed (mock recovery tests, Deno candidate check, disposable PostgreSQL concurrency/Outbox tests, and disposable local Auth/PostgREST session probe). The Auth probe confirmed old password rejection, new password acceptance, refresh-token revocation, and Auth `getUser` rejection. It also reconfirmed that a still-unexpired old access JWT remains accepted by local PostgREST after password update and global sign-out. Therefore this does not establish immediate API-session revocation.

This CI success validates the isolated candidate checks only. It does not constitute the complete HTTP-to-worker-to-Auth recovery E2E flow, does not validate a real SMS provider, and does not authorize migration/deployment to hosted Test or Production. The full E2E and the bounded-JWT or server-side session/version-check architecture decision remain open. No hosted Supabase project, real trainee data, live Auth account, or SMS provider was used. Release remains **NOT READY FOR PRODUCTION**.


## Old access-JWT mitigation decision note (2026-11-23)

The local Auth/PostgREST probe proves that password update and Auth global sign-out revoke refresh-token use and cause Auth `getUser` to reject the old access token, but do not invalidate an already-issued, still-unexpired JWT at PostgREST. The release design must explicitly choose the API-side residual-access guarantee; do not claim immediate global logout from Auth revocation alone.

Two viable directions require separate review:

1. **Bounded access-token lifetime.** Configure and verify a suitably short JWT lifetime for the Auth project, while ensuring supported clients refresh normally. This bounds the residual API access window to the remaining JWT lifetime, but it is not instantaneous revocation and affects every user/session in the project, not only password recovery. Before adoption, verify the actual hosted Auth configuration capability, minimum/maximum values, refresh behavior on Android/iOS/web, clock-skew handling, and user impact in an isolated Test environment.
2. **Server-side session/version enforcement in RLS.** Issue a signed session/version claim and compare it against a server-side per-user version during authorization, incrementing that version during recovery. This can provide prompt API-side invalidation, but requires a carefully reviewed access-token hook/claim lifecycle and consistent enforcement across every sensitive table, view, RPC, and storage policy. A missed policy or stale claim design would create a security gap. It must not be implemented as a broad weakening or bypass of RLS.

Do not combine these approaches or change hosted Auth settings as an experiment without an explicit architecture decision and isolated Test plan. The current candidate has neither mitigation implemented; this remains a release blocker. The first validation should inventory the app's current JWT lifetime and refresh behavior, then map all protected data surfaces and RLS policies before choosing. Preserve the existing old-JWT probe as a regression test: after the selected mitigation is implemented, test both Auth and actual PostgREST access with the old JWT.

No code, RLS policy, hosted Auth setting, migration, or user session was changed for this decision note. Release remains **NOT READY FOR PRODUCTION**.


## CI run #322 and existing application authorization patterns (2026-11-23)

GitHub Actions run `45116693142` / run #322 completed successfully on commit `d60221548ed4e9b8f3b0ad0d5d1ff078b1f0fe1b`. All four jobs passed: mock recovery tests, Deno candidate check, disposable local Auth/PostgREST probe, and disposable PostgreSQL concurrency/Outbox tests. This is still the same set of separate CI jobs; it is not the missing one-stack full recovery E2E.

A read-only inspection of existing `main` authorization code found useful patterns but does not establish a complete RLS inventory:

- `supabase/migrations/202611130001_atomic_trainee_progress_rpc.sql` defines a `SECURITY INVOKER` RPC, explicitly requires non-null `auth.uid()`, rejects coach-role use for a trainee-only action, and verifies the active trainee owns the exact row through `trainees.auth_user_id = auth.uid()`.
- `supabase/migrations/202610220001_save_trainee_workout_plan_atomic.sql` defines a `SECURITY DEFINER` coach operation but explicitly requires authentication, coach role, and `private.can_access_trainee(v_trainee_id)`; it revokes execute from PUBLIC and anon and grants only authenticated.
- `supabase/migrations/202611030001_save_coach_nutrition_builder_atomic.sql` similarly checks authenticated coach role and per-trainee access, and restricts function execution grants. It preserves previous nutrition plans as inactive history rather than deleting them.
- `supabase/migrations/202611140001_tighten_trainee_health_report_storage_reads.sql` shows a storage-object RLS policy tied to `auth.uid()`, active trainee state, and current coach/trainee ownership.
- Existing main-branch tests `tests/auth-session-lifecycle-watchdog.test.mjs` and `tests/auth-recovery-paths-integration.test.mjs` cover client-side session restoration/single-flight behavior. They do not prove immediate PostgREST JWT revocation and must not be treated as a server-side mitigation.

Implication for the recovery design: a session-version claim/check cannot be declared complete merely by adding a check to the recovery endpoint. It would need a verified inventory of all authenticated data access surfaces and policies, including direct PostgREST tables/views/RPCs and Storage policies, plus tests proving old-token denial without breaking legitimate coach/trainee access. The inspected examples are evidence of existing ownership checks, not proof that every surface is covered. No production code, RLS policy, Auth configuration, hosted project, or trainee data was changed in this audit.

### Current release blockers

1. Choose and validate the old-JWT residual-access policy (bounded JWT lifetime or complete server-side session/version enforcement).
2. Build and pass the single-stack disposable full HTTP recovery E2E; the current four CI jobs remain separate.
3. Complete the base-schema fixture compatibility and cleanup proof for that E2E.
4. Only then proceed to reviewed provider integration, staging validation, operational monitoring/secret rotation, and explicit release approval.

Release remains **NOT READY FOR PRODUCTION**.


## Follow-up verification — 2026-11-23

- Latest push CI run `45158409464` on commit `cd7f34d26e98ac5491d09a3bb7c0f3143a866470` completed successfully: all five jobs passed (mock/crypto/authorization tests, disposable PostgreSQL concurrency and PostgREST contracts, local Supabase Auth integration, local full recovery E2E, and Deno type-check of the non-deployable adapter).
- The E2E assertion regression was fixed: the outbox assertion now uses the captured `recoveryRequestId` rather than the undefined `requestId`. The test's finally cleanup remains in place.
- The latest CI is isolated evidence only. It does not validate deployment against the remote mirror's active Edge Function or its actual Auth/SMS provider.
- Read-only mirror audit on 2026-11-23 confirms the project is healthy (PostgreSQL 17.11), the recovery table has RLS enabled and a deny policy for anon/authenticated, and its unique partial index still covers only `pending` and `approved` (not `processing`).
- The mirror's active `trainee-password-recovery` Edge Function remains version 10 with `verify_jwt=false` and still performs direct table updates and direct Mediana pattern-SMS delivery. It is not compatible with the candidate RPC/outbox/encrypted-payload architecture. Do not apply candidate migrations before replacing and validating this handler as one coordinated release.
- Security advisors on the mirror currently report: one authenticated-executable SECURITY DEFINER function (`public.save_coach_nutrition_builder_plan`), leaked-password protection disabled, and five RLS-enabled/no-policy findings on test/archive tables. These are separate existing findings and should be triaged; no changes were made as part of this recovery work.
- No remote SQL, migration, Edge Function deployment, SMS, password change, or production operation was performed.

**Release decision remains: NOT READY.** Next gate is a Supabase-compatible, backwards-reviewed migration plus a deployable Edge Function/worker pair, tested together against the mirror's actual schema and Auth behavior. Only after that should the mirror receive a coordinated, reversible rollout.


## Candidate integration audit — 2026-11-23 (follow-up)

### RPC and schema contract cross-check
- Static cross-check confirms every RPC name called by the candidate HTTP handler is defined by the candidate SQL set: `recovery_consume_request_rate_limit`, `recovery_submit_request`, `recovery_coach_review_encrypted`, `recovery_coach_review`, `recovery_claim_reset`, `recovery_record_wrong_attempt`, `recovery_begin_auth_update`, and `recovery_finish_auth_update`.
- The worker RPC family is also present in the outbox migration: claim, heartbeat, begin-send, finish, reconcile, and encrypted-payload fetch.
- The encrypted migration replaces the enqueue trigger function created by the outbox migration and copies the encrypted envelope transactionally. This is internally coherent in the candidate set, but it still needs execution against a Supabase-shaped disposable schema with the exact deployed extensions, roles, grants, and PostgREST exposure configuration.

### Remaining implementation blockers
- The current mirror request table does not yet have candidate columns such as `request_coach_user_id`, `delivery_outcome`, `delivery_operation_id`, `auth_outcome`, and encrypted payload metadata. The current index still excludes `processing`.
- The active mirror Edge Function is still the legacy direct-write/direct-Mediana implementation. The candidate handler is deliberately not installed in `supabase/functions`, and the worker only accepts its fake provider. There is therefore no production-capable delivery adapter or validated provider response/idempotency contract yet.
- The candidate SQL files explicitly prohibit direct Supabase deployment. Merely removing those header comments or replaying them in the mirror would be unsafe; the migration must be rewritten as a Supabase migration with explicit preflight assertions, bounded lock strategy, grants/default privileges, rollback plan, and an exact compatibility check against the live table/function definitions.
- The actual Supabase Auth update's behavior under transport ambiguity and refresh-token/session revocation still needs a mirror-only end-to-end verification. The local Auth test is useful but does not prove remote project configuration behavior.

**Decision:** no deployment or SQL mutation authorized by this audit. The next engineering deliverable is a separate Supabase migration candidate and a deployable Edge Function/worker pair, with provider delivery kept disabled until its provider and credentials are explicitly validated. Existing live function remains untouched during preparation.
