'use strict';

// The nine-step rail proved *that* each stage ran, never *what* it found: every
// status event was {message, stage} and nothing else. These are the formatters
// behind the `detail` line the rail already knows how to render, plus the clock
// that measures a stage from where its work starts rather than from where its
// status event happens to fire.

const {
  createStageClock,
  formatNormalizeDetail,
  formatSearchDetail,
  formatPreviewDetail,
  formatKnowledgeDetail,
} = require('../stageDetail');

describe('createStageClock', () => {
  test('measures a stage from mark() to elapsed(), not from clock creation', () => {
    let fakeNow = 1000;
    const clock = createStageClock(() => fakeNow);

    fakeNow = 1500;
    clock.mark('search');
    fakeNow = 2400;

    expect(clock.elapsed('search')).toBe(900);
  });

  test('returns undefined for a stage that was never marked', () => {
    const clock = createStageClock(() => 0);
    expect(clock.elapsed('dna')).toBeUndefined();
  });

  test('keeps the first mark so a re-announced stage does not reset its window', () => {
    let fakeNow = 0;
    const clock = createStageClock(() => fakeNow);

    clock.mark('knowledge');
    fakeNow = 5100;
    clock.mark('knowledge');
    fakeNow = 6000;

    expect(clock.elapsed('knowledge')).toBe(6000);
  });
});

describe('formatNormalizeDetail', () => {
  test('names the resolved region and year', () => {
    expect(formatNormalizeDetail({ geo: 'Halmahera Barat', year: 2024 }))
      .toBe('Halmahera Barat · 2024');
  });

  // geoInference keys GEO_MALUT by lowercase name, so `canonical` arrives
  // lowercase. Title-casing belongs here rather than in that service, which
  // relies on the lowercase form for alias lookup.
  test('title-cases the lowercase canonical name geoInference returns', () => {
    expect(formatNormalizeDetail({ geo: 'halmahera barat', year: 2025 }))
      .toBe('Halmahera Barat · 2025');
  });

  test('says so plainly when no region was detected', () => {
    expect(formatNormalizeDetail({ geo: null, year: 2024 }))
      .toBe('Maluku Utara · 2024');
  });

  test('omits the year when none was inferred', () => {
    expect(formatNormalizeDetail({ geo: 'Ternate', year: null }))
      .toBe('Ternate · tahun terbaru');
  });
});

// Candidate scores are an unbounded additive relevance score, not a similarity:
// streaming.service.js starts from a base score and adds boosts of +100 (kab/kota
// + topic), +30 (topic only) and +20, and reads confidence off fixed thresholds
// at 80 and 70. A live query returned 112. Presenting that as a 0–1 score printed
// "skor tertinggi 1,12", which is not a number that exists on any scale here.
describe('formatSearchDetail', () => {
  test('reports the raw score with the confidence band the pipeline reads off it', () => {
    const candidates = [
      { name: 'Penduduk Miskin', score: 112 },
      { name: 'Garis Kemiskinan', score: 82 },
    ];
    expect(formatSearchDetail(candidates)).toBe('2 kandidat · skor tertinggi 112 (tinggi)');
  });

  test('calls 70-79 medium confidence', () => {
    expect(formatSearchDetail([{ name: 'x', score: 74 }]))
      .toBe('1 kandidat · skor tertinggi 74 (sedang)');
  });

  test('calls below 70 low confidence', () => {
    expect(formatSearchDetail([{ name: 'x', score: 12 }]))
      .toBe('1 kandidat · skor tertinggi 12 (rendah)');
  });

  test('reports an empty search rather than pretending it found something', () => {
    expect(formatSearchDetail([])).toBe('tidak ada kandidat cocok');
  });

  test('counts candidates even when none carries a usable score', () => {
    expect(formatSearchDetail([{ name: 'x' }, { name: 'y' }])).toBe('2 kandidat');
  });
});

describe('formatPreviewDetail', () => {
  test('reports table dimensions', () => {
    const preview = { rows: [{ a: 1 }, { a: 2 }, { a: 3 }], columns: ['a', 'b'] };
    expect(formatPreviewDetail(preview)).toBe('Tabel 3 baris × 2 kolom');
  });

  test('reports that no table was loaded when the preview is absent', () => {
    expect(formatPreviewDetail(null)).toBe('tanpa tabel');
  });
});

describe('formatKnowledgeDetail', () => {
  test('counts the reference documents collected', () => {
    expect(formatKnowledgeDetail([{ id: 1 }, { id: 2 }])).toBe('2 dokumen referensi');
  });

  test('uses the singular form for one document', () => {
    expect(formatKnowledgeDetail([{ id: 1 }])).toBe('1 dokumen referensi');
  });

  test('reports an empty knowledge search', () => {
    expect(formatKnowledgeDetail([])).toBe('tanpa referensi');
  });
});
