# Recovery implementation readiness checklist

Status: investigation checklist. No production code, database, auth provider, SMS provider, or account has been changed.

## Confirmed from current repository review
- Existing authentication regression tests exercise session restoration and duplicate-login prevention.
- Existing auth recovery-path test uses a mocked Supabase session and mocked profile-role lookup to test the coach login completion path.
- Those tests are not password-reset tests and do not prove SMS recovery, password mutation, token revocation, or trainee recovery authorization.
- A limited static scan of the root HTML did not identify direct common password-recovery API call names. The complete HTML could not be retrieved through the current repository file connector in this pass, so this is not a conclusive inventory of auth initialization.

## Required read-only discovery before implementation
- [ ] Retrieve the complete current auth bootstrap and identify the exact Supabase client construction site.
- [ ] Identify the exact SDK version loaded at runtime and whether it is the pinned local vendor build or a remote loader.
- [ ] Identify whether phone sign-in, email sign-in, or both are enabled in the Supabase project (do not change settings during discovery).
- [ ] Identify the current authoritative profile table/columns for role, trainee identity, and coach assignment.
- [ ] Verify RLS policies and server-side authorization for reading trainee-to-coach assignments.
- [ ] Identify existing Edge Functions or trusted server endpoints suitable for recovery orchestration.
- [ ] Verify the supported Auth password-recovery/update APIs for the actual SDK version.
- [ ] Verify provider behavior for refresh-token/session revocation after password change; document any residual access-token validity.
- [ ] Identify the configured SMS provider and confirm whether it supports delivery status, idempotency, and safe retry. Do not send real messages during discovery.

## Implementation prerequisites
- [ ] Use a dedicated server-side recovery record with atomic state transitions and unique active request constraints.
- [ ] Resolve trainee identity, assigned coach, and verified phone on the server; ignore client-supplied authority fields.
- [ ] Use generic public responses and rate limits that do not reveal account existence.
- [ ] Require coach ownership re-check at approval time.
- [ ] Store only a keyed digest of the OTP; never store/log plaintext outside the isolated test adapter.
- [ ] Use transactional outbox/idempotency for SMS delivery; never rely on in-memory locks for production concurrency.
- [ ] Separate request-review expiry from OTP expiry. The requested 24-hour OTP lifetime must be reviewed against security policy before production; do not silently change it.
- [ ] Use a short-lived, one-use reset grant scoped to the verified trainee and request.
- [ ] Update credentials only through the supported Auth provider API.
- [ ] Invalidate outstanding recovery grants/codes and revoke sessions to the extent supported.
- [ ] Add audit events without secrets, OTPs, passwords, or full phone numbers.

## Required test gates
- [ ] Run the mock-engine unit suite in a Node.js environment and capture the exact command/result.
- [ ] Add server-side integration tests for coach ownership, reassignment, enumeration resistance, throttling, concurrency, delivery retry, expiry, and replay.
- [ ] Test password update using disposable test accounts only.
- [ ] Test old-password rejection, new-password login, session revocation, and recovery-grant replay.
- [ ] Test delivery failure, provider timeout/ambiguous outcome, and safe retry.
- [ ] Test on mobile and desktop browsers before release.

## Release boundary
No merge to main, deployment, schema migration, Auth setting change, real SMS, or use of trainee accounts is authorized by this experimental work. Production release requires a separate explicit approval after all test gates pass.
