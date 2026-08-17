'use strict';

/**
 * Watermark-keyed cache shared by the dashboard and peta-tematik.
 *
 * Entries are never invalidated explicitly. The indicator's data watermark is
 * part of the key, so a refresh produces a different key and the previous entry
 * ages out on its own. The long TTL is a memory bound, not a freshness
 * mechanism — freshness comes entirely from the key.
 *
 * Kept behind a four-method interface (get/set/clear/getOrCompute) so this can
 * become Redis in one file. That matters the day PM2 runs more than
 * `instances: 1`: with an in-process cache, two workers hold different values
 * and users see different numbers depending on which one answers.
 */

const { LRUCache } = require('lru-cache');

const MAX_ENTRIES = 2000;
const TTL_MS = 24 * 60 * 60 * 1000;

const lru = new LRUCache({ max: MAX_ENTRIES, ttl: TTL_MS });

/** `undefined` marks a miss, so cached nulls need a sentinel. */
const NULL_SENTINEL = Symbol.for('malika.indicator.cache.null');

function buildKey(namespace, indicatorId, watermarkMs, ...parts) {
  return [namespace, indicatorId, watermarkMs, ...parts.map((p) => (p == null ? '*' : String(p)))].join(':');
}

function get(key) {
  const v = lru.get(key);
  if (v === NULL_SENTINEL) return null;
  return v;
}

function set(key, value) {
  lru.set(key, value === null ? NULL_SENTINEL : value);
}

function clear() {
  lru.clear();
}

function size() {
  return lru.size;
}

async function getOrCompute(namespace, indicatorId, watermarkMs, parts, computeFn) {
  const key = buildKey(namespace, indicatorId, watermarkMs, ...(parts || []));
  const cached = lru.get(key);
  if (cached !== undefined) return cached === NULL_SENTINEL ? null : cached;

  // A rejection is deliberately not cached: a transient DB error must not be
  // pinned for the life of the watermark.
  const fresh = await computeFn();
  set(key, fresh);
  return fresh;
}

module.exports = { buildKey, get, set, clear, size, getOrCompute, MAX_ENTRIES, TTL_MS };
