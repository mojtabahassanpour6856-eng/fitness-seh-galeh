# Offline continuity: production auth integration findings

Date: 2026-11-14

## Confirmed current architecture

### 1. The service worker already preserves the static app shell

The current `sw.js`:
- caches `index.html` and a constrained allow-list of same-origin static assets;
- serves the cached app entry when navigation fails or the server returns an error;
- uses an 800 ms navigation fallback so a slow network does not keep the user on a blank navigation;
- does not intercept Supabase/API requests, unknown dynamic paths, or POST writes.

The existing `tests/service-worker-shell-cache.test.mjs` verifies offline navigation fallback, slow-network fallback, 5xx/404 fallback, known static assets, and that Supabase/API and POST requests bypass the cache. The corresponding workflow also defines a real Chromium browser smoke test.

**Conclusion:** the static shell cache is already in place. The remaining observed risk is likely in the authentication/bootstrap layer after the shell has loaded, not a missing general-purpose API cache.

### 2. The auth restore watchdog does not currently gate restoration on connectivity

The production script `seh-auth-session-restore-watchdog-v1`:
- starts a saved-session restore after page startup;
- retries on `pageshow` and when the document becomes visible;
- reads the saved Supabase session through `__sehGetSessionSingleFlight()`;
- calls `window.finishLogin(session.user)` when a user is present;
- catches and logs failures, then leaves the remaining app state to the existing login flow.

There is no `navigator.onLine`/offline-state gate in this watchdog.

### 3. The login finalizer needs server access

The current `finishLogin(user)`:
- queries `profiles` for the user ID;
- if no profile row is returned, attempts `auth.refreshSession()` and retries the profile query;
- removes the app's `locked` body class and reveals the authenticated UI only after profile resolution.

Consequently, an offline reload can successfully recover a locally persisted Supabase session but still fail while resolving the profile from the server. The service worker may have delivered the app shell correctly while the app remains on its locked/auth screen.

This is a code-path explanation consistent with the reported symptom, not yet a reproduction on the user's Android device.

## Safe integration design

1. **Do not call sign-out or clear the Supabase persisted session merely because connectivity is lost.**
2. After a successful, server-verified `finishLogin`, persist only a minimal, versioned safe-shell marker. Do not persist tokens, user IDs, roles, profile data, trainee records, payment data, or API responses in this marker.
3. If startup occurs offline and a valid safe-shell marker exists, render a restricted offline shell state instead of repeatedly invoking profile lookup/refresh and leaving the user on the public login screen.
4. The offline shell must not treat the marker or a locally cached `getSession()` result as proof of fresh authentication. Do not expose private trainee data or enable writes unless the appropriate data was separately designed, cached, and protected—which is explicitly out of scope here.
5. If the user was already authenticated and the network drops while the app is open, do not blank or lock the already-rendered shell solely because of the offline event. Show an offline status and disable server-dependent actions.
6. On `online`, run one deduplicated server-side identity/profile validation. Restore private functionality only after it succeeds. If validation fails or times out, remain in restricted mode and preserve the saved session for a later retry; do not silently switch accounts.
7. Do not automatically queue writes in this phase. Payments, receipts, file uploads, destructive operations, and all other mutations remain blocked while offline.

## Required integration tests before any production patch

- Previously authenticated app loses network without navigation or visual lockout.
- Previously authenticated app is reopened offline and receives only the restricted shell.
- Offline startup with no valid marker remains on the public entry screen.
- Network returns but profile lookup times out: restricted state remains, session is not cleared.
- Network returns and server confirms the same account: private app functionality is restored once.
- Account switch or sign-out invalidates the prior safe-shell marker.
- Two tabs and repeated `pageshow`/visibility events do not duplicate login/profile requests.
- Existing service-worker tests continue to prove that API responses and POST writes are never cached or replayed.

## Current release boundary

This document and the standalone prototype are isolated on `experiment/offline-continuity-prototype-20261114`. No production `index.html`, `sw.js`, Supabase configuration, database rows, RLS policies, or student data were modified. Do not merge to `main` until the integration test matrix above passes on desktop and Android installed-PWA/browser contexts.
