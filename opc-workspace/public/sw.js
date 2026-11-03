
'use strict';
// Network only: private pages, sessions and business data are never saved in Cache Storage.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.mode!=='navigate'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
 event.respondWith(fetch(event.request).catch(()=>new Response(
  '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OPC工作台 · 当前离线</title><style>body{margin:0;padding:48px 24px;background:#f5f7f9;color:#173436;font:16px/1.7 system-ui}main{max-width:420px;margin:auto}a{display:inline-block;padding:12px 20px;background:#173436;color:white;border-radius:10px;text-decoration:none}</style><main><h1>当前离线</h1><p>请连接网络后重新打开工作台。云端资料需要联网读取，离线时无法查看或保存业务记录。</p><a href="/">重新连接</a></main></html>',
  {status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}}
 )));
});
