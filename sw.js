const CACHE_NAME = 'paymesh-v3';
const REPO = '/paymesh';
const SHELL = [
  REPO + '/',
  REPO + '/index.html',
  REPO + '/app.js',
  REPO + '/manifest.json',
  REPO + '/icon-192-1.png',
  REPO + '/icon-512-1.png',
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Add shell files one by one so one failure doesn't break all
      return Promise.allSettled(SHELL.map(url => cache.add(url)));
    })
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

  // Always network-first for Firebase
  if (url.includes('firestore.googleapis.com') ||
      url.includes('firebase') ||
      url.includes('gstatic.com/firebasejs')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for shell assets
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (e.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        if (e.request.mode === 'navigate') return caches.match(REPO + '/index.html');
      });
    })
  );
});
