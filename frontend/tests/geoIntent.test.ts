import test from 'node:test';
import assert from 'node:assert/strict';

import { extractGeoFromQuery } from '../src/lib/geoIntent';

test('extractGeoFromQuery: malut shorthand', () => {
  assert.equal(extractGeoFromQuery('inflasi malut 2024'), 'maluku utara');
});

test('extractGeoFromQuery: provinsi phrase', () => {
  assert.equal(extractGeoFromQuery('inflasi provinsi maluku utara tahun 2024'), 'maluku utara');
});

test('extractGeoFromQuery: kota phrase', () => {
  assert.equal(extractGeoFromQuery('tpt kota ternate 2025'), 'ternate');
});

test('extractGeoFromQuery: kabupaten phrase (multi word)', () => {
  assert.equal(extractGeoFromQuery('ipm kabupaten halmahera barat 2023'), 'halmahera barat');
});

test('extractGeoFromQuery: avoid exim words', () => {
  // Should not mistakenly treat "negara" as geo for non-exim.
  assert.notEqual(extractGeoFromQuery('ekspor 2025 negara china'), 'china');
});

test('extractGeoFromQuery: detects pulau taliabu phrase anywhere', () => {
  assert.equal(extractGeoFromQuery('jumlah kamar pulau taliabu'), 'pulau taliabu');
});

test('extractGeoFromQuery: expands halteng shorthand', () => {
  assert.equal(extractGeoFromQuery('inflasi halteng 2024'), 'halmahera tengah');
});

test('extractGeoFromQuery: expands tikep shorthand', () => {
  assert.equal(extractGeoFromQuery('ipm tikep 2024'), 'tidore kepulauan');
});

test('extractGeoFromQuery: expands kepsul shorthand', () => {
  assert.equal(extractGeoFromQuery('kemiskinan kepsul 2024'), 'kepulauan sula');
});

test('extractGeoFromQuery: expands pulmor shorthand', () => {
  assert.equal(extractGeoFromQuery('pdrb pulmor 2024'), 'pulau morotai');
});

test('extractGeoFromQuery: does not treat indicator topic as geo', () => {
  assert.equal(extractGeoFromQuery('jumlah kamar'), '');
  assert.equal(extractGeoFromQuery('jumlah kamar pulau taliabu'), 'pulau taliabu');
});
