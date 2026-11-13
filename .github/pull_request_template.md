## Problem and expected result
<!-- What user-facing problem does this change solve? -->

## Scope
- Roles affected: [ ] Coach [ ] Trainee [ ] Both
- Screens/flows affected:
- External services affected:
- Data/auth/RLS/schema changes: [ ] No [ ] Yes (explain below)

## Data safety
- [ ] No trainee data is deleted, rewritten, or migrated.
- [ ] Automated tests use mocks or disposable data only.
- [ ] Backup and rollback plan documented if persistent data/schema is affected.

## Automated checks
- [ ] Syntax/static checks
- [ ] Relevant unit/regression tests
- [ ] Browser tests (mobile and desktop)
- [ ] Save/reload/revisit checks where applicable
- [ ] No unexpected console/network errors

Test run links and results:

## Manual acceptance
| Device/browser | Role | Network condition | Flow checked | Result (pass/fail/not tested) |
|---|---|---|---|---|
| Android Chrome | Trainee | Online | Login + dashboard | |
| Android Chrome | Trainee | Offline then reconnect | Cached screen + refresh | |
| iPhone Safari | Trainee | Online | Login + dashboard | |
| Desktop browser | Coach | Online | Relevant coach flow | |

Screenshots/reproduction notes:

## Release and rollback
- Candidate commit:
- Known-good rollback commit:
- Known limitations:
- [ ] All applicable checks passed
- [ ] Manual acceptance recorded
- [ ] Explicit release approval obtained
- [ ] This PR is ready for review (remove Draft only after acceptance)
