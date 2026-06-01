const CACHE_NAME = 'paymesh-v101';

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

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = e.request.url;

  // NEVER cache these — always fetch fresh from network
  const neverCache =
    url.includes('app.js') ||
    url.includes('index.html') ||
    url.includes('sw.js') ||
    url.includes('firebase') ||
    url.includes('firestore') ||
    url.includes('gstatic.com/firebasejs') ||
    e.request.mode === 'navigate'; // THIS covers /paymesh/ navigation requests

  if (neverCache) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/paymesh/index.html'))
    );
    return;
  }

  // Cache first for icons, fonts only
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

// ── NOTIFICATION CLICK — opens PayMesh when user taps a notification ──
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Find an existing PayMesh tab and focus it
      for (const c of list) {
        if (c.url && c.url.includes('/paymesh/') && c.focus) {
          return c.focus();
        }
      }
      // No existing tab — open a new one
      return clients.openWindow('/paymesh/');
    })
  );
});
