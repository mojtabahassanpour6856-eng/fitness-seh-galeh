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
  let loading = false;

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
  function metricValue(metric, key) {
    if (!validMetric(metric)) return "—";
    const unit = METRIC_LABELS[key]?.[1] || "";
    return fa(metric.value, 2) + (unit ? " " + unit : "");
  }
  function currentTraineeId() {
    try { return typeof currentClient !== "undefined" ? (currentClient?.id || null) : null; } catch (_) { return null; }
  }
  function currentCoach() {
    try { return typeof authProfile !== "undefined" && authProfile?.role === "coach"; } catch (_) { return false; }
  }
  function mountProgressCard() {
    const section = currentCoach() ? $("progress") : $("traineeAnalysis");
    if (!section || $(CARD_ID)) return;
    const card = document.createElement("div");
    card.id = CARD_ID;
    card.className = "card";
    card.style.cssText = "margin-top:14px;border:1px solid #d8b65d;background:#fffdf8";
    card.innerHTML = '<h2>📈 گزارش‌های تأییدشده آنالیز بدن</h2>' +
      '<p class="muted">گزارش‌هایی که مربی بررسی و ارسال کرده است، همراه با روند تغییرات در این بخش نمایش داده می‌شود.</p>' +
      '<div id="topGenesisPublishedBody" class="muted">در حال دریافت گزارش‌ها…</div>';
    if (currentCoach()) {
      const history = $("progressHistory");
      const entry = $("progressEntryPanel");
      if (history) history.insertAdjacentElement("afterend", card);
      else if (entry) entry.insertAdjacentElement("afterend", card);
      else section.appendChild(card);
    } else {
      const archive = $("traineeAnalysisArchive");
      if (archive) archive.insertAdjacentElement("afterend", card);
      else section.appendChild(card);
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
    const body = $("topGenesisPublishedBody");
    if (!body || currentTraineeId() !== traineeId) return;
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
      const labels = {calf_left_cm:"ساق چپ",calf_right_cm:"ساق راست",thigh_left_cm:"ران چپ",thigh_right_cm:"ران راست",
        upper_arm_left_cm:"بازوی چپ",upper_arm_right_cm:"بازوی راست",bicep_left_cm:"بازوی چپ",bicep_right_cm:"بازوی راست",
        forearm_left_cm:"ساعد چپ",forearm_right_cm:"ساعد راست",chest_cm:"دور سینه",chest_region_cm:"ناحیه سینه",
        hip_cm:"دور باسن",hip_region_cm:"ناحیه باسن",waist_abdominal_cm:"دور شکم",waist_lower_cm:"دور کمر پایین",
        waist_narrowest_cm:"باریک‌ترین قسمت کمر",lower_waist_region_cm:"ناحیه کمر پایین",upper_waist_region_cm:"ناحیه کمر بالا"};
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
      '<div id="topGenesisHistoryList"></div>';
    const mode = $("topGenesisHistoryMode");
    const from = $("topGenesisDateFrom");
    const to = $("topGenesisDateTo");
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
        return '<article style="border:1px solid #eee3d1;border-radius:10px;padding:10px;margin:8px 0;background:#fff">' +
          '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap"><b>' +
          esc(dateFa(row.analysis_date)) + '</b><button type="button" data-history-details="' + esc(row.id) +
          '" aria-expanded="false" style="border:1px solid #c5a45b;border-radius:8px;background:#fffaf0;padding:7px 11px;color:#765b2e">مشاهده جزئیات</button></div>' +
          '<div class="muted" style="font-size:12px;margin-top:5px">' + fa(count, 0) + ' شاخص معتبر ثبت‌شده</div>' +
          '<div id="topGenesisDetails-' + esc(row.id) + '" hidden style="margin-top:12px">' + rowDetails(row) + '</div></article>';
      }).join("") : '<p class="muted">در این بازه گزارشی ثبت نشده است.</p>';
    };
    mode.addEventListener("change", renderHistory);
    from.addEventListener("change", renderHistory);
    to.addEventListener("change", renderHistory);
    $("topGenesisHistoryList").addEventListener("click", event => {
      const button = event.target.closest("[data-history-details]");
      if (!button) return;
      const panel = $("topGenesisDetails-" + button.dataset.historyDetails);
      if (!panel) return;
      panel.hidden = !panel.hidden;
      button.setAttribute("aria-expanded", String(!panel.hidden));
      button.textContent = panel.hidden ? "مشاهده جزئیات" : "بستن جزئیات";
    });
    renderHistory();
  }
  async function loadPublished(force) {
    const traineeId = currentTraineeId();
    if (!traineeId || !window.AUTH_SUPABASE || loading) return;
    if (!force && traineeId === lastLoadedTrainee && Date.now() - lastLoadedAt < 20000) return;
    loading = true;
    const body = $("topGenesisPublishedBody");
    if (body && !lastLoadedTrainee) body.textContent = "در حال دریافت گزارش‌ها…";
    try {
      const { data, error } = await window.AUTH_SUPABASE.from(TABLE)
        .select("id,analysis_date,report_metrics,training_notes,nutrition_notes,published_at")
        .eq("trainee_id", traineeId)
        .order("analysis_date", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      if (currentTraineeId() !== traineeId) return;
      renderPublished(data || [], traineeId);
      lastLoadedTrainee = traineeId;
      lastLoadedAt = Date.now();
    } catch (error) {
      if (body && currentTraineeId() === traineeId) {
        body.textContent = "دریافت گزارش‌های ارسال‌شده انجام نشد. دسترسی پایگاه داده را بررسی کنید.";
        console.warn("Top Genesis published history:", error);
      }
    } finally {
      loading = false;
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
    const requestId = String(event.data.requestId || "");
    try {
      if (!currentCoach()) throw new Error("ارسال گزارش فقط از حساب مربی امکان‌پذیر است.");
      const traineeId = currentTraineeId();
      if (!traineeId) throw new Error("ابتدا شاگرد موردنظر را انتخاب کنید.");
      const payload = event.data.payload || {};
      const date = String(payload.analysisDate || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("تاریخ آنالیز معتبر نیست.");
      const metrics = safeMetrics(payload.metrics);
      const training = String(payload.trainingNotes || "").trim().slice(0, 4000);
      const nutrition = String(payload.nutritionNotes || "").trim().slice(0, 4000);
      if (!training || !nutrition) throw new Error("پیشنهاد تمرینی و تغذیه‌ای مربی باید تکمیل شوند.");
      const { data: userData, error: userError } = await window.AUTH_SUPABASE.auth.getUser();
      if (userError) throw userError;
      const coachId = userData?.user?.id;
      if (!coachId) throw new Error("نشست مربی معتبر نیست؛ دوباره وارد شوید.");
      const { error } = await window.AUTH_SUPABASE.from(TABLE).insert({
        trainee_id: traineeId,
        coach_user_id: coachId,
        analysis_date: date,
        report_metrics: metrics,
        training_notes: training,
        nutrition_notes: nutrition
      });
      if (error) throw error;
      reply(frame, requestId, true, "گزارش تأییدشده با موفقیت به پنل پیشرفت شاگرد ارسال شد.");
      lastLoadedTrainee = null;
      if ($("progress")?.classList.contains("active")) {
        mountProgressCard();
        loadPublished(true);
      }
    } catch (error) {
      reply(frame, requestId, false, error?.message || "ارسال گزارش انجام نشد.");
    }
  }
  window.addEventListener("message", handleApprovedReport);
  function tick() {
    mountProgressCard();
    const visibleSection = currentCoach() ? $("progress") : $("traineeAnalysis");
    if (visibleSection?.classList.contains("active")) loadPublished(false);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tick, { once: true });
  } else tick();
  new MutationObserver(tick).observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(tick, 2500);
  window.addEventListener("visibilitychange", () => { if (!document.hidden) { lastLoadedTrainee = null; tick(); } });
})();