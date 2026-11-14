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

### Source inspection limitation — resolved by Git blob retrieval

The standard file/range reader returned empty content for the 1.3 MB monolithic `index.html`, but the repository Git blob endpoint successfully returned the full UTF-8 source. The following runtime call sites are now verified directly in the current main bundle. This resolves the earlier source-access limitation for the financial flows; it does not authorize code or database changes.

### Verified membership and payment handlers

- The active coach-facing membership handler is the later integration override `window.saveSubscription`, defined in the `SUBSCRIPTION PAYMENT SAFETY PATCH 2026-10-09` block. It writes to plural `trainee_memberships`, optionally `trainee_membership_cards`, and `trainee_payments`.
- It first reads recent `trainee_memberships.card_number` values and `trainee_membership_cards.card_number`. If none exists, it generates a four-digit candidate using Web Crypto where available and checks the card table before inserting. This remains a client-side read/check/insert race: there is no database uniqueness guarantee established by this flow, and the separate card-registry insert failure is caught and only logged. The membership row still stores the generated number.
- Membership and payment are separate writes. The handler deliberately stores a pending-payment marker in `sessionStorage` under `fitness_seh_galeh_pending_membership_payment_v1` after the membership insert and before attempting the payment insert. On a subsequent click in the same tab, it checks trainee, amount, paid label, start and end dates and retries only the payment insert, avoiding a second membership insert in that known failure path.
- This is a useful partial-failure guard, not server idempotency. The marker is tab-scoped, can be lost, and is not tied to auth UID, project/environment, stable operation UUID, or a server status ledger. If the payment insert commits but the response is lost, a retry can still create a duplicate payment. A new tab will not necessarily see the marker. Do not classify this as safe for offline replay.
- The bundle also contains an earlier legacy `saveSubscription` function that directly inserts membership then payment with no partial-failure guard. The later `window.saveSubscription` assignment overrides the global handler. Future refactoring must verify all HTML event bindings resolve to that override; remove or isolate the dead legacy implementation only in a separately tested cleanup, not as part of this audit.

### Verified receipt submission and approval handlers

- Trainee receipt submission is `window.submitPaymentReceipt`. It requires trainee mode and current trainee ID, validates file type/size (5 MiB), uploads to private `payment-receipts` with `upsert:false`, then inserts a `trainee_payment_receipts` row with submitter UID and pending status.
- If the metadata insert reports an error, the client attempts to remove the just-uploaded object. This is compensating cleanup only; if the upload succeeded but the insert response is ambiguous, or cleanup fails due to connectivity/session loss, the system can leave an orphaned object or an uncertain outcome. The object path includes UID, trainee ID, timestamp and filename, but not a stable operation ID. This two-step upload must remain online-only and must not be placed in the generic offline queue.
- Coach review is `window.reviewPaymentReceipt`. For approval it performs three separate operations in this order: insert a `trainee_payments` row; attempt to update all matching `trainee_memberships` rows to active/paid (errors are only logged); then update the receipt row to approved with reviewer metadata. These operations are not transactional and have no operation ID.
- Important retry hazard: if payment insert succeeds but receipt status update fails or its response is lost, the receipt remains pending and a second approval attempt can insert another payment. If the membership update fails, the receipt can still be marked approved while membership status remains stale. This is a confirmed workflow-level idempotency/atomicity gap, not merely a theoretical schema concern.
- Receipt rejection only updates receipt review metadata; it does not create a payment. The review handler checks pending status before acting, but that read-then-write check is not a concurrency lock and does not prevent two simultaneous approvals from both passing the initial read.

### Confirmed logout and account-switch behavior relevant to pending writes

- The primary `logoutApp()` invalidates a nutrition read-generation counter, clears the selected trainee and plan IDs, calls Supabase `signOut()`, and reloads the page.
- A separate account-switch UI handler also calls `auth.signOut()` and reloads. Neither handler currently inspects or quarantines a pending membership payment marker before sign-out. The marker is in `sessionStorage`, so it survives a reload in the same tab but is not scoped to the authenticated user. If the same tab switches accounts, a later coach could encounter a stale marker; the `samePayment` guard checks trainee and form fields but not auth UID or project reference. This must be corrected before any persistent outbox work is introduced.
- The receipt upload flow has no durable local operation record and should not be automatically retried after ambiguous failures.

### Revised implementation priorities

1. Treat membership + payment and receipt approval as multi-step business transactions. Design server-side RPCs that validate coach ownership and commit all required DB rows/status changes atomically, with a stable operation UUID and a unique idempotency ledger. Keep file upload outside the DB transaction but add a staged upload/reconciliation state machine before considering offline support.
2. Scope and quarantine the existing pending-payment recovery marker by project/environment, auth UID, trainee ID and operation ID; on account switch, never replay it under a different identity. Because current marker has no operation UUID and the payment API has no server-side deduplication, do not automatically replay an ambiguous payment.
3. Confirm HTML event bindings and the exact active override in browser tests before removing the earlier legacy function.
4. Only after the above are deployed and tested should a generic outbox be considered. Keep receipts, membership, payments, deletion, and Storage uploads excluded from automatic offline replay until their dedicated idempotency contracts exist.


## Follow-up: account-switch verification and transaction contract (design only)

### Account-switch path verified

The current source contains two user-visible sign-out paths:
- the main `logoutApp()` called by the top account bar and trainee profile exit;
- the dynamically installed `sehSwitchAccountBtn` handler for saved-account switching.

Both call Supabase `auth.signOut()` and reload the page. Neither currently checks, clears, or quarantines the membership pending-payment marker. The pending marker is a single `sessionStorage` key and does not include the current auth UID or Supabase project reference. This confirms the account-boundary gap. Do not solve it by blindly deleting the marker on sign-out: that could erase the only recovery clue for a payment that may already have committed. The safe future behavior is to quarantine it under the identity/environment that created it and require status reconciliation before any retry.

The trainee-auth flow also calls `signOut()` in several validation-failure paths (duplicate phone match, no trainee match, inactive approval, account already linked elsewhere, or failed account linking). Those paths are not necessarily initiated by a human account switch, but they reinforce why recovery state must be bound to identity and environment rather than relying on one logout button.

### HTML binding and active handler verification

- The membership form's button uses the global `saveSubscription()` name.
- The bundle first defines an older function declaration, then later assigns the safer implementation to `window.saveSubscription` in the subscription safety patch. Browser-level regression tests must confirm the final global assignment is active when the form is used. The older implementation is not the desired implementation and should not be revived during refactoring.
- The trainee receipt button calls `submitPaymentReceipt()`, which resolves to the later `window.submitPaymentReceipt` implementation.
- Coach receipt action buttons call `reviewPaymentReceipt(id, decision)`, resolving to the later global handler inspected above.

### Proposed server transaction contracts — not implemented

These are the minimum contracts to implement and test in a sandbox before touching production:

1. **Operation ledger**
   - Store a client-generated UUID for every business operation, with a unique constraint on (authenticated actor UID, operation kind, operation UUID); include environment/project identity in the client envelope and validate server-side deployment context.
   - Persist a canonical request hash and terminal result. Reusing the same operation UUID with a different request hash must be rejected, not treated as a retry.
   - A retry with the same UUID and same hash returns the previously committed result. The ledger row and business writes must commit in the same database transaction.
   - Never accept actor UID, role, coach ID, or trainee ownership as trusted client claims. Derive actor from `auth.uid()`, derive role from the trusted profile, and verify the assigned coach/trainee relationship inside the RPC.
   - Avoid persisting access or refresh tokens. Never replay a queued operation after account/environment mismatch.

2. **Membership creation + optional payment**
   - Replace the two-step client write with one coach-authorized RPC that records the membership and, when appropriate, its initial payment atomically.
   - The RPC should preserve the current product semantics for paid/unpaid membership and card number, but must not generate a payment for unpaid memberships or a zero amount.
   - Define whether a retry updates an existing membership or returns the prior result; the operation ledger makes retries of one submission idempotent without imposing an incorrect unique-per-trainee membership constraint.
   - Card-number allocation must be serialized and backed by an appropriate uniqueness rule after a read-only audit of historical duplicates and the intended uniqueness scope. Do not add a constraint until that audit is complete.

3. **Receipt approval/rejection**
   - Use one coach-authorized RPC with a row lock on the target receipt and a conditional transition from pending to approved/rejected.
   - Approval must atomically create exactly one payment, update the relevant membership status according to the defined business rule, and mark the receipt approved. Rejection must atomically mark it rejected without a payment.
   - Repeated calls with the same operation UUID return the prior result. A different operation attempting to act on an already terminal receipt returns a stable conflict/previous-state result and cannot create another payment.
   - Scope the membership update precisely. The current client code updates every `trainee_memberships` row for the trainee; the desired rule (latest active membership versus a specifically referenced membership) must be settled before implementation.

4. **Receipt file upload**
   - Keep Storage upload separate from the database transaction. Use a generated upload operation UUID in the object path and a staged database record with states such as `upload_pending`, `file_uploaded`, `submitted`, `cleanup_required`, and `quarantined`.
   - Reconcile ambiguous upload/metadata outcomes by querying the staged record and checking object existence before retry or cleanup. Do not blindly upload a second object or delete a file based only on a lost HTTP response.
   - Keep the existing private bucket, size/MIME constraints, ownership checks and `upsert:false` behavior unless a separately reviewed change requires otherwise.

5. **Account-switch and offline queue boundary**
   - Bind every queued operation to project/environment, actor UID, role, trainee ID, operation kind, UUID, payload hash and schema version.
   - On sign-out or account switch, stop dispatch immediately and quarantine pending/unknown operations. Do not delete them and do not replay under the next account.
   - On restoration, verify current project, auth UID, role and trainee relationship, then query server operation status before retrying any operation whose outcome is unknown.
   - Keep payments, membership, receipts, Storage uploads, deletes and other non-idempotent multi-step workflows out of generic automatic replay until their dedicated RPC/status and staged-upload contracts have passed failure-injection tests.

### Required sandbox acceptance tests before production consideration

- Same operation UUID + same payload submitted twice creates one business result and returns the same result.
- Same operation UUID + different payload is rejected.
- Server commits, response is deliberately dropped, then client retries: no duplicate payment/membership.
- Two coach tabs approve the same pending receipt simultaneously: exactly one payment and one terminal receipt transition.
- Receipt membership update fails: the whole approval transaction rolls back; receipt remains pending and no payment persists.
- Sign out while an operation is queued or sending: dispatch stops and the operation is quarantined under the old UID.
- Sign in as a different user in the same tab: old operation is not visible for replay and cannot be sent.
- Restore the original account: operation status is reconciled before retry.
- Receipt Storage upload succeeds but metadata submission is interrupted: reconciliation finds the uploaded object/staged record without creating duplicate files or losing the receipt.
- Existing trainee role restrictions remain intact: trainees submit receipts and their own progress; coaches review receipts and remain read-only for trainee-entered progress.

No RPC, schema, RLS, Storage, Auth setting, production row or application runtime code was changed in this follow-up. This section is an implementation contract and test plan only.


## Follow-up: test-project readiness for financial idempotency work — 2026-11-14

### Read-only schema inventory

The connected test project `fitness-seh-galeh-test` (`udptdznbvewkublvzmtm`) was re-identified by project metadata as ACTIVE_HEALTHY in `eu-west-1`, running PostgreSQL 17.11.0.003. Its migration history includes the isolated workout, nutrition, and trainee-progress test migrations.

A verbose schema inventory and catalog query found these 12 tables in `public`: `trainees`, `profiles`, `exercises`, `trainee_workout_plans`, `trainee_workout_exercises`, `foods`, `nutrition_plans`, `nutrition_meals`, `nutrition_meal_foods`, `nutrition_food_substitutes`, `weight_logs`, and `body_analyses`. All 12 have RLS enabled. The inventory does **not** contain the production financial workflow tables `trainee_memberships`, `trainee_membership_cards`, `trainee_payments`, or `trainee_payment_receipts`; it also does not contain `body_analysis_reports`. The existing test project therefore cannot validate the membership/payment and receipt-approval transaction contracts as-is. It is currently a workout/nutrition/progress sandbox, not a complete production-schema clone.

The test project has no production data; the inspected table row estimates were zero. This is consistent with the branch/test fixture purpose and does not establish behavior against production history or real user records.

### Test-only exposure findings

The test project's security advisor was re-run read-only. It reports:
- One `SECURITY DEFINER` RPC, `public.save_coach_nutrition_builder_plan(jsonb)`, executable by `anon`.
- Four `SECURITY DEFINER` RPCs executable by `authenticated`, including the experimental workout endpoints and nutrition/workout save endpoints.
- Four RLS-enabled tables in sandbox schema `workout_batch_test` without policies.
- The public schema also contains explicitly named anonymous test policies for fake workout rows/exercise reads.

These are test-environment findings and must not be copied into production. They make the current test project unsuitable as an unattended place to exercise real user-shaped payloads or to treat advisor cleanliness as a release gate. Do not change/revoke these fixtures as part of this audit; first identify the tests that depend on them and isolate them from any future financial acceptance suite.

### Implication for the next implementation step

Do not write or apply a financial RPC migration to this test project yet. The safe next gate is to prepare a **separate isolated financial test schema/project fixture** containing only the minimum table structures, constraints, helper functions and authorization model needed to test membership creation, payment creation, receipt transitions, and operation-ledger behavior. It must use synthetic identities and data only, no production export or personal information.

Before any DDL is applied, review the exact schema and authorization design. Prefer keeping the operation ledger in a non-exposed schema, with narrowly scoped function access and explicit actor/coach/trainee checks. Supabase's current changelog states that new public-schema tables are no longer automatically exposed through the Data API (enforced across projects from 2026-10-30); any future API-facing table must be deliberately exposed and granted, while an internal ledger should not be exposed merely for convenience. The current database-functions guidance recommends SECURITY INVOKER by default; any SECURITY DEFINER endpoint needs a documented necessity, fixed search_path, explicit `auth.uid()` checks, restricted EXECUTE grants, and advisor review.

No schema, migration, data, RLS policy, grant, Auth setting, Storage object, or application runtime code was changed during this follow-up. Only this audit document on the isolated Git branch is being extended.


## Follow-up: production financial schema and card-number history — 2026-11-14

### Exact production schema inventory

A second read-only catalog pass captured the current production columns, constraints and indexes for `trainee_memberships`, `trainee_membership_cards`, `trainee_payments`, `trainee_payment_receipts`, `trainees`, and `profiles`.

Key facts relevant to implementation:
- `trainee_memberships` has a primary key, a non-unique index on `trainee_id`, and a foreign key to `trainees`. It intentionally permits membership history for one trainee. Its `payment_status` CHECK permits `paid`, `unpaid`, and `pending`. Its copied `card_number` column has no unique constraint.
- `trainee_membership_cards` is a separate registry with UNIQUE constraints on both `card_number` and `trainee_id`. It also validates a four-digit number in the 1001–9999 range. This is an important correction to the earlier statement that no database card-number uniqueness was established: uniqueness **does exist in the registry table**, but not on the denormalized `trainee_memberships.card_number` copy. The client currently treats registry insertion failure as non-fatal, so a membership may still be saved even if registry allocation fails.
- `trainee_payments` has only its primary key plus a trainee foreign key and non-unique trainee index. There is no operation/payment idempotency key or unique business constraint in the inspected schema.
- `trainee_payment_receipts` has UUID primary key, a CHECK restricting `review_status` to `pending`, `approved`, or `rejected`, a trainee foreign key and a non-unique trainee index. It has no operation ID, no payment reference, and no uniqueness constraint tying one approved receipt to one payment.
- `profiles.role` is a text column defaulting to `trainee`; authorization must continue to read the trusted database profile, not a client-provided role.
- `trainees` contains both `auth_user_id` and `coach_user_id`; RPCs must validate the current authenticated actor against the appropriate active trainee/assigned coach relationship, not trust these identifiers from payload fields.

### Aggregate-only history check for card numbers

No card numbers or trainee identifiers were returned. Aggregate counts show:
- `trainee_memberships`: 11 rows, 11 non-null card-number values, 8 distinct values.
- `trainee_membership_cards`: 8 rows, 8 distinct card-number values.
- The 3 repeated card-number values in membership history are all repeats for the **same trainee**; no card-number value is shared across different trainees in the inspected data.
- `trainee_payments` has 12 rows and `trainee_payment_receipts` has 6 rows at the time of this read-only check.

This means repeated membership card numbers are currently consistent with a trainee retaining the same card number across multiple membership-history rows. A UNIQUE constraint on `trainee_memberships.card_number` would therefore be incorrect and must not be added. The registry's UNIQUE(card_number) and UNIQUE(trainee_id) constraints are the correct current allocation guard. Future membership RPC logic should treat the registry as the canonical allocation record, serialize concurrent allocation, and keep the copied membership value consistent; it must not reject legitimate membership history.

The aggregate check is only a point-in-time count. It does not prove every membership row is correctly synchronized with the registry, so a future cleanup must first compare membership-to-registry consistency without exposing personal data.

No production records, schema, constraints, grants, policies, functions, settings, or application runtime code were changed. This section records read-only findings only.


## Follow-up: transaction/RPC security design gate — 2026-11-14

### Current Supabase documentation and platform changes checked

The current Supabase changelog and database-function/security-advisor documentation were checked before proposing database implementation.

- Supabase's published Data API change says new `public` tables are no longer automatically exposed; the rollout is stated to apply to existing projects from 2026-10-30. A new table must receive explicit grants if the Data API should reach it. Grants and RLS are separate controls. The operation ledger should not receive client-facing grants merely because it is created in a database. See https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically.
- Current database-function guidance recommends caller privilege (`SECURITY INVOKER`) by default. Supabase's advisor explicitly warns that a `SECURITY DEFINER` function executable by authenticated users is a privileged API endpoint and requires deliberate authorization, restricted EXECUTE grants, and a documented reason. See https://supabase.com/docs/guides/database/functions and https://supabase.com/docs/guides/observability/advisors.
- The production project is PostgreSQL 17.11.0.003, so Postgres 15+ security-invoker view support is available if needed; no view is required for the operation ledger design.

### Production ACL facts relevant to choosing RPC security

A read-only privilege/catalog query found:
- `authenticated` currently has table-level SELECT/INSERT/UPDATE/DELETE grants on all four financial tables. Row access remains constrained by their RLS policies.
- `anon` did not appear among the direct table grants returned for those financial tables.
- The `private` schema currently has USAGE for `authenticated`, but not `anon`; CREATE is false for both.
- Existing `private.can_access_trainee(uuid)` and `private.is_coach()` helpers are owned by `postgres`, SECURITY DEFINER, with EXECUTE granted to `authenticated` and `service_role`, but not PUBLIC/anon.
- Existing nutrition and workout RPCs are SECURITY DEFINER; the named-argument nutrition adapter and trainee-progress RPC are SECURITY INVOKER. Their ACLs explicitly list authenticated/service_role and omit PUBLIC/anon.

This means an authenticated caller can already perform some direct writes to financial tables when RLS allows them. A future RPC must not assume that making the function SECURITY INVOKER alone creates atomicity or idempotency; all business mutations must be inside one database transaction and direct-write bypasses must be addressed in a separate compatibility/migration plan, not by silently removing current client access.

### Chosen design direction for the first financial RPC prototype

Do not implement or deploy yet. The next prototype should be built only in a dedicated isolated financial fixture, with synthetic accounts and rows.

1. **Narrow privileged transaction boundary.** A single public RPC entry point may need `SECURITY DEFINER` to atomically coordinate the private operation ledger and several existing business tables without exposing ledger write access to clients. If used, it must have:
   - fixed `search_path = pg_catalog, public, private, pg_temp`;
   - explicit `auth.uid() IS NOT NULL`;
   - trusted role lookup via `private.is_coach()`, never a client role claim;
   - exact coach-to-trainee ownership verification using the trusted database relationship;
   - explicit input validation and row locks;
   - `REVOKE ALL ... FROM PUBLIC, anon` and only the required `GRANT EXECUTE ... TO authenticated`;
   - no generic table/column names or dynamic SQL derived from client payload;
   - security-advisor review and tests proving no cross-coach access.
   
   This is a deliberate exception to the SECURITY INVOKER default, justified only if the isolated prototype proves that a single transaction cannot safely use the existing RLS/grants model. If a SECURITY INVOKER design can meet the same requirements without weakening the ledger, prefer it.

2. **Private operation ledger.** Candidate table in a non-API schema, with a unique key on `(actor_uid, operation_kind, operation_id)`, canonical JSONB request hash, stored result JSONB, and creation/completion timestamps. Actor UID is always `auth.uid()`. The table must not be directly writable or readable by `anon`/ordinary client requests. Confirm the project's exposed-schema configuration and effective grants before creating it; do not assume that a schema named `private` is automatically outside the Data API. Ledger insertion, business writes, and result persistence must commit or roll back together.

3. **Replay/concurrency algorithm.** For each call:
   - validate actor, role, trainee relationship, operation kind and UUID;
   - canonicalize and hash the complete business payload, excluding transport-only fields;
   - attempt to claim the unique operation key;
   - on conflict, lock/read the existing ledger row; return the stored result only if the payload hash matches; reject UUID reuse with a different payload;
   - for receipt approval/rejection, lock the receipt row with `SELECT ... FOR UPDATE` and transition only from `pending`;
   - write payment, membership state, receipt state, and ledger result in the same transaction.
   
   The unique ledger key serializes retries for the same actor/operation. Receipt row locking independently serializes competing approvals using different operation IDs. A second distinct operation against an already-terminal receipt must return a stable conflict/current state and never create a second payment.

4. **Membership card allocation.** Preserve existing `UNIQUE(card_number)` and `UNIQUE(trainee_id)` constraints on `trainee_membership_cards`. Lock the trainee row or use an equivalent database-side serialization mechanism before checking/allocating a number. Registry allocation and membership insert/copy must occur in one transaction. Do not add uniqueness to `trainee_memberships.card_number`; the aggregate history audit proves that would reject legitimate history.

5. **Legacy direct-write compatibility.** Since authenticated currently has direct DML grants on the finance tables, old clients may continue bypassing the new RPC until the app is migrated. Do not revoke those grants in the same first prototype. First migrate the active handlers behind feature gating, verify the deployed client versions and all call sites, and plan a controlled cutover. Until that gate is passed, the new RPC guarantees apply only to callers that actually use it; they do not magically make old direct REST writes idempotent.

6. **Receipt files remain a separate workflow.** The database transaction must not pretend it can atomically commit a Storage object. Keep upload online-only and use a staged upload record/reconciliation protocol in a later isolated phase. Do not add receipt file operations to the generic offline outbox.

### Test fixture decision

The existing test project is missing the four financial tables and contains permissive test-only objects/advisor findings. It is not an appropriate place to apply this design directly. The preferred next step is a separate, disposable fixture (isolated project or an isolated local Postgres/Supabase stack) with:
- synthetic coach and trainee auth identities;
- minimal schema matching the production columns, checks, FKs, relevant RLS policies and grants;
- the operation ledger and prototype RPC;
- deterministic concurrency tests with two independent sessions;
- no production export, real names, phone numbers, receipt files, or copied personal data.

No SQL/DDL, migration, grant, policy, function, data, Storage, Auth, or application runtime change was made in this follow-up. Only this design-gate section was added to the audit document on the isolated Git branch.


## Prototype milestone: isolated receipt-review idempotency fixture — 2026-11-14

A separate branch, `prototype/receipt-idempotency-fixture-20261114`, was created from the audit branch. It contains a disposable PostgreSQL 17 fixture and CI workflow, not a production migration:

- `tests/financial-receipt-idempotency.fixture.sql`: synthetic coach/trainee identities, receipt/payment tables, private operation ledger, and a narrowly scoped `review_receipt_idempotent` RPC.
- `tests/financial-receipt-idempotency.integration.sql`: assertions for same-operation replay, same-ID/different-payload rejection, terminal receipt protection under a different operation ID, rejection without payment, cross-coach denial, trainee-role denial, atomic rollback after an injected payment failure, and denial of direct ledger reads.
- `.github/workflows/test-financial-receipt-idempotency.yml`: disposable PostgreSQL 17 CI service; no Supabase credentials or production data.

The fixture intentionally uses only synthetic identities and does not connect to either Supabase project. It is a prototype of the receipt review boundary, not an implementation for the live app.

### Important scope limitations (not yet passed release gates)

1. The fixture has not yet been confirmed green by a completed GitHub Actions run. A pending commit status is not a passing test.
2. It tests sequential retry and transaction rollback, but does not yet exercise two truly concurrent database sessions. A two-session race test remains mandatory before claiming concurrency safety.
3. The production payment table currently has no receipt foreign key/idempotency key. The fixture does not add a new production column or unique constraint; it tests terminal-state + row-lock protection in the RPC transaction. Production implementation must preserve existing payment schema or separately justify and migrate any linkage.
4. Membership activation remains deliberately outside this first prototype. Production currently updates all memberships for a trainee during receipt approval, which is too broad without a settled rule for selecting the intended membership. Do not carry that behavior into a new RPC until the business rule is decided and represented in schema/tests.
5. This fixture does not yet cover membership creation/card allocation, upload staging, outbox replay, sign-out quarantine, or account switching.
6. The fixture is a minimal transaction/authorization model, not a byte-for-byte copy of production RLS policies, table definitions, or grants. Before porting, compare every relevant production column, check, FK, policy and caller path.

No production or test Supabase project was modified. No application runtime code, existing client handler, live payment, membership, receipt, Auth, Storage, RLS, grant or migration was changed. The fixture exists only in the separate Git branch above.


### Concurrent receipt-review race test added and CI-confirmed

The first concurrent-test attempt exposed a test-harness issue: an asynchronous `dblink` result had not been fully drained before issuing COMMIT. The test was corrected to consume the trailing empty result, and a further assertion now verifies that session B is still busy (waiting on the receipt row lock) before session A commits.

The corrected two-session test uses independent PostgreSQL connections, the same authenticated coach identity, one pending synthetic receipt, and two distinct operation UUIDs. It holds session A's transaction open after the RPC returns, confirms session B remains blocked, commits session A, then verifies session B receives the expected terminal-receipt rejection. Final assertions require exactly one payment and an approved receipt.

The GitHub Actions run for commit `3ca40d80b6f7dd4b5c3f8d16878a6265965c86a7` completed the SQL test step successfully on PostgreSQL 17.12. This now verifies the prototype's row-lock race behavior in a real two-session database test, in addition to retry, payload mismatch, authorization, private-ledger ACL, and rollback tests. Earlier intermediate commits in this branch had expected test failures while the harness was being corrected; the latest run is the relevant result.

Still not covered: production schema/RLS parity, membership activation rule, membership/card allocation, receipt upload staging, offline outbox/account switching, and app-client migration. This is a green isolated prototype test, not approval to deploy its SQL to Supabase.


### Production membership-history aggregate confirms activation ambiguity

A further aggregate-only production query returned no trainee IDs or personal fields:
- 11 membership rows belong to 8 trainees.
- 3 trainees have multiple membership rows; all 3 also have multiple rows whose current status is `active`.
- Every inspected membership row currently has `status='active'` and `payment_status='paid'`.
- Receipt review rows: 1 approved, 5 pending.
- All 12 current payment rows have positive amounts.

This confirms that updating every membership row for a trainee during receipt approval is not a safe default: multiple active historical rows exist for some trainees, and the current data does not reveal which row a new receipt is intended to settle. The prototype therefore continues to update only the receipt and create the corresponding payment; membership activation is intentionally excluded until the UI/business model identifies a specific membership or the schema provides an unambiguous relationship. No personal identifiers or individual financial amounts were retrieved in this aggregate check.

### Prototype hardening

The receipt fixture now uses SHA-256 (via PostgreSQL `pgcrypto`) for canonical JSONB request fingerprints instead of MD5, and explicitly rejects a NULL decision so it cannot fall through to the rejection branch. The latest CI run for commit `9169aa9012938917513de50d2befdf2c57349047` completed successfully on PostgreSQL 17.12, including the SHA-256 fingerprint and NULL-decision rejection checks. The later documentation-only commit does not change the tested SQL.


## Prototype milestone: atomic membership creation and card allocation — 2026-11-14

Added a second isolated PostgreSQL 17 fixture and independent GitHub Actions workflow:

- `tests/financial-membership-card.fixture.sql`
- `tests/financial-membership-card.integration.sql`
- `.github/workflows/test-financial-membership-card.yml`

The fixture follows the production schema facts inspected read-only:
- `trainee_membership_cards` has a unique `card_number` and a unique `trainee_id`; it is the canonical one-card-per-trainee registry.
- `trainee_memberships` is a history table: it must permit multiple rows per trainee, and its copied `card_number` must not be made unique.
- `trainee_memberships.id` and `trainee_payments.id` are bigint identity-like keys in the production schema, while the registry key is UUID.
- Membership history carries `start_date`, `end_date`, `status`, `description`, `amount`, `payment_status`, `card_number`, and `card_holder`.

Prototype transaction behavior:
1. Validate authenticated coach identity and trainee assignment.
2. Claim a unique operation-ledger key and compare SHA-256 request fingerprint on retries.
3. Lock the trainee row before card lookup/allocation.
4. Reuse the canonical registry card when present; otherwise allocate a four-digit candidate protected by the registry's database UNIQUE constraints.
5. Insert the membership history row and copy the canonical card number.
6. If the membership is marked paid and amount is positive, create its payment in the same transaction.
7. Persist the operation result in the same transaction.

CI run `43568950600` completed successfully on PostgreSQL 17.12. It verifies:
- same operation retry creates only one membership and one payment;
- a different genuine membership for the same trainee reuses the canonical card while preserving multiple history rows;
- unpaid membership does not create a payment;
- changed payload under an existing operation UUID is rejected;
- invalid date range and cross-coach access are rejected;
- injected payment failure rolls back membership, card registry allocation and operation-ledger claim;
- two independent sessions concurrently create memberships for the same trainee: second waits on trainee row lock, both history rows receive the same card, and only one registry row exists;
- different trainees do not share a card number.

### Scope and safety limits

This is a synthetic test fixture, not a production migration. It is not a complete copy of production RLS, grants, table triggers, sequence ownership, and actual browser handler payloads. The RPC signature and payment condition are prototype decisions requiring parity review against the live `saveSubscription` handler before any production migration. In particular, do not infer that the live handler's exact payment status/date/description semantics have already been preserved.

No production or test Supabase project was changed. No app runtime, live membership, payment, card registry, Auth, Storage, RLS, grant, or migration was modified.
