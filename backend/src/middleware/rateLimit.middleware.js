const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger').child({ service: 'RateLimit' });

const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);

function createRateLimiter(options = {}) {
  if (isTestEnv) {
    return (req, res, next) => next();
  }

  const handler = options.handler || ((req, res, next, opts) => {
    logger.warn({
      ip: req.ip,
      path: req.originalUrl,
      method: req.method,
      key: req.rateLimit?.key,
      limit: opts.limit,
      windowMs: opts.windowMs,
    }, 'Rate limit exceeded');

    res.status(opts.statusCode).json({
      error: 'RATE_LIMITED',
      message: opts.message || 'Too many requests',
    });
  });

  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    ...options,
    handler,
  });
}

module.exports = {
  createRateLimiter,
};
