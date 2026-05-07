jest.mock('../services/ai/openaiChat.service', () => ({
  openAiChatJson: jest.fn(),
  openAiToolCall: jest.fn(),
}));

jest.mock('../services/ai/queryBuilder.validator', () => ({
  validateQueryBuilderOutput: jest.fn(() => ({ ok: true, errors: [] })),
}));

jest.mock('../services/ai/vectorSearch.service', () => ({
  searchForQueryBuilder: jest.fn(async () => []),
}));

const { buildQueryFromText, getQueryBuilderToolParameters } = require('../services/ai/queryBuilder.service');
const { openAiToolCall, openAiChatJson } = require('../services/ai/openaiChat.service');
const { buildToolCallResponse, buildChatJsonResponse } = require('./helpers/mockOpenAI');
const { sampleQueryBuilderOutput } = require('./helpers/fixtures');

const validPayload = {
  ...sampleQueryBuilderOutput,
  params: { ...sampleQueryBuilderOutput.params, q: 'kemiskinan maluku utara' },
};

describe('queryBuilder.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns tool parameters without $schema metadata', () => {
    const params = getQueryBuilderToolParameters();
    expect(params).toHaveProperty('type');
    expect(params).not.toHaveProperty('$schema');
  });

  it('builds query using tool-call JSON first', async () => {
    openAiToolCall.mockResolvedValue(buildToolCallResponse(validPayload));

    const result = await buildQueryFromText({ q: 'kemiskinan maluku utara' });

    expect(result).toHaveProperty('intent', 'search');
    expect(result.params.q).toBe('kemiskinan maluku utara');
    expect(openAiChatJson).not.toHaveBeenCalled();
  });

  it('falls back to JSON response when tool call fails', async () => {
    openAiToolCall.mockRejectedValue(new Error('fail'));
    openAiChatJson.mockResolvedValue(buildChatJsonResponse(validPayload));

    const result = await buildQueryFromText({ q: 'kemiskinan maluku utara' });

    expect(result).toHaveProperty('type', 'dynamic');
    expect(openAiChatJson).toHaveBeenCalled();
  });
});
