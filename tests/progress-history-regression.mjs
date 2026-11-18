import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const start = html.indexOf("const PROGRESS_HISTORY_PAGE_SIZE=500;");
const end = html.indexOf("async function sbWrite(path,method,body){", start);
assert.ok(start >= 0 && end > start, "The shared paginated history reader must exist.");
const helperSource = html.slice(start, end);

const saveStart = html.indexOf("async function saveProgress(){");
const saveEnd = html.indexOf("async function saveAnalysis(){", saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart, "The progress submission handler must exist.");
const saveProgress = html.slice(saveStart, saveEnd);
assert.ok(saveProgress.includes('sbWrite("/rpc/record_trainee_progress","POST"'),
  "Trainee progress must use the deployed atomic RPC.");
assert.ok(saveProgress.includes("p_trainee_id:traineeId") && saveProgress.includes("p_log_date:date") &&
  saveProgress.includes("p_weight:weight"), "The RPC must receive the exact trainee, date, and weight.");
assert.doesNotMatch(saveProgress, /sbWrite\(["']\/weight_logs["'],["']POST["']/,
  "The client must not split a trainee progress submission into separate weight and body-analysis writes.");
assert.ok(saveProgress.includes("COACH_PROGRESS_ENTRY: ثبت توسط مربی"),
  "Coach-originated entries must retain an explicit coach marker.");

function loadHelpers(sbGet) {
  const sandbox = { sbGet, Date };
  vm.runInNewContext(
    helperSource + ";globalThis.__api={sbGetAllPages,isProgressManualRecord,progressWeightKey,progressSourceLabel,buildProgressHistoryRows,getTraineeProgressHistoryData};",
    sandbox
  );
  return sandbox.__api;
}

await testPagination();
testSourceClassificationAndDeduplication();
await testPerTraineeFetchCache();

function testPagination() {
  const calls = [];
  const fakeSbGet = async path => {
    calls.push(path);
    const limit = Number((path.match(/[?&]limit=(\d+)/) || [])[1] || 500);
    const offset = Number((path.match(/[?&]offset=(\d+)/) || [])[1] || 0);
    const total = 1201;
    return Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({
      id: offset + i + 1
    }));
  };
  const api = loadHelpers(fakeSbGet);
  return api.sbGetAllPages("/test?order=id.asc").then(rows => {
    assert.equal(rows.length, 1201, "All pages must be returned, not only the first 100 records.");
    assert.equal(calls.length, 3, "The 1,201-row fixture must require three pages.");
    assert.ok(calls[0].includes("limit=500&offset=0"));
    assert.ok(calls[1].includes("limit=500&offset=500"));
    assert.ok(calls[2].includes("limit=500&offset=1000"));
  });
}

function testSourceClassificationAndDeduplication() {
  const api = loadHelpers(async () => []);
  const analyses = [
    { id: "manual-1", analysis_date: "2026-01-01", weight: 80, notes: "MANUAL_PROGRESS_ENTRY: ثبت دستی" },
    { id: "legacy-duplicate", analysis_date: "2026-01-01", weight: "80.0", notes: "ثبت پیشرفت دوره‌ای" },
    { id: "legacy-1", analysis_date: "2026-01-02", weight: 79, notes: "ثبت پیشرفت دوره‌ای" },
    { id: "coach-1", analysis_date: "2026-01-03", weight: 82, notes: "BMI: 24 | BMR: 1700" }
  ];
  const weightLogs = [
    { id: 1, log_date: "2026-01-01", weight: 80 },
    { id: 2, log_date: "2026-01-02", weight: "79.0" },
    { id: 3, log_date: "2026-01-04", weight: 78 },
    { id: 4, log_date: "2026-01-04", weight: 78 }
  ];
  const rows = api.buildProgressHistoryRows(analyses, weightLogs);
  assert.equal(rows.length, 4, "Matching rows across tables are shown once; distinct weight-log IDs remain visible.");
  assert.equal(rows.filter(row => !row._weightOnly).length, 2);
  assert.equal(rows.filter(row => row._weightOnly).length, 2);
  assert.equal(api.progressSourceLabel(rows.find(row => row.id === "manual-1")), "ثبت شاگرد");
  assert.equal(api.progressSourceLabel(rows.find(row => row.id === "legacy-1")), "ثبت قدیمی · منبع نامشخص");
  assert.equal(api.progressSourceLabel(rows.find(row => row._weightOnly)), "فقط ثبت وزن");
  assert.equal(api.progressWeightKey("2026-01-01", 80), api.progressWeightKey("2026-01-01", "80.0"));
  assert.ok(rows.filter(row => row._weightOnly).every(row =>
    row.waist === null && row.chest === null && row.body_fat === null && row.muscle_mass === null
  ), "Weight-only rows must not receive fabricated body measurements.");
  assert.ok(!rows.some(row => row.id === "legacy-duplicate"), "An exact legacy duplicate must defer to the explicit marker without deleting either database row.");
  assert.ok(!rows.some(row => row.id === "coach-1"), "Coach/device analyses must not enter the manual progress timeline.");
  assert.ok(!Object.hasOwn(analyses[0], "_weightOnly"), "The source rows must not be mutated.");
}

async function testPerTraineeFetchCache() {
  const calls = [];
  const fakeSbGet = async path => {
    calls.push(path);
    if (path.includes("/body_analyses?")) return [{ id: "body-row", notes: "MANUAL_PROGRESS_ENTRY" }];
    if (path.includes("/weight_logs?")) return [{ id: 1, weight: 80 }];
    throw new Error("Unexpected query: " + path);
  };
  const api = loadHelpers(fakeSbGet);
  const first = await api.getTraineeProgressHistoryData("trainee-a");
  assert.equal(first.analysisRows[0].id, "body-row");
  assert.equal(calls.length, 2);
  await api.getTraineeProgressHistoryData("trainee-a");
  assert.equal(calls.length, 2, "The shared short cache should prevent duplicate reads during trainee selection.");
  await api.getTraineeProgressHistoryData("trainee-a", true);
  assert.equal(calls.length, 4, "A forced refresh must bypass the short cache.");
  await api.getTraineeProgressHistoryData("trainee-b");
  assert.equal(calls.length, 6);
  assert.ok(calls.every(path => path.includes("trainee_id=eq.trainee-a") || path.includes("trainee_id=eq.trainee-b")),
    "Every query must be scoped to the requested trainee.");
  assert.ok(calls.every(path => path.includes("order=") && path.includes("id.asc")),
    "Every page must use deterministic ordering with a unique ID tie-breaker.");
}

console.log("[progress-history] pagination, source classification, cross-table deduplication, and trainee-scoped cache passed.");
