/**
 * Main Agent — Pipeline V2 Layer 3
 *
 * Receives all sub-agent results (datasource, publication, nonstat),
 * builds an enriched system prompt, streams the response via AI SDK,
 * runs supervisor review, emits suggestions, and saves the message.
 *
 * Replaces: stageModelSelect + stageStream + stageKnowledgeMode from V1.
 * Reuses: prompt.service, modelRouter.service, supervisor.service, uiMetadata.service
 *
 * @module mainAgent
 */

'use strict';

const { streamText, smoothStream } = require('ai');
const { createOpenAI } = require('@ai-sdk/openai');
const { INTERNAL_API_BASE } = require('../config');
const { okResult, failResult, agentStatus, agentDetail, agentThinking } = require('./agentProtocol');
const { routeModel, buildModelParams, isReasoningModel } = require('../modelRouter.service');
const { OPENAI, SMART_CONTEXT, INDICATOR_INJECTION, EXTRACTION } = require('../config');
const { MODEL_ALIASES: _MODEL_ALIASES } = require('../config');
const { now } = require('../../../../utils/dateHelper');
const logger = require('../../../../utils/logger').child({ service: 'MainAgent' });

// Suppress TypeValidationErrors (AI SDK + Copilot proxy)
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

// Context budget
const MAX_CONTEXT_CHARS = 400_000;

/**
 * Run the main agent.
 *
 * @param {import('./agentProtocol').AgentInput} input
 * @param {object} subAgentResults - { datasource: AgentOutput, publication: AgentOutput, nonstat: AgentOutput }
 * @param {object} pipelineCtx - Reference to pipeline context for shared state
 * @returns {Promise<import('./agentProtocol').AgentOutput>}
 */
async function run(input, subAgentResults, pipelineCtx) {
  const startMs = Date.now();
  const timings = {};

  try {
    const { sse, gate, norm, context } = input;
    const ds = subAgentResults.datasource?.data || {};
    const pub = subAgentResults.publication?.data || {};
    const nonstat = subAgentResults.nonstat?.data || {};

    // ── Merge sub-agent results ─────────────────────────────────────────
    const candidates = ds.candidates || [];
    let dataPreview = ds.dataPreview || null;
    const dataPreviewSecondary = ds.dataPreviewSecondary || null;
    const periodFallback = ds.periodFallback || null;
    const isEximQuery = ds.isEximQuery || false;
    const eximParams = ds.eximParams || null;
    const intentResult = ds.intentResult || null;
    const chartPromise = ds.chartPromise || null;

    // Merge knowledge from publication + nonstat agents
    let knowledgeContext = [...(pub.sources || []), ...(nonstat.sources || [])];

    // ── Table relevance check ───────────────────────────────────────────
    if (dataPreview?.title) {
      const { checkTableRelevance } = require('../supervisor.service');
      const relCheck = checkTableRelevance(input.effectiveQuery || input.rawQuery, dataPreview, {});
      if (!relCheck.isRelevant) {
        logger.info({ tableTitle: dataPreview.title?.slice(0, 80), reason: relCheck.reason }, 'mainAgent: table irrelevant → removing');
        pipelineCtx._suppressedDataPreview = dataPreview;
        dataPreview = null;
      }
    }

    // ── Knowledge mode decision ─────────────────────────────────────────
    let isKnowledgeMode = false;
    const { isKnowledgeTypeQuery } = require('../knowledgeContext.service');

    if (gate?.forceKnowledge) {
      isKnowledgeMode = true;
      if (candidates.length > 0) pipelineCtx._pipelineCandidates = [...candidates];
    } else if (!dataPreview && knowledgeContext.length > 0) {
      const topSim = knowledgeContext[0]?.similarity || 0;
      if (isKnowledgeTypeQuery(input.effectiveQuery, topSim)) {
        isKnowledgeMode = true;
      }
    }

    // If knowledge mode, clear data preview
    if (isKnowledgeMode) {
      dataPreview = null;
    }

    // ── Model routing ───────────────────────────────────────────────────
    agentStatus(sse, 'model', input._topicLabel ? `Merangkai konteks "${input._topicLabel}"…` : 'Merangkai konteks & referensi…');

    const { detectMergeBundle } = require('../mergeBundles');
    const hasIndicatorInjectedDocs = knowledgeContext.some(d => d.indicatorInjected);

    const modelRoute = routeModel({
      query: norm.normalizedQuery,
      isGreeting: false,
      isMergeBundle: !!detectMergeBundle(input.rawQuery?.toLowerCase(), context.conversationTopic),
      isMultiSource: dataPreview?.merged || false,
      hasYearRange: !!dataPreview?.periodRange,
      candidateCount: candidates.length,
      isEximQuery,
      isKnowledgeMode,
      hasIndicatorInjectedDocs,
    });

    // Apply user model override
    if (input.modelOverride) {
      const allowedModels = ['claude-sonnet-4-6', 'claude-haiku-4-5'];
      if (allowedModels.includes(input.modelOverride)) {
        modelRoute.config.model = input.modelOverride;
      }
    }

    // ── Smart Context Sizing ────────────────────────────────────────────
    const contextTier = SMART_CONTEXT[modelRoute.tier] || SMART_CONTEXT.complex;
    const smartContextMeta = {
      tier: modelRoute.tier,
      maxDocs: contextTier.maxDocs,
      perDocChars: contextTier.perDocChars,
      docsDropped: 0,
      charsTrimmed: 0,
    };

    if (knowledgeContext.length > 0) {
      // ── Indicator-focus: when a strong indicator-guided match exists, ──────
      // ── drop weak/irrelevant docs to reduce context noise ──────────────────
      // Without this, queries like "rumah makan restoran" get drowned by 5+
      // Sensus Pertanian docs matching on "rumah" via vector similarity.
      let indicatorGuided = knowledgeContext.filter(d => d.extractionMethod === 'indicator-guided');
      if (indicatorGuided.length > 0 && knowledgeContext.length > 3) {
        // Sort indicator-guided docs by match quality (best first → LLM sees best doc first)
        indicatorGuided.sort((a, b) => (b._indicatorMatchScore || 0) - (a._indicatorMatchScore || 0));
        // Drop indicator-guided docs with significantly lower scores than the best —
        // they match a different table and confuse the LLM (e.g., "Sumber Air" vs "Air Minum Layak")
        if (indicatorGuided.length > 1) {
          const bestScore = indicatorGuided[0]._indicatorMatchScore || 0;
          indicatorGuided = indicatorGuided.filter(d => {
            const score = d._indicatorMatchScore || 0;
            return score >= bestScore - EXTRACTION.SCORE_GAP_THRESHOLD; // Drop docs too far below best
          });
        }
        // Keep: indicator-guided docs + up to 2 other docs (for context diversity)
        const others = knowledgeContext.filter(d => d.extractionMethod !== 'indicator-guided');
        const kept = [...indicatorGuided, ...others.slice(0, 2)];
        smartContextMeta.docsDropped += knowledgeContext.length - kept.length;
        knowledgeContext = kept;
      }

      // Limit docs
      if (knowledgeContext.length > contextTier.maxDocs) {
        smartContextMeta.docsDropped += knowledgeContext.length - contextTier.maxDocs;
        knowledgeContext = knowledgeContext.slice(0, contextTier.maxDocs);
      }
      // Limit per-doc content
      for (const doc of knowledgeContext) {
        const budget = doc.contentExtracted ? contextTier.perDocChars * 2 : contextTier.perDocChars;
        if (doc.content && doc.content.length > budget) {
          smartContextMeta.charsTrimmed += doc.content.length - budget;
          const chunk = doc.matchedChunkText || '';
          if (chunk.length > 0 && !doc.contentExtracted) {
            const header = `[BAGIAN PALING RELEVAN]\n${chunk}\n\n[KONTEKS DOKUMEN]\n`;
            const remaining = Math.max(0, budget - header.length);
            doc.content = header + doc.content.slice(0, remaining) + '\n\n[… konten dipotong]';
          } else {
            doc.content = doc.content.slice(0, budget) + '\n\n[… konten dipotong]';
          }
          // For truncated large docs with indicator_index, hint available tables
          // so the LLM knows it can call search_document_table to get specific data
          if (doc.indicatorIndex && !doc.contentExtracted) {
            const METADATA_TYPES = new Set(['KEYWORDS', 'TOPICS', 'PERIOD', 'ABBREV', 'INFO']);
            const tblEntries = doc.indicatorIndex.split('\n')
              .filter(e => { const p = e.split('|'); return p.length >= 3 && !METADATA_TYPES.has(p[0]); })
              .slice(0, 20)
              .map(e => { const p = e.split('|'); return `${p[0]}|${p[1]}|${p[2]?.slice(0, 60)}`; });
            if (tblEntries.length > 0) {
              doc.content += `\n\n[TABEL TERSEDIA — gunakan search_document_table(doc_id=${doc.id}) untuk data lengkap]\n${tblEntries.join('\n')}`;
            }
          }
        }
      }
    }

    timings.modelSelect = Date.now() - startMs;

    // Emit model info
    {
      const tier = modelRoute.tier;
      const model = modelRoute.config.model;
      const modelLabel = _MODEL_ALIASES[model] || 'MALIKA';
      const TIER_DISPLAY = { greeting: 'Sapaan', simple: 'Cepat', complex: 'Mendalam', deep: 'Komprehensif', user_override: 'Pilihan Pengguna' };
      const tierLabel = TIER_DISPLAY[tier] || tier;
      agentDetail(sse, 'model', `${modelLabel} (${tierLabel}) · KB: ${knowledgeContext.length > 0 ? 'ya' : '-'}`);
    }

    // Emit reasoning thinking
    {
      const model = modelRoute.config.model;
      const modelAlias = _MODEL_ALIASES[model] || model;
      agentThinking(sse, {
        step: 'reasoning', icon: '🧠',
        label: `Menganalisis dengan analisis ${modelRoute.tier === 'deep' || modelRoute.tier === 'complex' ? 'mendalam' : 'cepat'}`,
        detail: `${modelAlias} (${model})`, model, tier: modelRoute.tier,
      });
    }

    // ── Build messages ──────────────────────────────────────────────────
    const { systemPrompt } = require('../prompt.service');
    const { buildContextMessages } = require('../knowledgeContext.service');

    let errorLearningFixes = [];
    try {
      const errorLearningService = require('../../errorLearning.service');
      if (errorLearningService?.getPromptFixes) {
        errorLearningFixes = await errorLearningService.getPromptFixes(input.effectiveQuery);
      }
    } catch { /* continue */ }

    let systemContent = systemPrompt({
      hasDataPreview: Boolean(dataPreview),
      hasCandidates: candidates.length > 0,
      lowConfidence: (candidates[0]?.score || 0) < 80,
      periodFallback,
      promptFixes: errorLearningFixes,
      hasKnowledgeContext: knowledgeContext.length > 0,
    });

    // Append DNA context
    if (norm.dnaContext) {
      systemContent += '\n\n' + norm.dnaContext;
    }

    // Build brsContext
    let brsContext = null;
    if (knowledgeContext.length > 0 && dataPreview) {
      const brs = knowledgeContext.filter(d => d.category === 'BRS');
      const publications = knowledgeContext.filter(d => d.category === 'Publikasi');
      if (brs.length > 0 || publications.length > 0) {
        brsContext = { brs, publications };
      }
    }

    // Build context messages
    const contextMessages = buildContextMessages({
      intentResult,
      candidates: isKnowledgeMode ? [] : candidates,
      dataPreview,
      dataPreviewSecondary,
      historyMessages: context.historyArray,
      periodFallback,
      knowledgeContext,
      isServiceQueryWithoutKnowledge: false,
      availableYearsInfo: null,
      brsContext,
      reconciliationContext: null,
    }) || [];

    const sanitizedContext = contextMessages
      .filter(m => m && m.role && m.content != null && m.content !== '')
      .map(m => ({ role: m.role, content: String(m.content) }));

    // Expand abbreviations
    const { expandAbbreviationsInline } = require('../../../../shared/bpsAbbreviations');
    const userContent = expandAbbreviationsInline(String(input.effectiveQuery || input.rawQuery || ''));

    let openAiMessages = [
      { role: 'system', content: systemContent + (context.memoryContext ? '\n\n' + context.memoryContext : '') },
      ...sanitizedContext,
      { role: 'user', content: userContent },
    ];

    // Budget enforcement
    const tierBudget = contextTier?.totalBudget || MAX_CONTEXT_CHARS;
    const budgetResult = _trimMessagesToBudget(openAiMessages, tierBudget);
    if (budgetResult.trimmed) {
      openAiMessages = budgetResult.messages;
    }

    // Emit intent event for frontend
    sse.sendEvent('intent', {
      datasource: intentResult?.datasource || null,
      candidates: candidates.slice(0, 5).map(c => ({ id: c.id, name: c.name, type: c.type })),
      hasPreview: Boolean(dataPreview),
      effectiveQuery: input.effectiveQuery !== input.rawQuery?.slice(0, 4000) ? input.effectiveQuery : null,
      periodFallback: periodFallback || null,
      modelTier: modelRoute.tier,
    });

    // ── Stream ──────────────────────────────────────────────────────────
    agentStatus(sse, 'generate', input._topicLabel ? `Merangkum data "${input._topicLabel}"…` : 'Merangkum & menarasikan data…');

    const tierConfig = modelRoute.config;
    const modelParams = buildModelParams(tierConfig);
    const isReasoning = isReasoningModel(modelParams.model);

    const proxyBaseURL = process.env.OPENAI_API_BASE_URL || 'http://127.0.0.1:3031/v1';
    const openai = createOpenAI({ baseURL: proxyBaseURL, apiKey: 'sk-noop', compatibility: 'strict' });

    const streamOpts = {
      model: openai.chat(modelParams.model),
      messages: openAiMessages,
      maxTokens: modelParams.maxTokens,
      abortSignal: input.signal || undefined,
      onFinish: ({ finishReason, usage }) => {
        if (finishReason) pipelineCtx._finishReason = finishReason;
        if (usage) pipelineCtx._usage = usage;
      },
    };

    // Tool use
    const useTools = process.env.CHAT_TOOL_USE !== 'false';
    if (useTools && !isReasoning) {
      try {
        const tu = require('../toolUse.service');
        if (tu.shouldEnableToolUse({ ...pipelineCtx, candidates, dataPreview, knowledgeContext, isKnowledgeMode })) {
          streamOpts.tools = tu.buildTools({ ...pipelineCtx, candidates, dataPreview, knowledgeContext }, {});
          streamOpts.maxSteps = tu.MAX_TOOL_STEPS;
        }
      } catch { /* continue */ }
    }

    if (modelParams.temperature !== undefined) {
      streamOpts.temperature = modelParams.temperature;
    }
    if (!isReasoning) {
      streamOpts.experimental_transform = smoothStream({ chunking: 'word' });
    }

    let fullText = '';
    let reasoningText = '';
    const streamStartTime = Date.now();

    try {
      _suppressTypeValidationErrors();
      const result = streamText(streamOpts);

      for await (const part of result.fullStream) {
        if (!sse.isClientConnected()) break;
        switch (part.type) {
          case 'reasoning':
            if (part.text) { reasoningText += part.text; sse.sendEvent('thinking', { content: part.text }); }
            break;
          case 'text-delta':
            if (part.text) {
              fullText += part.text;
              if (fullText.length === part.text.length) {
                sse.sendEvent('status', { message: 'Menyusun jawaban…', stage: 'composing' });
              }
            }
            break;
          case 'tool-call':
            logger.info({ tool: part.toolName }, 'Tool called');
            sse.sendEvent('tool_call', { toolName: part.toolName, args: part.args || {} });
            break;
          case 'tool-result':
            sse.sendEvent('tool_result', { toolName: part.toolName, found: !!part.result?.found });
            break;
          case 'error':
            if (part.error?.name === 'AI_TypeValidationError') break;
            logger.error({ error: part.error }, 'Stream error');
            sse.sendEvent('error', { message: 'Terjadi kesalahan saat menyusun jawaban.' });
            break;
          case 'finish':
            pipelineCtx._usage = part.usage;
            pipelineCtx._finishReason = part.finishReason || null;
            break;
        }
      }

      // Recover usage
      if (!pipelineCtx._usage || !pipelineCtx._finishReason) {
        try {
          const [usage, fr] = await Promise.all([
            pipelineCtx._usage ? Promise.resolve(pipelineCtx._usage) : Promise.race([result.usage, new Promise((_, r) => setTimeout(() => r(), 3000))]).catch(() => null),
            pipelineCtx._finishReason ? Promise.resolve(pipelineCtx._finishReason) : Promise.race([result.finishReason, new Promise((_, r) => setTimeout(() => r(), 3000))]).catch(() => null),
          ]);
          if (usage && !pipelineCtx._usage) pipelineCtx._usage = usage;
          if (fr && !pipelineCtx._finishReason) pipelineCtx._finishReason = fr;
        } catch { /* non-critical */ }
      }
      if (!pipelineCtx._finishReason) pipelineCtx._finishReason = fullText.length > 0 ? 'stop' : 'error';
    } catch (err) {
      if (err.name === 'AbortError') return failResult('mainAgent', 'Aborted', { latencyMs: Date.now() - startMs });
      if (err.name !== 'AI_TypeValidationError') throw err;
    } finally {
      _restoreConsoleError();
    }

    const streamDuration = Date.now() - streamStartTime;
    timings.stream = streamDuration;

    // Cost tracking
    try {
      const { costTracker } = require('../../../../utils/costTracker');
      if (pipelineCtx._usage) {
        costTracker.record({
          model: tierConfig.model || OPENAI.MODEL,
          usage: {
            prompt_tokens: pipelineCtx._usage.inputTokens || 0,
            completion_tokens: pipelineCtx._usage.outputTokens || 0,
            cached_tokens: pipelineCtx._usage.cachedInputTokens || 0,
          },
          purpose: 'chat_generation_v2',
          latencyMs: streamDuration,
        });
      }
    } catch { /* non-critical */ }

    // Fallback if no text
    if (!fullText.trim()) {
      fullText = 'Mohon maaf, saya belum menemukan informasi yang sesuai. Silakan coba kata kunci yang lebih spesifik.';
    }

    // ── Post-stream: build UI metadata ──────────────────────────────────
    const { buildUIMetadata, buildKnowledgeCandidates, buildExternalLinksForUI, buildTableMeta } = require('../uiMetadata.service');

    // Await chart agent
    let chartConfig = null;
    if (chartPromise) {
      try { chartConfig = await chartPromise; } catch { /* handled */ }
    }

    // Inject bps_web_url into dataPreview
    if (dataPreview && candidates.length > 0) {
      const sel = candidates[0];
      if (sel?.bps_web_url) dataPreview.bps_web_url = sel.bps_web_url;
    }

    const uiMeta = buildUIMetadata({
      _opts: true, intentResult, candidates: isKnowledgeMode ? [] : candidates,
      dataPreview, periodFallback, eximParams, isKnowledgeMode,
      conversationTopic: context.conversationTopic, chartConfig,
    }) || { v: 1 };

    // All-years data for modal
    if (uiMeta.table && dataPreview) {
      uiMeta.table.source_id = dataPreview.source_id || null;
      uiMeta.table.allRows = dataPreview.allRows || null;
      uiMeta.table.allColumns = dataPreview.allColumns || null;
      uiMeta.table.availableYears = dataPreview.availableYears || null;
      uiMeta.table.defaultYear = dataPreview.defaultYear || null;
    }
    if (dataPreviewSecondary) uiMeta.table2 = buildTableMeta(dataPreviewSecondary);
    if (knowledgeContext.length > 0) {
      uiMeta.knowledgeCandidates = buildKnowledgeCandidates(null, knowledgeContext, !!dataPreview, false);
    }

    // DNA metadata
    if (norm.dnaResults) {
      try {
        const dna = require('../../../dna/dnaNucleus.service');
        uiMeta.dnaMetadata = dna.buildDnaUiMetadata(norm.dnaResults);
      } catch { /* continue */ }
    }

    // Thinking items
    if (pipelineCtx._thinkingItems?.length > 0) {
      uiMeta.thinkingItems = pipelineCtx._thinkingItems;
    }

    // Metadata
    uiMeta.metadata = {
      model: tierConfig.model || OPENAI.MODEL,
      tier: modelRoute.tier,
      reasoning: isReasoning,
      tokens: pipelineCtx._usage ? {
        input: pipelineCtx._usage.inputTokens || 0,
        output: pipelineCtx._usage.outputTokens || 0,
        cached: pipelineCtx._usage.cachedInputTokens || 0,
        total: pipelineCtx._usage.totalTokens || 0,
      } : null,
      finishReason: pipelineCtx._finishReason || null,
      latency_ms: streamDuration,
      pipeline_ms: pipelineCtx.timings || {},
      pipeline_version: 'v2',
      gate: gate ? { route: gate.route, confidence: gate.confidence, reason: gate.reason } : undefined,
      smartContext: smartContextMeta,
    };

    // ── Supervisor + Suggestions + Message Save (parallel) ──────────────
    // Run all three concurrently via Promise.allSettled to eliminate sequential blocking.
    // Supervisor result is applied to fullText/uiMeta before emitting SSE events.

    // 1) Supervisor promise
    let supervisorPromise = Promise.resolve(null);
    if (!gate?.skipSupervisor) {
      supervisorPromise = (async () => {
        try {
          const { reviewResponse } = require('../supervisor.service');
          const { getOpenAIKey } = require('../prompt.service');
          return await reviewResponse(pipelineCtx, fullText, uiMeta, getOpenAIKey());
        } catch (err) {
          logger.warn({ error: err.message }, 'Supervisor failed');
          return null;
        }
      })();
    }

    // 2) Suggestions promise
    let suggestionsPromise = Promise.resolve();
    try {
      const llmSuggestions = require('../llmSuggestions.service');
      if (llmSuggestions.LLM_SUGGESTIONS_ENABLED && sse?.isClientConnected?.()) {
        suggestionsPromise = Promise.race([
          llmSuggestions.sendLLMSuggestionsAsync(pipelineCtx, fullText),
          new Promise(resolve => setTimeout(resolve, 2000)),
        ]).catch(() => {});
      }
    } catch { /* non-critical */ }

    // 3) Message save promise (uses pre-supervisor text; supervisor may update uiMeta in-place)
    const messageSavePromise = (async () => {
      try {
        const ChatMessage = require('../../../../models/ChatMessage.model');
        const { stripMalikaUiBlock, linkifyWhatsAppNumber } = require('../chatHelpers');
        const cleanedText = stripMalikaUiBlock(String(fullText || ''));
        const processedText = linkifyWhatsAppNumber(cleanedText.trim(), {
          threadId: pipelineCtx.threadId,
          userMessage: input.rawQuery,
          aiResponse: cleanedText.slice(0, 200),
        });
        // uiMeta will be mutated by supervisor before this resolves in most cases,
        // but we snapshot the essentials now and update content after supervisor completes
        return { processedText, ChatMessage };
      } catch (saveErr) {
        logger.error({ error: saveErr.message }, 'Failed to prepare message save');
        return null;
      }
    })();

    // Wait for all three concurrently
    const [supervisorSettled, , messageSaveSettled] = await Promise.allSettled([
      supervisorPromise, suggestionsPromise, messageSavePromise,
    ]);

    // Apply supervisor result
    const supervisorResult = supervisorSettled.status === 'fulfilled' ? supervisorSettled.value : null;
    if (supervisorResult) {
      fullText = supervisorResult.fullText;
      if (supervisorResult.latencyMs > 0) timings.supervisor = supervisorResult.latencyMs;
      uiMeta.metadata.supervisor = supervisorResult.flags;
    }

    // Send final text (after supervisor adjustments)
    if (fullText) sse.sendEvent('text', { content: fullText });
    sse.sendEvent('malika_ui', uiMeta);

    // Done payload
    pipelineCtx._streamFullText = fullText;
    pipelineCtx._donePayload = { full_text: fullText, metadata: uiMeta.metadata };

    // Complete message save with final text (supervisor may have modified it)
    const saveData = messageSaveSettled.status === 'fulfilled' ? messageSaveSettled.value : null;
    if (saveData?.ChatMessage) {
      try {
        const { stripMalikaUiBlock } = require('../chatHelpers');
        const finalCleanedText = stripMalikaUiBlock(String(fullText || '')).trim();
        const uiBlock = `\n\n\`\`\`malika_ui\n${JSON.stringify(uiMeta)}\n\`\`\`\n`;
        await saveData.ChatMessage.create({
          thread_id: pipelineCtx.threadId,
          role: 'assistant',
          content: `${finalCleanedText}${uiBlock}`.trim().slice(0, 100000),
          model: tierConfig.model || null,
          latency_ms: pipelineCtx.pipelineStartTime ? Date.now() - pipelineCtx.pipelineStartTime : streamDuration,
          created_at: now(),
        });
      } catch (saveErr) {
        logger.error({ error: saveErr.message }, 'Failed to save assistant message');
      }
    }

    // Update thread timestamp
    if (context.thread) {
      context.thread.update({ last_message_at: now(), updated_at: now() }).catch(() => {});
    }

    // Background: compaction + memory
    try {
      const sc = require('../../sessionCompaction.service');
      sc.maybeCompactThread(pipelineCtx.threadId).catch(() => {});
    } catch { /* continue */ }
    try {
      const pm = require('../../persistentMemory.service');
      if (pm.CONFIG.ENABLED) {
        pm.extractAndStoreMemories(input.ownerId, input.rawQuery, fullText, pipelineCtx.threadId).catch(() => {});
      }
    } catch { /* continue */ }

    return okResult('mainAgent', {
      fullText,
      modelRoute,
      streamDuration,
      isKnowledgeMode,
    }, { latencyMs: Date.now() - startMs, timings });
  } catch (err) {
    return failResult('mainAgent', err, { latencyMs: Date.now() - startMs });
  }
}

// ── Budget Enforcement (simplified from V1) ─────────────────────────────

function _trimMessagesToBudget(messages, budget = MAX_CONTEXT_CHARS) {
  if (!messages?.length) return { messages, trimmed: false };
  const totalChars = () => messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
  if (totalChars() <= budget) return { messages, trimmed: false };

  const TRIM_MARKERS = [
    'DOKUMEN BRS', 'PUBLIKASI RESMI', 'KNOWLEDGE BASE', 'INFORMASI RESMI',
    'DATA STATISTIK', 'INFORMASI TERKAIT', 'INFORMASI INTERNAL',
  ];

  // Find trimmable messages (system messages with knowledge content)
  const trimmable = [];
  for (let i = 1; i < messages.length - 1; i++) {
    if (messages[i].role !== 'system') continue;
    const c = messages[i].content || '';
    if (c.length > 2000 && TRIM_MARKERS.some(m => c.includes(m))) trimmable.push(i);
  }
  trimmable.sort((a, b) => (messages[b].content?.length || 0) - (messages[a].content?.length || 0));

  // Truncate largest first
  for (const idx of trimmable) {
    if (totalChars() <= budget) break;
    const content = messages[idx].content;
    const minKeep = Math.max(4000, Math.floor(content.length * 0.3));
    const targetLen = Math.max(minKeep, content.length - (totalChars() - budget));
    if (targetLen < content.length) {
      let cutPoint = targetLen;
      const lastSep = content.lastIndexOf('\n---\n', cutPoint);
      if (lastSep > minKeep) cutPoint = lastSep;
      messages[idx] = { role: 'system', content: content.slice(0, cutPoint) + '\n\n⚠️ [Dokumen terpotong]' };
    }
  }

  // Remove entire messages if still over
  while (totalChars() > budget && trimmable.length > 0) {
    const removeIdx = trimmable.pop();
    messages.splice(removeIdx, 1);
    for (let j = 0; j < trimmable.length; j++) {
      if (trimmable[j] > removeIdx) trimmable[j]--;
    }
  }

  return { messages, trimmed: true };
}

module.exports = { run };
