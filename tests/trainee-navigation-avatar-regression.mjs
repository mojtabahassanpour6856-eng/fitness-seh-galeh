import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const avatarStart = appSource.indexOf("  function renderTraineeProfileHeader(root){");
const avatarEndMarker = "  window.renderTraineeProfileHeader = renderTraineeProfileHeader;";
const avatarEnd = appSource.indexOf(avatarEndMarker, avatarStart);
assert.ok(avatarStart >= 0 && avatarEnd > avatarStart, "Production avatar renderer was not found.");
const avatarSource = appSource.slice(avatarStart, avatarEnd + avatarEndMarker.length);

const historyMatch = appSource.match(/<script id="SEH_TRAINEE_BACK_NAV_SAFE_V2_20261031">([\s\S]*?)<\/script>/);
assert.ok(historyMatch, "Production trainee history controller was not found.");
const historySource = historyMatch[1];

const server = http.createServer((req, res) => {
  if (req.url === "/landing") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>landing</title><p>Previous page</p>");
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><head><title>trainee navigation fixture</title></head><body>
    <nav class="nav"><button id="navDash" onclick="showSection('traineeDashboard')">Dashboard</button>
    <button onclick="showSection('activitySection')">Activity</button>
    <button onclick="showSection('traineeAnalysis')">Analysis</button></nav>
    <section id="traineeDashboard" class="section active"></section>
    <section id="activitySection" class="section"></section>
    <section id="traineeAnalysis" class="section"></section>
    <section id="client" class="section"></section>
  </body></html>`);
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const browser = await chromium.launch({ headless: true });
try {
  // Exercise the actual production renderer with deliberately reordered image responses.
  const avatarPage = await browser.newPage();
  await avatarPage.route("**/avatar-*.png", async route => {
    const url = route.request().url();
    if (url.endsWith("avatar-a.png")) await new Promise(resolve => setTimeout(resolve, 350));
    if (url.endsWith("avatar-b.png")) await new Promise(resolve => setTimeout(resolve, 40));
    if (url.endsWith("avatar-fail.png")) {
      await route.abort();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l0sAAAAASUVORK5CYII=", "base64")
    });
  });
  await avatarPage.setContent('<div id="traineeDashboard"></div><button id="sehDeleteTraineePhotoEdit"></button>');
  await avatarPage.evaluate(() => {
    window.authProfile = { role: "trainee", full_name: "Regression trainee" };
    window.currentClient = { full_name: "Regression trainee", profile_image: "" };
  });
  await avatarPage.addScriptTag({ content: avatarSource });
  await avatarPage.evaluate(() => {
    currentClient.profile_image = location.origin + "/avatar-a.png";
    renderTraineeProfileHeader(document.getElementById("traineeDashboard"));
    currentClient.profile_image = location.origin + "/avatar-b.png";
    renderTraineeProfileHeader(document.getElementById("traineeDashboard"));
  });
  await avatarPage.waitForFunction(() => {
    const img = document.querySelector(".seh-profile-image");
    return img?.getAttribute("src")?.endsWith("/avatar-b.png") && img.style.display === "block";
  });
  await avatarPage.waitForTimeout(450);
  let avatarState = await avatarPage.evaluate(() => ({
    src: document.querySelector(".seh-profile-image")?.getAttribute("src"),
    display: document.querySelector(".seh-profile-image")?.style.display,
    fallback: document.querySelector(".seh-profile-fallback")?.style.display
  }));
  assert.ok(avatarState.src.endsWith("/avatar-b.png"), "A late response for the old avatar replaced the latest selection.");
  assert.equal(avatarState.display, "block");
  assert.equal(avatarState.fallback, "none");

  await avatarPage.evaluate(() => {
    currentClient.profile_image = location.origin + "/avatar-fail.png";
    renderTraineeProfileHeader(document.getElementById("traineeDashboard"));
  });
  await avatarPage.waitForFunction(() => document.querySelector(".seh-profile-fallback")?.style.display === "block");
  avatarState = await avatarPage.evaluate(() => ({
    imageDisplay: document.querySelector(".seh-profile-image")?.style.display,
    fallbackDisplay: document.querySelector(".seh-profile-fallback")?.style.display
  }));
  assert.equal(avatarState.imageDisplay, "none", "A failed image must not remain visible.");
  assert.equal(avatarState.fallbackDisplay, "block", "A failed image must show the fallback.");

  await avatarPage.evaluate(() => {
    currentClient.profile_image = "";
    renderTraineeProfileHeader(document.getElementById("traineeDashboard"));
  });
  avatarState = await avatarPage.evaluate(() => ({
    src: document.querySelector(".seh-profile-image")?.getAttribute("src"),
    display: document.querySelector(".seh-profile-image")?.style.display,
    fallbackDisplay: document.querySelector(".seh-profile-fallback")?.style.display
  }));
  assert.equal(avatarState.src, null, "Deleting the photo must remove the old src attribute.");
  assert.equal(avatarState.display, "none");
  assert.equal(avatarState.fallbackDisplay, "block");
  await avatarPage.close();

  // Execute the exact production history-controller script on a minimal page shell.
  const navPage = await browser.newPage();
  await navPage.goto(`http://127.0.0.1:${address.port}/landing`);
  await navPage.goto(`http://127.0.0.1:${address.port}/fixture`);
  await navPage.evaluate(() => {
    window.authProfile = { role: "trainee" };
    window.showSection = function(id) {
      document.querySelectorAll(".section").forEach(section => section.classList.toggle("active", section.id === id));
    };
    window.dashOpen = function(id) {
      if (id === "client") {
        document.querySelectorAll(".section").forEach(section => section.classList.toggle("active", section.id === "client"));
      }
    };
    window.openTraineeProfile = function() {
      document.querySelectorAll(".section").forEach(section => section.classList.toggle("active", section.id === "client"));
    };
  });
  await navPage.addScriptTag({ content: historySource });
  await navPage.waitForFunction(() => history.state?.sehTraineeBackV2?.kind === "base");
  await navPage.evaluate(() => showSection("activitySection"));
  await navPage.evaluate(() => showSection("traineeAnalysis"));
  let routeState = await navPage.evaluate(() => ({
    entry: history.state?.sehTraineeBackV2,
    active: document.querySelector(".section.active")?.id
  }));
  assert.equal(routeState.entry.route, "traineeAnalysis");
  assert.equal(routeState.entry.kind, "route");
  assert.equal(routeState.active, "traineeAnalysis");

  await navPage.goBack();
  await navPage.waitForFunction(() => document.querySelector(".section.active")?.id === "traineeDashboard");
  routeState = await navPage.evaluate(() => ({
    entry: history.state?.sehTraineeBackV2,
    active: document.querySelector(".section.active")?.id
  }));
  assert.equal(routeState.entry.kind, "base", "The first Back must land on the dashboard base entry.");
  assert.equal(routeState.active, "traineeDashboard");

  await navPage.goBack();
  await navPage.waitForURL(url => url.pathname === "/landing", { timeout: 5000 });
  assert.match(navPage.url(), /\/landing$/, "The second Back must leave the app normally.");
  await navPage.close();

  console.log("PASS: production avatar renderer ignores stale image loads, handles failure/deletion, and production trainee history returns to dashboard once before normal browser Back.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
