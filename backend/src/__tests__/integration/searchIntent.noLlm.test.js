'use strict';

// Mock intent service — the service under test
jest.mock('../../services/search/intent.service', () => ({
  resolveSearchIntent: jest.fn().mockResolvedValue({
    ok: true,
    query: 'x',
    query_builder: {},
    plan: { action: 'search', href: '/search' },
  }),
  buildDatasourceCandidates: jest.fn().mockResolvedValue([]),
}));

// Mock AI/vector services that have missing model deps in this worktree
jest.mock('../../services/ai/vectorSearch.service', () => ({
  searchSimilar: jest.fn().mockResolvedValue([]),
  searchKnowledge: jest.fn().mockResolvedValue([]),
  hybridSearch: jest.fn().mockResolvedValue([]),
  buildIndex: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/ai/embedding.service', () => ({
  generateEmbedding: jest.fn().mockResolvedValue(new Array(768).fill(0)),
  EMBEDDING_DIMENSIONS: 768,
  LEGACY_EMBEDDING_DIMENSIONS: 384,
}));

const request = require('supertest');
const app = require('../../../app');
const intent = require('../../services/search/intent.service');

describe('GET /search/intent noLlm param', () => {
  beforeEach(() => intent.resolveSearchIntent.mockClear());

  test('forwards noLlm=1 to service', async () => {
    await request(app).get('/search/intent?q=test&noLlm=1');
    expect(intent.resolveSearchIntent).toHaveBeenCalledWith(expect.objectContaining({ noLlm: true }));
  });

  test('defaults to noLlm=false when param omitted', async () => {
    await request(app).get('/search/intent?q=test');
    expect(intent.resolveSearchIntent).toHaveBeenCalledWith(expect.objectContaining({ noLlm: false }));
  });

  test('treats noLlm=0 as false', async () => {
    await request(app).get('/search/intent?q=test&noLlm=0');
    expect(intent.resolveSearchIntent).toHaveBeenCalledWith(expect.objectContaining({ noLlm: false }));
  });

  test('noLlm=1 bypasses the cache even on repeat queries', async () => {
    await request(app).get('/search/intent?q=cachebust&noLlm=1');
    const firstCalls = intent.resolveSearchIntent.mock.calls.length;
    await request(app).get('/search/intent?q=cachebust&noLlm=1');
    const secondCalls = intent.resolveSearchIntent.mock.calls.length;
    expect(secondCalls).toBe(firstCalls + 1); // service called both times, no cache
  });
});
