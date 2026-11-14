# Android acceptance checklist — offline-safe shell

This checklist is a manual release gate for the experimental offline auth-shell change. It must be run against a dedicated preview build, not by changing the production `main` branch.

## Test environments

Run separately in:
1. Chrome on Android.
2. The installed PWA added to the Android home screen.

Use one coach test account and one trainee test account. Do not use a real trainee's private records for the test.

## Before testing

- Open the preview while online and complete a normal sign-in.
- Confirm the normal coach/trainee screen loads.
- Allow the app to finish loading once so the service worker can install and cache the static shell.
- Do not create, edit, or delete any student records during these tests.

## Scenarios and expected results

### A. Network drops while the app is already open

1. Open the app and sign in normally.
2. Turn on Airplane mode.
3. Continue navigating only within already-open, non-destructive screens.

Expected:
- The app does not sign out or navigate to the login/introduction screen.
- Already-rendered UI remains visible.
- Server-dependent requests may fail gracefully.
- No queued write, payment, receipt, or file upload is replayed.

### B. Close and reopen while offline after a successful online sign-in

1. Restore internet and open the app once.
2. Close the app/browser fully.
3. Turn on Airplane mode.
4. Reopen the app.

Expected:
- The app shows the restricted branded shell and offline notice.
- The private navigation, trainee lists, profile details, payments, analysis reports, and app sections remain hidden.
- No session/profile network request is required to show this restricted shell.
- The offline marker is not treated as proof of authentication.

### C. Reconnect after restricted offline startup

1. Keep the app on the restricted shell.
2. Turn internet back on.

Expected:
- The app validates the existing session/profile with the server.
- The restricted shell is removed only after the authenticated UI is successfully restored.
- If validation fails or times out, the restricted shell remains and the stored session is not cleared.

### D. No prior safe marker

1. Use a clean browser profile or clear only the preview site's local data.
2. Open the preview offline.

Expected:
- The app remains on the public login/entry screen.
- No private content appears.

### E. Sign-out and account switch

1. Sign in as the coach, then sign out while online.
2. Turn internet off and reopen the app.
3. Repeat with the trainee test account, then switch accounts online.

Expected:
- Sign-out/account transitions invalidate the previous safe-shell marker.
- No previous account's private data is displayed.
- Without a current safe marker, offline startup stays on the public entry screen.

### F. Intermittent network / captive portal

1. Keep the device online according to Android's network indicator, but make the Supabase/API host unreachable (for example through a controlled test proxy).
2. Reopen the preview.

Expected:
- A failed profile lookup does not clear the persisted session.
- If a valid safe marker exists, only the restricted shell is shown.
- The app does not expose private data merely because `navigator.onLine` reports true.

## Release criteria

- All scenarios pass in both Android Chrome and installed PWA mode.
- Repeat the close/reopen/offline/reconnect cycle at least three times.
- No data changes are made during testing.
- Capture screenshots of the restricted shell and successful reconnect state for the release record.
- Any unexpected private content, duplicate write, sign-out, or blank screen blocks release.

## Not covered

This release does not enable offline data browsing, offline edits, offline payments, receipt submissions, file uploads, or background write synchronization.
