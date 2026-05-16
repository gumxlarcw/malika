# MALIKA Sonnet-only single-lane design

**Date:** 2026-05-16
**Author:** session driven by gumxlarcw
**Status:** awaiting user review → implementation
**Related:** `/root/.claude/projects/-var-www-html/memory/malika_llm_proxy.md`, `docs/workspace/chat-pipeline.md`, `docs/workspace/ai-llm.md`

---

## 1. Goal

Collapse MALIKA's chat stack to a single LLM lane backed by `claude-sonnet-4-6`, served exclusively through `malika-llm-proxy` (`127.0.0.1:3031`). Remove every "flash" model surface from frontend and backend. Forbid direct provider calls (`api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`) from any chat/LLM path.

Out of scope: Opus (already absent from the codebase) and the legacy OpenAI embeddings code path (separate cleanup, embeddings are now self-hosted via Xenova).

## 2. Guiding principle — "one model, many budgets"

Three orthogonal decisions are made per chat request today:

1. **Which model** — varied by tier (flash for GREETING/SIMPLE, Sonnet for COMPLEX/DEEP).
2. **How much budget** — `max_tokens`, `temperature`, `thinking_budget` vary per tier (300 tokens / no thinking for GREETING through 16k tokens / 16k thinking for DEEP).
3. **Which prompt** — shared across tiers.

This spec collapses #1 to a constant (`claude-sonnet-4-6`) and leaves #2 and #3 untouched. The tier classifier in `services/chat/streaming/modelRouter.service.js` (`routeModel()` with `COMPLEX_INDICATORS` / `DEEP_INDICATORS`) keeps running — it now picks budget+thinking, not model.

The fictional model choice is the only thing removed. No new abstractions, no flags, no rollout — pure deletion plus one constant.

## 3. Current reality vs perception

The frontend dropdown that lets users pick "MALIKA Flash" (Haiku) has been a lie for some time. The proxy's tier 1 is `anthropic/claude-sonnet-4-6` and the proxy ignores `body.model` — every chat request, regardless of what the frontend sends, is answered by Sonnet. The `modelForTier()` defaults to `gemini-3-flash-preview` are also dead code on this path: `requestContext.getModelOverride()` (set from `req.body.model`) wins over the tier default for the actual outbound call, and the proxy then ignores both.

This cleanup is removing dead pretense, not changing user-facing model behavior. The behavioral changes that DO happen:

- Frontend dropdown removed (users no longer see a model picker).
- `localStorage["selectedModel"]` cleaned up silently on next visit.
- Backend stops accepting `claude-haiku-4-5` / `gemini-*` overrides in `req.body.model`.
- 7 service-default model strings flip from `gemini-3-flash-preview` to `claude-sonnet-4-6`, which only matters if the corresponding env var is unset — a degraded-config path.
- 4 direct provider URLs in code are replaced with proxy URLs (or env reads), closing bypass paths.

## 4. Components — file-by-file changes

### 4.1 Backend (14 files)

| # | File | Change |
|---|---|---|
| 1 | `backend/src/services/chat/streaming/modelRouter.service.js` | In `TIER_CONFIG` (lines 72-109) hard-code `model: 'claude-sonnet-4-6'` for all 4 tiers; drop `process.env.OPENAI_MODEL_CHAT \|\|` / `OPENAI_MODEL_REASONING \|\|` lookups. Delete `CHAT_FORCE_MODEL` branch (lines 172-179). Update leading docstring (lines 1-12). Add startup warning if any of `MODEL_GREETING`, `MODEL_SIMPLE`, `MODEL_COMPLEX`, `MODEL_DEEP`, `CHAT_FORCE_MODEL` is set in env. **Delete `modelForTier()` function + `MODEL_TIERS` export ONLY AFTER #2 below has been completed** (3 production call sites still reference them). Once deleted, also remove from module exports (line 306-307). |
| 2 | `backend/src/services/chat/streaming.service.js` | Migrate 3 call sites that currently use `MODEL_TIERS.X` + `modelForTier(tier)`: lines 697-698 (GREETING), 4845-4846 (COMPLEX), 5236-5237 (SIMPLE). Replace `const effectiveModel = modelOverride \|\| modelForTier(tier);` with `const effectiveModel = modelOverride \|\| 'claude-sonnet-4-6';` and drop the matching `const tier = MODEL_TIERS.X;` line if `tier` becomes unused after the change. Update the import on line 98 to drop `modelForTier, MODEL_TIERS` (the file may still need other imports from `modelRouter.service`). |
| 3 | `backend/src/controllers/chat.controller.js` | `ALLOWED_OVERRIDES` (lines 76-81) becomes `new Set(['claude-sonnet-4-6'])`. Out-of-set values silently fall through to tier-router default (no 4xx — protects old PWA tabs from breaking). |
| 4-10 | 7 services with `\|\| 'gemini-3-flash-preview'` defaults: `services/chat/persistentMemory.service.js:28`, `services/ai/tableUnderstanding.service.js:81`, `services/ai/keywordExtractor.service.js:27`, `services/ai/reranker.service.js:17`, `services/ai/documentJudge.service.js:30`, `services/ai/synonymExpansion.service.js:137`, `config/search.config.js:102` | Each `\|\| 'gemini-3-flash-preview'` → `\|\| 'claude-sonnet-4-6'`. |
| 11 | `backend/src/utils/costTracker.js` | Delete the 3 gemini-flash cost entries (lines 20-23). |
| 12 | `backend/.env.example` | Lines 47-64: change ~12 vars from `claude-haiku-4-5-20251001` → `claude-sonnet-4-6`. Brings file in line with live `/opt/malika-llm-proxy/.env`. |
| 13 | `backend/src/__tests__/modelRouter.modelForTier.test.js` | Delete file (function under test is gone). |
| 14 | `backend/src/__tests__/openaiClient.chat.test.js` | Fixture model on lines 60, 66: `'gemini-3-flash-preview'` → `'claude-sonnet-4-6'`. |

### 4.2 Frontend (3 files)

| # | File | Change |
|---|---|---|
| 14 | `frontend/src/lib/chatConstants.ts` | Delete map entry `'claude-haiku-4-5': 'MALIKA Flash'` on line 14. Keep only `'claude-sonnet-4-6': 'MALIKA Deep'` (rename label if desired — out of scope here). |
| 15 | `frontend/src/lib/chatTransport.ts` | Line 160: `options?.model \|\| "claude-haiku-4-5"` → `options?.model \|\| "claude-sonnet-4-6"`. |
| 16 | `frontend/src/app/(admin)/chat/ChatPageClient.tsx` | Delete `selectedModel` state hook + localStorage read (lines 143-148). Delete model-picker dropdown (lines 2035-2043) and its wrapper button. All call sites that read `selectedModel` switch to the constant `"claude-sonnet-4-6"`. Add one-shot `localStorage.removeItem("selectedModel")` on mount to silently clean stale Haiku values. |

### 4.3 Proxy-bypass closures (4 files)

The user rule "only proxy + Sonnet" requires no chat/LLM HTTP client may target `api.openai.com`, `api.anthropic.com`, or `generativelanguage.googleapis.com` directly. Four current violations:

| # | File | Change |
|---|---|---|
| 17 | `backend/src/services/ai/openaiChat.service.js:17` | Replace hard-coded `'https://api.openai.com/v1/chat/completions'` with `process.env.OPENAI_API_URL` (already configured to proxy). Throw at module load if env unset. |
| 18 | `backend/src/services/ai/keywordExtractor.service.js:177, :445` | Remove the `\|\| 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'` fallbacks. If `process.env.OPENAI_API_URL` is unset, throw — fail loud, don't silently bypass. |
| 19 | `backend/src/services/ai/client/openaiClient.js:12` | Drop the `\|\| 'https://generativelanguage.googleapis.com/v1beta/openai'` literal. Require `OPENAI_API_BASE_URL`; throw at module load if missing. (Leave `OPENAI_EMBEDDINGS_URL` alone — embedding path is out of scope.) |
| 20 | `frontend/src/app/api/insights/route.ts:2300` | Replace `https://api.openai.com/v1/chat/completions` with proxy URL (`http://127.0.0.1:3031/v1/chat/completions` or env). Drop the direct OpenAI key usage in favor of the dummy proxy key (`malika-internal-proxy`). |

### 4.4 Defense-in-depth assertion (1 file)

| # | File | Change |
|---|---|---|
| 21 | `backend/src/services/chat/streaming/config.js` | Add startup assertion: parsed `OPENAI.API_URL` host must be `127.0.0.1` (or `localhost`), port `3031`. If not, log a `console.error` and refuse to start (`process.exit(1)`). Protects against future drift where someone edits env to point at a provider URL. |

### 4.5 Out of scope (explicitly not touched)

- `backend/src/services/ai/embedding.service.js` + OpenAI-embeddings code paths in `openaiClient.js` — legacy code per its own comment; embeddings live in `services/bpsMetadata/embedding.service.js` (Xenova self-hosted).
- `requestContext.setModelOverride(...)` — may have callers outside the chat path (admin probes, eval runner); removing it is a follow-up.
- `/opt/malika-llm-proxy/.env` — already all-Sonnet; nothing to change.
- `~/.openclaw/openclaw.json` — already `anthropic/claude-sonnet-4-6` primary; nothing to change.
- The proxy's Gemini-fallback tier chain (`gemini-3-flash-preview → 2.5-flash → 2.5-pro`) — operational redundancy for when Anthropic is down. Not a flash "lane"; not in scope.

## 5. Data flow (after)

```
User types message in ChatPageClient
  ↓
(no model state, no dropdown)
  ↓
chatTransport.ts sends body: { text }   ← no model field
  ↓
POST /api/chat/stream
  ↓
chat.controller.js — ALLOWED_OVERRIDES = {"claude-sonnet-4-6"};
  req.body.model absent → no override set
  ↓
modelRouter.routeModel({ query, isGreeting, ... })
  → classifier returns tier (GREETING/SIMPLE/COMPLEX/DEEP)
  → TIER_CONFIG[tier].model = "claude-sonnet-4-6"  (constant)
  → max_tokens, temperature, thinking_budget still per-tier
  ↓
streaming.service builds prompt + calls proxy
  POST http://127.0.0.1:3031/v1/chat/completions
  body: { model: "claude-sonnet-4-6", messages, stream: true,
          ...thinking, ...max_tokens varies by tier }
  ↓
Proxy tier 1 = anthropic/claude-sonnet-4-6
  ↓
Sonnet answers, streamed back as SSE
```

## 6. Error handling & edge cases

### 6.1 Stale PWA cache sends `{ model: "claude-haiku-4-5" }`
Whitelist rejects the override silently. Tier-router default (Sonnet) wins. User notices nothing because they were already getting Sonnet via the proxy.

### 6.2 Stale `localStorage.selectedModel = "claude-haiku-4-5"`
One-shot `removeItem` on `ChatPageClient` mount. Idempotent. No notice (dropdown is gone).

### 6.3 Deprecated env vars (`MODEL_GREETING`, `MODEL_SIMPLE`, `MODEL_COMPLEX`, `MODEL_DEEP`, `CHAT_FORCE_MODEL`) still set in someone's `.env`
Module-load warning in `modelRouter.service.js`: `logger.warn('Deprecated MODEL_* env var detected — no longer honored.')`. Footgun caught at startup.

### 6.4 Proxy outage / Sonnet unavailable
Unchanged. The proxy still cascades through its Gemini fallback tiers; the backend continues to send `model: "claude-sonnet-4-6"` and receive whatever the proxy serves. This spec governs what the backend *asks for*, not what the proxy *delivers* under failover — Gemini fallback is operational redundancy, not a user-visible "flash lane."

### 6.5 Someone repoints `OPENAI_API_URL` at a provider URL
Caught by the startup assertion in `streaming/config.js`. Backend refuses to start. Loud failure beats silent provider bypass.

## 7. Testing & verification

### 7.1 Code-level
- Delete `modelRouter.modelForTier.test.js`. Update fixture string in `openaiClient.chat.test.js`. Run `cd backend && npm test` — all existing tests pass.
- No new unit tests required. The bypass closures are structural (URL config); behavior is identical.

### 7.2 Provider-bypass verification (the rule)
After implementation, run:

```bash
grep -rIn -E 'api\.(anthropic|openai)\.com|generativelanguage\.googleapis\.com' \
  backend/src frontend/src \
  --include='*.ts' --include='*.tsx' --include='*.js' \
  | grep -v node_modules \
  | grep -v embedding
```

Expected output: **empty.** Any non-empty result is a violation and blocks merge.

### 7.3 Eval suite
- Production traffic was already all-Sonnet, so the B-grade eval scores from `backend/evals/reports/eval-2026-05-13-*` should be unchanged.
- Re-run the suite once after merge as sanity check. If scores regress, the issue is something missed in this spec, not the model change.

### 7.4 Manual smoke
After deploy (rebuild + reload PM2):
1. Open chat UI — confirm no model dropdown is rendered.
2. Send a greeting ("selamat pagi") — should respond quickly.
3. Send a data query ("IPM Maluku Utara 2024") — should return data with citations.
4. Send a deep query ("perbandingan IPM antar kabupaten Maluku Utara 2020-2024") — should engage extended thinking.
5. Check proxy logs: `pm2 logs malika-llm-proxy --lines 20 --nostream` — all 3 requests should show `Tier 1/4 → anthropic/claude-sonnet-4-6`.

## 8. Deployment

1. Edit + commit on `main` (per project workflow — no PR branch needed for this kind of cleanup; user can switch to branch+PR if preferred).
2. Backend reload: `pm2 reload pds-backend --update-env`.
3. Admin rebuild + reload: `cd backend/admin && npm run build && pm2 reload pds-admin --update-env`.
4. Frontend rebuild + reload: `cd frontend && npm run build && pm2 reload pds-frontend --update-env`.
5. Proxy: no change (already correct).
6. Run §7.2 grep check.
7. Run §7.4 smoke checks.
8. Re-run eval suite (§7.3).

## 9. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| User mid-session loses Haiku dropdown selection | Certain | Silent — Haiku selection was already not honored by proxy. No actual model change. |
| Stale PWA tabs send Haiku model string | Likely | Whitelist falls through silently to Sonnet. |
| Deprecated env vars in someone's `.env` | Likely | Module-load warning. |
| Eval scores regress | Low | Same model as before; re-run suite as sanity. |
| Direct-provider call we missed | Low | §7.2 grep gate before merge. |
| Operator points `OPENAI_API_URL` at a provider | Low | §4.4 startup assertion refuses to boot. |

## 10. Memory updates after merge

Update `/root/.claude/projects/-var-www-html/memory/`:
- `malika_llm_proxy.md` — add note that "MODEL_GREETING/SIMPLE/COMPLEX/DEEP / CHAT_FORCE_MODEL env vars are deprecated as of 2026-05-16."
- New file `single_lane_decision.md` (type: `project`) — record the rule "all chat/LLM traffic must go through `127.0.0.1:3031`, model = `claude-sonnet-4-6`, no Opus/Haiku/Gemini in code." Why: simplifies billing, eliminates dead-code surface, removes user-facing pretense. How to apply: any future suggestion to add a model lane or call a provider directly should be rejected and the suggester pointed at this spec.
