/**
 * Shared mathematical utilities
 * 
 * Canonical location for vector math operations used across services.
 * DO NOT duplicate — import from here.
 */

'use strict';

/**
 * Calculate cosine similarity between two vectors.
 * 
 * Handles:
 * - Both Array and TypedArray (Float32Array) inputs
 * - Dimension mismatch during embedding migration (Matryoshka truncation safe:
 *   text-embedding-3-large first N dims are the most important)
 * - Zero-vector edge cases
 * 
 * @param {number[]|Float32Array} a - First vector
 * @param {number[]|Float32Array} b - Second vector
 * @returns {number} Similarity score (0 to 1), or 0 for invalid inputs
 */
function cosineSimilarity(a, b) {
  const isVec = v => Array.isArray(v) || ArrayBuffer.isView(v);
  if (!isVec(a) || !isVec(b)) return 0;

  // During migration: if dimensions differ, use the shorter length
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < len; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

module.exports = {
  cosineSimilarity,
};
