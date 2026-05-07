const { countTokens, fetchOpenAIWithRetry } = require('../services/chat/streaming/openaiClient');

jest.mock('../utils/circuitBreaker', () => ({
  openAICircuit: {
    isOpen: jest.fn(),
    onSuccess: jest.fn(),
    onFailure: jest.fn(),
    nextAttemptTime: Date.now() + 1000,
  },
}));

jest.mock('../utils/metrics', () => ({
  metrics: {
    recordOpenAICall: jest.fn(),
    recordCircuitOpen: jest.fn(),
  },
}));

const { openAICircuit } = require('../utils/circuitBreaker');
const { metrics } = require('../utils/metrics');

describe('openaiClient', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    openAICircuit.isOpen.mockReturnValue(false);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('counts tokens from strings and messages', () => {
    expect(countTokens('abcd')).toBe(1);
    expect(countTokens([{ content: 'hello world' }])).toBeGreaterThan(0);
  });

  it('throws when circuit is open', async () => {
    openAICircuit.isOpen.mockReturnValue(true);

    await expect(fetchOpenAIWithRetry({ body: '{}' }, 0, 10))
      .rejects
      .toMatchObject({ code: 'CIRCUIT_OPEN' });

    expect(metrics.recordCircuitOpen).toHaveBeenCalled();
  });

  it('returns response and records success', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(''),
    });

    const resp = await fetchOpenAIWithRetry({ body: JSON.stringify({ input: 'hello' }) }, 0, 10);

    expect(resp.ok).toBe(true);
    expect(openAICircuit.onSuccess).toHaveBeenCalled();
    expect(metrics.recordOpenAICall).toHaveBeenCalled();
  });
});
