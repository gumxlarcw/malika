const {
  parsePeriod,
  comparePeriods,
  getNextPeriod,
  getPrevPeriod,
  formatPeriod,
  parsePeriodValue,
} = require('../utils/period');

describe('period utilities', () => {
  test('parsePeriod handles yearly, monthly, quarterly, semesterly', () => {
    expect(parsePeriod('2024')).toEqual({ year: 2024, type: 'yearly' });
    expect(parsePeriod('2024-03')).toEqual({ year: 2024, month: 3, type: 'monthly' });
    expect(parsePeriod('2024-Q2')).toEqual({ year: 2024, quarter: 2, type: 'quarterly' });
    expect(parsePeriod('2024-S1')).toEqual({ year: 2024, semester: 1, type: 'semesterly' });
  });

  test('parsePeriod handles BPS th_id formats', () => {
    expect(parsePeriod('125')).toEqual({ year: 2025, type: 'yearly' });
    expect(parsePeriod('12501')).toEqual({ year: 2025, month: 1, type: 'monthly' });
  });

  test('comparePeriods orders by year and granularity', () => {
    expect(comparePeriods('2024-12', '2025-01')).toBe(-1);
    expect(comparePeriods('2025-Q2', '2025-Q1')).toBe(1);
    expect(comparePeriods('2025', '2025-01')).toBe(1);
  });

  test('getNextPeriod/getPrevPeriod respect type', () => {
    expect(getNextPeriod('2024-12')).toBe('2025-01');
    expect(getPrevPeriod('2024-01')).toBe('2023-12');
    expect(getNextPeriod('2024-Q4')).toBe('2025-Q1');
    expect(getPrevPeriod('2024-Q1')).toBe('2023-Q4');
    expect(getNextPeriod('2024-S2')).toBe('2025-S1');
    expect(getPrevPeriod('2024-S1')).toBe('2023-S2');
    expect(getNextPeriod('2024')).toBe('2025');
    expect(getPrevPeriod('2024')).toBe('2023');
  });

  test('formatPeriod renders readable labels', () => {
    expect(formatPeriod('2024-03')).toBe('Maret 2024');
    expect(formatPeriod('2024-Q2')).toBe('Triwulan 2 2024');
    expect(formatPeriod('2024-S1')).toBe('Semester 1 2024');
    expect(formatPeriod('2024')).toBe('2024');
  });

  test('parsePeriodValue returns key for sorting', () => {
    expect(parsePeriodValue('2024')).toEqual({
      year: 2024,
      month: 12,
      quarter: undefined,
      semester: undefined,
      type: 'yearly',
      key: 202412,
    });
    expect(parsePeriodValue('2024-02')).toEqual({
      year: 2024,
      month: 2,
      quarter: undefined,
      semester: undefined,
      type: 'monthly',
      key: 202402,
    });
  });
});
