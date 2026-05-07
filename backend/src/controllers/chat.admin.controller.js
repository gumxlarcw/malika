const ChatThread = require('../models/ChatThread.model');
const ChatMessage = require('../models/ChatMessage.model');
const { Op } = require('sequelize');

/**
 * List all chat threads (paginated)
 * GET /chat/admin/threads?page=1&limit=50&owner=<optional>
 */
async function listAllThreads(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const ownerFilter = req.query.owner ? String(req.query.owner).trim() : null;

    const where = {};
    if (ownerFilter) {
      where.owner_id = { [Op.like]: `%${ownerFilter}%` };
    }

    const { count, rows } = await ChatThread.findAndCountAll({
      where,
      order: [['last_message_at', 'DESC'], ['created_at', 'DESC']],
      limit,
      offset,
    });

    // Get message count for each thread
    const threadIds = rows.map(r => r.id);
    const messageCounts = await ChatMessage.count({
      where: { thread_id: { [Op.in]: threadIds } },
      group: ['thread_id'],
    });
    const countMap = {};
    messageCounts.forEach(mc => {
      countMap[mc.thread_id] = mc.count;
    });

    const threads = rows.map(t => ({
      id: t.id,
      owner_id: t.owner_id,
      title: t.title,
      topics: t.topics,
      summary: t.summary,
      last_message_at: t.last_message_at,
      created_at: t.created_at,
      updated_at: t.updated_at,
      message_count: countMap[t.id] || 0,
    }));

    res.json({
      ok: true,
      threads,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (e) {
    next(e);
  }
}

/**
 * Get a single thread with all its messages
 * GET /chat/admin/threads/:id
 */
async function getThreadWithMessages(req, res, next) {
  try {
    const threadId = parseInt(req.params.id, 10);
    if (!Number.isFinite(threadId) || threadId <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid_thread_id' });
    }

    const thread = await ChatThread.findByPk(threadId);
    if (!thread) {
      return res.status(404).json({ ok: false, error: 'thread_not_found' });
    }

    const messages = await ChatMessage.findAll({
      where: { thread_id: threadId },
      order: [['created_at', 'ASC']],
    });

    res.json({
      ok: true,
      thread: {
        id: thread.id,
        owner_id: thread.owner_id,
        title: thread.title,
        topics: thread.topics,
        summary: thread.summary,
        last_message_at: thread.last_message_at,
        created_at: thread.created_at,
        updated_at: thread.updated_at,
      },
      messages: messages.map(m => ({
        id: m.id,
        thread_id: m.thread_id,
        role: m.role,
        content: m.content,
        model: m.model,
        tokens_in: m.tokens_in,
        tokens_out: m.tokens_out,
        latency_ms: m.latency_ms,
        created_at: m.created_at,
      })),
    });
  } catch (e) {
    next(e);
  }
}

/**
 * Export all threads + messages for a specific owner
 * GET /chat/admin/export/owner/:ownerId
 */
async function exportByOwner(req, res, next) {
  try {
    const ownerId = req.params.ownerId;
    if (!ownerId) {
      return res.status(400).json({ ok: false, error: 'missing_owner_id' });
    }

    const threads = await ChatThread.findAll({
      where: { owner_id: ownerId },
      order: [['created_at', 'DESC']],
    });

    const threadIds = threads.map(t => t.id);
    const messages = threadIds.length > 0 
      ? await ChatMessage.findAll({
          where: { thread_id: { [Op.in]: threadIds } },
          order: [['thread_id', 'ASC'], ['created_at', 'ASC']],
        })
      : [];

    // Group messages by thread
    const messagesByThread = {};
    messages.forEach(m => {
      if (!messagesByThread[m.thread_id]) {
        messagesByThread[m.thread_id] = [];
      }
      messagesByThread[m.thread_id].push({
        id: m.id,
        role: m.role,
        content: m.content,
        model: m.model,
        tokens_in: m.tokens_in,
        tokens_out: m.tokens_out,
        latency_ms: m.latency_ms,
        created_at: m.created_at,
      });
    });

    const exported = threads.map(t => ({
      thread: {
        id: t.id,
        owner_id: t.owner_id,
        title: t.title,
        topics: t.topics,
        summary: t.summary,
        last_message_at: t.last_message_at,
        created_at: t.created_at,
        updated_at: t.updated_at,
      },
      messages: messagesByThread[t.id] || [],
    }));

    res.json({
      ok: true,
      owner_id: ownerId,
      exported_at: new Date().toISOString(),
      thread_count: threads.length,
      message_count: messages.length,
      data: exported,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * Export all chat data (threads + messages)
 * GET /chat/admin/export/all?limit=1000
 */
async function exportAll(req, res, next) {
  try {
    const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit, 10) || 1000));

    const threads = await ChatThread.findAll({
      order: [['last_message_at', 'DESC'], ['created_at', 'DESC']],
      limit,
    });

    const threadIds = threads.map(t => t.id);
    const messages = threadIds.length > 0
      ? await ChatMessage.findAll({
          where: { thread_id: { [Op.in]: threadIds } },
          order: [['thread_id', 'ASC'], ['created_at', 'ASC']],
        })
      : [];

    // Group messages by thread
    const messagesByThread = {};
    messages.forEach(m => {
      if (!messagesByThread[m.thread_id]) {
        messagesByThread[m.thread_id] = [];
      }
      messagesByThread[m.thread_id].push({
        id: m.id,
        role: m.role,
        content: m.content,
        model: m.model,
        tokens_in: m.tokens_in,
        tokens_out: m.tokens_out,
        latency_ms: m.latency_ms,
        created_at: m.created_at,
      });
    });

    const exported = threads.map(t => ({
      thread: {
        id: t.id,
        owner_id: t.owner_id,
        title: t.title,
        topics: t.topics,
        summary: t.summary,
        last_message_at: t.last_message_at,
        created_at: t.created_at,
        updated_at: t.updated_at,
      },
      messages: messagesByThread[t.id] || [],
    }));

    res.json({
      ok: true,
      exported_at: new Date().toISOString(),
      thread_count: threads.length,
      message_count: messages.length,
      data: exported,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * Get chat statistics
 * GET /chat/admin/stats
 */
async function getStats(req, res, next) {
  try {
    const totalThreads = await ChatThread.count();
    const totalMessages = await ChatMessage.count();

    // Count by role
    const messagesByRole = await ChatMessage.count({ group: ['role'] });
    const roleCountMap = {};
    messagesByRole.forEach(r => {
      roleCountMap[r.role] = r.count;
    });

    // Unique owners
    const uniqueOwners = await ChatThread.count({
      distinct: true,
      col: 'owner_id',
    });

    // Recent activity (last 24h, 7d, 30d)
    const now = new Date();
    const d1 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const threads24h = await ChatThread.count({
      where: { last_message_at: { [Op.gte]: d1 } },
    });
    const threads7d = await ChatThread.count({
      where: { last_message_at: { [Op.gte]: d7 } },
    });
    const threads30d = await ChatThread.count({
      where: { last_message_at: { [Op.gte]: d30 } },
    });

    const messages24h = await ChatMessage.count({
      where: { created_at: { [Op.gte]: d1 } },
    });
    const messages7d = await ChatMessage.count({
      where: { created_at: { [Op.gte]: d7 } },
    });
    const messages30d = await ChatMessage.count({
      where: { created_at: { [Op.gte]: d30 } },
    });

    res.json({
      ok: true,
      stats: {
        total_threads: totalThreads,
        total_messages: totalMessages,
        unique_owners: uniqueOwners,
        messages_by_role: roleCountMap,
        activity: {
          threads_24h: threads24h,
          threads_7d: threads7d,
          threads_30d: threads30d,
          messages_24h: messages24h,
          messages_7d: messages7d,
          messages_30d: messages30d,
        },
      },
    });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  listAllThreads,
  getThreadWithMessages,
  exportByOwner,
  exportAll,
  getStats,
};
