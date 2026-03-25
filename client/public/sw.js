const SW_VERSION = 'heartogether-sw-v2';

// App shell assets to pre-cache so Chrome considers the SW functional
// and shows the PWA install prompt on Android.
const APP_SHELL = ['/', '/manifest.webmanifest', '/favicon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SW_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
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

// Network-first strategy.  Real-time audio signaling and API calls always
// go to the network first; cached responses are only used as a fallback so
// the app shell still loads when offline.  This fetch handler is required
// for Chrome to consider the service worker "functional" and surface the
// PWA install prompt on Android.
self.addEventListener('fetch', (event) => {
  // Only handle same-origin GET requests; skip cross-origin, non-GET, and
  // chrome-extension schemes to avoid interfering with WebSocket/Socket.IO.
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache successful GET responses for app-shell assets.
        if (response.ok && APP_SHELL.includes(url.pathname)) {
          const clone = response.clone();
          caches.open(SW_VERSION).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request)),
  );
});