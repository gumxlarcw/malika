const Notification = require('../../models/Notification.model');

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

async function createNotification({ uniqueKey, type, title, message, link, metadata, push = true, createdAt } = {}) {
  if (!uniqueKey) throw new Error('uniqueKey is required');
  if (!type) throw new Error('type is required');
  if (!title) throw new Error('title is required');

  const now = new Date();
  const metadataJson = metadata ? safeJsonStringify(metadata) : null;

  const createdAtDate = createdAt ? new Date(createdAt) : now;
  const safeCreatedAt = createdAtDate && !Number.isNaN(createdAtDate.getTime()) ? createdAtDate : now;

  // Some deployments have a short VARCHAR column for link; avoid insert failures.
  // Full URLs (e.g., BPS download.php) are preserved in metadata_json.
  const safeLink = typeof link === 'string' && link.length > 255 ? null : (link ?? null);

  const [row, created] = await Notification.findOrCreate({
    where: { unique_key: uniqueKey },
    defaults: {
      type,
      title,
      message: message ?? null,
      link: safeLink,
      unique_key: uniqueKey,
      metadata_json: metadataJson,
      created_at: safeCreatedAt,
    },
  });

  if (created && push !== false) {
    try {
      const { broadcastPush } = require('../push/push.service');
      const pushResult = await broadcastPush({
        title: title,
        body: message || '',
        url: link || '/notifications',
        tag: uniqueKey,
      });

      // Best-effort push delivery logging (summary only)
      try {
        const PushSendLog = require('../../models/PushSendLog.model');
        await PushSendLog.create({
          notification_id: row.id,
          notification_unique_key: uniqueKey,
          notification_type: type,
          notification_title: title,
          trigger: 'notification:create',
          sent: Number(pushResult?.sent || 0),
          failed: Number(pushResult?.failed || 0),
          skipped: Boolean(pushResult?.skipped),
          created_at: now,
        });
      } catch {
        // ignore
      }
    } catch {
      // Best-effort only; do not block API flows.
    }
  }

  return { row, created };
}

async function listNotifications({ limit = 20, offset = 0, type } = {}) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 20));
  const safeOffset = Math.max(0, Number(offset) || 0);

  const where = {};
  if (type) where.type = String(type);

  const rows = await Notification.findAll({
    where,
    order: [['created_at', 'DESC'], ['id', 'DESC']],
    limit: safeLimit,
    offset: safeOffset,
  });

  return rows;
}

module.exports = {
  createNotification,
  listNotifications,
};
