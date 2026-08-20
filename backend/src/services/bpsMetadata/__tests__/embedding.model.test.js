'use strict';

// The embedding model is selectable so bge-m3 can be adopted without a code edit
// and rolled back the same way. The prefix convention is the trap: e5 was trained
// with "query: " / "passage: " markers and loses accuracy without them, while
// bge-m3 was trained with none and loses accuracy WITH them. Nothing errors either
// way — the vectors just get quietly worse, which is the hardest kind of
// regression to notice.

const { prefixesFor, dimensionsFor } = require('../embedding.service');

describe('prefixesFor', () => {
  test('e5 models get the query/passage markers they were trained with', () => {
    expect(prefixesFor('Xenova/multilingual-e5-base')).toEqual({ query: 'query: ', passage: 'passage: ' });
    expect(prefixesFor('Xenova/multilingual-e5-large')).toEqual({ query: 'query: ', passage: 'passage: ' });
  });

  test('bge-m3 gets no prefix', () => {
    expect(prefixesFor('Xenova/bge-m3')).toEqual({ query: '', passage: '' });
  });

  test('an unknown model gets no prefix rather than a guessed one', () => {
    expect(prefixesFor('some/other-encoder')).toEqual({ query: '', passage: '' });
  });

  test('matching is not fooled by a substring', () => {
    expect(prefixesFor('Xenova/bge-m3-e5-lookalike').query).toBe('');
  });
});

describe('dimensionsFor', () => {
  test('knows the dimensions of the models we ship', () => {
    expect(dimensionsFor('Xenova/multilingual-e5-base')).toBe(768);
    expect(dimensionsFor('Xenova/bge-m3')).toBe(1024);
    expect(dimensionsFor('Xenova/multilingual-e5-large')).toBe(1024);
  });

  test('returns null for a model it does not know', () => {
    // A wrong dimension is caught at insert time by the VECTOR column, but only
    // after an expensive re-index. Better to refuse than to assume.
    expect(dimensionsFor('some/other-encoder')).toBeNull();
  });
});
