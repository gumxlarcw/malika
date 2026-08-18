---
name: Chat pipeline orphan code (cleanup history)
description: Historical record of the V2 chat pipeline refactor that stalled — 35 orphan files were deleted in commit 9dc176f (2026-05-08). Live streaming/ now has only 4 files.
type: project
originSessionId: 98a44225-437c-4ae5-bc0a-b7a355ff4e45
---
The `backend/src/services/chat/streaming/` directory previously held a stalled V2 refactor with 32 files plus 5 sub-agents in `agents/`. A require()-reachability audit on 2026-05-08 found that 35 of those files had no path of imports from any live entry point; they were deleted in commit `9dc176f` (`chore(chat): remove dead-code graveyard from streaming/`).

**What's left in `streaming/` (4 files, all live):**
- `openaiClient.js` — LLM HTTP client to malika-llm-proxy :3031. Used by `streaming.service.js`, `chat.service.js`, `persistentMemory.service.js`, `sessionCompaction.service.js`, plus 3 `services/ai/*` files.
- `modelRouter.service.js` — `routeModel()` + `TIER_CONFIG`. Used by `streaming.service.js`. **It was silently orphaned** by the 2026-05-16 single-lane refactor (which removed `modelForTier`/`MODEL_TIERS`) and stayed unreferenced until 2026-08-18, during which every answer ran at a hardcoded `max_tokens: 1000`. Re-wired at all three `llmChat` call sites; it now sizes the answer budget only — the model is a single Sonnet lane.
- `config.js` — shared constants. Used by `services/chat/sessionCompaction.service.js`.
- `requestContext.js` — per-request context object. Used by 5 `services/ai/*` services + `sessionCompaction`.

**What was deleted:**
- 7 true orphans: `index.js` (the barrel), `knowledgeAnalyst.service.js`, all 5 in `agents/`.
- 22 transitively orphan: `assistantMessage`, `brsPreview`, `chatHelpers`, `dataPreview`, `eximHandler`, `gateAgent`, `greeting`, `knowledgeContext`, `llmSuggestions`, `mergeBundles`, `multiSource`, `orchestrator`, `pipeline.service`, `previewBuilder`, `prompt.service`, `provinsi`, `reconciler`, `supervisor`, `toolUse`, `topicPatterns`, `topic.service`, `uiMetadata`.
- 3 services with only test importers (`chartAgent`, `sse`, `queryContext`) plus their test files.

**Why:** A modularization refactor was started (extract orchestrator, sub-agents, supervisor) and an "Option D / 3-Layer Architecture" was designed, but the planned `pipelineV2.service.js` orchestrator was never written. The extracted modules sat on disk for ~9 weeks (2026-03-02 to 2026-05-08) misleading anyone who read the directory. The chat-pipeline.md workspace doc described the *intended* end state, not the live path.

**How to apply:**
- Live chat flow is **monolithic in `streaming.service.js`** (~5162 lines). Don't expect orchestrator/agent/supervisor/prompt-builder modules to exist.
- Live intent classification: `services/search/intent.service::resolveSearchIntent` (deterministic, not LLM-based).
- Live LLM call: `streaming/openaiClient.chat()` → `http://127.0.0.1:3031/v1/chat/completions` (malika-llm-proxy).
- The Deep Doc 20/21 accuracy from 2026-03-10 is HISTORICAL — its logic was deleted along with `knowledgeContext.service.js`. To restore: recover from `git show 9dc176f^:<file>` and inline into `streaming.service.js`.
- If a future modularization is attempted: extract incrementally from the live monolith with each step verified by `pm2 reload pds-backend` + smoke test, not by building a parallel implementation.

## Frontend dark UI (commit `b4bde20`, 2026-05-08)

The PWA frontend was also built for V2 events. Cleanup commit `b4bde20` removed the **handler surface** (`onStatus`, `onStatusDetail`, `onToolCall`, `onToolResult`, `onThinking`, `onSuggestionsUpdate`) plus matching `SSEEventType`/`StreamCallbacks` entries in `chatTransport.ts`.

**What was retained (deferred for a future pass — would risk live UX):**
- `ChatProcessContext.tsx` push/clear functions (`pushStep`, `pushToolCall`, `clearSteps`, `markAllStepsDone`, `setProcessSteps`, etc.) — still called from `ChatPageClient.tsx` lifecycle paths (typing-bubble seed at line ~1122, thread-switch cleanup). State stays empty at runtime; harmless.
- Inert UI components: `UnifiedActivityFeed.tsx`, `ProcessIndicator.tsx`, `ToolCallCard.tsx` (standalone), `components/chat/feed/*` — never rendered (`<UnifiedActivityFeed>` JSX absent), only imported as types.
- `ThinkingFeed.tsx` — **still rendered** as typing indicator with empty props, plus replays persisted `thinkingItems` from legacy saved messages.
- `ToolCallEvent` / `ToolResultEvent` interfaces in `chatTransport.ts` — kept because `ChatProcessContext` references them as state shape.

**Why retained:** the state vars (`thinkingItems`, `pipelineText`, `reasoningText`) feed both the typing indicator AND a persisted-message replay path at `ChatPageClient.tsx:608-622` that reads `ui.thinkingItems` from saved `malika_ui` blobs. Removing them would break history loading for any thread that has stored thinkingItems on its messages.

**Net effect today:** the dark-UI handlers can no longer fire; the component code that would have consumed their state stays compiled but inert. ~157 lines of obvious dead handler code removed; ~10-30KB of unused component bundle remains.
