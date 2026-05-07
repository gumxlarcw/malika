/**
 * Thread Memory Service - Cross-Thread Semantic Search
 * 
 * OpenClaw-inspired feature that enables:
 * 1. Semantic search across user's past conversations
 * 2. Recall previous discussions on similar topics
 * 3. Provide context from past threads for better answers
 */

'use strict';

const ChatThread = require('../../models/ChatThread.model');
const ChatMessage = require('../../models/ChatMessage.model');
const { generateEmbedding, EMBEDDING_DIMENSIONS } = require('../ai/embedding.service');
const { Op } = require('sequelize');
const sequelize = require('../../config/db');
const logger = require('../../utils/logger').child({ service: 'ThreadMemory' });

// Configuration
const MEMORY_CONFIG = {
  MIN_SIMILARITY: 0.55,           // Minimum cosine similarity for match
  MAX_RESULTS: 5,                 // Max threads to return
  EMBEDDING_DIMENSION: EMBEDDING_DIMENSIONS, // from embedding.service (3072)
  INDEX_BATCH_SIZE: 10,           // Threads to index per batch
  SUMMARY_MIN_LENGTH: 50,         // Min summary length to index
};

// Cosine similarity from shared utility (canonical location: utils/math.js)
const { cosineSimilarity } = require('../../utils/math');

/**
 * Detect if query is asking about past conversations
 */
function isPastConversationQuery(query) {
  const patterns = [
    /\b(pernah|sebelumnya|kemarin|lalu|dulu)\b.*\b(tanya|bahas|diskusi|chat)/i,
    /\bhistori(cal)?\s+(chat|percakapan|tanya)/i,
    /\bapa\s+yang\s+(pernah|sudah)\s+(saya|aku)\s+(tanya|bahas)/i,
    /\briwayat\s+(chat|percakapan|tanya)/i,
    /\bingat\s+(percakapan|chat|waktu)\b/i,
    /\b(previous|past)\s+(chat|conversation|question)/i,
    /\bremember\s+when\s+(i|we)\s+(asked|discussed)/i,
  ];
  
  return patterns.some(p => p.test(query));
}

/**
 * Generate embedding for a thread summary
 */
async function generateThreadEmbedding(threadId) {
  try {
    const thread = await ChatThread.findByPk(threadId);
    if (!thread) return null;
    
    // Build searchable text from title + topics + summary
    const parts = [];
    if (thread.title) parts.push(thread.title);
    if (thread.topics && Array.isArray(thread.topics)) {
      parts.push(thread.topics.join(' '));
    }
    if (thread.summary) parts.push(thread.summary);
    
    const text = parts.join(' ').trim();
    if (text.length < MEMORY_CONFIG.SUMMARY_MIN_LENGTH) {
      logger.debug({ threadId, textLength: text.length }, 'Text too short for embedding');
      return null;
    }
    
    // Generate embedding
    const embedding = await generateEmbedding(text.slice(0, 6000)); // Limit input
    
    if (embedding && embedding.length === MEMORY_CONFIG.EMBEDDING_DIMENSION) {
      // Store embedding in thread (as JSON string due to DB limitations)
      await sequelize.query(
        `UPDATE chat_threads SET embedding = ? WHERE id = ?`,
        { replacements: [JSON.stringify(embedding), threadId] }
      );
      
      logger.info({ threadId, textLength: text.length }, 'Thread embedding generated');
      return embedding;
    }
    
    return null;
  } catch (error) {
    logger.error({ threadId, error: error.message }, 'Failed to generate thread embedding');
    return null;
  }
}

/**
 * Search user's past conversations semantically
 */
async function searchUserThreads(ownerId, query, options = {}) {
  const { limit = MEMORY_CONFIG.MAX_RESULTS, minSimilarity = MEMORY_CONFIG.MIN_SIMILARITY } = options;
  
  if (!ownerId || !query) return [];
  
  try {
    // Generate query embedding
    const queryEmbedding = await generateEmbedding(query);
    if (!queryEmbedding) {
      logger.warn('Failed to generate query embedding');
      return [];
    }
    
    // Get user's threads with embeddings
    const [threads] = await sequelize.query(
      `SELECT id, title, topics, summary, embedding, last_message_at 
       FROM chat_threads 
       WHERE owner_id = ? AND embedding IS NOT NULL
       ORDER BY last_message_at DESC
       LIMIT 50`,
      { replacements: [ownerId] }
    );
    
    if (!threads || threads.length === 0) {
      logger.debug({ ownerId }, 'No indexed threads found for user');
      return [];
    }
    
    // Calculate similarities
    const results = [];
    for (const thread of threads) {
      try {
        const embedding = JSON.parse(thread.embedding);
        const similarity = cosineSimilarity(queryEmbedding, embedding);
        
        if (similarity >= minSimilarity) {
          results.push({
            threadId: thread.id,
            title: thread.title,
            topics: thread.topics,
            summary: thread.summary?.slice(0, 300) + (thread.summary?.length > 300 ? '...' : ''),
            similarity,
            lastMessageAt: thread.last_message_at,
          });
        }
      } catch {
        // Skip threads with invalid embeddings
      }
    }
    
    // Sort by similarity descending
    results.sort((a, b) => b.similarity - a.similarity);
    
    logger.info({
      ownerId,
      query: query.slice(0, 50),
      threadsSearched: threads.length,
      matchesFound: results.length,
    }, 'Thread memory search completed');
    
    return results.slice(0, limit);
  } catch (error) {
    logger.error({ ownerId, error: error.message }, 'Thread memory search failed');
    return [];
  }
}

/**
 * Get context from past similar conversations
 * Used to enhance current conversation with relevant past context
 */
async function getRelevantPastContext(ownerId, query, currentThreadId) {
  if (!ownerId || !query) return null;
  
  try {
    const matches = await searchUserThreads(ownerId, query, { limit: 3 });
    
    // Filter out current thread
    const filtered = matches.filter(m => m.threadId !== currentThreadId);
    
    if (filtered.length === 0) return null;
    
    const top = filtered[0];
    if (top.similarity < 0.60) return null; // Only use high-confidence matches
    
    return {
      threadId: top.threadId,
      title: top.title,
      summary: top.summary,
      similarity: top.similarity,
    };
  } catch (error) {
    logger.error({ ownerId, error: error.message }, 'Failed to get past context');
    return null;
  }
}

/**
 * Index threads that don't have embeddings yet
 * Run periodically or after compaction
 */
async function indexUnindexedThreads(limit = MEMORY_CONFIG.INDEX_BATCH_SIZE) {
  try {
    // Find threads with summary but no embedding
    const [threads] = await sequelize.query(
      `SELECT id FROM chat_threads 
       WHERE summary IS NOT NULL 
       AND LENGTH(summary) > 50
       AND (embedding IS NULL OR embedding = '')
       LIMIT ?`,
      { replacements: [limit] }
    );
    
    if (!threads || threads.length === 0) {
      return { indexed: 0 };
    }
    
    let indexed = 0;
    for (const thread of threads) {
      const result = await generateThreadEmbedding(thread.id);
      if (result) indexed++;
    }
    
    logger.info({ found: threads.length, indexed }, 'Thread indexing batch completed');
    return { indexed, found: threads.length };
  } catch (error) {
    logger.error({ error: error.message }, 'Thread indexing failed');
    return { indexed: 0, error: error.message };
  }
}

/**
 * Get user's conversation statistics
 */
async function getUserConversationStats(ownerId) {
  if (!ownerId) return null;
  
  try {
    const [stats] = await sequelize.query(
      `SELECT 
         COUNT(*) as totalThreads,
         SUM(CASE WHEN summary IS NOT NULL THEN 1 ELSE 0 END) as withSummary,
         SUM(CASE WHEN embedding IS NOT NULL AND embedding != '' THEN 1 ELSE 0 END) as indexed
       FROM chat_threads 
       WHERE owner_id = ?`,
      { replacements: [ownerId] }
    );
    
    // Get topic frequency
    const [topTopics] = await sequelize.query(
      `SELECT topics FROM chat_threads WHERE owner_id = ? AND topics IS NOT NULL`,
      { replacements: [ownerId] }
    );
    
    const topicCounts = {};
    for (const row of topTopics) {
      try {
        const topics = typeof row.topics === 'string' ? JSON.parse(row.topics) : row.topics;
        if (Array.isArray(topics)) {
          for (const topic of topics) {
            topicCounts[topic] = (topicCounts[topic] || 0) + 1;
          }
        }
      } catch {
        // Skip invalid JSON
      }
    }
    
    const sortedTopics = Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic, count]) => ({ topic, count }));
    
    return {
      ...stats[0],
      topTopics: sortedTopics,
    };
  } catch (error) {
    logger.error({ ownerId, error: error.message }, 'Failed to get user stats');
    return null;
  }
}

module.exports = {
  isPastConversationQuery,
  searchUserThreads,
  getRelevantPastContext,
  generateThreadEmbedding,
  indexUnindexedThreads,
  getUserConversationStats,
  MEMORY_CONFIG,
};
