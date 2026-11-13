import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
  const file = path.resolve(root, "." + pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end("Not found"); return;
  }
  const ext = path.extname(file);
  const type = ext === ".html" ? "text/html; charset=utf-8" :
    ext === ".js" ? "text/javascript; charset=utf-8" :
    ext === ".css" ? "text/css; charset=utf-8" : "application/octet-stream";
  res.writeHead(200, { "content-type": type });
  fs.createReadStream(file).pipe(res);
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const browser = await chromium.launch({ headless: true });
try {
  const base = `http://127.0.0.1:${address.port}`;

  // Success path: the real production HTML and real vendored UMD SDK are loaded
  // in Chromium. External services are blocked so the test does not authenticate
  // or read/write any real account data.
  const good = await browser.newPage();
  const goodErrors = [];
  const sdkResponses = [];
  good.on("pageerror", error => goodErrors.push(error.message));
  good.on("response", response => {
    if (response.url().includes("/vendor/supabase-2.119.0.js")) sdkResponses.push(response.status());
  });
  await good.route("https://**/*", route => route.abort());
  await good.goto(base + "/index.html", { waitUntil: "domcontentloaded" });
  await good.waitForFunction(() =>
    window.__sehSupabaseSdkReady === true &&
    window.AUTH_SUPABASE &&
    typeof window.AUTH_SUPABASE.auth?.getSession === "function",
    { timeout: 15000 }
  );
  assert.deepEqual(sdkResponses, [200], "The local pinned SDK must be served successfully exactly once.");
  const successState = await good.evaluate(() => ({
    sdkReady: window.__sehSupabaseSdkReady,
    sdkFailed: window.__sehSupabaseSdkLoadFailed,
    clientReady: !!window.AUTH_SUPABASE && typeof window.AUTH_SUPABASE.auth?.getSession === "function",
    sdkUrl: document.getElementById("seh-supabase-sdk")?.src
  }));
  assert.equal(successState.sdkReady, true);
  assert.equal(successState.sdkFailed, false);
  assert.equal(successState.clientReady, true);
  assert.match(successState.sdkUrl, /\/vendor\/supabase-2\.119\.0\.js$/);
  await good.close();

  // Failure path: force only the local SDK asset to return 404. The production
  // onerror handler must surface its message and initialization must not create
  // an AUTH_SUPABASE client.
  const bad = await browser.newPage();
  const badErrors = [];
  bad.on("pageerror", error => badErrors.push(error.message));
  await bad.route("**/vendor/supabase-2.119.0.js", route =>
    route.fulfill({ status: 404, contentType: "text/plain", body: "simulated missing local SDK" })
  );
  await bad.route("https://**/*", route => route.abort());
  await bad.goto(base + "/index.html", { waitUntil: "domcontentloaded" });
  await bad.waitForFunction(() => {
    const box = document.getElementById("authError");
    return window.__sehSupabaseSdkLoadFailed === true && box?.style.display === "block";
  }, { timeout: 10000 });
  const failureState = await bad.evaluate(() => ({
    failed: window.__sehSupabaseSdkLoadFailed,
    clientCreated: !!window.AUTH_SUPABASE,
    message: document.getElementById("authError")?.textContent || ""
  }));
  assert.equal(failureState.failed, true);
  assert.equal(failureState.clientCreated, false, "A missing SDK must prevent Supabase client initialization.");
  assert.match(failureState.message, /کتابخانه اتصال/);
  assert.ok(badErrors.some(message => message.includes("Supabase SDK unavailable")),
    "The guarded startup should stop with the expected explicit error.");
  await bad.close();

  console.log("PASS: Chromium loaded the real production page and local Supabase SDK, initialized AUTH_SUPABASE only after SDK readiness, and safely stopped on SDK 404 without touching real account data.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
