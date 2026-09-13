// Minimal offline support: everything the app fetches from its own origin is cached on first use.
// index.html is network-first so a new deploy shows up on the next online visit; hashed
// bundles and fonts are cache-first because their names change when their content does.
const CACHE = 'macaron-ledger-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const isShell = req.mode === 'navigate' || req.url.endsWith('/') || req.url.endsWith('index.html');
  event.respondWith(isShell ? networkFirst(req) : cacheFirst(req));
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
    return res;
  } catch {
    return (await caches.match(req)) || (await caches.match('./')) || Response.error();
  }
}
