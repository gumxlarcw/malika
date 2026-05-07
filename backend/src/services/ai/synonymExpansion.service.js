/**
 * Synonym Expansion Service
 * 
 * Uses LLM to expand search terms with synonyms for better document matching.
 * ALWAYS called before vector search to maximize semantic coverage.
 * 
 * Design Goals:
 * 1. SCALABLE - No hard-coded synonyms, LLM generates on-demand
 * 2. CACHED - Results cached (1 hour TTL) to minimize API costs
 * 3. ALWAYS ON - Called for every query, caching makes it cost-efficient
 * 4. CONTEXTUAL - Aware of BPS statistical terminology
 * 
 * @module synonymExpansion.service
 * @created 2026-01-25
 * @updated 2026-01-25 - Changed from fallback to always-on
 */

'use strict';

const logger = require('../../utils/logger').child({ service: 'SynonymExpansion' });
const { BPS_ABBREVIATION_MAP } = require('../../shared/bpsAbbreviations');
const requestContext = require('../chat/streaming/requestContext');
const { chatCompletion } = require('./client/openaiClient');

// In-memory cache for synonym expansions (TTL: 1 hour)
const synonymCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// In-flight dedup: prevents duplicate LLM calls when parallel callers request the same query
// Maps cacheKey → Promise so concurrent requests share a single LLM call
const inflightRequests = new Map();

// Timeout for LLM synonym expansion (background fire-and-forget, so shorter is fine)
const SYNONYM_TIMEOUT_MS = parseInt(process.env.SYNONYM_TIMEOUT_MS, 10) || 4000; // 4s default (reduced from 8s — best-effort, fail fast)

// Stale-while-revalidate: serve expired cache immediately, refresh in background
// This means worst case we return synonyms that are 1-2 hours stale (minimal impact)
const STALE_SERVE_WINDOW_MS = CACHE_TTL_MS; // Serve stale entries for up to 1 extra TTL window

// Stopwords to filter from query before expansion
const STOPWORDS = new Set([
  'yang', 'dan', 'atau', 'untuk', 'dari', 'di', 'ke', 'pada', 'adalah', 'ini', 'itu',
  'dengan', 'dalam', 'sebagai', 'oleh', 'karena', 'jika', 'maka', 'serta', 'juga',
  'berapa', 'apa', 'siapa', 'dimana', 'kapan', 'bagaimana', 'mengapa',
  'data', 'tahun', 'bulan', 'angka', 'jumlah', 'statistik', 'bps',
]);

// ── Static BPS abbreviation expansions ──────────────────────────────────────
// Pre-expand BEFORE any LLM call to prevent hallucinated abbreviation meanings.
// Uses shared module as single source of truth.
const BPS_ABBREVIATIONS = new Map(
  Object.entries(BPS_ABBREVIATION_MAP).map(([k, v]) => [k, v.toLowerCase()])
);

/**
 * Pre-expand known BPS abbreviations in a list of words.
 * Returns { expandedWords, expansionsApplied }
 */
function preExpandAbbreviations(words) {
  const expandedWords = [];
  const expansionsApplied = [];
  for (const w of words) {
    expandedWords.push(w);
    const full = BPS_ABBREVIATIONS.get(w.toLowerCase());
    if (full) {
      // Add the full expansion as additional words
      const fullWords = full.split(/\s+/);
      expandedWords.push(...fullWords);
      expansionsApplied.push(`${w}=${full}`);
    }
  }
  return { expandedWords: [...new Set(expandedWords)], expansionsApplied };
}

/**
 * Clean expired cache entries
 */
function cleanExpiredCache() {
  const now = Date.now();
  for (const [key, entry] of synonymCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      synonymCache.delete(key);
    }
  }
}

// Clean cache every 10 minutes
setInterval(cleanExpiredCache, 10 * 60 * 1000);

/**
 * Expand search terms with synonyms using LLM
 * 
 * @param {string[]} terms - Original search terms
 * @param {string} context - Optional context (e.g., 'statistik', 'BPS')
 * @returns {Promise<{original: string[], expanded: string[], allTerms: string[]}>}
 */
async function expandWithSynonyms(terms, context = 'statistik BPS Indonesia') {
  if (!terms || terms.length === 0) {
    return { original: [], expanded: [], allTerms: [] };
  }

  // Normalize and dedupe
  const normalizedTerms = [...new Set(terms.map(t => t.toLowerCase().trim()).filter(t => t.length >= 2))];
  
  if (normalizedTerms.length === 0) {
    return { original: [], expanded: [], allTerms: [] };
  }

  // Check cache (with stale-while-revalidate)
  const cacheKey = normalizedTerms.sort().join('|');
  const cached = synonymCache.get(cacheKey);
  const now = Date.now();
  if (cached) {
    const age = now - cached.timestamp;
    if (age < CACHE_TTL_MS) {
      // Fresh cache — return immediately
      logger.debug({ terms: normalizedTerms, cached: true }, 'Returning cached synonyms');
      return cached.result;
    }
    if (age < CACHE_TTL_MS + STALE_SERVE_WINDOW_MS) {
      // Stale but within revalidate window — return stale, refresh in background
      logger.info({ terms: normalizedTerms, staleMs: age - CACHE_TTL_MS }, 'Returning stale synonyms, refreshing in background');
      // Fire background refresh (don't await)
      if (!inflightRequests.has(cacheKey)) {
        const refreshPromise = expandWithSynonyms(normalizedTerms, context)
          .catch(err => logger.debug({ err: err?.message }, 'Background synonym refresh failed'))
          .finally(() => inflightRequests.delete(cacheKey));
        inflightRequests.set(cacheKey, refreshPromise);
      }
      return cached.result;
    }
  }

  try {
    logger.info({ terms: normalizedTerms }, 'Expanding terms with LLM synonyms');

    const synonymModel = requestContext.getModelOverride() || process.env.OPENAI_MODEL_SYNONYM || 'gemini-3-flash-preview';
    const startMs = Date.now();
    const response = await chatCompletion({
      apiKeyEnv: 'OPENAI_API_KEY_QUERY_BUILDER',
      payload: {
        model: synonymModel,
        messages: [
          {
            role: 'system',
            content: `Kamu adalah asisten pencarian statistik BPS (Badan Pusat Statistik) Indonesia.
Tugas: Berikan sinonim/variasi kata untuk membantu pencarian dokumen.

ATURAN:
1. Berikan 2-4 sinonim/variasi untuk setiap kata
2. Fokus pada terminologi statistik BPS
3. Sertakan singkatan umum (TPT, PDRB, IHK, dll)
4. Sertakan variasi ejaan (misal: "ekonomi" → "perekonomian")
5. Sertakan istilah formal dan informal
6. Format output: JSON object with "synonyms" array containing objects with "word" and "variants" fields

⛔ SINGKATAN RESMI BPS (JANGAN ubah/karang kepanjangan!):
- PMTB = Pembentukan Modal Tetap Bruto (BUKAN "Pembangunan Manusia", BUKAN "Program Makanan")
- PDRB = Produk Domestik Regional Bruto
- IPM = Indeks Pembangunan Manusia
- TPT = Tingkat Pengangguran Terbuka
- IHK = Indeks Harga Konsumen
- NTP = Nilai Tukar Petani
- TPAK = Tingkat Partisipasi Angkatan Kerja
- TPK = Tingkat Penghunian Kamar
Jika menemui singkatan di atas, gunakan HANYA kepanjangan resmi sebagai sinonim.`,
          },
          {
            role: 'user',
            content: `Berikan sinonim untuk kata-kata berikut dalam konteks ${context}:\n\n${JSON.stringify(normalizedTerms)}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 500,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'synonym_expansion',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                synonyms: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      word: { type: 'string', description: 'Original word' },
                      variants: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Synonym/variant list for this word',
                      },
                    },
                    required: ['word', 'variants'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['synonyms'],
              additionalProperties: false,
            },
          },
        },
      },
      timeoutMs: SYNONYM_TIMEOUT_MS,
      retries: 0,            // No retry — non-critical call, avoid wasting proxy bandwidth
      skipCircuitBreaker: true, // Don't let synonym timeouts trip the circuit breaker
    });

    // Track cost
    try {
      const { costTracker } = require('../../utils/costTracker');
      if (response.usage) {
        costTracker.record({
          model: synonymModel,
          usage: response.usage,
          purpose: 'synonym_expansion',
          latencyMs: Date.now() - startMs,
        });
      }
    } catch { /* non-critical */ }

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from LLM');
    }

    const parsed = JSON.parse(content);
    
    // Handle structured output format: { synonyms: [{ word, variants }] }
    const expanded = [];
    if (parsed.synonyms && Array.isArray(parsed.synonyms)) {
      for (const entry of parsed.synonyms) {
        if (Array.isArray(entry.variants)) {
          expanded.push(...entry.variants.map(s => s.toLowerCase().trim()));
        }
      }
    } else {
      // Fallback: legacy format { word: [synonyms] }
      for (const [, synonyms] of Object.entries(parsed)) {
        if (Array.isArray(synonyms)) {
          expanded.push(...synonyms.map(s => s.toLowerCase().trim()));
        }
      }
    }

    // Build synonym map: original word → variants
    const synonymMap = {};
    if (parsed.synonyms && Array.isArray(parsed.synonyms)) {
      for (const entry of parsed.synonyms) {
        if (entry.word && Array.isArray(entry.variants)) {
          synonymMap[entry.word.toLowerCase().trim()] = entry.variants.map(s => s.toLowerCase().trim());
        }
      }
    }

    // Combine original + expanded, dedupe
    const allTerms = [...new Set([...normalizedTerms, ...expanded])];

    const result = {
      original: normalizedTerms,
      expanded: expanded,
      allTerms: allTerms,
      synonymMap,
    };

    // Cache the result
    synonymCache.set(cacheKey, {
      result,
      timestamp: Date.now(),
    });

    logger.info({
      original: normalizedTerms.length,
      expanded: expanded.length,
      total: allTerms.length,
    }, 'Synonym expansion complete');

    return result;

  } catch (err) {
    logger.error({ err: err?.message || err, stack: err?.stack?.split('\n').slice(0, 3).join(' | '), terms: normalizedTerms }, 'Synonym expansion failed, returning original terms');
    
    // Return original terms on error
    return {
      original: normalizedTerms,
      expanded: [],
      allTerms: normalizedTerms,
      error: err.message,
    };
  }
}

/**
 * Check if we should trigger synonym expansion
 * 
 * @param {number} resultCount - Number of results from initial search
 * @param {number} threshold - Minimum acceptable results (default: 2)
 * @returns {boolean}
 * @deprecated Now using always-on expansion, this function is kept for backward compatibility
 */
function shouldExpandSynonyms(resultCount, threshold = 2) {
  return resultCount < threshold;
}

/**
 * Expand a full query string with LLM-generated synonyms.
 * 
 * FIRE-AND-FORGET pattern:
 * - Cache HIT → return cached synonyms immediately (0ms)
 * - Cache MISS → fire background LLM call for cache warm-up, return original query
 * - The background result gets cached for subsequent queries
 * 
 * This eliminates the 12s timeout delay that was blocking every search.
 * Static dictionary (94 entries) provides comprehensive coverage on first query;
 * LLM adds creative/novel synonyms from the second query onwards (via cache).
 * 
 * @param {string} query - Original search query
 * @returns {Promise<string>} - Query with cached synonyms (if available) or original
 * 
 * @example
 * // First call (no cache): returns "data kemiskinan" immediately, warms cache
 * // Second call (cached): returns "data kemiskinan miskin poverty garis kemiskinan ..."
 */
async function expandQueryWithLLM(query) {
  if (!query || typeof query !== 'string') {
    return query || '';
  }

  // Extract meaningful terms (filter stopwords)
  const words = query.toLowerCase().split(/\s+/).filter(w => 
    w.length >= 2 && !STOPWORDS.has(w)
  );

  if (words.length === 0) {
    return query;
  }

  // Pre-expand known BPS abbreviations
  const { expandedWords: preExpanded, expansionsApplied } = preExpandAbbreviations(words);
  if (expansionsApplied.length > 0) {
    logger.debug({ expansionsApplied }, 'Pre-expanded BPS abbreviations for synonym cache key');
  }

  // LIMIT terms: max 12 unique terms
  const expandedWords = [...new Set(preExpanded)].slice(0, 12);
  const cacheKey = expandedWords.sort().join('|');

  // ── FAST PATH: Cache hit → return immediately (with stale-while-revalidate) ──
  const cached = synonymCache.get(cacheKey);
  if (cached) {
    const age = Date.now() - cached.timestamp;
    if (age < CACHE_TTL_MS) {
      // Fresh cache
      logger.debug({ query, cached: true, expandedTerms: cached.result.expanded.length }, 
        'Returning cached LLM synonyms (instant)');
      return query + ' ' + cached.result.expanded.join(' ');
    }
    if (age < CACHE_TTL_MS + STALE_SERVE_WINDOW_MS) {
      // Stale but usable — return stale, fire background refresh
      logger.debug({ query, stale: true }, 'Returning stale LLM synonyms, refreshing bg');
      if (!inflightRequests.has(cacheKey)) {
        const refreshPromise = expandWithSynonyms(expandedWords, 'statistik BPS Maluku Utara')
          .catch(() => null)
          .finally(() => inflightRequests.delete(cacheKey));
        inflightRequests.set(cacheKey, refreshPromise);
      }
      return query + ' ' + cached.result.expanded.join(' ');
    }
  }

  // ── WARM-UP PATH: Fire background LLM call, return original immediately ──
  // Don't await — the result will be cached for subsequent queries.
  // This eliminates the 12s timeout delay that was blocking search.
  if (!inflightRequests.has(cacheKey)) {
    const bgPromise = expandWithSynonyms(expandedWords, 'statistik BPS Maluku Utara')
      .then(expansion => {
        if (expansion?.expanded?.length > 0) {
          logger.info({
            query,
            synonyms: expansion.expanded.length,
            sample: expansion.expanded.slice(0, 5).join(', '),
          }, 'Background synonym expansion cached for future queries');
        }
        return expansion;
      })
      .catch(err => {
        logger.debug({ err: err?.message, query }, 'Background synonym expansion failed (non-blocking)');
        return null;
      })
      .finally(() => inflightRequests.delete(cacheKey));

    inflightRequests.set(cacheKey, bgPromise);
    logger.debug({ query, terms: expandedWords.length }, 
      'Synonym LLM call fired in background (cache warm-up)');
  } else {
    logger.debug({ query }, 'Synonym background call already in-flight (dedup)');
  }

  // Return original query immediately — no delay
  return query;
}

const { getMalutRegionSynonyms } = require('../../utils/geoAnalysis');

/**
 * Expand geo terms with local synonyms (no LLM needed)
 * 
 * @param {string[]} terms - Original terms
 * @returns {string[]} - Expanded with geo synonyms
 */
function expandGeoTerms(terms) {
  const regionSynonyms = getMalutRegionSynonyms();
  const expanded = [...terms];

  for (const term of terms) {
    const termLower = term.toLowerCase();
    
    // Check if term matches any region
    for (const [region, synonyms] of regionSynonyms.entries()) {
      if (termLower.includes(region) || synonyms.some(s => termLower.includes(s))) {
        // Add all synonyms for this region
        expanded.push(region, ...synonyms);
      }
    }
  }

  return [...new Set(expanded)];
}

/**
 * Clear synonym cache (for testing/admin)
 */
function clearCache() {
  synonymCache.clear();
  logger.info('Synonym cache cleared');
}

/**
 * Get cache stats
 * @returns {{size: number, entries: string[]}}
 */
function getCacheStats() {
  return {
    size: synonymCache.size,
    entries: Array.from(synonymCache.keys()),
  };
}

module.exports = {
  expandWithSynonyms,
  expandQueryWithLLM,  // Primary function - call before vector search
  shouldExpandSynonyms,
  expandGeoTerms,
  getMalutRegionSynonyms,
  clearCache,
  getCacheStats,
};
