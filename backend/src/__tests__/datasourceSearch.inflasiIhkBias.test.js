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

describe('datasourceSearch.service inflasi vs ihk bias', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('geo shorthand: "halteng" should rank Kab. Halmahera Tengah inflasi above province', async () => {
    DataSource.findAll.mockResolvedValueOnce([
      {
        id: 1,
        name: 'Inflasi Provinsi Maluku Utara (2022 = 100)',
        type: 'dynamic',
        category: 'Inflasi',
        description: '',
        aliases: '',
        api_url: 'bps://dummy',
        display_order: 0,
      },
      {
        id: 163,
        name: 'Inflasi Kabupaten Halmahera Tengah (2022 = 100)',
        type: 'dynamic',
        category: 'Harga-Harga',
        description: '',
        aliases: '',
        api_url: 'bps://dummy',
        display_order: 0,
      },
    ]);

    // Simulate period map hit only for the province to reproduce the original bias.
    DataPeriod.findAll.mockResolvedValueOnce([{ source_id: 1 }]);
    DataSourceSearchTerm.findAll.mockResolvedValue([]);

    const { searchDatasources } = require('../services/search/datasourceSearch.service');
    const items = await searchDatasources({ q: 'inflasi halteng maret 2024 - mei 2025', limit: 10 });

    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0].id).toBe(163);
  });

  test('geo shorthand: "kepsul" should not make datasource candidates empty', async () => {
    DataSource.findAll.mockResolvedValueOnce([
      {
        id: 99,
        name: 'Persentase Penduduk Miskin Provinsi Maluku Utara',
        type: 'dynamic',
        category: 'Kemiskinan',
        description: '',
        aliases: '',
        api_url: 'bps://dummy',
        display_order: 0,
      },
    ]);

    DataPeriod.findAll.mockResolvedValueOnce([]);
    DataSourceSearchTerm.findAll.mockResolvedValue([]);

    const { searchDatasources } = require('../services/search/datasourceSearch.service');
    const items = await searchDatasources({ q: 'kemiskinan kepsul 2024', limit: 10 });

    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].id).toBe(99);
  });

  test('when query explicitly contains inflasi, Inflasi datasource outranks IHK even if IHK has periodHit', async () => {
    DataSource.findAll.mockResolvedValueOnce([
      {
        id: 2,
        name: 'Indeks Harga Konsumen Kabupaten Halmahera Tengah (2022 = 100)',
        type: 'dynamic',
        category: 'Inflasi',
        description: '',
        aliases: '',
        api_url: 'bps://dummy',
        display_order: 0,
      },
      {
        id: 163,
        name: 'Inflasi Kabupaten Halmahera Tengah (2022 = 100)',
        type: 'dynamic',
        category: 'Harga-Harga',
        description: '',
        aliases: '',
        api_url: 'bps://dummy',
        display_order: 0,
      },
    ]);

    // Simulate period map hit only for IHK.
    DataPeriod.findAll.mockResolvedValueOnce([{ source_id: 2 }]);

    // Term index not used (mock returns empty tokens), but keep safe.
    DataSourceSearchTerm.findAll.mockResolvedValue([]);

    const { searchDatasources } = require('../services/search/datasourceSearch.service');
    const items = await searchDatasources({ q: 'inflasi mei 2025 halmahera tengah', limit: 10 });

    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0].id).toBe(163);
    expect(items[1].id).toBe(2);
  });

  test('when query explicitly contains ihk, IHK datasource outranks Inflasi', async () => {
    DataSource.findAll.mockResolvedValueOnce([
      {
        id: 2,
        name: 'Indeks Harga Konsumen Kabupaten Halmahera Tengah (2022 = 100)',
        type: 'dynamic',
        category: 'Inflasi',
        description: '',
        aliases: '',
        api_url: 'bps://dummy',
        display_order: 0,
      },
      {
        id: 163,
        name: 'Inflasi Kabupaten Halmahera Tengah (2022 = 100)',
        type: 'dynamic',
        category: 'Harga-Harga',
        description: '',
        aliases: '',
        api_url: 'bps://dummy',
        display_order: 0,
      },
    ]);

    DataPeriod.findAll.mockResolvedValueOnce([{ source_id: 2 }]);
    DataSourceSearchTerm.findAll.mockResolvedValue([]);

    const { searchDatasources } = require('../services/search/datasourceSearch.service');
    const items = await searchDatasources({ q: 'ihk mei 2025 halmahera tengah', limit: 10 });

    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0].id).toBe(2);
  });
});
