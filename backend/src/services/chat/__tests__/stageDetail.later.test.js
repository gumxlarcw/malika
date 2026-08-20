'use strict';

// The five stages that come after retrieval. Split from stageDetail.test.js only
// to keep each file readable; same module, same contract.

const {
  formatDnaDetail,
  formatThinkingDetail,
  formatDeepdiveDetail,
  formatGeneratingDetail,
  formatFormatDetail,
} = require('../stageDetail');

describe('formatDnaDetail', () => {
  test('names the fast path when the query skipped RAG', () => {
    expect(formatDnaDetail({
      originalQuery: 'data penduduk',
      normalizedQuery: 'data penduduk',
      usedFastPath: true,
    })).toBe('jalur cepat · data penduduk');
  });

  test('says the query was normalized when it changed', () => {
    expect(formatDnaDetail({
      originalQuery: 'tpt halbar',
      normalizedQuery: 'tingkat pengangguran terbuka Halmahera Barat',
      usedFastPath: false,
    })).toBe('dinormalkan · tingkat pengangguran terbuka Halmahera Barat');
  });

  test('reports the query unchanged when normalization was a no-op', () => {
    expect(formatDnaDetail({
      originalQuery: 'garis kemiskinan',
      normalizedQuery: 'garis kemiskinan',
      usedFastPath: false,
    })).toBe('garis kemiskinan');
  });

  test('clips a long query rather than flooding the rail row', () => {
    const long = 'a'.repeat(200);
    const out = formatDnaDetail({ originalQuery: long, normalizedQuery: long, usedFastPath: false });
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('formatThinkingDetail', () => {
  test('names the tier and the token budget with Indonesian thousands', () => {
    expect(formatThinkingDetail({ tier: 'lengkap', maxTokens: 2400 }))
      .toBe('tier lengkap · anggaran 2.400 token');
  });

  test('falls back to the budget alone when no tier was named', () => {
    expect(formatThinkingDetail({ tier: null, maxTokens: 1000 }))
      .toBe('anggaran 1.000 token');
  });
});

describe('formatDeepdiveDetail', () => {
  test('measures the reasoning trace in Indonesian thousands', () => {
    expect(formatDeepdiveDetail('x'.repeat(1240))).toBe('jejak nalar 1.240 karakter');
  });

  test('reports an absent trace rather than a zero', () => {
    expect(formatDeepdiveDetail('')).toBe('tanpa jejak nalar');
  });
});

describe('formatGeneratingDetail', () => {
  test('reports answer length and the model that actually served it', () => {
    expect(formatGeneratingDetail({ text: 'y'.repeat(820), model: 'deepseek-v4' }))
      .toBe('820 karakter · deepseek-v4');
  });

  test('omits the model when the proxy named none', () => {
    expect(formatGeneratingDetail({ text: 'y'.repeat(300), model: null }))
      .toBe('300 karakter');
  });
});

describe('formatFormatDetail', () => {
  test('reports the table and suggestion counts it built', () => {
    const uiMeta = {
      table: { kind: 'data', rows: [1, 2, 3], columns: ['a', 'b'] },
      suggestions: ['s1', 's2', 's3'],
    };
    expect(formatFormatDetail(uiMeta)).toBe('tabel 3×2 · 3 saran');
  });

  test('reports suggestions alone when no table was built', () => {
    expect(formatFormatDetail({ table: null, suggestions: ['s1'] })).toBe('1 saran');
  });

  test('reports a bare answer when there is neither', () => {
    expect(formatFormatDetail({})).toBe('jawaban teks');
  });
});
