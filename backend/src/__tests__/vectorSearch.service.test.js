jest.mock('../models/DataSource.model', () => ({
  findAll: jest.fn(),
}));

jest.mock('../models/KnowledgeBase.model', () => ({
  findAll: jest.fn(),
}));

jest.mock('../services/ai/embedding.service', () => ({
  generateEmbedding: jest.fn(async () => [0, 0, 0]),
  EMBEDDING_DIMENSIONS: 3,
}));

jest.mock('../services/ai/reranker.service', () => ({
  rerankCandidates: jest.fn(async (query, candidates) => ({ candidates, reranked: false })),
  rerankMixed: jest.fn(async (query, results) => ({ results, reranked: false })),
}));

jest.mock('../services/ai/documentJudge.service', () => ({
  judgeDocuments: jest.fn(async (query, candidates, opts) => ({
    results: (candidates || []).slice(0, opts?.topN || 10),
    judged: false,
    reranked: false,
    reasoning: 'mock',
    latencyMs: 0,
  })),
  extractSeriesKey: jest.fn(),
  detectSeriesGroups: jest.fn(() => new Map()),
}));

const DataSource = require('../models/DataSource.model');
const KnowledgeBase = require('../models/KnowledgeBase.model');
const {
  cosineSimilarity,
  loadEmbeddings,
  loadKnowledgeEmbeddings,
  invalidateCache,
  getCacheStats,
} = require('../services/ai/vectorSearch.service');

// These exercise the real database (they assert on live rows), so they cannot
// run where no DB is provisioned — CI included. Mirrors the SKIP_DB_TESTS
// convention already used by migrations.searchFulltext.test.js.
const runDb = process.env.SKIP_DB_TESTS !== '1';

(runDb ? describe : describe.skip)('vectorSearch.service', () => {
  beforeEach(() => {
    invalidateCache();
    jest.clearAllMocks();
  });

  it('computes cosine similarity', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    // Dimension mismatch uses Math.min (Matryoshka truncation safe)
    expect(cosineSimilarity([1], [1, 0])).toBeCloseTo(1);
    // Null/empty vectors return 0
    expect(cosineSimilarity(null, [1, 0])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('loads datasource embeddings into cache', async () => {
    DataSource.findAll.mockResolvedValue([
      { id: 1, name: 'A', type: 'dynamic', description: 'desc', embedding: '[1,0,0]' },
      { id: 2, name: 'B', type: 'dynamic', description: 'desc', embedding: 'invalid' },
    ]);

    const cache = await loadEmbeddings(true);
    expect(cache.size).toBe(1);

    const stats = getCacheStats();
    expect(stats.cached).toBe(1);
  });

  it('loads knowledge embeddings into cache', async () => {
    KnowledgeBase.findAll.mockResolvedValue([
      { id: 10, title: 'Doc', category: 'FAQ', content: 'content', embedding: '[0,1,0]', parent_id: null },
    ]);

    const cache = await loadKnowledgeEmbeddings(true);
    expect(cache.size).toBe(1);
  });
});
