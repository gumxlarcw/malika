# Chat Malika — Proxy Routing & Dynamic Model Selection

**Date:** 2026-04-22
**Author:** brainstormed with Claude
**Status:** design (pending user review)

## Problem

Chat Malika is broken in production. Every request fails with OpenAI 404:

```
[OpenAI] Attempt 1/3 failed: OpenAI API error 404:
  "The model `claude-sonnet-4-6` does not exist or you do not have access to it."
at streaming.service.js:4807 → streamChatResponse at 4821 → streamMessage at chat.controller.js:72
```

Root cause (from full audit, 2026-04-22):

1. The active chat entry `streamChatResponse` (`streaming.service.js:3518`) is a 5,228-line monolith that **ignores `OPENAI_API_URL`** and hardcodes `https://api.openai.com/v1/chat/completions` (lines 88 + 4791). It then sends `model: "claude-sonnet-4-6"` (from `OPENAI_MODEL_CHAT`) to OpenAI, which returns 404.
2. A correct, env-driven client already exists at `services/chat/streaming/openaiClient.js` — it is used by `greeting.service.js` and would work, but the monolith never imports it.
3. A refactored V2 pipeline (`pipelineV2.service.js`) exists but has **zero callers**; `PIPELINE_VERSION=shadow` is set in `.env` but no code reads the env var.
4. `malika-llm-proxy` runs on PM2 at `127.0.0.1:3031`, OpenAI-compatible, and is already used by other apps on the server. It owns all provider routing and fallback (Gemini 10-key round-robin → Anthropic fallback).

Additional drift under `services/chat/` that should be fixed in the same pass:
- `chat.service.js:1574` — raw `fetch` to `api.openai.com`.
- `chatPreview.service.js:472, 512` — raw `fetch` with `generativelanguage.googleapis.com` fallback (bypasses the proxy).

Out of scope (explicitly): `services/ai/*` callers (keyword extractor, embeddings, openaiChat). Those can be consolidated in a follow-up spec.

## Goals

1. Unblock chat in production by routing every in-scope LLM call through `malika-llm-proxy` (`127.0.0.1:3031`).
2. Collapse the two duplicate LLM clients in `services/chat/` into one, so URL/retry/timeout/circuit-breaker policy lives in a single file.
3. Make model selection dynamic: each stage picks a model appropriate for its tier (Gemini for cheap stages, Claude for heavy reasoning), and the frontend's `model` override is respected.

## Non-goals

- Activating pipeline V2. It stays dead code after this refactor; V1-vs-V2 decision belongs in a separate spec.
- Touching LLM callers outside `services/chat/` (e.g. `services/ai/*`).
- Changing the proxy itself — provider selection, retry across keys, and cross-provider fallback remain the proxy's responsibility.
- Adding new SSE events or changing the wire protocol with the frontend.
- Changing the circuit breaker, metrics, or logger utilities.

## Architecture

Two modules, one job each. Callers compose them.

```
                 ┌─ services/chat/streaming/openaiClient.js ──┐
  caller  ─────► │  chat({ model, messages, stream, signal }) │ ─► POST ${OPENAI.API_URL}
                 │  transport only — URL, timeout, retry,     │    (= 127.0.0.1:3031 proxy)
                 │  circuit breaker, abort, metrics           │
                 └────────────────────────────────────────────┘
                 ┌─ services/chat/streaming/modelRouter.service.js ─┐
  caller  ─────► │  modelForTier(tier) → 'gemini-3-flash-preview'…  │
                 │  policy only — tier → model mapping              │
                 └──────────────────────────────────────────────────┘

Composition at each call site:
  const tier  = modelRouter.classify(...);
  const model = requestBodyModel ?? modelRouter.modelForTier(tier);
  const resp  = await openaiClient.chat({ model, messages, stream, signal });
```

Boundary rules:
- `openaiClient.js` never knows about tiers. It takes a `model` string and forwards it.
- `modelRouter.service.js` never makes HTTP calls. It just maps tier → model string.
- Call sites wire the two together. Frontend override (`requestBody.model`) is applied at the composition point.
- All in-scope fetches land on `http://127.0.0.1:3031/v1/chat/completions` via `OPENAI.API_URL` from `config.js`.

## Components

### 1. `streaming/openaiClient.js` — extend, don't rewrite

The file already implements URL from config, timeouts, retries, exponential backoff, abortable sleep, circuit breaker, token metrics. Keep all of that. Add one ergonomic helper:

```js
// New signature (everything optional except model & messages)
async function chat({
  model,                 // required — passed through to proxy verbatim
  messages,              // required — OpenAI chat-completion shape
  stream   = false,      // true → caller reads resp.body as SSE
  temperature,           // optional — forwarded if set
  max_tokens,            // optional — forwarded if set
  tools,                 // optional — forwarded if set
  signal,                // optional — AbortSignal, forwarded to fetch + retry sleep
  apiKey,                // optional — defaults to OPENAI.API_KEY from config
  timeoutMs,             // optional — overrides default
  retries,               // optional — overrides default
  extraHeaders           // optional — merged over Authorization/Content-Type
}) { /* builds body, calls fetchOpenAIWithRetry, returns Response */ }

module.exports = { chat, fetchOpenAIWithRetry, fetchOpenAI, streamOpenAI, ... };
```

Existing exports stay for backwards compatibility (`greeting.service.js` already imports `fetchOpenAIWithRetry`).

### 2. `streaming/modelRouter.service.js` — add policy

Add one pure function. Existing tier-classification logic untouched.

```js
// Returns the proxy-understood model string for a tier.
// Override via env: MODEL_GREETING, MODEL_SIMPLE, MODEL_COMPLEX, MODEL_DEEP.
function modelForTier(tier) {
  const defaults = {
    GREETING: 'gemini-3-flash-preview',   // cheap, fast — greetings & chitchat
    SIMPLE:   'gemini-3-flash-preview',   // cheap — RAG lookups, short answers
    COMPLEX:  'claude-sonnet-4-6',        // reasoning heavy
    DEEP:     'claude-sonnet-4-6',        // extended thinking enabled
  };
  const envKey = `MODEL_${tier}`;
  return process.env[envKey] || defaults[tier] || 'claude-sonnet-4-6';
}
```

Tier fallback (Gemini keys exhausted → Claude) remains the proxy's job. The client names an initial model and hands off.

### 3. Call-site transform

Six sites convert from inline fetch to the composition pattern:

**Before** (monolith `streaming.service.js:688`):
```js
const response = await fetchOpenAIWithRetry({
  method: 'POST',
  headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, messages, stream: true }),
});
```

**After:**
```js
const { chat } = require('./streaming/openaiClient');
const { modelForTier } = require('./streaming/modelRouter.service');
const model = modelOverride || modelForTier(tier);
const response = await chat({ model, messages, stream: true, signal });
```

Sites:
- `streaming.service.js:688` (greeting stream)
- `streaming.service.js:4791` (raw hardcoded fetch — now uses `chat` with retry/breaker)
- `streaming.service.js:5182` (save-assistant non-stream call)
- `chat.service.js:1574` (hardcoded api.openai.com raw fetch)
- `chatPreview.service.js:472` (preview stream)
- `chatPreview.service.js:512` (preview continuation)

The monolith's private `OPENAI_API_URL`, `fetchWithTimeout`, `fetchOpenAIWithRetry` (lines 88–139) are deleted.

### 4. `streaming/config.js` — one-line fix

Line 13 default changes from `:3030` to `:3031` so the file is correct even when `.env` isn't loaded.

### 5. Controller — pass through the frontend's model

`controllers/chat.controller.js:72` currently drops `req.body.model`. Add `modelOverride: req.body?.model` to the `streamChatResponse` args and thread it through each call site as the `requestModel` that wins over `modelForTier(tier)`.

## Data flow

```
┌──────────────┐
│  Frontend    │  POST /api/chat/threads/:id/stream
│  (PWA)       │  body: { text, model: "claude-haiku-4-5" }   ← user's selector
└──────┬───────┘
       │ x-malika-uid
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  chat.controller.js:streamMessage                               │
│  ownerId       = getOwnerIdFromReq(req)                         │
│  modelOverride = req.body?.model                    ← NEW       │
│  → streamChatResponse({ res, threadId, userMessage, ownerId,   │
│                          modelOverride })                       │
└──────┬──────────────────────────────────────────────────────────┘
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  streaming.service.js:streamChatResponse                        │
│  (unchanged logic — save user msg, load history, gate, RAG…)    │
│                                                                 │
│  At each LLM call site (3 sites in the monolith,               │
│                         6 total across the chat tree):         │
│    tier  = modelRouter.classify(context)                        │
│    model = modelOverride ?? modelRouter.modelForTier(tier)      │
│    resp  = await openaiClient.chat({ model, messages,           │
│                                      stream: true, signal })    │
│                                                                 │
│  model precedence, highest wins:                                │
│    1. modelOverride (frontend body.model)                       │
│    2. modelForTier(tier) → MODEL_<TIER> env override            │
│    3. modelForTier(tier) → built-in default per tier            │
└──────┬──────────────────────────────────────────────────────────┘
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  streaming/openaiClient.js:chat()                               │
│  headers: Authorization: Bearer ${OPENAI.API_KEY}               │
│  body:    { model, messages, stream, ...opts }                  │
│  → fetchOpenAIWithRetry → POST ${OPENAI.API_URL}                │
│    (= http://127.0.0.1:3031/v1/chat/completions)                │
│                                                                 │
│  circuit breaker / 2 retries w/ exp. backoff / abort-aware      │
└──────┬──────────────────────────────────────────────────────────┘
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  malika-llm-proxy (PM2, :3031) — OWNS ALL FALLBACK              │
│                                                                 │
│  model starts with "gemini-*":                                  │
│    └─ Google Generative AI API                                  │
│         └─ round-robin across 10 keys, skip 429/403             │
│         └─ if all 10 fail → handleAnthropic fallback            │
│              (proxy line 270: fallbackModel='claude-sonnet-4-6')│
│                                                                 │
│  model starts with "claude-*":                                  │
│    └─ Anthropic SDK with OAuth token + identity headers         │
│                                                                 │
│  Returns OpenAI-compatible chunked response (SSE) or 503        │
└──────┬──────────────────────────────────────────────────────────┘
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  openaiClient returns Response                                  │
│  monolith pipes resp.body through its SSE parser                │
│  → emit 'text' events to frontend                               │
│  → finalize with 'malika_ui' + 'done'                           │
└─────────────────────────────────────────────────────────────────┘
```

### Data-flow invariants

1. **One egress.** Every in-scope LLM request leaves via `127.0.0.1:3031`. No path skips the proxy.
2. **Model is a string, not a policy.** Once `openaiClient.chat()` is called, the model name is opaque bytes to the client.
3. **Fallback lives in exactly one place — the proxy.** The client retries the same model on transient errors; it does not switch models.
4. **Abort propagates end-to-end.** `req.on('close')` → `AbortController` → `signal` → `fetch` and `abortableSleep`.
5. **Frontend override is trusted but validated.** Unknown model strings produce a proxy 400; no silent substitution.

## Error handling

### Failure taxonomy

| # | Failure | Caught by | Retry? | User-visible outcome |
|---|---|---|---|---|
| 1 | Network error (proxy unreachable, ECONNREFUSED) | `openaiClient` | 2× exp. backoff | SSE `error`: `'LLM service unavailable'`; `res.end()` |
| 2 | Proxy 5xx (upstream provider down) | `openaiClient` | 2× exp. backoff | Same as #1 |
| 3 | Proxy 429 (all providers rate-limited) | `openaiClient` | 2× with backoff | Same as #1 |
| 4 | Proxy 400 (bad model, malformed body) | `openaiClient` | No — client error | SSE `error`: `'Invalid LLM request'`; details logged server-side only |
| 5 | Proxy 503 (both providers failing) | `openaiClient` | No | SSE `error`; circuit breaker opens |
| 6 | Circuit breaker open before call | `openaiClient` throws `CIRCUIT_OPEN` | No | SSE `error`: `'LLM temporarily unavailable, try again in ${retryAfter}s'` |
| 7 | Client disconnect mid-stream | Controller `req.on('close')` → abort | No | Server logs `aborted`; retries stop via `abortableSleep(signal)` |
| 8 | Timeout (30 s default) | `fetchWithTimeout` | Becomes network error, enters retry loop | Same as #1 after final timeout |
| 9 | Invalid frontend `model` override | Proxy 400 (class #4) | No | Handled as #4 |
| 10 | Streaming body aborts mid-stream | Monolith's SSE parser `for await` loop | No mid-stream retry | Partial tokens already sent; emit `error`; `saveAssistantMessage({ partial: true })` |

### `openaiClient.chat()` error contract

Rejects with an `Error` whose shape callers can inspect:

```js
{
  name: 'Error',
  message: string,
  code?: 'CIRCUIT_OPEN' | 'ABORT' | 'TIMEOUT' | 'HTTP_<status>',
  status?: number,       // when HTTP_*
  retryAfter?: number,   // when CIRCUIT_OPEN
}
```

Callers never need to know URL, headers, retry, or breaker. They catch one error and emit one SSE `error` event.

### Silent-failure fixes

Three spots the current code swallows errors; the refactor fixes all three:

1. **Monolith line 88 hardcoded URL.** After refactor, `.env` misconfiguration surfaces at `config.js:140` (existing URL validator) as a boot error instead of silently hitting `api.openai.com`.
2. **`streaming.service.js:4791`** — raw fetch with no retry/breaker. Routed through `openaiClient.chat()`, so retries and breaker apply uniformly.
3. **`chatPreview.service.js:472, 512`** — Gemini-direct fallback that bypasses the proxy. Replaced with `openaiClient.chat()`; we fail cleanly when the proxy is unreachable.

### Logging and fail-fast

- Each `openaiClient.chat()` call logs once on success (model, tokens, latency) and once on final failure (model, `error.code`, attempts). No API keys, no message contents.
- On startup, log one `INFO` with the resolved `OPENAI.API_URL` and whether `OPENAI.API_KEY` is set (as a boolean, not the value). Deploys can confirm the backend is pointed at the proxy without leaking secrets.

## Testing

### 1. Unit — new surface area (Jest, fast)

Two new files under `backend/__tests__/chat/streaming/`:

**`openaiClient.chat.test.js`** — mock `fetch`:
- `chat({ model, messages })` POSTs to `OPENAI.API_URL` with correct body shape.
- `stream: true` forwards `stream: true` in body and returns `Response` with consumable `body`.
- `signal` forwarded to underlying `fetch`.
- Error classification: 400 → `code: 'HTTP_400'`, no retry; 5xx → retries configured times; `CIRCUIT_OPEN` surfaces with `retryAfter`.
- `apiKey` / `extraHeaders` override defaults.
- Tokenizer metrics recorded on success AND failure.

**`modelRouter.modelForTier.test.js`** — pure function:
- Each built-in tier returns its expected default.
- `MODEL_<TIER>` env override wins over default.
- Unknown tier returns `claude-sonnet-4-6`.

### 2. Regression — existing suites

```
cd backend && npx jest --passWithNoTests --no-coverage
```

Expected: **191/191** still pass; the known-failing `integration/chat.test.js` stays known-failing per memory; any new red is a blocker.

### 3. Integration — proxy roundtrip (manual)

Before touching the monolith, verify the proxy answers the contract:

```bash
# Gemini path
curl -s http://127.0.0.1:3031/v1/chat/completions \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $OPENAI_API_KEY_CHAT" \
  -d '{"model":"gemini-3-flash-preview","messages":[{"role":"user","content":"ping"}]}'

# Claude path
curl … -d '{"model":"claude-sonnet-4-6","messages":[…]}'

# Unknown model (expect 400)
curl … -d '{"model":"gpt-4o","messages":[…]}'
```

All three behave as expected before we ship.

### 4. End-to-end — accuracy unchanged

```bash
bash backend/evals/master-test-runner.sh            # 81 cases
node scripts/test-deep-document.js                  # 21 cases, baseline 20/21
```

Pass criteria: ≥ 80/81 on master; ≥ 19/21 on deep-doc (one-case tolerance for LLM variance, matches memory baseline).

### 5. Smoke — live SSE in a browser

1. `pm2 reload pds-backend --update-env`.
2. Open `malika.bpsmalut.com`, send one message per tier:
   - Greeting: "halo" → Gemini-flash, sub-2s first token.
   - Simple: "apa itu IPM" → Gemini-flash, < 5s to `done`.
   - Complex: "berapa kemiskinan di Halmahera Tengah 2024" → Claude Sonnet, data preview rendered.
   - Deep: multi-hop question → Claude Sonnet; no regression on event stream.
3. Verify `pm2 logs malika-llm-proxy`: requests arrive, model routing decisions log as expected.
4. Switch frontend model selector to Haiku, send a message, confirm proxy logs show `model: claude-haiku-4-5-20251001`.

### Rollback plan

Revert the merge commit. No migrations, no schema, no data. `.env` stays as-is. Cost is one `git revert && pm2 reload`.

### Not tested

- V2 pipeline behavior — still dead code after this refactor.
- `services/ai/*` callers — out of Approach-B scope.
- Proxy internals — covered by the proxy's own tests.

## Open questions

None. Design is ready for implementation planning.
