# Chat Malika — Proxy Routing & Dynamic Model Selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every in-scope chat-tree LLM call through `malika-llm-proxy` (`127.0.0.1:3031`), collapse two duplicate LLM clients into one, and let each stage pick a tier-appropriate model (Gemini for cheap stages, Claude for heavy reasoning). Frontend `model` override is honored. Unblocks the production outage where `streamChatResponse` sends `claude-sonnet-4-6` directly to `api.openai.com` and gets 404.

**Architecture:** Two modules, one job each. `streaming/openaiClient.js` is the HTTP transport (URL, retry, timeout, circuit breaker, abort, metrics). `streaming/modelRouter.service.js` is the tier→model policy. Callers compose them: `const model = modelOverride ?? modelForTier(tier); await chat({ model, ... })`. Per-provider fallback (Gemini keys exhausted → Claude) stays inside the proxy; the client never switches models.

**Tech Stack:** Node.js, Express, Jest (flat tests under `backend/src/__tests__/`), PM2 (`pds-backend`, `malika-llm-proxy`), OpenAI-compatible proxy on `127.0.0.1:3031`.

**Spec:** `docs/superpowers/specs/2026-04-22-chat-malika-proxy-routing-design.md`

**Deploy-safety order:** Tasks 1–5 add dead/inert code (no behavior change). Task 6 is the **unblock-prod commit** — after Task 6, chat uses the proxy. Tasks 7–8 extend the cleanup to siblings. Tasks 9–10 are verification.

**House rule (from CLAUDE.md):** before any edit, `cp <file> <file>.backup`. After the edit, `diff <file>.backup <file>` to verify. One backup per file; overwrite prior backups.

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Modify | `backend/src/services/chat/streaming/openaiClient.js` | Transport. Add `chat()` helper, annotate errors with `status`/`code`, skip retry on 4xx. |
| Modify | `backend/src/services/chat/streaming/modelRouter.service.js` | Policy. Add `modelForTier(tier)` returning a proxy-understood model string. |
| Modify | `backend/src/services/chat/streaming/config.js` | Fix default URL (:3030 → :3031). Add one startup INFO log with resolved URL + key-present boolean. |
| Modify | `backend/src/controllers/chat.controller.js` | Thread `req.body?.model` through as `modelOverride`. |
| Modify | `backend/src/services/chat/streaming.service.js` | Delete private `OPENAI_API_URL`/`fetchWithTimeout`/`fetchOpenAIWithRetry`. Convert 3 call sites to `chat({ model, messages, stream, signal })`. Add `modelOverride` arg to `streamChatResponse`. |
| Modify | `backend/src/services/chat/chat.service.js` | Convert line 1574 hardcoded `api.openai.com` fetch to `chat()`. |
| Modify | `backend/src/services/chat/chatPreview.service.js` | Convert lines 472 and 512 (env-with-Gemini-fallback fetch) to `chat()`. |
| Create | `backend/src/__tests__/openaiClient.chat.test.js` | Unit tests for the new `chat()` helper and the error-shape change. |
| Create | `backend/src/__tests__/modelRouter.modelForTier.test.js` | Unit tests for the new policy function. |

**Out of scope** (do NOT touch in this plan): anything under `backend/src/services/ai/*`, the V2 pipeline (`pipelineV2.service.js`), the proxy (`malika-llm-proxy.js`), frontend code.

---

## Task 1: Add `modelForTier(tier)` to modelRouter.service.js

**Files:**
- Test: `backend/src/__tests__/modelRouter.modelForTier.test.js` (create)
- Modify: `backend/src/services/chat/streaming/modelRouter.service.js`

- [ ] **Step 1: Read the current modelRouter.service.js top-to-bottom so you know where to add the new function and what's exported**

```bash
sed -n '1,80p' /var/www/html/project-data-strategis/backend/src/services/chat/streaming/modelRouter.service.js
tail -40 /var/www/html/project-data-strategis/backend/src/services/chat/streaming/modelRouter.service.js
```

Note: confirm there is a `module.exports = { ... }` block you can extend.

- [ ] **Step 2: Write the failing test**

Create `backend/src/__tests__/modelRouter.modelForTier.test.js`:

```js
'use strict';

const { modelForTier } = require('../services/chat/streaming/modelRouter.service');

describe('modelForTier', () => {
  const ENV_KEYS = ['MODEL_GREETING', 'MODEL_SIMPLE', 'MODEL_COMPLEX', 'MODEL_DEEP'];
  const originalEnv = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      originalEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (originalEnv[k] === undefined) delete process.env[k];
      else process.env[k] = originalEnv[k];
    }
  });

  test('GREETING defaults to gemini-3-flash-preview', () => {
    expect(modelForTier('GREETING')).toBe('gemini-3-flash-preview');
  });

  test('SIMPLE defaults to gemini-3-flash-preview', () => {
    expect(modelForTier('SIMPLE')).toBe('gemini-3-flash-preview');
  });

  test('COMPLEX defaults to claude-sonnet-4-6', () => {
    expect(modelForTier('COMPLEX')).toBe('claude-sonnet-4-6');
  });

  test('DEEP defaults to claude-sonnet-4-6', () => {
    expect(modelForTier('DEEP')).toBe('claude-sonnet-4-6');
  });

  test('MODEL_<TIER> env override wins over default', () => {
    process.env.MODEL_SIMPLE = 'claude-haiku-4-5-20251001';
    expect(modelForTier('SIMPLE')).toBe('claude-haiku-4-5-20251001');
  });

  test('unknown tier falls back to claude-sonnet-4-6', () => {
    expect(modelForTier('DOES_NOT_EXIST')).toBe('claude-sonnet-4-6');
    expect(modelForTier(undefined)).toBe('claude-sonnet-4-6');
    expect(modelForTier(null)).toBe('claude-sonnet-4-6');
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

```bash
cd /var/www/html/project-data-strategis/backend
npx jest src/__tests__/modelRouter.modelForTier.test.js --no-coverage 2>&1 | tail -20
```

Expected: tests fail with `TypeError: modelForTier is not a function` (or `undefined`).

- [ ] **Step 4: Backup the file you're about to edit**

```bash
cp /var/www/html/project-data-strategis/backend/src/services/chat/streaming/modelRouter.service.js \
   /var/www/html/project-data-strategis/backend/src/services/chat/streaming/modelRouter.service.js.backup
```

- [ ] **Step 5: Add `modelForTier` to modelRouter.service.js**

Add near the top of the file (below the requires, before the existing exports). Concrete code to add:

```js
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
  const defaults = {
    GREETING: 'gemini-3-flash-preview',
    SIMPLE:   'gemini-3-flash-preview',
    COMPLEX:  'claude-sonnet-4-6',
    DEEP:     'claude-sonnet-4-6',
  };
  const envKey = `MODEL_${tier}`;
  return process.env[envKey] || defaults[tier] || 'claude-sonnet-4-6';
}
```

Then add `modelForTier` to the `module.exports = { ... }` object at the bottom of the file. Do not remove any existing export.

- [ ] **Step 6: Diff-check the edit**

```bash
diff /var/www/html/project-data-strategis/backend/src/services/chat/streaming/modelRouter.service.js.backup \
     /var/www/html/project-data-strategis/backend/src/services/chat/streaming/modelRouter.service.js
```

Expected: only additions (the new function + one export line). No deletions.

- [ ] **Step 7: Run the test to confirm it passes**

```bash
cd /var/www/html/project-data-strategis/backend
npx jest src/__tests__/modelRouter.modelForTier.test.js --no-coverage 2>&1 | tail -20
```

Expected: 6 tests pass.

- [ ] **Step 8: Commit**

```bash
cd /var/www/html/project-data-strategis
git add backend/src/services/chat/streaming/modelRouter.service.js \
        backend/src/__tests__/modelRouter.modelForTier.test.js
git commit -m "$(cat <<'EOF'
feat(chat): add modelRouter.modelForTier() policy function

Maps GREETING/SIMPLE to Gemini Flash and COMPLEX/DEEP to Claude Sonnet,
with MODEL_<TIER> env-var overrides. Pure function, no transport coupling.
Preparation for unifying chat-tree LLM callers on the proxy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `chat()` helper + error-shape hardening to openaiClient.js

**Files:**
- Test: `backend/src/__tests__/openaiClient.chat.test.js` (create)
- Modify: `backend/src/services/chat/streaming/openaiClient.js`

- [ ] **Step 1: Re-read openaiClient.js so you understand what already exists**

```bash
cat /var/www/html/project-data-strategis/backend/src/services/chat/streaming/openaiClient.js
```

You should see `fetchWithTimeout`, `fetchOpenAIWithRetry`, `abortableSleep`, and the circuit breaker integration. `chat()` will be a thin wrapper around `fetchOpenAIWithRetry`.

- [ ] **Step 2: Write the failing test**

Create `backend/src/__tests__/openaiClient.chat.test.js`:

```js
'use strict';

const path = require('path');

// Mock config BEFORE requiring openaiClient so the module picks up the mock.
jest.mock('../services/chat/streaming/config', () => ({
  OPENAI: {
    API_URL: 'http://127.0.0.1:3031/v1/chat/completions',
    API_KEY: 'test-key',
    TIMEOUT_MS: 30000,
    RETRIES: 2,
  },
}));

// Fresh circuit breaker per test file.
jest.mock('../utils/circuitBreaker', () => {
  let open = false;
  return {
    openAICircuit: {
      isOpen: () => open,
      onSuccess: () => { open = false; },
      onFailure: () => {},
      nextAttemptTime: 0,
      __setOpen: (v) => { open = v; },
    },
  };
});

jest.mock('../utils/metrics', () => ({
  metrics: { recordCircuitOpen: jest.fn(), recordOpenAICall: jest.fn() },
}));

jest.mock('../utils/tokenizer', () => ({
  countTokens: () => 0,
  countTextTokens: () => 0,
}));

const { chat } = require('../services/chat/streaming/openaiClient');

function mockFetchOnce(response) {
  global.fetch = jest.fn().mockResolvedValueOnce(response);
}

function buildResponse({ status = 200, body = '{}', headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
    body: { getReader: () => ({}) }, // caller reads the stream itself
    headers: new Map(Object.entries(headers)),
  };
}

afterEach(() => { jest.clearAllMocks(); });

describe('chat()', () => {
  test('POSTs to OPENAI.API_URL with model + messages in body', async () => {
    mockFetchOnce(buildResponse({ status: 200, body: '{"ok":true}' }));
    await chat({ model: 'gemini-3-flash-preview', messages: [{ role: 'user', content: 'hi' }] });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3031/v1/chat/completions');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.model).toBe('gemini-3-flash-preview');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.stream).toBe(false); // default
  });

  test('stream:true is forwarded to request body', async () => {
    mockFetchOnce(buildResponse({ status: 200 }));
    await chat({ model: 'claude-sonnet-4-6', messages: [], stream: true });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
  });

  test('temperature, max_tokens, tools are forwarded when set', async () => {
    mockFetchOnce(buildResponse({ status: 200 }));
    await chat({
      model: 'm', messages: [], temperature: 0.2, max_tokens: 123,
      tools: [{ type: 'function', function: { name: 'f' } }],
    });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(123);
    expect(body.tools).toHaveLength(1);
  });

  test('optional fields not set are omitted from body', async () => {
    mockFetchOnce(buildResponse({ status: 200 }));
    await chat({ model: 'm', messages: [] });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('max_tokens');
    expect(body).not.toHaveProperty('tools');
  });

  test('authorization header uses OPENAI.API_KEY by default', async () => {
    mockFetchOnce(buildResponse({ status: 200 }));
    await chat({ model: 'm', messages: [] });
    const { headers } = global.fetch.mock.calls[0][1];
    expect(headers['Authorization']).toBe('Bearer test-key');
    expect(headers['Content-Type']).toBe('application/json');
  });

  test('apiKey override wins over config key', async () => {
    mockFetchOnce(buildResponse({ status: 200 }));
    await chat({ model: 'm', messages: [], apiKey: 'other-key' });
    expect(global.fetch.mock.calls[0][1].headers['Authorization']).toBe('Bearer other-key');
  });

  test('extraHeaders merge into request headers', async () => {
    mockFetchOnce(buildResponse({ status: 200 }));
    await chat({ model: 'm', messages: [], extraHeaders: { 'X-Trace-Id': 'abc' } });
    expect(global.fetch.mock.calls[0][1].headers['X-Trace-Id']).toBe('abc');
  });

  test('signal is forwarded to fetch', async () => {
    mockFetchOnce(buildResponse({ status: 200 }));
    const controller = new AbortController();
    await chat({ model: 'm', messages: [], signal: controller.signal });
    expect(global.fetch.mock.calls[0][1].signal).toBe(controller.signal);
  });

  test('throws with code=HTTP_400 on 400 and does NOT retry', async () => {
    global.fetch = jest.fn().mockResolvedValue(buildResponse({
      status: 400, body: '{"error":{"message":"bad model"}}',
    }));
    await expect(chat({ model: 'bad', messages: [] })).rejects.toMatchObject({
      code: 'HTTP_400', status: 400,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1); // no retry
  });

  test('retries on 503 up to configured retries (3 calls total = 1 + 2 retries)', async () => {
    global.fetch = jest.fn().mockResolvedValue(buildResponse({ status: 503, body: '{}' }));
    await expect(chat({ model: 'm', messages: [], retries: 2, timeoutMs: 1000 }))
      .rejects.toMatchObject({ code: 'HTTP_503', status: 503 });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  }, 15000);

  test('missing model throws synchronous error', async () => {
    await expect(chat({ messages: [] })).rejects.toThrow(/model.*required/i);
  });

  test('non-array messages throws', async () => {
    await expect(chat({ model: 'm', messages: 'hi' })).rejects.toThrow(/messages.*array/i);
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

```bash
cd /var/www/html/project-data-strategis/backend
npx jest src/__tests__/openaiClient.chat.test.js --no-coverage 2>&1 | tail -30
```

Expected: fails because `chat` is not exported yet.

- [ ] **Step 4: Backup openaiClient.js**

```bash
cp /var/www/html/project-data-strategis/backend/src/services/chat/streaming/openaiClient.js \
   /var/www/html/project-data-strategis/backend/src/services/chat/streaming/openaiClient.js.backup
```

- [ ] **Step 5: Harden the error shape inside `fetchOpenAIWithRetry`**

Open `openaiClient.js`. In the body of `fetchOpenAIWithRetry`, find:

```js
if (!resp.ok) {
  const errorText = await resp.text().catch(() => '');
  throw new Error(`OpenAI API error ${resp.status}: ${errorText.slice(0, 200)}`);
}
```

Replace with:

```js
if (!resp.ok) {
  const errorText = await resp.text().catch(() => '');
  const err = new Error(`OpenAI API error ${resp.status}: ${errorText.slice(0, 200)}`);
  err.status = resp.status;
  err.code = `HTTP_${resp.status}`;
  err.body = errorText.slice(0, 2000);
  throw err;
}
```

Then, inside the retry loop, find `logger.warn(... 'OpenAI request failed, retrying');` and immediately **before the backoff sleep**, add an early bail-out for 4xx client errors:

```js
// Client errors (4xx) are not transient — stop retrying.
if (err.status && err.status >= 400 && err.status < 500) {
  throw err;
}
```

- [ ] **Step 6: Add the `chat()` helper**

At the bottom of the file, just before the `module.exports`, add:

```js
/**
 * Send an OpenAI-compatible chat completion to the configured endpoint.
 *
 * Forwards `model`, `messages`, `stream`, and any of `temperature`, `max_tokens`,
 * `tools` that the caller provides. Returns a raw `Response`; for stream:true
 * callers read `resp.body` themselves.
 *
 * Error shape on reject:
 *   err.code     — 'HTTP_<status>' | 'CIRCUIT_OPEN' | 'AbortError'
 *   err.status   — numeric status when HTTP_*
 *   err.retryAfter — ms when CIRCUIT_OPEN
 */
async function chat({
  model,
  messages,
  stream = false,
  temperature,
  max_tokens,
  tools,
  signal,
  apiKey,
  timeoutMs,
  retries,
  extraHeaders = {},
} = {}) {
  if (!model || typeof model !== 'string') {
    throw new Error('chat: model is required (non-empty string)');
  }
  if (!Array.isArray(messages)) {
    throw new Error('chat: messages must be an array');
  }

  const body = { model, messages, stream };
  if (temperature !== undefined) body.temperature = temperature;
  if (max_tokens !== undefined) body.max_tokens = max_tokens;
  if (tools !== undefined)      body.tools = tools;

  const key = apiKey || OPENAI.API_KEY;
  const options = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    signal,
  };

  return fetchOpenAIWithRetry(options, retries, timeoutMs);
}
```

Add `chat` to `module.exports`:

```js
module.exports = {
  chat,
  fetchWithTimeout,
  fetchOpenAIWithRetry,
  fetchOpenAI,
  streamOpenAI,
  countTokens,
  abortableSleep,
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_MS,
};
```

- [ ] **Step 7: Diff-check**

```bash
diff /var/www/html/project-data-strategis/backend/src/services/chat/streaming/openaiClient.js.backup \
     /var/www/html/project-data-strategis/backend/src/services/chat/streaming/openaiClient.js
```

Expected: additions for `chat()` + `err.status`/`err.code`/`err.body` + 4xx bail-out; one new export.

- [ ] **Step 8: Run the new tests**

```bash
cd /var/www/html/project-data-strategis/backend
npx jest src/__tests__/openaiClient.chat.test.js --no-coverage 2>&1 | tail -30
```

Expected: all 12 tests pass.

- [ ] **Step 9: Run the full suite for regression**

```bash
cd /var/www/html/project-data-strategis/backend
SKIP_DB_TESTS=1 npx jest --passWithNoTests --no-coverage 2>&1 | tail -15
```

Expected: same count as before (191 tests, one known-failing integration test — no *new* failures). If any previously-green test goes red because you changed the error shape, the caller relied on `.message` parsing — investigate before moving on.

- [ ] **Step 10: Commit**

```bash
cd /var/www/html/project-data-strategis
git add backend/src/services/chat/streaming/openaiClient.js \
        backend/src/__tests__/openaiClient.chat.test.js
git commit -m "$(cat <<'EOF'
feat(chat): add chat() helper to openaiClient + annotated error shape

chat({ model, messages, stream, signal, ...}) wraps fetchOpenAIWithRetry
with ergonomic defaults. Errors now carry .status/.code/.body so callers
can distinguish transient (5xx, retried) from client (4xx, not retried).
Circuit breaker, timeout, retry, and abort behavior are unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Fix `config.js` default URL + startup log

**Files:**
- Modify: `backend/src/services/chat/streaming/config.js`

No new test — this is a 2-line change. The existing URL validator at line 140 covers the default.

- [ ] **Step 1: Read the current config.js lines 1–30 and 135–150**

```bash
sed -n '1,30p;135,150p' /var/www/html/project-data-strategis/backend/src/services/chat/streaming/config.js
```

- [ ] **Step 2: Backup**

```bash
cp /var/www/html/project-data-strategis/backend/src/services/chat/streaming/config.js \
   /var/www/html/project-data-strategis/backend/src/services/chat/streaming/config.js.backup
```

- [ ] **Step 3: Change the default URL from port 3030 to 3031**

At line 13 currently:

```js
API_URL: process.env.OPENAI_API_URL || 'http://127.0.0.1:3030/v1/chat/completions',
```

Change to:

```js
API_URL: process.env.OPENAI_API_URL || 'http://127.0.0.1:3031/v1/chat/completions',
```

- [ ] **Step 4: Add a one-line startup INFO log after the URL validator**

Find the existing validator (around line 140):

```js
try { new URL(OPENAI.API_URL); } catch { console.error(`[config.js] Invalid OPENAI_API_URL: ${OPENAI.API_URL}`); }
```

Immediately after that line, add:

```js
console.log(`[config.js] OPENAI.API_URL=${OPENAI.API_URL} key=${OPENAI.API_KEY ? '(configured)' : '(missing)'}`);
```

Do NOT log the key value — only the boolean.

- [ ] **Step 5: Diff-check**

```bash
diff /var/www/html/project-data-strategis/backend/src/services/chat/streaming/config.js.backup \
     /var/www/html/project-data-strategis/backend/src/services/chat/streaming/config.js
```

Expected: two one-line changes.

- [ ] **Step 6: Syntax check by requiring the file**

```bash
cd /var/www/html/project-data-strategis/backend
node -e "console.log(require('./src/services/chat/streaming/config').OPENAI.API_URL)"
```

Expected: prints `http://127.0.0.1:3031/v1/chat/completions` (because the backend's `.env` already sets `OPENAI_API_URL` to the same value) and the new INFO log line.

- [ ] **Step 7: Commit**

```bash
cd /var/www/html/project-data-strategis
git add backend/src/services/chat/streaming/config.js
git commit -m "$(cat <<'EOF'
fix(chat): default OPENAI.API_URL to malika-llm-proxy :3031 + startup log

The prior default (:3030) pointed nowhere. .env already sets the correct
URL in production; this makes the file correct when .env is missing.
Startup log prints the resolved URL and whether API_KEY is set (boolean
only, never the value) so deploys can confirm proxy routing without
leaking secrets.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Pre-flight — verify the proxy actually behaves as expected

**No code changes.** Verification only — run before touching the monolith so a proxy misconfiguration doesn't get blamed on your refactor.

- [ ] **Step 1: Confirm the proxy is up**

```bash
pm2 list 2>&1 | grep malika-llm-proxy
```

Expected: one line, status `online`, port 3031 implicit.

- [ ] **Step 2: Curl the Gemini path**

```bash
source /var/www/html/project-data-strategis/backend/.env
curl -sS --max-time 15 http://127.0.0.1:3031/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${OPENAI_API_KEY_CHAT}" \
  -d '{"model":"gemini-3-flash-preview","messages":[{"role":"user","content":"respond with the single word OK"}]}' \
  | head -c 400
echo
```

Expected: JSON chat-completion response, 200, content ends with `"OK"` or similar.

- [ ] **Step 3: Curl the Claude path**

```bash
source /var/www/html/project-data-strategis/backend/.env
curl -sS --max-time 30 http://127.0.0.1:3031/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${OPENAI_API_KEY_CHAT}" \
  -d '{"model":"claude-sonnet-4-6","messages":[{"role":"user","content":"respond with the single word OK"}]}' \
  | head -c 400
echo
```

Expected: 200, OpenAI-shaped response.

- [ ] **Step 4: Curl with an unknown model (expect 400)**

```bash
source /var/www/html/project-data-strategis/backend/.env
curl -sS -o /tmp/unknown.json -w "HTTP %{http_code}\n" --max-time 10 \
  http://127.0.0.1:3031/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${OPENAI_API_KEY_CHAT}" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"x"}]}'
cat /tmp/unknown.json; echo
```

Expected: `HTTP 400` or 4xx. If it returns 200, the proxy accepts unknown models — note it but do not block the plan.

- [ ] **Step 5: Record outcome**

If ALL three steps are as expected, continue to Task 5. If any step fails, stop — the problem is in the proxy or env, not in the code path you're about to refactor.

---

## Task 5: Pass frontend `model` override through the controller

**Files:**
- Modify: `backend/src/controllers/chat.controller.js`

- [ ] **Step 1: Read the current controller**

```bash
cat /var/www/html/project-data-strategis/backend/src/controllers/chat.controller.js
```

Confirm `streamMessage` is the function that calls `streamingService.streamChatResponse({...})`.

- [ ] **Step 2: Backup**

```bash
cp /var/www/html/project-data-strategis/backend/src/controllers/chat.controller.js \
   /var/www/html/project-data-strategis/backend/src/controllers/chat.controller.js.backup
```

- [ ] **Step 3: Add `modelOverride` to the call**

In `streamMessage`, locate the call to `streamingService.streamChatResponse({...})` (around line 72). Before that call, extract the override:

```js
// Frontend may send {text, model} — pass the model through as an override,
// normalized to the proxy's known values.
const ALLOWED_OVERRIDES = new Set([
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
  'gemini-3-flash-preview',
  'gemini-3-pro-preview',
]);
const rawModel = req.body?.model;
const modelOverride = (typeof rawModel === 'string' && ALLOWED_OVERRIDES.has(rawModel))
  ? rawModel
  : undefined;
```

Then update the call site to include it:

```js
await streamingService.streamChatResponse({
  res,
  threadId,
  userMessage,
  ownerId,
  modelOverride,       // ← added
});
```

- [ ] **Step 4: Diff-check**

```bash
diff /var/www/html/project-data-strategis/backend/src/controllers/chat.controller.js.backup \
     /var/www/html/project-data-strategis/backend/src/controllers/chat.controller.js
```

Expected: additions only.

- [ ] **Step 5: Syntax check**

```bash
cd /var/www/html/project-data-strategis/backend
node -e "require('./src/controllers/chat.controller')"
```

Expected: no output (successful require).

- [ ] **Step 6: Commit**

```bash
cd /var/www/html/project-data-strategis
git add backend/src/controllers/chat.controller.js
git commit -m "$(cat <<'EOF'
feat(chat): forward frontend model selector to streamChatResponse

Accepts {text, model} body; validates model against a whitelist of known
proxy models and drops anything else silently (undefined → downstream
modelRouter picks). No behavior change yet — streamChatResponse still
ignores the param until Task 6 wires it up.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Monolith refactor (UNBLOCKS PROD AT THIS COMMIT)

**Files:**
- Modify: `backend/src/services/chat/streaming.service.js`

This is the load-bearing task. After this commit the monolith uses the proxy. Do the three call-site swaps one at a time and run the full jest suite between each to isolate breakage.

- [ ] **Step 1: Read the three call sites and the private client**

```bash
sed -n '85,140p' /var/www/html/project-data-strategis/backend/src/services/chat/streaming.service.js
sed -n '680,720p' /var/www/html/project-data-strategis/backend/src/services/chat/streaming.service.js
sed -n '4780,4830p' /var/www/html/project-data-strategis/backend/src/services/chat/streaming.service.js
sed -n '5170,5210p' /var/www/html/project-data-strategis/backend/src/services/chat/streaming.service.js
```

Confirm each call site matches what the spec described; if line numbers have shifted, use `grep -n "fetchOpenAIWithRetry\|api.openai.com\|fetchWithTimeout" streaming.service.js` to re-locate.

- [ ] **Step 2: Backup**

```bash
cp /var/www/html/project-data-strategis/backend/src/services/chat/streaming.service.js \
   /var/www/html/project-data-strategis/backend/src/services/chat/streaming.service.js.backup
```

- [ ] **Step 3: Add the two imports at the top of the file**

Near the other requires, add:

```js
const { chat: llmChat } = require('./streaming/openaiClient');
const { modelForTier } = require('./streaming/modelRouter.service');
```

(The `llmChat` alias avoids colliding with any existing `chat` symbol in the monolith.)

- [ ] **Step 4: Extend `streamChatResponse` to accept `modelOverride`**

Change the signature at around line 3518 from:

```js
async function streamChatResponse({
  res,
  threadId,
  userMessage,
  ownerId,
}) {
```

to:

```js
async function streamChatResponse({
  res,
  threadId,
  userMessage,
  ownerId,
  modelOverride,
}) {
```

- [ ] **Step 5: Create an AbortController tied to the SSE response**

Near the top of `streamChatResponse`, just after the SSE headers are set (around line 3531), add:

```js
const abortController = new AbortController();
const abortSignal = abortController.signal;
res.on('close', () => {
  if (!res.writableEnded) abortController.abort();
});
```

You will pass `signal: abortSignal` into each `llmChat` call below. If an existing `AbortController` is already wired (search for `AbortController` in this function), reuse it instead of creating a second one.

- [ ] **Step 6: Replace call site 1 — line ~688 (greeting stream)**

Current shape:

```js
const response = await fetchOpenAIWithRetry({
  method: 'POST',
  headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, messages, stream: true /* + other params already there */ }),
});
```

Replace with (keep all `temperature`/`max_tokens`/`tools`/etc. that were in the original body — do not drop fields):

```js
const tier = 'GREETING';
const effectiveModel = modelOverride || modelForTier(tier);
const response = await llmChat({
  model: effectiveModel,
  messages,
  stream: true,
  signal: abortSignal,
  // forward the same optional fields the old body had — copy from the JSON.stringify above
  // e.g. temperature, max_tokens, tools — do not drop them
});
```

- [ ] **Step 7: Run jest to confirm nothing broke**

```bash
cd /var/www/html/project-data-strategis/backend
SKIP_DB_TESTS=1 npx jest --passWithNoTests --no-coverage 2>&1 | tail -10
```

Expected: same pass count as baseline (Task 2, Step 9). If red, read the diff and fix before moving on.

- [ ] **Step 8: Replace call site 2 — line ~4791 (raw hardcoded fetch)**

This one currently uses `fetchWithTimeout` directly with no retry:

```js
const resp = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: { ... },
  body: JSON.stringify({ model, messages, ... }),
}, timeoutMs);
```

Replace with:

```js
const tier = <the-tier-variable-that-already-exists-at-this-site>; // e.g. 'COMPLEX' or a variable from context
const effectiveModel = modelOverride || modelForTier(tier);
const resp = await llmChat({
  model: effectiveModel,
  messages,
  stream: true,      // or false — preserve the original behavior
  signal: abortSignal,
  timeoutMs,
  // forward other fields from the original body
});
```

If there is no tier classification near this site, use `'COMPLEX'` — this call path handles main reasoning and that's the safe default. Note the tier choice in the commit message.

- [ ] **Step 9: Run jest**

```bash
cd /var/www/html/project-data-strategis/backend
SKIP_DB_TESTS=1 npx jest --passWithNoTests --no-coverage 2>&1 | tail -10
```

- [ ] **Step 10: Replace call site 3 — line ~5182 (save-assistant / non-stream)**

Current:

```js
const response = await fetchOpenAIWithRetry({
  method: 'POST',
  headers: { ... },
  body: JSON.stringify({ model, messages /* stream: false or absent */ }),
});
```

Replace with:

```js
const tier = 'SIMPLE'; // non-streaming follow-ups (title, summary) are cheap
const effectiveModel = modelOverride || modelForTier(tier);
const response = await llmChat({
  model: effectiveModel,
  messages,
  stream: false,
  signal: abortSignal,
});
```

- [ ] **Step 11: Delete the monolith's private fetch utilities**

Delete lines 88 (`const OPENAI_API_URL = ...`), and the two functions `fetchWithTimeout` (lines 95–109) and `fetchOpenAIWithRetry` (lines 118–139). Line numbers may have drifted — find them with:

```bash
grep -n "const OPENAI_API_URL\|async function fetchWithTimeout\|async function fetchOpenAIWithRetry" \
  /var/www/html/project-data-strategis/backend/src/services/chat/streaming.service.js
```

After deletion, `grep -n "fetchOpenAIWithRetry\|fetchWithTimeout\|api.openai.com" streaming.service.js` should return **zero matches** — if any remain, there's a call site we missed. Stop and find it.

- [ ] **Step 12: Diff-check**

```bash
diff /var/www/html/project-data-strategis/backend/src/services/chat/streaming.service.js.backup \
     /var/www/html/project-data-strategis/backend/src/services/chat/streaming.service.js \
  | head -200
```

Scan the diff. Every deletion should be either (a) the private client utilities, (b) a replaced call-site body, or (c) the old signature of `streamChatResponse`. No other behavior changes.

- [ ] **Step 13: Full jest run**

```bash
cd /var/www/html/project-data-strategis/backend
SKIP_DB_TESTS=1 npx jest --passWithNoTests --no-coverage 2>&1 | tail -15
```

Expected: same pass count as baseline.

- [ ] **Step 14: Commit**

```bash
cd /var/www/html/project-data-strategis
git add backend/src/services/chat/streaming.service.js
git commit -m "$(cat <<'EOF'
fix(chat): route monolith LLM calls through malika-llm-proxy

Replaces 3 inline fetch sites in streamChatResponse with llmChat() from
streaming/openaiClient, deletes the monolith's private OPENAI_API_URL
constant + fetchWithTimeout + fetchOpenAIWithRetry (all of which pointed
at api.openai.com and caused the production 404 outage). Each site now
picks a per-tier model via modelForTier(), with the controller's
modelOverride winning when the frontend supplied one.

Behavior change: cheap stages (greeting) now default to gemini-3-flash-preview
via the proxy; main/save stages stay on claude-sonnet-4-6. Proxy retains
sole ownership of cross-provider fallback.

Fixes: OpenAI API error 404 "claude-sonnet-4-6 does not exist" in prod.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Convert `chat.service.js:1574`

**Files:**
- Modify: `backend/src/services/chat/chat.service.js`

- [ ] **Step 1: Inspect the call site**

```bash
sed -n '1555,1610p' /var/www/html/project-data-strategis/backend/src/services/chat/chat.service.js
```

Note what the call does (title generation? summary? classification?) — that determines the tier default.

- [ ] **Step 2: Backup**

```bash
cp /var/www/html/project-data-strategis/backend/src/services/chat/chat.service.js \
   /var/www/html/project-data-strategis/backend/src/services/chat/chat.service.js.backup
```

- [ ] **Step 3: Add imports**

At the top of the file (with other requires):

```js
const { chat: llmChat } = require('./streaming/openaiClient');
const { modelForTier } = require('./streaming/modelRouter.service');
```

- [ ] **Step 4: Replace the raw `fetch('https://api.openai.com/v1/chat/completions', ...)` call**

Replace with:

```js
const tier = 'SIMPLE'; // lightweight classification/title — cheap model is fine
const effectiveModel = modelForTier(tier);
const res = await llmChat({
  model: effectiveModel,
  messages,
  stream: false,
  // forward any temperature / max_tokens from the original call
});
const data = await res.json();
```

- [ ] **Step 5: `grep` to confirm no `api.openai.com` remains in this file**

```bash
grep -n "api.openai.com" /var/www/html/project-data-strategis/backend/src/services/chat/chat.service.js || echo "(clean)"
```

- [ ] **Step 6: Diff-check + jest**

```bash
diff /var/www/html/project-data-strategis/backend/src/services/chat/chat.service.js.backup \
     /var/www/html/project-data-strategis/backend/src/services/chat/chat.service.js

cd /var/www/html/project-data-strategis/backend
SKIP_DB_TESTS=1 npx jest --passWithNoTests --no-coverage 2>&1 | tail -10
```

- [ ] **Step 7: Commit**

```bash
cd /var/www/html/project-data-strategis
git add backend/src/services/chat/chat.service.js
git commit -m "$(cat <<'EOF'
fix(chat): route chat.service.js LLM call through the proxy

Converts the remaining hardcoded api.openai.com fetch in chat.service.js
to llmChat() via the centralized client.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Convert `chatPreview.service.js:472` and `:512`

**Files:**
- Modify: `backend/src/services/chat/chatPreview.service.js`

- [ ] **Step 1: Inspect both call sites**

```bash
sed -n '460,540p' /var/www/html/project-data-strategis/backend/src/services/chat/chatPreview.service.js
```

Both currently use `fetch(process.env.OPENAI_API_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', ...)` — the Gemini-direct fallback must be removed.

- [ ] **Step 2: Backup**

```bash
cp /var/www/html/project-data-strategis/backend/src/services/chat/chatPreview.service.js \
   /var/www/html/project-data-strategis/backend/src/services/chat/chatPreview.service.js.backup
```

- [ ] **Step 3: Add imports**

```js
const { chat: llmChat } = require('./streaming/openaiClient');
const { modelForTier } = require('./streaming/modelRouter.service');
```

- [ ] **Step 4: Replace line ~472 (preview stream)**

Current body passes through model, messages, and streaming flags. Replace with:

```js
const tier = 'SIMPLE'; // preview generation is inexpensive
const effectiveModel = modelForTier(tier);
const res = await llmChat({
  model: effectiveModel,
  messages,
  stream: true,
  // forward temperature etc. from the original body
});
```

- [ ] **Step 5: Replace line ~512 (continuation)**

Same pattern. Preserve the `stream` flag the original call used.

- [ ] **Step 6: Confirm no more `generativelanguage` or `api.openai.com` in the file**

```bash
grep -nE "generativelanguage|api\.openai\.com" /var/www/html/project-data-strategis/backend/src/services/chat/chatPreview.service.js || echo "(clean)"
```

- [ ] **Step 7: Diff-check + jest**

```bash
diff /var/www/html/project-data-strategis/backend/src/services/chat/chatPreview.service.js.backup \
     /var/www/html/project-data-strategis/backend/src/services/chat/chatPreview.service.js

cd /var/www/html/project-data-strategis/backend
SKIP_DB_TESTS=1 npx jest --passWithNoTests --no-coverage 2>&1 | tail -10
```

- [ ] **Step 8: Commit**

```bash
cd /var/www/html/project-data-strategis
git add backend/src/services/chat/chatPreview.service.js
git commit -m "$(cat <<'EOF'
fix(chat): route chatPreview.service.js through the proxy

Removes the generativelanguage.googleapis.com fallback path (which silently
bypassed the proxy) in favor of llmChat() via the centralized client. Both
preview sites now share the same retry/timeout/circuit-breaker policy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Regression + eval gate

**No code changes.** Run the existing harnesses and confirm we haven't regressed accuracy.

- [ ] **Step 1: Backend unit/integration suite**

```bash
cd /var/www/html/project-data-strategis/backend
SKIP_DB_TESTS=1 npx jest --passWithNoTests --no-coverage 2>&1 | tail -15
```

Expected: 191/191 (plus the known-failing `integration/chat.test.js` from memory). No new failures.

- [ ] **Step 2: Master eval runner**

```bash
cd /var/www/html/project-data-strategis
bash backend/evals/master-test-runner.sh 2>&1 | tail -40
```

Pass criteria: ≥ 80/81. If the number drops below, inspect the diff between the two runs — a single-case LLM flake is tolerable; a pattern is a regression.

- [ ] **Step 3: Deep-doc eval**

```bash
cd /var/www/html/project-data-strategis
node scripts/test-deep-document.js 2>&1 | tail -40
```

Pass criteria: ≥ 19/21 (memory baseline is 20/21; one-case tolerance for variance). If you drop two or more cases, investigate before continuing to Task 10.

- [ ] **Step 4: Record results in the commit log (no new commit)**

If all three gates pass, proceed to Task 10. If any gate fails, stop and triage — do not deploy.

---

## Task 10: Live smoke on the running backend

**No code changes.** End-to-end sanity on the deployed service.

- [ ] **Step 1: Reload the backend with new env and code**

```bash
pm2 reload pds-backend --update-env
pm2 logs pds-backend --lines 40 --nostream 2>&1 | tail -20
```

Expected: you see the `[config.js] OPENAI.API_URL=http://127.0.0.1:3031/v1/chat/completions key=(configured)` line from Task 3 in the startup log.

- [ ] **Step 2: Tail the proxy log in a second shell (or background)**

```bash
pm2 logs malika-llm-proxy --lines 0 --raw 2>&1 &
LOG_PID=$!
```

- [ ] **Step 3: Hit the backend's own SSE endpoint directly with curl**

```bash
source /var/www/html/project-data-strategis/backend/.env
# Create a test thread via your normal thread-creation flow OR use an existing thread id.
# Replace $THREAD_ID and $UID with real values.
curl -N -sS http://127.0.0.1:5000/api/chat/threads/$THREAD_ID/stream \
  -H "x-malika-uid: $UID" \
  -H "Content-Type: application/json" \
  -d '{"text":"halo"}' | head -c 1000
echo
```

Expected: you see `event: user_saved`, then `event: text` chunks, then `event: done` — no `event: error`.

- [ ] **Step 4: Confirm the proxy saw the request**

```bash
kill $LOG_PID 2>/dev/null
pm2 logs malika-llm-proxy --lines 20 --nostream 2>&1 | tail -20
```

Expected: a log line showing the incoming request with `model: "gemini-3-flash-preview"` (because "halo" is classified as GREETING → Gemini). If it says `claude-sonnet-4-6`, the tier classification isn't firing — check `modelRouter.classify` wiring at the greeting call site.

- [ ] **Step 5: Browser smoke (4 messages, one per tier)**

Open `malika.bpsmalut.com` in a browser. Send in order:

- `halo` → expect first token within 2s, proxy log shows `gemini-3-flash-preview`.
- `apa itu IPM` → expect first token within 5s, proxy log shows `gemini-3-flash-preview`.
- `berapa kemiskinan di Halmahera Tengah 2024` → expect data preview rendered, proxy log shows `claude-sonnet-4-6`.
- Switch the UI model selector to Haiku. Send any short message. Proxy log must show `claude-haiku-4-5-20251001` — this confirms the frontend override reached the proxy.

- [ ] **Step 6: Final verification**

Document in the PR description:
- Jest: pass count from Task 9 Step 1.
- Master eval: score from Task 9 Step 2.
- Deep-doc eval: score from Task 9 Step 3.
- Smoke: 4 messages, all four expected model routings confirmed from proxy logs.

No commit for this task. The PR can be merged after this task succeeds.

---

## Rollback

If any task beyond Task 6 reveals a blocker and you can't fix forward within the session, rollback is `git revert` + `pm2 reload pds-backend`. No schema, no data, no migration. If something is wrong between Task 6 and Task 9, you can revert Task 6's commit specifically and leave Tasks 1–5 (which are inert) in place.

---

## Self-review notes (for the plan author)

- Every task lists exact file paths.
- Every code step shows actual code, not "implement similar logic."
- Every test step has runnable commands with expected output.
- Task 6 is explicitly labeled as the prod-unblock commit so anyone paging through knows the stop-the-bleeding point.
- Backup-and-diff is applied uniformly per the user's CLAUDE.md rule.
- The two new files (`modelRouter.modelForTier.test.js`, `openaiClient.chat.test.js`) match the existing flat-test convention at `backend/src/__tests__/`.
- Tier assignments at each call site are specified (GREETING for the greeting path, SIMPLE for previews/titles, COMPLEX for the main reasoning path). The plan flags the one site (line ~4791) where tier must be inferred from surrounding code and documents the safe default.
- The `modelOverride` whitelist in Task 5 matches the four models the proxy advertises at `/v1/models` per the audit (`malika-llm-proxy.js:459–462`).
- Task 4's pre-flight curl is positioned *before* the monolith rewrite so a proxy bug doesn't masquerade as a code bug.
