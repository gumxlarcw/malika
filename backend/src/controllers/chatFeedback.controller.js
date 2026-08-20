const ChatFeedback = require('../models/ChatFeedback.model');
const ChatThread = require('../models/ChatThread.model');

/**
 * Submit feedback (stars + optional review) for a chat thread
 */
async function submitFeedback(req, res) {
  try {
    const { thread_id, stars, review } = req.body;
    const ownerId = req.malikaUid || req.headers['x-malika-uid'] || null;

    if (!thread_id || !stars) {
      return res.status(400).json({ ok: false, error: 'thread_id and stars required' });
    }

    const starsNum = parseInt(stars, 10);
    if (isNaN(starsNum) || starsNum < 1 || starsNum > 5) {
      return res.status(400).json({ ok: false, error: 'stars must be 1-5' });
    }

    // Get thread title for caching
    let threadTitle = null;
    try {
      const thread = await ChatThread.findByPk(thread_id);
      if (thread) {
        threadTitle = thread.title || null;
      }
    } catch {
      // Ignore - title is optional
    }

    // Check if feedback already exists for this thread by this user
    const existing = await ChatFeedback.findOne({
      where: { thread_id, owner_id: ownerId },
    });

    if (existing) {
      // Update existing feedback
      await existing.update({
        stars: starsNum,
        review: review || existing.review,
        thread_title: threadTitle || existing.thread_title,
      });
      return res.json({ ok: true, feedback: existing, updated: true });
    }

    // Create new feedback
    const feedback = await ChatFeedback.create({
      thread_id,
      owner_id: ownerId,
      stars: starsNum,
      review: review || null,
      thread_title: threadTitle,
      created_at: new Date(),
    });

    return res.json({ ok: true, feedback, created: true });
  } catch (error) {
    console.error('[ChatFeedback] submitFeedback error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

/**
 * Submit general feedback (not tied to a specific thread)
 * Each device (owner_id) can only submit once
 */
async function submitGeneralFeedback(req, res) {
  try {
    const { stars, review } = req.body;
    const ownerId = req.malikaUid || req.headers['x-malika-uid'] || null;

    if (!ownerId) {
      return res.status(400).json({ ok: false, error: 'Device identifier required' });
    }

    if (!stars) {
      return res.status(400).json({ ok: false, error: 'stars required' });
    }

    const starsNum = parseInt(stars, 10);
    if (isNaN(starsNum) || starsNum < 1 || starsNum > 5) {
      return res.status(400).json({ ok: false, error: 'stars must be 1-5' });
    }

    // Check if feedback already exists for this device (general feedback has thread_id = 0)
    const existing = await ChatFeedback.findOne({
      where: { owner_id: ownerId, thread_id: 0 },
    });

    if (existing) {
      // Update existing feedback
      await existing.update({
        stars: starsNum,
        review: review !== undefined ? review : existing.review,
      });
      return res.json({ ok: true, feedback: existing, updated: true });
    }

    // Create new feedback
    const feedback = await ChatFeedback.create({
      thread_id: 0, // 0 means general feedback
      owner_id: ownerId,
      stars: starsNum,
      review: review || null,
      thread_title: 'Feedback Umum',
      created_at: new Date(),
    });

    return res.json({ ok: true, feedback, created: true });
  } catch (error) {
    console.error('[ChatFeedback] submitGeneralFeedback error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

/**
 * Get current user's general feedback
 */
async function getMyFeedback(req, res) {
  try {
    const ownerId = req.malikaUid || req.headers['x-malika-uid'] || null;

    if (!ownerId) {
      return res.json({ ok: true, feedback: null });
    }

    // Get general feedback (thread_id = 0)
    const feedback = await ChatFeedback.findOne({
      where: { owner_id: ownerId, thread_id: 0 },
    });

    return res.json({ ok: true, feedback: feedback || null });
  } catch (error) {
    console.error('[ChatFeedback] getMyFeedback error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

/**
 * Get feedback for a specific thread
 */
async function getFeedbackByThread(req, res) {
  try {
    const { thread_id } = req.params;
    const ownerId = req.malikaUid || req.headers['x-malika-uid'] || null;

    const feedback = await ChatFeedback.findOne({
      where: { thread_id, owner_id: ownerId },
    });

    return res.json({ ok: true, feedback: feedback || null });
  } catch (error) {
    console.error('[ChatFeedback] getFeedbackByThread error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

/**
 * Get all feedbacks (admin)
 */
async function getAllFeedbacks(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = parseInt(req.query.offset, 10) || 0;
    const starFilter = req.query.stars ? parseInt(req.query.stars, 10) : null;

    const whereClause = {};
    if (starFilter && starFilter >= 1 && starFilter <= 5) {
      whereClause.stars = starFilter;
    }

    const feedbacks = await ChatFeedback.findAll({
      where: whereClause,
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    const total = await ChatFeedback.count({ where: whereClause });

    // Calculate stats
    const stats = await ChatFeedback.findAll({
      attributes: [
        [ChatFeedback.sequelize.fn('AVG', ChatFeedback.sequelize.col('stars')), 'avg_stars'],
        [ChatFeedback.sequelize.fn('COUNT', ChatFeedback.sequelize.col('id')), 'total_count'],
      ],
      raw: true,
    });

    const starDistribution = await ChatFeedback.findAll({
      attributes: [
        'stars',
        [ChatFeedback.sequelize.fn('COUNT', ChatFeedback.sequelize.col('id')), 'count'],
      ],
      group: ['stars'],
      raw: true,
    });

    return res.json({
      ok: true,
      feedbacks,
      total,
      stats: {
        avg_stars: parseFloat(stats[0]?.avg_stars || 0).toFixed(2),
        total_count: parseInt(stats[0]?.total_count || 0, 10),
        distribution: starDistribution.reduce((acc, s) => {
          acc[s.stars] = parseInt(s.count, 10);
          return acc;
        }, {}),
      },
    });
  } catch (error) {
    console.error('[ChatFeedback] getAllFeedbacks error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

module.exports = {
  submitFeedback,
  submitGeneralFeedback,
  getMyFeedback,
  getFeedbackByThread,
  getAllFeedbacks,
};
