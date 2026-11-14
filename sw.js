/* Fitness Seh Galeh service worker.
 * Cache only the static application shell. Never cache Supabase/API/user data.
 */
'use strict';

const SHELL_CACHE_NAME = 'seh-shell-v1';
const SHELL_ASSETS = [
  'index.html',
  'manifest.json',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'vendor/supabase-2.119.0.js',
  'coach-nutrition-builder.html',
  'top-genesis-pdf-app-embed.js',
  'top-genesis-pdf-test.html',
  'top-genesis-pdf-parser.js',
  'top-genesis-csv-parser.js',
  'top-genesis-publication.js',
  'top-genesis-archive.js'
];
const SHELL_ASSET_PATHS = new Set(SHELL_ASSETS);
const APP_SCOPE = new URL(self.registration.scope);
const APP_ROOT_PATH = APP_SCOPE.pathname;
const INDEX_URL = new URL('index.html', APP_SCOPE).href;
const NAVIGATION_FALLBACK_DELAY_MS = 800;

function isInAppScope(url) {
  return url.origin === APP_SCOPE.origin && url.pathname.startsWith(APP_ROOT_PATH);
}

function relativeAppPath(url) {
  return url.pathname.slice(APP_ROOT_PATH.length).replace(/^\/+/, '');
}

async function cacheShellAsset(cache, relativePath) {
  const url = new URL(relativePath, APP_SCOPE).href;
  try {
    const response = await fetch(url, { cache: 'reload' });
    if (response && response.ok && response.type !== 'opaque') {
      await cache.put(url, response.clone());
    }
  } catch (_) {
    // A missing optional asset must not prevent the app shell from installing.
  }
}

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    const cache = await caches.open(SHELL_CACHE_NAME);
    await Promise.allSettled(SHELL_ASSETS.map(path => cacheShellAsset(cache, path)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith('seh-shell-') && name !== SHELL_CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function serveNavigation(request) {
  const cachedShell = caches.open(SHELL_CACHE_NAME).then(cache => cache.match(INDEX_URL));
  const network = fetch(request).then(async response => {
    if (response && response.status >= 500) {
      return await cachedShell || response;
    }
    if (response && response.ok && response.type !== 'opaque') {
      const cache = await caches.open(SHELL_CACHE_NAME);
      await cache.put(INDEX_URL, response.clone());
    }
    return response;
  });

  const delayedCache = new Promise(resolve => {
    setTimeout(() => resolve(null), NAVIGATION_FALLBACK_DELAY_MS);
  }).then(async () => await cachedShell);

  try {
    const response = await Promise.race([network, delayedCache]);
    return response || await network;
  } catch (_) {
    return await cachedShell || Response.error();
  }
}

async function serveStaticAsset(request, relativePath) {
  const key = new URL(relativePath, APP_SCOPE).href;
  const cache = await caches.open(SHELL_CACHE_NAME);
  const cached = await cache.match(key);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.ok && response.type !== 'opaque') {
      await cache.put(key, response.clone());
    }
    return response;
  } catch (_) {
    return await cache.match(key) || Response.error();
  }
}

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (!request || request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch (_) { return; }
  if (!isInAppScope(url)) return;

  const relativePath = relativeAppPath(url);
  if (request.mode === 'navigate' && (relativePath === '' || relativePath === 'index.html')) {
    event.respondWith(serveNavigation(request));
    return;
  }

  if (SHELL_ASSET_PATHS.has(relativePath)) {
    event.respondWith(serveStaticAsset(request, relativePath));
  }
});

self.addEventListener('push', function (event) {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'فیتنس سه‌قلعه';
  const options = {
    body: data.body || 'یک پیام جدید از شاگرد دریافت کردید.',
    tag: data.tag || 'fitness-seh-galeh-chat',
    renotify: false,
    data: {
      url: './',
      trainee_id: data.trainee_id || null
    }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  event.waitUntil((async function () {
    const notificationData = event.notification.data || {};
    let targetUrl = new URL(notificationData.url || './', self.registration.scope);
    const traineeId = notificationData.trainee_id;

    // Carry the trainee ID into the app so the coach chat can open the right conversation.
    if (traineeId && /^[0-9a-f-]{36}$/i.test(String(traineeId))) {
      targetUrl.searchParams.set('openChatTrainee', String(traineeId));
    }
    if (targetUrl.origin !== self.location.origin) {
      targetUrl = new URL(self.registration.scope);
    }

    const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      if (new URL(client.url).origin !== self.location.origin || !('focus' in client)) continue;

      // If the app is already open, ask that page to open the exact trainee chat.
      // Keep the URL-based route as a fallback for older pages without the listener.
      if (traineeId && /^[0-9a-f-]{36}$/i.test(String(traineeId)) && 'postMessage' in client) {
        try {
          client.postMessage({ type: 'OPEN_CHAT_TRAINEE', trainee_id: String(traineeId) });
          return client.focus();
        } catch (error) {}
      }

      if ('navigate' in client && client.url !== targetUrl.href) {
        try { await client.navigate(targetUrl.href); } catch (error) {}
      }
      return client.focus();
    }
    return clients.openWindow(targetUrl.href);
  })());
});
