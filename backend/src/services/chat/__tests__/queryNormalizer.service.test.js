'use strict';
const {
  splitConcatenated,
  lightNormalize,
} = require('../queryNormalizer.service');

describe('splitConcatenated', () => {
  test('splits the canonical 2026-05-11 miss', () => {
    expect(splitConcatenated('pertumbuhanekonomi')).toBe('pertumbuhan ekonomi');
  });

  test('splits inside a multi-word query', () => {
    expect(splitConcatenated('pertumbuhanekonomi maluku utara triwulan 1 2025'))
      .toBe('pertumbuhan ekonomi maluku utara triwulan 1 2025');
  });

  test('matches case-insensitively (lowercases the match)', () => {
    expect(splitConcatenated('PertumbuhanEkonomi malut').toLowerCase())
      .toBe('pertumbuhan ekonomi malut');
  });

  test('does not split already-spaced phrases', () => {
    expect(splitConcatenated('pertumbuhan ekonomi malut'))
      .toBe('pertumbuhan ekonomi malut');
  });

  test('leaves non-dictionary words alone', () => {
    expect(splitConcatenated('xyzabc')).toBe('xyzabc');
  });

  test('splits multiple known concatenations in one query', () => {
    expect(splitConcatenated('kondisiekonomi dan pertumbuhanekonomi'))
      .toBe('kondisi ekonomi dan pertumbuhan ekonomi');
  });

  test('null/undefined safe', () => {
    expect(splitConcatenated(null)).toBe('');
    expect(splitConcatenated(undefined)).toBe('');
    expect(splitConcatenated('')).toBe('');
  });

  test('does not split when a known concatenation has an Indonesian suffix', () => {
    // \b regex must protect against future regression where someone "fixes"
    // the boundary handling. Words like "pertumbuhanekonominya" (-nya suffix)
    // should NOT be split — the suffix means there's no word boundary.
    expect(splitConcatenated('pertumbuhanekonominya')).toBe('pertumbuhanekonominya');
  });
});

describe('lightNormalize integration', () => {
  test('lightNormalize applies splitConcatenated', () => {
    const out = lightNormalize('pertumbuhanekonomi maluku utara triwulan 1 2025');
    expect(out.toLowerCase()).toContain('pertumbuhan ekonomi');
  });

  test('lightNormalize still fixes existing typos', () => {
    const out = lightNormalize('kemikinan halsel');
    expect(out.toLowerCase()).toContain('kemiskinan');
  });
});
