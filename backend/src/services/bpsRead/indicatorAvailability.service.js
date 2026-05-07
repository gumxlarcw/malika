const getSequelizeBps = require('../../config/db_bps');

function getIndicatorTableName(sourceId) {
  const idNum = Number(sourceId);
  if (!Number.isFinite(idNum) || idNum <= 0) return null;
  return `indikator_${idNum}`;
}

async function indicatorTableExistsInBps({ sourceId }) {
  const sequelizeBps = getSequelizeBps();
  if (!sequelizeBps) return { ok: true, available: false, reason: 'DB_BPS_DISABLED' };

  const tableName = getIndicatorTableName(sourceId);
  if (!tableName) return { ok: true, available: false, reason: 'INVALID_SOURCE_ID' };

  try {
    const [rows] = await sequelizeBps.query(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = ?`,
      { replacements: [tableName] }
    );

    const exists = Number(rows?.[0]?.cnt || 0) > 0;
    return { ok: true, available: exists, reason: exists ? 'OK' : 'TABLE_MISSING', table: tableName };
  } catch (e) {
    return { ok: false, available: false, reason: 'DB_ERROR', error: e?.message || String(e), table: tableName };
  }
}

module.exports = {
  indicatorTableExistsInBps,
};
