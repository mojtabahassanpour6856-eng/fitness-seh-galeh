/* Top Genesis PDF text extractor — isolated experiment.
 * Coach-side only. Does not upload files, persist PII, or change existing analysis records.
 * Requires PDF.js; loaded lazily from a pinned CDN version when not already present.
 */
(function (global) {
  "use strict";

  const PDFJS_VERSION = "3.11.174";
  const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" + PDFJS_VERSION + "/pdf.min.js";
  const PDFJS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" + PDFJS_VERSION + "/pdf.worker.min.js";
  const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
  let pdfJsPromise;
  let tesseractPromise;

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

  function loadTesseract() {
    if (global.Tesseract) return Promise.resolve(global.Tesseract);
    if (tesseractPromise) return tesseractPromise;
    tesseractPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = TESSERACT_URL;
      script.async = true;
      script.onload = () => global.Tesseract
        ? resolve(global.Tesseract)
        : reject(new Error("ابزار OCR بارگذاری شد اما در دسترس نیست."));
      script.onerror = () => reject(new Error("بارگذاری ابزار OCR ناموفق بود."));
      document.head.appendChild(script);
    });
    return tesseractPromise;
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

  function numericCandidates(text, regex) {
    return [...text.matchAll(regex)].map(match => Number(String(match[1]).replace(",", "."))).filter(Number.isFinite);
  }

  function setCandidateMetric(out, key, values, unit, source, tolerance, flags, label) {
    if (!values.length) return;
    const unique = [...new Set(values)];
    const conflict = Math.max(...unique) - Math.min(...unique) > tolerance;
    out[key] = metric(values[0], unit, source, conflict ? "conflict_review" : "needs_coach_review");
    if (unique.length > 1) out[key].alternatives = unique;
    if (conflict) flags.push("چند مقدار متفاوت برای " + label + " پیدا شد؛ مقدار نخست فقط گزینه اولیه است و باید با گزارش تطبیق داده شود.");
    else if (unique.length > 1) out[key].status = "consistent_rounding";
  }

  function metric(value, unit, source, status) {
    return value == null ? null : { value, unit, source, status: status || "needs_coach_review" };
  }

  function extractMetrics(raw) {
    const text = normalize(raw);
    const out = {};
    const flags = [];

    const heightWeightMatches = [...text.matchAll(/(?:Height\s*&\s*Weight|Height\s+and\s+Weight)\s*([0-9]+(?:\.[0-9]+)?)\s*cm\s*&?\s*([0-9]+(?:\.[0-9]+)?)\s*kg/gi)];
    if (heightWeightMatches.length) {
      setCandidateMetric(out, "height_cm", heightWeightMatches.map(m => Number(m[1])), "cm", "Basic Info / Height & Weight", 0.5, flags, "قد");
      setCandidateMetric(out, "weight_kg", heightWeightMatches.map(m => Number(m[2])), "kg", "Basic Info / Height & Weight", 0.5, flags, "وزن");
    } else {
      setCandidateMetric(out, "height_cm", numericCandidates(text, /\bHeight\s*[:=-]?\s*([0-9]+(?:\.[0-9]+)?)\s*cm/gi), "cm", "Basic Info / Height", 0.5, flags, "قد");
      setCandidateMetric(out, "weight_kg", numericCandidates(text, /\bWeight\s*[:=-]?\s*([0-9]+(?:\.[0-9]+)?)\s*kg/gi), "kg", "Basic Info / Weight", 0.5, flags, "وزن");
    }

    const fatValues = numericCandidates(text, /Body\s*Fat\s*%?\s*[:=-]?\s*([0-9]+(?:\.[0-9]+)?)\s*%/gi);
    setCandidateMetric(out, "body_fat_percent", fatValues, "%", "Basic Info / Fitness & Health Metrics", 1, flags, "درصد چربی بدن");

    const bmiValues = numericCandidates(text, /\bBMI\s*[:=-]?\s*([0-9]+(?:\.[0-9]+)?)/gi);
    setCandidateMetric(out, "bmi", bmiValues, "kg/m²", "Basic Info / Fitness & Health Metrics", 0.5, flags, "BMI");

    const whrValues = numericCandidates(text, /Waist\s*[- ]?to\s*[- ]?Hip\s*Ratio\s*[:=-]?\s*([0-9]+(?:\.[0-9]+)?)/gi);
    setCandidateMetric(out, "waist_hip_ratio", whrValues, "ratio", "Basic Info / Fitness & Health Metrics", 0.01, flags, "نسبت کمر به باسن");

    let rmrValues = numericCandidates(text, /(?:\bRMR\b|Resting\s*Metabolic\s*Rate)\s*[:=-]?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kcal|calories?)\s*\/?\s*day/gi);
    // OCR may separate the RMR heading from its graphical value with explanatory text.
    if (!rmrValues.length && /Resting\s*Metabolic\s*Rate|\bRMR\b/i.test(text)) {
      const dayValues = numericCandidates(text, /([0-9]{3,4})\s*(?:kcal|calories?)\s*\/?\s*day/gi);
      if (dayValues.length) rmrValues = [dayValues[0]];
    }
    setCandidateMetric(out, "resting_metabolic_rate_kcal", rmrValues, "kcal/day", "Activity & Caloric Expenditure / RMR", 25, flags, "سوخت‌وساز پایه");

    // TDEE is accepted only when the value is explicitly tied to a daily-expenditure
    // label. Never infer it as the last generic Calories/day number.
    let tdeeValues = numericCandidates(text, /(?:TDEE|Total\s*Daily\s*Energy\s*Expenditure|Daily\s*Energy\s*Expenditure|Caloric\s*Expenditure)\s*[:=-]?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:kcal|calories?)\s*\/?\s*day/gi);
    // OCR may return the two graphical Calories/day values in reading order: RMR, then total expenditure.
    if (!tdeeValues.length && /Caloric\s*Expenditure/i.test(text)) {
      const dayValues = numericCandidates(text, /([0-9]{3,4})\s*(?:kcal|calories?)\s*\/?\s*day/gi);
      if (dayValues.length > 1) tdeeValues = [dayValues[1]];
    }
    setCandidateMetric(out, "daily_energy_expenditure_kcal", tdeeValues, "kcal/day", "Activity & Caloric Expenditure / explicit daily expenditure label", 50, flags, "مصرف انرژی روزانه");

    const fatMass = numberAfter(text, /([0-9]+(?:\.[0-9]+)?)\s*kg\s*of\s*fat\s*mass/i);
    if (fatMass != null) out.fat_mass_kg = metric(fatMass, "kg", "Body Composition");

    const leanMass = numberAfter(text, /([0-9]+(?:\.[0-9]+)?)\s*kg\s*of\s*lean\s*body\s*mass/i);
    if (leanMass != null) out.lean_mass_kg = metric(leanMass, "kg", "Body Composition");

    const waist = numberAfter(text, /(?:Your\s*waist\s*measures|Waist\s*Circumference)\s*([0-9]+(?:\.[0-9]+)?)\s*cm/i);
    if (waist != null) out.waist_circumference_cm = metric(waist, "cm", "Waist Analysis");

    const percentile = numberAfter(text, /Percentile\s*([0-9]+(?:\.[0-9]+)?)\s*%/i);
    if (percentile != null) out.comparison_percentile = metric(percentile, "%", "Basic Info / Percentile");

    const bodyRank = numberAfter(text, /Your\s*Rank\s*([0-9]+(?:\.[0-9]+)?)\s*%\s*places\s*you/i);
    if (bodyRank != null) out.body_fat_rank_marker = metric(bodyRank, "%", "Body Composition / Your Rank");

    const ratioMatches = [...text.matchAll(/Waist\s*[- ]?to\s*[- ]?Hip\s*Ratio\s*[:=-]?\s*([0-9]+(?:\.[0-9]+)?)/gi)];
    const detailedWaistRatio = ratioMatches.length ? Number(ratioMatches[ratioMatches.length - 1][1]) : null;
    if (detailedWaistRatio != null) {
      out.waist_hip_ratio_detailed = metric(detailedWaistRatio, "ratio", "Waist Analysis");
      if (out.waist_hip_ratio && Math.abs(out.waist_hip_ratio.value - detailedWaistRatio) <= 0.01) {
        out.waist_hip_ratio.status = "consistent_rounding";
      } else if (out.waist_hip_ratio && Math.abs(out.waist_hip_ratio.value - detailedWaistRatio) > 0.01) {
        out.waist_hip_ratio.status = "conflict_review";
        flags.push("نسبت کمر به باسن در بخش‌های گزارش نیازمند تطبیق است.");
      }
    }

    const bodyMeasures = [
      ["calf_left_cm", /Calf\s*Left\s*Region\s*[|:=-]?\s*([0-9]+(?:\.[0-9]+)?)/i],
      ["forearm_left_cm", /Forearm\s*Left\s*Region\s*[|:=-]?\s*([0-9]+(?:\.[0-9]+)?)/i],
      ["forearm_right_cm", /Forearm\s*Right\s*Region\s*[|:=-]?\s*([0-9]+(?:\.[0-9]+)?)/i],
      ["calf_right_cm", /Calf\s*Right\s*Region\s*[|:=-]?\s*([0-9]+(?:\.[0-9]+)?)/i],
      ["chest_region_cm", /Chest\s*Region\s*[|:=-]?\s*([0-9]+(?:\.[0-9]+)?)/i],
      ["hip_region_cm", /Hip\s*Region\s*[|:=-]?\s*([0-9]+(?:\.[0-9]+)?)/i],
      ["lower_waist_region_cm", /Lower\s*Waist\s*Region\s*[|:=-]?\s*([0-9]+(?:\.[0-9]+)?)/i],
      ["thigh_left_cm", /Thigh\s*Left\s*Region\s*[|:=-]?\s*([0-9]+(?:\.[0-9]+)?)/i],
      ["thigh_right_cm", /Thigh\s*Right\s*Region\s*[|:=-]?\s*([0-9]+(?:\.[0-9]+)?)/i],
      ["upper_arm_left_cm", /Upper\s*Arm\s*Left\s*Region\s*[|:=-]?\s*([0-9]+(?:\.[0-9]+)?)/i],
      ["upper_arm_right_cm", /Upper\s*Arm\s*Right\s*Region\s*[|:=-]?\s*([0-9]+(?:\.[0-9]+)?)/i],
      ["upper_waist_region_cm", /Upper\s*Waist\s*Region\s*[|:=-]?\s*([0-9]+(?:\.[0-9]+)?)/i]
    ];
    const rawMeasures = {};
    bodyMeasures.forEach(([key, pattern]) => {
      // Prefer the final labeled value in the PDF. Some device pages list all
      // region labels first and their values afterward, while the later
      // Measurement Snapshots page pairs each label with its own value.
      const globalPattern = new RegExp(pattern.source, pattern.flags + "g");
      const values = numericCandidates(text, globalPattern);
      if (!values.length) return;
      // Keep every distinct value found across report pages. Never silently
      // replace one page's value with another or average conflicting readings.
      const uniqueValues = [...new Set(values)];
      const spread = Math.max(...uniqueValues) - Math.min(...uniqueValues);
      const hasConflict = spread > 0.01;
      const status = hasConflict
        ? "conflict_review"
        : uniqueValues.length > 1 ? "consistent_rounding" : "needs_coach_review";
      const value = values[0];
      rawMeasures[key] = {
        ...metric(value, "raw_reported_unit", "3D Scan and Measurements", status),
        raw_value: value,
        ...(uniqueValues.length > 1 ? { alternatives: uniqueValues } : {}),
        measurement_kind: "multi_point_or_region_reported_value",
        interpretation: "تفسیر دقیق عدد تا تأیید ساختار اسکن و تعریف خروجی دستگاه مشخص نیست؛ آن را محیط یک مقطع فرض نکنید."
      };
      if (hasConflict) {
        const regionLabels = {
          calf_left_cm: "ساق چپ", calf_right_cm: "ساق راست",
          forearm_left_cm: "ساعد چپ", forearm_right_cm: "ساعد راست",
          thigh_left_cm: "ران چپ", thigh_right_cm: "ران راست",
          upper_arm_left_cm: "بازوی چپ", upper_arm_right_cm: "بازوی راست",
          chest_region_cm: "ناحیه سینه", hip_region_cm: "ناحیه باسن",
          lower_waist_region_cm: "ناحیه کمر پایین", upper_waist_region_cm: "ناحیه کمر بالا"
        };
        flags.push("برای " + (regionLabels[key] || key) + " در صفحات مختلف PDF مقادیر متفاوت ثبت شده است؛ همه مقدارها بدون میانگین‌گیری حفظ شده‌اند و باید با صفحات اصلی تطبیق داده شوند.");
      }
    });
    // Compare left/right values only as a report-quality check. The device's
    // "Region" values are not yet confirmed to be circumference in cm, so the
    // threshold is expressed in raw reported units and must not be interpreted
    // as a clinical or body-measurement diagnosis.
    const bilateralPairs = [
      ["calf_left_cm", "calf_right_cm", "ساق"],
      ["forearm_left_cm", "forearm_right_cm", "ساعد"],
      ["thigh_left_cm", "thigh_right_cm", "ران"],
      ["upper_arm_left_cm", "upper_arm_right_cm", "بازو"]
    ];
    const bilateralComparisons = [];
    bilateralPairs.forEach(([leftKey, rightKey, label]) => {
      const leftItem = rawMeasures[leftKey];
      const rightItem = rawMeasures[rightKey];
      if (!leftItem || !rightItem) return;
      if (["conflict_review", "invalid_range"].includes(leftItem.status) ||
          ["conflict_review", "invalid_range"].includes(rightItem.status)) {
        flags.push("مقایسه دو سمت " + label + " انجام نشد؛ دست‌کم یکی از مقادیر در صفحات مختلف PDF ناسازگار است.");
        return;
      }
      const left = leftItem.raw_value;
      const right = rightItem.raw_value;
      if (left == null || right == null) return;
      const difference = Math.abs(left - right);
      const average = (Math.abs(left) + Math.abs(right)) / 2;
      const comparison = {
        region: label, left_value: left, right_value: right,
        absolute_difference: Number(difference.toFixed(3)),
        relative_difference_percent: average ? Number((difference / average * 100).toFixed(2)) : null,
        status: difference > 2 ? "coach_review_asymmetry" : "within_initial_review_threshold",
        interpretation: "مقایسه صرفاً برای کنترل کیفیت گزارش است؛ واحد و معنای دقیق مقادیر ناحیه‌ای هنوز باید با دستگاه تأیید شود."
      };
      bilateralComparisons.push(comparison);
      if (difference > 2) {
        flags.push("اختلاف گزارش‌شده بین " + label + " چپ و راست بیش از ۲ واحد است؛ احتمال خطای ثبت/حرکت/نور یا تفاوت واقعی وجود دارد و باید با اسکن و مشاهده مربی بررسی شود.");
      }
    });
    if (bilateralComparisons.length) out.bilateral_measurement_review = bilateralComparisons;

    // A missing side is never converted to zero or inferred from its opposite side.
    const hasBodyMeasurementsSection = /Body\s*Measurements\s*\(?(?:cm)?\)?/i.test(text);
    const missingMeasures = {};
    if (hasBodyMeasurementsSection && Object.keys(rawMeasures).length) {
      bilateralPairs.forEach(([leftKey, rightKey, label]) => {
        const leftPresent = Object.prototype.hasOwnProperty.call(rawMeasures, leftKey);
        const rightPresent = Object.prototype.hasOwnProperty.call(rawMeasures, rightKey);
        if (leftPresent !== rightPresent) {
          const missingKey = leftPresent ? rightKey : leftKey;
          missingMeasures[missingKey] = {
            value: null, unit: "raw_reported_unit", source: "Body Measurements / paired region not present in this PDF",
            status: "not_reported",
            interpretation: "سمت مقابل در این فایل ثبت نشده است؛ صفر یا مقدار حدسی نیست و از سمت دیگر کپی نمی‌شود."
          };
          flags.push("اندازه " + label + " در یک سمت گزارش نشده است؛ مقدار آن نباید حدس زده شود.");
        }
      });
    }
    if (hasBodyMeasurementsSection && Object.keys(rawMeasures).length) {
      ["forearm_left_cm", "forearm_right_cm"].forEach(key => {
        if (!rawMeasures[key]) missingMeasures[key] = {
          value: null, unit: "raw_reported_unit", source: "Body Measurements / expected region not present in this PDF",
          status: "not_reported",
          interpretation: "در این فایل ثبت نشده است؛ صفر یا مقدار حدسی نیست و از اسکن دیگری منتقل نشده است."
        };
      });
      if (Object.keys(missingMeasures).length) {
        out.missing_measurements = missingMeasures;
        out.measurement_coverage = { status: "partial", missing: Object.keys(missingMeasures) };
        flags.push("برخی اندازه‌های مورد انتظار در این گزارش ثبت نشده‌اند؛ مقادیر غایب صفر یا حدس نیستند و سایر شاخص‌ها مستقل قابل بررسی‌اند.");
      }
    }
    if (Object.keys(rawMeasures).length) {
      out.raw_body_measurements = rawMeasures;
      flags.push("اندازه‌های اندام عیناً مطابق گزارش دستگاه حفظ شده‌اند؛ به‌دلیل احتمال چندنقطه‌ای یا ناحیه‌ای بودن، به‌عنوان محیط یک مقطع تفسیر نشوند تا تعریف خروجی دستگاه تأیید شود.");
    }

    const checks = [
      ["height_cm", 100, 230], ["weight_kg", 25, 350], ["body_fat_percent", 2, 65],
      ["bmi", 10, 70], ["waist_hip_ratio", 0.3, 1.5], ["resting_metabolic_rate_kcal", 500, 4000],
      ["daily_energy_expenditure_kcal", 700, 7000], ["fat_mass_kg", 1, 250],
      ["lean_mass_kg", 10, 250], ["waist_circumference_cm", 30, 200],
      ["comparison_percentile", 0, 100], ["body_fat_rank_marker", 0, 100]
    ];
    checks.forEach(([key, min, max]) => {
      const item = out[key];
      if (item && (item.value < min || item.value > max)) {
        item.status = "invalid_range";
        flags.push(key + ": خارج از محدوده کنترل اولیه");
      } else if (item && item.status === "needs_coach_review") {
        // Passing a broad plausibility check is not a medical validation.
        item.status = "within_initial_range_needs_coach_review";
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
    const ocrPages = [];
    const scanPages = [];
    let ocrWorker = null;
    try {
      for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
        const page = await pdf.getPage(pageNo);
        const content = await page.getTextContent();
        let pageText = content.items.map(item => item.str || "").join(" ");
        // Some reports mix selectable text with rasterized measurement labels/charts.
        // OCR only when the page is short OR it looks like a measurement page whose
        // key region labels are missing from the selectable text layer.
        const normalizedPageText = normalize(pageText);
        const hasMeasurementContext = /Body\s*Measurements|3D\s*Scan|\bRegion\b/i.test(normalizedPageText);
        const hasRecognizableRegionMeasurement = /(?:Calf|Forearm|Thigh|Upper\s*Arm|Chest|Hip|Lower\s*Waist|Upper\s*Waist)\s*(?:Left|Right)?\s*Region\s*[:=-]?\s*[0-9]/i.test(normalizedPageText);
        const hasCalorieLabels = /Resting\s*Metabolic\s*Rate|\bRMR\b|Caloric\s*Expenditure/i.test(normalizedPageText);
        const hasCalorieValues = /[0-9]{3,4}\s*(?:kcal|calories?)\s*\/?\s*day/i.test(normalizedPageText);
        const needsTargetedOcr = normalizedPageText.length < 100 ||
          (hasMeasurementContext && !hasRecognizableRegionMeasurement) ||
          (hasCalorieLabels && !hasCalorieValues);
        if (needsTargetedOcr) {
          if (!ocrWorker) {
            const Tesseract = await loadTesseract();
            ocrWorker = await Tesseract.createWorker("eng");
          }
          const viewport = page.getViewport({ scale: 2.2 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d", { willReadFrequently: true });
          await page.render({ canvasContext: context, viewport }).promise;
          const recognized = await ocrWorker.recognize(canvas);
          pageText += " " + (recognized?.data?.text || "");
          ocrPages.push(pageNo);
          canvas.width = 0;
          canvas.height = 0;
        }
        pages.push(pageText);
        // Preserve real scan pages from the source PDF. These are page renders,
        // not generated silhouettes or substituted stock imagery.
        const scanText = normalize(pageText);
        const hasScanVisualCue = /Silhouette|3D\s*Scan|Front\s*View|Side\s*View/i.test(scanText);
        if (hasScanVisualCue && scanPages.length < 4) {
          const scanViewport = page.getViewport({ scale: 1.5 });
          const scanCanvas = document.createElement("canvas");
          scanCanvas.width = Math.ceil(scanViewport.width);
          scanCanvas.height = Math.ceil(scanViewport.height);
          const scanContext = scanCanvas.getContext("2d");
          await page.render({ canvasContext: scanContext, viewport: scanViewport }).promise;
          scanPages.push({
            page_number: pageNo,
            image_data_url: scanCanvas.toDataURL("image/png"),
            source: "original_pdf_page"
          });
          scanCanvas.width = 0;
          scanCanvas.height = 0;
        }
      }
    } finally {
      if (ocrWorker) await ocrWorker.terminate();
    }
    const result = extractMetrics(pages.join(" "));
    result.page_count = pdf.numPages;
    result.ocr_pages = ocrPages;
    result.scan_pages = scanPages;
    result.scan_page_numbers = scanPages.map(item => item.page_number);
    if (!scanPages.length) {
      result.flags.push("صفحه تصویری قابل‌شناسایی از اسکن در PDF پیدا نشد؛ گزارش بدون تصویر اسکن نباید برای تحویل نهایی تأیید شود.");
    }
    result.engine = "pdfjs-" + PDFJS_VERSION + (ocrPages.length ? " + tesseract.js-5" : "");
    result.review_required = true;
    return result;
  }

  global.TopGenesisPdfParser = Object.freeze({ extract, extractMetrics });
})(window);
