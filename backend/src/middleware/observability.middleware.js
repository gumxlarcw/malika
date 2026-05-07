const { randomUUID } = require('crypto');
const logger = require('../utils/logger');

function normalizeRequestId(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed.slice(0, 128) : null;
}

function requestContextMiddleware(req, res, next) {
  const incoming = normalizeRequestId(req.get('x-request-id'));
  const requestId = incoming || randomUUID();

  req.requestId = requestId;
  req.logger = logger.child({ requestId });
  res.setHeader('x-request-id', requestId);

  next();
}

function requestLoggerMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  const baseLogger = req.logger || logger;

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const route = req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : (req.originalUrl || req.path);
    const userContext = req.user ? { userId: req.user.id, userRole: req.user.role } : {};
    const status = res.statusCode;
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';

    if (route === '/metrics') return;

    baseLogger[level]({
      method: req.method,
      path: route,
      status,
      durationMs: Math.round(durationMs),
      ip: req.ip,
      userAgent: req.get('user-agent'),
      ...userContext,
    }, 'request.completed');
  });

  next();
}

function metricsAuthMiddleware(req, res, next) {
  const token = process.env.METRICS_AUTH_TOKEN;
  if (!token) return next();

  const authHeader = req.get('authorization') || '';
  if (authHeader.startsWith('Bearer ') && authHeader.slice(7) === token) {
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized' });
}

module.exports = {
  requestContextMiddleware,
  requestLoggerMiddleware,
  metricsAuthMiddleware,
};
