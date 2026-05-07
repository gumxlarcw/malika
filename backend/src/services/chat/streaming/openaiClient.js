/**
 * OpenAI Client (Streaming)
 *
 * Centralized OpenAI fetch utilities with timeout, retry, and circuit breaker.
 */

'use strict';

const logger = require('../../../utils/logger').child({ service: 'OpenAIClient' });
const { openAICircuit } = require('../../../utils/circuitBreaker');
const { metrics } = require('../../../utils/metrics');
const { OPENAI } = require('./config');
const { countTokens, countTextTokens } = require('../../../utils/tokenizer');

const OPENAI_API_URL = OPENAI.API_URL;
const DEFAULT_TIMEOUT_MS = OPENAI.TIMEOUT_MS;
const DEFAULT_RETRIES = OPENAI.RETRIES;

function estimateTokensFromBody(body) {
  if (!body) return 0;
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return countTokens(parsed);
    } catch {
      return countTextTokens(body);
    }
  }
  if (typeof body === 'object') {
    return countTokens(body);
  }
  return 0;
}

/**
 * Fetch with timeout support.
 *
 * If `options.signal` is supplied by the caller, it is passed straight through
 * to `fetch` (preserving identity). Otherwise an internal AbortController is
 * created and aborted after `timeoutMs`.
 *
 * Note on the caller-signal path: on timeout, the in-flight `fetch()` is not
 * aborted — `Promise.race` just rejects the await. The leaked request finishes
 * or dies on TCP close. Accepted tradeoff because all callers currently hit a
 * localhost proxy at :3031 with a 30 s timeout; a combined-signal via
 * `AbortSignal.any` would be cleaner but breaks callers that rely on strict
 * signal identity on `fetch`.
 */
async function fetchWithTimeout(url, options, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (options && options.signal) {
    // Caller owns the abort lifecycle. Still enforce a soft timeout by racing.
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    try {
      const resp = await Promise.race([fetch(url, options), timeoutPromise]);
      clearTimeout(timeoutId);
      return resp;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs}ms`);
      }
      throw err;
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return resp;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw err;
  }
}

/**
 * Sleep that respects AbortController signal
 * @param {number} ms - Milliseconds to sleep
 * @param {AbortSignal} [signal] - Optional abort signal
 * @returns {Promise<void>}
 */
function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException('Aborted', 'AbortError'));
    }
    const timeoutId = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Fetch OpenAI with retry, exponential backoff, and circuit breaker
 * @param {Object} options - Fetch options (must include headers with Authorization)
 * @param {number} retries - Number of retries (default 2)
 * @param {number} timeoutMs - Timeout in ms (default 30000)
 * @returns {Promise<Response>}
 */
async function fetchOpenAIWithRetry(options, retries = DEFAULT_RETRIES, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (openAICircuit.isOpen()) {
    metrics.recordCircuitOpen();
    const error = new Error('OpenAI service temporarily unavailable');
    error.code = 'CIRCUIT_OPEN';
    error.retryAfter = Math.max(0, openAICircuit.nextAttemptTime - Date.now());
    throw error;
  }

  const tokensUsed = estimateTokensFromBody(options?.body);

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetchWithTimeout(OPENAI_API_URL, options, timeoutMs);

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => '');
        // .message is truncated to 200 chars for log ergonomics.
        // .body keeps up to 2000 chars for callers that need to parse proxy errors.
        const err = new Error(`OpenAI API error ${resp.status}: ${errorText.slice(0, 200)}`);
        err.status = resp.status;
        err.code = `HTTP_${resp.status}`;
        err.body = errorText.slice(0, 2000);
        throw err;
      }

      openAICircuit.onSuccess();
      metrics.recordOpenAICall(tokensUsed, true);
      return resp;
    } catch (err) {
      lastError = err;
      logger.warn({ attempt: attempt + 1, maxAttempts: retries + 1, error: err.message }, 'OpenAI request failed, retrying');

      openAICircuit.onFailure();

      // Client errors (4xx) are not transient — stop retrying.
      if (err.status && err.status >= 400 && err.status < 500) {
        throw err;
      }

      if (attempt < retries) {
        const backoffMs = 1000 * Math.pow(2, attempt);
        // Use abortable sleep to allow clean shutdown on client disconnect
        try {
          await abortableSleep(backoffMs, options?.signal);
        } catch (sleepErr) {
          // If aborted during sleep, stop retrying
          if (sleepErr.name === 'AbortError') {
            throw sleepErr;
          }
        }
      }
    }
  }

  metrics.recordOpenAICall(tokensUsed, false);
  throw lastError;
}

async function fetchOpenAI(options, retries = DEFAULT_RETRIES, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return fetchOpenAIWithRetry(options, retries, timeoutMs);
}

async function streamOpenAI(options, retries = DEFAULT_RETRIES, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return fetchOpenAIWithRetry(options, retries, timeoutMs);
}

/**
 * Send an OpenAI-compatible chat completion to the configured endpoint.
 *
 * Forwards `model`, `messages`, `stream`, and any of `temperature`, `max_tokens`,
 * `tools` that the caller provides. Returns a raw `Response`; for stream:true
 * callers read `resp.body` themselves.
 *
 * Error shape on reject:
 *   err.code     — 'HTTP_<status>' | 'CIRCUIT_OPEN' | 'AbortError'
 *   err.status   — numeric status when HTTP_*
 *   err.retryAfter — ms when CIRCUIT_OPEN
 */
async function chat({
  model,
  messages,
  stream = false,
  temperature,
  max_tokens,
  tools,
  signal,
  apiKey,
  timeoutMs,
  retries,
  extraHeaders = {},
} = {}) {
  if (!model || typeof model !== 'string') {
    throw new Error('chat: model is required (non-empty string)');
  }
  if (!Array.isArray(messages)) {
    throw new Error('chat: messages must be an array');
  }

  const body = { model, messages, stream };
  if (temperature !== undefined) body.temperature = temperature;
  if (max_tokens !== undefined)  body.max_tokens = max_tokens;
  if (tools !== undefined)       body.tools = tools;

  const key = apiKey || OPENAI.API_KEY;
  // extraHeaders is spread first so Authorization/Content-Type cannot be
  // silently overridden by a caller that happens to include those keys.
  const options = {
    method: 'POST',
    headers: {
      ...extraHeaders,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  };

  return fetchOpenAIWithRetry(options, retries, timeoutMs);
}

module.exports = {
  chat,
  fetchWithTimeout,
  fetchOpenAIWithRetry,
  fetchOpenAI,
  streamOpenAI,
  countTokens,
  abortableSleep,
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_MS,
};
