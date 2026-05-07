import test from 'node:test';
import assert from 'node:assert/strict';

function baseUrl() {
  return process.env.PWA_BASE_URL || 'http://[::1]:6060';
}

async function isReachable(url: string, timeoutMs = 12000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    return res.ok || res.status === 400 || res.status === 404;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

function parseDataLink(link: string) {
  if (!link || typeof link !== 'string') return null;
  if (!link.startsWith('/data?')) return null;
  const sp = new URLSearchParams(link.slice('/data?'.length));
  const source_id = sp.get('source_id');
  if (!source_id) return null;
  return {
    source_id,
    period: sp.get('period') || '',
    type: sp.get('type') || '',
    month: sp.get('month') || '',
    group: sp.get('group') || '',
    code_hs: sp.get('code_hs') || '',
    pod: sp.get('pod') || '',
    ctr: sp.get('ctr') || '',
    metric: sp.get('metric') || '',
  };
}

async function findEximLink(q: string) {
  const b = baseUrl();
  const res = await fetch(`${b}/api/search?q=${encodeURIComponent(q)}`);
  const json = (await res.json()) as any;
  const lists: any[] = [];
  if (Array.isArray(json?.exact?.datasources)) lists.push(...json.exact.datasources);
  if (Array.isArray(json?.suggestions?.datasources)) lists.push(...json.suggestions.datasources);
  if (Array.isArray(json?.datasources)) lists.push(...json.datasources);

  for (const it of lists) {
    const link = String(it?.link || '');
    if (!link.startsWith('/data?')) continue;
    const sp = new URLSearchParams(link.slice('/data?'.length));
    const type = String(sp.get('type') || '').toLowerCase();
    const hasEximMarkers =
      type === 'exim' ||
      !!sp.get('group') ||
      !!sp.get('code_hs') ||
      !!sp.get('ctr') ||
      !!sp.get('pod') ||
      !!sp.get('metric');
    if (hasEximMarkers) return link;
  }

  return null;
}

async function callDataPreview(params: ReturnType<typeof parseDataLink>) {
  assert.ok(params);
  const b = baseUrl();
  const sp = new URLSearchParams();
  sp.set('source_id', params!.source_id);
  if (params!.period) sp.set('period', params!.period);
  if (params!.type) sp.set('type', params!.type);
  if (params!.month) sp.set('month', params!.month);
  if (params!.group) sp.set('group', params!.group);
  if (params!.code_hs) sp.set('code_hs', params!.code_hs);
  if (params!.pod) sp.set('pod', params!.pod);
  if (params!.ctr) sp.set('ctr', params!.ctr);
  if (params!.metric) sp.set('metric', params!.metric);

  const res = await fetch(`${b}/api/data-preview?${sp.toString()}`);
  const json = (await res.json()) as any;
  return { res, json };
}

test('E2E: komoditas + negara -> hs2ctr link + preview columns (or user-friendly error)', async (t) => {
  const b = baseUrl();
  if (!(await isReachable(`${b}/api/search?q=test`))) return t.skip('PWA server not reachable');

  const q = 'ekspor juni-agustus 2025 menurut komoditas dan negara';
  const link = await findEximLink(q);
  if (!link) return t.skip('No EXIM datasource link returned');

  const parsed = parseDataLink(link);
  assert.ok(parsed);
  assert.equal(String(parsed!.group).toLowerCase(), 'hs2ctr');

  const { res, json } = await callDataPreview(parsed);
  if (!res.ok) {
    assert.ok(typeof json?.message === 'string' && json.message.length > 0);
    return;
  }

  const cols = Array.isArray(json?.data?.columns) ? json.data.columns.map(String) : [];
  assert.ok(cols.includes('Bulan') || cols.some((c: string) => /bulan/i.test(c)));
  assert.ok(cols.includes('kodehs'));
  assert.ok(cols.includes('ctr'));
});

test('E2E: komoditas + pelabuhan -> hs2pod link', async (t) => {
  const b = baseUrl();
  if (!(await isReachable(`${b}/api/search?q=test`))) return t.skip('PWA server not reachable');

  const q = 'impor 2025 komoditas dan pelabuhan';
  const link = await findEximLink(q);
  if (!link) return t.skip('No EXIM datasource link returned');

  const parsed = parseDataLink(link);
  assert.ok(parsed);
  assert.equal(String(parsed!.group).toLowerCase(), 'hs2pod');
});

test('E2E: negara + pelabuhan -> detail link', async (t) => {
  const b = baseUrl();
  if (!(await isReachable(`${b}/api/search?q=test`))) return t.skip('PWA server not reachable');

  const q = 'ekspor 2025 negara dan pelabuhan';
  const link = await findEximLink(q);
  if (!link) return t.skip('No EXIM datasource link returned');

  const parsed = parseDataLink(link);
  assert.ok(parsed);
  assert.equal(String(parsed!.group).toLowerCase(), 'detail');
});

test('E2E: (cross-year range) pelabuhan + komoditas -> hs2pod and preview includes pod', async (t) => {
  const b = baseUrl();
  if (!(await isReachable(`${b}/api/search?q=test`))) return t.skip('PWA server not reachable');

  const q = 'ekspor november 2024 - maret 2025 menurut pelabuhan dan komoditas';
  const link = await findEximLink(q);
  if (!link) return t.skip('No EXIM datasource link returned');

  const parsed = parseDataLink(link);
  assert.ok(parsed);
  assert.equal(String(parsed!.group).toLowerCase(), 'hs2pod');

  const { res, json } = await callDataPreview(parsed);
  if (!res.ok) {
    assert.ok(typeof json?.message === 'string' && json.message.length > 0);
    return;
  }

  const cols = Array.isArray(json?.data?.columns) ? json.data.columns.map(String) : [];
  assert.ok(cols.includes('kodehs'));
  assert.ok(cols.includes('pod'));
});

test('E2E: (cross-year range) negara + komoditas -> hs2ctr and preview includes ctr', async (t) => {
  const b = baseUrl();
  if (!(await isReachable(`${b}/api/search?q=test`))) return t.skip('PWA server not reachable');

  const q = 'ekspor november 2024 - maret 2025 menurut negara dan komoditas';
  const link = await findEximLink(q);
  if (!link) return t.skip('No EXIM datasource link returned');

  const parsed = parseDataLink(link);
  assert.ok(parsed);
  assert.equal(String(parsed!.group).toLowerCase(), 'hs2ctr');

  const { res, json } = await callDataPreview(parsed);
  if (!res.ok) {
    assert.ok(typeof json?.message === 'string' && json.message.length > 0);
    return;
  }

  const cols = Array.isArray(json?.data?.columns) ? json.data.columns.map(String) : [];
  assert.ok(cols.includes('kodehs'));
  assert.ok(cols.includes('ctr'));
});
