# Review of existing Fitness Seh Galeh authentication integration

Review scope: read-only inspection of the current main branch's index.html and existing auth regression tests. No production files or auth configuration were changed.

## Observed existing behavior
- The current app shell contains a shared auth-session coordinator and separate session restoration/watchdog and finish-login coordination scripts. Existing tests exercise the `AUTH_SUPABASE.auth.getSession()` path and ensure overlapping restoration signals do not start duplicate login pipelines.
- The existing auth recovery regression test uses a mocked Supabase auth session and a `profiles` lookup to confirm a coach role before completing the coach login pipeline.
- The existing regression tests cover session restoration and single-flight login coordination. They do not demonstrate password recovery, password update, recovery-code delivery, or global session revocation.
- A targeted scan of the current main `index.html` found no direct `resetPasswordForEmail`, `updateUser`, `signInWithPassword`, or `supabase.auth` call strings. This is a limited static observation, not proof that no auth operation exists elsewhere or through dynamically loaded code.

## Integration conclusion
1. Do not add password recovery to the existing session restoration/watchdog scripts. Those scripts restore an already authenticated session; recovery is a separate unauthenticated-to-verified-reset flow.
2. Keep the current coach/trainee login pipeline unchanged. Recovery should be a separately scoped feature with its own UI and server-authoritative endpoints.
3. Before implementation, identify the exact initialized Supabase client, auth SDK version, current trainee/coach role resolution, profile ownership model, and any server-side auth functions. Do not infer those from test mocks.
4. Confirm the supported Supabase Auth recovery/update APIs and token/session revocation behavior for the project's actual SDK and auth configuration. Do not assume password change automatically revokes every existing session.
5. A recovery endpoint must resolve the trainee and assigned coach from trusted server-side records; the browser must never supply authoritative trainee ID, coach ID, or SMS destination.
6. The final password update must use the supported Auth API in a trusted flow. The existing browser-side app must never write password hashes or privileged auth records.

## Safe implementation sequence
- Stage A: map current auth client initialization and role/profile lookup; read-only only.
- Stage B: write a provider-specific flow design against the verified SDK/configuration; no code changes.
- Stage C: implement isolated server-side prototype and mock SMS adapter on a test branch only.
- Stage D: add integration tests for correct trainee, coach ownership, generic public responses, single-use reset grant, provider failure, and session invalidation.
- Stage E: manually test with disposable coach and trainee accounts. Only then request separate approval for any production migration or release.

## Acceptance gate
Until the exact auth client/configuration and provider semantics are verified, no live password reset, SMS sending, auth setting change, database migration, merge, or deployment is authorized by this experiment.
