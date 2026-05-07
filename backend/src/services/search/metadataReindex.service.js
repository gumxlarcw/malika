const ProcessedCache = require('../../models/ProcessedCache.model');
const MergedCache = require('../../models/MergedCache.model');

const { syncMetadataIndexForTable, syncMetadataIndexFromProcessedCacheRow } = require('./metadataIndex.service');

function safeJsonParse(text) {
  if (!text) return null;
  try {
    return JSON.parse(String(text));
  } catch {
    return null;
  }
}

async function pickLatestMergedCacheRow(sourceId) {
  const sid = Number(sourceId);
  if (!Number.isFinite(sid) || sid <= 0) return null;

  // Prefer signature=all when it exists (most common for non-EXIM).
  const preferred = await MergedCache.findOne({
    where: { source_id: sid, signature: 'all' },
    order: [['last_update', 'DESC']],
  });
  if (preferred) return preferred;

  // Fallback: any latest signature for this source.
  return MergedCache.findOne({
    where: { source_id: sid },
    order: [['last_update', 'DESC']],
  });
}

async function pickLatestProcessedCacheRow(sourceId) {
  const sid = Number(sourceId);
  if (!Number.isFinite(sid) || sid <= 0) return null;

  return ProcessedCache.findOne({
    where: { source_id: sid },
    order: [['last_update', 'DESC']],
  });
}

async function reindexSearchMetadataFromCacheForSource(sourceId, { preferMerged = true, dryRun = false } = {}) {
  const sid = Number(sourceId);
  if (!Number.isFinite(sid) || sid <= 0) {
    return { sourceId, ok: false, reason: 'invalid_source_id', inserted: 0 };
  }

  // 1) Try merged cache (covers dynamic/interop/exim and already merged across periods)
  if (preferMerged) {
    const mergedRow = await pickLatestMergedCacheRow(sid);
    const mergedObj = safeJsonParse(mergedRow?.merged_json);
    const table = mergedObj?.table;

    if (table && typeof table === 'object') {
      const r = await syncMetadataIndexForTable({ sourceId: sid, table, dryRun });
      return {
        sourceId: sid,
        ok: r.ok,
        reason: r.reason || 'merged_cache',
        inserted: r.inserted || 0,
        from: 'merged_cache',
        signature: mergedRow?.signature || null,
      };
    }
  }

  // 2) Fallback to processed cache (covers pressrelease and any cached processors)
  const processedRow = await pickLatestProcessedCacheRow(sid);
  if (processedRow?.processed_json) {
    const r = await syncMetadataIndexFromProcessedCacheRow({
      sourceId: sid,
      processedJsonText: processedRow.processed_json,
    });
    return {
      sourceId: sid,
      ok: r.ok,
      reason: r.reason || 'processed_cache',
      inserted: r.inserted || 0,
      from: 'processed_cache',
      period: processedRow?.period_value || null,
    };
  }

  return { sourceId: sid, ok: true, reason: 'no_cache_found', inserted: 0 };
}

async function reindexSearchMetadataFromCacheForAll({
  onlyVisible = true,
  limit = 200,
  offset = 0,
  preferMerged = true,
  dryRun = false,
} = {}) {
  // Lazy import to avoid circular deps in tests.
  const DataSource = require('../../models/DataSource.model');

  const where = {};
  if (onlyVisible) where.visible = true;

  const lim = Math.min(2000, Math.max(1, Number(limit) || 200));
  const off = Math.max(0, Number(offset) || 0);

  const sources = await DataSource.findAll({
    where,
    attributes: ['id', 'type', 'visible'],
    order: [['id', 'ASC']],
    limit: lim,
    offset: off,
  });

  const results = [];
  for (const s of sources) {
    try {
      const r = await reindexSearchMetadataFromCacheForSource(s.id, { preferMerged, dryRun });
      results.push(r);
    } catch (e) {
      results.push({
        sourceId: Number(s.id),
        ok: false,
        reason: 'error',
        inserted: 0,
        error: e?.message || String(e),
      });
    }
  }

  return {
    ok: true,
    onlyVisible: Boolean(onlyVisible),
    limit: lim,
    offset: off,
    count: results.length,
    results,
  };
}

module.exports = {
  reindexSearchMetadataFromCacheForSource,
  reindexSearchMetadataFromCacheForAll,
};
