/**
 * LLM-Based Contextual Suggestions Service
 * 
 * Generates intelligent follow-up question chips using LLM,
 * enriched with REAL datasource names and knowledge base topics from the database.
 * 
 * Design:
 * - Uses gpt-4.1 (or user's chosen model via requestContext)
 * - 3-second timeout to prevent hanging
 * - Caches by (query + topic) for 10 minutes
 * - Loads datasource catalog on startup for grounding
 * - Falls back silently on error
 * 
 * @module llmSuggestions.service
 * @created 2026-02-10
 */

'use strict';

const logger = require('../../../utils/logger').child({ service: 'LLMSuggestions' });
const requestContext = require('./requestContext');
const { chatCompletion } = require('../../ai/client/openaiClient');

// Feature flag
const LLM_SUGGESTIONS_ENABLED = process.env.LLM_SUGGESTIONS_ENABLED !== 'false';

// In-memory cache (TTL: 10 minutes, max 500 entries with LRU eviction)
const suggestionCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CACHE_SIZE = 500;

// Timeout for LLM calls (45s — gpt-5-mini reasoning model can take 20-30s)
const LLM_TIMEOUT_MS = 45000;

// ── Datasource catalog (loaded once, refreshed hourly) ──────────────

let _datasourceCatalog = null; // { categories: [...], topIndicators: [...], knowledgeTopics: [...] }
let _catalogLoadedAt = 0;
const CATALOG_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Load datasource and knowledge base catalog from DB for grounding suggestions.
 * Cached for 1 hour to avoid repeated DB queries.
 */
async function loadDatasourceCatalog() {
  const now = Date.now();
  if (_datasourceCatalog && (now - _catalogLoadedAt) < CATALOG_TTL_MS) {
    return _datasourceCatalog;
  }

  try {
    const DataSource = require('../../../models/DataSource.model');
    const KnowledgeBase = require('../../../models/KnowledgeBase.model');
    const { Sequelize } = require('sequelize');

    // Get distinct categories + top priority indicators
    const [allDs, knowledgeCats] = await Promise.all([
      DataSource.findAll({
        where: { visible: true, status: true },
        attributes: ['name', 'category', 'priority'],
        order: [['priority', 'ASC'], ['name', 'ASC']],
        raw: true,
      }),
      KnowledgeBase.findAll({
        attributes: [
          'category',
          [Sequelize.fn('COUNT', Sequelize.col('id')), 'count'],
        ],
        where: { status: 'ready' },
        group: ['category'],
        raw: true,
      }),
    ]);

    // Extract distinct categories
    const categorySet = new Set();
    const topIndicators = [];
    for (const ds of allDs) {
      if (ds.category) categorySet.add(ds.category);
      if (ds.priority <= 2 && topIndicators.length < 30) {
        topIndicators.push(ds.name);
      }
    }

    // Knowledge base topics
    const knowledgeTopics = knowledgeCats.map(k => `${k.category} (${k.count} dokumen)`);

    _datasourceCatalog = {
      categories: Array.from(categorySet).slice(0, 40),
      topIndicators: topIndicators,
      knowledgeTopics: knowledgeTopics,
      totalDatasources: allDs.length,
    };
    _catalogLoadedAt = now;

    logger.info({
      categories: _datasourceCatalog.categories.length,
      indicators: topIndicators.length,
      knowledge: knowledgeTopics.length,
    }, 'Datasource catalog loaded for LLM suggestions');

    return _datasourceCatalog;
  } catch (err) {
    logger.warn({ error: err.message }, 'Failed to load datasource catalog, using fallback');
    // Return minimal fallback
    return {
      categories: ['Kependudukan', 'Kemiskinan', 'Ketenagakerjaan', 'PDRB/Ekonomi', 'Inflasi/Harga', 'Pertanian', 'Pendidikan', 'Kesehatan'],
      topIndicators: ['Inflasi', 'Kemiskinan', 'IPM', 'PDRB', 'TPT', 'Ekspor', 'Impor', 'Penduduk'],
      knowledgeTopics: ['BRS', 'Publikasi', 'PPID'],
      totalDatasources: 319,
    };
  }
}

/**
 * System prompt for suggestion generation — grounded with real data catalog
 */
function buildSystemPrompt(catalog) {
  return `Kamu adalah asisten chat statistik BPS Maluku Utara (MALIKA).

Tugas: Berikan 3-5 saran pertanyaan lanjutan yang KONTEKSTUAL, SPESIFIK, dan merujuk DATA NYATA.

DATA YANG TERSEDIA DI SISTEM (${catalog.totalDatasources} indikator):
Kategori: ${catalog.categories.slice(0, 20).join(', ')}

Indikator utama: ${catalog.topIndicators.slice(0, 20).join(', ')}

Knowledge base: ${catalog.knowledgeTopics.join(', ')}

Wilayah: Prov. Maluku Utara, Kota Ternate, Kota Tidore Kepulauan, Kab. Halmahera Utara/Selatan/Tengah/Barat/Timur, Kab. Kepulauan Sula, Kab. Pulau Morotai, Kab. Pulau Taliabu

ATURAN PENTING:
1. Saran HARUS merujuk data/indikator NYATA yang ada di sistem
2. Pertanyaan SINGKAT (max 40 karakter)
3. Pertanyaan BERAGAM (jangan repetitif)
4. Bahasa Indonesia natural
5. Fokus: perbandingan wilayah, tren waktu, breakdown, insight

CONTOH BAIK (merujuk data nyata):
- "Data inflasi per bulan?"
- "Kemiskinan per kabupaten"
- "Tren IPM 5 tahun terakhir"
- "PDRB sektor terbesar?"
- "TPT Kota Ternate"
- "BRS kemiskinan terbaru"

CONTOH BURUK (terlalu generik/tidak merujuk data):
- "Apa saja data yang tersedia?"
- "Informasi lebih lanjut"

Format output HARUS berupa JSON object: {"suggestions": ["Saran 1", "Saran 2", "Saran 3"]}. JANGAN kembalikan array langsung, harus json object.`;
}

/**
 * Build cache key from context
 */
function buildCacheKey(userMessage, conversationTopic) {
  const msg = String(userMessage || '').toLowerCase().trim().slice(0, 100);
  const topic = String(conversationTopic || '').toLowerCase().trim();
  return `${msg}|${topic}`;
}

/**
 * Clean expired cache entries
 */
function cleanExpiredCache() {
  const now = Date.now();
  for (const [key, entry] of suggestionCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      suggestionCache.delete(key);
    }
  }
}

// Clean cache every 5 minutes
setInterval(cleanExpiredCache, 5 * 60 * 1000);

/**
 * Build user prompt with rich context
 */
function buildUserPrompt(ctx, fullText, catalog) {
  const parts = [];
  
  // Current conversation context
  if (ctx.userMessage) {
    parts.push(`Pertanyaan user: "${ctx.userMessage}"`);
  }
  
  if (ctx.conversationTopic) {
    parts.push(`Topik: ${ctx.conversationTopic}`);
  }
  
  // What was just shown
  if (ctx.dataPreview?.title) {
    parts.push(`Data ditampilkan: ${ctx.dataPreview.title}`);
  }
  
  if (ctx.isKnowledgeMode) {
    parts.push('Mode: Layanan/pengetahuan BPS (BRS, Publikasi, PPID)');
  }

  // Include matched candidates for grounding
  if (ctx.candidates?.length > 0) {
    const candidateNames = ctx.candidates.slice(0, 5).map(c => c.name).join(', ');
    parts.push(`Data terkait yang ditemukan: ${candidateNames}`);
  }

  // Include knowledge context categories if available
  if (ctx.knowledgeContext?.length > 0) {
    const kbTitles = ctx.knowledgeContext.slice(0, 3).map(k => k.title || k.name).filter(Boolean).join(', ');
    if (kbTitles) parts.push(`Dokumen terkait: ${kbTitles}`);
  }
  
  // Summary of assistant response (first 300 chars)
  if (fullText) {
    const summary = String(fullText).slice(0, 300).replace(/\n/g, ' ');
    parts.push(`Respons bot: "${summary}..."`);
  }
  
  // Year/geo context
  if (ctx.yearInference?.year) {
    parts.push(`Tahun: ${ctx.yearInference.year}`);
  }
  if (ctx.geoInference?.region) {
    parts.push(`Wilayah: ${ctx.geoInference.region}`);
  }

  // For greeting/new chat — suggest exploring popular data categories
  if (ctx.isGreeting || (!ctx.userMessage && !ctx.conversationTopic)) {
    parts.push(`\nIni adalah AWAL percakapan baru. Sarankan topik data populer yang bisa dieksplorasi user.`);
    parts.push(`Contoh topik populer: ${catalog.topIndicators.slice(0, 10).join(', ')}`);
  }
  
  parts.push('\nBerikan 3-5 saran pertanyaan lanjutan yang kontekstual dan merujuk data nyata. Output dalam format json.');
  
  return parts.join('\n');
}

/**
 * Generate contextual suggestions using LLM
 * 
 * @param {object} ctx - Pipeline context
 * @param {string} fullText - Complete assistant response
 * @returns {Promise<string[]|null>} - Array of suggestions or null on error
 */
async function generateLLMSuggestions(ctx, fullText) {
  if (!LLM_SUGGESTIONS_ENABLED) {
    logger.debug('LLM suggestions disabled');
    return null;
  }
  
  const startMs = Date.now();
  
  try {
    // Check cache first
    const cacheKey = buildCacheKey(ctx.userMessage, ctx.conversationTopic);
    const cached = suggestionCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      logger.debug({ cached: true, latencyMs: Date.now() - startMs }, 'Returning cached suggestions');
      return cached.suggestions;
    }

    // Load real datasource catalog
    const catalog = await loadDatasourceCatalog();
    
    // Build prompt grounded with real data
    const systemPrompt = buildSystemPrompt(catalog);
    const userPrompt = buildUserPrompt(ctx, fullText, catalog);
    
    // LLM call with shared client (retry + circuit breaker built-in)
    const response = await chatCompletion({
      apiKeyEnv: 'OPENAI_API_KEY_QUERY_BUILDER',
      payload: {
        model: process.env.OPENAI_MODEL_SUGGESTIONS || 'gpt-4.1',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 150,
        response_format: { type: 'json_object' },
      },
      timeoutMs: LLM_TIMEOUT_MS,
      retries: 1,
    });
    
    // Parse response
    const content = response.choices?.[0]?.message?.content || '[]';
    let suggestions;
    
    try {
      const parsed = JSON.parse(content);
      // Handle both array and object with suggestions key
      suggestions = Array.isArray(parsed) ? parsed : (parsed.suggestions || parsed.saran || []);
    } catch (parseErr) {
      // Fallback: try to extract suggestions from malformed JSON using regex
      logger.warn({ content: String(content).slice(0, 200), parseErr: parseErr.message }, 'Failed to parse LLM suggestions, trying regex fallback');
      try {
        const matches = String(content).match(/"([^"]{5,60}\??)"/g);
        if (matches && matches.length >= 2) {
          suggestions = matches.map(m => m.replace(/^"|"$/g, '')).slice(0, 5);
          logger.info({ count: suggestions.length }, 'Recovered suggestions via regex fallback');
        } else {
          return null;
        }
      } catch {
        return null;
      }
    }
    
    // Validate and clean suggestions
    const validSuggestions = suggestions
      .filter(s => typeof s === 'string' && s.length >= 5 && s.length <= 60)
      .slice(0, 5);
    
    if (validSuggestions.length === 0) {
      logger.debug('No valid suggestions from LLM');
      return null;
    }
    
    // Cache result (with LRU eviction when cache is full)
    if (suggestionCache.size >= MAX_CACHE_SIZE) {
      // Delete oldest entry (Map iterates in insertion order)
      const oldestKey = suggestionCache.keys().next().value;
      suggestionCache.delete(oldestKey);
    }
    suggestionCache.set(cacheKey, {
      suggestions: validSuggestions,
      timestamp: Date.now(),
    });
    
    const latencyMs = Date.now() - startMs;
    logger.info({
      suggestions: validSuggestions.length,
      latencyMs,
      tokens: response.usage?.total_tokens || 0,
    }, 'Generated LLM suggestions');
    
    return validSuggestions;
    
  } catch (error) {
    const latencyMs = Date.now() - startMs;
    
    if (error.name === 'AbortError') {
      logger.warn({ latencyMs }, 'LLM suggestions timed out');
    } else {
      logger.error({ error: error.message, latencyMs }, 'LLM suggestions failed');
    }
    
    return null;
  }
}

/**
 * Fire-and-forget wrapper that sends suggestions_update SSE event
 * 
 * @param {object} ctx - Pipeline context with sse client
 * @param {string} fullText - Complete assistant response
 */
async function sendLLMSuggestionsAsync(ctx, fullText) {
  if (!LLM_SUGGESTIONS_ENABLED) return;
  if (!ctx?.sse?.sendEvent) return;
  
  try {
    const suggestions = await generateLLMSuggestions(ctx, fullText);
    
    if (suggestions && suggestions.length > 0) {
      // Check if SSE client is still connected
      if (ctx.sse.isClientConnected?.() === false) {
        logger.info('Client disconnected, skipping suggestions_update');
        return;
      }
      
      ctx.sse.sendEvent('suggestions_update', { suggestions });
      logger.info({ count: suggestions.length, suggestions }, 'Sent suggestions_update SSE event');
    }
  } catch (error) {
    // Silent fail
    logger.info({ error: error.message }, 'sendLLMSuggestionsAsync failed silently');
  }
}

module.exports = {
  generateLLMSuggestions,
  sendLLMSuggestionsAsync,
  LLM_SUGGESTIONS_ENABLED,
  loadDatasourceCatalog, // exported for testing
};
