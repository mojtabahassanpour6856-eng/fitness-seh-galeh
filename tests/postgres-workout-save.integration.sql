\set ON_ERROR_STOP on

-- Verify least-privilege RPC grants and RLS posture in disposable PostgreSQL.
-- Guard the per-trainee transaction-lock contract against accidental removal.
-- This is a static regression assertion, NOT a multi-session concurrency test.
do $lock_contract$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.save_trainee_workout_plan_transaction(uuid,bigint,jsonb,jsonb,jsonb)'::regprocedure
  ) into v_definition;

  if position('pg_advisory_xact_lock' in v_definition) = 0 then
    raise exception 'RPC is missing its transaction-scoped advisory lock';
  end if;
  if position('hashtextextended(p_trainee_id::text, 0)' in v_definition) = 0 then
    raise exception 'RPC advisory lock is not keyed by trainee id';
  end if;
  if position('pg_advisory_xact_lock' in v_definition) >
     position('select count(*)::integer' in v_definition) then
    raise exception 'RPC must acquire the trainee lock before checking existing plans';
  end if;
  if position('pg_advisory_xact_lock' in v_definition) >
     position('insert into public.trainee_workout_plans' in v_definition) then
    raise exception 'RPC must acquire the trainee lock before any plan insert';
  end if;
  if position('order by e.id' in v_definition) = 0 or
     position('order by e.id' in v_definition) >
     position('select jsonb_build_object' in v_definition) then
    raise exception 'RPC must lock existing exercise rows before snapshot construction';
  end if;
  if position('perform 1' in v_definition) >
     position('order by e.id' in v_definition) then
    raise exception 'Exercise-row locking statement is missing';
  end if;
end
$lock_contract$;

do $$
declare
  v_signature text := 'public.save_trainee_workout_plan_transaction(uuid,bigint,jsonb,jsonb,jsonb)';
begin
  if not has_function_privilege('authenticated', v_signature, 'EXECUTE') then
    raise exception 'authenticated role must be able to execute the RPC';
  end if;
  if has_function_privilege('anon', v_signature, 'EXECUTE') then
    raise exception 'anon role must not be able to execute the RPC';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = v_signature::regprocedure) then
    raise exception 'RPC must remain SECURITY INVOKER';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.trainee_workout_plans'::regclass) then
    raise exception 'RLS must remain enabled on trainee_workout_plans';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.trainee_workout_exercises'::regclass) then
    raise exception 'RLS must remain enabled on trainee_workout_exercises';
  end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);
select set_config('test.is_coach', 'true', false);
select set_config('test.trainee_id', '11111111-1111-4111-8111-111111111111', false);

do $$
declare
 r jsonb;
 v_plan_id bigint;
 v_old_title text;
 v_old_exercise_id bigint;
 v_old_count integer;
 v_failed boolean;
 v_snapshot jsonb;
 v_stale_snapshot jsonb;
 v_big_exercises jsonb;
 v_empty_plan_id bigint;
begin
 r := public.save_trainee_workout_plan_transaction(
  '11111111-1111-4111-8111-111111111111', null, null,
  '{"title":"پیش‌نویس آزمایشی","plan_date":"2026-10-21","goal":"قدرت","notes":null}'::jsonb,
  '[{"exercise_id":101,"sets":3,"reps":"10","rest_seconds":60,"sort_order":1,"training_system":"normal","training_day":"جلسه اول","is_completed":false}]'::jsonb
 );
 v_plan_id := (r->>'plan_id')::bigint;
 v_snapshot := r->'plan_snapshot';
 v_stale_snapshot := v_snapshot;
 if (r->>'exercise_count')::integer <> 1 then raise exception 'create count mismatch'; end if;

 r := public.save_trainee_workout_plan_transaction(
  '11111111-1111-4111-8111-111111111111', v_plan_id, v_snapshot,
  '{"title":"برنامه جایگزین","plan_date":"2026-10-22","goal":"عضله‌سازی","notes":"نسخه دوم"}'::jsonb,
  '[{"exercise_id":102,"sets":4,"reps":"8","rest_seconds":90,"sort_order":1,"training_system":"normal","training_day":"جلسه اول","is_completed":false}]'::jsonb
 );
 v_snapshot := r->'plan_snapshot';
 if (r->>'updated_existing_plan')::boolean is not true then raise exception 'update flag mismatch'; end if;
 select title into v_old_title from public.trainee_workout_plans where id=v_plan_id;
 select exercise_id into v_old_exercise_id from public.trainee_workout_exercises where workout_plan_id=v_plan_id;
 if v_old_title <> 'برنامه جایگزین' or v_old_exercise_id <> 102 then raise exception 'replace failed'; end if;

 -- An exercise-only change must invalidate the preview snapshot too.
 -- This covers a trainee completion toggle occurring while a coach editor is open.
 update public.trainee_workout_exercises
    set is_completed = true
  where workout_plan_id = v_plan_id;
 v_failed := false;
 begin
  perform public.save_trainee_workout_plan_transaction(
   '11111111-1111-4111-8111-111111111111', v_plan_id, v_snapshot,
   '{"title":"ذخیره پس از تغییر انجام تمرین","plan_date":"2026-10-23"}'::jsonb,
   '[{"exercise_id":101,"sets":3,"reps":"10","rest_seconds":60,"sort_order":1,"training_system":"normal","training_day":"جلسه اول","is_completed":false}]'::jsonb
  );
 exception when others then v_failed := true;
 end;
 if not v_failed then raise exception 'snapshot with stale exercise completion state unexpectedly accepted'; end if;
 select title into v_old_title from public.trainee_workout_plans where id=v_plan_id;
 if v_old_title <> 'برنامه جایگزین' then raise exception 'stale exercise snapshot changed plan metadata'; end if;
 if not (select is_completed from public.trainee_workout_exercises where workout_plan_id=v_plan_id) then
  raise exception 'stale exercise snapshot overwrote the newer completion state';
 end if;
 -- Restore the fixture to the original snapshot so following tests stay independent.
 update public.trainee_workout_exercises
    set is_completed = false
  where workout_plan_id = v_plan_id;

 -- A correct snapshot must not authorize writing to a different plan id.
 v_failed := false;
 begin
  perform public.save_trainee_workout_plan_transaction(
   '11111111-1111-4111-8111-111111111111', v_plan_id + 999, v_snapshot,
   '{"title":"شناسه برنامه اشتباه","plan_date":"2026-10-23"}'::jsonb,
   '[{"exercise_id":101,"sets":3,"reps":"10","rest_seconds":60,"sort_order":1,"training_system":"normal","training_day":"جلسه اول","is_completed":false}]'::jsonb
  );
 exception when others then v_failed := true;
 end;
 if not v_failed then raise exception 'mismatched expected plan id unexpectedly accepted'; end if;
 select title into v_old_title from public.trainee_workout_plans where id=v_plan_id;
 select exercise_id into v_old_exercise_id from public.trainee_workout_exercises where workout_plan_id=v_plan_id;
 if v_old_title <> 'برنامه جایگزین' or v_old_exercise_id <> 102 then
  raise exception 'mismatched plan id changed the existing plan';
 end if;

 -- A stale preview snapshot must be rejected even though the plan id is unchanged.
 v_failed := false;
 begin
  perform public.save_trainee_workout_plan_transaction(
   '11111111-1111-4111-8111-111111111111', v_plan_id, v_stale_snapshot,
   '{"title":"ذخیره قدیمی","plan_date":"2026-10-23"}'::jsonb,
   '[{"exercise_id":101,"sets":3,"reps":"10","rest_seconds":60,"sort_order":1,"training_system":"normal","training_day":"جلسه اول","is_completed":false}]'::jsonb
  );
 exception when others then v_failed := true;
 end;
 if not v_failed then raise exception 'stale snapshot unexpectedly accepted'; end if;
 select title into v_old_title from public.trainee_workout_plans where id=v_plan_id;
 select exercise_id into v_old_exercise_id from public.trainee_workout_exercises where workout_plan_id=v_plan_id;
 if v_old_title <> 'برنامه جایگزین' or v_old_exercise_id <> 102 then raise exception 'stale snapshot changed plan'; end if;

 v_failed := false;
 begin
  perform public.save_trainee_workout_plan_transaction(
   '11111111-1111-4111-8111-111111111111', v_plan_id, v_snapshot,
   '{"title":"نباید ذخیره شود","plan_date":"2026-10-23"}'::jsonb,
   '[{"exercise_id":999999,"sets":3,"reps":"10","rest_seconds":60,"sort_order":1,"training_system":"normal","training_day":"جلسه اول","is_completed":false}]'::jsonb
  );
 exception when others then v_failed := true;
 end;
 if not v_failed then raise exception 'invalid exercise unexpectedly accepted'; end if;
 select title into v_old_title from public.trainee_workout_plans where id=v_plan_id;
 if v_old_title <> 'برنامه جایگزین' then raise exception 'invalid exercise changed plan'; end if;

 select title into v_old_title from public.trainee_workout_plans where id=v_plan_id;
 select exercise_id into v_old_exercise_id from public.trainee_workout_exercises where workout_plan_id=v_plan_id;
 select count(*) into v_old_count from public.trainee_workout_exercises where workout_plan_id=v_plan_id;
 perform set_config('test.fail_exercise_insert', 'on', false);
 v_failed := false;
 begin
  perform public.save_trainee_workout_plan_transaction(
   '11111111-1111-4111-8111-111111111111', v_plan_id, v_snapshot,
   '{"title":"شکست اجباری","plan_date":"2026-10-24","goal":"نباید تغییر کند"}'::jsonb,
   '[{"exercise_id":101,"sets":5,"reps":"5","rest_seconds":120,"sort_order":1,"training_system":"normal","training_day":"جلسه اول","is_completed":false}]'::jsonb
  );
 exception when others then
  if sqlerrm not like '%TEST_FORCED_INSERT_FAILURE%' then raise; end if;
  v_failed := true;
 end;
 perform set_config('test.fail_exercise_insert', 'off', false);
 if not v_failed then raise exception 'forced failure did not occur'; end if;
 select title into v_old_title from public.trainee_workout_plans where id=v_plan_id;
 select exercise_id into v_old_exercise_id from public.trainee_workout_exercises where workout_plan_id=v_plan_id;
 select count(*) into v_old_count from public.trainee_workout_exercises where workout_plan_id=v_plan_id;
 if v_old_title <> 'برنامه جایگزین' or v_old_exercise_id <> 102 or v_old_count <> 1 then
  raise exception 'ROLLBACK FAILED: original plan or exercise rows changed';
 end if;

 perform set_config('test.is_coach', 'false', false);
 v_failed := false;
 begin
  perform public.save_trainee_workout_plan_transaction(
   '11111111-1111-4111-8111-111111111111', v_plan_id, v_snapshot,
   '{"title":"غیرمجاز","plan_date":"2026-10-25"}'::jsonb,
   '[{"exercise_id":101,"sets":3,"reps":"10","rest_seconds":60,"sort_order":1,"training_system":"normal","training_day":"جلسه اول","is_completed":false}]'::jsonb
  );
 exception when others then v_failed := true;
 end;
 if not v_failed then raise exception 'non-coach unexpectedly accepted'; end if;
 perform set_config('test.is_coach', 'true', false);

 v_failed := false;
 begin
  perform public.save_trainee_workout_plan_transaction(
   '22222222-2222-4222-8222-222222222222', null, null,
   '{"title":"شاگرد دیگر","plan_date":"2026-10-25"}'::jsonb,
   '[{"exercise_id":101,"sets":3,"reps":"10","rest_seconds":60,"sort_order":1,"training_system":"normal","training_day":"جلسه اول","is_completed":false}]'::jsonb
  );
 exception when others then v_failed := true;
 end;
 if not v_failed then raise exception 'inaccessible trainee unexpectedly accepted'; end if;


 -- Explicitly reject unauthenticated callers, not just authenticated non-coaches.
 perform set_config('request.jwt.claim.sub', '', false);
 v_failed := false;
 begin
  perform public.save_trainee_workout_plan_transaction(
   '11111111-1111-4111-8111-111111111111', v_plan_id, v_snapshot,
   '{"title":"بدون ورود","plan_date":"2026-10-25"}'::jsonb,
   '[{"exercise_id":101,"sets":3,"reps":"10","rest_seconds":60,"sort_order":1,"training_day":"جلسه اول"}]'::jsonb
  );
 exception when others then v_failed := true;
 end;
 if not v_failed then raise exception 'unauthenticated caller unexpectedly accepted'; end if;
 perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);

 -- Invalid dates and numeric/system fields must fail without changing the saved plan.
 v_failed := false;
 begin
  perform public.save_trainee_workout_plan_transaction(
   '11111111-1111-4111-8111-111111111111', v_plan_id, v_snapshot,
   '{"title":"تاریخ نامعتبر","plan_date":"2026-02-30"}'::jsonb,
   '[{"exercise_id":101,"sets":3,"reps":"10","rest_seconds":60,"sort_order":1,"training_day":"جلسه اول"}]'::jsonb
  );
 exception when others then v_failed := true;
 end;
 if not v_failed then raise exception 'invalid calendar date unexpectedly accepted'; end if;

 v_failed := false;
 begin
  perform public.save_trainee_workout_plan_transaction(
   '11111111-1111-4111-8111-111111111111', v_plan_id, v_snapshot,
   '{"title":"ست منفی","plan_date":"2026-10-25"}'::jsonb,
   '[{"exercise_id":101,"sets":-1,"reps":"10","rest_seconds":60,"sort_order":1,"training_day":"جلسه اول"}]'::jsonb
  );
 exception when others then v_failed := true;
 end;
 if not v_failed then raise exception 'negative sets unexpectedly accepted'; end if;

 v_failed := false;
 begin
  perform public.save_trainee_workout_plan_transaction(
   '11111111-1111-4111-8111-111111111111', v_plan_id, v_snapshot,
   '{"title":"استراحت منفی","plan_date":"2026-10-25"}'::jsonb,
   '[{"exercise_id":101,"sets":3,"reps":"10","rest_seconds":-1,"sort_order":1,"training_day":"جلسه اول"}]'::jsonb
  );
 exception when others then v_failed := true;
 end;
 if not v_failed then raise exception 'negative rest unexpectedly accepted'; end if;

 v_failed := false;
 begin
  perform public.save_trainee_workout_plan_transaction(
   '11111111-1111-4111-8111-111111111111', v_plan_id, v_snapshot,
   '{"title":"سیستم ناشناخته","plan_date":"2026-10-25"}'::jsonb,
   '[{"exercise_id":101,"sets":3,"reps":"10","rest_seconds":60,"sort_order":1,"training_system":"unknown-system","training_day":"جلسه اول"}]'::jsonb
  );
 exception when others then v_failed := true;
 end;
 if not v_failed then raise exception 'unsupported training system unexpectedly accepted'; end if;

 select title into v_old_title from public.trainee_workout_plans where id=v_plan_id;
 select exercise_id into v_old_exercise_id from public.trainee_workout_exercises where workout_plan_id=v_plan_id;
 if v_old_title <> 'برنامه جایگزین' or v_old_exercise_id <> 102 then
  raise exception 'invalid payload changed the existing plan';
 end if;

 -- Empty exercise arrays are rejected before any write.
 v_failed := false;
 begin
  perform public.save_trainee_workout_plan_transaction(
   '11111111-1111-4111-8111-111111111111', null, null,
   '{"title":"بدون حرکت","plan_date":"2026-10-25"}'::jsonb, '[]'::jsonb
  );
 exception when others then v_failed := true;
 end;
 if not v_failed then raise exception 'empty exercise array unexpectedly accepted'; end if;

 -- More than 100 exercises are rejected before writes.
 select jsonb_agg(jsonb_build_object(
   'exercise_id', 101, 'sets', 3, 'reps', '10', 'rest_seconds', 60,
   'sort_order', n, 'training_day', 'روز۱'
 )) into v_big_exercises from generate_series(1,101) n;
 v_failed := false;
 begin
  perform public.save_trainee_workout_plan_transaction(
   '11111111-1111-4111-8111-111111111111', null, null,
   '{"title":"تعداد زیاد","plan_date":"2026-10-25"}'::jsonb, v_big_exercises
  );
 exception when others then v_failed := true;
 end;
 if not v_failed then raise exception 'oversized exercise array unexpectedly accepted'; end if;

 -- Duplicate sort order is rejected.
 v_failed := false;
 begin
  perform public.save_trainee_workout_plan_transaction(
   '11111111-1111-4111-8111-111111111111', null, null,
   '{"title":"ترتیب تکراری","plan_date":"2026-10-25"}'::jsonb,
   '[{"exercise_id":101,"sets":3,"reps":"10","rest_seconds":60,"sort_order":1,"training_day":"روز۱"},{"exercise_id":102,"sets":3,"reps":"10","rest_seconds":60,"sort_order":1,"training_day":"روز۱"}]'::jsonb
  );
 exception when others then v_failed := true;
 end;
 if not v_failed then raise exception 'duplicate sort order unexpectedly accepted'; end if;

 -- A trainee outside the coach's permitted scope is denied.
 v_failed := false;
 begin
  perform public.save_trainee_workout_plan_transaction(
   '99999999-9999-4999-8999-999999999999', null, null,
   '{"title":"شاگرد نامعتبر","plan_date":"2026-10-25"}'::jsonb,
   '[{"exercise_id":101,"sets":3,"reps":"10","rest_seconds":60,"sort_order":1,"training_day":"روز۱"}]'::jsonb
  );
 exception when others then v_failed := true;
 end;
 if not v_failed then raise exception 'invalid trainee unexpectedly accepted'; end if;

 -- Existing plan with zero exercise rows still gets a non-null, comparable snapshot.
 perform set_config('test.trainee_id', '22222222-2222-4222-8222-222222222222', false);
 insert into public.trainee_workout_plans(trainee_id,title,plan_date,goal,notes)
 values ('22222222-2222-4222-8222-222222222222','empty-existing-plan','2026-10-25',null,null)
 returning id into v_empty_plan_id;

 r := public.save_trainee_workout_plan_transaction(
  '22222222-2222-4222-8222-222222222222',
  v_empty_plan_id,
  jsonb_build_object(
   'plan', jsonb_build_object(
    'id',v_empty_plan_id,'title','empty-existing-plan',
    'plan_date','2026-10-25','goal',null,'notes',null
   ),
   'exercises','[]'::jsonb
  ),
  '{"title":"empty-plan-replaced","plan_date":"2026-10-26"}'::jsonb,
  '[{"exercise_id":101,"sets":3,"reps":"10","rest_seconds":60,"sort_order":1,"training_system":"normal","training_day":"جلسه اول","is_completed":false}]'::jsonb
 );
 if (r->>'exercise_count')::integer <> 1 then raise exception 'empty existing plan replacement failed'; end if;
 select title into v_old_title from public.trainee_workout_plans where id=v_empty_plan_id;
 if v_old_title <> 'empty-plan-replaced' then raise exception 'empty existing plan title not updated'; end if;
end $$;

reset role;

-- Exercise-update trigger parity test. Run as fixture owner so this isolates
-- the trigger's authorization behavior from the fixture's simplified RLS helper.
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false);
select set_config('test.is_coach', 'false', false);
do $trigger_guard$
declare
 v_failed boolean := false;
 v_plan_id bigint;
begin
 select id into v_plan_id from public.trainee_workout_plans where title='برنامه جایگزین';
 if v_plan_id is null then raise exception 'trigger fixture plan missing'; end if;

 update public.trainee_workout_exercises
    set is_completed = true
  where workout_plan_id = v_plan_id;
 if not found then raise exception 'trainee could not update completion state in trigger test'; end if;

 begin
  update public.trainee_workout_exercises
     set sets = sets + 1
   where workout_plan_id = v_plan_id;
 exception when others then
  if sqlerrm not like '%Trainee may only update is_completed%' then raise; end if;
  v_failed := true;
 end;
 if not v_failed then raise exception 'trainee unexpectedly changed workout prescription'; end if;

 perform set_config('test.is_coach', 'true', false);
 update public.trainee_workout_exercises
    set sets = sets + 1
  where workout_plan_id = v_plan_id;
 if not found then raise exception 'coach update was not applied in trigger test'; end if;
end $trigger_guard$;



-- Production-shaped RLS parity: active trainee may read only their own scope.
-- The disposable helper uses profile/ownership fields when use_live_identity=on.
set role authenticated;
select set_config('test.use_live_identity', 'on', false);
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false);
do $rls_trainee$
declare
  v_count integer;
  v_failed boolean := false;
  v_plan_id bigint;
begin
  select count(*) into v_count from public.trainee_workout_plans
   where trainee_id='11111111-1111-4111-8111-111111111111';
  if v_count < 1 then raise exception 'active trainee could not read own workout plan'; end if;

  select count(*) into v_count from public.trainee_workout_plans
   where trainee_id='22222222-2222-4222-8222-222222222222';
  if v_count <> 0 then raise exception 'trainee read another trainee workout plan'; end if;

  select count(*) into v_count
    from public.trainee_workout_exercises e
    join public.trainee_workout_plans p on p.id=e.workout_plan_id
   where p.trainee_id='11111111-1111-4111-8111-111111111111';
  if v_count < 1 then raise exception 'active trainee could not read own workout exercises'; end if;

  select count(*) into v_count
    from public.trainee_workout_exercises e
    join public.trainee_workout_plans p on p.id=e.workout_plan_id
   where p.trainee_id='22222222-2222-4222-8222-222222222222';
  if v_count <> 0 then raise exception 'trainee read another trainee workout exercises'; end if;

  select id into v_plan_id from public.trainee_workout_plans
   where trainee_id='11111111-1111-4111-8111-111111111111' limit 1;

  -- Current production-shaped policy permits only coach UPDATE. The trigger's
  -- is_completed exception does not grant RLS access; prove the current denial.
  update public.trainee_workout_exercises
     set is_completed = not is_completed
   where workout_plan_id = v_plan_id;
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'fixture mismatch: trainee completion update unexpectedly passed current coach-only UPDATE policy';
  end if;

  begin
    perform public.save_trainee_workout_plan_transaction(
      '11111111-1111-4111-8111-111111111111', v_plan_id, null,
      '{"title":"unauthorized trainee save","plan_date":"2026-10-27"}'::jsonb,
      '[{"exercise_id":101,"sets":3,"reps":"10","rest_seconds":60,"sort_order":1,"training_day":"جلسه اول"}]'::jsonb
    );
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'trainee unexpectedly invoked coach-only RPC'; end if;
end $rls_trainee$;
reset role;

-- Candidate policy experiment, disposable DB only: an access-scoped UPDATE
-- policy lets the trigger's column guard permit is_completed but reject edits
-- to prescription fields. This policy is NOT installed in production.
create policy trainee_completion_update_candidate
on public.trainee_workout_exercises for update to authenticated
using (exists (
  select 1 from public.trainee_workout_plans p
  where p.id = workout_plan_id and private.can_access_trainee(p.trainee_id)
))
with check (exists (
  select 1 from public.trainee_workout_plans p
  where p.id = workout_plan_id and private.can_access_trainee(p.trainee_id)
));

set role authenticated;
select set_config('test.use_live_identity', 'on', false);
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false);
do $completion_candidate$
declare
  v_plan_id bigint;
  v_count integer;
  v_failed boolean := false;
begin
  select id into v_plan_id from public.trainee_workout_plans
   where trainee_id='11111111-1111-4111-8111-111111111111' limit 1;
  update public.trainee_workout_exercises
     set is_completed = true where workout_plan_id = v_plan_id;
  get diagnostics v_count = row_count;
  if v_count < 1 then raise exception 'candidate policy did not allow completion-state update'; end if;

  -- Every prescription/identity field must be protected by the live-shaped trigger.
  -- Reset the flag for each attempted write so one rejected update cannot mask another.
  v_failed := false;
  begin
    update public.trainee_workout_exercises set sets = sets + 1 where workout_plan_id = v_plan_id;
  exception when others then
    if sqlerrm not like '%Trainee may only update is_completed%' then raise; end if;
    v_failed := true;
  end;
  if not v_failed then raise exception 'candidate policy allowed sets edit by trainee'; end if;

  v_failed := false;
  begin
    update public.trainee_workout_exercises set reps = reps || '-tamper' where workout_plan_id = v_plan_id;
  exception when others then
    if sqlerrm not like '%Trainee may only update is_completed%' then raise; end if;
    v_failed := true;
  end;
  if not v_failed then raise exception 'candidate policy allowed reps edit by trainee'; end if;

  v_failed := false;
  begin
    update public.trainee_workout_exercises set rest_seconds = rest_seconds + 1 where workout_plan_id = v_plan_id;
  exception when others then
    if sqlerrm not like '%Trainee may only update is_completed%' then raise; end if;
    v_failed := true;
  end;
  if not v_failed then raise exception 'candidate policy allowed rest edit by trainee'; end if;

  v_failed := false;
  begin
    update public.trainee_workout_exercises set exercise_id = 101 where workout_plan_id = v_plan_id;
  exception when others then
    if sqlerrm not like '%Trainee may only update is_completed%' then raise; end if;
    v_failed := true;
  end;
  if not v_failed then raise exception 'candidate policy allowed exercise id edit by trainee'; end if;

  v_failed := false;
  begin
    update public.trainee_workout_exercises set sort_order = sort_order + 1 where workout_plan_id = v_plan_id;
  exception when others then
    if sqlerrm not like '%Trainee may only update is_completed%' then raise; end if;
    v_failed := true;
  end;
  if not v_failed then raise exception 'candidate policy allowed ordering edit by trainee'; end if;

  v_failed := false;
  begin
    update public.trainee_workout_exercises set training_system = 'superset' where workout_plan_id = v_plan_id;
  exception when others then
    if sqlerrm not like '%Trainee may only update is_completed%' then raise; end if;
    v_failed := true;
  end;
  if not v_failed then raise exception 'candidate policy allowed training system edit by trainee'; end if;

  v_failed := false;
  begin
    update public.trainee_workout_exercises set group_key = 'tamper-group' where workout_plan_id = v_plan_id;
  exception when others then
    if sqlerrm not like '%Trainee may only update is_completed%' then raise; end if;
    v_failed := true;
  end;
  if not v_failed then raise exception 'candidate policy allowed grouping edit by trainee'; end if;

  v_failed := false;
  begin
    update public.trainee_workout_exercises set training_day = 'tamper-day' where workout_plan_id = v_plan_id;
  exception when others then
    if sqlerrm not like '%Trainee may only update is_completed%' then raise; end if;
    v_failed := true;
  end;
  if not v_failed then raise exception 'candidate policy allowed training day edit by trainee'; end if;

  v_failed := false;
  begin
    update public.trainee_workout_exercises set notes = 'tampered' where workout_plan_id = v_plan_id;
  exception when others then
    if sqlerrm not like '%Trainee may only update is_completed%' then raise; end if;
    v_failed := true;
  end;
  if not v_failed then raise exception 'candidate policy allowed notes edit by trainee'; end if;

  v_failed := false;
  begin
    update public.trainee_workout_exercises set workout_plan_id = workout_plan_id + 1 where workout_plan_id = v_plan_id;
  exception when others then
    if sqlerrm not like '%Trainee may only update is_completed%' then raise; end if;
    v_failed := true;
  end;
  if not v_failed then raise exception 'candidate policy allowed moving exercise to another plan'; end if;
end $completion_candidate$;
reset role;

-- A different coach cannot write a plan for a trainee outside their assignment.
set role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', false);
select set_config('test.use_live_identity', 'on', false);
do $rls_wrong_coach$
declare
  v_failed boolean := false;
begin
  begin
    insert into public.trainee_workout_plans(trainee_id,title,plan_date)
    values ('11111111-1111-4111-8111-111111111111','cross-tenant write','2026-10-27');
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'unassigned coach wrote another coach trainee plan'; end if;
end $rls_wrong_coach$;
reset role;


select 'PASS: PostgreSQL integration tests, rollback, trigger guard, and trainee RLS scope' as result;
