const { scanEligibility, buildIndikatorList } = require('../services/petaTematik/eligibilityScanner.service');

describe('eligibilityScanner', () => {
  describe('scanEligibility', () => {
    test('marks table eligible when dim_value contains a Malut kab/kota', async () => {
      const queryMock = jest.fn();
      queryMock.mockResolvedValueOnce([[
        { TABLE_NAME: 'indikator_182' },
        { TABLE_NAME: 'indikator_1' },
      ]]);
      queryMock.mockResolvedValueOnce([[{
        source_id: 182,
        source_name: 'Kepadatan Penduduk Menurut Kabupten/Kota',
        region_rows: 50,
      }]]);
      queryMock.mockResolvedValueOnce([[{
        source_id: 1,
        source_name: 'Inflasi Provinsi Maluku Utara',
        region_rows: 0,
      }]]);

      const seq = { query: queryMock };
      const result = await scanEligibility(seq);

      expect(result).toHaveLength(2);
      const ind182 = result.find(r => r.tableName === 'indikator_182');
      expect(ind182.eligible).toBe(true);
      expect(ind182.sourceId).toBe(182);
      expect(ind182.sourceName).toContain('Kepadatan Penduduk');

      const ind1 = result.find(r => r.tableName === 'indikator_1');
      expect(ind1.eligible).toBe(false);
    });

    test('handles empty table list', async () => {
      const seq = { query: jest.fn().mockResolvedValueOnce([[]]) };
      const result = await scanEligibility(seq);
      expect(result).toEqual([]);
    });

    test('skips indikator_418 (multi-dim, MVP exclusion)', async () => {
      const queryMock = jest.fn();
      queryMock.mockResolvedValueOnce([[{ TABLE_NAME: 'indikator_418' }]]);
      const seq = { query: queryMock };
      const result = await scanEligibility(seq);
      expect(result.find(r => r.tableName === 'indikator_418').eligible).toBe(false);
      // Excluded table should not query the table itself (only the table-list query happened)
      expect(queryMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('buildIndikatorList', () => {
    test('groups eligible by kategori, sorted', () => {
      const scanResults = [
        { tableName: 'indikator_182', sourceId: 182, sourceName: 'Kepadatan Penduduk', eligible: true },
        { tableName: 'indikator_13',  sourceId: 13,  sourceName: 'Harapan Lama Sekolah', eligible: true },
        { tableName: 'indikator_1',   sourceId: 1,   sourceName: 'Inflasi Provinsi', eligible: false },
        { tableName: 'indikator_201', sourceId: 201, sourceName: 'TPT Kabupaten/Kota', eligible: true },
      ];
      const list = buildIndikatorList(scanResults);

      expect(list.kategori).toBeDefined();
      expect(list.totalEligible).toBe(3);
      expect(list.kategori.Kependudukan).toHaveLength(1);
      expect(list.kategori.Kependudukan[0].sourceName).toBe('Kepadatan Penduduk');
      expect(list.kategori.Pendidikan).toHaveLength(1);
      expect(list.kategori.Ketenagakerjaan).toHaveLength(1);
      // No Inflasi (not eligible)
      expect(list.kategori.Ekonomi).toBeUndefined();
    });

    test('returns empty kategori map when no eligible', () => {
      const list = buildIndikatorList([]);
      expect(list.totalEligible).toBe(0);
      expect(list.kategori).toEqual({});
    });
  });
});
