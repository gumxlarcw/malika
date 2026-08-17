'use strict';

/**
 * Data-freshness watermark for one indicator.
 *
 * Every `indikator_NNN` table carries its own `last_update`. Reading MAX() of it
 * costs ~6ms and tells us exactly when the automation runner last wrote to that
 * indicator. Cache keys built on this number invalidate themselves: new data
 * produces a new watermark, hence a new key, and the stale entry is simply never
 * read again. See docs/superpowers/specs/2026-08-17-dashboard-mandiri-design.md.
 */

const getSequelizeBps = require('../../config/db_bps');
const { QueryTypes } = require('sequelize');

/** A 40-card page would otherwise issue 40 watermark queries per render. */
const MEMO_TTL_MS = 30000;

const memo = new Map(); // indicatorId -> { value, expiresAt }

function validateIndicatorId(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0 || n > 99999) {
    throw new Error('Invalid indikator');
  }
  return n;
}

/** Table names cannot be parameterised, so the id is validated first. */
function tableName(id) {
  return `indikator_${validateIndicatorId(id)}`;
}

function clearWatermarkMemo() {
  memo.clear();
}

async function getWatermark(indicatorId) {
  const id = validateIndicatorId(indicatorId);
  const hit = memo.get(id);
  const now = Date.now();
  if (hit && hit.expiresAt > now) return hit.value;

  let value = 0;
  try {
    const seq = getSequelizeBps();
    if (seq) {
      const rows = await seq.query(
        `SELECT MAX(last_update) AS lu FROM \`${tableName(id)}\``,
        { type: QueryTypes.SELECT }
      );
      const lu = rows && rows[0] ? rows[0].lu : null;
      value = lu ? new Date(lu).getTime() : 0;
    }
  } catch {
    // An unreadable indicator must not take the dashboard down. 0 is a valid
    // watermark: it simply means "nothing known", and the caller still caches.
    value = 0;
  }

  memo.set(id, { value, expiresAt: now + MEMO_TTL_MS });
  return value;
}

module.exports = {
  validateIndicatorId,
  tableName,
  getWatermark,
  clearWatermarkMemo,
  MEMO_TTL_MS,
};
