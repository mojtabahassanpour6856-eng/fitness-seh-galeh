# Controlled Release Process

## Purpose
Protect the production app and trainee records by shipping reviewed, tested batches instead of frequent unverified changes.

## Environments
- **Production:** GitHub Pages from `main`. A push or merge to `main` deploys automatically.
- **Preview:** a feature or release-candidate branch and its pull request. Preview changes must not be treated as production.
- **Data safety:** browser tests use mocks or disposable databases. Never run destructive tests against production Supabase or real trainee records.

## Non-negotiable rules
1. Do not commit directly to `main`; all application changes go through a pull request.
2. One release batch should have one clear purpose and a written change list.
3. Keep unrelated features out of the same batch. Group changes only when they are intended to ship together.
4. Before coding, identify affected screens, roles (coach/trainee), data paths, external services, and likely regression risks.
5. Do not change database schema, RLS policies, authentication, or stored trainee data as part of a UI-only batch.
6. Any database migration must be reviewed separately, include a backup/rollback plan, and be tested against disposable data first.
7. Never merge a draft PR or a PR with pending/failed required checks.
8. Never merge or deploy on the basis of automated tests alone when the change affects a user-visible workflow; complete the relevant manual acceptance checks too.
9. After deployment, verify the production URL and monitor the release before starting another production batch.
10. If a release causes a regression, stop further releases and roll back to the last known-good commit.

## Required pull request information
Every PR must state:
- User problem and expected result.
- Screens, roles, and flows affected.
- Files and data/services affected.
- Explicit statement whether database/auth/RLS changes are included.
- Automated tests added or run.
- Manual test matrix and results.
- Known limitations and rollback commit/ref.

## Test gates

### Gate A — Static and automated
- Syntax checks and relevant unit/regression tests.
- Browser tests at narrow mobile, common mobile, tablet, and desktop widths.
- Coach and trainee role separation.
- Save, reload, and revisit flows for changed data.
- No unexpected console errors or failed network requests.
- Mock/disposable database only for automated integration tests.

### Gate B — Manual acceptance
For user-facing changes, test at least:
- Android Chrome, narrow and typical phone widths.
- iPhone Safari when available.
- Coach account and trainee account separately.
- Fresh session and existing session.
- Stable internet, slow/interrupted internet, and reconnect.
- Reload after reconnect; verify that stale UI does not misrepresent saved state.
- Persian text, long names, large text/accessibility settings where relevant.

Record device/browser, viewport, network condition, exact build/commit, result, and screenshot or reproduction notes. If a device is unavailable, mark the check **not tested**, never passed.

### Gate C — Release candidate
- Freeze the candidate commit; do not add unrelated commits during acceptance.
- All applicable CI checks are green.
- Manual acceptance checks are recorded.
- Confirm production data is untouched by tests.
- Confirm rollback target and deployment owner.
- Obtain explicit release approval before merging/deploying.

### Gate D — Post-deploy
- Confirm GitHub Pages deployment completed.
- Open the production URL in a fresh browser session.
- Verify login, dashboard, and the changed critical flow with a test account.
- Check that the deployed commit matches the approved candidate.
- Keep the previous known-good commit recorded.

## Batch and versioning
Use a release branch such as `release/2026-11-stability-01`. Keep feature work in separate branches and merge it into the release candidate only after its own checks pass. Use a release tag such as `v2026.11.01` after production acceptance. Maintain a short release note listing fixes, features, and known issues.

## Network reliability is a separate release track
Do not treat a successful login on one ISP or one VPN state as proof of nationwide availability. Track separately:
- Static app hosting and asset delivery.
- Authentication endpoints.
- Supabase/API connectivity.
- Third-party scripts/fonts/CDNs.
- DNS, TLS, redirects, and cache behavior.

Use a reproducible matrix of ISP/operator, region, device/browser, VPN on/off, and timestamp. Never claim nationwide no-VPN compatibility without representative evidence. Avoid moving production hosting or changing auth/data providers as a quick fix; first identify which request fails and where.

## Current repository observation
At the time this process document was drafted, the `main` branch was not protected by GitHub branch protection (the API reported `protected: false`). Repository administrators should enable protection/rulesets requiring pull requests and successful status checks before relying on this process as an enforced control. Documentation alone does not block direct pushes.

## Rollback
1. Stop merges and further deployments.
2. Identify the last known-good production commit.
3. Revert the faulty production change through a reviewed PR (preferred) or use the repository's approved emergency rollback procedure.
4. Verify the production app and critical data paths.
5. Preserve logs and create a regression test before attempting the fix again.

## Current release-candidate notes
- PR #218 is a draft candidate for the trainee mobile dashboard/logout regression only.
- Its five associated CI workflow runs passed.
- Automated tests do not replace real-device acceptance, especially for offline behavior and cached assets.
- PR #218 has not been merged; production remains unchanged by that PR.
