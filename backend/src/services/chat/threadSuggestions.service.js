/**
 * Thread Suggestions Service
 *
 * Generates context-aware follow-up question chips for a chat thread on load.
 * Powers GET /chat/threads/:id/suggestions.
 *
 * Design:
 * - Loads last user + assistant message of the thread
 * - Loads a small datasource catalog (cached 1h) for grounding
 * - Calls LLM via shared openaiClient (4s timeout, 1 retry)
 * - Caches results by (thread_id + last_assistant_msg_id) for 10 minutes
 * - Returns null on any error → controller falls back to defaults
 */
'use strict';

const { Sequelize } = require('sequelize');
const ChatMessage = require('../../models/ChatMessage.model');
const ChatThread = require('../../models/ChatThread.model');
const DataSource = require('../../models/DataSource.model');
const KnowledgeBase = require('../../models/KnowledgeBase.model');
const { chatCompletion } = require('../ai/client/openaiClient');

const ENABLED = process.env.LLM_SUGGESTIONS_ENABLED !== 'false';
// malika-llm-proxy routes any model to claude-sonnet-4-6 → ~10s baseline.
// 20s gives headroom; first call per thread pays the cost, then 10-min cache
// makes return visits instant.
const LLM_TIMEOUT_MS = Number(process.env.LLM_SUGGESTIONS_TIMEOUT_MS) || 20000;
const LLM_MODEL = process.env.OPENAI_MODEL_SUGGESTIONS || 'claude-sonnet-4-6';

// In-memory cache (TTL 10 min, max 500 entries with LRU eviction)
const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_SIZE = 500;

// Datasource catalog (refreshed hourly)
let _catalog = null;
let _catalogLoadedAt = 0;
const CATALOG_TTL_MS = 60 * 60 * 1000;

const FALLBACK_CATALOG = {
  categories: ['Kependudukan', 'Kemiskinan', 'Ketenagakerjaan', 'PDRB/Ekonomi', 'Inflasi/Harga', 'Pertanian', 'Pendidikan', 'Kesehatan'],
  topIndicators: ['Inflasi', 'Kemiskinan', 'IPM', 'PDRB', 'TPT', 'Ekspor', 'Impor', 'Penduduk'],
  knowledgeTopics: ['BRS', 'Publikasi', 'PPID'],
  totalDatasources: 319,
};

async function loadCatalog() {
  const now = Date.now();
  if (_catalog && (now - _catalogLoadedAt) < CATALOG_TTL_MS) return _catalog;

  try {
    const [allDs, knowledgeCats] = await Promise.all([
      DataSource.findAll({
        where: { visible: true, status: true },
        attributes: ['name', 'category', 'priority'],
        order: [['priority', 'ASC'], ['name', 'ASC']],
        raw: true,
      }),
      KnowledgeBase.findAll({
        attributes: ['category', [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']],
        where: { status: 'ready' },
        group: ['category'],
        raw: true,
      }),
    ]);

    const categorySet = new Set();
    const topIndicators = [];
    for (const ds of allDs) {
      if (ds.category) categorySet.add(ds.category);
      if (ds.priority <= 2 && topIndicators.length < 30) topIndicators.push(ds.name);
    }

    _catalog = {
      categories: Array.from(categorySet).slice(0, 40),
      topIndicators,
      knowledgeTopics: knowledgeCats.map((k) => `${k.category} (${k.count} dokumen)`),
      totalDatasources: allDs.length,
    };
    _catalogLoadedAt = now;
    return _catalog;
  } catch {
    return FALLBACK_CATALOG;
  }
}

function buildPrompt(catalog, lastUser, lastAssistant, threadTitle) {
  const sys = `Kamu asisten chat statistik BPS Maluku Utara (MALIKA).
Tugas: berikan 4-5 saran pertanyaan lanjutan KONTEKSTUAL & spesifik, merujuk data nyata.

DATA TERSEDIA (${catalog.totalDatasources} indikator):
Kategori: ${catalog.categories.slice(0, 15).join(', ')}
Indikator utama: ${catalog.topIndicators.slice(0, 15).join(', ')}
Knowledge: ${catalog.knowledgeTopics.join(', ')}

Wilayah: Maluku Utara, Kota Ternate, Tidore Kepulauan, Kab. Halmahera Utara/Selatan/Tengah/Barat/Timur, Kab. Kepulauan Sula, Pulau Morotai, Pulau Taliabu.

ATURAN:
1. Saran rujuk data NYATA di sistem.
2. Pertanyaan SINGKAT (max 40 char), Bahasa Indonesia natural.
3. BERAGAM (perbandingan wilayah, tren waktu, breakdown, insight).

Format output: JSON object {"suggestions": ["Saran 1", ...]}`;

  const userParts = [];
  if (threadTitle) userParts.push(`Judul thread: "${threadTitle}"`);
  if (lastUser) userParts.push(`Pertanyaan terakhir user: "${String(lastUser).slice(0, 200)}"`);
  if (lastAssistant) userParts.push(`Respons MALIKA: "${String(lastAssistant).slice(0, 400).replace(/\n/g, ' ')}"`);
  if (!lastUser && !lastAssistant) userParts.push('Thread baru tanpa konteks. Sarankan topik populer.');
  userParts.push('\nBerikan 4-5 saran lanjutan kontekstual.');

  return { system: sys, user: userParts.join('\n') };
}

function getCacheKey(threadId, lastMsgId) {
  return `${threadId}:${lastMsgId || 'empty'}`;
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.suggestions;
}

function setCached(key, suggestions) {
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { suggestions, timestamp: Date.now() });
}

/**
 * Generate suggestions for a thread.
 * Returns array of strings, or null if generation fails / disabled.
 */
async function generateForThread(threadId, ownerId) {
  if (!ENABLED) return null;
  if (!threadId) return null;

  try {
    // Verify thread ownership + grab title
    const thread = await ChatThread.findOne({
      where: { id: threadId, owner_id: String(ownerId || '0') },
      attributes: ['id', 'title'],
      raw: true,
    });
    if (!thread) return null;

    // Last user message + last assistant message
    const recent = await ChatMessage.findAll({
      where: { thread_id: threadId },
      order: [['id', 'DESC']],
      limit: 6,
      attributes: ['id', 'role', 'content'],
      raw: true,
    });
    const lastUser = recent.find((m) => m.role === 'user');
    const lastAssistant = recent.find((m) => m.role === 'assistant');
    const lastMsgId = recent[0]?.id || null;

    // Cache check
    const cacheKey = getCacheKey(threadId, lastMsgId);
    const cached = getCached(cacheKey);
    if (cached) return cached;

    // Build prompt
    const catalog = await loadCatalog();
    const prompt = buildPrompt(catalog, lastUser?.content, lastAssistant?.content, thread.title);

    // LLM call with hard timeout. Use simple json_object (some Gemini routes
    // through the proxy run slow with strict json_schema).
    const response = await chatCompletion({
      apiKeyEnv: 'OPENAI_API_KEY_QUERY_BUILDER',
      payload: {
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        max_tokens: 250,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      },
      timeoutMs: LLM_TIMEOUT_MS,
      retries: 0,
      skipCircuitBreaker: true,
    });

    const rawContent = response?.choices?.[0]?.message?.content || '{}';
    // claude-sonnet-4-6 routed via the proxy often wraps json in ```json ... ```
    // markdown fences. Strip them before parsing.
    const stripped = String(rawContent)
      .replace(/^\s*```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    let parsed;
    try { parsed = JSON.parse(stripped); } catch { return null; }

    const raw = Array.isArray(parsed) ? parsed : (parsed.suggestions || parsed.saran || []);
    const cleaned = (Array.isArray(raw) ? raw : [])
      .filter((s) => typeof s === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length >= 4 && s.length <= 60)
      .slice(0, 5);

    if (cleaned.length === 0) return null;

    setCached(cacheKey, cleaned);
    return cleaned;
  } catch {
    return null;
  }
}

module.exports = {
  generateForThread,
  ENABLED,
};
