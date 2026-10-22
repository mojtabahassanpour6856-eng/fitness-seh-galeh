\set ON_ERROR_STOP on
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
select 'PASS: PostgreSQL integration tests including forced transaction rollback' as result;
