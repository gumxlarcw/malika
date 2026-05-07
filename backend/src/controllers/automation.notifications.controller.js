const Notification = require('../models/Notification.model');
const PushSubscription = require('../models/PushSubscription.model');
const PushSendLog = require('../models/PushSendLog.model');

const { getVapidConfig } = require('../services/push/push.service');

function safeNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function parseListParams(req, { defaultLimit = 50, maxLimit = 200 } = {}) {
  const limit = clamp(safeNumber(req.query.limit, defaultLimit), 1, maxLimit);
  const offset = clamp(safeNumber(req.query.offset, 0), 0, Number.MAX_SAFE_INTEGER);
  return { limit, offset };
}

function parseEnvBool(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  return String(raw).trim().toLowerCase() === 'true';
}

exports.getStatus = async (req, res) => {
  try {
    const vapid = getVapidConfig();

    const subscriptionsCount = await PushSubscription.count();
    const notificationsCount = await Notification.count();
    const pushLogsCount = await PushSendLog.count();

    res.json({
      ok: true,
      settings: {
        vapid: {
          configured: Boolean(vapid && vapid.publicKey && vapid.privateKey),
          publicKey: vapid?.publicKey || null,
          subject: vapid?.subject || null,
        },
        merged_cache_notifications: {
          enabled: parseEnvBool('MERGED_CACHE_NOTIFICATIONS_ENABLED', false),
          interval_minutes: safeNumber(process.env.MERGED_CACHE_NOTIFICATIONS_INTERVAL_MINUTES, 15),
          max: safeNumber(process.env.MERGED_CACHE_NOTIFICATIONS_MAX, 50),
          signature: process.env.MERGED_CACHE_NOTIFICATIONS_SIGNATURE || null,
        },
        publication_notifications: {
          enabled: parseEnvBool('PUBLICATION_NOTIFICATIONS_ENABLED', false),
          interval_minutes:
            process.env.PUBLICATION_INTERVAL_MINUTES != null ? safeNumber(process.env.PUBLICATION_INTERVAL_MINUTES, null) : null,
          max_new: safeNumber(process.env.PUBLICATION_NOTIFICATIONS_MAX_NEW, 50),
        },
        pressrelease_notifications: {
          // Pressrelease is pulled via automation (no dedicated scheduler). This is the safety cap.
          max_new: safeNumber(process.env.PRESSRELEASE_NOTIFICATIONS_MAX_NEW, 50),
        },
        automation_data_notifications: {
          enabled: parseEnvBool('AUTOMATION_DATA_NOTIFICATIONS_ENABLED', false),
        },
      },
      counts: {
        subscriptions: subscriptionsCount,
        notifications: notificationsCount,
        push_send_logs: pushLogsCount,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err?.message || String(err) });
  }
};

exports.listNotifications = async (req, res) => {
  try {
    const { limit, offset } = parseListParams(req, { defaultLimit: 50, maxLimit: 200 });
    const type = req.query.type ? String(req.query.type) : null;

    const where = {};
    if (type) where.type = type;

    const rows = await Notification.findAll({
      where,
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      limit,
      offset,
    });

    const items = rows.map((r) => {
      let meta = null;
      try {
        meta = r.metadata_json ? JSON.parse(r.metadata_json) : null;
      } catch {
        meta = null;
      }

      return {
        id: r.id,
        type: r.type,
        title: r.title,
        message: r.message,
        link: r.link,
        unique_key: r.unique_key,
        created_at: r.created_at,
        metadata: meta,
      };
    });

    res.json({ ok: true, limit, offset, items });
  } catch (err) {
    res.status(500).json({ ok: false, message: err?.message || String(err) });
  }
};

exports.listPushLogs = async (req, res) => {
  try {
    const { limit, offset } = parseListParams(req, { defaultLimit: 50, maxLimit: 200 });

    const trigger = req.query.trigger ? String(req.query.trigger) : null;
    const notificationId = req.query.notification_id != null ? safeNumber(req.query.notification_id, null) : null;
    const uniqueKey = req.query.unique_key ? String(req.query.unique_key) : null;

    const where = {};
    if (trigger) where.trigger = trigger;
    if (notificationId) where.notification_id = notificationId;
    if (uniqueKey) where.notification_unique_key = uniqueKey;

    const rows = await PushSendLog.findAll({
      where,
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      limit,
      offset,
    });

    const items = rows.map((r) => ({
      id: r.id,
      notification_id: r.notification_id,
      notification_unique_key: r.notification_unique_key,
      notification_type: r.notification_type,
      notification_title: r.notification_title,
      trigger: r.trigger,
      sent: r.sent,
      failed: r.failed,
      skipped: Boolean(r.skipped),
      created_at: r.created_at,
    }));

    res.json({ ok: true, limit, offset, items });
  } catch (err) {
    res.status(500).json({ ok: false, message: err?.message || String(err) });
  }
};
