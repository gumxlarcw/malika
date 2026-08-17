'use strict';

jest.mock('../config/db_bps', () => {
  const queryMock = jest.fn();
  return jest.fn(() => ({ query: queryMock, _queryMock: queryMock }));
});

const { QueryTypes } = require('sequelize');
const getSequelizeBps = require('../config/db_bps');
const cache = require('../services/petaTematik/cache.service');
const wm = require('../services/indicator/watermark.service');
const svc = require('../services/petaTematik/petaTematik.service');

/**
 * peta-tematik used a blind one-hour TTL with no invalidation, so after an
 * automation run the map could serve figures up to an hour behind the database.
 * Its cache keys now carry the indicator's watermark, which is what these tests
 * pin down.
 */
describe('petaTematik freshness', () => {
  beforeEach(() => {
    cache.clear();
    wm.clearWatermarkMemo();
    getSequelizeBps()._queryMock.mockReset();
  });

  /** The watermark query uses QueryTypes.SELECT and returns a flat row array. */
  function mockWatermark(ms) {
    getSequelizeBps()._queryMock.mockResolvedValueOnce([{ lu: new Date(ms) }]);
  }

  test('recomputes after the watermark advances instead of serving the old value', async () => {
    const m = getSequelizeBps()._queryMock;

    mockWatermark(1000);
    m.mockResolvedValueOnce([[{ year: 2024, kabko_count: 3 }]]);
    m.mockResolvedValueOnce([[{ has_monthly: 0 }]]);

    const before = await svc.getYears(182);
    expect(before.years).toEqual([2024]);

    // Data refreshes: last_update advances and a new year exists.
    wm.clearWatermarkMemo();
    mockWatermark(2000);
    m.mockResolvedValueOnce([[{ year: 2024, kabko_count: 3 }, { year: 2025, kabko_count: 5 }]]);
    m.mockResolvedValueOnce([[{ has_monthly: 0 }]]);

    const after = await svc.getYears(182);
    expect(after.years).toEqual([2024, 2025]);
  });

  test('still serves from cache while the watermark is unchanged', async () => {
    const m = getSequelizeBps()._queryMock;

    mockWatermark(1000);
    m.mockResolvedValueOnce([[{ year: 2024, kabko_count: 3 }]]);
    m.mockResolvedValueOnce([[{ has_monthly: 0 }]]);

    await svc.getYears(182);
    const callsAfterFirst = m.mock.calls.length;
    await svc.getYears(182);

    // Second call: no watermark query (memoised) and no recompute.
    expect(m.mock.calls.length).toBe(callsAfterFirst);
  });
});
