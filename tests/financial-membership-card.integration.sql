\set ON_ERROR_STOP on
\i tests/financial-membership-card.fixture.sql

set role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000001',false);

do $test$
declare v_first jsonb; v_retry jsonb; v_card text; v_count integer;
begin
  v_first := public.create_membership_atomic(
    '31000000-0000-0000-0000-000000000001','2026-11-14','2026-12-14',
    'عضویت باشگاه',200000,'paid','Synthetic trainee',
    '51000000-0000-0000-0000-000000000001','2026-11-14');
  v_retry := public.create_membership_atomic(
    '31000000-0000-0000-0000-000000000001','2026-11-14','2026-12-14',
    'عضویت باشگاه',200000,'paid','Synthetic trainee',
    '51000000-0000-0000-0000-000000000001','2026-11-14');
  if v_first is distinct from v_retry then raise exception 'same operation retry returned different result'; end if;
  select count(*) into v_count from public.trainee_memberships
   where trainee_id='31000000-0000-0000-0000-000000000001';
  if v_count<>1 then raise exception 'retry created % memberships, expected one',v_count; end if;
  select count(*) into v_count from public.trainee_payments
   where trainee_id='31000000-0000-0000-0000-000000000001';
  if v_count<>1 then raise exception 'retry created % payments, expected one',v_count; end if;
  if not exists(select 1 from public.trainee_payments
    where trainee_id='31000000-0000-0000-0000-000000000001'
      and payment_date='2026-11-14' and description='پرداخت عضویت') then
    raise exception 'payment date/description do not match the live coach handler contract';
  end if;
  select card_number into v_card from public.trainee_membership_cards
   where trainee_id='31000000-0000-0000-0000-000000000001';
  if v_card is distinct from v_first->>'card_number' then raise exception 'registry and result card mismatch'; end if;

  -- A second genuine membership for the same trainee reuses their canonical card.
  perform public.create_membership_atomic(
    '31000000-0000-0000-0000-000000000001','2026-12-15','2027-01-15',
    'Synthetic next membership',180000,'unpaid','Synthetic trainee',
    '51000000-0000-0000-0000-000000000002');
  select count(*) into v_count from public.trainee_memberships
   where trainee_id='31000000-0000-0000-0000-000000000001'
     and card_number=v_card;
  if v_count<>2 then raise exception 'historical membership rows did not retain same card'; end if;
  select count(*) into v_count from public.trainee_payments
   where trainee_id='31000000-0000-0000-0000-000000000001';
  if v_count<>1 then raise exception 'unpaid membership unexpectedly created payment'; end if;
  if not exists(select 1 from public.trainee_memberships
    where trainee_id='31000000-0000-0000-0000-000000000001'
      and description='Synthetic next membership'
      and status='pending' and payment_status='unpaid') then
    raise exception 'unpaid membership must remain pending, matching the live coach handler';
  end if;

  -- Same operation ID with changed payload is rejected.
  begin
    perform public.create_membership_atomic(
      '31000000-0000-0000-0000-000000000001','2026-12-15','2027-01-15',
      'Altered description',180000,'unpaid','Synthetic trainee',
      '51000000-0000-0000-0000-000000000002');
    raise exception 'expected changed-payload operation ID reuse to fail';
  exception when sqlstate '22023' then null;
  end;

  -- Invalid date range is rejected.
  begin
    perform public.create_membership_atomic(
      '31000000-0000-0000-0000-000000000002','2026-12-15','2026-12-01',
      'Invalid dates',10000,'unpaid','Synthetic trainee',
      '51000000-0000-0000-0000-000000000003');
    raise exception 'expected invalid date range to fail';
  exception when sqlstate '22023' then null;
  end;
end;
$test$;

-- If the registry is absent but membership history has a card, preserve that exact number.
insert into public.trainee_memberships(trainee_id,card_number,status,payment_status)
values('31000000-0000-0000-0000-000000000002','4321','pending','unpaid');

set role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000001',false);
select public.create_membership_atomic(
  '31000000-0000-0000-0000-000000000002','2026-11-14','2026-12-14',
  'History card reuse',0,'paid','Synthetic trainee',
  '51000000-0000-0000-0000-000000000011','2026-11-14');
reset role;
do $test$
declare v_registry text; v_count integer;
begin
  select card_number into v_registry from public.trainee_membership_cards
   where trainee_id='31000000-0000-0000-0000-000000000002';
  if v_registry is distinct from '4321' then
    raise exception 'legacy history card was not adopted into the canonical registry';
  end if;
  select count(*) into v_count from public.trainee_memberships
   where trainee_id='31000000-0000-0000-0000-000000000002' and card_number='4321';
  if v_count<>2 then raise exception 'legacy history card was not preserved on new membership'; end if;
end;
$test$;

-- A mismatch between history and registry must fail closed, not silently switch numbers.
insert into public.trainee_memberships(trainee_id,card_number,status,payment_status)
select '31000000-0000-0000-0000-000000000001',
       case when card_number='9999' then '9998' else '9999' end,
       'active','paid'
from public.trainee_membership_cards
where trainee_id='31000000-0000-0000-0000-000000000001';
set role authenticated;
do $test$
begin
  begin
    perform public.create_membership_atomic(
      '31000000-0000-0000-0000-000000000001','2027-02-01','2027-03-01',
      'Conflicting history card',10000,'paid','Synthetic trainee',
      '51000000-0000-0000-0000-000000000012','2027-02-01');
    raise exception 'expected card history/registry conflict to fail';
  exception when sqlstate '23514' then null;
  end;
end;
$test$;
reset role;

-- The live UI marks a zero-amount membership as paid/active but creates no payment row.
set role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000001',false);
select public.create_membership_atomic(
  '31000000-0000-0000-0000-000000000002','2026-11-14','2026-12-14',
  'عضویت باشگاه',0,'paid','Synthetic trainee',
  '51000000-0000-0000-0000-000000000010','2026-11-14');
reset role;
do $test$
declare v_count integer;
begin
  if not exists(select 1 from public.trainee_memberships
    where trainee_id='31000000-0000-0000-0000-000000000002'
      and status='active' and payment_status='paid' and amount=0) then
    raise exception 'zero-amount paid membership must remain active/paid';
  end if;
  select count(*) into v_count from public.trainee_payments
   where trainee_id='31000000-0000-0000-0000-000000000002';
  if v_count<>0 then raise exception 'zero-amount paid membership must not create a payment';
  end if;
end;
$test$;

-- A second coach cannot create a membership for another coach's trainee.
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000002',false);
do $test$
begin
  begin
    perform public.create_membership_atomic(
      '31000000-0000-0000-0000-000000000001','2026-11-14','2026-12-14',
      'Cross coach attempt',10000,'paid','Synthetic trainee',
      '51000000-0000-0000-0000-000000000004');
    raise exception 'expected cross-coach access to fail';
  exception when sqlstate '42501' then null;
  end;
end;
$test$;
reset role;

-- Inject a payment failure: card, membership, payment and ledger claim must roll back.
create function public.fixture_fail_membership_payment()
returns trigger language plpgsql as $trigger$
begin
  if new.amount=55555 then
    raise exception 'injected payment failure' using errcode='23514';
  end if;
  return new;
end;
$trigger$;
create trigger fixture_fail_membership_payment
before insert on public.trainee_payments
for each row execute function public.fixture_fail_membership_payment();

set role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000001',false);
do $test$
begin
  begin
    perform public.create_membership_atomic(
      '31000000-0000-0000-0000-000000000002','2026-11-14','2026-12-14',
      'Injected failure',55555,'paid','Synthetic trainee',
      '51000000-0000-0000-0000-000000000005');
    raise exception 'expected injected payment failure';
  exception when sqlstate '23514' then null;
  end;
end;
$test$;
reset role;

do $test$
declare v_count integer;
begin
  select count(*) into v_count from public.trainee_memberships
   where trainee_id='31000000-0000-0000-0000-000000000002';
  if v_count<>0 then raise exception 'membership survived payment failure'; end if;
  select count(*) into v_count from public.trainee_membership_cards
   where trainee_id='31000000-0000-0000-0000-000000000002';
  if v_count<>0 then raise exception 'card registry survived payment failure'; end if;
  select count(*) into v_count from private.operation_ledger
   where operation_id='51000000-0000-0000-0000-000000000005';
  if v_count<>0 then raise exception 'operation ledger claim survived failure'; end if;
end;
$test$;

-- Race two independent sessions creating two memberships for the same trainee.
-- The trainee row lock serializes card allocation; both memberships share one card.
insert into public.profiles(id,role) values
 ('11000000-0000-0000-0000-000000000004','coach');
insert into public.trainees(id,coach_user_id) values
 ('31000000-0000-0000-0000-000000000004','11000000-0000-0000-0000-000000000004');

select dblink_connect('membership_race_a','dbname='||current_database()||' user=postgres');
select dblink_connect('membership_race_b','dbname='||current_database()||' user=postgres');
select dblink_exec('membership_race_a','set role authenticated');
select dblink_exec('membership_race_b','set role authenticated');
select dblink_exec('membership_race_a','set request.jwt.claim.sub = ''11000000-0000-0000-0000-000000000004''');
select dblink_exec('membership_race_b','set request.jwt.claim.sub = ''11000000-0000-0000-0000-000000000004''');
select dblink_exec('membership_race_a','begin');

do $race$
declare v_error text;
begin
  if dblink_send_query('membership_race_a',
    $query$select public.create_membership_atomic(
      '31000000-0000-0000-0000-000000000004','2026-11-14','2026-12-14',
      'Concurrent A',10000,'paid','Synthetic A',
      '52000000-0000-0000-0000-000000000001')::text$query$)<>1 then
    raise exception 'could not start first membership creation';
  end if;
  perform * from dblink_get_result('membership_race_a') as t(result text);
  perform * from dblink_get_result('membership_race_a') as t(result text);

  if dblink_send_query('membership_race_b',
    $query$select public.create_membership_atomic(
      '31000000-0000-0000-0000-000000000004','2026-12-15','2027-01-15',
      'Concurrent B',12000,'paid','Synthetic B',
      '52000000-0000-0000-0000-000000000002')::text$query$)<>1 then
    raise exception 'could not start second membership creation';
  end if;
  perform pg_sleep(0.3);
  if dblink_is_busy('membership_race_b')<>1 then
    raise exception 'second membership creation did not wait on trainee row lock';
  end if;
  perform dblink_exec('membership_race_a','commit');
  perform * from dblink_get_result('membership_race_b') as t(result text);
  perform * from dblink_get_result('membership_race_b') as t(result text);
end;
$race$;

select dblink_disconnect('membership_race_a');
select dblink_disconnect('membership_race_b');

do $race$
declare v_count integer; v_distinct integer;
begin
  select count(*),count(distinct card_number) into v_count,v_distinct
  from public.trainee_memberships
  where trainee_id='31000000-0000-0000-0000-000000000004';
  if v_count<>2 or v_distinct<>1 then
    raise exception 'expected two memberships with one shared card; got rows %, distinct cards %',v_count,v_distinct;
  end if;
  select count(*) into v_count from public.trainee_membership_cards
  where trainee_id='31000000-0000-0000-0000-000000000004';
  if v_count<>1 then raise exception 'expected one canonical card registry row'; end if;
  select count(*) into v_count from public.trainee_payments
  where trainee_id='31000000-0000-0000-0000-000000000004';
  if v_count<>2 then raise exception 'expected two payments for two genuine paid memberships'; end if;
end;
$race$;

-- A pre-existing canonical registry assignment is reused, never regenerated.
insert into public.trainee_membership_cards(trainee_id,card_number)
values('31000000-0000-0000-0000-000000000003','4321');

-- Distinct trainees must never receive the same card number.
set role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000001',false);
select public.create_membership_atomic(
 '31000000-0000-0000-0000-000000000002','2026-11-14','2026-12-14',
 'Card uniqueness A',10000,'unpaid','Synthetic',
 '53000000-0000-0000-0000-000000000001');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000002',false);
select public.create_membership_atomic(
 '31000000-0000-0000-0000-000000000003','2026-11-14','2026-12-14',
 'Card uniqueness B',10000,'unpaid','Synthetic',
 '53000000-0000-0000-0000-000000000002');
reset role;
do $race$
declare v_count integer; v_card text;
begin
 select card_number into v_card from public.trainee_membership_cards
  where trainee_id='31000000-0000-0000-0000-000000000003';
 if v_card<>'4321' then raise exception 'existing canonical registry card was not preserved'; end if;
 select count(*) into v_count from (
  select card_number from public.trainee_membership_cards
  group by card_number having count(*)>1
 ) d;
 if v_count<>0 then raise exception 'card number collision across trainees'; end if;
end;
$race$;

select 'PASS: membership retry, stable card history, cross-coach denial, transaction rollback, same-trainee concurrent serialization, and cross-trainee card uniqueness.' as result;
