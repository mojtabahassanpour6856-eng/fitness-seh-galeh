import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = "qfakyudgidsumeuoqoot";
const projectUrl = "https://" + project + ".supabase.co";
const userId = "11111111-2222-4333-8444-555555555555";
const storageKey = "sb-" + project + "-auth-token";

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
  const file = path.resolve(root, "." + pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end("Not found"); return;
  }
  const ext = path.extname(file);
  const type = ext === ".html" ? "text/html; charset=utf-8" :
    ext === ".js" ? "text/javascript; charset=utf-8" :
    ext === ".css" ? "text/css; charset=utf-8" :
    ext === ".webmanifest" ? "application/manifest+json" :
    ext === ".json" ? "application/json" :
    ext === ".svg" ? "image/svg+xml" : "application/octet-stream";
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
});

const browser = await chromium.launch({ headless: true });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const context = await browser.newContext({ serviceWorkers: "allow" });
let profileReads = 0;
let mockNetworkOnline = true;
await context.addInitScript(({ storageKey, userId }) => {
  window.__offlineStorageTrace = [];
  const originalSet = Storage.prototype.setItem;
  const originalRemove = Storage.prototype.removeItem;
  Storage.prototype.setItem = function(key, value) { if (key === "seh.offline-safe-shell.v1") window.__offlineStorageTrace.push({op:"set",value:String(value),stack:new Error().stack}); return originalSet.call(this,key,value); };
  Storage.prototype.removeItem = function(key) { if (key === "seh.offline-safe-shell.v1") window.__offlineStorageTrace.push({op:"remove",stack:new Error().stack}); return originalRemove.call(this,key); };
  if (!localStorage.getItem(storageKey)) {
    const now = Math.floor(Date.now() / 1000);
    localStorage.setItem(storageKey, JSON.stringify({
      access_token: "mock-access-token-not-valid-for-any-real-service",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: now + 3600,
      refresh_token: "mock-refresh-token",
      user: {
        id: userId,
        aud: "authenticated",
        role: "authenticated",
        email: "offline-test@example.invalid",
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: { full_name: "Offline Test Coach" },
        created_at: new Date().toISOString()
      }
    }));
  }
}, { storageKey, userId });

await context.route("https://**/*", route => route.abort());
await context.route(projectUrl + "/**", async route => {
  if (!mockNetworkOnline) { await route.abort("internetdisconnected"); return; }
  const url = new URL(route.request().url());
  if (url.pathname === "/rest/v1/profiles") {
    profileReads++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-0/1" },
      body: JSON.stringify([{ id: userId, role: "coach", full_name: "Offline Test Coach" }])
    });
    return;
  }
  if (url.pathname.startsWith("/rest/v1/") || url.pathname.startsWith("/rest/v1/rpc/")) {
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "content-range": "*/0" }, body: "[]" });
    return;
  }
  // Any unexpected auth request is deliberately rejected; the test must use
  // only the synthetic persisted session and the mocked profile response.
  await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "unexpected mocked auth request" }) });
});

try {
  const online = await context.newPage();
  const errors = [];
  online.on("pageerror", error => errors.push({ message: error.message, stack: error.stack || "" }));
  await online.goto(base + "/index.html", { waitUntil: "domcontentloaded" });
  await online.waitForFunction(() => {
    const bar = document.getElementById("authUserBar");
    return document.body && !document.body.classList.contains("locked") &&
      document.getElementById("authScreen")?.style.display === "none" &&
      bar?.style.display === "block";
  }, { timeout: 20000 });
  await online.waitForTimeout(1500);
  const markerDebug = await online.evaluate(() => ({ marker: localStorage.getItem("seh.offline-safe-shell.v1"), trace: window.__offlineStorageTrace }));
  assert.ok(markerDebug.marker, "finishLogin must persist the minimal marker; trace=" + JSON.stringify(markerDebug.trace));
  await online.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 4000);
        navigator.serviceWorker.addEventListener("controllerchange", () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }
  });
  await online.reload({ waitUntil: "domcontentloaded" });
  await online.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 10000 });
  assert.ok(profileReads >= 1, "the real finishLogin flow must validate the mocked coach profile");
  await online.close();

  mockNetworkOnline = false;
  await context.setOffline(true);
  const offline = await context.newPage();
  offline.on("pageerror", error => errors.push({ message: error.message, stack: error.stack || "" }));
  await offline.goto(base + "/index.html", { waitUntil: "domcontentloaded", timeout: 15000 });
  try {
    await offline.waitForFunction(() => document.body?.classList.contains("seh-offline-shell"), { timeout: 10000 });
  } catch (error) {
    const state = await offline.evaluate(() => ({
      online: navigator.onLine,
      controlled: !!navigator.serviceWorker.controller,
      marker: localStorage.getItem("seh.offline-safe-shell.v1"),
      bodyClasses: document.body?.className,
      authScreen: document.getElementById("authScreen")?.style.display,
      authBar: document.getElementById("authUserBar")?.style.display,
      notice: !!document.getElementById("sehOfflineShellNotice"),
      href: location.href
    })).catch(e => ({ evaluationError: e.message }));
    throw new Error("Offline shell did not appear; browser state=" + JSON.stringify(state));
  }
  const restricted = await offline.evaluate(() => ({
    shell: document.body.classList.contains("seh-offline-shell"),
    authScreen: getComputedStyle(document.getElementById("authScreen")).display,
    authBar: getComputedStyle(document.getElementById("authUserBar")).display,
    nav: getComputedStyle(document.querySelector(".nav")).display,
    hero: getComputedStyle(document.querySelector(".hero")).display,
    sections: [...document.querySelectorAll(".page > section")].map(node => getComputedStyle(node).display),
    marker: JSON.parse(localStorage.getItem("seh.offline-safe-shell.v1") || "null")
  }));
  assert.equal(restricted.shell, true, "offline reopen must show the restricted shell");
  assert.equal(restricted.authScreen, "none");
  assert.equal(restricted.authBar, "none");
  assert.equal(restricted.nav, "none", "private navigation must remain hidden");
  assert.equal(restricted.hero, "block", "the branded app shell must remain visible");
  assert.ok(restricted.sections.every(value => value === "none"), "all private app sections must remain hidden");
  assert.deepEqual(restricted.marker, { version: 1, view: "home" }, "the offline marker must contain no identity or private data");
  const readsBeforeReconnect = profileReads;

  mockNetworkOnline = true;
  await context.setOffline(false);
  await offline.waitForFunction(() =>
    !document.body.classList.contains("seh-offline-shell") &&
    document.getElementById("authUserBar")?.style.display === "block",
    { timeout: 20000 }
  );
  assert.ok(profileReads > readsBeforeReconnect, "reconnect must revalidate the profile against the mock server");
  assert.equal(await offline.evaluate(() => document.getElementById("authUserText").textContent.includes("Offline Test Coach")), true);
  // The current app has two known, unrelated optional-profile UI startup errors.
  // Keep them visible in the report, but fail this auth/offline regression only on
  // unexpected errors that are not in that narrowly-scoped legacy allowlist.
  const knownNonAuthStartupErrors = [
    /^addProfileBasicFields is not defined$/,
    /^Failed to execute 'insertBefore' on 'Node'/
  ];
  const unexpectedErrors = errors.filter(entry => !knownNonAuthStartupErrors.some(pattern => pattern.test(entry.message)));
  assert.deepEqual(unexpectedErrors, [], "unexpected uncaught errors during auth/offline lifecycle");
  if (errors.length) console.log("KNOWN NON-AUTH STARTUP ERROR DETAILS (investigation only; not part of this auth regression): " + JSON.stringify(errors));
  console.log("PASS: actual app HTML + pinned Supabase SDK + mocked profile endpoint passed online sign-in, offline PWA-shell reopen, private UI hiding, and authenticated reconnect.");
} finally {
  await context.close();
  await browser.close();
  await new Promise(resolve => server.close(error => error ? reject(error) : resolve()));
}
