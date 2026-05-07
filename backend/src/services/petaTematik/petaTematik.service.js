'use strict';

const getSequelizeBps = require('../../config/db_bps');
const cache = require('./cache.service');
const { dimValueToKdkab, KDKAB_TO_NAMA } = require('./regionMap.service');
const { scanEligibility, buildIndikatorList } = require('./eligibilityScanner.service');
const metaLookup = require('./metadataLookup.service');

function validateIndikatorId(id) {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new Error('Invalid indikator id');
  }
  return n;
}

function tableName(id) {
  return `indikator_${validateIndikatorId(id)}`;
}

async function getYears(indikatorId) {
  const id = validateIndikatorId(indikatorId);
  return cache.getOrCompute(`ind:${id}:years`, async () => {
    const seq = getSequelizeBps();
    const [yearRows] = await seq.query(
      `SELECT DISTINCT year FROM \`${tableName(id)}\`
        WHERE year > 0 ORDER BY year ASC`
    );
    const [hmRows] = await seq.query(
      `SELECT (SUM(CASE WHEN month_no BETWEEN 1 AND 12 THEN 1 ELSE 0 END) > 0) AS has_monthly
         FROM \`${tableName(id)}\``
    );
    return {
      years: yearRows.map(r => Number(r.year)).sort((a, b) => a - b),
      has_monthly: Number(hmRows[0]?.has_monthly || 0) === 1,
    };
  });
}

async function getMetrics(indikatorId) {
  const id = validateIndikatorId(indikatorId);
  return cache.getOrCompute(`ind:${id}:metrics`, async () => {
    const seq = getSequelizeBps();
    const [rows] = await seq.query(
      `SELECT DISTINCT COALESCE(NULLIF(metric, ''), 'value') AS metric
         FROM \`${tableName(id)}\` WHERE year > 0`
    );
    const set = new Set(rows.map(r => {
      const m = r.metric || '';
      return m === '' ? 'value' : m;
    }));
    return { metrics: [...set].sort() };
  });
}

function validateYear(y) {
  const n = Number(y);
  if (!Number.isInteger(n) || n <= 0 || n > 9999) {
    throw new Error('Invalid year');
  }
  return n;
}

const KABKOTA_NAMES_FULL = [
  'Halmahera Barat', 'Halmahera Tengah', 'Halmahera Utara', 'Halmahera Selatan',
  'Kepulauan Sula', 'Halmahera Timur', 'Pulau Morotai', 'Pulau Taliabu',
  'Ternate', 'Tidore Kepulauan',
  'Kabupaten Halmahera Barat', 'Kabupaten Halmahera Tengah',
  'Kabupaten Halmahera Utara', 'Kabupaten Halmahera Selatan',
  'Kabupaten Kepulauan Sula', 'Kabupaten Halmahera Timur',
  'Kabupaten Pulau Morotai', 'Kabupaten Pulau Taliabu',
  'Kota Ternate', 'Kota Tidore Kepulauan',
];

async function getData({ indikator, year, month = null, metric = null }) {
  const id = validateIndikatorId(indikator);
  const y = validateYear(year);
  const m = month == null ? null : validateYear(month);
  const cacheKey = `data:${id}:${y}:${m || 0}:${metric || '*'}`;

  return cache.getOrCompute(cacheKey, async () => {
    const seq = getSequelizeBps();
    const placeholders = KABKOTA_NAMES_FULL.map(() => '?').join(',');
    const monthClause = m == null ? '' : 'AND month_no = ?';
    const metricClause = metric == null ? '' : "AND metric = ?";
    // IMPORTANT: replacements MUST be in the SAME ORDER as `?` placeholders
    // in the SQL string. Sequelize substitutes positionally.
    // Order: year, [month?], [metric?], ...kabkota_names
    const replacements = [y];
    if (m != null) replacements.push(m);
    if (metric != null) replacements.push(metric);
    replacements.push(...KABKOTA_NAMES_FULL);

    const [rows] = await seq.query(
      `SELECT dim_value, AVG(value) AS value
         FROM \`indikator_${id}\`
        WHERE year = ?
          AND year > 0
          ${monthClause}
          ${metricClause}
          AND dim_value IN (${placeholders})
        GROUP BY dim_value`,
      { replacements }
    );

    const valueByKdkab = {};
    for (const r of rows) {
      const kdkab = dimValueToKdkab(r.dim_value);
      if (!kdkab) continue;
      const v = r.value == null ? null : Number(r.value);
      if (valueByKdkab[kdkab] == null) {
        valueByKdkab[kdkab] = v;
      } else if (v != null) {
        valueByKdkab[kdkab] = (valueByKdkab[kdkab] + v) / 2;
      }
    }

    return Object.entries(KDKAB_TO_NAMA).map(([kdkab, nama_kab]) => ({
      kdkab,
      nama_kab,
      value: valueByKdkab[kdkab] ?? null,
    }));
  });
}

async function getSummary({ indikator, year, month = null, metric = null }) {
  const id = validateIndikatorId(indikator);
  const y = validateYear(year);
  const m = month == null ? null : validateYear(month);
  const cacheKey = `summary:${id}:${y}:${m || 0}:${metric || '*'}`;

  return cache.getOrCompute(cacheKey, async () => {
    const seq = getSequelizeBps();
    const monthClause = m == null ? '' : 'AND month_no = ?';
    const metricClause = metric == null ? '' : 'AND metric = ?';

    // 1. Provinsi total — try dim_value='Maluku Utara'
    const provReplacements = [y];
    if (m != null) provReplacements.push(m);
    if (metric != null) provReplacements.push(metric);
    const [provRows] = await seq.query(
      `SELECT AVG(value) AS provinsi_total
         FROM \`indikator_${id}\`
        WHERE year = ? AND year > 0
          ${monthClause} ${metricClause}
          AND dim_value = 'Maluku Utara'`,
      { replacements: provReplacements }
    );
    const provinsi_total = provRows[0]?.provinsi_total != null
      ? Number(provRows[0].provinsi_total) : null;

    // 2. Per-kab values for top/bottom
    const data = await getData({ indikator: id, year: y, month: m, metric });
    const withValues = data.filter(d => d.value != null);
    const sorted = [...withValues].sort((a, b) => b.value - a.value);
    const top3 = sorted.slice(0, 3).map(d => ({ nama_kab: d.nama_kab, value: d.value }));
    const bottom3 = sorted.slice(-3).reverse()
      .map(d => ({ nama_kab: d.nama_kab, value: d.value }));

    // 3. Trend — last 5 years provinsi
    const trendReplacements = [y, y];
    if (m != null) trendReplacements.push(m);
    if (metric != null) trendReplacements.push(metric);
    const [trendRows] = await seq.query(
      `SELECT year, AVG(value) AS provinsi_total
         FROM \`indikator_${id}\`
        WHERE year BETWEEN ? - 4 AND ?
          AND year > 0
          ${monthClause} ${metricClause}
          AND dim_value = 'Maluku Utara'
        GROUP BY year
        ORDER BY year ASC`,
      { replacements: trendReplacements }
    );
    const trend = trendRows.map(r => ({
      year: Number(r.year),
      provinsi_total: r.provinsi_total != null ? Number(r.provinsi_total) : null,
    }));

    return { provinsi_total, top3, bottom3, trend };
  });
}

const INDIKATOR_LIST_KEY = 'ind:list';

async function initIndikatorList() {
  const seq = getSequelizeBps();
  if (!seq) {
    cache.set(INDIKATOR_LIST_KEY, { totalEligible: 0, kategori: {} });
    return;
  }
  try {
    const scanResults = await scanEligibility(seq);
    const list = buildIndikatorList(scanResults);
    await enrichListWithMetadata(list);
    cache.set(INDIKATOR_LIST_KEY, list);
    console.log(`[petaTematik] indikator list ready: ${list.totalEligible} eligible (with metadata)`);
  } catch (e) {
    console.error('[petaTematik] initIndikatorList failed:', e.message);
    cache.set(INDIKATOR_LIST_KEY, { totalEligible: 0, kategori: {} });
  }
}

/**
 * Decorate every indikator item with metadata from indicator_meta:
 *   - unit, decimal_places, subject_label
 * One bulk SELECT (no N+1). Sources missing from indicator_meta keep their
 * original shape; UI falls back gracefully when unit is null.
 */
async function enrichListWithMetadata(list) {
  if (!list?.kategori) return;
  const allIds = [];
  for (const items of Object.values(list.kategori)) {
    for (const it of items) allIds.push(it.sourceId);
  }
  if (allIds.length === 0) return;

  const metaMap = await metaLookup.getIndikatorMetaBulk(allIds);
  for (const items of Object.values(list.kategori)) {
    for (const it of items) {
      const m = metaMap.get(it.sourceId);
      if (!m) continue;
      it.unit = m.unit_id ?? null;
      it.decimal_places = m.decimal_places ?? 2;
      it.subject_label = m.subject_label ?? null;
      it.responsible_party = m.responsible_party ?? null;
    }
  }
}

// In-flight init promise so concurrent callers don't fire multiple scans.
let initPromise = null;

async function getIndikatorList() {
  const cached = cache.get(INDIKATOR_LIST_KEY);
  if (cached && cached.totalEligible > 0) return cached;
  // Lazy re-init when cache is empty/expired — prevents zombie state
  // where scanner ran once at boot but TTL expired hours later.
  if (!initPromise) {
    initPromise = initIndikatorList().finally(() => { initPromise = null; });
  }
  await initPromise;
  return cache.get(INDIKATOR_LIST_KEY) ?? { totalEligible: 0, kategori: {} };
}

function isValidIndikator(id) {
  const list = cache.get(INDIKATOR_LIST_KEY);
  if (!list || !list.kategori) return false;
  for (const items of Object.values(list.kategori)) {
    if (items.some(it => it.sourceId === Number(id))) return true;
  }
  return false;
}

module.exports = {
  getYears, getMetrics, getData, getSummary,
  getIndikatorList, initIndikatorList, isValidIndikator,
  validateIndikatorId,
};
