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
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        if ('navigate' in client && client.url !== targetUrl.href) {
          try { await client.navigate(targetUrl.href); } catch (error) {}
        }
        return client.focus();
      }
    }
    return clients.openWindow(targetUrl.href);
  })());
});
