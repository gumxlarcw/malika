jest.mock('axios');
jest.mock('../models/WebapiHealthLog.model', () => ({
  create: jest.fn().mockResolvedValue({}),
}));
jest.mock('../services/pressrelease/apiKey.service', () => ({
  resolveBpsApiKey: jest.fn().mockResolvedValue(null),
}));

const axios = require('axios');
const { runProbe } = require('../services/webapiBpsHealth/probe.service');

describe('webapiBpsHealth probe — apikey missing', () => {
  test('returns UNKNOWN without calling axios when api key absent', async () => {
    const result = await runProbe({ trigger: 'manual' });
    expect(result.overall).toBe('UNKNOWN');
    expect(result.error).toBe('API_KEY_MISSING');
    expect(result.perFamily).toEqual([]);
    expect(axios.get).not.toHaveBeenCalled();
  });
});
