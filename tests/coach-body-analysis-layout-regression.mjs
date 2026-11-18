import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const html = read("index.html");
const embed = read("top-genesis-pdf-app-embed.js");
const publication = read("top-genesis-publication.js");

assert.match(html, /id="navBodyAnalysis"[^>]*window\.openCoachBodyAnalysis\(\)/,
  "The coach navigation must open the unified Body Analysis section directly.");
assert.doesNotMatch(html, /navAnalysisImport|analysisImport/,
  "The standalone Import Analysis navigation/card must be removed.");
const section = html.match(/<section id="bodyAnalysis" class="section">([\s\S]*?)<\/section>/);
assert.ok(section, "A dedicated Body Analysis section must exist.");
assert.match(section[1], /id="bodyAnalysisEntryPanel"/,
  "The analysis entry host must live inside the Body Analysis section.");
assert.match(section[1], /آنالیز بدن شاگرد/,
  "The unified card must have the Body Analysis heading.");
assert.match(html, /window\.openCoachBodyAnalysis=function\(\)[\s\S]*?profile\.role!=="coach"[\s\S]*?window\.showSection\("bodyAnalysis"/,
  "The coach route must use the shared section navigation and be role-guarded.");
assert.match(html, /window\.loadTopGenesisPublishedHistory\(\)/,
  "Opening Body Analysis must explicitly refresh the approved Top Genesis publication history.");
assert.match(html, /function ensureProgressCards\(\)[\s\S]*?analysisSec\.appendChild\(viewer\)[\s\S]*?progressSec\.appendChild\(chart\)[\s\S]*?progressSec\.appendChild\(history\)/,
  "Coach analysis receipt stays in Body Analysis while trend and history are placed in Progress.");
assert.match(html, /function isProgressManualRecord\\(row\\)/,
  "Manual and legacy progress records must be classified by their source markers.");
assert.match(html, /function progressSourceLabel\\(row\\)/,
  "Every progress row must expose a truthful source label.");
assert.match(html, /function buildProgressHistoryRows\\(analysisRows,weightRows\\)/,
  "Manual progress and independent weight logs must be combined without inventing measurements.");
assert.match(html, /const manualRows=list\\.filter\\(isProgressManualRecord\\)/,
  "Explicit student markers and legacy manual rows must be separated from coach analyses.");
assert.match(html, /const coachRows=list\\.filter\\(x=>!isProgressManualRecord\\(x\\)&&x\\._weightOnly!==true\\)/,
  "Coach analyses must stay separate from manual and independent weight records.");
assert.match(html, /const weighted=progressRows\\.filter/,
  "The weight trend must include manual progress and independent weight logs.");
assert.match(html, /const historyRows=progressRows\\.slice\\(\\)/,
  "The history table must display the combined manual and weight-only timeline.");
assert.match(html, /getTraineeProgressHistoryData\\(traineeId,force\\)/,
  "The chart must load all progress sources through the shared paginated reader.");
assert.match(html, /sbGetAllPages\\(\\"\\/body_analyses/,
  "Body analysis history must be retrieved through pagination.");
assert.match(html, /sbGetAllPages\\(\\"\\/weight_logs/,
  "Independent weight history must be retrieved through pagination.");
assert.match(html, /let progressHistoryRequestSeq=0;[\s\S]*?const requestId=\+\+progressHistoryRequestSeq/,
  "Manual body-analysis history requests must be sequenced to prevent stale responses from overwriting a newly selected trainee.");
assert.match(html, /el\.dataset\.boundTraineeId!==selectedId[\s\S]*?در حال دریافت تاریخچه شاگرد انتخاب‌شده/,
  "The history panel must clear the previous trainee's rows as soon as the selected trainee changes.");
assert.match(html, /requestId!==progressHistoryRequestSeq\|\|!currentClient\|\|String\(currentClient\.id\)!==String\(traineeId\)/,
  "A history response must be discarded unless it still belongs to the currently selected trainee.");

assert.match(embed, /const anchor = document\.getElementById\("bodyAnalysisEntryPanel"\)/);
assert.match(embed, /anchor\.appendChild\(host\)/,
  "The PDF/ZIP analyzer must be nested inside the unified Body Analysis card.");
assert.doesNotMatch(embed, /insertAdjacentElement\("afterend", host\)/,
  "The PDF/ZIP analyzer must not render as a separate adjacent card.");
assert.match(publication, /const target = \$\("bodyAnalysisEntryPanel"\)/,
  "Published analysis reports must be placed inside the unified Body Analysis card.");
assert.match(publication, /window\.loadTopGenesisPublishedHistory = function \(\)[\s\S]*?mountProgressCard\(\)[\s\S]*?return loadPublished\(false\)/,
  "The direct coach route must have an explicit public loader for approved Top Genesis history.");
assert.match(html, /analysisSec=\$\('bodyAnalysisEntryPanel'\)/,
  "The coach analysis receipt must be anchored to the Body Analysis card.");
assert.match(html, /progressSec=\$\('progress'\)/,
  "Trend and history cards must be anchored to the Progress section.");
assert.match(html, /id="progressEntryPanel"/,
  "The manual Progress entry card must remain intact.");
assert.match(html, /id="progress" class="section"/,
  "The manual Progress section must remain intact.");


const routeOpen = '<script id="COACH_BODY_ANALYSIS_DIRECT_ROUTE_V1">';
const routeStart = html.indexOf(routeOpen);
const routeEnd = html.indexOf("</script>", routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart, "The direct coach route script must be present at the end of the document.");
const routeSource = html.slice(routeStart + routeOpen.length, routeEnd);
function makeNode() {
  const classes = new Set();
  const attributes = {};
  return {
    hidden: false,
    style: { setProperty() {} },
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name),
      toggle: (name, force) => {
        const enabled = force === undefined ? !classes.has(name) : !!force;
        if (enabled) classes.add(name); else classes.delete(name);
        return enabled;
      }
    },
    setAttribute: (name, value) => { attributes[name] = value; },
    getAttribute: name => attributes[name],
    scrollIntoView() {},
    _classes: classes
  };
}
function runRouteForRole(role) {
  const bodyAnalysis = makeNode(), progress = makeNode(), dashboard = makeNode();
  const navAnalysis = makeNode(), navOther = makeNode();
  const panel = makeNode();
  const nodes = {
    bodyAnalysis, progress, dashboard, bodyAnalysisEntryPanel: panel,
    navBodyAnalysis: navAnalysis
  };
  const document = {
    getElementById: id => nodes[id] || null,
    querySelectorAll: selector => selector === ".section"
      ? [bodyAnalysis, progress, dashboard]
      : selector === ".nav button" ? [navAnalysis, navOther] : []
  };
  const window = {
    authProfile: { role },
    loadProgressHistoryCalls: 0,
    loadProgressHistory() { this.loadProgressHistoryCalls += 1; },
    loadTopGenesisPublishedHistoryCalls: 0,
    loadTopGenesisPublishedHistory() { this.loadTopGenesisPublishedHistoryCalls += 1; },
    showSection(id, btn) {
      const activeSection = nodes[id];
      document.querySelectorAll(".section").forEach(item => {
        const active = item === activeSection;
        item.classList.toggle("active", active);
        item.hidden = !active;
        item.setAttribute("aria-hidden", active ? "false" : "true");
      });
      document.querySelectorAll(".nav button").forEach(button => button.classList.remove("active"));
      if (btn) btn.classList.add("active");
    }
  };
  vm.runInNewContext(routeSource, { window, document });
  window.openCoachBodyAnalysis();
  return { bodyAnalysis, progress, dashboard, navAnalysis, navOther, panel, loadProgressHistoryCalls: window.loadProgressHistoryCalls, loadTopGenesisPublishedHistoryCalls: window.loadTopGenesisPublishedHistoryCalls };
}
const coachRoute = runRouteForRole("coach");
assert.equal(coachRoute.bodyAnalysis._classes.has("active"), true,
  "Coach click must activate the Body Analysis section.");
assert.equal(coachRoute.bodyAnalysis.hidden, false);
assert.equal(coachRoute.bodyAnalysis.getAttribute("aria-hidden"), "false");
assert.equal(coachRoute.progress.hidden, true,
  "Opening Body Analysis must hide the previous Progress section.");
assert.equal(coachRoute.navAnalysis._classes.has("active"), true,
  "The Body Analysis navigation button must be marked active.");
assert.equal(coachRoute.panel.hidden, false);
assert.equal(coachRoute.loadProgressHistoryCalls, 1,
  "Opening Body Analysis must load the coach analysis receipt without navigating to Progress.");
assert.equal(coachRoute.loadTopGenesisPublishedHistoryCalls, 1,
  "Opening Body Analysis must load approved Top Genesis publications without navigating to Progress.");
const traineeRoute = runRouteForRole("trainee");
assert.equal(traineeRoute.bodyAnalysis._classes.has("active"), false,
  "The coach-only direct route must not activate for trainee accounts.");

console.log("[coach-body-analysis] unified card, coach route, PDF/ZIP mount, published reports, and manual Progress isolation passed.");
