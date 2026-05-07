jest.mock('../services/datasource/fetch.service', () => ({
  fetchAPI: jest.fn(),
}));

jest.mock('../models/DataSource.model', () => ({
  findByPk: jest.fn(),
}));

jest.mock('../models/DataPeriod.model', () => ({
  upsert: jest.fn(),
}));

const { fetchAPI } = require('../services/datasource/fetch.service');
const DataSource = require('../models/DataSource.model');
const DataPeriod = require('../models/DataPeriod.model');

const { generatePeriodMap } = require('../services/period/generatePeriodMap.service');

describe('generatePeriodMap (interop auto-discover)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('discovers years from interop catalog and upserts period map rows', async () => {
    DataSource.findByPk.mockResolvedValue({
      id: 25,
      type: 'interop',
      api_url: 'https://webapi.bps.go.id/v1/api/interoperabilitas/datasource/simdasi/id/25/tahun/{period}/id_tabel/ZW16TjJSZkxtZG40ME1lTUJPRHVmdz09/wilayah/8200000/key/e5d1be11320576d466bdeb2f7f210387/',
    });

    fetchAPI.mockResolvedValue({
      status: 'OK',
      data: [
        { page: 1 },
        {
          status: 200,
          data: [
            { id_tabel: 'AAA', ketersediaan_tahun: [2020] },
            { id_tabel: 'ZW16TjJSZkxtZG40ME1lTUJPRHVmdz09', ketersediaan_tahun: [2018, 2020, 2021, 2022, 2024] },
          ],
        },
      ],
    });

    await expect(generatePeriodMap(25)).resolves.toBe(true);

    // called with candidate catalog URL (id/23...)
    expect(fetchAPI).toHaveBeenCalledTimes(1);
    expect(fetchAPI.mock.calls[0][0]).toContain('/v1/api/interoperabilitas/datasource/simdasi/id/23/wilayah/8200000/key/e5d1be11320576d466bdeb2f7f210387/');

    // upsert rows for each available year
    expect(DataPeriod.upsert).toHaveBeenCalledTimes(5);

    const upsertCalls = DataPeriod.upsert.mock.calls.map((c) => c[0]);
    const years = upsertCalls.map((r) => r.period_value).sort();
    expect(years).toEqual(['2018', '2020', '2021', '2022', '2024']);

    // api_url_override should substitute {period} with plain year
    const one = upsertCalls.find((r) => r.period_value === '2021');
    expect(one.api_url_override).toContain('/tahun/2021/');
  });

  test('requires start/end for non-interop sources', async () => {
    DataSource.findByPk.mockResolvedValue({
      id: 1,
      type: 'dynamic',
      api_url: 'http://example.com/{period}',
    });

    await expect(generatePeriodMap(1)).rejects.toMatchObject({ status: 400 });
    expect(DataPeriod.upsert).not.toHaveBeenCalled();
  });
});
