/**
 * Error Learning Service
 * Analyzes flagged messages, identifies patterns, and provides fixes
 */

const ChatMessageFlag = require('../../models/ChatMessageFlag.model');
const ChatErrorPattern = require('../../models/ChatErrorPattern.model');
const ChatMessage = require('../../models/ChatMessage.model');
const KnowledgeBase = require('../../models/KnowledgeBase.model');
const { processEmbeddings } = require('../ai/knowledgeDoc.service');
const { Op, Sequelize } = require('sequelize');
const { GEO_FRAGMENT_WORDS, KNOWN_GEO } = require('../../utils/geoAnalysis');

// Province + kab/kota names, their word components, and abbreviations. Excluded
// from keyword-frequency clouds so place names (which appear in almost every BPS
// query) don't drown out the statistical topic that actually characterizes a
// flag cluster. Single source of truth: shared/geo-regions.json via geoAnalysis.
const GEO_EXCLUDE_WORDS = new Set([...GEO_FRAGMENT_WORDS, ...KNOWN_GEO]);

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

const DRAFT_TEMPLATES = {
  hallucination: {
    fix_type: 'add_to_prompt',
    fix_content: "JANGAN mengarang data. Jika data tidak tersedia untuk pertanyaan ini, katakan eksplisit: 'Data tersebut belum tersedia di sistem MALIKA.'",
  },
  incomplete: {
    fix_type: 'add_to_prompt',
    fix_content: "Berikan jawaban LENGKAP: data spesifik dengan angka, periode/tahun, dan sumber. Hindari jawaban satu baris.",
  },
  context_lost: {
    fix_type: 'special_handling',
    fix_content: "Pengguna sedang melanjutkan diskusi sebelumnya. Tetap fokus pada topik yang sama dan jangan ganti subjek.",
  },
  irrelevant: {
    fix_type: 'special_handling',
    fix_content: "Pertanyaan ini tidak terkait dengan lingkup MALIKA (statistik BPS Maluku Utara). Arahkan pengguna ke topik yang relevan.",
  },
};

const MIN_CLUSTER_SIZE_FOR_DRAFT = 2;

function composeDraftPattern(flagType, cluster) {
  const template = DRAFT_TEMPLATES[flagType];
  if (!template) return null;
  if (cluster.count < MIN_CLUSTER_SIZE_FOR_DRAFT) return null;
  const topKw = (cluster.topKeywords || []).slice(0, 6).map(k => k.word);
  if (topKw.length === 0) return null;
  return {
    pattern_name: `Auto: ${flagType} cluster — '${topKw[0]}'`,
    pattern_type: 'query_pattern',
    trigger_keywords: topKw,
    error_description: `Auto-generated draft from ${cluster.count} pending ${flagType} flags. Top keywords: ${topKw.slice(0,3).join(', ')}.`,
    fix_type: template.fix_type,
    fix_content: template.fix_content,
  };
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
      const words = allQueries
        .toLowerCase()
        .split(/\s+/)
        .map(w => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')) // strip surrounding punctuation
        .filter(w => w.length > 3 && !GEO_EXCLUDE_WORDS.has(w));
      
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
      const draft = composeDraftPattern(type, analysis[type]);
      if (draft) analysis[type].suggestedDraft = draft;
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

    // Embed via xenova → retrieval_chunks (Phase C unified store).
    // processEmbeddings handles status lifecycle (processing → ready/error)
    // and DELETE+INSERTs into retrieval_chunks with source_kind='knowledge_doc'.
    await processEmbeddings([kb.id]);

    // Re-read to check final status set by processEmbeddings.
    await kb.reload();
    if (kb.status !== 'ready') {
      console.warn(`[ErrorLearning] embed failed for flag=${flagId} kb=${kb.id}:`, kb.error_message);
      return { ok: false, error: `Indexing failed: ${kb.error_message || 'unknown error'}`, knowledgeId: kb.id };
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
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [
      totalFlags,
      pendingFlags,
      recentFlagsCount,
      byTypeRows,
      byStatusRows,
      bySeverityRows,
      totalPatterns,
      activePatterns,
    ] = await Promise.all([
      ChatMessageFlag.count(),
      ChatMessageFlag.count({ where: { resolution_status: 'pending' } }),
      ChatMessageFlag.count({ where: { created_at: { [Op.gte]: sevenDaysAgo } } }),
      ChatMessageFlag.findAll({
        attributes: ['flag_type', [Sequelize.fn('COUNT', '*'), 'count']],
        group: ['flag_type'],
      }),
      ChatMessageFlag.findAll({
        attributes: ['resolution_status', [Sequelize.fn('COUNT', '*'), 'count']],
        group: ['resolution_status'],
      }),
      ChatMessageFlag.findAll({
        attributes: ['severity', [Sequelize.fn('COUNT', '*'), 'count']],
        group: ['severity'],
      }),
      ChatErrorPattern.count(),
      ChatErrorPattern.count({ where: { is_active: true } }),
    ]);

    const tally = (rows, key) => rows.reduce((acc, r) => {
      acc[r[key]] = parseInt(r.get('count'), 10);
      return acc;
    }, {});

    return {
      totalFlags,
      pendingFlags,
      recentFlags: recentFlagsCount,
      byType: tally(byTypeRows, 'flag_type'),
      byStatus: tally(byStatusRows, 'resolution_status'),
      bySeverity: tally(bySeverityRows, 'severity'),
      totalPatterns,
      activePatterns,
    };
  } catch (error) {
    console.error('[ErrorLearning] getStats error:', error);
    throw error;
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
