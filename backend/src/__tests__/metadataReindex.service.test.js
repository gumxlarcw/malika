const ProcessedCache = require('../models/ProcessedCache.model');
const MergedCache = require('../models/MergedCache.model');

jest.mock('../models/ProcessedCache.model', () => ({
  findOne: jest.fn(),
}));

jest.mock('../models/MergedCache.model', () => ({
  findOne: jest.fn(),
}));

jest.mock('../services/search/metadataIndex.service', () => ({
  syncMetadataIndexForTable: jest.fn(async () => ({ ok: true, reason: 'synced', inserted: 10 })),
  syncMetadataIndexFromProcessedCacheRow: jest.fn(async () => ({ ok: true, reason: 'synced', inserted: 5 })),
}));

describe('metadataReindex.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('prefers merged cache when available', async () => {
    const { reindexSearchMetadataFromCacheForSource } = require('../services/search/metadataReindex.service');

    MergedCache.findOne
      .mockResolvedValueOnce({ signature: 'all', merged_json: JSON.stringify({ table: { columns: [], data: [] } }) })
      .mockResolvedValueOnce(null);

    const res = await reindexSearchMetadataFromCacheForSource(1, { preferMerged: true });
    expect(res.from).toBe('merged_cache');
    expect(ProcessedCache.findOne).not.toHaveBeenCalled();
  });

  test('falls back to processed cache when merged missing', async () => {
    const { reindexSearchMetadataFromCacheForSource } = require('../services/search/metadataReindex.service');

    MergedCache.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    ProcessedCache.findOne.mockResolvedValueOnce({ processed_json: JSON.stringify({ columns: [], data: [] }), period_value: '2024' });

    const res = await reindexSearchMetadataFromCacheForSource(2, { preferMerged: true });
    expect(res.from).toBe('processed_cache');
  });
});
