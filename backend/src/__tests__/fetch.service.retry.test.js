jest.mock('axios', () => ({ get: jest.fn() }));
const axios = require('axios');

// Mock FetchLog model to avoid real DB
jest.mock('../models/FetchLog.model', () => ({
  create: jest.fn().mockResolvedValue(true),
}));

const { fetchAPI } = require('../services/datasource/fetch.service');

describe('fetch.service retry logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('retries up to 3 times and then throws', async () => {
    axios.get.mockRejectedValueOnce(new Error('fail 1'))
             .mockRejectedValueOnce(new Error('fail 2'))
             .mockRejectedValueOnce(new Error('fail 3'))
             .mockRejectedValue(new Error('final fail'));

    await expect(fetchAPI('http://example.com')).rejects.toBeTruthy();
    expect(axios.get).toHaveBeenCalledTimes(4);
  });

  test('succeeds after retries', async () => {
    axios.get
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockResolvedValueOnce({ status: 200, data: { ok: true } });

    const data = await fetchAPI('http://example.com');
    expect(data).toEqual({ ok: true });
    expect(axios.get).toHaveBeenCalledTimes(2);
  });
});
