/**
 * Indicator Unit Resolver
 *
 * Answers "what unit is this number in?" for a datasource, so the model does not
 * have to guess from the value's shape.
 *
 * It guesses badly: "Jumlah Penduduk Miskin" carries 10.53 for Halmahera Barat,
 * which is 10,530 people — but a decimal that small reads as a percentage, and
 * the model reported it as "10,53%" in 5 of 6 measured runs. The value column is
 * named "Nilai" and the context carried no unit at all, so nothing contradicted
 * the wrong reading.
 *
 * Units come from indicator_meta.unit_id (BPS metadata, keyed 1:1 to
 * data_sources.id). Coverage is partial — 89 of 307 rows — so when the unit is
 * unknown this says so plainly rather than inferring one. A guessed unit is
 * worse than none: title parentheticals look promising until you read them
 * ("2022 = 100", "PDAM Malut" — base years and source names, not units).
 *
 * @module services/chat/indicatorUnit.service
 */

'use strict';

/** Metadata is static; a process-lifetime cache avoids a query per chat turn. */
const cache = new Map();

/**
 * Strip markup and tidy a raw unit label. BPS stores some units as HTML
 * ("km<sup>2</sup>"), which would reach the model verbatim.
 *
 * @param {string|null} raw
 * @returns {string|null}
 */
function cleanUnitLabel(raw) {
  if (!raw) return null;
  const text = String(raw)
    .replace(/<sup>\s*2\s*<\/sup>/gi, '\u00b2')
    .replace(/<sup>\s*3\s*<\/sup>/gi, '\u00b3')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

/**
 * Derive a table-level unit from its per-column units — but only when every
 * column carries one and they all agree.
 *
 * Anything looser is unsafe. Source 187 lists five measures and only
 * "Kepadatan Penduduk per km persegi" records a unit; adopting it would tell
 * the model that population counts are in square kilometres.
 *
 * @param {Array<{unit_id: string|null}>} rows
 * @returns {string|null}
 */
function pickStrictMetricUnit(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const units = rows.map((r) => cleanUnitLabel(r && r.unit_id));
  if (units.some((u) => !u)) return null;
  return units.every((u) => u === units[0]) ? units[0] : null;
}

/**
 * Default loader: indicator-level unit first, then the strict per-column
 * fallback.
 *
 * The fallback exists because interop sources — 149 of them, none with an
 * indicator-level unit — deliberately record units per column instead. Reading
 * them here rather than writing them into indicator_meta is not a stylistic
 * choice: persist.js upserts `unit_id = VALUES(unit_id)` and the extractor
 * hardcodes null for interop, so anything written there is erased by the next
 * daily sync.
 */
async function defaultLoader(sourceId) {
  const IndicatorMeta = require('../../models/IndicatorMeta.model');
  const row = await IndicatorMeta.findByPk(sourceId, { attributes: ['unit_id'] });
  const direct = cleanUnitLabel(row ? row.unit_id : null);
  if (direct) return direct;

  const sequelize = require('../../config/db');
  const { QueryTypes } = require('sequelize');
  const metrics = await sequelize.query(
    'SELECT unit_id FROM indicator_metric_meta WHERE source_id = :id',
    { replacements: { id: sourceId }, type: QueryTypes.SELECT },
  );
  return pickStrictMetricUnit(metrics);
}

/**
 * Resolve the unit label for a datasource.
 *
 * @param {number|string|null} sourceId
 * @param {{loader?: function, cache?: Map}} [opts] - Test seams.
 * @returns {Promise<string|null>} Unit label, or null when unknown.
 */
async function resolveIndicatorUnit(sourceId, opts = {}) {
  const id = Number(sourceId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const store = opts.cache || cache;
  if (store.has(id)) return store.get(id);

  const load = opts.loader || defaultLoader;
  let unit = null;
  try {
    const raw = await load(id);
    unit = raw && String(raw).trim() ? String(raw).trim() : null;
  } catch (e) {
    // Metadata is an enhancement, never a dependency — a lookup failure must not
    // cost the user their answer.
    console.warn('[IndicatorUnit] lookup failed for', id, '-', e.message);
    return null;
  }

  store.set(id, unit);
  return unit;
}

/**
 * Render the unit line for the data context block.
 *
 * @param {string|null} unit
 * @returns {string} Context text (empty string when there is nothing useful to say).
 */
function formatUnitContext(unit) {
  if (unit) {
    return `Satuan nilai: ${unit}\n`
      + `WAJIB sebut satuan ini saat menyebut angkanya. JANGAN mengubahnya menjadi satuan lain — `
      + `khususnya jangan menulis angka sebagai persen bila satuannya bukan persen.`;
  }
  return 'Satuan nilai tidak tercantum di metadata. JANGAN mengarang satuan. '
    + 'Sebutkan angkanya apa adanya dan, bila perlu, rujuk Judul tabel. '
    + 'Jangan menambahkan tanda persen pada angka yang tidak diketahui satuannya.';
}

/** Test seam: drop cached lookups. */
function _clearCache() {
  cache.clear();
}

module.exports = {
  resolveIndicatorUnit,
  pickStrictMetricUnit,
  cleanUnitLabel,
  formatUnitContext,
  _clearCache,
};
