// Deployment refresh: ensure GitHub Pages republishes the latest coach workout PNG styling.
self.addEventListener('install', function (event) {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
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
