/* OmniAI 随身版 Service Worker v2
 * - 离线缓存界面（shell），断网也能打开。
 * - 预缓存 WebLLM 库；运行时把本地模型权重按 cache-first 缓存，
 *   因此首次联网下载后，断网也能从缓存跑真·本地大模型（安卓 Chrome / 支持 WebGPU 的浏览器）。
 * - iPhone Safari 无 WebGPU，仍由 app.js 降级为离线简版。
 */
var CACHE = "omniai-mobile-v2";
var SHELL = ["index.html", "styles.css", "app.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
var LIBS = ["https://esm.run/@mlc-ai/web-llm"];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(SHELL).then(function () {
        // 尽力预缓存 WebLLM 库（失败不影响安装，运行时仍会补缓存）
        return Promise.allSettled(LIBS.map(function (u) {
          return fetch(u).then(function (r) { if (r && (r.ok || r.type === "opaque")) return c.put(u, r); });
        }));
      });
    }).then(function () { self.skipWaiting(); })
  );
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
      caches.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) { cachePut(req, res.clone()); return res; });
      })
    );
    return;
  }

  // 跨域（WebLLM 库 / 模型 CDN）：cache-first + 在线时回填缓存。
  // 关键：首次联网下载的模型权重会被缓存，断网后直接命中缓存，
  // 使离线也能跑真·本地大模型；在线时命中缓存避免重复下载。
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && (res.ok || res.type === "opaque")) cachePut(req, res.clone());
        return res;
      }).catch(function () { return hit || Response.error(); });
    })
  );
});

function cachePut(req, res) {
  if (!res) return;
  caches.open(CACHE).then(function (c) { c.put(req, res).catch(function () {}); });
}
