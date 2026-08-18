'use strict';

/**
 * BPS `month_no` is a sentinel set, not a calendar month.
 * See docs/workspace/database.md:
 *   0        unknown / annual rollup
 *   1..12    January..December
 *   31..34   Triwulan I..IV
 *   35       Tahunan
 *   36, 37   semester markers (Maret / September, used for Kemiskinan)
 *
 * Comparing across classes produces nonsense deltas — Triwulan IV against
 * Tahunan is not a quarter-on-quarter change — so callers group by class first.
 */

const { MONTHS_ID } = require('../../utils/period');

const ROMAN = ['I', 'II', 'III', 'IV'];

function periodClass(monthNo) {
  const m = monthNo == null ? 0 : Number(monthNo);
  if (m === 0 || m === 35) return 'annual';
  if (m >= 1 && m <= 12) return 'monthly';
  if (m >= 31 && m <= 34) return 'quarterly';
  if (m === 36 || m === 37) return 'semester';
  return 'unknown';
}

function periodLabel(year, monthNo) {
  const m = monthNo == null ? 0 : Number(monthNo);
  const y = String(year);
  switch (periodClass(m)) {
    case 'annual': return y;
    case 'monthly': return `${MONTHS_ID[m - 1]} ${y}`;
    case 'quarterly': return `Triwulan ${ROMAN[m - 31]} ${y}`;
    case 'semester': return `${m === 36 ? 'Maret' : 'September'} ${y}`;
    default: return y;
  }
}

function sortPeriodsDesc(rows) {
  return [...rows].sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year;
    return Number(b.month_no || 0) - Number(a.month_no || 0);
  });
}

module.exports = { periodClass, periodLabel, sortPeriodsDesc, MONTHS_ID };
