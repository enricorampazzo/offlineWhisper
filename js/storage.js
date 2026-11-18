const CACHE_NAME = 'offlineWhisper';

async function exists(key) {
    const cache = await caches.open(CACHE_NAME);
    const match = await cache.match(key);
    return match !== undefined;
}

async function save(key, data) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(key, new Response(data));
}

async function load(key) {
    const cache = await caches.open(CACHE_NAME);
    const match = await cache.match(key);
    if (!match) return null;
    return match.arrayBuffer();
}

async function remove(key) {
    const cache = await caches.open(CACHE_NAME);
    await cache.delete(key);
}

export { exists, save, load, remove };
