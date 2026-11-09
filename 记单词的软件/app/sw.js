/**
 * sw.js — Service Worker（离线缓存）
 * ============================================================
 * 作用：第一次访问时把所有文件缓存到手机本地，
 *       以后即使断网 / 飞行模式也能正常打开 App。
 *
 * 四个关键设计：
 *   1. 核心代码必须整套缓存成功，装不完整就宁可不更新（避免新旧混搭白屏）。
 *   2. 【代码网络优先】js/css/html 联网时总是拿最新的一套，
 *      断网或超时才回退缓存 —— 这样升级后不会出现"新页面配旧模块"。
 *   3. 【资源缓存优先】图标、词库等大文件优先用缓存，省流量。
 *   4. 导航回退：从主屏幕打开的 URL 可能带参数，匹配不上时回退到缓存首页。
 *
 * 更新代码后：把 CACHE 版本号 +1（如 vocab-v17 → vocab-v18），
 *             用户下次打开会自动换上新版缓存。
 */

const CACHE = 'vocab-v30';

// 必须缓存的文件
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/config.js',
  './js/db.js',
  './js/seed.js',
  './js/ui.js',
  './js/pick.js',
  './js/schedule.js',
  './js/quiz.js',
  './js/synonym.js',
  './js/tts.js',
  './js/badge.js',
  './js/backup.js',
  './js/native-bridge.js',
  './assets/icon.svg',
  './assets/icon-180.png',
  './assets/icon-512.png',
  './data/words.json',
];

// 页面代码（必须成套更新）；其余是静态资源，允许单个失败
const isCore = (f) => f === './' || /\.(js|css|html)$/.test(f);
const CORE_FILES = FILES.filter(isCore);
const ASSET_FILES = FILES.filter(f => !isCore(f));

// 联网最多等 1.5 秒，慢网/断网时立刻用缓存，不让页面干等
const NETWORK_TIMEOUT = 1500;

// ---------- 安装：把所有文件存进手机 ----------
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    // cache:'reload' 绕过浏览器 HTTP 缓存，保证存进去的是服务器上的新文件
    // 核心代码用 Promise.all：任何一个失败就整体作废，绝不留下残缺缓存
    await Promise.all(
      CORE_FILES.map(f => cache.add(new Request(f, { cache: 'reload' })))
    );

    // 图标、词库等：单个失败只跳过它自己
    for (const f of ASSET_FILES) {
      await cache.add(new Request(f, { cache: 'reload' })).catch(() => {});
    }

    // 全部成功后才接管页面
    await self.skipWaiting();
  })());
});

// ---------- 激活：清理旧版本缓存 ----------
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// 带超时的网络请求：拿不到就返回 null（不抛错）
function fetchWithTimeout(request, ms) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(val);
    };
    const timer = setTimeout(() => done(null), ms);
    fetch(request, { cache: 'reload' })
      .then(res => done(res && res.ok ? res : null))
      .catch(() => done(null));
  });
}

// ---------- 拦截请求 ----------
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  const isCode = req.mode === 'navigate' || url.pathname.endsWith('/') ||
                 /\.(js|css|html)$/.test(url.pathname);

  if (isCode) {
    // 【代码网络优先】联网时拿最新的，顺手写回缓存；断网/超时用缓存
    e.respondWith((async () => {
      const net = await fetchWithTimeout(req, NETWORK_TIMEOUT);
      if (net) {
        const cache = await caches.open(CACHE);
        await cache.put(req, net.clone()).catch(() => {});
        return net;
      }

      const cached = await caches.match(req);
      if (cached) return cached;

      // 导航回退：从主屏幕打开带参数的网址，断网也能进首页
      if (req.mode === 'navigate') {
        const fallback = await caches.match('./index.html');
        if (fallback) return fallback;
      }
      return Response.error();
    })());
    return;
  }

  // 【静态资源缓存优先】图标、词库不常变，优先用本地缓存省流量
  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    try {
      const net = await fetch(req, { cache: 'reload' });
      if (net && net.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(req, net.clone()).catch(() => {});
      }
      return net;
    } catch (err) {
      // 词库兜底：断网且没缓存 → 返回空对象，db.js 会自动用样本数据
      if (req.url.includes('data/words.json')) {
        return new Response('{}', {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return Response.error();
    }
  })());
});
