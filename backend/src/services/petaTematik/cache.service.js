'use strict';

const { LRUCache } = require('lru-cache');

const TTL_MS = 60 * 60 * 1000;   // 1 jam
const MAX_ENTRIES = 500;

const lru = new LRUCache({
  max: MAX_ENTRIES,
  ttl: TTL_MS,
});

function get(key) {
  return lru.get(key);
}

function set(key, value) {
  lru.set(key, value);
}

function clear() {
  lru.clear();
}

async function getOrCompute(key, computeFn) {
  const cached = lru.get(key);
  if (cached !== undefined) return cached;
  const fresh = await computeFn();
  lru.set(key, fresh);
  return fresh;
}

module.exports = { get, set, clear, getOrCompute, TTL_MS, MAX_ENTRIES };
