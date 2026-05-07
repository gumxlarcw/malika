/**
 * Query Fast-Path Service
 * 
 * Provides cached intent mappings for high-frequency queries.
 * Skips full RAG/vector search for known common patterns.
 * 
 * Benefits:
 * - Faster response time for common queries
 * - Reduced API calls to OpenAI
 * - Consistent results for frequent questions
 */

// ============================================================================
// FAST-PATH INTENT MAPPINGS
// ============================================================================

/**
 * Pre-defined intent mappings for high-frequency queries
 * Based on analysis of 863 chat messages
 * 
 * Structure:
 * - pattern: regex or exact match
 * - intent: resolved intent object
 * - datasources: array of source_ids to search
 * - skipRag: whether to skip RAG entirely
 */
const FAST_PATH_MAPPINGS = [
  // === EKONOMI / PDRB ===
  {
    id: 'pertumbuhan_ekonomi',
    patterns: [
      /^pertumbuhan\s+ekonomi$/i,
      /^data\s+pertumbuhan\s+ekonomi$/i,
      /^pdrb$/i,
      /^data\s+pdrb$/i,
    ],
    intent: {
      topic: 'ekonomi',
      indicator: 'pdrb',
      type: 'dynamic',
    },
    datasourceIds: [203, 288, 282], // PDRB, Laju Pertumbuhan PDRB
    skipRag: false, // Still use RAG for best matching
    priority: 1,
  },
  {
    id: 'pertumbuhan_ekonomi_spesifik',
    patterns: [
      /^pertumbuhan\s+ekonomi\s+triwulan\s+(\d+)\s+tahun\s+(\d{4})$/i,
      /^pdrb\s+triwulan\s+(\d+)\s+(\d{4})$/i,
    ],
    intent: {
      topic: 'ekonomi',
      indicator: 'pdrb',
      type: 'dynamic',
    },
    datasourceIds: [203],
    extractParams: (match) => ({
      quarter: match[1],
      year: match[2],
    }),
    skipRag: true,
    priority: 1,
  },

  // === KEMISKINAN ===
  {
    id: 'kemiskinan_umum',
    patterns: [
      /^data\s+kemiskinan$/i,
      /^kemiskinan$/i,
      /^apakah\s+ada\s+data\s+kemiskinan\??$/i,
      /^penduduk\s+miskin$/i,
    ],
    intent: {
      topic: 'kemiskinan',
      indicator: 'penduduk_miskin',
      type: 'dynamic',
    },
    datasourceIds: [12, 425, 450, 452, 456], // Persentase/Jumlah Penduduk Miskin
    skipRag: false,
    priority: 1,
  },
  {
    id: 'kemiskinan_range',
    patterns: [
      /^kemiskinan\s+(\d{4})\s*[-–]\s*(\d{4})$/i,
      /^data\s+kemiskinan\s+(\d{4})\s*[-–]\s*(\d{4})$/i,
    ],
    intent: {
      topic: 'kemiskinan',
      indicator: 'penduduk_miskin',
      type: 'dynamic',
    },
    datasourceIds: [12, 425, 456],
    extractParams: (match) => ({
      yearStart: match[1],
      yearEnd: match[2],
    }),
    skipRag: true,
    priority: 1,
  },
  {
    id: 'kemiskinan_kabkota',
    patterns: [
      /jumlah\s+dan\s+persentase\s+penduduk\s+miskin\s+per\s+kabupaten/i,
      /kemiskinan\s+(menurut\s+)?kabupaten/i,
      /kemiskinan\s+per\s+kab/i,
    ],
    intent: {
      topic: 'kemiskinan',
      indicator: 'penduduk_miskin',
      geo_level: 'kabkota',
      type: 'dynamic',
    },
    datasourceIds: [425, 450, 452], // Kemiskinan Menurut Kabupaten/Kota
    skipRag: true,
    priority: 2,
  },

  // === PENGANGGURAN ===
  {
    id: 'pengangguran_umum',
    patterns: [
      /^pengangguran$/i,
      /^data\s+pengangguran$/i,
      /^tpt$/i,
      /^tingkat\s+pengangguran$/i,
    ],
    intent: {
      topic: 'ketenagakerjaan',
      indicator: 'tpt',
      type: 'dynamic',
    },
    datasourceIds: [6, 7, 430], // TPT, Pengangguran
    skipRag: false,
    priority: 1,
  },

  // === INFLASI ===
  {
    id: 'inflasi_umum',
    patterns: [
      /^inflasi$/i,
      /^data\s+inflasi$/i,
      /^ihk$/i,
    ],
    intent: {
      topic: 'inflasi',
      indicator: 'inflasi',
      type: 'dynamic',
    },
    datasourceIds: [1, 2, 3], // Inflasi, IHK
    skipRag: false,
    priority: 1,
  },
  {
    id: 'inflasi_range',
    patterns: [
      /^inflasi\s+(\d{4})\s*[-–]\s*(\d{4})$/i,
    ],
    intent: {
      topic: 'inflasi',
      indicator: 'inflasi',
      type: 'dynamic',
    },
    datasourceIds: [1, 2],
    extractParams: (match) => ({
      yearStart: match[1],
      yearEnd: match[2],
    }),
    skipRag: true,
    priority: 1,
  },

  // === PENDUDUK ===
  {
    id: 'penduduk_umum',
    patterns: [
      /^data\s+penduduk$/i,
      /^jumlah\s+penduduk$/i,
      /^penduduk$/i,
    ],
    intent: {
      topic: 'demografi',
      indicator: 'penduduk',
      type: 'dynamic',
    },
    datasourceIds: [18, 19, 20], // Jumlah Penduduk
    skipRag: false,
    priority: 1,
  },

  // === FOLLOW-UP KABKOTA ===
  {
    id: 'followup_kabkota',
    patterns: [
      /^kalau\s+data\s+kabupaten\s+(atau|dan)\s+kota\s+ada\s*\??$/i,
      /^ada\s+data\s+per\s+kabupaten\s*\??$/i,
      /^data\s+kabupaten\s*\??$/i,
    ],
    intent: {
      geo_level: 'kabkota',
      followup: true,
    },
    datasourceIds: [], // Will use previous context
    skipRag: false,
    priority: 3, // Lower priority - context-dependent
    requiresPreviousContext: true,
  },
];

// ============================================================================
// FAST-PATH MATCHING
// ============================================================================

/**
 * Check if query matches any fast-path pattern
 * @param {string} query - User query
 * @returns {object|null} - Matched mapping or null
 */
function matchFastPath(query) {
  if (!query) return null;
  
  const q = String(query).trim().toLowerCase();
  
  // Sort by priority (lower = higher priority)
  const sortedMappings = [...FAST_PATH_MAPPINGS].sort((a, b) => 
    (a.priority || 99) - (b.priority || 99)
  );
  
  for (const mapping of sortedMappings) {
    for (const pattern of mapping.patterns) {
      const match = q.match(pattern);
      if (match) {
        const result = {
          id: mapping.id,
          intent: { ...mapping.intent },
          datasourceIds: mapping.datasourceIds,
          skipRag: mapping.skipRag,
          requiresPreviousContext: mapping.requiresPreviousContext || false,
        };
        
        // Extract parameters if function provided
        if (mapping.extractParams && match.length > 1) {
          result.params = mapping.extractParams(match);
        }
        
        console.log(`[FastPath] Query matched: ${mapping.id}`);
        return result;
      }
    }
  }
  
  return null;
}

/**
 * Get datasource IDs for fast-path query
 * @param {string} query - User query
 * @returns {number[]|null} - Array of datasource IDs or null if no match
 */
function getFastPathDatasources(query) {
  const match = matchFastPath(query);
  if (match && match.datasourceIds.length > 0) {
    return match.datasourceIds;
  }
  return null;
}

/**
 * Check if query should skip RAG
 * @param {string} query - User query
 * @returns {boolean}
 */
function shouldSkipRag(query) {
  const match = matchFastPath(query);
  return match?.skipRag === true;
}

/**
 * Get fast-path intent if available
 * @param {string} query - User query
 * @returns {object|null} - Intent object or null
 */
function getFastPathIntent(query) {
  const match = matchFastPath(query);
  if (match) {
    return {
      ...match.intent,
      params: match.params || {},
      fastPath: true,
      fastPathId: match.id,
    };
  }
  return null;
}

// ============================================================================
// CACHE FOR RUNTIME PATTERNS
// ============================================================================

// In-memory cache for frequently used queries (LRU-like)
const queryCache = new Map();
const CACHE_MAX_SIZE = 100;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached intent for query
 * @param {string} query - User query
 * @returns {object|null}
 */
function getCachedIntent(query) {
  const key = String(query).trim().toLowerCase();
  const cached = queryCache.get(key);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log(`[FastPath] Cache hit for: ${key.slice(0, 30)}...`);
    return cached.intent;
  }
  
  // Remove expired entry
  if (cached) {
    queryCache.delete(key);
  }
  
  return null;
}

/**
 * Cache intent for query
 * @param {string} query - User query
 * @param {object} intent - Resolved intent
 */
function cacheIntent(query, intent) {
  const key = String(query).trim().toLowerCase();
  
  // Simple LRU: remove oldest if at capacity
  if (queryCache.size >= CACHE_MAX_SIZE) {
    const oldestKey = queryCache.keys().next().value;
    queryCache.delete(oldestKey);
  }
  
  queryCache.set(key, {
    intent,
    timestamp: Date.now(),
  });
}

/**
 * Clear all cached intents
 */
function clearCache() {
  queryCache.clear();
  console.log('[FastPath] Cache cleared');
}

module.exports = {
  // Main functions
  matchFastPath,
  getFastPathDatasources,
  getFastPathIntent,
  shouldSkipRag,
  
  // Cache functions
  getCachedIntent,
  cacheIntent,
  clearCache,
  
  // Export mappings for testing
  FAST_PATH_MAPPINGS,
};
