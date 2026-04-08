const CACHE_NAME = "finance-tracker-v6";
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./dashboard.html",
  "./accounts.html",
  "./transactions.html",
  "./categories.html",
  "./manifest.json",
  "./css/style.css",
  "./js/firebase.js",
  "./js/auth.js",
  "./js/db.js",
  "./js/dashboard.js",
  "./js/accounts.js",
  "./js/categories.js",
  "./js/transactions.js",
  "./assets/icon.svg",
  "./assets/icon-maskable.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );

  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((oldKey) => {
            return caches.delete(oldKey);
          })
      );
    })
  );

  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  const requestPath = url.pathname;
  const shouldPreferNetwork =
    requestPath.endsWith(".html") ||
    requestPath.endsWith(".js") ||
    requestPath.endsWith(".css") ||
    requestPath === "/" ||
    requestPath.endsWith("/finance-tracker/");

  if (shouldPreferNetwork) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }

          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });

          return networkResponse;
        })
        .catch(() => {
          return caches.match("./index.html");
        });
    })
  );
});
