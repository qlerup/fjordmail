// Private messages and authenticated API responses are never cached on disk.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{let data={};try{data=event.data?.json()||{};}catch{}event.waitUntil(self.registration.showNotification('FjordMail',{body:typeof data.body==='string'?data.body:'Der er kommet ny post.',icon:'/logos/icon-192.png',badge:'/logos/icon-64.png',tag:data.tag||'fjordmail',data:{url:'/'}}));});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{const own=windows.find(w=>new URL(w.url).origin===self.location.origin);if(own)return own.focus();return self.clients.openWindow('/');}));});
