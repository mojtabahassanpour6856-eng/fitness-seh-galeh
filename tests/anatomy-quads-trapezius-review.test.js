"use strict";
const fs = require("node:fs");
const assert = require("node:assert/strict");

const catalog = JSON.parse(fs.readFileSync("experiments/ANATOMY-MUSCLE-CATALOG.json", "utf8"));
const inspector = fs.readFileSync("experiments/anatomy-geometry-inspector.html", "utf8");
const workflow = fs.readFileSync(".github/workflows/anatomy-experiment-checks.yml", "utf8");

const requiredSheets = [
  { model: "male", view: "front", sourceGroup: "QUADS", expected: 4 },
  { model: "female", view: "front", sourceGroup: "QUADS", expected: 4 },
  { model: "male", view: "back", sourceGroup: "TRAPEZIUS", expected: 4 },
  { model: "female", view: "back", sourceGroup: "TRAPEZIUS", expected: 4 }
];

function entriesFor(model, view, sourceGroup) {
  const viewKey = model + "-" + view;
  const group = catalog.groups.find(item => item.source_group_key === sourceGroup);
  assert.ok(group, "source group must exist in the catalog: " + sourceGroup);
  return group.geometry_by_view?.[viewKey] || [];
}

for (const sheet of requiredSheets) {
  const entries = entriesFor(sheet.model, sheet.view, sheet.sourceGroup);
  assert.equal(entries.length, sheet.expected,
    sheet.model + "/" + sheet.view + "/" + sheet.sourceGroup + " must contain the audited source paths");
  assert.equal(new Set(entries.map(entry => entry.selection_key)).size, entries.length,
    "every path on a review sheet must have a unique stable key");
  assert.ok(entries.every(entry => Number.isInteger(entry.index) && entry.index >= 0),
    "every review entry must point to a real non-negative source index");
  assert.ok(entries.every(entry => typeof entry.selection_key === "string" && entry.selection_key.length > 0),
    "every review entry must use a stable source-derived key");
  assert.ok(workflow.includes(sheet.model + " " + sheet.view + " " + sheet.sourceGroup + " " + sheet.expected),
    "browser workflow must capture this exact review sheet");
}

for (const groupId of ["quads", "trapezius"]) {
  const group = catalog.groups.find(item => item.group_id === groupId);
  assert.ok(group, "ambiguous group must remain present: " + groupId);
  assert.equal(group.anatomical_validation_status, "unreviewed",
    "structural diagnostics must never silently validate anatomy");
  assert.equal(group.paired_selection_enabled, false,
    "bilateral selection must remain locked until anatomical review");
  assert.equal(group.pairing_status, "blocked_pending_geometry_audit",
    "ambiguous geometry must remain explicitly blocked");
}

assert.match(inspector, /function applyRequestedGroupReview\(\)/,
  "the geometry inspector must expose focused group review");
assert.match(inspector, /targets=paths\(\)\.filter\(path=>path\.dataset\.group===requested\)/,
  "focused review must select only paths from the requested SVG source group");
assert.match(inspector, /targets\.length>6/,
  "focused review must fail closed above the six-path comparison cap");
assert.match(inspector, /reviewKeys=targets\.map\(path=>path\.dataset\.key\)/,
  "focused review must include every matching source path, not a manually curated subset");
assert.match(inspector, /dataset\.groupReviewReady='true'/,
  "focused review must expose a browser-verifiable readiness marker");
assert.match(inspector, /dataset\.groupReviewCount=String\(reviewKeys\.length\)/,
  "focused review must expose its exact path count");
assert.match(workflow, /data-group-review-ready="true"/,
  "Chromium workflow must assert focused review readiness");
assert.match(workflow, /data-group-review-count=/,
  "Chromium workflow must assert the exact focused review path count");

console.log("PASS: four focused QUADS/TRAPEZIUS sheets map to exact catalog paths; no ambiguous group is promoted to anatomical validation.");
