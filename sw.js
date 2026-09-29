/* 汇市物语 Service Worker：缓存优先的 App Shell（纯静态、无构建） */
const CACHE = 'forextale-v4';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './src/core/prng.js',
  './src/core/bus.js',
  './src/core/store.js',
  './src/market/pairs.js',
  './src/market/sim.js',
  './src/engine/engine.js',
  './src/battle/battles.js',
  './src/battle/replay.js',
  './src/chart/chart.js',
  './src/ui/explain.js',
  './src/ui/toasts.js',
  './src/ui/tutorial.js',
  './src/ui/leaderboard.js',
  './src/ui/app.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).pathname.startsWith('/api/')) return; // 龙虎榜 API 直连，不缓存
  // 网络优先：在线永远拿最新代码，离线回退缓存（小体量静态站，无需版本博弈）
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./')))
  );
});
