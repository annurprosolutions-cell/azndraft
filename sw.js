/* Service Worker — AZN Invoice
   Tukar VERSION setiap kali update fail supaya user dapat versi baru */
const VERSION = 'azn-invoice-v1.4.0';
const CORE = [
  './', './index.html', './css/style.css', './js/config.js', './js/app.js', './manifest.json',
  './assets/logo.png', './assets/stamp.png', './assets/signature.png',
  './assets/icon-192.png', './assets/icon-512.png', './assets/apple-touch-icon.png', './assets/favicon.png',
  './assets/fonts/carlito-latin-400-normal.woff2', './assets/fonts/carlito-latin-700-normal.woff2'
];
const CDN = [
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(CORE);
    await Promise.all(CDN.map(u => fetch(u, { mode: 'no-cors' }).then(r => c.put(u, r)).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Jangan cache API Apps Script
  if (url.hostname.includes('script.google') || url.hostname.includes('googleusercontent')) return;

  // Network-first untuk fail app (supaya update cepat), fallback cache bila offline
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const fresh = await fetch(req);
      if (fresh && (fresh.ok || fresh.type === 'opaque')) cache.put(req, fresh.clone());
      return fresh;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return cache.match('./index.html');
      throw err;
    }
  })());
});
