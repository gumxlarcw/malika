jest.mock('axios');
jest.mock('../models/WebapiHealthLog.model', () => ({
  create: jest.fn().mockResolvedValue({}),
}));
jest.mock('../services/pressrelease/apiKey.service', () => ({
  resolveBpsApiKey: jest.fn().mockResolvedValue('TEST_KEY'),
}));

const axios = require('axios');
const WebapiHealthLog = require('../models/WebapiHealthLog.model');
const { runProbe, _classifyResponse } = require('../services/webapiBpsHealth/probe.service');

describe('webapiBpsHealth probe — classification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('2xx + JSON valid → ok=1', () => {
    const r = _classifyResponse({ status: 200, data: { domain: [] } });
    expect(r.ok).toBe(1);
    expect(r.errorCode).toBeNull();
  });

  test('response starts with "<" → HTML_RESPONSE (WAF block)', () => {
    const r = _classifyResponse({ status: 200, data: '<!DOCTYPE html>...' });
    expect(r.ok).toBe(0);
    expect(r.errorCode).toBe('HTML_RESPONSE');
  });

  test('401 → AUTH_INVALID', () => {
    const r = _classifyResponse({ status: 401, data: '' });
    expect(r.ok).toBe(0);
    expect(r.errorCode).toBe('AUTH_INVALID');
  });

  test('429 → RATE_LIMITED', () => {
    const r = _classifyResponse({ status: 429, data: '' });
    expect(r.ok).toBe(0);
    expect(r.errorCode).toBe('RATE_LIMITED');
  });

  test('503 → HTTP_5XX', () => {
    const r = _classifyResponse({ status: 503, data: '' });
    expect(r.ok).toBe(0);
    expect(r.errorCode).toBe('HTTP_5XX');
  });

  test('runProbe writes 4 rows + computes overall=UP when all ok', async () => {
    axios.get.mockResolvedValue({ status: 200, data: { domain: [{}] } });
    const result = await runProbe({ trigger: 'manual' });
    expect(result.overall).toBe('UP');
    expect(result.perFamily).toHaveLength(4);
    expect(WebapiHealthLog.create).toHaveBeenCalledTimes(4);
    // Validate DB payload shape (guards against typos in column names)
    expect(WebapiHealthLog.create).toHaveBeenCalledWith(expect.objectContaining({
      run_id: expect.any(String),
      probe_kind: 'manual',
      endpoint_family: expect.any(String),
      url_template: expect.any(String),
      ok: 1,
      error_code: null,
    }));
  });

  test('runProbe with mixed results → DEGRADED', async () => {
    axios.get
      .mockResolvedValueOnce({ status: 200, data: { domain: [] } })
      .mockResolvedValueOnce({ status: 200, data: { variabel: [] } })
      .mockResolvedValueOnce({ status: 503, data: '' })
      .mockResolvedValueOnce({ status: 200, data: { pressrelease: [] } });
    const result = await runProbe({ trigger: 'manual' });
    expect(result.overall).toBe('DEGRADED');
  });

  test('runProbe with all failures → DOWN', async () => {
    axios.get.mockResolvedValue({ status: 503, data: '' });
    const result = await runProbe({ trigger: 'manual' });
    expect(result.overall).toBe('DOWN');
  });

  test('runProbe with network exception → ok=0 error_code=NETWORK', async () => {
    const err = new Error('ENOTFOUND');
    err.code = 'ENOTFOUND';
    axios.get.mockRejectedValue(err);
    const result = await runProbe({ trigger: 'manual' });
    expect(result.overall).toBe('DOWN');
    expect(result.perFamily.every(f => f.ok === 0)).toBe(true);
  });

  test('runProbe with ECONNABORTED → TIMEOUT', async () => {
    const err = new Error('timeout of 8000ms exceeded');
    err.code = 'ECONNABORTED';
    axios.get.mockRejectedValue(err);
    const result = await runProbe({ trigger: 'manual' });
    expect(result.perFamily[0].errorCode).toBe('TIMEOUT');
  });
});
