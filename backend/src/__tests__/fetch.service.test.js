const fetchService = require('../services/datasource/fetch.service');

describe('fetch.service', () => {
  test('exports fetchAPI', () => {
    expect(typeof fetchService.fetchAPI).toBe('function');
  });
});
