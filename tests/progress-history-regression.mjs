import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const helperSource = fs.readFileSync(path.join(root, "progress-history.js"), "utf8");
const publication = fs.readFileSync(path.join(root, "top-genesis-publication.js"), "utf8");
const archive = fs.readFileSync(path.join(root, "top-genesis-archive.js"), "utf8");
assert.ok(helperSource.includes("async function sbGetAllPages"), "The shared paginated history reader must exist.");

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
await testPublishedHistoryPagination();
testArchivePaginationAndTraineeGuard();
testArbitraryReportComparison();

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

async function testPublishedHistoryPagination() {
  const start = publication.indexOf("const PUBLISHED_HISTORY_PAGE_SIZE = 500;");
  const end = publication.indexOf("async function loadPublished(force)", start);
  assert.ok(start >= 0 && end > start, "Published Top Genesis history must have a dedicated paginated reader.");
  const helperSource = publication.slice(start, end);
  const rows = Array.from({ length: 1201 }, (_, i) => ({ id: "publication-" + (i + 1) }));
  const ranges = [];
  const fakeSupabase = {
    from() {
      const query = {
        select() { return this; },
        eq() { return this; },
        order() { return this; },
        range(from, to) {
          ranges.push([from, to]);
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        }
      };
      return query;
    }
  };
  const sandbox = {
    TABLE: "trainee_body_analysis_publications",
    PUBLISHED_HISTORY_PAGE_SIZE: 500,
    contextEpoch: 1,
    activeLoadToken: 1,
    currentTraineeId: () => "trainee-a",
    window: { AUTH_SUPABASE: fakeSupabase }
  };
  vm.runInNewContext(helperSource + ";globalThis.__fetchAll=fetchAllPublishedRows;", sandbox);
  const result = await sandbox.__fetchAll("trainee-a", 1, 1);
  assert.equal(result.length, 1201, "All approved Top Genesis reports must be loaded across pages.");
  assert.deepEqual(ranges, [[0, 499], [500, 999], [1000, 1499]]);
  assert.ok(helperSource.includes('.order("id", { ascending: true })'),
    "Published history pagination must have a unique ordering tie-breaker.");

  let activeTrainee = "trainee-a";
  let staleCalls = 0;
  const staleSupabase = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        order() { return this; },
        range() {
          staleCalls++;
          activeTrainee = "trainee-b";
          return Promise.resolve({ data: rows.slice(0, 500), error: null });
        }
      };
    }
  };
  const staleSandbox = {
    TABLE: "trainee_body_analysis_publications",
    PUBLISHED_HISTORY_PAGE_SIZE: 500,
    contextEpoch: 1,
    activeLoadToken: 1,
    currentTraineeId: () => activeTrainee,
    window: { AUTH_SUPABASE: staleSupabase }
  };
  vm.runInNewContext(helperSource + ";globalThis.__fetchAll=fetchAllPublishedRows;", staleSandbox);
  const staleResult = await staleSandbox.__fetchAll("trainee-a", 1, 1);
  assert.equal(staleResult, null, "A publication-history load must stop if the selected trainee changes.");
  assert.equal(staleCalls, 1, "No further pages may be fetched after the trainee context changes.");
}

function testArbitraryReportComparison() {
  const start = publication.indexOf("function bodyMeasurementLabel(key)");
  const end = publication.indexOf("function metricValue(metric, key)", start);
  assert.ok(start >= 0 && end > start, "The report comparison helper must exist.");
  const helperSource = publication.slice(start, end);
  const labels = {
    weight_kg: ["وزن", "کیلوگرم"],
    body_fat_percent: ["درصد چربی", "٪"],
    bmi: ["BMI", ""]
  };
  const validMetric = metric => !!metric && metric.value !== null && metric.value !== undefined &&
    metric.value !== "" && Number.isFinite(Number(metric.value)) &&
    !["invalid_range", "conflict_review", "not_reported"].includes(metric.status);
  const build = new Function("METRIC_LABELS", "validMetric", helperSource + ";return buildComparisonRows;")(labels, validMetric);
  const older = { report_metrics: {
    weight_kg: { value: 80, unit: "kg" },
    body_fat_percent: { value: 25, unit: "%" },
    body_measurements_cm: {
      waist_abdominal_cm: { value: 90, unit: "cm" },
      chest_cm: { value: 100, unit: "cm" }
    }
  }};
  const newer = { report_metrics: {
    weight_kg: { value: 78, unit: "kg" },
    body_fat_percent: { value: 22, unit: "%" },
    body_measurements_cm: {
      waist_abdominal_cm: { value: 85, unit: "cm" },
      chest_cm: { value: 39, unit: "inch" }
    }
  }};
  const rows = build(older, newer);
  const weight = rows.find(row => row.key === "weight_kg");
  const fat = rows.find(row => row.key === "body_fat_percent");
  const waist = rows.find(row => row.key === "body_measurements_cm.waist_abdominal_cm");
  const chest = rows.find(row => row.key === "body_measurements_cm.chest_cm");
  assert.equal(weight.change, -2);
  assert.equal(fat.change, -3);
  assert.equal(waist.change, -5);
  assert.equal(chest.change, null, "Values with different units must not be subtracted.");
  assert.equal(chest.unitMismatch, true);
  assert.ok(publication.includes('data-history-compare="'),
    "Every published history item must be selectable for comparison.");
  assert.ok(publication.includes("buildComparisonRows(older,newer)"),
    "The UI must compare the two selected report snapshots.");
  assert.ok(publication.includes("selectedRows.sort"),
    "Comparison must be oriented from the older report to the newer report.");
  assert.ok(publication.includes("selected.length > 2"),
    "The UI must cap the selection at exactly two reports.");
}

function testArchivePaginationAndTraineeGuard() {
  assert.ok(archive.includes("const ARCHIVE_PAGE_SIZE = 500;"),
    "The private PDF archive must use bounded pages.");
  assert.ok(archive.includes(".range(offset, offset + ARCHIVE_PAGE_SIZE - 1)"),
    "The private PDF archive must request every page explicitly.");
  assert.ok(archive.includes("let archiveRefreshToken = 0;") &&
    archive.includes("token !== archiveRefreshToken"),
    "Stale archive requests must be discarded.");
  assert.ok(archive.includes("selectedId !== lastMountedTraineeId"),
    "Changing the selected trainee must trigger an archive refresh.");
  assert.ok(archive.includes('String(current.trainee.id) !== traineeId'),
    "An archive response must not render after the coach switches trainees.");
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

console.log("[progress-history] manual and Top Genesis pagination, source classification, cross-table deduplication, RPC, trainee isolation, and two-report comparison passed.");
