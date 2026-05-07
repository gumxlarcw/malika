'use strict';

const { modelForTier } = require('../services/chat/streaming/modelRouter.service');

describe('modelForTier', () => {
  const ENV_KEYS = ['MODEL_GREETING', 'MODEL_SIMPLE', 'MODEL_COMPLEX', 'MODEL_DEEP'];
  const originalEnv = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      originalEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (originalEnv[k] === undefined) delete process.env[k];
      else process.env[k] = originalEnv[k];
    }
  });

  test('GREETING defaults to gemini-3-flash-preview', () => {
    expect(modelForTier('GREETING')).toBe('gemini-3-flash-preview');
  });

  test('SIMPLE defaults to gemini-3-flash-preview', () => {
    expect(modelForTier('SIMPLE')).toBe('gemini-3-flash-preview');
  });

  test('COMPLEX defaults to claude-sonnet-4-6', () => {
    expect(modelForTier('COMPLEX')).toBe('claude-sonnet-4-6');
  });

  test('DEEP defaults to claude-sonnet-4-6', () => {
    expect(modelForTier('DEEP')).toBe('claude-sonnet-4-6');
  });

  test('MODEL_<TIER> env override wins over default', () => {
    process.env.MODEL_SIMPLE = 'claude-haiku-4-5-20251001';
    expect(modelForTier('SIMPLE')).toBe('claude-haiku-4-5-20251001');
  });

  test('unknown tier falls back to claude-sonnet-4-6', () => {
    expect(modelForTier('DOES_NOT_EXIST')).toBe('claude-sonnet-4-6');
    expect(modelForTier(undefined)).toBe('claude-sonnet-4-6');
    expect(modelForTier(null)).toBe('claude-sonnet-4-6');
    expect(modelForTier('')).toBe('claude-sonnet-4-6');
  });
});
