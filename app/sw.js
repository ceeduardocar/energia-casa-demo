importScripts("version.js");
// Cache com o nome da versão. O app abre do cache (sem esperar a rede); uma versão nova de version.js
// instala um cache novo já cheio e assume na hora. Os dados do banco nunca ficam em cache.
const V = "energykontrol-v" + self.APP_VERSION, SHELL = ["version.js", "./", "index.html", "styles.css", "app.js", "house-view.js", "util.js", "charts.js", "events.js", "demo.js", "supa.js", "config.js", "preconnect.js", "bills.js", "credits-months.js", "credits-html.js", "contas.js", "billparse.js", "manifest.webmanifest", "assets/casa-noite.webp", "fonts/manrope-latin-wght.woff2", "vendor/supabase.umd.js", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/maskable-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
const store = (req, res) => { if (res.ok) { const c = res.clone(); caches.open(V).then(x => x.put(req, c)); } return res; };
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return; // banco e outros sites: direto na rede
  // config.js pode mudar sem nova versão: rede primeiro. O resto: cache primeiro.
  if (u.pathname.endsWith("/config.js")) { e.respondWith(fetch(e.request).then(r => store(e.request, r)).catch(() => caches.match(e.request))); return; }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => store(e.request, r)).catch(() => caches.match("index.html"))));
});
