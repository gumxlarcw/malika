'use strict';

// Knowledge documents carry no publication date — knowledge_base has none, and
// created_at is the ingest timestamp. The period lives only in the title, which
// 97% of chunks carry (2657 month+year, 1227 year-only, 116 none out of a
// 4000-title sample).

const { parseDocPeriod, orderKnowledgeDocsByPeriod } = require('../chatUtils');

describe('parseDocPeriod', () => {
  test('reads month and year from a BRS title', () => {
    expect(parseDocPeriod('Tingkat Kemiskinan Maluku Utara September 2017 adalah sebesar 6,44 persen'))
      .toMatchObject({ year: 2017, month: 9, key: 201709, label: 'September 2017' });
  });

  test('reads a title with a chunk suffix', () => {
    expect(parseDocPeriod('Profil Kemiskinan di Maluku Utara Maret 2023 (3/5) — Tabel 5'))
      .toMatchObject({ year: 2023, month: 3, label: 'Maret 2023' });
  });

  test('reads an "Edisi <bulan> <tahun>" title', () => {
    expect(parseDocPeriod('Statistik Provinsi Maluku Utara Edisi Juli 2018 (7/20)'))
      .toMatchObject({ year: 2018, month: 7 });
  });

  test('falls back to a bare year when no month is present', () => {
    expect(parseDocPeriod('Profil Kemiskinan Provinsi Maluku Utara 2023 (9/16)'))
      .toMatchObject({ year: 2023, month: 0, key: 202300, label: '2023' });
  });

  // A title may name a range ("Maret 2012–September 2017"). The document is
  // about its newest period, so the latest mention wins — taking the first
  // would date a 2017 release to 2012.
  test('takes the latest period when the title spans a range', () => {
    expect(parseDocPeriod('Perkembangan Penduduk Miskin Maret 2012–September 2017'))
      .toMatchObject({ year: 2017, month: 9 });
  });

  test('returns null for an undated title', () => {
    expect(parseDocPeriod('Pengenaan Tarif Layanan Nol Rupiah (2/5)')).toBeNull();
  });

  test('is not fooled by chunk counters or other stray digits', () => {
    expect(parseDocPeriod('Panduan Layanan (12/30)')).toBeNull();
  });

  test('survives empty and non-string input', () => {
    expect(parseDocPeriod('')).toBeNull();
    expect(parseDocPeriod(null)).toBeNull();
    expect(parseDocPeriod(undefined)).toBeNull();
  });
});

describe('orderKnowledgeDocsByPeriod', () => {
  const older = { title: 'Tingkat Kemiskinan Maluku Utara September 2017', similarity: 0.880 };
  const newer = { title: 'Profil Kemiskinan di Maluku Utara Maret 2023', similarity: 0.884 };
  const undated = { title: 'Pengenaan Tarif Layanan Nol Rupiah (2/5)', similarity: 0.877 };

  test('prefers the newer document when similarities are near-tied', () => {
    // The live failure: 0.884 vs 0.880 — a 0.004 gap decided by nothing.
    const out = orderKnowledgeDocsByPeriod([older, newer], {});
    expect(out[0].title).toContain('Maret 2023');
  });

  test('leaves a clearly more relevant document on top', () => {
    const strong = { title: 'Tingkat Kemiskinan Maluku Utara September 2017', similarity: 0.95 };
    const weak = { title: 'Profil Kemiskinan di Maluku Utara Maret 2023', similarity: 0.60 };
    const out = orderKnowledgeDocsByPeriod([strong, weak], {});
    expect(out[0].title).toContain('September 2017');
  });

  // The safeguard that matters: asking about 2017 must not be answered with 2023.
  test('an explicit year in the question outranks recency', () => {
    const out = orderKnowledgeDocsByPeriod([newer, older], { requestedYear: 2017 });
    expect(out[0].title).toContain('September 2017');
  });

  test('an explicit year with no matching document changes nothing', () => {
    const out = orderKnowledgeDocsByPeriod([newer, older], { requestedYear: 1999 });
    expect(out.map(d => d.title)).toEqual([newer.title, older.title]);
  });

  test('undated documents keep their place rather than being promoted', () => {
    const out = orderKnowledgeDocsByPeriod([older, undated, newer], {});
    expect(out[0].title).toContain('Maret 2023');
    expect(out.map(d => d.title)).toContain(undated.title);
  });

  test('returns a copy and never mutates the caller array', () => {
    const input = [older, newer];
    const snapshot = [...input];
    orderKnowledgeDocsByPeriod(input, {});
    expect(input).toEqual(snapshot);
  });

  test('handles empty and single-element input', () => {
    expect(orderKnowledgeDocsByPeriod([], {})).toEqual([]);
    expect(orderKnowledgeDocsByPeriod([newer], {})).toEqual([newer]);
    expect(orderKnowledgeDocsByPeriod(null, {})).toEqual([]);
  });
});
