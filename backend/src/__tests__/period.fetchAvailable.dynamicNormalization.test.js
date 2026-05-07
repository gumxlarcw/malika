jest.mock('../services/datasource/fetch.service', () => ({
  fetchAPI: jest.fn(),
}));

jest.mock('../models/DataSource.model', () => ({
  findByPk: jest.fn(),
}));

jest.mock('../models/DataPeriod.model', () => ({
  findAll: jest.fn(),
}));

const DataSource = require('../models/DataSource.model');
const DataPeriod = require('../models/DataPeriod.model');

const { fetchAvailablePeriodsForSource } = require('../services/period/fetchAvailable.service');

describe('fetchAvailablePeriodsForSource (dynamic period map normalization)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('maps 3-digit period_value to { th_id: YYY, year: 19YY }', async () => {
    DataSource.findByPk.mockResolvedValue({
      id: 1,
      type: 'dynamic',
      api_url: 'http://example.com',
      metadata: { domain: '8200', var: '378', key: 'dummy' },
    });

    DataPeriod.findAll.mockResolvedValue([
      { period_value: '125' },
      { period_value: '124' },
    ]);

    await expect(fetchAvailablePeriodsForSource(1)).resolves.toEqual([
      { th_id: '125', year: '2025' },
      { th_id: '124', year: '2024' },
    ]);
  });

  test('maps 4-digit period_value to { th_id: YYY, year: YYYY } (legacy dynamic maps)', async () => {
    DataSource.findByPk.mockResolvedValue({
      id: 1,
      type: 'dynamic',
      api_url: 'http://example.com',
      metadata: { domain: '8200', var: '378', key: 'dummy' },
    });

    DataPeriod.findAll.mockResolvedValue([
      { period_value: '2025' },
      { period_value: '2024' },
    ]);

    await expect(fetchAvailablePeriodsForSource(1)).resolves.toEqual([
      { th_id: '125', year: '2025' },
      { th_id: '124', year: '2024' },
    ]);
  });
});
