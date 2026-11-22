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
