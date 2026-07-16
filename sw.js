const CACHE_NAME = 'gestionale-v16';

// Only static assets that always return 200 (no auth redirects).
const PRECACHE_URLS = [
    '/assets/js/app.js',
    '/assets/js/pagination.js',
    '/assets/js/filters.js',
    '/manifest.json',
];

async function precacheStaticAssets() {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(
        PRECACHE_URLS.map(async (url) => {
            try {
                const response = await fetch(url, { cache: 'no-cache' });
                if (response.ok) {
                    await cache.put(url, response);
                }
            } catch {
                // Non-fatal: app still works online if one asset is missing.
            }
        })
    );
}

self.addEventListener('install', (event) => {
    event.waitUntil(precacheStaticAssets().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    if (url.pathname.startsWith('/api/')) return;
    if (url.pathname.startsWith('/uploads/')) return;
    if (url.pathname.includes('view.php')) return;

    // View scripts change often — always fetch fresh.
    if (url.pathname.startsWith('/assets/js/') && !PRECACHE_URLS.includes(url.pathname)) {
        return;
    }

    // CSS changes often — always fetch fresh.
    if (url.pathname.startsWith('/assets/css/')) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() =>
                caches.match(event.request).then((cached) => cached || caches.match('/index.php'))
            )
    );
});
