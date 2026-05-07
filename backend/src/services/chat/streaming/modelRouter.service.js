/**
 * Model Router Service
 *
 * Dynamically selects the appropriate model and parameters
 * based on query complexity, type, and context signals.
 *
 * Routing tiers (updated 2026-03-18 — Claude Extended Thinking):
 *   GREETING  → claude-sonnet-4-6  (fast, low tokens — or template)
 *   SIMPLE    → claude-sonnet-4-6  (strong reasoning with good prompts)
 *   COMPLEX   → claude-sonnet-4-6  (Extended Thinking enabled, 8K budget)
 *   DEEP      → claude-sonnet-4-6  (Extended Thinking enabled, 16K budget)
 */

'use strict';

const logger = require('../../../utils/logger').child({ service: 'ModelRouter' });
const { OPENAI, FEATURES, CLAUDE_THINKING = {} } = require('./config');

/**
 * Canonical tier names for `modelForTier`. Call sites should import this
 * constant instead of repeating string literals so a typo like `'COMLEX'`
 * is caught by autocomplete rather than falling through to the default.
 */
const MODEL_TIERS = Object.freeze({
  GREETING: 'GREETING',
  SIMPLE:   'SIMPLE',
  COMPLEX:  'COMPLEX',
  DEEP:     'DEEP',
});

/**
 * Map a pipeline tier to the proxy-understood model string.
 *
 * Defaults favor cheap Gemini for low-complexity stages and Claude Sonnet
 * for reasoning-heavy ones. The proxy owns provider-level fallback (e.g.
 * Gemini-keys-exhausted → Claude) — this function only picks an initial
 * model.
 *
 * Per-tier override: set env var MODEL_GREETING / MODEL_SIMPLE / MODEL_COMPLEX / MODEL_DEEP.
 */
function modelForTier(tier) {
  // tier arrives uppercase by pipeline convention (GREETING/SIMPLE/COMPLEX/DEEP);
  // anything else falls through to the final claude-sonnet-4-6 fallback.
  const defaults = {
    GREETING: 'gemini-3-flash-preview',
    SIMPLE:   'gemini-3-flash-preview',
    COMPLEX:  'claude-sonnet-4-6',
    DEEP:     'claude-sonnet-4-6',
  };
  const envKey = `MODEL_${tier}`;
  return process.env[envKey] || defaults[tier] || 'claude-sonnet-4-6';
}

// ── Tier definitions ────────────────────────────────────────────────────────

const TIERS = {
  GREETING: 'greeting',
  SIMPLE: 'simple',
  COMPLEX: 'complex',
  DEEP: 'deep',
};

/**
 * Model configs per tier.
 *
 * `reasoning_effort` only applies to o-series models (o3, o4-mini).
 * `thinking_budget` applies to Claude models — tokens allocated for Extended Thinking.
 *   - null = no thinking (GREETING/SIMPLE)
 *   - number = explicit budget via type:'enabled'
 *   - 'adaptive' = model decides when to think (Sonnet 4.6+ feature)
 */
const TIER_CONFIG = {
  [TIERS.GREETING]: {
    model: process.env.OPENAI_MODEL_CHAT || 'claude-sonnet-4-6',
    max_tokens: 300,
    temperature: 0.7,
    reasoning: false,
    reasoning_effort: null,
    thinking_budget: null, // No thinking needed for greetings (was 1024, caused API error: budgetTokens > maxTokens)
    description: 'Sapaan singkat',
  },
  [TIERS.SIMPLE]: {
    model: process.env.OPENAI_MODEL_CHAT || 'claude-sonnet-4-6',
    max_tokens: 8000,
    temperature: 0.3,
    reasoning: false,
    reasoning_effort: null,
    thinking_budget: CLAUDE_THINKING?.BUDGET_SIMPLE, // 4000 — now safe: budgetTokens (4000) < maxTokens (8000)
    description: 'Pencarian data sederhana',
  },
  [TIERS.COMPLEX]: {
    model: process.env.OPENAI_MODEL_CHAT || 'claude-sonnet-4-6',
    max_tokens: 8000,
    temperature: 0.2,
    reasoning: false,
    reasoning_effort: null,
    thinking_budget: CLAUDE_THINKING?.BUDGET_COMPLEX,
    description: 'Analisis mendalam',
  },
  [TIERS.DEEP]: {
    model: process.env.OPENAI_MODEL_REASONING || 'claude-sonnet-4-6',
    max_tokens: 16000,
    temperature: 0.2,
    reasoning: false,
    reasoning_effort: null,
    thinking_budget: CLAUDE_THINKING?.BUDGET_DEEP,
    description: 'Analisis komprehensif',
  },
};

// ── Complexity signals ──────────────────────────────────────────────────────

const COMPLEX_INDICATORS = [
  // Multi-source / merge
  /jumlah\s+(dan|&)\s+persentase/i,
  /gabung(kan)?|merge/i,
  /perbandingan|compare|komparasi/i,
  /banding(kan)?.*kabupaten/i,
  // Trend / time-series
  /trend|tren|kecenderungan/i,
  /\d{4}\s*[-–]\s*\d{4}/,           // year range: "2020-2024"
  /selama\s+\d+\s+tahun/i,
  // Calculations
  /pertumbuhan|growth|perubahan/i,
  /rata-rata|average|mean/i,
  /korelasi|correlation/i,
  // Kab/Kota breakdown
  /per\s+kabupaten/i,
  /semua\s+(kab|kabupaten|kota)/i,
  /breakdown|rincian/i,
];

const DEEP_INDICATORS = [
  /proyeksi|forecast|prediksi/i,
  /elastisitas|elasticity/i,
  /formula|rumus|perhitungan/i,
  /analisis?\s+(mendalam|komprehensi[fv]|lanjut)/i,
  /mengapa|kenapa.*naik|kenapa.*turun/i,   // causal reasoning
  /faktor.*penyebab/i,
  /hubungan\s+antara/i,
  /simulasi/i,
];

// ── Router ──────────────────────────────────────────────────────────────────

/**
 * Determine the model tier for a given query and context.
 *
 * @param {Object} params
 * @param {string}  params.query           - The user's (possibly merged) query
 * @param {boolean} params.isGreeting      - Pre-detected greeting flag
 * @param {boolean} params.isMergeBundle   - Merge bundle detected
 * @param {boolean} params.isMultiSource   - Multi-source query
 * @param {boolean} params.hasYearRange    - Period range detected (e.g. 2020-2024)
 * @param {number}  params.candidateCount  - Number of datasource candidates
 * @param {boolean} params.isEximQuery     - EXIM query detected
 * @param {boolean} params.isKnowledgeMode - Knowledge/RAG mode
 * @returns {{ tier: string, config: Object }}
 */
function routeModel({
  query = '',
  isGreeting = false,
  isMergeBundle = false,
  isMultiSource = false,
  hasYearRange = false,
  candidateCount = 0,
  isEximQuery = false,
  isKnowledgeMode = false,
  hasIndicatorInjectedDocs = false,
} = {}) {
  // ── Force override via env ──
  if (process.env.CHAT_FORCE_MODEL) {
    logger.debug({ forced: process.env.CHAT_FORCE_MODEL }, 'Model forced via env');
    const base = TIER_CONFIG[TIERS.SIMPLE];
    return {
      tier: TIERS.SIMPLE,
      config: { ...base, model: process.env.CHAT_FORCE_MODEL },
    };
  }

  // ── Reasoning disabled globally? ──
  const reasoningEnabled = process.env.CHAT_REASONING_ENABLED !== 'false';

  // ── Tier 0: Greeting ──
  if (isGreeting) {
    return { tier: TIERS.GREETING, config: TIER_CONFIG[TIERS.GREETING] };
  }

  // ── Tier 3: Deep ──
  if (reasoningEnabled) {
    const isDeep = DEEP_INDICATORS.some(rx => rx.test(query));
    if (isDeep) {
      logger.info({ query: query.slice(0, 80), tier: TIERS.DEEP }, 'Deep reasoning tier');
      return { tier: TIERS.DEEP, config: TIER_CONFIG[TIERS.DEEP] };
    }
  }

  // ── Tier 2: Complex ──
  if (reasoningEnabled) {
    // Strong signals: any ONE of these alone justifies COMPLEX tier
    // hasIndicatorInjectedDocs = deep content from large publications was injected,
    // needs more context budget (7 docs, 25K/doc) to avoid truncating extracted data
    // isKnowledgeMode = RAG-only query (no datasource table) — needs larger context
    // budget to avoid truncating BRS/Publikasi content that is the sole answer source
    const strongSignals = [isMergeBundle, isMultiSource, hasYearRange, hasIndicatorInjectedDocs, isKnowledgeMode].filter(Boolean).length;
    // Weak signals: need 2+ to justify COMPLEX tier
    const weakSignals = [
      candidateCount >= 3,
      isEximQuery && candidateCount >= 2,
      COMPLEX_INDICATORS.some(rx => rx.test(query)),
    ].filter(Boolean).length;

    if (strongSignals >= 1 || weakSignals >= 2) {
      logger.info({ query: query.slice(0, 80), strong: strongSignals, weak: weakSignals, hasIndicatorInjected: hasIndicatorInjectedDocs, isKnowledgeMode, tier: TIERS.COMPLEX }, 'Complex reasoning tier');
      return { tier: TIERS.COMPLEX, config: TIER_CONFIG[TIERS.COMPLEX] };
    }
  }

  // ── Tier 1: Simple ──
  return { tier: TIERS.SIMPLE, config: TIER_CONFIG[TIERS.SIMPLE] };
}

/**
 * Build model parameters from a tier config.
 * Returns fields applicable to the selected model family.
 *
 * For OpenAI reasoning models (o-series, gpt-5 family):
 * - Uses maxCompletionTokens instead of maxTokens
 * - Enables reasoning with configurable effort
 * - Skips temperature
 *
 * For Claude models with Extended Thinking:
 * - Adds thinking config (type + budgetTokens)
 * - Keeps maxTokens as-is (thinking budget is separate in Claude API)
 * - Temperature is set but SDK may ignore it when thinking is enabled
 */
function buildModelParams(tierConfig) {
  const params = {
    model: tierConfig.model,
    maxTokens: tierConfig.max_tokens,
  };

  const isClaude = isClaudeModel(tierConfig.model);
  const isOSeries = isReasoningModel(tierConfig.model);

  // ── Claude Extended Thinking ──
  if (isClaude && tierConfig.thinking_budget && FEATURES.CLAUDE_THINKING_ENABLED) {
    // Claude Sonnet 4.6 supports both 'adaptive' and 'enabled' modes.
    // We use 'enabled' with explicit budget for predictable cost control.
    params.thinking = {
      type: 'enabled',
      budgetTokens: tierConfig.thinking_budget,
    };
    // When thinking is enabled, Claude ignores temperature — omit to avoid confusion
    logger.debug({
      model: tierConfig.model,
      thinkingBudget: tierConfig.thinking_budget,
    }, 'Claude Extended Thinking enabled');
  } else if (isClaude) {
    // Non-thinking Claude tiers: apply temperature normally
    if (tierConfig.temperature !== undefined) {
      params.temperature = tierConfig.temperature;
    }
  }

  // ── OpenAI o-series / gpt-5 reasoning ──
  if (isOSeries) {
    // Skip temperature for reasoning models
    params.reasoning = {
      effort: tierConfig.reasoning_effort || 'medium',
      summary: 'auto',
    };
    // Reasoning models use maxCompletionTokens (includes reasoning + output)
    params.maxTokens = undefined;
    params.maxCompletionTokens = Math.max(tierConfig.max_tokens * 4, 4000);
  } else if (!isClaude && tierConfig.temperature !== undefined) {
    // Non-Claude, non-reasoning models (Gemini etc): apply temperature
    params.temperature = tierConfig.temperature;
  }

  return params;
}

/**
 * Check if a model is an OpenAI reasoning model (o-series / gpt-5).
 * Gemini and Claude are NOT OpenAI reasoning models.
 */
function isReasoningModel(model) {
  return /^o[1-9]\b|^gpt-5\b/.test(model || '');
}

/**
 * Check if a model is a Claude model (Anthropic).
 */
function isClaudeModel(model) {
  return /^claude-/.test(model || '');
}

module.exports = {
  TIERS,
  TIER_CONFIG,
  routeModel,
  buildModelParams,
  isReasoningModel,
  isClaudeModel,
  modelForTier,
  MODEL_TIERS,
};
