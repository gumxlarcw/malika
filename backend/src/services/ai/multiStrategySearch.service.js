/**
 * Multi-Strategy Search Service
 *
 * Implements the AI agent search pattern:
 *   parallel multi-strategy → merge → deduplicate → evaluate → retry if weak
 *
 * Instead of one query → one embedding → one pass, this service:
 * 1. Generates 2-3 query variants (original, geo-stripped, abbreviation-expanded)
 * 2. Runs searches in parallel
 * 3. Merges and deduplicates results (best score per document wins)
 * 4. Optionally self-checks retrieval quality via lightweight LLM
 * 5. If weak → retries with decomposed sub-queries
 *
 * @module multiStrategySearch.service
 * @created 2026-02-20
 */

'use strict';

const logger = require('../../utils/logger').child({ service: 'MultiStrategy' });
const { KNOWN_GEO_PHRASES, GEO_DETECT_REGEX } = require('../../utils/geoAnalysis');
const { BPS_ABBREVIATION_MAP, SHORT_WORD_WHITELIST } = require('../../shared/bpsAbbreviations');
const { chatCompletion } = require('./client/openaiClient');

// ── Configuration ─────────────────────────────────────────────────────────
const CONFIG = {
  // Enable/disable multi-strategy (can be toggled via env)
  ENABLED: process.env.MULTI_STRATEGY_SEARCH !== 'false', // Default ON
  
  // Self-check: only when top result similarity is below this threshold
  SELF_CHECK_THRESHOLD: 0.55,
  
  // Self-check LLM
  SELF_CHECK_MODEL: process.env.OPENAI_MODEL_CHAT || 'gpt-4.1',
  SELF_CHECK_TIMEOUT_MS: 10000,
  SELF_CHECK_MAX_TOKENS: 200,
  
  // Max retry attempts after self-check failure
  MAX_RETRIES: 1,
  
  // Minimum similarity for supplementary results to be included
  SUPPLEMENTARY_MIN_SIMILARITY: 0.35,
};

// ── Geo-stripping utility ─────────────────────────────────────────────────
// Remove geographic terms from query to focus on the topic
const GEO_STRIP_PATTERNS = [
  /\b(provinsi|kabupaten|kota|kab\.?|kec\.?)\s*/gi,
  /\b(maluku\s*utara|malut)\b/gi,
  /\b(di|daerah)\s+(maluku|utara|ternate|tidore|morotai|taliabu|sula|halmahera)\b/gi,
  GEO_DETECT_REGEX,
];

function stripGeoFromQuery(query) {
  let stripped = query;
  for (const pattern of GEO_STRIP_PATTERNS) {
    stripped = stripped.replace(pattern, ' ');
  }
  // Also strip known geo phrases
  for (const phrase of KNOWN_GEO_PHRASES) {
    if (phrase.length >= 4) {
      const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      stripped = stripped.replace(re, ' ');
    }
  }
  return stripped.replace(/\s+/g, ' ').trim();
}

// ── Abbreviation expansion ────────────────────────────────────────────────
// Expand short forms inline: "TK" → "TK taman kanak-kanak"
function expandAbbreviationsForSearch(query) {
  const words = query.toLowerCase().split(/\s+/);
  const additions = [];
  
  for (const word of words) {
    const expansion = BPS_ABBREVIATION_MAP[word];
    if (expansion) {
      additions.push(expansion.toLowerCase());
    }
  }
  
  if (additions.length === 0) return null;
  return (query + ' ' + additions.join(' ')).trim();
}

// ── Query variant generation ──────────────────────────────────────────────
/**
 * Generate 2-3 search query variants from the original query.
 * Each variant targets a different search signal:
 *   - Original: full semantic match
 *   - Geo-stripped: topic-focused (removes location noise)
 *   - Abbreviation-expanded: captures full-form matches
 *
 * @param {string} query
 * @returns {Array<{query: string, strategy: string, skipSynonyms: boolean}>}
 */
function generateQueryVariants(query) {
  const variants = [
    { query, strategy: 'original', skipSynonyms: false },
  ];
  
  // Variant 2: Geo-stripped — removes region names to focus on topic
  let geoStripped = stripGeoFromQuery(query);
  // Also strip trailing prepositions left over from geo removal ("di", "ke", "dari")
  geoStripped = geoStripped.replace(/\b(di|ke|dari)\s*$/i, '').trim();
  if (geoStripped && geoStripped.length >= 5 && geoStripped !== query.trim()) {
    variants.push({ 
      query: geoStripped, 
      strategy: 'geo-stripped', 
      skipSynonyms: true,  // Save LLM cost — rely on embedding similarity
    });
  }
  
  // Variant 3: Abbreviation-expanded — "TK" → "TK taman kanak-kanak"
  const expanded = expandAbbreviationsForSearch(query);
  if (expanded && expanded !== query) {
    variants.push({ 
      query: expanded, 
      strategy: 'abbrev-expanded', 
      skipSynonyms: true,  // Already expanded
    });
  }
  
  return variants;
}

// ── Query decomposition ───────────────────────────────────────────────────
/**
 * Rule-based decomposition for complex multi-aspect queries.
 * Splits into focused sub-queries that each target one aspect.
 *
 * Examples:
 *   "sumber air minum layak Maluku Utara 2024"
 *   → ["air minum layak 2024", "sumber air minum statistik kesejahteraan"]
 *
 *   "jumlah sekolah TK di Maluku Utara"
 *   → ["taman kanak-kanak sekolah", "pendidikan sekolah maluku utara"]
 *
 * @param {string} query
 * @returns {Array<string>}
 */
function decomposeQuery(query) {
  const q = query.toLowerCase().trim();
  const subQueries = [];
  
  // Extract year if present
  const yearMatch = q.match(/\b(20[12]\d)\b/);
  const year = yearMatch ? yearMatch[1] : '';
  
  // Strategy: create topic-focused and source-focused variants
  let geoStrippedDecomp = stripGeoFromQuery(q);
  // Strip trailing prepositions and year to avoid duplication
  geoStrippedDecomp = geoStrippedDecomp.replace(/\b(di|ke|dari)\s*$/i, '').trim();
  
  // Remove year from geoStripped to avoid duplication when appending
  const geoStrippedNoYear = year
    ? geoStrippedDecomp.replace(new RegExp(`\\b${year}\\b`, 'g'), '').replace(/\s+/g, ' ').trim()
    : geoStrippedDecomp;
  
  if (geoStrippedNoYear.length >= 5) {
    // Topic-focused: just the statistical topic + year
    subQueries.push((geoStrippedNoYear + (year ? ` ${year}` : '')).trim());
  }
  
  // Abbreviation-aware: expand abbreviations and search for the full form
  const words = q.split(/\s+/);
  for (const word of words) {
    const expansion = BPS_ABBREVIATION_MAP[word];
    if (expansion) {
      subQueries.push(`${expansion.toLowerCase()} ${year}`.trim());
    }
  }
  
  // Source-aware: try to find the source publication
  // Common patterns: if query mentions data topic, also search for the publication name
  const topicToSource = {
    'air minum': 'statistik kesejahteraan rakyat',
    'sanitasi': 'statistik kesejahteraan rakyat',
    'perumahan': 'statistik kesejahteraan rakyat',
    'kesehatan': 'statistik kesejahteraan rakyat',
    'sekolah': 'pendidikan dalam angka',
    'guru': 'pendidikan dalam angka',
    'murid': 'pendidikan dalam angka',
    'siswa': 'pendidikan dalam angka',
    'padi': 'pertanian dalam angka',
    'tanaman': 'pertanian dalam angka',
    'peternakan': 'pertanian dalam angka',
    'nelayan': 'perikanan dalam angka',
    'ikan': 'perikanan dalam angka',
    'hotel': 'pariwisata dalam angka',
    'wisatawan': 'pariwisata dalam angka',
    'restoran': 'maluku utara dalam angka',
    'rumah makan': 'maluku utara dalam angka',
    'industri': 'maluku utara dalam angka',
  };
  
  for (const [keyword, source] of Object.entries(topicToSource)) {
    if (q.includes(keyword)) {
      subQueries.push(`${source} ${year}`.trim());
      break; // Only one source variant
    }
  }
  
  // Deduplicate
  const unique = [...new Set(subQueries.filter(sq => sq.length >= 5 && sq !== q))];
  return unique.slice(0, 3);
}

// ── Result merging ───────────────────────────────────────────────────────
/**
 * Merge results from multiple search variants.
 * For duplicates (same doc ID), keep the highest score.
 * Preserves metadata from the best-scoring version.
 *
 * @param {Array<Array>} resultSets - Array of result arrays
 * @param {number} minSimilarity - Minimum similarity threshold
 * @returns {Array} - Merged, deduplicated, sorted results
 */
function mergeResults(resultSets, minSimilarity = 0.35) {
  const bestByDoc = new Map();
  
  for (const results of resultSets) {
    if (!Array.isArray(results)) continue;
    
    for (const result of results) {
      if (!result || (result.similarity || 0) < minSimilarity) continue;
      
      const docId = result.parentId || result.id;
      const existing = bestByDoc.get(docId);
      
      if (!existing || (result.similarity || 0) > (existing.similarity || 0)) {
        bestByDoc.set(docId, { ...result, mergedFrom: result.strategy || 'primary' });
      }
    }
  }
  
  return Array.from(bestByDoc.values())
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
}

// ── Self-check ────────────────────────────────────────────────────────────
/**
 * Lightweight LLM check: "Does the retrieved context contain relevant data?"
 * Only called when top result similarity is borderline (< SELF_CHECK_THRESHOLD).
 *
 * @param {string} query - Original user query
 * @param {Array} results - Retrieved documents (top N)
 * @returns {Promise<{confident: boolean, reason: string}>}
 */
async function selfCheckRetrieval(query, results) {
  if (!results || results.length === 0) {
    return { confident: false, reason: 'No results' };
  }
  
  const topResult = results[0];
  const topSim = topResult.similarity || 0;
  
  // Skip self-check if top result is confident enough
  if (topSim >= CONFIG.SELF_CHECK_THRESHOLD) {
    return { confident: true, reason: `Top similarity ${topSim.toFixed(3)} >= threshold` };
  }
  
  // Build compact context for checking (first 2000 chars of top 3 results)
  const contextSnippets = results.slice(0, 3).map((r, i) => {
    const title = r.title || r.name || `Doc ${i + 1}`;
    const content = (r.matchedChunkText || r.content || '').slice(0, 1500);
    return `[${i + 1}] ${title}\n${content}`;
  }).join('\n\n');
  
  try {
    const response = await chatCompletion({
      apiKeyEnv: 'OPENAI_API_KEY_CHAT',
      payload: {
        model: CONFIG.SELF_CHECK_MODEL,
        temperature: 0.1,
        max_tokens: CONFIG.SELF_CHECK_MAX_TOKENS,
        messages: [
          {
            role: 'system',
            content: `Kamu adalah validator retrieval. Periksa apakah konteks yang diberikan berisi data yang relevan untuk menjawab pertanyaan pengguna. Jawab dalam format JSON: {"relevant": true/false, "reason": "alasan singkat"}`,
          },
          {
            role: 'user',
            content: `Pertanyaan: ${query}\n\nKonteks yang ditemukan:\n${contextSnippets.slice(0, 4000)}\n\nApakah konteks di atas berisi data/informasi yang relevan untuk menjawab pertanyaan?`,
          },
        ],
      },
      timeoutMs: CONFIG.SELF_CHECK_TIMEOUT_MS,
      retries: 0,
    });
    
    const text = response?.choices?.[0]?.message?.content || '';
    
    // Parse JSON response
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        const confident = parsed.relevant === true;
        logger.info({
          query: query.slice(0, 50),
          confident,
          reason: parsed.reason,
          topSim: topSim.toFixed(3),
        }, 'Self-check retrieval result');
        return { confident, reason: parsed.reason || '' };
      } catch {
        // JSON parse failed — assume confident if top sim is reasonable
        return { confident: topSim >= 0.45, reason: 'Self-check parse failed' };
      }
    }
    
    // No JSON in response — check text for affirmative/negative
    const isYes = /relevan|iya|ya|berisi|tersedia|terdapat|sesuai/i.test(text);
    return { confident: isYes, reason: text.slice(0, 100) };
  } catch (err) {
    logger.warn({ error: err.message }, 'Self-check LLM failed, assuming confident');
    return { confident: true, reason: 'Self-check error: ' + err.message };
  }
}

// ── Main entry point ──────────────────────────────────────────────────────
/**
 * Enhanced knowledge search using multi-strategy pattern.
 *
 * Flow:
 * 1. Generate query variants (original, geo-stripped, abbreviation-expanded)
 * 2. Run PRIMARY search (full pipeline: synonyms + reranking)
 * 3. Run SUPPLEMENTARY searches in parallel (cheaper: skip synonyms)
 * 4. Merge all results (best score per doc wins)
 * 5. Self-check top results if borderline confidence
 * 6. If weak → retry with decomposed sub-queries
 *
 * @param {string} query - User query
 * @param {number} topN - Number of results to return
 * @param {object} options
 * @param {boolean} options.skipLLMSynonyms - Skip LLM synonym expansion
 * @param {boolean} options.skipSelfCheck - Skip retrieval self-check
 * @param {boolean} options.skipMultiStrategy - Use single strategy (fallback)
 * @returns {Promise<{results: Array, reranked: boolean, duration_ms: number, strategies: string[]}>}
 */
async function enhancedSearchKnowledge(query, topN = 5, options = {}) {
  const startTime = Date.now();
  const { skipLLMSynonyms = false, skipSelfCheck = false, skipMultiStrategy = false } = options;
  
  // Lazy-load vectorSearch to avoid circular dependency
  const vectorSearch = require('./vectorSearch.service');
  
  // If disabled or explicitly skipped, fall back to single strategy
  if (!CONFIG.ENABLED || skipMultiStrategy) {
    const result = await vectorSearch.searchKnowledge(query, topN, { skipLLMSynonyms });
    return {
      ...result,
      strategies: ['single'],
      duration_ms: Date.now() - startTime,
    };
  }
  
  // Step 1: Generate query variants
  const variants = generateQueryVariants(query);
  const strategies = variants.map(v => v.strategy);
  
  logger.info({
    query: query.slice(0, 80),
    variants: variants.map(v => ({ strategy: v.strategy, query: v.query.slice(0, 60) })),
  }, 'Multi-strategy search: generated variants');
  
  // Step 2: Run PRIMARY search (full pipeline)
  // Step 3: Run SUPPLEMENTARY searches in parallel
  const searchPromises = variants.map((variant, idx) => {
    const isFirst = idx === 0;
    return vectorSearch.searchKnowledge(variant.query, topN, {
      skipLLMSynonyms: isFirst ? skipLLMSynonyms : variant.skipSynonyms,
      skipRerank: !isFirst, // Only rerank the primary search
    }).then(result => ({
      strategy: variant.strategy,
      results: result?.results || [],
      reranked: result?.reranked || false,
    })).catch(err => {
      logger.warn({ strategy: variant.strategy, error: err.message }, 'Variant search failed');
      return { strategy: variant.strategy, results: [], reranked: false };
    });
  });
  
  const searchResults = await Promise.all(searchPromises);
  
  // Step 4: Merge results
  const primaryResults = searchResults[0]?.results || [];
  const supplementaryResults = searchResults.slice(1).flatMap(r => r.results || []);
  
  // Start with primary results, then merge in supplementary docs not already present
  const primaryIds = new Set(primaryResults.map(r => r.parentId || r.id));
  const newFromSupplementary = supplementaryResults.filter(r => {
    const docId = r.parentId || r.id;
    return !primaryIds.has(docId) && (r.similarity || 0) >= CONFIG.SUPPLEMENTARY_MIN_SIMILARITY;
  });
  
  // Deduplicate supplementary by doc ID (keep best score)
  const suppByDoc = new Map();
  for (const r of newFromSupplementary) {
    const docId = r.parentId || r.id;
    const existing = suppByDoc.get(docId);
    if (!existing || (r.similarity || 0) > (existing.similarity || 0)) {
      suppByDoc.set(docId, r);
    }
  }
  const uniqueSupplementary = Array.from(suppByDoc.values());
  
  // Combine: primary first, then supplementary (sorted by similarity)
  let combined = [...primaryResults, ...uniqueSupplementary]
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, topN);
  
  const newDocsFound = uniqueSupplementary.length;
  if (newDocsFound > 0) {
    logger.info({
      primary: primaryResults.length,
      supplementaryNew: newDocsFound,
      combined: combined.length,
      strategies,
    }, 'Multi-strategy merge: found additional documents');
  }
  
  // Step 5: Self-check if borderline confidence
  let selfChecked = false;
  let selfCheckResult = null;
  
  if (!skipSelfCheck && combined.length > 0) {
    const topSim = combined[0]?.similarity || 0;
    
    if (topSim < CONFIG.SELF_CHECK_THRESHOLD) {
      selfCheckResult = await selfCheckRetrieval(query, combined);
      selfChecked = true;
      
      // Step 6: If not confident, retry with decomposed queries
      if (!selfCheckResult.confident) {
        logger.info({
          query: query.slice(0, 50),
          topSim: topSim.toFixed(3),
          reason: selfCheckResult.reason,
        }, 'Self-check: low confidence, retrying with decomposed queries');
        
        const subQueries = decomposeQuery(query);
        if (subQueries.length > 0) {
          strategies.push(...subQueries.map((_, i) => `decomposed-${i}`));
          
          const retryPromises = subQueries.map(sq =>
            vectorSearch.searchKnowledge(sq, topN, {
              skipLLMSynonyms: true, // Speed over quality for retry
              skipRerank: true,
            }).then(r => r?.results || [])
              .catch(() => [])
          );
          
          const retryResults = await Promise.all(retryPromises);
          const existingIds = new Set(combined.map(r => r.parentId || r.id));
          
          for (const results of retryResults) {
            for (const r of results) {
              const docId = r.parentId || r.id;
              if (!existingIds.has(docId) && (r.similarity || 0) >= CONFIG.SUPPLEMENTARY_MIN_SIMILARITY) {
                combined.push(r);
                existingIds.add(docId);
              }
            }
          }
          
          // Re-sort
          combined.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
          combined = combined.slice(0, topN);
          
          logger.info({
            subQueries,
            totalAfterRetry: combined.length,
          }, 'Decomposition retry complete');
        }
      }
    }
  }
  
  const duration = Date.now() - startTime;
  
  logger.info({
    query: query.slice(0, 50),
    strategies,
    resultCount: combined.length,
    topSim: combined[0]?.similarity?.toFixed(3) || '0',
    selfChecked,
    selfCheckConfident: selfCheckResult?.confident,
    duration_ms: duration,
  }, 'Multi-strategy search complete');
  
  return {
    results: combined,
    reranked: searchResults[0]?.reranked || false,
    strategies,
    selfChecked,
    selfCheckConfident: selfCheckResult?.confident,
    duration_ms: duration,
    totalKnowledge: combined.length,
  };
}

module.exports = {
  enhancedSearchKnowledge,
  generateQueryVariants,
  decomposeQuery,
  mergeResults,
  selfCheckRetrieval,
  stripGeoFromQuery,
  CONFIG,
};
