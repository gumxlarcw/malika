const { Op } = require('sequelize');

jest.mock('../models/DataSource.model', () => ({
  findAll: jest.fn(),
}));

jest.mock('../models/DataPeriod.model', () => ({
  findAll: jest.fn(),
}));

jest.mock('../models/DataSourceSearchTerm.model', () => ({
  findAll: jest.fn(),
}));

jest.mock('../services/ai/abbrevExpansion.service', () => ({
  expandIndicatorAbbreviations: jest.fn(async () => ({ terms: [] })),
}));

jest.mock('../services/search/searchTermIndex.service', () => ({
  extractQueryTokensForTermIndex: jest.fn(() => ['inflasi']),
}));

const DataSource = require('../models/DataSource.model');
const DataSourceSearchTerm = require('../models/DataSourceSearchTerm.model');

describe('datasourceSearch.service ignore IDs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('excludes IDs 166-169 in datasource candidate query', async () => {
    DataSource.findAll.mockResolvedValueOnce([]);

    const { searchDatasources } = require('../services/search/datasourceSearch.service');
    await searchDatasources({ q: 'inflasi', limit: 10 });

    expect(DataSource.findAll).toHaveBeenCalled();
    const call = DataSource.findAll.mock.calls[0][0];
    expect(call.where).toBeTruthy();
    expect(call.where.id).toBeTruthy();
    expect(call.where.id[Op.notIn]).toEqual([166, 167, 168, 169]);
  });

  test('keeps ignore filter even when querying by id list', async () => {
    // 1) initial candidates empty
    DataSource.findAll.mockResolvedValueOnce([]);

    // 2) term index returns some hits (including an ignored id)
    DataSourceSearchTerm.findAll.mockImplementation(async ({ where }) => {
      // Aggregate query uses term_norm IN [...]
      if (where && typeof where.term_norm === 'object') {
        return [
          { source_id: 166, get: () => '5' },
          { source_id: 10, get: () => '4' },
        ];
      }
      // Phrase query (term_norm === qNorm) doesn't matter here.
      return [];
    });

    // 3) extra candidates fetch by id IN [...]
    DataSource.findAll.mockResolvedValueOnce([]);

    const { searchDatasources } = require('../services/search/datasourceSearch.service');
    await searchDatasources({ q: 'inflasi', limit: 10 });

    // Term index query should exclude ignored ids at query-level
    const termCalls = DataSourceSearchTerm.findAll.mock.calls;
    expect(termCalls.length).toBeGreaterThan(0);
    const termWhere = termCalls[0][0].where;
    expect(termWhere.source_id).toBeTruthy();
    expect(termWhere.source_id[Op.notIn]).toEqual([166, 167, 168, 169]);

    // Second DataSource.findAll call is the extra candidate fetch (id IN [...])
    const dsCalls = DataSource.findAll.mock.calls;
    expect(dsCalls.length).toBeGreaterThanOrEqual(2);
    const extraCall = dsCalls[1][0];

    expect(extraCall.where.id).toBeTruthy();
    expect(extraCall.where[Op.and]).toBeTruthy();
    expect(extraCall.where[Op.and]).toEqual(
      expect.arrayContaining([{ id: { [Op.notIn]: [166, 167, 168, 169] } }])
    );
  });
});
