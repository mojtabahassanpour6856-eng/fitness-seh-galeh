# Network reliability audit — 2026-11-13

## Scope and safety
This is a source-code audit of the current `main` commit `f3e6b820fb766c94644b3c61f356eb4d80ebb379`. No production code, hosting, DNS, authentication, database, RLS, or trainee records were changed.

## Findings confirmed from source

### 1. The app depends on multiple external origins
The main page references:
- GitHub Pages for the app and its local files.
- `cdn.jsdelivr.net` for `@supabase/supabase-js@2`.
- `unpkg.com` as a fallback for the Supabase JS library.
- `qfakyudgidsumeuoqoot.supabase.co` for Auth, REST/Data API, and Edge Functions.
- `cdnjs.cloudflare.com` for html2canvas.
- `fonts.googleapis.com` for Vazirmatn in generated/exported output.
- Open Food Facts is called for the optional food lookup feature.

A successful page load does not prove the Supabase Auth/API origin is reachable; a successful Supabase health request does not prove either CDN is reachable. These must be tested independently on each carrier/network.

### 2. Supabase JS is not pinned to an exact version
The production HTML preloads and loads `@supabase/supabase-js@2` (major-version alias), then falls back to `@supabase/supabase-js@2` on unpkg. The resolved minor/patch can change without an app commit. This makes production less reproducible and can introduce behavior changes outside the app's release process.

**Recommendation:** after recording the current resolved library version and testing it, pin both CDN URLs to the same exact tested version. Do not change the version blindly in this audit PR.

### 3. Fallback only runs after a script load error
The fallback is wired through the script tag's `onerror`. It does not impose a bounded timeout if the first CDN connection stalls indefinitely. The login recovery code also depends on `window.supabase.createClient`; if neither source loads, login cannot proceed.

**Recommendation:** a later code change should use a bounded loader with explicit timeout, sequential fallback, and a clear on-screen message. It must not silently report a bad password when the library itself failed to load.

### 4. Service worker is not an offline application cache
The current `sw.js` handles install, activate, push, and notification clicks, but has no `fetch` event handler and does not precache or serve the app shell. Therefore it is a push-notification worker, not an offline-capable PWA cache.

This means an installed app may display browser/OS cached content while offline, but the service worker does not guarantee an up-to-date app shell or offline functionality. A stale-looking screen after connectivity loss is plausible; it is not proof that the latest deployment was fetched.

**Recommendation:** define explicit product behavior first:
- If offline use is not supported, show a clear offline/reconnect state and avoid presenting stale data as current.
- If offline use is required, design an explicit versioned app-shell cache and safe update/activation flow. Do not cache authenticated API responses, tokens, or private trainee data in a generic cache.

### 5. The main app is a very large single HTML document
The current `index.html` is about 1.3 MB and contains a large amount of inline application logic. A single parse/runtime error or a slow download can affect many unrelated features at once.

**Recommendation:** gradually split code into tested, versioned modules in a separate modernization project. Do not perform a large rewrite as part of the immediate connectivity fix.

### 6. Existing error telemetry is local only
The app stores the most recent script error in `window.__fitnessLastScriptError` and logs several failures to the browser console. This is useful for local diagnosis but does not provide a central view of which ISP, browser, or endpoint is failing. No user monitoring/analytics service was added.

**Recommendation:** first collect privacy-safe, user-submitted diagnostic reports. Any future telemetry must be opt-in/minimized and must never include passwords, tokens, trainee identifiers, health data, or request bodies.

## Diagnostic test page
`experiments/connection-diagnostics.html` runs read-only reachability and timing probes for:
- The production GitHub Pages origin and its manifest/service-worker files.
- Supabase Auth health endpoint.
- The exact CDN families used by the app (jsDelivr, unpkg, cdnjs, Google Fonts).

It reports browser/network metadata when exposed by the browser, HTTP status/timing, and service-worker registrations. It does not read localStorage, sessionStorage, cookies, auth sessions, API keys, or trainee data.

The page must be opened from a served HTTPS origin for meaningful same-origin checks. It is not yet on the production site because this PR is not merged.

## What source audit cannot prove
This repository inspection cannot establish nationwide reachability from Iranian carriers, regional DNS behavior, filtering, TLS interception, packet loss, or actual phone behavior. The diagnostic page must be run on representative real devices and networks with VPN off/on, and the report compared.

## Test matrix to collect
For each run, record:
- City/region (coarse only), operator/ISP, Wi-Fi or mobile data.
- Android/iOS and browser/PWA.
- VPN off/on.
- Timestamp and whether the app itself opens.
- Diagnostic report.

Do not send screenshots containing passwords, phone numbers, tokens, or trainee records.

## Recommended order of remediation
1. Collect diagnostic reports from at least 3 different networks/operators, including one failure case.
2. Pin the Supabase JS dependency to a tested exact version and implement bounded CDN fallback.
3. Add a clear online/offline/reconnecting state; do not imply offline support.
4. Decide whether offline app-shell support is required. If yes, implement a versioned, carefully scoped cache with explicit stale-data warnings and a rollback path.
5. After each item, run mobile browser tests and a real-device acceptance matrix before a release batch.

## Release safety
This audit is documentation and an isolated diagnostic page only. No production changes have been deployed. Do not merge until the diagnostic page and its privacy scope are reviewed.
