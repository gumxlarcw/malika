const cacheService = require('../services/cache/cache.service');

describe('cache.service', () => {
  test('has expected API', () => {
    expect(typeof cacheService.getCache).toBe('function');
    expect(typeof cacheService.saveCache).toBe('function');
  });
});

