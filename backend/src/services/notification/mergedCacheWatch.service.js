const { Op } = require('sequelize');
const DataSource = require('../../models/DataSource.model');
const MergedCache = require('../../models/MergedCache.model');
const { getCache, saveCache } = require('../cache/cache.service');

const SYSTEM_MERGEDCACHE_API_URL = 'system:mergedcache-watch';

async function ensureMergedCacheSystemDatasource() {
  const existing = await DataSource.findOne({
    where: { api_url: SYSTEM_MERGEDCACHE_API_URL },
    order: [['id', 'ASC']],
  });
  if (existing) return existing;

  const now = new Date();
  return DataSource.create({
    name: 'System: MergedCache Watcher',
    description: 'Internal datasource for merged cache update notification checkpoint storage',
    type: 'static',
    api_url: SYSTEM_MERGEDCACHE_API_URL,
    period_key: null,
    auto_period: false,
    status: true,
    visible: false,
    display_order: 0,
    created_at: now,
    updated_at: now,
  });
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function safeDate(value) {
  const d = value ? new Date(value) : null;
  if (d && !Number.isNaN(d.getTime())) return d;
  return null;
}

async function loadCheckpoint(dsId, key) {
  const cache = await getCache(dsId, key);
  if (!cache?.processed_json) return null;
  const parsed = safeParseJson(cache.processed_json);
  const lastCheckedAt = safeDate(parsed?.lastCheckedAt);
  return lastCheckedAt;
}

async function saveCheckpoint(dsId, key, date) {
  const now = date instanceof Date ? date : new Date();
  await saveCache(dsId, key, { lastCheckedAt: now.toISOString() });
}

async function checkMergedCacheUpdates({
  max = 50,
  signature = null,
  log,
} = {}) {
  const emit = typeof log === 'function' ? log : null;
  const info = (m) => emit && emit(String(m));

  const sysDs = await ensureMergedCacheSystemDatasource();
  const checkpointKey = 'merged_cache:last_checked_at';

  const lastCheckedAt = await loadCheckpoint(sysDs.id, checkpointKey);
  const now = new Date();

  // Warm start: set checkpoint and do not notify historical rows.
  if (!lastCheckedAt) {
    await saveCheckpoint(sysDs.id, checkpointKey, now);
    info('[mergedcache] checkpoint initialized (warm start)');
    return { ok: true, initialized: true, notified: 0, lastCheckedAt: now.toISOString() };
  }

  // IMPORTANT: only use last_update to detect real upstream data changes.
  // updated_at is touched on every save (e.g., automation runs), and would cause false positives.
  const baseWhere = { last_update: { [Op.gt]: lastCheckedAt } };
  if (signature) baseWhere.signature = String(signature);

  const batchSize = Math.max(1, Math.min(500, Number(max) || 50));

  let cursor = lastCheckedAt;
  let totalRows = 0;
  let notified = 0;
  const sourceById = new Map();

  let loops = 0;
  const maxLoops = 50; // safety guard

  while (loops < maxLoops) {
    loops += 1;

    const where = { ...baseWhere, last_update: { [Op.gt]: cursor } };
    const rows = await MergedCache.findAll({
      where,
      attributes: ['source_id', 'signature', 'last_update'],
      order: [['last_update', 'ASC']],
      limit: batchSize,
    });

    if (!rows || rows.length === 0) {
      // No more updates beyond cursor.
      break;
    }

    // If we hit the batch limit, we must fully drain the boundary timestamp to avoid missing
    // other rows with the same last_update when we advance the checkpoint.
    const maxTs = rows
      .map((r) => safeDate(r.last_update))
      .filter(Boolean)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    let expandedRows = rows;
    if (maxTs) {
      const boundaryWhere = {
        ...(signature ? { signature: String(signature) } : {}),
        last_update: maxTs,
      };

      const boundary = await MergedCache.findAll({
        where: boundaryWhere,
        attributes: ['source_id', 'signature', 'last_update'],
        order: [['last_update', 'ASC']],
      });

      if (boundary && boundary.length > 0) {
        const seen = new Set();
        const merged = [];
        for (const r of rows.concat(boundary)) {
          const sid = Number(r.source_id);
          const sig = String(r.signature || 'all');
          const lu = safeDate(r.last_update);
          if (!Number.isFinite(sid) || !lu) continue;
          const key = `${sid}:${sig}:${lu.toISOString()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(r);
        }
        // Keep ordering by last_update asc for nicer notification ordering.
        merged.sort((a, b) => {
          const da = safeDate(a.last_update)?.getTime() || 0;
          const db = safeDate(b.last_update)?.getTime() || 0;
          return da - db;
        });
        expandedRows = merged;
      }
    }

    totalRows += expandedRows.length;

    // Enrich datasource names (cached across loops).
    const sourceIds = Array.from(
      new Set(expandedRows.map((r) => Number(r.source_id)).filter((n) => Number.isFinite(n)))
    ).filter((sid) => !sourceById.has(sid));

    if (sourceIds.length > 0) {
      const sources = await DataSource.findAll({
        where: { id: { [Op.in]: sourceIds } },
        attributes: ['id', 'name', 'type', 'category'],
        limit: Math.max(1, sourceIds.length),
      });
      for (const s of sources) sourceById.set(Number(s.id), s);
    }

    try {
      const { createNotification } = require('./notification.service');

      for (const r of expandedRows) {
        const sid = Number(r.source_id);
        const sig = String(r.signature || 'all');
        const lastUpdate = safeDate(r.last_update);
        if (!lastUpdate) continue;

        const ds = sourceById.get(sid);
        const indicatorName = ds?.name ? String(ds.name).trim() : null;

        const uniqueKey = `mergedcache:${sid}:${sig}:${lastUpdate.toISOString()}`;

        const result = await createNotification({
          uniqueKey,
          type: 'data',
          title: 'Data Statistik',
          message: indicatorName ? `${indicatorName} diperbarui` : 'Data Statistik diperbarui',
          link: '/',
          metadata: {
            source_id: sid,
            signature: sig,
            last_update: lastUpdate.toISOString(),
            source: indicatorName,
            kind: 'merged_cache',
          },
          createdAt: lastUpdate,
        });

        if (result?.created) notified += 1;
      }
    } catch {
      // best-effort
    }

    // Move cursor forward to the boundary timestamp we fully drained.
    if (maxTs) cursor = maxTs;
    else break;
  }

  // Advance checkpoint to the newest last_update we fully processed (or now).
  await saveCheckpoint(sysDs.id, checkpointKey, cursor || now);

  info(`[mergedcache] notified=${notified} rows=${totalRows}`);
  return { ok: true, initialized: false, notified, rows: totalRows };
}

module.exports = {
  checkMergedCacheUpdates,
};
