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
    const bodyNames = {
      calf_left_cm: "ساق چپ", calf_right_cm: "ساق راست",
      thigh_left_cm: "ران چپ", thigh_right_cm: "ران راست",
      upper_arm_left_cm: "بازوی چپ", upper_arm_right_cm: "بازوی راست",
      bicep_left_cm: "بازوی چپ", bicep_right_cm: "بازوی راست",
      forearm_left_cm: "ساعد چپ", forearm_right_cm: "ساعد راست",
      chest_cm: "دور سینه", chest_region_cm: "ناحیه سینه",
      hip_cm: "دور باسن", hip_region_cm: "ناحیه باسن",
      waist_abdominal_cm: "دور شکم", waist_lower_cm: "دور کمر پایین",
      waist_narrowest_cm: "باریک‌ترین قسمت کمر",
      lower_waist_region_cm: "ناحیه کمر پایین", upper_waist_region_cm: "ناحیه کمر بالا"
    };
    const bodyMeasurements = latest.report_metrics?.body_measurements_cm || {};
    const bodyMeasurementCards = Object.entries(bodyMeasurements).map(([key, metric]) => {
      if (!validMetric(metric)) return "";
      const label = bodyNames[key] || "اندازه ثبت‌شده";
      return '<div style="border:1px solid #eadfc9;border-radius:9px;padding:8px;background:#fff">' +
        '<small>' + esc(label) + '</small><b style="display:block;color:#765b2e">' +
        esc(fa(metric.value, 2) + " " + (metric.unit === "cm" ? "سانتی‌متر" : metric.unit || "")) +
        '</b></div>';
    }).join("");
    const archive = rows.slice().reverse().map(row => {
      const count = Object.keys(METRIC_LABELS).filter(key => validMetric(row.report_metrics?.[key])).length;
      return '<article style="border:1px solid #eee3d1;border-radius:10px;padding:10px;margin:8px 0;background:#fff">' +
        '<b>' + esc(dateFa(row.analysis_date)) + '</b><div class="muted" style="font-size:12px;margin-top:4px">' +
        fa(count, 0) + ' شاخص معتبر ثبت‌شده</div>' +
        '<div style="font-size:13px;margin-top:6px">' + esc(row.training_notes || "") + '</div>' +
        '<div style="font-size:13px;margin-top:4px">' + esc(row.nutrition_notes || "") + '</div></article>';
    }).join("");
    body.innerHTML = '<p>آخرین آنالیز ارسال‌شده: <b>' + esc(dateFa(latest.analysis_date)) + '</b></p>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:8px">' + cards + '</div>' +
      (bodyMeasurementCards ? '<h3 style="margin-top:18px">اندازه‌های بدنی</h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:7px">' + bodyMeasurementCards + '</div>' : '') +
      '<h3 style="margin-top:18px">روند تغییرات آنالیزها</h3>' +
      (charts || '<p class="muted">با ارسال آنالیز بعدی، نمودار روند شاخص‌های قابل‌مقایسه در این قسمت فعال می‌شود.</p>') +
      '<h3 style="margin-top:18px">تاریخچه و توصیه‌های مربی</h3>' + archive;
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