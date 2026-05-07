let pino;
try {
  // Optional dependency; falls back to console if unavailable
  // This allows usage without forcing install immediately.
  // eslint-disable-next-line global-require
  pino = require('pino');
} catch (e) {
  pino = null;
}

const level = process.env.LOG_LEVEL || 'info';

function createLogger() {
  if (pino) {
    return pino({ level });
  }
  // Minimal console-backed logger with similar API
  const methods = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
  const logger = {};
  methods.forEach((m) => {
    logger[m] = (...args) => {
      // eslint-disable-next-line no-console
      console[m === 'fatal' ? 'error' : m](...args);
    };
  });
  logger.child = () => logger;
  return logger;
}

module.exports = createLogger();
