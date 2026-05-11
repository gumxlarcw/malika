const { getAllDocuments } = require('../services/ai/knowledgeDoc.service');

jest.setTimeout(10_000);

test('getAllDocuments returns canonical shape', async () => {
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
