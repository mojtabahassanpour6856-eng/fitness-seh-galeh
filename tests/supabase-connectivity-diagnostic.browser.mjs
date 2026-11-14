import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const html = await readFile("index.html");
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://127.0.0.1").pathname;
  if (path === "/" || path === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }
  const asset = path.replace(/^\//, "");
  import("node:fs").then(({ createReadStream }) => {
    const stream = createReadStream(asset);
    stream.on("error", () => { res.writeHead(404); res.end("not found"); });
    stream.pipe(res);
  });
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });

async function probe(label, request) {
  const started = Date.now();
  try {
    const response = await request();
    const body = await response.text();
    return {
      label,
      outcome: response.ok ? "reachable" : "http_error",
      status: response.status,
      elapsed_ms: Date.now() - started,
      content_type: response.headers.get("content-type") || "",
      response_excerpt: body.slice(0, 180).replace(/[\r\n]+/g, " ")
    };
  } catch (error) {
    return {
      label,
      outcome: "network_or_cors_error",
      elapsed_ms: Date.now() - started,
      error_name: error?.name || "Error",
      error_message: String(error?.message || error).slice(0, 240)
    };
  }
}

try {
  const page = await browser.newPage();
  await page.goto(base + "/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.AUTH_SUPABASE && typeof SUPABASE_URL === "string" && typeof SUPABASE_KEY === "string", { timeout: 15000 });
  const config = await page.evaluate(() => ({ url: SUPABASE_URL, key: SUPABASE_KEY }));
  const endpoint = config.url.replace(/\/$/, "") + "/auth/v1/settings";
  const headers = { apikey: config.key, Accept: "application/json" };

  const nodeResult = await probe("node_https_auth_settings", () =>
    fetch(endpoint, { headers, signal: AbortSignal.timeout(8000) })
  );
  const browserResult = await page.evaluate(async ({ endpoint, headers }) => {
    const started = performance.now();
    try {
      const response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(8000) });
      const body = await response.text();
      return {
        label: "chromium_cors_auth_settings",
        outcome: response.ok ? "reachable" : "http_error",
        status: response.status,
        elapsed_ms: Math.round(performance.now() - started),
        content_type: response.headers.get("content-type") || "",
        response_excerpt: body.slice(0, 180).replace(/[\r\n]+/g, " ")
      };
    } catch (error) {
      return {
        label: "chromium_cors_auth_settings",
        outcome: "network_or_cors_error",
        elapsed_ms: Math.round(performance.now() - started),
        error_name: error?.name || "Error",
        error_message: String(error?.message || error).slice(0, 240)
      };
    }
  }, { endpoint, headers });

  console.log("SAFE_SUPABASE_CONNECTIVITY_DIAGNOSTIC=" + JSON.stringify({
    endpoint: new URL(endpoint).origin + "/auth/v1/settings",
    credentialed_login_attempted: false,
    database_or_trainee_data_accessed: false,
    results: [nodeResult, browserResult]
  }));
  await page.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
