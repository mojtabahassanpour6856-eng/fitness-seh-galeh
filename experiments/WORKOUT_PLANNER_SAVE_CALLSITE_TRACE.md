# Experimental workout planner — save-call-site trace

Date: 2026-10-22
Branch: `coach-workout-editor-isolated-preview`
Status: source-level trace only. No live app or database writes performed.

## Files traced
- `experiments/workout-template-planner.html`
- `experiments/workout-persistence-adapter.js`
- `fitness_seh_galeh_FINAL_CLEAN2.html` (the same-branch app copy used for the trace; this is not assumed to be the currently deployed production file)

## Call path observed

1. The planner button `sendToCoachApp` is the experiment's database-save entry point.
2. It reads the same-origin parent window context through `getWorkoutPlannerContext()`.
3. The planner initializes `atomicSaveEnabled = false` and only changes it to true when the returned context explicitly has `enableAtomicWorkoutSave === true`.
4. If that flag is false, the planner throws a stop message before calling the persistence adapter. This is fail-closed: no legacy direct-save fallback is called from this click handler.
5. If enabled, the click handler verifies the session/trainee read access, then calls only `saveToSupabaseAtomic()`. Its error is displayed to the user; there is no catch-block retry through `saveToSupabase()`.
6. The same-branch app copy's `getWorkoutPlannerContext()` returns the Supabase client, selected trainee ID, title, goal, and notes, but does **not** return `enableAtomicWorkoutSave`. Thus the inspected copy leaves atomic save disabled by default and the planner save button stops safely rather than writing.

## Conclusions

- In the traced experimental click path, no dual-writer fallback was found.
- The experiment is deliberately non-operational for database saving unless the parent context explicitly opts in.
- This is not proof that all deployed/production entry points have been traced: the same-branch app copy must not be presumed identical to the deployed GitHub Pages file without comparing its commit and content.
- The old `saveToSupabase()` implementation still exists in the adapter, and must remain unreachable from the experiment's save button during rollout. Do not enable the context flag until the RPC has been installed/reviewed in a disposable environment and its authenticated RLS/trigger behavior passes.

## Next required tests

1. Browser test: default context (no opt-in flag) produces the safe stop message and makes zero table writes and zero RPC calls.
2. Browser test: opt-in true + RPC rejection makes one RPC attempt and zero legacy REST mutations.
3. Browser test: repeated clicks are blocked while a save is in progress; the button is restored after success/error.
4. Verify read-after-write by fetching plan metadata and ordered exercise rows after RPC success.
5. Compare the exact currently deployed app file with the branch copy before claiming production call-site coverage.
6. Run actual coach-session/RLS/exercise-trigger integration tests in a disposable database fixture. Do not use production trainee records.

## Safety status

No SQL migration was deployed, no live trainee data was changed, and no trainee-facing UI was modified by this audit.
