const client = require('prom-client');

const register = new client.Registry();

client.collectDefaultMetrics({
  register,
  prefix: 'malika_',
});

const httpRequestDurationMs = new client.Histogram({
  name: 'malika_http_request_duration_ms',
  help: 'HTTP request duration in ms',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [25, 50, 100, 200, 300, 500, 1000, 2000, 5000, 10000],
});

const httpRequestsTotal = new client.Counter({
  name: 'malika_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

const httpRequestsInFlight = new client.Gauge({
  name: 'malika_http_requests_in_flight',
  help: 'Number of HTTP requests in flight',
});

const openaiRequestsTotal = new client.Counter({
  name: 'malika_openai_requests_total',
  help: 'Total OpenAI requests by outcome',
  labelNames: ['status'],
});

const cacheEventsTotal = new client.Counter({
  name: 'malika_cache_events_total',
  help: 'Cache hit/miss events',
  labelNames: ['result'],
});

const errorEventsTotal = new client.Counter({
  name: 'malika_error_events_total',
  help: 'Error events by code',
  labelNames: ['code'],
});

const dbUp = new client.Gauge({
  name: 'malika_db_up',
  help: 'Database connectivity (1=up, 0=down)',
});

const dbPoolSize = new client.Gauge({
  name: 'malika_db_pool_size',
  help: 'Total connections in Sequelize pool',
  labelNames: ['db'],
});

const dbPoolAvailable = new client.Gauge({
  name: 'malika_db_pool_available',
  help: 'Available connections in Sequelize pool',
  labelNames: ['db'],
});

const dbPoolUsing = new client.Gauge({
  name: 'malika_db_pool_using',
  help: 'Used connections in Sequelize pool',
  labelNames: ['db'],
});

const dbPoolWaiting = new client.Gauge({
  name: 'malika_db_pool_waiting',
  help: 'Pending acquire requests in Sequelize pool',
  labelNames: ['db'],
});

register.registerMetric(httpRequestDurationMs);
register.registerMetric(httpRequestsTotal);
register.registerMetric(httpRequestsInFlight);
register.registerMetric(openaiRequestsTotal);
register.registerMetric(cacheEventsTotal);
register.registerMetric(errorEventsTotal);
register.registerMetric(dbUp);
register.registerMetric(dbPoolSize);
register.registerMetric(dbPoolAvailable);
register.registerMetric(dbPoolUsing);
register.registerMetric(dbPoolWaiting);

function readPoolValue(pool, key) {
  const value = pool?.[key];
  try {
    return typeof value === 'function' ? value.call(pool) : value;
  } catch {
    return undefined;
  }
}

function startDbPoolMetrics(sequelize, label = 'primary') {
  if (!sequelize) return null;
  const pool = sequelize?.connectionManager?.pool;
  if (!pool) return null;

  const sample = () => {
    const size = readPoolValue(pool, 'size');
    const available = readPoolValue(pool, 'available');
    const using = readPoolValue(pool, 'using');
    const waiting = readPoolValue(pool, 'waiting');

    if (typeof size === 'number') dbPoolSize.set({ db: label }, size);
    if (typeof available === 'number') dbPoolAvailable.set({ db: label }, available);
    if (typeof using === 'number') dbPoolUsing.set({ db: label }, using);
    if (typeof waiting === 'number') dbPoolWaiting.set({ db: label }, waiting);
  };

  sample();
  const interval = setInterval(sample, 15000);
  interval.unref?.();
  return interval;
}

function resolveRouteLabel(req) {
  if (req.route?.path) {
    return `${req.baseUrl || ''}${req.route.path}`;
  }
  if (req.baseUrl && req.path) {
    return `${req.baseUrl}${req.path}`;
  }
  return req.path || req.originalUrl || 'unknown';
}

function createMetricsMiddleware() {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    httpRequestsInFlight.inc();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const route = resolveRouteLabel(req);
      const labels = {
        method: req.method,
        route,
        status_code: String(res.statusCode),
      };

      httpRequestsInFlight.dec();
      httpRequestDurationMs.observe(labels, durationMs);
      httpRequestsTotal.inc(labels);
    });

    next();
  };
}

async function metricsEndpoint(req, res) {
  res.setHeader('Content-Type', register.contentType);
  res.end(await register.metrics());
}

module.exports = {
  createMetricsMiddleware,
  metricsEndpoint,
  recordOpenAICallProm: (success) => {
    openaiRequestsTotal.inc({ status: success ? 'success' : 'failure' });
  },
  recordCacheHitProm: () => {
    cacheEventsTotal.inc({ result: 'hit' });
  },
  recordCacheMissProm: () => {
    cacheEventsTotal.inc({ result: 'miss' });
  },
  recordErrorProm: (code = 'UNKNOWN') => {
    errorEventsTotal.inc({ code });
  },
  setDbUp: (value) => {
    dbUp.set(value);
  },
  startDbPoolMetrics,
  register,
};
