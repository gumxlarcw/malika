const { nowUnix } = require('./dateHelper');

/**
 * Simple in-memory cache with TTL
 * For caching expensive operations like datasource lookups, embeddings
 */

class SimpleCache {
  constructor(ttlMs = 5 * 60 * 1000, maxSize = 1000) {
    this.cache = new Map();
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
    this.stats = { hits: 0, misses: 0 };
  }

  /**
   * Get value from cache
   * @param {string} key - Cache key
   * @returns {*} Cached value or null
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (nowUnix() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return entry.value;
  }

  /**
   * Set value in cache
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   */
  set(key, value) {
    // Enforce max size (LRU-style: delete oldest entries)
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      value,
      timestamp: nowUnix(),
    });
  }

  /**
   * Check if key exists and is not expired
   * @param {string} key - Cache key
   * @returns {boolean}
   */
  has(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (nowUnix() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Delete key from cache
   * @param {string} key - Cache key
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * Clear all entries
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Cleanup expired entries
   */
  cleanup() {
    const now = nowUnix();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics
   * @returns {object} Stats object
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) + '%' : '0%',
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = { hits: 0, misses: 0 };
  }
}

// Create singleton caches for different use cases
const datasourceCache = new SimpleCache(5 * 60 * 1000, 500);  // 5 min, 500 entries
const vectorSearchCache = new SimpleCache(10 * 60 * 1000, 200); // 10 min, 200 entries
const periodCache = new SimpleCache(30 * 60 * 1000, 1000);     // 30 min, 1000 entries

// Cleanup job every 2 minutes
setInterval(() => {
  datasourceCache.cleanup();
  vectorSearchCache.cleanup();
  periodCache.cleanup();
}, 2 * 60 * 1000).unref(); // unref() allows process to exit if this is only timer

module.exports = {
  SimpleCache,
  datasourceCache,
  vectorSearchCache,
  periodCache,
};
