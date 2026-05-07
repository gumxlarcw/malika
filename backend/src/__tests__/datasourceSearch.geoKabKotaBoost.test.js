const DataSource = require('../models/DataSource.model');
const DataPeriod = require('../models/DataPeriod.model');
const DataSourceSearchTerm = require('../models/DataSourceSearchTerm.model');

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
  extractQueryTokensForTermIndex: jest.fn(() => []),
}));

describe('datasourceSearch.service kab/kota geo boost', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('when query mentions a kab/kota name, prefer Kabupaten/Kota breakdown datasource (non-EXIM)', async () => {
    DataSource.findAll.mockResolvedValueOnce([
      {
        id: 10,
        name: 'Persentase Penduduk Miskin Provinsi Maluku Utara',
        type: 'dynamic',
        category: 'Kemiskinan',
        description: '',
        aliases: '',
        api_url: 'bps://dummy',
        display_order: 0,
      },
      {
        id: 11,
        name: 'Persentase Penduduk Miskin Provinsi Maluku Utara Menurut Kabupaten/Kota',
        type: 'dynamic',
        category: 'Kemiskinan',
        description: '',
        aliases: '',
        api_url: 'bps://dummy',
        display_order: 0,
      },
    ]);

    // Keep period map neutral so ranking relies on text signals.
    DataPeriod.findAll.mockResolvedValueOnce([]);
    DataSourceSearchTerm.findAll.mockResolvedValue([]);

    const { searchDatasources } = require('../services/search/datasourceSearch.service');
    const items = await searchDatasources({ q: 'kemiskinan ternate 2024', limit: 10 });

    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0].id).toBe(11);
  });

  test('when query explicitly contains kabupaten/kota keywords, prefer Kabupaten/Kota breakdown datasource (non-EXIM)', async () => {
    DataSource.findAll.mockResolvedValueOnce([
      {
        id: 20,
        name: 'Tingkat Pengangguran Terbuka Provinsi Maluku Utara',
        type: 'dynamic',
        category: 'Ketenagakerjaan',
        description: '',
        aliases: '',
        api_url: 'bps://dummy',
        display_order: 0,
      },
      {
        id: 21,
        name: 'Tingkat Pengangguran Terbuka Menurut Kabupaten/Kota',
        type: 'dynamic',
        category: 'Ketenagakerjaan',
        description: '',
        aliases: '',
        api_url: 'bps://dummy',
        display_order: 0,
      },
    ]);

    DataPeriod.findAll.mockResolvedValueOnce([]);
    DataSourceSearchTerm.findAll.mockResolvedValue([]);

    const { searchDatasources } = require('../services/search/datasourceSearch.service');
    const items = await searchDatasources({ q: 'pengangguran kabupaten kota 2024', limit: 10 });

    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0].id).toBe(21);
  });
});
