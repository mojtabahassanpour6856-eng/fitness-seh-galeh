/* Top Genesis PDF text extractor — isolated experiment.
 * Coach-side only. Does not upload files, persist PII, or change existing analysis records.
 * Requires PDF.js; loaded lazily from a pinned CDN version when not already present.
 */
(function (global) {
  "use strict";

  const PDFJS_VERSION = "3.11.174";
  const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" + PDFJS_VERSION + "/pdf.min.js";
  const PDFJS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" + PDFJS_VERSION + "/pdf.worker.min.js";
  let pdfJsPromise;

  function loadPdfJs() {
    if (global.pdfjsLib) return Promise.resolve(global.pdfjsLib);
    if (pdfJsPromise) return pdfJsPromise;
    pdfJsPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = PDFJS_URL;
      script.async = true;
      script.onload = () => {
        if (!global.pdfjsLib) return reject(new Error("کتابخانه PDF.js بارگذاری شد اما در دسترس نیست."));
        global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        resolve(global.pdfjsLib);
      };
      script.onerror = () => reject(new Error("بارگذاری ابزار خواندن PDF ناموفق بود؛ اتصال اینترنت را بررسی کنید."));
      document.head.appendChild(script);
    });
    return pdfJsPromise;
  }

  function normalize(text) {
    return String(text || "")
      .replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
      .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function numberAfter(text, regex) {
    const match = text.match(regex);
    if (!match) return null;
    const value = Number(String(match[1]).replace(",", "."));
    return Number.isFinite(value) ? value : null;
  }

  function metric(value, unit, source, status) {
    return value == null ? null : { value, unit, source, status: status || "needs_coach_review" };
  }

  function extractMetrics(raw) {
    const text = normalize(raw);
    const out = {};

    const heightWeight = text.match(/(?:Height\s*&\s*Weight|Height\s+and\s+Weight)\s*([0-9]+(?:\.[0-9]+)?)\s*cm\s*&?\s*([0-9]+(?:\.[0-9]+)?)\s*kg/i);
    if (heightWeight) {
      out.height_cm = metric(Number(heightWeight[1]), "cm", "Basic Info / Height & Weight");
      out.weight_kg = metric(Number(heightWeight[2]), "kg", "Basic Info / Height & Weight");
    }

    const fatValues = [...text.matchAll(/Body\s*Fat\s*%?\s*([0-9]+(?:\.[0-9]+)?)\s*%/gi)].map(m => Number(m[1]));
    if (fatValues.length) {
      const exact = fatValues.find(v => v !== 25) ?? fatValues[0];
      const conflict = Math.max(...fatValues) - Math.min(...fatValues) > 1;
      out.body_fat_percent = metric(exact, "%", "Basic Info / Fitness & Health Metrics", conflict ? "conflict_review" : "needs_coach_review");
      if (conflict) out.body_fat_percent.alternatives = [...new Set(fatValues)];
    }

    const bmi = numberAfter(text, /\bBMI\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (bmi != null) out.bmi = metric(bmi, "kg/m²", "Basic Info / Fitness & Health Metrics");

    const whr = numberAfter(text, /Waist\s*[- ]?to\s*[- ]?Hip\s*Ratio\s*([0-9]+(?:\.[0-9]+)?)/i);
    if (whr != null) out.waist_hip_ratio = metric(whr, "ratio", "Basic Info / Fitness & Health Metrics");

    const rmr = numberAfter(text, /\bRMR\s*([0-9]+(?:\.[0-9]+)?)\s*calories?\s*\/\s*day/i);
    if (rmr != null) out.resting_metabolic_rate_kcal = metric(rmr, "kcal/day", "Activity & Caloric Expenditure / RMR");

    const tdee = numberAfter(text, /(?:Caloric\s*Expenditure|total\s*calories\s*you\s*burn\s*each\s*day)[^0-9]{0,100}([0-9]+(?:\.[0-9]+)?)\s*Calories?\s*\/\s*day/i);
    if (tdee != null) out.daily_energy_expenditure_kcal = metric(tdee, "kcal/day", "Activity & Caloric Expenditure / Caloric Expenditure");

    const fatMass = numberAfter(text, /(?:Fat\s*Mass\s*|made\s*up\s*of\s*)([0-9]+(?:\.[0-9]+)?)\s*kg\s*(?:of\s*fat|fat\s*mass)/i);
    if (fatMass != null) out.fat_mass_kg = metric(fatMass, "kg", "Body Composition");

    const leanMass = numberAfter(text, /([0-9]+(?:\.[0-9]+)?)\s*kg\s*of\s*lean\s*body\s*mass/i);
    if (leanMass != null) out.lean_mass_kg = metric(leanMass, "kg", "Body Composition");

    const waist = numberAfter(text, /(?:Your\s*waist\s*measures|Waist\s*Circumference)\s*([0-9]+(?:\.[0-9]+)?)\s*cm/i);
    if (waist != null) out.waist_circumference_cm = metric(waist, "cm", "Waist Analysis");

    const percentile = numberAfter(text, /Percentile\s*([0-9]+(?:\.[0-9]+)?)\s*%/i);
    if (percentile != null) out.comparison_percentile = metric(percentile, "%", "Basic Info / Percentile");

    const flags = [];
    const checks = [
      ["height_cm", 100, 230], ["weight_kg", 25, 350], ["body_fat_percent", 2, 65],
      ["bmi", 10, 70], ["waist_hip_ratio", 0.3, 1.5], ["resting_metabolic_rate_kcal", 500, 4000],
      ["daily_energy_expenditure_kcal", 700, 7000], ["fat_mass_kg", 1, 250],
      ["lean_mass_kg", 10, 250], ["waist_circumference_cm", 30, 200],
      ["comparison_percentile", 0, 100]
    ];
    checks.forEach(([key, min, max]) => {
      const item = out[key];
      if (item && (item.value < min || item.value > max)) {
        item.status = "invalid_range";
        flags.push(key + ": خارج از محدوده کنترل اولیه");
      }
    });
    if (out.body_fat_percent?.status === "conflict_review") flags.push("درصد چربی در صفحات مختلف با دقت متفاوت درج شده است.");
    if (!out.height_cm || !out.weight_kg) flags.push("قد یا وزن از متن PDF استخراج نشد.");
    if (!out.body_fat_percent) flags.push("درصد چربی پیدا نشد.");
    if (!out.bmi) flags.push("BMI پیدا نشد.");
    return { metrics: out, flags, review_required: true, pii_extracted: false };
  }

  async function extract(file) {
    if (!(file instanceof Blob) || (!/\.pdf$/i.test(file.name || "") && file.type !== "application/pdf")) {
      throw new Error("فقط فایل PDF قابل بررسی است.");
    }
    if (!file.size || file.size > 10 * 1024 * 1024) throw new Error("حجم فایل باید بین صفر تا ۱۰ مگابایت باشد.");
    const pdfjs = await loadPdfJs();
    const bytes = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: bytes }).promise;
    const pages = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => item.str || "").join(" "));
    }
    const result = extractMetrics(pages.join(" "));
    result.page_count = pdf.numPages;
    result.engine = "pdfjs-" + PDFJS_VERSION;
    return result;
  }

  global.TopGenesisPdfParser = Object.freeze({ extract, extractMetrics });
})(window);
