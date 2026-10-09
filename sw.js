// The build generates a precise shell + SAMPLE-only allowlist. Premium content,
// tokens, API responses and traveler state are never handled by this worker.
importScripts('./precache.js');
const CACHE=`mcs-shell-${self.MCS_PRECACHE_VERSION}`;
const URLS=self.MCS_PRECACHE.map(path=>new URL(path,self.registration.scope).href);
const SHELL=new URL('index.html',self.registration.scope).href;
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 try {await cache.addAll(URLS);}catch(error){await caches.delete(CACHE);throw error;}
 // No skipWaiting: do not replace a running trip session without warning.
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const key of await caches.keys())if(key.startsWith('mcs-shell-')&&key!==CACHE)await caches.delete(key);
 await self.clients.claim();
 for(const client of await self.clients.matchAll())client.postMessage({type:'OFFLINE_READY'});
})()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 if(URLS.includes(url.href)) {event.respondWith((async()=>{const cache=await caches.open(CACHE);return await cache.match(event.request)||fetch(event.request);})());return;}
 // Keep the shell and its modules in one cache generation while this worker controls the page.
 if(event.request.mode==='navigate'&&(url.href===self.registration.scope||url.href===SHELL))event.respondWith((async()=>{
  const cached=await (await caches.open(CACHE)).match(SHELL);
  return cached||fetch(event.request);
 })());
});
self.addEventListener('message',event=>{
 if(event.data?.type==='CHECK_OFFLINE')event.waitUntil((async()=>{const cache=await caches.open(CACHE);const complete=(await Promise.all(URLS.map(url=>cache.match(url)))).every(Boolean);event.source?.postMessage({type:complete?'OFFLINE_READY':'OFFLINE_INCOMPLETE'});})());
 if(event.data?.type==='ACTIVATE_UPDATE')event.waitUntil(self.skipWaiting());
});

// Release eb05eb63752a
