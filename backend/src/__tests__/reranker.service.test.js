jest.mock('../services/ai/openaiChat.service', () => ({
  openAiChatJson: jest.fn(),
  openAiStructuredOutput: jest.fn(),
}));

const { openAiChatJson, openAiStructuredOutput } = require('../services/ai/openaiChat.service');
const {
  needsReranking,
  rerankCandidates,
  queryMayNeedDisambiguation,
  RERANK_SCORE_GAP_THRESHOLD,
} = require('../services/ai/reranker.service');
const { buildChatJsonResponse } = require('./helpers/mockOpenAI');
const { sampleRerankCandidates } = require('./helpers/fixtures');

describe('reranker.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('detects when reranking is needed', () => {
    const candidates = [
      { id: 1, score: RERANK_SCORE_GAP_THRESHOLD - 1 },
      { id: 2, score: 0 },
    ];
    expect(needsReranking(candidates)).toBe(true);
  });

  it('reorders candidates based on AI response', async () => {
    openAiStructuredOutput.mockResolvedValue(
      buildChatJsonResponse({ picked_rank: 2, picked_id: 2, reason: 'Lebih spesifik' })
    );

    const result = await rerankCandidates('kemiskinan kab/kota', sampleRerankCandidates);

    expect(result.reranked).toBe(true);
    expect(result.candidates[0].id).toBe(2);
  });

  it('skips reranking when gap is large', async () => {
    const candidates = [
      { id: 1, score: 100 },
      { id: 2, score: 10 },
    ];

    const result = await rerankCandidates('inflasi', candidates);
    expect(result.reranked).toBe(false);
  });

  it('detects disambiguation patterns', () => {
    expect(queryMayNeedDisambiguation('PDRB lapangan usaha')).toBe(true);
    expect(queryMayNeedDisambiguation('peta penduduk')).toBe(false);
  });
});
