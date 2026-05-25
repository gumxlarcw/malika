jest.mock('axios', () => ({ get: jest.fn() }));
const axios = require('axios');

const mockFetchLog = { create: jest.fn().mockResolvedValue(true) };
jest.mock('../models/FetchLog.model', () => mockFetchLog);

const {
  fetchAPI,
  isRetryable,
  computeBackoffMs,
} = require('../services/datasource/fetch.service');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('fetch.service retry logic', () => {
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
      .mockResolvedValueOnce({ status: 200, headers: {}, data: { ok: true } });

    const data = await fetchAPI('http://example.com');
    expect(data).toEqual({ ok: true });
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  test('fails fast on 4xx without retrying', async () => {
    const err = Object.assign(new Error('forbidden'), {
      response: { status: 403 },
    });
    axios.get.mockRejectedValue(err);

    await expect(fetchAPI('http://example.com')).rejects.toBe(err);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  test('retries on 503 then succeeds', async () => {
    const err503 = Object.assign(new Error('upstream'), {
      response: { status: 503 },
    });
    axios.get
      .mockRejectedValueOnce(err503)
      .mockResolvedValueOnce({ status: 200, headers: {}, data: { ok: true } });

    await expect(fetchAPI('http://example.com')).resolves.toEqual({ ok: true });
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  test('retries on 429 then exhausts', async () => {
    const err429 = Object.assign(new Error('rate limited'), {
      response: { status: 429 },
    });
    axios.get.mockRejectedValue(err429);

    await expect(fetchAPI('http://example.com')).rejects.toBe(err429);
    expect(axios.get).toHaveBeenCalledTimes(4);
  });

  test('does NOT retry on WAF HTML response (string body)', async () => {
    axios.get.mockResolvedValue({
      status: 200,
      headers: {},
      data: '<html><body>Challenge</body></html>',
    });

    await expect(fetchAPI('http://example.com')).rejects.toThrow(/HTML received/);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  test('detects WAF HTML via content-type even if body is object-coerced', async () => {
    axios.get.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      data: { masquerading: true },
    });

    await expect(fetchAPI('http://example.com')).rejects.toThrow(/HTML received/);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  test('HTML guard tolerates leading whitespace', async () => {
    axios.get.mockResolvedValue({
      status: 200,
      headers: {},
      data: '\n  <!DOCTYPE html>',
    });

    await expect(fetchAPI('http://example.com')).rejects.toThrow(/HTML received/);
  });

  test('final FetchLog summary captures all attempts', async () => {
    const e1 = Object.assign(new Error('boom1'), { code: 'ECONNRESET' });
    const e2 = Object.assign(new Error('boom2'), { response: { status: 503 } });
    axios.get
      .mockRejectedValueOnce(e1)
      .mockRejectedValueOnce(e2)
      .mockRejectedValueOnce(e1)
      .mockRejectedValueOnce(e2);

    await expect(fetchAPI('http://example.com', 7)).rejects.toBeTruthy();

    expect(mockFetchLog.create).toHaveBeenCalledTimes(1);
    const call = mockFetchLog.create.mock.calls[0][0];
    expect(call.source_id).toBe(7);
    expect(call.message).toMatch(/\[1\].*ECONNRESET/);
    expect(call.message).toMatch(/\[2\].*503/);
    expect(call.message).toMatch(/\[4\]/);
  });

  test('success path writes single OK FetchLog', async () => {
    axios.get.mockResolvedValue({ status: 200, headers: {}, data: { ok: 1 } });

    await fetchAPI('http://example.com', 42);

    expect(mockFetchLog.create).toHaveBeenCalledTimes(1);
    expect(mockFetchLog.create.mock.calls[0][0]).toMatchObject({
      source_id: 42,
      status_code: 200,
      message: 'OK',
    });
  });
});

describe('isRetryable', () => {
  test('5xx → true', () => {
    expect(isRetryable({ response: { status: 500 } })).toBe(true);
    expect(isRetryable({ response: { status: 502 } })).toBe(true);
    expect(isRetryable({ response: { status: 504 } })).toBe(true);
  });

  test('408 + 429 → true', () => {
    expect(isRetryable({ response: { status: 408 } })).toBe(true);
    expect(isRetryable({ response: { status: 429 } })).toBe(true);
  });

  test('4xx (non-408/429) → false', () => {
    expect(isRetryable({ response: { status: 400 } })).toBe(false);
    expect(isRetryable({ response: { status: 401 } })).toBe(false);
    expect(isRetryable({ response: { status: 403 } })).toBe(false);
    expect(isRetryable({ response: { status: 404 } })).toBe(false);
    expect(isRetryable({ response: { status: 422 } })).toBe(false);
  });

  test('network codes → true', () => {
    expect(isRetryable({ code: 'ECONNRESET' })).toBe(true);
    expect(isRetryable({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isRetryable({ code: 'ENOTFOUND' })).toBe(true);
  });

  test('WAF HTML signal → false', () => {
    expect(isRetryable({ code: 'WAF_HTML_RESPONSE' })).toBe(false);
  });

  test('plain Error (no status, no code) → true (assume transient)', () => {
    expect(isRetryable(new Error('mystery'))).toBe(true);
  });
});

describe('computeBackoffMs', () => {
  test('grows exponentially with attempt (within jitter band)', () => {
    for (let i = 0; i < 50; i++) {
      const d1 = computeBackoffMs(1);
      const d2 = computeBackoffMs(2);
      const d3 = computeBackoffMs(3);
      expect(d1).toBeGreaterThanOrEqual(800);
      expect(d1).toBeLessThanOrEqual(1200);
      expect(d2).toBeGreaterThanOrEqual(1600);
      expect(d2).toBeLessThanOrEqual(2400);
      expect(d3).toBeGreaterThanOrEqual(3200);
      expect(d3).toBeLessThanOrEqual(4800);
    }
  });

  test('never returns negative', () => {
    for (let i = 0; i < 100; i++) {
      expect(computeBackoffMs(1)).toBeGreaterThanOrEqual(0);
    }
  });
});
