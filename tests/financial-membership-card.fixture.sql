-- Disposable PostgreSQL 17 fixture for atomic membership + card allocation.
-- Synthetic CI-only schema. NOT a Supabase migration and never run against live projects.
\set ON_ERROR_STOP on
create extension if not exists pgcrypto;
create extension if not exists dblink;
create role anon nologin;
create role authenticated nologin;

create schema auth;
create schema private;
create or replace function auth.uid()
returns uuid language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.profiles (
  id uuid primary key,
  role text not null check (role in ('coach','trainee'))
);
create table public.trainees (
  id uuid primary key,
  coach_user_id uuid not null references public.profiles(id)
);
create table public.trainee_membership_cards (
  id uuid primary key default gen_random_uuid(),
  trainee_id uuid not null unique references public.trainees(id),
  card_number text not null unique
    check (card_number ~ '^[0-9]{4}$' and card_number::integer between 1001 and 9999),
  created_at timestamptz not null default now()
);
create table public.trainee_memberships (
  id bigint generated always as identity primary key,
  trainee_id uuid not null references public.trainees(id),
  start_date date,
  end_date date,
  status text default 'active',
  description text,
  created_at timestamptz default now(),
  amount numeric,
  payment_status text not null default 'unpaid'
    check (payment_status in ('paid','unpaid','pending')),
  card_number text,
  card_holder text
);
create index trainee_memberships_trainee_id_idx on public.trainee_memberships(trainee_id);
create table public.trainee_payments (
  id bigint generated always as identity primary key,
  trainee_id uuid not null references public.trainees(id),
  amount numeric,
  payment_date date,
  description text,
  created_at timestamptz default now()
);
create table private.operation_ledger (
  actor_uid uuid not null,
  operation_kind text not null,
  operation_id uuid not null,
  request_hash text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key(actor_uid,operation_kind,operation_id)
);

create or replace function private.is_coach()
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists(select 1 from public.profiles p
    where p.id=auth.uid() and p.role='coach')
$$;

create or replace function public.create_membership_atomic(
  p_trainee_id uuid,
  p_start_date date,
  p_end_date date,
  p_description text,
  p_amount numeric,
  p_payment_status text,
  p_card_holder text,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $rpc$
declare
  v_actor uuid := auth.uid();
  v_hash text;
  v_existing_hash text;
  v_result jsonb;
  v_rows integer;
  v_card text;
  v_candidate text;
  v_membership_id bigint;
  v_payment_id bigint;
  v_attempt integer;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode='28000';
  end if;
  if not coalesce(private.is_coach(),false) then
    raise exception 'Coach role required' using errcode='42501';
  end if;
  if p_trainee_id is null or p_operation_id is null
     or p_payment_status is null
     or p_payment_status not in ('paid','unpaid','pending')
     or (p_amount is not null and p_amount < 0)
     or (p_start_date is not null and p_end_date is not null and p_end_date < p_start_date) then
    raise exception 'Invalid membership request' using errcode='22023';
  end if;

  v_hash := encode(digest(jsonb_build_object(
    'trainee_id',p_trainee_id,'start_date',p_start_date,'end_date',p_end_date,
    'description',p_description,'amount',p_amount,
    'payment_status',p_payment_status,'card_holder',p_card_holder
  )::text,'sha256'),'hex');

  insert into private.operation_ledger(actor_uid,operation_kind,operation_id,request_hash)
  values(v_actor,'create_membership',p_operation_id,v_hash)
  on conflict do nothing;
  get diagnostics v_rows = row_count;

  if v_rows=0 then
    select request_hash,result into v_existing_hash,v_result
    from private.operation_ledger
    where actor_uid=v_actor and operation_kind='create_membership'
      and operation_id=p_operation_id
    for update;
    if v_existing_hash is distinct from v_hash then
      raise exception 'Operation ID reused with different membership payload'
        using errcode='22023';
    end if;
    if v_result is not null then return v_result; end if;
    raise exception 'Membership operation has no completed result' using errcode='55000';
  end if;

  -- Serialize all card and membership creations for this trainee.
  perform 1 from public.trainees t
  where t.id=p_trainee_id and t.coach_user_id=v_actor
  for update;
  if not found then
    raise exception 'Coach cannot create membership for this trainee'
      using errcode='42501';
  end if;

  select card_number into v_card
  from public.trainee_membership_cards
  where trainee_id=p_trainee_id;

  if v_card is null then
    for v_attempt in 1..500 loop
      v_candidate := (floor(random()*8999)::integer + 1001)::text;
      insert into public.trainee_membership_cards(trainee_id,card_number)
      values(p_trainee_id,v_candidate)
      on conflict do nothing
      returning card_number into v_card;
      if v_card is not null then exit; end if;
      -- A legacy/direct writer may have registered this trainee's card while
      -- the RPC was allocating. Re-read after the unique-conflict wait and
      -- reuse the canonical registry value instead of spinning to exhaustion.
      select card_number into v_card
      from public.trainee_membership_cards
      where trainee_id=p_trainee_id;
      if v_card is not null then exit; end if;
    end loop;
    if v_card is null then
      raise exception 'Could not allocate a unique membership card'
        using errcode='23505';
    end if;
  end if;

  insert into public.trainee_memberships(
    trainee_id,start_date,end_date,status,description,amount,
    payment_status,card_number,card_holder
  ) values (
    p_trainee_id,p_start_date,p_end_date,'active',p_description,p_amount,
    p_payment_status,v_card,p_card_holder
  ) returning id into v_membership_id;

  if p_payment_status='paid' and coalesce(p_amount,0)>0 then
    insert into public.trainee_payments(trainee_id,amount,payment_date,description)
    values(p_trainee_id,p_amount,current_date,p_description)
    returning id into v_payment_id;
  end if;

  v_result := jsonb_build_object(
    'success',true,'membership_id',v_membership_id,
    'card_number',v_card,'payment_id',v_payment_id
  );
  update private.operation_ledger
  set result=v_result,completed_at=now()
  where actor_uid=v_actor and operation_kind='create_membership'
    and operation_id=p_operation_id;
  return v_result;
end;
$rpc$;

revoke all on schema private from public,anon,authenticated;
revoke all on all tables in schema private from public,anon,authenticated;
revoke all on function public.create_membership_atomic(uuid,date,date,text,numeric,text,text,uuid)
  from public,anon;
grant usage on schema public to authenticated;
grant execute on function public.create_membership_atomic(uuid,date,date,text,numeric,text,text,uuid)
  to authenticated;

insert into public.profiles(id,role) values
 ('11000000-0000-0000-0000-000000000001','coach'),
 ('11000000-0000-0000-0000-000000000002','coach'),
 ('21000000-0000-0000-0000-000000000001','trainee');
insert into public.trainees(id,coach_user_id) values
 ('31000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001'),
 ('31000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000001'),
 ('31000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000002');
grant select,insert,update,delete on public.profiles,public.trainees,
 public.trainee_membership_cards,public.trainee_memberships,public.trainee_payments
to authenticated;
grant usage,select on all sequences in schema public to authenticated;
