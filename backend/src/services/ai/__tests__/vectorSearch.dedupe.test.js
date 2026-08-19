'use strict';

// After re-chunking, one knowledge_base row is embedded as several token-sized
// windows, so a single document can come back as several retrieval rows sharing
// one source_ref_id. Downstream still treats that id as the identity of a
// document — documentJudge builds `new Map(input.map(c => [c.id, c]))` and maps
// the LLM's ranked_ids back through it — so duplicates would silently collapse to
// whichever copy happened to be last, and the judge's chosen ordering would be
// applied to a different window than the one it read.
//
// The window is the unit of matching; the document stays the unit of retrieval.

const { dedupeBySourceRef } = require('../vectorSearch.service');

const row = (id, similarity, content) => ({ id, similarity, content, title: `doc ${id}` });

describe('dedupeBySourceRef', () => {
  test('keeps one entry per document', () => {
    const out = dedupeBySourceRef([row(1, 0.90), row(1, 0.85), row(2, 0.80)]);
    expect(out.map(r => r.id)).toEqual([1, 2]);
  });

  test('keeps the best-scoring window of a document', () => {
    // The window that matched best is the one the question is about.
    const out = dedupeBySourceRef([row(1, 0.70, 'weak window'), row(1, 0.92, 'the table'), row(2, 0.80)]);
    expect(out.find(r => r.id === 1).content).toBe('the table');
  });

  test('preserves descending similarity order after collapsing', () => {
    const out = dedupeBySourceRef([row(1, 0.70), row(2, 0.95), row(1, 0.92)]);
    expect(out.map(r => r.id)).toEqual([2, 1]);
    expect(out[0].similarity).toBeGreaterThanOrEqual(out[1].similarity);
  });

  test('leaves an already-unique list untouched', () => {
    const input = [row(3, 0.9), row(4, 0.8)];
    expect(dedupeBySourceRef(input).map(r => r.id)).toEqual([3, 4]);
  });

  test('handles empty and malformed input', () => {
    expect(dedupeBySourceRef([])).toEqual([]);
    expect(dedupeBySourceRef(null)).toEqual([]);
  });
});
