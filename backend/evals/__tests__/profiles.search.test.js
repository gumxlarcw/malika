'use strict';

const searchProfile = require('../lib/profiles/search');

describe('search profile contract', () => {
  test('exports required fields', () => {
    expect(searchProfile.name).toBe('search');
    expect(typeof searchProfile.loadFixture).toBe('function');
    expect(typeof searchProfile.runCase).toBe('function');
    expect(typeof searchProfile.summarize).toBe('function');
  });

  test('loadFixture returns expanded case corpus with required fields', () => {
    const cases = searchProfile.loadFixture();
    expect(cases.length).toBeGreaterThanOrEqual(40);
    expect(cases[0]).toHaveProperty('id');
    expect(cases[0]).toHaveProperty('query');
    expect(cases[0]).toHaveProperty('tags');
  });

  test('summarize structures per-stage metrics', () => {
    const results = [
      { id: 'a', stages: { intent_det: { passed: true,  diffs: [], match_rate: 1 } } },
      { id: 'b', stages: { intent_det: { passed: false, diffs: ['year: expected 2024, got 2023'], match_rate: 0.5 } } },
    ];
    const s = searchProfile.summarize(results);
    expect(s.cases_total).toBe(2);
    expect(s.stages.intent_det.cases).toBe(2);
    expect(s.stages.intent_det.pass_rate).toBeCloseTo(0.5);
  });
});

const { scoreStructural } = require('../lib/scoring');

describe('search profile — plan stage scoring', () => {
  test('deeplink action requires source_id match', () => {
    const got = { action: 'deeplink', source_id: 42 };
    const expected = { action: 'deeplink', source_id: 42 };
    const r = scoreStructural(got, expected);
    expect(r.passed).toBe(true);
  });

  test('plan fails when action differs', () => {
    const got = { action: 'search' };
    const expected = { action: 'deeplink', source_id: 42 };
    const r = scoreStructural(got, expected);
    expect(r.passed).toBe(false);
  });
});

describe('search profile — summarize extensions', () => {
  const searchProfile = require('../lib/profiles/search');

  test('comparison_llm_vs_det: retire_llm_safe when det never loses', () => {
    const results = [
      { id: 'a', stages: {
        intent_llm: { passed: true },
        intent_det: { passed: true },
      }},
      { id: 'b', stages: {
        intent_llm: { passed: false },
        intent_det: { passed: true },
      }},
      { id: 'c', stages: {
        intent_llm: { passed: false },
        intent_det: { passed: false },
      }},
    ];
    const s = searchProfile.summarize(results);
    expect(s.comparison_llm_vs_det.llm_wins).toBe(0);
    expect(s.comparison_llm_vs_det.det_wins).toBe(1);
    expect(s.comparison_llm_vs_det.both_pass).toBe(1);
    expect(s.comparison_llm_vs_det.both_fail).toBe(1);
    expect(s.comparison_llm_vs_det.retire_llm_safe).toBe(true);
  });

  test('comparison_llm_vs_det: NOT safe when any llm_wins', () => {
    const results = [
      { id: 'a', stages: {
        intent_llm: { passed: true },
        intent_det: { passed: false },
      }},
    ];
    const s = searchProfile.summarize(results);
    expect(s.comparison_llm_vs_det.llm_wins).toBe(1);
    expect(s.comparison_llm_vs_det.retire_llm_safe).toBe(false);
    expect(s.comparison_llm_vs_det.retire_llm_reason).toMatch(/1 case/);
  });

  test('summarize includes knowledge, plan, e2e stages', () => {
    const results = [
      { id: 'a', stages: {
        knowledge: { passed: true,  latencyMs: 100 },
        plan:      { passed: true },
        e2e:       { passed: false, latencyMs: 500 },
      }},
    ];
    const s = searchProfile.summarize(results);
    expect(s.stages.knowledge).toBeDefined();
    expect(s.stages.plan).toBeDefined();
    expect(s.stages.e2e).toBeDefined();
    expect(s.stages.knowledge.cases).toBe(1);
    expect(s.stages.knowledge.pass_rate).toBe(1);
    expect(s.stages.e2e.pass_rate).toBe(0);
  });
});
