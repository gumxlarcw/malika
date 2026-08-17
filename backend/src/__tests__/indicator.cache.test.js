'use strict';

const cache = require('../services/indicator/cache');

describe('indicator/cache', () => {
  beforeEach(() => cache.clear());

  test('key includes the watermark so refreshed data cannot collide', () => {
    const a = cache.buildKey('latest', 182, 1000, 'metricA');
    const b = cache.buildKey('latest', 182, 2000, 'metricA');
    expect(a).not.toBe(b);
  });

  test('key is stable for the same inputs', () => {
    expect(cache.buildKey('latest', 182, 1000, 'm')).toBe(cache.buildKey('latest', 182, 1000, 'm'));
  });

  test('computes once and serves the cached value after', async () => {
    const compute = jest.fn().mockResolvedValue({ value: 5 });

    const first = await cache.getOrCompute('latest', 182, 1000, ['m'], compute);
    const second = await cache.getOrCompute('latest', 182, 1000, ['m'], compute);

    expect(first).toEqual({ value: 5 });
    expect(second).toEqual({ value: 5 });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  // This is the freshness guarantee of the whole design, asserted rather than assumed.
  test('a new watermark recomputes instead of serving the old value', async () => {
    const compute = jest.fn()
      .mockResolvedValueOnce({ value: 'old' })
      .mockResolvedValueOnce({ value: 'new' });

    const before = await cache.getOrCompute('latest', 182, 1000, ['m'], compute);
    const after = await cache.getOrCompute('latest', 182, 2000, ['m'], compute);

    expect(before).toEqual({ value: 'old' });
    expect(after).toEqual({ value: 'new' });
    expect(compute).toHaveBeenCalledTimes(2);
  });

  test('caches null results so an empty indicator is not recomputed every request', async () => {
    const compute = jest.fn().mockResolvedValue(null);

    await cache.getOrCompute('latest', 182, 1000, ['m'], compute);
    await cache.getOrCompute('latest', 182, 1000, ['m'], compute);

    expect(compute).toHaveBeenCalledTimes(1);
  });

  test('does not cache a rejection', async () => {
    const compute = jest.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ value: 1 });

    await expect(cache.getOrCompute('latest', 182, 1000, ['m'], compute)).rejects.toThrow('boom');
    await expect(cache.getOrCompute('latest', 182, 1000, ['m'], compute)).resolves.toEqual({ value: 1 });
  });
});
