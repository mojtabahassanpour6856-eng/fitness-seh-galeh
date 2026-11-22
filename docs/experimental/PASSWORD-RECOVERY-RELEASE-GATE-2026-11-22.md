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
