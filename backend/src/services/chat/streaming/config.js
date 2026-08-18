/**
 * Streaming Service Configuration
 * 
 * Centralized configuration constants for the streaming chat service.
 * Extract hardcoded values here for easier maintenance and testing.
 */

// OpenAI API Configuration
const { now } = require('../../../utils/dateHelper');

// OpenAI API Configuration
const OPENAI = {
  API_URL: process.env.OPENAI_API_URL || 'http://127.0.0.1:3031/v1/chat/completions',
  API_KEY: process.env.OPENAI_API_KEY_CHAT
        || process.env.OPENAI_API_KEY_INTERPRETATION
        || process.env.OPENAI_API_KEY_QUERY_BUILDER
        || '',
  TIMEOUT_MS: 90000,           // Default timeout for API calls (increased for gpt-5-mini)
  GREETING_TIMEOUT_MS: 30000,  // Shorter timeout for simple greetings
  REASONING_TIMEOUT_MS: 120000, // Longer timeout for reasoning models
  RETRIES: 2,                  // Number of retry attempts
  // Defaults name the single Sonnet lane the proxy actually serves. The old
  // 'gpt-4.1' defaults predate the proxy-only rule and pointed at a model no
  // tier in the chain can answer as.
  MODEL: process.env.OPENAI_MODEL_CHAT || 'claude-sonnet-4-6',
  MODEL_REASONING: process.env.OPENAI_MODEL_REASONING || 'claude-sonnet-4-6',
  TEMPERATURE: {
    DEFAULT: 0.3,
    GREETING: 0.7,
    CREATIVE: 0.5,
  },
  MAX_TOKENS: {
    DEFAULT: 3000,             // Standard chat response (upgraded for gpt-4.1)
    GREETING: 300,             // Short greeting messages (synced with TIER_CONFIG H5 fix)
    LONG: 5000,                // Extended responses (complex queries)
    SHORT: 500,                // Brief responses
    REASONING: 8000,           // Reasoning model responses (deep analysis)
  },
};

// Data Processing Limits
const DATA = {
  MIN_ROWS_FOR_PREVIEW: 1,   // Minimum rows needed for valid preview
  // Note: MAX_ROWS/MAX_COLUMNS removed - full table data is now returned
};

// Year/Period Configuration
const PERIOD = {
  MIN_ACCEPTABLE_YEAR_OFFSET: 2,  // How many years back is acceptable (currentYear - offset)
  DEFAULT_YEAR: now().getFullYear(),
  MONTHS_IN_YEAR: 12,
};

// Similarity Thresholds for Vector Search
const SIMILARITY = {
  DATASOURCE: 0.40,          // Datasource matching threshold
  KNOWLEDGE: 0.35,           // Knowledge base matching threshold
  BRS: 0.45,                 // BRS/Press release matching threshold
  PUBLICATION: 0.40,         // Publication matching threshold
};

// Context Detection
const CONTEXT = {
  MAX_HISTORY_MESSAGES: 50,  // Maximum messages to include in context (increased from 10)
  SHORT_FOLLOWUP_MAX_WORDS: 4,  // Max words for short follow-up detection
  CONFIRM_KEYWORDS: ['ya', 'iya', 'yup', 'ok', 'oke', 'lanjut', 'boleh', 'silakan', 'silahkan'],
};

// Compaction Settings (OpenClaw-inspired memory management)
const COMPACTION = {
  ENABLED: process.env.CHAT_COMPACTION_ENABLED !== 'false',  // Default: enabled
  TRIGGER_AFTER: 40,           // Trigger compaction when message count exceeds this
  SUMMARIZE_COUNT: 25,         // How many oldest messages to summarize
  MODEL: process.env.OPENAI_MODEL_COMPACTION || 'claude-sonnet-4-6',
  TEMPERATURE: 0.2,            // Low temperature for factual summary
  MAX_TOKENS: 3000,             // Max tokens for summary response (maximized for less lossy compaction)
  TIMEOUT_MS: 45000,           // Timeout for compaction LLM call (increased for gpt-5-mini)
  DELETE_AFTER_COMPACT: true,  // Delete summarized messages to save DB space
};

// Feature Flags (can be overridden by env vars)
const FEATURES = {
  USE_EVENTSOURCE_PARSER: process.env.USE_EVENTSOURCE_PARSER === 'true',
  ENABLE_KNOWLEDGE_PATTERNS: true,
  ENABLE_ERROR_LEARNING: true,
  ENABLE_QUERY_NORMALIZER: true,
  ENABLE_YEAR_INFERENCE: true,
  ENABLE_GEO_INFERENCE: true,
  ENABLE_FAST_PATH: true,
  // OpenClaw-inspired: search past threads for similar context
  CROSS_THREAD_MEMORY: process.env.CROSS_THREAD_MEMORY !== 'false', // Default ON
};

// EXIM Datasource IDs — SINGLE SOURCE OF TRUTH
// These must match the data_sources table entries for EXIM ekspor/impor
const EXIM = {
  EKSPOR_SOURCE_ID: Number(process.env.EXIM_EKSPOR_SOURCE_ID) || 159,
  IMPOR_SOURCE_ID:  Number(process.env.EXIM_IMPOR_SOURCE_ID)  || 160,
};

// Internal API base URL (for self-calls like merge/preview)
const INTERNAL_API_BASE = process.env.INTERNAL_API_BASE_URL || 'http://localhost:5000';

// SSE (Server-Sent Events) Configuration
const SSE = {
  HEARTBEAT_MS: Number(process.env.SSE_HEARTBEAT_MS) || 15000,  // Keepalive interval (ms)
};

/**
 * Smart Context Sizing by Model Tier
 *
 * Prevents "lost in the middle" regression by matching context volume
 * to query complexity. Simple queries get focused context (fewer docs,
 * shorter extracts) so the LLM can attend to every detail.
 *
 * Used by: pipeline.service.js (pruning), vectorSearch.service.js (injection boost)
 * @see https://arxiv.org/abs/2307.03172 "Lost in the Middle"
 */
const SMART_CONTEXT = {
  greeting: { maxDocs: 0,  perDocChars: 0,      totalBudget: 20_000 },
  simple:   { maxDocs: 5,  perDocChars: 15_000,  totalBudget: 120_000 },
  complex:  { maxDocs: 7,  perDocChars: 25_000,  totalBudget: 200_000 },
  deep:     { maxDocs: 10, perDocChars: 80_000,  totalBudget: 400_000 },
};

// Derived: minimum maxDocs across all active tiers (used for injection boost targeting)
const MIN_ACTIVE_MAX_DOCS = Math.min(
  ...Object.values(SMART_CONTEXT)
    .filter(t => t.maxDocs > 0)
    .map(t => t.maxDocs)
);

/**
 * Indicator Index Injection Config
 * Controls how docs with strong indicator_index matches get boosted into results.
 * All thresholds are relative/proportional — no doc-specific hardcoding.
 */
const INDICATOR_INJECTION = {
  MAX_INJECTIONS: 4,                         // Max docs to inject per query (raised for post-enrichment competition)
  BOOST_TARGET_POSITION: Math.max(0, MIN_ACTIVE_MAX_DOCS - 3), // Target position for similarity boost (0-indexed)
  MIN_INDICATOR_LENGTH: 10,                  // Min indicator_index chars to consider
  ENRICHMENT_GATE_CHARS: 50_000,             // Min doc size (chars) to trigger indicator-guided extraction
  CHUNK_WINDOW_GATE_CHARS: 400_000,          // Min doc size for chunk-window fallback extraction
};

// L9: Validate URL configs at startup
try { new URL(OPENAI.API_URL); } catch { console.error(`[config.js] Invalid OPENAI_API_URL: ${OPENAI.API_URL}`); }
try { new URL(INTERNAL_API_BASE); } catch { console.error(`[config.js] Invalid INTERNAL_API_BASE_URL: ${INTERNAL_API_BASE}`); }

// Proxy-only rule (2026-05-16): chat traffic must terminate at the local malika-llm-proxy.
// If OPENAI_API_URL ever points off-host, refuse to start — silent provider bypass is worse than a crash.
try {
  const u = new URL(OPENAI.API_URL);
  const okHost = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  const okPort = u.port === '3031';
  if (!okHost || !okPort) {
    console.error(`[config.js] FATAL: OPENAI_API_URL must be 127.0.0.1:3031 (the malika-llm-proxy). Got: ${OPENAI.API_URL}`);
    process.exit(1);
  }
} catch (e) {
  console.error(`[config.js] FATAL: OPENAI_API_URL unparseable: ${e.message}`);
  process.exit(1);
}

console.log(`[config.js] OPENAI.API_URL=${OPENAI.API_URL} key=${OPENAI.API_KEY ? '(configured)' : '(missing)'}`);

module.exports = {
  OPENAI,
  DATA,
  PERIOD,
  SIMILARITY,
  CONTEXT,
  COMPACTION,
  FEATURES,
  EXIM,
  INTERNAL_API_BASE,
  SSE,
  SMART_CONTEXT,
  INDICATOR_INJECTION,
};
