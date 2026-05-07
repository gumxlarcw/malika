let startedAt = Date.now();
let resolvedCount = 0;

const reasonCounts = new Map();
const actionCounts = new Map();

function bumpCount(map, key) {
  const k = String(key || 'unknown');
  map.set(k, (map.get(k) || 0) + 1);
}

function record({ action, reason }) {
  resolvedCount += 1;
  bumpCount(actionCounts, action);
  bumpCount(reasonCounts, reason);
}

function snapshot() {
  return {
    started_at: new Date(startedAt).toISOString(),
    resolved: resolvedCount,
    actions: Object.fromEntries(actionCounts.entries()),
    reasons: Object.fromEntries(reasonCounts.entries()),
    pid: process.pid,
    uptime_s: Math.floor(process.uptime()),
  };
}

function reset() {
  startedAt = Date.now();
  resolvedCount = 0;
  actionCounts.clear();
  reasonCounts.clear();
}

function getResolvedCount() {
  return resolvedCount;
}

module.exports = {
  intentStats: {
    record,
    snapshot,
    reset,
    getResolvedCount,
  },
};
