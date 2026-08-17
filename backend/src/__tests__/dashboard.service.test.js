'use strict';

jest.mock('../models/DataSource.model', () => ({ findAll: jest.fn() }));
jest.mock('../models/IndicatorMeta.model', () => ({ findAll: jest.fn() }));
jest.mock('../models/IndicatorMetricMeta.model', () => ({ findAll: jest.fn() }));
jest.mock('../services/settings/appSettings.service', () => ({ getJson: jest.fn(), setJson: jest.fn() }));
jest.mock('../services/indicator/read.service', () => ({
  getLatest: jest.fn(),
  getTrend: jest.fn(),
  getPeriodCount: jest.fn(),
}));

const DataSource = require('../models/DataSource.model');
const IndicatorMeta = require('../models/IndicatorMeta.model');
const IndicatorMetricMeta = require('../models/IndicatorMetricMeta.model');
const appSettings = require('../services/settings/appSettings.service');
const read = require('../services/indicator/read.service');
const svc = require('../services/dashboard/dashboard.service');

describe('dashboard.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    appSettings.getJson.mockResolvedValue(null);
    IndicatorMeta.findAll.mockResolvedValue([]);
    IndicatorMetricMeta.findAll.mockResolvedValue([]);
    read.getLatest.mockResolvedValue(null);
    read.getTrend.mockResolvedValue({ points: [], delta: null });
    read.getPeriodCount.mockResolvedValue(4); // eligible unless a test says otherwise
  });

  describe('pickMetric', () => {
    test('prefers percent over other types', () => {
      expect(svc.pickMetric([
        { id: 9, metric_key: 'count_a', metric_type: 'count' },
        { id: 3, metric_key: 'pct_a', metric_type: 'percent' },
      ])).toBe('pct_a');
    });

    test('falls back to the lowest id when types are equal', () => {
      expect(svc.pickMetric([
        { id: 9, metric_key: 'b', metric_type: 'numeric' },
        { id: 3, metric_key: 'a', metric_type: 'numeric' },
      ])).toBe('a');
    });

    test('returns null when there are no metrics', () => {
      expect(svc.pickMetric([])).toBeNull();
    });
  });

  describe('getSummary', () => {
    test('groups visible sources by category', async () => {
      DataSource.findAll.mockResolvedValue([
        { id: 1, name: 'A', category: 'Ekonomi', visible: true, display_order: 1, icon: null, color: null },
        { id: 2, name: 'B', category: 'Ekonomi', visible: true, display_order: 2, icon: null, color: null },
        { id: 3, name: 'C', category: 'Sosial', visible: true, display_order: 1, icon: null, color: null },
      ]);
      read.getTrend.mockResolvedValue({ points: [{ year: 2026, month_no: 35, periodLabel: '2026', value: 1 }], delta: null });

      const out = await svc.getSummary();

      expect(out.categories.map((c) => c.name)).toEqual(['Ekonomi', 'Sosial']);
      expect(out.categories[0].indicators.map((i) => i.sourceId)).toEqual([1, 2]);
    });

    test('an indicator with a province row gets shape "province"', async () => {
      DataSource.findAll.mockResolvedValue([
        { id: 1, name: 'A', category: 'Ekonomi', visible: true, display_order: 1, icon: null, color: null },
      ]);
      read.getLatest.mockResolvedValue({ value: 5.93, year: 2026, month_no: 35, periodLabel: '2026', scope: 'province' });
      read.getTrend.mockResolvedValue({ points: [{ year: 2026, month_no: 35, periodLabel: '2026', value: 5.93 }], delta: null });

      const out = await svc.getSummary();

      expect(out.categories[0].indicators[0].shape).toBe('province');
      expect(out.categories[0].indicators[0].latest.value).toBe(5.93);
    });

    test('an indicator without a province row is not given a headline value', async () => {
      DataSource.findAll.mockResolvedValue([
        { id: 1, name: 'A', category: 'Ekonomi', visible: true, display_order: 1, icon: null, color: null },
      ]);
      read.getLatest.mockResolvedValue(null);
      read.getTrend.mockResolvedValue({ points: [], delta: null });

      const out = await svc.getSummary();

      const card = out.categories[0].indicators[0];
      expect(card.latest).toBeNull();
      expect(card.shape).not.toBe('province');
    });

    test('headline follows the appSettings list when present', async () => {
      DataSource.findAll.mockResolvedValue([
        { id: 1, name: 'A', category: 'Ekonomi', visible: true, display_order: 1, icon: null, color: null },
        { id: 2, name: 'B', category: 'Ekonomi', visible: true, display_order: 2, icon: null, color: null },
      ]);
      appSettings.getJson.mockResolvedValue([2]);

      const out = await svc.getSummary();

      expect(out.headline.map((c) => c.sourceId)).toEqual([2]);
    });

    // Spec: fewer than two periods carrying values is not eligible for a card.
    test('excludes an indicator with fewer than two periods of data', async () => {
      DataSource.findAll.mockResolvedValue([
        { id: 1, name: 'A', category: 'Ekonomi', visible: true, display_order: 1, icon: null, color: null },
        { id: 2, name: 'B', category: 'Ekonomi', visible: true, display_order: 2, icon: null, color: null },
      ]);
      read.getPeriodCount.mockImplementation((id) => Promise.resolve(id === 1 ? 1 : 5));

      const out = await svc.getSummary();

      expect(out.categories[0].indicators.map((i) => i.sourceId)).toEqual([2]);
    });

    test('drops a category that ends up with no eligible indicators', async () => {
      DataSource.findAll.mockResolvedValue([
        { id: 1, name: 'A', category: 'Kosong', visible: true, display_order: 1, icon: null, color: null },
      ]);
      read.getPeriodCount.mockResolvedValue(0);

      const out = await svc.getSummary();

      expect(out.categories).toEqual([]);
    });

    test('one broken indicator does not fail the whole dashboard', async () => {
      DataSource.findAll.mockResolvedValue([
        { id: 1, name: 'A', category: 'Ekonomi', visible: true, display_order: 1, icon: null, color: null },
        { id: 2, name: 'B', category: 'Ekonomi', visible: true, display_order: 2, icon: null, color: null },
      ]);
      read.getTrend.mockImplementation((id) => {
        if (id === 1) return Promise.reject(new Error('boom'));
        return Promise.resolve({ points: [], delta: null });
      });

      const out = await svc.getSummary();

      expect(out.categories[0].indicators.map((i) => i.sourceId)).toEqual([1, 2]);
      expect(out.categories[0].indicators[0].error).toBe(true);
    });
  });
});
