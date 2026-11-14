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
