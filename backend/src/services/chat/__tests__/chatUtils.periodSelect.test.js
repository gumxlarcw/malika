'use strict';

// Knowledge retrieval fetched 3 documents and then re-ranked those 3 by period,
// so when the right period sat at rank 11 or 47 there was nothing to promote.
// Measured over 15 labelled cases: the document that actually answers is always
// within 0.021 cosine of the top hit (median 0.0098) — it is present and near,
// just not first. selectDocsByPeriod reorders a wide candidate pool by period
// before it is trimmed to the prompt budget.

const { selectDocsByPeriod } = require('../chatUtils');

const doc = (title, similarity) => ({ title, similarity });

describe('selectDocsByPeriod', () => {
  test('promotes the document whose month and year match the question', () => {
    const docs = [
      doc('Jumlah penduduk miskin di Maluku Utara pada Maret 2021 sebesar 6,38 persen', 0.890),
      doc('Profil Kemiskinan di Maluku Utara Maret 2023', 0.889),
      doc('Persentase Penduduk Miskin Maret 2025 turun menjadi 5,81 persen', 0.883),
    ];
    const out = selectDocsByPeriod(docs, { year: 2025, month: 3, limit: 3 });
    expect(out[0].title).toMatch(/Maret 2025/);
  });

  test('prefers the same year when the question names no month', () => {
    const docs = [
      doc('Ekonomi Maluku Utara Triwulan III 2020 Tumbuh 6,66 Persen', 0.894),
      doc('Ekonomi Maluku Utara Triwulan III-2025 Tumbuh 2,59 Persen', 0.891),
    ];
    const out = selectDocsByPeriod(docs, { year: 2025, limit: 2 });
    expect(out[0].title).toMatch(/2025/);
  });

  test('leaves the order alone when the question names no period', () => {
    const docs = [doc('A Maret 2019', 0.9), doc('B Maret 2025', 0.8), doc('C', 0.7)];
    const out = selectDocsByPeriod(docs, { limit: 3 });
    expect(out.map(d => d.title)).toEqual(['A Maret 2019', 'B Maret 2025', 'C']);
  });

  test('does not promote a matching document that is far less relevant', () => {
    // A 2025 document about something else must not outrank a near-tie on topic.
    // Measured band: the right answer is always within 0.021 of the top hit.
    const docs = [
      doc('Profil Kemiskinan Maluku Utara Maret 2023', 0.890),
      doc('Statistik Pemotongan Ternak Provinsi Maluku Utara 2025', 0.700),
    ];
    const out = selectDocsByPeriod(docs, { year: 2025, limit: 2, band: 0.03 });
    expect(out[0].title).toMatch(/Kemiskinan/);
  });

  test('leaves a wrong-period and an undated document in similarity order', () => {
    // Neither is promoted: an unknown period is not evidence of being wrong, and
    // demoting a stated mismatch was measured to change nothing on the labelled
    // set while risking exactly the failure in the next test.
    const docs = [
      doc('Laporan Kemiskinan Maluku Utara Maret 2019', 0.890),
      doc('Pedoman Umum Statistik Kemiskinan', 0.888),
    ];
    const out = selectDocsByPeriod(docs, { year: 2025, limit: 2 });
    expect(out.map(d => d.title)).toEqual([
      'Laporan Kemiskinan Maluku Utara Maret 2019',
      'Pedoman Umum Statistik Kemiskinan',
    ]);
  });

  test('treats a compendium titled one year later as a source for the asked year', () => {
    // "Provinsi Maluku Utara Dalam Angka 2017" reports 2016 data. Verified across
    // six editions (2019, 2021, 2023, 2024, 2025, 2026): in every one the year
    // before the title dominates the text roughly 2:1 over its neighbours. Ranking
    // it as a mismatch pushed the chunk holding the 2016 population table from
    // rank 11 down to 23.
    const docs = [
      doc('Statistik Daerah Provinsi Maluku Utara 2019', 0.880),
      doc('Provinsi Maluku Utara Dalam Angka 2017', 0.875),
    ];
    const out = selectDocsByPeriod(docs, { year: 2016, limit: 2 });
    expect(out[0].title).toMatch(/Dalam Angka 2017/);
  });

  test('does not rank an exact-year title above the compendium that reports it', () => {
    // For a year-only question both are legitimate sources and the title says
    // nothing about which is better, so similarity decides rather than the label.
    const docs = [
      doc('Provinsi Maluku Utara Dalam Angka 2017', 0.890),
      doc('Laporan Tahunan 2016', 0.888),
    ];
    const out = selectDocsByPeriod(docs, { year: 2016, limit: 2 });
    expect(out[0].title).toMatch(/Dalam Angka 2017/);
  });

  test('keeps a wrong-period document rather than dropping it', () => {
    // This is a re-rank, not a filter: when nothing matches the requested period
    // the best available answer must still be offered.
    const docs = [doc('Kemiskinan Maret 2019', 0.9), doc('Kemiskinan Maret 2018', 0.8)];
    const out = selectDocsByPeriod(docs, { year: 2025, limit: 2 });
    expect(out).toHaveLength(2);
  });

  test('trims to the requested limit', () => {
    const docs = [doc('A 2025', 0.9), doc('B 2025', 0.89), doc('C 2025', 0.88)];
    expect(selectDocsByPeriod(docs, { year: 2025, limit: 2 })).toHaveLength(2);
  });

  test('same year but a different month ranks below an exact match', () => {
    const docs = [
      doc('Inflasi Kota Ternate September 2025', 0.890),
      doc('Inflasi Kota Ternate Maret 2025', 0.889),
    ];
    const out = selectDocsByPeriod(docs, { year: 2025, month: 3, limit: 2 });
    expect(out[0].title).toMatch(/Maret 2025/);
  });

  test('survives empty and malformed input', () => {
    expect(selectDocsByPeriod([], { year: 2025, limit: 3 })).toEqual([]);
    expect(selectDocsByPeriod(null, { year: 2025, limit: 3 })).toEqual([]);
  });
});

describe('selectDocsByPeriod without a requested period', () => {
  test('keeps the recency preference for near-ties (2026-08-18 behaviour)', () => {
    // Cosine has no notion of time: a September 2017 profile and a Maret 2023 one
    // scored 0.880 vs 0.884 and the older won by four thousandths. That fix lives
    // in orderKnowledgeDocsByPeriod and must survive the period-aware path.
    const docs = [
      { title: 'Profil Kemiskinan di Maluku Utara September 2017', similarity: 0.884 },
      { title: 'Profil Kemiskinan di Maluku Utara Maret 2023', similarity: 0.880 },
    ];
    const out = selectDocsByPeriod(docs, { limit: 2 });
    expect(out[0].title).toMatch(/Maret 2023/);
  });

  test('does not reorder when the similarity gap is wide', () => {
    const docs = [
      { title: 'Profil Kemiskinan September 2017', similarity: 0.90 },
      { title: 'Profil Kemiskinan Maret 2023', similarity: 0.60 },
    ];
    const out = selectDocsByPeriod(docs, { limit: 2 });
    expect(out[0].title).toMatch(/September 2017/);
  });
});

describe('the compendium tolerance is limited to undated-month publications', () => {
  test('does not treat a dated release from the next year as the asked year', () => {
    // Caught live: "komoditas … garis kemiskinan Maret 2025" was answered from
    // Profil Kemiskinan Maret 2026. The year+1 rule is about annual compendia
    // titled by publication year ("Dalam Angka 2017" reports 2016); a title that
    // names its month has already said exactly which period it covers and must
    // not be pulled forward.
    const docs = [
      { title: 'Persentase Penduduk Miskin Maret 2026 sebesar 5,79 persen', similarity: 0.882 },
      { title: 'Persentase Penduduk Miskin Maret 2025 turun menjadi 5,81 persen', similarity: 0.878 },
    ];
    const out = selectDocsByPeriod(docs, { year: 2025, month: 3, limit: 2 });
    expect(out[0].title).toMatch(/Maret 2025/);
  });

  test('still allows the tolerance for an annual title carrying no month', () => {
    const docs = [
      { title: 'Laporan Lain 2019', similarity: 0.880 },
      { title: 'Provinsi Maluku Utara Dalam Angka 2017', similarity: 0.876 },
    ];
    const out = selectDocsByPeriod(docs, { year: 2016, limit: 2 });
    expect(out[0].title).toMatch(/Dalam Angka 2017/);
  });
});

describe('the compendium tolerance does not apply to dated releases', () => {
  test('a next-year dated release is not promoted over an undated relevant one', () => {
    // The earlier test passed only because an exact match outscored it. On its own
    // "Maret 2026" must not be treated as a source for Maret 2025 at all — the
    // year+1 rule is about annual compendia titled by publication year.
    const docs = [
      { title: 'Pedoman Penghitungan Garis Kemiskinan', similarity: 0.880 },
      { title: 'Persentase penduduk miskin pada Maret 2026 sebesar 5,79 persen', similarity: 0.878 },
    ];
    const out = selectDocsByPeriod(docs, { year: 2025, month: 3, limit: 2 });
    expect(out[0].title).toMatch(/Pedoman/);
  });
});
