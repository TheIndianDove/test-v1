// sw.js – Offline-first Atlas shell

const CACHE_NAME = 'atlas-v7'; // bump when you change caching logic

// All static app shell assets we want available when fully offline
const APP_SHELL = [
  './',
  './programs.html',
  './schedule.html',
  './log.html',
  './history.html',
  './tracker.html',
  './profile.html',
  './settings.html',
  './css/style.css',
  './functions.js',
  './manifest.webmanifest',
  './icons/atlas-logo.png',
  './icons/icons.svg'
];

// Detect localhost/127.0.0.1 (keep dev fresh)
const DEV = ['localhost', '127.0.0.1'].includes(
  new URL(self.registration.scope).hostname
);

self.addEventListener('install', (event) => {
  if (!DEV) {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
    );
  }
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isHTML =
    req.mode === 'navigate' ||
    req.headers.get('accept')?.includes('text/html');
  const isCSSJS = /\.(css|js|mjs)$/i.test(url.pathname);

  // --- Development: always go to network for HTML/CSS/JS
  if (DEV && (isHTML || isCSSJS)) {
    event.respondWith(fetch(req, { cache: 'no-store' }));
    return;
  }

  // --- HTML: cache-first, then network, then fallback
  if (isHTML) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;

        return fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
            return res;
          })
          .catch(() =>
            // last resort: show programs page
            caches.match('./programs.html')
          );
      })
    );
    return;
  }

  // --- CSS / JS: try cache, then network (and cache)
  if (isCSSJS) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchAndCache = fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
            return res;
          })
          .catch(() => cached);

        return cached || fetchAndCache;
      })
    );
    return;
  }

  // --- Other GETs: network-first with cache fallback
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
