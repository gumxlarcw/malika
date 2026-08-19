'use strict';

// BPS SIMDASI publishes some year-slices as an empty shell: the interop endpoint
// answers `data-availability: "available"` and returns a full set of region rows,
// but every measure cell is the literal string "..." (verified 2026-08-19 on
// datasource 187 / tahun 2016 — 55 of 55 cells dotted, every other year intact).
// readGenericIndicatorFromBps maps "..." to null, so the table arrives as N rows
// of nulls. Row count alone therefore cannot mean "we have data".

const { hasUsableValues, pickFirstSourceWithData } = require('../chatUtils');

const HOLLOW_187_2016 = [
  { Tahun: 2016, Wilayah: 'Halmahera Barat', 'Jumlah Penduduk': null, 'Kepadatan Penduduk per km persegi': null, value_codes: { 'Jumlah Penduduk': '...' } },
  { Tahun: 2016, Wilayah: 'Kota Ternate', 'Jumlah Penduduk': null, 'Kepadatan Penduduk per km persegi': null, value_codes: { 'Jumlah Penduduk': '...' } },
];

const REAL_187_2024 = [
  { Tahun: 2024, Wilayah: 'Halmahera Barat', 'Jumlah Penduduk': 137.8, 'Kepadatan Penduduk per km persegi': 62, value_codes: null },
  { Tahun: 2024, Wilayah: 'Kota Ternate', 'Jumlah Penduduk': 214.4, 'Kepadatan Penduduk per km persegi': 1421, value_codes: null },
];

describe('hasUsableValues', () => {
  test('rejects a table whose measure cells are all null', () => {
    expect(hasUsableValues(HOLLOW_187_2016)).toBe(false);
  });

  test('accepts the same table in a year that carries values', () => {
    expect(hasUsableValues(REAL_187_2024)).toBe(true);
  });

  test('accepts a table where only some cells are missing', () => {
    const partial = [
      { Tahun: 2017, Wilayah: 'Kota Ternate', 'Jumlah Penduduk': 212.9, 'Laju Pertumbuhan': null },
    ];
    expect(hasUsableValues(partial)).toBe(true);
  });

  test('treats a bare "..." string as missing, not as a value', () => {
    expect(hasUsableValues([{ Wilayah: 'Kota Ternate', Nilai: '...' }])).toBe(false);
  });

  test('does not count label columns as values', () => {
    // Tahun/Wilayah are dimensions. A row carrying only those is not an answer.
    expect(hasUsableValues([{ Tahun: 2016, Wilayah: 'Kota Ternate' }])).toBe(false);
  });

  test('counts a zero as a real value', () => {
    // 0 is a legitimate statistic (e.g. jumlah kejadian = 0) and must not be
    // confused with an absent one.
    expect(hasUsableValues([{ Wilayah: 'Kota Ternate', Nilai: 0 }])).toBe(true);
  });

  test('treats an empty table as unusable', () => {
    expect(hasUsableValues([])).toBe(false);
    expect(hasUsableValues(null)).toBe(false);
  });
});

describe('pickFirstSourceWithData', () => {
  test('skips a source that returns a hollow table and takes the next that has values', async () => {
    const fetched = [];
    const fetchPreview = async (sourceId) => {
      fetched.push(sourceId);
      if (sourceId === 187) return { source: 'Penduduk...', columns: [], data: HOLLOW_187_2016 };
      if (sourceId === 184) return { source: 'Proyeksi Penduduk', columns: [], data: [{ Tahun: 2016, Wilayah: 'Ternate', Nilai: 218028 }] };
      return null;
    };

    const picked = await pickFirstSourceWithData([187, 184, 452], fetchPreview);

    expect(picked).toMatchObject({ sourceId: 184 });
    expect(picked.preview.data[0].Nilai).toBe(218028);
    expect(fetched).toEqual([187, 184]); // stopped as soon as it found real data
  });

  test('returns null when every candidate is hollow or empty', async () => {
    const fetchPreview = async () => ({ source: 'x', columns: [], data: HOLLOW_187_2016 });
    expect(await pickFirstSourceWithData([187, 186], fetchPreview)).toBeNull();
  });

  test('keeps the first source when it already has values', async () => {
    const fetchPreview = async () => ({ source: 'x', columns: [], data: REAL_187_2024 });
    const picked = await pickFirstSourceWithData([187, 184], fetchPreview);
    expect(picked.sourceId).toBe(187);
  });

  test('survives a source that throws and continues to the next', async () => {
    const fetchPreview = async (id) => {
      if (id === 187) throw new Error('BPS timeout');
      return { source: 'x', columns: [], data: REAL_187_2024 };
    };
    const picked = await pickFirstSourceWithData([187, 184], fetchPreview);
    expect(picked.sourceId).toBe(184);
  });

  test('ignores duplicate and falsy ids', async () => {
    const seen = [];
    const fetchPreview = async (id) => { seen.push(id); return null; };
    await pickFirstSourceWithData([187, 187, null, undefined, 184], fetchPreview);
    expect(seen).toEqual([187, 184]);
  });
});

// findNearestAvailablePeriod is consulted only after the requested year has
// already failed to produce usable rows. Its three copies of the year-picking
// rule all asked "is the nearest year different from the one requested?" — which
// is false when the requested year IS registered but published as a shell, so
// they fell through to "return the latest" and answered a 2016 question with
// 2026 while 2017 sat one year away.
const { pickNearestYear } = require('../chatUtils');

describe('pickNearestYear', () => {
  test('skips the requested year, which has already been tried and yielded nothing', () => {
    // datasource 187 registers 2016, but that slice is an all-"..." shell.
    expect(pickNearestYear([2010, 2016, 2017, 2018, 2024, 2026], 2016)).toBe(2017);
  });

  test('picks the nearest year when the requested one is absent entirely', () => {
    expect(pickNearestYear([2018, 2019, 2024], 2020)).toBe(2019);
  });

  test('prefers the more recent year when two are equally near', () => {
    expect(pickNearestYear([2015, 2017], 2016)).toBe(2017);
  });

  test('falls back to an older year when nothing newer exists', () => {
    expect(pickNearestYear([2010, 2012], 2016)).toBe(2012);
  });

  test('returns the latest year when none was requested', () => {
    expect(pickNearestYear([2019, 2024, 2021], null)).toBe(2024);
  });

  test('returns null when there is nothing to pick', () => {
    expect(pickNearestYear([], 2016)).toBeNull();
    expect(pickNearestYear([2016], 2016)).toBeNull(); // only the failed year
  });

  test('ignores non-numeric entries', () => {
    expect(pickNearestYear([2017, 'abc', null, 2019], 2020)).toBe(2019);
  });
});
