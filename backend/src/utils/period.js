'use strict';

/**
 * Period string utilities.
 *
 * Two period notations circulate in this codebase:
 *   - calendar strings: `2024`, `2024-03`, `2024-Q2`, `2024-S1`
 *   - BPS `th_id` codes: `125` (= 2025) and `12501` (= 2025-01), where the year
 *     is stored as `year - 1900` (see convertYearToBpsCode).
 *
 * Ordering follows the same rule as utils/dateHelper.parsePeriodString: a period
 * is ranked by the LAST month it covers, so a yearly `2025` sorts after monthly
 * `2025-01`. comparePeriods is re-exported from dateHelper rather than
 * reimplemented so the two modules can never drift apart.
 */

const { comparePeriods } = require('./dateHelper');

const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** BPS stores years as an offset from 1900: 2025 -> 125. */
function convertYearToBpsCode(year) {
  return year - 1900;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Parse a period string into its components.
 * Returns null when the value matches no known notation.
 *
 * @param {string} value
 * @returns {{year:number, type:string, month?:number, quarter?:number, semester?:number}|null}
 */
function parsePeriod(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return null;

  const yearly = raw.match(/^(\d{4})$/);
  if (yearly) return { year: Number(yearly[1]), type: 'yearly' };

  const monthly = raw.match(/^(\d{4})-?(0[1-9]|1[0-2])$/);
  if (monthly) {
    return { year: Number(monthly[1]), month: Number(monthly[2]), type: 'monthly' };
  }

  const quarterly = raw.match(/^(\d{4})-?Q([1-4])$/i);
  if (quarterly) {
    return { year: Number(quarterly[1]), quarter: Number(quarterly[2]), type: 'quarterly' };
  }

  const semesterly = raw.match(/^(\d{4})-?S([12])$/i);
  if (semesterly) {
    return { year: Number(semesterly[1]), semester: Number(semesterly[2]), type: 'semesterly' };
  }

  // BPS th_id: 3 digits = yearly, 5 digits = yearly + 2-digit month.
  const bpsYearly = raw.match(/^(\d{3})$/);
  if (bpsYearly) return { year: Number(bpsYearly[1]) + 1900, type: 'yearly' };

  const bpsMonthly = raw.match(/^(\d{3})(0[1-9]|1[0-2])$/);
  if (bpsMonthly) {
    return {
      year: Number(bpsMonthly[1]) + 1900,
      month: Number(bpsMonthly[2]),
      type: 'monthly',
    };
  }

  return null;
}

/**
 * Parse into a sortable record. `month` is the last month the period covers, so
 * `key` (year*100 + month) orders mixed granularities consistently.
 *
 * @param {string} value
 * @returns {{year:number, month:number, quarter:number|undefined, semester:number|undefined, type:string, key:number}|null}
 */
function parsePeriodValue(value) {
  const parsed = parsePeriod(value);
  if (!parsed) return null;

  let month;
  switch (parsed.type) {
    case 'monthly': month = parsed.month; break;
    case 'quarterly': month = parsed.quarter * 3; break;
    case 'semesterly': month = parsed.semester * 6; break;
    default: month = 12; break; // yearly covers through December
  }

  return {
    year: parsed.year,
    month,
    quarter: parsed.quarter,
    semester: parsed.semester,
    type: parsed.type,
    key: parsed.year * 100 + month,
  };
}

/** Shift a period by `step` units of its own granularity. */
function shiftPeriod(value, step) {
  const parsed = parsePeriod(value);
  if (!parsed) return null;
  const { year, type } = parsed;

  if (type === 'yearly') return String(year + step);

  if (type === 'monthly') {
    const total = year * 12 + (parsed.month - 1) + step;
    return `${Math.floor(total / 12)}-${pad2((total % 12) + 1)}`;
  }

  if (type === 'quarterly') {
    const total = year * 4 + (parsed.quarter - 1) + step;
    return `${Math.floor(total / 4)}-Q${(total % 4) + 1}`;
  }

  const total = year * 2 + (parsed.semester - 1) + step;
  return `${Math.floor(total / 2)}-S${(total % 2) + 1}`;
}

function getNextPeriod(value) {
  return shiftPeriod(value, 1);
}

function getPrevPeriod(value) {
  return shiftPeriod(value, -1);
}

/** Human-readable Indonesian label, e.g. "Maret 2024", "Triwulan 2 2024". */
function formatPeriod(value) {
  const parsed = parsePeriod(value);
  if (!parsed) return String(value == null ? '' : value);

  switch (parsed.type) {
    case 'monthly': return `${MONTHS_ID[parsed.month - 1]} ${parsed.year}`;
    case 'quarterly': return `Triwulan ${parsed.quarter} ${parsed.year}`;
    case 'semesterly': return `Semester ${parsed.semester} ${parsed.year}`;
    default: return String(parsed.year);
  }
}

module.exports = {
  convertYearToBpsCode,
  parsePeriod,
  parsePeriodValue,
  comparePeriods,
  getNextPeriod,
  getPrevPeriod,
  formatPeriod,
  MONTHS_ID,
};
