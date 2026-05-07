'use strict';

const {
  recordDivergence,
  snapshot,
  reset,
  hashQuery,
} = require('../services/search/shadowLogger.service');

describe('shadowLogger', () => {
  beforeEach(() => reset());

  test('hashQuery produces a short, deterministic, non-reversible digest', () => {
    const h1 = hashQuery('tpt malut 2024');
    const h2 = hashQuery('tpt malut 2024');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(12);
    expect(h1).not.toContain('tpt');
    expect(h1).not.toContain('malut');
  });

  test('recordDivergence accumulates entries', () => {
    recordDivergence({ q: 'a', oldSourceId: 1, newSourceId: 2, oldType: 'dynamic', newType: 'interop' });
    recordDivergence({ q: 'b', oldSourceId: 3, newSourceId: 3, oldType: 'dynamic', newType: 'dynamic' });
    const s = snapshot();
    expect(s.total_divergent).toBe(1);  // only 1 had different source_id
    expect(s.total_recorded).toBe(2);
  });

  test('snapshot groups divergences by old→new source_id pair', () => {
    recordDivergence({ q: 'q1', oldSourceId: 1, newSourceId: 2 });
    recordDivergence({ q: 'q2', oldSourceId: 1, newSourceId: 2 });
    recordDivergence({ q: 'q3', oldSourceId: 3, newSourceId: 4 });
    const s = snapshot();
    expect(s.divergence_pairs['1→2']).toBe(2);
    expect(s.divergence_pairs['3→4']).toBe(1);
  });

  test('reset clears accumulated data', () => {
    recordDivergence({ q: 'a', oldSourceId: 1, newSourceId: 2 });
    reset();
    expect(snapshot().total_recorded).toBe(0);
  });
});
