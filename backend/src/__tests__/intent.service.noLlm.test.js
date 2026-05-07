'use strict';

jest.mock('../services/ai/queryBuilder.service', () => ({
  buildQueryFromText: jest.fn().mockResolvedValue({
    intent: 'data',
    type: 'dynamic',
    params: { year: 2024 },
    confidence: 0.9,
  }),
}));

jest.mock('../services/search/datasourceSearch.service', () => ({
  searchDatasources: jest.fn().mockResolvedValue([]),
  expandIndicatorAbbreviations: jest.fn().mockImplementation((q) => q),
}));

jest.mock('../services/bpsRead/indicatorAvailability.service', () => ({
  indicatorTableExistsInBps: jest.fn().mockResolvedValue({ available: true }),
}));

jest.mock('../models/DataSource.model', () => ({ findOne: jest.fn() }), { virtual: true });
jest.mock('../models/DataPeriod.model', () => ({ findOne: jest.fn() }), { virtual: true });

const qbService = require('../services/ai/queryBuilder.service');
const { resolveSearchIntent } = require('../services/search/intent.service');

describe('resolveSearchIntent noLlm flag', () => {
  beforeEach(() => {
    qbService.buildQueryFromText.mockClear();
  });

  test('calls LLM by default', async () => {
    await resolveSearchIntent({ q: 'tpt malut 2024' });
    expect(qbService.buildQueryFromText).toHaveBeenCalled();
  });

  test('skips LLM when noLlm=true', async () => {
    await resolveSearchIntent({ q: 'tpt malut 2024', noLlm: true });
    expect(qbService.buildQueryFromText).not.toHaveBeenCalled();
  });

  test('returns valid plan shape even when noLlm=true', async () => {
    const r = await resolveSearchIntent({ q: 'tpt malut 2024', noLlm: true });
    expect(r.ok).toBe(true);
    expect(r).toHaveProperty('query');
    expect(r).toHaveProperty('query_builder');
    expect(r).toHaveProperty('plan');
  });
});
