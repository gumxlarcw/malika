const { getAllDocuments } = require('../services/ai/knowledgeDoc.service');

jest.setTimeout(10_000);

// These exercise the real database (they assert on live rows), so they cannot
// run where no DB is provisioned — CI included. Mirrors the SKIP_DB_TESTS
// convention already used by migrations.searchFulltext.test.js.
const runDb = process.env.SKIP_DB_TESTS !== '1';

(runDb ? test : test.skip)('getAllDocuments returns canonical shape', async () => {
  const docs = await getAllDocuments();
  expect(Array.isArray(docs)).toBe(true);
  for (const d of docs.slice(0, 3)) {
    expect(d).toHaveProperty('id');
    expect(d).toHaveProperty('title');
    expect(d).toHaveProperty('chunks');
    expect(typeof d.chunks).toBe('number');
    expect(d).toHaveProperty('content_length');
    expect(typeof d.content_length).toBe('number');
    expect(d).toHaveProperty('status');
    expect(d).toHaveProperty('hasEmbedding');
    expect(typeof d.hasEmbedding).toBe('boolean');
  }
});
