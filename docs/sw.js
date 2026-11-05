// Keeps the app itself available offline. Requests to the backend are never cached.
// Serves the saved copy at once and refreshes it in the background, so updates appear on the next open.
const CACHE = 'calendar-shell-v2';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'api.js', 'settings.js', 'week.js', 'voice.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'fonts/source-serif-4-latin-wght-normal.woff2', 'fonts/frank-ruhl-libre-hebrew-wght-normal.woff2',
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
    const cached = await cache.match(event.request, { ignoreSearch: true });
    const refresh = fetch(event.request).then((response) => {
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    });
    if (cached) {
      event.waitUntil(refresh.catch(() => {}));
      return cached;
    }
    return refresh;
  }));
});
