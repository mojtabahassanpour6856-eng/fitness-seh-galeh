\set ON_ERROR_STOP on

-- Disposable PostgreSQL only. This creates tables only inside a dedicated test schema;
-- do not use a production database for this integration test.
create schema if not exists workout_batch_test;

create sequence workout_batch_test.trainee_workout_plans_id_seq start 1;
create sequence workout_batch_test.trainee_workout_exercises_id_seq start 1;

create table workout_batch_test.exercises (
  id bigint primary key,
  name text not null
);
create table workout_batch_test.trainee_workout_plans (
  id bigint primary key default nextval('workout_batch_test.trainee_workout_plans_id_seq'::regclass),
  trainee_id uuid not null
);
create table workout_batch_test.trainee_workout_exercises (
  id bigint primary key default nextval('workout_batch_test.trainee_workout_exercises_id_seq'::regclass),
  workout_plan_id bigint not null references workout_batch_test.trainee_workout_plans(id),
  exercise_id bigint not null references workout_batch_test.exercises(id),
  sets integer not null,
  sort_order integer not null
);

insert into workout_batch_test.exercises(id,name) values (101,'Exercise A'),(102,'Exercise B');
insert into workout_batch_test.trainee_workout_plans(trainee_id)
values ('11111111-1111-4111-8111-111111111111');

do $assert_id_defaults$
begin
  if (select id from workout_batch_test.trainee_workout_plans limit 1) <> 1 then
    raise exception 'FAIL: plan ID default did not allocate the first sequence value';
  end if;
end
$assert_id_defaults$;

-- Case 1: a selected group is sent as one multi-row INSERT and both rows commit.
begin;
insert into workout_batch_test.trainee_workout_exercises(workout_plan_id,exercise_id,sets,sort_order)
values (1,101,3,1),(1,102,3,2);
commit;

do $assert_success$
begin
  if (select count(*) from workout_batch_test.trainee_workout_exercises where workout_plan_id=1) <> 2 then
    raise exception 'FAIL: successful batch did not commit both selected exercises';
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
    values (1,101,4,3),(1,999999,4,4);
  exception when foreign_key_violation then
    v_failed := true;
  end;

  if not v_failed then
    raise exception 'FAIL: invalid batch unexpectedly succeeded';
  end if;

  if (select count(*) from workout_batch_test.trainee_workout_exercises where workout_plan_id=1) <> 2 then
    raise exception 'FAIL: invalid batch partially inserted rows';
  end if;

  if exists (
    select 1 from workout_batch_test.trainee_workout_exercises
    where workout_plan_id=1 and sort_order in (3,4)
  ) then
    raise exception 'FAIL: partial rows from invalid batch remain';
  end if;
end
$assert_rollback$;

select 'PASS: valid batch committed both rows; invalid batch rolled back entirely' as result;
