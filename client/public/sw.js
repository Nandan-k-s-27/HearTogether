const SW_VERSION = 'heartogether-sw-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== SW_VERSION)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

// Keep network behavior unchanged for realtime audio signaling and API calls.
self.addEventListener('fetch', () => {
  // Intentionally no custom caching strategy.
});