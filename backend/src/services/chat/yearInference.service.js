/**
 * Year Inference Service
 * 
 * Automatically infers the intended year from user queries.
 * Handles relative references like "tahun lalu", "tahun ini", etc.
 * 
 * Used to improve query understanding when user doesn't specify explicit year.
 */

// ============================================================================
// YEAR INFERENCE PATTERNS
// ============================================================================

/**
 * Get current year based on actual date
 * @returns {number}
 */
function getCurrentYear() {
  return new Date().getFullYear();
}

/**
 * Get current month (1-12)
 * @returns {number}
 */
function getCurrentMonth() {
  return new Date().getMonth() + 1;
}

/**
 * Get current quarter (1-4)
 * @returns {number}
 */
function getCurrentQuarter() {
  return Math.ceil(getCurrentMonth() / 3);
}

/**
 * Relative year patterns
 */
const RELATIVE_YEAR_PATTERNS = [
  // Tahun ini / this year
  {
    pattern: /\b(tahun\s+ini|thn\s+ini|year\s+ini)\b/i,
    resolver: () => getCurrentYear(),
    description: 'tahun ini',
  },
  // Tahun lalu / last year
  {
    pattern: /\b(tahun\s+lalu|tahun\s+kemarin|thn\s+lalu|last\s+year)\b/i,
    resolver: () => getCurrentYear() - 1,
    description: 'tahun lalu',
  },
  // 2 tahun lalu
  {
    pattern: /\b(\d+)\s+tahun\s+(lalu|yang\s+lalu|sebelumnya)\b/i,
    resolver: (match) => getCurrentYear() - parseInt(match[1]),
    description: 'N tahun lalu',
  },
  // Tahun depan
  {
    pattern: /\b(tahun\s+depan|tahun\s+berikutnya|next\s+year)\b/i,
    resolver: () => getCurrentYear() + 1,
    description: 'tahun depan',
  },
];

/**
 * Month patterns (Indonesian)
 */
const MONTH_PATTERNS = {
  januari: 1, jan: 1,
  februari: 2, feb: 2,
  maret: 3, mar: 3,
  april: 4, apr: 4,
  mei: 5,
  juni: 6, jun: 6,
  juli: 7, jul: 7,
  agustus: 8, agu: 8, ags: 8,
  september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10,
  november: 11, nov: 11,
  desember: 12, des: 12,
};

/**
 * Quarter patterns
 */
const QUARTER_PATTERNS = {
  'triwulan 1': 1, 'triwulan i': 1, 'tw1': 1, 'q1': 1,
  'triwulan 2': 2, 'triwulan ii': 2, 'tw2': 2, 'q2': 2,
  'triwulan 3': 3, 'triwulan iii': 3, 'tw3': 3, 'q3': 3,
  'triwulan 4': 4, 'triwulan iv': 4, 'tw4': 4, 'q4': 4,
};

// ============================================================================
// INFERENCE FUNCTIONS
// ============================================================================

/**
 * Extract explicit year from query (4-digit year)
 * @param {string} query - User query
 * @returns {number|null}
 */
function extractExplicitYear(query) {
  if (!query) return null;
  
  // Match 4-digit year (1990-2099)
  const match = query.match(/\b(19\d{2}|20\d{2})\b/);
  if (match) {
    return parseInt(match[1]);
  }
  
  return null;
}

/**
 * Extract year range from query
 * @param {string} query - User query
 * @returns {{start: number, end: number}|null}
 */
function extractYearRange(query) {
  if (!query) return null;
  
  // Match patterns like "2020-2024", "2020 - 2024", "2020 sampai 2024"
  const rangePattern = /\b(19\d{2}|20\d{2})\s*[-–—sampai hingga sd s\.?d\.?]\s*(19\d{2}|20\d{2})\b/i;
  const match = query.match(rangePattern);
  
  if (match) {
    return {
      start: parseInt(match[1]),
      end: parseInt(match[2]),
    };
  }
  
  return null;
}

/**
 * Resolve relative year references
 * @param {string} query - User query
 * @returns {{year: number, original: string}|null}
 */
function resolveRelativeYear(query) {
  if (!query) return null;
  
  const q = query.toLowerCase();
  
  for (const { pattern, resolver, description } of RELATIVE_YEAR_PATTERNS) {
    const match = q.match(pattern);
    if (match) {
      return {
        year: resolver(match),
        original: description,
        matchedText: match[0],
      };
    }
  }
  
  return null;
}

/**
 * Extract month from query
 * @param {string} query - User query
 * @returns {number|null} - Month number (1-12) or null
 */
function extractMonth(query) {
  if (!query) return null;
  
  const q = query.toLowerCase();
  
  // Check month names
  for (const [name, num] of Object.entries(MONTH_PATTERNS)) {
    const pattern = new RegExp(`\\b${name}\\b`, 'i');
    if (pattern.test(q)) {
      return num;
    }
  }
  
  // Check "bulan X" pattern
  const bulanMatch = q.match(/\bbulan\s+(\d{1,2})\b/);
  if (bulanMatch) {
    const month = parseInt(bulanMatch[1]);
    if (month >= 1 && month <= 12) {
      return month;
    }
  }
  
  return null;
}

/**
 * Extract quarter from query
 * @param {string} query - User query
 * @returns {number|null} - Quarter number (1-4) or null
 */
function extractQuarter(query) {
  if (!query) return null;
  
  const q = query.toLowerCase();
  
  for (const [pattern, num] of Object.entries(QUARTER_PATTERNS)) {
    if (q.includes(pattern)) {
      return num;
    }
  }
  
  // Check "triwulan X" pattern with digit
  const twMatch = q.match(/\btriwulan\s+(\d)\b/);
  if (twMatch) {
    const quarter = parseInt(twMatch[1]);
    if (quarter >= 1 && quarter <= 4) {
      return quarter;
    }
  }
  
  return null;
}

/**
 * Infer the most likely year for a query
 * Priority:
 * 1. Explicit year in query (e.g., "2024")
 * 2. Relative reference (e.g., "tahun lalu")
 * 3. Default to latest available year (passed as param)
 * 
 * @param {string} query - User query
 * @param {object} options
 * @param {number} options.latestAvailable - Latest available year in data
 * @param {boolean} options.preferLatest - If true, default to latest instead of current
 * @returns {object}
 */
function inferYear(query, options = {}) {
  const { latestAvailable, preferLatest = true } = options;
  
  const result = {
    year: null,
    source: null,
    range: null,
    month: null,
    quarter: null,
    isInferred: false,
  };
  
  // 1. Check for year range first
  const range = extractYearRange(query);
  if (range) {
    result.range = range;
    result.year = range.end; // Use end year as primary
    result.source = 'explicit_range';
    return result;
  }
  
  // 2. Check for explicit year
  const explicitYear = extractExplicitYear(query);
  if (explicitYear) {
    result.year = explicitYear;
    result.source = 'explicit';
    result.month = extractMonth(query);
    result.quarter = extractQuarter(query);
    return result;
  }
  
  // 3. Check for relative year
  const relative = resolveRelativeYear(query);
  if (relative) {
    result.year = relative.year;
    result.source = 'relative';
    result.originalRef = relative.original;
    result.isInferred = true;
    result.month = extractMonth(query);
    result.quarter = extractQuarter(query);
    return result;
  }
  
  // 4. Default behavior
  if (preferLatest && latestAvailable) {
    result.year = latestAvailable;
    result.source = 'default_latest';
    result.isInferred = true;
  } else {
    result.year = getCurrentYear();
    result.source = 'default_current';
    result.isInferred = true;
  }
  
  result.month = extractMonth(query);
  result.quarter = extractQuarter(query);
  
  return result;
}

/**
 * Check if query mentions a future year (likely prediction request)
 * @param {string} query - User query
 * @returns {boolean}
 */
function isFutureYearRequest(query) {
  const explicit = extractExplicitYear(query);
  if (explicit && explicit > getCurrentYear()) {
    return true;
  }
  
  const relative = resolveRelativeYear(query);
  if (relative && relative.original === 'tahun depan') {
    return true;
  }
  
  // Check for prediction keywords
  if (/\b(prediksi|proyeksi|perkiraan|estimasi|forecast)\b/i.test(query)) {
    return true;
  }
  
  return false;
}

/**
 * Replace relative year references with actual year in query
 * Useful for search/intent resolution
 * @param {string} query - User query
 * @returns {string}
 */
function normalizeYearInQuery(query) {
  if (!query) return '';
  
  let normalized = query;
  
  for (const { pattern, resolver, description } of RELATIVE_YEAR_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      const year = resolver(match);
      normalized = normalized.replace(match[0], `tahun ${year}`);
    }
  }
  
  return normalized;
}

module.exports = {
  // Core functions
  inferYear,
  extractExplicitYear,
  extractYearRange,
  resolveRelativeYear,
  extractMonth,
  extractQuarter,
  
  // Utility functions
  getCurrentYear,
  getCurrentMonth,
  getCurrentQuarter,
  isFutureYearRequest,
  normalizeYearInQuery,
  
  // Export patterns for testing
  RELATIVE_YEAR_PATTERNS,
  MONTH_PATTERNS,
  QUARTER_PATTERNS,
};
