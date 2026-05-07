import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureDataLinkQuery, ensureDataLinkType } from '../src/lib/dataLink';

test('ensureDataLinkType adds explicit type', () => {
  const href = '/data?source_id=10&period=2024';
  const next = ensureDataLinkType(href, 'interop');
  assert.ok(next.startsWith('/data?'));
  const sp = new URLSearchParams(next.slice('/data?'.length));
  assert.equal(sp.get('type'), 'interop');
  assert.equal(sp.get('source_id'), '10');
  assert.equal(sp.get('period'), '2024');
});

test('ensureDataLinkType overwrites existing type (safety)', () => {
  const href = '/data?source_id=10&type=dynamic&period=2024';
  const next = ensureDataLinkType(href, 'interop');
  const sp = new URLSearchParams(next.slice('/data?'.length));
  assert.equal(sp.get('type'), 'interop');
});

test('ensureDataLinkQuery adds q when missing', () => {
  const href = '/data?source_id=10&type=dynamic&period=2024';
  const next = ensureDataLinkQuery(href, 'inflasi maluku utara 2024');
  const sp = new URLSearchParams(next.slice('/data?'.length));
  assert.equal(sp.get('q'), 'inflasi maluku utara 2024');
});

test('ensureDataLinkQuery does not overwrite existing q', () => {
  const href = '/data?source_id=10&type=dynamic&period=2024&q=old';
  const next = ensureDataLinkQuery(href, 'new');
  const sp = new URLSearchParams(next.slice('/data?'.length));
  assert.equal(sp.get('q'), 'old');
});
