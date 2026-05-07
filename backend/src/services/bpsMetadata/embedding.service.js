'use strict';

/**
 * Embedding service using Google Gemini `text-embedding-004` (768-dim).
 * Uses the existing key pool from /opt/openclaw/malika-llm-proxy.config.js
 * (10 Google keys with round-robin + fallback). NO OpenAI dependency.
 *
 * This module is dedicated to BPS metadata embeddings — separate from the
 * legacy `services/ai/embedding.service.js` (which uses OpenAI and may be
 * removed once chat AI also migrates to Google embeddings).
 */

const axios = require('axios');

// Google's stable production embedding model. Native dim is 3072 (Matryoshka);
// we request 768 to keep storage footprint reasonable while preserving most
// of the signal — Google's docs recommend 768/1536/3072 as truncation points.
const MODEL = 'gemini-embedding-001';
const DIMENSIONS = 768;
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

let _keys = null;

function loadKeys() {
  if (_keys) return _keys;
  // Prefer env (deployment-controlled) — fallback to the proxy config file.
  const envKeys = (process.env.GOOGLE_API_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (envKeys.length > 0) {
    _keys = envKeys;
    return _keys;
  }
  try {
    const cfg = require('/opt/openclaw/malika-llm-proxy.config.js');
    const apps = cfg?.apps || [];
    const env = apps[0]?.env || {};
    const keys = String(env.GOOGLE_API_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (keys.length === 0) {
      throw new Error('No GOOGLE_API_KEYS found in proxy config');
    }
    _keys = keys;
    return _keys;
  } catch (e) {
    throw new Error(`Cannot load Google API keys: ${e.message}`);
  }
}

let _cursor = 0;
function nextKey() {
  const keys = loadKeys();
  const k = keys[_cursor % keys.length];
  _cursor++;
  return k;
}

/**
 * Embed text into a 768-dim vector via Gemini text-embedding-004.
 *
 * Tries up to N keys (1 retry per remaining key) before giving up. Returns
 * a plain array of numbers. Caller is responsible for JSON.stringify when
 * persisting to a TEXT column.
 */
async function generateEmbedding(text) {
  const cleaned = String(text || '').trim().slice(0, 8000);
  if (!cleaned) throw new Error('Empty text for embedding');

  const keys = loadKeys();
  const maxAttempts = Math.min(keys.length, 3);
  let lastErr = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = nextKey();
    try {
      const url = `${BASE_URL}/models/${MODEL}:embedContent?key=${key}`;
      const res = await axios.post(
        url,
        {
          content: { parts: [{ text: cleaned }] },
          taskType: 'SEMANTIC_SIMILARITY',
          outputDimensionality: DIMENSIONS,
        },
        {
          timeout: 30000,
          headers: { 'Content-Type': 'application/json' },
        },
      );
      const values = res.data?.embedding?.values;
      if (!Array.isArray(values) || values.length !== DIMENSIONS) {
        throw new Error(`Invalid response shape (got len=${values?.length})`);
      }
      return values;
    } catch (e) {
      lastErr = e;
      // Rate limit / quota → try next key. Other errors → retry once with next key.
      const status = e.response?.status;
      if (status === 429 || status === 403) continue;
      if (attempt < maxAttempts - 1) continue;
    }
  }
  const errMsg = lastErr?.response?.data?.error?.message || lastErr?.message || 'unknown';
  throw new Error(`Gemini embedding failed after ${maxAttempts} attempts: ${errMsg}`);
}

/** Cosine similarity for two 768-dim vectors. */
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

module.exports = {
  generateEmbedding,
  cosineSimilarity,
  EMBEDDING_DIMENSIONS: DIMENSIONS,
  EMBEDDING_MODEL: MODEL,
};
