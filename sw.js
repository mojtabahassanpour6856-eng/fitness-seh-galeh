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
    renotify: true,
    data: { url: data.url || '/fitness-seh-galeh/' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const targetUrl = new URL('/fitness-seh-galeh/', self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (const client of clientList) {
        if (client.url.startsWith(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});
