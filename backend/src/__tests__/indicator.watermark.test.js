'use strict';

jest.mock('../config/db_bps', () => {
  const queryMock = jest.fn();
  return jest.fn(() => ({ query: queryMock, _queryMock: queryMock }));
});

const getSequelizeBps = require('../config/db_bps');
const wm = require('../services/indicator/watermark.service');

describe('indicator/watermark.service', () => {
  beforeEach(() => {
    wm.clearWatermarkMemo();
    getSequelizeBps()._queryMock.mockReset();
  });

  test('validateIndicatorId rejects anything that is not a positive integer', () => {
    expect(() => wm.validateIndicatorId('abc')).toThrow('Invalid indikator');
    expect(() => wm.validateIndicatorId(0)).toThrow('Invalid indikator');
    expect(() => wm.validateIndicatorId(-5)).toThrow('Invalid indikator');
    expect(() => wm.validateIndicatorId(1.5)).toThrow('Invalid indikator');
    expect(() => wm.validateIndicatorId(100000)).toThrow('Invalid indikator');
    expect(wm.validateIndicatorId('182')).toBe(182);
  });

  test('returns MAX(last_update) as epoch ms', async () => {
    const when = new Date('2026-06-30T09:00:00Z');
    getSequelizeBps()._queryMock.mockResolvedValueOnce([{ lu: when }]);

    await expect(wm.getWatermark(182)).resolves.toBe(when.getTime());
  });

  test('returns 0 when the table has no rows', async () => {
    getSequelizeBps()._queryMock.mockResolvedValueOnce([{ lu: null }]);
    await expect(wm.getWatermark(182)).resolves.toBe(0);
  });

  test('returns 0 instead of throwing when the query fails', async () => {
    getSequelizeBps()._queryMock.mockRejectedValueOnce(new Error('no such table'));
    await expect(wm.getWatermark(999)).resolves.toBe(0);
  });

  test('memoises so a page of cards does not issue one query per card', async () => {
    const m = getSequelizeBps()._queryMock;
    m.mockResolvedValueOnce([{ lu: new Date('2026-06-30T09:00:00Z') }]);

    await wm.getWatermark(182);
    await wm.getWatermark(182);
    await wm.getWatermark(182);

    expect(m).toHaveBeenCalledTimes(1);
  });

  test('memo is per-indicator, not global', async () => {
    const m = getSequelizeBps()._queryMock;
    m.mockResolvedValueOnce([{ lu: new Date('2026-01-01T00:00:00Z') }]);
    m.mockResolvedValueOnce([{ lu: new Date('2026-02-02T00:00:00Z') }]);

    const a = await wm.getWatermark(182);
    const b = await wm.getWatermark(183);

    expect(a).not.toBe(b);
    expect(m).toHaveBeenCalledTimes(2);
  });
});
