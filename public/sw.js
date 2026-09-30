// Arnav Island's offline shell: the app opens instantly, with or without a network. Only this site's own files are kept;
// nothing from your PCs ever passes through here (the relay is a WebSocket, which a service worker never sees).
const VERSION = 'island-v1.0.0';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/apple-touch-icon.png', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const req = event.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Pages: the network first (so an update shows at once), the kept shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3500);
        const res = await fetch(req, { signal: ctl.signal }); clearTimeout(t);
        if (res.ok) { const c = await caches.open(VERSION); await c.put('/', res.clone()); }
        return res;
      } catch { return (await caches.match('/')) ?? Response.error(); }
    })());
    return;
  }
  // The app's files (named by their contents, so they never change): kept once fetched.
  event.respondWith((async () => {
    const hit = await caches.match(req); if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/splash/'))) { const c = await caches.open(VERSION); await c.put(req, res.clone()); }
    return res;
  })());
});
