const CACHE_VERSION = "pl-predictions-v5";
const APP_SHELL = [
  "/",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];
const STATIC_EXT_RE = /\.(?:png|jpg|jpeg|svg|webp|gif|ico|json|txt)$/i;

function isBypassRequest(request, url) {
  if (request.method !== "GET") return true;
  if (url.origin !== self.location.origin) return true;

  // Never cache Next.js runtime/build assets or API responses.
  if (url.pathname.startsWith("/_next/")) return true;
  if (url.pathname.startsWith("/api/")) return true;

  // Never cache RSC/data transport requests.
  if (url.searchParams.has("_rsc")) return true;
  if (url.searchParams.has("__nextDataReq")) return true;
  const accept = request.headers.get("accept") || "";
  if (accept.includes("text/x-component")) return true;

  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener("message", (event) => {
  if (event?.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (isBypassRequest(event.request, url)) return;

  // Navigation/doc requests should be network-first to avoid stale UI.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/") || Response.error()),
    );
    return;
  }

  // Cache only safe static files; everything else uses network-first.
  const isStatic = APP_SHELL.includes(url.pathname) || STATIC_EXT_RE.test(url.pathname);
  if (!isStatic) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request) || Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type !== "basic") {
            return response;
          }
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match("/"));
    }),
  );
});
