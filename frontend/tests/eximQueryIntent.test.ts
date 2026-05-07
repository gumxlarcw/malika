import test from 'node:test';
import assert from 'node:assert/strict';

import { filterEximColumnsForQuery, inferEximGroupFromQuery } from '../src/lib/eximQueryIntent';

test('inferEximGroupFromQuery: hs2ctr', () => {
  assert.equal(
    inferEximGroupFromQuery('ekspor juni-agustus 2025 menurut komoditas dan negara'),
    'hs2ctr'
  );
  assert.equal(
    inferEximGroupFromQuery('ekspor juni-agustus 2025 berdasarkan komoditas dan negara'),
    'hs2ctr'
  );
  assert.equal(
    inferEximGroupFromQuery('ekspor juni-agustus 2025 per komoditas dan negara'),
    'hs2ctr'
  );
  assert.equal(
    inferEximGroupFromQuery('ekspor juni-agustus 2025 komoditas dan negara'),
    'hs2ctr'
  );
  assert.equal(
    inferEximGroupFromQuery('ekspor juni-agustus 2025 komoditas & negara'),
    'hs2ctr'
  );
  assert.equal(
    inferEximGroupFromQuery('ekspor 2025 berdasarkan hs code dan country'),
    'hs2ctr'
  );
  assert.equal(
    inferEximGroupFromQuery('impor 2025 menurut negara dan komoditas'),
    'hs2ctr'
  );
  assert.equal(
    inferEximGroupFromQuery('ekspor 2025 menurut hs2 dan negara'),
    'hs2ctr'
  );
});

test('inferEximGroupFromQuery: hs2pod', () => {
  assert.equal(
    inferEximGroupFromQuery('ekspor 2025 menurut komoditas dan pelabuhan'),
    'hs2pod'
  );
  assert.equal(
    inferEximGroupFromQuery('ekspor 2025 komoditas dan pelabuhan'),
    'hs2pod'
  );
  assert.equal(
    inferEximGroupFromQuery('impor 2025 menurut hs2 dan pelabuhan'),
    'hs2pod'
  );
});

test('inferEximGroupFromQuery: detail', () => {
  assert.equal(
    inferEximGroupFromQuery('ekspor 2025 menurut negara dan pelabuhan'),
    'detail'
  );
  assert.equal(
    inferEximGroupFromQuery('ekspor 2025 negara dan pelabuhan'),
    'detail'
  );
  assert.equal(
    inferEximGroupFromQuery('impor 2025 menurut pelabuhan dan negara'),
    'detail'
  );
});

test('inferEximGroupFromQuery: solo groups', () => {
  assert.equal(inferEximGroupFromQuery('ekspor 2025 menurut negara'), 'ctr');
  assert.equal(inferEximGroupFromQuery('ekspor 2025 menurut pelabuhan'), 'pod');
  assert.equal(inferEximGroupFromQuery('ekspor 2025 menurut komoditas'), 'hs2');
  assert.equal(inferEximGroupFromQuery('impor 2025 menurut hs2'), 'hs2');
});

test('filterEximColumnsForQuery respects combined groups even without query text', () => {
  const cols = ['Bulan', 'kodehs', 'ctr', 'pod', 'value', 'netweight'];

  assert.deepEqual(
    filterEximColumnsForQuery(cols, '', { group: 'hs2ctr' }),
    ['Bulan', 'kodehs', 'ctr', 'value', 'netweight']
  );

  assert.deepEqual(
    filterEximColumnsForQuery(cols, '', { group: 'hs2pod' }),
    ['Bulan', 'kodehs', 'pod', 'value', 'netweight']
  );

  assert.deepEqual(
    filterEximColumnsForQuery(cols, '', { group: 'detail' }),
    ['Bulan', 'ctr', 'pod', 'value', 'netweight']
  );
});

test('filterEximColumnsForQuery: metric selection by query', () => {
  const cols = ['Bulan', 'kodehs', 'ctr', 'pod', 'value', 'netweight'];

  // Default: show both metrics.
  assert.deepEqual(
    filterEximColumnsForQuery(cols, 'impor maluku utara', { group: 'ctr' }),
    ['Bulan', 'ctr', 'value', 'netweight']
  );

  // Explicit value.
  assert.deepEqual(
    filterEximColumnsForQuery(cols, 'nilai impor maluku utara', { group: 'ctr' }),
    ['Bulan', 'ctr', 'value']
  );

  // Explicit netweight.
  assert.deepEqual(
    filterEximColumnsForQuery(cols, 'volume impor maluku utara', { group: 'ctr' }),
    ['Bulan', 'ctr', 'netweight']
  );

  // If user asks for both, keep both.
  assert.deepEqual(
    filterEximColumnsForQuery(cols, 'nilai dan volume impor maluku utara', { group: 'ctr' }),
    ['Bulan', 'ctr', 'value', 'netweight']
  );
});

test('filterEximColumnsForQuery: metric selection by params.metric', () => {
  const cols = ['Bulan', 'kodehs', 'ctr', 'pod', 'value', 'netweight'];
  assert.deepEqual(
    filterEximColumnsForQuery(cols, 'impor maluku utara', { group: 'ctr', metric: 'value' }),
    ['Bulan', 'ctr', 'value']
  );
  assert.deepEqual(
    filterEximColumnsForQuery(cols, 'impor maluku utara', { group: 'ctr', metric: 'netweight' }),
    ['Bulan', 'ctr', 'netweight']
  );
});
