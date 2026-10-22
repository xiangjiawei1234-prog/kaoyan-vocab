/* 背单词网页 — 离线缓存（应用壳 + 考研/四级/六级/综合词库）
   整组发布：新版本在自己的缓存里完整下载后才等待启用；旧页面继续读旧缓存，
   不会出现 HTML/CSS/JS 来自不同版本的混用。 */
const CACHE = "kaoyan-vocab-v42";
const ASSETS = [
  "./",
  "./index.html",
  "./css/app.css?v=20261022-r37",
  "./js/app.js?v=20261022-r37",
  "./js/words-data.js",
  "./js/cet-words-data.js",
  "./js/combined-words-data.js",
  "./js/senses-data.js",
  "./js/txt-zip.js",
  "./manifest.webmanifest",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
  "./assets/icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  // 只下载、不跳过等待：等所有旧页面关闭后再由 activate 启用整组新资源。
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" }))))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("kaoyan-vocab-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 为用户明确触发的更新入口保留安全切换；普通访问不自动打断当前会话。
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 只读本应用的当前版本缓存；不回退到别的缓存，也不逐文件后台覆盖。
  const current = caches.open(CACHE);
  if (req.mode === "navigate") {
    // 页面导航固定读当前版本缓存中的 index.html，避免网络返回半新半旧的壳。
    event.respondWith(
      current.then((cache) => cache.match("./index.html")).then((hit) => hit || fetch(req))
    );
    return;
  }
  event.respondWith(
    current.then((cache) => cache.match(req)).then((hit) => hit || fetch(req))
  );
});
