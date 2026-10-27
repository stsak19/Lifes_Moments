/*
 * Service worker for the owners' admin (scope: admin pages only).
 * It shows notifications and opens the right request when one is tapped.
 *
 * Today the admin shows test notifications itself through this worker.
 * Later the server (a Supabase Edge Function) sends real Web Push messages when a
 * guest sends a request and 4 hours before a request expires. The message is JSON:
 *   { "title": "...", "body": "...", "url": "admin.html?req=<id>", "tag": "req-<id>" }
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || "Life's Moments", {
    body: d.body || 'Νέο αίτημα κράτησης',
    icon: 'icons/admin-192.png',
    badge: 'icons/badge-96.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    requireInteraction: true,
    data: { url: d.url || 'admin.html' }
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || 'admin.html', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    // the phone app (admin-mobile.html) and the desktop admin both handle ?req=<id>
    const isAdmin = (w) => /\/admin(-mobile)?\.html$/.test(new URL(w.url).pathname);
    const open = wins.find((w) => new URL(w.url).pathname.endsWith('/admin-mobile.html')) || wins.find(isAdmin);
    if (open) { open.postMessage({ open: url }); return open.focus(); }
    const narrow = /Mobi|Android|iPhone/.test(self.navigator.userAgent);
    return self.clients.openWindow(narrow ? url.replace('/admin.html', '/admin-mobile.html') : url);
  }));
});
