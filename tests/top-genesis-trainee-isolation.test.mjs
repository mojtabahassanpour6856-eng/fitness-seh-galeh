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
  assert.match(publisher, /assertSameTraineeContext\(\);\s*const \{ error \} = await window\.AUTH_SUPABASE\.from\(TABLE\)\.insert/);
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
  assert.ok(publisher.includes("if (uploadedReportPath) {"), "The catch handler must guard cleanup with the uploaded path.");
  assert.ok(publisher.includes('.remove([uploadedReportPath])'), "The catch handler must remove the exact uploaded object.");
    "A failed insert or post-upload context check must attempt to remove the uploaded object.");
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
