/* Published Top Genesis snapshots: coach-confirmed send + trainee progress history. */
(function () {
  "use strict";
  const TABLE = "trainee_body_analysis_publications";
  const CARD_ID = "topGenesisPublishedProgress";
  const METRIC_LABELS = {
    height_cm: ["قد", "سانتی‌متر"],
    weight_kg: ["وزن", "کیلوگرم"],
    body_fat_percent: ["درصد چربی بدن", "٪"],
    bmi: ["شاخص توده بدنی", ""],
    fat_mass_kg: ["توده چربی", "کیلوگرم"],
    lean_mass_kg: ["توده بدون چربی", "کیلوگرم"],
    resting_metabolic_rate_kcal: ["سوخت‌وساز پایه", "کیلوکالری"],
    daily_energy_expenditure_kcal: ["انرژی روزانه", "کیلوکالری"],
    waist_hip_ratio: ["نسبت کمر به باسن", ""],
    body_water_percent: ["آب بدن", "٪"],
    visceral_fat_level: ["چربی احشایی", ""]
  };
  const CHART_KEYS = ["weight_kg", "body_fat_percent", "fat_mass_kg", "lean_mass_kg", "bmi"];
  let lastLoadedTrainee = null;
  let lastLoadedAt = 0;
  // Per-trainee request state avoids duplicate reads during repeated navigation.
  let activeLoadToken = 0;
  let loadingTraineeId = null;
  const publishedCache = new Map();
  const PUBLISHED_CACHE_TTL_MS = 15000;
  let lastContextKey = null;
  let contextEpoch = 0;
  const publishedRowsById = new Map();
  // Deduplicate repeated iframe messages in this coach page session. The
  // analyzer may retry a postMessage after a delayed response; the same
  // request ID must never upload or insert a second publication.
  const publicationRequests = new Map();
  function rememberPublicationResult(key, result) {
    const entry = publicationRequests.get(key);
    if (entry) entry.result = result;
    while (publicationRequests.size > 100) {
      const oldest = publicationRequests.keys().next().value;
      publicationRequests.delete(oldest);
    }
  }

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
  const fa = (value, digits = 1) => Number(value).toLocaleString("fa-IR", {
    maximumFractionDigits: digits
  });
  function dateFa(value) {
    if (!value) return "—";
    const date = new Date(String(value).slice(0, 10) + "T12:00:00");
    if (Number.isNaN(date.getTime())) return esc(value);
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      year: "numeric", month: "long", day: "numeric"
    }).format(date);
  }
  function validMetric(metric) {
    return metric && metric.value !== null && metric.value !== undefined &&
      metric.value !== "" && Number.isFinite(Number(metric.value)) &&
      !["invalid_range", "conflict_review", "not_reported"].includes(metric.status);
  }
  function bodyMeasurementLabel(key) {
    const labels = {
      neck_cm:"دور گردن",chest_cm:"دور سینه",chest_region_cm:"ناحیه سینه",
      bicep_left_cm:"بازوی چپ",bicep_right_cm:"بازوی راست",
      bicep_left_lower_cm:"پایین بازوی چپ",bicep_right_lower_cm:"پایین بازوی راست",
      upper_arm_left_cm:"بازوی چپ",upper_arm_right_cm:"بازوی راست",
      forearm_left_cm:"ساعد چپ",forearm_right_cm:"ساعد راست",
      high_hip_cm:"بالاترین قسمت باسن",hip_cm:"دور باسن",hip_region_cm:"ناحیه باسن",
      waist_abdominal_cm:"دور شکم",waist_lower_cm:"دور کمر پایین",
      waist_narrowest_cm:"باریک‌ترین قسمت کمر",lower_waist_region_cm:"ناحیه کمر پایین",
      upper_waist_region_cm:"ناحیه کمر بالا",thigh_left_upper_cm:"بالای ران چپ",
      thigh_right_upper_cm:"بالای ران راست",mid_thigh_left_cm:"وسط ران چپ",
      mid_thigh_right_cm:"وسط ران راست",thigh_left_lower_cm:"پایین ران چپ",
      thigh_right_lower_cm:"پایین ران راست",thigh_left_cm:"ران چپ",thigh_right_cm:"ران راست",
      calf_left_cm:"ساق چپ",calf_right_cm:"ساق راست"
    };
    return labels[key] || ("اندازه " + String(key || "").replace(/_/g, " "));
  }
  function buildComparisonRows(older, newer) {
    const output = [];
    for (const key of Object.keys(METRIC_LABELS)) {
      const a = older.report_metrics?.[key];
      const b = newer.report_metrics?.[key];
      const aValid = validMetric(a), bValid = validMetric(b);
      if (!aValid && !bValid) continue;
      const unitA = String(a?.unit || METRIC_LABELS[key][1] || "");
      const unitB = String(b?.unit || METRIC_LABELS[key][1] || "");
      const sameUnit = !aValid || !bValid || unitA === unitB;
      output.push({
        key,label:METRIC_LABELS[key][0],unit:unitA || unitB,
        olderValue:aValid?Number(a.value):null,newerValue:bValid?Number(b.value):null,
        olderValid:aValid,newerValid:bValid,
        change:aValid&&bValid&&sameUnit?Number(b.value)-Number(a.value):null,
        unitMismatch:aValid&&bValid&&!sameUnit
      });
    }
    const olderMeasures = older.report_metrics?.body_measurements_cm || {};
    const newerMeasures = newer.report_metrics?.body_measurements_cm || {};
    const measureKeys = new Set([...Object.keys(olderMeasures),...Object.keys(newerMeasures)]);
    for (const key of measureKeys) {
      const a = olderMeasures[key], b = newerMeasures[key];
      const aValid = validMetric(a), bValid = validMetric(b);
      if (!aValid && !bValid) continue;
      const unitA = String(a?.unit || "cm"), unitB = String(b?.unit || "cm");
      const sameUnit = !aValid || !bValid || unitA === unitB;
      output.push({
        key:"body_measurements_cm."+key,label:bodyMeasurementLabel(key),unit:unitA || unitB,
        olderValue:aValid?Number(a.value):null,newerValue:bValid?Number(b.value):null,
        olderValid:aValid,newerValid:bValid,
        change:aValid&&bValid&&sameUnit?Number(b.value)-Number(a.value):null,
        unitMismatch:aValid&&bValid&&!sameUnit
      });
    }
    return output;
  }
  function metricValue(metric, key) {
    if (!validMetric(metric)) return "—";
    const unit = METRIC_LABELS[key]?.[1] || "";
    return fa(metric.value, 2) + (unit ? " " + unit : "");
  }
  function currentTraineeId() {
    try {
      const trainee = window.currentClient || (typeof currentClient !== "undefined" ? currentClient : null);
      return trainee?.id || null;
    } catch (_) { return null; }
  }
  function currentCoach() {
    try {
      const profile = window.authProfile || (typeof authProfile !== "undefined" ? authProfile : null);
      return profile?.role === "coach";
    } catch (_) { return false; }
  }
  function currentTrainee() {
    try {
      const profile = window.authProfile || (typeof authProfile !== "undefined" ? authProfile : null);
      return profile?.role === "trainee";
    } catch (_) { return false; }
  }
  // The old progress widgets read the legacy body_analyses table. They are
  // not the trainee's manual progress card and must not remain beside the
  // new approved-report experience.
  function removeLegacyProgressAnalysisCards() {
    // The coach's latest body-analysis view belongs inside the analysis panel.
    // Keep manual progress widgets in Progress for coaches; hide obsolete
    // legacy widgets from trainee Progress without touching the manual entry card.
    const coachView = currentCoach();
    const analysisPanel = $("bodyAnalysisEntryPanel");
    const progressSection = $("progress");
    const coachAnalysisView = $("coachAnalysisView");
    if (coachView) {
      if (analysisPanel && coachAnalysisView && coachAnalysisView.parentElement !== analysisPanel) {
        analysisPanel.appendChild(coachAnalysisView);
      }
      ["progressTrend", "progressHistory"].forEach(id => {
        const node = $(id);
        if (progressSection && node && node.parentElement !== progressSection) {
          progressSection.appendChild(node);
        }
      });
    } else {
      ["coachAnalysisView", "progressTrend", "progressHistory"].forEach(id => {
        const node = $(id);
        if (node) node.remove();
      });
    }
  }
  function installTraineeAnalysisNavigationGuard() {
    const original = window.dashOpen;
    if (typeof original !== "function" || window.__topGenesisAnalysisNavigationGuard) return;
    window.__topGenesisAnalysisNavigationGuard = true;
    window.dashOpen = function(key) {
      window.__topGenesisLastDashKey = key;
      const result = original.apply(this, arguments);
      if (key !== "analysis" || !currentTrainee()) return result;
      const reveal = () => {
        if (window.__topGenesisLastDashKey !== "analysis") return;
        let section = $("traineeAnalysis");
        if (!section) {
          section = document.createElement("section");
          section.id = "traineeAnalysis";
          section.className = "section";
          section.innerHTML = '<div id="traineeAnalysisArchive" hidden aria-hidden="true"></div>';
          document.body.appendChild(section);
        }
        document.querySelectorAll(".section").forEach(item => {
          const active = item === section;
          item.classList.toggle("active", active);
          if (active) {
            item.hidden = false;
            item.removeAttribute("hidden");
            item.removeAttribute("aria-hidden");
            item.classList.remove("hide");
            item.style.setProperty("display", "block", "important");
            item.style.setProperty("visibility", "visible", "important");
          } else {
            item.style.setProperty("display", "none", "important");
            item.style.setProperty("visibility", "hidden", "important");
            item.setAttribute("aria-hidden", "true");
          }
        });
        document.querySelectorAll(".nav button").forEach(button => button.classList.remove("active"));
        const nav = document.querySelector('.nav button[onclick*="analysis"]');
        if (nav) nav.classList.add("active");
      };
      reveal();
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(reveal);
      setTimeout(reveal, 90);
      setTimeout(reveal, 420);
      return result;
    };
  }
  function mountProgressCard() {
    const coachView = currentCoach();
    const section = coachView ? $("progress") : $("traineeAnalysis");
    if (!section) return;
    let card = $(CARD_ID);
    if (!card) {
      card = document.createElement("div");
      card.id = CARD_ID;
      card.className = "card";
      card.style.cssText = "margin-top:14px;border:1px solid #d8b65d;background:#fffdf8";
      card.innerHTML = '<h2>📈 گزارش‌های تأییدشده آنالیز بدن</h2>' +
        '<p class="muted">گزارش اصلی و تاریخچه آنالیزهایی که مربی بررسی و برای شما ارسال کرده است.</p>' +
        '<div id="topGenesisPublishedBody" class="muted">در حال دریافت گزارش‌ها…</div>';
    }
    // The app is a single-page interface: after logout/login the same document
    // can change roles. Always move the one card to the active role's panel.
    if (coachView) {
      const target = $("bodyAnalysisEntryPanel");
      if (target && card.parentElement !== target) target.appendChild(card);
    } else {
      const archive = $("traineeAnalysisArchive");
      if (archive) {
        if (card.parentElement !== archive.parentElement || card.previousElementSibling !== archive) {
          archive.insertAdjacentElement("afterend", card);
        }
      } else if (card.parentElement !== section) {
        section.appendChild(card);
      }
    }
  }
  function chartCard(rows, key) {
    const points = rows.map(row => ({
      date: row.analysis_date,
      metric: row.report_metrics?.[key]
    })).filter(point => validMetric(point.metric));
    if (points.length < 2) return "";
    const values = points.map(point => Number(point.metric.value));
    const min = Math.min(...values), max = Math.max(...values);
    const spread = max - min || Math.max(Math.abs(max) * 0.08, 1);
    const x0 = 34, x1 = 606, y0 = 18, y1 = 118;
    const coords = points.map((point, index) => {
      const x = points.length === 1 ? (x0 + x1) / 2 : x0 + (x1 - x0) * index / (points.length - 1);
      const y = y1 - ((Number(point.metric.value) - min) / spread) * (y1 - y0);
      return { x, y, point };
    });
    const polyline = coords.map(point => point.x + "," + point.y).join(" ");
    const dots = coords.map(point =>
      '<circle cx="' + point.x + '" cy="' + point.y + '" r="4.5" fill="#b9944d"><title>' +
      esc(dateFa(point.point.date) + " · " + metricValue(point.point.metric, key)) +
      '</title></circle>'
    ).join("");
    const labels = [coords[0], coords[coords.length - 1]].map(point =>
      '<text x="' + point.x + '" y="145" text-anchor="middle" font-size="11" fill="#6b6253">' +
      esc(dateFa(point.point.date)) + '</text>'
    ).join("");
    const [label] = METRIC_LABELS[key];
    return '<article style="border:1px solid #eee3d1;border-radius:12px;padding:10px;margin:10px 0;background:#fff">' +
      '<b>' + esc(label) + '</b><svg viewBox="0 0 640 158" role="img" aria-label="نمودار روند ' + esc(label) +
      '" style="width:100%;height:auto;display:block"><line x1="24" y1="118" x2="616" y2="118" stroke="#e8dfd0"/>' +
      '<polyline points="' + polyline + '" fill="none" stroke="#a8833e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
      dots + labels + '</svg><div style="display:flex;justify-content:space-between;font-size:12px;color:#756b59">' +
      '<span>کمترین: ' + fa(min, 2) + '</span><span>بیشترین: ' + fa(max, 2) + '</span></div></article>';
  }
  function persianMonthKey(date) {
    const parts = new Intl.DateTimeFormat("en-US-u-ca-persian", {
      year: "numeric", month: "numeric"
    }).formatToParts(date);
    return parts.find(part => part.type === "year")?.value + "/" +
      parts.find(part => part.type === "month")?.value;
  }
  function currentPersianMonthRange(now = new Date()) {
    const key = persianMonthKey(now);
    const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    while (persianMonthKey(cursor) === key) cursor.setDate(cursor.getDate() - 1);
    cursor.setDate(cursor.getDate() + 1);
    const from = cursor.toISOString().slice(0, 10);
    while (persianMonthKey(cursor) === key) cursor.setDate(cursor.getDate() + 1);
    return { from, to: cursor.toISOString().slice(0, 10) };
  }
  function rowDetails(row) {
    const metrics = row.report_metrics || {};
    const main = Object.keys(METRIC_LABELS).map(key => {
      const metric = metrics[key];
      if (!validMetric(metric)) return "";
      return '<div style="border:1px solid #eadfc9;border-radius:9px;padding:8px;background:#fff">' +
        '<small>' + esc(METRIC_LABELS[key][0]) + '</small><b style="display:block;color:#765b2e">' +
        esc(metricValue(metric, key)) + '</b></div>';
    }).join("");
    const names = {
      calf_left_cm:"ساق چپ",calf_right_cm:"ساق راست",thigh_left_cm:"ران چپ",thigh_right_cm:"ران راست",
      upper_arm_left_cm:"بازوی چپ",upper_arm_right_cm:"بازوی راست",bicep_left_cm:"بازوی چپ",bicep_right_cm:"بازوی راست",
      forearm_left_cm:"ساعد چپ",forearm_right_cm:"ساعد راست",chest_cm:"دور سینه",chest_region_cm:"ناحیه سینه",
      hip_cm:"دور باسن",hip_region_cm:"ناحیه باسن",waist_abdominal_cm:"دور شکم",waist_lower_cm:"دور کمر پایین",
      waist_narrowest_cm:"باریک‌ترین قسمت کمر",lower_waist_region_cm:"ناحیه کمر پایین",upper_waist_region_cm:"ناحیه کمر بالا"
    };
    const measures = Object.entries(metrics.body_measurements_cm || {}).map(([key, metric]) => {
      if (!validMetric(metric)) return "";
      return '<div style="border:1px solid #eadfc9;border-radius:8px;padding:7px;background:#fff"><small>' +
        esc(names[key] || "اندازه ثبت‌شده") + '</small><b style="display:block;color:#765b2e">' +
        esc(fa(metric.value, 2) + " " + (metric.unit === "cm" ? "سانتی‌متر" : metric.unit || "")) +
        '</b></div>';
    }).join("");
    return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:7px">' + main + '</div>' +
      (measures ? '<h4>اندازه‌های بدنی</h4><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(115px,1fr));gap:7px">' + measures + '</div>' : '') +
      '<h4>توصیه تمرینی مربی</h4><p>' + esc(row.training_notes || "ثبت نشده") + '</p>' +
      '<h4>توصیه تغذیه‌ای مربی</h4><p>' + esc(row.nutrition_notes || "ثبت نشده") + '</p>';
  }
  function renderPublished(rows, traineeId) {
    publishedRowsById.clear();
    (rows || []).forEach(row => publishedRowsById.set(String(row.id), row));
    const body = $("topGenesisPublishedBody");
    if (!body || currentTraineeId() !== traineeId) return;
    body.dataset.renderedTraineeId = traineeId;
    if (!rows.length) {
      body.innerHTML = '<p class="muted">هنوز گزارشی از آنالیز تاپ جنسیس برای شما ارسال نشده است.</p>';
      return;
    }
    const latest = rows[rows.length - 1];
    const cards = Object.keys(METRIC_LABELS).map(key => {
      const metric = latest.report_metrics?.[key];
      if (!validMetric(metric)) return "";
      return '<div style="border:1px solid #eadfc9;border-radius:10px;padding:10px;background:#fff">' +
        '<small style="color:#756b59">' + esc(METRIC_LABELS[key][0]) + '</small><b style="display:block;color:#765b2e;font-size:1.1rem">' +
        esc(metricValue(metric, key)) + '</b></div>';
    }).join("");
    const charts = CHART_KEYS.map(key => chartCard(rows, key)).filter(Boolean).join("");
    const latestMeasurements = Object.entries(latest.report_metrics?.body_measurements_cm || {}).map(([key, metric]) => {
      if (!validMetric(metric)) return "";
      const labels = {
        neck_cm:"دور گردن",
        chest_cm:"دور سینه",chest_region_cm:"ناحیه سینه",
        bicep_left_cm:"بازوی چپ",bicep_right_cm:"بازوی راست",
        bicep_left_lower_cm:"پایین بازوی چپ",bicep_right_lower_cm:"پایین بازوی راست",
        upper_arm_left_cm:"بازوی چپ",upper_arm_right_cm:"بازوی راست",
        forearm_left_cm:"ساعد چپ",forearm_right_cm:"ساعد راست",
        high_hip_cm:"بالاترین قسمت باسن",hip_cm:"دور باسن",hip_region_cm:"ناحیه باسن",
        waist_abdominal_cm:"دور شکم",waist_lower_cm:"دور کمر پایین",
        waist_narrowest_cm:"باریک‌ترین قسمت کمر",lower_waist_region_cm:"ناحیه کمر پایین",upper_waist_region_cm:"ناحیه کمر بالا",
        thigh_left_upper_cm:"بالای ران چپ",thigh_right_upper_cm:"بالای ران راست",
        mid_thigh_left_cm:"وسط ران چپ",mid_thigh_right_cm:"وسط ران راست",
        thigh_left_lower_cm:"پایین ران چپ",thigh_right_lower_cm:"پایین ران راست",
        thigh_left_cm:"ران چپ",thigh_right_cm:"ران راست",
        calf_left_cm:"ساق چپ",calf_right_cm:"ساق راست"
      };
      return '<div style="border:1px solid #eadfc9;border-radius:9px;padding:8px;background:#fff"><small>' +
        esc(labels[key] || "اندازه ثبت‌شده") + '</small><b style="display:block;color:#765b2e">' +
        esc(fa(metric.value, 2) + " " + (metric.unit === "cm" ? "سانتی‌متر" : metric.unit || "")) + '</b></div>';
    }).join("");
    body.innerHTML = '<section style="padding:10px;border:1px solid #eadfc9;border-radius:12px;background:#fff">' +
      '<p>آخرین آنالیز ارسال‌شده: <b>' + esc(dateFa(latest.analysis_date)) + '</b></p>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:8px">' + cards + '</div>' +
      (latestMeasurements ? '<h3>اندازه‌های بدنی آخرین آنالیز</h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:7px">' + latestMeasurements + '</div>' : '') +
      '</section><h3 style="margin-top:18px">روند تغییرات همه آنالیزها</h3>' +
      (charts || '<p class="muted">با ارسال آنالیز بعدی، نمودار روند شاخص‌های قابل‌مقایسه در این قسمت فعال می‌شود.</p>') +
      '<h3 style="margin-top:18px">تاریخچه آنالیزها</h3>' +
      '<div id="topGenesisHistoryFilters" style="display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin:10px 0">' +
      '<label>نمایش <select id="topGenesisHistoryMode" style="padding:8px;border:1px solid #d8c69e;border-radius:8px"><option value="latest">آخرین آنالیز</option><option value="month">این ماه</option><option value="all">همه آنالیزها</option><option value="range">انتخاب بازه تاریخ</option></select></label>' +
      '<label id="topGenesisDateFromWrap" hidden>از تاریخ <input id="topGenesisDateFrom" type="date" lang="fa-IR" style="padding:7px;border:1px solid #d8c69e;border-radius:8px"></label>' +
      '<label id="topGenesisDateToWrap" hidden>تا تاریخ <input id="topGenesisDateTo" type="date" lang="fa-IR" style="padding:7px;border:1px solid #d8c69e;border-radius:8px"></label>' +
      '<span id="topGenesisHistoryCount" class="muted" style="font-size:12px"></span></div>' +
      '<div id="topGenesisCompareControls" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px;margin:8px 0;border:1px solid #eadfc9;border-radius:10px;background:#fffdf8">' +
      '<span id="topGenesisCompareStatus" class="muted" style="flex:1 1 220px">برای مقایسه، دو آنالیز را انتخاب کنید.</span>' +
      '<button type="button" id="topGenesisCompareButton" disabled style="width:auto;padding:8px 12px;border:1px solid #c5a45b;border-radius:8px;background:#fffaf0;color:#765b2e">مقایسه دو آنالیز</button>' +
      '<button type="button" id="topGenesisClearCompare" style="width:auto;padding:8px 12px;border:1px solid #ddd;border-radius:8px;background:#fff">پاک کردن انتخاب</button></div>' +
      '<div id="topGenesisCompareResult" hidden style="margin:10px 0"></div>' +
      '<div id="topGenesisHistoryList"></div>';
    const mode = $("topGenesisHistoryMode");
    const from = $("topGenesisDateFrom");
    const to = $("topGenesisDateTo");
    const resetComparison = () => {
      const result = $("topGenesisCompareResult");
      if (result) { result.hidden = true; result.innerHTML = ""; }
      const button = $("topGenesisCompareButton");
      if (button) button.disabled = true;
      const status = $("topGenesisCompareStatus");
      if (status) status.textContent = "برای مقایسه، دو آنالیز را انتخاب کنید.";
    };
    const renderHistory = () => {
      const selected = mode.value;
      $("topGenesisDateFromWrap").hidden = selected !== "range";
      $("topGenesisDateToWrap").hidden = selected !== "range";
      let filtered = rows.slice().reverse();
      if (selected === "latest") filtered = filtered.slice(0, 1);
      else if (selected === "month") {
        const range = currentPersianMonthRange();
        filtered = filtered.filter(row => row.analysis_date >= range.from && row.analysis_date < range.to);
      } else if (selected === "range") {
        if (from.value) filtered = filtered.filter(row => row.analysis_date >= from.value);
        if (to.value) filtered = filtered.filter(row => row.analysis_date <= to.value);
      }
      $("topGenesisHistoryCount").textContent = fa(filtered.length, 0) + " گزارش";
      $("topGenesisHistoryList").innerHTML = filtered.length ? filtered.map(row => {
        const count = Object.keys(METRIC_LABELS).filter(key => validMetric(row.report_metrics?.[key])).length;
        const action = row.report_storage_path
          ? '<button type="button" data-history-report="' + esc(row.id) + '" style="border:1px solid #c5a45b;border-radius:8px;background:#fffaf0;padding:7px 11px;color:#765b2e">مشاهده گزارش کامل</button>'
          : '<button type="button" data-history-details="' + esc(row.id) + '" aria-expanded="false" style="border:1px solid #c5a45b;border-radius:8px;background:#fffaf0;padding:7px 11px;color:#765b2e">مشاهده جزئیات</button>';
        return '<article style="border:1px solid #eee3d1;border-radius:10px;padding:10px;margin:8px 0;background:#fff">' +
          '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap"><b>' +
          esc(dateFa(row.analysis_date)) + '</b><label style="display:inline-flex;align-items:center;gap:5px;font-size:12px"><input type="checkbox" data-history-compare="' + esc(row.id) + '"> انتخاب برای مقایسه</label>' + action + '</div>' +
          '<div class="muted" style="font-size:12px;margin-top:5px">' + fa(count, 0) + ' شاخص معتبر ثبت‌شده</div>' +
          '<div id="topGenesisDetails-' + esc(row.id) + '" hidden style="margin-top:12px">' + rowDetails(row) + '</div></article>';
      }).join("") : '<p class="muted">در این بازه گزارشی ثبت نشده است.</p>';
      resetComparison();
    };
    mode.addEventListener("change", renderHistory);
    from.addEventListener("change", renderHistory);
    to.addEventListener("change", renderHistory);
    $("topGenesisHistoryList").addEventListener("click", async event => {
      const reportButton = event.target.closest("[data-history-report]");
      if (reportButton) {
        const row = rows.find(item => item.id === reportButton.dataset.historyReport);
        if (row?.report_storage_path) await openFullReport(row, reportButton);
        return;
      }
      const button = event.target.closest("[data-history-details]");
      if (!button) return;
      const panel = $("topGenesisDetails-" + button.dataset.historyDetails);
      if (!panel) return;
      panel.hidden = !panel.hidden;
      button.setAttribute("aria-expanded", String(!panel.hidden));
      button.textContent = panel.hidden ? "مشاهده جزئیات" : "بستن جزئیات";
    });
    const historyList = $("topGenesisHistoryList");
    const compareButton = $("topGenesisCompareButton");
    const compareStatus = $("topGenesisCompareStatus");
    const compareResult = $("topGenesisCompareResult");
    historyList.addEventListener("change", event => {
      if (!event.target.matches("[data-history-compare]")) return;
      const selected = Array.from(historyList.querySelectorAll("[data-history-compare]:checked"));
      if (selected.length > 2) {
        event.target.checked = false;
        if (compareStatus) compareStatus.textContent = "برای مقایسه فقط دو آنالیز را انتخاب کنید.";
        return;
      }
      compareButton.disabled = selected.length !== 2;
      if (compareStatus) compareStatus.textContent = selected.length === 2
        ? "دو آنالیز انتخاب شدند؛ برای دیدن اختلاف شاخص‌ها دکمه مقایسه را بزنید."
        : "آنالیز انتخاب‌شده: " + fa(selected.length, 0) + " از ۲";
    });
    compareButton.addEventListener("click", () => {
      const ids = Array.from(historyList.querySelectorAll("[data-history-compare]:checked")).map(input => input.dataset.historyCompare);
      if (ids.length !== 2) return;
      const selectedRows = ids.map(id => publishedRowsById.get(String(id))).filter(Boolean);
      if (selectedRows.length !== 2) return;
      selectedRows.sort((a,b) =>
        String(a.analysis_date||"").localeCompare(String(b.analysis_date||"")) ||
        String(a.created_at||"").localeCompare(String(b.created_at||""))
      );
      const older = selectedRows[0], newer = selectedRows[1];
      const comparisonRows = buildComparisonRows(older,newer);
      const unitText = unit => unit === "cm" ? "سانتی‌متر" : unit === "kg" ? "کیلوگرم" : unit === "%" ? "٪" : unit;
      const valueText = (valid,value,unit) => valid ? fa(value,2) + (unitText(unit) ? " " + unitText(unit) : "") : "—";
      const changeText = row => {
        if (row.change === null) return row.unitMismatch ? "واحد متفاوت" : "—";
        const value = (row.change > 0 ? "+" : "") + fa(row.change,2);
        return value + (unitText(row.unit) ? " " + unitText(row.unit) : "");
      };
      compareResult.innerHTML = '<section style="border:1px solid #d8b65d;border-radius:12px;padding:12px;background:#fffdf8">' +
        '<h3 style="margin-top:0">مقایسه دو آنالیز انتخاب‌شده</h3>' +
        '<p class="muted">آنالیز قدیمی: <b>' + esc(dateFa(older.analysis_date)) + '</b>　|　آنالیز جدید: <b>' + esc(dateFa(newer.analysis_date)) + '</b></p>' +
        (comparisonRows.length ? '<div style="overflow-x:auto"><table style="width:100%;min-width:520px;border-collapse:collapse"><thead><tr><th>شاخص</th><th>آنالیز قدیمی</th><th>آنالیز جدید</th><th>تغییر</th></tr></thead><tbody>' +
          comparisonRows.map(row => '<tr><td>' + esc(row.label) + '</td><td>' + esc(valueText(row.olderValid,row.olderValue,row.unit)) + '</td><td>' + esc(valueText(row.newerValid,row.newerValue,row.unit)) + '</td><td><b>' + esc(changeText(row)) + '</b></td></tr>').join("") +
          '</tbody></table></div>' : '<p class="muted">شاخص عددی معتبری برای مقایسه این دو گزارش وجود ندارد.</p>') +
        '</section>';
      compareResult.hidden = false;
      compareResult.scrollIntoView({ behavior:"smooth", block:"nearest" });
    });
    $("topGenesisClearCompare").addEventListener("click", () => {
      historyList.querySelectorAll("[data-history-compare]").forEach(input => { input.checked = false; });
      resetComparison();
    });
    // Keep the report viewer mounted across history refreshes. Recreating it
    // here revoked the active Blob URL and unexpectedly closed an open report.
    ensureFullReportViewer();
    renderHistory();
  }
  function ensureFullReportViewer() {
    let modal = $("topGenesisFullReportModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "topGenesisFullReportModal";
      modal.hidden = true;
      modal.style.cssText = "display:none;position:fixed;inset:0;z-index:99999;background:#17130dcc;padding:12px;align-items:center;justify-content:center";
      modal.innerHTML = '<section role="dialog" aria-modal="true" aria-label="گزارش کامل آنالیز بدن" style="width:min(100%,1000px);height:min(96vh,900px);background:#fffdf7;border:1px solid #d8b65d;border-radius:14px;padding:10px;display:flex;flex-direction:column;gap:8px"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>گزارش کامل آنالیز بدن</b><div style="display:flex;gap:6px"><button type="button" id="topGenesisPrintFullReport">چاپ / ذخیره PDF</button><button type="button" id="topGenesisCloseFullReport">بستن</button></div></div><iframe id="topGenesisFullReportFrame" title="گزارش کامل آنالیز بدن" sandbox="allow-same-origin allow-modals" style="width:100%;flex:1;border:1px solid #eadfc9;border-radius:9px;background:white"></iframe></section>';
      document.body.appendChild(modal);
      const closeModal = () => {
        const frame = $("topGenesisFullReportFrame");
        if (frame?.dataset.objectUrl) URL.revokeObjectURL(frame.dataset.objectUrl);
        if (frame) { frame.removeAttribute("src"); delete frame.dataset.objectUrl; }
        modal.hidden = true;
        modal.style.display = "none";
      };
      $("topGenesisCloseFullReport").addEventListener("click", closeModal);
      $("topGenesisPrintFullReport").addEventListener("click", () => {
        try { $("topGenesisFullReportFrame").contentWindow.print(); } catch (_) {}
      });
      modal.addEventListener("click", event => { if (event.target === modal) closeModal(); });
    }
    return { modal, frame: $("topGenesisFullReportFrame") };
  }
  function closeFullReportViewer() {
    const modal = $("topGenesisFullReportModal");
    const frame = $("topGenesisFullReportFrame");
    if (frame?.dataset.objectUrl) URL.revokeObjectURL(frame.dataset.objectUrl);
    if (frame) { frame.removeAttribute("src"); delete frame.dataset.objectUrl; }
    if (modal) { modal.hidden = true; modal.style.display = "none"; }
  }
  async function openFullReport(row, button) {
    const viewer = ensureFullReportViewer();
    const modal = viewer.modal;
    const frame = viewer.frame;
    if (!modal || !frame || !row?.report_storage_path) {
      alert("نمایشگر گزارش آماده نشد؛ صفحه را تازه‌سازی کنید.");
      return;
    }
    const requestedTraineeId = currentTraineeId();
    const requestedEpoch = contextEpoch;
    if (!requestedTraineeId || (!currentCoach() && !currentTrainee())) return;
    const expectedPrefix = String(row.coach_user_id || "") + "/" + requestedTraineeId + "/published/";
    if (String(row.trainee_id || "") !== String(requestedTraineeId) ||
        !row.coach_user_id || !String(row.report_storage_path).startsWith(expectedPrefix) ||
        !/^[0-9a-f-]{36}\.html$/i.test(String(row.report_storage_path).slice(expectedPrefix.length))) {
      console.warn("Top Genesis report path does not match the selected trainee and assigned coach.");
      return;
    }
    const oldText = button?.textContent;
    if (button) { button.disabled = true; button.textContent = "در حال دریافت گزارش…"; }
    try {
      const { data, error } = await window.AUTH_SUPABASE.storage
        .from("trainee-health-reports").download(row.report_storage_path);
      if (error) throw error;
      if (!data) throw new Error("فایل گزارش دریافت نشد.");
      if (requestedEpoch !== contextEpoch || requestedTraineeId !== currentTraineeId()) {
        throw new Error("شاگرد یا حساب کاربری تغییر کرده است؛ نمایش گزارش قبلی لغو شد.");
      }
      if (frame.dataset.objectUrl) URL.revokeObjectURL(frame.dataset.objectUrl);
      const reportBlob = data.type === "text/html" ? data : new Blob([data], { type: "text/html;charset=utf-8" });
      const objectUrl = URL.createObjectURL(reportBlob);
      frame.dataset.objectUrl = objectUrl;
      frame.src = objectUrl;
      modal.hidden = false;
      modal.style.display = "flex";
    } catch (error) {
      if (requestedEpoch === contextEpoch && requestedTraineeId === currentTraineeId()) {
        alert("نمایش گزارش کامل انجام نشد. اتصال یا دسترسی گزارش را بررسی کنید.");
        console.warn("Top Genesis full report:", error);
      }
    } finally {
      // A completed request must never mutate controls belonging to a newer
      // trainee/account context (the old button may already be detached).
      if (button && requestedEpoch === contextEpoch &&
          requestedTraineeId === currentTraineeId() && button.isConnected) {
        button.disabled = false;
        button.textContent = oldText || "مشاهده گزارش کامل";
      }
    }
  }
  // Public entry point for the coach's dedicated Body Analysis route.
  // This is separate from window.loadProgressHistory, which reads legacy manual records.
  window.loadTopGenesisPublishedHistory = function () {
    mountProgressCard();
    return loadPublished(false);
  };

  const PUBLISHED_HISTORY_PAGE_SIZE = 500;
  async function fetchAllPublishedRows(traineeId, requestEpoch, requestToken) {
    const all = [];
    const seenIds = new Set();
    let offset = 0;
    let pageCount = 0;
    while (true) {
      if (++pageCount > 10000) throw new Error("تعداد صفحات تاریخچه آنالیز از حد ایمن بیشتر شد.");
      if (requestEpoch !== contextEpoch || requestToken !== activeLoadToken ||
          String(currentTraineeId()) !== String(traineeId)) return null;
      const { data, error } = await window.AUTH_SUPABASE.from(TABLE)
        .select("id,trainee_id,coach_user_id,analysis_date,report_metrics,training_notes,nutrition_notes,report_storage_path,published_at")
        .eq("trainee_id", traineeId)
        .order("analysis_date", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + PUBLISHED_HISTORY_PAGE_SIZE - 1);
      if (error) throw error;
      const page = Array.isArray(data) ? data : [];
      for (const row of page) {
        const id = row && row.id != null ? String(row.id) : null;
        if (id !== null && seenIds.has(id)) continue;
        if (id !== null) seenIds.add(id);
        all.push(row);
      }
      if (page.length < PUBLISHED_HISTORY_PAGE_SIZE) break;
      offset += page.length;
    }
    return all;
  }

  async function loadPublished(force) {
    const traineeId = currentTraineeId();
    const requestEpoch = contextEpoch;
    if ((!currentCoach() && !currentTrainee()) || !traineeId || !window.AUTH_SUPABASE) return;

    // The history card may be mounted after the first database request (for
    // example, when its host panel is created lazily during navigation).
    // Always paint any cached rows into the current DOM before request guards:
    // a previous successful load must not suppress rendering into a newly
    // mounted card.
    const body = $("topGenesisPublishedBody");
    const cached = publishedCache.get(traineeId);
    const cacheIsFresh = cached && Date.now() - cached.savedAt < PUBLISHED_CACHE_TTL_MS;
    // MutationObserver calls tick() after DOM changes. Re-rendering cached rows
    // on every tick replaces the card HTML again, which triggers the observer
    // indefinitely and can freeze the page. Paint cached rows only when this
    // card has not yet been rendered for the selected trainee.
    if (cached && body?.dataset.renderedTraineeId !== traineeId) {
      renderPublished(cached.rows, traineeId);
    }

    if (!force && traineeId === lastLoadedTrainee && Date.now() - lastLoadedAt < 20000) return;
    if (loadingTraineeId === traineeId) return;

    if (!cacheIsFresh && body) {
      body.setAttribute("aria-live", "polite");
      body.setAttribute("aria-busy", "true");
      body.textContent = "در حال دریافت سوابق آنالیز…";
    }

    const requestToken = ++activeLoadToken;
    loadingTraineeId = traineeId;
    try {
      const rows = await fetchAllPublishedRows(traineeId, requestEpoch, requestToken);
      if (!rows) return;
      if (requestEpoch !== contextEpoch || currentTraineeId() !== traineeId) return;
      if (requestToken !== activeLoadToken) return;
      publishedCache.set(traineeId, { rows, savedAt: Date.now() });
      renderPublished(rows, traineeId);
      lastLoadedTrainee = traineeId;
      lastLoadedAt = Date.now();
    } catch (error) {
      if (requestEpoch === contextEpoch && body && currentTraineeId() === traineeId) {
        if (requestToken !== activeLoadToken) return;
        if (!cacheIsFresh) {
          body.innerHTML = '<p class="muted">دریافت سوابق آنالیز انجام نشد. اتصال اینترنت یا دسترسی را بررسی و دوباره تلاش کنید.</p>' +
            '<button type="button" id="topGenesisRetryHistory" style="margin-top:8px;padding:8px 12px;border:1px solid #c5a45b;border-radius:8px;background:#fffaf0">تلاش دوباره</button>';
          $("topGenesisRetryHistory")?.addEventListener("click", () => loadPublished(true), { once: true });
        }
        console.warn("Top Genesis published history:", error);
      }
    } finally {
      if (requestToken === activeLoadToken) {
        loadingTraineeId = null;
        $("topGenesisPublishedBody")?.removeAttribute("aria-busy");
      }
    }
  }
  function safeMetrics(source) {
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("داده‌های آنالیز معتبر نیستند.");
    const allowed = new Set([
      "height_cm", "weight_kg", "body_fat_percent", "bmi", "fat_mass_kg", "lean_mass_kg",
      "resting_metabolic_rate_kcal", "daily_energy_expenditure_kcal", "waist_hip_ratio",
      "body_water_percent", "visceral_fat_level", "body_measurements_cm"
    ]);
    const output = {};
    for (const key of allowed) {
      const value = source[key];
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      if (key === "body_measurements_cm") {
        const nested = {};
        Object.entries(value).forEach(([name, metric]) => {
          if (/^[a-z0-9_]{1,64}$/i.test(name) && metric && typeof metric === "object" &&
              metric.value !== undefined && metric.value !== null && Number.isFinite(Number(metric.value))) {
            nested[name] = { value: Number(metric.value), unit: String(metric.unit || "").slice(0, 40), status: String(metric.status || "").slice(0, 40) };
          }
        });
        if (Object.keys(nested).length) output[key] = nested;
      } else if (value.value !== undefined && value.value !== null && Number.isFinite(Number(value.value))) {
        output[key] = { value: Number(value.value), unit: String(value.unit || "").slice(0, 40), status: String(value.status || "").slice(0, 40) };
      }
    }
    if (!Object.keys(output).length) throw new Error("هیچ شاخص عددی معتبری برای ارسال پیدا نشد.");
    return output;
  }
  function reply(frame, requestId, ok, message) {
    frame?.contentWindow?.postMessage({
      type: "top-genesis-publish-result", requestId, ok, message
    }, window.location.origin);
  }
  async function handleApprovedReport(event) {
    const frame = $("topGenesisPdfAnalyzerFrame");
    if (!frame || event.source !== frame.contentWindow || event.origin !== window.location.origin ||
        event.data?.type !== "top-genesis-approved-report") return;
    const requestId = String(event.data.requestId || "").slice(0, 120);
    if (!requestId) {
      reply(frame, requestId, false, "شناسه درخواست ارسال گزارش معتبر نیست؛ دوباره تلاش کنید.");
      return;
    }
    const requestKey = String(currentTraineeId() || "") + ":" + requestId;
    const previousRequest = publicationRequests.get(requestKey);
    if (previousRequest) {
      if (previousRequest.result) {
        reply(frame, requestId, previousRequest.result.ok, previousRequest.result.message);
      } else {
        reply(frame, requestId, false, "این درخواست قبلاً دریافت شده و هنوز در حال پردازش است؛ لطفاً چند لحظه صبر کنید.");
      }
      return;
    }
    publicationRequests.set(requestKey, { result: null });
    let uploadedReportPath = null;
    let publicationStage = "اعتبارسنجی گزارش";
    try {
      if (!currentCoach()) throw new Error("ارسال گزارش فقط از حساب مربی امکان‌پذیر است.");
      const traineeId = currentTraineeId();
      if (!traineeId) throw new Error("ابتدا شاگرد موردنظر را انتخاب کنید.");
      const payload = event.data.payload || {};
      const payloadTraineeId = String(payload.traineeId || "");
      const payloadContextNonce = String(payload.contextNonce || "");
      if (!payloadTraineeId || payloadTraineeId !== traineeId ||
          payloadTraineeId !== String(frame.dataset.boundTraineeId || "") ||
          !payloadContextNonce || payloadContextNonce !== String(frame.dataset.contextNonce || "")) {
        throw new Error("شاگرد انتخاب‌شده هنگام تحلیل تغییر کرده است؛ برای جلوگیری از ارسال گزارش فرد اشتباه، دوباره فایل همان شاگرد را تحلیل کنید.");
      }
      const assertSameTraineeContext = () => {
        if (currentTraineeId() !== traineeId ||
            String(frame.dataset.boundTraineeId || "") !== traineeId ||
            String(frame.dataset.contextNonce || "") !== payloadContextNonce) {
          throw new Error("شاگرد انتخاب‌شده تغییر کرده است؛ ارسال گزارش متوقف شد.");
        }
      };
      const date = String(payload.analysisDate || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("تاریخ آنالیز معتبر نیست.");
      const metrics = safeMetrics(payload.metrics);
      const training = String(payload.trainingNotes || "").trim().slice(0, 4000);
      const nutrition = String(payload.nutritionNotes || "").trim().slice(0, 4000);
      const reportHtml = String(payload.reportHtml || "");
      if (!training || !nutrition) throw new Error("پیشنهاد تمرینی و تغذیه‌ای مربی باید تکمیل شوند.");
      if (!reportHtml.startsWith("<!doctype html>") || !reportHtml.includes('id="result"')) {
        throw new Error("نسخه کامل و قابل‌نمایش گزارش شاگرد آماده نیست؛ دوباره تحلیل را اجرا کنید.");
      }
      const reportBytes = new TextEncoder().encode(reportHtml).length;
      if (reportBytes <= 0 || reportBytes > 9 * 1024 * 1024) {
        throw new Error("حجم گزارش کامل بیش از حد مجاز است؛ تعداد تصاویر اسکن را بررسی کنید.");
      }
      publicationStage = "بازیابی نشست مربی";
      const auth = window.AUTH_SUPABASE?.auth;
      if (!auth || typeof auth.getSession !== "function" || typeof auth.getUser !== "function") {
        throw new Error("سرویس نشست مربی در این صفحه آماده نیست؛ صفحه را تازه‌سازی کنید.");
      }
      // Read the persisted session through the app's single-flight session
      // coordinator. Passing the access token explicitly to getUser avoids a
      // race where getUser() tries to re-read a session while auth storage is
      // being refreshed by another request.
      const sessionResult = typeof window.__sehGetSessionSingleFlight === "function"
        ? await window.__sehGetSessionSingleFlight()
        : await auth.getSession();
      if (sessionResult?.error) throw sessionResult.error;
      let coachSession = sessionResult?.data?.session || null;
      if (!coachSession?.access_token) {
        throw new Error("نشست ورود مربی در مرورگر پیدا نشد؛ لطفاً صفحه را تازه‌سازی کنید و دوباره با حساب مربی وارد شوید. اطلاعات شاگردان تغییری نکرده است.");
      }
      publicationStage = "اعتبارسنجی نشست مربی";
      const { data: userData, error: userError } = await auth.getUser(coachSession.access_token);
      if (userError) throw userError;
      const coachId = userData?.user?.id;
      if (!coachId) throw new Error("نشست مربی از سوی سرویس ورود تأیید نشد؛ دوباره وارد حساب مربی شوید.");
      assertSameTraineeContext();
      const reportPath = coachId + "/" + traineeId + "/published/" + crypto.randomUUID() + ".html";
      // Reserve this unique path before the first request. If the browser loses
      // the response after Storage accepted the object, the catch block can
      // still attempt cleanup rather than leaving an orphaned report.
      uploadedReportPath = reportPath;
      publicationStage = "بارگذاری فایل گزارش در فضای ذخیره‌سازی";
      const reportBlob = new Blob([reportHtml], { type: "text/html;charset=utf-8" });
      let uploadResult = null;
      let lastUploadError = null;
      // Mobile networks can drop the response after Storage has already
      // accepted a large report. Reuse one immutable UUID path and verify that
      // exact object before retrying, so a lost response cannot create duplicates.
      const maxUploadAttempts = 5;
      const storage = window.AUTH_SUPABASE.storage.from("trainee-health-reports");
      const isRetryableStorageError = error => {
        const status = Number(error?.status || error?.statusCode || 0);
        const message = String(error?.message || error?.name || "");
        const name = String(error?.name || "").toLowerCase();
        return error instanceof TypeError || status >= 500 ||
          /failed to fetch|fetch failed|network|timeout|unknown error|storageunknownerror/i.test(message) ||
          name.includes("unknown") || name.includes("network");
      };
      const verifyUploadedObject = async () => {
        try {
          const { data, error } = await storage.download(reportPath);
          return !error && Boolean(data);
        } catch (_) {
          return false;
        }
      };
      for (let attempt = 1; attempt <= maxUploadAttempts; attempt += 1) {
        assertSameTraineeContext();
        try {
          uploadResult = await storage.upload(reportPath, reportBlob, {
            contentType: "text/html",
            cacheControl: "3600",
            // INSERT-only Storage permissions: never require UPDATE for retries.
            upsert: false
          });
          lastUploadError = uploadResult?.error || null;
          if (!lastUploadError) break;
        } catch (error) {
          lastUploadError = error;
        }

        const status = Number(lastUploadError?.status || lastUploadError?.statusCode || 0);
        const errorText = String(lastUploadError?.message || lastUploadError?.name || "");
        const errorName = String(lastUploadError?.name || "Error");
        const duplicateObject = status === 409 ||
          /already exists|duplicate/i.test(errorText) ||
          errorName.toLowerCase().includes("alreadyexists");
        const retryable = duplicateObject || isRetryableStorageError(lastUploadError);

        // A network error is ambiguous: the server may have stored the object
        // but the response was lost. Confirm it before sending the same path again.
        if (retryable && await verifyUploadedObject()) {
          lastUploadError = null;
          console.info("Top Genesis Storage upload verified after ambiguous response.", { attempt });
          break;
        }
        if (!retryable || attempt === maxUploadAttempts) break;

        console.warn("Top Genesis Storage upload retry:", {
          attempt, nextAttempt: attempt + 1, status: status || null,
          name: errorName, message: errorText.slice(0, 180),
          browserOnline: navigator.onLine !== false
        });
        const backoffMs = Math.min(5000, 800 * (2 ** (attempt - 1)));
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
      if (lastUploadError) throw lastUploadError;
      assertSameTraineeContext();
      publicationStage = "ثبت اطلاعات گزارش در پایگاه داده";
      const { error } = await window.AUTH_SUPABASE.from(TABLE).insert({
        trainee_id: traineeId,
        coach_user_id: coachId,
        analysis_date: date,
        report_metrics: metrics,
        training_notes: training,
        nutrition_notes: nutrition,
        report_storage_path: reportPath
      });
      if (error) throw error;
      uploadedReportPath = null;
      const successMessage = "گزارش تأییدشده با موفقیت به پنل پیشرفت شاگرد ارسال شد.";
      rememberPublicationResult(requestKey, { ok: true, message: successMessage });
      reply(frame, requestId, true, successMessage);
      lastLoadedTrainee = null;
      if ($("progress")?.classList.contains("active")) {
        mountProgressCard();
        loadPublished(true);
      }
    } catch (error) {
      let cleanupFailure = null;
      if (uploadedReportPath) {
        try {
          const { error: cleanupError } = await window.AUTH_SUPABASE.storage
            .from("trainee-health-reports")
            .remove([uploadedReportPath]);
          if (cleanupError) cleanupFailure = cleanupError;
        } catch (cleanupError) {
          cleanupFailure = cleanupError;
        }
        if (cleanupFailure) {
          console.error("Top Genesis temporary report cleanup failed:", {
            path: uploadedReportPath,
            name: String(cleanupFailure?.name || "Error"),
            message: String(cleanupFailure?.message || "Unknown cleanup error"),
            status: cleanupFailure?.status ?? null,
            code: cleanupFailure?.code ?? null
          });
        }
      }
      const errorName = String(error?.name || "Error");
      const rawErrorMessage = String(error?.message || "خطای نامشخص");
      const networkFetchFailure = error instanceof TypeError && navigator.onLine !== false;
      const baseErrorMessage = networkFetchFailure
        ? "مرورگر نتوانست درخواست را به فضای ذخیره‌سازی برساند؛ احتمال اختلال شبکه یا محدودیت CORS وجود دارد. جزئیات: " + rawErrorMessage
        : rawErrorMessage;
      const cleanupWarning = cleanupFailure
        ? "؛ پاکسازی فایل موقت نیز ناموفق بود و نیاز به بررسی فضای ذخیره‌سازی دارد"
        : "";
      const errorMessage = baseErrorMessage + cleanupWarning;
      const errorStatus = Number.isFinite(Number(error?.status)) ? `، وضعیت HTTP ${Number(error.status)}` : "";
      const errorCode = error?.code ? `، کد ${String(error.code).slice(0, 40)}` : "";
      const offline = navigator.onLine === false ? "؛ اتصال اینترنت مرورگر قطع است" : "";
      console.error("Top Genesis publication failed:", {
        stage: publicationStage, name: errorName, message: errorMessage,
        status: error?.status ?? null, code: error?.code ?? null,
        browserOnline: navigator.onLine
      });
      const failureMessage = `مرحله ناموفق: ${publicationStage}. ${errorMessage} (${errorName}${errorStatus}${errorCode})${offline}`;
      rememberPublicationResult(requestKey, { ok: false, message: failureMessage });
      reply(frame, requestId, false, failureMessage);
    }
  }
  window.addEventListener("message", handleApprovedReport);
  function tick() {
    const role = currentCoach() ? "coach" : currentTrainee() ? "trainee" : "signed-out";
    const traineeId = role === "signed-out" ? "" : String(currentTraineeId() || "");
    const contextKey = role + ":" + traineeId;
    if (contextKey !== lastContextKey) {
      lastContextKey = contextKey;
      contextEpoch += 1;
      activeLoadToken += 1;
      loadingTraineeId = null;
      lastLoadedTrainee = null;
      lastLoadedAt = 0;
      closeFullReportViewer();
      const body = $("topGenesisPublishedBody");
      if (body) body.textContent = role === "signed-out" || !traineeId
        ? "برای مشاهده گزارش‌ها وارد حساب کاربری شوید."
        : "در حال دریافت گزارش‌های شاگرد انتخاب‌شده…";
    }
    removeLegacyProgressAnalysisCards();
    installTraineeAnalysisNavigationGuard();
    mountProgressCard();
    const visibleSection = currentCoach() ? $("progress") : $("traineeAnalysis");
    // Coaches need the approved-report history ready as soon as they select a trainee;
    // waiting until they open the Progress section makes the Analysis card look empty
    // until an unrelated navigation event happens. loadPublished() already deduplicates
    // in-flight requests and caches each trainee, so this is safe across page mutations.
    const coachHasSelectedTrainee = currentCoach() && Boolean(currentTraineeId());
    if (coachHasSelectedTrainee || visibleSection?.classList.contains("active")) {
      loadPublished(false);
    }
  }
  // Capture report clicks at document level: the history list can be
  // re-rendered/reparented during role changes, which may detach its listener.
  document.addEventListener("click", async event => {
    const button = event.target?.closest?.("[data-history-report]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const row = publishedRowsById.get(String(button.dataset.historyReport || ""));
    if (!row?.report_storage_path) {
      alert("اطلاعات این گزارش در فهرست فعلی پیدا نشد؛ فهرست را تازه‌سازی کنید.");
      return;
    }
    await openFullReport(row, button);
  }, true);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tick, { once: true });
  } else tick();
  new MutationObserver(tick).observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(tick, 2500);
  window.addEventListener("visibilitychange", () => { if (!document.hidden) { lastLoadedTrainee = null; tick(); } });
})();