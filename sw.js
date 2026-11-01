// 앱 설치(PWA)용 서비스 워커: 이 사이트의 파일만 캐시해서 오프라인에서도 화면이 열리게 합니다.
// 구글 로그인, 클래스룸 API, AI 서버 같은 외부 요청은 건드리지 않습니다.
const CACHE = "suhaeng-collector-v1";
const FILES = ["./", "./index.html", "./style.css", "./app.js", "./manifest.json",
  "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// 네트워크 우선(항상 최신 버전), 오프라인이면 캐시 사용
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })
        .then((r) => r || caches.match("./index.html")))
  );
});
