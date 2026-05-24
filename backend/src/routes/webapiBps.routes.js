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

// GET /webapi-bps/history?hours=24&bucket=1h
router.get('/history', async (req, res) => {
  try {
    const hours = Math.min(Math.max(parseInt(req.query.hours) || 24, 1), 168);
    const bucket = String(req.query.bucket || '1h');

    // Validate bucket combinations (cap total points at ~300)
    const bucketSec = bucket === '5m' ? 300 : bucket === '15m' ? 900 : bucket === '1h' ? 3600 : null;
    if (!bucketSec) {
      return res.status(400).json({ error: 'bucket must be one of: 5m, 15m, 1h' });
    }
    const totalPoints = (hours * 3600) / bucketSec;
    if (totalPoints > 300) {
      return res.status(400).json({ error: `Too many buckets (${totalPoints}); reduce hours or use larger bucket` });
    }

    // Group-by SQL — server-side bucketing
    const format = bucket === '1h' ? '%Y-%m-%d %H:00:00'
                 : bucket === '15m' ? '%Y-%m-%d %H:%i:00'
                 : '%Y-%m-%d %H:%i:00';

    const [rows] = await sequelize.query(`
      SELECT
        DATE_FORMAT(created_at, ?) AS bucket_start,
        COUNT(*)                    AS probes,
        SUM(1 - ok)                 AS failed,
        AVG(latency_ms)             AS avg_latency
      FROM webapi_health_logs
      WHERE probe_kind = 'scheduled'
        AND created_at >= NOW() - INTERVAL ? HOUR
      GROUP BY bucket_start
      ORDER BY bucket_start ASC
    `, { replacements: [format, hours] });

    return res.json({
      bucket,
      hours,
      buckets: rows.map(r => ({
        t: new Date(r.bucket_start + 'Z').toISOString(),
        probes: Number(r.probes),
        failed: Number(r.failed),
        p95LatencyMs: r.p95 != null ? Number(r.p95) : (r.avg_latency != null ? Number(r.avg_latency) : null),
      })),
    });
  } catch (err) {
    logger.error({ err: err.message }, 'GET /webapi-bps/history failed');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /webapi-bps/logs?limit&offset&family&status&kind&runId
router.get('/logs', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const where = {};
    if (req.query.family) where.endpoint_family = String(req.query.family);
    if (req.query.kind) where.probe_kind = String(req.query.kind);
    if (req.query.runId) where.run_id = String(req.query.runId);
    if (req.query.status === 'ok') where.ok = 1;
    else if (req.query.status === 'error') where.ok = 0;

    const { count, rows } = await WebapiHealthLog.findAndCountAll({
      where,
      order: [['id', 'DESC']],
      limit,
      offset,
    });

    return res.json({ total: count, limit, offset, logs: rows });
  } catch (err) {
    logger.error({ err: err.message }, 'GET /webapi-bps/logs failed');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
