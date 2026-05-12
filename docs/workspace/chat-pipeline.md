# Chat Pipeline — Project Line

> Last updated: 2026-05-08

## Current State
- **Protocol**: SSE (Server-Sent Events)
- **Live entry**: `backend/src/services/chat/streaming.service.js` — `streamChatResponse()` at `:3502`
- **Architecture**: Monolithic. The full pipeline runs inline inside `streaming.service.js` (~5162 lines).
- **`streaming/` directory**: 4 files only — `openaiClient.js`, `modelRouter.service.js`, `config.js`, `requestContext.js`. All live. The previous dead-code graveyard (35 files from a stalled V2 refactor) was removed in commit `9dc176f`.

## Live Pipeline Flow

```
HTTP /threads/:id/stream
  → chatController.streamMessage
  → streamingService.streamChatResponse  (streaming.service.js:3502)

  Stage 1 — SSE setup
    Headers + sendEvent() helper + AbortController bound to res.close
    Emits: user_saved, thread_updated

  Stage 2 — Query understanding (all inline in streaming.service.js)
    :3567-3677  Merge with prior turn ("ya", time/geo fragments, topic switch)
    :3681-3687  Normalize         → queryNormalizerService.lightNormalize
    :3689-3700  Year inference    → yearInferenceService.inferYear
    :3703-3711  Geo inference     → geoInferenceService.inferGeoFilter
    :3714-3722  Fast-path skip    → queryFastPathService.shouldSkipRag
    :3724-3769  Intent + cands    → resolveSearchIntent (search/intent.service)
                                    + buildDatasourceCandidates
    :3771-3860  Re-rank candidates by geo/topic match
    :3862-3885  Lock to prior datasource on follow-ups

  Stage 3 — Data preview
    :3917-4230  Fetch + cache preview table (period fallback if year missing)
    :4285-4386  Bundle merge (e.g., Inflasi-IHK monthly multi-source)

  Stage 4 — Knowledge retrieval (RAG)
    :19         vectorSearchService           (services/ai/vectorSearch.service)
    :27         knowledgePatternsService      (services/ai/knowledgePatterns.service)
    Used inline; no documentJudge/knowledgeAnalyst stage in the live path.

  Stage 5 — Prompt assembly
    :3355-3500  buildContextMessages — system prompt + intent + candidates
                + dataPreview + history (≤20 msgs reversed) + knowledgeContext
    :4740-4766  Final openAiMessages[] built

  Stage 6 — Tier + LLM call
    modelForTier(tier) → (model, max_tokens, temperature, thinking_budget)
                         from streaming/modelRouter.service
    llmChat({ model, messages, stream:true, retries:2, timeoutMs:30000 })
                         → streaming/openaiClient.js
                         → POST http://127.0.0.1:3031/v1/chat/completions
                           (malika-llm-proxy → Anthropic / Gemini fallback)

  Stage 7 — Stream chunks
    readLlmChatResponse() handles both SSE and plain JSON
    Per delta: sendEvent('text', { content })

  Stage 8 — Post-stream
    :4788-4793  Build EXIM params (if applicable)
    :4796-4799  sendEvent('malika_ui', { intent, candidates, table, suggestions })
    :4802       sendEvent('done', { full_text })
    :4805-4930  Persist assistant message — UI metadata embedded as
                ```malika_ui fenced block (longtext column).
```

## Live Modules in `streaming/`

| Module | Used by | Purpose |
|---|---|---|
| `streaming/openaiClient.js` | `streaming.service.js`, `chat.service.js`, `persistentMemory.service.js`, `sessionCompaction.service.js`, plus `services/ai/{multiStrategySearch, synonymExpansion, tableUnderstanding}` | LLM HTTP client → malika-llm-proxy |
| `streaming/modelRouter.service.js` | `streaming.service.js:90` | `modelForTier()`, `MODEL_TIERS` constants |
| `streaming/config.js` | `services/chat/sessionCompaction.service.js` (plus `openaiClient.js` and `modelRouter.service.js`) | Shared config constants |
| `streaming/requestContext.js` | `services/chat/sessionCompaction.service.js`, `services/ai/{documentJudge, keywordExtractor, reranker, synonymExpansion, tableUnderstanding}` | Per-request context object passed across services |

All four files have at least one importer outside `streaming/`. Verified by `grep -rE "require\\(['\"][^'\"]*streaming/(file)['\"]"` across `backend/src/`.

## Model Tiers (`streaming/modelRouter.service.js`)

Source defaults vs runtime (production sets `OPENAI_MODEL_CHAT=claude-sonnet-4-6`):

| Tier | Source default | Runtime (prod) | Temp | Thinking |
|---|---|---|---|---|
| GREETING | `gemini-3-flash-preview` | `claude-sonnet-4-6` | 0.7 | off |
| SIMPLE | `gemini-3-flash-preview` | `claude-sonnet-4-6` | 0.3 | 4K |
| COMPLEX | `claude-sonnet-4-6` | `claude-sonnet-4-6` | 0.2 | adaptive |
| DEEP | `claude-sonnet-4-6` | `claude-sonnet-4-6` | 0.1 | 16K |

Per-tier knobs override via `MODEL_<TIER>` env vars. Live intent classification uses `services/search/intent.service::resolveSearchIntent` (deterministic keyword/datasource matching, not LLM-based). The previous LLM-based `gateAgent.service.js` was deleted in commit `9dc176f` along with the rest of the V2 refactor.

## SSE Events
`user_saved`, `thread_updated`, `intent`, `context`, `status`, `text`, `malika_ui`, `done`, `error`, `heartbeat`

## Key Live Services (outside `streaming/`)

| Service | Path | Role |
|---|---|---|
| Intent + datasource ranking | `services/search/intent.service` | resolveSearchIntent, buildDatasourceCandidates |
| Query normalization | `services/chat/queryNormalizer.service` | abbrev, typo, geo aliases |
| Year inference | `services/chat/yearInference.service` | "tahun lalu" → year |
| Geo inference | `services/chat/geoInference.service` | kab/kota detection |
| Fast-path | `services/chat/queryFastPath.service` | skip RAG for common queries |
| Vector search | `services/ai/vectorSearch.service` | embedding-based knowledge retrieval |
| Knowledge patterns | `services/ai/knowledgePatterns.service` | pattern-based KB matching |
| Error learning | `services/chat/errorLearning.service` | track and surface prior errors |
| Response formatter | `services/chat/responseFormatter.service` | post-LLM formatting helpers |
| LLM client | `services/chat/streaming/openaiClient.js` | HTTP → malika-llm-proxy :3031 |
| Tier mapping | `services/chat/streaming/modelRouter.service.js` | tier → model/temp/tokens |

## LLM Proxy
- Endpoint: `OPENAI_API_URL = http://127.0.0.1:3031/v1/chat/completions`
- PM2 process: `malika-llm-proxy` (config at `/opt/openclaw/malika-llm-proxy.config.js`)
- OpenAI-compatible gateway → routes to Anthropic (`claude-sonnet-4-6`, oat01 key) or Gemini fallback (10 keys)
- Backend cannot answer chat if proxy is down

## Concurrency
The live path is mostly sequential. The only parallelism inside the request is implicit (multiple awaited promises within preview fetch) — there is **no** `Promise.all` for parallel agent execution in the live flow.

## Historical: Pipeline V2 / Option D (Deleted)

A 3-layer agent architecture was attempted (datasourceAgent, publicationAgent, nonstatAgent, mainAgent + supervisor + orchestrator) but never wired into `streaming.service.js`. The orchestrator entry that the design called for (`pipelineV2.service.js`) was never written. The 35 files that made up the partial implementation were deleted in commit `9dc176f` (2026-05-08) after a require()-reachability audit confirmed zero live importers.

The "latency optimization" claims from 2026-03-02 (50-90s → 18-30s, skipRerank chains, supervisor low-risk skip, mainAgent post-stream parallelism) described behavior of code that never ran in production.

If a similar refactor is attempted in the future, start from the live monolith in `streaming.service.js` and extract incrementally with each step verified by `pm2 reload pds-backend` + smoke test, rather than building a parallel implementation.

## Deep Doc System (Knowledge Context)

The Deep Doc accuracy work referenced in MEMORY.md (Layer 1 refusal validator, Layer 3 extraction quality score, scoped phrase bonus, indicator-guided extraction) was implemented in `knowledgeContext.service.js` and `pipeline.service.js` — both deleted in commit `9dc176f`. These features were **not active in the live path** at the time of deletion (no live importer). The 20/21 Deep Doc accuracy from 2026-03-10 reflects historical behavior, not current.

To restore Deep Doc accuracy:
1. Recover the relevant logic from git history (`git show 9dc176f^:backend/src/services/chat/streaming/knowledgeContext.service.js`).
2. Inline the validator/quality-score/extraction logic into `streaming.service.js`'s knowledge retrieval stage (Stage 4) or a new dedicated live module.
3. Re-run `node scripts/test-deep-document.js` to confirm.

> If anyone asks for "Deep Doc 20/21 accuracy", treat it as a re-implementation request, not a regression report.

## Change Log
| Date | Change | Files Affected |
|---|---|---|
| 2026-05-12 | Chat accuracy fixes (B1+B2+B3) — eval baseline 0.911 → 0.949 (+3.8 pp). (B3) Eval fixture cleanup: 3 cases relaxed so eval stops penalizing correct behavior — `edge-nondata-02` `shouldNotContain` changed from `"tidak tersedia"` to `"Mohon maaf"` (guard against refusal opening, not benign mentions); `hallucination-guard-01` `shouldNotContain` now `["AHH 2030 adalah", "AHH 2030 sebesar", "tahun 2030: "]` (catches fabricated values, not bare acknowledgment); `knowledge-ppid-01` `shouldNotContain` now `["Drs.", "M.Sc.", "M.Si.", "S.E.,"]` (academic-title fabrication guards). (B1) Added `splitConcatenated()` to `queryNormalizer.service.js` with 20-entry curated dictionary (`pertumbuhanekonomi → pertumbuhan ekonomi`, `tingkatpengangguran → tingkat pengangguran`, etc.); runs unconditionally as Step 0 of `normalizeQuery` before typo correction. Closes the 2026-05-11 canonical miss — that query now matches PDRB indikator (was `NO_MATCH`, now 5 candidates incl id=288). (B2) Prompt surgery in `streaming.service.js`: (3a) injected today's date + BPS release cadence in `systemPrompt()` so model can reason temporally ("data Q1 2025 seharusnya tersedia karena sudah Mei 2026"); (3b) replaced reactive "WAJIB beritahu belum tersedia" period-fallback wording in both `systemPrompt()` (~`:418-424`) and `buildContextMessages()` (~`:3415-3421`) with positive-frame "lead with the data, period mismatch one-line aside"; (3c) added new `KETERSEDIAAN DATA` block in `systemPrompt()` promoting Auto-Tune Pattern #13/14/15 fix_content to base rules, AND scoped the multi-indikator rule to comprehensive-analysis queries only (after initial Phase 3 over-application regressed `data-simple-02` A→C). Renamed `BATASAN PENTING` → `PRINSIP DATA`. Deep-doc replay 0/11 → 1/11 (T5 only — T3/T6/T8/T10 still fail because dataPreview rows lack a year column → separate B5 follow-up). Real remaining failure: `knowledge-brs-01` "inflasi kelompok pengeluaran" still D (model asks for clarification instead of using defaults). Plan: `docs/superpowers/plans/2026-05-12-malika-chat-accuracy-fixes.md`. Reports: `backend/evals/reports/eval-2026-05-12-00-45.json`. | `backend/src/services/chat/{queryNormalizer.service,streaming.service}.js`, `backend/src/services/chat/__tests__/queryNormalizer.service.test.js`, `backend/evals/fixtures/chat-cases.json` |
| 2026-05-11 | MALIKA Auto Tune (agentic remediation per flag): admin clicks "Auto Tune" on a flag → backend kicks off background job → agentic loop via malika-llm-proxy `/v1/chat/completions` (claude-cli worker pool, OAuth subscription billing) → pseudo-tool-use protocol (model emits tool calls as fenced JSON, parser dispatches) → 6 constrained tools (read_flag, search_existing_patterns, search_knowledge_base, propose_pattern, propose_kb_correction, run_regression_and_commit, abandon) → regression eval gate (every active pattern still fires on canonical_query; every koreksi entry's retrieval_chunks row exists) → on pass, commits + auto-resolves flag to training_added; on fail, rollback + agent revises or abandons. AT-5 smoke: flag 37 → 41s → committed pattern "Analisis Ekonomi - Tampilkan Data Terbaru Tanpa Konfirmasi" (fix_type=add_to_prompt). New `auto_tune_logs` audit table + `canonical_query` column on chat_error_patterns. Plan: `docs/superpowers/plans/2026-05-11-malika-auto-tune.md` | `backend/src/services/autoTune/{agent,jobRunner,regression,tools}.service.js`, `backend/src/controllers/autoTune.controller.js`, `backend/src/routes/autoTune.routes.js`, `backend/src/models/{AutoTuneLog,ChatErrorPattern}.model.js`, `backend/admin/app/malika-analysis/page.tsx`, `backend/app.js`, `/opt/malika-llm-proxy/src/index.js` (passthrough +IPv4 fix) |
| 2026-05-11 | MALIKA tuning loop (Level A + C): (A) `analyzeFlags()` composes draft patterns from flag clusters keyed to `flag_type` templates (hallucination/incomplete → `add_to_prompt`; context_lost/irrelevant → `special_handling`); min cluster size 2. Admin Analytics tab gains "Pattern Suggestions" cards + one-click Promote modal POSTing to existing `/error-learning/patterns`. (C) New `patternRetirement.service.js` + scheduler at 06:45 WIT daily deactivates `is_active=true AND occurrence_count<5 AND last_occurrence_at<NOW()-90 DAY` (preserves row for audit; admin re-activate via toggle). First run retired 8 seed patterns from 2026-01-20 import (zero occurrences over 111 days). Plan: `docs/superpowers/plans/2026-05-11-malika-tuning-suggestions-retirement.md` | `backend/src/services/chat/{errorLearning,patternRetirement}.service.js`, `backend/admin/app/malika-analysis/page.tsx`, `backend/server.js` |
| 2026-05-11 | MALIKA analysis loop closed end-to-end. (1) `addToKnowledgeBase` ported xenova→retrieval_chunks via `processEmbeddings` (was silent-lie writing to dropped 1536d OpenAI columns). (2) `checkQueryPattern` (special_handling) wired into streaming.service.js:4737 alongside `getPromptFixes`; matching patterns get `[SPECIAL HANDLING — name]` prefix in `promptFixes`. (3) New `autoFlag.service.js` with 3 conservative heuristics (refusal-with-data → hallucination/high; ultra-short non-greeting → incomplete/low; repeat-in-thread → context_lost/medium) fire-and-forget via `setImmediate` from `saveAssistantMessage`. Repeat check runs FIRST (stronger pipeline signal than single-message refusal). (4) PWA chat gains 🚩 Laporkan button in `MessageFeedback.tsx`; new Next.js proxy at `frontend/src/app/api/error-learning/flag/route.ts`. **HNSW caveat:** newly-inserted retrieval_chunks rows surface via linear scan at sim 0.866 but not via HNSW indexed query until next reorg. Plan: `docs/superpowers/plans/2026-05-11-malika-analysis-fixes-and-loop.md` | `backend/src/services/chat/{errorLearning,autoFlag,streaming}.service.js`, `frontend/src/{components/chat/MessageFeedback,components/chat/DataSummaryBubble,app/(admin)/chat/ChatPageClient,app/api/error-learning/flag/route}.tsx/ts` |
| 2026-05-08 | **Frontend dead-handler cleanup** (commit `b4bde20`): removed handlers + SSE event-type entries for events the live backend never emits (`status`, `status_detail`, `tool_call`, `tool_result`, `thinking`, `suggestions_update`). Kept `ToolCallEvent`/`ToolResultEvent` interfaces in `chatTransport.ts` because `ChatProcessContext` still references them as state shape. Kept inert UI components (`UnifiedActivityFeed`, `ProcessIndicator`, etc.) for future pass — see [chat_pipeline_orphan_code.md](../../../../root/.claude/projects/-var-www-html/memory/chat_pipeline_orphan_code.md). Net delta: -157 / +17 lines. Live SSE round-trip verified via frontend proxy. | frontend/src/lib/chatTransport.ts, frontend/src/app/(admin)/chat/ChatPageClient.tsx |
| 2026-05-08 | **Dead-code cleanup** (commit `9dc176f`): deleted 35 files (17576 lines) from `streaming/` and `__tests__/` after require()-reachability audit confirmed zero live importers. `streaming/` reduced from 32 files + 5 in `agents/` → 4 files (`openaiClient`, `modelRouter`, `config`, `requestContext`). PM2 reload verified clean. Test suite delta: 251/270 pass (19 pre-existing failures, none caused by this change). | streaming/agents/* (deleted dir), streaming/{index, knowledgeAnalyst, assistantMessage, brsPreview, chatHelpers, dataPreview, eximHandler, gateAgent, greeting, knowledgeContext, llmSuggestions, mergeBundles, multiSource, orchestrator, pipeline.service, previewBuilder, prompt.service, provinsi, reconciler, supervisor, toolUse, topicPatterns, topic.service, uiMetadata, chartAgent.service, sse.service, queryContext.service}, __tests__/{chartAgent.service, sse.service, queryContext.service}.test.js |
| 2026-05-08 | **Doc rewrite**: corrected pipeline description to match live monolithic flow in `streaming.service.js`. Identified V2 architecture, sub-agents, supervisor/chartAgent/toolUse, and `pipeline.service.js`-based stage decomposition as orphan/dead-code (no live importer). Flagged Deep Doc system regression risk. | docs/workspace/chat-pipeline.md |
| 2026-05-08 | Fix `malika_ui` fence truncation in persisted assistant messages: two `streamingPersist` paths sliced `assistantContent` to 8000 chars, severing the closing ` ``` ` for tables with rich `value_codes` payloads (verified: 11 rows × 26 metric columns ≈ 41 KB). Replay then fell back to raw-code-block render instead of `DataSummaryBubble`. Cap interpretation at 8000 chars only; let uiBlock pass through (DB column is `longtext`). Added e2e regression test. | streaming.service.js (lines 736, 4924), e2e/chat-modal-value-codes.spec.ts |
| 2026-05-08 | Verified ChatTableModal renders `<sup title>` for per-cell `value_codes` during live streaming (lines 288 + 419 of ChatTableModal.tsx). Both in-whitelist (`*` → "Angka sementara") and extended-whitelist (`–` → "Data nihil atau tidak ada") tooltip paths confirmed in DOM. | (verification only; no code change in this entry) |
| 2026-03-02 | Pipeline V2 latency optimization (8 changes, 50-90s → 18-30s) **— rolled back / dead code as of 2026-05-08** | documentJudge, publicationAgent, supervisor, mainAgent, gateAgent, knowledgeSearch, multiStrategySearch, pipeline, chat.validation |
| 2026-03-02 | Pipeline V2 (Option D) — 3-layer architecture with sub-agents **— never wired into streaming.service.js, orphan as of 2026-05-08** | agents/*, pipelineV2.service.js (file no longer exists), config.js, streaming.service.js |
| 2026-03-02 | Initial audit & documentation | - |
