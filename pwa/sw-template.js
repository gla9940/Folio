// VERSION and PRECACHE are injected from the exact production build.
const PREFIX = 'folio-app-v1-';
const CACHE = PREFIX + VERSION;
const ownedCache = name => name.startsWith(PREFIX) && /^[a-f0-9]{20}$/.test(name.slice(PREFIX.length));
const urls = new Set(PRECACHE.map(entry => entry.url));
const hex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const PREVIOUS = '/__folio_app_previous__';
async function activeVersion() {
  if (!self.registration.active) return null;
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {channel.port1.close(); resolve(null);}, 2000);
    channel.port1.onmessage = event => {clearTimeout(timer); channel.port1.close(); resolve(event.data?.version ?? null);};
    self.registration.active.postMessage({type: 'FOLIO_STATUS'}, [channel.port2]);
  });
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      const previous = await activeVersion();
      if (previous) await cache.put(PREVIOUS, new Response(JSON.stringify(previous)));
      await Promise.all(PRECACHE.map(async entry => {
        const response = await fetch(new Request(entry.url, {cache: 'reload', redirect: 'error'}));
        if (!response.ok || response.redirected || hex(await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer())) !== entry.revision) throw Error('Incomplete app update');
        await cache.put(entry.url, response);
      }));
    } catch (error) { await caches.delete(CACHE); throw error; }
    // Never skip waiting during installation. Existing reading sessions continue.
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const owned = (await caches.keys()).filter(name => ownedCache(name) && name !== CACHE);
    // One prior app version protects an already-open tab's late font requests.
    const metadata = await (await caches.open(CACHE)).match(PREVIOUS);
    const previousVersion = metadata ? await metadata.json() : null;
    const previous = previousVersion && ownedCache(PREFIX + previousVersion) ? PREFIX + previousVersion : owned.at(-1);
    await Promise.all(owned.filter(name => name !== previous).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const navigation = request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html');
  if (!navigation && !urls.has(url.pathname) && !url.pathname.startsWith('/assets/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(navigation ? '/index.html' : url.pathname);
    if (cached) return cached;
    if (!navigation && url.pathname.startsWith('/assets/')) {
      for (const name of (await caches.keys()).filter(name => ownedCache(name) && name !== CACHE)) {
        const previous = await (await caches.open(name)).match(url.pathname);
        if (previous) return previous;
      }
    }
    try { return await fetch(request); }
    catch { return new Response(navigation ? '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Folio</title><p>앱 파일을 준비하지 못했습니다. 온라인에서 다시 열어 주세요. 저장된 책과 독서 기록은 삭제하지 않았습니다.</p></html>' : '', {status: 503, headers: {'Content-Type': navigation ? 'text/html; charset=utf-8' : 'text/plain'}}); }
  })());
});
self.addEventListener('message', event => {
  const reply = value => event.ports[0]?.postMessage(value);
  if (event.data?.type === 'FOLIO_STATUS') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      const complete = (await Promise.all(PRECACHE.map(entry => cache.match(entry.url)))).every(Boolean);
      reply({version: VERSION, complete});
    })());
  } else if (event.data?.type === 'FOLIO_ACTIVATE') {
    event.waitUntil((async () => {
      const windows = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
      if (windows.some(client => client.id !== event.source?.id)) { reply({blocked: true}); return; }
      reply({accepted: true}); await self.skipWaiting();
    })());
  }
});
