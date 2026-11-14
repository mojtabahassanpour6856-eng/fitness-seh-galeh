import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), "utf8");

test("Top Genesis preview is recreated when the selected trainee changes", () => {
  const embed = read("top-genesis-pdf-app-embed.js");
  assert.match(embed, /boundTraineeId !== context\.traineeId/);
  assert.match(embed, /if \(activeFrame\) activeFrame\.remove\(\)/);
  assert.match(embed, /type: "top-genesis-context"/);
  assert.match(embed, /traineeId,\s*contextNonce: nonce/);
});

test("embedded report cannot be approved or sent without a bound trainee context", () => {
  const html = read("top-genesis-pdf-test.html");
  assert.match(html, /event\.data\?\.type!=="top-genesis-context"/);
  assert.match(html, /coachContextReady&&\(!embeddedMode\|\|coachContext\?\.traineeId&&coachContext\?\.contextNonce\)/);
  assert.match(html, /traineeId:coachContext\.traineeId,contextNonce:coachContext\.contextNonce/);
});

test("publisher rejects stale, mismatched, or switched trainee contexts before writing", () => {
  const publisher = read("top-genesis-publication.js");
  assert.match(publisher, /payloadTraineeId !== traineeId/);
  assert.match(publisher, /payloadTraineeId !== String\(frame\.dataset\.boundTraineeId \|\| ""\)/);
  assert.match(publisher, /payloadContextNonce !== String\(frame\.dataset\.contextNonce \|\| ""\)/);
  assert.match(publisher, /assertSameTraineeContext\(\);[\s\S]{0,220}const \{ error \} = await window\.AUTH_SUPABASE\.from\(TABLE\)\.insert/);
});


test("publisher removes an uploaded report when trainee context changes or publication fails", () => {
  const publisher = read("top-genesis-publication.js");
  const uploadAt = publisher.indexOf(".upload(reportPath");
  const postUploadGuardAt = publisher.indexOf("assertSameTraineeContext();", uploadAt);
  const insertAt = publisher.indexOf(".from(TABLE).insert", postUploadGuardAt);
  const cleanupAt = publisher.indexOf(".remove([uploadedReportPath])");
  assert.ok(uploadAt >= 0, "The private report must be uploaded before its publication row is inserted.");
  assert.ok(postUploadGuardAt > uploadAt && postUploadGuardAt < insertAt,
    "The trainee context must be revalidated after upload and immediately before database insertion.");
  assert.ok(cleanupAt > insertAt,
    "A failed insert or post-upload context check must attempt to remove the uploaded object.");
  assert.ok(publisher.includes("if (uploadedReportPath) {"), "The catch handler must guard cleanup with the uploaded path.");
  assert.ok(publisher.includes('.remove([uploadedReportPath])'), "The catch handler must remove the exact uploaded object.");
});

test("iframe handshake is retryable and every context request receives the currently bound identity", () => {
  const embed = read("top-genesis-pdf-app-embed.js");
  const html = read("top-genesis-pdf-test.html");
  assert.match(html, /top-genesis-context-request/,
    "The child analyzer must request context after its message listener is ready.");
  assert.match(embed, /event\.data\?\.type === "top-genesis-context-request"/,
    "The parent must respond to a late or retried context request.");
  assert.match(embed, /type: "top-genesis-context"[\s\S]*?traineeId: boundTraineeId[\s\S]*?contextNonce/,
    "The retry response must carry the same bound trainee ID and nonce as the active iframe.");
});


test("published report viewer is cleared when account or trainee context changes", () => {
  const publication = read("top-genesis-publication.js");
  assert.match(publication, /function closeFullReportViewer\(\)/,
    "The full report modal must have a single cleanup path.");
  assert.match(publication, /URL\.revokeObjectURL\(frame\.dataset\.objectUrl\)/,
    "Switching context must revoke the previous report Blob URL.");
  assert.match(publication, /const contextKey = role \+ ":" \+ traineeId/);
  assert.match(publication, /if \(contextKey !== lastContextKey\)[\s\S]*?closeFullReportViewer\(\)/,
    "Role or selected trainee changes must immediately clear the previous report viewer.");
  assert.match(publication, /requestedEpoch !== contextEpoch \|\| requestedTraineeId !== currentTraineeId\(\)/,
    "A report download completing after a context switch must not be displayed.");
  assert.match(publication, /requestEpoch !== contextEpoch \|\| currentTraineeId\(\) !== traineeId/,
    "A stale history query must not render data into a newly selected trainee's panel.");
});


test("full report download requires exact trainee and assigned-coach storage path", () => {
  const publication = read("top-genesis-publication.js");
  assert.match(publication, /trainee_id,coach_user_id,analysis_date/,
    "The publication query must retain the owner identities needed to validate the report path.");
  assert.match(publication, /const expectedPrefix = String\(row\.coach_user_id \|\| ""\) \+ "\/" \+ requestedTraineeId \+ "\/published\//);
  assert.match(publication, /String\(row\.trainee_id \|\| ""\) !== String\(requestedTraineeId\)/,
    "A report row for another trainee must never be opened.");
  assert.match(publication, /report_storage_path\)\.startsWith\(expectedPrefix\)/,
    "A report must live under its assigned coach and exact trainee folder.");
  assert.match(publication, /0-9a-f-\]\{36\}\\\\\.html/,
    "Only generated UUID HTML report objects should be opened.");
});


test("stale report downloads cannot restore controls after a trainee or account switch", () => {
  const publication = read("top-genesis-publication.js");
  assert.ok(publication.includes("button.isConnected"));
  assert.ok(publication.includes("requestedEpoch === contextEpoch"));
  assert.ok(publication.includes("if (requestEpoch === contextEpoch && body && currentTraineeId() === traineeId)"),
    "A stale query error must not overwrite the current account's history panel.");
});

test("legacy publication rows without a storage path never expose a full-report action", () => {
  const publication = read("top-genesis-publication.js");
  assert.ok(publication.includes("const action = row.report_storage_path"));
  assert.match(publication, /data-history-details/);
  assert.ok(publication.includes("if (!modal || !frame || !row?.report_storage_path) return"),
    "The report viewer must reject legacy rows that have no storage object.");
});


test("health report storage reads are scoped to the exact assigned trainee folders", () => {
  const migration = read("supabase/migrations/202611140001_tighten_trainee_health_report_storage_reads.sql");
  assert.match(migration, /drop policy if exists trainee_health_reports_read_own_or_assigned_coach/);
  assert.match(migration, /t\.id::text = \(storage\.foldername\(name\)\)\[2\]/);
  assert.match(migration, /t\.coach_user_id = auth\.uid\(\)/);
  assert.match(migration, /storage\.foldername\(name\)\)\[1\] in/);
  assert.match(migration, /t\.auth_user_id = auth\.uid\(\)/);
});


test("publication failures report the exact stage and browser network diagnostics", () => {
  const publisher = read("top-genesis-publication.js");
  assert.match(publisher, /publicationStage = "بارگذاری فایل گزارش در فضای ذخیره‌سازی"/);
  assert.match(publisher, /publicationStage = "ثبت اطلاعات گزارش در پایگاه داده"/);
  assert.match(publisher, /errorName = String\(error\?\.name \|\| "Error"\)/);
  assert.match(publisher, /browserOnline: navigator\.onLine/);
  assert.match(publisher, /Top Genesis publication failed:/);
});
