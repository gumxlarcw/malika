/**
 * Persistent Memory Service (OpenClaw-inspired)
 * 
 * Extracts, stores, and retrieves per-user facts/preferences/regions
 * from conversations. Injected into system prompt for personalized responses.
 * 
 * Key features:
 * - LLM-based fact extraction after each conversation turn
 * - BM25 + vector hybrid retrieval for relevant memories
 * - Confidence-weighted deduplication (reinforces repeated facts)
 * - TTL-based expiration for stale memories
 * - Cross-thread memory search
 */

'use strict';

const UserMemory = require('../../models/UserMemory.model');
const { generateEmbedding } = require('../ai/embedding.service');
const { Op } = require('sequelize');
const sequelize = require('../../config/db');
const { LRUCache } = require('lru-cache');
const logger = require('../../utils/logger').child({ service: 'PersistentMemory' });
const { chatCompletion } = require('../ai/client/openaiClient');

// ── Configuration ──────────────────────────────────────────────────────────

const CONFIG = {
  EXTRACTION_MODEL: process.env.OPENAI_MODEL_MEMORY || 'gemini-3-flash-preview',
  EXTRACTION_TEMPERATURE: 0.1,
  EXTRACTION_MAX_TOKENS: 500,
  MAX_MEMORIES_PER_USER: 100,
  MAX_MEMORIES_IN_PROMPT: 8,
  MIN_CONFIDENCE: 0.3,
  CONFIDENCE_BOOST: 0.1,       // On each reinforcement
  MAX_CONFIDENCE: 1.0,
  BM25_WEIGHT: 0.4,            // Weight for keyword match
  VECTOR_WEIGHT: 0.6,          // Weight for semantic similarity
  MIN_RETRIEVAL_SCORE: 0.3,
  EXTRACTION_TIMEOUT_MS: 30000, // Increased for gpt-5-mini
  ENABLED: process.env.PERSISTENT_MEMORY_ENABLED !== 'false', // Default ON
};

// LLM result cache (avoid repeated extractions for same text)
const extractionCache = new LRUCache({ max: 200, ttl: 1000 * 60 * 30 }); // 30 min

// ── Memory Extraction ──────────────────────────────────────────────────────

/**
 * Extract memorable facts from a conversation turn.
 * Called asynchronously after each assistant response (fire-and-forget).
 * 
 * @param {string} ownerId
 * @param {string} userMessage
 * @param {string} assistantResponse
 * @param {number} threadId
 */
async function extractAndStoreMemories(ownerId, userMessage, assistantResponse, threadId) {
  if (!CONFIG.ENABLED || !ownerId || !userMessage) return;

  const cacheKey = `${ownerId}:${userMessage.slice(0, 100)}`;
  if (extractionCache.has(cacheKey)) return;

  try {
    const facts = await extractFacts(userMessage, assistantResponse);
    if (!facts || facts.length === 0) return;

    extractionCache.set(cacheKey, true);

    for (const fact of facts.slice(0, 5)) {
      await upsertMemory(ownerId, fact, threadId);
    }

    logger.info({ ownerId, threadId, factsExtracted: facts.length }, 'Memories extracted');
  } catch (error) {
    logger.warn({ ownerId, error: error.message }, 'Memory extraction failed');
  }
}

/**
 * Use LLM to extract facts from a conversation turn.
 */
async function extractFacts(userMessage, assistantResponse) {
  const prompt = `Analyze this conversation turn and extract memorable facts about the user.

USER: ${userMessage.slice(0, 1000)}
ASSISTANT: ${(assistantResponse || '').slice(0, 500)}

Extract facts in JSON array. Each item has:
- type: "fact" | "preference" | "topic" | "region"
- key: short identifier for deduplication (lowercase, snake_case)
- content: the fact text in Indonesian

Rules:
- Only extract CLEAR, EXPLICIT facts (not guesses)
- "region" type: if user asks about specific kabupaten/kota consistently
- "topic" type: if user shows interest in a specific statistical topic
- "preference" type: if user explicitly states a preference
- "fact" type: other memorable info about user/context
- Return [] if nothing notable

Examples:
- User asks about "data Ternate" → {"type":"region","key":"region_interest","content":"Tertarik dengan data Kota Ternate"}
- User asks "inflasi" multiple topics → {"type":"topic","key":"topic_inflasi","content":"Sering bertanya tentang inflasi"}

Return ONLY valid JSON array, no markdown.`;

  try {
    const _startMs = Date.now();
    const response = await chatCompletion({
      apiKeyEnv: 'OPENAI_API_KEY_CHAT',
      payload: {
        model: CONFIG.EXTRACTION_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: CONFIG.EXTRACTION_TEMPERATURE,
        max_tokens: CONFIG.EXTRACTION_MAX_TOKENS,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'memory_extraction',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                facts: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      type: {
                        type: 'string',
                        enum: ['fact', 'preference', 'topic', 'region'],
                        description: 'Category of the extracted fact',
                      },
                      key: {
                        type: 'string',
                        description: 'Short snake_case identifier for deduplication',
                      },
                      content: {
                        type: 'string',
                        description: 'The fact text in Indonesian',
                      },
                    },
                    required: ['type', 'key', 'content'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['facts'],
              additionalProperties: false,
            },
          },
        },
      },
      timeoutMs: CONFIG.EXTRACTION_TIMEOUT_MS,
      retries: 2,
    });

    // Track cost
    try {
      const { costTracker } = require('../../utils/costTracker');
      if (response.usage) {
        costTracker.record({
          model: CONFIG.EXTRACTION_MODEL,
          usage: response.usage,
          purpose: 'memory_extraction',
          latencyMs: Date.now() - _startMs,
        });
      }
    } catch { /* non-critical */ }

    const text = response.choices?.[0]?.message?.content || '{"facts":[]}';
    const parsed = JSON.parse(text);
    
    // Structured output guarantees the schema, but handle fallback gracefully
    let facts;
    if (parsed.facts && Array.isArray(parsed.facts)) {
      facts = parsed.facts;
    } else if (Array.isArray(parsed)) {
      facts = parsed;
    } else if (parsed.memories) {
      facts = parsed.memories;
    } else if (parsed.type && parsed.key && parsed.content) {
      facts = [parsed];
    } else {
      facts = Object.values(parsed).find(v => Array.isArray(v)) || [];
    }
    return facts.filter(f => f.type && f.key && f.content);
  } catch (error) {
    logger.debug({ error: error.message }, 'LLM extraction failed');
    return [];
  }
}

/**
 * Upsert a memory (create or reinforce existing).
 */
async function upsertMemory(ownerId, fact, threadId) {
  try {
    const existing = await UserMemory.findOne({
      where: { owner_id: ownerId, key: fact.key },
    });

    if (existing) {
      // Reinforce existing memory
      const newConfidence = Math.min(
        existing.confidence + CONFIG.CONFIDENCE_BOOST,
        CONFIG.MAX_CONFIDENCE,
      );
      await existing.update({
        content: fact.content,
        confidence: newConfidence,
        hit_count: existing.hit_count + 1,
        last_accessed_at: new Date(),
      });
      return existing;
    }

    // Create new memory
    const memory = await UserMemory.create({
      owner_id: ownerId,
      type: fact.type || 'fact',
      key: fact.key,
      content: fact.content,
      confidence: 0.7,
      source_thread_id: threadId,
      hit_count: 1,
      last_accessed_at: new Date(),
    });

    // Generate embedding async (don't block)
    generateMemoryEmbedding(memory.id, fact.content).catch(() => {});

    // Enforce per-user limit
    await enforceMemoryLimit(ownerId);

    return memory;
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      // Race condition - another process created it, that's fine
      return null;
    }
    logger.warn({ ownerId, key: fact.key, error: error.message }, 'Failed to upsert memory');
    return null;
  }
}

/**
 * Generate and store embedding for a memory.
 */
async function generateMemoryEmbedding(memoryId, content) {
  try {
    const embedding = await generateEmbedding(content);
    if (embedding) {
      await UserMemory.update(
        { embedding: JSON.stringify(embedding) },
        { where: { id: memoryId } }
      );
    }
  } catch (error) {
    logger.debug({ memoryId, error: error.message }, 'Memory embedding generation failed');
  }
}

// ── Memory Retrieval ───────────────────────────────────────────────────────

/**
 * Retrieve relevant memories for a query using hybrid BM25 + vector search.
 * Injected into the system prompt for personalized responses.
 * 
 * @param {string} ownerId
 * @param {string} query - Current user query
 * @param {Object} options
 * @returns {Array<{type, key, content, score}>}
 */
async function retrieveRelevantMemories(ownerId, query, options = {}) {
  if (!CONFIG.ENABLED || !ownerId) return [];
  const { limit = CONFIG.MAX_MEMORIES_IN_PROMPT, minScore = CONFIG.MIN_RETRIEVAL_SCORE } = options;

  try {
    // Get all user memories (not expired)
    const memories = await UserMemory.findAll({
      where: {
        owner_id: ownerId,
        confidence: { [Op.gte]: CONFIG.MIN_CONFIDENCE },
        [Op.or]: [
          { expires_at: null },
          { expires_at: { [Op.gt]: new Date() } },
        ],
      },
      order: [['hit_count', 'DESC'], ['confidence', 'DESC']],
      limit: 50,
    });

    if (memories.length === 0) return [];

    // BM25 scoring (keyword match)
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    const bm25Scores = memories.map(m => {
      const text = `${m.content} ${m.key}`.toLowerCase();
      let hits = 0;
      for (const term of queryTerms) {
        if (text.includes(term)) hits++;
      }
      return queryTerms.length > 0 ? hits / queryTerms.length : 0;
    });

    // Vector scoring (semantic similarity)
    let vectorScores = memories.map(() => 0);
    try {
      const queryEmbedding = await generateEmbedding(query);
      if (queryEmbedding) {
        vectorScores = memories.map(m => {
          if (!m.embedding) return 0;
          try {
            const emb = JSON.parse(m.embedding);
            return cosineSimilarity(queryEmbedding, emb);
          } catch {
            return 0;
          }
        });
      }
    } catch {
      // Fall back to BM25-only
    }

    // Hybrid scoring
    const scored = memories.map((m, i) => ({
      id: m.id,
      type: m.type,
      key: m.key,
      content: m.content,
      confidence: m.confidence,
      hit_count: m.hit_count,
      score: (CONFIG.BM25_WEIGHT * bm25Scores[i]) + (CONFIG.VECTOR_WEIGHT * vectorScores[i]),
      bm25: bm25Scores[i],
      vector: vectorScores[i],
    }));

    // Filter and sort
    const filtered = scored
      .filter(m => m.score >= minScore || m.type === 'region' || m.type === 'preference')
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Touch last_accessed_at for retrieved memories
    if (filtered.length > 0) {
      const ids = filtered.map(m => m.id);
      UserMemory.update(
        { last_accessed_at: new Date() },
        { where: { id: { [Op.in]: ids } } }
      ).catch(() => {});
    }

    return filtered;
  } catch (error) {
    logger.warn({ ownerId, error: error.message }, 'Memory retrieval failed');
    return [];
  }
}

/**
 * Build a memory context block for injection into the system prompt.
 * 
 * @param {string} ownerId
 * @param {string} query
 * @returns {string|null} - Prompt text or null if no relevant memories
 */
async function buildMemoryContext(ownerId, query) {
  if (!CONFIG.ENABLED) return null;

  const memories = await retrieveRelevantMemories(ownerId, query);
  if (memories.length === 0) return null;

  const lines = memories.map(m => {
    const typeLabel = { fact: '📝', preference: '⚙️', topic: '📊', region: '📍' }[m.type] || '📝';
    return `${typeLabel} ${m.content}`;
  });

  return `MEMORI USER (dari percakapan sebelumnya):
${lines.join('\n')}

Gunakan informasi ini untuk mempersonalisasi jawaban. Misalnya, jika user sering bertanya tentang wilayah tertentu, prioritaskan data wilayah tersebut.`;
}

// ── Memory Management ──────────────────────────────────────────────────────

/**
 * Get all memories for a user.
 */
async function getUserMemories(ownerId) {
  return UserMemory.findAll({
    where: { owner_id: ownerId },
    order: [['hit_count', 'DESC'], ['confidence', 'DESC']],
    attributes: ['id', 'type', 'key', 'content', 'confidence', 'hit_count', 'last_accessed_at', 'created_at'],
  });
}

/**
 * Delete a specific memory.
 */
async function deleteMemory(ownerId, memoryId) {
  return UserMemory.destroy({
    where: { id: memoryId, owner_id: ownerId },
  });
}

/**
 * Clear all memories for a user.
 */
async function clearUserMemories(ownerId) {
  return UserMemory.destroy({
    where: { owner_id: ownerId },
  });
}

/**
 * Enforce maximum memories per user by removing lowest-confidence, oldest.
 */
async function enforceMemoryLimit(ownerId) {
  try {
    const count = await UserMemory.count({ where: { owner_id: ownerId } });
    if (count <= CONFIG.MAX_MEMORIES_PER_USER) return;

    const excess = count - CONFIG.MAX_MEMORIES_PER_USER;
    const toDelete = await UserMemory.findAll({
      where: { owner_id: ownerId },
      order: [['confidence', 'ASC'], ['last_accessed_at', 'ASC']],
      limit: excess,
      attributes: ['id'],
    });

    if (toDelete.length > 0) {
      await UserMemory.destroy({
        where: { id: { [Op.in]: toDelete.map(m => m.id) } },
      });
    }
  } catch (error) {
    logger.debug({ ownerId, error: error.message }, 'Memory limit enforcement failed');
  }
}

/**
 * Clean up expired memories (run periodically).
 */
async function cleanupExpiredMemories() {
  try {
    const deleted = await UserMemory.destroy({
      where: {
        expires_at: { [Op.lt]: new Date() },
      },
    });
    if (deleted > 0) {
      logger.info({ deleted }, 'Expired memories cleaned up');
    }
    return deleted;
  } catch (error) {
    logger.warn({ error: error.message }, 'Memory cleanup failed');
    return 0;
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────

// Cosine similarity from shared utility (canonical location: utils/math.js)
const { cosineSimilarity } = require('../../utils/math');

module.exports = {
  extractAndStoreMemories,
  retrieveRelevantMemories,
  buildMemoryContext,
  getUserMemories,
  deleteMemory,
  clearUserMemories,
  cleanupExpiredMemories,
  enforceMemoryLimit,
  CONFIG,
};
