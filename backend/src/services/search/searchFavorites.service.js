const { Op } = require('sequelize');
const sequelize = require('../../config/db');
const DataSource = require('../../models/DataSource.model');

// Ensure this model is loaded in server.js before sync.
const SearchStat = require('../../models/SearchStat.model');

const IGNORED_SOURCE_IDS = new Set([166, 167, 168, 169]);

function asInt(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

async function trackDatasourceClick({ sourceId }) {
  const sid = asInt(sourceId);
  if (!sid || sid <= 0) return { ok: false, reason: 'INVALID_SOURCE_ID' };
  if (IGNORED_SOURCE_IDS.has(sid)) return { ok: true, ignored: true };

  // Use an atomic upsert to avoid lost updates under concurrency.
  await sequelize.query(
    `INSERT INTO data_search_stats (source_id, search_count, last_searched_at, created_at, updated_at)
     VALUES (:sid, 1, NOW(), NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       search_count = search_count + 1,
       last_searched_at = NOW(),
       updated_at = NOW()`,
    { replacements: { sid } }
  );

  return { ok: true };
}

async function getFavoriteDatasources({ limit = 5 }) {
  const max = Math.min(20, Math.max(1, Number.parseInt(String(limit || 5), 10) || 5));

  // First try stats-based favorites.
  const rows = await sequelize.query(
    `SELECT ds.id, ds.name, ds.type, ds.category, ss.search_count
     FROM data_search_stats ss
     JOIN data_sources ds ON ds.id = ss.source_id
     WHERE ds.visible = 1 AND ds.status = 1
       AND ds.id NOT IN (166,167,168,169)
     ORDER BY ss.search_count DESC, ss.last_searched_at DESC, ds.display_order ASC, ds.id ASC
     LIMIT :lim`,
    { replacements: { lim: max }, type: sequelize.QueryTypes.SELECT }
  );

  const picked = Array.isArray(rows) ? rows : [];
  const pickedIds = new Set(picked.map((r) => r && r.id).filter((id) => Number.isInteger(id)));
  if (picked.length >= max) return picked.slice(0, max);

  // Fallback: deterministic list when stats are empty.
  const fallback = await DataSource.findAll({
    where: {
      visible: true,
      status: true,
      id: { [Op.notIn]: Array.from(new Set([...IGNORED_SOURCE_IDS, ...Array.from(pickedIds)])) },
    },
    attributes: ['id', 'name', 'type', 'category', 'display_order'],
    order: [['display_order', 'ASC'], ['id', 'ASC']],
    limit: Math.max(0, max - picked.length),
  });

  const toppedUp = fallback.map((ds) => ({
    id: ds.id,
    name: ds.name,
    type: ds.type,
    category: ds.category || null,
    search_count: 0,
  }));

  return [...picked, ...toppedUp].slice(0, max);
}

module.exports = {
  trackDatasourceClick,
  getFavoriteDatasources,
};
