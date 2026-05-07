import test from 'node:test';
import assert from 'node:assert/strict';

import { expandBpsKeywordVariants } from '../src/lib/bpsKeyword';

test('expandBpsKeywordVariants: tourism query adds hotel', () => {
  const out = expandBpsKeywordVariants({
    q: 'jumlah kamar pulau taliabu',
    base: ['jumlah kamar pulau taliabu', 'jumlah kamar'],
    datasourceCategories: ['Pariwisata'],
  });
  assert.ok(out.includes('hotel'));
});

test('expandBpsKeywordVariants: keeps list capped', () => {
  const out = expandBpsKeywordVariants({
    q: 'kamar hotel',
    base: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    datasourceCategories: ['Pariwisata'],
  });
  assert.ok(out.length <= 5);
});

test('expandBpsKeywordVariants: strips geo noise from base keywords', () => {
  const out = expandBpsKeywordVariants({
    q: 'gini ratio maluku utara',
    base: ['gini ratio maluku utara'],
  });
  assert.ok(out.includes('gini ratio'));
});

test('expandBpsKeywordVariants: labor query adds broader terms', () => {
  const out = expandBpsKeywordVariants({
    q: 'tpak maluku utara',
    base: ['tpak maluku utara'],
  });
  assert.ok(out.some((k) => k === 'ketenagakerjaan' || k === 'tenaga kerja' || k === 'angkatan kerja'));
});

test('expandBpsKeywordVariants: stunting query adds health terms', () => {
  const out = expandBpsKeywordVariants({
    q: 'stunting maluku utara',
    base: ['stunting maluku utara'],
  });
  assert.ok(out.includes('stunting'));
  assert.ok(out.includes('kesehatan') || out.includes('gizi'));
});

test('expandBpsKeywordVariants: fisheries query adds perikanan/ikan', () => {
  const out = expandBpsKeywordVariants({
    q: 'produksi perikanan maluku utara',
    base: ['produksi perikanan maluku utara'],
  });
  assert.ok(out.includes('perikanan') || out.includes('ikan'));
});

test('expandBpsKeywordVariants: airport passenger query adds air-transport terms', () => {
  const out = expandBpsKeywordVariants({
    q: 'penumpang bandara ternate',
    base: ['penumpang bandara ternate'],
  });
  assert.ok(out.some((k) => k === 'angkutan udara' || k === 'transportasi udara' || k === 'bandara'));
});
