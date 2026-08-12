// App-shell service worker. Caches the shell only — the HTML document,
// built JS/CSS, icons, and the manifest — never anything under /api/.
// Venue freshness is computed at request time (CLAUDE.md invariant #2) and
// must never be served from a cache, so /api/ is a hard exclusion here,
// not just an omission: every fetch handler checks for it before touching
// caches.storage at all.
const SHELL_CACHE = "pulse-shell-v1";
const SHELL_URLS = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept, never cache: API responses carry live venue data.
  if (event.request.method !== "GET" || isApiRequest(url) || url.origin !== self.location.origin) {
    return;
  }

  // Network-first, cache as offline fallback only — not cache-first. "/"
  // is dynamic (feed content, freshness badges, whatever query params the
  // visitor landed with) and SHELL_CACHE's name never changes across
  // deploys, so a cache-first "/" would serve whatever HTML happened to be
  // cached the first time this service worker installed, forever, on every
  // subsequent visit regardless of how many times the app is redeployed.
  // Falling back to cache only once the network fetch actually fails keeps
  // the PWA's offline affordance without that staleness trap.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, responseClone));
        }
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
