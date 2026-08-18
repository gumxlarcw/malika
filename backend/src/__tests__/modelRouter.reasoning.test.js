'use strict';

// Reasoning costs output tokens, so it is spent only where there is something
// to reason about. Greetings and plain lookups stay on the cheap path.

jest.mock('../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}));

const { routeModel, TIERS } = require('../services/chat/streaming/modelRouter.service');

describe('reasoning_effort per tier', () => {
  test('greeting does not reason', () => {
    const { tier, config } = routeModel({ isGreeting: true });
    expect(tier).toBe(TIERS.GREETING);
    expect(config.reasoning_effort).toBeNull();
  });

  // Policy 2026-08-18: reason on every tier except greeting. The trace is what
  // tells a waiting reader the pipeline is working rather than hung, so it has
  // to be there for ordinary lookups too — not only the analytical ones.
  test('simple lookup reasons', () => {
    const { tier, config } = routeModel({ query: 'jumlah penduduk ternate 2024', candidateCount: 1 });
    expect(tier).toBe(TIERS.SIMPLE);
    expect(config.reasoning_effort).toBe('high');
  });

  test('complex query reasons', () => {
    const { tier, config } = routeModel({ query: 'bandingkan IPM per kabupaten', hasYearRange: true });
    expect(tier).toBe(TIERS.COMPLEX);
    expect(config.reasoning_effort).toBe('high');
  });

  test('deep query reasons', () => {
    const { tier, config } = routeModel({ query: 'mengapa inflasi naik? proyeksi tahun depan' });
    expect(tier).toBe(TIERS.DEEP);
    expect(config.reasoning_effort).toBe('high');
  });

  // 'high' measured cheapest AND most concise on this stack: 4272 chars of
  // reasoning at 1614 output tokens, versus 'low' rambling to 12626 chars and
  // exhausting a 4000-token budget without finishing the answer.
  test("reasoning tiers use 'high', never 'low'", () => {
    const reasoningTiers = [
      { query: 'bandingkan IPM per kabupaten', hasYearRange: true },  // → COMPLEX
      { query: 'mengapa inflasi naik? proyeksi tahun depan' },        // → DEEP
    ];
    for (const args of reasoningTiers) {
      expect(routeModel(args).config.reasoning_effort).toBe('high');
    }
  });

  test('answer budget leaves room for reasoning plus the answer', () => {
    // 'high' spent 1614 output tokens on reasoning + answer in the probe.
    const { config } = routeModel({ query: 'bandingkan IPM per kabupaten', hasYearRange: true });
    expect(config.max_tokens).toBeGreaterThan(1614 * 2);
  });
});
