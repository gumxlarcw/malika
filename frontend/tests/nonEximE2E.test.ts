import test from 'node:test';
import assert from 'node:assert/strict';

function baseUrl() {
  return process.env.PWA_BASE_URL || 'http://127.0.0.1:6060';
}

function firstDataLink(items: any[]): string | null {
  for (const it of items) {
    if (it && typeof it.link === 'string' && it.link.startsWith('/data?')) return it.link;
  }
  return null;
}

test('non-EXIM search returns explicit type and preserves year/geo when present', async () => {
  const q = 'inflasi kota ternate 2025';
  const res = await fetch(`${baseUrl()}/api/search?q=${encodeURIComponent(q)}`);
  assert.equal(res.ok, true);

  const json: any = await res.json();
  const items: any[] = Array.isArray(json?.datasources) ? json.datasources : [];
  assert.ok(items.length > 0, 'expected at least one datasource result');

  // When the query already has a year, the UX should not ask the user to add one.
  const subtitle = typeof items[0]?.subtitle === 'string' ? items[0].subtitle : '';
  assert.ok(!subtitle.toLowerCase().includes('tambahkan tahun'));

  const link = firstDataLink(items);
  assert.ok(link, 'expected a /data deeplink in results');

  const u = new URL(link, baseUrl());
  const type = u.searchParams.get('type');
  assert.ok(type && type.length > 0, 'expected type to be present');
  assert.notEqual(type, 'exim');

  // When the query includes a valid year, the deeplink should preserve it.
  const period = u.searchParams.get('period');
  assert.equal(period, '2025');

  // Geo is best-effort; if present, it must not be empty.
  const geo = u.searchParams.get('geo');
  if (geo !== null) assert.ok(geo.trim().length > 0);
});
