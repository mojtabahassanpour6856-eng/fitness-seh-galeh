# Atomic workout-save integration test plan

Run this only against a disposable Supabase development branch after applying
`supabase/migrations/202610220001_save_trainee_workout_plan_atomic.sql`.
Never run the rollback/fixture steps against production data.

## Required authenticated integration cases

1. Coach creates a plan with 0 exercises. Verify returned `plan_id`, trainee id and date.
2. Coach creates a plan with 6 training-day labels and multiple exercise rows. Verify all rows and sort order.
3. Save supersets and trisets; verify `training_system` and `group_key` survive readback.
4. Update an existing plan with a complete exercise array. Verify old child rows are replaced, not duplicated.
5. Submit a non-existent `exercise_id` midway through the payload. The RPC must error and the entire transaction must roll back: plan header unchanged and original exercise rows still present.
6. Submit malformed JSON, missing `exercise_id`, invalid date, invalid integer, invalid boolean, and more than 120 exercises. Each request must fail without any partial writes.
7. Coach A submits a trainee owned by Coach B. Verify authorization error and zero writes.
8. Unauthenticated and trainee-role callers attempt the RPC. Verify rejection.
9. Concurrent updates: two clients save different complete snapshots to the same plan. Confirm the agreed conflict policy before production; the current function is transactional but does not yet implement optimistic version checks.
10. Read back using the existing trainee UI query path and verify the current trainee-facing output remains unchanged.

## Integration caveats
- The function treats `p_exercises` as the complete authoritative list and replaces every child row for that plan. Never call it with a partial list.
- The current production editor still performs header and movement writes through separate REST requests. Do not switch the button to this RPC until the editor has a reliable complete-draft representation and a stale-write/version policy.
- The function must be applied to a development branch and tested there before wiring the app. Production migration and frontend publication are separate approvals/steps.
