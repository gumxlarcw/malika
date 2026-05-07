const Notification = require('../models/Notification.model');
const MergedCache = require('../models/MergedCache.model');
const DataSource = require('../models/DataSource.model');
const { createNotification, listNotifications } = require('../services/notification/notification.service');
const { Op } = require('sequelize');

function parseBoolTrue(v) {
  return String(v || '').trim().toLowerCase() === 'true';
}

function requireAdminTokenIfConfigured(req) {
  const token = process.env.NOTIFICATIONS_ADMIN_TOKEN;
  // In production, never expose admin notification endpoints without a token.
  if (!token) {
    if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') return false;
    return true; // non-production convenience
  }

  const header = req.headers['x-notifications-admin-token'];
  const query = req.query.token;
  const provided = (Array.isArray(header) ? header[0] : header) || query;
  return String(provided || '') === String(token);
}

function denyIfAdminTokenMissing(req, res) {
  if (!requireAdminTokenIfConfigured(req)) {
    res.status(403).json({ message: 'Forbidden' });
    return true;
  }
  return false;
}

// GET /notifications/admin/list - List notifications for admin table
exports.list = async (req, res) => {
  try {
    if (denyIfAdminTokenMissing(req, res)) return;

    const limit = req.query.limit;
    const offset = req.query.offset;
    const type = req.query.type ? String(req.query.type) : undefined;

    const rows = await listNotifications({ limit: limit || 100, offset: offset || 0, type });

    // Get total count
    const where = type ? { type } : {};
    const total = await Notification.count({ where });

    const payload = rows.map((r) => {
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

    res.json({ items: payload, total });
  } catch (err) {
    res.status(500).json({ message: err.message || String(err) });
  }
};

// DELETE /notifications/admin/delete - Delete selected notifications by IDs
exports.deleteSelected = async (req, res) => {
  try {
    if (denyIfAdminTokenMissing(req, res)) return;

    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'ids array is required' });
    }

    const numericIds = ids.map((id) => Number(id)).filter((id) => !Number.isNaN(id) && id > 0);
    if (numericIds.length === 0) {
      return res.status(400).json({ message: 'No valid numeric IDs provided' });
    }

    const deleted = await Notification.destroy({
      where: { id: { [Op.in]: numericIds } },
    });

    res.json({ ok: true, deleted, ids: numericIds });
  } catch (err) {
    res.status(500).json({ message: err.message || String(err) });
  }
};

// POST /notifications/admin/create - Create custom notification with redirect options
exports.createCustom = async (req, res) => {
  try {
    if (denyIfAdminTokenMissing(req, res)) return;

    const body = req.body || {};
    const title = String(body.title || '').trim();
    const message = body.message != null ? String(body.message) : null;
    const type = String(body.type || 'info').trim();
    const redirectType = String(body.redirectType || 'none').trim(); // none, data, pressrelease, custom
    const sourceId = body.sourceId ? Number(body.sourceId) : null;
    const brsId = body.brsId ? String(body.brsId).trim() : null;
    const customUrl = body.customUrl ? String(body.customUrl).trim() : null;

    if (!title) {
      return res.status(400).json({ message: 'Title is required' });
    }

    // Build link based on redirect type
    let link = '/notifications';
    let metadata = { kind: 'custom', redirectType };

    if (redirectType === 'data' && sourceId) {
      link = `/data?source_id=${sourceId}`;
      metadata.source_id = sourceId;
      // Get datasource name
      try {
        const ds = await DataSource.findByPk(sourceId);
        if (ds) metadata.datasource_name = ds.name;
      } catch { /* ignore */ }
    } else if (redirectType === 'pressrelease') {
      if (brsId) {
        link = `/pressrelease/${brsId}`;
        metadata.brs_id = brsId;
      } else {
        link = '/pressrelease';
      }
    } else if (redirectType === 'custom' && customUrl) {
      link = customUrl;
      metadata.custom_url = customUrl;
    }

    const uniqueKey = `custom:${Date.now()}:${Math.random().toString(36).substring(2, 9)}`;

    const result = await createNotification({
      uniqueKey,
      type,
      title,
      message,
      link,
      metadata,
    });

    res.json({
      ok: true,
      created: result.created,
      id: result.row.id,
      link,
    });
  } catch (err) {
    res.status(500).json({ message: err.message || String(err) });
  }
};

exports.clear = async (req, res) => {
  try {
    if (denyIfAdminTokenMissing(req, res)) return;

    const all = parseBoolTrue(req.query.all);
    const type = req.query.type ? String(req.query.type).trim() : null;

    const where = {};
    if (!all && type) where.type = type;

    const deleted = await Notification.destroy({ where: all ? {} : where });
    res.json({ ok: true, deleted });
  } catch (err) {
    res.status(500).json({ message: err.message || String(err) });
  }
};

exports.test = async (req, res) => {
  try {
    if (denyIfAdminTokenMissing(req, res)) return;

    const body = req.body || {};
    const type = String(body.type || 'info');
    const title = String(body.title || 'Test Notification');
    const message = body.message !== undefined ? String(body.message) : null;
    const link = body.link !== undefined ? String(body.link) : null;

    const uniqueKey =
      body.uniqueKey !== undefined && String(body.uniqueKey).trim()
        ? String(body.uniqueKey).trim()
        : `manual:test:${Date.now()}`;

    const result = await createNotification({
      uniqueKey,
      type,
      title,
      message,
      link,
      metadata: { kind: 'manual:test' },
    });

    res.json({ ok: true, created: result.created, id: result.row.id });
  } catch (err) {
    res.status(500).json({ message: err.message || String(err) });
  }
};

exports.emitLatestMerged = async (req, res) => {
  try {
    if (denyIfAdminTokenMissing(req, res)) return;

    const latest = await MergedCache.findOne({
      order: [['last_update', 'DESC'], ['id', 'DESC']],
    });

    if (!latest) {
      return res.status(404).json({ message: 'No merged cache found' });
    }

    const sourceId = Number(latest.source_id);
    const signature = String(latest.signature || 'all');
    const lastUpdate = latest.last_update ? new Date(latest.last_update) : new Date();

    let dsName = null;
    try {
      const ds = await DataSource.findByPk(sourceId);
      dsName = ds && ds.name ? String(ds.name) : null;
    } catch {
      dsName = null;
    }

    const uniqueKey = `manual:latest-merged:${sourceId}:${signature}:${lastUpdate.toISOString()}`;

    const result = await createNotification({
      uniqueKey,
      type: 'data',
      title: dsName || 'Periode terakhir diperbarui',
      message: `source_id=${sourceId} signature=${signature} last_update=${lastUpdate.toISOString()}`,
      link: `/cache/merged/${sourceId}?signature=${encodeURIComponent(signature)}`,
      metadata: {
        source_id: sourceId,
        signature,
        last_update: lastUpdate.toISOString(),
        kind: 'manual:latest-merged',
      },
    });

    res.json({ ok: true, created: result.created, id: result.row.id, source_id: sourceId, signature });
  } catch (err) {
    res.status(500).json({ message: err.message || String(err) });
  }
};

exports.rebroadcast = async (req, res) => {
  try {
    if (denyIfAdminTokenMissing(req, res)) return;

    const id = Number(req.query.id || 0);
    const uniqueKey = req.query.uniqueKey != null ? String(req.query.uniqueKey).trim() : null;

    if (!id && !uniqueKey) {
      return res.status(400).json({ ok: false, message: 'Provide ?id=<notification_id> or ?uniqueKey=<unique_key>' });
    }

    const row = id
      ? await Notification.findByPk(id)
      : await Notification.findOne({ where: { unique_key: uniqueKey } });

    if (!row) return res.status(404).json({ ok: false, message: 'Notification not found' });

    // Send a push even if the notification was created in the past.
    const { broadcastPush } = require('../services/push/push.service');

    let meta = null;
    try {
      meta = row.metadata_json ? JSON.parse(row.metadata_json) : null;
    } catch {
      meta = null;
    }

    const deepLink =
      (typeof row.link === 'string' && row.link.trim())
        ? row.link.trim()
        : (meta && meta.pdf_url ? String(meta.pdf_url) : '/notifications');

    const result = await broadcastPush({
      title: row.title || 'Notifikasi',
      body: row.message || '',
      url: deepLink,
      tag: row.unique_key || (id ? `notification:${id}` : null),
    });

    // Best-effort push delivery logging (summary only)
    try {
      const PushSendLog = require('../models/PushSendLog.model');
      await PushSendLog.create({
        notification_id: row.id,
        notification_unique_key: row.unique_key || null,
        notification_type: row.type || null,
        notification_title: row.title || null,
        trigger: 'notification:rebroadcast',
        sent: Number(result?.sent || 0),
        failed: Number(result?.failed || 0),
        skipped: Boolean(result?.skipped),
        created_at: new Date(),
      });
    } catch {
      // ignore
    }

    return res.json({ ok: true, id: row.id, unique_key: row.unique_key, push: result });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || String(err) });
  }
};
