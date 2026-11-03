-- Atomic, coach-only save for the new nutrition builder.
-- Deploy only after reviewing this migration; it preserves the previous plan as inactive history.
create or replace function public.save_coach_nutrition_builder_plan(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $function$
declare
  v_trainee_id uuid;
  v_plan jsonb;
  v_meals jsonb;
  v_meal jsonb;
  v_food jsonb;
  v_plan_id uuid;
  v_meal_id uuid;
  v_index integer;
  v_option integer;
  v_name text;
  v_count integer := 0;
  v_food_count integer := 0;
  v_seen text[] := array[]::text[];
  v_names text[] := array['صبحانه','میان‌وعده صبح','ناهار','میان‌وعده عصر','شام','قبل خواب','قبل تمرین','بعد تمرین'];
  v_suffix text[] := array['','۲','۳','۴'];
  v_note text;
  v_amount numeric;
  v_grams numeric;
  v_food_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not coalesce(private.is_coach(), false) then
    raise exception 'Coach role required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload->'plan') <> 'object'
     or jsonb_typeof(p_payload->'meals') <> 'array' then
    raise exception 'Invalid nutrition payload' using errcode = '22023';
  end if;

  begin
    v_trainee_id := (p_payload->>'trainee_id')::uuid;
  exception when others then
    raise exception 'Valid trainee_id is required' using errcode = '22023';
  end;
  if not private.can_access_trainee(v_trainee_id) then
    raise exception 'Coach cannot access this trainee' using errcode = '42501';
  end if;

  v_plan := p_payload->'plan';
  v_meals := p_payload->'meals';
  if jsonb_array_length(v_meals) < 8 or jsonb_array_length(v_meals) > 32 then
    raise exception 'The plan must contain 8 to 32 meal options' using errcode = '22023';
  end if;
  if nullif(btrim(v_plan->>'title'),'') is null or length(v_plan->>'title') > 160 then
    raise exception 'A valid plan title is required' using errcode = '22023';
  end if;
  if nullif(v_plan->>'start_date','') is not null then perform (v_plan->>'start_date')::date; end if;
  if nullif(v_plan->>'end_date','') is not null then perform (v_plan->>'end_date')::date; end if;

  -- Preserve all old plans. Only mark them inactive; never delete them.
  update public.nutrition_plans
     set is_active = false
   where trainee_id = v_trainee_id
     and private.can_access_trainee(trainee_id);

  insert into public.nutrition_plans
    (trainee_id,title,start_date,end_date,daily_calories,protein_target,carbs_target,fat_target,notes,is_active)
  values
    (v_trainee_id,btrim(v_plan->>'title'),
     nullif(v_plan->>'start_date','')::date,
     nullif(v_plan->>'end_date','')::date,
     nullif(v_plan->>'daily_calories','')::numeric,
     nullif(v_plan->>'protein_target','')::numeric,
     nullif(v_plan->>'carbs_target','')::numeric,
     nullif(v_plan->>'fat_target','')::numeric,
     nullif(v_plan->>'notes',''),true)
  returning id into v_plan_id;

  for v_meal in select value from jsonb_array_elements(v_meals)
  loop
    if jsonb_typeof(v_meal) <> 'object'
       or jsonb_typeof(coalesce(v_meal->'foods','null'::jsonb)) <> 'array' then
      raise exception 'Invalid meal option' using errcode = '22023';
    end if;
    v_index := (v_meal->>'meal_index')::integer;
    v_option := (v_meal->>'option_no')::integer;
    if v_index < 0 or v_index > 7 or v_option < 1 or v_option > 4 then
      raise exception 'Invalid meal index or option number' using errcode = '22023';
    end if;
    if (v_index::text || ':' || v_option::text) = any(v_seen) then
      raise exception 'Duplicate meal option' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_index::text || ':' || v_option::text);
    v_name := v_names[v_index+1] || v_suffix[v_option];
    v_note := case when coalesce((v_meal->>'target')::numeric,0) > 0
      then 'SEH_BUILDER_TARGET:' || (v_meal->>'target') else null end;

    insert into public.nutrition_meals(plan_id,meal_name,meal_order,notes)
    values(v_plan_id,v_name,(v_index+1)*10+v_option,v_note)
    returning id into v_meal_id;

    if jsonb_array_length(v_meal->'foods') > 60 then
      raise exception 'Too many food rows in one option' using errcode = '22023';
    end if;
    for v_food in select value from jsonb_array_elements(v_meal->'foods')
    loop
      v_food_id := (v_food->>'food_id')::bigint;
      v_amount := (v_food->>'amount')::numeric;
      if v_food_id is null or v_amount is null or v_amount <= 0 or v_amount > 100000 then
        raise exception 'Invalid food or amount' using errcode = '22023';
      end if;
      if not exists(select 1 from public.foods where id=v_food_id) then
        raise exception 'Food does not exist: %',v_food_id using errcode = '23503';
      end if;
      v_grams := nullif(v_food->>'grams_per_unit','')::numeric;
      if v_grams is not null and (v_grams <= 0 or v_grams > 100000) then
        raise exception 'Invalid grams_per_unit' using errcode = '22023';
      end if;
      if length(coalesce(v_food->>'unit','گرم')) > 40 then
        raise exception 'Invalid food unit' using errcode = '22023';
      end if;
      v_note := null;
      if nullif(v_food->>'recipe_name','') is not null then
        v_note := '[دستور ترکیبی: ' || left(v_food->>'recipe_name',120) || ']';
      end if;
      if v_grams is not null and v_grams > 0 then
        v_note := concat_ws(' | ',v_note,'[seh-gpu:' || v_grams::text || ']');
      end if;
      insert into public.nutrition_meal_foods(meal_id,food_id,amount,unit,notes)
      values(v_meal_id,v_food_id,v_amount,coalesce(nullif(v_food->>'unit',''),'گرم'),v_note);
      v_food_count := v_food_count + 1;
    end loop;
    v_count := v_count + 1;
  end loop;

  if v_count <> jsonb_array_length(v_meals) then
    raise exception 'Meal option count mismatch' using errcode = '22023';
  end if;
  -- Every one of the eight meal slots must retain its primary option.
  for v_index in 0..7 loop
    if not ((v_index::text || ':1') = any(v_seen)) then
      raise exception 'Missing primary option for meal slot %',v_index using errcode = '22023';
    end if;
  end loop;
  return jsonb_build_object('plan_id',v_plan_id,'trainee_id',v_trainee_id,'meal_options',v_count,'food_rows',v_food_count);
end;
$function$;

revoke all on function public.save_coach_nutrition_builder_plan(jsonb) from public;
revoke all on function public.save_coach_nutrition_builder_plan(jsonb) from anon;
grant execute on function public.save_coach_nutrition_builder_plan(jsonb) to authenticated;
