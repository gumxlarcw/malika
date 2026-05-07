'use strict';

const svc = require('../services/petaTematik/petaTematik.service');
const cache = require('../services/petaTematik/cache.service');

// Mock the DB module
jest.mock('../config/db_bps', () => {
  const queryMock = jest.fn();
  return jest.fn(() => ({ query: queryMock, _queryMock: queryMock }));
});

const getSequelizeBps = require('../config/db_bps');

describe('petaTematik.service', () => {
  beforeEach(() => {
    cache.clear();
    getSequelizeBps()._queryMock.mockReset();
  });

  describe('getYears', () => {
    test('returns sorted years and has_monthly flag', async () => {
      getSequelizeBps()._queryMock.mockResolvedValueOnce([[
        { year: 2024 }, { year: 2023 }, { year: 2022 },
      ]]);
      getSequelizeBps()._queryMock.mockResolvedValueOnce([[
        { has_monthly: 1 },
      ]]);

      const result = await svc.getYears(182);
      expect(result.years).toEqual([2022, 2023, 2024]);
      expect(result.has_monthly).toBe(true);
    });

    test('rejects invalid indikator id', async () => {
      await expect(svc.getYears('abc')).rejects.toThrow('Invalid indikator');
      await expect(svc.getYears(0)).rejects.toThrow('Invalid indikator');
      await expect(svc.getYears(-5)).rejects.toThrow('Invalid indikator');
    });

    test('caches result', async () => {
      const m = getSequelizeBps()._queryMock;
      m.mockResolvedValueOnce([[{ year: 2024 }]]);
      m.mockResolvedValueOnce([[{ has_monthly: 0 }]]);

      await svc.getYears(182);
      await svc.getYears(182);  // should hit cache
      expect(m).toHaveBeenCalledTimes(2); // 2 calls only on first invocation
    });
  });

  describe('getMetrics', () => {
    test('returns distinct metrics', async () => {
      getSequelizeBps()._queryMock.mockResolvedValueOnce([[
        { metric: 'value' }, { metric: 'month-to-month' },
      ]]);
      const result = await svc.getMetrics(182);
      expect(result.metrics).toEqual(['month-to-month', 'value']); // sorted
    });

    test('includes empty/null metric as "value" fallback', async () => {
      getSequelizeBps()._queryMock.mockResolvedValueOnce([[
        { metric: '' },
      ]]);
      const result = await svc.getMetrics(182);
      expect(result.metrics).toEqual(['value']);
    });
  });

  describe('getData', () => {
    test('returns 10 polygons with kdkab + value, null for missing kab', async () => {
      getSequelizeBps()._queryMock.mockResolvedValueOnce([[
        { dim_value: 'Halmahera Barat', value: 80.71 },
        { dim_value: 'Ternate', value: 1856.05 },
        // 8 missing
      ]]);

      const result = await svc.getData({ indikator: 182, year: 2022 });
      expect(result).toHaveLength(10);
      const halbar = result.find(r => r.kdkab === '01');
      expect(halbar.nama_kab).toBe('Halmahera Barat');
      expect(halbar.value).toBeCloseTo(80.71);
      const ternate = result.find(r => r.kdkab === '71');
      expect(ternate.value).toBeCloseTo(1856.05);
      // Missing kab → value: null
      const halteng = result.find(r => r.kdkab === '02');
      expect(halteng.value).toBeNull();
    });

    test('skips Maluku Utara (province total)', async () => {
      getSequelizeBps()._queryMock.mockResolvedValueOnce([[
        { dim_value: 'Maluku Utara', value: 41.25 },
        { dim_value: 'Halmahera Barat', value: 80.71 },
      ]]);
      const result = await svc.getData({ indikator: 182, year: 2022 });
      // No row with kdkab matching Maluku Utara — only 10 kab/kota
      expect(result).toHaveLength(10);
      expect(result.every(r => r.kdkab !== null)).toBe(true);
    });

    test('passes month + metric filters when provided', async () => {
      const m = getSequelizeBps()._queryMock;
      m.mockResolvedValueOnce([[{ dim_value: 'Ternate', value: 100 }]]);
      await svc.getData({ indikator: 182, year: 2024, month: 6, metric: 'value' });
      const callArgs = m.mock.calls[0];
      expect(callArgs[0]).toMatch(/month_no = \?/);
      expect(callArgs[0]).toMatch(/metric = \?/);
      expect(callArgs[1].replacements).toContain(6);
      expect(callArgs[1].replacements).toContain('value');
    });

    test('rejects invalid year', async () => {
      await expect(svc.getData({ indikator: 182, year: 0 })).rejects.toThrow('Invalid year');
      await expect(svc.getData({ indikator: 182, year: 'abc' })).rejects.toThrow('Invalid year');
    });
  });

  describe('getSummary', () => {
    test('returns provinsi_total + top3 + bottom3 + trend', async () => {
      const m = getSequelizeBps()._queryMock;
      // 1st call: provinsi total
      m.mockResolvedValueOnce([[{ provinsi_total: 41.25 }]]);
      // 2nd call: per-kab values for top/bottom (called by getData internally)
      m.mockResolvedValueOnce([[
        { dim_value: 'Ternate', value: 1856 },
        { dim_value: 'Halmahera Barat', value: 80 },
        { dim_value: 'Tidore Kepulauan', value: 71 },
        { dim_value: 'Halmahera Utara', value: 52 },
        { dim_value: 'Pulau Taliabu', value: 40 },
        { dim_value: 'Kepulauan Sula', value: 32 },
        { dim_value: 'Pulau Morotai', value: 31 },
        { dim_value: 'Halmahera Selatan', value: 31 },
        { dim_value: 'Halmahera Tengah', value: 22 },
        { dim_value: 'Halmahera Timur', value: 14 },
      ]]);
      // 3rd call: trend (last 5 years provinsi)
      m.mockResolvedValueOnce([[
        { year: 2020, provinsi_total: 38 },
        { year: 2021, provinsi_total: 39 },
        { year: 2022, provinsi_total: 41.25 },
      ]]);

      const result = await svc.getSummary({ indikator: 182, year: 2022 });
      expect(result.provinsi_total).toBeCloseTo(41.25);
      expect(result.top3).toHaveLength(3);
      expect(result.top3[0].nama_kab).toBe('Ternate');
      expect(result.top3[0].value).toBeCloseTo(1856);
      expect(result.bottom3).toHaveLength(3);
      expect(result.bottom3[0].nama_kab).toBe('Halmahera Timur');
      expect(result.trend).toHaveLength(3);
      expect(result.trend[2]).toEqual({ year: 2022, provinsi_total: 41.25 });
    });

    test('returns null provinsi_total if no row', async () => {
      const m = getSequelizeBps()._queryMock;
      m.mockResolvedValueOnce([[]]);  // no provinsi total
      m.mockResolvedValueOnce([[]]);  // no kab values
      m.mockResolvedValueOnce([[]]);  // no trend

      const result = await svc.getSummary({ indikator: 182, year: 2022 });
      expect(result.provinsi_total).toBeNull();
      expect(result.top3).toEqual([]);
      expect(result.bottom3).toEqual([]);
      expect(result.trend).toEqual([]);
    });
  });

  describe('getIndikatorList + initIndikatorList', () => {
    test('initIndikatorList caches result; getIndikatorList returns it', async () => {
      const m = getSequelizeBps()._queryMock;
      m.mockResolvedValueOnce([[ // table list
        { TABLE_NAME: 'indikator_182' },
      ]]);
      m.mockResolvedValueOnce([[ // per-table aggregate
        { source_id: 182, source_name: 'Kepadatan Penduduk', region_rows: 50 },
      ]]);

      await svc.initIndikatorList();
      const list = await svc.getIndikatorList();

      expect(list.totalEligible).toBe(1);
      expect(list.kategori.Kependudukan).toHaveLength(1);
      expect(list.kategori.Kependudukan[0].sourceId).toBe(182);
    });

    test('getIndikatorList without prior init returns empty fallback', async () => {
      cache.clear();
      const list = await svc.getIndikatorList();
      expect(list.totalEligible).toBe(0);
      expect(list.kategori).toEqual({});
    });
  });
});
