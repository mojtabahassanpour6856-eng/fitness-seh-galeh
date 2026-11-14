# Offline continuity prototype (isolated)

This is a standalone, synthetic UI/state-machine experiment. It is not imported by `index.html`, is not registered in the production service worker, and does not connect to Supabase.

## Goal

When an already-open app loses connectivity, retain the non-sensitive app shell instead of bouncing the user to the public introduction/login screen. Server-dependent actions remain unavailable until identity is verified online again.

## Security boundary

- The local marker stores only a version and the allow-listed shell view `home`.
- It is **not** an authentication credential and never proves that a user is signed in.
- No access/refresh token, user ID, role, trainee data, payment, receipt, analysis file, private API response or form submission is stored.
- Offline state exposes no private records and permits no server mutations.
- On reconnection, the real app must validate the user against the server (for Supabase, an online `getUser()`/equivalent check); a locally cached `getSession()` result alone is not proof of fresh server validation.
- If validation fails, the app must require normal online sign-in. Do not silently switch accounts or restore a private view under a different user.
- This prototype intentionally does not implement offline writes or a queue.

## States

- `authenticated-online`: online and identity freshly verified.
- `offline-limited`: a safe shell marker exists; preserve the shell only.
- `offline-guest`: no marker; show public/offline entry screen.
- `reauth-required`: connectivity is back but server identity validation has not succeeded.

## Run

Open `index.html` through a local static server (ES modules require an HTTP origin). Buttons simulate connectivity and identity-validation outcomes. The demo uses browser localStorage only for the safe shell marker.

## Tests

Run with Node.js 18+:

```sh
node --test tests/offline-continuity.test.mjs
```

The test file is located at the repository's `tests/offline-continuity.test.mjs`.

## Not yet proven

This prototype does not yet demonstrate integration with the live app's auth lifecycle, browser restart behavior, multi-tab coordination, or Android installed-PWA behavior. Those require a separate integration test branch/device matrix before any production change.