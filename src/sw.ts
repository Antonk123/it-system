import { precacheAndRoute } from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope;

// Precache manifest - replaced by vite-plugin-pwa at build time
precacheAndRoute(self.__WB_MANIFEST);

// NOTE: Runtime caching for /api/* intentionally omitted.
// This app requires LAN access to the Docker server; offline API caching adds
// complexity without benefit. See 20-RESEARCH.md Assumption A1.

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json() as {
    type: string;
    ticketId: string;
    title: string;
    body: string;
  };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      data: { ticketId: data.ticketId, url: `/tickets/${data.ticketId}` },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url: string = event.notification.data?.url ?? '/';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url.includes(url) && 'focus' in client) return client.focus();
        }
        return self.clients.openWindow(url);
      })
  );
});
