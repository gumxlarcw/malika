'use strict';

const { heuristicScore } = require('../lib/scoring');

describe('heuristicScore', () => {
  test('full match gives grade A', () => {
    const response = { content: 'MALIKA siap membantu. Angka inflasi 2.5%.', latencyMs: 1000 };
    const expect_ = {
      shouldContain: ['MALIKA', 'inflasi'],
      shouldNotContain: ['error'],
      mustCiteNumber: true,
      minLength: 20,
      maxLatencyMs: 5000,
    };
    const r = heuristicScore(response, expect_);
    expect(r.grade).toBe('A');
    expect(r.composite).toBeGreaterThanOrEqual(0.9);
  });

  test('missing required token lowers score', () => {
    const response = { content: 'Halo dunia.', latencyMs: 500 };
    const expect_ = { shouldContain: ['MALIKA'], minLength: 10, maxLatencyMs: 2000 };
    const r = heuristicScore(response, expect_);
    expect(r.details.shouldContain.missing).toContain('MALIKA');
    expect(r.grade).not.toBe('A');
  });

  test('alternation with | matches any one', () => {
    const response = { content: 'Inflasi 2.5 persen.', latencyMs: 1000 };
    const expect_ = { shouldContain: ['%|persen'] };
    const r = heuristicScore(response, expect_);
    expect(r.details.shouldContain.score).toBe(1);
  });
});

describe('scoreStructural', () => {
  const { scoreStructural } = require('../lib/scoring');

  test('passes when every labeled field matches', () => {
    const result = { type: 'dynamic', year: 2024, geo: 'maluku utara', source_id: 42 };
    const expected = { type: 'dynamic', year: 2024, geo: 'maluku utara', source_id: 42 };
    const r = scoreStructural(result, expected);
    expect(r.passed).toBe(true);
    expect(r.diffs).toEqual([]);
    expect(r.match_rate).toBe(1);
  });

  test('fails with diffs for every mismatched field', () => {
    const result = { type: 'dynamic', year: 2023, geo: null, source_id: 42 };
    const expected = { type: 'dynamic', year: 2024, geo: 'maluku utara', source_id: 42 };
    const r = scoreStructural(result, expected);
    expect(r.passed).toBe(false);
    expect(r.diffs).toEqual([
      'year: expected 2024, got 2023',
      'geo: expected "maluku utara", got null',
    ]);
    expect(r.match_rate).toBeCloseTo(2 / 4);
  });

  test('skips fields that are absent in expected', () => {
    const result = { type: 'dynamic', extra_field: 'ignored' };
    const expected = { type: 'dynamic' };
    const r = scoreStructural(result, expected);
    expect(r.passed).toBe(true);
    expect(r.match_rate).toBe(1);
  });

  test('treats undefined result field as null', () => {
    const result = { type: 'dynamic' };
    const expected = { type: 'dynamic', year: 2024 };
    const r = scoreStructural(result, expected);
    expect(r.passed).toBe(false);
    expect(r.diffs).toContain('year: expected 2024, got null');
  });
});
