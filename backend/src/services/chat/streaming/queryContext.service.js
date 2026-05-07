/**
 * Query Context Service
 * 
 * Handles context detection, topic extraction, and fragment handling
 * for streaming chat. Determines if queries are follow-ups, fragments,
 * or new topics.
 * 
 * Extracted from streaming.service.js during Phase 4+ refactor.
 */

'use strict';

// ============================================================================
// DEPENDENCIES
// ============================================================================

// Knowledge patterns: dynamic procedural query detection
let knowledgePatternsService = null;
try {
  knowledgePatternsService = require('../../ai/knowledgePatterns.service');
} catch (e) {
  // Service not available
}

// Geo data — canonical source
const { KNOWN_GEO, GEO_PATTERNS, GEO_FRAGMENT_WORDS } = require('../../../utils/geoAnalysis');
const { MONTH_NAMES_SET } = require('../../../utils/queryAnalysis');

// ============================================================================
// ALLOWED TOKENS FOR FRAGMENT DETECTION
// ============================================================================

const PERIOD_FRAGMENT_ALLOWED = new Set([
  'untuk', 'periode', 'rentang', 'dari', 'sampai', 'sd', 's/d', 'di', 'ada', 'yang', 'berapa',
  'tahun', 'thn', 'bulan', 'terakhir', 'ini', 'lalu', 'kemarin', 'tersedia', 'saja', 'aja',
  'ya', 'iya', 'oke', 'ok', 'tampilkan', 'tampil', 'lanjut', 'boleh',
  // Month names — from queryAnalysis canonical source
  ...MONTH_NAMES_SET,
  'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh',
  'beberapa', 'sejumlah', 'spesifik', 'khusus', 'data',
  // Geo fragments — from geoAnalysis canonical source
  ...GEO_FRAGMENT_WORDS,
]);

// Known Maluku Utara kab/kota names — from geoAnalysis canonical source
// (KNOWN_GEO imported at top)

// Filler words to filter from queries
const FILLER_WORDS = new Set([
  'tampilkan', 'tampil', 'tunjukkan', 'lihat', 'lihatkan', 'kasih', 'berikan',
  'tolong', 'coba', 'mohon', 'silakan', 'please',
  'bagaimana', 'gimana', 'apakah', 'apa', 'berapa',
  'ya', 'iya', 'yaa', 'iyaa', 'ok', 'oke', 'okay', 'sip',
  'dong', 'deh', 'nih', 'sih', 'kan', 'lah', 'kah',
  'yang', 'ada', 'tersedia', 'punya',
  'bisa', 'dapat', 'boleh', 'mau',
  'saya', 'aku', 'kita', 'kami',
  'itu', 'ini', 'nya',
]);

// Geo patterns for replacement/detection — from geoAnalysis canonical source
// (GEO_PATTERNS imported at top)

// ============================================================================
// FRAGMENT DETECTION FUNCTIONS
// ============================================================================

/**
 * Check if message is a time/period fragment (e.g. "tahun 2025", "2 tahun terakhir")
 * Also catches geo-only fragments and short follow-up queries
 */
function isLikelyTimeOrPeriodFragment(raw) {
  const t = String(raw || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return false;

  const tokens = t.split(' ').filter(Boolean);
  if (tokens.length > 10) return false;

  let hasSignal = false;
  for (const tok of tokens) {
    if (/^(19\d{2}|20\d{2}|2100)$/.test(tok)) {
      hasSignal = true;
      continue;
    }
    if (/^(0?[1-9]|1[0-2])$/.test(tok)) continue;
    if (PERIOD_FRAGMENT_ALLOWED.has(tok)) {
      if (['tahun', 'thn', 'bulan', 'terakhir', 'kabupaten', 'kab', 'kota', 'kepulauan', 'sula', 'kepsul', 
           'halmahera', 'ternate', 'tidore', 'morotai', 'taliabu', 'spesifik', 'khusus'].includes(tok)) {
        hasSignal = true;
      }
      continue;
    }
    return false;
  }

  return hasSignal;
}

/**
 * Check if message is a geo-only fragment (e.g. "kabupaten morotai", "ternate", "halmahera selatan")
 */
function isLikelyGeoOnlyFragment(raw) {
  if (!raw) return false;
  let t = String(raw).toLowerCase().trim();
  if (!t || t.length < 3) return false;
  
  // Strip filler patterns
  const fillerPatterns = [
    /\s*(ada|tidak|gimana|bagaimana|dong|deh|nih|sih|ya|yah|juga|saja|aja)\s*\?*$/i,
    /^\s*(di|untuk|pada|ke|dari)\s+/i,
    /\s*\?+$/,
  ];
  for (const pattern of fillerPatterns) {
    t = t.replace(pattern, '').trim();
  }
  
  if (!t || t.length < 3) return false;
  
  // Allow optional 'kabupaten', 'kab', 'kota' prefix
  const stripped = t.replace(/^(kabupaten|kab\.?|kota)\s+/i, '').trim();
  
  if (KNOWN_GEO.has(stripped)) return true;
  if (KNOWN_GEO.has(t)) return true;
  
  // "kabupaten X" pattern with known geo
  if (/^(kabupaten|kab\.?|kota)\s+/i.test(t) && stripped.length > 0) {
    return KNOWN_GEO.has(stripped);
  }
  
  return false;
}

/**
 * Filter out stopwords and filler words from query before merging
 */
function filterQueryFillers(query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return '';
  
  // Multi-word filler patterns
  const fillerPatterns = [
    /\byang tersedia\b/gi,
    /\byang ada\b/gi,
    /\bada apa\b/gi,
    /\bapa saja\b/gi,
    /\bberapa saja\b/gi,
    /\bseperti apa\b/gi,
    /\bbagaimana dengan\b/gi,
    /\bapakah ada\b/gi,
    /\bapakah tersedia\b/gi,
    /\btolong tampilkan\b/gi,
    /\bcoba tampilkan\b/gi,
    /\bmohon tampilkan\b/gi,
    /\bsilakan tampilkan\b/gi,
    /\bkalo\s+dalam\b/gi,
    /\bkalau\s+dalam\b/gi,
  ];
  
  let result = q;
  for (const pattern of fillerPatterns) {
    result = result.replace(pattern, ' ');
  }
  
  // Remove single filler words
  const tokens = result.split(/\s+/).filter(Boolean);
  const filteredTokens = tokens.filter(token => {
    const t = token.toLowerCase().replace(/[?!.,;:]+$/, '');
    return !FILLER_WORDS.has(t);
  });
  
  result = filteredTokens.join(' ').replace(/\s+/g, ' ').trim();
  
  if (!result || result.length < 2) {
    return q.replace(/\?+$/, '').trim();
  }
  
  return result;
}

// ============================================================================
// FOLLOW-UP AND COMPARISON DETECTION
// ============================================================================

/**
 * Check if message is a comparison/follow-up request that should keep context
 */
function isComparisonFollowUp(query) {
  const q = String(query || '').toLowerCase().trim();
  const patterns = [
    /^bandingkan\s+(dengan|sama)/i,
    /\bbandingkan\s+(dengan|sama)\s+(angka|data|kabupaten|kota|wilayah|daerah|provinsi)/i,
    /\bbagaimana\s+(dengan|di)\s+(kabupaten|kota|wilayah|daerah|provinsi)/i,
    /\b(kabupaten|kota|wilayah|daerah|provinsi)\s+(lain|lainnya)/i,
    /^(apa|berapa)\s+(saja\s+)?(angka|data)\s+(di\s+)?(kabupaten|kota|provinsi)/i,
    /^tampilkan\s+(semua|seluruh|per)\s+(kabupaten|kota|wilayah|provinsi)/i,
    /\bperbandingan\s+(dengan|antar)\s+(kabupaten|kota|wilayah|provinsi)/i,
    /\bbandingkan\s+dengan\s+provinsi/i,
  ];
  return patterns.some(p => p.test(q));
}

/**
 * Check if message is asking to break context and search from alternative sources
 */
function isAlternativeSourceRequest(query) {
  const q = String(query || '').toLowerCase().trim();
  const patterns = [
    /^ya\s+(dari|coba)\s+(survei|sumber|data)\s*(lain|lainnya)/i,
    /\b(dari|coba)\s+(survei|sumber|data)\s*(lain|lainnya)/i,
    /\b(survei|sumber|data)\s*(yang\s+)?(lain|lainnya)/i,
    /^cari\s+(dari|di)\s+(survei|sumber)\s*(lain|lainnya)/i,
    /^(bukan\s+)?(sensus|survei)\s*(ekonomi|pertanian|penduduk)?\s*[,.]?\s*(dari|coba|pakai)\s+(yang\s+)?(lain|lainnya)/i,
  ];
  return patterns.some(p => p.test(q));
}

/**
 * Check if message is a short follow-up that should inherit previous context
 */
function isShortFollowUp(raw) {
  const t = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return false;
  
  if (isComparisonFollowUp(t)) return true;
  if (t.length > 60) return false;
  
  const patterns = [
    /^\d{4}\s*(ada|tersedia|yang|saja)?\s*\??$/i,
    /^(untuk|di|spesifik|khusus)\s+(untuk\s+)?(kepulauan|kepsul|halsel|halut|halmahera|ternate|tidore|morotai|taliabu)/i,
    /^tahun\s+(berapa|apa)\s*(saja|yang|ada|tersedia)?/i,
    /^(ada|tersedia)\s+(data|tahun|periode)/i,
    /^(data\s+)?(tahun|periode)\s+(berapa|apa|mana)/i,
    /^ya\s+(tersedia|ada)\s+(untuk\s+)?(tahun|periode|data)/i,
    /^tampilkan\s*(data(nya)?)?$/i,
  ];
  
  return patterns.some(p => p.test(t));
}

// ============================================================================
// QUERY MERGING
// ============================================================================

/**
 * Merge base query with a fragment (e.g. "pengangguran" + "tahun 2025 kabupaten kepsul")
 */
function mergeQuery(base, fragment) {
  const b = String(base || '').trim();
  const f = String(fragment || '').trim();
  if (!b) return f;
  if (!f) return b;
  
  const fFiltered = filterQueryFillers(f);
  const bNorm = b.toLowerCase();
  const fNorm = fFiltered.toLowerCase();
  
  if (bNorm.includes(fNorm) && fNorm.length > 2) return b;
  
  // Check for geo in fragment
  let fragGeo = null;
  for (const pattern of GEO_PATTERNS) {
    const match = fNorm.match(pattern);
    if (match) {
      fragGeo = match[0];
      break;
    }
  }
  
  // Check for geo in base
  let baseGeo = null;
  for (const pattern of GEO_PATTERNS) {
    const match = bNorm.match(pattern);
    if (match) {
      baseGeo = match[0];
      break;
    }
  }
  
  let result = b;
  
  // Year replacement
  const fragYearMatch = f.match(/\b(19|20)\d{2}\b/);
  const baseYearMatch = b.match(/\b(19|20)\d{2}\b/);
  
  if (fragYearMatch && baseYearMatch) {
    result = result.replace(baseYearMatch[0], fragYearMatch[0]);
  } else if (fragYearMatch && !baseYearMatch) {
    result = `${result} ${fragYearMatch[0]}`;
  }
  
  // Geo replacement
  if (fragGeo && baseGeo) {
    for (const pattern of GEO_PATTERNS) {
      if (pattern.test(result)) {
        result = result.replace(pattern, '');
        break;
      }
    }
    result = `${result} ${fragGeo}`.replace(/\s+/g, ' ').trim();
  } else if (fragGeo && !baseGeo) {
    result = `${result} ${fragGeo}`;
  }
  
  // Add remaining content
  let fragRemaining = fFiltered
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/\s*(tahun|thn|periode)\s*/gi, '');
  
  if (fragGeo) {
    for (const pattern of GEO_PATTERNS) {
      fragRemaining = fragRemaining.replace(pattern, '');
    }
  }
  
  // Check if asking for kab/kota level data
  const asksKabKotaLevel = /\b(kabupaten|kab)(\s*(atau|dan|\/)\s*(kota)|\s*\/\s*kota|upaten\/kota)\b/i.test(fFiltered) ||
                           /\b(per|menurut|tiap|setiap)\s*(kabupaten|kab)\b/i.test(fFiltered);
  
  if (asksKabKotaLevel) {
    if (!result.toLowerCase().includes('kabupaten') && !result.toLowerCase().includes('kab/kota')) {
      result = `${result} kabupaten/kota`;
    }
    fragRemaining = fragRemaining.replace(/\s*(kabupaten|kab|kota|di|untuk|atau|dan)\s*/gi, ' ').trim();
  } else {
    fragRemaining = fragRemaining.replace(/\s*(kabupaten|kab|kota|di|untuk)\s*/gi, ' ').trim();
  }
  
  if (fragRemaining && fragRemaining.length > 2 && !/^(ada|tersedia|yang|saja)\??$/i.test(fragRemaining)) {
    if (!result.toLowerCase().includes(fragRemaining.toLowerCase())) {
      result = `${result} ${fragRemaining}`;
    }
  }
  
  return result.replace(/\s+/g, ' ').trim();
}

// ============================================================================
// DATA SUBJECT EXTRACTION
// ============================================================================

/**
 * Extract the data subject from a query (e.g. "angkatan kerja" from "kalau data angkatan kerja tahun terbaru?")
 */
function extractDataSubject(query) {
  const q = String(query || '').toLowerCase().trim();
  
  const subjectPatterns = [
    /\b(angkatan\s*kerja)\b/i,
    /\b(tenaga\s*kerja)\b/i,
    /\b(pengangguran|tpt)\b/i,
    /\b(kemiskinan|penduduk\s*miskin)\b/i,
    /\b(inflasi)\b/i,
    /\b(penduduk|populasi|jumlah\s*penduduk)\b/i,
    /\b(pdrb|produk\s*domestik)\b/i,
    /\b(ekspor|impor)\b/i,
    /\b(ipm|indeks\s*pembangunan)\b/i,
    /\b(tpak|partisipasi\s*angkatan\s*kerja)\b/i,
    /\b(gini|ketimpangan)\b/i,
    /\b(harapan\s*hidup|ahh)\b/i,
    /\b(pertumbuhan\s*ekonomi)\b/i,
    /\b(hotel|pariwisata|wisatawan)\b/i,
    /\b(sekolah|siswa|murid|guru|pendidikan)\b/i,
    /\b(kesehatan|rumah\s*sakit|puskesmas)\b/i,
    /\b(durian|mangga|pisang|jeruk|kelapa|sawit|padi|jagung|kopi|kakao|cengkeh)\b/i,
    /\b(produksi|luas\s*panen|luas\s*tanam)\b/i,
  ];
  
  for (const pattern of subjectPatterns) {
    const match = q.match(pattern);
    if (match) return match[1].trim();
  }
  
  return null;
}

// ============================================================================
// SUBSTANTIVE KEYWORD DETECTION
// ============================================================================

/**
 * Check if query contains substantive data-related keywords
 */
function hasSubstantiveKeywords(query) {
  const q = String(query || '').toLowerCase();
  
  if (isComparisonFollowUp(q)) return false;
  
  const patterns = [
    /\bdata\s+(tentang|terkait|mengenai|produksi|pertanian)/,
    /\b(produksi|luas|jumlah|angka|statistik)\s+\w+/,
    /\b(tanaman|buah|sayuran|komoditas|pertanian)\b/,
    /\b(durian|mangga|pisang|jeruk|padi|jagung|kelapa|sawit|kopi|kakao|cengkeh)\b/,
    /\b(pmtb|pembentukan\s*modal|modal\s*tetap\s*bruto|investasi|konsumsi\s*(rumah|pemerintah))\b/i,
    /\b(lapangan\s*usaha|pengeluaran|komponen\s*pdrb)\b/i,
    /^(penduduk|populasi|inflasi|ekspor|impor|kemiskinan|pengangguran|pdrb|ipm|hotel|sekolah)$/i,
  ];
  return patterns.some(p => p.test(q));
}

/**
 * Check if user is asking for a DIFFERENT data type that should break out of locked source
 */
function isDifferentDataTypeRequest(query, lockedSourceName) {
  const q = String(query || '').toLowerCase();
  const lockedName = String(lockedSourceName || '').toLowerCase();
  
  // Kab/kota vs province check
  const askingKabKota = /\b(kabupaten|kab\/kota|per\s*kab|menurut\s*kab|kota|kabupaten\/kota)\b/i.test(q);
  const lockedHasKabKota = /\b(kabupaten|kab\/kota|menurut\s*kab)\b/i.test(lockedName);
  if (askingKabKota && !lockedHasKabKota) return true;
  
  const askingProvinsi = /\b(provinsi|maluku\s*utara|malut)\b/i.test(q) && !/\b(kabupaten|kab|kota)\b/i.test(q);
  if (askingProvinsi && lockedHasKabKota) return true;
  
  // Data type keywords
  const dataTypeKeywords = {
    proyeksi: ['proyeksi', 'estimasi', 'prediksi', 'forecast'],
    laju: ['laju', 'pertumbuhan', 'growth'],
    rasio: ['rasio', 'perbandingan'],
    persentase: ['persentase', 'persen', '%'],
    indeks: ['indeks', 'index'],
    distribusi: ['distribusi', 'sebaran'],
    kepadatan: ['kepadatan', 'density'],
    rata: ['rata-rata', 'rataan', 'average', 'mean'],
  };
  
  for (const [, keywords] of Object.entries(dataTypeKeywords)) {
    for (const keyword of keywords) {
      if (q.includes(keyword)) {
        const lockedHasType = keywords.some(k => lockedName.includes(k));
        if (!lockedHasType) return true;
      }
    }
  }
  
  return false;
}

// ============================================================================
// PROCEDURAL/FAQ DETECTION
// ============================================================================

/**
 * Check if query is a procedural/FAQ question (not a data request)
 */
function isProceduralFaqQuery(query) {
  const q = String(query || '').toLowerCase();
  
  // Use dynamic patterns if available
  if (knowledgePatternsService) {
    return knowledgePatternsService.isProceduralQuerySync(q);
  }
  
  // Fallback patterns
  const faqPatterns = [
    /\b(siapa|who)\s+(kepala|pimpinan|direktur|wakil|sekretaris)/i,
    /\b(siapa)\s+.*(bps|badan\s*pusat\s*statistik)/i,
    /\b(apa\s+itu|apakah|pengertian|definisi)\s+\w+/i,
    /\b(dimana|where|lokasi|alamat)\s+(kantor|bps|pelayanan)/i,
    /\b(cara|bagaimana|how\s+to)\s+(mengunduh|download|mendapatkan|mengakses|mengajukan|daftar|registrasi)/i,
    /\b(cara|bagaimana|how)\s+(menggunakan|memakai|akses)/i,
    /\b(mekanisme|prosedur|tata\s*cara|langkah|tahap|alur)\s+\w+/i,
    /\b(transdata|allstats|silastik|romanis|sirusa|webapi)\b/i,
    /\b(nol\s*rupiah|layanan\s*gratis|gratis)\b/i,
    /\b(jam\s+(buka|kerja|operasional)|jadwal\s+pelayanan)\b/i,
    /\b(nomor\s+(telepon|hp|wa|whatsapp)|kontak|hubungi)\b/i,
    /\b(syarat|persyaratan|ketentuan|aturan)\s+(untuk|layanan|akses|data)/i,
    /\b(tugas|fungsi|visi|misi)\s+(bps|badan)/i,
    /\b(sejarah|profil)\s+(bps|kantor)/i,
  ];
  
  return faqPatterns.some(p => p.test(q));
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Fragment detection
  isLikelyTimeOrPeriodFragment,
  isLikelyGeoOnlyFragment,
  filterQueryFillers,
  
  // Follow-up detection
  isComparisonFollowUp,
  isAlternativeSourceRequest,
  isShortFollowUp,
  
  // Query merging
  mergeQuery,
  
  // Subject extraction
  extractDataSubject,
  
  // Keyword detection
  hasSubstantiveKeywords,
  isDifferentDataTypeRequest,
  
  // Procedural detection
  isProceduralFaqQuery,
  
  // Constants (for testing)
  KNOWN_GEO,
  GEO_PATTERNS,
};
