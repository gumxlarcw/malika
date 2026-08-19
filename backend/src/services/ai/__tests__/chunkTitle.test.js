'use strict';

// Chunks were titled by the last caption appearing before the chunk ENDED, so a
// chunk carrying the tail of Table A plus Table B's caption on its final line was
// named after Table B. Measured consequence: the chunk holding the 2016 population
// density table is titled "Tabel 3.2.11 Jumlah Pencari Kerja", and that wrong title
// costs 0.033 cosine against a query about population density — it scores worse than
// having no title at all.
//
// The right owner of a chunk is the section covering most of it.

const { sectionForChunk } = require('../chunkTitle.service');

// entries are captions in document order, each at a character position
const E = [
  { type: 'BAB', position: 0, label: 'Bab 3' },
  { type: 'TBL', position: 1000, label: 'Tabel 3.1.4 Kepadatan Penduduk' },
  { type: 'TBL', position: 4000, label: 'Tabel 3.1.5 Rumah Tangga' },
  { type: 'TBL', position: 9000, label: 'Tabel 3.2.8 Bekerja' },
];

describe('sectionForChunk', () => {
  test('a chunk wholly inside one table takes that table', () => {
    expect(sectionForChunk(1200, 3000, E).label).toMatch(/3\.1\.4/);
  });

  test('a chunk that merely ends with the next caption keeps the table it is made of', () => {
    // 2800 of 3000 chars belong to 3.1.4; only the last 200 to 3.1.5.
    expect(sectionForChunk(1200, 4200, E).label).toMatch(/3\.1\.4/);
  });

  test('a chunk that is mostly the next table takes the next table', () => {
    // 200 chars of 3.1.4, 2800 of 3.1.5 — the caption is near the start.
    expect(sectionForChunk(3800, 6600, E).label).toMatch(/3\.1\.5/);
  });

  test('a chunk spanning a whole table plus edges takes the table it covers most', () => {
    expect(sectionForChunk(3500, 9200, E).label).toMatch(/3\.1\.5/);
  });

  test('a chunk before any table falls back to the chapter', () => {
    expect(sectionForChunk(10, 800, E).label).toMatch(/Bab 3/);
  });

  test('a chunk starting exactly at a caption takes that table', () => {
    expect(sectionForChunk(4000, 5000, E).label).toMatch(/3\.1\.5/);
  });

  test('prefers a table over the chapter when both cover the chunk', () => {
    expect(sectionForChunk(1000, 2000, E).type).toBe('TBL');
  });

  test('returns null when there are no entries', () => {
    expect(sectionForChunk(0, 100, [])).toBeNull();
    expect(sectionForChunk(0, 100, null)).toBeNull();
  });

  test('is unaffected by entries that start after the chunk ends', () => {
    // The old rule let a caption beyond the chunk win; it must be irrelevant now.
    expect(sectionForChunk(1200, 3000, E).label).toMatch(/3\.1\.4/);
    expect(sectionForChunk(1200, 3000, E.slice(0, 3)).label).toMatch(/3\.1\.4/);
  });
});


// A chunk often straddles table boundaries: chunk 45 of Dalam Angka 2017 spans the
// tail of 3.1.3, the whole of 3.1.4 (the density table we care about) and the head
// of 3.1.5. Choosing by coverage alone names 3.1.3 — the one table whose caption the
// reader cannot even see in that chunk. Captions physically present in the chunk are
// what the text is actually about, so they win.
describe('sectionsForChunk — captions the chunk actually carries', () => {
  const { sectionsForChunk } = require('../chunkTitle.service');

  test('names the captions contained in the chunk, in document order', () => {
    const out = sectionsForChunk(149948, 153899, [
      { type: 'TBL', position: 148000, label: 'Tabel 3.1.3 Penduduk Menurut Umur' },
      { type: 'TBL', position: 151970, label: 'Tabel 3.1.4 Kepadatan Penduduk' },
      { type: 'TBL', position: 152889, label: 'Tabel 3.1.5 Rumah Tangga' },
    ]);
    expect(out.map(e => e.label)).toEqual([
      'Tabel 3.1.4 Kepadatan Penduduk',
      'Tabel 3.1.5 Rumah Tangga',
    ]);
  });

  test('falls back to the covering section when no caption is inside', () => {
    const out = sectionsForChunk(148500, 151000, [
      { type: 'TBL', position: 148000, label: 'Tabel 3.1.3 Penduduk Menurut Umur' },
      { type: 'TBL', position: 151970, label: 'Tabel 3.1.4 Kepadatan Penduduk' },
    ]);
    expect(out.map(e => e.label)).toEqual(['Tabel 3.1.3 Penduduk Menurut Umur']);
  });

  test('caps the number of names so a title stays readable', () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({ type: 'TBL', position: 1000 + i * 100, label: `Tabel ${i}` }));
    expect(sectionsForChunk(900, 2000, entries).length).toBeLessThanOrEqual(2);
  });

  test('prefers a contained table over a contained chapter heading', () => {
    const out = sectionsForChunk(1000, 3000, [
      { type: 'BAB', position: 1100, label: 'Bab 3 Penduduk' },
      { type: 'TBL', position: 1500, label: 'Tabel 3.1.1 Sesuatu' },
    ]);
    expect(out[0].type).toBe('TBL');
  });

  test('returns an empty list when there are no entries', () => {
    expect(sectionsForChunk(0, 100, [])).toEqual([]);
  });
});
