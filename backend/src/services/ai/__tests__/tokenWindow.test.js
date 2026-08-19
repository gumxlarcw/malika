'use strict';

// Chunks are embedded by a model that stops at 512 tokens, and the corpus does
// not tokenize uniformly: measured over 298 sampled chunks, chars-per-token runs
// from 1.51 to 5.54 (median 3.82, p05 2.76). Digit-dense chunks — the statistical
// tables this whole exercise is about — sit at 2.50-2.96. Sizing windows by
// characters therefore cannot work: 1,900 chars is ~500 tokens of prose but ~760
// of a numeric table, which the model would silently truncate.
//
// The counter is injected so the rule can be tested without loading a 280 MB ONNX
// tokenizer, and so a test states its own token arithmetic instead of depending on
// how a particular model happens to split Indonesian.

const { windowByTokens } = require('../tokenWindow.service');

// One token per whitespace-separated word.
const words = (t) => String(t).trim().split(/\s+/).filter(Boolean).length;

describe('windowByTokens', () => {
  test('returns the text unchanged when it already fits', () => {
    const text = 'satu dua tiga empat lima';
    expect(windowByTokens(text, { maxTokens: 10, countTokens: words })).toEqual([text]);
  });

  test('splits text that exceeds the budget', () => {
    const text = Array.from({ length: 30 }, (_, i) => `kata${i}`).join(' ');
    const out = windowByTokens(text, { maxTokens: 10, overlapTokens: 0, countTokens: words });
    expect(out.length).toBeGreaterThan(1);
    out.forEach(w => expect(words(w)).toBeLessThanOrEqual(10));
  });

  test('every window stays within the budget', () => {
    const text = Array.from({ length: 200 }, (_, i) => `kata${i}`).join(' ');
    const out = windowByTokens(text, { maxTokens: 25, overlapTokens: 5, countTokens: words });
    out.forEach(w => expect(words(w)).toBeLessThanOrEqual(25));
  });

  test('covers the whole text — nothing is dropped', () => {
    const text = Array.from({ length: 100 }, (_, i) => `kata${i}`).join(' ');
    const out = windowByTokens(text, { maxTokens: 20, overlapTokens: 4, countTokens: words });
    const seen = new Set(out.join(' ').split(/\s+/));
    for (let i = 0; i < 100; i++) expect(seen.has(`kata${i}`)).toBe(true);
  });

  test('repeats a trailing line in the next window so a header carries forward', () => {
    // Rows are lines and lines are never split, so overlap is not about keeping a
    // row intact — it is about the line above it. A table row means little without
    // the header, so consecutive windows share their boundary line.
    const lines = Array.from({ length: 12 }, (_, i) => `baris ${i} nilai`);
    const out = windowByTokens(lines.join('\n'), { maxTokens: 9, overlapTokens: 3, countTokens: words });
    expect(out.length).toBeGreaterThan(1);
    const lastOfFirst = out[0].split('\n').pop();
    expect(out[1].split('\n')[0]).toBe(lastOfFirst);
  });

  test('prefers to break at a line boundary rather than mid-line', () => {
    const text = 'baris satu dua\nbaris dua tiga\nbaris tiga empat';
    const out = windowByTokens(text, { maxTokens: 6, overlapTokens: 0, countTokens: words });
    out.forEach(w => expect(w.startsWith('baris')).toBe(true));
  });

  test('splits a single oversized line rather than emitting it whole', () => {
    // A table row can exceed the budget on its own; it must still be cut, or the
    // model truncates it and the tail becomes unsearchable — the original bug.
    const text = Array.from({ length: 50 }, (_, i) => `v${i}`).join(' ');
    const out = windowByTokens(text, { maxTokens: 8, overlapTokens: 0, countTokens: words });
    out.forEach(w => expect(words(w)).toBeLessThanOrEqual(8));
  });

  test('handles empty and whitespace-only input', () => {
    expect(windowByTokens('', { maxTokens: 10, countTokens: words })).toEqual([]);
    expect(windowByTokens('   \n  ', { maxTokens: 10, countTokens: words })).toEqual([]);
  });

  test('makes progress even when overlap is larger than the budget allows', () => {
    // Guard against an infinite loop: overlap must never consume the whole window.
    const text = Array.from({ length: 30 }, (_, i) => `k${i}`).join(' ');
    const out = windowByTokens(text, { maxTokens: 5, overlapTokens: 20, countTokens: words });
    expect(out.length).toBeGreaterThan(1);
    expect(out.length).toBeLessThan(30);
  });
});
