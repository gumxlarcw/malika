/**
 * Geo Analysis Utilities
 * ======================
 * Single source of truth for ALL Maluku Utara geographic data.
 * Every file needing geo aliases/patterns/lists MUST import from here.
 *
 * Canonical data: shared/geo-regions.json
 * This module derives all structures needed across the codebase.
 */

const geoConfig = require('../../../shared/geo-regions.json');

// ============================================================================
// CORE DATA STRUCTURES (derived from geo-regions.json)
// ============================================================================

/** Region key → { name, aliases, kode_wilayah, type } */
const REGIONS = geoConfig.regions.reduce((acc, region) => {
  acc[region.key.toLowerCase()] = {
    name: region.name,
    aliases: region.aliases || [],
    kode_wilayah: region.kode_wilayah,
    type: region.type,
  };
  return acc;
}, {});

const PROVINCE_ALIASES = geoConfig.provinceAliases || [];
const PROVINCE_KODE = geoConfig.provinceKode || '82';

/** alias (lowercase) → canonical key */
const REGION_ALIASES = {};
for (const [canonical, data] of Object.entries(REGIONS)) {
  REGION_ALIASES[canonical.toLowerCase()] = canonical;
  for (const alias of data.aliases) {
    REGION_ALIASES[alias.toLowerCase()] = canonical;
  }
}

// ============================================================================
// DERIVED: KNOWN GEO PHRASES (for search geo-stripping)
// Used by: datasourceSearch.service.js, search.controller.js
// ============================================================================

/** Full region names + short single-word names (not abbreviations) */
const KNOWN_GEO_PHRASES = (() => {
  const phrases = new Set();
  // Add all region keys (full names)
  for (const key of Object.keys(REGIONS)) {
    phrases.add(key);
  }
  // Add province
  phrases.add('maluku utara');
  // Add common short forms that are substrings of keys
  for (const data of Object.values(REGIONS)) {
    for (const alias of data.aliases) {
      // Include non-abbreviated aliases (single words ≥4 chars, no dots/hyphens)
      if (!alias.includes('.') && !alias.includes('-') && alias.length >= 4 && !/^[a-z]{2,6}$/.test(alias)) {
        phrases.add(alias);
      }
    }
  }
  // Ensure these short forms are always included
  for (const name of ['ternate', 'tidore', 'morotai', 'taliabu', 'sula']) {
    phrases.add(name);
  }
  return Array.from(phrases);
})();

// ============================================================================
// DERIVED: KNOWN GEO SET (for fragment detection)
// Used by: queryContext.service.js, streaming.service.js
// ============================================================================

/** Set of all region names + common aliases for geo-only detection */
const KNOWN_GEO = (() => {
  const set = new Set();
  for (const [alias, canonical] of Object.entries(REGION_ALIASES)) {
    set.add(alias);
    // Also add the canonical key
    set.add(canonical);
  }
  // Add official names (lowercase)
  for (const data of Object.values(REGIONS)) {
    set.add(data.name.toLowerCase());
  }
  return set;
})();

// ============================================================================
// DERIVED: GEO FRAGMENT WORDS (individual tokens for allowed sets)
// Used by: queryContext.service.js, streaming.service.js
// ============================================================================

/** Individual geo words for the 'allowed' Set in fragment detection */
const GEO_FRAGMENT_WORDS = new Set([
  'kabupaten', 'kab', 'kota', 'provinsi',
  'kepulauan', 'pulau', 'maluku',
  'halmahera', 'selatan', 'utara', 'barat', 'timur', 'tengah',
  'ternate', 'tidore', 'morotai', 'taliabu', 'sula',
  'kepsul', 'halsel', 'halut', 'halbar', 'haltim', 'halteng',
]);

// ============================================================================
// DERIVED: GEO STOP WORDS (for topic extraction in vectorSearch)
// Used by: vectorSearch.service.js
// ============================================================================

/** Stop words to remove geo terms during topic extraction */
const GEO_STOP_WORDS = new Set([
  'maluku', 'utara', 'provinsi', 'kabupaten', 'kota',
  'ternate', 'tidore', 'halmahera', 'morotai', 'taliabu', 'sula',
  'indonesia', 'kepulauan', 'pulau',
]);

// ============================================================================
// DERIVED: GEO PATTERNS (regex array for replacement/detection)
// Used by: queryContext.service.js, streaming.service.js
// ============================================================================

/** Regex patterns matching each region (abbreviation|full name) */
const GEO_PATTERNS = [
  /\b(kepsul|kepulauan\s*sula)\b/gi,
  /\b(halsel|halmahera\s*selatan)\b/gi,
  /\b(halut|halmahera\s*utara)\b/gi,
  /\b(halbar|halmahera\s*barat)\b/gi,
  /\b(haltim|halmahera\s*timur)\b/gi,
  /\b(halteng|halmahera\s*tengah)\b/gi,
  /\b(tikep|tidore\s*kepulauan|kota\s*tidore)\b/gi,
  /\b(ternate|kota\s*ternate)\b/gi,
  /\b(morotai|pulau\s*morotai)\b/gi,
  /\b(taliabu|pulau\s*taliabu)\b/gi,
];

// ============================================================================
// DERIVED: GEO ABBREVIATION RULES (regex→replacement for normalizing)
// Used by: datasourceSearch.service.js
// ============================================================================

/** [regex, replacement] pairs for normalizing abbreviations to full names */
const GEO_ABBREVIATION_RULES = [
  [/\bhal[-\s]?teng\b/g, 'halmahera tengah'],
  [/\bhal[-\s]?ut\b/g, 'halmahera utara'],
  [/\bhalut\b/g, 'halmahera utara'],
  [/\bhal[-\s]?sel\b/g, 'halmahera selatan'],
  [/\bhalsel\b/g, 'halmahera selatan'],
  [/\bhal[-\s]?tim\b/g, 'halmahera timur'],
  [/\bhaltim\b/g, 'halmahera timur'],
  [/\bhal[-\s]?bar\b/g, 'halmahera barat'],
  [/\bhalbar\b/g, 'halmahera barat'],
  [/\btikep\b/g, 'tidore kepulauan'],
  [/\bkepsul\b/g, 'kepulauan sula'],
  [/\bpul\s*tal\b/g, 'pulau taliabu'],
  [/\bpultal\b/g, 'pulau taliabu'],
  [/\bpul\s*mor\b/g, 'pulau morotai'],
  [/\bpulmor\b/g, 'pulau morotai'],
];

// ============================================================================
// DERIVED: GEO EXPANSION MAP (for vectorSearch query expansion)
// Used by: vectorSearch.service.js
// ============================================================================

/** abbreviation/short → [expanded forms] for query expansion */
const GEO_EXPANSION_MAP = (() => {
  const map = {};
  for (const [key, data] of Object.entries(REGIONS)) {
    // Add short aliases → [key] mapping
    for (const alias of data.aliases) {
      const a = alias.toLowerCase();
      // Only short abbreviations (≤6 chars, no spaces/dots)
      if (a.length <= 6 && !a.includes(' ') && !a.includes('.')) {
        map[a] = [a, key];
      }
    }
    // Add key itself
    map[key] = [key];
  }
  // Province
  map['malut'] = ['malut', 'maluku utara'];
  return map;
})();

/** Identity map of full region names (for typo correction targets) */
const REGION_NAMES_MAP = (() => {
  const map = {};
  for (const key of Object.keys(REGIONS)) {
    map[key] = key;
  }
  map['maluku utara'] = 'maluku utara';
  map['ternate'] = 'ternate';
  return map;
})();

/** Common typo patterns for direct replacement */
const GEO_TYPO_PATTERNS = [
  [/\bkepulan\b/g, 'kepulauan'],
  [/\bhalmhera\b/g, 'halmahera'],
  [/\bhalmaher\b/g, 'halmahera'],
  [/\bmaluku\s*utar\b/g, 'maluku utara'],
  [/\bmorotay\b/g, 'morotai'],
  [/\btaliab\b/g, 'taliabu'],
];

// ============================================================================
// DERIVED: GEO DETECT REGEX (single combined regex)
// Used by: pipeline.service.js, streaming.service.js (isShortFollowUp)
// ============================================================================

/** Single regex matching any known geo term (abbreviation or full name) */
const GEO_DETECT_REGEX = /\b(kepsul|halsel|halut|halbar|haltim|halteng|tikep|kepulauan\s*sula|halmahera\s*(selatan|utara|barat|timur|tengah)|tidore\s*kepulauan|ternate|morotai|taliabu)\b/i;

// ============================================================================
// DERIVED: SEARCH REGIONS (for search.config.js)
// Used by: config/search.config.js
// ============================================================================

/** MALUT_REGIONS in search.config format: { official, aliases, type } */
const SEARCH_REGIONS = (() => {
  const result = {};
  for (const [key, data] of Object.entries(REGIONS)) {
    // Use common abbreviation as object key (e.g. "halbar" for "halmahera barat")
    // Prefer abbreviations 4-7 chars, falling back to single-word key or key itself
    const abbr = data.aliases.find(a => a.length >= 4 && a.length <= 7 && !a.includes(' ') && !a.includes('.') && !a.includes('-'));
    const shortKey = abbr || key.split(' ').pop();
    result[shortKey] = {
      official: data.name,
      aliases: [key, ...data.aliases.filter(a => a !== shortKey)],
      type: data.type,
    };
  }
  // Province entry
  result['malut'] = {
    official: 'Provinsi Maluku Utara',
    aliases: [...PROVINCE_ALIASES.filter(a => a !== 'provinsi')],
    type: 'provinsi',
  };
  return result;
})();

// ============================================================================
// DERIVED: WEB SEARCH REGIONS (flat array)
// Used by: webSearch.service.js
// ============================================================================

/** Flat array of all region names + common aliases for web search matching */
const WEB_SEARCH_REGIONS = (() => {
  const arr = new Set();
  arr.add('maluku utara');
  arr.add('malut');
  for (const [key, data] of Object.entries(REGIONS)) {
    arr.add(key);
    for (const alias of data.aliases) {
      const a = alias.toLowerCase();
      // Include short names and abbreviations, skip compound forms with dots
      if (!a.includes('.') && a.length >= 3) {
        arr.add(a);
      }
    }
  }
  return Array.from(arr);
})();

// ============================================================================
// FUNCTIONS: Geo region synonyms
// Used by: synonymExpansion.service.js
// ============================================================================

/** Get Map<canonicalName, synonyms[]> for geo synonym expansion */
function getMalutRegionSynonyms() {
  const map = new Map();
  for (const [key, data] of Object.entries(REGIONS)) {
    const synonyms = data.aliases.filter(a =>
      !a.includes('.') && a !== key
    );
    map.set(key, synonyms);
  }
  // Province
  map.set('maluku utara', PROVINCE_ALIASES.filter(a => a !== 'maluku utara' && a !== 'provinsi'));
  return map;
}

// ============================================================================
// FUNCTIONS: Geo shorthand expansion
// Used by: chat.service.js
// ============================================================================

/** Expand geo abbreviation/shorthand to full canonical key */
function expandGeoShorthand(geo) {
  if (!geo) return null;
  const g = geo.toLowerCase().replace(/[^a-z]/g, '');
  const canonical = REGION_ALIASES[g];
  if (!canonical) return null;
  // Return the canonical key itself (e.g., 'kepulauan sula' for 'kepsul')
  return canonical;
}

// ============================================================================
// FUNCTIONS: Geo prompt string builder
// Used by: prompt.service.js
// ============================================================================

/** Build the WILAYAH MALUKU UTARA section for LLM system prompt */
function buildGeoPromptString() {
  const lines = ['WILAYAH MALUKU UTARA (10 Kab/Kota):'];
  // Standard abbreviation display names
  const displayAbbr = {
    'tidore kepulauan': 'Tikep',
    'halmahera utara': 'Halut',
    'halmahera selatan': 'Halsel',
    'halmahera tengah': 'Halteng',
    'halmahera barat': 'Halbar',
    'halmahera timur': 'Haltim',
    'kepulauan sula': 'Kepsul',
  };
  for (const [key, data] of Object.entries(REGIONS)) {
    const abbr = displayAbbr[key];
    const prefix = data.type === 'kota' ? '' : 'Kab. ';
    const name = data.type === 'kota' ? data.name : data.name.replace('Kabupaten ', '');
    const label = abbr
      ? `${prefix}${name} / ${abbr}`
      : `${prefix}${name}`;
    lines.push(`- ${label} (kode ${data.kode_wilayah})`);
  }
  lines.push(`- Provinsi Maluku Utara / Malut (kode ${PROVINCE_KODE})`);
  return lines.join('\n');
}

// ============================================================================
// CORE FUNCTIONS (original geoAnalysis functions)
// ============================================================================

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeRegionName(name) {
  if (!name) return null;
  const canonical = REGION_ALIASES[name.toLowerCase()] || name.toLowerCase();
  const region = REGIONS[canonical];
  if (!region) return null;
  return region.name;
}

function findGeoMatches(query) {
  if (!query) return [];
  const q = String(query).toLowerCase();
  const found = [];

  for (const [alias, canonical] of Object.entries(REGION_ALIASES)) {
    const pattern = new RegExp(`\\b${escapeRegex(alias)}\\b`, 'i');
    if (pattern.test(q)) {
      if (!found.some(f => f.canonical === canonical)) {
        found.push({ canonical, matched: alias });
      }
    }
  }

  return found;
}

function extractAllGeoReferences(query) {
  return findGeoMatches(query).map(match => match.canonical);
}

function extractGeoFromQuery(query) {
  const matches = findGeoMatches(query);
  if (matches.length > 0) {
    const canonical = matches[0].canonical;
    return { region: REGIONS[canonical]?.name || 'Provinsi Maluku Utara', isExplicit: true };
  }

  const q = String(query || '').toLowerCase();
  if (PROVINCE_ALIASES.some(alias => new RegExp(`\\b${escapeRegex(alias)}\\b`, 'i').test(q))) {
    return { region: 'Provinsi Maluku Utara', isExplicit: true };
  }

  return { region: 'Provinsi Maluku Utara', isExplicit: false };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Core data
  REGIONS,
  REGION_ALIASES,
  PROVINCE_ALIASES,
  PROVINCE_KODE,

  // Derived structures
  KNOWN_GEO_PHRASES,
  KNOWN_GEO,
  GEO_FRAGMENT_WORDS,
  GEO_STOP_WORDS,
  GEO_PATTERNS,
  GEO_ABBREVIATION_RULES,
  GEO_EXPANSION_MAP,
  REGION_NAMES_MAP,
  GEO_TYPO_PATTERNS,
  GEO_DETECT_REGEX,
  SEARCH_REGIONS,
  WEB_SEARCH_REGIONS,

  // Functions
  normalizeRegionName,
  findGeoMatches,
  extractGeoFromQuery,
  extractAllGeoReferences,
  getMalutRegionSynonyms,
  expandGeoShorthand,
  buildGeoPromptString,
};
