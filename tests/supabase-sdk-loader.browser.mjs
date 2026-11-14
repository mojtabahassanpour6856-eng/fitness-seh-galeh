import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright";

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

async function testEngine(name, browserType, base) {
  const browser = await browserType.launch({ headless: true });
  try {
    // Success path: real production HTML + real local SDK. External services
    // are blocked, so no authentication or trainee data access can occur.
    const good = await browser.newPage();
    const sdkResponses = [];
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
    assert.deepEqual(sdkResponses, [200], name + ": local SDK must load exactly once.");
    const success = await good.evaluate(() => ({
      ready: window.__sehSupabaseSdkReady,
      failed: window.__sehSupabaseSdkLoadFailed,
      clientReady: !!window.AUTH_SUPABASE && typeof window.AUTH_SUPABASE.auth?.getSession === "function",
      sdkUrl: document.getElementById("seh-supabase-sdk")?.src
    }));
    assert.equal(success.ready, true, name + ": SDK ready flag");
    assert.equal(success.failed, false, name + ": SDK failure flag");
    assert.equal(success.clientReady, true, name + ": Supabase client readiness");
    assert.match(success.sdkUrl, /\/vendor\/supabase-2\.119\.0\.js$/);
    await good.close();

    // Failure path: simulate local SDK 404. Startup must stop before client init.
    const bad = await browser.newPage();
    const pageErrors = [];
    bad.on("pageerror", error => pageErrors.push(error.message));
    await bad.route("**/vendor/supabase-2.119.0.js", route =>
      route.fulfill({ status: 404, contentType: "text/plain", body: "simulated missing local SDK" })
    );
    await bad.route("https://**/*", route => route.abort());
    await bad.goto(base + "/index.html", { waitUntil: "domcontentloaded" });
    await bad.waitForFunction(() => {
      const box = document.getElementById("authError");
      return window.__sehSupabaseSdkLoadFailed === true && box?.style.display === "block";
    }, { timeout: 10000 });
    const failure = await bad.evaluate(() => ({
      failed: window.__sehSupabaseSdkLoadFailed,
      clientCreated: !!window.AUTH_SUPABASE,
      message: document.getElementById("authError")?.textContent || ""
    }));
    assert.equal(failure.failed, true, name + ": SDK failure flag");
    assert.equal(failure.clientCreated, false, name + ": no client may be created after SDK 404");
    assert.match(failure.message, /کتابخانه اتصال/);
    assert.ok(pageErrors.some(message => message.includes("Supabase SDK unavailable")),
      name + ": guarded startup must stop explicitly");
    await bad.close();
    console.log("PASS: " + name + " success and 404 startup paths");
  } finally {
    await browser.close();
  }
}

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const base = "http://127.0.0.1:" + address.port;
try {
  for (const [name, browserType] of [["Chromium", chromium], ["Firefox", firefox], ["WebKit", webkit]]) {
    await testEngine(name, browserType, base);
  }
  console.log("PASS: all three browser engines loaded the local pinned SDK and safely stopped on simulated SDK 404 without touching real account data.");
} finally {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
