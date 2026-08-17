'use strict';

jest.mock('../services/dashboard/dashboard.service', () => ({
  getSummary: jest.fn(),
  HEADLINE_SETTING_KEY: 'dashboard:headline',
  CATEGORY_ORDER_SETTING_KEY: 'dashboard:categoryOrder',
}));
jest.mock('../services/settings/appSettings.service', () => ({
  getJson: jest.fn(),
  setJson: jest.fn(),
}));

const dashboardService = require('../services/dashboard/dashboard.service');
const appSettings = require('../services/settings/appSettings.service');
const curation = require('../services/dashboard/curation.service');

describe('dashboard/curation.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    appSettings.getJson.mockResolvedValue(null);
    appSettings.setJson.mockResolvedValue(undefined);
    dashboardService.getSummary.mockResolvedValue({
      headline: [],
      categories: [
        { name: 'Ekonomi', indicators: [{ sourceId: 1, name: 'A', category: 'Ekonomi', shape: 'province' }] },
        { name: 'Sosial', indicators: [{ sourceId: 2, name: 'B', category: 'Sosial', shape: 'regional' }] },
      ],
      generatedAt: '2026-08-17T00:00:00.000Z',
    });
  });

  describe('getCuration', () => {
    test('returns saved settings plus a trimmed candidate list', async () => {
      appSettings.getJson.mockImplementation((k) =>
        Promise.resolve(k === 'dashboard:headline' ? [1] : ['Sosial'])
      );

      const out = await curation.getCuration();

      expect(out.headline).toEqual([1]);
      expect(out.categoryOrder).toEqual(['Sosial']);
      expect(out.categories).toEqual(['Ekonomi', 'Sosial']);
      // Only the fields the picker needs — never the whole payload.
      expect(out.candidates).toEqual([
        { sourceId: 1, name: 'A', category: 'Ekonomi', shape: 'province' },
        { sourceId: 2, name: 'B', category: 'Sosial', shape: 'regional' },
      ]);
    });

    test('returns empty arrays when nothing is saved yet', async () => {
      const out = await curation.getCuration();
      expect(out.headline).toEqual([]);
      expect(out.categoryOrder).toEqual([]);
    });
  });

  describe('saveCuration', () => {
    test('persists both settings', async () => {
      await curation.saveCuration({ headline: [3, 1], categoryOrder: ['Sosial', 'Ekonomi'] });

      expect(appSettings.setJson).toHaveBeenCalledWith('dashboard:headline', [3, 1]);
      expect(appSettings.setJson).toHaveBeenCalledWith('dashboard:categoryOrder', ['Sosial', 'Ekonomi']);
    });

    test('rejects a headline that is not a list of positive integers', async () => {
      await expect(curation.saveCuration({ headline: 'nope', categoryOrder: [] }))
        .rejects.toThrow('Invalid headline');
      await expect(curation.saveCuration({ headline: [0], categoryOrder: [] }))
        .rejects.toThrow('Invalid headline');
      await expect(curation.saveCuration({ headline: [1.5], categoryOrder: [] }))
        .rejects.toThrow('Invalid headline');
      expect(appSettings.setJson).not.toHaveBeenCalled();
    });

    test('caps the headline length', async () => {
      const tooMany = Array.from({ length: curation.MAX_HEADLINE + 1 }, (_, i) => i + 1);
      await expect(curation.saveCuration({ headline: tooMany, categoryOrder: [] }))
        .rejects.toThrow('Invalid headline');
    });

    test('rejects a categoryOrder that is not a list of strings', async () => {
      await expect(curation.saveCuration({ headline: [], categoryOrder: [1, 2] }))
        .rejects.toThrow('Invalid categoryOrder');
      expect(appSettings.setJson).not.toHaveBeenCalled();
    });

    test('de-duplicates the headline while preserving order', async () => {
      await curation.saveCuration({ headline: [2, 1, 2], categoryOrder: [] });
      expect(appSettings.setJson).toHaveBeenCalledWith('dashboard:headline', [2, 1]);
    });
  });
});
