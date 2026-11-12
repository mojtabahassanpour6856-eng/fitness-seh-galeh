/* Top Genesis CSV + ZIP bundle reader.
 * Coach-side only: parses locally in the browser, never uploads or persists source files.
 * CSV is the authoritative source for numeric measurements; PDF remains the source for report pages/charts.
 */
(function (global) {
  "use strict";
  const JSZIP_URL = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
  let jszipPromise;

  function loadJsZip() {
    if (global.JSZip) return Promise.resolve(global.JSZip);
    if (jszipPromise) return jszipPromise;
    jszipPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = JSZIP_URL;
      script.async = true;
      script.onload = () => global.JSZip
        ? resolve(global.JSZip)
        : reject(new Error("کتابخانه بازکردن ZIP در دسترس نیست."));
      script.onerror = () => reject(new Error("بارگذاری ابزار بازکردن ZIP ناموفق بود."));
      document.head.appendChild(script);
    });
    return jszipPromise;
  }

  function parseRows(text) {
    const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/);
    const rows = [];
    for (const line of lines) {
      if (!line.trim() || /^sep\s*=/i.test(line.trim())) continue;
      const row = [];
      let value = "", quoted = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (quoted && line[i + 1] === '"') { value += '"'; i++; }
          else quoted = !quoted;
        } else if (ch === "," && !quoted) {
          row.push(value.trim()); value = "";
        } else value += ch;
      }
      row.push(value.trim());
      rows.push(row);
    }
    return rows;
  }

  function numeric(value) {
    if (value == null || String(value).trim() === "") return null;
    const n = Number.parseFloat(String(value).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : null;
  }

  function parseCsv(text) {
    const rows = parseRows(text);
    const profile = {};
    const sections = {};
    let section = "metadata";
    let tableHeader = false;
    const sectionNames = new Set([
      "FITNESS & HEALTH", "CIRCUMFERENCES & LENGTHS", "AREAS & VOLUMES", "SHAPE RATIOS"
    ]);
    const metadataKeys = new Set([
      "Company Name", "DefaultID", "Customer Name", "Customer First Name",
      "Customer Last Name", "Customer Gender", "Customer Age", "Customer Height",
      "Customer Weight", "Capture Time", "Capture Method", "Sensor Type",
      "Model Type", "Registration System"
    ]);

    for (const row of rows) {
      const first = (row[0] || "").trim();
      if (sectionNames.has(first)) {
        section = first; sections[section] = {}; tableHeader = false; continue;
      }
      if (first.toLowerCase() === "measurement name" && (row[1] || "").toLowerCase() === "value") {
        tableHeader = true; sections[section] ||= {}; continue;
      }
      if (metadataKeys.has(first) && row.length > 1) {
        // Deliberately exclude Customer Email and all other direct identifiers.
        profile[first] = row.slice(1).join(",").trim();
        continue;
      }
      if (tableHeader && row.length >= 2) {
        const label = first;
        const value = numeric(row[1]);
        if (label && value != null) {
          sections[section][label] = { value, unit: row[2] || null, source: "Top Genesis CSV", status: "needs_coach_review" };
        }
      }
    }

    const get = (sectionName, label) => sections[sectionName]?.[label] || null;
    const metrics = {
      body_fat_percent: get("FITNESS & HEALTH", "Body Fat %"),
      body_density_g_cm3: get("FITNESS & HEALTH", "Body Density"),
      bmi: get("FITNESS & HEALTH", "Body Mass Index (BMI)"),
      height_cm: profile["Customer Height"] ? { value: numeric(profile["Customer Height"]), unit: "cm", source: "Top Genesis CSV profile", status: "needs_coach_review" } : null,
      weight_kg: profile["Customer Weight"] ? { value: numeric(profile["Customer Weight"]), unit: "kg", source: "Top Genesis CSV profile", status: "needs_coach_review" } : null,
      waist_hip_ratio: get("SHAPE RATIOS", "Waist-Hip Ratio (WHO)")
    };
    const measurements = sections["CIRCUMFERENCES & LENGTHS"] || {};
    const areasVolumes = sections["AREAS & VOLUMES"] || {};
    const ratios = sections["SHAPE RATIOS"] || {};
    const flags = [];
    if (Object.keys(measurements).length !== 21) {
      flags.push("تعداد اندازه‌های محیطی/طولی CSV برابر ۲۱ مورد نیست؛ موارد موجود حفظ شده‌اند و موارد غایب حدس زده نمی‌شوند.");
    }
    if (metrics.height_cm && metrics.weight_kg && metrics.bmi) {
      const calculated = metrics.weight_kg.value / Math.pow(metrics.height_cm.value / 100, 2);
      if (Math.abs(calculated - metrics.bmi.value) > 0.7) flags.push("BMI محاسبه‌شده از قد و وزن با مقدار CSV اختلاف دارد؛ هر دو برای بررسی حفظ شوند.");
    }
    return {
      profile: {
        gender: profile["Customer Gender"] || null,
        age: numeric(profile["Customer Age"]),
        height_cm: metrics.height_cm,
        weight_kg: metrics.weight_kg,
        capture_time: profile["Capture Time"] || null,
        capture_method: profile["Capture Method"] || null,
        sensor_type: profile["Sensor Type"] || null,
        model_type: profile["Model Type"] || null
      },
      metrics,
      body_measurements_cm: measurements,
      areas_and_volumes: areasVolumes,
      shape_ratios: ratios,
      flags,
      source: "Top Genesis CSV",
      pii_extracted: false,
      review_required: true
    };
  }

  function readBlobAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("خواندن یکی از تصاویر اسکن ناموفق بود."));
      reader.readAsDataURL(blob);
    });
  }

  async function extractBundle(zipFile) {
    if (!(zipFile instanceof Blob) || !/\.zip$/i.test(zipFile.name || "")) {
      throw new Error("فقط فایل ZIP خروجی تاپ‌جنسیس قابل بررسی است.");
    }
    if (!zipFile.size || zipFile.size > 20 * 1024 * 1024) throw new Error("حجم ZIP باید حداکثر ۲۰ مگابایت باشد.");
    const JSZip = await loadJsZip();
    const archive = await JSZip.loadAsync(zipFile);
    const entries = Object.values(archive.files).filter(item => !item.dir);
    const csvEntry = entries.find(item => /\.csv$/i.test(item.name));
    if (!csvEntry) throw new Error("فایل CSV در ZIP پیدا نشد.");
    const csvText = await csvEntry.async("string");
    const parsed = parseCsv(csvText);
    const imageRules = [
      ["body_front", ["front", "anterior", "fore"], ["body", "scan", "view"], "نمای روبه‌رو"],
      ["body_back", ["back", "posterior", "rear"], ["body", "scan", "view"], "نمای پشت"],
      ["body_left", ["left"], ["body", "scan", "view"], "نمای سمت چپ"],
      ["body_right", ["right"], ["body", "scan", "view"], "نمای سمت راست"],
      ["silhouette_front", ["front", "anterior", "fore"], ["silhouette", "line", "outline"], "نمای خطی روبه‌رو"],
      ["silhouette_left", ["left", "profile", "side"], ["silhouette", "line", "outline", "profile"], "نمای خطی پهلو"]
    ];
    const imageEntries = entries.filter(item => /\\.(jpe?g|png)$/i.test(item.name));
    const usedImageNames = new Set();
    const findImage = (directionTokens, typeTokens, excludeTypeTokens) => {
      const candidates = imageEntries.filter(item => {
        const name = item.name.toLowerCase().replace(/[^a-z0-9]+/g, " ");
        const hasDirection = directionTokens.some(token => name.includes(token));
        const hasType = typeTokens.some(token => name.includes(token));
        const hasExcluded = (excludeTypeTokens || []).some(token => name.includes(token));
        const bodyFallback = typeTokens.includes("body") && !hasExcluded;
        return hasDirection && (hasType || bodyFallback) && !hasExcluded && !usedImageNames.has(item.name);
      });
      return candidates[0] || null;
    };
    const scans = {};
    for (const [key, directionTokens, typeTokens, label] of imageRules) {
      const isSilhouette = key.startsWith("silhouette");
      const entry = findImage(directionTokens, typeTokens, isSilhouette ? ["body photo", "body image"] : ["silhouette", "outline", "wireframe"]);
      if (!entry) continue;
      usedImageNames.add(entry.name);
      const blob = await entry.async("blob");
      if (!blob.size || blob.size > 8 * 1024 * 1024) {
        parsed.flags.push("تصویر " + label + " از محدوده حجم مجاز خارج بود و وارد گزارش نشد.");
        continue;
      }
      scans[key] = { label, image_data_url: await readBlobAsDataUrl(blob), source: "original_top_genesis_zip" };
    }
    parsed.scan_images = scans;
    parsed.scan_image_count = Object.keys(scans).length;
    parsed.expected_scan_image_count = imageRules.length;
    if (parsed.scan_image_count !== imageRules.length) {
      parsed.flags.push("همه شش تصویر استاندارد اسکن در ZIP پیدا نشدند؛ تصاویر غایب ساخته یا جایگزین نمی‌شوند.");
    }
    parsed.bundle_file_count = entries.length;
    parsed.review_required = true;
    return parsed;
  }

  global.TopGenesisCsvParser = Object.freeze({ parseCsv, extractBundle });
})(window);
