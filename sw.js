const CACHE_NAME = 'paymesh-v10';

// On install — cache only static assets, NOT app.js
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll([
      '/paymesh/icon-192-1.png',
      '/paymesh/icon-512-1.png',
      '/paymesh/manifest.json'
    ]))
  );
  self.skipWaiting();
});

// On activate — delete ALL old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy:
// - index.html and app.js → ALWAYS network first, never serve from cache
// - Firebase → always network
// - Everything else → cache first
self.addEventListener('fetch', (e) => {
  const url = e.request.url;

  // Never cache app logic files — always get fresh from network
  if (url.includes('app.js') || url.includes('index.html') ||
      url.includes('firebase') || url.includes('firestore') ||
      url.includes('gstatic.com/firebasejs')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache first for icons, fonts, etc.
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (e.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return response;
      });
    })
  );
});
