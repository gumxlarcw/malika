'use strict';
/**
 * Split text into windows that fit an embedding model's token budget.
 *
 * Sizing by characters cannot work on this corpus. Measured over 298 sampled
 * chunks, chars-per-token runs 1.51 to 5.54 (median 3.82, p05 2.76), and the
 * digit-dense statistical tables sit at 2.50-2.96 — so a 1,900-char window is
 * ~500 tokens of prose but ~760 tokens of a numeric table. e5-base stops at 512
 * and the remainder is silently dropped, which is how 57.5% of the knowledge base
 * came to have no representation in any vector.
 *
 * The token counter is injected: production passes the real tokenizer, tests pass
 * a trivial one so the splitting rule can be checked without a 280 MB model.
 */

/**
 * @param {string} text
 * @param {{maxTokens:number, overlapTokens?:number, countTokens:(s:string)=>number}} opts
 * @returns {string[]} windows, in order, together covering the whole text
 */
function windowByTokens(text, { maxTokens, overlapTokens = 0, countTokens } = {}) {
  const src = String(text || '').trim();
  if (!src) return [];
  if (typeof countTokens !== 'function') throw new Error('countTokens is required');
  const budget = Math.max(1, Number(maxTokens) || 1);
  // Overlap must leave room to advance, or the window never moves forward.
  const overlap = Math.max(0, Math.min(Number(overlapTokens) || 0, budget - 1));

  if (countTokens(src) <= budget) return [src];

  // Break at line boundaries where possible: a statistical table is a stack of
  // rows, and cutting mid-row costs more than an uneven window.
  const units = [];
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (countTokens(t) <= budget) {
      units.push(t);
      continue;
    }
    // A single line can exceed the budget on its own (one long table row). Cut it
    // on whitespace rather than emitting something the model would truncate.
    let buf = [];
    for (const word of t.split(/\s+/)) {
      buf.push(word);
      if (countTokens(buf.join(' ')) > budget) {
        buf.pop();
        if (buf.length) units.push(buf.join(' '));
        buf = [word];
      }
    }
    if (buf.length) units.push(buf.join(' '));
  }
  if (units.length === 0) return [];

  const windows = [];
  let i = 0;
  while (i < units.length) {
    let end = i;
    let current = '';
    while (end < units.length) {
      const next = current ? `${current}\n${units[end]}` : units[end];
      if (countTokens(next) > budget) break;
      current = next;
      end += 1;
    }
    // Each unit already fits the budget, so end always advances past i.
    if (end === i) { current = units[i]; end = i + 1; }
    windows.push(current);
    if (end >= units.length) break;

    // Step back far enough to repeat roughly `overlap` tokens, without ever
    // failing to advance.
    let back = 0;
    let backTokens = 0;
    while (end - 1 - back > i && backTokens < overlap) {
      backTokens += countTokens(units[end - 1 - back]);
      back += 1;
    }
    i = Math.max(i + 1, end - back);
  }
  return windows;
}

module.exports = { windowByTokens };
