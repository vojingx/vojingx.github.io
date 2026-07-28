/* OmniAI 随身版 Service Worker：离线缓存界面 + 尽力缓存本地模型，断网可用 */
var CACHE = "omniai-mobile-v1";
var SHELL = ["index.html", "styles.css", "app.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  // 同源：cache-first（界面离线秒开）
  if (new URL(req.url).origin === location.origin) {
    e.respondWith(
      caches.match(req).then(function (hit) { return hit || fetch(req).then(function (res) { cachePut(req, res); return res; }); })
    );
    return;
  }
  // 跨域（WebLLM 库 / 模型 CDN）：尽力缓存，失败则走网络
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && (res.ok || res.type === "opaque")) cachePut(req, res.clone());
      return res;
    }).catch(function () { return caches.match(req); })
  );
});

function cachePut(req, res) {
  if (!res) return;
  caches.open(CACHE).then(function (c) { c.put(req, res).catch(function () {}); });
}
