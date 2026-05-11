/**
 * Error Learning Controller
 * API endpoints for flagging problematic messages and managing error patterns
 */

const errorLearningService = require('../services/chat/errorLearning.service');
const ChatMessageFlag = require('../models/ChatMessageFlag.model');
const ChatErrorPattern = require('../models/ChatErrorPattern.model');

/**
 * Flag a problematic message (public - user can flag)
 */
async function flagMessage(req, res) {
  try {
    const { message_id, thread_id, flag_type, expected_response } = req.body;
    const ownerId = req.headers['x-malika-uid'] || null;

    if (!message_id || !flag_type) {
      return res.status(400).json({ ok: false, error: 'message_id and flag_type required' });
    }

    const validTypes = [
      'hallucination', 'wrong_data', 'irrelevant', 'incomplete',
      'formatting_issue', 'context_lost', 'wrong_source', 'other'
    ];
    if (!validTypes.includes(flag_type)) {
      return res.status(400).json({ ok: false, error: `Invalid flag_type. Valid: ${validTypes.join(', ')}` });
    }

    const result = await errorLearningService.flagMessage({
      messageId: message_id,
      threadId: thread_id,
      flagType: flag_type,
      severity: 'medium',
      flaggedBy: 'user',
      ownerId,
      expectedResponse: expected_response,
    });

    return res.json(result);
  } catch (error) {
    console.error('[ErrorLearning] flagMessage error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

/**
 * Get error tracking stats (admin)
 */
async function getStats(req, res) {
  try {
    const result = await errorLearningService.getStats();
    return res.json(result);
  } catch (error) {
    console.error('[ErrorLearning] getStats error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

/**
 * Analyze pending flags and find patterns (admin)
 */
async function analyzeFlags(req, res) {
  try {
    const result = await errorLearningService.analyzeFlags();
    return res.json(result);
  } catch (error) {
    console.error('[ErrorLearning] analyzeFlags error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

/**
 * List all flags with pagination (admin)
 */
async function listFlags(req, res) {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const status = req.query.status || null;
    const flagType = req.query.flag_type || req.query.type || null;
    const severity = req.query.severity || null;

    const where = {};
    if (status) where.resolution_status = status;
    if (flagType) where.flag_type = flagType;
    if (severity) where.severity = severity;

    const { rows, count } = await ChatMessageFlag.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      offset: (page - 1) * limit,
      limit,
    });

    return res.json({
      ok: true,
      flags: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    });
  } catch (error) {
    console.error('[ErrorLearning] listFlags error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

/**
 * Resolve a flag (admin)
 */
async function resolveFlag(req, res) {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const resolvedBy = req.user?.id || null;

    if (!status) {
      return res.status(400).json({ ok: false, error: 'status required' });
    }

    const result = await errorLearningService.resolveFlag(id, {
      status,
      notes,
      resolvedBy,
    });

    return res.json(result);
  } catch (error) {
    console.error('[ErrorLearning] resolveFlag error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

/**
 * Create an error pattern (admin)
 */
async function createPattern(req, res) {
  try {
    const {
      pattern_name,
      pattern_type,
      trigger_keywords,
      trigger_regex,
      error_description,
      fix_type,
      fix_content,
    } = req.body;

    if (!pattern_name || !pattern_type || !error_description || !fix_type) {
      return res.status(400).json({
        ok: false,
        error: 'pattern_name, pattern_type, error_description, and fix_type required',
      });
    }

    const result = await errorLearningService.createPattern({
      patternName: pattern_name,
      patternType: pattern_type,
      triggerKeywords: trigger_keywords || [],
      triggerRegex: trigger_regex,
      errorDescription: error_description,
      fixType: fix_type,
      fixContent: fix_content,
    });

    return res.json(result);
  } catch (error) {
    console.error('[ErrorLearning] createPattern error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

/**
 * List all error patterns (admin)
 */
async function listPatterns(req, res) {
  try {
    const patterns = await ChatErrorPattern.findAll({
      order: [['occurrence_count', 'DESC']],
    });

    return res.json({ ok: true, patterns });
  } catch (error) {
    console.error('[ErrorLearning] listPatterns error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

/**
 * Update an error pattern (admin)
 */
async function updatePattern(req, res) {
  try {
    const { id } = req.params;
    const updates = req.body;

    const pattern = await ChatErrorPattern.findByPk(id);
    if (!pattern) {
      return res.status(404).json({ ok: false, error: 'Pattern not found' });
    }

    await pattern.update(updates);
    return res.json({ ok: true, pattern });
  } catch (error) {
    console.error('[ErrorLearning] updatePattern error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

/**
 * Delete an error pattern (admin)
 */
async function deletePattern(req, res) {
  try {
    const { id } = req.params;

    const pattern = await ChatErrorPattern.findByPk(id);
    if (!pattern) {
      return res.status(404).json({ ok: false, error: 'Pattern not found' });
    }

    await pattern.destroy();
    return res.json({ ok: true, deleted: true });
  } catch (error) {
    console.error('[ErrorLearning] deletePattern error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

/**
 * Add correction to knowledge base from a flag (admin)
 */
async function addToKnowledge(req, res) {
  try {
    const { id } = req.params;
    const { correction_text } = req.body;

    if (!correction_text) {
      return res.status(400).json({ ok: false, error: 'correction_text required' });
    }

    const result = await errorLearningService.addToKnowledgeBase(id, correction_text);
    return res.json(result);
  } catch (error) {
    console.error('[ErrorLearning] addToKnowledge error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

/**
 * Update a flag (admin) - PATCH endpoint
 */
async function updateFlag(req, res) {
  try {
    const { id } = req.params;
    const updates = {};
    
    // Allow updating specific fields
    if (req.body.resolution_status) updates.resolution_status = req.body.resolution_status;
    if (req.body.correction_notes !== undefined) updates.correction_notes = req.body.correction_notes;
    if (req.body.expected_response !== undefined) updates.expected_response = req.body.expected_response;
    if (req.body.severity) updates.severity = req.body.severity;
    
    // Set resolved_by and resolved_at if status is changing to resolved state
    if (updates.resolution_status && updates.resolution_status !== 'pending') {
      updates.resolved_by = req.user?.id || null;
      updates.resolved_at = new Date();
    }
    
    const flag = await ChatMessageFlag.findByPk(id);
    if (!flag) {
      return res.status(404).json({ ok: false, error: 'Flag not found' });
    }
    
    await flag.update(updates);
    return res.json({ ok: true, flag });
  } catch (error) {
    console.error('[ErrorLearning] updateFlag error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

module.exports = {
  flagMessage,
  getStats,
  analyzeFlags,
  listFlags,
  resolveFlag,
  updateFlag,
  createPattern,
  listPatterns,
  updatePattern,
  deletePattern,
  addToKnowledge,
};
