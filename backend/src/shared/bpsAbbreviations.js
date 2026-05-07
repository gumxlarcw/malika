/**
 * BPS Abbreviation Registry — Single Source of Truth
 *
 * Canonical map of all known BPS (Badan Pusat Statistik) abbreviations.
 * Import this module instead of defining your own abbreviation map.
 *
 * Used by:
 *  - gateAgent.service.js  (pre-expand query before gate LLM)
 *  - synonymExpansion.service.js (pre-expand before synonym LLM)
 *  - queryNormalizer.service.js (expand abbreviations in user query)
 *  - reranker.service.js (pre-expand before reranker/filter LLMs)
 *  - supervisor.service.js (abbreviation reference for review LLM)
 *  - streaming.service.js (abbreviation reference in response LLM prompt)
 *
 * @module shared/bpsAbbreviations
 */

'use strict';

/**
 * Map of abbreviation (lowercase) → full expansion.
 * The expansion is in Indonesian Title Case (for prompt display).
 */
const BPS_ABBREVIATION_MAP = {
  // === Economic indicators ===
  'pmtb': 'Pembentukan Modal Tetap Bruto',
  'pdrb': 'Produk Domestik Regional Bruto',
  'pdb': 'Produk Domestik Bruto',
  'ihk': 'Indeks Harga Konsumen',
  'ntp': 'Nilai Tukar Petani',
  'ntn': 'Nilai Tukar Nelayan',
  'ntup': 'Nilai Tukar Usaha Pertanian',
  'umk': 'Upah Minimum Kabupaten/Kota',
  'ump': 'Upah Minimum Provinsi',
  'grdp': 'Produk Domestik Regional Bruto',
  'ddi': 'Penanaman Modal Dalam Negeri',
  'fdi': 'Penanaman Modal Asing',

  // === Human development / demography ===
  'ipm': 'Indeks Pembangunan Manusia',
  'ahh': 'Angka Harapan Hidup',
  'hls': 'Harapan Lama Sekolah',
  'rls': 'Rata-rata Lama Sekolah',
  'als': 'Angka Lama Sekolah',
  'apk': 'Angka Partisipasi Kasar',
  'apm': 'Angka Partisipasi Murni',
  'akb': 'Angka Kematian Bayi',
  'aki': 'Angka Kematian Ibu',
  'tfr': 'Total Fertility Rate',
  'imr': 'Infant Mortality Rate',

  // === Labor / employment ===
  'tpt': 'Tingkat Pengangguran Terbuka',
  'tpak': 'Tingkat Partisipasi Angkatan Kerja',
  'tpk': 'Tingkat Penghunian Kamar',
  'naker': 'Ketenagakerjaan',

  // === EXIM ===
  'exim': 'Ekspor Impor',
  'hs': 'Harmonized System',
  'pod': 'Pelabuhan',
  'ctr': 'Negara',

  // === Growth / change ===
  'yoy': 'Year on Year',
  'mom': 'Month on Month',
  'qtq': 'Quarter to Quarter',
  'ytd': 'Year to Date',

  // === Publications / surveys ===
  'brs': 'Berita Resmi Statistik',
  'susenas': 'Survei Sosial Ekonomi Nasional',
  'sakernas': 'Survei Angkatan Kerja Nasional',
  'podes': 'Potensi Desa',
  'sptk': 'Survei Pertanian Tanaman Kegunaan',
  'stbp': 'Survei Tanaman Buah-buahan dan Sayuran Tahunan',
  'sp': 'Sensus Penduduk',
  'st': 'Sensus Pertanian',
  'se': 'Sensus Ekonomi',

  // === Organizations ===
  'bps': 'Badan Pusat Statistik',
  'pst': 'Pelayanan Statistik Terpadu',
  'ppid': 'Pejabat Pengelola Informasi dan Dokumentasi',

  // === Education levels (2-letter, important for search) ===
  'tk': 'Taman Kanak-kanak',
  'sd': 'Sekolah Dasar',
  'mi': 'Madrasah Ibtidaiyah',
  'ts': 'Madrasah Tsanawiyah',
  'ma': 'Madrasah Aliyah',
  'ra': 'Raudhatul Athfal',
  'slb': 'Sekolah Luar Biasa',
  'smp': 'Sekolah Menengah Pertama',
  'sma': 'Sekolah Menengah Atas',
  'smk': 'Sekolah Menengah Kejuruan',

  // === Common short forms in queries ===
  'kab': 'Kabupaten',
  'thn': 'tahun',
  'bln': 'bulan',
};

/**
 * Whitelist of important 2-letter terms that should NOT be filtered
 * by the `word.length >= 3` search filter. These are recognized BPS
 * abbreviations or statistical terms that carry meaningful signal.
 */
const SHORT_WORD_WHITELIST = new Set([
  'tk', 'sd', 'mi', 'ts', 'ma', 'ra',  // Education levels
  'rt', 'rw',                            // Administrative units
  'sp', 'st', 'se',                      // Census types
  'db', 'hb', 'lb',                      // Regional codes
  'lp',                                   // Lembaga Pemasyarakatan
  'hs',                                   // Harmonized System (EXIM)
]);

/**
 * Pre-expand known abbreviations in a text string.
 * Appends "(Full Expansion)" after each matched abbreviation.
 *
 * @param {string} text - Input text (e.g. user query)
 * @returns {string} - Text with abbreviations expanded inline
 */
function expandAbbreviationsInline(text) {
  if (!text) return text;
  let result = text;
  for (const [abbr, full] of Object.entries(BPS_ABBREVIATION_MAP)) {
    const rx = new RegExp(`\\b${abbr}\\b`, 'gi');
    if (rx.test(result)) {
      // Idempotency guard: skip if this abbreviation was already expanded
      // e.g., "TPT (Tingkat Pengangguran Terbuka)" should not become
      // "TPT (Tingkat Pengangguran Terbuka) (Tingkat Pengangguran Terbuka)"
      const expandedPattern = new RegExp(`\\b${abbr}\\b\\s*\\(${full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'i');
      if (expandedPattern.test(result)) continue;
      result = result.replace(rx, `${abbr.toUpperCase()} (${full})`);
    }
  }
  return result;
}

/**
 * Build a compact abbreviation reference block for LLM prompts.
 * Only includes the most important abbreviations to save tokens.
 *
 * @param {'full'|'compact'} mode - 'full' = all entries, 'compact' = top ~25
 * @returns {string} - Formatted reference block
 */
function buildAbbreviationReference(mode = 'compact') {
  const entries = Object.entries(BPS_ABBREVIATION_MAP);

  // For compact mode, pick the most hallucination-prone abbreviations
  const compactKeys = new Set([
    'pmtb', 'pdrb', 'pdb', 'ipm', 'ihk', 'tpt', 'tpak', 'tpk',
    'ntp', 'ntn', 'umk', 'ump', 'ahh', 'hls', 'rls', 'apk', 'apm',
    'akb', 'aki', 'naker', 'ddi', 'fdi', 'brs', 'exim',
  ]);

  const selected = mode === 'full'
    ? entries
    : entries.filter(([k]) => compactKeys.has(k));

  const lines = selected.map(([k, v]) => `  ${k.toUpperCase()} = ${v}`);
  return lines.join('\n');
}

/**
 * The anti-hallucination instruction to append after the abbreviation list.
 *
 * This is a STRICT, multi-layered rule that prevents LLMs from hallucinating
 * abbreviation expansions. It includes:
 *  1. Explicit prohibition with examples of WRONG behavior
 *  2. Chain-of-thought verification step
 *  3. Fallback behavior (use as-is or ask user)
 */
const ANTI_HALLUCINATION_RULE = `⛔⛔⛔ ATURAN WAJIB SINGKATAN — PELANGGARAN = KESALAHAN FATAL:

1. HANYA gunakan kepanjangan yang ADA di daftar singkatan resmi di atas.
2. Jika singkatan TIDAK ADA di daftar, kamu DILARANG KERAS mengarang/menebak kepanjangannya.
3. Untuk singkatan yang tidak dikenal: tulis singkatan APA ADANYA (misal: "data XYZ") atau tanyakan ke user.

❌ CONTOH KESALAHAN FATAL (JANGAN DITIRU):
  - Mengarang "PMTB = Pendapatan Masyarakat Total Bersih" ← SALAH! PMTB = Pembentukan Modal Tetap Bruto
  - Mengarang "TPK = Tingkat Produktivitas Kerja" ← SALAH! TPK = Tingkat Penghunian Kamar
  - Mengarang "NTP = Neraca Transaksi Perdagangan" ← SALAH! NTP = Nilai Tukar Petani

✅ CARA BENAR:
  - Cek daftar singkatan → ada? Gunakan kepanjangan resmi.
  - Tidak ada di daftar? Tulis apa adanya: "data ABC" tanpa menebak kepanjangannya.
  - Ragu? Tanyakan: "Mohon maaf, bisa diperjelas singkatan tersebut?"

⚠️ VERIFIKASI WAJIB sebelum menyebut kepanjangan singkatan:
  Tanyakan pada diri sendiri: "Apakah kepanjangan ini ADA di daftar resmi yang diberikan?"
  Jika TIDAK → jangan tulis kepanjangannya.`;

/**
 * Dynamic abbreviation lookup via DNA Nucleus API.
 * Falls back gracefully if DNA service unavailable.
 *
 * @param {string} abbr - Abbreviation to look up
 * @returns {Promise<{found: boolean, expansion: string, definition: string}|null>}
 */
async function lookupAbbreviationDynamic(abbr) {
  if (!abbr || abbr.length < 2) return null;

  // First check static map
  const staticExpansion = BPS_ABBREVIATION_MAP[abbr.toLowerCase()];
  if (staticExpansion) {
    return { found: true, expansion: staticExpansion, definition: '', source: 'static' };
  }

  // Then try DNA Nucleus API
  try {
    const dnaService = require('../services/dna/dnaNucleus.service');
    const result = await dnaService.lookupAbbreviation(abbr);
    if (result?.found) {
      return result;
    }
  } catch (err) {
    // DNA service not available — silent fallback
  }

  return { found: false, expansion: '', definition: '' };
}

module.exports = {
  BPS_ABBREVIATION_MAP,
  SHORT_WORD_WHITELIST,
  expandAbbreviationsInline,
  buildAbbreviationReference,
  ANTI_HALLUCINATION_RULE,
  lookupAbbreviationDynamic,
};
