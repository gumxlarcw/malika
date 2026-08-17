'use strict';

/**
 * Dashboard-shaped reads over a single `indikator_NNN` table.
 *
 * PROVINCE RULE (spec, non-negotiable): a provincial figure is returned only
 * when the source provides an explicit province row. Averaging ten
 * kabupaten/kota does not yield the provincial poverty rate — that needs
 * population weighting — and summing is wrong for rates and indices. Publishing
 * either under a BPS masthead would be a fabricated official statistic, so when
 * no province row exists this returns null and the caller renders a different
 * card shape.
 */

const { QueryTypes } = require('sequelize');
const getSequelizeBps = require('../../config/db_bps');
const { validateIndicatorId, tableName, getWatermark } = require('./watermark.service');
const cache = require('./cache');
const { periodClass, periodLabel, sortPeriodsDesc } = require('./period');
const { dimValueToKdkab } = require('../petaTematik/regionMap.service');

/** From shared/geo-regions.json — provinceAliases. */
const PROVINCE_ALIASES = ['maluku utara', 'malut', 'provinsi maluku utara', 'north maluku'];

function normalise(dimValue) {
  return String(dimValue == null ? '' : dimValue).trim().toLowerCase();
}

function isRegionDimValue(dimValue) {
  return dimValueToKdkab(dimValue) != null;
}

function isProvinceDimValue(dimValue) {
  if (isRegionDimValue(dimValue)) return false;
  return PROVINCE_ALIASES.includes(normalise(dimValue));
}

async function fetchRows(id, metric) {
  const seq = getSequelizeBps();
  if (!seq) return [];
  const metricClause = metric == null ? '' : 'AND metric = ?';
  const replacements = metric == null ? [] : [metric];
  return seq.query(
    `SELECT year, month_no, dim_value, value
       FROM \`${tableName(id)}\`
      WHERE value IS NOT NULL
        AND year > 0
        ${metricClause}
      ORDER BY year DESC, month_no DESC
      LIMIT 500`,
    { replacements, type: QueryTypes.SELECT }
  );
}

async function getLatest(indicatorId, { metric = null } = {}) {
  const id = validateIndicatorId(indicatorId);
  const watermark = await getWatermark(id);

  return cache.getOrCompute('latest', id, watermark, [metric], async () => {
    let rows = [];
    try {
      rows = await fetchRows(id, metric);
    } catch {
      return null;
    }
    if (!rows.length) return null;

    const provinceRows = rows.filter((r) => isProvinceDimValue(r.dim_value));
    if (!provinceRows.length) return null; // See PROVINCE RULE above.

    const newest = sortPeriodsDesc(provinceRows)[0];
    return {
      value: Number(newest.value),
      year: Number(newest.year),
      month_no: Number(newest.month_no || 0),
      periodLabel: periodLabel(newest.year, newest.month_no),
      scope: 'province',
    };
  });
}

async function getTrend(indicatorId, { metric = null, limit = 6 } = {}) {
  const id = validateIndicatorId(indicatorId);
  const watermark = await getWatermark(id);
  const n = Number.isInteger(limit) && limit > 0 && limit <= 40 ? limit : 6;

  return cache.getOrCompute('trend', id, watermark, [metric, n], async () => {
    let rows = [];
    try {
      rows = await fetchRows(id, metric);
    } catch {
      return { points: [], delta: null };
    }

    const provinceRows = sortPeriodsDesc(rows.filter((r) => isProvinceDimValue(r.dim_value)));
    if (!provinceRows.length) return { points: [], delta: null };

    const newest = provinceRows[0];
    const cls = periodClass(newest.month_no);

    // Only periods of the same class are comparable: Triwulan IV against
    // Tahunan is not a quarter-on-quarter change.
    const sameClass = provinceRows.filter((r) => periodClass(r.month_no) === cls);

    const recent = sameClass.slice(0, n);
    const points = [...recent].reverse().map((r) => ({
      year: Number(r.year),
      month_no: Number(r.month_no || 0),
      periodLabel: periodLabel(r.year, r.month_no),
      value: Number(r.value),
    }));

    let delta = null;
    if (sameClass.length >= 2) {
      const prev = sameClass[1];
      delta = {
        absolute: Number(newest.value) - Number(prev.value),
        previousValue: Number(prev.value),
        previousLabel: periodLabel(prev.year, prev.month_no),
      };
    }

    return { points, delta };
  });
}

async function getPeriodCount(indicatorId, { metric = null } = {}) {
  const id = validateIndicatorId(indicatorId);
  const watermark = await getWatermark(id);

  return cache.getOrCompute('periodcount', id, watermark, [metric], async () => {
    try {
      const seq = getSequelizeBps();
      if (!seq) return 0;
      const metricClause = metric == null ? '' : 'AND metric = ?';
      const replacements = metric == null ? [] : [metric];
      const rows = await seq.query(
        `SELECT COUNT(DISTINCT year, month_no) AS n
           FROM \`${tableName(id)}\`
          WHERE value IS NOT NULL
            AND year > 0
            ${metricClause}`,
        { replacements, type: QueryTypes.SELECT }
      );
      return rows && rows[0] ? Number(rows[0].n) || 0 : 0;
    } catch {
      return 0;
    }
  });
}

module.exports = { isProvinceDimValue, isRegionDimValue, getLatest, getTrend, getPeriodCount };
