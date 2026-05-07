function normalizeKey(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (Number.isFinite(n) && n > 0) return n;
  return fallback;
}

function createIntentCache() {
  // Cache is per-process (PM2 instance). That's intentional: simple, fast, low-risk.
  const store = new Map();

  function getConfig() {
    const ttlMs = parsePositiveInt(process.env.SEARCH_INTENT_CACHE_TTL_MS, 15000);
    const maxEntries = parsePositiveInt(process.env.SEARCH_INTENT_CACHE_MAX, 500);
    const enabled = ttlMs > 0 && maxEntries > 0;
    return { enabled, ttlMs, maxEntries };
  }

  function makeKey({ q, includeCandidates, limit }) {
    const qq = normalizeKey(q);
    const inc = includeCandidates ? '1' : '0';
    const lim = Number.parseInt(String(limit || 20), 10) || 20;
    return `${qq}::inc=${inc}::lim=${lim}`;
  }

  function get(params) {
    const { enabled, ttlMs } = getConfig();
    if (!enabled) return { hit: false, value: null };

    const key = makeKey(params);
    const entry = store.get(key);
    if (!entry) return { hit: false, value: null };

    if (Date.now() - entry.ts > ttlMs) {
      store.delete(key);
      return { hit: false, value: null };
    }

    // Refresh LRU order.
    store.delete(key);
    store.set(key, entry);
    return { hit: true, value: entry.value };
  }

  function set(params, value) {
    const { enabled, maxEntries } = getConfig();
    if (!enabled) return;

    const key = makeKey(params);
    store.set(key, { ts: Date.now(), value });

    while (store.size > maxEntries) {
      const firstKey = store.keys().next().value;
      if (!firstKey) break;
      store.delete(firstKey);
    }
  }

  return { get, set };
}

// Singleton cache instance
const intentCache = createIntentCache();

module.exports = {
  intentCache,
};
