const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function createHarness({ getRows, write, locks } = {}) {
  const elements = {
    dietTypeSelect: { value: 'متعادل', options: [], addEventListener() {} },
    dietCustomName: { value: '' },
    dietSettings: { value: 'تنظیمات تست' },
    dietNotes: { value: 'یادداشت تست' },
    dietStatus: { textContent: '' },
    dietSavedSummary: { textContent: '' }
  };
  const button = { disabled: false, textContent: 'ذخیره', dataset: {} };
  const document = {
    getElementById: id => elements[id] || null,
    querySelector: selector => selector.includes('saveDietConfiguration') ? button : null
  };
  const calls = [];
  const lockCalls = [];
  const context = {
    console,
    document,
    currentClient: { id: 'trainee-test-1' },
    authProfile: { role: 'coach' },
    foods: [['برنج', 130, 2]],
    today: () => '2026-11-02',
    sbGet: async path => {
      calls.push(['GET', path]);
      return getRows ? getRows() : [];
    },
    sbWrite: async (path, method, payload) => {
      calls.push([method, path, payload]);
      if (write) return write(path, method, payload);
      return [];
    },
    alert: message => { calls.push(['ALERT', message]); },
    navigator: { locks: locks || { request: async (name, options, callback) => { lockCalls.push({ name, options }); return callback(); } } },
    window: {}
  };
  context.window = context;
  vm.createContext(context);
  const html = fs.readFileSync('index.html', 'utf8');
  const match = html.match(/<script id="FITNESS_TRAINEE_DIET_TYPES_V1">([\s\S]*?)<\/script>/);
  assert.ok(match, 'diet builder script must exist in index.html');
  vm.runInContext(match[1], context, { timeout: 3000 });
  context.loadDietSummary = async () => {}; // Keep this unit test focused on the save path.
  return { context, elements, button, calls, lockCalls };
}


test('diet saves request an exclusive browser-wide lock per trainee', async () => {
  const h = createHarness();
  await h.context.saveDietConfiguration();
  assert.equal(h.lockCalls.length, 1);
  assert.equal(h.lockCalls[0].name, 'sehgaleh-diet-save-trainee-test-1');
  assert.equal(h.lockCalls[0].options.mode, 'exclusive');
});

test('separate tabs serialize saves for the same trainee through the shared browser lock', async () => {
  const tails = new Map();
  const sharedLocks = {
    request: (name, options, callback) => {
      const previous = tails.get(name) || Promise.resolve();
      const current = previous.then(callback);
      tails.set(name, current.catch(() => {}));
      return current;
    }
  };
  let stored = [];
  const write = async (path, method, payload) => {
    if (method === 'POST') stored = [{ id: 51, ...payload }];
    if (method === 'PATCH') stored = stored.map(row => row.id === 51 ? { ...row, ...payload } : row);
    return stored;
  };
  const firstTab = createHarness({ getRows: () => stored, write, locks: sharedLocks });
  const secondTab = createHarness({ getRows: () => stored, write, locks: sharedLocks });
  await Promise.all([
    firstTab.context.saveDietConfiguration(),
    secondTab.context.saveDietConfiguration()
  ]);
  assert.equal(firstTab.calls.filter(x => x[0] === 'POST').length + secondTab.calls.filter(x => x[0] === 'POST').length, 1);
  assert.equal(firstTab.calls.filter(x => x[0] === 'PATCH').length + secondTab.calls.filter(x => x[0] === 'PATCH').length, 1);
  assert.equal(stored.length, 1);
});

test('diet save still works when the browser does not support Web Locks', async () => {
  const h = createHarness({ locks: null });
  delete h.context.navigator.locks;
  await h.context.saveDietConfiguration();
  assert.equal(h.calls.filter(x => x[0] === 'POST').length, 1);
});

test('first diet save inserts one tagged diet row', async () => {
  const h = createHarness();
  await h.context.saveDietConfiguration();
  const writes = h.calls.filter(x => x[0] === 'POST');
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1], '/fasting_logs');
  assert.match(writes[0][2].description, /^رژیم‌غذایی::/);
  assert.equal(h.elements.dietStatus.textContent, '✅ رژیم و برنامه غذایی برای این شاگرد ذخیره شد.');
  assert.equal(h.button.disabled, false);
});

test('subsequent save updates the existing diet row instead of inserting another', async () => {
  let stored = [];
  const h = createHarness({
    getRows: () => stored,
    write: async (path, method, payload) => {
      if (method === 'POST') stored = [{ id: 41, ...payload }];
      if (method === 'PATCH') stored = stored.map(row => row.id === 41 ? { ...row, ...payload } : row);
      return stored;
    }
  });
  await h.context.saveDietConfiguration();
  await h.context.saveDietConfiguration();
  assert.equal(h.calls.filter(x => x[0] === 'POST').length, 1);
  assert.equal(h.calls.filter(x => x[0] === 'PATCH').length, 1);
  assert.equal(stored.length, 1);
  assert.match(h.calls.find(x => x[0] === 'GET')[1], /description=like\./);
});


test('diet lookup is filtered by its tag so unrelated fasting history cannot hide it', async () => {
  const h = createHarness({
    getRows: () => [{ id: 88, description: 'رژیم‌غذایی::{"type":"متعادل"}' }]
  });
  await h.context.saveDietConfiguration();
  const lookup = h.calls.find(x => x[0] === 'GET')[1];
  assert.match(lookup, /description=like\./);
  assert.equal(h.calls.filter(x => x[0] === 'PATCH').length, 1);
  assert.equal(h.calls.filter(x => x[0] === 'POST').length, 0);
});

test('concurrent save clicks are ignored while the first save is in progress', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = createHarness({ getRows: async () => { await gate; return []; } });
  const first = h.context.saveDietConfiguration();
  await Promise.resolve();
  await h.context.saveDietConfiguration();
  assert.equal(h.calls.filter(x => x[0] === 'GET').length, 1);
  release();
  await first;
  assert.equal(h.calls.filter(x => x[0] === 'POST').length, 1);
});

test('switching selected trainee during save cancels the write', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = createHarness({ getRows: async () => { await gate; return []; } });
  const first = h.context.saveDietConfiguration();
  await Promise.resolve();
  h.context.currentClient = { id: 'another-trainee' };
  release();
  await first;
  assert.equal(h.calls.some(x => x[0] === 'POST' || x[0] === 'PATCH'), false);
  assert.match(h.elements.dietStatus.textContent, /شاگرد هنگام ذخیره تغییر کرده است/);
});

test('nutrition table calculations scale every bank value per 100g by selected amount', () => {
  const h = createHarness();
  h.context.foods = [
    ['سینه مرغ پخته', 165, 31, 0, 3.6],
    ['برنج پخته', 130, 2.7, 28.2, 0.3]
  ];
  const chicken = h.context.dietFoodNutrition({ foodIndex: '0', amount: 150 });
  assert.deepEqual(
    { cal: chicken.cal, protein: chicken.protein, carbs: chicken.carbs, fat: chicken.fat, valid: chicken.valid },
    { cal: 247.5, protein: 46.5, carbs: 0, fat: 5.4, valid: true }
  );
  const rice = h.context.dietFoodNutrition({ foodIndex: '1', amount: 200 });
  assert.deepEqual(
    { cal: rice.cal, protein: rice.protein, carbs: rice.carbs, fat: rice.fat, valid: rice.valid },
    { cal: 260, protein: 5.4, carbs: 56.4, fat: 0.6, valid: true }
  );
});

test('nutrition calculations reject missing or malformed bank values instead of showing false zeroes', () => {
  const h = createHarness();
  h.context.foods = [
    ['غذای ناقص', 120, 4, null, 2],
    ['غذای نامعتبر', 120, 4, 'نامشخص', 2]
  ];
  assert.equal(h.context.dietFoodNutrition({ foodIndex: '0', amount: 100 }).valid, false);
  assert.equal(h.context.dietFoodNutrition({ foodIndex: '1', amount: 100 }).valid, false);
  assert.equal(h.context.dietFoodNutrition({ foodIndex: '', amount: 100 }).valid, false);
});

test('meal totals add the nutrition of all selected food rows', () => {
  const h = createHarness();
  h.context.foods = [
    ['سینه مرغ پخته', 165, 31, 0, 3.6],
    ['برنج پخته', 130, 2.7, 28.2, 0.3]
  ];
  const total = h.context.dietMealNutrition({
    items: [{ foodIndex: '0', amount: 150 }, { foodIndex: '1', amount: 200 }]
  });
  assert.deepEqual(
    { cal: total.cal, protein: total.protein, carbs: total.carbs, fat: total.fat },
    { cal: 507.5, protein: 51.9, carbs: 56.4, fat: 6 }
  );
});

