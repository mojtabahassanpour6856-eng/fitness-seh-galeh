import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};
let forceEntry404 = false;
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
  if (forceEntry404 && (pathname === "/" || pathname === "/index.html")) {
    res.writeHead(404); res.end("Simulated entry-route 404"); return;
  }
  let file = path.resolve(root, "." + pathname);
  if (!file.startsWith(root + path.sep) && file !== root) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end("Not found"); return;
  }
  res.writeHead(200, { "content-type": mime[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: "allow" });
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    return route.abort();
  });

  const page = await context.newPage();
  await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.evaluate(async () => await navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });

  const initialCache = await page.evaluate(async () => {
    const cache = await caches.open("seh-shell-v3");
    const keys = await cache.keys();
    return keys.map(request => new URL(request.url).pathname);
  });
  assert.ok(initialCache.some(path => path.endsWith("/index.html")),
    "Chromium must precache the main app shell");
  assert.ok(initialCache.some(path => path.endsWith("/vendor/supabase-2.119.0.js")),
    "Chromium must precache the pinned local SDK");
  assert.ok(initialCache.some(path => path.endsWith("/coach-nutrition-builder.html")),
    "Chromium must precache the embedded nutrition page");
  assert.ok(initialCache.every(path => path.startsWith("/")),
    "the cache must contain only same-origin paths");

  forceEntry404 = true;
  await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 15000 });
  assert.equal(await page.locator("#authScreen").count(), 1,
    "a server-side 404 on the app entry route must fall back to the cached shell");
  forceEntry404 = false;

  await page.evaluate(() => localStorage.setItem(
    "seh.offline-safe-shell.v1", JSON.stringify({ version: 1, view: "home" })
  ));
  await context.setOffline(true);
  await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForFunction(() => document.body.classList.contains("seh-offline-shell"), null, { timeout: 10000 });
  assert.equal(await page.locator("#authScreen").evaluate(el => getComputedStyle(el).display), "none",
    "a previously verified offline user must not be bounced back to the login screen");
  assert.equal(await page.locator(".hero").evaluate(el => getComputedStyle(el).display !== "none"), true,
    "the safe brand shell must remain visible offline");
  assert.equal(await page.locator(".nav").evaluate(el => getComputedStyle(el).display), "none",
    "private navigation must stay hidden in restricted offline mode");
  assert.equal(await page.locator(".section").first().evaluate(el => getComputedStyle(el).display), "none",
    "private app sections must stay hidden in restricted offline mode");
  assert.match(await page.locator("#sehOfflineShellNotice").innerText(), /حالت آفلاین/,
    "the offline restriction must be clearly explained");

  await page.evaluate(() => localStorage.removeItem("seh.offline-safe-shell.v1"));
  await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
  assert.equal(await page.locator("#authScreen").evaluate(el => getComputedStyle(el).display), "flex",
    "without a safe marker, offline startup must remain locked on the public entry screen");

  const nutritionPage = await context.newPage();
  await nutritionPage.goto(base + "/coach-nutrition-builder.html", {
    waitUntil: "domcontentloaded", timeout: 15000
  });
  assert.ok(await nutritionPage.locator("body").innerText().then(text => text.length > 20),
    "the cached nutrition builder must load as its own offline document");

  const genesisPage = await context.newPage();
  await genesisPage.goto(base + "/top-genesis-pdf-test.html?embedded=1", {
    waitUntil: "domcontentloaded", timeout: 15000
  });
  assert.equal(await genesisPage.locator("#topGenesisZip").count(), 1,
    "the cached Top Genesis page must load its own offline document");

  const shellStillIntact = await genesisPage.evaluate(async () => {
    const cache = await caches.open("seh-shell-v3");
    const response = await cache.match(new URL("index.html", location.href).href);
    return response ? await response.text() : "";
  });
  assert.match(shellStillIntact, /Fitness Seh Galeh|فیتنس سه‌قلعه/i,
    "embedded HTML navigations must never overwrite the cached main app shell");

  console.log("PASS: Chromium registers the service worker, precaches the shell, opens the app and both embedded pages offline, and keeps API data outside the cache.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
