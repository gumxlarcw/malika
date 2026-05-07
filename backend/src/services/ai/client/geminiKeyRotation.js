'use strict';

/**
 * Gemini API Key Rotation
 *
 * Rotates through multiple Google API keys to avoid per-key rate limits.
 * Keys are loaded from GOOGLE_API_KEYS env var (comma-separated) or
 * fall back to a single GOOGLE_API_KEY.
 *
 * Strategy: round-robin with temporary cooldown on 429 errors.
 */

const logger = require('../../../utils/logger').child({ service: 'GeminiKeyRotation' });

// ── Key pool ──────────────────────────────────────────────────────────────
// Keys are loaded from env vars only — no hardcoded values in source.
// Configure via GOOGLE_API_KEYS=key1,key2,key3 (comma-separated) in .env,
// or GOOGLE_API_KEY for a single-key setup.

function loadKeys() {
  const envKeys = process.env.GOOGLE_API_KEYS;
  if (envKeys) {
    const parsed = envKeys.split(',').map((k) => k.trim()).filter(Boolean);
    if (parsed.length > 0) return parsed;
  }
  const single = process.env.GOOGLE_API_KEY;
  if (single && single.trim()) return [single.trim()];
  // No keys configured — return empty so callers can detect and surface
  // a meaningful error (better than throwing during module load).
  return [];
}

const keys = loadKeys();

// ── Rotation state ────────────────────────────────────────────────────────

let currentIndex = 0;
const cooldowns = new Map(); // key → cooldownUntil timestamp
const COOLDOWN_MS = 60_000; // 1 minute cooldown on 429

/**
 * Get the next available API key (round-robin, skipping cooled-down keys).
 * @returns {string} API key
 */
function getNextKey() {
  const now = Date.now();
  const total = keys.length;

  for (let i = 0; i < total; i++) {
    const idx = (currentIndex + i) % total;
    const key = keys[idx];
    const cooldownUntil = cooldowns.get(key);

    if (!cooldownUntil || now >= cooldownUntil) {
      currentIndex = (idx + 1) % total;
      return key;
    }
  }

  // All keys on cooldown — use the one with the earliest cooldown expiry
  let earliest = Infinity;
  let bestKey = keys[0];
  for (const [key, until] of cooldowns.entries()) {
    if (until < earliest) {
      earliest = until;
      bestKey = key;
    }
  }
  logger.warn({ keysTotal: total, cooldownsActive: cooldowns.size }, 'All keys on cooldown, using earliest-expiring');
  return bestKey;
}

/**
 * Mark a key as rate-limited (puts it on cooldown).
 * @param {string} key - The API key that got rate-limited
 */
function markRateLimited(key) {
  cooldowns.set(key, Date.now() + COOLDOWN_MS);
  const suffix = key.slice(-6);
  logger.warn({ keySuffix: suffix, cooldownMs: COOLDOWN_MS }, 'Key rate-limited, cooling down');
}

/**
 * Get current rotation stats.
 */
function getStats() {
  const now = Date.now();
  const activeCooldowns = [...cooldowns.entries()].filter(([, until]) => until > now).length;
  return {
    totalKeys: keys.length,
    currentIndex,
    activeCooldowns,
    availableKeys: keys.length - activeCooldowns,
  };
}

module.exports = {
  getNextKey,
  markRateLimited,
  getStats,
};
