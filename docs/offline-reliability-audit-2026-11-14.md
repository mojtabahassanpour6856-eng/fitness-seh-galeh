# Offline reliability audit — 2026-11-14

## Scope and safety boundary

- Audited the current `main` snapshot at commit `23df7a441eaefa1dd4c4656f605a0e3f8c206a29`.
- Read-only inspection of application code, service worker, tests, and tracked SQL migrations.
- No production code, database rows, Supabase settings, RLS policies, or Storage objects were changed.
- A migration file in the repository is not evidence that it has been applied to the connected Supabase project. Deployment status must be checked separately before any schema-dependent implementation.

## Confirmed current behavior

1. `sbWrite(path, method, body)` sends a direct REST request and returns the response. It does not attach a durable operation ID, idempotency key, or persistent outbox record.
2. The service worker caches a constrained same-origin app shell and static assets. Its tests explicitly verify that Supabase API requests, unknown dynamic paths, and POST requests bypass the cache. This is correct for avoiding accidental caching of private API data, but it does not make writes offline-capable.
3. The only confirmed application `localStorage` persistence found in the inspected main bundle is for user-created meal recipes. It is not an authenticated, per-user write queue. No IndexedDB-backed outbox was found in the inspected main bundle.
4. The app has multiple independent write paths. A global offline queue must not intercept all writes indiscriminately.

## High-priority write paths and risks

| Area | Current observed pattern | Reliability concern |
|---|---|---|
| Manual progress | Client writes `weight_logs`, then separately writes `body_analyses` in multiple handlers | A disconnect between requests leaves a partial record. A progress RPC migration exists in the repo, but the inspected main bundle does not call `/rpc/record_trainee_progress`. |
| Membership + payment | Membership row is created, then payment row is created in a second request in several flows | A timeout or disconnect can leave membership without its corresponding payment; blind retry can duplicate either row. |
| Membership card number | Client reads existing numbers, generates a candidate, checks collision, then inserts | Read-then-insert race; uniqueness must be enforced by the database and retries must verify the existing row. |
| Workout editor | Several direct REST write paths; one path submits a selected movement group as a multi-row insert and validates returned rows | A multi-row insert is better than per-row writes but does not make the whole multi-step editing flow atomic. A full-plan atomic RPC migration exists in the repository; integration/deployment must be verified. |
| Nutrition builder | Main bundle calls `/rpc/save_coach_nutrition_builder_plan` | This is the strongest existing atomic-save pattern. The migration is tracked in the repo; confirm it is deployed and its overload resolves correctly before depending on it. |
| Water/activity/fasting/notes/goals/supplements/injuries/food logs | Independent POST/PATCH/DELETE requests | These need per-operation retry policy and server-side deduplication before any automatic replay. |
| Body-analysis files/receipts | Database metadata and Storage uploads are separate concerns | Must not replay file upload or metadata blindly; use a staged upload protocol and verify object existence/ownership. |

## Existing SQL assets discovered

- `supabase/migrations/202610220001_save_trainee_workout_plan_atomic.sql`: transactional workout-plan replacement with coach and trainee access checks.
- `supabase/migrations/202611030001_save_coach_nutrition_builder_atomic.sql`: coach-only atomic nutrition-builder save, preserving previous plans as inactive history.
- `supabase/migrations/202611130001_atomic_trainee_progress_rpc.sql`: `record_trainee_progress` uses SECURITY INVOKER, validates the active trainee owner, and attempts to fill missing halves of a prior two-table write.

Important review note for the progress RPC: its deduplication key is effectively trainee + date + rounded weight, not a client-generated operation ID. If the same trainee legitimately records the same weight/date with corrected measurements, the current function can treat it as an already-existing manual record and not update the changed measurements. Do not adopt this RPC as the generic offline idempotency mechanism without revising its contract and tests.

## Identity and isolation requirements for a future outbox

Every queued operation must be bound to:
- Supabase project/environment identifier;
- authenticated Supabase user ID (`auth.uid()`);
- resolved application role;
- trainee ID, when applicable;
- operation ID generated once at the moment of user submission;
- schema/version and operation type.

Before replay:
1. Obtain a fresh authenticated session; never store access or refresh tokens in the outbox.
2. Require the same authenticated user and expected role. If the account differs, quarantine the item; never replay it under the new account.
3. Re-check server authorization/RLS. Client-side trainee ownership checks are defense-in-depth only.
4. Send the original operation ID unchanged. The server must enforce uniqueness in a durable idempotency ledger scoped to user + operation type, and return the original result on retry.
5. Mark an item complete only after the server returns a definitive committed result and the client verifies the returned operation ID/result.
6. Treat timeouts, connection resets, browser termination, and ambiguous 5xx responses as UNKNOWN, not FAILED. Query operation status before replay.
7. Never automatically replay destructive deletes, payment/receipt operations, or multi-step file workflows until each has a purpose-built server contract.

## Proposed outbox state machine

- `draft`: local form draft only; not yet submitted.
- `queued`: validated payload persisted in IndexedDB and bound to the current account.
- `sending`: lease acquired by one sync worker/tab.
- `committed`: server confirmed operation ID and result.
- `retry_wait`: definite transient failure; exponential backoff with jitter.
- `unknown`: outcome ambiguous; status lookup required before replay.
- `blocked_auth`: user/session mismatch or expired session; wait for re-authentication.
- `blocked_validation`: permanent validation or authorization failure; user action required.
- `cancelled`: cancelled before send only. Once sending begins, cancellation cannot imply rollback.

Use a unique local key on operation ID, a lease/lock to prevent two tabs sending the same item, and a bounded retention period. Encrypt sensitive queued payloads where feasible, minimize stored fields, and clear/quarantine account-scoped records on logout or account switch. Do not cache private API responses in the service worker.

## Recommended implementation order

1. Finish the write-path inventory, including every upload, RPC, and direct REST mutation.
2. Confirm which SQL migrations are deployed in a disposable Supabase branch; inspect relevant RLS and constraints read-only first.
3. Define a server-side idempotency ledger and status RPC. Do not rely on client-only UUIDs.
4. Convert one low-risk, single-row operation (for example a trainee water log) end-to-end in an isolated test branch, including account switching, two tabs, timeout-after-commit, and browser restart tests.
5. Convert multi-table operations to purpose-built transactional RPCs before queueing them.
6. Add IndexedDB outbox and visible states only after server idempotency is proven.
7. Keep `main` unchanged until offline, duplicate, ownership-isolation, and regression suites pass.

## Explicit non-goals for this audit branch

- No implementation of offline writes.
- No changes to the production Supabase project or migrations.
- No broad caching of API responses.
- No automatic replay of payments, membership changes, body-analysis imports, or Storage uploads.


## Supabase read-only verification — 2026-11-14

The connected projects were identified by name before inspection:
- Production: `fitness seghale` (`qfakyudgidsumeuoqoot`, `eu-west-1`).
- Test: `fitness-seh-galeh-test` (`udptdznbvewkublvzmtm`, `eu-west-1`).

No database writes, migration applications, settings changes, or Storage uploads were performed.

### Migration deployment status

The production migration history includes:
- `20261022201809 save_trainee_workout_plan_atomic`
- `20261022201811 experimental_workout_rpc_compat`
- `20261103142009 save_coach_nutrition_builder_atomic`
- `20261113110113 atomic_trainee_progress_rpc`

Therefore these migrations are recorded as applied in the production database migration history (unlike merely existing as repository files). This still does not prove that every current frontend path calls the RPC; the audited main bundle's manual progress handlers still used separate REST writes.

The test project's migration history also includes its isolated progress RPC setup. Its database contains sandbox-specific permissive anonymous policies for fake workout rows. These are test-only fixtures and must never be copied to production.

### Production security advisor findings

The production security advisor returned:
- Four SECURITY DEFINER functions executable by `authenticated`: `experimental_save_trainee_workout`, `experimental_workout_snapshot`, `save_coach_nutrition_builder_plan`, and `save_trainee_workout_plan_atomic`.
- One informational RLS-enabled/no-policy finding for `public.exercises_duplicate_archive_20261023`.
- Leaked-password protection is disabled in Supabase Auth.

The SECURITY DEFINER warning is not by itself proof of an authorization bypass: the inspected function bodies include authentication/role/trainee-access checks and fixed search paths. However, the functions are exposed RPC entry points and require an explicit intended-caller/grant review. In particular, experimental RPCs should not remain callable by authenticated users unless the app intentionally uses them. The nutrition RPC must remain coach-only at the server boundary. Do not resolve these warnings by blindly changing SECURITY DEFINER to INVOKER; that can break legitimate transactional behavior or access checks.

The test project's advisor additionally reported one anonymous-executable SECURITY DEFINER nutrition RPC and four RLS-enabled tables with no policies in its sandbox schema. This differs from production and reinforces that test fixtures must be isolated. Production advisor did not report anonymous execution of the nutrition RPC.

### Storage verification limitation

The test project's `storage.buckets` query returned no bucket rows, so it is not a valid mirror for validating the production upload policy design. Production Storage bucket/object policies and upload paths remain a separate outstanding read-only inspection. No assumption is made that the test project's bucket configuration matches production.

### Next review gates

1. Inspect production Storage buckets and `storage.objects` policies, including path ownership rules for trainee health reports and payment receipts.
2. Inspect production table grants, unique constraints, foreign keys, and relevant function EXECUTE grants to distinguish intentional RPC exposure from stale/experimental access.
3. Review the exact frontend call sites for each deployed RPC and reconcile app code versus migration history.
4. Review Auth settings for leaked-password protection and document a safe proposed change; do not change it as part of this audit.
5. Only after these checks, finalize the idempotency ledger contract and test plan. No production fix is authorized by this audit.


### Production Storage policy review

Read-only catalog inspection confirmed two private buckets:
- `payment-receipts`: 5 MiB limit; JPEG, PNG, WebP, PDF.
- `trainee-health-reports`: 10 MiB limit; PDF, JPEG, PNG, WebP, HTML.

The `storage.objects` RLS policies require authenticated users and scope upload/read/delete paths through the authenticated user's ID and the trainee's assigned coach/owner relationship. The buckets are not public. Read policies allow the active trainee owner or assigned coach to read the corresponding trainee's objects; upload policies separately distinguish trainee-owned receipt uploads from coach/trainee health-report uploads.

Important operational detail: the inspected policies include INSERT and SELECT policies for these buckets but no UPDATE policy. Supabase Storage upsert/replacement requires INSERT + SELECT + UPDATE. Therefore, if any frontend upload uses `upsert: true` or attempts to overwrite an existing object path, it is expected to fail under the current policy set. This is a conditional finding; actual upload call sites and overwrite behavior still need to be mapped before proposing any policy change. Do not add a broad UPDATE policy without matching the existing folder/trainee ownership checks.

The Storage catalog grants broad table-level privileges to `anon` and `authenticated` on internal Storage tables, but row-level policies remain the effective object-access gate. The buckets themselves are private, and no public object policy was found. This is not a recommendation to change Supabase-managed Storage grants directly.

### Remaining caveats

- The repository code search did not return reliable upload call-site matches, so exact upload methods, object naming conventions, overwrite flags, and metadata-write ordering remain unverified.
- Constraint inspection confirmed foreign keys and basic NOT NULL/CHECK constraints on the principal trainee/progress/plan tables, but did not establish an idempotency uniqueness constraint for each operational write path.


## Exact Top Genesis PDF upload/delete path — verified from current main

The standalone `top-genesis-archive.js` module is the confirmed production upload path for Top Genesis PDFs. It uses:
- private bucket `trainee-health-reports`;
- object path `<coach-auth-uid>/<trainee-id>/<random-uuid>-<safe-filename>`;
- `upload(..., { contentType: "application/pdf", upsert: false })`;
- then a separate INSERT into `public.body_analysis_reports`.

The object naming convention matches the current Storage INSERT policy and the table's `body_analysis_reports_file_path_check`. The bucket's 10 MiB limit matches the client limit and table constraint. The client-generated random UUID plus `upsert:false` avoids same-path overwrite collisions. Thus the earlier conditional concern about missing Storage UPDATE permission does not apply to this confirmed archive upload path.

However, the two-step file+metadata workflow is not atomic:
1. If upload succeeds and metadata INSERT fails, the client attempts a compensating Storage remove. If that cleanup request also fails (offline, timeout, session expiry), an orphan private object can remain without a database row.
2. Delete currently removes the Storage object first, then deletes the metadata row. If the second step fails, the row remains while its file is gone.
3. An ambiguous timeout after either request can leave the client uncertain whether the operation committed. The current flow has no durable operation ID or reconciliation record.

This is a real reliability concern for future offline support, but not a reason to replay these operations automatically. Keep Top Genesis uploads/deletes online-only until a staged upload/reconciliation workflow exists. A future design should persist a pending upload record/status, reconcile object existence and metadata, and make deletion a retryable state machine rather than blind replay.

## Confirmed production table and RPC details

- `body_analysis_reports` has coach-only SELECT/INSERT/UPDATE/DELETE policies. Insert and delete require both the authenticated coach ID and current assignment to the trainee. Its constraints enforce the storage path prefix, PDF MIME type, 10 MiB maximum, JSON object metrics, unique storage path, and trainee/coach foreign keys.
- The current report archive upload is therefore aligned with the production RLS and Storage folder checks, based on the exact module and live catalog policies.
- The workout save RPC and experimental workout RPCs are SECURITY DEFINER with fixed search paths and explicit authenticated-user/coach/trainee access checks. The two experimental functions are present in production migration history and have EXECUTE granted to authenticated users. This is not an observed authorization bypass, but their production exposure should be intentional and documented; do not revoke until frontend call sites and release dependencies are verified.
- The nutrition builder has a SECURITY DEFINER JSON-payload implementation that checks coach role and trainee assignment, plus a SECURITY INVOKER compatibility overload. Both are granted to authenticated users; the invoker wrapper delegates to the guarded implementation.
- `record_trainee_progress` is SECURITY INVOKER and explicitly rejects coach accounts, requiring the active trainee owner. It atomically inserts missing halves of the two-table progress record, but its identity is the tuple trainee/date/exact weight (with advisory lock hash rounded to two decimals), not a client operation ID. It cannot distinguish a legitimate correction to the same date/weight from a retry. Its advisory lock also cannot serialize legacy direct REST inserts that do not acquire the same lock.

## Constraint/index gap relevant to duplicate protection

Read-only index inspection found only primary-key uniqueness for `weight_logs` and `body_analyses`; no unique constraint/index was found on the business identity of a manual progress event. The progress RPC's advisory lock protects concurrent callers of that RPC, but does not provide database-enforced uniqueness against legacy direct REST writes or other code paths. Do not add a unique key on trainee/date/weight without first defining correction semantics and auditing historical duplicates; that could reject legitimate repeat entries or fail migration on existing data.

The same inspection found primary-key-only uniqueness on `nutrition_plans` and `trainee_workout_plans` for the inspected tables. These plan histories intentionally allow multiple rows per trainee, so do not add a simplistic trainee-only unique constraint.

## Current recommendation

- Keep Storage upload and delete operations out of a generic offline queue.
- For manual progress, replace the legacy two-write client path with a purpose-built RPC only after reconciling the RPC's duplicate/correction semantics and verifying every caller. Preserve the strict rule that only the trainee submits; coach views remain read-only.
- For all future queued writes, use a separate server idempotency ledger keyed by authenticated user + operation type + client-generated operation UUID, with a canonical payload hash and status/result lookup. A duplicate operation UUID with a different payload must be rejected, not silently treated as the original.


## Additional production RLS review — progress, membership, payments, receipts

Read-only inspection of `pg_policies`, function definitions, and table columns in production confirmed:

- `private.can_access_trainee(id)` returns true only for the active trainee account that owns the row, or the coach whose `coach_user_id` is assigned to that trainee. It is SECURITY DEFINER with a fixed `pg_catalog, public, pg_temp` search path.
- `private.is_coach()` checks the authenticated user's `profiles.role = 'coach'`.
- `weight_logs` INSERT is authenticated-only and requires `NOT private.is_coach()` plus `can_access_trainee(trainee_id)`; SELECT allows the assigned coach or active trainee owner. There is no UPDATE or DELETE policy in the inspected policy set.
- `body_analyses` INSERT allows coach writes only when the manual-progress marker is absent, and non-coach writes only when the marker is present; both require trainee access. UPDATE and DELETE are coach-only and explicitly exclude rows carrying the manual-progress marker. This enforces the coach-read-only boundary for manual progress at the row-policy layer, subject to the existing marker convention.
- The deployed `record_trainee_progress` RPC is stricter than the general access helper: it rejects coaches and requires the exact active trainee owner. Keep that contract if/when the frontend is migrated to the RPC.
- Membership tables `trainee_membership` and `trainee_memberships`, membership cards, and `trainee_payments` are coach-write-only under the inspected INSERT/UPDATE/DELETE policies; SELECT is available to the assigned coach or active trainee owner. The duplicate singular/plural membership table names are a legacy/schema ambiguity that must be mapped to actual frontend call sites before consolidating anything.
- `trainee_payment_receipts` INSERT requires `submitted_by = auth.uid()`, a valid trainee access relationship, pending status, and empty review fields. SELECT is limited to the assigned coach or the submitting user; review/update/delete are coach-only.

### Receipt policy question to resolve before any redesign

The receipt INSERT policy does not explicitly include `NOT private.is_coach()`. Because `can_access_trainee` also returns true for the assigned coach, a coach account appears able to insert a pending receipt row for an assigned trainee, provided `submitted_by` is the coach's own UID. This may be intentional for a coach-side administrative workflow, or it may be broader than intended. No exploit or data access beyond the assigned trainee relationship was demonstrated. Confirm the intended product behavior and inspect the actual receipt submission UI before proposing a policy change. Do not alter production RLS based on this observation alone.

### Current schema implications

- `trainee_payment_receipts` has a generated UUID primary key, mandatory trainee/submitting-user/path, default pending status, and optional amount/date/note; no operation UUID/idempotency field was found in its inspected columns.
- `trainee_payments` and both membership tables use their own primary keys and have no inspected client-operation identity field. This supports the earlier conclusion that blind replay can create duplicates unless the server provides operation-level idempotency.
- Membership card numbers are stored in `trainee_membership_cards` and `trainee_membership`; frontend read/check/insert behavior still needs exact call-site mapping. Do not add a uniqueness constraint until duplicate historical values and intended cross-table uniqueness scope are audited.

## Auth lifecycle and service-worker regression evidence

The current main branch includes tests for:
- deduplicating concurrent `pageshow` and `visibilitychange` session-restore attempts;
- bounded coach trainee-list retries and restarting recovery on `online`;
- preserving the cached app shell during offline navigation and server 5xx responses;
- explicitly bypassing Supabase API requests, unknown dynamic paths, and all POST requests in the service worker.

These tests support the existing safe shell-cache boundary and basic transient-session/list recovery. They do not prove outbox safety: there is still no tested account-switch quarantine, cross-tab write lease, operation-status reconciliation, or timeout-after-commit replay behavior. Those remain mandatory before any queued write is enabled.



## Follow-up review: deployed policy semantics and regression coverage

The production policy definitions were re-read directly from `pg_policies` and the relevant helper functions. This confirms the following intended boundaries at the database layer:

- `private.can_access_trainee` is a relationship check: active trainee owner OR assigned coach.
- `private.is_coach` derives role from the authenticated user's profile row.
- `weight_logs` insert is limited to non-coach authenticated users with access to that trainee. The inspected policy set contains no direct UPDATE/DELETE policy for this table.
- `body_analyses` distinguishes manual-progress rows through its marker convention: trainee insert is allowed only for marked manual records; coach insert only for non-manual records; coach update/delete excludes manual-progress records.
- `record_trainee_progress` requires the active trainee's own auth UID and rejects coach sessions. This remains the preferred server boundary for the trainee-submitted progress workflow, once the identity/correction contract is fixed.
- Membership and payment tables are coach-write-only; trainee owners can read records associated with themselves.
- Receipt insert requires the authenticated submitter UID, a trainee relationship, pending status, and unset review metadata. The policy does not explicitly reject a coach role, so an assigned coach can apparently create a pending receipt row for their own assigned trainee. Whether that is a product bug or an intentional admin flow remains unresolved; no RLS change is proposed.

The two membership table variants (`trainee_membership` and `trainee_memberships`) and two card representations (`trainee_membership_cards` and `trainee_membership.card_number`) must be mapped to actual runtime handlers before schema cleanup or uniqueness constraints. The receipt/payment/membership tables inspected do not expose a client operation UUID field, so these workflows are not safe for blind automatic retry.

### Current frontend regression tests inspected

The checked-in tests verify:
- auth session lifecycle signals share a single restore attempt;
- dashboard recovery and auth watchdog overlap without duplicate `finishLogin` or trainee-list loads;
- the auth single-flight wrapper blocks a different user from racing an in-progress login;
- bounded trainee-list retries restart on the browser `online` event;
- the service worker serves only the static shell/assets and explicitly bypasses Supabase API, unknown dynamic paths, and POST writes.

These are useful existing protections. However, the tests do not exercise an actual sign-out/account-switch sequence with a pending mutation, nor do they test queued operation quarantine, cross-tab leases, or server-side operation-status reconciliation. Thus they are not sufficient evidence to enable offline writes.

### Source inspection limitation

The current financial handlers appear embedded in the very large monolithic `index.html` bundle (approximately 1.3 MB). The GitHub file reader returns no ranged content for this oversized file, and repository code search did not return matching excerpts for the financial table identifiers. The live database policy/schema review is therefore complete for the tables above, but the exact frontend receipt/payment/membership call sites remain unverified. Do not infer which of the legacy table variants is active from schema presence alone. The next safe step is to obtain a supported source snapshot or split/read-only extraction of the relevant handlers before making any code change.
