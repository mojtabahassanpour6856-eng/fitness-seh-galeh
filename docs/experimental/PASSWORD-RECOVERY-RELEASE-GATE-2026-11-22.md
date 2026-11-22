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
