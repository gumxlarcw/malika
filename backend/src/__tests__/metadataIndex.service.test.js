const DataSourceSearchTerm = require('../models/DataSourceSearchTerm.model');

jest.mock('../models/DataSourceSearchTerm.model', () => ({
  bulkCreate: jest.fn(),
  destroy: jest.fn(),
}));

describe('metadataIndex.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('extracts column labels and categorical values (skips numerics)', async () => {
    const {
      extractColumnLabels,
      extractStringValuesFromRows,
      buildEntriesFromTable,
    } = require('../services/search/metadataIndex.service');

    const table = {
      columns: [
        { key: 'Komoditas', label: 'Komoditas' },
        { key: 'Nilai', label: 'Nilai (Rp)' },
      ],
      data: [
        { Komoditas: 'Durian', Nilai: 12345 },
        { Komoditas: 'Mangga', Nilai: '9.876' },
        { Komoditas: 'Pisang', Nilai: '10%' },
      ],
    };

    expect(extractColumnLabels(table)).toEqual(['Komoditas', 'Nilai (Rp)']);

    const values = extractStringValuesFromRows({
      columns: table.columns,
      data: table.data,
      maxRows: 100,
      maxDistinct: 100,
    });

    expect(values).toContain('Durian');
    expect(values).toContain('Mangga');
    expect(values).toContain('Pisang');
    expect(values).not.toContain('12345');

    const entries = buildEntriesFromTable({ sourceId: 7, table });
    const kinds = new Set(entries.map((e) => e.kind));

    // Phrases and token kinds should be produced.
    expect(kinds.has('column')).toBe(true);
    expect(kinds.has('column_token')).toBe(true);
    expect(kinds.has('value')).toBe(true);
    expect(kinds.has('value_token')).toBe(true);
  });

  test('syncMetadataIndexForTable upserts and prunes only its managed kinds', async () => {
    const { syncMetadataIndexForTable } = require('../services/search/metadataIndex.service');

    DataSourceSearchTerm.bulkCreate.mockResolvedValueOnce([]);
    DataSourceSearchTerm.destroy.mockResolvedValueOnce(0);

    const res = await syncMetadataIndexForTable({
      sourceId: 99,
      table: {
        columns: [{ key: 'Komoditas', label: 'Komoditas' }],
        data: [{ Komoditas: 'Durian' }],
      },
    });

    expect(res.ok).toBe(true);
    expect(DataSourceSearchTerm.bulkCreate).toHaveBeenCalledTimes(1);

    // destroy is called best-effort for pruning; at least once is expected.
    expect(DataSourceSearchTerm.destroy.mock.calls.length).toBeGreaterThanOrEqual(1);

    // Ensure pruning is scoped by kind (doesn't wipe unrelated kinds).
    const destroyWhere = DataSourceSearchTerm.destroy.mock.calls[0][0].where;
    expect(destroyWhere).toHaveProperty('kind');
  });
});
