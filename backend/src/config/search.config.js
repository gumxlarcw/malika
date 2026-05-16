/**
 * Search Configuration
 * 
 * Externalized configuration for search-related services.
 * This file centralizes hard-coded values to make them:
 * 1. Easy to modify without code changes
 * 2. Potentially loadable from database in future
 * 3. Environment-specific via process.env overrides
 * 
 * @module search.config
 * @created 2026-01-25
 */

'use strict';

/**
 * Stopwords - words to exclude from search terms
 * These are common words that don't add search value
 */
const STOPWORDS = [
  // Indonesian question words
  'apa', 'siapa', 'bagaimana', 'kapan', 'dimana', 'mengapa', 'berapa',
  // Common prepositions/conjunctions
  'dan', 'atau', 'untuk', 'dari', 'yang', 'di', 'ke', 'ini', 'itu',
  'adalah', 'dengan', 'pada', 'oleh', 'sebagai', 'jika', 'bila',
  // Generic data terms (too broad)
  'data', 'angka', 'nilai', 'jumlah', 'total',
  // Time-related (handled separately)
  'tahun', 'bulan', 'terbaru', 'terkini', 'terakhir', 'lalu',
  // Region prefix (handled by geo extraction)
  'provinsi', 'kabupaten', 'kota', 'kecamatan', 'desa', 'kelurahan',
];

// Maluku Utara regions — derived from canonical shared/geo-regions.json
const { SEARCH_REGIONS: MALUT_REGIONS } = require('../utils/geoAnalysis');

/**
 * Statistical topics that trigger special handling
 * - Higher topN for knowledge search
 * - Lower similarity threshold
 * - Latest-first clustering
 */
const STATISTICAL_TOPICS = [
  // Core indicators
  { topic: 'kemiskinan', aliases: ['miskin', 'penduduk miskin', 'garis kemiskinan', 'poverty'] },
  { topic: 'inflasi', aliases: ['ihk', 'indeks harga konsumen', 'cpi', 'consumer price'] },
  { topic: 'pengangguran', aliases: ['penganggur', 'nganggur', 'tpt', 'tingkat pengangguran terbuka', 'unemployment'] },
  { topic: 'pdrb', aliases: ['produk domestik regional bruto', 'pertumbuhan ekonomi', 'ekonomi', 'gdp'] },
  { topic: 'ipm', aliases: ['indeks pembangunan manusia', 'human development index', 'hdi'] },
  { topic: 'gini', aliases: ['gini ratio', 'gini rasio', 'ketimpangan', 'inequality'] },
  { topic: 'ekspor', aliases: ['export', 'ekspor impor', 'exim'] },
  { topic: 'impor', aliases: ['import'] },
  { topic: 'tpak', aliases: ['angkatan kerja', 'partisipasi angkatan kerja', 'labor force'] },
  { topic: 'penduduk', aliases: ['demografi', 'populasi', 'population', 'kependudukan'] },
  { topic: 'upah', aliases: ['gaji', 'umr', 'ump', 'wages', 'salary'] },
  // Migration/movement indicators
  { topic: 'migrasi', aliases: ['perpindahan', 'pindahan', 'pendatang', 'mobilitas', 'migration'] },
  { topic: 'emigrasi', aliases: ['migrasi keluar', 'pindah keluar', 'keluar daerah'] },
  { topic: 'imigrasi', aliases: ['migrasi masuk', 'pindah masuk', 'masuk daerah'] },
  // Additional indicators
  { topic: 'wisatawan', aliases: ['pariwisata', 'tourism', 'tourist', 'tpk', 'hotel'] },
  { topic: 'industri', aliases: ['manufaktur', 'manufacturing', 'ibs'] },
  { topic: 'pertanian', aliases: ['pangan', 'padi', 'rice', 'agriculture'] },
  { topic: 'perikanan', aliases: ['ikan', 'fish', 'tangkap', 'budidaya'] },
  { topic: 'perdagangan', aliases: ['dagang', 'trade', 'retail'] },
  { topic: 'transportasi', aliases: ['transport', 'logistik', 'pelabuhan', 'bandara'] },
];

/**
 * Search scoring weights
 */
const SCORING_WEIGHTS = {
  // Keyword matching
  KEYWORD_MATCH: 10,           // Points per keyword match
  GEO_TERM_MATCH: 30,          // Points for geo-term match (3x normal)
  
  // Bonus points
  NUMBER_ROW_BONUS: 5,         // Lines with multiple numbers
  NUMBER_ROW_GEO_BONUS: 20,    // Lines with numbers + geo match
  EXACT_MATCH_BONUS: 15,       // Exact phrase match
  TITLE_MATCH_BONUS: 25,       // Match in document title
  
  // Similarity thresholds (lowered for wide-recall + AI reranker pipeline)
  KNOWLEDGE_MIN_SIMILARITY: 0.25,         // Default minimum (was 0.40)
  STATISTICAL_MIN_SIMILARITY: 0.25,       // Same as default (was 0.30)
  HIGH_CONFIDENCE_THRESHOLD: 0.70,        // High confidence match
  
  // Result limits
  DEFAULT_TOP_N: 5,
  STATISTICAL_TOP_N: 8,
  MAX_EXTRACTION_CHARS: 8000,
};

/**
 * Synonym expansion settings
 */
const SYNONYM_CONFIG = {
  // When to trigger synonym expansion
  MIN_MATCHES_THRESHOLD: 3,    // Expand if fewer than this many matches
  
  // LLM settings
  MODEL: process.env.OPENAI_MODEL_SYNONYM || 'claude-sonnet-4-6',
  TEMPERATURE: 0.3,
  MAX_TOKENS: 500,
  
  // Cache settings
  CACHE_TTL_MS: 60 * 60 * 1000,  // 1 hour
  CACHE_CLEAN_INTERVAL_MS: 10 * 60 * 1000, // 10 minutes
};

/**
 * Get all geo aliases as a flat array
 * @returns {string[]}
 */
function getAllGeoAliases() {
  const aliases = [];
  for (const region of Object.values(MALUT_REGIONS)) {
    aliases.push(...region.aliases);
  }
  return aliases;
}

/**
 * Check if a term is a statistical topic
 * @param {string} term - Term to check
 * @returns {boolean}
 */
function isStatisticalTopic(term) {
  const termLower = term.toLowerCase();
  return STATISTICAL_TOPICS.some(t => 
    t.topic === termLower || 
    t.aliases.some(a => termLower.includes(a) || a.includes(termLower))
  );
}

/**
 * Get all aliases for a statistical topic
 * @param {string} topic - Topic name
 * @returns {string[]}
 */
function getTopicAliases(topic) {
  const topicLower = topic.toLowerCase();
  const found = STATISTICAL_TOPICS.find(t => 
    t.topic === topicLower || t.aliases.includes(topicLower)
  );
  return found ? [found.topic, ...found.aliases] : [topic];
}

/**
 * Detect geo region from query
 * @param {string} query - User query
 * @returns {{region: object, matched: string} | null}
 */
function detectGeoRegion(query) {
  const queryLower = query.toLowerCase();
  for (const [key, region] of Object.entries(MALUT_REGIONS)) {
    for (const alias of region.aliases) {
      if (queryLower.includes(alias)) {
        return { region, matched: alias, key };
      }
    }
  }
  return null;
}

/**
 * Datasource IDs to ignore in search results.
 * These are meta/system sources that should not appear in user-facing results.
 * IDs 166-169: internal system datasources (not user-relevant).
 */
const IGNORED_SOURCE_IDS = new Set([166, 167, 168, 169]);

module.exports = {
  STOPWORDS,
  MALUT_REGIONS,
  STATISTICAL_TOPICS,
  SCORING_WEIGHTS,
  SYNONYM_CONFIG,
  IGNORED_SOURCE_IDS,
  getAllGeoAliases,
  isStatisticalTopic,
  getTopicAliases,
  detectGeoRegion,
};
