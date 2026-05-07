/**
 * Cost & Token Tracker for OpenAI API calls.
 *
 * Tracks per-model token usage and estimated costs across all LLM calls.
 * Data is kept in-memory with periodic log flushes (no DB dependency).
 *
 * Usage:
 *   const { costTracker } = require('../utils/costTracker');
 *   costTracker.record({ model, usage: { prompt_tokens, completion_tokens, ... }, purpose, latencyMs });
 *   costTracker.snapshot();             // { models: {...}, total: {...} }
 *   costTracker.snapshotAndReset();     // snapshot + reset counters
 */

'use strict';

// ── Pricing table (USD per 1M tokens, as of 2026-02) ────────────────────

const MODEL_PRICING = {
  // Gemini models (free tier — $0 cost)
  'gemini-3-flash-preview': { input: 0, output: 0, cachedInput: 0 },
  'gemini-3-pro-preview':   { input: 0, output: 0, cachedInput: 0 },
  'gemini-2.5-flash':       { input: 0, output: 0, cachedInput: 0 },
  'gemini-2.0-flash':       { input: 0, output: 0, cachedInput: 0 },
  // Legacy OpenAI (kept for reference)
  'gpt-4.1-mini': { input: 0.40, output: 1.60, cachedInput: 0.10 },
  'gpt-4.1-nano': { input: 0.10, output: 0.40, cachedInput: 0.025 },
  'gpt-4.1':      { input: 2.00, output: 8.00, cachedInput: 0.50 },
  'o4-mini':      { input: 1.10, output: 4.40, cachedInput: 0.275 },
  // Embedding models (per dimension-adjusted token)
  'text-embedding-3-small': { input: 0.02, output: 0, cachedInput: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0, cachedInput: 0 },
};

const DEFAULT_PRICING = { input: 1.00, output: 4.00, cachedInput: 0.25 };

// ── Tracker class ────────────────────────────────────────────────────────

class CostTracker {
  constructor() {
    this._models = {};     // { [model]: { calls, inputTokens, outputTokens, cachedTokens, reasoningTokens, totalCost, latencyMs } }
    this._purposes = {};   // { [purpose]: { calls, totalCost } }
    this._startedAt = Date.now();
    this._totalCalls = 0;
    this._totalCost = 0;
    this._totalLatency = 0;

    // Auto-log every 5 minutes (non-blocking)
    this._logInterval = setInterval(() => this._autoLog(), 5 * 60 * 1000);
    if (this._logInterval.unref) this._logInterval.unref();
  }

  /**
   * Record an LLM API call's token usage and cost.
   *
   * @param {Object} opts
   * @param {string} opts.model           - Model name (e.g. 'gpt-4.1-mini')
   * @param {Object} opts.usage           - OpenAI usage object
   * @param {number} [opts.usage.prompt_tokens]
   * @param {number} [opts.usage.completion_tokens]
   * @param {number} [opts.usage.cached_tokens]       - Prompt cache hits
   * @param {number} [opts.usage.reasoning_tokens]    - o-series reasoning tokens
   * @param {string} [opts.purpose]       - Call purpose (e.g. 'query_builder', 'reranker', 'chat')
   * @param {number} [opts.latencyMs]     - Round-trip latency in ms
   */
  record({ model, usage, purpose, latencyMs }) {
    if (!model || !usage) return;

    const pricing = MODEL_PRICING[model] || DEFAULT_PRICING;
    const inputTokens = usage.prompt_tokens || usage.promptTokens || 0;
    const outputTokens = usage.completion_tokens || usage.completionTokens || 0;
    const cachedTokens = usage.cached_tokens || usage.cachedTokens || 0;
    const reasoningTokens = usage.reasoning_tokens || usage.reasoningTokens || 0;

    // Cost calculation: cached input tokens use lower rate
    const freshInputTokens = Math.max(0, inputTokens - cachedTokens);
    const inputCost = (freshInputTokens * pricing.input + cachedTokens * pricing.cachedInput) / 1_000_000;
    const outputCost = (outputTokens * pricing.output) / 1_000_000;
    const totalCost = inputCost + outputCost;

    // Model-level aggregation
    if (!this._models[model]) {
      this._models[model] = {
        calls: 0, inputTokens: 0, outputTokens: 0,
        cachedTokens: 0, reasoningTokens: 0,
        totalCost: 0, latencyMs: 0,
      };
    }
    const m = this._models[model];
    m.calls++;
    m.inputTokens += inputTokens;
    m.outputTokens += outputTokens;
    m.cachedTokens += cachedTokens;
    m.reasoningTokens += reasoningTokens;
    m.totalCost += totalCost;
    m.latencyMs += latencyMs || 0;

    // Purpose-level aggregation
    if (purpose) {
      if (!this._purposes[purpose]) {
        this._purposes[purpose] = { calls: 0, totalCost: 0, latencyMs: 0 };
      }
      const p = this._purposes[purpose];
      p.calls++;
      p.totalCost += totalCost;
      p.latencyMs += latencyMs || 0;
    }

    // Totals
    this._totalCalls++;
    this._totalCost += totalCost;
    this._totalLatency += latencyMs || 0;
  }

  /**
   * Get current aggregated stats without resetting.
   */
  snapshot() {
    const uptimeMs = Date.now() - this._startedAt;
    return {
      uptimeMs,
      totalCalls: this._totalCalls,
      totalCostUSD: round6(this._totalCost),
      avgLatencyMs: this._totalCalls > 0 ? Math.round(this._totalLatency / this._totalCalls) : 0,
      models: Object.fromEntries(
        Object.entries(this._models).map(([k, v]) => [k, {
          ...v,
          totalCost: round6(v.totalCost),
          avgLatencyMs: v.calls > 0 ? Math.round(v.latencyMs / v.calls) : 0,
        }])
      ),
      purposes: Object.fromEntries(
        Object.entries(this._purposes).map(([k, v]) => [k, {
          ...v,
          totalCost: round6(v.totalCost),
          avgLatencyMs: v.calls > 0 ? Math.round(v.latencyMs / v.calls) : 0,
        }])
      ),
    };
  }

  /**
   * Get snapshot and reset all counters.
   */
  snapshotAndReset() {
    const snap = this.snapshot();
    this._models = {};
    this._purposes = {};
    this._totalCalls = 0;
    this._totalCost = 0;
    this._totalLatency = 0;
    this._startedAt = Date.now();
    return snap;
  }

  /** @private */
  _autoLog() {
    if (this._totalCalls === 0) return;
    const snap = this.snapshot();
    // Use console.log for lightweight always-on logging
    console.log('[CostTracker]', JSON.stringify({
      calls: snap.totalCalls,
      cost_usd: snap.totalCostUSD,
      avg_latency_ms: snap.avgLatencyMs,
      uptime_min: Math.round(snap.uptimeMs / 60000),
      models: Object.fromEntries(
        Object.entries(snap.models).map(([k, v]) => [k, `${v.calls} calls, $${v.totalCost}`])
      ),
    }));
  }
}

function round6(n) {
  return Math.round(n * 1_000_000) / 1_000_000;
}

// Singleton
const costTracker = new CostTracker();

module.exports = { costTracker, CostTracker, MODEL_PRICING };
