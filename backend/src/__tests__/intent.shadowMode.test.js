'use strict';

jest.mock('../services/search/fulltextRanker', () => ({
  rankByQuery:     jest.fn(),
  applyClickPrior: (c) => c,  // identity for tests
  deriveConfidence: () => 0.8,
  NAME_MATCH_WEIGHT: 2.0,
  MAX_CLICK_WEIGHT: 0.5,
}));
jest.mock('../services/search/entityResolver', () => ({
  resolveGeo: jest.fn(() => []),
  rebuildEntityIndex: jest.fn(),
  getEntityIndex: jest.fn(() => []),
}));
jest.mock('../services/ai/queryBuilder.service', () => ({
  buildQueryFromText: jest.fn().mockResolvedValue({
    intent: 'data', type: 'dynamic', params: { year: 2024 }, confidence: 0.9,
  }),
}));
jest.mock('../services/search/datasourceSearch.service', () => ({
  searchDatasources: jest.fn().mockResolvedValue([
    { id: 19, type: 'dynamic' },
  ]),
  expandIndicatorAbbreviations: jest.fn((q) => q),
}));
jest.mock('../services/bpsRead/indicatorAvailability.service', () => ({
  indicatorTableExistsInBps: jest.fn().mockResolvedValue({ available: true }),
}));
jest.mock('../models/DataSource.model', () => ({ findOne: jest.fn() }), { virtual: true });
jest.mock('../models/DataPeriod.model', () => ({ findAll: jest.fn().mockResolvedValue([]) }), { virtual: true });

const { rankByQuery } = require('../services/search/fulltextRanker');
const { recordDivergence, snapshot, reset } = require('../services/search/shadowLogger.service');
const { resolveSearchIntent } = require('../services/search/intent.service');

describe('shadow mode', () => {
  beforeEach(() => {
    rankByQuery.mockReset();
    reset();
  });

  test('with SEARCH_SHADOW_MODE=1, records divergence when old!=new', async () => {
    process.env.SEARCH_SHADOW_MODE = '1';
    // Old path picks source_id 19 (via searchDatasources mock)
    // New path picks source_id 42 (via rankByQuery mock)
    rankByQuery.mockResolvedValueOnce([{ id: 42, type: 'interop', base_relevance: 5 }]);

    const result = await resolveSearchIntent({ q: 'tpt malut 2024' });

    // User gets OLD result (unchanged behavior)
    expect(result.ok).toBe(true);
    // Divergence recorded (19 → 42)
    const s = snapshot();
    expect(s.total_divergent).toBe(1);
    expect(s.divergence_pairs['19→42']).toBe(1);

    delete process.env.SEARCH_SHADOW_MODE;
  });

  test('without SEARCH_SHADOW_MODE, no divergence recording', async () => {
    delete process.env.SEARCH_SHADOW_MODE;
    rankByQuery.mockResolvedValueOnce([{ id: 42, type: 'interop', base_relevance: 5 }]);

    await resolveSearchIntent({ q: 'tpt malut 2024' });

    expect(snapshot().total_recorded).toBe(0);
  });

  test('no divergence recorded when old and new agree', async () => {
    process.env.SEARCH_SHADOW_MODE = '1';
    rankByQuery.mockResolvedValueOnce([{ id: 19, type: 'dynamic', base_relevance: 5 }]);

    await resolveSearchIntent({ q: 'tpt malut 2024' });

    const s = snapshot();
    expect(s.total_divergent).toBe(0);
    expect(s.total_recorded).toBe(1);  // agreement is still recorded

    delete process.env.SEARCH_SHADOW_MODE;
  });
});
