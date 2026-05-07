'use strict';

/**
 * Canonical Knowledge Search Service
 * 
 * This is the SINGLE entry point for all knowledge base searches.
 * Used by both chat.service.js (non-streaming) and streaming.service.js.
 * 
 * IMPORTANT: Do not create duplicate search wrappers elsewhere.
 * Import this service instead.
 */

const { SimpleCache } = require('../../utils/simpleCache');
const logger = require('../../utils/logger').child({ service: 'KnowledgeSearch' });

// Cache with 5 minute TTL, max 200 entries
const knowledgeCache = new SimpleCache(5 * 60 * 1000, 200);

// Lazy-loaded service references
let _vectorSearchService = null;
let _multiStrategyService = null;

function getVectorSearchService() {
  if (!_vectorSearchService) {
    try {
      _vectorSearchService = require('../ai/vectorSearch.service');
    } catch {
      _vectorSearchService = null;
    }
  }
  return _vectorSearchService;
}

function getMultiStrategyService() {
  if (!_multiStrategyService) {
    try {
      _multiStrategyService = require('../ai/multiStrategySearch.service');
    } catch {
      _multiStrategyService = null;
    }
  }
  return _multiStrategyService;
}

function buildCacheKey(query, topN, minSimilarity) {
  return JSON.stringify({
    query: String(query || '').trim().toLowerCase(),
    topN: Number(topN) || 5,
    minSimilarity: Number(minSimilarity) || 0.4,
  });
}

/**
 * Search knowledge base for relevant documents
 * @param {object|string} options - Options object or query string
 * @param {string} options.query - User query
 * @param {number} options.topN - Number of results (default: 5)
 * @param {number} options.minSimilarity - Minimum similarity threshold (default: 0.4)
 * @param {object} options.deps - Dependency injection (optional)
 * @returns {Promise<Array>} - Filtered knowledge documents
 */
async function searchKnowledge(options = {}) {
  // Support both object and string arguments for backward compatibility
  let query, topN, minSimilarity, deps, skipLLMSynonyms;
  if (typeof options === 'string') {
    query = options;
    topN = 5;
    minSimilarity = 0.4;
    deps = {};
    skipLLMSynonyms = false;
  } else {
    ({ query, topN = 5, minSimilarity = 0.4, deps = {}, skipLLMSynonyms = false } = options);
  }

  const q = String(query || '').trim();
  if (!q) return [];

  const cacheKey = buildCacheKey(q, topN, minSimilarity);
  const cached = knowledgeCache.get(cacheKey);
  if (cached) {
    logger.debug({ query: q, cached: true }, 'Knowledge search cache hit');
    return cached;
  }

  const vectorSearchService = deps.vectorSearchService || getVectorSearchService();
  if (!vectorSearchService?.searchKnowledge) return [];

  try {
    // Use multi-strategy search when available (parallel variants + self-check)
    const multiStrategy = getMultiStrategyService();
    let result;
    
    if (multiStrategy?.enhancedSearchKnowledge && !deps.skipMultiStrategy) {
      result = await multiStrategy.enhancedSearchKnowledge(q, topN, { 
        skipLLMSynonyms,
        skipSelfCheck: deps.skipSelfCheck || false,
      });
    } else {
      // Fallback to single-strategy search
      result = await vectorSearchService.searchKnowledge(q, topN, { skipLLMSynonyms });
    }
    
    const filtered = (result?.results || []).filter(r => (r?.similarity || 0) >= minSimilarity);
    knowledgeCache.set(cacheKey, filtered);
    return filtered;
  } catch (e) {
    logger.warn({ error: e.message }, 'Knowledge search failed');
    return [];
  }
}

/**
 * Invalidate knowledge cache (useful after knowledge_base updates)
 */
function invalidateCache() {
  knowledgeCache.clear();
  logger.info('Knowledge search cache invalidated');
}

async function rankKnowledgeResults({ query, results = [], deps = {} } = {}) {
  const list = Array.isArray(results) ? results : [];
  if (list.length <= 1) return list;

  let rerankerService = deps.rerankerService;
  if (!rerankerService) {
    try {
      rerankerService = require('../ai/reranker.service');
    } catch {
      rerankerService = null;
    }
  }

  if (rerankerService?.rerankKnowledge) {
    try {
      const reranked = await rerankerService.rerankKnowledge(query, list);
      return Array.isArray(reranked?.results) ? reranked.results : list;
    } catch (e) {
      logger.warn({ error: e.message }, 'Knowledge rerank failed');
    }
  }

  return list.slice().sort((a, b) => (b?.similarity || 0) - (a?.similarity || 0));
}

function formatKnowledgeContext({ results = [], maxItems = 8, maxChars = 10000 } = {}) {
  const list = Array.isArray(results) ? results.slice(0, maxItems) : [];
  if (list.length === 0) return '';

  const blocks = list.map((doc, idx) => {
    const title = String(doc?.title || doc?.name || `Dokumen ${idx + 1}`).trim();
    const similarity = Math.round((doc?.similarity || 0) * 100);
    
    // Content may be enriched with query-relevant extraction from enrichKnowledgeWithExtraction
    const rawContent = doc?.content || '';
    const content = String(rawContent).replace(/\s+/g, ' ').trim();
    
    // For extracted content, allow more chars (2000 instead of 600) to include more data
    const maxSnippet = doc?.contentExtracted ? 5000 : 3000;
    const snippet = content.length > maxSnippet ? `${content.slice(0, maxSnippet)}…` : content;
    
    // Add marker if using extracted content
    const extractionNote = doc?.contentExtracted ? ' [Data relevan diekstrak]' : '';
    return `Dokumen ${idx + 1}: ${title}${extractionNote} (relevansi ${similarity}%)\n${snippet}`.trim();
  });

  const text = blocks.join('\n\n');
  const trimmed = text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
  return `KONTEN DOKUMEN INTERNAL BPS (gunakan jika relevan):\n${trimmed}`.trim();
}

/**
 * Get cache statistics
 */
function getCacheStats() {
  return {
    size: knowledgeCache.size || 0,
    maxSize: 200,
    ttlMs: 5 * 60 * 1000,
  };
}

module.exports = {
  searchKnowledge,
  rankKnowledgeResults,
  formatKnowledgeContext,
  invalidateCache,
  getCacheStats,
};
