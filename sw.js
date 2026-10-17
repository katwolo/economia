// Red primero, caché como respaldo: la app funciona sin conexión.
// Al publicar cambios, sube el número (y APP_VERSION en app.js).
const CACHE = 'economia-v6';
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'db.js', 'categories.js', 'importer.js', 'charts.js', 'sync.js', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  const cleanup = caches.keys().then(async (keys) => {
    const old = keys.filter((k) => k !== CACHE);
    await Promise.all(old.map((k) => caches.delete(k)));
    await self.clients.claim();
    return old.length > 0;
  });
  e.waitUntil(cleanup);
  // Si había una versión anterior, la app abierta se recarga una vez para usar ya la nueva (las
  // versiones antiguas no sabían hacerlo solas). Va fuera de waitUntil: la recarga pasa por este
  // mismo service worker y tiene que esperar a que termine de activarse.
  cleanup.then(async (updated) => {
    if (!updated) return;
    const wins = await self.clients.matchAll({ type: 'window' });
    wins.forEach((w) => w.navigate(w.url).catch(() => {}));
  });
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // "no-cache": con conexión siempre se pregunta al servidor si hay versión nueva, en vez de usar
  // la copia que el navegador guarda unos minutos. Sin conexión se usa la caché de la app.
  e.respondWith(
    fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
