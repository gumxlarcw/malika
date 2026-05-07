const { nowUnix } = require('./dateHelper');

/**
 * Simple metrics collector for observability
 * Tracks request times, token usage, cache hits, errors
 */

class MetricsCollector {
  constructor() {
    this.metrics = this._createEmptyMetrics();
    this.startTime = nowUnix();
  }

  _createEmptyMetrics() {
    return {
      chatRequests: { count: 0, totalDuration: 0, maxDuration: 0 },
      streamingRequests: { count: 0, totalDuration: 0 },
      nonStreamingRequests: { count: 0, totalDuration: 0 },
      openaiCalls: { count: 0, totalTokens: 0, failures: 0 },
      cacheHits: { count: 0 },
      cacheMisses: { count: 0 },
      vectorSearches: { count: 0, totalDuration: 0 },
      errors: { count: 0, byCode: {} },
      circuitBreaker: { openCount: 0 },
    };
  }

  /**
   * Record a chat request completion
   * @param {number} durationMs - Request duration
   * @param {boolean} isStreaming - Whether streaming or not
   */
  recordChatRequest(durationMs, isStreaming = true) {
    this.metrics.chatRequests.count++;
    this.metrics.chatRequests.totalDuration += durationMs;
    this.metrics.chatRequests.maxDuration = Math.max(
      this.metrics.chatRequests.maxDuration, 
      durationMs
    );

    if (isStreaming) {
      this.metrics.streamingRequests.count++;
      this.metrics.streamingRequests.totalDuration += durationMs;
    } else {
      this.metrics.nonStreamingRequests.count++;
      this.metrics.nonStreamingRequests.totalDuration += durationMs;
    }
  }

  /**
   * Record an OpenAI API call
   * @param {number} tokensUsed - Tokens consumed
   * @param {boolean} success - Whether call succeeded
   */
  recordOpenAICall(tokensUsed = 0, success = true) {
    this.metrics.openaiCalls.count++;
    this.metrics.openaiCalls.totalTokens += tokensUsed;
    if (!success) {
      this.metrics.openaiCalls.failures++;
    }
    try {
      // Best-effort: Prometheus counters
      const { recordOpenAICallProm } = require('./prometheus');
      recordOpenAICallProm(success);
    } catch (_) {
      // Ignore if prom-client not available
    }
  }

  /**
   * Record a cache hit
   */
  recordCacheHit() {
    this.metrics.cacheHits.count++;
    try {
      const { recordCacheHitProm } = require('./prometheus');
      recordCacheHitProm();
    } catch (_) {
      // Ignore if prom-client not available
    }
  }

  /**
   * Record a cache miss
   */
  recordCacheMiss() {
    this.metrics.cacheMisses.count++;
    try {
      const { recordCacheMissProm } = require('./prometheus');
      recordCacheMissProm();
    } catch (_) {
      // Ignore if prom-client not available
    }
  }

  /**
   * Record a vector search
   * @param {number} durationMs - Search duration
   */
  recordVectorSearch(durationMs) {
    this.metrics.vectorSearches.count++;
    this.metrics.vectorSearches.totalDuration += durationMs;
  }

  /**
   * Record an error
   * @param {string} code - Error code
   */
  recordError(code = 'UNKNOWN') {
    this.metrics.errors.count++;
    this.metrics.errors.byCode[code] = (this.metrics.errors.byCode[code] || 0) + 1;
    try {
      const { recordErrorProm } = require('./prometheus');
      recordErrorProm(code);
    } catch (_) {
      // Ignore if prom-client not available
    }
  }

  /**
   * Record circuit breaker open event
   */
  recordCircuitOpen() {
    this.metrics.circuitBreaker.openCount++;
  }

  /**
   * Get aggregated stats
   * @returns {object}
   */
  getStats() {
    const m = this.metrics;
    const uptime = nowUnix() - this.startTime;

    const avgChatDuration = m.chatRequests.count > 0
      ? Math.round(m.chatRequests.totalDuration / m.chatRequests.count)
      : 0;

    const cacheTotal = m.cacheHits.count + m.cacheMisses.count;
    const cacheHitRate = cacheTotal > 0
      ? ((m.cacheHits.count / cacheTotal) * 100).toFixed(1) + '%'
      : 'N/A';

    const avgVectorSearch = m.vectorSearches.count > 0
      ? Math.round(m.vectorSearches.totalDuration / m.vectorSearches.count)
      : 0;

    return {
      uptime: Math.round(uptime / 1000) + 's',
      chatRequests: m.chatRequests.count,
      avgResponseTimeMs: avgChatDuration,
      maxResponseTimeMs: m.chatRequests.maxDuration,
      streamingRequests: m.streamingRequests.count,
      nonStreamingRequests: m.nonStreamingRequests.count,
      openaiCalls: m.openaiCalls.count,
      openaiFailures: m.openaiCalls.failures,
      totalTokensUsed: m.openaiCalls.totalTokens,
      cacheHitRate,
      avgVectorSearchMs: avgVectorSearch,
      errorCount: m.errors.count,
      errorsByCode: { ...m.errors.byCode },
      circuitBreakerOpens: m.circuitBreaker.openCount,
    };
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.metrics = this._createEmptyMetrics();
    this.startTime = nowUnix();
  }
}

// Singleton instance
const metrics = new MetricsCollector();

// Log stats every 5 minutes in production
if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    const stats = metrics.getStats();
    if (stats.chatRequests > 0) {
      console.log('[Metrics]', JSON.stringify(stats));
    }
  }, 5 * 60 * 1000).unref();
}

module.exports = {
  MetricsCollector,
  metrics,
};
