'use strict';

// "berapa jumlah penduduk Kota Ternate 2024?" picked a province-only table of age
// brackets (id 186) over one that breaks down by kabupaten/kota and holds the
// answer (id 187, Kota Ternate = 214,4 ribu). Nothing was wrong with either
// table; the ranking had no notion that a question naming a city needs a source
// that can produce one.

const { kabKotaBoostFor } = require('../../search/intent.service');

const PER_KABKOTA = 'Penduduk, Laju Pertumbuhan Penduduk, Distribusi Persentase Penduduk, Kepadatan Penduduk Menurut Kabupaten/Kota';
const PROVINCE_ONLY = 'Jumlah Penduduk Menurut Kelompok Umur dan JenisKelamin (ribu jiwa) di Provinsi Maluku Utara';

describe('kabKotaBoostFor', () => {
  test('lifts a per-kabupaten source when a city is named', () => {
    expect(kabKotaBoostFor(PER_KABKOTA, 'Kota Ternate')).toBeGreaterThan(0);
  });

  test('leaves a province-only source alone when a city is named', () => {
    expect(kabKotaBoostFor(PROVINCE_ONLY, 'Kota Ternate')).toBe(0);
  });

  test('resolves regional shorthand and bare names', () => {
    // normalizeRegionName carries the alias table: kepsul → Kepulauan Sula,
    // Tidore → Kota Tidore Kepulauan.
    expect(kabKotaBoostFor(PER_KABKOTA, 'kepsul')).toBeGreaterThan(0);
    expect(kabKotaBoostFor(PER_KABKOTA, 'Tidore')).toBeGreaterThan(0);
    expect(kabKotaBoostFor(PER_KABKOTA, 'Halmahera Utara')).toBeGreaterThan(0);
  });

  // The guard that matters: a province question must not be dragged onto a
  // kabupaten/kota breakdown just because one exists.
  test('does not fire for the province itself', () => {
    for (const geo of ['Maluku Utara', 'Provinsi Maluku Utara', 'malut', 'North Maluku']) {
      expect(kabKotaBoostFor(PER_KABKOTA, geo)).toBe(0);
    }
  });

  test('does not fire when no region was asked for', () => {
    expect(kabKotaBoostFor(PER_KABKOTA, null)).toBe(0);
    expect(kabKotaBoostFor(PER_KABKOTA, '')).toBe(0);
    expect(kabKotaBoostFor(PER_KABKOTA, undefined)).toBe(0);
  });

  test('survives a missing or non-string source name', () => {
    expect(kabKotaBoostFor(null, 'Kota Ternate')).toBe(0);
    expect(kabKotaBoostFor(undefined, 'Kota Ternate')).toBe(0);
  });
});
