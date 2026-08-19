'use strict';

// The judge is asked to pick 10 documents from the top-20 by cosine, and its
// ranking rules told it to prefer the newest edition of a series regardless of
// what period the question named. For "komoditas … garis kemiskinan perkotaan
// Maret 2025" it recorded, in its own reasoning, that it prioritised the Maret
// 2026 release and dropped the Maret 2025 one — so the period-aware selection
// downstream had nothing left to promote.

const {
  detectQueryPeriod,
  buildUnifiedPrompt,
  detectSeriesGroups,
} = require('../documentJudge.service');

describe('detectQueryPeriod', () => {
  test('reads month and year from a natural question', () => {
    expect(detectQueryPeriod('komoditas garis kemiskinan perkotaan Maret 2025'))
      .toMatchObject({ year: 2025, month: 3, hasExplicit: true });
  });

  test('reads a year with no month', () => {
    expect(detectQueryPeriod('berapa IPM Maluku Utara tahun 2025'))
      .toMatchObject({ year: 2025, month: null, hasExplicit: true });
  });

  test('reads a quarter', () => {
    expect(detectQueryPeriod('pertumbuhan ekonomi triwulan III 2025'))
      .toMatchObject({ year: 2025, quarter: 'III', hasExplicit: true });
  });

  test('reports no explicit period when the question names none', () => {
    expect(detectQueryPeriod('berapa tingkat kemiskinan Maluku Utara'))
      .toMatchObject({ hasExplicit: false });
  });

  test('does not treat "terbaru" as a period', () => {
    expect(detectQueryPeriod('data kemiskinan terbaru').hasExplicit).toBe(false);
  });
});

describe('buildUnifiedPrompt with an explicit period', () => {
  const candidates = [
    { id: 1, title: 'Persentase Penduduk Miskin Maret 2026 sebesar 5,79 persen', content: 'x', similarity: 0.88 },
    { id: 2, title: 'Persentase Penduduk Miskin Maret 2025 turun menjadi 5,81 persen', content: 'y', similarity: 0.87 },
    { id: 3, title: 'Persentase Penduduk Miskin September 2024 turun menjadi 6,03 persen', content: 'z', similarity: 0.86 },
  ];
  const query = 'komoditas garis kemiskinan perkotaan Maret 2025';
  const prompt = () => buildUnifiedPrompt(query, candidates, detectSeriesGroups(candidates));

  test('names the month, not only the year', () => {
    expect(prompt()).toMatch(/Maret 2025/);
  });

  test('does not tell the judge to keep only the newest editions', () => {
    // The series-dedup rule read "pilih HANYA 1-2 edisi terbaru", which is exactly
    // what made it discard the Maret 2025 release.
    expect(prompt()).not.toMatch(/pilih HANYA 1-2 edisi terbaru/);
  });

  test('does not tell the judge to always prefer the newest', () => {
    expect(prompt()).not.toMatch(/SELALU pilih yang terbaru/);
  });

  test('tells the judge the requested period outranks recency', () => {
    expect(prompt()).toMatch(/periode yang diminta|sesuai periode/i);
  });
});

describe('buildUnifiedPrompt without an explicit period', () => {
  const candidates = [
    { id: 1, title: 'Persentase Penduduk Miskin Maret 2026 sebesar 5,79 persen', content: 'x', similarity: 0.88 },
    { id: 2, title: 'Persentase Penduduk Miskin Maret 2025 turun menjadi 5,81 persen', content: 'y', similarity: 0.87 },
  ];
  const prompt = () =>
    buildUnifiedPrompt('berapa tingkat kemiskinan Maluku Utara', candidates, detectSeriesGroups(candidates));

  test('keeps the recency rule when no period was asked for', () => {
    // Without a stated period, newest is the right default and must not be lost.
    expect(prompt()).toMatch(/SELALU pilih yang terbaru/);
  });

  test('keeps series deduplication to the newest editions', () => {
    expect(prompt()).toMatch(/edisi terbaru/);
  });
});

describe('selectJudgeInput', () => {
  // Only MAX_CANDIDATES_INPUT candidates reach the judge and the cut is by cosine.
  // The chunk holding the Maret 2025 commodity table sat at rank 22 and was
  // discarded before the judge could weigh it. This is the production path — the
  // prompt builder receives an already-truncated list, so admission has to be
  // fixed here, not there.
  const { selectJudgeInput } = require('../documentJudge.service');

  const filler = (n, offset = 0) =>
    Array.from({ length: n }, (_, i) => ({
      id: 100 + offset + i,
      title: `Publikasi Umum Statistik Daerah ${2019 + (i % 5)} (${i}/40)`,
      content: 'isi umum',
      category: 'BRS',
      similarity: 0.89 - (offset + i) * 0.0005,
    }));

  const target = {
    id: 999,
    title: 'Persentase Penduduk Miskin Maret 2025 turun menjadi 5,81 persen (4/6)',
    content: 'Beras 25,10',
    category: 'BRS',
    similarity: 0.861,
  };

  test('admits a period-matching document that ranks below the input cut', () => {
    const candidates = [...filler(22), target, ...filler(17, 22)];
    const input = selectJudgeInput('komoditas garis kemiskinan perkotaan Maret 2025', candidates);
    expect(input.map(d => d.id)).toContain(999);
  });

  test('does not admit it when the question names no period', () => {
    const candidates = [...filler(22), target, ...filler(17, 22)];
    const input = selectJudgeInput('komoditas penyumbang garis kemiskinan', candidates);
    expect(input.map(d => d.id)).not.toContain(999);
  });

  test('never returns more than the input cap', () => {
    const candidates = [...filler(22), target, ...filler(17, 22)];
    const input = selectJudgeInput('garis kemiskinan Maret 2025', candidates);
    expect(input.length).toBeLessThanOrEqual(20);
  });

  test('still reserves slots for Publikasi', () => {
    // The pre-existing guarantee: a top-20 by score came out all BRS and the judge
    // never saw a publication.
    const pubs = Array.from({ length: 3 }, (_, i) => ({
      id: 500 + i, title: `Profil Kemiskinan Provinsi Maluku Utara 2024 (${i}/32)`,
      content: 'x', category: 'Publikasi', similarity: 0.50 - i * 0.01,
    }));
    const input = selectJudgeInput('garis kemiskinan Maret 2025', [...filler(30), ...pubs]);
    expect(input.filter(d => d.category === 'Publikasi').length).toBeGreaterThanOrEqual(3);
  });
});

describe('high-confidence bypass', () => {
  // At similarity >= 0.92 the judge is skipped entirely and an inline dedup keeps
  // the newest edition per series — a third place where "newest" silently beats
  // the period the user asked for.
  const { judgeDocuments } = require('../documentJudge.service');

  test('keeps the requested period rather than the newest edition', async () => {
    const candidates = [
      { id: 1, title: 'Profil Kemiskinan Maluku Utara Maret 2026', content: 'a', similarity: 0.95 },
      { id: 2, title: 'Profil Kemiskinan Maluku Utara Maret 2025', content: 'b', similarity: 0.93 },
      { id: 3, title: 'Statistik Daerah Maluku Utara 2024', content: 'c', similarity: 0.92 },
    ];
    const r = await judgeDocuments('penduduk miskin Maret 2025', candidates, { topN: 3 });
    const titles = r.results.map(d => d.title).join(' | ');
    expect(titles).toMatch(/Maret 2025/);
  });

  test('still keeps the newest edition when no period was asked for', async () => {
    const candidates = [
      { id: 1, title: 'Profil Kemiskinan Maluku Utara Maret 2026', content: 'a', similarity: 0.95 },
      { id: 2, title: 'Profil Kemiskinan Maluku Utara Maret 2025', content: 'b', similarity: 0.93 },
      { id: 3, title: 'Statistik Daerah Maluku Utara 2024', content: 'c', similarity: 0.92 },
    ];
    const r = await judgeDocuments('penduduk miskin Maluku Utara', candidates, { topN: 3 });
    expect(r.results.map(d => d.title).join(' | ')).toMatch(/Maret 2026/);
  });
});

describe('the compendium tolerance is only for annual titles', () => {
  const { docMatchesQueryPeriod, detectQueryPeriod, selectJudgeInput } = require('../documentJudge.service');
  const asked = detectQueryPeriod('garis kemiskinan perkotaan Maret 2025');

  test('accepts the release for the month that was asked for', () => {
    expect(docMatchesQueryPeriod('Persentase Penduduk Miskin Maret 2025 turun menjadi 5,81 persen', asked)).toBeTruthy();
  });

  test('rejects a dated release from the following year', () => {
    // "Dalam Angka 2026" may report 2025; "Maret 2026" reports Maret 2026. Treating
    // the latter as a match let the Maret 2026 chunks consume the slots reserved
    // for the period actually requested, so rank 22 was never reached.
    expect(docMatchesQueryPeriod('Persentase penduduk miskin pada Maret 2026 sebesar 5,79 persen', asked)).toBeFalsy();
  });

  test('still accepts an annual compendium titled one year later', () => {
    const yearOnly = detectQueryPeriod('jumlah penduduk Maluku Utara tahun 2016');
    expect(docMatchesQueryPeriod('Provinsi Maluku Utara Dalam Angka 2017', yearOnly)).toBeTruthy();
  });

  test('admits the requested month even when later releases outrank it', () => {
    const newer = Array.from({ length: 22 }, (_, i) => ({
      id: 200 + i,
      title: `Persentase penduduk miskin pada Maret 2026 sebesar 5,79 persen (${i}/6)`,
      content: 'x', category: 'BRS', similarity: 0.882 - i * 0.0005,
    }));
    const target = {
      id: 999, title: 'Persentase Penduduk Miskin Maret 2025 turun menjadi 5,81 persen (4/6)',
      content: 'Beras 25,10', category: 'BRS', similarity: 0.861,
    };
    const input = selectJudgeInput('garis kemiskinan perkotaan Maret 2025', [...newer, target]);
    expect(input.map(d => d.id)).toContain(999);
  });
});
