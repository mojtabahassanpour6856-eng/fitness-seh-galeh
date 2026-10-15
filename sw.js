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
    // Keep the destination sent with the push, if provided.
    data: { url: data.url || './' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  event.waitUntil((async function () {
    const notificationData = event.notification.data || {};
    let targetUrl;

    try {
      targetUrl = new URL(notificationData.url || './', self.registration.scope).href;
    } catch (error) {
      targetUrl = self.registration.scope;
    }

    // Only navigate within this app's origin.
    const parsedTarget = new URL(targetUrl);
    if (parsedTarget.origin !== self.location.origin) {
      targetUrl = self.registration.scope;
    }

    const clientList = await clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    // If the app is already open, navigate that window to the notification
    // destination before focusing it, rather than merely focusing the old page.
    for (const client of clientList) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        if ('navigate' in client && client.url !== targetUrl) {
          try {
            await client.navigate(targetUrl);
          } catch (error) {
            // Focusing is still useful if navigation is blocked.
          }
        }
        return client.focus();
      }
    }

    return clients.openWindow(targetUrl);
  })());
});
