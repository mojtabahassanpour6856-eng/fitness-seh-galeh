import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
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
  await imagePage.close();

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const textPage = pdfDoc.addPage([612, 792]);
  textPage.drawText(
    "Height & Weight 161 cm & 57 kg Body Fat 24.5% BMI 22.0 Waist-to-Hip Ratio 0.734 RMR 1352 calories/day Body Measurements (cm) Calf Left Region 157.69 Calf Right Region 162.75 Hip Region 680.13. This is a synthetic browser test fixture with enough selectable text to bypass OCR on this page.",
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
  const pdfBytes = await pdfDoc.save();

  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/top-genesis-pdf-test.html`);
  await page.locator("#pdfFile").setInputFiles({
    name: "synthetic-top-genesis-fixture.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(pdfBytes)
  });
  await page.locator("#run").click();
  await page.waitForFunction(() => {
    const text = document.querySelector("#status")?.textContent || "";
    return text.includes("استخراج تمام شد") || text.startsWith("خطا:");
  }, null, { timeout: 180000 });

  const status = await page.locator("#status").innerText();
  assert.match(status, /استخراج تمام شد/, `Parser did not complete: ${status}`);
  const pageInfo = await page.locator("#result").innerText();
  assert.match(pageInfo, /تعداد صفحات: 3/);
  assert.match(pageInfo, /صفحات OCR: 2، 3/);
  assert.match(pageInfo, /161/);
  assert.match(pageInfo, /57/);
  assert.match(pageInfo, /مقایسه دو سمت بدن/,
    "Bilateral region comparison must be rendered in the Persian results.");
  assert.match(pageInfo, /ساق چپ/,
    "Region names must be shown in Persian rather than internal keys.");
  assert.match(pageInfo, /نیازمند بررسی مربی/,
    "A bilateral difference above the review threshold must be visible to the coach.");
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
  assert.equal(direct.metrics.bilateral_measurement_review[0].status, "coach_review_asymmetry",
    "A left/right difference above the initial 2-unit review threshold must be flagged.");
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
  assert.equal(smallDifference.metrics.bilateral_measurement_review[0].status, "within_initial_review_threshold",
    "A bilateral difference at or below 2 reported units must not trigger the asymmetry flag.");
  const valid25 = await page.evaluate(() => window.TopGenesisPdfParser.extractMetrics(
    "Body Fat 25% BMI 22.4"
  ));
  assert.equal(valid25.metrics.body_fat_percent.value, 25,
    "A legitimate body-fat value of exactly 25% must never be discarded.");
  assert.equal(valid25.metrics.body_fat_percent.status, "within_initial_range_needs_coach_review",
    "A broad range check must not be presented as medical validation.");
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
  assert.match(simpleAnalysis,/کنترل BMI/,"Height, weight and BMI should be cross-checked.");
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
  console.log("PASS: Chromium loaded PDF.js, parsed selectable PDF text, ran OCR on image-only and semi-text measurement pages, and rendered extracted metrics.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
