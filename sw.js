// Minimal offline support. index.html is network-first so a new deploy shows up
// on the next online visit; everything else (CSS, JS modules, icons) is cached on
// first use. Bump CACHE whenever you want to force clients to re-fetch.
const CACHE = 'macaron-ledger-v2';
const PRECACHE = [
  './',
  'index.html',
  'app.css',
  'js/boot.js',
  'js/app.js',
  'js/data.js',
  'js/store.js',
  'js/money.js',
  'js/dates.js',
  'js/categories.js',
  'js/analytics.js',
  'js/charts.js',
  'js/csv.js',
  'js/backup.js',
  'js/ui.js',
  'js/gate.js',
  'manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
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
