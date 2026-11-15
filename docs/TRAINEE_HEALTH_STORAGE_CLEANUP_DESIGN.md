# Trainee health-file lifecycle and safe Storage cleanup

Status: design-only experiment. This document does not change the live database, Storage bucket, policies, or application runtime.

## Findings that constrain the design

- Legacy health-file uploads used a two-folder object path: `auth user UUID / trainee UUID / filename`.
- The historical client flow uploaded the object first and inserted the `trainee_injuries` row second. Its cleanup path did not inspect the Storage `remove()` result's returned `error`, so a failed delete could go unnoticed.
- `trainee_injuries.trainee_id` references `trainees.id` with `ON DELETE CASCADE`. Deleting a trainee can remove database rows without deleting the corresponding Storage object.
- The live schema currently has multiple other trainee-owned tables with cascading foreign keys. A hard delete is therefore a broad data-erasure operation.
- The four legacy image objects have not been mapped to a surviving trainee or a reliable row reference. They are explicitly out of scope for automatic cleanup.

## Non-negotiable safety rules

1. Never delete an object based only on a folder scan, filename, age, or lack of a currently visible trainee.
2. Never use a foreign key from a cleanup job to `trainees`; a trainee deletion must not cascade-delete the cleanup intent.
3. The browser must never receive a service-role credential.
4. A cleanup worker may act only on an exact object path recorded in a trusted job row, in an allowlisted private bucket.
5. Before deletion, the worker must check every supported database reference for that bucket/path. If the reference inventory is incomplete or a query fails, move the job to manual review; do not delete.
6. Storage removal is idempotent. A missing object is a successful cleanup outcome only after the reference check passes.
7. Retained files and cleanup jobs must be auditable. Never silently swallow Storage API errors.
8. No retroactive deletion or automatic enqueueing of the four legacy objects.

## Proposed lifecycle

### A. Create cleanup intent before upload

An authenticated server endpoint/RPC validates the current user, coach/trainee relationship, and allowed upload purpose. It creates a job containing:

- UUID primary key
- fixed bucket identifier (not arbitrary client input)
- exact object path generated or strictly validated server-side
- uploader user UUID and trainee UUID as plain UUID values (no FK to trainees)
- state = `pending`
- `eligible_after` grace timestamp
- attempt count, lease fields, last error, created/updated timestamps

If the intent cannot be persisted, abort before uploading.

### B. Upload and persist the business row

1. Upload to the exact path in the intent with `upsert: false`.
2. Validate the upload response, including its returned error field.
3. Persist the injury/health row and transition the cleanup job to `retained` in one database transaction, preferably through a narrow authenticated RPC.
4. If the row insert or transaction fails, leave the job pending. Do not try to hide cleanup failures in the browser.

The atomic transaction is important: it prevents a worker from observing a successful business-row insert while the job still appears deletable, or vice versa.

### C. Worker cleanup

A server-side scheduled worker uses service role only on the server. It:

- claims eligible pending jobs with a lease / row lock;
- refuses jobs outside the allowlisted bucket and exact path grammar;
- checks references across all known tables and legacy pointer formats;
- changes the job to `manual_review` if the reference inventory is incomplete, any query fails, or a reference exists unexpectedly;
- deletes only the exact object path when the complete reference check proves it is unreferenced;
- checks both the Storage response's `error` and thrown exceptions;
- retries transient failures with bounded exponential backoff;
- records completion, attempts, timestamps, and sanitized error details.

A job that reaches its retry limit becomes `manual_review`, never silently discarded.

### D. Trainee deletion / archival

Preferred product behavior is archive/deactivate first, preserving all dependent history. A future hard-delete flow must:

1. enumerate and classify owned Storage objects using explicit database references, not folder scans alone;
2. create durable cleanup intents for exact paths;
3. preserve those intents independently of the trainee row;
4. delete or anonymize database records only after the user-facing confirmation and retention rules are satisfied;
5. let the worker perform Storage deletion after a second reference check.

The existing registration-rejection routine that hard-deletes an unapproved trainee must also be reviewed. Its use of `ON DELETE CASCADE` makes it a possible orphan-object path if a file was uploaded before rejection.

## Proposed state machine

- `pending`: intent persisted; object may or may not exist; not eligible until grace period expires.
- `processing`: leased by one worker; lease expires if worker crashes.
- `retained`: business row committed; never eligible for cleanup.
- `completed`: exact unreferenced object removed or confirmed absent.
- `manual_review`: ambiguous reference, incomplete inventory, invalid path, or exhausted retries.

No state transition may move `retained` back to `pending` automatically.

## Required tests before implementation can be enabled

### Upload / transaction tests
- intent insert denied -> no Storage upload;
- Storage upload denied -> no business row; pending intent safely resolves as no-object;
- Storage succeeds + business-row transaction fails -> exact object removed by worker;
- business row + retained-state update commit atomically;
- duplicate client retry reuses the same idempotency key and cannot create a second object or row;
- upload returns `{ error }` without throwing -> failure is detected.

### Worker tests
- two workers race -> only one lease owner removes;
- worker crashes while processing -> lease expires and retry is safe;
- object already absent -> idempotent completion after reference check;
- Storage returns error or throws -> bounded retry and visible audit state;
- reference query errors or is unavailable -> manual review, no deletion;
- an existing row references the path -> no deletion;
- path traversal, unexpected bucket, malformed UUIDs, and unapproved filename grammar -> reject;
- job survives deletion of the trainee row;
- a path belonging to another trainee/coach -> reject.

### Trainee lifecycle tests
- archive trainee -> all history and files remain readable under intended policy;
- hard delete -> cleanup intent survives all FK cascades;
- rejected registration with an uploaded file -> object is accounted for before cascade;
- cross-coach isolation -> one coach cannot enqueue, inspect, or delete another coach's object.

## Blocking questions to resolve before writing a migration

1. Inventory every current and historical health-file reference format. The current database inspection found no `HEALTH_REPORT_FILE::` marker among the 10 injury rows, so that marker must not be assumed to be the only format.
2. Confirm the exact current production UI entry point for health-file uploads. The historical implementation is present in Git history, while the current main `index.html` does not provide a usable source file through the repository connector.
3. Decide retention periods and whether hard deletion is legally/operationally required, or archive is sufficient.
4. Choose a server-side worker deployment mechanism and schedule only after verifying current Supabase documentation and project capabilities.

## Scope boundary

This branch is deliberately design-only. Do not merge it, deploy it, apply SQL, change RLS, or touch live Storage objects as part of this experiment. The four unidentified legacy files remain untouched pending a separately approved manual investigation.
