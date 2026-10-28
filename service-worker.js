const CACHE = 'gelatos-lele-company-v69-push';
const ASSETS = [
  './',
  './index.html',
  './styles-v11.css',
  './styles-v18.css',
  './styles-v32.css',
  './styles-v51.css',
  './styles-v59.css',
  './styles-v60.css',
  './styles-v61.css',
  './styles-v62.css',
  './styles-v63.css',
  './styles-v64.css',
  './styles-v65.css',
  './styles-v66.css',
  './styles-v67.css',
  './business-core.js',
  './cloud-config.js',
  './cloud-sync.js',
  './app-v18.js',
  './manifest.webmanifest',
  './service-worker.js',
  './logo-transparente-v2.png',
  './icon-logo-sistema-v68.png',
  './icon-oficial-v2.png',
  './customer.html',
  './customer.css',
  './customer-v31.css',
  './customer-v32.css',
  './customer-v36.css',
  './customer-v51.css',
  './customer-v53.css',
  './customer-v59.css',
  './customer-v60.css',
  './customer-v62.css',
  './customer-v64.css',
  './customer-v65.css',
  './customer-v66.css',
  './customer-v67.css',
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
  // O catálogo e os pedidos vêm da nuvem. Nunca colocamos respostas do
  // banco no cache do navegador: assim o próximo cliente vê o estoque real.
  if (new URL(event.request.url).origin !== self.location.origin) return;
  const url = new URL(event.request.url);
  // HTML sempre vem primeiro da rede. Assim quem instalou o app não fica preso
  // em uma tela/script antigo depois que a empresa publica uma correção.
  if (event.request.mode === 'navigate') {
    const fallback = url.pathname.endsWith('/customer.html') ? './customer.html' : './index.html';
    event.respondWith(fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(fallback)));
    return;
  }
  // Arquivos versionados precisam respeitar a versão. Assim a próxima versão
  // do app não recebe um JavaScript antigo apenas porque tem o mesmo nome.
  // Para arquivos sem versão, a cópia pré-armazenada continua disponível offline.
  const matchOptions = url.searchParams.has('v') ? undefined : { ignoreSearch: true };
  event.respondWith(caches.match(event.request, matchOptions).then(cached => cached || fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request, { ignoreSearch: true }))));
});
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) { payload = { body: event.data?.text?.() || '' }; }
  event.waitUntil(self.registration.showNotification(payload.title || 'Novo pedido no Gelatos Lele', {
    body: payload.body || 'Abra o app para conferir o pedido.', icon: './icon-logo-sistema-v68.png', badge: './icon-logo-sistema-v68.png',
    tag: payload.tag || 'gelatos-pedido', renotify: true, vibrate: [120, 70, 120], data: { url: String(payload.url || './?abrir=pedidos') }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './?abrir=pedidos', self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => client.url.startsWith(self.location.origin));
    if (existing) return existing.focus().then(() => existing.navigate(target));
    return clients.openWindow(target);
  }));
});
