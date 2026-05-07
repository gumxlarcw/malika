'use strict';

const chatProfile = require('../lib/profiles/chat');

describe('chat profile contract', () => {
  test('exports required fields', () => {
    expect(chatProfile.name).toBe('chat');
    expect(typeof chatProfile.loadFixture).toBe('function');
    expect(typeof chatProfile.runCase).toBe('function');
    expect(typeof chatProfile.summarize).toBe('function');
  });

  test('loadFixture returns cases from chat-cases.json', () => {
    const cases = chatProfile.loadFixture();
    expect(Array.isArray(cases)).toBe(true);
    expect(cases.length).toBeGreaterThan(0);
    expect(cases[0]).toHaveProperty('id');
    expect(cases[0]).toHaveProperty('query');
    expect(cases[0]).toHaveProperty('expect');
  });

  test('summarize computes aggregate metrics', () => {
    const results = [
      { id: 'a', category: 'greeting', score: { composite: 0.95, grade: 'A' }, response: { latencyMs: 1000 } },
      { id: 'b', category: 'greeting', score: { composite: 0.60, grade: 'D' }, response: { latencyMs: 2000 } },
      { id: 'c', category: 'period',   score: { composite: 0.85, grade: 'B' }, response: { latencyMs: 1500 } },
    ];
    const s = chatProfile.summarize(results);
    expect(s.cases_total).toBe(3);
    expect(s.cases_passed).toBe(2); // grades A + B
    expect(s.overall_score).toBeCloseTo((0.95 + 0.60 + 0.85) / 3, 2);
    expect(s.by_category.greeting.total).toBe(2);
    expect(s.by_category.greeting.passed).toBe(1);
  });
});
