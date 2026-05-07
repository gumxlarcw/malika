const { Op, QueryTypes } = require('sequelize');

const sequelize = require('../../config/db');
const getSequelizeBps = require('../../config/db_bps');
const DataSource = require('../../models/DataSource.model');
const DataSourceSearchTerm = require('../../models/DataSourceSearchTerm.model');

const {
  makeTermEntries,
  normalizeText,
} = require('./searchTermIndex.service');

async function isBpsConnected() {
  try {
    const sequelizeBps = getSequelizeBps();
    if (!sequelizeBps) return false;
    await sequelizeBps.authenticate();
    return true;
  } catch (e) {
    return false;
  }
}

async function listDistinctMetricsFromIndicatorTable(sourceId) {
  const sid = Number(sourceId);
  if (!Number.isFinite(sid) || sid <= 0) return [];

  const tableName = `indikator_${sid}`;
  // Hardening: avoid injection by validating name structure.
  if (!/^indikator_\d+$/.test(tableName)) return [];

  const sequelizeBps = getSequelizeBps();
  if (!sequelizeBps) return [];

  try {
    const rows = await sequelizeBps.query(
      `SELECT DISTINCT metric FROM ${tableName} WHERE metric IS NOT NULL AND metric <> '' LIMIT 200`,
      { type: QueryTypes.SELECT }
    );

    return rows
      .map((r) => String(r.metric || '').trim())
      .filter(Boolean)
      .filter((m) => normalizeText(m) !== 'null');
  } catch (e) {
    // Table might not exist or permission issues.
    return [];
  }
}

async function upsertTerms(entries) {
  if (!entries.length) return 0;

  // Use the local sequelize for writes to the primary DB.
  // `DataSourceSearchTerm` is bound to that sequelize via model definition.
  await DataSourceSearchTerm.bulkCreate(entries, {
    updateOnDuplicate: ['term', 'weight'],
  });

  return entries.length;
}

async function pruneOldTermsForSource(sourceId, keepTermNormSet) {
  const sid = Number(sourceId);
  if (!Number.isFinite(sid) || sid <= 0) return;

  const keep = Array.from(keepTermNormSet || []).filter(Boolean);

  // If we extracted nothing, do not wipe existing index.
  if (keep.length === 0) return;

  await DataSourceSearchTerm.destroy({
    where: {
      source_id: sid,
      term_norm: {
        [Op.notIn]: keep,
      },
    },
  });
}

async function rebuildTermsForSource(sourceId, { dryRun = false } = {}) {
  const sid = Number(sourceId);
  if (!Number.isFinite(sid) || sid <= 0) {
    return { sourceId, ok: false, reason: 'invalid_source_id', inserted: 0 };
  }

  const connected = await isBpsConnected();
  if (!connected) {
    return { sourceId: sid, ok: false, reason: 'bps_db_unavailable', inserted: 0 };
  }

  const metrics = await listDistinctMetricsFromIndicatorTable(sid);

  const entries = makeTermEntries({
    sourceId: sid,
    terms: metrics,
    kind: 'metric',
    weightPhrase: 3,
    weightToken: 1,
  });

  if (dryRun) {
    return {
      sourceId: sid,
      ok: true,
      reason: 'dry_run',
      inserted: entries.length,
      metricsCount: metrics.length,
    };
  }

  const inserted = await upsertTerms(entries);

  // Keep only norms for phrases+tokens we just built for this source & kinds.
  const keep = new Set(entries.map((e) => e.term_norm));
  // Best-effort pruning: don't throw if it fails.
  try {
    await pruneOldTermsForSource(sid, keep);
  } catch (e) {
    // ignore
  }

  return {
    sourceId: sid,
    ok: true,
    reason: 'rebuilt',
    inserted,
    metricsCount: metrics.length,
  };
}

async function rebuildTermsForAllSources({ onlyVisible = true, dryRun = false, limit = 200 } = {}) {
  const where = {};
  if (onlyVisible) where.visible = true;

  const sources = await DataSource.findAll({
    where,
    attributes: ['id', 'type'],
    order: [['id', 'ASC']],
    limit,
  });

  const results = [];
  for (const s of sources) {
    // Only meaningful for indicators replicated to data_bps
    // (non-dynamic sources like pressrelease won’t have indikator_<id> tables).
    const r = await rebuildTermsForSource(s.id, { dryRun });
    results.push(r);
  }

  return results;
}

module.exports = {
  rebuildTermsForSource,
  rebuildTermsForAllSources,
};
