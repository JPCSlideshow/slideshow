/* Keeps the slideshow, its photos and fonts on the device, so the link still opens and photos still show
   when the store's internet is slow or drops. Product prices/stock still come live from the website.
   Rule: if the internet answers, use it. Only fall back to the saved copy when the internet fails.
   Never make the page fail when the browser on its own would have loaded it. */
const SHELL = "jw-shell-v2", PHOTOS = "jw-photos-v1", MAX_PHOTOS = 150;

self.addEventListener("install", e => {
  self.skipWaiting();
  // save the start page straight away, so it's on the device even before the first reload
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(["./", "./version.js", "./stores.js"])).catch(() => {}));
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL && k !== PHOTOS) await caches.delete(k);   // clear old versions
    await self.clients.claim();
  })());
});

function keyFor(req){
  const u = new URL(req.url);
  if (req.mode === "navigate" || u.pathname.endsWith("/") || u.pathname.endsWith("/index.html")) return u.origin + u.pathname.replace(/index\.html$/, "");
  if (u.pathname.endsWith("/version.js") || u.pathname.endsWith("/stores.js")) return u.origin + u.pathname;
  return req.url;                                   // app.js keeps its ?v= so each version is separate
}

async function networkFirst(req){
  const cache = await caches.open(SHELL);
  const key = keyFor(req);
  const saved = await cache.match(key) || await cache.match(req, {ignoreSearch: true});
  // pages and version files: always check GitHub for the newest copy (skip the browser's 10-minute cache)
  const net = fetch(req).then(async res => {
    if (res && res.ok && res.type === "basic"){
      if (new URL(req.url).pathname.endsWith("/app.js")){   // keep only the newest app.js
        for (const k of await cache.keys()) if (new URL(k.url).pathname.endsWith("/app.js") && k.url !== req.url) await cache.delete(k);
      }
      await cache.put(key, res.clone()).catch(() => {});
    }
    return res;
  });
  if (!saved) return net;                           // nothing saved yet: behave exactly like a normal page load
  // something saved: give the internet 10 seconds, then use the saved copy
  return Promise.race([
    net.catch(() => saved),
    new Promise(r => setTimeout(() => r(saved), 10000))
  ]);
}

async function cacheFirst(req, name, limit){
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === "opaque")){
    try {
      await cache.put(req, res.clone());
      if (limit){
        const keys = await cache.keys();
        for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);
      }
    } catch (e) { /* storage full: just don't save */ }
  }
  return res;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;                 // product lookups go straight to the website
  const url = new URL(req.url);
  if (url.origin === self.location.origin){
    if (url.pathname.endsWith("/sw.js")) return;
    e.respondWith(networkFirst(req).catch(() => fetch(req)));
    return;
  }
  if (url.hostname.endsWith("saleor.cloud") && url.pathname.indexOf("/media/") !== -1){ e.respondWith(cacheFirst(req, PHOTOS, MAX_PHOTOS).catch(() => fetch(req))); return; }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com"){ e.respondWith(cacheFirst(req, SHELL).catch(() => fetch(req))); return; }
});
