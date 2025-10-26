// Trifling Service Worker - Enables offline functionality
const CACHE_VERSION = 'v60';
const CACHE_NAME = `trifling-${CACHE_VERSION}`;

// Resources to cache on install
const STATIC_CACHE = [
    '/',
    '/index.html',
    '/editor.html',
    '/profile.html',
    '/data.html',
    '/about.html',
    '/css/app.css',
    '/js/app.js',
    '/js/editor.js',
    '/js/profile.js',
    '/js/avatar.js',
    '/js/avatar-editor.js',
    '/js/data.js',
    '/js/db.js',
    '/js/namegen.js',
    '/js/notifications.js',
    '/js/worker.js',
    '/js/terminal.js',
    '/js/sync-kv.js'
];

// CDN resources to cache (Ace Editor and Pyodide)
const CDN_CACHE = [
    'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.2/ace.js',
    'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.2/mode-python.js',
    'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.2/theme-monokai.js',
    'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/pyodide.js',
    'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/pyodide.asm.js',
    'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/pyodide.asm.wasm',
    'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/python_stdlib.zip',
    'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/pyodide-lock.json'
];

// Install event - cache all resources
self.addEventListener('install', (event) => {
    console.log('[Service Worker] Installing...');

    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[Service Worker] Caching static assets and CDN resources');

            // Cache static assets
            const staticPromise = cache.addAll(STATIC_CACHE);

            // Cache CDN resources individually (they might fail, don't block on them)
            const cdnPromises = CDN_CACHE.map((url) =>
                cache.add(url).catch((err) => {
                    console.warn(`[Service Worker] Failed to cache ${url}:`, err);
                })
            );

            return Promise.all([staticPromise, ...cdnPromises]);
        }).then(() => {
            console.log('[Service Worker] Installation complete');
            // Skip waiting to activate immediately
            return self.skipWaiting();
        })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[Service Worker] Activating...');

    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[Service Worker] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('[Service Worker] Activation complete');
            // Claim all clients immediately
            return self.clients.claim();
        })
    );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    const url = new URL(event.request.url);

    // NEVER cache API endpoints - they need fresh data
    if (url.pathname.startsWith('/api/')) {
        return; // Let it go to network
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                console.log('[Service Worker] Serving from cache:', event.request.url);
                return cachedResponse;
            }

            // If not found and URL has query params, try without them
            if (url.search) {
                const urlWithoutQuery = new URL(url.pathname, url.origin);
                return caches.match(urlWithoutQuery).then((cachedResponseNoQuery) => {
                    if (cachedResponseNoQuery) {
                        console.log('[Service Worker] Serving from cache (no query):', url.pathname);
                        return cachedResponseNoQuery;
                    }

                    // Not in cache, fetch from network
                    return fetchFromNetwork();
                });
            }

            // Not in cache, fetch from network
            return fetchFromNetwork();
        })
    );

    function fetchFromNetwork() {
        console.log('[Service Worker] Fetching from network:', event.request.url);
        return fetch(event.request).then((response) => {
                // Don't cache if not a valid response
                if (!response || response.status !== 200 || response.type === 'error') {
                    return response;
                }

                // Clone the response (can only be consumed once)
                const responseToCache = response.clone();

                // Cache the response for future use (but not API endpoints)
                if (!url.pathname.startsWith('/api/')) {
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }

                return response;
            }).catch((err) => {
                console.error('[Service Worker] Fetch failed:', event.request.url, err);

                // If it's a navigation request and we're offline, show a friendly message
                if (event.request.mode === 'navigate') {
                    return new Response(
                        '<html><body><h1>Offline</h1><p>You are offline and this page is not cached.</p></body></html>',
                        { headers: { 'Content-Type': 'text/html' } }
                    );
                }

                throw err;
            });
    }
});

// Message event - handle commands from the page
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
