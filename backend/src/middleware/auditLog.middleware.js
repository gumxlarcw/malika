const AdminAuditLog = require('../models/AdminAuditLog.model');
const logger = require('../utils/logger').child({ service: 'AuditLog' });

const SENSITIVE_FIELDS = new Set(['password', 'password_hash', 'token', 'refresh_token']);

function sanitizePayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (Array.isArray(payload)) return payload.map(sanitizePayload);
  const clean = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SENSITIVE_FIELDS.has(key)) {
      clean[key] = '[REDACTED]';
    } else if (value && typeof value === 'object') {
      clean[key] = sanitizePayload(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

function createAuditLogMiddleware({ resource } = {}) {
  return (req, res, next) => {
    const startedAt = Date.now();

    res.on('finish', async () => {
      try {
        if (!req.user) return;

        const entry = {
          user_id: req.user.id,
          user_email: req.user.email || null,
          user_role: req.user.role || null,
          action: req.method,
          resource: resource || null,
          method: req.method,
          path: req.originalUrl,
          ip: req.ip,
          user_agent: req.get('user-agent') || null,
          status_code: res.statusCode,
          duration_ms: Date.now() - startedAt,
          request_body: req.body ? JSON.stringify(sanitizePayload(req.body)) : null,
          request_query: req.query ? JSON.stringify(sanitizePayload(req.query)) : null,
          request_params: req.params ? JSON.stringify(sanitizePayload(req.params)) : null,
          created_at: new Date(),
        };

        await AdminAuditLog.create(entry);
      } catch (err) {
        logger.warn({ error: err?.message || String(err) }, 'Failed to write audit log');
      }
    });

    next();
  };
}

module.exports = {
  createAuditLogMiddleware,
};
