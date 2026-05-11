const { getEmbeddingStats } = require('../services/ai/embedding.service');

jest.setTimeout(10_000);

const REQUIRED_FIELDS = [
  'total',
  'embedded',
  'notEmbedded',
  'oldestEmbedding',
  'newestEmbedding',
  'lastUpdated',
];

test('getEmbeddingStats returns the canonical shape', async () => {
  const stats = await getEmbeddingStats();
  for (const f of REQUIRED_FIELDS) {
    expect(stats).toHaveProperty(f);
  }
  expect(typeof stats.total).toBe('number');
  expect(typeof stats.embedded).toBe('number');
  expect(typeof stats.notEmbedded).toBe('number');
  expect(stats.total).toBeGreaterThan(0);
  // Embedded count must reflect retrieval_chunks reality (>= 1)
  expect(stats.embedded).toBeGreaterThan(0);
  expect(stats.notEmbedded).toBe(stats.total - stats.embedded);
});
