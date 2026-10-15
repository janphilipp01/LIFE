// Life OS · Service Worker: App-Hülle und Bibliotheken offline verfügbar; Daten-Zwischenspeicher und Warteschlange liegen in shim.js
const CACHE = 'lifeos-v3';
const LIBS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com']; // feste Versionen der Bibliotheken – dürfen offline aus dem Cache kommen
const SHELL = ['/', '/index.html', '/shim.js', '/config.js', '/manifest.webmanifest', '/icons/icon-192.png', '/handy.html'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (LIBS.includes(u.hostname)) { e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(n => { if (n.ok) { const c = n.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return n; }))); return; }
  if (u.origin !== location.origin) return; // Supabase: nie cachen (Daten-Cache übernimmt shim.js)
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('/'))));
});

// Push-Mitteilungen
self.addEventListener('push', e => {
  let m = {}; try { m = e.data ? e.data.json() : {}; } catch (_) { m = { title: 'Life OS', body: e.data ? e.data.text() : '' }; }
  const jobs = [self.registration.showNotification(m.title || 'Life OS', { body: m.body || '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'lifeos-' + (m.url || ''), data: { url: m.url || '/' } })];
  if (typeof m.badge === 'number' && self.navigator && self.navigator.setAppBadge) jobs.push((m.badge ? self.navigator.setAppBadge(m.badge) : self.navigator.clearAppBadge()).catch(() => {}));
  e.waitUntil(Promise.all(jobs));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) { if ('focus' in w) { w.navigate(url).catch(() => {}); return w.focus(); } }
    return clients.openWindow(url);
  }));
});
