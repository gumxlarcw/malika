const {
  extractGeoFromQuery,
  extractAllGeoReferences,
  normalizeRegionName,
} = require('../utils/geoAnalysis');

describe('geoAnalysis utilities', () => {
  test('normalizeRegionName resolves aliases to canonical display', () => {
    expect(normalizeRegionName('halut')).toBe('Kabupaten Halmahera Utara');
    expect(normalizeRegionName('tikep')).toBe('Kota Tidore Kepulauan');
  });

  test('extractGeoFromQuery detects explicit kab/kota', () => {
    const result = extractGeoFromQuery('data inflasi halmahera selatan 2024');
    expect(result).toEqual({
      region: 'Kabupaten Halmahera Selatan',
      isExplicit: true,
    });
  });

  test('extractGeoFromQuery detects province aliases', () => {
    const result = extractGeoFromQuery('pdrb malut 2023');
    expect(result).toEqual({
      region: 'Provinsi Maluku Utara',
      isExplicit: true,
    });
  });

  test('extractGeoFromQuery defaults to province when none specified', () => {
    const result = extractGeoFromQuery('pdrb 2023');
    expect(result).toEqual({
      region: 'Provinsi Maluku Utara',
      isExplicit: false,
    });
  });

  test('extractAllGeoReferences returns canonical keys', () => {
    const refs = extractAllGeoReferences('tikep dan halbar');
    expect(refs).toEqual(expect.arrayContaining(['tidore kepulauan', 'halmahera barat']));
  });
});
