'use strict';

jest.mock('../config/db_bps', () => {
  const queryMock = jest.fn();
  return jest.fn(() => ({ query: queryMock, _queryMock: queryMock }));
});

const getSequelizeBps = require('../config/db_bps');
const cache = require('../services/indicator/cache');
const wm = require('../services/indicator/watermark.service');
const read = require('../services/indicator/read.service');

function mockWatermark(ms) {
  getSequelizeBps()._queryMock.mockResolvedValueOnce([{ lu: new Date(ms) }]);
}

describe('indicator/read.service', () => {
  beforeEach(() => {
    cache.clear();
    wm.clearWatermarkMemo();
    getSequelizeBps()._queryMock.mockReset();
  });

  describe('dim_value classification', () => {
    test('recognises province rows', () => {
      expect(read.isProvinceDimValue('Maluku Utara')).toBe(true);
      expect(read.isProvinceDimValue('MALUKU UTARA')).toBe(true);
      expect(read.isProvinceDimValue('Provinsi Maluku Utara')).toBe(true);
    });

    test('does not mistake a kabupaten/kota for the province', () => {
      expect(read.isProvinceDimValue('Halmahera Barat')).toBe(false);
      expect(read.isProvinceDimValue('Kota Ternate')).toBe(false);
      expect(read.isRegionDimValue('Kota Ternate')).toBe(true);
      expect(read.isRegionDimValue('Maluku Utara')).toBe(false);
    });

    test('a non-geographic dimension is neither', () => {
      expect(read.isProvinceDimValue('A. Pertanian, Kehutanan, dan Perikanan')).toBe(false);
      expect(read.isRegionDimValue('A. Pertanian, Kehutanan, dan Perikanan')).toBe(false);
    });
  });

  describe('getLatest', () => {
    test('returns the province value for the newest period', async () => {
      mockWatermark(1000);
      getSequelizeBps()._queryMock.mockResolvedValueOnce([
        { year: 2026, month_no: 35, dim_value: 'Maluku Utara', value: 5.93 },
      ]);

      await expect(read.getLatest(182, { metric: 'm1' })).resolves.toEqual({
        value: 5.93,
        year: 2026,
        month_no: 35,
        periodLabel: '2026',
        scope: 'province',
      });
    });

    // The rule that must never regress: averaging regions is not a provincial figure.
    test('returns null when only kabupaten/kota rows exist', async () => {
      mockWatermark(1000);
      getSequelizeBps()._queryMock.mockResolvedValueOnce([
        { year: 2026, month_no: 35, dim_value: 'Halmahera Barat', value: 6.48 },
        { year: 2026, month_no: 35, dim_value: 'Kota Ternate', value: 8.21 },
      ]);

      await expect(read.getLatest(182, { metric: 'm1' })).resolves.toBeNull();
    });

    test('returns null when the indicator has no rows at all', async () => {
      mockWatermark(1000);
      getSequelizeBps()._queryMock.mockResolvedValueOnce([]);
      await expect(read.getLatest(182, { metric: 'm1' })).resolves.toBeNull();
    });

    test('serves from cache on the second call with the same watermark', async () => {
      const m = getSequelizeBps()._queryMock;
      mockWatermark(1000);
      m.mockResolvedValueOnce([{ year: 2026, month_no: 35, dim_value: 'Maluku Utara', value: 1 }]);

      await read.getLatest(182, { metric: 'm1' });
      const callsAfterFirst = m.mock.calls.length;
      await read.getLatest(182, { metric: 'm1' });

      expect(m.mock.calls.length).toBe(callsAfterFirst);
    });

    test('rejects an invalid indicator id before touching the database', async () => {
      await expect(read.getLatest('abc', { metric: 'm' })).rejects.toThrow('Invalid indikator');
      expect(getSequelizeBps()._queryMock).not.toHaveBeenCalled();
    });
  });

  describe('getTrend', () => {
    test('returns province points oldest-first with a like-for-like delta', async () => {
      mockWatermark(1000);
      getSequelizeBps()._queryMock.mockResolvedValueOnce([
        { year: 2026, month_no: 32, dim_value: 'Maluku Utara', value: 20.49 },
        { year: 2026, month_no: 31, dim_value: 'Maluku Utara', value: 18.79 },
        { year: 2025, month_no: 34, dim_value: 'Maluku Utara', value: 17.10 },
      ]);

      const t = await read.getTrend(182, { metric: 'm1', limit: 6 });

      expect(t.points.map((p) => p.value)).toEqual([17.1, 18.79, 20.49]);
      expect(t.points[2].periodLabel).toBe('Triwulan II 2026');
      expect(t.delta.absolute).toBeCloseTo(1.7, 5);
      expect(t.delta.previousLabel).toBe('Triwulan I 2026');
    });

    test('does not compare across period classes', async () => {
      mockWatermark(1000);
      // Newest is quarterly; the only other row is annual — not comparable.
      getSequelizeBps()._queryMock.mockResolvedValueOnce([
        { year: 2026, month_no: 32, dim_value: 'Maluku Utara', value: 20.49 },
        { year: 2025, month_no: 35, dim_value: 'Maluku Utara', value: 17.10 },
      ]);

      const t = await read.getTrend(182, { metric: 'm1' });

      expect(t.delta).toBeNull();
    });

    test('returns empty points when there is no province row', async () => {
      mockWatermark(1000);
      getSequelizeBps()._queryMock.mockResolvedValueOnce([
        { year: 2026, month_no: 35, dim_value: 'Kota Ternate', value: 8.21 },
      ]);

      const t = await read.getTrend(182, { metric: 'm1' });

      expect(t.points).toEqual([]);
      expect(t.delta).toBeNull();
    });
  });

  describe('getPeriodCount', () => {
    test('counts distinct periods regardless of dimension', async () => {
      mockWatermark(1000);
      getSequelizeBps()._queryMock.mockResolvedValueOnce([{ n: 4 }]);

      await expect(read.getPeriodCount(182, { metric: 'm1' })).resolves.toBe(4);
    });

    // A region-only indicator has no province points but is still a real card,
    // so eligibility must not be judged from getTrend.
    test('counts region-only indicators too', async () => {
      mockWatermark(1000);
      getSequelizeBps()._queryMock.mockResolvedValueOnce([{ n: 2 }]);

      await expect(read.getPeriodCount(183, { metric: null })).resolves.toBe(2);
    });

    test('returns 0 when the query fails', async () => {
      mockWatermark(1000);
      getSequelizeBps()._queryMock.mockRejectedValueOnce(new Error('no such table'));

      await expect(read.getPeriodCount(999, { metric: null })).resolves.toBe(0);
    });
  });
});
