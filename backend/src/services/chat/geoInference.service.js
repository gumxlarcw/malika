/**
 * Geo Inference Service
 * 
 * Automatically detects geographic references (kabupaten/kota) in user queries.
 * Used to apply geo filters when viewing data.
 */

// ============================================================================
// MALUKU UTARA GEOGRAPHIC DATA
// ============================================================================

/**
 * Complete list of kabupaten/kota in Maluku Utara with aliases
 */
const GEO_MALUT = {
  // Format: canonical_name -> { aliases: [], kode_wilayah: string }
  
  'ternate': {
    aliases: ['kota ternate', 'tte'],
    kode_wilayah: '8271',
    type: 'kota',
  },
  'tidore kepulauan': {
    aliases: ['kota tidore', 'tidore', 'tikep'],
    kode_wilayah: '8272',
    type: 'kota',
  },
  'halmahera barat': {
    aliases: ['halbar', 'halmaheraBarat', 'halmahera-barat'],
    kode_wilayah: '8201',
    type: 'kabupaten',
  },
  'halmahera tengah': {
    aliases: ['halteng', 'halmaheraTengah', 'halmahera-tengah'],
    kode_wilayah: '8202',
    type: 'kabupaten',
  },
  'halmahera utara': {
    aliases: ['halut', 'halmaheraUtara', 'halmahera-utara'],
    kode_wilayah: '8203',
    type: 'kabupaten',
  },
  'halmahera selatan': {
    aliases: ['halsel', 'halmaheraSelatan', 'halmahera-selatan'],
    kode_wilayah: '8204',
    type: 'kabupaten',
  },
  'halmahera timur': {
    aliases: ['haltim', 'halmaheraTimur', 'halmahera-timur'],
    kode_wilayah: '8205',
    type: 'kabupaten',
  },
  'kepulauan sula': {
    aliases: ['sula', 'kep. sula', 'kep sula', 'kepsula'],
    kode_wilayah: '8206',
    type: 'kabupaten',
  },
  'pulau morotai': {
    aliases: ['morotai', 'p. morotai', 'p morotai', 'pulauMorotai'],
    kode_wilayah: '8207',
    type: 'kabupaten',
  },
  'pulau taliabu': {
    aliases: ['taliabu', 'p. taliabu', 'p taliabu', 'pulauTaliabu'],
    kode_wilayah: '8208',
    type: 'kabupaten',
  },
};

// Build reverse lookup: alias -> canonical_name
const ALIAS_LOOKUP = {};
for (const [canonical, data] of Object.entries(GEO_MALUT)) {
  ALIAS_LOOKUP[canonical.toLowerCase()] = canonical;
  for (const alias of data.aliases) {
    ALIAS_LOOKUP[alias.toLowerCase()] = canonical;
  }
}

// ============================================================================
// DETECTION FUNCTIONS
// ============================================================================

/**
 * Extract geo references from a query
 * @param {string} query - User query
 * @returns {object[]} - Array of detected geo references
 */
function extractGeoReferences(query) {
  if (!query) return [];
  
  const q = query.toLowerCase();
  const found = [];
  
  // Check each alias
  for (const [alias, canonical] of Object.entries(ALIAS_LOOKUP)) {
    // Use word boundary matching
    const pattern = new RegExp(`\\b${escapeRegex(alias)}\\b`, 'i');
    if (pattern.test(q)) {
      const geoData = GEO_MALUT[canonical];
      if (!found.some(f => f.canonical === canonical)) {
        found.push({
          canonical,
          matched: alias,
          kode_wilayah: geoData.kode_wilayah,
          type: geoData.type,
        });
      }
    }
  }
  
  return found;
}

/**
 * Check if query is asking about specific kabupaten/kota
 * @param {string} query - User query
 * @returns {boolean}
 */
function hasGeoReference(query) {
  return extractGeoReferences(query).length > 0;
}

/**
 * Get the primary geo reference (first one found)
 * @param {string} query - User query
 * @returns {object|null}
 */
function getPrimaryGeo(query) {
  const refs = extractGeoReferences(query);
  return refs.length > 0 ? refs[0] : null;
}

/**
 * Check if query explicitly asks for "per kabupaten/kota" breakdown
 * This is different from asking about a specific kab/kota
 * @param {string} query - User query
 * @returns {boolean}
 */
function asksForKabKotaBreakdown(query) {
  if (!query) return false;
  
  const patterns = [
    /\bper\s+kabupaten\s*(\/|dan|kota)?\s*kota\b/i,
    /\bmenurut\s+kabupaten\s*(\/|dan|kota)?\s*kota\b/i,
    /\bper\s+kab\s*(\/|dan|kota)?\s*kota\b/i,
    /\btiap\s+kabupaten\s*(\/|dan|kota)?\s*kota\b/i,
    /\bmasing-masing\s+kabupaten\b/i,
    /\bsemua\s+kabupaten\b/i,
    /\bseluruh\s+kabupaten\b/i,
    /\bdata\s+kabupaten\b/i,
    /\bperkabupaten\b/i,
    /\bperwilayah\b/i,
    /\bper\s+wilayah\b/i,
  ];
  
  return patterns.some(p => p.test(query));
}

/**
 * Infer geo filter for a query
 * @param {string} query - User query
 * @returns {object}
 */
function inferGeoFilter(query) {
  const result = {
    hasGeo: false,
    geoFilter: null,
    geoReferences: [],
    asksBreakdown: false,
    shouldApplyFilter: false,
  };
  
  // Check if asking for breakdown (not specific filter)
  result.asksBreakdown = asksForKabKotaBreakdown(query);
  
  // Extract specific geo references
  result.geoReferences = extractGeoReferences(query);
  result.hasGeo = result.geoReferences.length > 0;
  
  // Determine if we should apply filter
  // Apply filter only if:
  // 1. Has specific geo reference AND
  // 2. Not asking for breakdown (which means show all)
  if (result.hasGeo && !result.asksBreakdown) {
    result.shouldApplyFilter = true;
    result.geoFilter = result.geoReferences[0]; // Primary geo
  }
  
  return result;
}

/**
 * Normalize geo reference in query (expand shorthand)
 * @param {string} query - User query
 * @returns {string}
 */
function normalizeGeoInQuery(query) {
  if (!query) return '';
  
  let normalized = query;
  
  // Expand common shorthands
  const expansions = [
    // Shorthand -> Full name
    [/\bhalbar\b/gi, 'Halmahera Barat'],
    [/\bhalteng\b/gi, 'Halmahera Tengah'],
    [/\bhalut\b/gi, 'Halmahera Utara'],
    [/\bhalsel\b/gi, 'Halmahera Selatan'],
    [/\bhaltim\b/gi, 'Halmahera Timur'],
    [/\btikep\b/gi, 'Tidore Kepulauan'],
    [/\bkepsula\b/gi, 'Kepulauan Sula'],
  ];
  
  for (const [pattern, replacement] of expansions) {
    normalized = normalized.replace(pattern, replacement);
  }
  
  return normalized;
}

/**
 * Get all kabupaten/kota names for prompt context
 * @returns {string[]}
 */
function getAllKabKotaNames() {
  return Object.keys(GEO_MALUT).map(name => 
    name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  );
}

/**
 * Validate if a geo name is valid
 * @param {string} name - Geo name to validate
 * @returns {boolean}
 */
function isValidGeoName(name) {
  if (!name) return false;
  return ALIAS_LOOKUP.hasOwnProperty(name.toLowerCase());
}

/**
 * Get canonical geo name from any alias
 * @param {string} alias - Alias to lookup
 * @returns {string|null}
 */
function getCanonicalGeoName(alias) {
  if (!alias) return null;
  const canonical = ALIAS_LOOKUP[alias.toLowerCase()];
  if (canonical) {
    return canonical.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  return null;
}

// ============================================================================
// HELPERS
// ============================================================================

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  // Core functions
  extractGeoReferences,
  hasGeoReference,
  getPrimaryGeo,
  inferGeoFilter,
  asksForKabKotaBreakdown,
  
  // Utility functions
  normalizeGeoInQuery,
  getAllKabKotaNames,
  isValidGeoName,
  getCanonicalGeoName,
  
  // Data exports
  GEO_MALUT,
  ALIAS_LOOKUP,
};
