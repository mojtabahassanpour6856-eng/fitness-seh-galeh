import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const swSource = fs.readFileSync('sw.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
assert.match(html, /seh-app-shell-service-worker-registration-v1/);
assert.match(html, /\.register\('\.\/sw\.js',\s*\{scope:'\.\/'\}\)/);
assert.match(swSource, /self\.addEventListener\('fetch'/);
assert.match(swSource, /self\.addEventListener\('push'/);
assert.match(swSource, /self\.addEventListener\('notificationclick'/);

const scope = 'https://app.example.test/fitness-seh-galeh/';
const listeners = {};
const stores = new Map();
const requests = [];
let offline = false;
let forcedStatus = null;
let skipWaitingCalls = 0;
let claimCalls = 0;

class MockCache {
  constructor(name) { this.name = name; this.entries = stores.get(name); }
  key(value) { return typeof value === 'string' ? value : value.url; }
  async put(key, response) { this.entries.set(this.key(key), response.clone()); }
  async match(key, options = {}) {
    const wanted = this.key(key);
    if (this.entries.has(wanted)) return this.entries.get(wanted).clone();
    if (options.ignoreSearch) {
      const clean = wanted.split('?')[0];
      for (const [stored, response] of this.entries) {
        if (stored.split('?')[0] === clean) return response.clone();
      }
    }
    return undefined;
  }
}

const caches = {
  async open(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    return new MockCache(name);
  },
  async keys() { return [...stores.keys()]; },
  async delete(name) { return stores.delete(name); }
};

async function mockFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input.url;
  requests.push({ url, cache: init.cache || null });
  if (offline) throw new TypeError('simulated offline network');
  return new Response('network:' + new URL(url).pathname, {
    status: forcedStatus || 200,
    headers: { 'content-type': url.endsWith('.html') ? 'text/html' : 'application/octet-stream' }
  });
}

const clients = {
  async claim() { claimCalls++; },
  async matchAll() { return []; },
  async openWindow() { return null; }
};
const self = {
  registration: { scope, showNotification: async () => {} },
  location: { origin: 'https://app.example.test' },
  clients,
  addEventListener(name, fn) { listeners[name] = fn; },
  async skipWaiting() { skipWaitingCalls++; }
};

vm.runInNewContext(swSource, {
  self, clients, caches, fetch: mockFetch, URL, Promise, Response,
  setTimeout, clearTimeout, console
});

let installPromise;
listeners.install({ waitUntil(promise) { installPromise = promise; } });
await installPromise;
assert.equal(skipWaitingCalls, 1, 'service worker activates after attempting shell precache');

const cache = await caches.open('seh-shell-v2');
const cachedIndex = await cache.match(scope + 'index.html');
const cachedSdk = await cache.match(scope + 'vendor/supabase-2.119.0.js');
const cachedNutritionBuilder = await cache.match(scope + 'coach-nutrition-builder.html');
assert.ok(cachedIndex, 'app index is included in the shell cache');
assert.ok(cachedSdk, 'the pinned local Supabase SDK is included in the shell cache');
assert.ok(cachedNutritionBuilder, 'the local nutrition builder is included in the shell cache');
assert.ok(requests.every(item => new URL(item.url).origin === new URL(scope).origin),
  'precache requests are restricted to same-origin app assets');

stores.set('seh-shell-old', new Map([['old', new Response('old')]]));
let activatePromise;
listeners.activate({ waitUntil(promise) { activatePromise = promise; } });
await activatePromise;
assert.equal(claimCalls, 1, 'active service worker claims existing app tabs');
assert.ok(!stores.has('seh-shell-old'), 'old app-shell cache versions are cleaned up');

offline = true;
let navigationResponse;
listeners.fetch({
  request: { method: 'GET', mode: 'navigate', url: scope + '?appicon=gold' },
  respondWith(promise) { navigationResponse = promise; }
});
assert.ok(navigationResponse, 'same-origin app navigation is handled');
const navigation = await navigationResponse;
assert.match(await navigation.text(), /network:\/fitness-seh-galeh\/index\.html/,
  'offline navigation falls back to the previously cached app shell');

let assetResponse;
listeners.fetch({
  request: { method: 'GET', mode: 'cors', url: scope + 'vendor/supabase-2.119.0.js?v=2' },
  respondWith(promise) { assetResponse = promise; }
});
assert.ok(assetResponse, 'known static app assets are handled');
const asset = await assetResponse;
assert.match(await asset.text(), /network:\/fitness-seh-galeh\/vendor\/supabase-2\.119\.0\.js/,
  'offline static asset requests use the cached asset');

let nutritionFrameResponse;
listeners.fetch({
  request: { method: 'GET', mode: 'navigate', url: scope + 'coach-nutrition-builder.html' },
  respondWith(promise) { nutritionFrameResponse = promise; }
});
const nutritionFrame = await nutritionFrameResponse;
assert.match(await nutritionFrame.text(), /network:\/fitness-seh-galeh\/coach-nutrition-builder\.html/,
  'embedded nutrition builder navigation serves its own cached document');

let topGenesisFrameResponse;
listeners.fetch({
  request: { method: 'GET', mode: 'navigate', url: scope + 'top-genesis-pdf-test.html?embedded=1' },
  respondWith(promise) { topGenesisFrameResponse = promise; }
});
const topGenesisFrame = await topGenesisFrameResponse;
assert.match(await topGenesisFrame.text(), /network:\/fitness-seh-galeh\/top-genesis-pdf-test\.html/,
  'embedded Top Genesis navigation serves its own cached document');
const appShellAfterFrames = await cache.match(scope + 'index.html');
assert.match(await appShellAfterFrames.text(), /network:\/fitness-seh-galeh\/index\.html/,
  'embedded frame navigation never overwrites the cached app shell');

let externalIntercepted = false;
listeners.fetch({
  request: { method: 'GET', mode: 'cors', url: 'https://qfakyudgidsumeuoqoot.supabase.co/rest/v1/trainees' },
  respondWith() { externalIntercepted = true; }
});
assert.equal(externalIntercepted, false, 'Supabase API requests are never intercepted or cached');

let dynamicIntercepted = false;
listeners.fetch({
  request: { method: 'GET', mode: 'cors', url: scope + 'user-data.json' },
  respondWith() { dynamicIntercepted = true; }
});
assert.equal(dynamicIntercepted, false, 'unknown same-origin paths are not cached');

let postIntercepted = false;
listeners.fetch({
  request: { method: 'POST', mode: 'cors', url: scope + 'rest/write' },
  respondWith() { postIntercepted = true; }
});
assert.equal(postIntercepted, false, 'write requests are never intercepted');

offline = false;
forcedStatus = 503;
let degradedNavigationResponse;
listeners.fetch({
  request: { method: 'GET', mode: 'navigate', url: scope },
  respondWith(promise) { degradedNavigationResponse = promise; }
});
const degradedNavigation = await degradedNavigationResponse;
assert.match(await degradedNavigation.text(), /network:\/fitness-seh-galeh\/index\.html/,
  'a server-side 5xx uses the cached shell instead of a blank error page');

// A failed update must not remove the currently active shell cache.
const originalFetch = globalThis.fetch;
// Simulate a newer worker whose required index cannot be fetched.
// Its failed install must not mutate or delete the currently active v2 cache.
offline = true;
const updateListeners = {};
let updateSkipWaitingCalls = 0;
const updateSelf = {
  ...self,
  addEventListener(name, fn) { updateListeners[name] = fn; },
  async skipWaiting() { updateSkipWaitingCalls++; }
};
vm.runInNewContext(swSource.replace("seh-shell-v2", "seh-shell-v3"), {
  self: updateSelf, clients, caches, fetch: mockFetch, URL, Promise, Response,
  setTimeout, clearTimeout, console
});
let failedUpdateInstall;
updateListeners.install({ waitUntil(promise) { failedUpdateInstall = promise; } });
await assert.rejects(failedUpdateInstall, /Required app shell index\.html could not be cached/);
assert.ok(stores.has('seh-shell-v2'), 'failed update preserves the previously active shell cache');
assert.ok(!stores.has('seh-shell-v3'), 'failed update removes its incomplete cache');
assert.equal(updateSkipWaitingCalls, 0, 'failed update never calls skipWaiting');
offline = false;

console.log('PASS: static app shell is cached; offline navigation, 5xx fallback and assets recover; Supabase/API and writes bypass the cache; push handlers remain registered.');
