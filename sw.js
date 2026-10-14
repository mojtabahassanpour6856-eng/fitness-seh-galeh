self.addEventListener('push', function (event) {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = {
      body: event.data ? event.data.text() : ''
    };
  }

  const title = data.title || 'فیتنس سه‌قلعه';
  const options = {
    body: data.body || 'یک پیام جدید از شاگرد دریافت کردید.',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: 'fitness-seh-galeh-chat',
    renotify: true,
    data: {
      url:
