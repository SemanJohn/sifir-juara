// Service worker Sifir Juara — cache untuk main offline
var CACHE = "sifir-juara-v23";
var ASSETS = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      return Promise.all(ASSETS.map(function(a){
        return c.add(a).catch(function(){});
      }));
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE; })
        .map(function(k){ return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function(e){
  if(e.request.method !== "GET") return; // biar POST (Sheets) terus ke rangkaian

  // Panggilan API (papan markah / akaun) — SENTIASA rangkaian, jangan cache
  // supaya markah sentiasa terkini (elak data lama tersimpan)
  if(e.request.url.indexOf("script.google") !== -1){
    return; // biar pelayar buat fetch rangkaian biasa
  }

  // Halaman utama: cuba rangkaian dulu supaya kemas kini cepat sampai,
  // guna cache hanya bila offline
  if(e.request.mode === "navigate"){
    e.respondWith(
      fetch(e.request).then(function(res){
        var clone = res.clone();
        caches.open(CACHE).then(function(c){ c.put(e.request, clone); });
        return res;
      }).catch(function(){ return caches.match(e.request).then(function(r){ return r || caches.match("./"); }); })
    );
    return;
  }

  // Aset lain: cache dulu, rangkaian jika tiada
  e.respondWith(
    caches.match(e.request).then(function(r){
      if(r) return r;
      return fetch(e.request).then(function(res){
        var clone = res.clone();
        caches.open(CACHE).then(function(c){ c.put(e.request, clone); });
        return res;
      }).catch(function(){ return caches.match("./"); });
    })
  );
});
