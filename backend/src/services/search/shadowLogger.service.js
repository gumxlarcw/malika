'use strict';

const crypto = require('crypto');

let recorded = [];
const pairCounts = new Map();

function hashQuery(q) {
  const s = String(q || '');
  if (!s) return '';
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
}

function recordDivergence({ q, oldSourceId, newSourceId, oldType, newType, newTop1Score, newConfidence }) {
  const entry = {
    q_hash: hashQuery(q),
    old_source_id: oldSourceId == null ? null : Number(oldSourceId),
    new_source_id: newSourceId == null ? null : Number(newSourceId),
    old_type: oldType || null,
    new_type: newType || null,
    new_top1_score: newTop1Score == null ? null : Number(newTop1Score),
    new_confidence: newConfidence == null ? null : Number(newConfidence),
    ts: new Date().toISOString(),
  };
  recorded.push(entry);

  if (entry.old_source_id !== entry.new_source_id) {
    const key = `${entry.old_source_id}→${entry.new_source_id}`;
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }
}

function snapshot() {
  const divergent = recorded.filter((r) => r.old_source_id !== r.new_source_id);
  return {
    total_recorded: recorded.length,
    total_divergent: divergent.length,
    divergence_pairs: Object.fromEntries(pairCounts.entries()),
    sample: divergent.slice(-20),  // last 20 divergences for spot-inspection
  };
}

function reset() {
  recorded = [];
  pairCounts.clear();
}

module.exports = { recordDivergence, snapshot, reset, hashQuery };
