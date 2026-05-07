'use strict';

/**
 * Maps BPS indikator source_name to one of 8 kategori (7 + Lainnya fallback).
 * First-match wins. Keywords matched as case-insensitive substring.
 *
 * Keywords curated based on audit of 311 indikator tables — see
 * docs/superpowers/specs/2026-05-06-peta-tematik-design.md sec 3.
 *
 * Note: Order of RULES matters for disambiguation. Rules checking more
 * specific keywords (e.g., Ekonomi's "miskin") should come before
 * rules with general keywords (e.g., Kependudukan's "penduduk").
 */

const KATEGORI_LIST = Object.freeze([
  'Kependudukan',
  'Ketenagakerjaan',
  'Pendidikan',
  'Kesehatan',
  'Ekonomi',
  'Pariwisata & Akomodasi',
  'Pembangunan & Sosial',
  'Lainnya',
]);

// Rules ordered to avoid false positives:
// Ekonomi before Kependudukan so "miskin" matches before "penduduk"
const RULES = Object.freeze([
  Object.freeze({ kategori: 'Ekonomi', keywords: [
    'kemiskinan', 'miskin', 'pdrb', 'bruto', 'pendapatan', 'pengeluaran', 'gini',
    'koperasi', 'umkm', 'industri', 'produksi', 'pertanian',
    'perikanan', 'peternakan', 'tukar petani', 'inflasi'
  ]}),
  Object.freeze({ kategori: 'Kependudukan', keywords: [
    'penduduk', 'rumah tangga', 'proyeksi', 'migrasi',
    'kepadatan', 'rasio jenis kelamin'
  ]}),
  Object.freeze({ kategori: 'Ketenagakerjaan', keywords: [
    'tpak', 'tpt', 'pengangguran', 'pekerja', 'bekerja',
    'pencari kerja', 'lowongan', 'angkatan kerja'
  ]}),
  Object.freeze({ kategori: 'Pendidikan', keywords: [
    'sekolah', 'pendidikan', 'melek huruf',
    'aps', 'apk', 'apm', 'harapan lama sekolah', 'rata-rata lama sekolah'
  ]}),
  Object.freeze({ kategori: 'Kesehatan', keywords: [
    'umur harapan hidup', 'uhh', 'kesehatan', 'gizi',
    'imunisasi', 'puskesmas', 'posyandu', 'kematian', 'kelahiran'
  ]}),
  Object.freeze({ kategori: 'Pariwisata & Akomodasi', keywords: [
    'wisata', 'wisatawan', 'hotel', 'akomodasi', 'kamar', 'tamu menginap',
    'penghunian'
  ]}),
  Object.freeze({ kategori: 'Pembangunan & Sosial', keywords: [
    'ipm', 'pembangunan manusia', 'perceraian', 'gender',
    'ikg', 'idi', 'desa'
  ]}),
]);

function classify(sourceName) {
  if (!sourceName || typeof sourceName !== 'string') return 'Lainnya';
  const lower = sourceName.toLowerCase();
  for (const rule of RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return rule.kategori;
    }
  }
  return 'Lainnya';
}

module.exports = { classify, KATEGORI_LIST, RULES };
