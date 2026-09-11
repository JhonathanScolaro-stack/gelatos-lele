const CACHE = 'gelatos-lele-company-v26-immediate-customer-stock';
const ASSETS = [
  './',
  './index.html',
  './styles-v18.css',
  './business-core.js',
  './cloud-config.js',
  './cloud-sync.js',
  './app-v18.js',
  './manifest.webmanifest',
  './service-worker.js',
  './logo-transparente-v2.png',
  './icon-oficial-v2.png',
  './customer.html',
  './customer.css',
  './customer.js'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match('./index.html')))
  );
});
