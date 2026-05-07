/**
 * Agent Protocol — Shared I/O contracts for Pipeline V2 sub-agents.
 *
 * All Layer 2/3 agents conform to the same input/output shape so the
 * orchestrator (pipelineV2.service.js) can run them uniformly.
 *
 * @module agentProtocol
 */

'use strict';

const logger = require('../../../../utils/logger').child({ service: 'AgentProtocol' });

// ── Agent Input ──────────────────────────────────────────────────────────

/**
 * @typedef {Object} AgentInput
 * @property {string}  query          - Effective/normalized query text
 * @property {string}  rawQuery       - Original user message (unmerged)
 * @property {object}  gate           - Gate agent result (route, hints, skipFlags)
 * @property {object}  context        - Context loader result (history, prevUiMeta, topic, memory)
 * @property {object}  norm           - Normalizer result (yearInference, geoInference, normalizedQuery)
 * @property {object}  [dna]          - DNA enrichment result (dnaContext, dnaEnrichedQuery)
 * @property {object}  sse            - SSE handler for status events
 * @property {number}  threadId       - Thread ID
 * @property {string}  ownerId        - Owner UID
 * @property {string}  [modelOverride] - User-selected model override
 * @property {AbortSignal} [signal]   - Abort signal for cancellation
 */

/**
 * Build a validated AgentInput from pipeline context.
 *
 * @param {object} ctx - Pipeline V2 context
 * @returns {AgentInput}
 */
function buildAgentInput(ctx) {
  const input = {
    query: ctx.normalizedQuery || ctx.effectiveQuery || ctx.userMessage,
    rawQuery: ctx.userMessage,
    effectiveQuery: ctx.effectiveQuery || ctx.userMessage,
    gate: ctx.gate || {},
    context: {
      historyArray: ctx.historyArray || [],
      prevUiMeta: ctx.prevUiMeta || null,
      conversationTopic: ctx.conversationTopic || null,
      memoryContext: ctx.memoryContext || null,
      thread: ctx.thread || null,
    },
    norm: {
      normalizedQuery: ctx.normalizedQuery || ctx.effectiveQuery,
      yearInference: ctx.yearInference || null,
      geoInference: ctx.geoInference || null,
      dnaEnrichedQuery: ctx.dnaEnrichedQuery || null,
      dnaContext: ctx.dnaContext || null,
      dnaResults: ctx.dnaResults || null,
    },
    sse: ctx.sse,
    threadId: ctx.threadId,
    ownerId: ctx.ownerId,
    modelOverride: ctx.modelOverride || null,
    signal: ctx.sse?.abortController?.signal || null,
    // Pass-through flags from context stage
    _shouldPreferPrevCandidates: ctx._shouldPreferPrevCandidates || false,
    _wasKnowledgeMode: ctx._wasKnowledgeMode || false,
    _usedFastPath: ctx._usedFastPath || false,
  };
  return input;
}

// ── Agent Output ──────────────────────────────────────────────────────────

/**
 * @typedef {Object} AgentOutput
 * @property {string}  agent         - Agent name (e.g. 'datasource', 'publication', 'nonstat')
 * @property {boolean} ok            - Whether agent completed successfully
 * @property {number}  latencyMs     - Total agent execution time
 * @property {object}  data          - Agent-specific result data
 * @property {string}  [error]       - Error message if !ok
 * @property {object}  [timings]     - Sub-step timings within the agent
 */

/**
 * Create a successful agent output.
 *
 * @param {string} agent - Agent name
 * @param {object} data - Result data
 * @param {object} [opts] - Optional fields
 * @param {number} [opts.latencyMs]
 * @param {object} [opts.timings]
 * @returns {AgentOutput}
 */
function okResult(agent, data, opts = {}) {
  return {
    agent,
    ok: true,
    latencyMs: opts.latencyMs || 0,
    data: data || {},
    timings: opts.timings || {},
  };
}

/**
 * Create a failed agent output.
 *
 * @param {string} agent - Agent name
 * @param {Error|string} error - Error
 * @param {object} [opts]
 * @param {number} [opts.latencyMs]
 * @returns {AgentOutput}
 */
function failResult(agent, error, opts = {}) {
  const msg = typeof error === 'string' ? error : (error?.message || 'Unknown error');
  logger.warn({ agent, error: msg, latencyMs: opts.latencyMs }, `Agent ${agent} failed`);
  return {
    agent,
    ok: false,
    latencyMs: opts.latencyMs || 0,
    data: {},
    error: msg,
  };
}

/**
 * Unwrap a Promise.allSettled result into an AgentOutput.
 * If the promise was rejected, returns a failResult.
 *
 * @param {PromiseSettledResult} settled - From Promise.allSettled
 * @param {string} agentName - Fallback agent name if result lacks one
 * @returns {AgentOutput}
 */
function unwrapSettled(settled, agentName) {
  if (settled.status === 'fulfilled') {
    return settled.value;
  }
  return failResult(agentName, settled.reason);
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Send a status event from an agent (prefixed with agent name).
 *
 * @param {object} sse - SSE handler
 * @param {string} stage - Stage identifier
 * @param {string} message - Status message
 * @param {object} [extra] - Extra fields
 */
function agentStatus(sse, stage, message, extra = {}) {
  if (!sse?.isClientConnected?.()) return;
  sse.sendEvent('status', { message, stage, ...extra });
}

/**
 * Send a status_detail event from an agent.
 */
function agentDetail(sse, stage, detail, extra = {}) {
  if (!sse?.isClientConnected?.()) return;
  sse.sendEvent('status_detail', { stage, detail, ...extra });
}

/**
 * Send a thinking item from an agent.
 */
function agentThinking(sse, item) {
  if (!sse?.isClientConnected?.()) return;
  sse.sendEvent('thinking', item, { flush: false });
}

module.exports = {
  buildAgentInput,
  okResult,
  failResult,
  unwrapSettled,
  agentStatus,
  agentDetail,
  agentThinking,
};
