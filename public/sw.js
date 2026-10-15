/*
 * Traugily service worker.
 * Strategy:
 *  - App shell + hashed assets: cache-first (immutable, content-hashed by Vite).
 *  - Navigations: network-first with cached index.html fallback (SPA shell).
 *  - API requests: NEVER cached — account/workout responses are sensitive.
 *  - Offline: the app shell loads; workout logging continues via IndexedDB.
 */

const VERSION = 'traugily-v1'
const SHELL_CACHE = `${VERSION}-shell`
const ASSET_CACHE = `${VERSION}-assets`
const PRECACHE = ['/', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Never touch API, auth, billing, or file routes.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/oauth/') ||
    event.request.method !== 'GET'
  ) {
    return
  }

  // Navigations: network-first, fall back to cached shell for offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone()
          caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy))
          return response
        })
        .catch(async () => {
          const cached = await caches.match('/')
          return cached || new Response('Offline', { status: 503, statusText: 'Offline' })
        }),
    )
    return
  }

  // Static assets: cache-first (Vite hashes filenames, so entries are immutable).
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(ASSET_CACHE).then((cache) => cache.put(event.request, copy))
            }
            return response
          }),
      ),
    )
    return
  }

  // Other same-origin GETs (manifest, sw): stale-while-revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const network = fetch(event.request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, copy))
            }
            return response
          })
          .catch(() => cached)
        return cached || network
      }),
    )
  }
})