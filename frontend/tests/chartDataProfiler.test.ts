/**
 * Tests for Chart Data Profiler
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  profileChartData,
  getIndicatorChartConfig,
  INDICATOR_CHART_MAP,
  validateChartData,
  type DataProfile,
} from '../src/lib/chartDataProfiler.js';

describe('chartDataProfiler', () => {
  describe('INDICATOR_CHART_MAP', () => {
    it('should have mappings for common datasources', () => {
      // Inflasi
      assert(INDICATOR_CHART_MAP[1], 'Should have mapping for source 1');
      assert.strictEqual(INDICATOR_CHART_MAP[1].profile, 'time-series-monthly');
      assert.strictEqual(INDICATOR_CHART_MAP[1].chartType, 'line');

      // Gini Rasio
      assert(INDICATOR_CHART_MAP[8], 'Should have mapping for source 8');
      assert.strictEqual(INDICATOR_CHART_MAP[8].profile, 'geo-single-metric');
      assert.strictEqual(INDICATOR_CHART_MAP[8].chartType, 'bar');

      // EXIM
      assert(INDICATOR_CHART_MAP[159], 'Should have mapping for source 159');
      assert.strictEqual(INDICATOR_CHART_MAP[159].profile, 'exim-time-series');
    });

    it('should have more than 300 mappings', () => {
      const mappingCount = Object.keys(INDICATOR_CHART_MAP).length;
      assert(mappingCount > 300, `Expected >300 mappings, got ${mappingCount}`);
    });
  });

  describe('profileChartData', () => {
    it('should detect time-series-multi-metric for inflasi-like data with multiple metrics', () => {
      // This data has 2 metrics (month-to-month, year-on-year) so it should be time-series-multi-metric
      const columns = ['Bulan', 'month-to-month', 'year-on-year'];
      const rows = [
        { Bulan: 'Januari', 'month-to-month': 0.5, 'year-on-year': 2.1 },
        { Bulan: 'Februari', 'month-to-month': 0.3, 'year-on-year': 2.2 },
        { Bulan: 'Maret', 'month-to-month': 0.4, 'year-on-year': 2.3 },
      ];

      const result = profileChartData(columns, rows, 'dynamic');

      assert.strictEqual(result.profile, 'time-series-multi-metric');
      assert.strictEqual(result.recommended.chartType, 'line');
      assert(result.dimensions.time, 'Should detect time dimension');
      assert.strictEqual(result.dimensions.time?.column, 'Bulan');
    });

    it('should detect time-series-monthly for single metric time series', () => {
      const columns = ['Bulan', 'Nilai'];
      const rows = [
        { Bulan: 'Januari', Nilai: 0.5 },
        { Bulan: 'Februari', Nilai: 0.3 },
        { Bulan: 'Maret', Nilai: 0.4 },
      ];

      const result = profileChartData(columns, rows, 'dynamic');

      assert.strictEqual(result.profile, 'time-series-monthly');
      assert.strictEqual(result.recommended.chartType, 'line');
    });

    it('should detect geo-single-metric for wilayah + nilai (>5 rows)', () => {
      const columns = ['Wilayah', 'Nilai'];
      // Need more than 5 rows to avoid "few-rows-category" profile
      const rows = [
        { Wilayah: 'Halmahera Barat', Nilai: 0.225 },
        { Wilayah: 'Ternate', Nilai: 0.312 },
        { Wilayah: 'Tidore', Nilai: 0.289 },
        { Wilayah: 'Halmahera Utara', Nilai: 0.315 },
        { Wilayah: 'Halmahera Tengah', Nilai: 0.245 },
        { Wilayah: 'Halmahera Selatan', Nilai: 0.298 },
      ];

      const result = profileChartData(columns, rows, 'dynamic');

      assert.strictEqual(result.profile, 'geo-single-metric');
      assert.strictEqual(result.recommended.chartType, 'bar');
      assert(result.dimensions.geo, 'Should detect geo dimension');
    });

    it('should detect few-rows-category for small geo data', () => {
      const columns = ['Wilayah', 'Nilai'];
      const rows = [
        { Wilayah: 'Ternate', Nilai: 0.312 },
        { Wilayah: 'Tidore', Nilai: 0.289 },
      ];

      const result = profileChartData(columns, rows, 'dynamic');

      // With <= 5 rows, it becomes few-rows-category
      assert.strictEqual(result.profile, 'few-rows-category');
    });

    it('should detect exim-time-series for EXIM data', () => {
      const columns = ['Bulan', 'pod', 'ctr', 'kodehs', 'value', 'netweight'];
      const rows = [
        { Bulan: 'Januari', pod: 'SANANA', ctr: 'SINGAPORE', kodehs: '03', value: 1000, netweight: 500 },
        { Bulan: 'Februari', pod: 'SANANA', ctr: 'SINGAPORE', kodehs: '03', value: 1200, netweight: 600 },
      ];

      const result = profileChartData(columns, rows, 'exim');

      assert.strictEqual(result.profile, 'exim-time-series');
      assert.strictEqual(result.recommended.chartType, 'line');
      assert(result.dimensions.filters, 'Should detect filter dimensions');
    });

    it('should detect single-row for province-level data', () => {
      const columns = ['Propinsi', 'Nilai'];
      const rows = [{ Propinsi: 'Maluku Utara', Nilai: 5.5 }];

      const result = profileChartData(columns, rows, 'dynamic');

      assert.strictEqual(result.profile, 'single-row');
      assert.strictEqual(result.recommended.chartType, 'none');
      assert.strictEqual(result.isChartable, false);
    });

    it('should return empty profile for null/empty data', () => {
      const result1 = profileChartData(null, null);
      assert.strictEqual(result1.profile, 'empty');
      assert.strictEqual(result1.isChartable, false);

      const result2 = profileChartData([], []);
      assert.strictEqual(result2.profile, 'empty');
    });
  });

  describe('getIndicatorChartConfig', () => {
    it('should return pre-computed config for known source_id', () => {
      const result = getIndicatorChartConfig(1);

      assert.strictEqual(result.profile, 'time-series-monthly');
      assert.strictEqual(result.recommended.chartType, 'line');
      assert.strictEqual(result.recommended.xAxis, 'Bulan');
    });

    it('should fallback to dynamic profiling for unknown source_id', () => {
      // Need more than 5 rows for geo-single-metric
      const columns = ['Wilayah', 'Nilai'];
      const rows = [
        { Wilayah: 'A', Nilai: 1 },
        { Wilayah: 'B', Nilai: 2 },
        { Wilayah: 'C', Nilai: 3 },
        { Wilayah: 'D', Nilai: 4 },
        { Wilayah: 'E', Nilai: 5 },
        { Wilayah: 'F', Nilai: 6 },
      ];

      const result = getIndicatorChartConfig(99999, columns, rows, 'dynamic');

      assert.strictEqual(result.profile, 'geo-single-metric');
    });

    it('should return unknown profile for source without data or mapping', () => {
      const result = getIndicatorChartConfig(99999);

      assert.strictEqual(result.profile, 'unknown');
      assert.strictEqual(result.isChartable, false);
    });
  });

  describe('validateChartData', () => {
    it('should validate chartable data', () => {
      const profile = profileChartData(
        ['Bulan', 'Nilai'],
        [
          { Bulan: 'Jan', Nilai: 1 },
          { Bulan: 'Feb', Nilai: 2 },
          { Bulan: 'Mar', Nilai: 3 },
        ]
      );

      const validation = validateChartData(profile, [
        { Bulan: 'Jan', Nilai: 1 },
        { Bulan: 'Feb', Nilai: 2 },
        { Bulan: 'Mar', Nilai: 3 },
      ]);

      assert.strictEqual(validation.isValid, true);
      assert(validation.sanitizedData, 'Should have sanitized data');
      assert.strictEqual(validation.sanitizedData?.categories.length, 3);
    });

    it('should warn about all-zero values', () => {
      const profile = profileChartData(
        ['Wilayah', 'Nilai'],
        [
          { Wilayah: 'A', Nilai: 0 },
          { Wilayah: 'B', Nilai: 0 },
        ]
      );

      const validation = validateChartData(profile, [
        { Wilayah: 'A', Nilai: 0 },
        { Wilayah: 'B', Nilai: 0 },
      ]);

      assert(
        validation.warnings.includes('Semua nilai metrik adalah 0 atau null'),
        'Should warn about all-zero values'
      );
    });
  });
});
