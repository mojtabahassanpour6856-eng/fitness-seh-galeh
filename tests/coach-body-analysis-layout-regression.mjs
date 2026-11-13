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
assert.doesNotMatch(html, /dashOpen\(['"]analysis['"]\)[\s\S]{0,120}آنالیز بدن|<span id="dashAnalysis"/,
  "The obsolete dashboard Body Analysis shortcut must be removed.");
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
assert.match(html, /function ensureProgressCards\(\)[\s\S]*?if\(analysisSec\)analysisSec\.appendChild\(viewer\)[\s\S]*?progressSec\.appendChild\(chart\)[\s\S]*?progressSec\.appendChild\(history\)/,
  "Coach analysis receipt stays in Body Analysis while trend and history are placed in Progress.");
assert.match(html, /id="progressTrend"[^>]*>[\s\S]*?id="progressTrendBody"/,
  "The progress trend card must exist in the initial HTML.");
assert.match(html, /id="progressHistory"[^>]*>[\s\S]*?id="progressHistoryBody"/,
  "The progress history card must exist in the initial HTML.");
assert.match(html, /const isProgressEntry=x=>[\s\S]*?note==='ثبت پیشرفت دوره‌ای'/,
  "Both trainee and legacy coach manual progress records must be classified as progress.");
assert.match(html, /notes:"MANUAL_PROGRESS_ENTRY: ثبت دستی و تأییدشده توسط شاگرد"/,
  "New manual progress records must be marked as trainee-confirmed, never coach-entered.");
assert.match(html, /window\.saveProgress=async function\(\)[\s\S]*?authProfile\?\.role!=='trainee'[\s\S]*?ثبت دستی پیشرفت فقط از حساب خود شاگرد/,
  "The progress save action must reject every role except the trainee.");
const progressMigration = read("supabase/migrations/202611130001_atomic_trainee_progress_rpc.sql");
assert.match(html, /window\\.saveProgress=async function\\([\\s\\S]*?sbWrite\\('\\/rpc\\/record_trainee_progress','POST'/,
  "The trainee progress UI must use one atomic server-side RPC, not two independent REST inserts.");
assert.match(html, /async function saveProgress\\(\\)\\{\\s*return window\\.saveProgress\\(\\);\\s*\\}/,
  "The legacy global saveProgress entry point must delegate to the single guarded implementation.");
assert.doesNotMatch(html, /existingWeights|existingManual/,
  "The browser must not use a racy check-then-insert sequence for progress.");
assert.match(progressMigration, /security invoker/i,
  "The atomic progress RPC must preserve caller privileges and RLS.");
assert.match(progressMigration, /private\\.is_coach\\(\\)/,
  "The database RPC must reject coach accounts.");
assert.match(progressMigration, /auth_user_id = auth\\.uid\\(\\)[\\s\\S]*?approval_status = 'active'/,
  "The database RPC must enforce exact ownership by the active trainee account.");
assert.match(progressMigration, /pg_advisory_xact_lock/,
  "Concurrent duplicate submissions must be serialized within the transaction.");
assert.match(progressMigration, /insert into public\\.weight_logs[\\s\\S]*?insert into public\\.body_analyses/,
  "Both progress tables must be written in the same database transaction.");
assert.match(html, /id="progressEntryPanel" style="display:none"/,
  "The progress entry form must be hidden by default for the coach view.");
assert.match(html, /const entryPanel=[$][(]'progressEntryPanel'[)][\s\S]*?const traineeCanEnter=activeProfile[?]\.role==='trainee'[\s\S]*?entryPanel\.style\.display=traineeCanEnter\?'block':'none'[\s\S]*?entryPanel\.setAttribute\('aria-hidden',String\(!traineeCanEnter\)\)/,
  "Only the trainee role may reveal the progress entry form; the coach view remains hidden.");
assert.match(html, /const manualRows=list\.filter\(isProgressEntry\)/,
  "Progress trend and history must include all explicitly classified manual progress records.");
assert.match(html, /note\.startsWith\('ثبت پیشرفت دوره‌ای:'\)/,
  "Legacy coach progress notes with a suffix must still be classified as manual progress.");
assert.match(html, /sbGet\('\/weight_logs\?trainee_id=eq\./,
  "The progress trend must also load manual weigh-ins from weight_logs.");
assert.match(html, /seenProgress\.has\(key\)/,
  "Merging weight_logs with body_analyses must deduplicate matching date/weight records.");
assert.match(html, /const uniqueProgress=new Map\(\);/,
  "Duplicate manual rows already present in body_analyses must also be collapsed.");
assert.match(html, /numericWeight\.toFixed\(2\)/,
  "Deduplication must normalize numerically equivalent weight values.");
assert.match(html, /render\(rows,traineeId,seq,weightLogs\)/,
  "Both manual progress sources must be passed into the progress renderer.");

assert.match(html, /const coachRows=list\.filter\(x=>!isProgressEntry\(x\)\)/,
  "All manual progress records, including legacy coach entries, must be excluded from the coach analysis receipt.");
assert.match(html, /const weighted=manualRows\.filter/,
  "Progress trend must use progress records only.");
assert.match(html, /const historyRows=manualRows\.slice\(\)/,
  "Progress history must use progress records only.");
assert.match(embed, /const anchor = document\.getElementById\("bodyAnalysisEntryPanel"\)/);
assert.match(embed, /anchor\.appendChild\(host\)/,
  "The PDF/ZIP analyzer must be nested inside the unified Body Analysis card.");
assert.doesNotMatch(embed, /insertAdjacentElement\("afterend", host\)/,
  "The PDF/ZIP analyzer must not render as a separate adjacent card.");
assert.match(publication, /const target = \$\("bodyAnalysisEntryPanel"\)/,
  "Published analysis reports must be placed inside the unified Body Analysis card.");
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
  return { bodyAnalysis, progress, dashboard, navAnalysis, navOther, panel };
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
const traineeRoute = runRouteForRole("trainee");
assert.equal(traineeRoute.bodyAnalysis._classes.has("active"), false,
  "The coach-only direct route must not activate for trainee accounts.");

console.log("[coach-body-analysis] unified card, coach route, PDF/ZIP mount, published reports, and manual Progress isolation passed.");
