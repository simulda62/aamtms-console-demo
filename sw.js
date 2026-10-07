// AAM TMS 관제 화면 시안 - 오프라인 보관(서비스 워커)
// - 같은 출처의 화면 파일(index.html, css, js, img, vendor)만 보관함. 지도 타일 등 외부 자원은 보관하지 않음(지도 제공처 이용 조건).
// - 연결되어 있으면 항상 새 파일을 받고(네트워크 우선) 받은 것을 보관함. 연결이 없으면 보관본을 씀.
// - 한 번 열면 그다음부터는 인터넷 없이도 열리고 작동함.
const CACHE = 'aamtms-console-demo-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('aamtms-console-demo-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// 화면이 처음 열릴 때(서비스 워커가 아직 관여하기 전) 받은 파일 목록을 화면에서 보내 주면 보관함
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type !== 'precache' || !Array.isArray(d.urls)) return;
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(d.urls.map(async url => {
      try {
        const u = new URL(url, self.registration.scope);
        if (u.origin !== self.location.origin) return;
        const page = d.page && u.href === new URL(d.page, self.registration.scope).href;
        if (!page && await cache.match(u.href)) return;
        const res = await fetch(u.href);
        if (res.ok) await cache.put(page ? self.registration.scope : u.href, res);
      } catch (err) { /* 연결 없음: 다음 기회에 보관 */ }
    }));
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 외부 자원은 관여하지 않음
  if (url.pathname.endsWith('.zip')) return; // 내려받기용 압축 파일은 보관하지 않음
  const nav = req.mode === 'navigate';
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      // 화면(index.html)은 주소 뒤 조건(?view= 등)과 상관없이 하나로 보관함
      if (res.ok) await cache.put(nav ? self.registration.scope : req, res.clone());
      return res;
    } catch (err) {
      const hit = nav
        ? await cache.match(self.registration.scope)
        : (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true }));
      if (hit) return hit;
      throw err;
    }
  })());
});
