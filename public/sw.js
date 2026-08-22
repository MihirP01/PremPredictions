const CACHE_VERSION = "pl-predictions-v3.3.5";
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;
const APP_SHELL = [
  "/",
  "/offline",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];
const STATIC_EXT_RE = /\.(?:png|jpg|jpeg|svg|webp|gif|ico|json|txt)$/i;
const API_CACHEABLE_PATHS = [
  "/api/current-gameweek",
  "/api/fixtures",
  "/api/table",
];

function isBypassRequest(request, url) {
  if (request.method !== "GET") return true;
  if (url.origin !== self.location.origin) return true;

  // Never cache Next.js runtime/build assets here (handled separately below).
  if (url.pathname.startsWith("/_next/")) return true;

  // Never cache RSC/data transport requests.
  if (url.searchParams.has("_rsc")) return true;
  if (url.searchParams.has("__nextDataReq")) return true;
  const accept = request.headers.get("accept") || "";
  if (accept.includes("text/x-component")) return true;

  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)),
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
            .filter((key) => !key.startsWith(CACHE_VERSION))
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.status === 200) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);
  return cached || networkPromise || Response.error();
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cache = await caches.open(cacheName);
    return (await cache.match(request)) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Live scores / table / current GW must not be served stale.
  if (
    event.request.method === "GET" &&
    url.origin === self.location.origin &&
    API_CACHEABLE_PATHS.some((path) => url.pathname.startsWith(path))
  ) {
    event.respondWith(networkFirst(event.request, API_CACHE));
    return;
  }

  if (isBypassRequest(event.request, url)) return;

  // Navigation/doc requests should be network-first to avoid stale UI.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(
        () =>
          caches.match("/offline", { cacheName: APP_SHELL_CACHE }) ||
          caches.match("/") ||
          Response.error(),
      ),
    );
    return;
  }

  // Cache only safe static files; everything else uses network-first.
  const isStatic =
    APP_SHELL.includes(url.pathname) || STATIC_EXT_RE.test(url.pathname);
  if (!isStatic) {
    event.respondWith(fetch(event.request).catch(() => Response.error()));
    return;
  }

  event.respondWith(staleWhileRevalidate(event.request, STATIC_CACHE));
});
