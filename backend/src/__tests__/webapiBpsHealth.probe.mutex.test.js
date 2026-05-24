jest.mock('axios');
jest.mock('../models/WebapiHealthLog.model', () => ({
  create: jest.fn().mockResolvedValue({}),
}));
jest.mock('../services/pressrelease/apiKey.service', () => ({
  resolveBpsApiKey: jest.fn().mockResolvedValue('TEST_KEY'),
}));

const axios = require('axios');
const { runProbe } = require('../services/webapiBpsHealth/probe.service');

describe('webapiBpsHealth probe — mutex', () => {
  test('concurrent runProbe: 2nd call returns skipped', async () => {
    // axios.get takes 100ms — long enough that 2nd runProbe finds mutex set
    axios.get.mockImplementation(() => new Promise(resolve => {
      setTimeout(() => resolve({ status: 200, data: { ok: true } }), 100);
    }));

    const [first, second] = await Promise.all([
      runProbe({ trigger: 'manual' }),
      runProbe({ trigger: 'manual' }),
    ]);

    // Exactly one of them is the real result, the other is skipped
    const skipped = [first, second].find(r => r.skipped);
    const real = [first, second].find(r => !r.skipped);

    expect(skipped).toBeDefined();
    expect(skipped.reason).toBe('probe_already_running');
    expect(real).toBeDefined();
    expect(real.overall).toBe('UP');
  });
});
