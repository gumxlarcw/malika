/**
 * Query Normalizer Service
 * 
 * Pre-processes user queries before intent detection:
 * - Expands abbreviations (TPT, PDRB, IPM, etc.)
 * - Normalizes common typos and variations
 * - Standardizes geo names
 * 
 * Used by streaming.service.js before search/intent detection.
 */

// ============================================================================
// ABBREVIATION EXPANSION
// ============================================================================

const ABBREVIATIONS = {
  // Economic indicators
  'tpt': 'Tingkat Pengangguran Terbuka',
  'pdrb': 'Produk Domestik Regional Bruto',
  'ipm': 'Indeks Pembangunan Manusia',
  'ihk': 'Indeks Harga Konsumen',
  'ntp': 'Nilai Tukar Petani',
  'ntup': 'Nilai Tukar Usaha Pertanian',
  'tpak': 'Tingkat Partisipasi Angkatan Kerja',
  'grdp': 'Produk Domestik Regional Bruto', // English alias
  
  // Demographic indicators
  'akb': 'Angka Kematian Bayi',
  'aki': 'Angka Kematian Ibu',
  'apk': 'Angka Partisipasi Kasar',
  'apm': 'Angka Partisipasi Murni',
  'ahh': 'Angka Harapan Hidup',
  'als': 'Angka Lama Sekolah',
  'rls': 'Rata-rata Lama Sekolah',
  'hls': 'Harapan Lama Sekolah',
  
  // Publication/Statistical terms
  'brs': 'Berita Resmi Statistik',
  'susenas': 'Survei Sosial Ekonomi Nasional',
  'sakernas': 'Survei Angkatan Kerja Nasional',
  'podes': 'Potensi Desa',
  'sptk': 'Survei Pertanian Tanaman Kegunaan',
  'stbp': 'Survei Tanaman Buah-buahan dan Sayuran Tahunan',
  'sp': 'Sensus Penduduk',
  'st': 'Sensus Pertanian',
  'se': 'Sensus Ekonomi',
  
  // EXIM terms
  'exim': 'Ekspor Impor',
  'hs': 'Harmonized System',
  'pod': 'Pelabuhan',
  'ctr': 'Negara',
  
  // Growth/Change terms
  'yoy': 'Year on Year',
  'mom': 'Month on Month',
  'qtq': 'Quarter to Quarter',
  'ytd': 'Year to Date',
  
  // Organizations
  'bps': 'Badan Pusat Statistik',
  'pst': 'Pelayanan Statistik Terpadu',
  
  // Common Indonesian abbreviations in queries
  'kab': 'Kabupaten',
  'kab.': 'Kabupaten',
  'thn': 'tahun',
  'bln': 'bulan',
};

/**
 * Expand abbreviations in query to full terms
 * @param {string} query - Raw user query
 * @returns {string} - Query with expanded abbreviations
 */
function expandAbbreviations(query) {
  if (!query) return '';
  
  let expanded = query;
  
  for (const [abbr, full] of Object.entries(ABBREVIATIONS)) {
    // Create regex that matches word boundary
    // Special handling for abbreviations with period (e.g., "kab.")
    const pattern = abbr.includes('.') 
      ? new RegExp(`\\b${abbr.replace('.', '\\.')}`, 'gi')
      : new RegExp(`\\b${abbr}\\b`, 'gi');
    
    // Only expand if it's clearly an abbreviation (all caps or common pattern)
    // Don't expand if it's part of a longer word
    expanded = expanded.replace(pattern, (match) => {
      // Preserve original casing style
      if (match === match.toUpperCase() && match.length <= 5) {
        return full; // TPT -> Tingkat Pengangguran Terbuka
      }
      return full.toLowerCase(); // tpt -> tingkat pengangguran terbuka
    });
  }
  
  return expanded;
}

// ============================================================================
// GEO NAME NORMALIZATION
// ============================================================================

const GEO_ALIASES = {
  // Kabupaten/Kota Maluku Utara
  'kepsul': 'Kepulauan Sula',
  'kep. sula': 'Kepulauan Sula',
  'kep sula': 'Kepulauan Sula',
  'kepulauan sula': 'Kepulauan Sula',
  
  'halsel': 'Halmahera Selatan',
  'hal sel': 'Halmahera Selatan',
  'hal. sel': 'Halmahera Selatan',
  'halmahera selatan': 'Halmahera Selatan',
  
  'halut': 'Halmahera Utara',
  'hal ut': 'Halmahera Utara',
  'hal. ut': 'Halmahera Utara',
  'halmahera utara': 'Halmahera Utara',
  
  'halbar': 'Halmahera Barat',
  'hal bar': 'Halmahera Barat',
  'hal. bar': 'Halmahera Barat',
  'halmahera barat': 'Halmahera Barat',
  
  'haltim': 'Halmahera Timur',
  'hal tim': 'Halmahera Timur',
  'hal. tim': 'Halmahera Timur',
  'halmahera timur': 'Halmahera Timur',
  
  'halteng': 'Halmahera Tengah',
  'hal teng': 'Halmahera Tengah',
  'hal. teng': 'Halmahera Tengah',
  'halmahera tengah': 'Halmahera Tengah',
  
  'tikep': 'Tidore Kepulauan',
  'kota tikep': 'Tidore Kepulauan',
  'tidore': 'Tidore Kepulauan',
  'tidore kepulauan': 'Tidore Kepulauan',
  
  'ternate': 'Kota Ternate',
  'kota ternate': 'Kota Ternate',
  
  'morotai': 'Pulau Morotai',
  'pulau morotai': 'Pulau Morotai',
  'p morotai': 'Pulau Morotai',
  'p. morotai': 'Pulau Morotai',
  
  'taliabu': 'Pulau Taliabu',
  'pulau taliabu': 'Pulau Taliabu',
  'p taliabu': 'Pulau Taliabu',
  'p. taliabu': 'Pulau Taliabu',
  
  // Provinsi
  'malut': 'Maluku Utara',
  'mal ut': 'Maluku Utara',
  'maluku utara': 'Maluku Utara',
};

/**
 * Normalize geo names to standard format
 * @param {string} query - Raw user query
 * @returns {string} - Query with normalized geo names
 */
function normalizeGeoNames(query) {
  if (!query) return '';
  
  let normalized = query.toLowerCase();
  
  // Sort by length (longest first) to avoid partial replacements
  const sortedAliases = Object.entries(GEO_ALIASES).sort((a, b) => b[0].length - a[0].length);
  
  for (const [alias, standard] of sortedAliases) {
    const pattern = new RegExp(`\\b${alias.replace(/\./g, '\\.')}\\b`, 'gi');
    normalized = normalized.replace(pattern, standard);
  }
  
  return normalized;
}

// ============================================================================
// TYPO CORRECTIONS
// ============================================================================

const COMMON_TYPOS = {
  // Common misspellings
  'pengganguran': 'pengangguran',
  'penganggoran': 'pengangguran',
  'pengangruran': 'pengangguran',
  'kemiskian': 'kemiskinan',
  'kemikinan': 'kemiskinan',
  'kemskinan': 'kemiskinan',
  'inflsi': 'inflasi',
  'infasi': 'inflasi',
  'inflaasi': 'inflasi',
  'pendudik': 'penduduk',
  'pendduk': 'penduduk',
  'ekonommi': 'ekonomi',
  'eknomi': 'ekonomi',
  'pertumbhan': 'pertumbuhan',
  'eksport': 'ekspor',
  'ekspr': 'ekspor',
  'imort': 'impor',
  'impot': 'impor',
  'statistk': 'statistik',
  'statisitk': 'statistik',
  'kabpaten': 'kabupaten',
  'kabupten': 'kabupaten',
  'kecamtan': 'kecamatan',
};

// ============================================================================
// CONCATENATED-TOKEN SPLITTING
// ============================================================================

// Curated dictionary of statistical-term concatenations seen in real queries.
// Each entry maps a no-space form to its space-separated form. Keys are
// matched case-insensitively; on match the lowercased split form is used
// (downstream lowercases queries anyway).
//
// Adding entries: only add concatenations of words that BOTH appear as
// independent terms in real BPS indicator names. Don't add general Indonesian
// word pairs — keep this targeted to statistical vocabulary.
const CONCATENATIONS = {
  'pertumbuhanekonomi': 'pertumbuhan ekonomi',
  'kondisiekonomi': 'kondisi ekonomi',
  'lajupertumbuhan': 'laju pertumbuhan',
  'tingkatpengangguran': 'tingkat pengangguran',
  'tingkatkemiskinan': 'tingkat kemiskinan',
  'tingkatpartisipasi': 'tingkat partisipasi',
  'angkaharapan': 'angka harapan',
  'angkamelek': 'angka melek',
  'angkakematian': 'angka kematian',
  'angkapartisipasi': 'angka partisipasi',
  'jumlahpenduduk': 'jumlah penduduk',
  'jumlahpekerja': 'jumlah pekerja',
  'hargakonsumen': 'harga konsumen',
  'indekspembangunan': 'indeks pembangunan',
  'indekshargakonsumen': 'indeks harga konsumen',
  'pendapatanperkapita': 'pendapatan per kapita',
  'pdrbperkapita': 'pdrb per kapita',
  'neracadagang': 'neraca dagang',
  'tenagakerja': 'tenaga kerja',
  'angkatankerja': 'angkatan kerja',
};

/**
 * Split known concatenated statistical terms (case-insensitive).
 * Returns lowercase result on match — downstream callers (searchDatasources)
 * already lowercase queries, so case-preservation isn't needed.
 *
 * @param {string|null|undefined} query
 * @returns {string}
 */
function splitConcatenated(query) {
  if (!query) return '';
  let out = String(query);
  for (const [joined, split] of Object.entries(CONCATENATIONS)) {
    const re = new RegExp(`\\b${joined}\\b`, 'gi');
    out = out.replace(re, split);
  }
  return out;
}

/**
 * Fix common typos in query
 * @param {string} query - Raw user query
 * @returns {string} - Query with fixed typos
 */
function fixTypos(query) {
  if (!query) return '';
  
  let fixed = query.toLowerCase();
  
  for (const [typo, correct] of Object.entries(COMMON_TYPOS)) {
    const pattern = new RegExp(`\\b${typo}\\b`, 'gi');
    fixed = fixed.replace(pattern, correct);
  }
  
  return fixed;
}

// ============================================================================
// FILLER WORD REMOVAL
// ============================================================================

const FILLER_PATTERNS = [
  /\b(tolong|dong|kak|bang|mbak|mas|ya|yaa|yaaa)\b/gi,
  /\b(mau|ingin|pengen|butuh|perlu)\s+(lihat|cari|tahu|tau)\b/gi,
  /\b(bisa|boleh)\s+(kasih|berikan|tampilkan|tunjukkan)\b/gi,
  /\b(aku|saya|gue|gw)\s+(mau|ingin|butuh)\b/gi,
  /^(hi|hai|halo|hello|hey)\s*/i,
  /\s*(makasih|terima kasih|thanks|thank you)\s*$/i,
];

/**
 * Remove filler words that don't add semantic meaning
 * @param {string} query - Raw user query
 * @returns {string} - Query without filler words
 */
function removeFillers(query) {
  if (!query) return '';
  
  let cleaned = query;
  
  for (const pattern of FILLER_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ');
  }
  
  return cleaned.replace(/\s+/g, ' ').trim();
}

// ============================================================================
// MAIN NORMALIZATION PIPELINE
// ============================================================================

/**
 * Full query normalization pipeline
 * @param {string} query - Raw user query
 * @param {Object} options - Options
 * @param {boolean} options.expandAbbr - Expand abbreviations (default: true)
 * @param {boolean} options.normalizeGeo - Normalize geo names (default: true)
 * @param {boolean} options.fixTypos - Fix common typos (default: true)
 * @param {boolean} options.removeFillers - Remove filler words (default: false)
 * @returns {string} - Normalized query
 */
function normalizeQuery(query, options = {}) {
  if (!query) return '';
  
  const {
    expandAbbr = true,
    normalizeGeo = true,
    fixTypos: shouldFixTypos = true,
    removeFillers: shouldRemoveFillers = false,
  } = options;
  
  let result = query.trim();

  // Order matters:
  // 0. Split known concatenated tokens FIRST so the typo fixer + geo + abbrev
  //    can see the word boundaries
  result = splitConcatenated(result);

  // 1. Fix typos first (so abbreviations work on corrected text)
  if (shouldFixTypos) {
    result = fixTypos(result);
  }
  
  // 2. Normalize geo names
  if (normalizeGeo) {
    result = normalizeGeoNames(result);
  }
  
  // 3. Expand abbreviations last (after geo normalization)
  if (expandAbbr) {
    result = expandAbbreviations(result);
  }
  
  // 4. Remove fillers (optional, can change meaning)
  if (shouldRemoveFillers) {
    result = removeFillers(result);
  }
  
  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Light normalization - just typos and geo, no abbreviation expansion
 * Use this for search queries where abbreviation expansion might hurt matching
 * @param {string} query - Raw user query
 * @returns {string} - Lightly normalized query
 */
function lightNormalize(query) {
  return normalizeQuery(query, {
    expandAbbr: false,
    normalizeGeo: true,
    fixTypos: true,
    removeFillers: false,
  });
}

/**
 * Get expanded version of query for LLM context
 * Includes all normalization for better LLM understanding
 * @param {string} query - Raw user query
 * @returns {string} - Fully expanded query
 */
function expandForLLM(query) {
  return normalizeQuery(query, {
    expandAbbr: true,
    normalizeGeo: true,
    fixTypos: true,
    removeFillers: false,
  });
}

module.exports = {
  // Main functions
  normalizeQuery,
  lightNormalize,
  expandForLLM,
  splitConcatenated,

  // Individual processors
  expandAbbreviations,
  normalizeGeoNames,
  fixTypos,
  removeFillers,

  // Exports for testing
  ABBREVIATIONS,
  GEO_ALIASES,
  COMMON_TYPOS,
  CONCATENATIONS,
};
