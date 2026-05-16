'use strict';

const axios = require('axios');
const http = require('http');
const https = require('https');
const logger = require('../../../utils/logger').child({ service: 'OpenAIClient' });
const { openAICircuit } = require('../../../utils/circuitBreaker');
const { metrics } = require('../../../utils/metrics');
const { countTokens, countTextTokens } = require('../../../utils/tokenizer');
const { getNextKey, markRateLimited } = require('./geminiKeyRotation');

// Proxy-only rule (2026-05-16): see backend/src/utils/requireProxyUrl.js
const OPENAI_API_BASE_URL = require('../../../utils/requireProxyUrl')(
  'ai/client/openaiClient', 'OPENAI_API_BASE_URL'
);
// Embeddings still need real OpenAI API (Copilot proxy doesn't support embeddings)
const OPENAI_EMBEDDINGS_URL = process.env.OPENAI_EMBEDDINGS_BASE_URL || 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT_MS = 60_000; // Increased for gpt-5-mini
const DEFAULT_RETRIES = 2;

// Keep-alive agents for connection reuse (backend → proxy on localhost)
const httpKeepAliveAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 30,       // match proxy semaphore headroom
  maxFreeSockets: 10,
});
const httpsKeepAliveAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 30,
  maxFreeSockets: 10,
});

function getOpenAiApiKey(envKeyName) {
  // For embeddings, always use the dedicated OpenAI key
  if (envKeyName === 'OPENAI_API_KEY_EMBEDDINGS') {
    const v = process.env[envKeyName];
    return v && String(v).trim() ? String(v).trim() : null;
  }
  // For all other calls (chat/completion), use rotating Gemini keys
  return getNextKey();
}

function estimateTokensFromPayload(payload) {
  if (!payload) return 0;
  try {
    return countTokens(payload);
  } catch (err) {
    return 0;
  }
}

async function requestOpenAI({ apiKeyEnv, endpoint, payload, timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES, responseType = 'json', baseUrl, skipCircuitBreaker = false }) {
  const apiKey = getOpenAiApiKey(apiKeyEnv);
  if (!apiKey) {
    const err = new Error(`Missing ${apiKeyEnv} env`);
    err.statusCode = 503;
    err.code = 'OPENAI_DISABLED';
    throw err;
  }

  if (!skipCircuitBreaker && openAICircuit.isOpen()) {
    metrics.recordCircuitOpen();
    const error = new Error('OpenAI service temporarily unavailable');
    error.code = 'CIRCUIT_OPEN';
    error.retryAfter = Math.max(0, openAICircuit.nextAttemptTime - Date.now());
    throw error;
  }

  const tokensUsed = estimateTokensFromPayload(payload);
  const url = `${baseUrl || OPENAI_API_BASE_URL}${endpoint}`;

  let lastError;
  const startTime = Date.now();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      logger.debug({ endpoint, attempt: attempt + 1, maxAttempts: retries + 1 }, 'OpenAI request start');
      const response = await axios.post(url, payload, {
        timeout: timeoutMs,
        responseType,
        httpAgent: httpKeepAliveAgent,
        httpsAgent: httpsKeepAliveAgent,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!skipCircuitBreaker) openAICircuit.onSuccess();
      metrics.recordOpenAICall(tokensUsed, true);
      logger.debug({ endpoint, status: response.status, durationMs: Date.now() - startTime }, 'OpenAI request success');
      return response;
    } catch (err) {
      lastError = err;
      if (!skipCircuitBreaker) openAICircuit.onFailure();

      const status = err?.response?.status;
      const message = err?.response?.data?.error?.message || err?.message || 'OpenAI error';
      logger.warn({ endpoint, status, attempt: attempt + 1, maxAttempts: retries + 1, error: message }, 'OpenAI request failed');

      // Mark key as rate-limited on 429 and rotate to next key
      if (status === 429 && apiKey) {
        markRateLimited(apiKey);
      }

      if (attempt < retries) {
        const backoffMs = 1000 * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }

  metrics.recordOpenAICall(tokensUsed, false);
  throw lastError;
}

async function chatCompletion({ apiKeyEnv, payload, timeoutMs, retries, skipCircuitBreaker }) {
  const response = await requestOpenAI({
    apiKeyEnv,
    endpoint: '/chat/completions',
    payload,
    timeoutMs,
    retries,
    skipCircuitBreaker,
  });
  return response.data;
}

async function embedding({ apiKeyEnv, payload, timeoutMs, retries }) {
  // Embeddings use real OpenAI API (not copilot proxy)
  const apiKey = getOpenAiApiKey(apiKeyEnv || 'OPENAI_API_KEY_EMBEDDINGS');
  if (!apiKey || apiKey === 'copilot-proxy') {
    // Try the dedicated embeddings key
    const embKey = getOpenAiApiKey('OPENAI_API_KEY_EMBEDDINGS');
    if (!embKey) {
      const err = new Error('Missing OPENAI_API_KEY_EMBEDDINGS env for embeddings');
      err.statusCode = 503;
      err.code = 'OPENAI_DISABLED';
      throw err;
    }
    // Call directly with embeddings key and real OpenAI URL
    const url = `${OPENAI_EMBEDDINGS_URL}/embeddings`;
    const response = await axios.post(url, payload, {
      timeout: timeoutMs || DEFAULT_TIMEOUT_MS,
      httpAgent: httpKeepAliveAgent,
      httpsAgent: httpsKeepAliveAgent,
      headers: {
        Authorization: `Bearer ${embKey}`,
        'Content-Type': 'application/json',
      },
    });
    return response.data;
  }
  const response = await requestOpenAI({
    apiKeyEnv,
    endpoint: '/embeddings',
    payload,
    timeoutMs,
    retries,
    baseUrl: OPENAI_EMBEDDINGS_URL,
  });
  return response.data;
}

async function streamChat({ apiKeyEnv, payload, timeoutMs, retries }) {
  const response = await requestOpenAI({
    apiKeyEnv,
    endpoint: '/chat/completions',
    payload,
    timeoutMs,
    retries,
    responseType: 'stream',
  });
  return response;
}

module.exports = {
  chatCompletion,
  embedding,
  streamChat,
  countTokens,
};
