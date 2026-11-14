import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const hardStop = setTimeout(() => { console.error('[smoke] hard stop after 8 minutes'); process.exit(124); }, 8 * 60 * 1000);
hardStop.unref();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
  const file = path.resolve(root, "." + pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end("Not found"); return;
  }
  res.writeHead(200, { "content-type": mime[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
console.log('[smoke] launching Chromium');
const browser = await chromium.launch({ headless: true });
try {
  // Draw a synthetic report sentence into a raster image so Tesseract must
  // recognize actual characters, not merely initialize on a blank page.
  const imagePage = await browser.newPage();
  const imageDataUrl = await imagePage.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1400;
    canvas.height = 300;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000000";
    ctx.font = "bold 76px Arial";
    ctx.fillText("Your waist measures 69.87 cm", 45, 180);
    return canvas.toDataURL("image/png");
  });
  const regionImageDataUrl = await imagePage.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1800;
    canvas.height = 300;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000000";
    ctx.font = "bold 72px Arial";
    ctx.fillText("Forearm Right Region 123.456", 35, 180);
    return canvas.toDataURL("image/png");
  });
  const silhouetteImageDataUrl = await imagePage.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 600; canvas.height = 700;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 600, 700);
    ctx.strokeStyle = "#27965a"; ctx.lineWidth = 10; ctx.lineCap = "round";
    ctx.beginPath(); ctx.ellipse(300, 85, 48, 58, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(300,145);ctx.lineTo(300,390);
    ctx.moveTo(300,190);ctx.lineTo(170,300);
    ctx.moveTo(300,190);ctx.lineTo(430,300);
    ctx.moveTo(300,390);ctx.lineTo(205,650);
    ctx.moveTo(300,390);ctx.lineTo(395,650);
    ctx.stroke();
    return canvas.toDataURL("image/png");
  });
  await imagePage.close();

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const textPage = pdfDoc.addPage([612, 792]);
  textPage.drawText(
    "Height & Weight 161 cm & 57 kg Body Fat 24.5% BMI 22.0 Waist-to-Hip Ratio 0.734 RMR 1352 calories/day Body Measurements (cm) Calf Left Region 157.69 Calf Right Region 162.75 Hip Region 680.13. This is a synthetic browser test fixture with a profile summary and enough selectable text to bypass OCR on this page.",
    { x: 40, y: 700, size: 10, font, color: rgb(0, 0, 0), maxWidth: 530, lineHeight: 16 }
  );
  const ocrPage = pdfDoc.addPage([612, 792]);
  const pngBytes = Buffer.from(imageDataUrl.split(",")[1], "base64");
  const ocrImage = await pdfDoc.embedPng(pngBytes);
  ocrPage.drawImage(ocrImage, { x: 40, y: 400, width: 530, height: 114 });

  // Semi-text page: selectable body-measurement heading and enough prose to
  // exceed the old 100-character cutoff, while the actual region value is raster.
  const mixedPage = pdfDoc.addPage([612, 792]);
  mixedPage.drawText(
    "Body Measurements (cm). This page includes explanatory selectable text about the scan report, but the measurement labels and values are embedded in the chart image rather than the PDF text layer.",
    { x: 40, y: 700, size: 10, font, color: rgb(0, 0, 0), maxWidth: 530, lineHeight: 16 }
  );
  const regionPngBytes = Buffer.from(regionImageDataUrl.split(",")[1], "base64");
  const regionImage = await pdfDoc.embedPng(regionPngBytes);
  mixedPage.drawImage(regionImage, { x: 40, y: 400, width: 530, height: 88 });
  const scanPage = pdfDoc.addPage([612, 792]);
  scanPage.drawText(
    "Silhouette Profile 3D Scan. This synthetic fixture includes a front-facing body outline and a side-profile outline to verify that only original scan pages are selected for the final report.",
    { x: 40, y: 700, size: 10, font, color: rgb(0, 0, 0), maxWidth: 530, lineHeight: 16 }
  );
  const silhouettePngBytes = Buffer.from(silhouetteImageDataUrl.split(",")[1], "base64");
  const silhouetteImage = await pdfDoc.embedPng(silhouettePngBytes);
  scanPage.drawImage(silhouetteImage, { x: 185, y: 160, width: 240, height: 520 });
  const pdfBytes = await pdfDoc.save();

  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(30000);
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  console.log('[smoke] opening analyzer fixture');
  await page.goto(`http://127.0.0.1:${address.port}/top-genesis-pdf-test.html`);
  await page.addScriptTag({ path: path.join(root, "top-genesis-csv-parser.js") });
  assert.equal(await page.locator("#topGenesisZip").count(), 1,
    "The coach analysis page must expose an optional ZIP bundle input.");
  assert.match(await page.locator("#topGenesisZip").getAttribute("accept"), /zip/i,
    "The ZIP input must only advertise ZIP bundle files.");
  const csvFixture = `sep=,
Company Name,DefaultID
Customer Name,نمونه ناشناس
Customer Gender,Male
Customer Age,37
Customer Height,185 cm
Customer Weight,83 kg
Customer Email,private@example.com
Capture Time,11/11/2026 5:49:10 AM
Capture Method,Booth with turntable
Sensor Type,kinect v2
Model Type,Body
FITNESS & HEALTH
measurement name,value,units
Body Fat %,19.0,%
Body Density,1.159838,g/cm^3
Body Mass Index (BMI),24.2
CIRCUMFERENCES & LENGTHS
measurement name,value,units
Bicep Left Lower,28.025,cm
Bicep Right Lower,28.046,cm
Bicep Left,31.670,cm
Bicep Right,31.460,cm
Calf Left,32.380,cm
Calf Right,32.826,cm
Chest,98.990,cm
Forearm Left,27.983,cm
Forearm Right,28.056,cm
High Hip,94.258,cm
Hip,97.948,cm
Neck,40.273,cm
Thigh Left Lower,40.719,cm
Thigh Right Lower,40.905,cm
Mid-Thigh Left,52.426,cm
Mid-Thigh Right,52.314,cm
Thigh Left Upper,60.007,cm
Thigh Right Upper,58.848,cm
Waist (Abdominal),87.050,cm
Waist (Lower),91.346,cm
Waist (Narrowest),85.111,cm
AREAS & VOLUMES
measurement name,value,units
Left Arm Surface Area,1444.9,cm^2
Right Arm Surface Area,1453.3,cm^2
Body Surface Area,17321.8,cm^2
Head Surface Area,1599.1,cm^2
Left Leg Surface Area,2314.5,cm^2
Right Leg Surface Area,2329.4,cm^2
Torso Surface Area,6758.6,cm^2
Left Arm Volume,2653,cm^3
Right Arm Volume,2752,cm^3
Body Volume,71562,cm^3
Head Volume,5441,cm^3
Left Leg Volume,5972,cm^3
Right Leg Volume,5993,cm^3
Torso Volume,44568,cm^3
SHAPE RATIOS
measurement name,value,units
Bust-Hip Ratio,1.011
Bust-Waist Ratio,1.084
Waist-Hip Ratio (WHO),0.889
`;
  const csvResult = await page.evaluate(text => window.TopGenesisCsvParser.parseCsv(text), csvFixture);
  assert.equal(csvResult.profile.age, 37);
  assert.equal(csvResult.profile.height_cm.value, 185);
  assert.equal(csvResult.profile.weight_kg.value, 83);
  assert.equal(csvResult.metrics.body_fat_percent.value, 19);
  assert.equal(csvResult.metrics.bmi.value, 24.2);
  assert.equal(csvResult.metrics.waist_hip_ratio.value, 0.889);
  assert.equal(Object.keys(csvResult.body_measurements_cm).length, 21,
    "The real CSV layout must yield all 21 circumference/length measurements.");
  assert.equal(csvResult.body_measurements_cm["Calf Left"].value, 32.38,
    "CSV decimal precision must be preserved; CSV is the source of truth for measurements.");
  assert.equal(csvResult.body_measurements_cm["Calf Right"].value, 32.826);
  assert.equal(csvResult.areas_and_volumes["Body Volume"].value, 71562);
  assert.equal(csvResult.areas_and_volumes["Torso Surface Area"].value, 6758.6);
  assert.equal(csvResult.shape_ratios["Waist-Hip Ratio (WHO)"].value, 0.889);
  assert.equal(JSON.stringify(csvResult).includes("private@example.com"), false,
    "Customer email must not be extracted or exposed by the CSV parser.");
  assert.equal(csvResult.review_required, true);
  console.log('[smoke] loading JSZip CDN');
  await page.addScriptTag({ url: "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js" });
  console.log('[smoke] JSZip loaded');
  // Regression fixture mirrors the exact filename prefix and member names in the
  // user's uploaded archive. Real body photos are deliberately not committed.
  const zipResult = await page.evaluate(async csv => {
    const zip = new window.JSZip();
    zip.file("جواد کربلایی 11-11-2026 01_49_10 pm utc.csv", csv);
    const canvas = document.createElement("canvas");
    canvas.width = 706; canvas.height = 1080;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 706, 1080);
    ctx.fillStyle = "#333"; ctx.font = "32px Arial"; ctx.fillText("ANONYMIZED TEST IMAGE", 30, 80);
    const jpeg = await (await fetch(canvas.toDataURL("image/jpeg", .82))).blob();
    const names = [
      "جواد کربلایی 11-11-2026 01_49_10 pm utc_body_Front.jpg",
      "جواد کربلایی 11-11-2026 01_49_10 pm utc_body_Back.jpg",
      "جواد کربلایی 11-11-2026 01_49_10 pm utc_body_Left.jpg",
      "جواد کربلایی 11-11-2026 01_49_10 pm utc_body_Right.jpg",
      "جواد کربلایی 11-11-2026 01_49_10 pm utc_silhouette_Left.jpg",
      "جواد کربلایی 11-11-2026 01_49_10 pm utc_silhouette_Front.jpg"
    ];
    for (const name of names) zip.file(name, jpeg);
    const blob = await zip.generateAsync({type:"blob"});
    const file = new File([blob], "top-genesis-real-name-pattern.zip", {type:"application/zip"});
    return window.TopGenesisCsvParser.extractBundle(file);
  }, csvFixture);
  assert.equal(zipResult.profile.age, 37);
  assert.equal(zipResult.profile.height_cm.value, 185);
  assert.equal(zipResult.profile.weight_kg.value, 83);
  assert.equal(zipResult.metrics.body_fat_percent.value, 19);
  assert.equal(zipResult.metrics.bmi.value, 24.2);
  assert.equal(zipResult.body_measurements_cm["Calf Left"].value, 32.38,
    "CSV calf values must remain authoritative when they differ from the PDF.");
  assert.equal(zipResult.body_measurements_cm["Calf Right"].value, 32.826);
  assert.equal(Object.keys(zipResult.body_measurements_cm).length, 21);
  assert.equal(zipResult.areas_and_volumes["Body Volume"].value, 71562);
  assert.equal(zipResult.scan_image_count, 6,
    "The exact real-world filename prefix must still identify all six scan views.");
  assert.deepEqual(Object.keys(zipResult.scan_images).sort(),
    ["body_back","body_front","body_left","body_right","silhouette_front","silhouette_left"].sort());
  const realNameImageSizes = await page.evaluate(async scans => {
    const entries = await Promise.all(Object.entries(scans).map(([key,item]) => new Promise((resolve,reject) => {
      const img = new Image(); img.onload=()=>resolve([key,img.naturalWidth,img.naturalHeight]); img.onerror=reject; img.src=item.image_data_url;
    })));
    return Object.fromEntries(entries.map(([key,w,h])=>[key,[w,h]]));
  }, zipResult.scan_images);
  assert.ok(Object.values(realNameImageSizes).every(([w,h])=>w===706&&h===1080),
    "All six extracted images must retain the source scan dimensions.");


  console.log('[smoke] preparing synthetic PDF');
  await page.locator("#pdfFile").setInputFiles({
    name: "synthetic-top-genesis-fixture.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(pdfBytes)
  });
  console.log('[smoke] starting PDF extraction');
  await page.locator("#run").click();
  console.log('[smoke] waiting for extraction status');
  await page.waitForFunction(() => {
    const text = document.querySelector("#status")?.textContent || "";
    return text.includes("استخراج تمام شد") || text.startsWith("خطا:");
  }, null, { timeout: 180000 });

  console.log('[smoke] extraction status reached');
  const status = await page.locator("#status").innerText();
  assert.match(status, /استخراج تمام شد/, `Parser did not complete: ${status}`);
  assert.equal(await page.locator("#analysisDate").count(), 1,
    "The analysis date must be explicitly selectable for trainee progress history.");
  assert.equal(await page.locator("#sendToTrainee").count(), 1,
    "A separate coach send action must be present after the report is rendered.");
  assert.equal(await page.locator("#sendToTrainee").isDisabled(), true,
    "The report must not be sent before manual coach approval.");
  assert.match(await page.locator("#sendToTrainee").innerText(), /ارسال به پنل پیشرفت شاگرد/);
  const pageInfo = await page.locator("#result").innerText();
  assert.doesNotMatch(pageInfo, /FITNESS SEH GALEH|Top Genesis|BMI|BMR|OCR|PDF|ZIP|CSV|PNG/,
    "The generated report shown to the coach must use Persian labels rather than English abbreviations.");
  assert.match(pageInfo, /تعداد صفحات: 4/);
  assert.match(pageInfo, /صفحات تشخیص متن: 2، 3/);
  assert.match(pageInfo, /161/);
  assert.match(pageInfo, /57/);
  assert.match(pageInfo, /مقایسه دو سمت بدن/,
    "Bilateral region comparison must be rendered in the Persian results.");
  assert.match(pageInfo, /ساق چپ/,
    "Region names must be shown in Persian rather than internal keys.");
  assert.match(pageInfo, /اختلاف عددی خام/,
    "Unvalidated Region units must be presented as uninterpreted raw differences.");
  assert.match(pageInfo, /24.5/);
  const direct = await page.evaluate(() => window.TopGenesisPdfParser.extractMetrics(
    "Body Measurements (cm) Calf Left Region 157.686 Calf Right Region 162.757 Hip Region 680.131"
  ));
  const colonSeparated = await page.evaluate(() => window.TopGenesisPdfParser.extractMetrics(
    "Body Measurements (cm) Calf Left Region: 157.686 Hip Region: 680.131 Waist-to-Hip Ratio: 0.734"
  ));
  assert.equal(colonSeparated.metrics.raw_body_measurements.calf_left_cm.raw_value, 157.686,
    "Region values with a colon separator must be extracted.");
  assert.equal(colonSeparated.metrics.raw_body_measurements.hip_region_cm.raw_value, 680.131,
    "Hip region values with a colon separator must be extracted.");
  assert.equal(colonSeparated.metrics.waist_hip_ratio_detailed.value, 0.734,
    "Detailed WHR must support a colon separator.");
  assert.equal(direct.metrics.raw_body_measurements.calf_left_cm.raw_value, 157.686,
    "Calf raw value must retain its decimal precision.");
  assert.equal(direct.metrics.raw_body_measurements.calf_right_cm.raw_value, 162.757,
    "Opposite-side calf raw value must retain its decimal precision.");
  assert.equal(direct.metrics.bilateral_measurement_review[0].status, "raw_difference_needs_unit_validation",
    "A left/right raw difference must not be classified as asymmetry before unit semantics are validated.");
  assert.equal(direct.metrics.bilateral_measurement_review[0].absolute_difference, 5.071,
    "The bilateral difference must be calculated without losing decimal precision.");
  assert.equal(direct.metrics.raw_body_measurements.hip_region_cm.raw_value, 680.131,
    "Hip raw value must retain its decimal precision.");
  assert.equal(direct.metrics.missing_measurements.forearm_left_cm.status, "not_reported",
    "Absent forearm must be represented as not_reported, not zero.");
  assert.equal(direct.metrics.missing_measurements.forearm_right_cm.status, "not_reported",
    "Both absent forearms must remain not_reported.");
  assert.equal(direct.metrics.measurement_coverage.status, "partial");
  // Regression fixture built only from values already extracted from the user's earlier real report.
  // It is not a fresh OCR run on the original PDF.
  const priorReport = await page.evaluate(() => window.TopGenesisPdfParser.extractMetrics(
    "Body Measurements (cm) Calf Left Region 157.686 Calf Right Region 162.757 Chest Region 404.906 Hip Region 680.131 Lower Waist Region 490.499"
  ));
  const priorRegions = priorReport.metrics.raw_body_measurements;
  assert.equal(priorRegions.calf_left_cm.raw_value, 157.686);
  assert.equal(priorRegions.calf_right_cm.raw_value, 162.757);
  assert.equal(priorRegions.chest_region_cm.raw_value, 404.906);
  assert.equal(priorRegions.hip_region_cm.raw_value, 680.131);
  assert.equal(priorRegions.lower_waist_region_cm.raw_value, 490.499);
  for (const key of Object.keys(priorRegions)) {
    assert.equal(priorRegions[key].unit, "raw_reported_unit",
      "Region values must not be labeled as confirmed centimeters before device semantics are verified.");
    assert.equal(priorRegions[key].status, "needs_coach_review");
    assert.equal(priorRegions[key].source, "3D Scan and Measurements");
  }
  const oneSided = await page.evaluate(() => window.TopGenesisPdfParser.extractMetrics(
    "Body Measurements (cm) Calf Left Region 157.686 Hip Region 680.131"
  ));
  assert.equal(oneSided.metrics.missing_measurements.calf_right_cm.status, "not_reported",
    "A missing paired side must be explicitly marked not_reported.");
  assert.equal(oneSided.metrics.raw_body_measurements.calf_left_cm.raw_value, 157.686,
    "The present side must remain unchanged when its paired side is absent.");
  const smallDifference = await page.evaluate(() => window.TopGenesisPdfParser.extractMetrics(
    "Body Measurements (cm) Calf Left Region 157.686 Calf Right Region 159.000"
  ));
  assert.equal(smallDifference.metrics.bilateral_measurement_review[0].status, "raw_difference_needs_unit_validation",
    "Even a small raw difference remains uninterpreted until device units are validated.");
  const valid25 = await page.evaluate(() => window.TopGenesisPdfParser.extractMetrics(
    "Body Fat 25% BMI 22.4"
  ));
  assert.equal(valid25.metrics.body_fat_percent.value, 25,
    "A legitimate body-fat value of exactly 25% must never be discarded.");
  assert.equal(valid25.metrics.body_fat_percent.status, "within_initial_range_needs_coach_review",
    "A broad range check must not be presented as medical validation.");
  const conflictingRegion = await page.evaluate(() => window.TopGenesisPdfParser.extractMetrics(
    "Body Measurements (cm) Calf Left Region 157.69 Calf Left Region 180.25 Calf Right Region 162.75"
  ));
  assert.equal(conflictingRegion.metrics.raw_body_measurements.calf_left_cm.status, "conflict_review");
  assert.deepEqual(conflictingRegion.metrics.raw_body_measurements.calf_left_cm.alternatives, [157.69, 180.25]);
  assert.equal(conflictingRegion.metrics.bilateral_measurement_review, undefined);
  const roundedRegion = await page.evaluate(() => window.TopGenesisPdfParser.extractMetrics(
    "Body Measurements (cm) Calf Left Region 157.69 Calf Left Region 157.686 Calf Right Region 162.75"
  ));
  assert.equal(roundedRegion.metrics.raw_body_measurements.calf_left_cm.status, "consistent_rounding");
  assert.deepEqual(roundedRegion.metrics.raw_body_measurements.calf_left_cm.alternatives, [157.69, 157.686]);
  const nargesKnownValues = await page.evaluate(() => window.TopGenesisPdfParser.extractMetrics(
    "Height & Weight 161 cm & 57 kg Body Fat 24.5% BMI 22.0 Waist-to-Hip Ratio 0.734 14 kg of fat mass 43 kg of lean body mass Your waist measures 69.87 cm RMR 1352 calories/day Caloric Expenditure 1623 Calories/day"
  ));
  assert.equal(nargesKnownValues.metrics.weight_kg.value, 57);
  assert.equal(nargesKnownValues.metrics.height_cm.value, 161);
  assert.equal(nargesKnownValues.metrics.body_fat_percent.value, 24.5);
  assert.equal(nargesKnownValues.metrics.bmi.value, 22);
  assert.equal(nargesKnownValues.metrics.waist_hip_ratio.value, 0.734);
  assert.equal(nargesKnownValues.metrics.fat_mass_kg.value, 14);
  assert.equal(nargesKnownValues.metrics.lean_mass_kg.value, 43);
  assert.equal(nargesKnownValues.metrics.waist_circumference_cm.value, 69.87);
  assert.equal(nargesKnownValues.metrics.resting_metabolic_rate_kcal.value, 1352);
  assert.equal(nargesKnownValues.metrics.daily_energy_expenditure_kcal.value, 1623);
  const conflictingFat = await page.evaluate(() => window.TopGenesisPdfParser.extractMetrics(
    "Body Fat 25% Body Fat 29.5% BMI 22.4"
  ));
  assert.equal(conflictingFat.metrics.body_fat_percent.value, 25,
    "The first body-fat candidate must be retained transparently.");
  assert.equal(conflictingFat.metrics.body_fat_percent.status, "conflict_review",
    "Materially different body-fat values must require review.");
  assert.deepEqual(conflictingFat.metrics.body_fat_percent.alternatives, [25, 29.5]);
  const energy = await page.evaluate(() => window.TopGenesisPdfParser.extractMetrics(
    "RMR 1352 calories/day Caloric Expenditure 2100 Calories/day"
  ));
  assert.equal(energy.metrics.resting_metabolic_rate_kcal.value, 1352,
    "RMR must be extracted only from its explicit label.");
  assert.equal(energy.metrics.daily_energy_expenditure_kcal.value, 2100,
    "Daily expenditure must not be confused with the explicit RMR value.");
  const ambiguousEnergy = await page.evaluate(() => window.TopGenesisPdfParser.extractMetrics(
    "RMR 1352 calories/day Activity target 1900 Calories/day Maintenance 2200 Calories/day"
  ));
  assert.equal(ambiguousEnergy.metrics.resting_metabolic_rate_kcal.value, 1352);
  assert.equal(ambiguousEnergy.metrics.daily_energy_expenditure_kcal, undefined,
    "A generic last Calories/day value must not be guessed as TDEE.");
  const repeatedCore = await page.evaluate(() => window.TopGenesisPdfParser.extractMetrics(
    "Height & Weight 161 cm & 57 kg Height & Weight 161.2 cm & 57.1 kg Body Fat 25% Body Fat 25.2% BMI 22.0 BMI 22.1 Waist-to-Hip Ratio 0.734 Waist-to-Hip Ratio 0.73"
  ));
  assert.equal(repeatedCore.metrics.height_cm.value, 161);
  assert.equal(repeatedCore.metrics.weight_kg.value, 57);
  assert.equal(repeatedCore.metrics.height_cm.status, "consistent_rounding");
  assert.equal(repeatedCore.metrics.body_fat_percent.value, 25);
  assert.equal(repeatedCore.metrics.body_fat_percent.status, "consistent_rounding");
  assert.equal(repeatedCore.metrics.bmi.value, 22);
  assert.equal(repeatedCore.metrics.bmi.status, "consistent_rounding");
  assert.equal(repeatedCore.metrics.waist_hip_ratio.value, 0.734);
  assert.equal(repeatedCore.metrics.waist_hip_ratio.status, "consistent_rounding");
  const separatelyLabeled = await page.evaluate(() => window.TopGenesisPdfParser.extractMetrics(
    "Height: 172 cm Weight: 68.5 kg"
  ));
  assert.equal(separatelyLabeled.metrics.height_cm.value, 172,
    "Height must also be found when reported separately.");
  assert.equal(separatelyLabeled.metrics.weight_kg.value, 68.5,
    "Weight must also be found when reported separately.");
  // Anonymized regression fixture transcribed from the user's real 13-page Top Genesis PDF.
  // It contains no name, email, or original PDF bytes; OCR-only values are represented as recognized text.
  const javadRealReport = await page.evaluate(() => window.TopGenesisPdfParser.extractMetrics(
    "Height & Weight 185 cm & 83 kg Body Fat 19.0% BMI 24.2 Waist-to-Hip Ratio 0.889 RMR 1878 calories/day Percentile 50% " +
    "Bicep Left Lower 28.02 Bicep Right Lower 28.05 Bicep Left 31.67 Bicep Right 31.46 Calf Left 32.58 Calf Right 32.74 " +
    "Chest 98.99 Forearm Left 27.98 Forearm Right 28.06 High Hip 94.26 Hip 97.95 Neck 40.27 " +
    "Thigh Left Lower 40.72 Thigh Right Lower 40.90 Mid-Thigh Left 52.43 Mid-Thigh Right 52.31 " +
    "Thigh Left Upper 60.01 Thigh Right Upper 58.85 Waist (Abdominal) 87.05 Waist (Lower) 91.35 Waist (Narrowest) 85.11 " +
    "Bicep Left Lower | 28.025 cm Bicep Right Lower | 28.046 cm Bicep Left | 31.670 cm Bicep Right | 31.460 cm " +
    "Calf Left | 32.583 cm Calf Right | 32.736 cm Chest | 98.990 cm Forearm Left | 27.983 cm Forearm Right | 28.056 cm " +
    "High Hip | 94.258 cm Hip | 97.948 cm Neck | 40.273 cm Thigh Left Lower | 40.719 cm Thigh Right Lower | 40.905 cm " +
    "Mid-Thigh Left | 52.426 cm Mid-Thigh Right | 52.314 cm Thigh Left Upper | 60.007 cm Thigh Right Upper | 58.848 cm " +
    "Waist (Abdominal) | 87.050 cm Waist (Lower) | 91.346 cm Waist (Narrowest) | 85.111 cm " +
    "16 kg of fat mass 67 kg of lean body mass Waist Circumference 91.35 cm " +
    "Resting Metabolic Rate This is how many calories you burn each day without doing any activity. 1878 Calories/day " +
    "Caloric Expenditure This is the total calories you burn each day. 2254 Calories/day " +
    "31.66 cm width 24.93 cm depth 600.67 cm? area " +
    "1.1x 1.1x More likely to suffer from Cancer More likely to suffer from Cardiovascular Disease " +
    "1.4x 1.2x More likely to suffer from Respiratory Disease More likely to suffer from All Other Diseases " +
    "0.0 19% Average Kilograms of Fat Body Fat Rank " +
    "0.00 cm Normal Change in Waist Circumference Risk Level " +
    "For example, your waist circumference of 91.35 cm makes you 1.1 times more likely to suffer from cancer."
  ));
  assert.equal(javadRealReport.metrics.height_cm.value, 185);
  assert.equal(javadRealReport.metrics.weight_kg.value, 83);
  assert.equal(javadRealReport.metrics.body_fat_percent.value, 19);
  assert.equal(javadRealReport.metrics.bmi.value, 24.2);
  assert.equal(javadRealReport.metrics.waist_hip_ratio.value, 0.889);
  assert.equal(javadRealReport.metrics.fat_mass_kg.value, 16);
  assert.equal(javadRealReport.metrics.lean_mass_kg.value, 67);
  assert.equal(javadRealReport.metrics.resting_metabolic_rate_kcal.value, 1878);
  assert.equal(javadRealReport.metrics.daily_energy_expenditure_kcal.value, 2254);
  assert.equal(javadRealReport.metrics.waist_circumference_cm.value, 91.35);
  assert.equal(javadRealReport.metrics.waist_width_cm.value, 31.66);
  assert.equal(javadRealReport.metrics.waist_depth_cm.value, 24.93);
  assert.equal(javadRealReport.metrics.waist_area_cm2.value, 600.67);
  assert.equal(javadRealReport.metrics.vendor_relative_risk_estimates.cancer.value, 1.1);
  assert.equal(javadRealReport.metrics.vendor_relative_risk_estimates.cardiovascular.value, 1.1);
  assert.equal(javadRealReport.metrics.vendor_relative_risk_estimates.respiratory.value, 1.4);
  assert.equal(javadRealReport.metrics.vendor_relative_risk_estimates.other_diseases.value, 1.2);
  assert.equal(javadRealReport.metrics.device_waist_loss_goal_cm.value, 0);
  assert.equal(javadRealReport.metrics.device_fat_loss_goal_kg.value, 0);
  assert.equal(javadRealReport.metrics.comparison_percentile.value, 50);
  const javadMeasures = javadRealReport.metrics.body_measurements_cm;
  assert.equal(Object.keys(javadMeasures).length, 21, "All 21 standard circumference measurements must be extracted.");
  assert.equal(javadMeasures.bicep_left_lower_cm.value, 28.02);
  assert.equal(javadMeasures.bicep_left_lower_cm.status, "consistent_rounding");
  assert.equal(javadMeasures.thigh_left_upper_cm.value, 60.01);
  assert.equal(javadMeasures.waist_narrowest_cm.value, 85.11);
  assert.equal(javadMeasures.waist_lower_cm.value, 91.35);
  assert.equal(javadMeasures.forearm_right_cm.value, 28.06);

  const noPii = await page.evaluate(() => window.TopGenesisPdfParser.extractMetrics(
    "Name: Example Person Email: sample@example.com Height & Weight 170 cm & 65 kg"
  ));
  assert.equal(noPii.pii_extracted, false);
  assert.equal(Object.keys(noPii.metrics).some(key => /name|email/i.test(key)), false,
    "Personal identity fields must not be exposed in extracted metrics.");
  const conflictingBmi = await page.evaluate(() => window.TopGenesisPdfParser.extractMetrics(
    "BMI 22.0 BMI 29.4"
  ));
  assert.equal(conflictingBmi.metrics.bmi.status, "conflict_review");
  assert.deepEqual(conflictingBmi.metrics.bmi.alternatives, [22, 29.4]);
  assert.match(pageInfo, /ساعد چپ.*ثبت نشده/s, "Missing forearm was not reported as missing.");
  assert.match(pageInfo, /69\.87/, "Tesseract did not recognize the synthetic waist value from the raster page.");

  assert.match(pageInfo, /123\.456/, "Targeted OCR did not recover the region value from the semi-text page.");

  console.log('[smoke] OCR and report assertions passed');
  // The coach report must use original PDF page renders, not generated imagery.
  const scanImages = page.locator(".scan-figure img");
  assert.equal(await scanImages.count(), 1,
    "Only the PDF page explicitly labeled as a body scan should be selected; measurement pages are not scan images.");
  const scanSources = await scanImages.evaluateAll(items => items.map(item => item.getAttribute("src") || ""));
  assert.ok(scanSources.every(src => src.startsWith("data:image/png;base64,")));
  assert.match(await page.locator(".scan-figure figcaption").innerText(), /صفحه 4/);
  const coverLogo = page.locator(".report-cover .cover-logo");
  assert.equal(await coverLogo.count(), 1);
  await coverLogo.evaluate(img => img.decode());
  assert.ok(await coverLogo.evaluate(img => img.naturalWidth > 0));
  assert.equal(await page.locator("[data-review]").count(), 0,
    "Quality review must be a single coach confirmation, not five separate form controls.");
  assert.equal(await page.locator("#coachApprove").isDisabled(), false,
    "The single final approval checkbox must be immediately available.");
  assert.ok((await page.locator("#trainingNotes").inputValue()).trim().length > 0,
    "A concise editable training recommendation should be prefilled.");
  assert.ok((await page.locator("#nutritionNotes").inputValue()).trim().length > 0,
    "A concise editable nutrition recommendation should be prefilled.");
  assert.equal(await page.locator("#pngReport").isDisabled(), true,
    "Report outputs must remain locked until the coach's single approval.");
  await page.locator("#coachApprove").check();
  assert.equal(await page.locator("#pngReport").isDisabled(), false);
  assert.equal(await page.locator("#shareReport").isDisabled(), false);

  // Use the real html2canvas renderer; mock only the operating-system share sheet.
  await page.addScriptTag({ url: "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js" });
  assert.equal(await page.evaluate(() => typeof window.html2canvas), "function",
    "The real PNG rendering library must load before multi-page export.");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: ({ files }) => Array.isArray(files) && files.length > 1
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async ({ files }) => {
        window.__sharedReportFiles = await Promise.all(files.map(async file => {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          return { name:file.name, type:file.type, size:file.size, width:view.getUint32(16), height:view.getUint32(20) };
        }));
      }
    });
  });
  const expectedPngPages = await page.locator(".report-page").count();
  await page.locator("#shareReport").click();
  await page.waitForFunction(() => Array.isArray(window.__sharedReportFiles), null, { timeout: 30000 });
  const sharedFiles = await page.evaluate(() => window.__sharedReportFiles);
  assert.equal(sharedFiles.length, expectedPngPages,
    "Every report page must be included as a separate PNG file in sharing.");
  assert.ok(sharedFiles.every(file => file.type === "image/png" && file.size > 0 && file.width >= 1200 && file.height >= 500),
    "Shared report pages must be non-empty, high-resolution PNG files.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const mobileLayout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    pages: [...document.querySelectorAll(".report-page")].map(node => {
      const rect = node.getBoundingClientRect(); return { left:rect.left, right:rect.right };
    })
  }));
  assert.ok(mobileLayout.scrollWidth <= mobileLayout.viewport + 1,
    "The report must not create horizontal scrolling on a 390px mobile viewport.");
  assert.ok(mobileLayout.pages.every(item => item.left >= -1 && item.right <= mobileLayout.viewport + 1));
  const nullMetricVisual = await page.evaluate(() => window.TopGenesisVisualReport({
    weight_kg: { value: null, unit: "kg", status: "not_reported" }
  }, []));
  assert.doesNotMatch(nullMetricVisual, /0\s*kg/,
    "A null or missing metric must never be rendered as zero.");
  const simpleAnalysis = await page.evaluate(() => window.TopGenesisSimpleAnalysis({
    height_cm:{value:161,status:"within_initial_range_needs_coach_review"},
    weight_kg:{value:57,status:"within_initial_range_needs_coach_review"},
    body_fat_percent:{value:24.5,status:"within_initial_range_needs_coach_review"},
    bmi:{value:22,status:"within_initial_range_needs_coach_review"},
    fat_mass_kg:{value:14,status:"needs_coach_review"},
    lean_mass_kg:{value:43,status:"needs_coach_review"},
    resting_metabolic_rate_kcal:{value:1352,status:"within_initial_range_needs_coach_review"}
  }));
  assert.match(simpleAnalysis,/خلاصه ساده و تصویری/);
  assert.match(simpleAnalysis,/ترکیب وزن ثبت‌شده/,"Consistent fat and lean mass should render a composition chart.");
  assert.match(simpleAnalysis,/کنترل شاخص توده بدنی/,"Height, weight and BMI should be cross-checked.");
  assert.match(simpleAnalysis,/درصد چربی محاسبه‌شده/,"Body-fat percentage should be cross-checked against fat mass.");
  assert.match(simpleAnalysis,/معادل کالری مصرفی روزانه نیست/,"RMR must not be presented as daily calorie expenditure.");
  const trend = await page.evaluate(() => window.TopGenesisReportComparison(
    {weight_kg:{value:60,unit:"kg",status:"needs_coach_review"},body_fat_percent:{value:28,unit:"%",status:"needs_coach_review"},calf_left_cm:{value:150,unit:"raw_reported_unit",status:"needs_coach_review"},bmi:{value:90,unit:"kg/m²",status:"invalid_range"}},
    {weight_kg:{value:58.5,unit:"kg",status:"needs_coach_review"},body_fat_percent:{value:25.5,unit:"%",status:"needs_coach_review"},calf_left_cm:{value:145,unit:"raw_reported_unit",status:"needs_coach_review"},bmi:{value:23,unit:"kg/m²",status:"needs_coach_review"}}
  ));
  assert.match(trend,/مقایسه روند دو گزارش/);
  assert.match(trend,/کاهش/,"The comparison should describe direction of change.");
  assert.match(trend,/۱|1/,"The comparison should include numeric differences.");
  assert.match(trend,/مقایسه خام، بدون تفسیر محیطی/,"Raw Region changes must not be described as circumference changes.");
  assert.doesNotMatch(trend,/BMI/,"Invalid or conflicting values must be excluded from trend comparisons.");
  const unitMismatch = await page.evaluate(() => window.TopGenesisReportComparison(
    {weight_kg:{value:60,unit:"kg",status:"needs_coach_review"}},
    {weight_kg:{value:58,unit:"lb",status:"needs_coach_review"}}
  ));
  assert.match(unitMismatch,/شاخص مشترک و قابل‌مقایسه‌ای/,"Metrics with mismatched units must not be compared.");
  const multiTrend = await page.evaluate(() => window.TopGenesisMultiReportTrend([
    {metrics:{weight_kg:{value:62,unit:"kg",status:"needs_coach_review"},body_fat_percent:{value:30,unit:"%",status:"needs_coach_review"},bmi:{value:90,unit:"kg/m²",status:"invalid_range"}}},
    {metrics:{weight_kg:{value:60,unit:"kg",status:"needs_coach_review"},body_fat_percent:{value:28,unit:"%",status:"needs_coach_review"},bmi:{value:23,unit:"kg/m²",status:"needs_coach_review"}}},
    {metrics:{weight_kg:{value:58,unit:"kg",status:"needs_coach_review"},body_fat_percent:{value:25,unit:"%",status:"needs_coach_review"},bmi:{value:22,unit:"kg/m²",status:"needs_coach_review"}}}
  ]));
  assert.match(multiTrend,/نمودار روند چندمرحله‌ای/);
  assert.match(multiTrend,/گزارش 1/);
  assert.match(multiTrend,/گزارش 3/);
  assert.match(multiTrend,/کاهش 4.00 کیلوگرم/,"Multi-visit chart should calculate first-to-last weight change.");
  assert.match(multiTrend,/کاهش 5.00 واحد درصد/,"Multi-visit chart should calculate percentage-point change.");
  assert.doesNotMatch(multiTrend,/BMI/,"A metric invalid in any visit must be excluded from the complete trend.");
  assert.equal(await page.locator("#pdfFilesMore").evaluate(el=>el.hasAttribute("multiple")),true,"Additional report picker must allow multiple PDFs.");
  const printableReportScaffold = await page.evaluate(() => ({
    hasPrintStyles: Array.from(document.querySelectorAll("style")).some(x => x.textContent.includes("@media print")),
    hasPrintButtonCode: document.documentElement.innerHTML.includes("printReport"),
    hasCoachSignoff: document.documentElement.innerHTML.includes("یادداشت و تأیید مربی"),
    hasPersianReportTitle: document.documentElement.innerHTML.includes("گزارش تحلیل ترکیب بدن")
  }));
  assert.equal(printableReportScaffold.hasPrintStyles,true,"Printable report must include print-specific styling.");
  assert.equal(printableReportScaffold.hasPrintButtonCode,true,"Printable report must expose a print action after extraction.");
  assert.equal(printableReportScaffold.hasCoachSignoff,true,"Printable report must include coach sign-off fields.");
  assert.equal(printableReportScaffold.hasPersianReportTitle,true,"Printable report must have a Persian title.");
  await page.emulateMedia({ media: "print" });
  const printLayout = await page.evaluate(() => ({
    font: getComputedStyle(document.querySelector(".report-cover")).fontFamily,
    direction: getComputedStyle(document.querySelector(".report-page")).direction,
    textDirection: getComputedStyle(document.querySelector(".report-page p")).direction,
    bidiIsolation: getComputedStyle(document.querySelector(".report-page p")).unicodeBidi,
    pageBreaks: [...document.querySelectorAll(".report-page")].every(node => {
      const style = getComputedStyle(node);
      return style.breakAfter === "page" || style.pageBreakAfter === "always";
    }),
    noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1
  }));
  assert.match(printLayout.font, /Vazirmatn/,
    "Print layout must retain the Persian-capable report font.");
  assert.equal(printLayout.direction, "rtl", "Every report page must preserve right-to-left layout.");
  assert.equal(printLayout.textDirection, "rtl", "Persian paragraphs must preserve right-to-left text flow.");
  assert.equal(printLayout.bidiIsolation, "plaintext", "Mixed Persian and Latin text must use bidi-aware paragraph isolation.");
  assert.equal(printLayout.pageBreaks, true,
    "Each report section must be separated cleanly when printed.");
  assert.equal(printLayout.noHorizontalOverflow, true,
    "Print layout must not overflow horizontally.");
  await page.emulateMedia({ media: "screen" });
  const suspiciousAnalysis = await page.evaluate(() => window.TopGenesisSimpleAnalysis({
    weight_kg:{value:57,status:"within_initial_range_needs_coach_review"},
    fat_mass_kg:{value:14,status:"needs_coach_review"},
    lean_mass_kg:{value:43,status:"conflict_review"},
    bmi:{value:90,status:"invalid_range"}
  }));
  assert.doesNotMatch(suspiciousAnalysis,/ترکیب وزن ثبت‌شده/,"Conflicting metrics must not enter the chart.");
  assert.doesNotMatch(suspiciousAnalysis,/BMI گزارش/,"Invalid BMI must not appear in the summary cards.");
  const escaped = await page.evaluate(() => window.TopGenesisSimpleAnalysis({weight_kg:{value:"<img src=x>",status:"needs_coach_review"}}));
  assert.doesNotMatch(escaped,/<img src=x>/,"Extracted text must be HTML-escaped.");

  assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join("; ")}`);

  console.log('[smoke] report rendering assertions passed');
  // Verify the production shell keeps only the hidden mount point and loads
  // the analyzer entry directly; the legacy archive must not be a dependency.
  const appShellSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const publicationSource = fs.readFileSync(path.join(root, "top-genesis-publication.js"), "utf8");
  assert.match(appShellSource, /id=["']bodyAnalysisEntryPanel["']/, "The production app must preserve the analyzer mount point.");
  assert.match(appShellSource, /top-genesis-pdf-app-embed\.js/, "The production app must load the analyzer entry directly.");
  assert.doesNotMatch(appShellSource, /async function loadTraineeAnalysis\s*\(/, "The obsolete trainee analysis renderer must be removed.");
  assert.doesNotMatch(appShellSource, /loadTraineeAnalysis\s*\(/, "The obsolete trainee analysis renderer must not be called.");
  assert.doesNotMatch(appShellSource, /id=["\x27]traineeAnalysisSheet|id=["\x27]traineeAnalysisChart/, "Legacy trainee analysis panels must not be recreated.");
  assert.match(appShellSource, /<section id="bodyAnalysis" class="section">[\s\S]*?id="bodyAnalysisEntryPanel"/, "The coach body-analysis mount point must live inside the unified Body Analysis section.");
  assert.match(publicationSource, /installTraineeAnalysisNavigationGuard/, "The trainee analysis route must be kept visible after legacy navigation callbacks.");
  assert.match(publicationSource, /setTimeout\(reveal, 420\)/, "The trainee analysis route must survive delayed dashboard restoration callbacks.");
  assert.match(publicationSource, /removeLegacyProgressAnalysisCards/, "Legacy body-analysis widgets must be removed from the progress panel.");
  assert.match(publicationSource, /\["coachAnalysisView", "progressTrend", "progressHistory"\]/, "Only legacy body-analysis widgets may be removed; manual progress data remains untouched.");
  assert.doesNotMatch(appShellSource, /<script[^>]+src=["'][^"']*top-genesis-archive\.js/i,
    "The production app must not load the legacy archive module.");

  // Verify the analyzer mounts independently of the legacy archive module,
  // appears for coaches, and is hidden for trainees.
  const integrationPage = await browser.newPage();
  await integrationPage.goto(`http://127.0.0.1:${address.port}/top-genesis-pdf-test.html`);
  await integrationPage.evaluate(() => {
    const anchor = document.createElement("section");
    anchor.id = "bodyAnalysisEntryPanel";
    anchor.style.display = "block";
    anchor.setAttribute("aria-hidden", "false");
    document.body.appendChild(anchor);
    window.authProfile = { role: "coach" };
    window.currentClient = { id: "trainee-fatemeh-fixture" };
  });
  await integrationPage.addScriptTag({ path: path.join(root, "top-genesis-pdf-app-embed.js") });
  await integrationPage.waitForSelector("#topGenesisPdfAnalyzerPanel");
  await integrationPage.waitForFunction(() => {
    const frame = document.querySelector("#topGenesisPdfAnalyzerFrame");
    return frame?.contentDocument?.documentElement?.dataset.topGenesisTraineeId === "trainee-fatemeh-fixture";
  }, null, { timeout: 10000 });
  const firstNonce = await integrationPage.locator("#topGenesisPdfAnalyzerFrame").getAttribute("data-context-nonce");
  await integrationPage.evaluate(() => { window.currentClient = { id: "trainee-javad-fixture" }; });
  await integrationPage.waitForFunction(() => {
    const frame = document.querySelector("#topGenesisPdfAnalyzerFrame");
    return frame?.dataset.boundTraineeId === "trainee-javad-fixture" &&
      frame.contentDocument?.documentElement?.dataset.topGenesisTraineeId === "trainee-javad-fixture";
  }, null, { timeout: 10000 });
  const switchedNonce = await integrationPage.locator("#topGenesisPdfAnalyzerFrame").getAttribute("data-context-nonce");
  assert.notEqual(switchedNonce, firstNonce, "Each trainee preview must receive a fresh context nonce.");
  assert.equal(await integrationPage.locator("#topGenesisPdfAnalyzerFrame").evaluate(el => el.contentDocument.documentElement.dataset.topGenesisTraineeId),
    "trainee-javad-fixture", "The new preview must be bound to the newly selected trainee.");
  assert.equal(await integrationPage.locator("#topGenesisArchivePanel").count(), 0,
    "The standalone analyzer test must not load or require the legacy archive.");
  assert.equal(await integrationPage.locator("#topGenesisPdfAnalyzerPanel").evaluate(el => el.style.display), "block");
  assert.equal(await integrationPage.locator("#bodyAnalysisEntryPanel").evaluate(el => el.contains(document.querySelector("#topGenesisPdfAnalyzerPanel"))),
    true, "The PDF/ZIP analyzer must mount inside the unified Body Analysis card.");
  assert.match(await integrationPage.locator("#topGenesisPdfAnalyzerFrame").getAttribute("src"), /top-genesis-pdf-test\.html\?embedded=1/);
  await integrationPage.evaluate(() => { window.authProfile = { role: "trainee" }; });
  await integrationPage.waitForFunction(() =>
    document.querySelector("#topGenesisPdfAnalyzerPanel")?.style.display === "none", null, { timeout: 7000 });
  await integrationPage.evaluate(() => { window.authProfile = { role: "coach" }; });
  await integrationPage.waitForFunction(() =>
    document.querySelector("#topGenesisPdfAnalyzerPanel")?.style.display === "block", null, { timeout: 7000 });
  const analyzerEmbedSource = fs.readFileSync(path.join(root, "top-genesis-pdf-app-embed.js"), "utf8");
  assert.match(analyzerEmbedSource, /if \(!context\)\s*\{/,
    "The embedded analyzer must be hidden and unmounted when no coach trainee is selected.");
  assert.match(analyzerEmbedSource, /boundTraineeId !== context\.traineeId/,
    "The embedded analyzer must reset when the selected trainee changes.");
  assert.match(analyzerEmbedSource, /top-genesis-publication\.js/,
    "The standalone analyzer entry must continue loading the report publication module.");
  // Exercise the real parent/iframe publication message path with a mocked
  // Storage rejection. A failed upload must return its exact stage to the
  // analyzer and must never create a publication database row.
  await integrationPage.evaluate(() => {
    window.authProfile = { role: "coach" };
    window.currentClient = { id: "trainee-javad-fixture" };
    window.__publicationInsertCount = 0;
    window.AUTH_SUPABASE = {
      auth: { async getUser() { return { data: { user: { id: "coach-fixture-1" } }, error: null }; } },
      storage: {
        from() {
          return {
            async upload() {
              return { error: Object.assign(new Error("simulated storage denied"), {
                name: "StorageApiError", status: 403, code: "42501"
              }) };
            },
            async remove() { throw new Error("Cleanup must not run before a successful upload."); }
          };
        }
      },
      from() {
        return {
          async insert() {
            window.__publicationInsertCount += 1;
            return { error: null };
          }
        };
      }
    };
  });
  await integrationPage.addScriptTag({ path: path.join(root, "top-genesis-publication.js") });
  await integrationPage.waitForTimeout(100);
  await integrationPage.locator("#topGenesisPdfAnalyzerFrame").evaluate(frame => {
    frame.contentWindow.postMessage({
      type: "top-genesis-approved-report",
      requestId: "storage-failure-fixture",
      payload: {
        traineeId: "trainee-javad-fixture",
        contextNonce: frame.dataset.contextNonce,
        analysisDate: "2026-11-14",
        metrics: { weight_kg: { value: 78, unit: "kg", status: "needs_coach_review" } },
        trainingNotes: "برنامه تمرینی آزمایشی",
        nutritionNotes: "برنامه تغذیه آزمایشی",
        reportHtml: '<!doctype html><html><body><div id="result">fixture</div></body></html>'
      }
    }, window.location.origin);
  });
  await integrationPage.waitForFunction(() => {
    const frame = document.querySelector("#topGenesisPdfAnalyzerFrame");
    const status = frame?.contentDocument?.querySelector("#sendToTraineeStatus")?.textContent || "";
    return status.includes("مرحله ناموفق: بارگذاری فایل گزارش در فضای ذخیره‌سازی") &&
      status.includes("simulated storage denied");
  }, null, { timeout: 10000 });
  assert.equal(await integrationPage.evaluate(() => window.__publicationInsertCount), 0,
    "A Storage upload failure must not insert a trainee publication row.");
  assert.match(await integrationPage.locator("#topGenesisPdfAnalyzerFrame").evaluate(frame =>
    frame.contentDocument.querySelector("#sendToTraineeStatus").textContent),
    /وضعیت HTTP 403/,
    "The analyzer must receive the concrete HTTP status for a failed upload.");
  console.log("[smoke] simulated Storage failure returned exact stage and prevented database insert");
  await integrationPage.close();

  console.log('[smoke] coach role-switch assertions passed');
  // Verify approved reports appear in the trainee's analysis/progress page.
  console.log('[smoke] opening trainee progress page');
  const traineeProgressPage = await browser.newPage();
  console.log('[smoke] trainee progress page created');
  // The trainee progress component is independent of the analyzer iframe. Use a clean page
  // so PDF.js/OCR bootstrapping cannot block the role/history smoke test.
  console.log("[smoke] using isolated trainee progress page");
  traineeProgressPage.setDefaultTimeout(15000);
  await traineeProgressPage.goto("data:text/html,<html><head><title>trainee-fixture</title></head><body></body></html>");
  console.log("[smoke] trainee fixture document ready");
  await traineeProgressPage.evaluate(() => {
    window.authProfile = { role: "trainee", trainee_id: "trainee-fixture-1" };
    window.currentClient = { id: "trainee-fixture-1" };
    window.AUTH_SUPABASE = {
      from() {
        const orderCount = { value: 0 };
        const chain = {
          select() { return this; },
          eq() { return this; },
          order() {
            orderCount.value += 1;
            return orderCount.value === 1 ? this : Promise.resolve({ data: [
              { id:"a1", analysis_date:"2026-10-01", report_metrics:{ weight_kg:{value:82,unit:"kg",status:"needs_coach_review"}, body_fat_percent:{value:22,unit:"%",status:"needs_coach_review"} }, training_notes:"تمرین مقاومتی طبق برنامه", nutrition_notes:"پروتئین کافی" },
              { id:"a2", analysis_date:"2026-11-01", report_metrics:{ weight_kg:{value:79,unit:"kg",status:"needs_coach_review"}, body_fat_percent:{value:19,unit:"%",status:"needs_coach_review"} }, training_notes:"افزایش تدریجی فشار تمرین", nutrition_notes:"تنظیم کالری روزانه" }
            ], error:null });
          }
        };
        return chain;
      }
    };
    const nav=document.createElement("div");
    nav.className="nav";
    nav.innerHTML='<button type="button" onclick="dashOpen(\'analysis\')">آنالیز بدن</button>';
    document.body.appendChild(nav);
    const dashboard=document.createElement("section");
    dashboard.id="traineeDashboard";
    dashboard.className="section active";
    document.body.appendChild(dashboard);
    const section=document.createElement("section");
    section.id="traineeAnalysis";
    section.className="section";
    section.style.display="none";
    section.innerHTML='<div id="traineeAnalysisArchive"></div>';
    document.body.appendChild(section);
    const progress=document.createElement("section");
    progress.id="progress";
    progress.className="section";
    progress.innerHTML='<div id="manualProgressCard" class="card">پیشرفت دستی شاگرد</div><div id="coachAnalysisView" class="card"></div><div id="progressTrend" class="card"></div><div id="progressHistory" class="card"></div>';
    document.body.appendChild(progress);
    window.dashOpen=function(key) {
      document.querySelectorAll(".section").forEach(item => item.classList.remove("active"));
      if (key === "analysis") dashboard.classList.add("active");
      if (key === "progress") progress.classList.add("active");
    };
  });
  console.log("[smoke] trainee fixture configured");
  await traineeProgressPage.addScriptTag({ path: path.join(root, "top-genesis-publication.js") });
  console.log('[smoke] publication script loaded');
  await traineeProgressPage.waitForSelector("#topGenesisPublishedProgress", { state: "attached" });
  await traineeProgressPage.evaluate(() => window.dashOpen("analysis"));
  await traineeProgressPage.waitForSelector("#topGenesisPublishedProgress", { state: "visible" });
  await traineeProgressPage.waitForFunction(() =>
    document.querySelector("#traineeAnalysis")?.classList.contains("active") &&
    getComputedStyle(document.querySelector("#traineeAnalysis")).display !== "none");
  assert.equal(await traineeProgressPage.locator("#progress #coachAnalysisView, #progress #progressTrend, #progress #progressHistory").count(), 0,
    "Legacy analysis cards must be removed from progress while the manual progress section remains intact.");
  assert.equal(await traineeProgressPage.locator("#progress #manualProgressCard").count(), 1,
    "The trainee's manual progress card must remain untouched.");
  await traineeProgressPage.evaluate(() => window.dashOpen("progress"));
  await traineeProgressPage.waitForTimeout(500);
  assert.equal(await traineeProgressPage.locator("#progress").evaluate(el => el.classList.contains("active")), true,
    "A delayed analysis recovery must not override later navigation to manual progress.");
  assert.equal(await traineeProgressPage.locator("#progress #manualProgressCard").count(), 1);
  await traineeProgressPage.evaluate(() => window.dashOpen("analysis"));
  await traineeProgressPage.waitForFunction(() => document.querySelector("#traineeAnalysis")?.classList.contains("active"));
  console.log('[smoke] trainee analysis route, manual progress preservation and navigation passed');
  console.log('[smoke] trainee report card mounted');
  await traineeProgressPage.waitForFunction(() => {
    const body = document.querySelector("#topGenesisPublishedBody");
    return body && body.querySelectorAll("polyline").length >= 2;
  });
  assert.match(await traineeProgressPage.locator("#topGenesisPublishedProgress").innerText(), /گزارش‌های تأییدشده آنالیز بدن/);
  assert.match(await traineeProgressPage.locator("#topGenesisPublishedBody").innerText(), /۷۹/);
  assert.match(await traineeProgressPage.locator("#topGenesisPublishedBody").innerText(), /تاریخچه آنالیزها/);
  // History filters and per-report detail panels must not alter the all-history trend.
  const historyMode = traineeProgressPage.locator("#topGenesisHistoryMode");
  assert.equal(await historyMode.inputValue(), "latest");
  assert.equal(await traineeProgressPage.locator("#topGenesisHistoryList article").count(), 1);
  await historyMode.selectOption("all");
  console.log('[smoke] history all filter passed');
  assert.equal(await traineeProgressPage.locator("#topGenesisHistoryList article").count(), 2);
  await traineeProgressPage.locator('[data-history-details="a1"]').click();
  console.log('[smoke] report detail opened');
  assert.equal(await traineeProgressPage.locator("#topGenesisDetails-a1").isVisible(), true);
  assert.match(await traineeProgressPage.locator("#topGenesisDetails-a1").innerText(), /۸۲|82/);
  assert.match(await traineeProgressPage.locator("#topGenesisDetails-a1").innerText(), /توصیه تمرینی مربی/);
  assert.match(await traineeProgressPage.locator("#topGenesisDetails-a1").innerText(), /تمرین مقاومتی طبق برنامه/);
  assert.match(await traineeProgressPage.locator("#topGenesisDetails-a1").innerText(), /پروتئین کافی/);
  await historyMode.selectOption("month");
  console.log('[smoke] month filter passed');
  assert.equal(await traineeProgressPage.locator("#topGenesisHistoryList article").count(), 1,
    "Persian current-month filter should include only the November fixture.");
  await historyMode.selectOption("range");
  console.log('[smoke] range filter selected');
  await traineeProgressPage.locator("#topGenesisDateFrom").fill("2026-10-01");
  await traineeProgressPage.locator("#topGenesisDateTo").fill("2026-10-01");
  assert.equal(await traineeProgressPage.locator("#topGenesisHistoryList article").count(), 1,
    "Date range should select the matching report date.");
  assert.ok(await traineeProgressPage.locator("#topGenesisPublishedBody polyline").count() >= 2,
    "Trend charts must continue to use the complete history, independent of the selected filter.");
  // Switching roles inside the same SPA must move the report card, not strand it in coach view.
  console.log("[smoke] starting trainee-to-coach role switch");
  await traineeProgressPage.evaluate(() => {
    window.authProfile.role = "coach";
    const progress = document.createElement("section");
    progress.id = "progress";
    progress.className = "section";
    progress.innerHTML = '<div id="progressEntryPanel"></div>';
    const bodyAnalysis = document.createElement("section");
    bodyAnalysis.id = "bodyAnalysis";
    bodyAnalysis.className = "section";
    bodyAnalysis.innerHTML = '<div id="bodyAnalysisEntryPanel"></div>';
    document.body.append(progress, bodyAnalysis);
  });
  await traineeProgressPage.waitForFunction(() =>
    document.querySelector("#topGenesisPublishedProgress")?.closest("#bodyAnalysisEntryPanel"));
  console.log("[smoke] report moved inside coach Body Analysis card");
  await traineeProgressPage.evaluate(() => { window.authProfile.role = "trainee"; });
  await traineeProgressPage.waitForFunction(() =>
    document.querySelector("#topGenesisPublishedProgress")?.closest("#traineeAnalysis"));
  console.log("[smoke] report returned to trainee analysis");


  await traineeProgressPage.close();
  console.log('[smoke] trainee progress page closed');


  const analyzerSource = fs.readFileSync(path.join(root, "top-genesis-pdf-test.html"), "utf8");
  const fullReportMigration = fs.readFileSync(path.join(root, "supabase/migrations/202611120002_top_genesis_full_trainee_report.sql"), "utf8");
  assert.match(analyzerSource, /buildTraineeSafeReportHtml/, "The trainee report must be derived from the exact analyzer output.");
  assert.match(analyzerSource, /reportHtml/, "The complete report must be included in the approved publication payload.");
  assert.match(analyzerSource, /image_data_url/, "Original scan images must remain in the generated report.");
  assert.match(publicationSource, /report_storage_path/, "The publication must retain a private full-report storage path.");
  assert.match(publicationSource, /storage[\s\S]*\.upload\(/, "The coach-approved report must be uploaded to private storage.");
  assert.match(publicationSource, /\.download\(row\.report_storage_path\)/, "The trainee must load the private full report from storage.");
  assert.match(fullReportMigration, /add column if not exists report_storage_path/i);
  assert.match(fullReportMigration, /text\/html/);
  assert.doesNotMatch(fullReportMigration, /drop table|delete from public\.trainee_body_analysis_publications/i,
    "The full-report migration must not delete or rewrite existing trainee records.");

  const publicationMigration = fs.readFileSync(path.join(root, "supabase/migrations/202611120001_top_genesis_publications.sql"), "utf8");
  assert.match(publicationMigration, /private\.can_access_trainee/);
  assert.match(publicationMigration, /for insert to authenticated/i);
  assert.doesNotMatch(publicationMigration, /for update to authenticated/i);
  assert.doesNotMatch(publicationMigration, /for delete to authenticated/i);

  console.log("PASS: Chromium loaded PDF.js/OCR, parsed anonymized CSV/ZIP fixtures, and rendered approved multi-visit trends in the trainee progress panel.");
} finally {
  console.log('[smoke] closing browser');
  await browser.close();
  console.log('[smoke] browser closed');
  await new Promise(resolve => server.close(resolve));
  console.log('[smoke] server closed');
}
