'use strict';

jest.mock('../models/DataSource.model', () => {
  return {
    findAll: jest.fn(),
  };
}, { virtual: true });

const DataSource = require('../models/DataSource.model');
const { rebuildEntityIndex, getEntityIndex } = require('../services/search/entityResolver');

describe('rebuildEntityIndex', () => {
  beforeEach(() => DataSource.findAll.mockReset());

  test('mines geo entities from data_sources.name column', async () => {
    DataSource.findAll.mockResolvedValueOnce([
      { name: 'Inflasi Provinsi Maluku Utara (2022 = 100)' },
      { name: 'Indeks Pembangunan Manusia Menurut Kabupaten/Kota' },
      { name: 'Inflasi Kota Ternate (2022 = 100)' },
      { name: 'Inflasi Kabupaten Halmahera Tengah (2022 = 100)' },
      { name: 'Jumlah Penduduk Miskin Kepulauan Sula' },
      { name: 'Indeks Harga Konsumen Pulau Morotai' },
    ]);

    await rebuildEntityIndex();
    const index = getEntityIndex();

    // Should include multi-word regional entities from the corpus
    expect(index).toEqual(expect.arrayContaining([
      'maluku utara',
      'kota ternate',
      'kabupaten halmahera tengah',
      'kepulauan sula',
      'pulau morotai',
    ]));
  });

  test('handles empty corpus', async () => {
    DataSource.findAll.mockResolvedValueOnce([]);
    await rebuildEntityIndex();
    expect(getEntityIndex()).toEqual([]);
  });

  test('deduplicates identical entities', async () => {
    DataSource.findAll.mockResolvedValueOnce([
      { name: 'Data A Kota Ternate 2020' },
      { name: 'Data B Kota Ternate 2021' },
      { name: 'Data C Kota Ternate 2022' },
    ]);
    await rebuildEntityIndex();
    const index = getEntityIndex();
    const tenarteCount = index.filter((e) => e === 'kota ternate').length;
    expect(tenarteCount).toBe(1);
  });
});

describe('resolvePrefixAlias', () => {
  const { resolvePrefixAlias, _setIndexForTesting } = require('../services/search/entityResolver');

  beforeAll(() => {
    _setIndexForTesting([
      'maluku utara',
      'halmahera utara',
      'halmahera selatan',
      'halmahera tengah',
      'halmahera barat',
      'halmahera timur',
      'tidore kepulauan',
      'kepulauan sula',
      'pulau morotai',
      'pulau taliabu',
      'kota ternate',
    ]);
  });

  test.each([
    ['halut',   'halmahera utara'],
    ['halsel',  'halmahera selatan'],
    ['halteng', 'halmahera tengah'],
    ['halbar',  'halmahera barat'],
    ['haltim',  'halmahera timur'],
    ['tikep',   'tidore kepulauan'],
    ['pulmor',  'pulau morotai'],
    ['kepsul',  'kepulauan sula'],
    ['pultal',  'pulau taliabu'],
    ['malut',   'maluku utara'],
  ])('resolves concatenated-prefix alias "%s" → "%s"', (alias, expected) => {
    expect(resolvePrefixAlias(alias)).toBe(expected);
  });

  test('returns null for tokens with spaces', () => {
    expect(resolvePrefixAlias('hal ut')).toBe(null);
  });

  test('returns null for tokens shorter than 5 chars', () => {
    expect(resolvePrefixAlias('hal')).toBe(null);
  });

  test('returns null when no match', () => {
    expect(resolvePrefixAlias('xyzzy')).toBe(null);
  });

  test('does not match single-word entities', () => {
    _setIndexForTesting(['indonesia']);
    expect(resolvePrefixAlias('ind')).toBe(null);  // single-word entity, algorithm requires ≥2 words
  });
});

describe('resolveGeo (tiered)', () => {
  const { resolveGeo, _setIndexForTesting } = require('../services/search/entityResolver');

  beforeEach(() => {
    _setIndexForTesting([
      'maluku utara',
      'halmahera utara',
      'halmahera selatan',
      'pulau morotai',
      'kota ternate',
      'kabupaten halmahera tengah',
    ]);
  });

  test('Tier 1: exact substring match', () => {
    expect(resolveGeo('pengangguran maluku utara 2024')).toContain('maluku utara');
    expect(resolveGeo('kemiskinan kota ternate')).toContain('kota ternate');
  });

  test('Tier 2: prefix-alias for abbreviation', () => {
    expect(resolveGeo('tpt halut 2024')).toContain('halmahera utara');
    expect(resolveGeo('inflasi pulmor')).toContain('pulau morotai');
  });

  test('Tier 3: Levenshtein for single-word typo in multi-word entity', () => {
    // "tenarte" → "ternate" (single edit)
    expect(resolveGeo('inflasi kota tenarte')).toContain('kota ternate');
  });

  test('multiple matches from the query', () => {
    const result = resolveGeo('perbandingan halmahera utara dan halmahera selatan');
    expect(result).toContain('halmahera utara');
    expect(result).toContain('halmahera selatan');
  });

  test('returns empty array when no entity matches', () => {
    expect(resolveGeo('halo apa kabar')).toEqual([]);
  });

  test('empty query returns empty array', () => {
    expect(resolveGeo('')).toEqual([]);
  });
});
