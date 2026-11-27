"use strict";
const fs = require("node:fs");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const gallery = fs.readFileSync("experiments/anatomy-preview-gallery.html", "utf8");
const capture = fs.readFileSync("experiments/anatomy-preview-capture.html", "utf8");
const workflow = fs.readFileSync(".github/workflows/anatomy-experiment-checks.yml", "utf8");

const views = ["male-front", "male-back", "female-front", "female-back"];
for (const view of views) {
  assert.ok(gallery.includes("view=" + view), "gallery must include " + view);
  assert.ok(workflow.includes("/tmp/anatomy-" + view + ".png"), "workflow must capture " + view);
}
assert.equal((gallery.match(/<iframe\b/g) || []).length, 4, "gallery must contain exactly four view frames");
assert.match(gallery, /@media\(max-width:850px\)/, "gallery must be responsive");
assert.match(gallery, /مرزبندی یا صحت آناتومیک عضلات نیست/, "gallery must state anatomical limitation");
assert.match(capture, /getElementById\("sex"\)/, "capture page must set body model");
assert.match(capture, /getElementById\("view"\)/, "capture page must set view");
assert.match(capture, /dataset\.pathCount/, "capture page must report rendered muscle path count");
assert.match(capture, /"male-front":28,"male-back":30,"female-front":28,"female-back":30/, "capture page must enforce the audited path count for every view");
assert.match(capture, /dataset\.expectedPathCount/, "capture page must expose the expected path count");
assert.match(capture, /dataset\.captureReady=String\(paths===expectedPaths\)/, "capture page must be ready only when the exact audited path count renders");
assert.match(capture, /dispatchEvent\(new Event\("change"/, "capture page must trigger prototype redraw");
assert.match(workflow, /Capture real anatomy preview/, "workflow must run browser capture");
assert.match(workflow, /data-capture-ready="true"/, "workflow must wait for rendered paths before each view screenshot");
assert.match(workflow, /data-gallery-ready="true"/, "workflow must wait for all four views before gallery screenshot");
assert.match(workflow, /data-loaded-views="male-front,male-back,female-front,female-back"/, "workflow must verify the exact four gallery views");
assert.match(workflow, /anatomy-preview-gallery\.png/, "workflow must capture and upload gallery");
assert.match(workflow, /name: anatomy-preview/, "workflow must upload preview artifact");

for (const html of [gallery, capture]) {
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    new vm.Script(match[1]);
  }
}
console.log("PASS: four-view anatomy gallery, capture wiring, limitations, and browser artifact workflow.");
