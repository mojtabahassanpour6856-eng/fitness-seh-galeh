"use strict";
const fs = require("node:fs");
const assert = require("node:assert/strict");

const review = fs.readFileSync("experiments/anatomy-deltoid-path-review.html", "utf8");
const capture = fs.readFileSync("experiments/anatomy-preview-capture.html", "utf8");
const catalog = JSON.parse(fs.readFileSync("experiments/ANATOMY-MUSCLE-CATALOG.json", "utf8"));
const workflow = fs.readFileSync(".github/workflows/anatomy-experiment-checks.yml", "utf8");

const expectedViews = ["male-front", "male-back", "female-front", "female-back"];
const buttons = [...review.matchAll(/<button\b[^>]*data-key="([^"]+)"[^>]*data-view="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)]
  .map(([, key, view, label]) => ({ key, view, label: label.replace(/<[^>]+>/g, "").trim() }));

assert.equal((review.match(/<section class="panel">/g) || []).length, 4,
  "deltoid review must have exactly four body-view panels");
assert.equal((review.match(/<iframe\b/g) || []).length, 4,
  "deltoid review must embed exactly the four canonical views");
assert.equal(buttons.length, 16, "all 16 deltoid paths must have a dedicated selector");
assert.equal(new Set(buttons.map(b => b.key)).size, 16,
  "every deltoid selector must use a unique stable selection_key");
assert.deepEqual([...new Set(buttons.map(b => b.view))].sort(), [...expectedViews].sort(),
  "selectors must cover exactly the four canonical views");

const catalogKeys = new Set();
for (const muscle of catalog.muscles) {
  for (const [view, paths] of Object.entries(muscle.geometry_by_view || {})) {
    for (const path of paths) catalogKeys.add(view + "|" + path.selection_key);
  }
}
for (const button of buttons) {
  assert.ok(catalogKeys.has(button.view + "|" + button.key),
    "selector key must exist in the catalog for " + button.view + ": " + button.key);
}
assert.match(review, /root\.dataset\.captureReady!=="true"/,
  "review page must require validated capture frames");
assert.match(review, /paths\.find\(p=>p\.dataset\.key===activeKey\)/,
  "review page must resolve the selected stable key to exactly one rendered path");
assert.match(review, /missing=buttons\.filter\(b=>!paths\.some\(p=>p\.dataset\.key===b\.dataset\.key\)\)/,
  "review page must reject missing path keys before declaring a panel ready");
assert.match(review, /dataset\.reviewReady=String\(loaded\.length===4&&reviewPanels\.every\(p=>p\.dataset\.panelReady==="true"\)\)/,
  "review readiness must require all four successfully loaded panels");
assert.match(review, /p\.style\.opacity=chosen\?"1":"\.13"/,
  "selected path must be highlighted while non-selected paths are dimmed");
assert.match(capture, /dataset\.captureReady=String\(paths===expectedPaths&&controlsMatch&&titleMatch\)/,
  "the four-view capture page must validate the rendered view");
assert.match(workflow, /data-review-ready="true"/,
  "browser workflow must assert deltoid review readiness");
assert.match(workflow, /anatomy-deltoid-review\.png/,
  "browser workflow must capture the deltoid review sheet");
console.log("PASS: 16 unique deltoid selectors map to the catalog across all four canonical views.");
