// web/public/sw.js: minimal service worker so the soundbox is installable and its shell opens offline.
// Caches only the app shell (navigations, /assets/* and the voice clips in /voice/*); never touches /api,
// SSE, /t, /pay data or webhooks.
const CACHE = "paygent-shell-v2";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (/^\/(api|t|webhooks)\//.test(url.pathname)) return;
  if (req.headers.get("accept")?.includes("text/event-stream")) return;
  if (req.mode === "navigate") {
    // Network first so a deploy is picked up; the cached shell only answers when offline.
    event.respondWith(fetch(req).catch(() => caches.match("/").then((r) => r || Response.error())));
    return;
  }
  if (/^\/(assets|voice)\//.test(url.pathname) || SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              void caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
