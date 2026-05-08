# Chat Pipeline — Project Line

> Last updated: 2026-05-08

## Current State
- **Protocol**: SSE (Server-Sent Events)
- **Live entry**: `backend/src/services/chat/streaming.service.js` — `streamChatResponse()` at `:3502`
- **Architecture**: Monolithic. The full pipeline runs inline inside `streaming.service.js` (~5162 lines).
- **Dead-code graveyard**: `backend/src/services/chat/streaming/` contains ~30 files, but only **two** are actually imported by the live entry — see [Live vs Orphan](#live-vs-orphan-imports) below. A planned 3-layer/agent refactor was started but never wired in.

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

## Live vs Orphan Imports

The only `streaming/*` modules actually wired into the live path:

| Module | Used by | Purpose |
|---|---|---|
| `streaming/openaiClient.js` | `streaming.service.js:89` | LLM HTTP client → malika-llm-proxy |
| `streaming/modelRouter.service.js` | `streaming.service.js:90` | `modelForTier`, `MODEL_TIERS` constants |

Every other `streaming/*.service.js` file has **no live importer** (verified by grep across `src/`):

`gateAgent.service.js`, `pipeline.service.js`, `supervisor.service.js`, `chartAgent.service.js` (only test imports), `toolUse.service.js`, `knowledgeContext.service.js`, `prompt.service.js`, `sse.service.js`, `knowledgeAnalyst.service.js`, `orchestrator.service.js`, `multiSource.service.js`, `previewBuilder.service.js`, `topic.service.js`, `provinsi.service.js`, `queryContext.service.js`, `reconciler.service.js`, `uiMetadata.service.js`, `llmSuggestions.service.js`, `dataPreview.service.js`, `brsPreview.service.js`, `greeting.service.js`, plus `streaming/agents/{datasourceAgent, publicationAgent, nonstatAgent, mainAgent, agentProtocol}.js`.

These represent a stalled extraction refactor. They are kept on disk but **do not affect runtime behavior**.

> Cleanup is available as a follow-up: deleting the orphans + the `agents/` subdir would reduce ~28 files. Defer until a deliberate refactor session — they are misleading but not harmful.

## Model Tiers (`streaming/modelRouter.service.js`)

Source defaults vs runtime (production sets `OPENAI_MODEL_CHAT=claude-sonnet-4-6`):

| Tier | Source default | Runtime (prod) | Temp | Thinking |
|---|---|---|---|---|
| GREETING | `gemini-3-flash-preview` | `claude-sonnet-4-6` | 0.7 | off |
| SIMPLE | `gemini-3-flash-preview` | `claude-sonnet-4-6` | 0.3 | 4K |
| COMPLEX | `claude-sonnet-4-6` | `claude-sonnet-4-6` | 0.2 | adaptive |
| DEEP | `claude-sonnet-4-6` | `claude-sonnet-4-6` | 0.1 | 16K |

Per-tier knobs override via `MODEL_<TIER>` env vars. Gate model (intent classifier) defaults to `gemini-3-flash-preview` via `GATE_LLM_MODEL` — but the gate file (`gateAgent.service.js`) is currently orphan; live intent uses `services/search/intent.service::resolveSearchIntent` (deterministic, not LLM-based).

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

## What WAS Planned but Not Implemented

The previous version of this doc described a "Pipeline V2 / Option D / 3-Layer Architecture" with agents (datasourceAgent, publicationAgent, nonstatAgent, mainAgent) running in parallel via `pipelineV2.service.js` and `PIPELINE_VERSION` env var routing. **None of that is wired up.** Files exist on disk but have no live importer; no env var is read. The "latency optimization" claims (50-90s → 18-30s, skipRerank chains, supervisor low-risk skip, mainAgent post-stream parallelism) describe behavior of the orphan code, not the live path.

If/when the refactor resumes, this section should be re-introduced. Until then, treat orphan modules as design notes, not implementation.

## Deep Doc System (Knowledge Context)

The Deep Doc accuracy work referenced in MEMORY.md (Layer 1 refusal validator, Layer 3 extraction quality score, scoped phrase bonus, indicator-guided extraction) lives in the orphan `knowledgeContext.service.js` and `pipeline.service.js`. These features are **not active in the current live path**. Reproducing the 20/21 Deep Doc accuracy requires either:
1. Wiring the orphan modules back into `streaming.service.js`, or
2. Re-implementing the validator/quality-score logic inline.

> This is a known regression risk. Verify against `scripts/test-deep-document.js` before claiming Deep Doc accuracy.

## Change Log
| Date | Change | Files Affected |
|---|---|---|
| 2026-05-08 | **Doc rewrite**: corrected pipeline description to match live monolithic flow in `streaming.service.js`. Marked V2 architecture, sub-agents, supervisor/chartAgent/toolUse, and `pipeline.service.js`-based stage decomposition as orphan/dead-code (no live importer). Flagged Deep Doc system regression risk. | docs/workspace/chat-pipeline.md |
| 2026-05-08 | Fix `malika_ui` fence truncation in persisted assistant messages: two `streamingPersist` paths sliced `assistantContent` to 8000 chars, severing the closing ` ``` ` for tables with rich `value_codes` payloads (verified: 11 rows × 26 metric columns ≈ 41 KB). Replay then fell back to raw-code-block render instead of `DataSummaryBubble`. Cap interpretation at 8000 chars only; let uiBlock pass through (DB column is `longtext`). Added e2e regression test. | streaming.service.js (lines 736, 4924), e2e/chat-modal-value-codes.spec.ts |
| 2026-05-08 | Verified ChatTableModal renders `<sup title>` for per-cell `value_codes` during live streaming (lines 288 + 419 of ChatTableModal.tsx). Both in-whitelist (`*` → "Angka sementara") and extended-whitelist (`–` → "Data nihil atau tidak ada") tooltip paths confirmed in DOM. | (verification only; no code change in this entry) |
| 2026-03-02 | Pipeline V2 latency optimization (8 changes, 50-90s → 18-30s) **— rolled back / dead code as of 2026-05-08** | documentJudge, publicationAgent, supervisor, mainAgent, gateAgent, knowledgeSearch, multiStrategySearch, pipeline, chat.validation |
| 2026-03-02 | Pipeline V2 (Option D) — 3-layer architecture with sub-agents **— never wired into streaming.service.js, orphan as of 2026-05-08** | agents/*, pipelineV2.service.js (file no longer exists), config.js, streaming.service.js |
| 2026-03-02 | Initial audit & documentation | - |
