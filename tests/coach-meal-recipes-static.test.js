const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const marker = '// FITNESS_SEH_GALEH_PREBUILT_MEAL_RECIPES_V1';
const markerAt = html.indexOf(marker);
assert.notEqual(markerAt, -1, 'prebuilt coach meal recipes are missing');

const arrayEnd = html.indexOf('];', markerAt);
assert.ok(arrayEnd > markerAt, 'could not locate end of the meal recipe array');
const block = html.slice(markerAt + marker.length, arrayEnd);
const recipes = block.split('\n')
  .map(line => line.trim().replace(/,$/, ''))
  .filter(line => line.startsWith('{'))
  .map(line => JSON.parse(line));

assert.equal(recipes.length, 21, 'expected the agreed 21 prebuilt recipes');
const counts = recipes.reduce((out, recipe) => {
  out[recipe.category] = (out[recipe.category] || 0) + 1;
  assert.ok(recipe.name && Array.isArray(recipe.ingredients) && recipe.ingredients.length,
    'each recipe must have a coach selector name and ingredient rows');
  for (const row of recipe.ingredients) {
    assert.ok(Array.isArray(row) && row.length === 3, 'ingredient rows must be [food name, amount, unit]');
    assert.ok(typeof row[0] === 'string' && row[0].trim(), 'ingredient name must be present');
    assert.ok(Number(row[1]) > 0, 'ingredient amount must be positive');
    assert.ok(typeof row[2] === 'string' && row[2].trim(), 'ingredient unit must be present');
  }
  return out;
}, {});

assert.deepEqual(counts, {
  breakfast: 5,
  lunch: 5,
  dinner: 3,
  snack: 3,
  preworkout: 1,
  postworkout: 3,
  bedtime: 1
});
assert.equal(recipes.find(r => r.name === 'معجون حجم ۱')?.category, 'postworkout');
assert.equal(recipes.find(r => r.name === 'معجون حجم ۲')?.category, 'postworkout');
assert.equal(recipes.find(r => r.name === 'شیک کاهش وزن ۱')?.category, 'snack');
assert.equal(recipes.find(r => r.name === 'شیک کاهش وزن ۲')?.category, 'bedtime');

const cerelacRecipe = recipes.find(r => r.name === 'معجون حجم ۱');
assert.ok(cerelacRecipe?.ingredients.some(row => row[0] === 'سرلاک' && Number(row[1]) === 30),
  'volume shake 1 must include 30 g of Cerelac');
const cerelacSql = fs.readFileSync('supabase/migrations/202610280001_add_cerelac_wheat.sql', 'utf8');
assert.match(cerelacSql, /'سرلاک'/);
assert.match(cerelacSql, /427/);
assert.match(cerelacSql, /15\.5/);
assert.match(cerelacSql, /64\.5/);
assert.match(cerelacSql, /12\.5/);

console.log('PASS: 21 prebuilt meal recipes, Cerelac ingredient and nutrition seed, categories, and row validation.');
