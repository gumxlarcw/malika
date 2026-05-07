/**
 * Query Analysis Utilities
 * Shared utilities for query routing, period extraction, and signal detection
 */

// =====================================================
// PERIOD EXTRACTION UTILITIES
// =====================================================

const MONTH_MAP = {
  'januari': '01', 'jan': '01',
  'februari': '02', 'feb': '02',
  'maret': '03', 'mar': '03',
  'april': '04', 'apr': '04',
  'mei': '05', 'may': '05',
  'juni': '06', 'jun': '06',
  'juli': '07', 'jul': '07',
  'agustus': '08', 'agu': '08', 'aug': '08',
  'september': '09', 'sep': '09', 'sept': '09',
  'oktober': '10', 'okt': '10', 'oct': '10',
  'november': '11', 'nov': '11',
  'desember': '12', 'des': '12', 'dec': '12',
};

// Numeric month map (for EXIM and other services that need 1-12 instead of '01'-'12')
const MONTH_MAP_NUMERIC = {
  'januari': 1, 'jan': 1,
  'februari': 2, 'feb': 2,
  'maret': 3, 'mar': 3,
  'april': 4, 'apr': 4,
  'mei': 5, 'may': 5,
  'juni': 6, 'jun': 6,
  'juli': 7, 'jul': 7,
  'agustus': 8, 'agu': 8, 'ags': 8, 'aug': 8,
  'september': 9, 'sep': 9, 'sept': 9,
  'oktober': 10, 'okt': 10, 'oct': 10,
  'november': 11, 'nov': 11,
  'desember': 12, 'des': 12, 'dec': 12,
};

/**
 * Extract numeric month from query text
 * @param {string} query - Raw query text
 * @returns {number | null} - Month number 1-12 or null
 */
function extractMonthFromQuery(query) {
  const q = String(query || '').toLowerCase();
  for (const [name, num] of Object.entries(MONTH_MAP_NUMERIC)) {
    if (q.includes(name)) return num;
  }
  return null;
}

const MONTH_NAMES = {
  '01': 'Januari', '02': 'Februari', '03': 'Maret', '04': 'April',
  '05': 'Mei', '06': 'Juni', '07': 'Juli', '08': 'Agustus',
  '09': 'September', '10': 'Oktober', '11': 'November', '12': 'Desember',
};

const QUARTER_MAP = {
  'q1': { months: ['01', '02', '03'], label: 'Triwulan I' },
  'q2': { months: ['04', '05', '06'], label: 'Triwulan II' },
  'q3': { months: ['07', '08', '09'], label: 'Triwulan III' },
  'q4': { months: ['10', '11', '12'], label: 'Triwulan IV' },
  'triwulan 1': { months: ['01', '02', '03'], label: 'Triwulan I' },
  'triwulan 2': { months: ['04', '05', '06'], label: 'Triwulan II' },
  'triwulan 3': { months: ['07', '08', '09'], label: 'Triwulan III' },
  'triwulan 4': { months: ['10', '11', '12'], label: 'Triwulan IV' },
  'triwulan i': { months: ['01', '02', '03'], label: 'Triwulan I' },
  'triwulan ii': { months: ['04', '05', '06'], label: 'Triwulan II' },
  'triwulan iii': { months: ['07', '08', '09'], label: 'Triwulan III' },
  'triwulan iv': { months: ['10', '11', '12'], label: 'Triwulan IV' },
};

const SEMESTER_MAP = {
  'semester 1': { months: ['01', '02', '03', '04', '05', '06'], label: 'Semester I', code: 'S1' },
  'semester 2': { months: ['07', '08', '09', '10', '11', '12'], label: 'Semester II', code: 'S2' },
  'semester i': { months: ['01', '02', '03', '04', '05', '06'], label: 'Semester I', code: 'S1' },
  'semester ii': { months: ['07', '08', '09', '10', '11', '12'], label: 'Semester II', code: 'S2' },
  'sem 1': { months: ['01', '02', '03', '04', '05', '06'], label: 'Semester I', code: 'S1' },
  'sem 2': { months: ['07', '08', '09', '10', '11', '12'], label: 'Semester II', code: 'S2' },
  'sem i': { months: ['01', '02', '03', '04', '05', '06'], label: 'Semester I', code: 'S1' },
  'sem ii': { months: ['07', '08', '09', '10', '11', '12'], label: 'Semester II', code: 'S2' },
};

// =====================================================
// QUERY NORMALIZATION UTILITIES
// =====================================================

const PUNCTUATION_REGEX = /[.,;:!?()[\]{}'"`~|_+=*\/\\-]/g;
const WHITESPACE_REGEX = /\s+/g;
const YEAR_REGEX = /\b(20\d{2})\b/g;
const NUMBER_REGEX = /-?\d+(?:\.\d+)?/g;

/**
 * Normalize query by lowercasing, trimming, and removing punctuation.
 * @param {string} query
 * @returns {string}
 */
function normalizeQuery(query) {
  return String(query || '')
    .toLowerCase()
    .replace(PUNCTUATION_REGEX, ' ')
    .replace(WHITESPACE_REGEX, ' ')
    .trim();
}

/**
 * Split query into tokens (lowercased, punctuation removed).
 * @param {string} query
 * @returns {string[]}
 */
function tokenizeQuery(query) {
  const normalized = normalizeQuery(query);
  if (!normalized) return [];
  return normalized.split(' ').filter(Boolean);
}

/**
 * Extract year mentions from query.
 * @param {string} query
 * @returns {number[]} - Unique years in appearance order
 */
function extractYearFromQuery(query) {
  const q = String(query || '');
  const matches = q.match(YEAR_REGEX) || [];
  const seen = new Set();
  const years = [];
  for (const match of matches) {
    const yearNum = Number(match);
    if (!Number.isNaN(yearNum) && !seen.has(yearNum)) {
      seen.add(yearNum);
      years.push(yearNum);
    }
  }
  return years;
}

/**
 * Extract numeric values from query (integers or decimals).
 * @param {string} query
 * @returns {number[]}
 */
function extractNumbersFromQuery(query) {
  const q = String(query || '');
  const matches = q.match(NUMBER_REGEX) || [];
  return matches
    .map((val) => Number(val))
    .filter((val) => !Number.isNaN(val));
}

/**
 * Extract period info from query text
 * @param {string} query - Raw query text
 * @returns {{ hasPeriod: boolean, year?: string, month?: string, monthName?: string, quarter?: string, quarterInfo?: object, display?: string }}
 */
function extractPeriodFromQuery(query) {
  const q = String(query || '').toLowerCase().trim();
  
  // Extract year (4 digits starting with 20)
  const yearMatch = q.match(/\b(20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : null;
  
  // Extract month
  let month = null;
  let monthName = null;
  for (const [key, val] of Object.entries(MONTH_MAP)) {
    if (q.includes(key)) {
      month = val;
      monthName = MONTH_NAMES[val];
      break;
    }
  }
  
  // Extract quarter
  let quarter = null;
  let quarterInfo = null;
  for (const [key, info] of Object.entries(QUARTER_MAP)) {
    if (q.includes(key)) {
      quarter = key;
      quarterInfo = info;
      break;
    }
  }

  // Extract semester
  let semester = null;
  let semesterInfo = null;
  for (const [key, info] of Object.entries(SEMESTER_MAP)) {
    if (q.includes(key)) {
      semester = info.code;
      semesterInfo = info;
      break;
    }
  }
  
  // Build display string
  let display = '';
  if (month && year) {
    display = `${monthName} ${year}`;
  } else if (quarterInfo && year) {
    display = `${quarterInfo.label} ${year}`;
  } else if (year) {
    display = `Tahun ${year}`;
  } else if (month) {
    display = `${monthName} (tanpa tahun)`;
  } else if (quarterInfo) {
    display = `${quarterInfo.label} (tanpa tahun)`;
  }
  
  // hasPeriod should only be true if we have YEAR
  // Month/quarter/semester without year is not useful for filtering
  const hasMeaningfulPeriod = !!year;
  
  return {
    hasPeriod: hasMeaningfulPeriod,
    hasPartialPeriod: !!(month || quarter || semester) && !year, // For display purposes only
    hasExplicitPeriod: !!(year || month || quarter || semester),
    year,
    month,
    monthName,
    quarter,
    quarterInfo,
    semester,
    semesterInfo,
    display,
  };
}

/**
 * Build regex pattern for matching period in data_period_map.period_value
 * period_value format: "2025-12" (monthly), "2025-Q4" (quarterly), "2025" (yearly)
 */
function buildPeriodPattern(extracted) {
  const patterns = [];
  
  if (extracted.month && extracted.year) {
    // Monthly: "2025-12"
    patterns.push(`${extracted.year}-${extracted.month}`);
  }
  
  if (extracted.quarterInfo && extracted.year) {
    // Quarterly: "2025-Q4" or months in quarter
    const qNum = extracted.quarter.replace(/\D/g, '') || 
                 (extracted.quarter.includes('i') ? extracted.quarter.split('i').length : '');
    patterns.push(`${extracted.year}-Q${qNum}`);
    // Also match individual months in the quarter
    extracted.quarterInfo.months.forEach(m => {
      patterns.push(`${extracted.year}-${m}`);
    });
  }
  
  if (extracted.year && !extracted.month && !extracted.quarterInfo) {
    // Yearly: starts with year
    patterns.push(`${extracted.year}`);
  }
  
  if (patterns.length === 0) return /(?!)/; // Match nothing
  
  return new RegExp(patterns.join('|'), 'i');
}

/**
 * Build regex pattern for matching period in BRS/Publication content
 * More flexible - matches "Desember 2025", "Des 2025", "12/2025", etc.
 */
function buildContentPeriodPattern(extracted) {
  const patterns = [];
  
  if (extracted.monthName && extracted.year) {
    // "Desember 2025", "Des 2025"
    patterns.push(`${extracted.monthName.toLowerCase()}\\s*${extracted.year}`);
    patterns.push(`${extracted.monthName.slice(0, 3).toLowerCase()}\\s*${extracted.year}`);
    // "12/2025", "12-2025"
    patterns.push(`${extracted.month}[/-]${extracted.year}`);
    // "2025-12"
    patterns.push(`${extracted.year}[/-]${extracted.month}`);
  }
  
  if (extracted.quarterInfo && extracted.year) {
    // "Triwulan IV 2025", "Q4 2025"
    patterns.push(`${extracted.quarterInfo.label.toLowerCase().replace(' ', '\\s*')}\\s*${extracted.year}`);
    patterns.push(`q${extracted.quarter.replace(/\D/g, '')}\\s*${extracted.year}`);
    patterns.push(`${extracted.year}\\s*${extracted.quarterInfo.label.toLowerCase()}`);
  }
  
  if (extracted.year && !extracted.monthName && !extracted.quarterInfo) {
    // Just year - match any mention of the year
    patterns.push(`\\b${extracted.year}\\b`);
  }
  
  if (patterns.length === 0) return /(?!)/; // Match nothing
  
  return new RegExp(patterns.join('|'), 'i');
}

// =====================================================
// QUERY SIGNAL DETECTION
// =====================================================

/**
 * Data signals - patterns indicating statistical/data queries
 * These queries should show data tables + BRS + Publications
 */
const DATA_SIGNALS = [
  // Explicit data keywords
  /\b(data\s+(penduduk|kemiskinan|inflasi|pengangguran|ekspor|impor|pdrb|ipm|tpt))\b/i,
  /\b(angka|banyaknya|persentase|persen|%)\b/i,
  /\b(tabel|grafik|chart|diagram)\b/i,
  // Time periods for data (years, quarters, months)
  /\b(tahun\s+\d{4}|\b20\d{2}\b)\b/i,
  /\b(triwulan|semester|kuartal|q[1-4])\b/i,
  // Geographic data queries with comparison intent
  /\b(kabupaten|kota|kecamatan|desa|kelurahan|provinsi|wilayah)\s+(mana|apa|tertinggi|terendah)/i,
  // Comparative/ranking queries (data-focused)
  /\b(tertinggi|terendah|terbesar|terkecil|naik|turun|pertumbuhan|growth)\b/i,
  /\b(bandingkan|perbandingan|dibanding|versus|vs)\b/i,
  /\b(berapa|how\s+much|how\s+many)\s+(jumlah|angka|nilai|total)/i,
  // Common statistical indicators (with following geo/year context)
  /\b(inflasi|kemiskinan|pengangguran|tpt|ipm|pdrb|ekspor|impor|penduduk)\s+(maluku|2\d{3}|kabupaten|kota)/i,
  // Standalone statistical indicator acronyms/keywords — always data queries
  // These are unambiguous statistical terms that never mean non-data queries on their own
  /\b(pdrb|ipm|tpt|tpak|ihk|gini|apbd|ekspor|impor)\b/i,
  // Statistical indicators followed by any region name (not just "maluku/kabupaten/kota")
  /\b(inflasi|kemiskinan|pengangguran|penduduk|pdrb|ipm)\s+(halmahera|ternate|tidore|morotai|taliabu|sula)\b/i,
];

/**
 * Knowledge/service signals - patterns indicating non-statistical queries
 * These queries should use custom documents (PPID, FAQ, guides)
 */
const KNOWLEDGE_SIGNALS = [
  /\b(siapa|who)\b/i,
  /\b(apa\s+itu|apakah|pengertian|definisi)\b/i,
  /\b(bagaimana|how\s+to|cara)\b/i,
  /\b(layanan|pelayanan)\b/i,
  /\b(prosedur|tata\s*cara|tahap|tahapan|langkah)\b/i,
  /\b(nol\s*rupiah|rekomendasi\s+statistik)\b/i,
  /\b(sensus|survei|sakernas|susenas|supas)\b/i,
  /\b(jam\s+(buka|kerja|operasional)|alamat|kontak)\b/i,
];

/**
 * Check if query has data signals
 * @param {string} query
 * @returns {boolean}
 */
function hasDataSignal(query) {
  const q = String(query || '').toLowerCase().trim();
  return DATA_SIGNALS.some(p => p.test(q));
}

/**
 * Check if query has knowledge/service signals
 * @param {string} query
 * @returns {boolean}
 */
function hasKnowledgeSignal(query) {
  const q = String(query || '').toLowerCase().trim();
  return KNOWLEDGE_SIGNALS.some(p => p.test(q));
}

/**
 * Analyze query and determine routing type
 * @param {string} query - Raw query text
 * @param {number} customDocSimilarity - Similarity to custom docs (PPID, FAQ) - NOT BRS/Publications
 * @returns {{ type: 'statistical'|'non-statistical', reason: string, signals: { hasDataSignal: boolean, hasKnowledgeSignal: boolean } }}
 */
function analyzeQueryRouting(query, customDocSimilarity = 0) {
  const q = String(query || '').toLowerCase().trim();
  
  const hasData = hasDataSignal(q);
  const hasKnowledge = hasKnowledgeSignal(q);
  
  let type = 'statistical';
  let reason = '';
  
  if (hasData && !hasKnowledge) {
    type = 'statistical';
    reason = 'Has data signals (angka/tabel/tahun/dll)';
  } else if (hasKnowledge && !hasData) {
    type = 'non-statistical';
    reason = 'Has knowledge signals (siapa/apa itu/cara/dll)';
  } else if (hasKnowledge && hasData) {
    // Mixed signals - use custom doc similarity to decide
    type = customDocSimilarity >= 0.55 ? 'non-statistical' : 'statistical';
    reason = `Mixed signals, using custom doc similarity (${customDocSimilarity.toFixed(2)}) to decide`;
  } else if (customDocSimilarity >= 0.55) {
    type = 'non-statistical';
    reason = `High custom doc similarity (${customDocSimilarity.toFixed(2)})`;
  } else {
    type = 'statistical';
    reason = 'Default to statistical (no clear signals)';
  }
  
  return {
    type,
    reason,
    signals: {
      hasDataSignal: hasData,
      hasKnowledgeSignal: hasKnowledge,
    },
  };
}

/**
 * Categories that are considered statistical content
 */
const STATISTICAL_CATEGORIES = ['brs', 'publication'];

/**
 * Categories that are considered custom/non-statistical content
 */
const CUSTOM_DOC_CATEGORIES = ['ppid', 'faq', 'guide', 'about', 'manual'];

/**
 * Check if a category is statistical
 * @param {string} category
 * @returns {boolean}
 */
function isStatisticalCategory(category) {
  return STATISTICAL_CATEGORIES.includes(String(category || '').toLowerCase());
}

/**
 * Check if a category is custom/non-statistical
 * @param {string} category
 * @returns {boolean}
 */
function isCustomDocCategory(category) {
  return CUSTOM_DOC_CATEGORIES.includes(String(category || '').toLowerCase());
}

// =====================================================
// PERIOD RANGE EXTRACTION (for multi-year queries)
// =====================================================

/**
 * Extract period range or specific years from query builder clauses
 * Supports:
 * - Continuous range: "2020-2024", "2020 sampai 2024" → generates all years in between
 * - Specific years: "2020, 2022, 2024", "2020 dan 2024" → uses exact years from clauses
 * @param {Object} queryBuilder - Query builder with clauses array
 * @returns {{ yearStart: number, yearEnd: number, years: number[], isSpecificYears: boolean } | null}
 */
function extractPeriodRange(queryBuilder) {
  if (!queryBuilder?.clauses || !Array.isArray(queryBuilder.clauses)) return null;
  
  const timeClauses = queryBuilder.clauses.filter(c => c.kind === 'time' && c.year);
  if (timeClauses.length <= 1) return null; // Not a range/multiple years
  
  const clauseYears = [...new Set(timeClauses.map(c => c.year))].sort((a, b) => a - b);
  const yearStart = clauseYears[0];
  const yearEnd = clauseYears[clauseYears.length - 1];
  
  // Detect if this is a continuous range or specific years
  let isSpecificYears = false;
  let years = [];
  
  if (clauseYears.length === 2) {
    // Two years: treat as continuous range (e.g., "2020-2024", "2020 sampai 2024")
    for (let y = yearStart; y <= yearEnd; y++) {
      years.push(y);
    }
  } else {
    // 3+ years: check if they're consecutive
    const expectedContinuous = yearEnd - yearStart + 1;
    if (clauseYears.length === expectedContinuous) {
      // All years are consecutive (e.g., "2020, 2021, 2022, 2023")
      years = clauseYears;
    } else {
      // Non-consecutive specific years (e.g., "2020, 2022, 2024")
      isSpecificYears = true;
      years = clauseYears;
    }
  }
  
  // Sanity check: don't allow more than 10 years
  if (years.length > 10) {
    years = years.slice(-10); // Take last 10 years
  }
  
  return {
    yearStart,
    yearEnd,
    years,
    isSpecificYears,
  };
}

// =====================================================
// DERIVED MONTH UTILITIES (canonical — import these, don't redefine)
// =====================================================

/** Ordered array of capitalized month names (index 0 = Januari) */
const MONTH_ORDER = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember',
];

/** Numeric key → capitalized month name ({ 1: 'Januari', ... , 12: 'Desember' }) */
const MONTH_NUM_TO_NAME = Object.fromEntries(
  MONTH_ORDER.map((name, i) => [i + 1, name])
);

/** Capitalized month name → numeric value ({ 'Januari': 1, ..., 'Desember': 12 }) */
const MONTH_NAME_TO_NUM = Object.fromEntries(
  MONTH_ORDER.map((name, i) => [name, i + 1])
);

/** Set of all known month name strings (lowercase + abbreviations) for detection */
const MONTH_NAMES_SET = new Set(Object.keys(MONTH_MAP_NUMERIC));

/** Regex that matches any Indonesian month name (case-insensitive) */
const MONTH_REGEX = /\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\b/gi;

/** Regex matching "MonthName YYYY" pattern for period extraction from titles */
const MONTH_YEAR_REGEX = /\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(\d{4})\b/i;

module.exports = {
  // Period extraction
  MONTH_MAP,
  MONTH_MAP_NUMERIC,
  MONTH_NAMES,
  MONTH_ORDER,
  MONTH_NUM_TO_NAME,
  MONTH_NAME_TO_NUM,
  MONTH_NAMES_SET,
  MONTH_REGEX,
  MONTH_YEAR_REGEX,
  QUARTER_MAP,
  extractPeriodFromQuery,
  extractMonthFromQuery,
  extractPeriodRange,
  buildPeriodPattern,
  buildContentPeriodPattern,

  // Query normalization
  normalizeQuery,
  tokenizeQuery,
  extractYearFromQuery,
  extractNumbersFromQuery,
  
  // Signal detection
  DATA_SIGNALS,
  KNOWLEDGE_SIGNALS,
  hasDataSignal,
  hasKnowledgeSignal,
  analyzeQueryRouting,
  
  // Category helpers
  STATISTICAL_CATEGORIES,
  CUSTOM_DOC_CATEGORIES,
  isStatisticalCategory,
  isCustomDocCategory,
};
