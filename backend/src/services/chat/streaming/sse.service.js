/**
 * SSE Service
 *
 * Centralized SSE connection handling with cleanup and heartbeat.
 */

'use strict';

const logger = require('../../../utils/logger').child({ service: 'SSE' });
const { nowUnix } = require('../../../utils/dateHelper');
const { SSE: SSE_CONFIG } = require('./config');

/**
 * Create an SSE handler for an Express response.
 * @param {object} params
 * @param {object} params.res - Express response
 * @param {string|number} [params.threadId]
 * @param {number} [params.heartbeatMs]
 */
function createSSEHandler({ res, threadId, heartbeatMs = SSE_CONFIG.HEARTBEAT_MS }) {
  let isClientConnected = true;
  const abortController = new AbortController();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const onClose = () => {
    isClientConnected = false;
    abortController.abort();
    logger.debug({ threadId }, 'Client disconnected from SSE');
  };

  const onError = (err) => {
    isClientConnected = false;
    abortController.abort();
    logger.warn({ threadId, error: err.message }, 'SSE connection error');
  };

  res.on('close', onClose);
  res.on('error', onError);

  const sendEvent = (event, data, { flush: shouldFlush = true } = {}) => {
    if (!isClientConnected) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      // Flush immediately to push through compression middleware (skip for batched events)
      if (shouldFlush && typeof res.flush === 'function') res.flush();
    } catch (err) {
      isClientConnected = false;
      logger.debug({ event, error: err.message }, 'Failed to write SSE event');
    }
  };

  let heartbeatId = null;
  if (heartbeatMs && Number.isFinite(heartbeatMs) && heartbeatMs > 0) {
    heartbeatId = setInterval(() => {
      if (!isClientConnected) return;
      sendEvent('heartbeat', { ts: nowUnix() });
    }, heartbeatMs);
  }

  const end = () => {
    isClientConnected = false;
    if (heartbeatId) clearInterval(heartbeatId);
    res.removeListener('close', onClose);
    res.removeListener('error', onError);
    try {
      res.end();
    } catch (e) {
      // no-op
    }
  };

  return {
    sendEvent,
    end,
    isClientConnected: () => isClientConnected,
    abortController,
  };
}

module.exports = {
  createSSEHandler,
};
