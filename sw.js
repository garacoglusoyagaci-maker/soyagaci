// Servis çalışanı: uygulama dosyalarını önbelleğe alır. Önce ağdan dener (güncellemeler hemen gelir),
// ağ yoksa önbellekten açar. Supabase ve diğer dış adreslere karışmaz.
const CACHE = "soyagaci-v15";
const SHELL = ["./", "index.html", "style.css", "app.js", "config.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Supabase, CDN vb. doğrudan ağa gider
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((m) => m || caches.match("index.html")))
  );
});

// ---------- Yönetici bildirimleri (Web Push) ----------
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Soyağacı", {
    body: d.body || "Onayınıza yeni bir işlem düştü.",
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: d.tag || "soyagaci-onay",
    renotify: true,
    data: { go: d.go || "approvals" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const go = (e.notification.data && e.notification.data.go) || "approvals";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) { c.postMessage({ go }); return c.focus(); }
      }
      return self.clients.openWindow("./#" + go);
    })
  );
});
