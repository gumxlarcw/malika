'use strict';

const axios = require('axios');
const crypto = require('crypto');
const WebapiHealthLog = require('../../models/WebapiHealthLog.model');
const { resolveBpsApiKey } = require('../pressrelease/apiKey.service');
const { bpsAPICircuit } = require('../../utils/circuitBreaker');
const { buildTargets, PROBE_HEADERS, PROBE_TIMEOUT_MS } = require('./probeTargets');
const logger = require('../../utils/logger').child({ service: 'WebapiBpsHealth' });

let probeMutex = false;

function _classifyResponse(resp) {
  const { status, data } = resp;

  if (typeof data === 'string' && data.trimStart().startsWith('<')) {
    return { ok: 0, errorCode: 'HTML_RESPONSE', errorMessage: 'WAF returned HTML' };
  }
  if (status === 401 || status === 403) {
    return { ok: 0, errorCode: 'AUTH_INVALID', errorMessage: `HTTP ${status}` };
  }
  if (status === 429) {
    return { ok: 0, errorCode: 'RATE_LIMITED', errorMessage: 'HTTP 429' };
  }
  if (status >= 500) {
    return { ok: 0, errorCode: 'HTTP_5XX', errorMessage: `HTTP ${status}` };
  }
  if (status >= 400) {
    return { ok: 0, errorCode: 'HTTP_4XX', errorMessage: `HTTP ${status}` };
  }
  if (status >= 200 && status < 300) {
    return { ok: 1, errorCode: null, errorMessage: null };
  }
  return { ok: 0, errorCode: 'UNKNOWN_STATUS', errorMessage: `HTTP ${status}` };
}

function _classifyException(err) {
  if (err && err.code === 'ECONNABORTED') {
    return { ok: 0, errorCode: 'TIMEOUT', errorMessage: err.message };
  }
  return { ok: 0, errorCode: 'NETWORK', errorMessage: err.message || String(err) };
}

async function _probeOne(target, runId, probeKind) {
  const startedAt = Date.now();
  let classification;
  let httpStatus = null;
  let bytesReceived = null;

  try {
    const resp = await axios.get(target.url, {
      timeout: PROBE_TIMEOUT_MS,
      validateStatus: () => true,
      headers: PROBE_HEADERS,
      responseType: 'json',
      transitional: { silentJSONParsing: false, forcedJSONParsing: false },
    });
    httpStatus = resp.status;
    bytesReceived = typeof resp.data === 'string'
      ? Buffer.byteLength(resp.data, 'utf8')
      : Buffer.byteLength(JSON.stringify(resp.data || ''), 'utf8');
    classification = _classifyResponse(resp);
  } catch (err) {
    classification = _classifyException(err);
  }

  const latencyMs = Date.now() - startedAt;

  try {
    await WebapiHealthLog.create({
      run_id: runId,
      probe_kind: probeKind,
      endpoint_family: target.family,
      url_template: target.urlTemplate,
      http_status: httpStatus,
      latency_ms: classification.ok ? latencyMs : (httpStatus ? latencyMs : null),
      ok: classification.ok,
      error_code: classification.errorCode,
      error_message: classification.errorMessage,
      bytes_received: bytesReceived,
    });
  } catch (dbErr) {
    logger.error({ family: target.family, err: dbErr.message }, 'Failed to persist probe row');
  }

  return {
    family: target.family,
    ok: classification.ok,
    latencyMs: classification.ok ? latencyMs : null,
    httpStatus,
    errorCode: classification.errorCode,
  };
}

async function runProbe({ trigger = 'scheduled' } = {}) {
  if (probeMutex) {
    return { skipped: true, reason: 'probe_already_running' };
  }
  probeMutex = true;

  const startTotal = Date.now();
  const runId = crypto.randomUUID();
  const probeKind = trigger === 'manual' ? 'manual' : (trigger === 'recovery' ? 'recovery' : 'scheduled');

  try {
    const apiKey = await resolveBpsApiKey();
    if (!apiKey) {
      return {
        runId,
        overall: 'UNKNOWN',
        error: 'API_KEY_MISSING',
        perFamily: [],
        durationMs: Date.now() - startTotal,
      };
    }

    const targets = buildTargets(apiKey);
    const settled = await Promise.allSettled(
      targets.map(t => _probeOne(t, runId, probeKind))
    );
    const perFamily = settled.map((s, i) => {
      if (s.status === 'fulfilled') return s.value;
      return { family: targets[i].family, ok: 0, latencyMs: null, httpStatus: null, errorCode: 'INTERNAL' };
    });

    const okCount = perFamily.filter(p => p.ok).length;
    const overall = okCount === perFamily.length ? 'UP'
                  : okCount === 0 ? 'DOWN'
                  : 'DEGRADED';

    if (overall === 'DOWN') {
      try { bpsAPICircuit.onFailure(); }
      catch (cbErr) { logger.warn({ err: cbErr.message }, 'bpsAPICircuit.onFailure threw'); }
    } else if (overall === 'UP') {
      try { bpsAPICircuit.onSuccess(); }
      catch (cbErr) { logger.warn({ err: cbErr.message }, 'bpsAPICircuit.onSuccess threw'); }
    }

    return {
      runId,
      overall,
      perFamily,
      durationMs: Date.now() - startTotal,
    };
  } finally {
    probeMutex = false;
  }
}

module.exports = {
  runProbe,
  _classifyResponse,
  _classifyException,
};
