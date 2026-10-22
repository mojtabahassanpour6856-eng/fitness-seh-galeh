\set ON_ERROR_STOP on

-- Disposable PostgreSQL contract test for the atomic-save RPC.
-- This intentionally mocks only Supabase auth/authorization helpers; it does
-- not claim to replace a real Supabase permission/schema test.
create role anon;
create role authenticated;
create schema auth;
create schema private;

create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('app.test_uid', true), '')::uuid
$$;

create function private.is_coach() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.test_is_coach', true), 'false') = 'true'
$$;

create function private.can_access_trainee(p_trainee_id uuid) returns boolean
language sql stable as $$
  select p_trainee_id::text = coalesce(current_setting('app.test_trainee_id', true), '')
$$;

create sequence public.trainee_workout_plans_id_seq;
create sequence public.trainee_workout_exercises_id_seq;

create table public.trainee_workout_plans (
  id bigint primary key,
  trainee_id uuid not null,
  title text not null,
  plan_date date,
  goal text,
  notes text
);

create table public.exercises (
  id bigint primary key,
  name text not null
);
insert into public.exercises(id, name) values (101, 'Test squat'), (102, 'Test row');

create table public.trainee_workout_exercises (
  id bigint primary key,
  workout_plan_id bigint not null references public.trainee_workout_plans(id) on delete cascade,
  exercise_id bigint not null references public.exercises(id),
  sets integer,
  reps text,
  rest_seconds integer,
  notes text,
  sort_order integer,
  training_system text,
  group_key text,
  training_day text,
  is_completed boolean
);

-- Align sequences with the explicit IDs used by the migration.
select setval('public.trainee_workout_plans_id_seq', 1, false);
select setval('public.trainee_workout_exercises_id_seq', 1, false);

\i supabase/migrations/202610220001_save_trainee_workout_plan_atomic.sql
\i supabase/migrations/202610220002_experimental_workout_rpc_compat.sql

select set_config('app.test_uid', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
select set_config('app.test_is_coach', 'true', false);
select set_config('app.test_trainee_id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);

-- Create a plan and verify atomic insert/readback.
select public.save_trainee_workout_plan_atomic(
  null,
  '{"trainee_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","title":"Contract test","plan_date":"2026-10-22","goal":"strength","notes":"first"}'::jsonb,
  '[{"exercise_id":101,"sets":3,"reps":"10","rest_seconds":60,"sort_order":1,"training_system":"normal","training_day":"day1","is_completed":false}]'::jsonb
) as created \gset

do $$
declare n integer;
begin
  select count(*) into n from public.trainee_workout_plans where title = 'Contract test';
  if n <> 1 then raise exception 'create plan assertion failed'; end if;
  select count(*) into n from public.trainee_workout_exercises e
    join public.trainee_workout_plans p on p.id=e.workout_plan_id
    where p.title='Contract test';
  if n <> 1 then raise exception 'create exercise assertion failed'; end if;
end $$;

-- Verify update replaces the complete list and preserves grouped/day metadata.
do $$
declare
  v_plan_id bigint;
  n integer;
  v_group text;
  v_day text;
begin
  select id into v_plan_id from public.trainee_workout_plans where title = 'Contract test';
  perform public.save_trainee_workout_plan_atomic(
    v_plan_id,
    '{"trainee_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","title":"Contract test updated","plan_date":"2026-10-23","goal":"strength","notes":"updated"}'::jsonb,
    '[{"exercise_id":101,"sets":4,"reps":"8","sort_order":1,"training_system":"superset","group_key":"A","training_day":"day2"},{"exercise_id":102,"sets":4,"reps":"12","sort_order":2,"training_system":"superset","group_key":"A","training_day":"day2"}]'::jsonb
  );
  select count(*) into n from public.trainee_workout_exercises where workout_plan_id=v_plan_id;
  if n <> 2 then raise exception 'full-list replacement assertion failed: expected 2 rows, got %', n; end if;
  select group_key, training_day into v_group, v_day
    from public.trainee_workout_exercises where workout_plan_id=v_plan_id order by sort_order limit 1;
  if v_group <> 'A' or v_day <> 'day2' then raise exception 'group/day metadata readback failed'; end if;
  if not exists(select 1 from public.trainee_workout_plans where id=v_plan_id and title='Contract test updated' and plan_date='2026-10-23') then
    raise exception 'header update assertion failed';
  end if;
end $$;

-- Invalid exercise FK must roll back both header changes and child-list replacement.
do $$
declare
  v_plan_id bigint;
  n integer;
  v_title text;
begin
  select id, title into v_plan_id, v_title from public.trainee_workout_plans where title='Contract test updated';
  begin
    perform public.save_trainee_workout_plan_atomic(
      v_plan_id,
      '{"trainee_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","title":"Should roll back","plan_date":"2026-10-24"}'::jsonb,
      '[{"exercise_id":999999,"sets":3,"reps":"10","sort_order":1}]'::jsonb
    );
    raise exception 'invalid exercise unexpectedly saved';
  exception when foreign_key_violation then
    null;
  end;
  select title into v_title from public.trainee_workout_plans where id=v_plan_id;
  if v_title <> 'Contract test updated' then raise exception 'header was not rolled back'; end if;
  select count(*) into n from public.trainee_workout_exercises where workout_plan_id=v_plan_id;
  if n <> 2 then raise exception 'child rows were not rolled back; expected 2, got %', n; end if;
end $$;

-- Empty full list is valid and clears all exercise rows.
do $$
declare v_plan_id bigint; n integer;
begin
  select id into v_plan_id from public.trainee_workout_plans where title='Contract test updated';
  perform public.save_trainee_workout_plan_atomic(
    v_plan_id,
    '{"trainee_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","title":"Contract test updated","plan_date":"2026-10-23"}'::jsonb,
    '[]'::jsonb
  );
  select count(*) into n from public.trainee_workout_exercises where workout_plan_id=v_plan_id;
  if n <> 0 then raise exception 'empty exercise list did not clear rows'; end if;
end $$;

-- Reject a coach attempting to access a different trainee.
do $$
declare v_failed boolean := false;
begin
  begin
    perform public.save_trainee_workout_plan_atomic(
      null,
      '{"trainee_id":"cccccccc-cccc-cccc-cccc-cccccccccccc","title":"Wrong trainee"}'::jsonb,
      '[]'::jsonb
    );
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'cross-trainee save unexpectedly succeeded'; end if;
end $$;

-- Reject a non-coach caller.
select set_config('app.test_is_coach', 'false', false);
do $$
declare v_failed boolean := false;
begin
  begin
    perform public.save_trainee_workout_plan_atomic(
      null,
      '{"trainee_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","title":"Not a coach"}'::jsonb,
      '[]'::jsonb
    );
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'non-coach save unexpectedly succeeded'; end if;
end $$;

-- Reject unauthenticated calls.
select set_config('app.test_uid', '', false);
select set_config('app.test_is_coach', 'true', false);
do $$
declare v_failed boolean := false;
begin
  begin
    perform public.save_trainee_workout_plan_atomic(
      null,
      '{"trainee_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","title":"No auth"}'::jsonb,
      '[]'::jsonb
    );
  exception when sqlstate '28000' then v_failed := true;
  end;
  if not v_failed then raise exception 'unauthenticated save unexpectedly succeeded'; end if;
end $$;


-- Test the exact RPC names used by the isolated planner and stale-write rejection.
select set_config('app.test_uid', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
select set_config('app.test_is_coach', 'true', false);
select set_config('app.test_trainee_id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
do $$
declare
  v_before jsonb;
  v_after jsonb;
  v_plan_id bigint;
  v_failed boolean := false;
begin
  v_before := public.experimental_workout_snapshot('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  v_plan_id := nullif(v_before->>'plan_id','')::bigint;
  perform public.experimental_save_trainee_workout(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    v_plan_id,
    v_before->>'fingerprint',
    '{"title":"RPC compatibility test","goal":"strength","notes":"round trip","plan_date":"2026-10-24"}'::jsonb,
    '[{"exercise_id":101,"sets":3,"reps":"10","rest_seconds":60,"sort_order":1,"training_system":"superset","group_key":"SUPERSET-1-1","training_day":"جلسه 1","is_completed":false},{"exercise_id":102,"sets":3,"reps":"12","rest_seconds":60,"sort_order":2,"training_system":"superset","group_key":"SUPERSET-1-1","training_day":"جلسه 1","is_completed":false}]'::jsonb
  );
  v_after := public.experimental_workout_snapshot('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  if (v_after->>'plan_count')::integer <> 1 then raise exception 'RPC snapshot plan count failed'; end if;
  if jsonb_array_length(v_after->'exercises') <> 2 then raise exception 'RPC exercise round trip failed'; end if;
  if v_after->'exercises'->0->>'group_key' <> 'SUPERSET-1-1' then raise exception 'RPC superset group key round trip failed'; end if;
  if v_after->>'fingerprint' = v_before->>'fingerprint' then raise exception 'RPC fingerprint did not change after save'; end if;

  begin
    perform public.experimental_save_trainee_workout(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      v_plan_id,
      v_before->>'fingerprint',
      '{"title":"STALE WRITE MUST FAIL","plan_date":"2026-10-25"}'::jsonb,
      '[]'::jsonb
    );
  exception when sqlstate '40001' then v_failed := true;
  end;
  if not v_failed then raise exception 'stale concurrent save was not rejected'; end if;
  if not exists(select 1 from public.trainee_workout_plans where id=v_plan_id and title='RPC compatibility test') then
    raise exception 'stale save unexpectedly changed plan header';
  end if;
end $$;

select 'PASS: atomic save and planner RPC compatibility tests' as result;
