'use strict';

const p = require('../services/indicator/period');

describe('indicator/period', () => {
  test('classifies the BPS sentinel set', () => {
    expect(p.periodClass(0)).toBe('annual');
    expect(p.periodClass(35)).toBe('annual');
    expect(p.periodClass(1)).toBe('monthly');
    expect(p.periodClass(12)).toBe('monthly');
    expect(p.periodClass(31)).toBe('quarterly');
    expect(p.periodClass(34)).toBe('quarterly');
    expect(p.periodClass(36)).toBe('semester');
    expect(p.periodClass(37)).toBe('semester');
    expect(p.periodClass(99)).toBe('unknown');
    expect(p.periodClass(null)).toBe('annual');
  });

  test('labels periods the way BPS writes them', () => {
    expect(p.periodLabel(2026, 35)).toBe('2026');
    expect(p.periodLabel(2026, 0)).toBe('2026');
    expect(p.periodLabel(2026, 7)).toBe('Juli 2026');
    expect(p.periodLabel(2026, 32)).toBe('Triwulan II 2026');
    expect(p.periodLabel(2026, 36)).toBe('Maret 2026');
    expect(p.periodLabel(2026, 37)).toBe('September 2026');
  });

  test('sorts newest first within a year', () => {
    const rows = [
      { year: 2025, month_no: 34 },
      { year: 2026, month_no: 31 },
      { year: 2026, month_no: 33 },
    ];
    expect(p.sortPeriodsDesc(rows)).toEqual([
      { year: 2026, month_no: 33 },
      { year: 2026, month_no: 31 },
      { year: 2025, month_no: 34 },
    ]);
  });
});
