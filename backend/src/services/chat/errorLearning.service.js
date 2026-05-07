/**
 * Error Learning Service
 * Analyzes flagged messages, identifies patterns, and provides fixes
 */

const ChatMessageFlag = require('../../models/ChatMessageFlag.model');
const ChatErrorPattern = require('../../models/ChatErrorPattern.model');
const ChatMessage = require('../../models/ChatMessage.model');
const KnowledgeBase = require('../../models/KnowledgeBase.model');
const { generateEmbedding } = require('../ai/embedding.service');
const { Op, Sequelize } = require('sequelize');

/**
 * Flag a problematic message for review
 * @param {object} params
 * @returns {Promise<object>}
 */
async function flagMessage({
  messageId,
  threadId,
  flagType,
  severity = 'medium',
  flaggedBy = 'user',
  ownerId = null,
  userQuery = null,
  assistantResponse = null,
  expectedResponse = null,
  contextSnapshot = null,
}) {
  try {
    // Check if already flagged
    const existing = await ChatMessageFlag.findOne({
      where: { message_id: messageId, flag_type: flagType },
    });

    if (existing) {
      // Update severity if higher
      const severityOrder = ['low', 'medium', 'high', 'critical'];
      if (severityOrder.indexOf(severity) > severityOrder.indexOf(existing.severity)) {
        await existing.update({ severity });
      }
      return { ok: true, flag: existing, updated: true };
    }

    // Get user query if not provided
    if (!userQuery && messageId) {
      const msg = await ChatMessage.findByPk(messageId);
      if (msg && msg.role === 'assistant') {
        // Find previous user message
        const prevUserMsg = await ChatMessage.findOne({
          where: {
            thread_id: msg.thread_id,
            id: { [Op.lt]: msg.id },
            role: 'user',
          },
          order: [['id', 'DESC']],
        });
        if (prevUserMsg) userQuery = prevUserMsg.content;
        assistantResponse = msg.content;
        threadId = msg.thread_id;
      }
    }

    const flag = await ChatMessageFlag.create({
      message_id: messageId,
      thread_id: threadId,
      flag_type: flagType,
      severity,
      flagged_by: flaggedBy,
      owner_id: ownerId,
      user_query: userQuery,
      assistant_response: assistantResponse,
      expected_response: expectedResponse,
      context_snapshot: contextSnapshot,
      resolution_status: 'pending',
    });

    // Try to match existing error patterns
    await matchToPatterns(flag);

    return { ok: true, flag, created: true };
  } catch (error) {
    console.error('[ErrorLearning] flagMessage error:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Parse trigger_keywords which may be JSON string or array
 */
function parseKeywords(keywords) {
  if (!keywords) return [];
  if (Array.isArray(keywords)) return keywords;
  if (typeof keywords === 'string') {
    try {
      const parsed = JSON.parse(keywords);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Match a flag to existing error patterns
 */
async function matchToPatterns(flag) {
  try {
    const patterns = await ChatErrorPattern.findAll({
      where: { is_active: true },
    });

    const query = String(flag.user_query || '').toLowerCase();

    for (const pattern of patterns) {
      let matched = false;

      // Parse and check keyword match
      const keywords = parseKeywords(pattern.trigger_keywords);
      for (const kw of keywords) {
        if (query.includes(String(kw).toLowerCase())) {
          matched = true;
          break;
        }
      }

      // Check regex match
      if (!matched && pattern.trigger_regex) {
        try {
          const regex = new RegExp(pattern.trigger_regex, 'i');
          if (regex.test(query)) matched = true;
        } catch { /* invalid regex */ }
      }

      if (matched) {
        // Increment occurrence count
        await pattern.update({
          occurrence_count: pattern.occurrence_count + 1,
          last_occurrence_at: new Date(),
        });

        console.log(`[ErrorLearning] Flag ${flag.id} matched pattern: ${pattern.pattern_name}`);
      }
    }
  } catch (error) {
    console.error('[ErrorLearning] matchToPatterns error:', error);
  }
}

/**
 * Analyze flagged messages and identify common patterns
 * @returns {Promise<object>}
 */
async function analyzeFlags() {
  try {
    // Get pending flags
    const flags = await ChatMessageFlag.findAll({
      where: { resolution_status: 'pending' },
      order: [['created_at', 'DESC']],
      limit: 100,
    });

    // Group by flag_type
    const byType = {};
    for (const flag of flags) {
      if (!byType[flag.flag_type]) byType[flag.flag_type] = [];
      byType[flag.flag_type].push(flag);
    }

    // Find common keywords in each type
    const analysis = {};
    for (const [type, typeFlags] of Object.entries(byType)) {
      const allQueries = typeFlags.map(f => String(f.user_query || '')).join(' ');
      const words = allQueries.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      
      // Count word frequency
      const wordCount = {};
      for (const word of words) {
        wordCount[word] = (wordCount[word] || 0) + 1;
      }

      // Sort by frequency
      const topWords = Object.entries(wordCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([word, count]) => ({ word, count }));

      analysis[type] = {
        count: typeFlags.length,
        topKeywords: topWords,
        sampleQueries: typeFlags.slice(0, 3).map(f => f.user_query),
      };
    }

    return {
      ok: true,
      totalPending: flags.length,
      byType: analysis,
    };
  } catch (error) {
    console.error('[ErrorLearning] analyzeFlags error:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Create a new error pattern from flagged messages
 * @param {object} params
 * @returns {Promise<object>}
 */
async function createPattern({
  patternName,
  patternType,
  triggerKeywords = [],
  triggerRegex = null,
  errorDescription,
  fixType,
  fixContent = null,
}) {
  try {
    const pattern = await ChatErrorPattern.create({
      pattern_name: patternName,
      pattern_type: patternType,
      trigger_keywords: triggerKeywords,
      trigger_regex: triggerRegex,
      error_description: errorDescription,
      fix_type: fixType,
      fix_content: fixContent,
      occurrence_count: 0,
      is_active: true,
    });

    return { ok: true, pattern };
  } catch (error) {
    console.error('[ErrorLearning] createPattern error:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Get active fixes to inject into system prompt based on user query
 * Only returns fixes for patterns that match the query keywords/regex
 * @param {string} userQuery - The user's query to match against patterns
 * @returns {Promise<string[]>}
 */
async function getPromptFixes(userQuery = '') {
  try {
    const patterns = await ChatErrorPattern.findAll({
      where: {
        is_active: true,
        fix_type: 'add_to_prompt',
        fix_content: { [Op.ne]: null },
      },
      order: [['occurrence_count', 'DESC']],
    });

    const q = String(userQuery || '').toLowerCase();
    const matchedFixes = [];

    for (const pattern of patterns) {
      let matched = false;

      // Parse and check keyword match
      const keywords = parseKeywords(pattern.trigger_keywords);
      for (const kw of keywords) {
        if (q.includes(String(kw).toLowerCase())) {
          matched = true;
          break;
        }
      }

      // Check regex match (only if not already matched by keyword)
      if (!matched && pattern.trigger_regex) {
        try {
          const regex = new RegExp(pattern.trigger_regex, 'i');
          if (regex.test(q)) matched = true;
        } catch { /* invalid regex, skip */ }
      }

      if (matched) {
        matchedFixes.push(pattern.fix_content);
        // Log for debugging
        console.log(`[ErrorLearning] Query matched pattern: ${pattern.pattern_name}`);
      }
    }

    return matchedFixes;
  } catch (error) {
    console.error('[ErrorLearning] getPromptFixes error:', error);
    return [];
  }
}

/**
 * Check if query matches known error patterns and get special handling
 * @param {string} query
 * @returns {Promise<object|null>}
 */
async function checkQueryPattern(query) {
  try {
    const patterns = await ChatErrorPattern.findAll({
      where: {
        is_active: true,
        fix_type: 'special_handling',
      },
    });

    const q = String(query || '').toLowerCase();

    for (const pattern of patterns) {
      let matched = false;

      // Parse and check keyword match
      const keywords = parseKeywords(pattern.trigger_keywords);
      for (const kw of keywords) {
        if (q.includes(String(kw).toLowerCase())) {
          matched = true;
          break;
        }
      }

      if (!matched && pattern.trigger_regex) {
        try {
          const regex = new RegExp(pattern.trigger_regex, 'i');
          if (regex.test(q)) matched = true;
        } catch { /* invalid regex */ }
      }

      if (matched) {
        return {
          patternId: pattern.id,
          patternName: pattern.pattern_name,
          fixContent: pattern.fix_content,
          errorDescription: pattern.error_description,
        };
      }
    }

    return null;
  } catch (error) {
    console.error('[ErrorLearning] checkQueryPattern error:', error);
    return null;
  }
}

/**
 * Add correction to knowledge base automatically
 * @param {number} flagId
 * @param {string} correctionText
 * @returns {Promise<object>}
 */
async function addToKnowledgeBase(flagId, correctionText) {
  try {
    const flag = await ChatMessageFlag.findByPk(flagId);
    if (!flag) {
      return { ok: false, error: 'Flag not found' };
    }

    // Create knowledge base entry
    const title = `Koreksi: ${flag.user_query?.slice(0, 100) || 'Pertanyaan tanpa judul'}`;
    
    const kb = await KnowledgeBase.create({
      title,
      description: `Auto-generated dari flag ID ${flagId}`,
      category: 'koreksi',
      source_type: 'text',
      content: correctionText,
      content_length: correctionText.length,
      status: 'pending',
    });

    // Generate embedding
    try {
      const embedding = await generateEmbedding(`${title}. ${correctionText}`);
      await kb.update({
        embedding: JSON.stringify(embedding),
        embedding_updated_at: new Date(),
        status: 'ready',
      });
    } catch (e) {
      console.warn('[ErrorLearning] Embedding failed:', e.message);
    }

    // Update flag status
    await flag.update({
      resolution_status: 'training_added',
      resolved_at: new Date(),
    });

    return { ok: true, knowledgeId: kb.id };
  } catch (error) {
    console.error('[ErrorLearning] addToKnowledgeBase error:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Get dashboard stats for error tracking
 * @returns {Promise<object>}
 */
async function getStats() {
  try {
    const [
      totalFlags,
      pendingFlags,
      byType,
      byStatus,
      recentFlags,
      topPatterns,
    ] = await Promise.all([
      ChatMessageFlag.count(),
      ChatMessageFlag.count({ where: { resolution_status: 'pending' } }),
      ChatMessageFlag.findAll({
        attributes: [
          'flag_type',
          [Sequelize.fn('COUNT', '*'), 'count'],
        ],
        group: ['flag_type'],
      }),
      ChatMessageFlag.findAll({
        attributes: [
          'resolution_status',
          [Sequelize.fn('COUNT', '*'), 'count'],
        ],
        group: ['resolution_status'],
      }),
      ChatMessageFlag.findAll({
        order: [['created_at', 'DESC']],
        limit: 10,
      }),
      ChatErrorPattern.findAll({
        where: { is_active: true },
        order: [['occurrence_count', 'DESC']],
        limit: 10,
      }),
    ]);

    return {
      ok: true,
      stats: {
        totalFlags,
        pendingFlags,
        byType: byType.reduce((acc, r) => {
          acc[r.flag_type] = parseInt(r.get('count'), 10);
          return acc;
        }, {}),
        byStatus: byStatus.reduce((acc, r) => {
          acc[r.resolution_status] = parseInt(r.get('count'), 10);
          return acc;
        }, {}),
        recentFlags: recentFlags.map(f => ({
          id: f.id,
          flagType: f.flag_type,
          severity: f.severity,
          userQuery: f.user_query?.slice(0, 100),
          status: f.resolution_status,
          createdAt: f.created_at,
        })),
        topPatterns: topPatterns.map(p => ({
          id: p.id,
          name: p.pattern_name,
          type: p.pattern_type,
          occurrences: p.occurrence_count,
          fixType: p.fix_type,
        })),
      },
    };
  } catch (error) {
    console.error('[ErrorLearning] getStats error:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Resolve a flag with resolution notes
 * @param {number} flagId
 * @param {object} resolution
 * @returns {Promise<object>}
 */
async function resolveFlag(flagId, { status, notes, resolvedBy }) {
  try {
    const flag = await ChatMessageFlag.findByPk(flagId);
    if (!flag) {
      return { ok: false, error: 'Flag not found' };
    }

    await flag.update({
      resolution_status: status,
      correction_notes: notes,
      resolved_by: resolvedBy,
      resolved_at: new Date(),
    });

    return { ok: true, flag };
  } catch (error) {
    console.error('[ErrorLearning] resolveFlag error:', error);
    return { ok: false, error: error.message };
  }
}

module.exports = {
  flagMessage,
  analyzeFlags,
  createPattern,
  getPromptFixes,
  checkQueryPattern,
  addToKnowledgeBase,
  getStats,
  resolveFlag,
};
