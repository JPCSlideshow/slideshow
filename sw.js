/* Keeps the slideshow, its photos and fonts on the device, so the link still opens and photos still show
   when the store's internet is slow or drops. Product prices/stock still come live from the website. */
const SHELL = "jw-shell-v1", PHOTOS = "jw-photos-v1", MAX_PHOTOS = 150;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

function timeout(ms){ return new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)); }

// Slideshow files: try the internet first (so updates arrive), fall back to the saved copy
async function networkFirst(req){
  const cache = await caches.open(SHELL);
  try {
    const res = await Promise.race([fetch(req), timeout(15000)]);
    if (res && res.ok){
      const url = new URL(req.url);
      if (url.pathname.endsWith("/app.js")){          // keep only the newest app.js
        for (const k of await cache.keys()) if (new URL(k.url).pathname === url.pathname && k.url !== req.url) await cache.delete(k);
      }
      const key = url.pathname.endsWith("/version.js") ? url.origin + url.pathname : req.url;
      await cache.put(key, res.clone());
    }
    return res;
  } catch (e) {
    const hit = await cache.match(req) || await cache.match(req, {ignoreSearch: true});
    if (hit) return hit;
    throw e;
  }
}

// Photos and fonts: use the saved copy if there is one, otherwise download and save it
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
        for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);   // drop the oldest
      }
    } catch (e) { /* storage full: just don't save */ }
  }
  return res;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;                    // product lookups go straight to the website
  const url = new URL(req.url);
  if (url.origin === self.location.origin) { e.respondWith(networkFirst(req)); return; }
  if (url.hostname.endsWith("saleor.cloud") && url.pathname.indexOf("/media/") !== -1) { e.respondWith(cacheFirst(req, PHOTOS, MAX_PHOTOS)); return; }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") { e.respondWith(cacheFirst(req, SHELL)); return; }
});
