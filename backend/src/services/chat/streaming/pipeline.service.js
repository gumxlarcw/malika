/**
 * Chat Pipeline Orchestrator v2
 *
 * Clean, staged execution pipeline that replaces the monolithic
 * streamChatResponse function with testable, composable stages.
 *
 * Uses Vercel AI SDK (streamText) for protocol-compliant streaming
 * and supports reasoning models (o3, o4-mini) with thinking token display.
 *
 * Pipeline stages:
 *   1. validate    → Thread ownership + save user message
 *   2. context     → Load history, detect fragments, merge queries
 *   3. normalize   → Query normalization, year/geo inference
 *   4. intent      → Fast-path check, intent resolution, candidate ranking
 *   5. preview     → Data/EXIM/merge preview
 *   6. knowledge   → RAG search + knowledge mode detection
 *   7. model       → Select model tier + build OpenAI messages
 *   8. stream      → AI SDK streamText + post-processing
 */

'use strict';

// ── Scoped AI SDK TypeValidationError suppression ────────────────────────
// The Copilot proxy injects annotations/copilot_annotations as objects, but
// Vercel AI SDK's Zod schema expects arrays. This causes ~60 stack traces per
// request printed to stderr. They are non-fatal — content tokens still flow.
// Instead of a global override, we wrap only the streamText call.
const _origConsoleError = console.error;
function _suppressTypeValidationErrors() {
  console.error = function (...args) {
    const first = typeof args[0] === 'string' ? args[0] : '';
    if (first.includes('TypeValidationError') || first.includes('Error message:')) return;
    if (args[0] && typeof args[0] === 'object') {
      const name = args[0]?.name || args[0]?.constructor?.name || '';
      if (name.includes('TypeValidationError')) return;
    }
    _origConsoleError.apply(console, args);
  };
}
function _restoreConsoleError() {
  console.error = _origConsoleError;
}

const { GEO_DETECT_REGEX } = require('../../../utils/geoAnalysis');
const { streamText, smoothStream } = require('ai');
const { createOpenAI } = require('@ai-sdk/openai');
const { createAnthropic } = require('@ai-sdk/anthropic');
const { routeModel, buildModelParams, isReasoningModel, isClaudeModel } = require('./modelRouter.service');
const { classifyQuery, ROUTES, GATE_ENABLED } = require('./gateAgent.service');
const { OPENAI, FEATURES, EXIM, SMART_CONTEXT, INDICATOR_INJECTION } = require('./config');
const { MODEL_ALIASES: _MODEL_ALIASES } = require('./config');
const logger = require('../../../utils/logger').child({ service: 'ChatPipeline' });
const { now } = require('../../../utils/dateHelper');
const requestContext = require('./requestContext');

// ── Direct imports — replace legacyService bridge from streaming.service.js ──
const { getOpenAIKey, getOpenAIModel, systemPrompt } = require('./prompt.service');
const {
  stripMarkdownFormatting, isGreeting, buildGreetingSuggestions,
  buildContextualSuggestions, isConfirmMessage, isPrevContextKnowledgeMode,
} = require('./chatHelpers');
const {
  isLikelyTimeOrPeriodFragment, isLikelyGeoOnlyFragment, isComparisonFollowUp,
  isAlternativeSourceRequest, isShortFollowUp, mergeQuery, extractDataSubject,
  hasSubstantiveKeywords, isDifferentDataTypeRequest, isProceduralFaqQuery,
} = require('./queryContext.service');
const {
  expandGeoShorthand, findNearestAvailablePeriod, getProcessedPreviewFromCache,
  getEximPreviewFromApi, getProcessedPreviewForRange, extractContextFromPrevUiMeta,
} = require('./previewBuilder.service');
const { buildUIMetadata } = require('./uiMetadata.service');
const { saveAssistantMessage } = require('./assistantMessage.service');
const { searchKnowledgeBase, isKnowledgeTypeQuery, buildContextMessages: buildContextMessagesFromModule } = require('./knowledgeContext.service');
const { streamGreetingResponse } = require('./greeting.service');
const {
  findConversationTopic, findLastMeaningfulUserQuery, findLastAssistantUiMeta,
  updateThreadTitleIfNeeded,
} = require('./topic.service');
const { reconcileDataSources, formatReconciliationContext, RECONCILER_ENABLED } = require('./reconciler.service');
const { _hasTopicOverlap } = require('./knowledgeContext.service');
const { generateChartConfig, CHART_AGENT_ENABLED } = require('./chartAgent.service');
const { extractPeriodRange } = require('../../../utils/queryAnalysis');
const queryNormalizerService = require('../queryNormalizer.service');
const yearInferenceService = require('../yearInference.service');
const geoInferenceService = require('../geoInference.service');
const errorLearningService = require('../errorLearning.service');
const responseFormatterService = require('../responseFormatter.service');

const queryFastPathService = require('../queryFastPath.service');

// Lazily loaded (optional module)
let _webSearchService;
function getWebSearchService() {
  if (_webSearchService === undefined) {
    try { _webSearchService = require('../../search/webSearch.service'); } catch { _webSearchService = null; }
  }
  return _webSearchService;
}

/**
 * Build the legacy service reference object from direct imports.
 * This replaces the `legacyService` parameter previously passed from streaming.service.js.
 */
function _buildServiceRef() {
  return {
    getOpenAIKey,
    getOpenAIModel,
    isGreeting,
    isConfirmMessage,
    isLikelyTimeOrPeriodFragment,
    isLikelyGeoOnlyFragment,
    isShortFollowUp,
    findLastMeaningfulUserQuery,
    findLastAssistantUiMeta,
    findConversationTopic,
    isPrevContextKnowledgeMode,
    isProceduralFaqQuery,
    isAlternativeSourceRequest,
    isDifferentDataTypeRequest,
    isComparisonFollowUp,
    extractDataSubject,
    mergeQuery,
    hasSubstantiveKeywords,
    isNewTopicQuery: require('./topic.service').isNewTopicQuery,
    updateThreadTitleIfNeeded,
    buildGreetingSuggestions,
    streamGreetingResponse,
    systemPrompt,
    buildContextMessages: buildContextMessagesFromModule,
    buildUIMetadata,
    saveAssistantMessage,
    isKnowledgeTypeQuery,
    searchKnowledgeBase,
    getProcessedPreviewFromCache,
    getEximPreviewFromApi,
    findNearestAvailablePeriod,
    getProcessedPreviewForRange,
    extractPeriodRange,
    expandGeoShorthand,
    extractContextFromPrevUiMeta,
    buildContextualSuggestions,
    queryNormalizerService,
    yearInferenceService,
    geoInferenceService,
    queryFastPathService,
    errorLearningService,
    webSearchService: getWebSearchService(),
    responseFormatterService,
    generateChartConfig,
  };
}

// ── Smart Column Selection ──────────────────────────────────────────────────
/**
 * Select the most relevant columns based on the user's query.
 * Always keeps the first 2 columns (typically identifiers: wilayah, kategori)
 * and picks the remaining columns by keyword relevance to the query.
 * Falls back to first maxCols columns if no query matches found.
 *
 * @param {string[]} allCols - All column headers
 * @param {string} query - User's query text
 * @param {number} [maxCols=24] - Maximum columns to return
 * @returns {string[]} Selected columns (up to maxCols)
 */
function selectRelevantColumns(allCols, query, maxCols = 24) {
  if (!allCols || allCols.length <= maxCols) return allCols || [];

  // Always keep first 2 columns (identifiers: wilayah/kategori/nama)
  const KEEP_FIRST = 2;
  const kept = allCols.slice(0, KEEP_FIRST);
  const remaining = allCols.slice(KEEP_FIRST);

  if (!query || !query.trim()) {
    // No query context — fall back to first maxCols
    return allCols.slice(0, maxCols);
  }

  // Build query tokens for matching (lowercase, ≥2 chars, no stopwords)
  const STOPWORDS = new Set([
    'data', 'tabel', 'angka', 'statistik', 'berapa', 'apa', 'yang', 'dan', 'atau',
    'di', 'ke', 'dari', 'ini', 'itu', 'untuk', 'dengan', 'tahun', 'bulan',
    'maluku', 'utara', 'malut', 'provinsi', 'kabupaten', 'kota', 'per',
    'terbaru', 'terkini', 'latest', 'terakhir', 'semua', 'seluruh',
  ]);
  const queryTokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !STOPWORDS.has(w));

  if (queryTokens.length === 0) return allCols.slice(0, maxCols);

  // Score each remaining column by query relevance
  const scored = remaining.map((col, idx) => {
    const colLower = (col || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    let score = 0;

    for (const token of queryTokens) {
      if (colLower.includes(token)) {
        // Exact substring match — strong signal
        score += 10;
      } else {
        // Check partial matches (e.g. query "miskin" matches column "kemiskinan")
        const colWords = colLower.split(/\s+/);
        for (const cw of colWords) {
          if (cw.includes(token) || token.includes(cw)) {
            score += 5;
            break;
          }
        }
      }
    }

    // Year columns (e.g., "2024", "2023") get slight preference when no specific match
    if (/^\d{4}$/.test(col.trim())) score += 1;
    // "Total" columns get slight preference
    if (/total|jumlah|rata.?rata|average/i.test(col)) score += 2;

    return { col, score, originalIdx: idx };
  });

  // Sort by score (desc), then original order (asc) for ties
  scored.sort((a, b) => b.score - a.score || a.originalIdx - b.originalIdx);

  // Take top (maxCols - KEEP_FIRST) columns
  const selected = scored.slice(0, maxCols - KEEP_FIRST);

  // Re-sort selected columns by original order for natural presentation
  selected.sort((a, b) => a.originalIdx - b.originalIdx);

  const result = [...kept, ...selected.map(s => s.col)];

  // Log if smart selection actually changed the output vs naive slice
  const naiveResult = allCols.slice(0, maxCols);
  const isSmartDifferent = result.some((c, i) => c !== naiveResult[i]);
  if (isSmartDifferent) {
    const matchedCols = scored.filter(s => s.score > 0).map(s => s.col);
    logger.debug({
      totalCols: allCols.length,
      selectedCols: result.length,
      queryTokens,
      matchedCols: matchedCols.slice(0, 5),
    }, 'Smart column selection applied');
  }

  return result;
}

// ── Context Budget Enforcement ──────────────────────────────────────────────
// Copilot API (GitHub proxy) has an undocumented payload size limit that causes
// 400 errors when messages are too large. gpt-5-mini has a 400K context window
// but the proxy rejects requests before they reach the model.
// Budget: 400K chars (~100K tokens) — both gpt-4.1 and gpt-5-mini have 1M token
// context windows. Real queries use ~150-200K chars for 10 KB docs + data preview.
// trimMessagesToBudget() still gracefully handles overflows.
const MAX_CONTEXT_CHARS = 400_000;

// SMART_CONTEXT & INDICATOR_INJECTION imported from ./config.js — single source of truth
// See config.js for tier definitions: greeting, simple, complex, deep

/**
 * Trim OpenAI messages array to fit within a character budget.
 * Strategy (progressive, least-destructive first):
 *   1. Measure total chars
 *   2. If over budget, find the largest system message(s) containing knowledge/data
 *   3. Truncate those messages, preserving the first portion (summary/intro)
 *   4. If still over, drop the smallest-similarity knowledge docs from the back
 *
 * Preserves: system prompt (index 0), user message (last), conversation history.
 * 
 * @param {Array} messages - Array of {role, content} objects
 * @param {number} [budget=MAX_CONTEXT_CHARS] - Max total characters
 * @returns {{ messages: Array, trimmed: boolean, originalChars: number, trimmedChars: number }}
 */
function trimMessagesToBudget(messages, budget = MAX_CONTEXT_CHARS) {
  if (!messages || messages.length === 0) return { messages, trimmed: false, originalChars: 0, trimmedChars: 0 };

  const totalChars = () => messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
  const originalChars = totalChars();

  if (originalChars <= budget) {
    return { messages, trimmed: false, originalChars, trimmedChars: originalChars };
  }

  logger.warn({
    originalChars,
    budget,
    messageCount: messages.length,
    messageSizes: messages.map((m, i) => ({ i, role: m.role, chars: m.content?.length || 0 })),
  }, 'Context exceeds budget — trimming messages');

  // Identify which messages are trimmable (system messages with knowledge/data content)
  // Never trim: index 0 (system prompt) and last message (user query)
  const TRIM_MARKERS = [
    'DOKUMEN BRS', 'PUBLIKASI RESMI', 'KNOWLEDGE BASE', 'INFORMASI RESMI',
    'DATA STATISTIK', 'INFORMASI TERKAIT', 'INFORMASI INTERNAL',
    'SUMBER RESMI BRS', 'DOKUMEN TERKAIT',
  ];

  const trimmableIndices = [];
  for (let i = 1; i < messages.length - 1; i++) {
    const m = messages[i];
    if (m.role !== 'system') continue;
    const content = m.content || '';
    // Check if this message contains knowledge/data content (large and has markers)
    if (content.length > 2000 && TRIM_MARKERS.some(marker => content.includes(marker))) {
      trimmableIndices.push(i);
    }
  }

  // Sort trimmable by size (largest first) so we trim the biggest offenders
  trimmableIndices.sort((a, b) => (messages[b].content?.length || 0) - (messages[a].content?.length || 0));

  // Phase 1: Truncate large knowledge messages to fit budget
  const overBy = totalChars() - budget;
  let trimmedSoFar = 0;

  for (const idx of trimmableIndices) {
    if (totalChars() <= budget) break;

    const content = messages[idx].content;
    const contentLen = content.length;

    // Calculate how much we need to trim from this message
    const currentOver = totalChars() - budget;

    // Determine the target length for this message
    // Keep at least 4000 chars (intro + key stats) or 30% of content, whichever is larger
    const minKeep = Math.max(4000, Math.floor(contentLen * 0.3));
    const targetLen = Math.max(minKeep, contentLen - currentOver);

    if (targetLen < contentLen) {
      // Find a good breakpoint — try to end at a paragraph/section boundary
      let cutPoint = targetLen;

      // Look for section separator (---) near the cut point
      const searchStart = Math.max(minKeep, targetLen - 500);
      const lastSeparator = content.lastIndexOf('\n---\n', cutPoint);
      if (lastSeparator > searchStart) {
        cutPoint = lastSeparator;
      } else {
        // Look for paragraph break
        const lastPara = content.lastIndexOf('\n\n', cutPoint);
        if (lastPara > searchStart) {
          cutPoint = lastPara;
        }
      }

      const trimmedContent = content.slice(0, cutPoint) +
        '\n\n⚠️ [Dokumen terpotong karena keterbatasan konteks. Bagian awal berisi informasi paling penting.]';

      messages[idx] = { role: 'system', content: trimmedContent };
      trimmedSoFar += contentLen - trimmedContent.length;

      logger.info({
        messageIdx: idx,
        originalLen: contentLen,
        trimmedLen: trimmedContent.length,
        savedChars: contentLen - trimmedContent.length,
      }, 'Trimmed knowledge message to fit budget');
    }
  }

  // Phase 2: If still over budget, remove trimmable messages entirely (last one first)
  while (totalChars() > budget && trimmableIndices.length > 0) {
    const removeIdx = trimmableIndices.pop();
    const removedLen = messages[removeIdx].content?.length || 0;
    messages.splice(removeIdx, 1);
    trimmedSoFar += removedLen;
    // Adjust remaining indices after splice
    for (let j = 0; j < trimmableIndices.length; j++) {
      if (trimmableIndices[j] > removeIdx) trimmableIndices[j]--;
    }
    logger.warn({ removedIdx: removeIdx, removedChars: removedLen }, 'Removed entire knowledge message to fit budget');
  }

  // Phase 3: If STILL over budget (shouldn't happen normally), truncate conversation history
  if (totalChars() > budget) {
    // Drop older history messages (keep last 4 exchanges)
    let historyStart = -1, historyEnd = -1;
    for (let i = 1; i < messages.length - 1; i++) {
      if (messages[i].role === 'user' || messages[i].role === 'assistant') {
        if (historyStart === -1) historyStart = i;
        historyEnd = i;
      }
    }
    if (historyStart !== -1 && historyEnd !== -1) {
      const historyCount = historyEnd - historyStart + 1;
      if (historyCount > 8) {
        const toRemove = historyCount - 8;
        const removed = messages.splice(historyStart, toRemove);
        const removedChars = removed.reduce((s, m) => s + (m.content?.length || 0), 0);
        trimmedSoFar += removedChars;
        logger.warn({ removedCount: toRemove, removedChars }, 'Dropped old history messages to fit budget');
      }
    }
  }

  const trimmedChars = totalChars();
  logger.info({
    originalChars,
    trimmedChars,
    savedChars: originalChars - trimmedChars,
    withinBudget: trimmedChars <= budget,
  }, 'Context budget enforcement complete');

  return { messages, trimmed: true, originalChars, trimmedChars };
}

// New services (lazy-loaded to avoid circular deps)
let _persistentMemory = null;
let _sessionCompaction = null;
let _toolUse = null;
let _llmSuggestions = null;
let _dnaService = null;

function getPersistentMemory() {
  if (!_persistentMemory) _persistentMemory = require('../persistentMemory.service');
  return _persistentMemory;
}
function getSessionCompaction() {
  if (!_sessionCompaction) _sessionCompaction = require('../sessionCompaction.service');
  return _sessionCompaction;
}
function getToolUse() {
  if (!_toolUse) _toolUse = require('./toolUse.service');
  return _toolUse;
}
function getLLMSuggestions() {
  if (!_llmSuggestions) _llmSuggestions = require('./llmSuggestions.service');
  return _llmSuggestions;
}
function getDnaService() {
  if (!_dnaService) {
    try { _dnaService = require('../../dna/dnaNucleus.service'); } catch { /* not available */ }
  }
  return _dnaService;
}

// ── Contextual topic extraction ─────────────────────────────────────────────

/**
 * Extract a short, clean topic label from the pipeline context.
 * Used to make status messages contextual (e.g. "Mencari data 'kemiskinan'..."
 * instead of generic "Mencocokkan sumber data...").
 *
 * @param {PipelineContext} ctx
 * @returns {string|null} Short topic label or null
 */
function getTopicLabel(ctx) {
  const raw = ctx.conversationTopic || ctx.normalizedQuery || ctx.effectiveQuery || ctx.userMessage || '';
  if (!raw || raw.length < 2) return null;

  let topic = raw
    // Strip common question/command prefixes (applied iteratively so chained prefixes get removed)
    .replace(/^(berapa|apa|bagaimana|kapan|dimana|siapa|jelaskan|ceritakan|tampilkan|tunjukkan|carikan|tolong|mohon|bisa|coba|saya\s+ingin|saya\s+mau|ada\s+nggak|ada\s+tidak)\s+/gi, '')
    .replace(/^(data|tabel|grafik|chart|angka|statistik|info|informasi|jumlah|persentase|total)\s+/gi, '')
    .replace(/^(tentang|mengenai|soal|perihal|untuk|itu)\s+/gi, '')
    .trim();

  // Remove geo references — kab/kota names from GEO_DETECT_REGEX
  if (GEO_DETECT_REGEX) {
    topic = topic.replace(GEO_DETECT_REGEX, '').trim();
  }
  // Province-level and abbreviations (not in GEO_DETECT_REGEX)
  topic = topic.replace(/\b(maluku\s+utara|malut|provinsi|prov\.?)\b/gi, '').trim();
  // Remove common geo prefixes/words
  topic = topic.replace(/\b(kabupaten|kab\.?|kota|kecamatan|kelurahan|desa|pulau)\b/gi, '').trim();

  // Remove year/period references
  topic = topic.replace(/\b(tahun\s*)?(20[12]\d)\b/gi, '').trim();
  topic = topic.replace(/\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|kuartal|triwulan|semester|q[1-4])\s*\d*/gi, '').trim();
  topic = topic.replace(/\b(terbaru|terkini|terakhir|sekarang|saat\s+ini)\b/gi, '').trim();

  // Clean up multiple spaces and punctuation FIRST (before preposition loop)
  topic = topic.replace(/\s+/g, ' ').replace(/[?.!,;:\-]+$/g, '').trim();

  // Remove orphaned prepositions and connectors at start/end (loop until stable)
  let prev;
  do {
    prev = topic;
    topic = topic
      .replace(/\b(di|ke|dari|pada|per|dan|atau|yang|untuk|dengan|menurut|berdasarkan)\s*$/gi, '')
      .replace(/^\s*(di|ke|dari|pada|per|dan|atau|yang|untuk|dengan|menurut|berdasarkan)\s+/gi, '')
      .trim();
  } while (topic !== prev);

  // Final cleanup
  topic = topic.replace(/\s+/g, ' ').trim();

  // If topic is still too short or just noise, skip
  if (topic.length < 3) return null;

  // Truncate to reasonable length
  if (topic.length > 35) topic = topic.slice(0, 35).replace(/\s+\S*$/, '') + '…';

  return topic;
}

// ── Stage result types (documented via JSDoc) ─────────────────────────────

/**
 * @typedef {Object} PipelineContext
 * @property {object} res                - Express response
 * @property {number} threadId           - Thread ID
 * @property {string} userMessage        - Raw user message
 * @property {string} ownerId            - Owner UID
 * @property {object} sse                - SSE handler { sendEvent, end, isClientConnected, abortController }
 *
 * -- Populated by stages --
 * @property {object}  thread            - ChatThread model instance
 * @property {object}  userMsg           - Saved ChatMessage record
 * @property {Array}   historyArray      - Conversation history (raw JSON)
 * @property {string}  effectiveQuery    - Merged/resolved query text
 * @property {string}  normalizedQuery   - After normalization + inference
 * @property {boolean} isGreeting        - Greeting detected
 * @property {boolean} isConfirm         - Confirmation detected
 * @property {string}  conversationTopic - Detected conversation topic
 * @property {object}  prevUiMeta        - Previous assistant's malika_ui metadata
 * @property {object}  yearInference     - { year, source, isInferred }
 * @property {object}  geoInference      - { hasGeo, geoFilter, geoReferences }
 * @property {object}  intentResult      - Search intent result
 * @property {Array}   candidates        - Datasource candidates
 * @property {object}  dataPreview       - Table preview data
 * @property {object}  periodFallback    - Period fallback info
 * @property {Array}   knowledgeContext  - RAG documents
 * @property {boolean} isKnowledgeMode   - In knowledge mode
 * @property {boolean} isEximQuery       - EXIM query
 * @property {object}  eximParams        - { group, month, facets, mode }
 * @property {object}  modelRoute        - { tier, config } from modelRouter
 * @property {Array}   openAiMessages    - Final messages array
 * @property {object}  timings           - Per-stage timing { [stage]: ms }
 */

// ── Pipeline runner ──────────────────────────────────────────────────────

/**
 * Execute the full chat pipeline with timing tracking.
 *
 * @param {Object} params
 * @param {object} params.res          - Express response object
 * @param {number} params.threadId     - Thread ID
 * @param {string} params.userMessage  - User's message text
 * @param {string} params.ownerId      - Owner UID
 * @returns {Promise<void>}
 */
async function runPipeline({ res, threadId, userMessage, ownerId, modelOverride, _preEstablishedSSE }) {
  const startTime = Date.now();
  const timings = {};
  // MT-1: Request-level tracing ID for cross-service log correlation
  const requestId = crypto.randomUUID().slice(0, 8);

  // Build service reference from direct imports (replaces legacyService bridge)
  const svc = _buildServiceRef();

  /** @type {PipelineContext} */
  const ctx = {
    res,
    threadId,
    userMessage,
    ownerId,
    requestId, // MT-1: propagate through all service calls
    sse: _preEstablishedSSE || null, // Reuse SSE from concurrency queue if available
    timings,
    pipelineStartTime: startTime,
    modelOverride: modelOverride || null, // User-selected model (gpt-5-mini or gpt-4.1)
    _thinkingItems: [], // Accumulates thinking items for uiMeta (T5 incremental emission)
  };

  /**
   * Emit a single thinking item immediately via SSE and accumulate for uiMeta.
   * Called progressively after each pipeline stage instead of batch-emitting.
   */
  function emitThinkingItem(item) {
    if (!ctx.sse?.isClientConnected?.()) return;
    ctx._thinkingItems.push(item);
    // flush: false — next status event will flush; avoids N write+flush per stage group
    ctx.sse.sendEvent('thinking', item, { flush: false });
  }

  const PIPELINE_TIMEOUT_MS = 600_000; // 10min safety net (generous — let Deep reasoning complete)
  const pipelineTimer = setTimeout(() => {
    logger.error({ requestId, threadId, elapsed: Date.now() - startTime }, 'Pipeline timeout exceeded');
    try {
      if (ctx.sse?.isClientConnected?.()) {
        ctx.sse.sendEvent('error', { message: 'Mohon maaf, permintaan memakan waktu terlalu lama. Silakan coba lagi.' });
      }
    } catch { /* no-op */ }
    try { ctx.sse?.end?.(); } catch { /* no-op */ }
  }, PIPELINE_TIMEOUT_MS);

  // Wrap entire pipeline in requestContext so ALL sub-agents (no matter how
  // deeply nested) can read the user's model choice via requestContext.getModelOverride()
  await requestContext.run({ modelOverride: ctx.modelOverride }, async () => {

  try {
    logger.info({ requestId, threadId, query: userMessage?.slice(0, 80) }, 'Pipeline started');

    // ── Stage 1: SSE setup & validation ────────────────────────────────
    const t1 = Date.now();
    await stageValidate(ctx, svc);
    timings.validate = Date.now() - t1;

    // ── Stage 0 (post-validate): Gate Agent classification ─────────────
    const tGate = Date.now();
    ctx.gate = await stageGate(ctx, svc);
    timings.gate = Date.now() - tGate;

    // Handle gate early-exit routes (greeting, chitchat, decline, individual data)
    if (ctx._gateHandled) return;

    // ── Stage 2: Context loading & query merging ───────────────────────
    const t2 = Date.now();
    await stageContext(ctx, svc);
    timings.context = Date.now() - t2;

    // ── Stages 3+3b: Normalize + DNA Pre-Enrich in parallel ─────────
    // Both only require ctx.effectiveQuery (from context stage).
    // Normalize produces normalizedQuery; DNA produces dnaEnrichedQuery.
    // Intent uses: dnaEnrichedQuery || normalizedQuery (both ready after this).
    //
    // Status event schema convention:
    //   Core stages    → { message, stage }
    //   Conditional    → { message, stage }  (may or may not fire)
    //   Status detail  → { stage, detail }   (attached to its parent step)
    //
    { const _t = getTopicLabel(ctx); ctx.sse.sendEvent('status', { message: _t ? `Mengenali topik "${_t}"…` : 'Mengenali topik & wilayah…', stage: 'normalize' }); }
    const t3 = Date.now();
    await Promise.all([
      (async () => {
        await stageNormalize(ctx, svc);
        timings.normalize = Date.now() - t3;
      })(),
      (async () => {
        await stageDnaPreEnrich(ctx);
        timings.dnaLookup = Date.now() - t3;
      })(),
    ]);
    // Detail: what was recognized (normalize results)
    {
      const parts = [];
      const topic = (ctx.normalizedQuery || ctx.effectiveQuery || '').slice(0, 50);
      if (topic) parts.push(`Topik: ${topic}`);
      const geo = ctx.geoInference?.geoReferences?.[0]?.name;
      if (geo) parts.push(`Wilayah: ${geo}`);
      const yr = ctx.yearInference?.year;
      if (yr) parts.push(`Periode: ${yr}`);
      ctx.sse.sendEvent('status_detail', { stage: 'normalize', detail: parts.join(' · ') || 'Query dianalisis' });
    }
    // Detail: what DNA found
    ctx.sse.sendEvent('status', { message: 'Mengumpulkan metadata…', stage: 'dna' });
    {
      const term = ctx._dnaSearchTerm || '';
      const raw = ctx.dnaRawResults;
      if (raw) {
        const items = [];
        if (raw.variables?.length) items.push(`${raw.variables.length} variabel`);
        if (raw.indicators?.length) items.push(`${raw.indicators.length} indikator`);
        if (raw.kegiatan?.length) items.push(`${raw.kegiatan.length} kegiatan`);
        const topName = raw.variables?.[0]?.nama || raw.indicators?.[0]?.nama || raw.kegiatan?.[0]?.judul || '';
        ctx.sse.sendEvent('status_detail', { stage: 'dna', detail: `"${term}" → ${items.join(', ')}${topName ? `: ${topName.slice(0, 60)}` : ''}` });
      } else if (ctx._dnaBackgroundPromise) {
        ctx.sse.sendEvent('status_detail', { stage: 'dna', detail: `"${term}" → fetching di background` });
      } else {
        ctx.sse.sendEvent('status_detail', { stage: 'dna', detail: 'Tidak ada metadata relevan', resultStatus: 'empty' });
      }
    }

    // ── T5: Incremental thinking – emit query + context + dna items ──
    {
      const query = ctx.effectiveQuery || ctx.userMessage || '';
      emitThinkingItem({
        step: 'query', icon: '📝', label: 'Memahami pertanyaan',
        detail: query.slice(0, 120) + (query.length > 120 ? '...' : ''),
        elapsedMs: (timings.normalize || 0) + (timings.context || 0) + (timings.validate || 0),
      });
      if (ctx.norm) {
        const tags = [];
        if (ctx.norm.topic) tags.push(ctx.norm.topic);
        if (ctx.norm.geoLabel) tags.push(ctx.norm.geoLabel);
        if (ctx.norm.year) tags.push(`${ctx.norm.year}`);
        if (ctx.norm.month) tags.push(ctx.norm.month);
        if (tags.length > 0) {
          emitThinkingItem({ step: 'context', icon: '🔍', label: 'Konteks terdeteksi', detail: tags.join(' · '), tags, elapsedMs: timings.normalize || 0 });
        }
      }
      if (ctx.dnaResults?.length > 0) {
        const topDna = ctx.dnaResults.slice(0, 2);
        emitThinkingItem({
          step: 'dna', icon: '🧬', label: `${ctx.dnaResults.length} metadata DNA ditemukan`,
          detail: topDna.map(d => d.nama || d.name || '').filter(Boolean).join(', ').slice(0, 100),
          elapsedMs: timings.dnaLookup || 0,
        });
      }
    }

    // ── Client disconnect check ──────────────────────────────────────
    if (!ctx.sse?.isClientConnected?.()) {
      logger.info({ threadId, timings }, 'Client disconnected before intent stage — aborting');
      return;
    }

    // ── Stages 4+6: Intent + Knowledge in parallel ──────────────────
    { const _t = getTopicLabel(ctx); ctx.sse.sendEvent('status', { message: _t ? `Mencari sumber data "${_t}"…` : 'Mencocokkan sumber data…', stage: 'search' }); }
    const t46 = Date.now();
    const [intentResult, knowledgeResult] = await Promise.allSettled([
      (async () => {
        const ts = Date.now();
        await stageIntent(ctx, svc);
        timings.intent = Date.now() - ts;
      })(),
      (async () => {
        const ts = Date.now();
        await stageKnowledgeSearch(ctx, svc);
        timings.knowledgeSearch = Date.now() - ts;
      })(),
    ]);
    timings.intentAndKnowledge = Date.now() - t46;

    // Log any rejected promises
    if (intentResult.status === 'rejected') {
      logger.error({ error: intentResult.reason?.message }, 'stageIntent failed');
    }
    if (knowledgeResult.status === 'rejected') {
      logger.warn({ error: knowledgeResult.reason?.message }, 'stageKnowledgeSearch failed');
    }
    // Detail: candidates + knowledge found
    {
      const parts = [];
      const cands = ctx.candidates || [];
      let searchResultStatus = 'ok';
      if (cands.length > 0) {
        const top = cands[0];
        parts.push(`${cands.length} sumber data: ${(top.name || '').slice(0, 50)}`);
      } else {
        parts.push('Tidak ada sumber data cocok');
        searchResultStatus = 'warn';
      }
      const kb = ctx.knowledgeContext || [];
      if (kb.length > 0) parts.push(`${kb.length} dokumen RAG`);
      else if (searchResultStatus !== 'ok') searchResultStatus = 'empty';
      ctx.sse.sendEvent('status_detail', { stage: 'search', detail: parts.join(' · '), resultStatus: searchResultStatus });
    }

    // ── T5: Incremental thinking – emit sources + knowledge items ──
    {
      if (ctx.candidates?.length > 0) {
        const topNames = ctx.candidates.slice(0, 3).map(c => c.name || c.ds_name || '').filter(Boolean);
        emitThinkingItem({
          step: 'sources', icon: '📊', label: `${ctx.candidates.length} sumber data relevan`,
          detail: topNames.join(' · ').slice(0, 120), count: ctx.candidates.length,
          elapsedMs: timings.intent || timings.intentAndKnowledge || 0,
        });
      }
      if (ctx.knowledgeContext?.length > 0) {
        const brsList = ctx.knowledgeContext.filter(d => d.category === 'BRS');
        const pubList = ctx.knowledgeContext.filter(d => d.category === 'Publikasi');
        const parts2 = [];
        if (brsList.length > 0) parts2.push(`${brsList.length} BRS`);
        if (pubList.length > 0) parts2.push(`${pubList.length} Publikasi`);
        const topTitle = (brsList[0] || pubList[0])?.title || '';
        emitThinkingItem({
          step: 'knowledge', icon: '📚', label: `${parts2.join(' + ')} referensi ditemukan`,
          detail: topTitle.slice(0, 100) + (topTitle.length > 100 ? '...' : ''),
          brsCount: brsList.length, pubCount: pubList.length,
          elapsedMs: timings.knowledgeSearch || 0,
        });
      }
    }

    // ── Client disconnect check ──────────────────────────────────────
    if (!ctx.sse?.isClientConnected?.()) {
      logger.info({ threadId, timings }, 'Client disconnected before preview stage — aborting');
      return;
    }

    // ── Stage 5 + DNA background: Preview + DNA await in parallel ────
    // Preview doesn't need DNA results; DNA background may still be running.
    // Running them in parallel saves time when DNA API is slow (~15s cold).
    { const _t = getTopicLabel(ctx); ctx.sse.sendEvent('status', { message: _t ? `Memuat data "${_t}" terbaru…` : 'Memuat data tabel terbaru…', stage: 'preview' }); }
    const t5 = Date.now();
    await Promise.all([
      (async () => {
        await stagePreview(ctx, svc);
        timings.preview = Date.now() - t5;
      })(),
      (async () => {
        // Await DNA background promise if still pending (fired in stage 3b)
        if (ctx._dnaBackgroundPromise) {
          try { await ctx._dnaBackgroundPromise; } catch (_) { /* already logged */ }
        }
      })(),
    ]);
    // Detail: table info
    {
      const p = ctx.dataPreview;
      if (p) {
        const fb = ctx.periodFallback ? ` (${ctx.periodFallback.requestedYear}→${ctx.periodFallback.actualYear})` : '';
        const sec = ctx.dataPreviewSecondary ? ' +1 tabel' : '';
        ctx.sse.sendEvent('status_detail', { stage: 'preview', detail: `${(p.title || 'Tabel').slice(0, 60)} · ${p.total_rows || p.rows?.length || 0} baris${fb}${sec}` });
      } else {
        ctx.sse.sendEvent('status_detail', { stage: 'preview', detail: ctx.isKnowledgeMode ? 'Mode pengetahuan (tanpa tabel)' : 'Tidak ada data preview', resultStatus: ctx.isKnowledgeMode ? 'ok' : 'warn' });
      }
    }

    // ── Pre-stream Table Relevance Check ──────────────────────────────
    // If the data preview table is about a DIFFERENT topic than the query,
    // null it out BEFORE the LLM sees it. This prevents the LLM from
    // hallucinating data by mixing query topic with unrelated table data.
    // Knowledge context (BRS/Publikasi) is preserved for the LLM to use.
    if (ctx.dataPreview && ctx.dataPreview.title) {
      const { checkTableRelevance } = require('./supervisor.service');
      const relCheck = checkTableRelevance(
        ctx.effectiveQuery || ctx.userMessage,
        ctx.dataPreview,
        ctx
      );
      if (!relCheck.isRelevant) {
        logger.info({
          threadId,
          tableTitle: (ctx.dataPreview.title || '').slice(0, 80),
          query: (ctx.effectiveQuery || ctx.userMessage || '').slice(0, 100),
          reason: relCheck.reason,
          hasKnowledge: (ctx.knowledgeContext?.length || 0) > 0,
        }, 'Pre-stream: table irrelevant to query → removing from LLM context');
        // Save reference for post-stream UI metadata (so we know it was suppressed)
        ctx._suppressedDataPreview = ctx.dataPreview;
        ctx._tableIrrelevantReason = relCheck.reason;
        ctx.dataPreview = null;
        ctx.dataPreviewSecondary = null;
        // Emit warning to user
        ctx.sse.sendEvent('status_detail', {
          stage: 'preview',
          detail: 'Tabel tidak relevan dengan pertanyaan — menggunakan dokumen referensi',
          resultStatus: 'warn',
        });
      }
    }

    // ── T5: Incremental thinking – emit data preview item ──
    if (ctx.dataPreview) {
      const preview = ctx.dataPreview;
      const rowCount = preview.rows?.length || preview.table_data?.length || 0;
      if (rowCount > 0) {
        emitThinkingItem({
          step: 'data', icon: '📋', label: `${rowCount} baris data tabel dimuat`,
          detail: preview.title || preview.ds_name || 'Data statistik terbaru',
          elapsedMs: timings.preview || 0,
        });
      }
    }

    // ── Stage 5.5: Chart Agent (parallel — fire-and-forget until needed) ──
    // Generates chart config via LLM while the pipeline continues with knowledge mode / model selection.
    // Result is awaited later when building uiMeta. Zero latency on the critical path.
    let chartAgentPromise = null;
    if (CHART_AGENT_ENABLED && ctx.dataPreview && ctx.dataPreview.rows?.length > 1) {
      ctx.sse.sendEvent('status_detail', { stage: 'preview', detail: 'Memilih visualisasi terbaik…', resultStatus: 'ok' });
      const tChart = Date.now();
      chartAgentPromise = generateChartConfig(ctx)
        .then(config => {
          timings.chartAgent = Date.now() - tChart;
          ctx._chartConfig = config;
          if (config?.should_render) {
            emitThinkingItem({
              step: 'chart', icon: '📈', label: `Grafik ${config.chart_type} dipilih`,
              detail: config.chart_title || 'Visualisasi otomatis',
              elapsedMs: timings.chartAgent,
            });
          }
          return config;
        })
        .catch(err => {
          timings.chartAgent = Date.now() - tChart;
          logger.warn({ error: err.message, latencyMs: timings.chartAgent }, 'Chart agent failed');
          return null;
        });
      ctx._chartAgentPromise = chartAgentPromise;
    }

    // ── L1 fix: Combined fallback notification ───────────────────────
    // When multiple fallbacks occur, send a consolidated notice to the user
    // so they know exactly what data they're seeing vs what was requested.
    {
      const fallbacks = [];
      if (ctx.periodFallback) {
        fallbacks.push(`Periode ${ctx.periodFallback.requestedYear} tidak tersedia, menampilkan ${ctx.periodFallback.actualYear}`);
      }
      if (ctx.isKnowledgeMode && !ctx.dataPreview && ctx.candidates?.length > 0) {
        fallbacks.push('Data tabel tidak tersedia, beralih ke mode pengetahuan');
      }
      if (fallbacks.length > 1) {
        ctx.sse.sendEvent('status', { message: 'Penyesuaian data…', stage: 'fallback' });
        ctx.sse.sendEvent('status_detail', {
          stage: 'fallback',
          detail: `⚠️ ${fallbacks.join(' · ')}`,
        });
        logger.info({ threadId, fallbacks }, 'Multiple fallbacks applied');
      }
    }

    // ── Stage 6b: Knowledge mode decision ──────────────────────────────
    const t6b = Date.now();
    stageKnowledgeMode(ctx, svc);
    timings.knowledgeMode = Date.now() - t6b;

    // ── Stage 6c: Knowledge Analyst — REMOVED (Phase 5) ───────────────
    // Removed: 0% activation rate in production (28 checks, 0 activations).
    // chunk-window extraction always preempts the analyst, making it dead code.
    // SMART_CONTEXT handles all context sizing. File kept at knowledgeAnalyst.service.js
    // for reference but is no longer loaded or called.

    // ── Stage 7: Model selection & message building ────────────────────
    // DNA background already awaited in parallel with Preview (above)
    { const _t = getTopicLabel(ctx); ctx.sse.sendEvent('status', { message: _t ? `Merangkai konteks "${_t}"…` : 'Merangkai konteks & referensi…', stage: 'model' }); }
    const t7 = Date.now();
    await stageModelSelect(ctx, svc);
    timings.model = Date.now() - t7;
    // Detail: model info
    {
      const tier = ctx.modelRoute?.tier || 'unknown';
      const model = ctx.modelRoute?.config?.model || 'unknown';
      const MODEL_DISPLAY = _MODEL_ALIASES;
      const TIER_DISPLAY = { greeting: 'Sapaan', simple: 'Cepat', complex: 'Mendalam', deep: 'Komprehensif', user_override: 'Pilihan Pengguna' };
      const modelLabel = MODEL_DISPLAY[model] || 'MALIKA';
      const tierLabel = TIER_DISPLAY[tier] || tier;
      const hasDna = ctx.dnaContext ? 'ya' : '-';
      const hasKb = (ctx.knowledgeContext?.length || 0) > 0 ? 'ya' : '-';
      ctx.sse.sendEvent('status_detail', { stage: 'model', detail: `${modelLabel} (${tierLabel}) · DNA: ${hasDna} · KB: ${hasKb}` });
    }

    // ── T5: Incremental thinking – emit reasoning + strategy items ──
    {
      const tier = ctx.modelRoute?.tier || 'simple';
      const model = ctx.modelRoute?.config?.model || 'claude-haiku-4-5';
      const modelAlias = _MODEL_ALIASES[model] || model;
      const isDeep = tier === 'complex' || tier === 'deep';
      emitThinkingItem({
        step: 'reasoning', icon: '🧠',
        label: `Menganalisis dengan ${isDeep ? 'penalaran mendalam' : 'analisis cepat'}`,
        detail: `${modelAlias} (${model})`, model, tier, elapsedMs: timings.model || 0,
      });
      const query = ctx.effectiveQuery || ctx.userMessage || '';
      let strategy = 'Menyusun narasi berdasarkan data terbaru';
      let strategyIcon = '📐';
      if (/tren|trend|pertumbuhan|growth|perkembangan/i.test(query)) { strategy = 'Mendeteksi pola tren & pertumbuhan antar periode'; strategyIcon = '📈'; }
      else if (/bandingan|compare|komparasi|versus|vs\b/i.test(query)) { strategy = 'Menyiapkan perbandingan antar wilayah/periode'; strategyIcon = '⚖️'; }
      else if (/tertinggi|terendah|ranking|rangking|peringkat/i.test(query)) { strategy = 'Menelusuri peringkat & nilai ekstrem'; strategyIcon = '🏆'; }
      else if (/apa itu|definisi|pengertian|maksud/i.test(query)) { strategy = 'Menjelaskan definisi & konsep statistik'; strategyIcon = '📖'; }
      else if (/berapa|jumlah|total|angka/i.test(query)) { strategy = 'Mengambil & menampilkan angka spesifik'; strategyIcon = '🔢'; }
      else if (/distribusi|proporsi|komposisi|persentase/i.test(query)) { strategy = 'Menganalisis distribusi & komposisi data'; strategyIcon = '📊'; }
      else if (/sebab|mengapa|faktor|penyebab|kenapa/i.test(query)) { strategy = 'Mengidentifikasi faktor & analisis kausal'; strategyIcon = '🔎'; }
      else if (/prediksi|proyeksi|forecast|ramalan/i.test(query)) { strategy = 'Menyusun analisis proyeksi berdasarkan tren'; strategyIcon = '🔮'; }
      emitThinkingItem({ step: 'strategy', icon: strategyIcon, label: strategy });
    }

    // Emit intent event (matches legacy protocol for backward compat)
    ctx.sse.sendEvent('intent', {
      datasource: ctx.intentResult?.datasource || null,
      candidates: (ctx.candidates || []).slice(0, 5).map(c => ({
        id: c.id, name: c.name, type: c.type,
      })),
      hasPreview: Boolean(ctx.dataPreview),
      effectiveQuery: ctx.effectiveQuery !== ctx.userMessage.slice(0, 4000) ? ctx.effectiveQuery : null,
      periodFallback: ctx.periodFallback || null,
      modelTier: ctx.modelRoute?.tier || 'simple',
    });

    // ── Token budget enforcement (H4) — delegated to trimMessagesToBudget() ──
    // gpt-5-mini has 400K context window, but Copilot proxy has payload limits.
    // Context is trimmed in stageModelSelect() via trimMessagesToBudget().
    // Budget: 100K chars (~25-30K tokens). See MAX_CONTEXT_CHARS constant.

    // ── Stage 7b: Query Orchestrator (Sub-Agent Option C) ──────────────
    // For complex analytical queries, decomposes the question into sub-tasks,
    // runs parallel worker agents for focused extraction, and injects their
    // pre-analyzed findings into the system prompt.
    {
      const { shouldActivateOrchestrator, orchestrate } = require('./orchestrator.service');
      if (shouldActivateOrchestrator(ctx)) {
        ctx.sse.sendEvent('status', { message: 'Menganalisis secara mendalam…', stage: 'orchestrator' });
        const t7b = Date.now();
        const orchResult = await orchestrate(ctx);
        timings.orchestrator = Date.now() - t7b;

        if (orchResult?.activated) {
          ctx._orchestratorUsed = true;
          ctx._orchestratorTasks = orchResult.taskCount;
          ctx._orchestratorWorkers = orchResult.workerResults;
          ctx._orchestratorLatencyMs = orchResult.totalLatencyMs;
          ctx.sse.sendEvent('status_detail', {
            stage: 'orchestrator',
            detail: `${orchResult.taskCount} sub-analisis · ${orchResult.workerResults} selesai · ${orchResult.totalLatencyMs}ms`,
          });

          // Emit individual sub-questions as thinking items for the timeline
          if (orchResult.subQuestions?.length > 0) {
            const typeIcons = { extraction: '📊', comparison: '⚖️', trend: '📈', ranking: '🏆' };
            for (const sq of orchResult.subQuestions) {
              if (!ctx.sse.isClientConnected()) break;
              ctx.sse.sendEvent('thinking', {
                step: 'orchestrator-sub',
                icon: typeIcons[sq.type] || '📋',
                label: sq.question,
                tags: [sq.type || 'analisis'],
              });
            }
          }

          // Re-run budget trimming after orchestrator injection
          // (pre-analysis text was appended to system prompt)
          const budgetResult2 = trimMessagesToBudget(ctx.openAiMessages);
          if (budgetResult2.trimmed) {
            ctx.openAiMessages = budgetResult2.messages;
            ctx._contextTrimmed = true;
          }
        }
      }
    }

    // ── Client disconnect check ──────────────────────────────────────
    if (!ctx.sse?.isClientConnected?.()) {
      logger.info({ threadId, timings }, 'Client disconnected before streaming stage — aborting');
      return;
    }

    // ── Stage 8: AI SDK streaming ──────────────────────────────────────
    { const _t = getTopicLabel(ctx); ctx.sse.sendEvent('status', { message: _t ? `Merangkum data "${_t}"…` : 'Merangkum & menarasikan data…', stage: 'generate' }); }
    const t8 = Date.now();
    await stageStream(ctx, svc);
    timings.stream = Date.now() - t8;
    // Detail: generation stats
    {
      const textLen = ctx._streamFullText?.length || 0;
      const u = ctx._usage;
      const supMs = ctx.timings?.supervisor || 0;
      if (u) {
        ctx.sse.sendEvent('status_detail', { stage: 'generate', detail: `${textLen} karakter · ${u.inputTokens || 0}→${u.outputTokens || 0} token${u.cachedInputTokens ? ` · cache: ${u.cachedInputTokens}` : ''}${supMs ? ` · review: ${supMs}ms` : ''}` });
      } else {
        ctx.sse.sendEvent('status_detail', { stage: 'generate', detail: `${textLen} karakter dihasilkan` });
      }
    }

    timings.total = Date.now() - startTime;
    logger.info({ requestId, threadId, timings, tier: ctx.modelRoute?.tier }, 'Pipeline completed');

    // ── Stage 9+10: suggestions already sent inside stageStream (Phase 3) ──
    // Suggestions ran in parallel with supervisor inside stageStream().
    // Done event sends after suggestions have been received by frontend.
    if (ctx._donePayload && ctx.sse?.isClientConnected?.()) {
      ctx.sse.sendEvent('done', ctx._donePayload);
    }

  } catch (error) {
    logger.error({ requestId, threadId, error: error.message, timings }, 'Pipeline error');
    try {
      if (ctx.sse?.isClientConnected?.()) {
        ctx.sse.sendEvent('error', { message: error.message || 'Unknown error' });
      }
    } catch { /* no-op */ }
  } finally {
    clearTimeout(pipelineTimer);
    try {
      ctx.sse?.end?.();
    } catch { /* no-op */ }
    // Schedule minor GC to reclaim per-request allocations (LLM strings, context objects)
    // Deferred to avoid blocking the response path
    if (typeof global.gc === 'function') {
      setImmediate(() => { try { global.gc({ type: 'minor' }); } catch {} });
    }
  }

  }); // end requestContext.run()
}

// ── Stage implementations ───────────────────────────────────────────────

/**
 * Stage 1: SSE setup, thread validation, user message save
 */
async function stageValidate(ctx, svc) {
  const { createSSEHandler } = require('./sse.service');
  const ChatThread = require('../../../models/ChatThread.model');
  const ChatMessage = require('../../../models/ChatMessage.model');

  // Init SSE connection (skip if pre-established by concurrency queue)
  if (!ctx.sse) {
    ctx.sse = createSSEHandler({ res: ctx.res, threadId: ctx.threadId });
  }

  // Validate thread ownership
  const thread = await ChatThread.findOne({
    where: { id: ctx.threadId, owner_id: ctx.ownerId },
  });
  if (!thread) {
    ctx.sse.sendEvent('error', { message: 'Thread not found' });
    ctx.sse.end();
    throw new Error('Thread not found');
  }
  ctx.thread = thread;

  // Save user message
  const userMsg = await ChatMessage.create({
    thread_id: ctx.threadId,
    role: 'user',
    content: ctx.userMessage.slice(0, 8000),
    created_at: now(),
  });
  ctx.userMsg = userMsg;
  ctx.sse.sendEvent('user_saved', { id: userMsg.id });

  // Auto-update thread title (delegated to legacy)
  if (svc.updateThreadTitleIfNeeded) {
    const titleUpdated = await svc.updateThreadTitleIfNeeded(thread, ctx.userMessage);
    if (titleUpdated) {
      ctx.sse.sendEvent('thread_updated', { title: thread.title, topics: thread.topics });
    }
  }
}

/**
 * Stage 0 (post-validate): Gate Agent — classify query before heavy stages.
 *
 * Handles four early-exit routes directly:
 *   - greeting     → template response, skip all stages
 *   - chitchat     → template response (thanks/farewell/ack), skip all stages
 *   - decline      → canned out-of-scope response
 *   - decline_individual → Pasal 21 compliance response
 *
 * For all other routes, stores hints on ctx.gate that downstream stages use
 * to skip unnecessary work (e.g. skipIntent, skipPreview, forceKnowledge).
 */
async function stageGate(ctx, svc) {
  // Load recent history for follow-up detection (lightweight — latest 10 messages)
  const ChatMessage = require('../../../models/ChatMessage.model');
  const recentMessages = await ChatMessage.findAll({
    where: { thread_id: ctx.threadId },
    order: [['id', 'DESC']],
    limit: 10,
    attributes: ['id', 'role', 'content'],
  });
  const historyForGate = recentMessages.reverse().map(m => m.toJSON());

  // Extract previous uiMeta for context
  let prevUiMeta = null;
  const lastAssistant = historyForGate.filter(m => m.role === 'assistant').pop();
  if (lastAssistant?.content) {
    const uiMatch = lastAssistant.content.match(/```malika_ui\n([\s\S]*?)\n```/);
    if (uiMatch) {
      try { prevUiMeta = JSON.parse(uiMatch[1]); } catch { /* ignore */ }
    }
  }

  const gate = await classifyQuery(ctx.userMessage, {
    historyArray: historyForGate,
    prevUiMeta,
  });

  // For routes that return early, handle them here
  if (gate.route === ROUTES.GREETING) {
    // Short-circuit: respond with a canned template — no pipeline stages, no progress indicator
    const { getGreetingTemplate } = require('./prompt.service');
    const greetingText = getGreetingTemplate();

    ctx.sse.sendEvent('text', { content: greetingText });

    const uiMeta = {
      v: 1,
      metadata: {
        model: 'gate-agent',
        tier: 'GREETING',
        reasoning: false,
        tokens: null,
        latency_ms: gate.latencyMs,
        gate: { route: gate.route, reason: gate.reason },
      },
    };
    ctx.sse.sendEvent('malika_ui', uiMeta);

    // Static example-query suggestions
    try {
      if (ctx.sse?.isClientConnected?.()) {
        ctx.sse.sendEvent('suggestions_update', {
          suggestions: [
            'Data kemiskinan terbaru',
            'Inflasi per kabupaten/kota',
            'IPM Maluku Utara',
            'Jumlah penduduk 2024',
            'PDRB per sektor',
          ],
        });
      }
    } catch (e) {
      logger.debug({ error: e?.message }, 'Greeting suggestions failed');
    }

    ctx.sse.sendEvent('done', { full_text: greetingText });

    // Save to DB
    try {
      const { now: nowFn } = require('../../../utils/dateHelper');
      const ChatMessage = require('../../../models/ChatMessage.model');
      await ChatMessage.create({
        thread_id: ctx.threadId,
        role: 'assistant',
        content: greetingText + `\n\n\`\`\`malika_ui\n${JSON.stringify(uiMeta)}\n\`\`\`\n`,
        created_at: nowFn(),
      });
    } catch (e) {
      logger.warn({ error: e.message }, 'Failed to save greeting message');
    }

    ctx.isGreeting = true;
    ctx._gateHandled = true;
    return gate;
  }

  if (gate.route === ROUTES.CHITCHAT) {
    // Short-circuit: respond with a canned chitchat template — no pipeline stages
    const { getChitchatTemplate } = require('./prompt.service');
    const chitchatText = getChitchatTemplate(ctx.userMessage);

    ctx.sse.sendEvent('text', { content: chitchatText });

    const uiMeta = {
      v: 1,
      metadata: {
        model: 'gate-agent',
        tier: 'CHITCHAT',
        reasoning: false,
        tokens: null,
        latency_ms: gate.latencyMs,
        gate: { route: gate.route, reason: gate.reason },
      },
    };
    ctx.sse.sendEvent('malika_ui', uiMeta);

    // Static example-query suggestions
    try {
      if (ctx.sse?.isClientConnected?.()) {
        ctx.sse.sendEvent('suggestions_update', {
          suggestions: [
            'Data kemiskinan terbaru',
            'Inflasi per kabupaten/kota',
            'IPM Maluku Utara',
            'Jumlah penduduk 2024',
            'PDRB per sektor',
          ],
        });
      }
    } catch (e) {
      logger.debug({ error: e?.message }, 'Chitchat suggestions failed');
    }

    ctx.sse.sendEvent('done', { full_text: chitchatText });

    // Save to DB
    try {
      const { now: nowFn } = require('../../../utils/dateHelper');
      const ChatMessage = require('../../../models/ChatMessage.model');
      await ChatMessage.create({
        thread_id: ctx.threadId,
        role: 'assistant',
        content: chitchatText + `\n\n\`\`\`malika_ui\n${JSON.stringify(uiMeta)}\n\`\`\`\n`,
        created_at: nowFn(),
      });
    } catch (e) {
      logger.warn({ error: e.message }, 'Failed to save chitchat message');
    }

    ctx._gateHandled = true;
    return gate;
  }

  if (gate.route === ROUTES.DECLINE || gate.route === ROUTES.DECLINE_INDIVIDUAL) {
    const declineText = gate.declineText || 'Mohon maaf, silakan tanyakan tentang data statistik Maluku Utara.';

    // Send the decline response directly
    ctx.sse.sendEvent('text', { content: declineText });

    const uiMeta = {
      v: 1,
      metadata: {
        model: 'gate-agent',
        tier: 'DECLINE',
        reasoning: false,
        tokens: null,
        latency_ms: gate.latencyMs,
        gate: { route: gate.route, reason: gate.reason },
      },
    };
    ctx.sse.sendEvent('malika_ui', uiMeta);

    // Use static suggestions for decline — never reference the user's declined query
    // (LLM suggestions would incorporate personal names / inappropriate content from the query)
    try {
      if (ctx.sse?.isClientConnected?.()) {
        ctx.sse.sendEvent('suggestions_update', {
          suggestions: [
            'Data kemiskinan terbaru',
            'Inflasi per kabupaten/kota',
            'IPM Maluku Utara',
            'Jumlah penduduk 2024',
            'PDRB per sektor',
          ],
        });
      }
    } catch (e) {
      logger.debug({ error: e?.message }, 'Static suggestions for decline failed');
    }

    ctx.sse.sendEvent('done', { full_text: declineText });

    // Save to DB
    try {
      const { now: nowFn } = require('../../../utils/dateHelper');
      await ChatMessage.create({
        thread_id: ctx.threadId,
        role: 'assistant',
        content: declineText + `\n\n\`\`\`malika_ui\n${JSON.stringify(uiMeta)}\n\`\`\`\n`,
        created_at: nowFn(),
      });
    } catch (e) {
      logger.warn({ error: e.message }, 'Failed to save decline message');
    }

    ctx._gateHandled = true;
    return gate;
  }

  return gate;
}

/**
 * Stage 2: Load history, detect context, merge queries
 */
async function stageContext(ctx, svc) {
  const ChatMessage = require('../../../models/ChatMessage.model');

  // Load history (use config value, not hardcoded)
  const { CONTEXT } = require('./config');
  const historyLimit = CONTEXT.MAX_HISTORY_MESSAGES || 50;
  const historyMessages = await ChatMessage.findAll({
    where: { thread_id: ctx.threadId },
    order: [['id', 'ASC']],
    limit: historyLimit,
  });
  ctx.historyArray = historyMessages.map(m => m.toJSON());

  // ── Persistent Memory: retrieve relevant user memories ────────────
  ctx.memoryContext = null;
  try {
    const pm = getPersistentMemory();
    if (pm.CONFIG.ENABLED) {
      ctx.memoryContext = await pm.buildMemoryContext(ctx.ownerId, ctx.userMessage.slice(0, 500));
    }
  } catch (e) {
    logger.debug({ error: e.message }, 'Memory retrieval skipped');
  }

  const clipped = ctx.userMessage.slice(0, 10000);

  // Detect message type using legacy helpers
  // Preserve gate's greeting detection (LLM gate may catch greetings that regex misses)
  ctx.isGreeting = ctx.isGreeting || svc.isGreeting?.(clipped) || false;
  ctx.isConfirm = svc.isConfirmMessage?.(clipped) || false;

  // Greetings are now short-circuited in stageGate (template response, no pipeline).
  // ctx.isGreeting is kept for model routing if gate didn't catch it.

  // Detect fragments and build effective query (delegate to legacy)
  const isPeriodFragment = svc.isLikelyTimeOrPeriodFragment?.(clipped) || false;
  const isGeoOnlyFragment = svc.isLikelyGeoOnlyFragment?.(clipped) || false;
  const isFollowUp = svc.isShortFollowUp?.(clipped) || false;
  const lastMeaningful = svc.findLastMeaningfulUserQuery?.(ctx.historyArray) || null;
  ctx.prevUiMeta = svc.findLastAssistantUiMeta?.(ctx.historyArray) || null;
  ctx.conversationTopic = svc.findConversationTopic?.(ctx.historyArray) || null;

  const wasKnowledgeMode = svc.isPrevContextKnowledgeMode?.(ctx.prevUiMeta, ctx.historyArray) || false;
  const isProceduralFaq = svc.isProceduralFaqQuery?.(clipped) || false;
  const isAltSource = svc.isAlternativeSourceRequest?.(clipped) || false;
  const askingDiffType = svc.isDifferentDataTypeRequest?.(clipped, ctx.prevUiMeta?.candidates?.[0]?.name || '') || false;
  const isComparison = svc.isComparisonFollowUp?.(clipped) || false;

  // Query merge logic (mirrors legacy exactly)
  let effectiveQuery = clipped;
  ctx._shouldPreferPrevCandidates = false;

  if (isProceduralFaq) {
    effectiveQuery = clipped;
  } else if (isAltSource && lastMeaningful) {
    const subject = svc.extractDataSubject?.(lastMeaningful) || lastMeaningful;
    effectiveQuery = subject;
  } else if (isComparison && ctx.conversationTopic) {
    // Comparison follow-ups (e.g. "bandingkan dengan kabupaten lain") should
    // keep the same datasource and just change scope.  Prefer prev candidates
    // so stagePreview can show all-region data from the same source.
    effectiveQuery = svc.mergeQuery?.(ctx.conversationTopic, clipped) || clipped;
    ctx._shouldPreferPrevCandidates = true;
  } else if (askingDiffType && ctx.conversationTopic) {
    effectiveQuery = svc.mergeQuery?.(ctx.conversationTopic, clipped) || clipped;
  } else if (isGeoOnlyFragment && ctx.conversationTopic) {
    effectiveQuery = svc.mergeQuery?.(ctx.conversationTopic, clipped) || clipped;
  } else if (ctx.isConfirm && lastMeaningful) {
    effectiveQuery = lastMeaningful;
    ctx._shouldPreferPrevCandidates = true;
  } else if (!ctx.isConfirm && (isPeriodFragment || isFollowUp) && lastMeaningful) {
    effectiveQuery = svc.mergeQuery?.(lastMeaningful, clipped) || clipped;
    ctx._shouldPreferPrevCandidates = true;
  } else if (!ctx.isConfirm && ctx.conversationTopic && !svc.hasSubstantiveKeywords?.(clipped)) {
    effectiveQuery = svc.mergeQuery?.(ctx.conversationTopic, clipped) || clipped;
    ctx._shouldPreferPrevCandidates = true;
  }

  ctx.effectiveQuery = effectiveQuery;
  ctx._wasKnowledgeMode = wasKnowledgeMode;
  ctx._askingDiffType = askingDiffType;

  console.log('[pipeline:context]', {
    clipped: clipped.slice(0, 80),
    effectiveQuery: effectiveQuery.slice(0, 100),
    conversationTopic: ctx.conversationTopic,
    isComparison, askingDiffType, isFollowUp, isPeriodFragment, isGeoOnlyFragment,
    shouldPreferPrev: ctx._shouldPreferPrevCandidates,
    prevCandidates: ctx.prevUiMeta?.candidates?.length || 0,
  });
}

/**
 * Stage 3: Query normalization (abbreviations, year, geo)
 */
async function stageNormalize(ctx, svc) {
  let query = ctx.effectiveQuery;

  // Light normalization
  if (svc.queryNormalizerService?.lightNormalize) {
    query = svc.queryNormalizerService.lightNormalize(query);
  }

  // Year inference
  ctx.yearInference = null;
  if (svc.yearInferenceService) {
    const result = svc.yearInferenceService.inferYear(query, { preferLatest: true });
    if (result?.year) {
      ctx.yearInference = result;
      if (result.isInferred) {
        query = svc.yearInferenceService.normalizeYearInQuery(query);
      }
    }
  }

  // Geo inference
  ctx.geoInference = null;
  if (svc.geoInferenceService) {
    ctx.geoInference = svc.geoInferenceService.inferGeoFilter(query);
    if (ctx.geoInference?.hasGeo) {
      query = svc.geoInferenceService.normalizeGeoInQuery(query);
    }
  }

  ctx.normalizedQuery = query;
}

/**
 * Stage 4: Intent resolution + candidate ranking
 * (Delegates to legacy intent service — no change in ranking logic)
 */
async function stageIntent(ctx, svc) {
  const { resolveSearchIntent, buildDatasourceCandidates } = require('../../search/intent.service');

  // ── Gate hint: skip intent entirely if gate says so (e.g., knowledge route) ──
  if (ctx.gate?.skipIntent && ctx.gate?.route !== ROUTES.STATISTICAL_FAST) {
    logger.info({ gateRoute: ctx.gate.route }, 'stageIntent: SKIPPED by gate hint');
    ctx.candidates = [];
    return;
  }

  // ── DNA enrichment: use enriched query for better datasource matching ──
  // If DNA found official names/synonyms, use the enriched query
  const intentQuery = ctx.dnaEnrichedQuery || ctx.normalizedQuery;
  if (ctx.dnaEnrichedQuery && ctx.dnaEnrichedQuery !== ctx.normalizedQuery) {
    logger.info({ original: ctx.normalizedQuery, enriched: ctx.dnaEnrichedQuery.slice(0, 120) }, 'stageIntent: using DNA-enriched query');
  }

  // ── Gate hint: use gate-provided fast-path IDs ──────────────────
  if (ctx.gate?.route === ROUTES.STATISTICAL_FAST && ctx.gate?.fastPathIds?.length) {
    try {
      const DataSource = require('../../../models/DataSource.model');
      const sources = await DataSource.findAll({
        where: { id: ctx.gate.fastPathIds },
        attributes: ['id', 'name', 'description', 'type', 'aliases', 'category', 'visible', 'bps_web_url'],
      });
      ctx.candidates = sources.map(ds => ({
        id: ds.id, name: ds.name, description: ds.description,
        type: ds.type, aliases: ds.aliases || null, category: ds.category || null, score: 100,
        bps_web_url: ds.bps_web_url || null,
      }));
      if (ctx.candidates.length > 0) {
        logger.info({ gateRoute: ctx.gate.route, fastPathId: ctx.gate.fastPathResult?.id, candidates: ctx.candidates.length }, 'stageIntent: gate fast-path used');
        ctx._usedFastPath = true;            // expose to stagePreview
        return;
      }
    } catch { /* fall through to normal intent */ }
  }

  // Fast-path: use hardcoded datasource IDs for known statistical queries
  // This skips the expensive resolveSearchIntent chain (synonym expansion + embedding + QB LLM)
  // Even for skipRag=false mappings, we use their datasourceIds to avoid the 4-7s intent resolution
  // Try normalizedQuery first, then fall back to original userMessage (may differ due to topic merging)
  let usedFastPath = false;
  if (svc.queryFastPathService) {
    const originalClipped = ctx.userMessage.slice(0, 10000).trim().toLowerCase();
    const fpDatasources = svc.queryFastPathService.getFastPathDatasources?.(intentQuery)
                       || svc.queryFastPathService.getFastPathDatasources?.(ctx.normalizedQuery)
                       || svc.queryFastPathService.getFastPathDatasources?.(originalClipped);
    logger.info({ query: ctx.normalizedQuery, original: originalClipped, fpDatasources }, 'Fast-path check');
    if (fpDatasources?.length) {
      try {
        const DataSource = require('../../../models/DataSource.model');
        const sources = await DataSource.findAll({
          where: { id: fpDatasources },
          attributes: ['id', 'name', 'description', 'type', 'aliases', 'category', 'visible', 'bps_web_url'],
        });
        ctx.candidates = sources.map(ds => ({
          id: ds.id, name: ds.name, description: ds.description,
          type: ds.type, aliases: ds.aliases || null, category: ds.category || null, score: 100,
          bps_web_url: ds.bps_web_url || null,
        }));
        if (ctx.candidates.length > 0) {
          usedFastPath = true;
          ctx._usedFastPath = true;          // expose to stagePreview
          logger.info({ query: ctx.normalizedQuery, candidates: ctx.candidates.length }, 'Intent fast-path used');
        }
      } catch { usedFastPath = false; }
    }
  }

  if (!usedFastPath) {
    try {
      ctx.intentResult = await resolveSearchIntent({ q: intentQuery, context: {} });
    } catch { /* continue */ }

    try {
      ctx.candidates = await buildDatasourceCandidates({
        q: intentQuery,
        qb: ctx.intentResult?.query_builder || null,
        limit: 12,
      });
      if (!Array.isArray(ctx.candidates)) ctx.candidates = [];
    } catch { ctx.candidates = []; }
  }

  // Candidate locking / fallback from previous context
  if (ctx._shouldPreferPrevCandidates && ctx.prevUiMeta?.candidates?.length > 0 && ctx.candidates.length === 0) {
    ctx.candidates = ctx.prevUiMeta.candidates.map(c => ({
      id: c.id, name: c.name, type: c.type, score: c.score || 80,
      bps_web_url: c.bps_web_url || null,
    }));
  }

  // Fallback: if candidates empty but intent resolved a datasource, populate from DB
  if (ctx.candidates.length === 0 && ctx.intentResult?.datasource?.source_id) {
    try {
      const DataSource = require('../../../models/DataSource.model');
      const ds = await DataSource.findByPk(ctx.intentResult.datasource.source_id, {
        attributes: ['id', 'name', 'description', 'type', 'aliases', 'category', 'bps_web_url'],
      });
      if (ds) {
        ctx.candidates = [{
          id: ds.id, name: ds.name, description: ds.description,
          type: ds.type, aliases: ds.aliases || null, category: ds.category || null, score: 85,
          bps_web_url: ds.bps_web_url || null,
        }];
        logger.info({ sourceId: ds.id, name: ds.name }, 'stageIntent: populated candidate from intentResult datasource');
      }
    } catch { /* continue without candidate */ }
  }
}

/**
 * Stage 5: Data preview — fetches actual table data from data_bps / ProcessedCache / API.
 *
 * This mirrors the V1 logic in streamChatResponse (lines ~3920-4300) but delegates
 * the actual data-fetching to helper functions exposed via svc.
 *
 * Populates: ctx.dataPreview, ctx.periodFallback, ctx.isEximQuery, ctx.eximParams
 */

/**
 * Build EXIM preview from a single source.
 * Shared helper to avoid duplication in year / no-year branches.
 */
async function _fetchOneEximPreview(svc, { sourceId, year, eximMonth, eximGroup, eximFacets, eximMode, effectiveQuery, monthNameFromNo }) {
  if (!svc.getEximPreviewFromApi) return null;
  const data = await svc.getEximPreviewFromApi({
    sourceId, year, month: eximMonth,
    group: eximGroup, codeHs: eximFacets?.code_hs || null,
    pod: eximFacets?.pod || null, ctr: eximFacets?.ctr || null, metric: null,
  });
  if (!data?.data?.length) return null;

  const groupLabel = eximGroup === 'hs2' ? ' (per Komoditas)' : eximGroup === 'ctr' ? ' (per Negara)' : eximGroup === 'pod' ? ' (per Pelabuhan)' : '';
  const monthLabel = eximMonth ? ` • ${monthNameFromNo(eximMonth)}` : '';
  const mode = eximMode === 'impor' ? 'impor' : 'ekspor';
  const modeLabel = mode === 'ekspor' ? 'Ekspor' : 'Impor';
  const titlePrefix = eximMode === 'both'
    ? `${modeLabel} Maluku Utara`
    : (data.source || `${modeLabel} Maluku Utara`);

  return {
    title: `${titlePrefix}${groupLabel} • ${year}${monthLabel}`,
    columns: selectRelevantColumns(data.columns || [], effectiveQuery),
    total_columns: (data.columns || []).length,
    rows: data.data.slice(0, 100), total_rows: data.data.length,
    from: data.from, eximGroup, eximMode: mode,
  };
}

/**
 * Fetch both EXIM sources (ekspor + impor) or a single one.
 * Sets ctx.dataPreview / ctx.dataPreviewSecondary.
 * @returns {boolean} true if preview was set
 */
async function _fetchEximDual(ctx, svc, { selectedSourceId, year, eximMonth, eximGroup, eximFacets, eximMode, effectiveQuery, monthNameFromNo }) {
  const opts = { year, eximMonth, eximGroup, eximFacets, eximMode, effectiveQuery, monthNameFromNo };
  if (eximMode === 'both') {
    const [eksporData, imporData] = await Promise.all([
      _fetchOneEximPreview(svc, { ...opts, sourceId: EXIM.EKSPOR_SOURCE_ID }),
      _fetchOneEximPreview(svc, { ...opts, sourceId: EXIM.IMPOR_SOURCE_ID }),
    ]);
    if (eksporData) ctx.dataPreview = eksporData;
    if (imporData) ctx.dataPreviewSecondary = imporData;
    if (!ctx.dataPreview && ctx.dataPreviewSecondary) {
      ctx.dataPreview = ctx.dataPreviewSecondary;
      ctx.dataPreviewSecondary = null;
    }
  } else {
    const eximData = await _fetchOneEximPreview(svc, { ...opts, sourceId: selectedSourceId });
    if (eximData) ctx.dataPreview = eximData;
  }
  return !!ctx.dataPreview;
}

/**
 * Fetch all-years data for modal year-tab UI.
 * Appends allRows/allColumns/availableYears to ctx.dataPreview.
 */
async function _fetchAllYearsForModal(ctx, svc, selectedSourceId, requestedYear, requestedGeo) {
  if (!ctx.dataPreview || ctx.isEximQuery || !selectedSourceId || !svc.getProcessedPreviewForRange) return;
  try {
    const DataPeriod = require('../../../models/DataPeriod.model');
    const periods = await DataPeriod.findAll({
      where: { source_id: selectedSourceId },
      attributes: ['period_value'],
      raw: true,
    });
    const allYears = [...new Set(
      periods.map(p => String(p.period_value).trim())
        .filter(y => /^(19\d{2}|20\d{2}|2100)$/.test(y) || /^\d{2,3}$/.test(y))
    )].sort((a, b) => parseInt(b, 10) - parseInt(a, 10));

    if (allYears.length > 1) {
      const rangeData = await svc.getProcessedPreviewForRange({
        sourceId: selectedSourceId, years: allYears, geo: requestedGeo,
      });
      if (rangeData?.data?.length > 0) {
        ctx.dataPreview.allRows = rangeData.data;
        ctx.dataPreview.allColumns = rangeData.columns;
        ctx.dataPreview.availableYears = rangeData.availableYears || allYears;
        const availYears = ctx.dataPreview.availableYears;
        ctx.dataPreview.defaultYear =
          (requestedYear && availYears.includes(String(requestedYear)))
            ? String(requestedYear)
            : (availYears[0] || allYears[0]);
        ctx.dataPreview.source_id = selectedSourceId;
        logger.debug({
          sourceId: selectedSourceId,
          yearCount: ctx.dataPreview.availableYears.length,
          totalRows: rangeData.data.length,
        }, 'stagePreview: all-years data loaded for modal tabs');
      }
    } else {
      ctx.dataPreview.source_id = selectedSourceId;
      ctx.dataPreview.availableYears = allYears;
      ctx.dataPreview.defaultYear = allYears[0] || (requestedYear ? String(requestedYear) : null);
    }
  } catch (e) {
    logger.warn({ error: e.message, sourceId: selectedSourceId }, 'stagePreview: allYears fetch failed');
  }
}

async function stagePreview(ctx, svc) {
  const { detectMergeBundle, detectMonthlyBundle } = require('./mergeBundles');
  const { inferEximGroupFromQuery, extractEximQueryFacets, detectEximModeFromQuery, extractEximMonth, monthNameFromNo, isEximQuery: checkIsExim } = require('./eximHandler');

  ctx.dataPreview = null;
  ctx.dataPreviewSecondary = null;
  ctx.periodFallback = null;
  ctx.isEximQuery = false;
  ctx.eximParams = null;

  // ── Gate hint: skip preview for knowledge/decline routes ─────────────
  if (ctx.gate?.skipPreview) {
    logger.debug({ gateRoute: ctx.gate.route }, 'stagePreview: SKIPPED by gate hint');
    return;
  }

  // ── Determine source ID ──────────────────────────────────────────────
  let selectedSourceId = ctx.candidates?.[0]?.id || ctx.intentResult?.datasource?.source_id || null;
  if (!selectedSourceId) return;

  // Track which source_id the pipeline fetches for (used by tool dedup)
  ctx._previewSourceId = selectedSourceId;

  const effectiveQuery = ctx.effectiveQuery || ctx.userMessage;
  const selectedSourceType = ctx.candidates?.[0]?.type || ctx.intentResult?.datasource?.type || 'dynamic';

  // ── Requested year / geo from intent + inference ─────────────────────
  let requestedYear = ctx.intentResult?.query_builder?.params?.year
    || ctx.yearInference?.year
    || null;
  let requestedGeo = ctx.intentResult?.query_builder?.params?.geo || null;

  // Inherit year from previous context if not specified
  if (!requestedYear && ctx._shouldPreferPrevCandidates && ctx.prevUiMeta && svc.extractContextFromPrevUiMeta) {
    const prev = svc.extractContextFromPrevUiMeta(ctx.prevUiMeta);
    if (prev?.year) requestedYear = prev.year;
  }

  // Extract geo from effective query if not from intent
  if (!requestedGeo) {
    const geoMatch = effectiveQuery.toLowerCase().match(GEO_DETECT_REGEX);
    if (geoMatch) requestedGeo = geoMatch[1].replace(/\s+/g, ' ');
  }

  // Clear geo if user wants all-region comparison
  const wantsAllRegions = /\b(semua|seluruh)\s+(kabupaten|kota|wilayah)/i.test(effectiveQuery) ||
    /\bper\s+(kabupaten|kota)/i.test(effectiveQuery) ||
    /\bbandingkan\s+(dengan\s+)?(kabupaten|kota|wilayah)/i.test(effectiveQuery);
  if (wantsAllRegions && requestedGeo) requestedGeo = null;

  // ── EXIM detection ───────────────────────────────────────────────────
  ctx.isEximQuery = selectedSourceType === 'exim' || checkIsExim(effectiveQuery);

  let eximGroup = null, eximFacets = {}, eximMonth = null, eximMode = null;
  if (ctx.isEximQuery) {
    eximMode = detectEximModeFromQuery(effectiveQuery);
    eximGroup = inferEximGroupFromQuery(effectiveQuery);
    eximFacets = extractEximQueryFacets(effectiveQuery);
    eximMonth = extractEximMonth(effectiveQuery) || ctx.intentResult?.query_builder?.params?.month || null;
    if (!eximGroup && /\b(terbanyak|tertinggi|terbesar|terendah)\b/i.test(effectiveQuery)) eximGroup = 'hs2';

    // Prefer actual EXIM source for grouped queries
    if (eximGroup && ctx.candidates?.length > 0) {
      if (eximMode === 'both') {
        // Ensure both EXIM sources are at the front
        for (const eid of [EXIM.EKSPOR_SOURCE_ID, EXIM.IMPOR_SOURCE_ID]) {
          const idx = ctx.candidates.findIndex(c => c.id === eid);
          if (idx > 0) {
            const [moved] = ctx.candidates.splice(idx, 1);
            ctx.candidates.unshift(moved);
          }
        }
        selectedSourceId = EXIM.EKSPOR_SOURCE_ID; // primary = ekspor
        ctx._previewSourceId = selectedSourceId;
      } else {
        const eximSourceId = eximMode === 'impor' ? EXIM.IMPOR_SOURCE_ID : EXIM.EKSPOR_SOURCE_ID;
        if (ctx.candidates.some(c => c.id === eximSourceId) && selectedSourceId !== eximSourceId) {
          selectedSourceId = eximSourceId;
          ctx._previewSourceId = selectedSourceId;
          const idx = ctx.candidates.findIndex(c => c.id === eximSourceId);
          if (idx > 0) {
            const [moved] = ctx.candidates.splice(idx, 1);
            ctx.candidates.unshift(moved);
          }
        }
      }
    }
    ctx.eximParams = { group: eximGroup, month: eximMonth, facets: eximFacets, mode: eximMode };
  }

  // ── Confidence gate — skip table for low-confidence or off-topic ────
  const topScore = ctx.candidates?.[0]?.score || 0;
  // If candidates are empty but intent resolved a datasource, trust the intent result
  const hasIntentDatasource = !!(ctx.intentResult?.datasource?.source_id);
  let isTopicRelevant = true;
  // Fast-path candidates are inherently topic-relevant (already matched by pattern)
  // Intent-resolved datasources (no candidates) are also trusted
  if (!ctx._usedFastPath && !hasIntentDatasource && ctx.conversationTopic && ctx.candidates?.length > 0) {
    const top = ctx.candidates[0];
    // Build haystack from candidate's own metadata (name + aliases + category)
    // This mirrors scoreDatasource() logic and scales to ALL indicators automatically
    const hay = [
      top.name || '',
      top.aliases || '',
      top.category || '',
    ].join(' ').toLowerCase();
    const topicLower = ctx.conversationTopic.toLowerCase();
    // Check full topic string first, then individual words
    const topicTokens = [topicLower, ...topicLower.split(/\s+/).filter(w => w.length >= 2)];
    isTopicRelevant = topicTokens.some(t => hay.includes(t));
  }
  const shouldShowPreview = (topScore >= 70 || hasIntentDatasource) && isTopicRelevant;
  if (!shouldShowPreview) {
    logger.info({ topScore, hasIntentDatasource, isTopicRelevant, conversationTopic: ctx.conversationTopic }, 'stagePreview: SKIPPED by confidence gate');
    return;
  }

  logger.debug({ selectedSourceId, selectedSourceType, requestedYear, requestedGeo, wantsAllRegions, isExim: ctx.isEximQuery }, 'stagePreview: enter data fetch');

  // ── Period range handling (e.g. "2020-2024") ─────────────────────────
  if (svc.extractPeriodRange) {
    const periodRange = svc.extractPeriodRange(ctx.intentResult?.query_builder);
    if (periodRange?.years?.length > 1 && svc.getProcessedPreviewForRange) {
      const rangeData = await svc.getProcessedPreviewForRange({
        sourceId: selectedSourceId, years: periodRange.years, geo: requestedGeo,
      });
      if (rangeData?.data?.length > 0) {
        const yearLabel = rangeData.availableYears?.length > 1
          ? `${rangeData.availableYears[0]}-${rangeData.availableYears[rangeData.availableYears.length - 1]}`
          : String(rangeData.availableYears?.[0] || periodRange.yearEnd);
        const allCols = rangeData.columns || [];
        ctx.dataPreview = {
          title: `${rangeData.source} • ${yearLabel}${requestedGeo ? ` • ${requestedGeo}` : ''}`,
          columns: selectRelevantColumns(allCols, effectiveQuery),
          total_columns: allCols.length,
          rows: rangeData.data.slice(0, 100),
          total_rows: rangeData.data.length,
          geo: requestedGeo, from: rangeData.from,
          periodRange: { requested: { start: periodRange.yearStart, end: periodRange.yearEnd }, available: rangeData.availableYears },
        };
        requestedYear = periodRange.yearEnd;
        return; // range preview done
      }
      // Range failed → fall through to single year (use end year)
      requestedYear = periodRange.yearEnd;
    }
  }

  // ── Single year / latest handling ────────────────────────────────────
  if (selectedSourceId && requestedYear) {
    // EXIM data
    if (ctx.isEximQuery && svc.getEximPreviewFromApi) {
      const gotExim = await _fetchEximDual(ctx, svc, {
        selectedSourceId, year: requestedYear, eximMonth, eximGroup, eximFacets, eximMode, effectiveQuery, monthNameFromNo,
      });
      if (gotExim) return;
    }

    // Non-EXIM: data_bps → ProcessedCache → live API
    if (!ctx.dataPreview && svc.getProcessedPreviewFromCache) {
      logger.debug({ selectedSourceId, requestedYear, requestedGeo }, 'stagePreview: fetch with year');
      const processed = await svc.getProcessedPreviewFromCache({
        sourceId: selectedSourceId, year: requestedYear,
        month: ctx.intentResult?.query_builder?.params?.month || null,
        geo: requestedGeo,
      });
      logger.debug({ hasData: !!processed?.data?.length, rows: processed?.data?.length || 0, from: processed?.from }, 'stagePreview: cache result');
      if (processed?.data?.length > 0) {
        ctx.dataPreview = {
          title: `${processed.source} • ${requestedYear}${requestedGeo ? ` • ${requestedGeo}` : ''}`,
          columns: selectRelevantColumns(processed.columns || [], effectiveQuery),
          total_columns: (processed.columns || []).length,
          rows: processed.data.slice(0, 100), total_rows: processed.data.length,
          geo: requestedGeo, from: processed.from,
        };
        // Don't return here — fall through to allYears block below
      }
    }

    // Fallback: nearest available period
    if (!ctx.dataPreview && svc.findNearestAvailablePeriod && svc.getProcessedPreviewFromCache) {
      const nearest = await svc.findNearestAvailablePeriod(selectedSourceId, requestedYear);
      if (nearest?.period && nearest.period !== requestedYear) {
        const fallback = await svc.getProcessedPreviewFromCache({
          sourceId: selectedSourceId, year: nearest.period, month: null, geo: requestedGeo,
        });
        if (fallback?.data?.length > 0) {
          ctx.periodFallback = { requestedYear, actualYear: nearest.period, direction: nearest.direction };
          ctx.dataPreview = {
            title: `${fallback.source} • ${nearest.period}${requestedGeo ? ` • ${requestedGeo}` : ''}`,
            columns: selectRelevantColumns(fallback.columns || [], effectiveQuery),
            total_columns: (fallback.columns || []).length,
            rows: fallback.data.slice(0, 100), total_rows: fallback.data.length,
            geo: requestedGeo, from: fallback.from, periodFallback: ctx.periodFallback,
          };
        }
      }
    }
  } else if (selectedSourceId && !requestedYear) {
    // No year specified → try latest available
    logger.debug({ selectedSourceId, isExim: ctx.isEximQuery, eximMode }, 'stagePreview: no year → latest');

    // ── EXIM no-year dual-fetch: discover latest year then fetch both ──
    if (ctx.isEximQuery && svc.getEximPreviewFromApi && svc.findNearestAvailablePeriod) {
      // Discover latest year from primary EXIM source
      const latestExim = await svc.findNearestAvailablePeriod(selectedSourceId, null);
      if (latestExim?.period) {
        requestedYear = latestExim.period;
        const gotExim = await _fetchEximDual(ctx, svc, {
          selectedSourceId, year: requestedYear, eximMonth, eximGroup, eximFacets,
          eximMode: eximMode || 'ekspor', effectiveQuery, monthNameFromNo,
        });
        if (gotExim) {
          logger.debug({ eximMode, hasSecondary: !!ctx.dataPreviewSecondary }, 'stagePreview: EXIM no-year dual-fetch done');
          return;
        }
      }
    }

    // Non-EXIM: latest available from ProcessedCache
    if (!ctx.dataPreview && svc.findNearestAvailablePeriod && svc.getProcessedPreviewFromCache) {
      const latest = await svc.findNearestAvailablePeriod(selectedSourceId, null);
      logger.debug({ latest }, 'stagePreview: nearest period');
      if (latest?.period) {
        const latestData = await svc.getProcessedPreviewFromCache({
          sourceId: selectedSourceId, year: latest.period, month: null, geo: requestedGeo,
        });
        logger.debug({ hasData: !!latestData?.data?.length, rows: latestData?.data?.length || 0 }, 'stagePreview: latest cache result');
        if (latestData?.data?.length > 0) {
          requestedYear = latest.period;
          ctx.dataPreview = {
            title: `${latestData.source} • ${latest.period}${requestedGeo ? ` • ${requestedGeo}` : ''}`,
            columns: selectRelevantColumns(latestData.columns || [], effectiveQuery),
            total_columns: (latestData.columns || []).length,
            rows: latestData.data.slice(0, 100), total_rows: latestData.data.length,
            geo: requestedGeo, from: latestData.from,
          };
        }
      }
    }
  }

  // ── Multi-datasource: fetch secondary table for 2nd high-scoring candidate ──
  if (ctx.dataPreview && !ctx.dataPreviewSecondary && !ctx.isEximQuery && ctx.candidates?.length >= 2) {
    const top = ctx.candidates[0];
    const second = ctx.candidates[1];
    // Only fetch secondary if:
    // 1. Different source_id from primary
    // 2. High confidence (score >= 75)
    // 3. Different indicator category (not an alias of the same data)
    const isDifferentSource = second.id !== top.id;
    const isHighConfidence = second.score >= 75;
    const isDifferentCategory = (second.category || '') !== (top.category || '') || 
                                 (second.name || '').toLowerCase() !== (top.name || '').toLowerCase();
    
    if (isDifferentSource && isHighConfidence && isDifferentCategory) {
      logger.debug({ secondId: second.id, secondName: second.name, secondScore: second.score }, 'stagePreview: fetching secondary datasource');
      try {
        const secondYear = requestedYear || null;
        let secondData = null;

        if (secondYear && svc.getProcessedPreviewFromCache) {
          const processed = await svc.getProcessedPreviewFromCache({
            sourceId: second.id, year: secondYear, month: null, geo: requestedGeo,
          });
          if (processed?.data?.length > 0) {
            secondData = processed;
          }
        }

        // Fallback: latest available for secondary
        if (!secondData && svc.findNearestAvailablePeriod && svc.getProcessedPreviewFromCache) {
          const nearest = await svc.findNearestAvailablePeriod(second.id, secondYear);
          if (nearest?.period) {
            secondData = await svc.getProcessedPreviewFromCache({
              sourceId: second.id, year: nearest.period, month: null, geo: requestedGeo,
            });
            if (secondData?.data?.length > 0) {
              secondData._resolvedYear = nearest.period;
            }
          }
        }

        if (secondData?.data?.length > 0) {
          const yr = secondData._resolvedYear || secondYear;
          ctx.dataPreviewSecondary = {
            title: `${secondData.source} • ${yr}${requestedGeo ? ` • ${requestedGeo}` : ''}`,
            columns: selectRelevantColumns(secondData.columns || [], effectiveQuery),
            total_columns: (secondData.columns || []).length,
            rows: secondData.data.slice(0, 100), total_rows: secondData.data.length,
            geo: requestedGeo, from: secondData.from,
          };
          logger.debug({ secondSource: secondData.source, year: yr }, 'stagePreview: secondary datasource loaded');
        }
      } catch (e) {
        logger.warn({ error: e.message }, 'stagePreview: secondary datasource fetch failed (non-critical)');
      }
    }
  }

  // ── Fetch ALL years data for modal year-tabs (non-EXIM only) ─────────
  // This runs AFTER single-period preview is set. The extra data is for UI only
  // (the LLM continues to see only ctx.dataPreview.rows — single period).
  await _fetchAllYearsForModal(ctx, svc, selectedSourceId, requestedYear, requestedGeo);
}

/**
 * Stage 6a: Knowledge RAG search (can run in parallel with stageIntent)
 * Only performs the async search — mode decision is separate.
 */
async function stageKnowledgeSearch(ctx, svc) {
  ctx.knowledgeContext = [];

  // Skip expensive vector search for greetings (no useful KB results for "halo")
  if (ctx.gate?.route === ROUTES.GREETING || ctx.isGreeting) {
    logger.debug('stageKnowledgeSearch: SKIPPED for greeting');
    return;
  }

  try {
    if (svc.searchKnowledgeBase) {
      // IMPORTANT: Use original effectiveQuery for KB search, NOT DNA-enriched.
      // DNA enrichment adds BPS API metadata terms (e.g., "TK" → "kelompok pelaku
      // utamausaha mendapatkan pendampingan penyuluh") that pollute vector search
      // and cause completely wrong documents to be returned. DNA enrichment is only
      // useful for datasource intent matching, not knowledge base vector search.
      const kbQuery = ctx.effectiveQuery;

      // Only skip reranker when gate explicitly routed to data (not knowledge),
      // AND we already have strong datasource candidates. This ensures knowledge-mode
      // queries always get Document Judge review for better accuracy.
      // Previously: skipRerank for ALL hasDataSignal queries, which bypassed the Judge
      // for the majority of statistical queries — degrading RAG quality.
      const hasCandidates = (ctx.candidates?.length || 0) >= 2;
      const gateIsData = ctx.gate?.route === 'statistical' || ctx.gate?.route === 'statistical_exim';
      const skipRerank = gateIsData && hasCandidates;
      ctx.knowledgeContext = await svc.searchKnowledgeBase(kbQuery, 15, {
        skipRerank,
      });

      // Prefer latest edition when multiple publications from same series exist
      // (e.g., "Dalam Angka 2020", "Dalam Angka 2023", "Dalam Angka 2025")
      if (ctx.knowledgeContext?.length > 0) {
        ctx.knowledgeContext = _preferLatestEditions(ctx.knowledgeContext);
      }

      // FIX C: Enrich large documents with query-relevant content extraction
      // Two extraction strategies (checked per-doc inside enrichKnowledgeWithExtraction):
      //   1. Indicator-guided: uses DAFTAR TABEL index to find exact table position
      //   2. Chunk-window: extracts ±20K around matched chunk position (massive docs)
      //
      // Gate: run when at least one doc exceeds the enrichment threshold.
      // The function itself skips docs that don't match any strategy, so medium docs
      // are returned as-is without inflating context.
      const docSizes = ctx.knowledgeContext.map(d => (d.content?.length || 0));
      const hasLargeDoc = docSizes.some(s => s > INDICATOR_INJECTION.ENRICHMENT_GATE_CHARS);
      if (hasLargeDoc) {
        const { enrichKnowledgeWithExtraction } = require('./knowledgeContext.service');
        const t0 = Date.now();
        // Use the original effectiveQuery for extraction (not DNA-enriched) —
        // DNA enrichment adds metadata words (jenis kelamin, tenaga kerja, etc.)
        // that pollute indicator table matching and cause wrong table selection
        const extractionQuery = ctx.effectiveQuery;
        ctx.knowledgeContext = await enrichKnowledgeWithExtraction(ctx.knowledgeContext, extractionQuery, { requestId: ctx.requestId });
        logger.info({ ms: Date.now() - t0, docs: ctx.knowledgeContext.length },
          'stageKnowledgeSearch: enrichKnowledgeWithExtraction completed');
      }
    }
  } catch (e) {
    logger.warn({ error: e.message }, 'Knowledge search failed');
  }

  // ── FOLLOW-UP KB ANCHORING ────────────────────────────────────────────
  // When a follow-up message re-runs KB search with a merged query, the
  // new results may completely lose the previous response's sources.
  // This causes jarring "source switching" (e.g., user asks "bandingkan
  // dengan tahun lalu" and loses the BRS from the first answer).
  // Fix: if ALL previous KB docs were lost, re-inject them so the AI
  // reranker can decide if they're still relevant in context.
  if (ctx._shouldPreferPrevCandidates && ctx.prevUiMeta?.knowledgeCandidates?.length > 0) {
    try {
      const prevKbIds = new Set(ctx.prevUiMeta.knowledgeCandidates.map(k => k.id).filter(Boolean));
      const currentKbIds = new Set((ctx.knowledgeContext || []).map(k => k.id));
      const retained = [...prevKbIds].filter(id => currentKbIds.has(id)).length;

      if (retained === 0 && ctx.knowledgeContext?.length > 0 && prevKbIds.size > 0) {
        // Complete source switch — re-inject previous docs for reranker consideration
        const { loadKnowledgeEmbeddings } = require('../../ai/vectorSearch.service');
        const kbCache = await loadKnowledgeEmbeddings();
        let injected = 0;
        for (const prevDoc of ctx.prevUiMeta.knowledgeCandidates) {
          if (!prevDoc.id || currentKbIds.has(prevDoc.id)) continue;
          const cached = kbCache.get(prevDoc.id);
          if (cached) {
            ctx.knowledgeContext.push({
              id: prevDoc.id,
              name: cached.title,
              title: cached.title,
              category: cached.category,
              content: cached.content,
              similarity: 0.50, // Neutral score — let reranker decide
              source: 'knowledge',
              _anchored: true,
            });
            currentKbIds.add(prevDoc.id);
            injected++;
          }
        }
        if (injected > 0) {
          logger.info({ injected, prevCount: prevKbIds.size, newCount: ctx.knowledgeContext.length },
            'Follow-up KB anchoring: re-injected previous sources');
        }
      }
    } catch (e) {
      logger.debug({ error: e.message }, 'Follow-up KB anchoring failed (non-fatal)');
    }
  }
}

/**
 * Stage 3b: DNA Pre-Enrichment
 * Two-phase DNA pre-enrichment for intent+KB search:
 *
 * Phase 1 — CACHE CHECK (instant, 0ms):
 *   If DNA results are already cached from a previous query, instantly builds
 *   an enriched query with official BPS names/synonyms. This enriched query
 *   feeds INTO intent search & KB search for better accuracy.
 *
 * Phase 2 — BACKGROUND FETCH (if cache miss):
 *   Fires DNA searchSmart in the background (does NOT block pipeline).
 *   This warms the cache for the NEXT query with the same term.
 *   DNA context for LLM prompt is saved via ctx._dnaBackgroundPromise,
 *   which is awaited later before building the LLM prompt.
 *
 * This approach ensures:
 *   - Zero added latency on first query (cache miss → background fetch)
 *   - Instant enrichment on repeat queries (cache hit → 0ms → enriched intent+KB)
 *   - Progressive improvement as cache warms up
 *   - LLM always gets DNA context (first query: awaited before prompt; repeat: instant)
 *
 * Cold API latency: MSIND+MSKEG+MSVAR parallel ~15-17s (background fetch, not blocking)
 * Cached latency: 0ms (instant enrichment)
 */
async function stageDnaPreEnrich(ctx) {
  ctx.dnaContext = null;
  ctx.dnaEnrichedQuery = null;
  ctx.dnaRawResults = null;
  ctx._dnaBackgroundPromise = null;
  ctx._dnaSearchTerm = null;

  try {
    const dna = getDnaService();
    if (!dna) return;

    const query = ctx.effectiveQuery || ctx.userMessage || '';
    if (!query || query.length < 2) return;

    let searchTerm = _extractDnaPrimaryTerm(query);
    if (!searchTerm) return;

    ctx._dnaSearchTerm = searchTerm;
    const isAbbr = /^[A-Z]{2,8}$/.test(searchTerm.replace(/[^a-zA-Z]/g, ''));
    const searchOpts = { length: 3, isAbbreviation: isAbbr };

    // ── Phase 1: Instant cache check (with normalization fallback) ────
    let cached = await dna.getCachedSmart(searchTerm, searchOpts);
    if (!cached) {
      // Try normalized form (e.g., "miskin" → "kemiskinan") to hit warmup cache
      const normalized = _normalizeToCachedTerm(searchTerm);
      if (normalized && normalized !== searchTerm) {
        cached = await dna.getCachedSmart(normalized, searchOpts);
        if (cached) {
          logger.debug({ original: searchTerm, normalized }, 'DNA term normalized to hit cache');
          searchTerm = normalized;
        }
      }
    }
    if (cached) {
      // Cache hit → instant enrichment (0ms)
      ctx.dnaRawResults = cached;
      const contextBlock = dna.buildDnaContextBlock(cached, query);
      if (contextBlock) ctx.dnaContext = contextBlock;

      const enrichmentTerms = _buildDnaEnrichmentTerms(cached, searchTerm, query);
      if (enrichmentTerms) {
        ctx.dnaEnrichedQuery = `${ctx.normalizedQuery || query} ${enrichmentTerms}`.trim();
        logger.info({
          term: searchTerm,
          enrichment: enrichmentTerms,
          source: 'cache',
        }, 'DNA pre-enrichment applied (cached)');
      }

      logger.debug({
        term: searchTerm,
        inds: cached.indicators?.length || 0,
        keg: cached.kegiatan?.length || 0,
        vars: cached.variables?.length || 0,
        enriched: !!enrichmentTerms,
        phase: 'cache-hit',
      }, 'DNA pre-enrich completed (instant)');
      return;
    }

    // ── Phase 2: Cache miss → background fetch ────────────────────────
    // Fire DNA search in background — does NOT block intent+KB.
    // The promise is stored so we can await it later before LLM prompt.
    logger.debug({ term: searchTerm, phase: 'cache-miss' }, 'DNA pre-enrich cache miss — firing background fetch');

    ctx._dnaBackgroundPromise = (async () => {
      try {
        const results = await dna.searchSmart(searchTerm, searchOpts);
        ctx.dnaRawResults = results;

        const contextBlock = dna.buildDnaContextBlock(results, query);
        if (contextBlock) ctx.dnaContext = contextBlock;

        // No enrichment for THIS query (intent+KB already started),
        // but cache is now warm for the next query.
        logger.debug({
          term: searchTerm,
          inds: results.indicators?.length || 0,
          keg: results.kegiatan?.length || 0,
          vars: results.variables?.length || 0,
          phase: 'background-done',
        }, 'DNA background fetch completed (cache warmed)');
      } catch (bgErr) {
        logger.debug({ term: searchTerm, error: bgErr.message }, 'DNA background fetch failed');
      }
    })();
  } catch (e) {
    logger.warn({ error: e.message }, 'DNA pre-enrich failed');
  }
}

/**
 * Extract enrichment terms from DNA results to append to search queries.
 * Returns space-separated terms that improve keyword matching.
 *
 * Examples:
 *  - PMTB → "pembentukan modal tetap bruto"
 *  - kemiskinan → "garis kemiskinan penduduk miskin konsumsi pangan"
 *  - IPM → "indeks pembangunan manusia"
 *
 * @param {object} results - DNA search results {variables, indicators, kegiatan}
 * @param {string} searchTerm - The original search term
 * @param {string} originalQuery - The full original query
 * @returns {string|null} Space-separated enrichment terms, or null
 */
function _buildDnaEnrichmentTerms(results, searchTerm, originalQuery) {
  if (!results) return null;
  const terms = new Set();
  const originalLower = (originalQuery || '').toLowerCase();

  // Extract from variables (MSVAR — from cache if available)
  if (results.variables?.length > 0) {
    for (const v of results.variables.slice(0, 2)) {
      // Add the official nama (e.g., "Pembentukan Modal Tetap Bruto")
      if (v.nama) {
        const words = v.nama.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length >= 3);
        words.forEach(w => { if (!originalLower.includes(w)) terms.add(w); });
      }
      // Add alias if different from search term
      if (v.alias && v.alias.toLowerCase() !== searchTerm.toLowerCase()) {
        terms.add(v.alias.toLowerCase());
      }
    }
  }

  // Extract from indicators (MSIND)
  if (results.indicators?.length > 0) {
    for (const i of results.indicators.slice(0, 2)) {
      if (i.nama) {
        const words = i.nama.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length >= 3);
        // Only add substantive words not already in query
        words.forEach(w => {
          if (!originalLower.includes(w) && !_isStopword(w)) terms.add(w);
        });
      }
    }
  }

  // Extract from kegiatan (MSKEG) — add survey/activity names
  if (results.kegiatan?.length > 0) {
    for (const k of results.kegiatan.slice(0, 1)) {
      if (k.judul) {
        const words = k.judul.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length >= 4);
        words.forEach(w => {
          if (!originalLower.includes(w) && !_isStopword(w)) terms.add(w);
        });
      }
    }
  }

  if (terms.size === 0) return null;

  // Limit to top 8 terms — keep most relevant, avoid overwhelming synonym expansion
  return [...terms].slice(0, 8).join(' ');
}

/**
 * Normalize an extracted term to its canonical warmup-cache form.
 * Maps common variations to the form used in DNA warmup.
 * Returns the canonical form, or null if no mapping exists.
 */
function _normalizeToCachedTerm(term) {
  if (!term) return null;
  const map = {
    'miskin': 'kemiskinan',
    'nganggur': 'pengangguran',
    'kerja': 'ketenagakerjaan',
    'pekerjaan': 'ketenagakerjaan',
    'harga': 'inflasi',
    'pdrb': 'PDRB',
    'ipm': 'IPM',
    'pmtb': 'PMTB',
    'tpk': 'TPK',
    'ntp': 'NTP',
    'ntup': 'NTUP',
    'tpt': 'TPT',
    'pendapatan': 'ekonomi',
    'pengeluaran': 'konsumsi',
    'nelayan': 'perikanan',
    'ikan': 'perikanan',
    'padi': 'pertanian',
    'wisatawan': 'pariwisata',
    'hotel': 'pariwisata',
    'buruh': 'upah',
    'gaji': 'upah',
  };
  return map[term.toLowerCase()] || null;
}

/**
 * Check if a word is a generic stopword (not useful for search enrichment)
 */
function _isStopword(w) {
  const stops = new Set([
    'yang', 'dan', 'atau', 'untuk', 'dari', 'dengan', 'dalam', 'pada',
    'oleh', 'sebagai', 'secara', 'terhadap', 'antara', 'melalui',
    'berdasarkan', 'menurut', 'mengenai', 'tentang', 'atas',
    'badan', 'pusat', 'statistik', 'nasional', 'indonesia', 'provinsi',
    'kabupaten', 'kota', 'tahun', 'bulan', 'data',
    // Government program terms (not useful for statistical search)
    'jumlah', 'kompilasi', 'difasilitasi', 'kemitraan', 'pencacahan',
    'tercapainya', 'pelaksanaan', 'perumusan', 'kebijakan', 'penyiapan',
    'direktorat', 'dirjen', 'kementerian', 'lembaga', 'regulasi',
    'realisasi', 'fasilitasi', 'koordinasi', 'evaluasi', 'monitoring',
    'lengkap', 'seluruh', 'berbagai', 'sesuai', 'bidang',
  ]);
  return stops.has(w);
}

/**
 * Extract the best search term from a user query for DNA API.
 * Always returns something for statistical queries.
 *
 * Priority:
 *  1. Uppercase abbreviation (PMTB, IPM, TPK)
/**
 * When multiple publications from the same series are found (e.g.,
 * "Maluku Utara Dalam Angka 2020/2023/2025"), keep only the latest edition
 * and displace older ones. This ensures the user gets the most current data.
 * Non-series documents are kept as-is.
 *
 * Returns at most 10 docs (the pipeline's effective limit).
 */
function _preferLatestEditions(docs) {
  if (!docs || docs.length <= 1) return docs;

  // Group by normalized series name (strip year from title)
  const yearRe = /\b(19|20)\d{2}\b/g;
  const seriesMap = new Map(); // seriesKey → [{ doc, year }]

  for (const doc of docs) {
    const title = (doc.title || '').trim();
    const years = title.match(yearRe);
    const latestYear = years?.length ? Math.max(...years.map(Number)) : 0;
    const seriesKey = title.replace(yearRe, '').replace(/\s+/g, ' ').trim().toLowerCase();

    if (!seriesMap.has(seriesKey)) seriesMap.set(seriesKey, []);
    seriesMap.get(seriesKey).push({ doc, year: latestYear, origIdx: docs.indexOf(doc) });
  }

  // For each series with >1 edition, keep only the latest
  const keep = new Set();
  const displaced = [];
  for (const [, editions] of seriesMap) {
    if (editions.length <= 1) {
      keep.add(editions[0].doc);
      continue;
    }
    // Sort by year descending — keep latest
    editions.sort((a, b) => b.year - a.year);
    keep.add(editions[0].doc);
    for (let i = 1; i < editions.length; i++) displaced.push(editions[i].doc);
  }

  // Result: kept docs in original order, trimmed to 10
  const result = docs.filter(d => keep.has(d));
  return result.slice(0, 10);
}

/**
 * Extract the best search term from a user query for DNA API.
 * Always returns something for statistical queries.
 *
 * Strategy:
 *  1. Abbreviation (2-8 uppercase chars, e.g., IPM, PDRB, TPT)
 *  2. Known statistical keyword (kemiskinan, inflasi, etc.)
 *  3. Longest meaningful content word (≥4 chars, not geo/filler)
 *
 * @param {string} query
 * @returns {string|null}
 */
function _extractDnaPrimaryTerm(query) {
  if (!query) return null;

  const words = query.split(/\s+/);
  const skipWords = new Set([
    'di', 'ke', 'yg', 'dan', 'atau', 'ini', 'itu', 'apa', 'yang',
    'data', 'berapa', 'halo', 'hai', 'terima', 'kasih', 'tolong',
    'maluku', 'utara', 'ternate', 'tidore', 'halmahera', 'sula',
    'morotai', 'taliabu', 'kepulauan', 'kabupaten', 'kota', 'provinsi',
    'tahun', 'bulan', 'terbaru', 'terkini', 'selatan', 'tengah',
    'barat', 'timur', 'pulau',
  ]);

  // 1. Uppercase abbreviation (2-8 chars)
  for (const word of words) {
    const clean = word.replace(/[^a-zA-Z]/g, '');
    if (clean.length >= 2 && clean.length <= 8 && clean === clean.toUpperCase() && /[A-Z]/.test(clean)) {
      if (!skipWords.has(clean.toLowerCase())) {
        return clean;
      }
    }
  }

  // 2. Statistical keywords
  const statKeywords = [
    'kemiskinan', 'miskin', 'inflasi', 'pengangguran', 'penduduk', 'migrasi',
    'ekspor', 'impor', 'produksi', 'konsumsi', 'investasi',
    'pertanian', 'industri', 'perdagangan', 'pariwisata', 'ketenagakerjaan',
    'upah', 'gaji', 'harga', 'pertumbuhan', 'ekonomi',
    'kematian', 'kelahiran', 'fertilitas', 'harapan hidup',
    'partisipasi', 'sekolah', 'pendidikan', 'kesehatan',
    'perumahan', 'konstruksi', 'transportasi', 'komunikasi',
    'gini', 'ketimpangan', 'pengeluaran', 'pendapatan',
  ];
  const lower = query.toLowerCase();
  for (const kw of statKeywords) {
    if (lower.includes(kw)) return kw;
  }

  // 3. Longest meaningful word (fallback — so DNA always tries)
  const meaningful = words
    .map(w => w.replace(/[^a-zA-Z]/g, '').toLowerCase())
    .filter(w => w.length >= 4 && !skipWords.has(w));
  if (meaningful.length > 0) {
    return meaningful.sort((a, b) => b.length - a.length)[0];
  }

  return null;
}

/**
 * Stage 6b: Knowledge mode decision (sync, runs after intent + preview)
 * Decides whether to enter knowledge mode and clears candidates/preview if so.
 */
function stageKnowledgeMode(ctx, svc) {
  ctx.isKnowledgeMode = false;

  // ── Gate hint: force knowledge mode for knowledge/institutional routes ──
  if (ctx.gate?.forceKnowledge) {
    ctx.isKnowledgeMode = true;
    ctx.dataPreview = null;
    ctx.dataPreviewSecondary = null;
    if (ctx.candidates?.length > 0) ctx._pipelineCandidates = [...ctx.candidates];
    ctx.candidates = [];
    logger.debug({ gateRoute: ctx.gate.route }, 'stageKnowledgeMode: FORCED by gate hint');
    return;
  }

  const topSim = ctx.knowledgeContext?.[0]?.similarity || 0;
  const isProceduralQuery = svc.isProceduralFaqQuery?.(ctx.effectiveQuery) || false;

  // Check: indicator-injected docs present AND no valid dataPreview data
  // Only enter knowledge mode via injection when datasource returned no useful data
  const hasInjectedDocs = ctx.knowledgeContext.some(d => d._injectedByIndicator);
  const dataPreviewHasRows = ctx.dataPreview?.allRows?.length > 0 || ctx.dataPreview?.rows?.length > 0;
  if (hasInjectedDocs && !dataPreviewHasRows) {
    ctx.isKnowledgeMode = true;
    if (ctx.dataPreview) {
      ctx._stashedDataPreview = ctx.dataPreview;
      ctx.dataPreview = null;
      ctx.dataPreviewSecondary = null;
    }
    if (ctx.candidates?.length > 0) ctx._pipelineCandidates = [...ctx.candidates];
    ctx.candidates = [];
    logger.debug('stageKnowledgeMode: entered via indicator-injected docs (no valid dataPreview rows)');
    return;
  }

  // Never enter knowledge mode if we already have preview data — that's a confirmed data query
  if (ctx.dataPreview) {
    logger.debug('stageKnowledgeMode: skipped, dataPreview already set');
    return;
  }

  if ((ctx.knowledgeContext.length > 0 && svc.isKnowledgeTypeQuery?.(ctx.effectiveQuery, topSim)) || isProceduralQuery) {
    ctx.isKnowledgeMode = true;
    ctx.dataPreview = null;
    ctx.dataPreviewSecondary = null;
    if (ctx.candidates?.length > 0) ctx._pipelineCandidates = [...ctx.candidates];
    ctx.candidates = [];
  }

  // Stay in knowledge mode for follow-ups
  if (ctx._wasKnowledgeMode && (ctx.isConfirm || svc.isShortFollowUp?.(ctx.userMessage.slice(0, 4000)))) {
    ctx.isKnowledgeMode = true;
    ctx.dataPreview = null;
    ctx.dataPreviewSecondary = null;
    if (ctx.candidates?.length > 0) ctx._pipelineCandidates = [...ctx.candidates];
    ctx.candidates = [];
  }
}

/**
 * Stage 7: Model selection + OpenAI message building
 */
async function stageModelSelect(ctx, svc) {
  const { detectMergeBundle } = require('./mergeBundles');

  // Always use automatic tier routing (GREETING/SIMPLE/COMPLEX/DEEP) for
  // proper max_tokens, timeout, and description per query complexity.
  // User's model choice (Deep=gpt-5-mini / Flash=gpt-4.1) overrides the
  // model field in whichever tier is selected — no hardcoded per-tier models.
  // Check if any knowledge docs were indicator-injected (deep content from large publications)
  // This signals the model router to upgrade to COMPLEX tier for more context budget
  const hasIndicatorInjectedDocs = (ctx.knowledgeContext || []).some(d => d.indicatorInjected);

  ctx.modelRoute = routeModel({
    query: ctx.normalizedQuery,
    isGreeting: ctx.isGreeting || false,
    isMergeBundle: !!detectMergeBundle(ctx.userMessage.toLowerCase(), ctx.conversationTopic),
    isMultiSource: ctx.dataPreview?.merged || false,
    hasYearRange: !!ctx.dataPreview?.periodRange,
    candidateCount: ctx.candidates?.length || 0,
    isEximQuery: ctx.isEximQuery,
    isKnowledgeMode: ctx.isKnowledgeMode,
    hasIndicatorInjectedDocs,
  });

  // Apply user's model choice to the routed tier config
  if (ctx.modelOverride) {
    const allowedModels = ['claude-sonnet-4-6', 'claude-haiku-4-5'];
    if (allowedModels.includes(ctx.modelOverride)) {
      const originalModel = ctx.modelRoute.config.model;
      ctx.modelRoute.config.model = ctx.modelOverride;
      logger.info({
        threadId: ctx.threadId,
        model: ctx.modelOverride,
        tier: ctx.modelRoute.tier,
        originalModel,
      }, 'User model override applied to routed tier');
    } else {
      logger.warn({ threadId: ctx.threadId, model: ctx.modelOverride }, 'Invalid model override, using automatic model');
    }
  }

  // ── Smart Context Sizing ────────────────────────────────────────────────
  // Tier-based knowledge context management to prevent "lost in the middle"
  // regression. Simple queries get focused context; deep queries get full docs.
  const contextTier = SMART_CONTEXT[ctx.modelRoute.tier] || SMART_CONTEXT.complex;
  ctx._smartContext = { tier: ctx.modelRoute.tier, ...contextTier, docsDropped: 0, charsTrimmed: 0 };

  if (ctx.knowledgeContext?.length > 0) {
    const originalDocCount = ctx.knowledgeContext.length;
    const originalChars = ctx.knowledgeContext.reduce((s, d) => s + (d.content?.length || 0), 0);

    // 1. Limit number of documents (already sorted by relevance)
    if (ctx.knowledgeContext.length > contextTier.maxDocs) {
      ctx._smartContext.docsDropped = ctx.knowledgeContext.length - contextTier.maxDocs;
      ctx.knowledgeContext = ctx.knowledgeContext.slice(0, contextTier.maxDocs);
    }

    // 2. Limit per-document content size (chunk-aware)
    //    Cumulative budget guard: stop adding docs once we reach 70% of totalBudget,
    //    leaving headroom for system prompt + history + user message.
    //    Without this, 10 docs × 80K = 800K could be assembled before trimMessagesToBudget.
    const cumulativeBudget = Math.floor(contextTier.totalBudget * 0.7);
    let cumulativeChars = 0;
    for (const doc of ctx.knowledgeContext) {
      // Indicator-extracted docs have focused content (TOC + data window).
      // Give them 2x perDocChars budget to preserve the extraction.
      const effectivePerDocChars = doc.contentExtracted
        ? contextTier.perDocChars * 2
        : contextTier.perDocChars;

      if (doc.content && doc.content.length > effectivePerDocChars) {
        const origLen = doc.content.length;
        const chunk = doc.matchedChunkText || '';
        if (chunk.length > 0 && !doc.contentExtracted) {
          // Chunk-aware: prioritize matched section + fill remainder from doc start
          const header = `[BAGIAN PALING RELEVAN]\n${chunk}\n\n[KONTEKS DOKUMEN]\n`;
          const remaining = Math.max(0, effectivePerDocChars - header.length);
          doc.content = header + doc.content.slice(0, remaining) +
            '\n\n[… konten dipotong untuk fokus pada informasi utama]';
        } else {
          // No chunk match or already extracted — head truncation with effective budget
          doc.content = doc.content.slice(0, effectivePerDocChars) +
            '\n\n[… konten dipotong untuk fokus pada informasi utama]';
        }
        ctx._smartContext.charsTrimmed += origLen - doc.content.length;
      }

      // Cumulative budget guard: further truncate if running total exceeds 70% of tier budget
      cumulativeChars += (doc.content?.length || 0);
      if (cumulativeChars > cumulativeBudget && doc.content) {
        const excess = cumulativeChars - cumulativeBudget;
        const newLen = Math.max(2000, doc.content.length - excess);
        if (newLen < doc.content.length) {
          ctx._smartContext.charsTrimmed += doc.content.length - newLen;
          doc.content = doc.content.slice(0, newLen) + '\n\n[… dipotong: batas konteks tercapai]';
          cumulativeChars = cumulativeBudget;
        }
      }
    }

    const finalChars = ctx.knowledgeContext.reduce((s, d) => s + (d.content?.length || 0), 0);
    if (ctx._smartContext.docsDropped > 0 || ctx._smartContext.charsTrimmed > 0) {
      logger.info({
        tier: ctx.modelRoute.tier,
        originalDocs: originalDocCount,
        keptDocs: ctx.knowledgeContext.length,
        droppedDocs: ctx._smartContext.docsDropped,
        originalChars,
        finalChars,
        savedChars: originalChars - finalChars,
      }, 'Smart context: tier-based sizing applied');
    }
  }

  // Build prompt fixes
  let promptFixes = [];
  try {
    if (svc.errorLearningService?.getPromptFixes) {
      promptFixes = await svc.errorLearningService.getPromptFixes(ctx.effectiveQuery);
    }
  } catch { /* continue */ }

  // Determine if tools will be enabled (so system prompt includes tool instructions)
  let toolsEnabled = false;
  if (process.env.CHAT_TOOL_USE === 'true') {
    try {
      const tu = getToolUse();
      toolsEnabled = tu.shouldEnableToolUse(ctx);
    } catch { /* ignore */ }
  }

  // ── Layer 3: Extraction Quality Score ──────────────────────────────────
  // Systematically scores knowledge extraction quality (0-100) based on:
  //   - Extraction method (indicator-guided=50, chunk-window=25, none=0)
  //   - Numeric data presence (+25)
  //   - Indicator match score (+up to 15)
  //   - Multiple indicator docs (+10)
  // Score drives: prompt confidence level, retry eligibility, monitoring
  let extractionQuality = 0;
  let knowledgeDataConfirmed = false;
  let knowledgeExtractionTier = 'none';
  if (ctx.knowledgeContext?.length > 0) {
    const indicatorDocs = ctx.knowledgeContext.filter(d => d.extractionMethod === 'indicator-guided');
    const chunkDocs = ctx.knowledgeContext.filter(d => d.extractionMethod === 'chunk-window');

    if (indicatorDocs.length > 0) {
      knowledgeExtractionTier = 'indicator-guided';
      extractionQuality += 50; // High confidence method

      // Check numeric data presence
      const numericPattern = /\d{1,3}([.,]\d{1,3})+|\d{4,}/;
      knowledgeDataConfirmed = indicatorDocs.some(d => numericPattern.test(d.content || ''));
      if (knowledgeDataConfirmed) extractionQuality += 25;

      // Indicator match score bonus (max 15)
      const topScore = indicatorDocs[0]?._indicatorMatchScore || 0;
      extractionQuality += Math.min(15, Math.round(topScore * 3));

      // Multiple indicator docs = stronger coverage
      if (indicatorDocs.length >= 2) extractionQuality += 10;
    } else if (chunkDocs.length > 0) {
      knowledgeExtractionTier = 'chunk-window';
      extractionQuality += 25;
      const numericPattern = /\d{1,3}([.,]\d{1,3})+|\d{4,}/;
      if (chunkDocs.some(d => numericPattern.test(d.content || ''))) {
        extractionQuality += 15;
      }
    }

    extractionQuality = Math.min(100, extractionQuality);

    logger.info({
      threadId: ctx.threadId,
      extractionQuality,
      tier: knowledgeExtractionTier,
      dataConfirmed: knowledgeDataConfirmed,
      indicatorDocs: indicatorDocs?.length || 0,
      topTable: indicatorDocs?.[0]?._extractedTableTitle?.slice(0, 80),
    }, 'Layer 3: Extraction quality scored');
  }

  // Store on ctx for post-response validator (Layer 1)
  ctx._knowledgeDataConfirmed = knowledgeDataConfirmed;
  ctx._knowledgeExtractionTier = knowledgeExtractionTier;
  ctx._extractionQuality = extractionQuality;

  // Build system prompt
  let systemContent = svc.systemPrompt({
    hasDataPreview: Boolean(ctx.dataPreview),
    hasCandidates: (ctx.candidates?.length || 0) > 0,
    lowConfidence: (ctx.candidates?.[0]?.score || 0) < 80,
    periodFallback: ctx.periodFallback,
    multiSourceDisclaimer: null,
    promptFixes,
    hasKnowledgeContext: ctx.knowledgeContext?.length > 0,
    knowledgeDataConfirmed,
    knowledgeExtractionTier,
    extractionQuality,
  });

  // Append tool instructions when tools are enabled
  if (toolsEnabled) {
    try {
      const tu = getToolUse();
      systemContent += '\n\n' + tu.TOOL_INSTRUCTIONS;
    } catch { /* continue without tool instructions */ }
  }

  // Append DNA Nucleus metadata context (authoritative BPS definitions)
  if (ctx.dnaContext) {
    systemContent += '\n\n' + ctx.dnaContext;
    logger.debug('Pipeline: DNA metadata context injected into system prompt');
  }

  // Build brsContext from knowledgeContext for BRS interpretation instructions
  let brsContext = null;
  if (ctx.knowledgeContext?.length > 0 && ctx.dataPreview) {
    const brs = ctx.knowledgeContext.filter(d => d.category === 'BRS');
    const publications = ctx.knowledgeContext.filter(d => d.category === 'Publikasi');
    if (brs.length > 0 || publications.length > 0) {
      brsContext = { brs, publications };
      logger.debug({ brsCount: brs.length, pubCount: publications.length, topBrs: brs[0]?.title?.slice(0, 60) }, 'Pipeline: built brsContext from knowledgeContext');
    }
  }

  // ── Data Reconciler: Per-row source selection when multi-source overlap exists ──
  // Runs gpt-5-mini to compare table vs BRS/Pub data cell-by-cell
  let reconciliationContext = null;
  if (RECONCILER_ENABLED && ctx.dataPreview?.rows?.length > 0 && ctx.knowledgeContext?.length > 0) {
    const hasTableData = ctx.dataPreview.title && ctx.dataPreview.rows.length > 0;
    if (hasTableData) {
      // Find overlapping knowledge docs (same topic as table)
      let overlappingDocs = ctx.knowledgeContext.filter(doc => {
        const matchTitle = doc._extractedTableTitle || doc.title;
        return _hasTopicOverlap(ctx.dataPreview.title, matchTitle);
      });
      // Cap at 5 docs to keep reconciler prompt under ~15K chars (prevents timeout)
      if (overlappingDocs.length > 5) {
        // Prefer BRS over Publikasi, then take first N
        overlappingDocs.sort((a, b) => {
          const aIsBrs = a.category === 'BRS' ? 0 : 1;
          const bIsBrs = b.category === 'BRS' ? 0 : 1;
          return aIsBrs - bIsBrs;
        });
        overlappingDocs = overlappingDocs.slice(0, 5);
      }
      if (overlappingDocs.length > 0) {
        logger.info({
          tableTitle: ctx.dataPreview.title?.slice(0, 80),
          overlappingCount: overlappingDocs.length,
          docTitles: overlappingDocs.map(d => (d.title || '').slice(0, 60)),
        }, 'Pipeline: multi-source overlap detected, running Data Reconciler');
        try {
          const startReconciler = Date.now();
          const reconciliation = await reconcileDataSources(ctx, ctx.dataPreview, overlappingDocs);
          if (reconciliation) {
            ctx.timings.reconciler = reconciliation.latencyMs || (Date.now() - startReconciler);
            ctx.reconciliationResult = reconciliation; // Store for supervisor verification
            reconciliationContext = formatReconciliationContext(reconciliation);
            if (reconciliationContext) {
              logger.info({
                hasOverlap: reconciliation.has_overlap,
                itemCount: reconciliation.reconciliation?.length || 0,
                summary: reconciliation.summary,
                latencyMs: ctx.timings.reconciler,
              }, 'Pipeline: Data Reconciler completed successfully');
            }
          }
        } catch (err) {
          logger.warn({ error: err.message }, 'Pipeline: Data Reconciler failed, continuing without reconciliation');
        }
      }
    }
  }

  // Build context messages (history, knowledge, data)
  const contextMessages = svc.buildContextMessages?.({
    intentResult: ctx.intentResult,
    candidates: ctx.candidates,
    dataPreview: ctx.dataPreview,
    dataPreviewSecondary: ctx.dataPreviewSecondary,
    historyMessages: ctx.historyArray,
    periodFallback: ctx.periodFallback,
    knowledgeContext: ctx.knowledgeContext,
    isServiceQueryWithoutKnowledge: false,
    availableYearsInfo: null,
    brsContext,
    reconciliationContext,
  }) || [];

  // Sanitize: AI SDK strictly validates every message has role + content (string)
  // Filter out messages with missing/empty content, then ensure content is always a string
  const sanitizedContext = contextMessages
    .filter(m => m && m.role && m.content != null && m.content !== '')
    .map(m => ({ role: m.role, content: String(m.content) }));

  // Debug: log context message count and what they contain
  logger.debug({
    contextMsgCount: sanitizedContext.length,
    hasBrsNarrative: sanitizedContext.some(m => String(m.content).includes('SUMBER RESMI BRS')),
    hasBrsInstruction: sanitizedContext.some(m => String(m.content).includes('INSTRUKSI INTERPRETASI DENGAN BRS')),
    hasBrsContext: Boolean(brsContext),
    brsCount: brsContext?.brs?.length || 0,
  }, 'Pipeline: context messages debug');


  // Expand abbreviations in user message so LLM sees "PMTB (Pembentukan Modal Tetap Bruto)"
  const { expandAbbreviationsInline } = require('../../../shared/bpsAbbreviations');
  const userContent = expandAbbreviationsInline(String(ctx.effectiveQuery || ctx.userMessage || ''));

  ctx.openAiMessages = [
    { role: 'system', content: systemContent + (ctx.memoryContext ? '\n\n' + ctx.memoryContext : '') },
    ...sanitizedContext,
    { role: 'user', content: userContent },
  ];

  // ── Context budget enforcement ──────────────────────────────────────────
  // Prevent 400 errors from Copilot API by trimming oversized context.
  // Uses tier-specific budget from Smart Context sizing (simple=120K, complex=200K, deep=400K).
  const tierBudget = contextTier?.totalBudget || MAX_CONTEXT_CHARS;
  const budgetResult = trimMessagesToBudget(ctx.openAiMessages, tierBudget);
  if (budgetResult.trimmed) {
    ctx.openAiMessages = budgetResult.messages;
    ctx._contextTrimmed = true;
    ctx._contextOriginalChars = budgetResult.originalChars;
    ctx._contextTrimmedChars = budgetResult.trimmedChars;
  }
}

/**
 * Stage 8: AI SDK streamText + post-processing
 *
 * This is the core upgrade: replaces manual fetch + SSE line parsing
 * with Vercel AI SDK's streamText for protocol-compliant streaming.
 */
async function stageStream(ctx, svc) {
  const apiKey = svc.getOpenAIKey?.() || process.env.OPENAI_API_KEY_CHAT || '';

  if (!apiKey) {
    const fallback = 'Saat ini fitur AI belum aktif. Saya tetap bisa bantu mengarahkan ke data yang sesuai berdasarkan database.';
    ctx.sse.sendEvent('text', { content: fallback });
    ctx.sse.sendEvent('done', { full_text: fallback });
    await svc.saveAssistantMessage?.(ctx.threadId, fallback, null, ctx.intentResult, ctx.candidates, ctx.dataPreview, ctx.periodFallback);
    return;
  }

  const tierConfig = ctx.modelRoute.config;
  const modelParams = buildModelParams(tierConfig);
  const isReasoning = isReasoningModel(modelParams.model);
  const isClaude = isClaudeModel(modelParams.model);
  const hasThinking = Boolean(isClaude && modelParams.thinking);

  // ── Provider selection ──
  // Claude → @ai-sdk/anthropic direct to Anthropic API (natively parses thinking)
  //   Uses same OAuth token + identity headers as malika-llm-proxy.
  // Others → @ai-sdk/openai via malika-llm-proxy
  let sdkModel;
  if (isClaude) {
    // Read OAuth token from env (MUST be set in .env — no hardcoded fallback)
    const anthropicToken = process.env.ANTHROPIC_TOKEN;
    if (!anthropicToken) {
      throw new Error('ANTHROPIC_TOKEN env var is required for Claude direct calls');
    }
    const anthropic = createAnthropic({
      authToken: anthropicToken,
      headers: {
        'anthropic-dangerous-direct-browser-access': 'true',
        'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14',
        'user-agent': 'claude-cli/2.1.78 (external, cli)',
        'x-app': 'cli',
      },
    });
    sdkModel = anthropic(modelParams.model);
    logger.info({ model: modelParams.model, thinking: hasThinking }, 'Using @ai-sdk/anthropic direct');
  } else {
    const proxyBaseURL = process.env.OPENAI_API_BASE_URL || 'http://127.0.0.1:3031/v1';
    const openai = createOpenAI({ baseURL: proxyBaseURL, apiKey: 'sk-noop', compatibility: 'strict' });
    sdkModel = openai.chat(modelParams.model);
  }
  const effectiveHasThinking = hasThinking;

  // For Claude direct via OAuth: no identity prefix injection needed.
  // The OAuth token (sk-ant-oat01) is validated via anthropic-beta headers,
  // not via a system message identity. The MALIKA system prompt (built by
  // prompt.service.js) already defines the assistant persona correctly.
  let streamMessages = ctx.openAiMessages;

  // Build streamText options
  const streamOpts = {
    model: sdkModel,
    messages: streamMessages,
    maxTokens: modelParams.maxTokens,
    abortSignal: ctx.sse.abortController.signal,
    onError: ({ error }) => {
      logger.error({ err: error }, 'streamText onError');
    },
    onFinish: ({ finishReason, usage }) => {
      if (finishReason) ctx._finishReason = finishReason;
      if (usage) ctx._usage = usage;
    },
  };

  // ── Claude Extended Thinking config ──────────────────────────────
  if (effectiveHasThinking) {
    streamOpts.providerOptions = {
      anthropic: {
        thinking: modelParams.thinking,
      },
    };
    logger.info({
      threadId: ctx.threadId,
      thinkingType: modelParams.thinking.type,
      budgetTokens: modelParams.thinking.budgetTokens,
    }, 'Extended Thinking enabled for this request');
  }

  // ── Tool Use: add function calling tools if enabled ──────────────
  // Default: ON for non-reasoning models (set CHAT_TOOL_USE=false to disable)
  const useTools = process.env.CHAT_TOOL_USE !== 'false';
  if (useTools && !isReasoning) {
    try {
      const tu = getToolUse();
      if (tu.shouldEnableToolUse(ctx)) {
        streamOpts.tools = tu.buildTools(ctx, svc);
        streamOpts.maxSteps = tu.MAX_TOOL_STEPS;
        const toolNames = Object.keys(streamOpts.tools || {});
        logger.info({ threadId: ctx.threadId, toolCount: toolNames.length, toolNames }, 'Tool use enabled for this query');
      }
    } catch (e) {
      logger.warn({ error: e.message }, 'Tool use setup failed, continuing without tools');
    }
  }

  // Apply temperature (skip for Claude with thinking — SDK ignores it)
  if (modelParams.temperature !== undefined && !effectiveHasThinking) {
    streamOpts.temperature = modelParams.temperature;
  }

  // Stream smoothing for fluid text delivery (skip for reasoning/thinking models)
  if (!isReasoning && !effectiveHasThinking) {
    streamOpts.experimental_transform = smoothStream({ chunking: 'word' });
  }

  let fullText = '';
  let reasoningText = '';
  let sentComposeStatus = false;
  let sentThinkingStatus = false;
  const streamStartTime = Date.now();

  try {
    _suppressTypeValidationErrors();
    const result = streamText(streamOpts);

    // Handle reasoning/thinking tokens (o-series reasoning OR Claude Extended Thinking)
    if (isReasoning || effectiveHasThinking) {
      // Send 'thinking' stage to pipeline indicator — model is about to think
      { const _t = getTopicLabel(ctx); ctx.sse.sendEvent('status', { message: _t ? `Menganalisis "${_t}"…` : 'Berpikir & menganalisis…', stage: 'thinking' }); }
      sentThinkingStatus = true;
    }

    // Contextual thinking: T5 incremental emission — items have already been
    // emitted progressively after each pipeline stage. No batch needed here.
    // ctx._thinkingItems was populated by emitThinkingItem() calls above.

    // Consume the stream
    try {
      for await (const part of result.fullStream) {
        if (!ctx.sse.isClientConnected()) break;

        switch (part.type) {
          case 'reasoning':
          case 'reasoning-delta':
            // Reasoning/thinking tokens (OpenAI o-series OR Claude Extended Thinking)
            // AI SDK v6 emits 'reasoning-delta' in fullStream; older versions use 'reasoning'.
            if (part.text) {
              if (!sentThinkingStatus) {
                const _t = getTopicLabel(ctx);
                ctx.sse.sendEvent('status', { message: _t ? `Menganalisis "${_t}"…` : 'Berpikir & menganalisis…', stage: 'thinking' });
                sentThinkingStatus = true;
              }
              reasoningText += part.text;
              ctx.sse.sendEvent('thinking', { step: 'thinking-delta', content: part.text });
            }
            break;

          case 'text-delta':
            // Regular text content — BUFFERED (not sent incrementally)
            // Text is sent as a single event after supervisor formatting to avoid
            // the "flash" where raw text appears then gets replaced.
            if (part.text) {
              if (!sentComposeStatus) {
                ctx.sse.sendEvent('status', { message: 'Menyusun jawaban…', stage: 'composing' });
                sentComposeStatus = true;
              }
              fullText += part.text;
            }
            break;

          case 'tool-call':
            // Tool call initiated by LLM — send user-friendly status + rich tool_call event
            logger.info({ tool: part.toolName, args: part.args }, 'Tool called');
            {
              const toolStatusMap = {
                search_data: 'Mencari indikator statistik...',
                search_indicators_semantic: 'Mencari indikator berdasarkan makna...',
                get_data_preview: 'Mengambil data tabel...',
                search_knowledge: 'Mencari dokumen BPS...',
                search_document_table: 'Mencari tabel dalam dokumen...',
                get_exim_data: 'Mengambil data perdagangan...',
                recall_memory: 'Memeriksa riwayat percakapan...',
              };
              const toolMessage = toolStatusMap[part.toolName] || `Memproses (${part.toolName})...`;
              // Legacy status event (backward compat for older frontends)
              ctx.sse.sendEvent('status', {
                message: toolMessage,
                stage: `tool_${part.toolName}`,
              });
              // Rich tool_call event with args for agentic UI
              ctx.sse.sendEvent('tool_call', {
                toolName: part.toolName,
                callId: part.toolCallId || `tc_${Date.now()}`,
                args: _sanitizeToolArgs(part.args),
                message: toolMessage,
              });
              // Track tool call start time for elapsed calculation
              if (!ctx._toolCallTimers) ctx._toolCallTimers = {};
              ctx._toolCallTimers[part.toolName] = Date.now();
            }
            break;

          case 'tool-result':
            // Tool result returned — send rich tool_result event to frontend
            logger.info({ tool: part.toolName, found: !!part.result?.found, cached: !!part.result?.cached }, 'Tool result');
            {
              const startTime = ctx._toolCallTimers?.[part.toolName];
              const elapsedMs = startTime ? Date.now() - startTime : null;
              ctx.sse.sendEvent('tool_result', {
                toolName: part.toolName,
                callId: part.toolCallId || null,
                summary: _summarizeToolResult(part.toolName, part.result),
                found: !!part.result?.found,
                cached: !!part.result?.cached,
                elapsedMs,
              });
            }
            break;

          case 'error':
            // Skip Copilot proxy annotation validation errors (non-blocking,
            // content tokens still flow). These occur because the proxy forwards
            // annotations as objects instead of arrays.
            if (part.error?.name === 'AI_TypeValidationError' ||
                part.error?.constructor?.name === '_TypeValidationError') {
              // Intentionally silent — content tokens still accumulate
              break;
            }
            logger.error({ error: part.error }, 'Stream error');
            ctx.sse.sendEvent('error', { message: 'Terjadi kesalahan saat menyusun jawaban.' });
            break;

          case 'finish':
            // Capture usage metadata + finish reason
            ctx._usage = part.usage;
            ctx._finishReason = part.finishReason || null;
            break;
        }
      }
    } catch (streamErr) {
      if (streamErr.name === 'AbortError') {
        logger.debug({ threadId: ctx.threadId }, 'Stream aborted by client');
        return;
      }
      // AI SDK TypeValidationError: Copilot proxy adds extra fields (annotations,
      // copilot_annotations) that the SDK's Zod schema rejects. These are non-blocking
      // — content tokens still flow correctly. Silently continue.
      if (streamErr.name === 'AI_TypeValidationError' || streamErr.constructor?.name === '_TypeValidationError') {
        // Intentionally silent — fullText is already accumulated from successful chunks
      } else {
        throw streamErr;
      }
    }

    // Recover usage & finishReason from result promises (works even when
    // fullStream loop exits early due to TypeValidationError from Copilot proxy).
    // If onFinish callback already captured these, skip the await.
    if (!ctx._usage || !ctx._finishReason) {
      try {
        const raceTimeout = (promise, ms) => Promise.race([
          promise,
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
        ]);
        const [usage, finishReason] = await Promise.all([
          ctx._usage ? Promise.resolve(ctx._usage) : raceTimeout(result.usage, 3000).catch(() => null),
          ctx._finishReason ? Promise.resolve(ctx._finishReason) : raceTimeout(result.finishReason, 3000).catch(() => null),
        ]);
        if (usage && !ctx._usage) ctx._usage = usage;
        if (finishReason && !ctx._finishReason) ctx._finishReason = finishReason;
      } catch { /* non-critical */ }
    }

    // Fallback: if text was generated but finishReason still missing, default to 'stop'
    // If no text was generated (stream error), set 'error'
    if (!ctx._finishReason) {
      ctx._finishReason = fullText.length > 0 ? 'stop' : 'error';
    }
  } catch (outerErr) {
    // Unexpected error wrapping entire streamText + consumption
    if (outerErr.name === 'AbortError') {
      logger.debug({ threadId: ctx.threadId }, 'Stream aborted by client (outer)');
      return;
    }
    throw outerErr;
  } finally {
    _restoreConsoleError();
  }

  const streamDuration = Date.now() - streamStartTime;

  // Log Extended Thinking stats
  if (effectiveHasThinking && reasoningText) {
    logger.info({
      threadId: ctx.threadId,
      thinkingChars: reasoningText.length,
      outputChars: fullText.length,
      thinkingBudget: modelParams.thinking?.budgetTokens,
      streamDurationMs: streamDuration,
    }, 'Claude Extended Thinking completed');
  }

  // ── finish_reason monitoring: detect truncated responses ──────────
  if (ctx._finishReason === 'length') {
    logger.warn({
      threadId: ctx.threadId,
      finishReason: ctx._finishReason,
      model: tierConfig.model || OPENAI.MODEL,
      maxTokens: modelParams.maxTokens,
      outputTokens: ctx._usage?.outputTokens || 0,
      textLength: fullText.length,
    }, 'LLM output TRUNCATED (finish_reason=length) — response may be incomplete');

    // Auto-continuation: request the model to continue from where it left off
    try {
      _suppressTypeValidationErrors();
      const continuationMessages = [
        ...ctx.openAiMessages,
        { role: 'assistant', content: fullText },
        { role: 'user', content: 'Lanjutkan jawaban yang terpotong di atas. Mulai langsung dari kalimat terakhir, jangan ulangi bagian yang sudah dijawab.' },
      ];

      const contResult = streamText({
        model: sdkModel,
        messages: continuationMessages,
        maxTokens: Math.min((modelParams.maxTokens || 8000), 8000),
        abortSignal: ctx.sse.abortController.signal,
        onError: ({ error }) => {
          const name = error?.name || '';
          if (name.includes('TypeValidationError')) return;
          logger.error({ err: error }, 'Continuation streamText onError');
        },
      });

      let contText = '';
      for await (const part of contResult.fullStream) {
        if (!ctx.sse.isClientConnected()) break;
        if (part.type === 'text-delta' && part.text) {
          contText += part.text;
        } else if (part.type === 'finish') {
          // Update usage with continuation tokens
          if (part.usage && ctx._usage) {
            ctx._usage.outputTokens = (ctx._usage.outputTokens || 0) + (part.usage.outputTokens || 0);
            ctx._usage.totalTokens = (ctx._usage.totalTokens || 0) + (part.usage.totalTokens || 0);
          }
          ctx._continuationFinishReason = part.finishReason || null;
        }
      }

      if (contText.trim()) {
        fullText += '\n' + contText.trim();
        ctx._hadContinuation = true; // Flag for supervisor to re-review full text
        logger.info({
          threadId: ctx.threadId,
          continuationChars: contText.length,
          continuationFinishReason: ctx._continuationFinishReason,
          totalChars: fullText.length,
        }, 'Auto-continuation completed successfully');
      }
    } catch (contErr) {
      if (contErr.name !== 'AbortError') {
        logger.warn({ error: contErr.message, threadId: ctx.threadId }, 'Auto-continuation failed');
      }
    } finally {
      _restoreConsoleError();
    }
  }

  // Track cost for the main chat generation via AI SDK
  try {
    const { costTracker } = require('../../../utils/costTracker');
    if (ctx._usage) {
      const promptTok = ctx._usage.inputTokens || 0;
      const cachedTok = ctx._usage.cachedInputTokens || 0;
      const cacheRate = promptTok > 0 ? ((cachedTok / promptTok) * 100).toFixed(1) : '0.0';
      logger.info({
        threadId: ctx.threadId,
        model: tierConfig.model || OPENAI.MODEL,
        promptTokens: promptTok,
        cachedTokens: cachedTok,
        completionTokens: ctx._usage.outputTokens || 0,
        cacheHitRate: `${cacheRate}%`,
        latencyMs: streamDuration,
      }, 'Prompt cache stats');
      costTracker.record({
        model: tierConfig.model || OPENAI.MODEL,
        usage: {
          prompt_tokens: promptTok,
          completion_tokens: ctx._usage.outputTokens || 0,
          reasoning_tokens: ctx._usage.reasoningTokens || 0,
          cached_tokens: cachedTok,
        },
        purpose: 'chat_generation',
        latencyMs: streamDuration,
      });
    }
  } catch { /* non-critical */ }

  // Store fullText on ctx so pipeline can pass it to LLM suggestions after SSE close
  ctx._streamFullText = fullText;

  // ── Fallback: if LLM produced no text after tool calls, generate default response ──
  if (!fullText.trim() && streamOpts.tools) {
    const fallbackMsg = 'Mohon maaf, saya belum menemukan informasi yang sesuai untuk pertanyaan tersebut. Silakan coba dengan kata kunci yang lebih spesifik, atau hubungi BPS Maluku Utara via WhatsApp di [+62 851-7676-4422](https://wa.me/6285176764422) untuk bantuan lebih lanjut.';
    fullText = fallbackMsg;
    ctx._streamFullText = fullText;
    // Fallback text will be sent as final text below after supervisor
    logger.warn({ threadId: ctx.threadId }, 'Empty response after tool calls — will send fallback');
  }

  // ── Post-streaming: build UI metadata ──────────────────────────────
  const { buildKnowledgeCandidates, buildExternalLinksForUI, buildTableMeta } = require('./uiMetadata.service');

  // Inject bps_web_url from selected candidate into dataPreview for frontend link
  if (ctx.dataPreview && ctx.candidates?.length > 0) {
    const selectedCandidate = ctx.candidates.find(c => c.id === ctx.selectedSourceId) || ctx.candidates[0];
    if (selectedCandidate?.bps_web_url) {
      ctx.dataPreview.bps_web_url = selectedCandidate.bps_web_url;
    }
  }
  if (ctx.dataPreviewSecondary && ctx.candidates?.length > 0) {
    const secondaryCandidate = ctx.candidates.find(c => c.id === ctx.secondarySourceId) || ctx.candidates[1] || ctx.candidates[0];
    if (secondaryCandidate?.bps_web_url) {
      ctx.dataPreviewSecondary.bps_web_url = secondaryCandidate.bps_web_url;
    }
  }

  // Await chart agent if it was launched (Stage 5.5)
  if (ctx._chartAgentPromise) {
    try { await ctx._chartAgentPromise; } catch { /* already handled */ }
  }

  const uiMeta = svc.buildUIMetadata?.({
    _opts: true,
    intentResult: ctx.intentResult,
    candidates: ctx.candidates,
    dataPreview: ctx.dataPreview,
    periodFallback: ctx.periodFallback,
    eximParams: ctx.eximParams,
    isKnowledgeMode: ctx.isKnowledgeMode,
    conversationTopic: ctx.conversationTopic,
    chartConfig: ctx._chartConfig || null,
  }) || { v: 1 };

  // Inject all-years data into table for modal year-tabs
  // (Legacy buildUIMetadata doesn't include these fields)
  if (uiMeta.table && ctx.dataPreview) {
    uiMeta.table.source_id = ctx.dataPreview.source_id || null;
    uiMeta.table.allRows = ctx.dataPreview.allRows || null;
    uiMeta.table.allColumns = ctx.dataPreview.allColumns || null;
    uiMeta.table.availableYears = ctx.dataPreview.availableYears || null;
    uiMeta.table.defaultYear = ctx.dataPreview.defaultYear || null;
  }

  // Add secondary table for dual EXIM queries (ekspor + impor)
  if (ctx.dataPreviewSecondary) {
    uiMeta.table2 = buildTableMeta(ctx.dataPreviewSecondary);
  }

  // Enrich with knowledge candidates
  if (ctx.knowledgeContext?.length > 0) {
    uiMeta.knowledgeCandidates = buildKnowledgeCandidates(null, ctx.knowledgeContext, !!ctx.dataPreview, false);
  }

  // External links
  let resolvedExternalLinks = null;
  try {
    if (svc.webSearchService?.isAvailable?.()) {
      const extLinks = await svc.webSearchService.searchExternalIndicators(ctx.effectiveQuery, null);
      if (extLinks?.length) {
        resolvedExternalLinks = buildExternalLinksForUI(extLinks);
        uiMeta.externalLinks = resolvedExternalLinks;
      }
    }
  } catch { /* continue */ }

  // Add DNA metadata for frontend second-bubble rendering
  if (ctx.dnaRawResults) {
    const dna = require('../../dna/dnaNucleus.service');
    uiMeta.dnaMetadata = dna.buildDnaUiMetadata(ctx.dnaRawResults);
  }

  // Append accumulated reasoning tokens as a thinking item (for reasoning models)
  if (reasoningText && ctx._thinkingItems) {
    ctx._thinkingItems.push({
      step: 'reasoning',
      content: reasoningText.length > 2000
        ? reasoningText.slice(0, 2000) + '…'
        : reasoningText,
    });
  }

  // Persist thinking items so they survive page refreshes
  if (ctx._thinkingItems?.length > 0) {
    uiMeta.thinkingItems = ctx._thinkingItems;
  }

  // Add metadata from pipeline
  uiMeta.metadata = {
    model: tierConfig.model || OPENAI.MODEL,
    tier: ctx.modelRoute.tier,
    reasoning: isReasoning || effectiveHasThinking,
    reasoning_effort: tierConfig.reasoning_effort || null,
    thinking: effectiveHasThinking ? {
      type: modelParams.thinking?.type || null,
      budgetTokens: modelParams.thinking?.budgetTokens || null,
    } : null,
    tokens: ctx._usage ? {
      input: ctx._usage.inputTokens || 0,
      output: ctx._usage.outputTokens || 0,
      reasoning: ctx._usage.reasoningTokens || 0,
      cached: ctx._usage.cachedInputTokens || 0,
      total: ctx._usage.totalTokens || 0,
    } : null,
    finishReason: ctx._finishReason || null,
    wasTruncated: ctx._finishReason === 'length',
    continuation: ctx._continuationFinishReason ? { finishReason: ctx._continuationFinishReason } : undefined,
    latency_ms: streamDuration,
    pipeline_ms: ctx.timings,
    toolUse: useTools && streamOpts.tools ? true : undefined,
    memoryUsed: ctx.memoryContext ? true : undefined,
    gate: ctx.gate ? { route: ctx.gate.route, confidence: ctx.gate.confidence, reason: ctx.gate.reason } : undefined,
    orchestrator: ctx._orchestratorUsed ? {
      tasks: ctx._orchestratorTasks,
      workers: ctx._orchestratorWorkers,
      latencyMs: ctx._orchestratorLatencyMs,
    } : undefined,
    smartContext: ctx._smartContext ? {
      tier: ctx._smartContext.tier,
      maxDocs: ctx._smartContext.maxDocs,
      perDocChars: ctx._smartContext.perDocChars,
      totalBudget: ctx._smartContext.totalBudget,
      docsDropped: ctx._smartContext.docsDropped,
      charsTrimmed: ctx._smartContext.charsTrimmed,
    } : undefined,
  };

  // ── Phase 3 Optimization: Parallel Supervisor + Suggestions ──────────
  // Start LLM suggestions generation in parallel with supervisor review.
  // Suggestions use raw fullText (pre-supervisor) — the 300-char summary
  // is close enough to generate equally good follow-up questions.
  // This saves ~500–2000ms by overlapping the two independent LLM calls.

  let suggestionsPromise = null;
  try {
    const llmSuggestions = getLLMSuggestions();
    if (llmSuggestions.LLM_SUGGESTIONS_ENABLED && ctx.sse?.isClientConnected?.()) {
      suggestionsPromise = Promise.race([
        llmSuggestions.sendLLMSuggestionsAsync(ctx, fullText),
        new Promise(resolve => setTimeout(resolve, 2000)), // 2s max wait
      ]).catch(e => logger.debug({ error: e?.message }, 'Parallel suggestions failed'));
    }
  } catch { /* non-critical */ }

  // ── Supervisor Agent: post-stream review ─────────────────────────────
  // Reviews response for BPS compliance, statistical context, and narrative quality.
  // May modify fullText (append disclaimers) and uiMeta (suppress data display).
  // Gate hint: skipSupervisor for greetings (template responses need no review)
  if (ctx.gate?.skipSupervisor) {
    logger.debug({ gateRoute: ctx.gate?.route }, 'Supervisor: SKIPPED (gate_hint)');
    uiMeta.metadata.supervisor = { skipped: true, reason: 'gate_hint' };
  } else {
    try {
      const { reviewResponse } = require('./supervisor.service');
      const supervisorKey = svc.getOpenAIKey?.() ||
        process.env.OPENAI_API_KEY_CHAT ||
        process.env.OPENAI_API_KEY_INTERPRETATION ||
        process.env.OPENAI_API_KEY_QUERY_BUILDER || '';
      const supervisorResult = await reviewResponse(ctx, fullText, uiMeta, supervisorKey);
      fullText = supervisorResult.fullText;
      // uiMeta is mutated in-place by supervisor

      // Track supervisor timing
      if (supervisorResult.latencyMs > 0) {
        ctx.timings.supervisor = supervisorResult.latencyMs;
      }

      // Add supervisor flags to metadata
      uiMeta.metadata.supervisor = supervisorResult.flags;

      // Supervisor may have modified the text (no-op if unchanged)
    } catch (err) {
      logger.warn({ error: err.message, threadId: ctx.threadId }, 'Supervisor failed — continuing without review');
    }
  }

  // ── Layer 1: Post-Response Validator (scalable safety net) ─────────────
  // Detects when LLM says "data not available" but context actually had numeric data.
  // Triggers when ANY knowledge context has numeric data (not just indicator-guided).
  const hasAnyKnowledgeNumericData = (ctx.knowledgeContext || []).some(d => {
    const numPat = /\d{1,3}([.,]\d{1,3})+|\d{4,}/;
    return numPat.test(d.content || '');
  });
  if (fullText && (ctx._knowledgeDataConfirmed || hasAnyKnowledgeNumericData)) {
    const refusalPatterns = [
      /data\s+(belum|tidak)\s+(tersedia|ada|ditemukan|dapat)/i,
      /belum\s+dapat\s+(ditampilkan|dikonfirmasi|disajikan)/i,
      /tidak\s+memiliki\s+data/i,
      /data\s+tahun\s+\d{4}\s+(belum|tidak)/i,
      /belum\s+(di)?rilis/i,
      // Claude-specific refusal patterns
      /belum\s+dapat\s+dikonfirmasi\s+dari\s+sumber/i,
      /isi\s+tabel\s+tersebut\s+belum\s+dapat/i,
      /tidak\s+dapat\s+dikonfirmasi/i,
      /tidak\s+dapat\s+disajikan/i,
      /data\s+spesifik\s+mengenai.*belum\s+dapat/i,
      /angka.*rinci\s+belum\s+dapat\s+dikonfirmasi/i,
      /(?:belum|tidak)\s+(?:dapat|bisa)\s+(?:di)?konfirmasi/i,
      /data\s+.*masih\s+(?:perlu|harus)\s+dikonfirmasi/i,
      /tidak\s+(?:bisa|dapat)\s+memastikan/i,
      /informasi.*(?:belum|tidak)\s+(?:tersedia|ada|lengkap)/i,
    ];
    const hasRefusal = refusalPatterns.some(rx => rx.test(fullText));
    if (hasRefusal) {
      logger.warn({
        threadId: ctx.threadId,
        extractionTier: ctx._knowledgeExtractionTier,
        topTable: ctx.knowledgeContext?.[0]?._extractedTableTitle?.slice(0, 80),
        responseSnippet: fullText.slice(0, 200),
      }, 'POST-RESPONSE VALIDATOR: LLM refused data that IS in context — flagged for retry');

      // Attempt a targeted mini-retry: re-ask the LLM with a very short, focused prompt
      // that says "You have the data — extract it from the context below"
      try {
        const retryStart = Date.now();
        const { streamText: aiStreamText } = require('ai');
        // Reuse sdkModel (same provider — Claude direct or OpenAI proxy)
        const indicatorDocs = (ctx.knowledgeContext || []).filter(d => d.extractionMethod === 'indicator-guided');
        const bestDoc = indicatorDocs[0];
        if (bestDoc?.content) {
          // Extract the numeric table portion (up to 20K to capture full per-kab/kota tables)
          const tableContent = bestDoc.content.slice(0, 20000);
          const retryMessages = [
            { role: 'system', content: `Kamu adalah MALIKA, asisten data BPS Maluku Utara. Konteks berikut PASTI mengandung data numerik yang menjawab pertanyaan user. EKSTRAK DAN SAJIKAN angka-angka dari tabel di bawah. DILARANG bilang "data tidak tersedia".

ATURAN PENTING:
- HANYA gunakan angka yang BENAR-BENAR ADA di tabel konteks. JANGAN mengarang angka.
- Jika tabel hanya berisi data level provinsi, JANGAN mengarang breakdown per kabupaten/kota.
- Sesuai UU No. 16/1997 Pasal 21, data individu bersifat rahasia — hanya sajikan data agregat.
- Publikasi Dalam Angka tahun X berisi data tahun X-1 (contoh: DDA 2025 = data 2024).` },
            { role: 'user', content: `TABEL DATA:\n${tableContent}\n\nPERTANYAAN: ${ctx.effectiveQuery || ctx.userMessage}\n\nSajikan data dari tabel di atas dalam format yang rapi. Sebutkan angka spesifik.` },
          ];
          const retryResult = await aiStreamText({
            model: sdkModel,
            messages: retryMessages,
            maxTokens: 4000,
            temperature: 0.1,
          });
          let retryText = '';
          for await (const chunk of retryResult.textStream) {
            retryText += chunk;
          }
          if (retryText && retryText.length > 100) {
            // Validate retry didn't also refuse
            const retryRefused = refusalPatterns.some(rx => rx.test(retryText));
            if (!retryRefused) {
              fullText = retryText;
              ctx.sse.sendEvent('status_detail', { stage: 'composing', detail: '🔄 Data diekstrak ulang — jawaban diperbaiki', resultStatus: 'ok' });
              logger.info({
                threadId: ctx.threadId,
                retryLatencyMs: Date.now() - retryStart,
                retryLength: retryText.length,
              }, 'POST-RESPONSE VALIDATOR: Retry succeeded — response replaced');
            }
          }
        }
      } catch (retryErr) {
        logger.warn({ error: retryErr.message }, 'POST-RESPONSE VALIDATOR: Retry failed — keeping original response');
      }
    }
  }

  // ── Send final text as a single event (buffered, post-supervisor) ────
  // This avoids the "flash" where raw text appears then gets replaced.
  // Composing detail: supervisor review status
  {
    const sup = uiMeta.metadata?.supervisor;
    const parts = [];
    if (sup?.skipped) {
      parts.push('Supervisor: dilewati');
    } else if (sup) {
      parts.push(`Supervisor: reviewed`);
      if (sup.hallucination_risk) parts.push('⚠ risiko halusinasi');
    }
    if (fullText) parts.push(`${fullText.length} karakter final`);
    ctx.sse.sendEvent('status_detail', { stage: 'composing', detail: parts.join(' · ') || 'Finalisasi selesai' });
  }
  if (fullText) {
    ctx.sse.sendEvent('text', { content: fullText });
  }

  // Emit UI metadata (done event moved to pipeline level, AFTER Stage 9 suggestions_update)
  logger.debug({
    kbCandCount: uiMeta.knowledgeCandidates?.length || 0,
    kbCandIds: (uiMeta.knowledgeCandidates || []).map(c => c.id).slice(0, 5),
  }, 'Pre-SSE uiMeta knowledge candidates');
  ctx.sse.sendEvent('malika_ui', uiMeta);

  // ── Await parallel suggestions before done event ─────────────────────
  // suggestions_update must arrive BEFORE done event so frontend receives
  // them before onDone triggers refresh. suggestionsPromise was started
  // before supervisor (Phase 3 optimization: parallel execution).
  if (suggestionsPromise) {
    try {
      await suggestionsPromise;
    } catch { /* already handled internally */ }
  }

  // Store fullText for pipeline done event
  ctx._streamFullText = fullText;
  ctx._donePayload = { full_text: fullText, metadata: uiMeta.metadata || {} };

  // Save assistant message (use total pipeline duration as latency)
  // Use the supervisor-modified uiMeta directly instead of rebuilding from scratch,
  // so that supervisor suppressions are persisted in the saved message.
  const totalLatencyMs = ctx.pipelineStartTime ? Date.now() - ctx.pipelineStartTime : streamDuration;
  try {
    const ChatMessage = require('../../../models/ChatMessage.model');
    const { stripMalikaUiBlock, linkifyWhatsAppNumber } = require('./chatHelpers');

    const uiBlock = `\n\n\`\`\`malika_ui\n${JSON.stringify(uiMeta)}\n\`\`\`\n`;
    const cleanedText = stripMalikaUiBlock(String(fullText || ''));
    const waContext = {
      threadId: ctx.threadId,
      userMessage: ctx.userMessage || null,
      aiResponse: cleanedText.slice(0, 200),
    };
    const processedText = linkifyWhatsAppNumber(cleanedText.trim(), waContext);
    const assistantContent = `${processedText}${uiBlock}`.trim().slice(0, 100000);

    await ChatMessage.create({
      thread_id: ctx.threadId,
      role: 'assistant',
      content: assistantContent,
      model: tierConfig.model || null,
      latency_ms: totalLatencyMs || null,
      created_at: now(),
    });
  } catch (saveErr) {
    logger.error({ error: saveErr.message, threadId: ctx.threadId }, 'Failed to save assistant message');
  }

  // Update thread timestamp
  await ctx.thread.update({
    last_message_at: now(),
    updated_at: now(),
  });

  // ── Post-stream: fire-and-forget background tasks ──────────────────

  // 1. Session compaction (if thread is getting long)
  try {
    const sc = getSessionCompaction();
    sc.maybeCompactThread(ctx.threadId).catch(e =>
      logger.debug({ threadId: ctx.threadId, error: e.message }, 'Compaction skipped')
    );
  } catch { /* continue */ }

  // 2. Persistent memory extraction (learn facts from this turn)
  try {
    const pm = getPersistentMemory();
    if (pm.CONFIG.ENABLED) {
      pm.extractAndStoreMemories(ctx.ownerId, ctx.userMessage, fullText, ctx.threadId).catch(e =>
        logger.debug({ error: e.message }, 'Memory extraction skipped')
      );
    }
  } catch { /* continue */ }

  // 3. LLM suggestions moved to pipeline level (Stage 9) — must send before SSE close
}

// ── Tool SSE helpers ────────────────────────────────────────────────────────

/**
 * Sanitize tool args for frontend display — remove huge payloads.
 * Keeps only short, user-readable fields. */
function _sanitizeToolArgs(args) {
  if (!args || typeof args !== 'object') return {};
  const safe = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string' && v.length > 200) {
      safe[k] = v.slice(0, 200) + '…';
    } else {
      safe[k] = v;
    }
  }
  return safe;
}

/**
 * Build a compact, human-readable summary of a tool result for the frontend.
 * Each tool type gets a custom summary format. */
function _summarizeToolResult(toolName, result) {
  if (!result) return 'Tidak ada hasil';
  if (!result.found) return result.message || 'Tidak ditemukan';

  switch (toolName) {
    case 'search_data': {
      const n = result.count || result.candidates?.length || 0;
      const top = result.candidates?.[0]?.name;
      return `${n} indikator ditemukan${top ? ` · ${top.slice(0, 50)}` : ''}${result.cached ? ' (cache)' : ''}`;
    }
    case 'search_indicators_semantic': {
      const n = result.count || result.results?.length || 0;
      const top = result.results?.[0];
      return top
        ? `${n} hasil semantic · ${(top.title || '').slice(0, 50)} (${(top.score || 0).toFixed(2)})`
        : `${n} hasil semantic`;
    }
    case 'get_data_preview': {
      const rows = result.rows || 0;
      const src = result.source || '';
      const note = result.period_note ? ` · ${result.period_note}` : '';
      return `${src.slice(0, 50)} · ${rows} baris${note}${result.cached ? ' (cache)' : ''}`;
    }
    case 'search_knowledge': {
      const n = result.count || result.documents?.length || 0;
      const top = result.documents?.[0]?.title;
      return `${n} dokumen ditemukan${top ? ` · ${top.slice(0, 50)}` : ''}${result.cached ? ' (cache)' : ''}`;
    }
    case 'search_document_table': {
      const t = result.table_title || result.table_number || '';
      return `Tabel ${t}${result.method === 'keyword_search' ? ' (keyword)' : ''}`.trim();
    }
    case 'get_exim_data': {
      const rows = result.rows || 0;
      const src = result.source || '';
      return `${src} · ${rows} baris${result.cached ? ' (cache)' : ''}`;
    }
    case 'recall_memory': {
      const n = result.count || result.threads?.length || 0;
      return `${n} percakapan ditemukan`;
    }
    default:
      return result.found ? 'Berhasil' : 'Gagal';
  }
}

module.exports = {
  runPipeline,
  // Export stages for unit testing
  stageValidate,
  stageGate,
  stageContext,
  stageNormalize,
  stageIntent,
  stagePreview,
  stageKnowledgeSearch,
  stageDnaPreEnrich,
  stageKnowledgeMode,
  stageModelSelect,
  stageStream,
};
