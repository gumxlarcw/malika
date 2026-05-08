# Chat Pipeline — Project Line

> Last updated: 2026-05-08

## Current State
- **Protocol**: SSE (Server-Sent Events)
- **Core file**: `backend/src/services/chat/streaming.service.js` (~2100 lines)
- **Pipeline dir**: `backend/src/services/chat/streaming/` (32 files)

## Pipeline Flow
```
Input → gateAgent (intent) → modelRouter (tier) → pipeline (search+RAG)
→ orchestrator (merge) → knowledgeAnalyst (evaluate) → LLM call
→ chartAgent (if applicable) → supervisor (quality) → SSE output
```

## Model Tiers (modelRouter.service.js)
| Tier | Context Budget | Model |
|---|---|---|
| GREETING | 20K chars | claude-sonnet-4-6 |
| SIMPLE | 120K chars | claude-sonnet-4-6 |
| COMPLEX | 200K chars | claude-sonnet-4-6 |
| DEEP | 400K chars | claude-sonnet-4-6 |

## SSE Events
`user_saved`, `thread_updated`, `intent`, `context`, `status`, `text`, `malika_ui`, `done`, `error`, `heartbeat`

## Key Services
- `gateAgent.service.js` — Intent classifier
- `modelRouter.service.js` — Tier selection
- `pipeline.service.js` — Main orchestration
- `orchestrator.service.js` — Multi-source merge
- `knowledgeAnalyst.service.js` — RAG evaluation
- `chartAgent.service.js` — Chart generation
- `supervisor.service.js` — Quality check
- `prompt.service.js` — Prompt builder
- `sse.service.js` — SSE handler
- `toolUse.service.js` — Agentic tool calling

## Pipeline V2 (Option D: 3-Layer Architecture)

**Status**: Implemented, routing via `PIPELINE_VERSION` env var (default: `v1`)

### Architecture
```
Layer 1 (parallel): gateAgent + contextLoader + normalizer + DNA
Layer 2 (parallel): datasourceAgent + publicationAgent + nonstatAgent
Layer 3 (stream):   mainAgent + supervisor
```

### New Files
| File | Lines | Purpose |
|---|---|---|
| `streaming/agents/agentProtocol.js` | 178 | Shared I/O contracts |
| `streaming/agents/datasourceAgent.service.js` | 498 | Intent + preview + chart |
| `streaming/agents/publicationAgent.service.js` | 266 | BRS/Pub KB + retry |
| `streaming/agents/nonstatAgent.service.js` | 75 | Non-stat KB |
| `streaming/agents/mainAgent.service.js` | 589 | Synthesize + stream |
| `streaming/pipelineV2.service.js` | 617 | 3-layer orchestrator |

### Routing (env: `PIPELINE_VERSION`)
- `v1` — Original pipeline (default)
- `v2` — V2 pipeline
- `shadow` — V1 serves, V2 runs in background
- `gradual:N` — N% of requests to V2

### Key Improvement: Publication Retry
`publicationAgent` has confidence-based retry: if top similarity < 0.55, reformulates query using abbreviation expansion + BPS domain synonyms and retries.

## Pipeline V2 Latency Optimizations (2026-03-02)

**Before**: 50-90s per query. **After**: 18-30s (statistical/knowledge), 60-120s (deep).

| # | Optimization | Detail |
|---|---|---|
| 1 | DocumentJudge candidates 50→20 | windowSize 300→200, scan limit 50K→20K |
| 2 | High-confidence bypass (similarity ≥ 0.85) | Skips LLM judge entirely (~22-56s saved) |
| 3 | publicationAgent: always skipRerank | Removes judge from publication search path |
| 4 | Supervisor: skip LLM for low-risk | greeting/chitchat/short (<200ch) skip LLM review |
| 5 | mainAgent: parallel post-stream | supervisor + suggestions + message-save via Promise.allSettled |
| 6 | Fix skipRerank passthrough | knowledgeSearch + multiStrategySearch weren't forwarding flag |
| 7 | Fix supervisor JSON parse | Strip markdown code fences from Gemini responses |
| 8 | Gate: skipIntent for knowledge | KNOWLEDGE route skips datasource intent search (saves ~27s) |

### Key Patterns
- `skipRerank` chain: publicationAgent → knowledgeSearch.service → multiStrategySearch → vectorSearch → documentJudge (bypassed)
- Supervisor low-risk check: `gateRoute === 'greeting' || 'chitchat' || tier === 'GREETING' || fullText.length < 200`
- mainAgent allowedModels: `['claude-sonnet-4-6', 'claude-haiku-4-5']`
- Validation (chat.validation.js) model enum: `['gemini-3-flash-preview', 'gemini-3-pro-preview', 'claude-sonnet-4-6', 'claude-haiku-4-5']`

### Test Results
- **E2E**: 5/5 pass. Q2=18.4s, Q3=21.4s, Q4=26.1s, Q5=25.3s
- **Accuracy**: 56/56 (100%) — including DM01-DM03 deep mode with claude-sonnet-4-6

## Change Log
| Date | Change | Files Affected |
|---|---|---|
| 2026-05-08 | Fix `malika_ui` fence truncation in persisted assistant messages: two `streamingPersist` paths sliced `assistantContent` to 8000 chars, severing the closing ` ``` ` for tables with rich `value_codes` payloads (verified: 11 rows × 26 metric columns ≈ 41 KB). Replay then fell back to raw-code-block render instead of `DataSummaryBubble`. Cap interpretation at 8000 chars only; let uiBlock pass through (DB column is `longtext`). Added e2e regression test. | streaming.service.js (lines 736, 4924), e2e/chat-modal-value-codes.spec.ts |
| 2026-05-08 | Verified ChatTableModal renders `<sup title>` for per-cell `value_codes` during live streaming (lines 288 + 419 of ChatTableModal.tsx). Both in-whitelist (`*` → "Angka sementara") and extended-whitelist (`–` → "Data nihil atau tidak ada") tooltip paths confirmed in DOM. | (verification only; no code change in this entry) |
| 2026-03-02 | Pipeline V2 latency optimization (8 changes, 50-90s → 18-30s) | documentJudge, publicationAgent, supervisor, mainAgent, gateAgent, knowledgeSearch, multiStrategySearch, pipeline, chat.validation |
| 2026-03-02 | Pipeline V2 (Option D) — 3-layer architecture with sub-agents | agents/*, pipelineV2.service.js, config.js, streaming.service.js |
| 2026-03-02 | Initial audit & documentation | - |
