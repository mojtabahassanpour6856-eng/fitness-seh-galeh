"use strict";
const fs = require("node:fs");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const gallery = fs.readFileSync("experiments/anatomy-preview-gallery.html", "utf8");
const capture = fs.readFileSync("experiments/anatomy-preview-capture.html", "utf8");
const workflow = fs.readFileSync(".github/workflows/anatomy-experiment-checks.yml", "utf8");
const inspector = fs.readFileSync("experiments/anatomy-geometry-inspector.html", "utf8");

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
assert.match(inspector, /dataset\.inspectorReady=\x27true\x27/, "inspector must expose successful iframe readiness");
assert.match(inspector, /height:min\(90vh,1250px\)/, "desktop inspector preview must be tall enough to show the full body");
assert.match(inspector, /list\.dataset\.pathCount=String\(paths\(\)\.length\)/, "inspector must expose the loaded path count");
assert.match(inspector, /dataset\.inspectorError=\x27true\x27/, "inspector must expose terminal iframe initialization failure");
assert.match(inspector, /function refresh\(\)\{if\(!controls\(\)\)return;[\s\S]*?return true;\}/, "inspector refresh must signal successful iframe initialization to the retry loop");
assert.match(capture, /dataset\.pathCount/, "capture page must report rendered muscle path count");
assert.match(capture, /"male-front":28,"male-back":30,"female-front":28,"female-back":30/, "capture page must enforce the audited path count for every view");
assert.match(capture, /dataset\.expectedPathCount/, "capture page must expose the expected path count");
assert.match(capture, /dataset\.captureReady=String\(paths===expectedPaths&&controlsMatch&&titleMatch\)/, "capture page must validate path count, selected model/view, and displayed title");
assert.match(capture, /dataset\.controlsMatch/, "capture page must expose selected control validation");
assert.match(capture, /dataset\.titleMatch/, "capture page must expose displayed title validation");
assert.match(capture, /catch\(error\)\{fail\(/, "capture page must report runtime capture failures");
assert.match(capture, /dispatchEvent\(new Event\("change"/, "capture page must trigger prototype redraw");
assert.match(workflow, /Capture real anatomy preview/, "workflow must run browser capture");
assert.match(workflow, /grep -o 'class="muscle ' \/tmp\/anatomy-dom\.html/, "workflow must count actual rendered SVG muscle paths");
assert.doesNotMatch(workflow, /anatomySmoke|anatomyInteractionSmoke|anatomyMuscleBrowserSmoke/, "workflow must not depend on removed legacy smoke markers");
assert.match(workflow, /data-inspector-ready="true"/, "workflow must require geometry inspector readiness");
assert.match(workflow, /inspector_expected=28[\s\S]*inspector_expected=30/, "workflow must check expected inspector path counts for front and back views");
assert.match(workflow, /data-path-count=/, "workflow must verify the inspector loaded its expected path list");
assert.match(workflow, /for model in male female[\s\S]*for direction in front back/, "workflow must inspect all four model and view combinations");
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
