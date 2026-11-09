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
    "Height & Weight 161 cm & 57 kg Body Fat 24.5% BMI 22.0 Waist-to-Hip Ratio 0.734 RMR 1352 calories/day Body Measurements (cm) Calf Left Region 157.69 Hip Region 680.13. This is a synthetic browser test fixture with enough selectable text to bypass OCR on this page.",
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
  assert.match(pageInfo, /24.5/);
  const direct = await page.evaluate(() => window.TopGenesisPdfParser.extractMetrics(
    "Body Measurements (cm) Calf Left Region 157.69 Calf Right Region 162.757 Hip Region 680.13"
  ));
  assert.equal(direct.metrics.raw_body_measurements.calf_left_cm.raw_value, 157.69,
    "Calf raw value must retain its decimal precision.");
  assert.equal(direct.metrics.raw_body_measurements.calf_right_cm.raw_value, 162.757,
    "Opposite-side calf raw value must retain its decimal precision.");
  assert.equal(direct.metrics.bilateral_measurement_review[0].status, "coach_review_asymmetry",
    "A left/right difference above the initial 2-unit review threshold must be flagged.");
  assert.equal(direct.metrics.bilateral_measurement_review[0].absolute_difference, 5.067,
    "The bilateral difference must be calculated without losing decimal precision.");
  assert.equal(direct.metrics.raw_body_measurements.hip_region_cm.raw_value, 680.13,
    "Hip raw value must retain its decimal precision.");
  assert.equal(direct.metrics.missing_measurements.forearm_left_cm.status, "not_reported",
    "Absent forearm must be represented as not_reported, not zero.");
  assert.equal(direct.metrics.measurement_coverage.status, "partial");
  assert.match(pageInfo, /ساعد چپ.*ثبت نشده/s, "Missing forearm was not reported as missing.");
  assert.match(pageInfo, /69\.87/, "Tesseract did not recognize the synthetic waist value from the raster page.");
  assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join("; ")}`);
  console.log("PASS: Chromium loaded PDF.js, parsed selectable PDF text, ran OCR on image-only and semi-text measurement pages, and rendered extracted metrics.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
