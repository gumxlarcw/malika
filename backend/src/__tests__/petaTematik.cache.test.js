const cache = require('../services/petaTematik/cache.service');

describe('petaTematik.cache', () => {
  beforeEach(() => cache.clear());

  test('get returns undefined for missing key', () => {
    expect(cache.get('missing')).toBeUndefined();
  });

  test('set then get round-trip', () => {
    cache.set('a', { foo: 1 });
    expect(cache.get('a')).toEqual({ foo: 1 });
  });

  test('keys are isolated', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
  });

  test('getOrCompute uses cached value', async () => {
    cache.set('k', 'cached');
    const compute = jest.fn(async () => 'fresh');
    const v = await cache.getOrCompute('k', compute);
    expect(v).toBe('cached');
    expect(compute).not.toHaveBeenCalled();
  });

  test('getOrCompute computes and stores on miss', async () => {
    const compute = jest.fn(async () => 'computed');
    const v = await cache.getOrCompute('miss', compute);
    expect(v).toBe('computed');
    expect(cache.get('miss')).toBe('computed');
    expect(compute).toHaveBeenCalledTimes(1);
  });

  test('clear removes all entries', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });
});
