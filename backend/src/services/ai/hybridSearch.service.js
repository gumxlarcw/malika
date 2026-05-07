/**
 * Hybrid Search Service (BM25 + Vector)
 * 
 * Implements Reciprocal Rank Fusion (RRF) to combine BM25 keyword search
 * with existing vector (cosine similarity) search for knowledge documents.
 * 
 * This is modeled after OpenClaw's hybrid search approach:
 * - BM25 handles exact keyword matches (e.g., "PDRB", "inflasi")
 * - Vector handles semantic similarity (e.g., "pertumbuhan ekonomi" ≈ "PDRB")
 * - RRF combines both rankings for better recall and precision
 * 
 * Uses MySQL FULLTEXT index on knowledge_base(title, content) for BM25.
 */

'use strict';

const sequelize = require('../../config/db');
const { LRUCache } = require('lru-cache');
const logger = require('../../utils/logger').child({ service: 'HybridSearch' });

// ── Configuration ──────────────────────────────────────────────────────────

const CONFIG = {
  BM25_WEIGHT: 0.35,           // Weight for BM25 score in final ranking
  VECTOR_WEIGHT: 0.65,         // Weight for vector score in final ranking
  RRF_K: 60,                   // RRF constant (standard value)
  BM25_TOP_N: 30,              // How many BM25 results to retrieve
  MIN_QUERY_LENGTH: 2,         // Minimum query length for BM25
  FULLTEXT_INDEX_NAME: 'ft_knowledge_title_content',
  ENABLED: process.env.HYBRID_SEARCH_ENABLED !== 'false', // Default ON
};

// Cache for FULLTEXT availability check
let fulltextAvailable = null;

// BM25 result cache (avoid repeated queries for same text)
const bm25Cache = new LRUCache({ max: 200, ttl: 1000 * 60 * 5 }); // 5 min

// ── FULLTEXT Index Management ──────────────────────────────────────────────

/**
 * Ensure FULLTEXT index exists on knowledge_base table.
 * Called once on startup.
 */
async function ensureFulltextIndex() {
  try {
    // Check if index already exists
    const [indexes] = await sequelize.query(
      `SHOW INDEX FROM knowledge_base WHERE Key_name = ?`,
      { replacements: [CONFIG.FULLTEXT_INDEX_NAME] }
    );

    if (indexes && indexes.length > 0) {
      fulltextAvailable = true;
      logger.info('FULLTEXT index already exists on knowledge_base');
      return true;
    }

    // Create FULLTEXT index
    logger.info('Creating FULLTEXT index on knowledge_base(title, content)...');
    await sequelize.query(
      `ALTER TABLE knowledge_base ADD FULLTEXT INDEX ${CONFIG.FULLTEXT_INDEX_NAME} (title, content)`
    );
    fulltextAvailable = true;
    logger.info('FULLTEXT index created successfully');
    return true;
  } catch (error) {
    // If table doesn't exist or other error, disable FULLTEXT
    logger.warn({ error: error.message }, 'Failed to create FULLTEXT index, BM25 disabled');
    fulltextAvailable = false;
    return false;
  }
}

/**
 * Check if FULLTEXT search is available.
 */
async function isFulltextAvailable() {
  if (fulltextAvailable !== null) return fulltextAvailable;
  return ensureFulltextIndex();
}

// ── BM25 Search via MySQL FULLTEXT ─────────────────────────────────────────

/**
 * Search knowledge_base using MySQL FULLTEXT (BM25-like scoring).
 * Returns scored results with MySQL's relevance score.
 * 
 * @param {string} query - Search query
 * @param {number} limit - Max results
 * @returns {Promise<Array<{id: number, title: string, score: number}>>}
 */
async function bm25Search(query, limit = CONFIG.BM25_TOP_N) {
  if (!CONFIG.ENABLED || query.length < CONFIG.MIN_QUERY_LENGTH) return [];
  
  const available = await isFulltextAvailable();
  if (!available) return [];

  // Check cache
  const cacheKey = `bm25:${query.slice(0, 200)}:${limit}`;
  const cached = bm25Cache.get(cacheKey);
  if (cached) return cached;

  try {
    // Build FULLTEXT query - use BOOLEAN MODE for better control
    // Expand common abbreviations for BM25 too
    const expandedTerms = expandForBM25(query);

    const [results] = await sequelize.query(
      `SELECT 
         id, title,
         MATCH(title, content) AGAINST(? IN BOOLEAN MODE) AS relevance
       FROM knowledge_base
       WHERE status = 'ready'
         AND MATCH(title, content) AGAINST(? IN BOOLEAN MODE)
       ORDER BY relevance DESC
       LIMIT ?`,
      { replacements: [expandedTerms, expandedTerms, limit] }
    );

    // Normalize scores to 0-1 range
    const maxScore = results.length > 0 ? Math.max(...results.map(r => r.relevance)) : 1;
    const normalized = results.map(r => ({
      id: r.id,
      title: r.title,
      score: maxScore > 0 ? r.relevance / maxScore : 0,
    }));

    bm25Cache.set(cacheKey, normalized);
    return normalized;
  } catch (error) {
    logger.warn({ error: error.message, query: query.slice(0, 50) }, 'BM25 search failed');
    return [];
  }
}

/**
 * Expand query for BM25 BOOLEAN MODE.
 * Adds synonyms and wildcards for better recall.
 */
function expandForBM25(query) {
  const abbrevs = {
    'pdrb': 'pdrb produk domestik regional bruto',
    'tpt': 'tpt pengangguran terbuka',
    'tpak': 'tpak partisipasi angkatan kerja',
    'ipm': 'ipm pembangunan manusia',
    'ihk': 'ihk harga konsumen inflasi',
    'ipg': 'ipg pembangunan gender',
    'halbar': 'halbar halmahera barat',
    'halsel': 'halsel halmahera selatan',
    'halut': 'halut halmahera utara',
    'haltim': 'haltim halmahera timur',
    'halteng': 'halteng halmahera tengah',
    'kepsul': 'kepsul kepulauan sula',
    'tikep': 'tikep tidore kepulauan',
  };

  let expanded = query.toLowerCase();
  for (const [abbr, full] of Object.entries(abbrevs)) {
    if (expanded.includes(abbr)) {
      expanded = expanded.replace(abbr, full);
    }
  }

  // Remove common Indonesian stopwords
  const stopwords = ['yang', 'dan', 'atau', 'untuk', 'dari', 'dengan', 'ini', 'itu', 'di', 'ke', 'pada'];
  const tokens = expanded.split(/\s+/)
    .filter(t => t.length >= 2 && !stopwords.includes(t));

  // Truncate to top 12 keywords — MySQL FULLTEXT has diminishing returns
  // beyond ~10-12 terms, and very long queries (50+ words from synonym
  // expansion) cause 3-4s slow queries on the knowledge_base table.
  const truncated = tokens.slice(0, 12);

  // In BOOLEAN MODE, we don't need special operators for a basic search
  // Just space-separate the terms (implicit OR in BOOLEAN MODE)
  return truncated.join(' ');
}

// ── Reciprocal Rank Fusion ─────────────────────────────────────────────────

/**
 * Combine BM25 and vector search results using RRF.
 * 
 * RRF formula: score(d) = sum(1 / (k + rank_i(d))) across all rankings
 * This is then weighted by BM25_WEIGHT and VECTOR_WEIGHT.
 * 
 * @param {Array<{id, score}>} bm25Results - BM25 results with scores
 * @param {Array<{id, score}>} vectorResults - Vector results with scores  
 * @param {Object} options
 * @returns {Array<{id, bm25Rank, vectorRank, rrfScore, bm25Score, vectorScore}>}
 */
function reciprocalRankFusion(bm25Results, vectorResults, options = {}) {
  const { k = CONFIG.RRF_K, bm25Weight = CONFIG.BM25_WEIGHT, vectorWeight = CONFIG.VECTOR_WEIGHT } = options;

  // Build rank maps
  const bm25Ranks = new Map();
  bm25Results.forEach((r, i) => bm25Ranks.set(r.id, { rank: i + 1, score: r.score }));

  const vectorRanks = new Map();
  vectorResults.forEach((r, i) => vectorRanks.set(r.id, { rank: i + 1, score: r.score }));

  // Collect all unique IDs
  const allIds = new Set([
    ...bm25Results.map(r => r.id),
    ...vectorResults.map(r => r.id),
  ]);

  const fused = [];
  for (const id of allIds) {
    const bm25 = bm25Ranks.get(id);
    const vector = vectorRanks.get(id);

    // RRF: 1/(k + rank) for each ranking where this doc appears
    const bm25RRF = bm25 ? bm25Weight / (k + bm25.rank) : 0;
    const vectorRRF = vector ? vectorWeight / (k + vector.rank) : 0;

    fused.push({
      id,
      rrfScore: bm25RRF + vectorRRF,
      bm25Rank: bm25?.rank || null,
      vectorRank: vector?.rank || null,
      bm25Score: bm25?.score || 0,
      vectorScore: vector?.score || 0,
    });
  }

  // Sort by RRF score descending
  fused.sort((a, b) => b.rrfScore - a.rrfScore);
  return fused;
}

/**
 * Perform hybrid search combining BM25 + vector.
 * Drop-in enhancement for the existing vector search pipeline.
 * 
 * @param {string} query - User query
 * @param {Array<{id, similarity, ...}>} vectorResults - Existing vector search results
 * @param {Object} options
 * @returns {Array<{id, finalScore, bm25Score, vectorScore, rrfScore}>}
 */
async function hybridRerank(query, vectorResults, options = {}) {
  if (!CONFIG.ENABLED) {
    // Passthrough: just use vector results as-is
    return vectorResults.map(r => ({ ...r, finalScore: r.similarity || r.score || 0 }));
  }

  const startTime = Date.now();

  // Run BM25 search
  const bm25Results = await bm25Search(query);

  if (bm25Results.length === 0) {
    // No BM25 results - fall back to vector-only
    return vectorResults.map(r => ({ ...r, finalScore: r.similarity || r.score || 0 }));
  }

  // Normalize vector results format for RRF
  const normalizedVector = vectorResults.map(r => ({
    id: r.id,
    score: r.similarity || r.score || 0,
  }));

  // Apply RRF
  const fused = reciprocalRankFusion(bm25Results, normalizedVector, options);

  // Merge back full data from vector results
  const vectorMap = new Map(vectorResults.map(r => [r.id, r]));
  const results = fused.map(f => {
    const vectorData = vectorMap.get(f.id) || {};
    return {
      ...vectorData,
      id: f.id,
      similarity: f.vectorScore, // Preserve original vector similarity
      finalScore: f.rrfScore,
      bm25Score: f.bm25Score,
      vectorScore: f.vectorScore,
      bm25Rank: f.bm25Rank,
      vectorRank: f.vectorRank,
    };
  });

  const duration = Date.now() - startTime;
  logger.debug({
    query: query.slice(0, 50),
    bm25Hits: bm25Results.length,
    vectorHits: vectorResults.length,
    fusedCount: results.length,
    duration_ms: duration,
  }, 'Hybrid search completed');

  return results;
}

// ── Invalidation ───────────────────────────────────────────────────────────

function invalidateBM25Cache() {
  bm25Cache.clear();
}

module.exports = {
  ensureFulltextIndex,
  isFulltextAvailable,
  bm25Search,
  reciprocalRankFusion,
  hybridRerank,
  expandForBM25,
  invalidateBM25Cache,
  CONFIG,
};
