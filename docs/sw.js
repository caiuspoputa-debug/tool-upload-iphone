'use strict';

// Change VERSION for every release. An installed shell is immutable until the
// user accepts its replacement; no booking, token, API or backup is cached here.
const VERSION='5.0.15';
const BASE=new URL(self.registration.scope);
const PREFIX='agenda-frizerie-shell-'+encodeURIComponent(BASE.pathname)+'-';
const CACHE_NAME=PREFIX+VERSION;
const FILES=[
 'index.html','styles.css','app.js','finance.js','gestures.js','legacy-logo.js','logo.js',
 'sync.js','drive-journal.js','drive-sync-ui.js','timeline.js','holidays.js','catalog.js',
 'pwa-storage.js','activation-client.js','boot.js','google-config.js','direct-drive.js','cloud-backup.js',
 'vendor/firebase-app-compat.js','vendor/firebase-auth-compat.js','vendor/firebase-firestore-compat.js',
 'firebase-config.js','firebase-account.js','firebase-transport.js','firebase-sync-ui.js',
 'pwa-shell.js','pwa.css','manifest.webmanifest','icons/icon-192.png',
 'icons/icon-512.png','icons/icon-512-maskable.png','icons/apple-touch-icon.png'
];
const URLS=FILES.map(file=>new URL(file,BASE).href);
const ALLOWED=new Set(URLS);
const INDEX=new URL('index.html',BASE).href;
const APP_MARKER=/<meta\b(?=[^>]*\bname\s*=\s*["']app-id["'])(?=[^>]*\bcontent\s*=\s*["']AgendaFrizerieApp["'])[^>]*>/i;
const requestFor=url=>new Request(url,{method:'GET',credentials:'same-origin',redirect:'error',cache:'reload'});

async function validate(url,response){
 if(!response||!response.ok||response.redirected||response.type==='opaque'||response.url!==url)throw Error('Resursă statică nevalidă.');
 const type=(response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
 if(url.endsWith('.html')){
  if(type!=='text/html'||!APP_MARKER.test(await response.clone().text()))throw Error('Pagina primită nu este aplicația.');
 }else if(url.endsWith('.js')){
  if(!['text/javascript','application/javascript','application/x-javascript'].includes(type))throw Error('Script nevalid.');
 }else if(url.endsWith('.css')){
  if(type!=='text/css')throw Error('Stil nevalid.');
 }else if(url.endsWith('.webmanifest')){
  if(!['application/manifest+json','application/json'].includes(type))throw Error('Manifest nevalid.');
  const manifest=await response.clone().json();if(manifest.name!=='Agenda Frizerie'||manifest.display!=='standalone')throw Error('Alt manifest.');
 }else if(url.endsWith('.png')&&type!=='image/png')throw Error('Iconiță nevalidă.');
 return response;
}

async function validCache(cache){
 for(const url of URLS)await validate(url,await cache.match(url));
 return true;
}

self.addEventListener('install',event=>event.waitUntil((async()=>{
 // Reuse only a complete cache with the same immutable release identifier.
 // A failed new release never touches a previous release's cache.
 const existed=(await caches.keys()).includes(CACHE_NAME),cache=await caches.open(CACHE_NAME);
 if(existed){await validCache(cache);return;}
 try{await cache.addAll(URLS.map(requestFor));await validCache(cache);}
 catch(error){await caches.delete(CACHE_NAME);throw error;}
 // No skipWaiting here: an update waits for explicit approval in the UI.
})()));

self.addEventListener('activate',event=>event.waitUntil((async()=>{
 await Promise.all((await caches.keys()).filter(name=>name.startsWith(PREFIX)&&name!==CACHE_NAME).map(name=>caches.delete(name)));
 await self.clients.claim();
})()));

self.addEventListener('message',event=>{
 const data=event.data||{};
 if(data.type==='SKIP_WAITING'&&data.userApproved===true&&event.source){
  try{if(new URL(event.source.url).origin===BASE.origin)event.waitUntil(self.skipWaiting());}catch(_){}
 }
 if(data.type==='GET_PWA_STATUS'&&event.ports?.[0])event.waitUntil((async()=>{
  let offlineReady=false;try{offlineReady=await validCache(await caches.open(CACHE_NAME));}catch(_){}
  event.ports[0].postMessage({type:'PWA_STATUS',version:VERSION,cacheName:CACHE_NAME,offlineReady});
 })());
});

async function shellAsset(url){
 const cache=await caches.open(CACHE_NAME),cached=await cache.match(url);
 if(cached)return cached;
 const response=await validate(url,await fetch(requestFor(url)));
 await cache.put(url,response.clone());return response;
}

self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==BASE.origin||request.headers.has('Authorization'))return;
 const entry=url.pathname===BASE.pathname||url.href===INDEX;
 if(request.mode==='navigate'&&entry){
  event.respondWith(shellAsset(INDEX).catch(()=>new Response('<!doctype html><html lang="ro"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agenda Frizerie</title><body style="font:16px system-ui;padding:24px;line-height:1.5"><h1>Conexiune necesară</h1><p>Deschide aplicația o dată cu internet pentru a pregăti utilizarea fără internet.</p><p>Datele locale nu au fost șterse.</p></body></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
  return;
 }
 if(!url.search&&ALLOWED.has(url.href))event.respondWith(shellAsset(url.href));
});
