'use strict';

// A rebuilt index has to be measurable BEFORE it goes live, or the only way to
// judge it is to cut over and find out in production. searchRetrieval therefore
// accepts an alternate table — whitelisted, because a table name cannot be a bound
// parameter and this one reaches SQL by interpolation.

const { resolveRetrievalTable, RETRIEVAL_TABLES } = require('../retrieval.service');

describe('resolveRetrievalTable', () => {
  test('defaults to the live table', () => {
    expect(resolveRetrievalTable()).toBe('retrieval_chunks');
    expect(resolveRetrievalTable(null)).toBe('retrieval_chunks');
  });

  test('allows the rebuild shadow table', () => {
    expect(resolveRetrievalTable('retrieval_chunks_rebuild')).toBe('retrieval_chunks_rebuild');
  });

  test('rejects anything not on the whitelist', () => {
    expect(() => resolveRetrievalTable('users')).toThrow(/not a known retrieval table/i);
  });

  test('rejects an injection attempt rather than sanitising it', () => {
    expect(() => resolveRetrievalTable('retrieval_chunks; DROP TABLE users--')).toThrow();
    expect(() => resolveRetrievalTable('`retrieval_chunks`')).toThrow();
  });

  test('the whitelist is a closed set', () => {
    expect(RETRIEVAL_TABLES).toEqual(['retrieval_chunks', 'retrieval_chunks_rebuild', 'retrieval_chunks_old', 'retrieval_chunks_bge']);
  });
});
