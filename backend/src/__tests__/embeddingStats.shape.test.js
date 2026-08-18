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

const { getDatasourcesWithEmbeddingStatus } = require('../services/ai/embedding.service');

// These exercise the real database (they assert on live rows), so they cannot
// run where no DB is provisioned — CI included. Mirrors the SKIP_DB_TESTS
// convention already used by migrations.searchFulltext.test.js.
const runDb = process.env.SKIP_DB_TESTS !== '1';

(runDb ? test : test.skip)('getDatasourcesWithEmbeddingStatus returns per-source rows', async () => {
  const rows = await getDatasourcesWithEmbeddingStatus();
  expect(Array.isArray(rows)).toBe(true);
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows.slice(0, 5)) {
    expect(r).toHaveProperty('id');
    expect(r).toHaveProperty('name');
    expect(r).toHaveProperty('type');
    expect(r).toHaveProperty('hasEmbedding');
    expect(typeof r.hasEmbedding).toBe('boolean');
    expect(r).toHaveProperty('embeddingUpdatedAt');
    expect(r).toHaveProperty('textLength');
    expect(typeof r.textLength).toBe('number');
  }
  // At least some sources must show hasEmbedding=true given live retrieval_chunks state.
  expect(rows.filter((r) => r.hasEmbedding).length).toBeGreaterThan(0);
});

(runDb ? test : test.skip)('getEmbeddingStats returns the canonical shape', async () => {
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
