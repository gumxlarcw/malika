'use strict';

const axios = require('axios');
const FetchLog = require('../../models/FetchLog.model');
const logger = require('../../utils/logger');
const { BPS_HEADERS, BPS_TIMEOUT_MS } = require('./bpsHeaders');

const DEFAULT_MAX_ATTEMPTS = 4;        // initial + 3 retries (preserves prior contract)
const BACKOFF_BASE_MS      = 1000;     // 1s → 2s → 4s
const BACKOFF_JITTER_RATIO = 0.2;      // ±20% — avoid thundering herd on shared WAF

const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'ENOTFOUND',
]);

// Skip real waits during jest runs — keeps retry tests sub-second.
const IS_TEST = process.env.NODE_ENV === 'test';

function isRetryable(err) {
  // WAF challenge HTML: hammering escalates the block. Fail fast.
  if (err && err.code === 'WAF_HTML_RESPONSE') return false;

  const status = err && err.response && err.response.status;
  if (status) {
    // Transient: server-side errors, request timeout, rate limit.
    // Permanent: 4xx (auth/not-found/validation) — retrying won't fix the request.
    return status >= 500 || status === 408 || status === 429;
  }

  // No HTTP response → network-layer error.
  if (err && err.code && RETRYABLE_NETWORK_CODES.has(err.code)) return true;

  // Unknown shape with no status: assume retryable (e.g. plain Error from axios).
  return !status;
}

function computeBackoffMs(attempt) {
  const base = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
  const jitter = base * BACKOFF_JITTER_RATIO * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function looksLikeHtmlResponse(response) {
  const ct = response && response.headers && response.headers['content-type'];
  if (ct && /text\/html/i.test(ct)) return true;
  const body = response && response.data;
  return typeof body === 'string' && body.trim().startsWith('<');
}

async function fetchAPI(url, source_id = null, maxAttempts = DEFAULT_MAX_ATTEMPTS) {
  const errors = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.get(url, {
        headers: BPS_HEADERS,
        timeout: BPS_TIMEOUT_MS,
      });

      if (looksLikeHtmlResponse(response)) {
        const wafErr = new Error('Invalid response: HTML received instead of JSON');
        wafErr.code = 'WAF_HTML_RESPONSE';
        throw wafErr;
      }

      await FetchLog.create({
        source_id,
        status_code: response.status,
        message: 'OK',
      });
      return response.data;

    } catch (err) {
      errors.push({
        attempt,
        status: err.response?.status,
        code: err.code,
        message: err.message,
      });

      const canRetry = attempt < maxAttempts && isRetryable(err);
      if (!canRetry) {
        const summary = errors
          .map(e => `[${e.attempt}] ${e.status || e.code || 'ERR'}: ${e.message}`)
          .join(' | ');
        await FetchLog.create({
          source_id,
          status_code: err.response?.status || 500,
          message: summary,
        });
        logger.error({ url, errors }, 'Fetch failed (final)');
        throw err;
      }

      const delayMs = IS_TEST ? 0 : computeBackoffMs(attempt);
      logger.warn(
        {
          url,
          attempt,
          nextAttempt: attempt + 1,
          delayMs,
          errorCode: err.code,
          status: err.response?.status,
        },
        'Retrying fetch'
      );
      if (delayMs > 0) await sleep(delayMs);
    }
  }
}

module.exports = { fetchAPI, isRetryable, computeBackoffMs };
