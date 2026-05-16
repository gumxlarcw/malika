'use strict';

const path = require('path');

// Mock config BEFORE requiring openaiClient so the module picks up the mock.
jest.mock('../services/chat/streaming/config', () => ({
  OPENAI: {
    API_URL: 'http://127.0.0.1:3031/v1/chat/completions',
    API_KEY: 'test-key',
    TIMEOUT_MS: 30000,
    RETRIES: 2,
  },
}));

// Fresh circuit breaker per test file.
jest.mock('../utils/circuitBreaker', () => {
  let open = false;
  return {
    openAICircuit: {
      isOpen: () => open,
      onSuccess: () => { open = false; },
      onFailure: () => {},
      nextAttemptTime: 0,
      __setOpen: (v) => { open = v; },
    },
  };
});

jest.mock('../utils/metrics', () => ({
  metrics: { recordCircuitOpen: jest.fn(), recordOpenAICall: jest.fn() },
}));

jest.mock('../utils/tokenizer', () => ({
  countTokens: () => 0,
  countTextTokens: () => 0,
}));

const { chat } = require('../services/chat/streaming/openaiClient');

function mockFetchOnce(response) {
  global.fetch = jest.fn().mockResolvedValueOnce(response);
}

function buildResponse({ status = 200, body = '{}', headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
    body: { getReader: () => ({}) },
    headers: new Map(Object.entries(headers)),
  };
}

afterEach(() => { jest.clearAllMocks(); });

describe('chat()', () => {
  test('POSTs to OPENAI.API_URL with model + messages in body', async () => {
    mockFetchOnce(buildResponse({ status: 200, body: '{"ok":true}' }));
    await chat({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3031/v1/chat/completions');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.stream).toBe(false);
  });

  test('stream:true is forwarded to request body', async () => {
    mockFetchOnce(buildResponse({ status: 200 }));
    await chat({ model: 'claude-sonnet-4-6', messages: [], stream: true });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
  });

  test('temperature, max_tokens, tools are forwarded when set', async () => {
    mockFetchOnce(buildResponse({ status: 200 }));
    await chat({
      model: 'm', messages: [], temperature: 0.2, max_tokens: 123,
      tools: [{ type: 'function', function: { name: 'f' } }],
    });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(123);
    expect(body.tools).toHaveLength(1);
  });

  test('optional fields not set are omitted from body', async () => {
    mockFetchOnce(buildResponse({ status: 200 }));
    await chat({ model: 'm', messages: [] });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('max_tokens');
    expect(body).not.toHaveProperty('tools');
  });

  test('authorization header uses OPENAI.API_KEY by default', async () => {
    mockFetchOnce(buildResponse({ status: 200 }));
    await chat({ model: 'm', messages: [] });
    const { headers } = global.fetch.mock.calls[0][1];
    expect(headers['Authorization']).toBe('Bearer test-key');
    expect(headers['Content-Type']).toBe('application/json');
  });

  test('apiKey override wins over config key', async () => {
    mockFetchOnce(buildResponse({ status: 200 }));
    await chat({ model: 'm', messages: [], apiKey: 'other-key' });
    expect(global.fetch.mock.calls[0][1].headers['Authorization']).toBe('Bearer other-key');
  });

  test('extraHeaders merge into request headers', async () => {
    mockFetchOnce(buildResponse({ status: 200 }));
    await chat({ model: 'm', messages: [], extraHeaders: { 'X-Trace-Id': 'abc' } });
    expect(global.fetch.mock.calls[0][1].headers['X-Trace-Id']).toBe('abc');
  });

  test('signal is forwarded to fetch', async () => {
    mockFetchOnce(buildResponse({ status: 200 }));
    const controller = new AbortController();
    await chat({ model: 'm', messages: [], signal: controller.signal });
    expect(global.fetch.mock.calls[0][1].signal).toBe(controller.signal);
  });

  test('throws with code=HTTP_400 on 400 and does NOT retry', async () => {
    global.fetch = jest.fn().mockResolvedValue(buildResponse({
      status: 400, body: '{"error":{"message":"bad model"}}',
    }));
    await expect(chat({ model: 'bad', messages: [] })).rejects.toMatchObject({
      code: 'HTTP_400', status: 400,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('retries on 503 up to configured retries (3 calls total = 1 + 2 retries)', async () => {
    global.fetch = jest.fn().mockResolvedValue(buildResponse({ status: 503, body: '{}' }));
    await expect(chat({ model: 'm', messages: [], retries: 2, timeoutMs: 1000 }))
      .rejects.toMatchObject({ code: 'HTTP_503', status: 503 });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  }, 15000);

  test('missing model throws synchronous error', async () => {
    await expect(chat({ messages: [] })).rejects.toThrow(/model.*required/i);
  });

  test('non-array messages throws', async () => {
    await expect(chat({ model: 'm', messages: 'hi' })).rejects.toThrow(/messages.*array/i);
  });
});
