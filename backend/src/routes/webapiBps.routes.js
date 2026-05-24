'use strict';

const express = require('express');
const router = express.Router();
const WebapiHealthLog = require('../models/WebapiHealthLog.model');
const { runProbe } = require('../services/webapiBpsHealth/probe.service');
const { resolveBpsApiKey } = require('../services/pressrelease/apiKey.service');
const { bpsAPICircuit } = require('../utils/circuitBreaker');
const sequelize = require('../config/db');
const logger = require('../utils/logger').child({ service: 'WebapiBpsRoutes' });

// In-memory 30s cache for /status (dashboard polls 30s — perfect cache TTL)
let statusCache = { ts: 0, data: null };
const STATUS_CACHE_MS = 30_000;

router.get('/status', async (req, res) => {
  try {
    if (statusCache.data && Date.now() - statusCache.ts < STATUS_CACHE_MS) {
      return res.json(statusCache.data);
    }

    // Per-family last status
    const families = ['domain', 'var', 'th', 'pressrelease'];
    const perFamily = await Promise.all(families.map(async (family) => {
      const last = await WebapiHealthLog.findOne({
        where: { endpoint_family: family },
        order: [['id', 'DESC']],
      });
      return {
        family,
        lastOk: last ? !!last.ok : null,
        lastLatencyMs: last ? last.latency_ms : null,
        lastErrorCode: last ? last.error_code : null,
        lastCheckedAt: last ? last.created_at : null,
      };
    }));

    // Last probe run summary
    const lastAny = await WebapiHealthLog.findOne({ order: [['id', 'DESC']] });

    // 24h aggregate (scheduled only) — raw SQL for percentile
    const [aggRows] = await sequelize.query(`
      SELECT
        COUNT(*)            AS total,
        SUM(1 - ok)         AS failed,
        AVG(ok)             AS uptime,
        AVG(latency_ms)     AS avg_latency,
        MAX(latency_ms)     AS max_latency
      FROM webapi_health_logs
      WHERE probe_kind = 'scheduled' AND created_at >= NOW() - INTERVAL 24 HOUR
    `);
    const agg = aggRows[0] || {};

    // p50/p95 via separate query (MariaDB 11+ window functions)
    const [pRows] = await sequelize.query(`
      SELECT
        MAX(CASE WHEN cum_pct <= 0.50 THEN latency_ms END) AS p50,
        MAX(CASE WHEN cum_pct <= 0.95 THEN latency_ms END) AS p95
      FROM (
        SELECT latency_ms,
               PERCENT_RANK() OVER (ORDER BY latency_ms) AS cum_pct
        FROM webapi_health_logs
        WHERE probe_kind = 'scheduled' AND ok = 1 AND latency_ms IS NOT NULL
          AND created_at >= NOW() - INTERVAL 24 HOUR
      ) t
    `);
    const p = pRows[0] || {};

    // Overall: derive from latest run
    let overall = 'UNKNOWN';
    if (lastAny) {
      const sameRun = await WebapiHealthLog.findAll({ where: { run_id: lastAny.run_id } });
      const okCount = sameRun.filter(r => r.ok).length;
      overall = okCount === sameRun.length ? 'UP' : okCount === 0 ? 'DOWN' : 'DEGRADED';
    }

    const apiKey = await resolveBpsApiKey();
    const circuit = bpsAPICircuit.getStatus();

    const out = {
      overall,
      lastProbeAt: lastAny ? lastAny.created_at : null,
      lastProbeRunId: lastAny ? lastAny.run_id : null,
      uptime24h: agg.uptime !== null && agg.uptime !== undefined ? Number(agg.uptime) : null,
      p50LatencyMs24h: p.p50 != null ? Number(p.p50) : null,
      p95LatencyMs24h: p.p95 != null ? Number(p.p95) : null,
      totalProbes24h: Number(agg.total || 0),
      failedProbes24h: Number(agg.failed || 0),
      perFamily,
      circuit: {
        state: circuit.state,
        failureCount: circuit.failureCount,
        lastFailureAt: circuit.lastFailureTime ? new Date(circuit.lastFailureTime).toISOString() : null,
        nextAttemptAt: circuit.nextAttemptTime ? new Date(circuit.nextAttemptTime).toISOString() : null,
      },
      apiKeyPresent: !!apiKey,
    };

    statusCache = { ts: Date.now(), data: out };
    return res.json(out);
  } catch (err) {
    logger.error({ err: err.message }, 'GET /webapi-bps/status failed');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
