'use strict';

describe('requireProxyUrl', () => {
  let originalEnv;
  const HELPER_PATH = require.resolve('../requireProxyUrl');

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.OPENAI_API_URL;
    delete process.env.OPENAI_API_BASE_URL;
    delete require.cache[HELPER_PATH];
  });

  afterEach(() => {
    process.env = originalEnv;
    delete require.cache[HELPER_PATH];
  });

  test('returns the env value when set (default env var name)', () => {
    process.env.OPENAI_API_URL = 'http://127.0.0.1:3031/v1/chat/completions';
    const requireProxyUrl = require('../requireProxyUrl');
    expect(requireProxyUrl('test.module')).toBe('http://127.0.0.1:3031/v1/chat/completions');
  });

  test('returns the env value when set (custom env var name)', () => {
    process.env.OPENAI_API_BASE_URL = 'http://127.0.0.1:3031/v1';
    const requireProxyUrl = require('../requireProxyUrl');
    expect(requireProxyUrl('test.module', 'OPENAI_API_BASE_URL')).toBe('http://127.0.0.1:3031/v1');
  });

  test('throws with module name + env var name when missing', () => {
    const requireProxyUrl = require('../requireProxyUrl');
    expect(() => requireProxyUrl('my.module'))
      .toThrow(/\[my\.module\].*OPENAI_API_URL.*malika-llm-proxy/);
  });

  test('throws on empty-string env value (whitespace counts as missing)', () => {
    process.env.OPENAI_API_URL = '   ';
    const requireProxyUrl = require('../requireProxyUrl');
    expect(() => requireProxyUrl('m')).toThrow(/OPENAI_API_URL/);
  });
});
