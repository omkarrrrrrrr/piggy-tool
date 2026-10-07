/* Piggy service worker: makes the app open instantly and work offline.
   Everything the app needs is cached for offline use, but the network always wins when it is
   reachable, so a new version appears on the next open. User data is never touched here (it lives in the page's storage). */
const CACHE = 'piggy-shell-v2';
const SHELL = [
  '/', '/style.css', '/app.js', '/parser.js',
  '/manifest.json', '/icon-192.png', '/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const ours = url.origin === location.origin && url.pathname.startsWith('/');
  const font = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!ours && !font) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req, ours ? { cache: 'no-cache' } : undefined)
      .then((res) => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; })
      .catch(() => null);
    if (font && hit) { e.waitUntil(net); return hit; } // fonts never change: cache first
    // the app itself: network first so a deploy shows up on the very next open; the cache is only the offline fallback
    const res = await Promise.race([net, new Promise((r) => setTimeout(() => r(null), 4000))]);
    if (res) return res;
    return hit || (await net) || (req.mode === 'navigate' ? cache.match('/') : Response.error());
  }));
});
