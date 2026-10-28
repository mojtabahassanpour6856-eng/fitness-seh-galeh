-- Reference nutrition values for Nestle CERELAC Wheat (per 100 g).
-- Values are based on the product reference previously reviewed; formulations vary by market.
-- This file is intentionally not applied automatically. Review and apply only to the intended
-- database after the experimental app branch has been validated.
insert into public.foods
  (name, category, calories, protein, carbs, fat, serving_unit, serving_amount)
select
  'سرلاک', 'غلات', 427, 15.5, 64.5, 12.5, 'گرم', 100
where not exists (
  select 1 from public.foods where name = 'سرلاک'
);
