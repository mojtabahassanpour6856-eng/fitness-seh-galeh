\set ON_ERROR_STOP on

-- Disposable PostgreSQL only. This reproduces the missing-default condition
-- and exercises the migration-equivalent repair inside an isolated schema.
create schema if not exists workout_batch_test;

create sequence workout_batch_test.trainee_workout_plans_id_seq start 1;
create sequence workout_batch_test.trainee_workout_exercises_id_seq start 1;

create table workout_batch_test.exercises (
  id bigint primary key,
  name text not null
);
create table workout_batch_test.trainee_workout_plans (
  id bigint primary key,
  trainee_id uuid not null
);
create table workout_batch_test.trainee_workout_exercises (
  id bigint primary key,
  workout_plan_id bigint not null references workout_batch_test.trainee_workout_plans(id),
  exercise_id bigint not null references workout_batch_test.exercises(id),
  sets integer not null,
  sort_order integer not null
);

insert into workout_batch_test.exercises(id,name) values (101,'Exercise A'),(102,'Exercise B');
-- Existing rows mimic a database where IDs exist but their sequence defaults were removed.
insert into workout_batch_test.trainee_workout_plans(id,trainee_id)
values (12,'11111111-1111-4111-8111-111111111111');
insert into workout_batch_test.trainee_workout_exercises(id,workout_plan_id,exercise_id,sets,sort_order)
values (158,12,101,3,1);

-- Migration-equivalent sequence alignment and default restoration, scoped only to this test schema.
select setval(
  'workout_batch_test.trainee_workout_plans_id_seq'::regclass,
  coalesce((select max(id) from workout_batch_test.trainee_workout_plans), 1),
  exists(select 1 from workout_batch_test.trainee_workout_plans)
);
select setval(
  'workout_batch_test.trainee_workout_exercises_id_seq'::regclass,
  coalesce((select max(id) from workout_batch_test.trainee_workout_exercises), 1),
  exists(select 1 from workout_batch_test.trainee_workout_exercises)
);
alter table workout_batch_test.trainee_workout_plans
  alter column id set default nextval('workout_batch_test.trainee_workout_plans_id_seq'::regclass);
alter table workout_batch_test.trainee_workout_exercises
  alter column id set default nextval('workout_batch_test.trainee_workout_exercises_id_seq'::regclass);

insert into workout_batch_test.trainee_workout_plans(trainee_id)
values ('22222222-2222-4222-8222-222222222222');

do $assert_id_defaults$
begin
  if (select max(id) from workout_batch_test.trainee_workout_plans) <> 13 then
    raise exception 'FAIL: plan ID default did not continue after existing max ID';
  end if;
  if nextval('workout_batch_test.trainee_workout_exercises_id_seq'::regclass) <> 159 then
    raise exception 'FAIL: exercise sequence did not continue after existing max ID';
  end if;
end
$assert_id_defaults$;

-- Case 1: one multi-row INSERT commits all selected exercises and generates IDs.
begin;
insert into workout_batch_test.trainee_workout_exercises(workout_plan_id,exercise_id,sets,sort_order)
values (13,101,3,1),(13,102,3,2);
commit;

do $assert_success$
begin
  if (select count(*) from workout_batch_test.trainee_workout_exercises where workout_plan_id=13) <> 2 then
    raise exception 'FAIL: successful batch did not commit both selected exercises';
  end if;
  if (select count(*) from workout_batch_test.trainee_workout_exercises where workout_plan_id=13 and id in (160,161)) <> 2 then
    raise exception 'FAIL: child IDs were not generated sequentially after existing IDs';
  end if;
end
$assert_success$;

-- Case 2: second row violates the exercise foreign key. PostgreSQL must reject
-- the whole multi-row statement, not leave the first row inserted.
do $assert_rollback$
declare
  v_failed boolean := false;
begin
  begin
    insert into workout_batch_test.trainee_workout_exercises(workout_plan_id,exercise_id,sets,sort_order)
    values (13,101,4,3),(13,999999,4,4);
  exception when foreign_key_violation then
    v_failed := true;
  end;

  if not v_failed then
    raise exception 'FAIL: invalid batch unexpectedly succeeded';
  end if;
  if (select count(*) from workout_batch_test.trainee_workout_exercises where workout_plan_id=13) <> 2 then
    raise exception 'FAIL: invalid batch partially inserted rows';
  end if;
  if exists (
    select 1 from workout_batch_test.trainee_workout_exercises
    where workout_plan_id=13 and sort_order in (3,4)
  ) then
    raise exception 'FAIL: partial rows from invalid batch remain';
  end if;
end
$assert_rollback$;

select 'PASS: sequence defaults continue existing IDs; valid batch commits; invalid batch rolls back entirely' as result;
