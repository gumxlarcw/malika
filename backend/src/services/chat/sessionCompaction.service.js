/**
 * Session Compaction Service (OpenClaw-inspired)
 * 
 * Compacts long conversation threads by summarizing older messages
 * into a concise summary, then deleting the originals. This keeps
 * context windows manageable while preserving important information.
 * 
 * Flow:
 * 1. Triggered when message count exceeds COMPACTION.TRIGGER_AFTER
 * 2. Takes the oldest N messages (COMPACTION.SUMMARIZE_COUNT)
 * 3. Sends to LLM for summarization
 * 4. Stores summary as a system message at the beginning
 * 5. Deletes the original summarized messages
 * 6. Updates thread.summary for cross-thread memory search
 * 7. Generates thread embedding for semantic search
 */

'use strict';

const ChatThread = require('../../models/ChatThread.model');
const ChatMessage = require('../../models/ChatMessage.model');
const { COMPACTION } = require('./streaming/config');
const { generateEmbedding } = require('../ai/embedding.service');
const { now } = require('../../utils/dateHelper');
const { Op } = require('sequelize');
const sequelize = require('../../config/db');
const logger = require('../../utils/logger').child({ service: 'SessionCompaction' });
const requestContext = require('./streaming/requestContext');
const { chatCompletion } = require('../ai/client/openaiClient');

// Track in-flight compactions to avoid double-compaction
const compactingThreads = new Set();

// ── Core Compaction Logic ──────────────────────────────────────────────────

/**
 * Check if a thread needs compaction and run if so.
 * Called after each assistant message save (fire-and-forget).
 * 
 * @param {number} threadId
 * @returns {Promise<{compacted: boolean, messagesSummarized?: number}>}
 */
async function maybeCompactThread(threadId) {
  if (!COMPACTION.ENABLED) return { compacted: false };
  if (compactingThreads.has(threadId)) return { compacted: false };

  try {
    // Check message count
    const messageCount = await ChatMessage.count({ where: { thread_id: threadId } });
    if (messageCount < COMPACTION.TRIGGER_AFTER) {
      return { compacted: false };
    }

    compactingThreads.add(threadId);
    return await compactThread(threadId);
  } catch (error) {
    logger.error({ threadId, error: error.message }, 'Compaction check failed');
    return { compacted: false, error: error.message };
  } finally {
    compactingThreads.delete(threadId);
  }
}

/**
 * Compact a thread by summarizing oldest messages.
 */
async function compactThread(threadId) {
  const t = await sequelize.transaction();

  try {
    // Get all messages for the thread
    const allMessages = await ChatMessage.findAll({
      where: { thread_id: threadId },
      order: [['id', 'ASC']],
      transaction: t,
    });

    if (allMessages.length < COMPACTION.TRIGGER_AFTER) {
      await t.rollback();
      return { compacted: false };
    }

    // Separate: find existing summary message (role=system) vs conversation messages
    const existingSummaryIdx = allMessages.findIndex(m => 
      m.role === 'system' && m.content?.startsWith('[RINGKASAN PERCAKAPAN')
    );
    const existingSummary = existingSummaryIdx >= 0 ? allMessages[existingSummaryIdx] : null;
    
    // Non-system messages
    const conversationMsgs = allMessages.filter(m => 
      m.role !== 'system' || !m.content?.startsWith('[RINGKASAN PERCAKAPAN')
    );

    // Take oldest N messages to summarize (leave recent ones intact)
    const toSummarize = conversationMsgs.slice(0, COMPACTION.SUMMARIZE_COUNT);
    const keepMessages = conversationMsgs.slice(COMPACTION.SUMMARIZE_COUNT);

    if (toSummarize.length < 5) {
      await t.rollback();
      return { compacted: false };
    }

    // Build conversation text for summarization
    const conversationText = toSummarize.map(m => {
      const role = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Malika' : 'System';
      return `${role}: ${m.content?.slice(0, 500) || ''}`;
    }).join('\n');

    // Existing summary context (if any)
    const priorSummary = existingSummary?.content || '';

    // Generate summary via LLM
    const summary = await generateSummary(conversationText, priorSummary);
    if (!summary) {
      await t.rollback();
      return { compacted: false, error: 'LLM summarization failed' };
    }

    const summaryContent = `[RINGKASAN PERCAKAPAN SEBELUMNYA]\n${summary}`;

    // Upsert summary message
    if (existingSummary) {
      await ChatMessage.update(
        { content: summaryContent },
        { where: { id: existingSummary.id }, transaction: t }
      );
    } else {
      // Insert summary as first message (minimal ID)
      await ChatMessage.create({
        thread_id: threadId,
        role: 'system',
        content: summaryContent,
        created_at: now(),
      }, { transaction: t });
    }

    // Delete summarized messages
    if (COMPACTION.DELETE_AFTER_COMPACT) {
      const idsToDelete = toSummarize.map(m => m.id);
      await ChatMessage.destroy({
        where: { id: { [Op.in]: idsToDelete } },
        transaction: t,
      });
    }

    // Update thread summary for cross-thread search
    const thread = await ChatThread.findByPk(threadId, { transaction: t });
    if (thread) {
      await thread.update({
        summary: summary.slice(0, 10000),
        updated_at: now(),
      }, { transaction: t });
    }

    await t.commit();

    // Generate thread embedding async (for cross-thread memory search)
    generateThreadEmbedding(threadId, summary).catch(() => {});

    logger.info({
      threadId,
      summarized: toSummarize.length,
      kept: keepMessages.length,
      summaryLength: summary.length,
    }, 'Thread compacted successfully');

    return {
      compacted: true,
      messagesSummarized: toSummarize.length,
      messagesKept: keepMessages.length,
      summaryLength: summary.length,
    };
  } catch (error) {
    await t.rollback();
    logger.error({ threadId, error: error.message }, 'Thread compaction failed');
    return { compacted: false, error: error.message };
  }
}

// ── LLM Summarization ──────────────────────────────────────────────────────

/**
 * Generate a conversation summary using LLM.
 */
async function generateSummary(conversationText, priorSummary = '') {
  const priorBlock = priorSummary
    ? `\nRINGKASAN SEBELUMNYA:\n${priorSummary}\n`
    : '';

  const prompt = `Ringkas percakapan berikut menjadi ringkasan singkat yang mempertahankan:
1. Topik/data yang dibahas dan hasilnya
2. Angka/fakta statistik yang disebutkan
3. Wilayah/periode yang dicari user
4. Preferensi atau pola user (e.g., sering tanya inflasi)
5. Hal-hal yang belum terjawab/perlu follow-up

${priorBlock}
PERCAKAPAN:
${conversationText.slice(0, 6000)}

Tulis ringkasan dalam format poin-poin bahasa Indonesia. Maksimal 400 kata.
Fokus pada FAKTA dan ANGKA, bukan proses percakapan.`;

  try {
    const response = await chatCompletion({
      apiKeyEnv: 'OPENAI_API_KEY_CHAT',
      payload: {
        model: requestContext.getModelOverride() || COMPACTION.MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: COMPACTION.TEMPERATURE,
        max_tokens: COMPACTION.MAX_TOKENS,
      },
      timeoutMs: COMPACTION.TIMEOUT_MS,
      retries: 2,
    });

    return response.choices?.[0]?.message?.content || null;
  } catch (error) {
    logger.error({ error: error.message }, 'Summary generation failed');
    return null;
  }
}

/**
 * Generate embedding for thread summary (for cross-thread search).
 */
async function generateThreadEmbedding(threadId, summaryText) {
  try {
    const thread = await ChatThread.findByPk(threadId);
    if (!thread) return;

    const textForEmbed = [
      thread.title || '',
      Array.isArray(thread.topics) ? thread.topics.join(' ') : '',
      summaryText || thread.summary || '',
    ].join(' ').trim();

    if (textForEmbed.length < 30) return;

    const embedding = await generateEmbedding(textForEmbed.slice(0, 6000));
    if (embedding) {
      await sequelize.query(
        'UPDATE chat_threads SET embedding = ? WHERE id = ?',
        { replacements: [JSON.stringify(embedding), threadId] }
      );
    }
  } catch (error) {
    logger.debug({ threadId, error: error.message }, 'Thread embedding failed');
  }
}

// ── Load Compacted Context ─────────────────────────────────────────────────

/**
 * Load conversation history with compaction awareness.
 * Returns the summary + recent messages, or all messages if no compaction.
 * 
 * @param {number} threadId
 * @param {number} recentLimit - Number of recent messages to include
 * @returns {Array<{role, content}>}
 */
async function loadCompactedHistory(threadId, recentLimit = 20) {
  const messages = await ChatMessage.findAll({
    where: { thread_id: threadId },
    order: [['id', 'ASC']],
    attributes: ['id', 'role', 'content', 'created_at'],
  });

  // Find summary message
  const summaryMsg = messages.find(m => 
    m.role === 'system' && m.content?.startsWith('[RINGKASAN PERCAKAPAN')
  );

  const conversationMsgs = messages.filter(m =>
    m.role !== 'system' || !m.content?.startsWith('[RINGKASAN PERCAKAPAN')
  );

  const result = [];

  // Include summary if present
  if (summaryMsg) {
    result.push({
      role: 'system',
      content: summaryMsg.content,
    });
  }

  // Include recent messages
  const recent = conversationMsgs.slice(-recentLimit);
  for (const m of recent) {
    result.push({ role: m.role, content: m.content });
  }

  return result;
}

// ── Batch Compaction ───────────────────────────────────────────────────────

/**
 * Find and compact threads that exceed the message limit.
 * Run periodically (e.g., daily cron).
 */
async function compactOldThreads(limit = 10) {
  try {
    const [threads] = await sequelize.query(
      `SELECT t.id, COUNT(m.id) as msg_count
       FROM chat_threads t
       JOIN chat_messages m ON m.thread_id = t.id
       GROUP BY t.id
       HAVING msg_count >= ?
       ORDER BY msg_count DESC
       LIMIT ?`,
      { replacements: [COMPACTION.TRIGGER_AFTER, limit] }
    );

    let compacted = 0;
    for (const thread of threads) {
      const result = await maybeCompactThread(thread.id);
      if (result.compacted) compacted++;
    }

    logger.info({ found: threads.length, compacted }, 'Batch compaction completed');
    return { found: threads.length, compacted };
  } catch (error) {
    logger.error({ error: error.message }, 'Batch compaction failed');
    return { found: 0, compacted: 0, error: error.message };
  }
}

module.exports = {
  maybeCompactThread,
  compactThread,
  loadCompactedHistory,
  compactOldThreads,
  generateThreadEmbedding,
};
