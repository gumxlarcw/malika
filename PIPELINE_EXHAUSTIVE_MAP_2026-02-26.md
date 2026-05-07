# MALIKA Chat Pipeline — Exhaustive Map

**Generated**: 2026-02-26  
**Source**: `backend/src/services/chat/streaming/pipeline.service.js` (3,455 lines)  
**Entry point**: `runPipeline({ res, threadId, userMessage, ownerId, modelOverride, _preEstablishedSSE })`

---

## Table of Contents

1. [Pipeline Initialization (Pre-Stage)](#1-pipeline-initialization)
2. [Stage 1: stageValidate](#stage-1-stagevalidate)
3. [Stage 0: stageGate](#stage-0-stagegate)
4. [Stage 2: stageContext](#stage-2-stagecontext)
5. [Stage 3 + 3b: stageNormalize + stageDnaPreEnrich](#stage-3--3b-stagenormalize--stagednapreenrich)
6. [Stage 4 + 6a: stageIntent + stageKnowledgeSearch](#stage-4--6a-stageintent--stageknowledgesearch)
7. [Stage 5 + DNA await: stagePreview](#stage-5--dna-await-stagepreview)
8. [Pre-stream Table Relevance Check](#pre-stream-table-relevance-check)
9. [Stage 5.5: Chart Agent](#stage-55-chart-agent)
10. [Stage 6b: stageKnowledgeMode](#stage-6b-stageknowledgemode)
11. [Stage 7: stageModelSelect](#stage-7-stagemodelselect)
12. [Stage 7b: Orchestrator](#stage-7b-orchestrator)
13. [Stage 8: stageStream](#stage-8-stagestream)
14. [Stage 9+10: Done Event](#stage-910-done-event)
15. [Helper Functions](#helper-functions)
16. [All SSE Events](#all-sse-events)
17. [Complete Stage Summary Table](#complete-stage-summary-table)

---

## 1. Pipeline Initialization

**Lines**: 577–596  
**Function**: Top of `runPipeline()`

### What happens:
1. Records `startTime = Date.now()` and creates empty `timings = {}` object
2. Calls `_buildServiceRef()` to create `svc` — a bag of all imported helper functions (lines 106–142)
3. Builds initial `ctx` (PipelineContext) with: `res`, `threadId`, `userMessage`, `ownerId`, `sse` (reuse or null), `timings`, `pipelineStartTime`, `modelOverride`, `_thinkingItems: []`
4. Defines `emitThinkingItem(item)` — pushes to `ctx._thinkingItems` AND sends SSE `thinking` event (flush: false)
5. Sets PIPELINE_TIMEOUT_MS = 600,000 (10 min) safety net with `setTimeout` that sends error + ends SSE
6. Wraps entire pipeline in `requestContext.run({ modelOverride })` so all sub-agents can read user model choice via AsyncLocalStorage

### Writes to ctx:
- `res`, `threadId`, `userMessage`, `ownerId`, `sse`, `timings`, `pipelineStartTime`, `modelOverride`, `_thinkingItems`

### External calls: None  
### LLM calls: None  
### DB calls: None

---

## Stage 1: stageValidate

**Lines (orchestrator)**: 598–599  
**Lines (implementation)**: 1057–1098  
**Timing key**: `timings.validate`

### What it does:
1. Creates SSE handler via `createSSEHandler()` if not pre-established by concurrency queue
2. Validates thread ownership: `ChatThread.findOne({ where: { id, owner_id } })`
3. Saves user message: `ChatMessage.create({ thread_id, role: 'user', content })`
4. Auto-updates thread title via `svc.updateThreadTitleIfNeeded(thread, userMessage)`

### Calls:
| Type | Details |
|------|---------|
| **LLM** | NO |
| **Embedding** | NO |
| **External API** | NO |
| **Database** | YES — `ChatThread.findOne()`, `ChatMessage.create()`, `thread.update()` (title) |

### SSE events sent:
- `user_saved` — `{ id: userMsg.id }`
- `thread_updated` — `{ title, topics }` (conditional)
- `error` — `{ message: 'Thread not found' }` (if validation fails)

### Writes to ctx:
- `ctx.thread` — ChatThread model instance
- `ctx.userMsg` — saved ChatMessage record
- `ctx.sse` — SSE handler

### Dependencies: None (first stage)
### Can be parallelized: NO (must run first — SSE + thread validation)
### Can be a tool: NO (infrastructure)
### If skipped: SSE never established, no thread, no saved message → everything breaks

---

## Stage 0: stageGate

**Lines (orchestrator)**: 602–606  
**Lines (implementation)**: 1108–1310  
**Timing key**: `timings.gate`

### What it does:
1. Loads last 10 messages for follow-up detection: `ChatMessage.findAll({ limit: 10 })`
2. Extracts `prevUiMeta` from last assistant message (regex parse `malika_ui` block)
3. Calls `classifyQuery()` (Gate Agent) — **LLM call** to classify route
4. Handles 4 early-exit routes directly:
   - **GREETING**: Template response → text + malika_ui + suggestions_update + done → save to DB → `ctx._gateHandled = true`
   - **CHITCHAT**: Template response → text + malika_ui + suggestions_update + done → save to DB → `ctx._gateHandled = true`
   - **DECLINE**: Canned OOS response → text + malika_ui + suggestions_update + done → save to DB → `ctx._gateHandled = true`
   - **DECLINE_INDIVIDUAL**: Pasal 21 compliance → same flow as DECLINE
5. For data/knowledge/analytical routes: returns gate object with hints (`skipIntent`, `skipPreview`, `forceKnowledge`, `fastPathIds`)

### Calls:
| Type | Details |
|------|---------|
| **LLM** | YES — `classifyQuery()` → Gate Agent (model: env `GATE_LLM_MODEL` or gpt-5-mini) |
| **Embedding** | NO |
| **External API** | NO |
| **Database** | YES — `ChatMessage.findAll()` (10 recent), `ChatMessage.create()` (for early-exit saves) |

### SSE events sent (early-exit only):
- `text` — `{ content: greetingText/chitchatText/declineText }`
- `malika_ui` — `{ v:1, metadata: { model:'gate-agent', tier, gate: {route, reason} } }`
- `suggestions_update` — `{ suggestions: [5 static examples] }`
- `done` — `{ full_text }`

### Writes to ctx:
- `ctx.gate` — Gate result object `{ route, reason, confidence, latencyMs, skipIntent, skipPreview, forceKnowledge, fastPathIds, ... }`
- `ctx.isGreeting` — true if GREETING route
- `ctx._gateHandled` — true if early-exit route handled

### Dependencies: Stage 1 (needs `ctx.sse`, `ctx.threadId`)
### Can be parallelized: NO (gates entire pipeline)
### Can be a tool: NO (routing decision)
### If skipped: No fast-path for greetings/chitchat/OOS → all queries hit full pipeline → wasteful but functional

### Post-gate check (line 606):
```javascript
if (ctx._gateHandled) return; // Pipeline ends here for early-exit routes
```

---

## Stage 2: stageContext

**Lines (orchestrator)**: 609–610  
**Lines (implementation)**: 1318–1402  
**Timing key**: `timings.context`

### What it does:
1. Loads conversation history: `ChatMessage.findAll({ thread_id, limit: 50, order: ASC })`
2. Retrieves persistent user memories: `persistentMemory.buildMemoryContext(ownerId, userMessage)`
3. Detects message types via legacy helpers:
   - `isGreeting`, `isConfirm`, `isPeriodFragment`, `isGeoOnlyFragment`, `isFollowUp`
   - `lastMeaningful`, `prevUiMeta`, `conversationTopic`
   - `wasKnowledgeMode`, `isProceduralFaq`, `isAltSource`, `askingDiffType`, `isComparison`
4. **Query merge logic** — determines `effectiveQuery` based on context:
   - Procedural FAQ → use raw query
   - Alternative source request → extract data subject from last meaningful
   - Comparison follow-up → merge conversationTopic + current query
   - Different data type → merge conversationTopic + current query
   - Geo-only fragment → merge conversationTopic + current query
   - Confirmation → reuse lastMeaningful
   - Period/follow-up fragment → merge lastMeaningful + current
   - No substantive keywords → merge conversationTopic + current
   - Default: use raw clipped query

### Calls:
| Type | Details |
|------|---------|
| **LLM** | NO |
| **Embedding** | NO |
| **External API** | NO |
| **Database** | YES — `ChatMessage.findAll()` (up to 50 history messages) |

### SSE events sent: None

### Writes to ctx:
- `ctx.historyArray` — conversation history (JSON array)
- `ctx.memoryContext` — persistent memory context string (or null)
- `ctx.isGreeting` — boolean
- `ctx.isConfirm` — boolean
- `ctx.effectiveQuery` — merged/resolved query text
- `ctx.prevUiMeta` — previous assistant's malika_ui metadata
- `ctx.conversationTopic` — detected topic string
- `ctx._wasKnowledgeMode` — boolean (previous turn was knowledge mode)
- `ctx._shouldPreferPrevCandidates` — boolean (use previous candidates as fallback)
- `ctx._askingDiffType` — boolean

### Dependencies: Stage 1 (needs `ctx.threadId`, `ctx.userMessage`)
### Can be parallelized: NO (must complete before normalization)
### Can be a tool: NO (context resolution logic)
### If skipped: No query merging → follow-up questions miss context → "2024" alone won't get merged with topic

---

## Stage 3 + 3b: stageNormalize + stageDnaPreEnrich

**Lines (orchestrator)**: 617–693  
**Lines (stageNormalize)**: 1405–1440  
**Lines (stageDnaPreEnrich)**: 2095–2195  
**Timing keys**: `timings.normalize`, `timings.dnaLookup`

### Execution: **PARALLEL** via `Promise.all()`

### Stage 3: stageNormalize
1. Light normalize (abbreviation expansion, typo fix): `queryNormalizerService.lightNormalize()`
2. Year inference: `yearInferenceService.inferYear(query, { preferLatest: true })`
3. Geo inference: `geoInferenceService.inferGeoFilter(query)`
4. Stores normalized query

### Stage 3b: stageDnaPreEnrich
1. Extracts best DNA search term via `_extractDnaPrimaryTerm()` (lines 2346–2429)
   - Priority: uppercase abbreviation → statistical keyword → longest meaningful word
2. **Phase 1 (instant cache check)**:
   - Calls `dna.getCachedSmart()` — checks in-memory cache
   - If miss: tries normalized form via `_normalizeToCachedTerm()` (e.g., "miskin" → "kemiskinan")
   - If cache hit: builds `dnaContext` block, `dnaEnrichedQuery` with official BPS names
3. **Phase 2 (background fetch on cache miss)**:
   - Fires `dna.searchSmart()` as background promise (NOT blocking)
   - Stores promise as `ctx._dnaBackgroundPromise` (awaited later before Stage 7)

### Calls:
| Type | Stage 3 | Stage 3b |
|------|---------|----------|
| **LLM** | NO | NO |
| **Embedding** | NO | NO |
| **External API** | NO | YES (conditional) — DNA API `searchSmart()` calls MSIND+MSKEG+MSVAR (background, ~15-17s cold) |
| **Database** | NO | NO (cache-first) |

### SSE events sent (orchestrator, lines 618–693):
- `status` — `{ message: 'Mengenali topik...', stage: 'normalize' }`
- `status_detail` — `{ stage: 'normalize', detail: 'Topik: X · Wilayah: Y · Periode: Z' }`
- `status` — `{ message: 'Mengumpulkan metadata…', stage: 'dna' }`
- `status_detail` — `{ stage: 'dna', detail: '... → N variabel, M indikator' }`
- `thinking` (3 items):
  - `{ step: 'query', icon: '📝', label: 'Memahami pertanyaan', ... }`
  - `{ step: 'context', icon: '🔍', label: 'Konteks terdeteksi', ... }` (conditional)
  - `{ step: 'dna', icon: '🧬', label: 'N metadata DNA ditemukan', ... }` (conditional)

### Writes to ctx:
**stageNormalize**:
- `ctx.yearInference` — `{ year, source, isInferred }`
- `ctx.geoInference` — `{ hasGeo, geoFilter, geoReferences }`
- `ctx.normalizedQuery` — after abbreviation expansion + year/geo normalization

**stageDnaPreEnrich**:
- `ctx.dnaContext` — formatted DNA context block for system prompt (or null)
- `ctx.dnaEnrichedQuery` — query + official BPS names (or null)
- `ctx.dnaRawResults` — raw DNA API results
- `ctx._dnaBackgroundPromise` — pending promise if cache miss
- `ctx._dnaSearchTerm` — extracted search term

### Dependencies: Stage 2 (needs `ctx.effectiveQuery`)
### Can be parallelized: YES — already runs in parallel (3 + 3b)
### If skipped:
- **Normalize**: No year/geo inference → year/geo not extracted → preview may fetch wrong period
- **DNA**: No metadata enrichment → intent search slightly less accurate, no DNA in LLM prompt

---

## Stage 4 + 6a: stageIntent + stageKnowledgeSearch

**Lines (orchestrator)**: 695–759  
**Lines (stageIntent)**: 1449–1545  
**Lines (stageKnowledgeSearch)**: 1989–2090  
**Timing keys**: `timings.intent`, `timings.knowledgeSearch`, `timings.intentAndKnowledge`

### Execution: **PARALLEL** via `Promise.allSettled()`

### Stage 4: stageIntent
1. **Gate hint check**: If `ctx.gate.skipIntent` → skip entirely, `ctx.candidates = []`
2. **Gate fast-path**: If gate provided `fastPathIds` → load from `DataSource.findAll({ id: fastPathIds })` → done
3. **queryFastPath check**: Hardcoded pattern-to-datasource mapping → `DataSource.findAll()` → done
4. **Full intent resolution** (if no fast-path):
   - `resolveSearchIntent({ q: intentQuery })` — internally calls:
     - Synonym expansion (LLM)
     - Embedding search
     - Query Builder (LLM)
   - `buildDatasourceCandidates({ q, qb, limit: 12 })` — internally calls:
     - AI Reranker (LLM, reasoning:low)
5. **Candidate fallback**: If `_shouldPreferPrevCandidates` and no new candidates → use previous candidates
6. **Intent datasource fallback**: If candidates empty but intent resolved a source_id → load from DB

### Stage 6a: stageKnowledgeSearch
1. Skip for greetings
2. Calls `searchKnowledgeBase(kbQuery, 15, { skipRerank })` — internally:
   - Static synonym expansion
   - LLM synonym expansion (LLM)
   - Vector search (embedding)
   - BM25 search
   - Document Judge (LLM, with TTL cache)
   - Deduplication by parent_id
3. `_preferLatestEditions()` — dedup same-series publications, keep latest
4. **enrichKnowledgeWithExtraction** (conditional, if any doc > 50K chars):
   - Indicator-guided extraction (DAFTAR TABEL index → 5K char window)
   - Chunk-window extraction (±20K around matched chunk)
5. **Follow-up KB anchoring**: If previous KB docs completely lost, re-inject them from cache

### Calls:
| Type | stageIntent | stageKnowledgeSearch |
|------|-------------|---------------------|
| **LLM** | YES (multiple, inside resolveSearchIntent): Synonym Expansion, Query Builder, Reranker | YES (multiple, inside searchKnowledgeBase): Synonym Expansion, Document Judge |
| **Embedding** | YES (inside resolveSearchIntent: query embedding for vector search) | YES (inside searchKnowledgeBase: query embedding for vector search) |
| **External API** | NO | NO |
| **Database** | YES — `DataSource.findAll()` (fast-path + fallback) | YES — `loadKnowledgeEmbeddings()` (in-memory cache), KB anchoring |

### SSE events sent (orchestrator, lines 695–759):
- `status` — `{ message: 'Mencari sumber data "topic"…', stage: 'search' }`
- `status_detail` — `{ stage: 'search', detail: 'N sumber data: X · M dokumen RAG', resultStatus }`
- `thinking`:
  - `{ step: 'sources', icon: '📊', label: 'N sumber data relevan', ... }` (conditional)
  - `{ step: 'knowledge', icon: '📚', label: 'N BRS + M Publikasi referensi ditemukan', ... }` (conditional)

### Writes to ctx:
**stageIntent**:
- `ctx.intentResult` — full intent resolution result (datasource, query_builder, params)
- `ctx.candidates` — ranked datasource candidates array
- `ctx._usedFastPath` — boolean

**stageKnowledgeSearch**:
- `ctx.knowledgeContext` — array of KB documents (with content, similarity, category, etc.)

### Dependencies: Stage 3 (needs `ctx.normalizedQuery`, `ctx.dnaEnrichedQuery`, `ctx.effectiveQuery`)
### Can be parallelized: YES — already runs in parallel (4 + 6a)
### If skipped:
- **Intent**: No datasource candidates → no data preview → knowledge-only mode
- **Knowledge**: No RAG documents → LLM has no BRS/Publikasi context → less informed responses

---

## Stage 5 + DNA await: stagePreview

**Lines (orchestrator)**: 762–801  
**Lines (implementation)**: 1671–1979  
**Lines (helpers)**: `_fetchOneEximPreview` (1557–1585), `_fetchEximDual` (1594–1620), `_fetchAllYearsForModal` (1628–1670)  
**Timing key**: `timings.preview`

### Execution: **PARALLEL** with DNA background promise await

### What it does:
1. **Gate hint check**: If `ctx.gate.skipPreview` → return immediately
2. **Determine source ID** from top candidate or intent result
3. **Extract year/geo**: From intent + inference + previous context + GEO_DETECT_REGEX
4. **Clear geo** if user wants all-region comparison (`/semua|seluruh|per kabupaten/`)
5. **EXIM detection**: `isEximQuery` + `inferEximGroupFromQuery` + `extractEximQueryFacets` + `detectEximModeFromQuery` + `extractEximMonth`
6. **Confidence gate**: Skip table if `topScore < 70` and no intent datasource
7. **Period range**: If year range (e.g., "2020-2024") → `getProcessedPreviewForRange()`
8. **Single year fetch**:
   - EXIM → `_fetchEximDual()` (parallel ekspor + impor)
   - Non-EXIM → `getProcessedPreviewFromCache({ sourceId, year, month, geo })`
   - Fallback → `findNearestAvailablePeriod()` then re-fetch
9. **No year**: Discover latest via `findNearestAvailablePeriod(null)` then fetch
10. **Secondary datasource**: If 2nd candidate score ≥ 75 and different category → fetch secondary table
11. **All-years modal data**: `_fetchAllYearsForModal()` for frontend year-tab UI

### Calls:
| Type | Details |
|------|---------|
| **LLM** | NO |
| **Embedding** | NO |
| **External API** | YES (conditional) — EXIM API via `getEximPreviewFromApi()` |
| **Database** | YES — `getProcessedPreviewFromCache()` (ProcessedCache), `findNearestAvailablePeriod()` (DataPeriod), `DataPeriod.findAll()` (all-years), `getProcessedPreviewForRange()` |

### SSE events sent (orchestrator):
- `status` — `{ message: 'Memuat data "topic" terbaru…', stage: 'preview' }`
- `status_detail` — `{ stage: 'preview', detail: 'Title · N baris (year→fallbackYear) +1 tabel' }`

### Writes to ctx:
- `ctx.dataPreview` — `{ title, columns, total_columns, rows, total_rows, geo, from, periodRange, allRows, allColumns, availableYears, defaultYear, source_id, bps_web_url, ... }`
- `ctx.dataPreviewSecondary` — second table (EXIM dual or multi-source)
- `ctx.periodFallback` — `{ requestedYear, actualYear, direction }`
- `ctx.isEximQuery` — boolean
- `ctx.eximParams` — `{ group, month, facets, mode }`
- `ctx._previewSourceId` — selected source ID

### Dependencies: Stage 4 (needs `ctx.candidates`, `ctx.intentResult`), Stage 3 (needs `ctx.yearInference`, `ctx.geoInference`)
### Can be parallelized: YES — already parallel with DNA background await
### Can be a tool: PARTIALLY — `search_data` + `get_data_preview` tools replicate this
### If skipped: No data table → LLM has no tabular data → knowledge-only responses

---

## Pre-stream Table Relevance Check

**Lines**: 773–818  
**No function name** — inline block in orchestrator

### What it does:
1. If `ctx.dataPreview` exists with a title:
   - Calls `checkTableRelevance()` from `supervisor.service.js`
   - Compares query topic vs table title
   - If **NOT relevant**: nullifies `ctx.dataPreview` and `ctx.dataPreviewSecondary`
   - Saves reference as `ctx._suppressedDataPreview` for post-stream metadata

### Calls:
| Type | Details |
|------|---------|
| **LLM** | NO (rule-based check in `checkTableRelevance`) |
| **Embedding** | NO |
| **External API** | NO |
| **Database** | NO |

### SSE events sent:
- `status_detail` — `{ stage: 'preview', detail: 'Tabel tidak relevan...', resultStatus: 'warn' }` (if suppressed)
- `thinking` — `{ step: 'data', icon: '📋', label: 'N baris data tabel dimuat', ... }` (if relevant and kept)

### Writes to ctx:
- `ctx._suppressedDataPreview` — suppressed preview (if irrelevant)
- `ctx._tableIrrelevantReason` — reason string
- `ctx.dataPreview = null` (if irrelevant)
- `ctx.dataPreviewSecondary = null` (if irrelevant)

### Dependencies: Stage 5 (needs `ctx.dataPreview`)
### Can be parallelized: NO (must complete before model select)
### If skipped: Irrelevant tables pass through to LLM → hallucination risk (LLM mixes query topic with wrong table)

---

## Stage 5.5: Chart Agent

**Lines**: 837–871  
**Timing key**: `timings.chartAgent`

### What it does:
1. **Condition**: `CHART_AGENT_ENABLED && ctx.dataPreview && rows > 1`
2. Calls `generateChartConfig(ctx)` — **LLM call** (fire-and-forget promise)
3. Stores result as `ctx._chartConfig` on success
4. Promise stored as `ctx._chartAgentPromise` (awaited later when building uiMeta)

### Calls:
| Type | Details |
|------|---------|
| **LLM** | YES — Chart Agent (model: env `CHART_AGENT_MODEL` or gpt-4.1) |
| **Embedding** | NO |
| **External API** | NO |
| **Database** | NO |

### SSE events sent:
- `status_detail` — `{ stage: 'preview', detail: 'Memilih visualisasi terbaik…' }`
- `thinking` — `{ step: 'chart', icon: '📈', label: 'Grafik {type} dipilih', ... }` (on success)

### Writes to ctx:
- `ctx._chartConfig` — `{ should_render, chart_type, chart_title, ... }`
- `ctx._chartAgentPromise` — the pending promise

### Dependencies: Stage 5 (needs `ctx.dataPreview`)
### Can be parallelized: YES — already fire-and-forget, doesn't block pipeline
### Can be a tool: YES — could be an optional visualization tool
### If skipped: No chart config → frontend shows table only, no auto-chart

---

## Fallback Notification Block

**Lines**: 874–888

### What it does:
Consolidates multiple fallbacks into a single user notification when:
- Period fallback occurred
- Knowledge mode activated as fallback (no data preview but candidates existed)

### SSE events sent (conditional, only if 2+ fallbacks):
- `status` — `{ message: 'Penyesuaian data…', stage: 'fallback' }`
- `status_detail` — `{ stage: 'fallback', detail: '⚠️ ...' }`

---

## Stage 6b: stageKnowledgeMode

**Lines (orchestrator)**: 889–890  
**Lines (implementation)**: 2433–2488  
**Timing key**: `timings.knowledgeMode`

### What it does (SYNCHRONOUS):
1. **Gate hint**: If `ctx.gate.forceKnowledge` → force knowledge mode, clear preview + candidates
2. **Skip if dataPreview exists** — confirmed data query, never switch to knowledge mode
3. **Knowledge mode activation**: If KB docs found AND query matches knowledge type pattern, OR procedural FAQ
4. **Follow-up retention**: Stay in knowledge mode if previous turn was knowledge + current is confirmation/follow-up
5. When entering knowledge mode: nullifies `ctx.dataPreview`, `ctx.dataPreviewSecondary`, stashes `ctx.candidates` as `ctx._pipelineCandidates`

### Calls:
| Type | Details |
|------|---------|
| **LLM** | NO |
| **Embedding** | NO |
| **External API** | NO |
| **Database** | NO |

### SSE events sent: None

### Writes to ctx:
- `ctx.isKnowledgeMode` — boolean
- `ctx.dataPreview = null` (if knowledge mode)
- `ctx.dataPreviewSecondary = null` (if knowledge mode)
- `ctx.candidates = []` (if knowledge mode)
- `ctx._pipelineCandidates` — stashed original candidates

### Dependencies: Stages 4, 5, 6a (needs `ctx.candidates`, `ctx.dataPreview`, `ctx.knowledgeContext`)
### Can be parallelized: NO (sync decision gate)
### If skipped: Data queries might also get knowledge mode treatment, or vice versa → confused responses

---

## Stage 7: stageModelSelect

**Lines (orchestrator)**: 897–960  
**Lines (implementation)**: 2495–2731  
**Timing key**: `timings.model`

### What it does:
1. **Model routing**: `routeModel()` determines tier (GREETING/SIMPLE/COMPLEX/DEEP) based on:
   - Query patterns (projection, causal → DEEP)
   - Merge bundles, multi-source → COMPLEX
   - Year range, indicator-injected docs → COMPLEX
   - Default → SIMPLE
2. **User model override**: If `ctx.modelOverride` is valid → replace `config.model` in routed tier
3. **Smart Context Sizing** per tier:
   - Limits # of docs (`maxDocs`) and per-doc chars (`perDocChars`)
   - Indicator-extracted docs get 2× budget
   - Chunk-aware truncation: prepends `matchedChunkText` before truncating
4. **Prompt fixes**: `errorLearningService.getPromptFixes(query)`
5. **Tool detection**: Checks if tool use should be enabled
6. **System prompt build**: `svc.systemPrompt({ hasDataPreview, hasCandidates, ... })`
7. **Appends to system prompt**: Tool instructions, DNA context, memory context
8. **Builds brsContext**: Groups knowledge docs into BRS vs Publikasi
9. **Data Reconciler** (conditional):
   - If table + knowledge docs have topic overlap → `reconcileDataSources()` — **LLM call** (gpt-4.1, 45s timeout)
   - Formats reconciliation context for system prompt
10. **Context messages**: `svc.buildContextMessages({ intentResult, candidates, dataPreview, ... })`
11. **Abbreviation expansion**: `expandAbbreviationsInline()` on user content
12. **Final message array**: `[system, ...context, user]`
13. **Budget enforcement**: `trimMessagesToBudget()` with tier-specific budget

### Calls:
| Type | Details |
|------|---------|
| **LLM** | YES (conditional) — Data Reconciler via `reconcileDataSources()` (model: gpt-4.1, 45s timeout, 0 retries) |
| **Embedding** | NO |
| **External API** | NO |
| **Database** | NO |

### SSE events sent (orchestrator, lines 898–960):
- `status` — `{ message: 'Merangkai konteks "topic"…', stage: 'model' }`
- `status_detail` — `{ stage: 'model', detail: 'MALIKA Deep (Mendalam) · DNA: ya · KB: ya' }`
- `thinking`:
  - `{ step: 'reasoning', icon: '🧠', label: 'Menganalisis dengan penalaran mendalam', ... }`
  - `{ step: 'strategy', icon: '{varies}', label: '{analysis strategy}' }`
- `intent` — `{ datasource, candidates, hasPreview, effectiveQuery, periodFallback, modelTier }` (backward compat)

### Writes to ctx:
- `ctx.modelRoute` — `{ tier, config: { model, maxTokens, temperature, ... } }`
- `ctx._smartContext` — `{ tier, maxDocs, perDocChars, totalBudget, docsDropped, charsTrimmed }`
- `ctx.knowledgeContext` — possibly trimmed (docs dropped, content truncated)
- `ctx.reconciliationResult` — reconciler output
- `ctx.openAiMessages` — final `[{ role, content }]` array for LLM
- `ctx._contextTrimmed` — boolean
- `ctx._contextOriginalChars`, `ctx._contextTrimmedChars`

### Dependencies: All previous stages
### Can be parallelized: NO (needs all prior context)
### If skipped: No model selection, no messages built → streaming impossible

---

## Stage 7b: Orchestrator

**Lines (orchestrator)**: 966–1000  
**Timing key**: `timings.orchestrator`

### What it does:
1. **Activation check**: `shouldActivateOrchestrator(ctx)` — only for COMPLEX/DEEP tier queries
2. Calls `orchestrate(ctx)` — decomposes query into 2-4 sub-tasks → parallel worker agents
3. Injects pre-analyzed findings into system prompt
4. Re-runs `trimMessagesToBudget()` after injection

### Calls:
| Type | Details |
|------|---------|
| **LLM** | YES — Orchestrator decomposition (gpt-4.1 hardcoded) + parallel worker agents (gpt-4.1) |
| **Embedding** | NO |
| **External API** | NO |
| **Database** | NO |

### SSE events sent:
- `status` — `{ message: 'Menganalisis secara mendalam…', stage: 'orchestrator' }`
- `status_detail` — `{ stage: 'orchestrator', detail: 'N sub-analisis · M selesai · Xms' }`
- `thinking` (per sub-question): `{ step: 'orchestrator-sub', icon: '{type}', label: '{question}', tags }`

### Writes to ctx:
- `ctx._orchestratorUsed` — boolean
- `ctx._orchestratorTasks` — task count
- `ctx._orchestratorWorkers` — worker results count
- `ctx._orchestratorLatencyMs`
- `ctx.openAiMessages` — modified (pre-analysis injected, possibly re-trimmed)
- `ctx._contextTrimmed` — updated if re-trimming occurred

### Dependencies: Stage 7 (needs `ctx.openAiMessages`, `ctx.modelRoute`)
### Can be parallelized: NO (modifies openAiMessages before streaming)
### Can be a tool: YES — could be decomposition tool
### If skipped: Complex analytical queries get single-pass analysis instead of multi-agent decomposition

---

## Stage 8: stageStream

**Lines (orchestrator)**: 1003–1026  
**Lines (implementation)**: 2738–3405  
**Timing key**: `timings.stream`

### What it does (LARGE — ~670 lines):

#### A. Setup (lines 2738–2810)
1. Gets API key
2. Builds `modelParams` from tier config
3. Creates AI SDK OpenAI provider with Copilot proxy baseURL
4. Builds `streamOpts` with model, messages, maxTokens, abort signal
5. Tool use setup: If `CHAT_TOOL_USE !== 'false'` and non-reasoning → `tu.buildTools(ctx, svc)` + `maxSteps`
6. Reasoning model config: Sets `providerOptions.openai.reasoningEffort`
7. Stream smoothing: `smoothStream({ chunking: 'word' })` for non-reasoning models

#### B. Stream Consumption (lines 2850–2975)
1. Calls `streamText(streamOpts)` — **MAIN LLM CALL**
2. Iterates `result.fullStream`:
   - `reasoning` → accumulates `reasoningText`, sends `thinking` SSE
   - `text-delta` → **BUFFERED** (accumulates in `fullText`, NOT sent incrementally)
   - `tool-call` → sends `status` + `tool_call` SSE events
   - `tool-result` → sends `tool_result` SSE event
   - `error` → sends `error` SSE (except TypeValidationError)
   - `finish` → captures `usage` + `finishReason`
3. Error recovery: Handles AbortError, TypeValidationError from Copilot proxy
4. Recovers usage/finishReason from result promises if not captured by onFinish

#### C. Auto-continuation (lines 3001–3063)
1. If `finishReason === 'length'`:
   - Appends `{ role: 'assistant', content: fullText }` and continuation prompt
   - Runs second `streamText()` call
   - Appends continuation text to fullText

#### D. Cost tracking (lines 3065–3091)
1. Records model, tokens, cache hit rate via `costTracker.record()`

#### E. Tool fallback (lines 3096–3101)
1. If no text produced after tool calls → sends fallback message

#### F. Post-stream UI metadata (lines 3103–3219)
1. Injects `bps_web_url` into dataPreview
2. **Awaits chartAgentPromise** (from Stage 5.5)
3. Builds `uiMeta` via `svc.buildUIMetadata()`
4. Injects: table allRows/allColumns/availableYears, table2, knowledgeCandidates, externalLinks, dnaMetadata, thinkingItems
5. Builds `uiMeta.metadata` with: model, tier, reasoning, tokens, finishReason, pipeline_ms, gate, orchestrator, smartContext

#### G. Parallel Supervisor + Suggestions (lines 3220–3310)
1. **Suggestions** (parallel): `sendLLMSuggestionsAsync(ctx, fullText)` — **LLM call** (2s max wait)
2. **Supervisor** (sequential): `reviewResponse(ctx, fullText, uiMeta, key)` — **LLM call**
   - May modify `fullText` (append disclaimers)
   - May modify `uiMeta` (suppress data display)
   - Gate hint: skips for greetings (`ctx.gate.skipSupervisor`)

#### H. Send final content (lines 3312–3333)
1. Sends composed `status_detail` with supervisor result
2. **Sends `text` event with FULL final text** (buffered, post-supervisor)
3. Sends `malika_ui` event
4. **Awaits suggestionsPromise** before done event

#### I. Save & cleanup (lines 3339–3405)
1. Saves assistant message to DB: `ChatMessage.create()`
2. Updates thread timestamp: `ctx.thread.update()`
3. **Fire-and-forget background tasks**:
   - Session compaction: `maybeCompactThread()` — may use **LLM** for summarization
   - Persistent memory extraction: `extractAndStoreMemories()` — may use **LLM**

### Calls:
| Type | Details |
|------|---------|
| **LLM** | YES (4-6 separate calls): Main stream, Auto-continuation (if truncated), Supervisor, Suggestions, Session compaction (bg), Memory extraction (bg) |
| **Embedding** | NO |
| **External API** | YES (conditional) — web search for external indicators |
| **Database** | YES — `ChatMessage.create()` (save assistant), `thread.update()` |

### SSE events sent:
- `status` — `{ message: 'Merangkum data...', stage: 'generate' }` (start)
- `status_detail` — `{ stage: 'generate', detail: 'N karakter · I→O token · cache: C · review: Xms' }` (end)
- `status` — `{ message: 'Berpikir & menganalisis…', stage: 'thinking' }` (reasoning models)
- `status` — `{ message: 'Menyusun jawaban…', stage: 'composing' }` (first text delta)
- `thinking` — `{ content: reasoning_text }` (reasoning model incremental)
- `status` → tool_call status messages
- `tool_call` — `{ toolName, callId, args, message }`
- `tool_result` — `{ toolName, callId, summary, found, cached, elapsedMs }`
- `error` — on stream errors
- `status_detail` — `{ stage: 'composing', detail: 'Supervisor: reviewed · N karakter final' }`
- `text` — `{ content: FULL_FINAL_TEXT }` (single event, buffered)
- `malika_ui` — full UI metadata object
- `suggestions_update` — `{ suggestions: [...] }` (from LLM suggestions)

### Writes to ctx:
- `ctx._streamFullText` — full response text
- `ctx._usage` — token usage
- `ctx._finishReason` — stop/length/error
- `ctx._continuationFinishReason` — if auto-continued
- `ctx._chartConfig` — awaited from chart agent
- `ctx._donePayload` — `{ full_text, metadata }`

### Dependencies: Stage 7 (needs `ctx.openAiMessages`, `ctx.modelRoute`)
### Can be parallelized: NO (core generation stage)
### If skipped: No response generated at all

---

## Stage 9+10: Done Event

**Lines**: 1024–1027  
**Part of**: Orchestrator-level code after stageStream returns

### What it does:
```javascript
if (ctx._donePayload && ctx.sse?.isClientConnected?.()) {
  ctx.sse.sendEvent('done', ctx._donePayload);
}
```

### SSE events sent:
- `done` — `{ full_text, metadata }` — FINAL event that triggers frontend onDone

### Dependencies: Stage 8 (needs `ctx._donePayload`)
### Note: `suggestions_update` was already sent BEFORE this (inside stageStream)

---

## Error Handling (catch block)

**Lines**: 1029–1036

```javascript
catch (error) {
  logger.error({ threadId, error: error.message, timings }, 'Pipeline error');
  ctx.sse.sendEvent('error', { message: error.message || 'Unknown error' });
}
```

## Finally Block

**Lines**: 1037–1047

1. `clearTimeout(pipelineTimer)` — cancels 10-min safety net
2. `ctx.sse.end()` — closes SSE connection
3. Schedules minor GC: `global.gc({ type: 'minor' })` via `setImmediate`

---

## Helper Functions

### Top-level helpers defined in pipeline.service.js:

| Function | Lines | Purpose |
|----------|-------|---------|
| `_suppressTypeValidationErrors()` | 30–39 | Wraps `console.error` to suppress AI SDK TypeValidationError noise |
| `_restoreConsoleError()` | 40–42 | Restores original `console.error` |
| `_buildServiceRef()` | 106–142 | Builds service reference bag from direct imports |
| `selectRelevantColumns(allCols, query, maxCols=24)` | 155–197 | Smart column selection: keeps ID cols + query-relevant cols, scored by token matching |
| `trimMessagesToBudget(messages, budget)` | 267–404 | Progressive message trimming: (1) truncate large knowledge messages, (2) remove entirely, (3) drop old history |
| `getPersistentMemory()` | 412–415 | Lazy-loads persistentMemory.service |
| `getSessionCompaction()` | 416–419 | Lazy-loads sessionCompaction.service |
| `getToolUse()` | 420–423 | Lazy-loads toolUse.service |
| `getLLMSuggestions()` | 424–427 | Lazy-loads llmSuggestions.service |
| `getDnaService()` | 428–432 | Lazy-loads dnaNucleus.service |
| `getTopicLabel(ctx)` | 440–492 | Extracts clean topic label for status messages (strips prefixes, geo, years, cleans punctuation) |
| `_fetchOneEximPreview(svc, opts)` | 1557–1585 | Fetches single EXIM preview from API, builds title/columns/rows |
| `_fetchEximDual(ctx, svc, opts)` | 1594–1620 | Fetches both ekspor+impor EXIM previews in parallel |
| `_fetchAllYearsForModal(ctx, svc, ...)` | 1628–1670 | Fetches all-years data for frontend year-tab UI from DataPeriod |
| `_preferLatestEditions(docs)` | 2310–2345 | Deduplicates same-series publications, keeps latest edition |
| `_buildDnaEnrichmentTerms(results, term, query)` | 2207–2266 | Extracts enrichment terms from DNA results (official names, aliases) |
| `_normalizeToCachedTerm(term)` | 2272–2299 | Maps common term variations to canonical DNA cache form |
| `_isStopword(w)` | 2304–2318 | Checks if word is a generic stopword |
| `_extractDnaPrimaryTerm(query)` | 2346–2429 | Extracts best DNA search term: abbreviation → stat keyword → longest meaningful word |
| `_sanitizeToolArgs(args)` | 3412–3421 | Truncates long tool args for frontend display |
| `_summarizeToolResult(toolName, result)` | 3427–3449 | Builds human-readable tool result summary per tool type |

---

## All SSE Events

### Event Types (in order of emission):

| # | Event | Sender | When |
|---|-------|--------|------|
| 1 | `user_saved` | stageValidate | After saving user message |
| 2 | `thread_updated` | stageValidate | If thread title auto-updated |
| 3 | `text` | stageGate | Early-exit routes (greeting/chitchat/decline) |
| 4 | `malika_ui` | stageGate | Early-exit routes |
| 5 | `suggestions_update` | stageGate | Early-exit routes (static suggestions) |
| 6 | `done` | stageGate | Early-exit routes |
| 7 | `status` | orchestrator | Before each major stage group |
| 8 | `status_detail` | orchestrator | After each stage with details |
| 9 | `thinking` | emitThinkingItem / stageStream | Progressive thinking timeline items |
| 10 | `intent` | orchestrator | After stageModelSelect (backward compat) |
| 11 | `tool_call` | stageStream | When LLM invokes a tool |
| 12 | `tool_result` | stageStream | When tool returns result |
| 13 | `text` | stageStream | **Final buffered text** (single event, post-supervisor) |
| 14 | `malika_ui` | stageStream | Full UI metadata |
| 15 | `suggestions_update` | stageStream (LLM suggestions) | Follow-up suggestions |
| 16 | `done` | runPipeline | Final signal `{ full_text, metadata }` |
| 17 | `error` | any stage | On errors |

### Status `stage` values:
`normalize`, `dna`, `search`, `preview`, `fallback`, `model`, `orchestrator`, `generate`, `thinking`, `composing`, `tool_{name}`

---

## Complete Stage Summary Table

| # | Stage | Lines | Async? | LLM? | Embedding? | Ext API? | DB? | Parallelized With | Timing Key | Can Skip? | Breaks if Skipped |
|---|-------|-------|--------|------|------------|----------|-----|-------------------|------------|-----------|-------------------|
| 1 | **stageValidate** | 1057–1098 | yes | NO | NO | NO | YES (ChatThread, ChatMessage) | — | `validate` | NO | Everything |
| 0 | **stageGate** | 1108–1310 | yes | **YES** (Gate Agent) | NO | NO | YES (ChatMessage×10) | — | `gate` | YES | No fast-path, all queries hit full pipeline |
| — | *gate early-exit* | 606 | — | — | — | — | — | — | — | — | — |
| 2 | **stageContext** | 1318–1402 | yes | NO | NO | NO | YES (ChatMessage×50) | — | `context` | NO | No query merging, follow-ups broken |
| 3 | **stageNormalize** | 1405–1440 | yes | NO | NO | NO | NO | **3b (parallel)** | `normalize` | YES | No year/geo extraction |
| 3b | **stageDnaPreEnrich** | 2095–2195 | yes | NO | NO | YES (DNA API, bg) | NO | **3 (parallel)** | `dnaLookup` | YES | No DNA enrichment in intent |
| 4 | **stageIntent** | 1449–1545 | yes | **YES** (Synonym, QB, Reranker) | **YES** | NO | YES (DataSource) | **6a (parallel)** | `intent` | YES | No datasource candidates |
| 6a | **stageKnowledgeSearch** | 1989–2090 | yes | **YES** (Synonym, DocJudge) | **YES** | NO | NO (in-memory cache) | **4 (parallel)** | `knowledgeSearch` | YES | No RAG documents |
| 5 | **stagePreview** | 1671–1979 | yes | NO | NO | YES (EXIM API) | YES (ProcessedCache, DataPeriod) | **DNA bg await** | `preview` | YES | No data table |
| — | *table relevance check* | 773–818 | no | NO | NO | NO | NO | — | — | YES | Irrelevant tables → hallucination |
| 5.5 | **Chart Agent** | 837–871 | yes (f&f) | **YES** (Chart Agent) | NO | NO | NO | **non-blocking** | `chartAgent` | YES | No auto-chart |
| 6b | **stageKnowledgeMode** | 2433–2488 | no (sync) | NO | NO | NO | NO | — | `knowledgeMode` | YES | Wrong mode selection |
| 7 | **stageModelSelect** | 2495–2731 | yes | **YES** (Reconciler, conditional) | NO | NO | NO | — | `model` | NO | No messages built → no streaming |
| 7b | **Orchestrator** | 966–1000 | yes | **YES** (Orchestrator + workers) | NO | NO | NO | — | `orchestrator` | YES | No multi-agent decomposition |
| 8 | **stageStream** | 2738–3405 | yes | **YES** (Main LLM, Supervisor, Suggestions, +bg) | NO | YES (web search) | YES (ChatMessage save) | — | `stream` | NO | No response at all |
| 9-10 | **Done event** | 1024–1027 | no | NO | NO | NO | NO | — | — | NO | Frontend never receives completion |

---

## LLM Calls Summary (In Execution Order)

| # | Agent | Stage | Model | Required? | Blocking? |
|---|-------|-------|-------|-----------|-----------|
| 1 | Gate Agent | 0 | `GATE_LLM_MODEL` (gpt-5-mini) | Yes | Yes |
| 2 | Synonym Expansion (Intent) | 4 | `OPENAI_MODEL_SYNONYM` (gpt-5-mini) | Yes (in full intent) | Yes |
| 3 | Query Builder | 4 | `OPENAI_QUERY_BUILDER_MODEL` (gpt-5-mini) | Yes (in full intent) | Yes |
| 4 | Reranker | 4 | `OPENAI_MODEL_RERANKER` (gpt-5-mini, reasoning:low) | Yes (in full intent) | Yes |
| 5 | Synonym Expansion (KB) | 6a | `OPENAI_MODEL_SYNONYM` (gpt-5-mini) | Yes | Yes |
| 6 | Document Judge | 6a | gpt-4.1 | Yes | Yes |
| 7 | Chart Agent | 5.5 | `CHART_AGENT_MODEL` (gpt-4.1) | No | No (fire-and-forget) |
| 8 | Data Reconciler | 7 | gpt-4.1 | No (conditional) | Yes |
| 9 | Orchestrator + Workers | 7b | gpt-4.1 | No (conditional) | Yes |
| 10 | **Main LLM Stream** | 8 | Tier config (gpt-5-mini/gpt-4.1) | **YES** | Yes |
| 11 | Auto-continuation | 8 | Same as main | No (if truncated) | Yes |
| 12 | Supervisor | 8 | `SUPERVISOR_LLM_MODEL` (gpt-5-mini) | Yes | Yes |
| 13 | LLM Suggestions | 8 | `OPENAI_MODEL_SUGGESTIONS` (gpt-4.1) | No | Parallel (2s cap) |
| 14 | Session Compaction | 8 (bg) | `OPENAI_MODEL_COMPACTION` (gpt-5-mini) | No | No (fire-and-forget) |
| 15 | Memory Extraction | 8 (bg) | varies | No | No (fire-and-forget) |

**Total LLM calls per typical data query**: 8-10 (Gate + Synonym×2 + QB + Reranker + DocJudge + Main + Supervisor + Suggestions)  
**Total LLM calls per complex analytical query**: 12-15 (adds Reconciler + Orchestrator + Workers + Chart + Continuation)

---

## Context Object (`ctx`) — Complete Field Map

### Set by initialization:
| Field | Type | Set By |
|-------|------|--------|
| `res` | Express Response | init |
| `threadId` | number | init |
| `userMessage` | string | init |
| `ownerId` | string | init |
| `sse` | SSEHandler | init / stageValidate |
| `timings` | object | init |
| `pipelineStartTime` | number | init |
| `modelOverride` | string\|null | init |
| `_thinkingItems` | array | init |

### Set by stages:
| Field | Type | Set By Stage |
|-------|------|--------------|
| `thread` | ChatThread | 1 |
| `userMsg` | ChatMessage | 1 |
| `gate` | GateResult | 0 |
| `isGreeting` | boolean | 0, 2 |
| `_gateHandled` | boolean | 0 |
| `historyArray` | array | 2 |
| `memoryContext` | string\|null | 2 |
| `isConfirm` | boolean | 2 |
| `effectiveQuery` | string | 2 |
| `prevUiMeta` | object\|null | 2 |
| `conversationTopic` | string\|null | 2 |
| `_wasKnowledgeMode` | boolean | 2 |
| `_shouldPreferPrevCandidates` | boolean | 2 |
| `_askingDiffType` | boolean | 2 |
| `yearInference` | object\|null | 3 |
| `geoInference` | object\|null | 3 |
| `normalizedQuery` | string | 3 |
| `dnaContext` | string\|null | 3b |
| `dnaEnrichedQuery` | string\|null | 3b |
| `dnaRawResults` | object\|null | 3b |
| `_dnaBackgroundPromise` | Promise\|null | 3b |
| `_dnaSearchTerm` | string\|null | 3b |
| `dnaResults` | array | 3b |
| `intentResult` | object\|null | 4 |
| `candidates` | array | 4 |
| `_usedFastPath` | boolean | 4 |
| `knowledgeContext` | array | 6a |
| `dataPreview` | object\|null | 5 |
| `dataPreviewSecondary` | object\|null | 5 |
| `periodFallback` | object\|null | 5 |
| `isEximQuery` | boolean | 5 |
| `eximParams` | object\|null | 5 |
| `_previewSourceId` | number\|null | 5 |
| `_suppressedDataPreview` | object\|null | pre-stream check |
| `_tableIrrelevantReason` | string\|null | pre-stream check |
| `_chartConfig` | object\|null | 5.5 |
| `_chartAgentPromise` | Promise\|null | 5.5 |
| `isKnowledgeMode` | boolean | 6b |
| `_pipelineCandidates` | array\|null | 6b |
| `modelRoute` | object | 7 |
| `_smartContext` | object | 7 |
| `reconciliationResult` | object\|null | 7 |
| `openAiMessages` | array | 7 |
| `_contextTrimmed` | boolean | 7, 7b |
| `_orchestratorUsed` | boolean | 7b |
| `_orchestratorTasks` | number | 7b |
| `_orchestratorWorkers` | number | 7b |
| `_orchestratorLatencyMs` | number | 7b |
| `_streamFullText` | string | 8 |
| `_usage` | object\|null | 8 |
| `_finishReason` | string | 8 |
| `_continuationFinishReason` | string\|null | 8 |
| `_donePayload` | object | 8 |

---

## Special Conditions / Branching

### EXIM Queries
- Detected in stagePreview when `selectedSourceType === 'exim'` or `checkIsExim(effectiveQuery)`
- Dual-fetch: parallel ekspor + impor via `_fetchEximDual()`
- Grouped queries: infers HS2/CTR/POD group
- Year discovery: uses `findNearestAvailablePeriod()` for latest EXIM year
- Sets `ctx.eximParams` for UI metadata

### Greeting / Chitchat / Decline (Gate Early-Exit)
- Handled entirely in stageGate
- Template responses, no LLM generation
- Static suggestions (5 examples)
- Pipeline returns immediately after gate

### Knowledge-Only Mode
- Triggered in stageKnowledgeMode when:
  - Gate forces it (`forceKnowledge`)
  - No data preview and KB docs match knowledge query pattern
  - Previous turn was knowledge mode + current is follow-up
- Clears `dataPreview`, `candidates`; keeps `knowledgeContext`

### Follow-Up Context
- `_shouldPreferPrevCandidates` = true when:
  - Comparison follow-up with topic
  - Confirmation of previous query
  - Period/follow-up fragment with lastMeaningful
  - No substantive keywords in current message
- Causes: candidate locking, KB anchoring, year inheritance from previous context

### Multi-Source Overlap (Reconciler)
- Activated when table data + KB docs have topic overlap
- Max 5 overlapping docs (BRS prioritized)
- gpt-4.1, 45s timeout, 0 retries

### Orchestrator (Complex Queries)
- Activated for COMPLEX/DEEP tier queries only
- Decomposes into 2-4 sub-tasks → parallel workers → inject findings
- Re-trims budget after injection

### Auto-Continuation
- If `finishReason === 'length'` (output truncated)
- Appends continuation prompt and runs second streamText()
- Merges continuation into fullText

### Tool Use
- Enabled when `CHAT_TOOL_USE !== 'false'` AND non-reasoning model
- Tools: search_data, get_data_preview, search_knowledge, search_document_table, get_exim_data, recall_memory
- Max steps configured via `tu.MAX_TOOL_STEPS`

---

## Exported Functions

```javascript
module.exports = {
  runPipeline,
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
```

All stage functions are exported for unit testing.

---

## Execution Timeline (Typical Data Query)

```
T=0ms     stageValidate          [DB: thread + save message]
T=50ms    stageGate              [LLM: Gate Agent ~200-800ms]
T=800ms   ─── gate check ───
T=800ms   stageContext           [DB: history 50 msgs]
T=900ms   ┌─ stageNormalize     [sync: abbreviation, year, geo]
          └─ stageDnaPreEnrich   [cache check or bg API fire]
T=950ms   ┌─ stageIntent        [LLM×3: synonym+QB+reranker ~3-7s]
          └─ stageKnowledgeSearch [LLM×2: synonym+docjudge + embedding ~2-5s]
T=6000ms  ┌─ stagePreview       [DB: ProcessedCache/EXIM API ~200-1500ms]
          └─ DNA bg await        [awaits if still running]
T=7000ms  table relevance check  [sync, ~0ms]
T=7000ms  Chart Agent (f&f)      [LLM async, ~500-2000ms]
T=7050ms  stageKnowledgeMode     [sync, ~0ms]
T=7050ms  stageModelSelect       [LLM conditional: Reconciler ~4-35s]
T=8000ms  Orchestrator           [LLM conditional: ~3-10s]
T=8000ms  stageStream            [LLM main: ~2-15s streaming]
T=15000ms Supervisor + Suggestions (parallel) [LLM×2: ~500-2000ms]
T=17000ms text + malika_ui + done events
T=17000ms ─── pipeline end ───
          (bg: compaction, memory extraction)
```

**Typical latency**: 10-20s (data query), 3-8s (greeting/chitchat), 20-40s (complex analytical)
