// Keeps the app itself available offline. Requests to the backend are never cached.
// Always asks the network first so updates appear straight away, and uses the saved copy only when offline.
const CACHE = 'calendar-shell-v11';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'api.js', 'settings.js', 'week.js', 'voice.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'fonts/montserrat-latin-wght-normal.woff2', 'fonts/heebo-hebrew-wght-normal.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(caches.open(CACHE).then(async (cache) => {
    try {
      const response = await fetch(event.request, { cache: 'no-cache' });
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      throw error;
    }
  }));
});
