const {
  formatDate,
  parseDate,
  getQuarter,
  getSemester,
  getPeriodString,
  comparePeriods,
} = require('../utils/dateHelper');

describe('dateHelper utilities', () => {
  test('formatDate with tokens', () => {
    const d = new Date('2026-01-23T10:15:30Z');
    expect(formatDate(d, 'YYYY-MM-DD')).toBe('2026-01-23');
    expect(formatDate(d, 'DD/MM/YYYY')).toBe('23/01/2026');
  });

  test('parseDate handles Indonesian month names', () => {
    const parsed = parseDate('23 Januari 2026');
    expect(parsed).not.toBeNull();
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(0);
    expect(parsed.getDate()).toBe(23);
  });

  test('parseDate handles numeric formats', () => {
    const parsed = parseDate('2026-12-05');
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(11);
    expect(parsed.getDate()).toBe(5);
  });

  test('getQuarter/getSemester', () => {
    const d = new Date('2026-07-01T00:00:00Z');
    expect(getQuarter(d)).toBe(3);
    expect(getSemester(d)).toBe(2);
  });

  test('getPeriodString', () => {
    const d = new Date('2026-02-10T00:00:00Z');
    expect(getPeriodString(d, 'monthly')).toBe('2026-02');
    expect(getPeriodString(d, 'quarterly')).toBe('2026-Q1');
    expect(getPeriodString(d, 'semesterly')).toBe('2026-S1');
    expect(getPeriodString(d, 'yearly')).toBe('2026');
  });

  test('comparePeriods', () => {
    expect(comparePeriods('2024-12', '2025-01')).toBe(-1);
    expect(comparePeriods('2025-Q2', '2025-Q1')).toBe(1);
    expect(comparePeriods('2025', '2025-01')).toBe(1);
  });
});
