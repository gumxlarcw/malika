jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

jest.mock('../../models/FetchLog.model', () => ({
  create: jest.fn(),
}));

jest.mock('../../utils/circuitBreaker', () => ({
  openAICircuit: {
    isOpen: jest.fn(() => false),
    onSuccess: jest.fn(),
    onFailure: jest.fn(),
    nextAttemptTime: Date.now() + 1000,
  },
}));

jest.mock('../../utils/metrics', () => ({
  metrics: {
    recordOpenAICall: jest.fn(),
    recordCircuitOpen: jest.fn(),
  },
}));

const axios = require('axios');
const FetchLog = require('../../models/FetchLog.model');
const { fetchAPI } = require('../../services/datasource/fetch.service');
const { chatCompletion } = require('../../services/ai/client/openaiClient');

process.env.OPENAI_API_KEY_QUERY_BUILDER = 'test';

describe('integration: external API mocks', () => {
  let origSetTimeout;

  beforeEach(() => {
    jest.clearAllMocks();
    // Replace setTimeout with immediate callback to skip retry delays
    origSetTimeout = global.setTimeout;
    global.setTimeout = (fn) => origSetTimeout(fn, 0);
  });

  afterEach(() => {
    global.setTimeout = origSetTimeout;
  });

  it('retries BPS fetch and succeeds', async () => {
    axios.get
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValueOnce({ status: 200, data: { ok: true } });

    const result = await fetchAPI('https://example.com', 1, 2);

    expect(result).toEqual({ ok: true });
    expect(axios.get).toHaveBeenCalledTimes(3);
    expect(FetchLog.create).toHaveBeenCalled();
  });

  it('retries OpenAI calls on failure', async () => {
    axios.post
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ status: 200, data: { ok: true } });

    const result = await chatCompletion({
      apiKeyEnv: 'OPENAI_API_KEY_QUERY_BUILDER',
      payload: { model: 'gpt-4.1', messages: [] },
      retries: 1,
      timeoutMs: 10,
    });

    expect(result).toEqual({ ok: true });
    expect(axios.post).toHaveBeenCalledTimes(2);
  });
});
