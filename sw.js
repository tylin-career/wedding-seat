/* 婚宴尋座 離線快取 Service Worker
   策略：頁面（含 ?q= ?t= 深連結）走「網路優先」確保名單隨時最新，斷網時退回快取；
   字型等靜態資源走「快取優先」，宴會廳弱網時加速載入。 */
const CACHE = "seat-v1";

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.add("./index.html")).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;

  /* 頁面導航：網路優先；成功就更新快取，失敗（離線）退回快取的 index.html。
     統一存成 ./index.html，讓 / 、/index.html、/?q=、/?t= 都能命中同一份。 */
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok && !res.redirected) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put("./index.html", clone));
        }
        return res;
      }).catch(() => caches.match("./index.html"))
    );
    return;
  }

  /* 其他資源（Google Fonts CSS / 字型檔、圖示）：快取優先，未命中再抓網路並存起來。
     跨來源 no-cors 回應是 opaque（status 0），也允許快取，字型才能離線使用。 */
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res && (res.ok || res.type === "opaque")) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }))
  );
});
