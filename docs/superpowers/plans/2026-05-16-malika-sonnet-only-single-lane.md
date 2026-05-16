# MALIKA Sonnet-only single-lane — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse MALIKA's chat stack to a single LLM lane backed by `claude-sonnet-4-6`, served exclusively through `malika-llm-proxy` (`127.0.0.1:3031`). Remove every "flash" surface from frontend + backend. Close 4 direct-provider HTTP call sites that bypass the proxy.

**Architecture:** No new abstractions. The existing tier classifier in `modelRouter.service.js` keeps running — it now picks `max_tokens`/`thinking_budget` only, while `model` is the constant `'claude-sonnet-4-6'` everywhere. Frontend model picker UI is deleted; the user-facing dropdown was already a lie (proxy ignores `body.model`). Direct provider URLs (`api.openai.com`, `generativelanguage.googleapis.com`) are replaced with `process.env.OPENAI_API_URL` (already points at the proxy) and a startup assertion refuses to boot if `OPENAI_API_URL` ever points off-host.

**Tech Stack:** Node 20, Express, Next.js 16 (admin/PWA), MariaDB 11.8, Jest, PM2. Proxy is `/opt/malika-llm-proxy/src/index.js` (already correct, no changes).

**Spec:** `docs/superpowers/specs/2026-05-16-malika-sonnet-only-single-lane-design.md`

**Project rules to follow throughout:**
- Backup before edit: `cp <file> <file>.backup` (per global CLAUDE.md).
- No `Co-Authored-By` trailer in commit messages.
- Stage with explicit paths (`git add <path>`), never `git add -A` — there are unrelated working-tree changes from other sessions.
- Backend `.js` reload: `pm2 reload pds-backend --update-env`.
- Frontend `.tsx`/`.ts` requires `npm run build` BEFORE `pm2 reload pds-frontend --update-env`.
- Admin same: `cd backend/admin && npm run build && pm2 reload pds-admin --update-env`.

---

## Task 1: Add startup assertion that OPENAI_API_URL is the local proxy

**Why:** Defense in depth (spec §4.4). If someone ever edits `.env` to point at a provider URL, the backend should refuse to start rather than silently bypass the proxy.

**Files:**
- Modify: `backend/src/services/chat/streaming/config.js` (around lines 143-146)

- [ ] **Step 1: Backup the file**

```bash
cp /var/www/html/project-data-strategis/backend/src/services/chat/streaming/config.js \
   /var/www/html/project-data-strategis/backend/src/services/chat/streaming/config.js.backup
```

- [ ] **Step 2: Read the current validation block (lines 143-146)**

It currently logs a warning if `OPENAI.API_URL` is not parseable. We extend it to also enforce that the host is `127.0.0.1` or `localhost` and port is `3031`.

- [ ] **Step 3: Replace the validation block**

Old (around lines 143-146):

```js
// L9: Validate URL configs at startup
try { new URL(OPENAI.API_URL); } catch { console.error(`[config.js] Invalid OPENAI_API_URL: ${OPENAI.API_URL}`); }
try { new URL(INTERNAL_API_BASE); } catch { console.error(`[config.js] Invalid INTERNAL_API_BASE_URL: ${INTERNAL_API_BASE}`); }
console.log(`[config.js] OPENAI.API_URL=${OPENAI.API_URL} key=${OPENAI.API_KEY ? '(configured)' : '(missing)'}`);
```

New:

```js
// L9: Validate URL configs at startup
try { new URL(OPENAI.API_URL); } catch { console.error(`[config.js] Invalid OPENAI_API_URL: ${OPENAI.API_URL}`); }
try { new URL(INTERNAL_API_BASE); } catch { console.error(`[config.js] Invalid INTERNAL_API_BASE_URL: ${INTERNAL_API_BASE}`); }

// Proxy-only rule (2026-05-16): chat traffic must terminate at the local malika-llm-proxy.
// If OPENAI_API_URL ever points off-host, refuse to start — silent provider bypass is worse than a crash.
try {
  const u = new URL(OPENAI.API_URL);
  const okHost = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  const okPort = u.port === '3031';
  if (!okHost || !okPort) {
    console.error(`[config.js] FATAL: OPENAI_API_URL must be 127.0.0.1:3031 (the malika-llm-proxy). Got: ${OPENAI.API_URL}`);
    process.exit(1);
  }
} catch (e) {
  console.error(`[config.js] FATAL: OPENAI_API_URL unparseable: ${e.message}`);
  process.exit(1);
}

console.log(`[config.js] OPENAI.API_URL=${OPENAI.API_URL} key=${OPENAI.API_KEY ? '(configured)' : '(missing)'}`);
```

- [ ] **Step 4: Verify diff vs backup**

```bash
diff /var/www/html/project-data-strategis/backend/src/services/chat/streaming/config.js.backup \
     /var/www/html/project-data-strategis/backend/src/services/chat/streaming/config.js
```

Expected: shows the added block of ~14 lines.

- [ ] **Step 5: Sanity-load the module**

```bash
cd /var/www/html/project-data-strategis/backend && \
  OPENAI_API_URL=http://127.0.0.1:3031/v1/chat/completions \
  node -e "require('./src/services/chat/streaming/config'); console.log('config loaded ok')"
```

Expected: `[config.js] OPENAI.API_URL=http://127.0.0.1:3031/v1/chat/completions key=...` then `config loaded ok`.

- [ ] **Step 6: Negative test — bogus URL should exit 1**

```bash
cd /var/www/html/project-data-strategis/backend && \
  OPENAI_API_URL=https://api.openai.com/v1/chat/completions \
  node -e "require('./src/services/chat/streaming/config')" ; \
  echo "exit=$?"
```

Expected: `FATAL: OPENAI_API_URL must be 127.0.0.1:3031...` and `exit=1`.

- [ ] **Step 7: Commit**

```bash
cd /var/www/html/project-data-strategis && \
git add backend/src/services/chat/streaming/config.js && \
git commit -m "fix(chat): refuse to start if OPENAI_API_URL points off-proxy

Defense in depth for the proxy-only rule. If anyone edits .env to point
at api.openai.com or generativelanguage.googleapis.com, the backend now
crashes with a clear FATAL message instead of silently bypassing the
malika-llm-proxy."
```

---

## Task 2: Migrate `streaming.service.js` callers off `MODEL_TIERS` / `modelForTier`

**Why:** Spec §4.1 #2. There are 3 production call sites in `streaming.service.js` that currently use the `modelForTier(tier)` helper. They must be migrated to the constant `'claude-sonnet-4-6'` BEFORE Task 3 deletes the helper.

**Files:**
- Modify: `backend/src/services/chat/streaming.service.js` (lines 98, 697-698, 4845-4846, 5236-5237)

- [ ] **Step 1: Backup the file**

```bash
cp /var/www/html/project-data-strategis/backend/src/services/chat/streaming.service.js \
   /var/www/html/project-data-strategis/backend/src/services/chat/streaming.service.js.backup
```

- [ ] **Step 2: Update the import on line 98**

Old:

```js
const { modelForTier, MODEL_TIERS } = require('./streaming/modelRouter.service');
```

New:

```js
// (modelForTier/MODEL_TIERS removed 2026-05-16 — single Sonnet lane, no tier-based model selection)
```

- [ ] **Step 3: Update the GREETING call site (lines 697-698)**

Old:

```js
    const tier = MODEL_TIERS.GREETING;
    const effectiveModel = modelOverride || modelForTier(tier);
```

New:

```js
    const effectiveModel = modelOverride || 'claude-sonnet-4-6';
```

- [ ] **Step 4: Update the COMPLEX call site (lines 4845-4846)**

Old:

```js
    const tier = MODEL_TIERS.COMPLEX;
    const effectiveModel = modelOverride || modelForTier(tier);
```

New:

```js
    const effectiveModel = modelOverride || 'claude-sonnet-4-6';
```

- [ ] **Step 5: Update the SIMPLE call site (lines 5236-5237)**

Old:

```js
      const tier = MODEL_TIERS.SIMPLE;
      const effectiveModel = modelForTier(tier);
```

New:

```js
      const effectiveModel = 'claude-sonnet-4-6';
```

- [ ] **Step 6: Confirm no remaining references in the file**

```bash
grep -n -E 'MODEL_TIERS|modelForTier' /var/www/html/project-data-strategis/backend/src/services/chat/streaming.service.js
```

Expected: no output.

- [ ] **Step 7: Module loads cleanly**

```bash
cd /var/www/html/project-data-strategis/backend && \
  OPENAI_API_URL=http://127.0.0.1:3031/v1/chat/completions \
  node -e "require('./src/services/chat/streaming.service'); console.log('streaming.service loads ok')"
```

Expected: ends with `streaming.service loads ok`.

- [ ] **Step 8: Run existing tests**

```bash
cd /var/www/html/project-data-strategis/backend && npx jest --passWithNoTests --no-coverage
```

Expected: no NEW failures vs main. (`integration/chat.test.js` failure is pre-existing per memory; document any other regression.)

- [ ] **Step 9: Commit**

```bash
cd /var/www/html/project-data-strategis && \
git add backend/src/services/chat/streaming.service.js && \
git commit -m "refactor(chat): inline 'claude-sonnet-4-6' in 3 streaming.service callers

Drops the modelForTier()/MODEL_TIERS import. All 3 tier-selection call
sites (GREETING/COMPLEX/SIMPLE) now use the constant directly. Prereq
for deleting modelForTier() in the next commit."
```

---

## Task 3: Strip tier-based model selection from `modelRouter.service.js` + delete dead test

**Why:** Spec §4.1 #1 and #13. After Task 2, nothing imports `modelForTier`/`MODEL_TIERS`. We delete them, hard-code Sonnet in `TIER_CONFIG`, drop the `CHAT_FORCE_MODEL` escape hatch, and add a startup warning for deprecated env vars.

**Files:**
- Modify: `backend/src/services/chat/streaming/modelRouter.service.js`
- Delete: `backend/src/__tests__/modelRouter.modelForTier.test.js`

- [ ] **Step 1: Backup the file**

```bash
cp /var/www/html/project-data-strategis/backend/src/services/chat/streaming/modelRouter.service.js \
   /var/www/html/project-data-strategis/backend/src/services/chat/streaming/modelRouter.service.js.backup
```

- [ ] **Step 2: Replace the leading docstring and tier-helper block (lines 1-52)**

Old (lines 1-52):

```js
/**
 * Model Router Service
 *
 * Dynamically selects the appropriate model and parameters
 * based on query complexity, type, and context signals.
 *
 * Routing tiers (updated 2026-03-18 — Claude Extended Thinking):
 *   GREETING  → claude-sonnet-4-6  (fast, low tokens — or template)
 *   SIMPLE    → claude-sonnet-4-6  (strong reasoning with good prompts)
 *   COMPLEX   → claude-sonnet-4-6  (Extended Thinking enabled, 8K budget)
 *   DEEP      → claude-sonnet-4-6  (Extended Thinking enabled, 16K budget)
 */

'use strict';

const logger = require('../../../utils/logger').child({ service: 'ModelRouter' });
const { OPENAI, FEATURES, CLAUDE_THINKING = {} } = require('./config');

/**
 * Canonical tier names for `modelForTier`. Call sites should import this
 * constant instead of repeating string literals so a typo like `'COMLEX'`
 * is caught by autocomplete rather than falling through to the default.
 */
const MODEL_TIERS = Object.freeze({
  GREETING: 'GREETING',
  SIMPLE:   'SIMPLE',
  COMPLEX:  'COMPLEX',
  DEEP:     'DEEP',
});

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
  // tier arrives uppercase by pipeline convention (GREETING/SIMPLE/COMPLEX/DEEP);
  // anything else falls through to the final claude-sonnet-4-6 fallback.
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

New (replaces the same lines):

```js
/**
 * Model Router Service
 *
 * Picks `max_tokens`, `temperature`, and `thinking_budget` based on query
 * complexity. All tiers use the same model (`claude-sonnet-4-6`) served
 * via the malika-llm-proxy — there is no per-tier model selection.
 *
 * Single-lane decision recorded 2026-05-16 in
 * docs/superpowers/specs/2026-05-16-malika-sonnet-only-single-lane-design.md
 */

'use strict';

const logger = require('../../../utils/logger').child({ service: 'ModelRouter' });
const { FEATURES, CLAUDE_THINKING = {} } = require('./config');

// Deprecated env vars (warn once at module load so misconfig is caught at boot).
{
  const deprecated = ['MODEL_GREETING', 'MODEL_SIMPLE', 'MODEL_COMPLEX', 'MODEL_DEEP', 'CHAT_FORCE_MODEL']
    .filter((k) => process.env[k]);
  if (deprecated.length > 0) {
    logger.warn({ deprecated }, 'Deprecated MODEL_* env var(s) detected — no longer honored. Remove from .env.');
  }
}
```

(Note: also drop `OPENAI` from the destructured `require('./config')` since the file no longer reads it — only `FEATURES` and `CLAUDE_THINKING`.)

- [ ] **Step 3: Hard-code Sonnet in `TIER_CONFIG` (lines 72-109 of original — line numbers shifted after Step 2)**

Find the block:

```js
const TIER_CONFIG = {
  [TIERS.GREETING]: {
    model: process.env.OPENAI_MODEL_CHAT || 'claude-sonnet-4-6',
    ...
  },
  [TIERS.SIMPLE]: {
    model: process.env.OPENAI_MODEL_CHAT || 'claude-sonnet-4-6',
    ...
  },
  [TIERS.COMPLEX]: {
    model: process.env.OPENAI_MODEL_CHAT || 'claude-sonnet-4-6',
    ...
  },
  [TIERS.DEEP]: {
    model: process.env.OPENAI_MODEL_REASONING || 'claude-sonnet-4-6',
    ...
  },
};
```

Replace each `model:` line with the constant:

```js
    model: 'claude-sonnet-4-6',
```

(4 occurrences. Other fields like `max_tokens`, `temperature`, `thinking_budget` stay untouched.)

- [ ] **Step 4: Delete the `CHAT_FORCE_MODEL` branch in `routeModel()` (original lines 172-179)**

Find:

```js
  // ── Force override via env ──
  if (process.env.CHAT_FORCE_MODEL) {
    logger.debug({ forced: process.env.CHAT_FORCE_MODEL }, 'Model forced via env');
    const base = TIER_CONFIG[TIERS.SIMPLE];
    return {
      tier: TIERS.SIMPLE,
      config: { ...base, model: process.env.CHAT_FORCE_MODEL },
    };
  }
```

Delete the entire block.

- [ ] **Step 5: Trim the module exports (original lines 299-308)**

Old:

```js
module.exports = {
  TIERS,
  TIER_CONFIG,
  routeModel,
  buildModelParams,
  isReasoningModel,
  isClaudeModel,
  modelForTier,
  MODEL_TIERS,
};
```

New:

```js
module.exports = {
  TIERS,
  TIER_CONFIG,
  routeModel,
  buildModelParams,
  isReasoningModel,
  isClaudeModel,
};
```

- [ ] **Step 6: Delete the dead test file**

```bash
rm /var/www/html/project-data-strategis/backend/src/__tests__/modelRouter.modelForTier.test.js
```

- [ ] **Step 7: Confirm no stray references anywhere in backend/src**

```bash
grep -rIn -E 'MODEL_TIERS|modelForTier|CHAT_FORCE_MODEL' \
  /var/www/html/project-data-strategis/backend/src 2>/dev/null | grep -v node_modules
```

Expected: no output. (If anything remains, fix it before continuing.)

- [ ] **Step 8: Module loads, warns on deprecated env var**

```bash
cd /var/www/html/project-data-strategis/backend && \
  OPENAI_API_URL=http://127.0.0.1:3031/v1/chat/completions \
  MODEL_GREETING=foo \
  node -e "require('./src/services/chat/streaming/modelRouter.service'); console.log('ok')"
```

Expected: a `[ModelRouter]` warn line listing `MODEL_GREETING`, then `ok`.

- [ ] **Step 9: Module loads quietly without deprecated env**

```bash
cd /var/www/html/project-data-strategis/backend && \
  OPENAI_API_URL=http://127.0.0.1:3031/v1/chat/completions \
  node -e "require('./src/services/chat/streaming/modelRouter.service'); console.log('ok')"
```

Expected: just `ok` (no warning).

- [ ] **Step 10: Jest full run**

```bash
cd /var/www/html/project-data-strategis/backend && npx jest --passWithNoTests --no-coverage
```

Expected: no new failures.

- [ ] **Step 11: Commit**

```bash
cd /var/www/html/project-data-strategis && \
git add backend/src/services/chat/streaming/modelRouter.service.js && \
git add -u backend/src/__tests__/modelRouter.modelForTier.test.js && \
git commit -m "refactor(chat): delete tier-based model selection, hard-code Sonnet

modelForTier()/MODEL_TIERS removed (no callers after the previous
commit). TIER_CONFIG hard-codes 'claude-sonnet-4-6' for all 4 tiers.
CHAT_FORCE_MODEL escape hatch deleted. Module-load warn fires if any
deprecated MODEL_*/CHAT_FORCE_MODEL env var is still set."
```

---

## Task 4: Tighten `ALLOWED_OVERRIDES` whitelist

**Why:** Spec §4.1 #3. The whitelist currently accepts 4 model strings from `req.body.model`. With the single-lane design, only `'claude-sonnet-4-6'` is allowed; everything else silently falls through (no 4xx, protects stale PWA tabs).

**Files:**
- Modify: `backend/src/controllers/chat.controller.js` (lines 76-81)

- [ ] **Step 1: Backup**

```bash
cp /var/www/html/project-data-strategis/backend/src/controllers/chat.controller.js \
   /var/www/html/project-data-strategis/backend/src/controllers/chat.controller.js.backup
```

- [ ] **Step 2: Replace the whitelist (lines 76-81)**

Old:

```js
    const ALLOWED_OVERRIDES = new Set([
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
      'gemini-3-flash-preview',
      'gemini-3-pro-preview',
    ]);
```

New:

```js
    // Single-lane (2026-05-16): only Sonnet via the proxy. Out-of-set strings
    // (e.g., stale PWA tabs sending 'claude-haiku-4-5') silently fall through
    // to the tier-router default — no 4xx, no surprise.
    const ALLOWED_OVERRIDES = new Set(['claude-sonnet-4-6']);
```

- [ ] **Step 3: Verify diff**

```bash
diff /var/www/html/project-data-strategis/backend/src/controllers/chat.controller.js.backup \
     /var/www/html/project-data-strategis/backend/src/controllers/chat.controller.js
```

Expected: 4 lines removed, 4 lines added.

- [ ] **Step 4: Commit**

```bash
cd /var/www/html/project-data-strategis && \
git add backend/src/controllers/chat.controller.js && \
git commit -m "fix(chat): trim ALLOWED_OVERRIDES to claude-sonnet-4-6 only

Stale tabs sending haiku/gemini in body.model fall through silently to
the tier-router default. No user-facing breakage — proxy was already
serving Sonnet regardless of body.model."
```

---

## Task 5: Flip 7 service-default model strings + costTracker + .env.example + test fixture

**Why:** Spec §4.1 #4-10, #11, #12, #14. A batch of trivial string flips. Done as one commit because each change is one line and they all serve the same intent (kill flash defaults).

**Files:**
- Modify: `backend/src/services/chat/persistentMemory.service.js:28`
- Modify: `backend/src/services/ai/tableUnderstanding.service.js:81`
- Modify: `backend/src/services/ai/keywordExtractor.service.js:27`
- Modify: `backend/src/services/ai/reranker.service.js:17`
- Modify: `backend/src/services/ai/documentJudge.service.js:30`
- Modify: `backend/src/services/ai/synonymExpansion.service.js:137`
- Modify: `backend/src/config/search.config.js:102`
- Modify: `backend/src/utils/costTracker.js` (lines 20-23)
- Modify: `backend/.env.example` (lines 47-64)
- Modify: `backend/src/__tests__/openaiClient.chat.test.js` (lines 60, 66)

- [ ] **Step 1: Backup each file**

```bash
for f in \
  backend/src/services/chat/persistentMemory.service.js \
  backend/src/services/ai/tableUnderstanding.service.js \
  backend/src/services/ai/keywordExtractor.service.js \
  backend/src/services/ai/reranker.service.js \
  backend/src/services/ai/documentJudge.service.js \
  backend/src/services/ai/synonymExpansion.service.js \
  backend/src/config/search.config.js \
  backend/src/utils/costTracker.js \
  backend/.env.example \
  backend/src/__tests__/openaiClient.chat.test.js ; do
  cp "/var/www/html/project-data-strategis/$f" "/var/www/html/project-data-strategis/$f.backup"
done
```

- [ ] **Step 2: For each of the 7 services + search.config.js, replace `|| 'gemini-3-flash-preview'` with `|| 'claude-sonnet-4-6'`**

In each file, find the exact pattern and replace. The 7 service occurrences (plus search.config.js = 8 total) all look like:

```js
... process.env.OPENAI_MODEL_<X> || 'gemini-3-flash-preview' ...
```

Replace `'gemini-3-flash-preview'` → `'claude-sonnet-4-6'` at the cited line in each file. Be precise — only that one literal in each file; do not search-and-replace globally.

- [ ] **Step 3: Delete the 3 gemini-flash entries in `costTracker.js` (lines 20-23)**

Old:

```js
  'gemini-3-flash-preview': { input: 0, output: 0, cachedInput: 0 },
  'gemini-2.5-pro':         { input: 0, output: 0, cachedInput: 0 },
  'gemini-2.5-flash':       { input: 0, output: 0, cachedInput: 0 },
  'gemini-2.0-flash':       { input: 0, output: 0, cachedInput: 0 },
```

(Note: the spec said "3 entries" but the actual file has 4 gemini lines including `gemini-2.5-pro`. The `2.5-pro` line is also dead in the single-lane world — delete all 4.)

New: delete those 4 lines entirely. Leave the rest of the cost table untouched.

- [ ] **Step 4: Update `backend/.env.example` (lines 47-64)**

Replace every occurrence of `claude-haiku-4-5-20251001` with `claude-sonnet-4-6` in those lines. There are 11 occurrences. After the change, lines 47-64 should look like:

```
OPENAI_MODEL_NANO=claude-sonnet-4-6
OPENAI_MODEL_KEYWORD_EXTRACTOR=claude-sonnet-4-6
OPENAI_MODEL_SYNONYM=claude-sonnet-4-6
OPENAI_MODEL_RERANKER=claude-sonnet-4-6
OPENAI_MODEL_SUGGESTIONS=claude-sonnet-4-6
OPENAI_MODEL_MEMORY=claude-sonnet-4-6
OPENAI_MODEL_COMPACTION=claude-sonnet-4-6
OPENAI_MODEL_VISION=claude-sonnet-4-6
OPENAI_MODEL_TABLE_UNDERSTANDING=claude-sonnet-4-6
OPENAI_INTERPRETATION_MODEL=claude-sonnet-4-6
OPENAI_INTERPRETATION_MODEL_FALLBACK=claude-sonnet-4-6
OPENAI_QUERY_BUILDER_MODEL=claude-sonnet-4-6
OPENAI_QUERY_BUILDER_MODEL_FALLBACK=claude-sonnet-4-6
OPENAI_CHAT_TIMEOUT_MS=60000

# Specialized model IDs for chat sub-routing
GATE_LLM_MODEL=claude-sonnet-4-6
SUPERVISOR_LLM_MODEL=claude-sonnet-4-6
```

- [ ] **Step 5: Update `openaiClient.chat.test.js` (lines 60, 66)**

Old (line 60):

```js
    await chat({ model: 'gemini-3-flash-preview', messages: [{ role: 'user', content: 'hi' }] });
```

New:

```js
    await chat({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] });
```

Old (line 66):

```js
    expect(body.model).toBe('gemini-3-flash-preview');
```

New:

```js
    expect(body.model).toBe('claude-sonnet-4-6');
```

- [ ] **Step 6: Verify no remaining `gemini-3-flash-preview` references**

```bash
grep -rIn 'gemini-3-flash-preview' \
  /var/www/html/project-data-strategis/backend/src \
  /var/www/html/project-data-strategis/backend/.env.example 2>/dev/null \
  | grep -v node_modules
```

Expected: no output. Same check for haiku-4-5-20251001:

```bash
grep -rIn 'claude-haiku-4-5-20251001' \
  /var/www/html/project-data-strategis/backend/src \
  /var/www/html/project-data-strategis/backend/.env.example 2>/dev/null \
  | grep -v node_modules
```

Expected: no output.

- [ ] **Step 7: Jest run**

```bash
cd /var/www/html/project-data-strategis/backend && npx jest --passWithNoTests --no-coverage
```

Expected: openaiClient.chat.test.js passes with new expectation; no new failures elsewhere.

- [ ] **Step 8: Commit**

```bash
cd /var/www/html/project-data-strategis && \
git add \
  backend/src/services/chat/persistentMemory.service.js \
  backend/src/services/ai/tableUnderstanding.service.js \
  backend/src/services/ai/keywordExtractor.service.js \
  backend/src/services/ai/reranker.service.js \
  backend/src/services/ai/documentJudge.service.js \
  backend/src/services/ai/synonymExpansion.service.js \
  backend/src/config/search.config.js \
  backend/src/utils/costTracker.js \
  backend/.env.example \
  backend/src/__tests__/openaiClient.chat.test.js && \
git commit -m "refactor(chat): kill gemini-flash and haiku defaults throughout backend

8 services that defaulted to 'gemini-3-flash-preview' when their env
var was missing now default to 'claude-sonnet-4-6'. costTracker drops
4 dead gemini cost rows. .env.example aligns with the live proxy env
(all-Sonnet). Test fixture updated."
```

---

## Task 6: Frontend tiny defaults (chatConstants + chatTransport)

**Why:** Spec §4.2 #14, #15. Two one-line changes. Done together because they're tightly related and both trivial.

**Files:**
- Modify: `frontend/src/lib/chatConstants.ts` (line 14)
- Modify: `frontend/src/lib/chatTransport.ts` (line 160)

- [ ] **Step 1: Backup**

```bash
cp /var/www/html/project-data-strategis/frontend/src/lib/chatConstants.ts \
   /var/www/html/project-data-strategis/frontend/src/lib/chatConstants.ts.backup
cp /var/www/html/project-data-strategis/frontend/src/lib/chatTransport.ts \
   /var/www/html/project-data-strategis/frontend/src/lib/chatTransport.ts.backup
```

- [ ] **Step 2: `chatConstants.ts` — remove Haiku from MODEL_ALIASES**

Old (lines 12-15):

```ts
export const MODEL_ALIASES: Record<string, string> = {
  'claude-sonnet-4-6': 'MALIKA Deep',
  'claude-haiku-4-5': 'MALIKA Flash',
} as const;
```

New:

```ts
export const MODEL_ALIASES: Record<string, string> = {
  'claude-sonnet-4-6': 'MALIKA',
} as const;
```

(The label drops "Deep" because there's no flash to contrast against anymore — `MALIKA` alone is honest.)

- [ ] **Step 3: `chatTransport.ts` — flip the default model (line 160)**

Old:

```ts
        body: JSON.stringify({ text, model: options?.model || "claude-haiku-4-5" }),
```

New:

```ts
        body: JSON.stringify({ text, model: options?.model || "claude-sonnet-4-6" }),
```

- [ ] **Step 4: Verify diffs**

```bash
diff /var/www/html/project-data-strategis/frontend/src/lib/chatConstants.ts.backup \
     /var/www/html/project-data-strategis/frontend/src/lib/chatConstants.ts
diff /var/www/html/project-data-strategis/frontend/src/lib/chatTransport.ts.backup \
     /var/www/html/project-data-strategis/frontend/src/lib/chatTransport.ts
```

- [ ] **Step 5: Commit (do NOT rebuild yet — saving rebuild for Task 7 which also touches frontend)**

```bash
cd /var/www/html/project-data-strategis && \
git add frontend/src/lib/chatConstants.ts frontend/src/lib/chatTransport.ts && \
git commit -m "fix(frontend): remove haiku from MODEL_ALIASES + chatTransport default

Frontend now sends 'claude-sonnet-4-6' as the default outbound model
and exposes only one alias ('MALIKA') in MODEL_ALIASES."
```

---

## Task 7: Frontend — remove model dropdown UI + localStorage migration

**Why:** Spec §4.2 #16. Biggest frontend change. Deletes the `selectedModel` state, the persistence `useEffect`, the dropdown buttons in JSX, and adds a one-shot `removeItem` for the stale localStorage key.

**Files:**
- Modify: `frontend/src/app/(admin)/chat/ChatPageClient.tsx` (lines 143-155, 2025-2048, possibly other `selectedModel` references)

- [ ] **Step 1: Backup**

```bash
cp /var/www/html/project-data-strategis/frontend/src/app/(admin)/chat/ChatPageClient.tsx \
   /var/www/html/project-data-strategis/frontend/src/app/(admin)/chat/ChatPageClient.tsx.backup
```

- [ ] **Step 2: Find all `selectedModel` references**

```bash
grep -n 'selectedModel\|modelDropdownOpen\|setSelectedModel\|malika_selected_model' \
  /var/www/html/project-data-strategis/frontend/src/app/\(admin\)/chat/ChatPageClient.tsx
```

Note every line. The known cluster is lines 143-155 (state + useEffect) and 2025-2048 (dropdown JSX). There MAY be other call sites (e.g., the dropdown trigger button before line 2025, and any place the value is passed to chatTransport).

- [ ] **Step 3: Replace the state/useEffect block (lines 143-155)**

Old (lines 143-155):

```ts
  const [selectedModel, setSelectedModel] = useState<"claude-sonnet-4-6" | "claude-haiku-4-5">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("malika_selected_model");
      if (saved === "claude-haiku-4-5" || saved === "claude-sonnet-4-6") return saved;
    }
    return "claude-haiku-4-5";
  });
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);

  // Persist model selection across page loads
  useEffect(() => {
    localStorage.setItem("malika_selected_model", selectedModel);
  }, [selectedModel]);
```

New:

```ts
  // Single-lane (2026-05-16): only Sonnet. Clean stale dropdown selection from
  // pre-2026-05-16 visits — idempotent, safe to ship and re-ship.
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("malika_selected_model");
    }
  }, []);
```

- [ ] **Step 4: Replace any `selectedModel` reference in JSX or callbacks with the string literal `"claude-sonnet-4-6"`**

For each remaining hit from Step 2 (excluding the deleted lines), inspect:
- If it's a check like `selectedModel === "claude-sonnet-4-6"` → change to `true` and remove the surrounding conditional (or just inline the truthy branch).
- If it's a check like `selectedModel === "claude-haiku-4-5"` → change to `false` and remove the falsy branch's JSX.
- If it's being passed as a prop or to `chatTransport`'s `options.model` → replace with `"claude-sonnet-4-6"` literal.

- [ ] **Step 5: Remove the dropdown JSX block (around lines 2025-2048)**

This block contains two `<button type="button">` elements — one for "MALIKA Deep" (checkmark when `selectedModel === "claude-sonnet-4-6"`) and one for "MALIKA Flash" (checkmark when `selectedModel === "claude-haiku-4-5"`). The dropdown is opened by `modelDropdownOpen`. Delete the entire dropdown container including:

- The wrapper that conditionally renders `{modelDropdownOpen && (...)}`.
- The dropdown trigger button (just above line 2025 — find the button that toggles `modelDropdownOpen`; grep for `setModelDropdownOpen` to locate it).
- Both option buttons inside the dropdown.

After deletion, the chat input form should still render correctly (the `<textarea>` at line 2052 onward and the send button must remain).

- [ ] **Step 6: Confirm no remaining references**

```bash
grep -n 'selectedModel\|modelDropdownOpen\|setSelectedModel\|malika_selected_model' \
  /var/www/html/project-data-strategis/frontend/src/app/\(admin\)/chat/ChatPageClient.tsx
```

Expected: only the one occurrence inside the new `useEffect` (`localStorage.removeItem("malika_selected_model")`).

- [ ] **Step 7: TypeScript check passes**

```bash
cd /var/www/html/project-data-strategis/frontend && npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors related to `selectedModel`, `modelDropdownOpen`, `setSelectedModel`. Pre-existing errors unrelated to this change are acceptable but note them.

- [ ] **Step 8: Frontend build succeeds**

```bash
cd /var/www/html/project-data-strategis/frontend && npm run build 2>&1 | tail -30
```

Expected: build completes (a Next.js compile + page generation). Errors during the build block this task.

- [ ] **Step 9: Commit**

```bash
cd /var/www/html/project-data-strategis && \
git add frontend/src/app/\(admin\)/chat/ChatPageClient.tsx && \
git commit -m "feat(chat): remove model dropdown UI, single-lane Sonnet

selectedModel state + persistence effect + dropdown JSX all removed
(dropdown was a lie — proxy already served only Sonnet). One-shot
localStorage.removeItem cleans the stale 'malika_selected_model' key
from prior visits. No user notice needed."
```

---

## Task 8: Close proxy bypass — `openaiChat.service.js`

**Why:** Spec §4.3 #17. The hard-coded `https://api.openai.com/v1/chat/completions` URL must be replaced with the proxy URL (from env). Throw at module load if env is missing.

**Files:**
- Modify: `backend/src/services/ai/openaiChat.service.js` (line 17)

- [ ] **Step 1: Backup**

```bash
cp /var/www/html/project-data-strategis/backend/src/services/ai/openaiChat.service.js \
   /var/www/html/project-data-strategis/backend/src/services/ai/openaiChat.service.js.backup
```

- [ ] **Step 2: Add a module-load env check at the top, after the `require('axios')` line**

Insert after line 1 (`const axios = require('axios');`):

```js

// Proxy-only rule (2026-05-16): all chat calls must terminate at the local
// malika-llm-proxy. Refuse to load if OPENAI_API_URL is not set so misconfig
// fails loud at boot instead of silently bypassing the proxy.
const CHAT_URL = process.env.OPENAI_API_URL;
if (!CHAT_URL) {
  throw new Error('[openaiChat.service] OPENAI_API_URL env var must be set (must point at malika-llm-proxy)');
}
```

- [ ] **Step 3: Replace the hard-coded URL on line 17 (now shifted)**

Old:

```js
  const url = 'https://api.openai.com/v1/chat/completions';
```

New:

```js
  const url = CHAT_URL;
```

- [ ] **Step 4: Module loads with env set**

```bash
cd /var/www/html/project-data-strategis/backend && \
  OPENAI_API_URL=http://127.0.0.1:3031/v1/chat/completions \
  node -e "require('./src/services/ai/openaiChat.service'); console.log('ok')"
```

Expected: `ok`.

- [ ] **Step 5: Module fails to load without env**

```bash
cd /var/www/html/project-data-strategis/backend && \
  unset OPENAI_API_URL && \
  node -e "require('./src/services/ai/openaiChat.service')" ; echo "exit=$?"
```

Expected: `Error: [openaiChat.service] OPENAI_API_URL env var must be set ...`, exit non-zero.

- [ ] **Step 6: Commit**

```bash
cd /var/www/html/project-data-strategis && \
git add backend/src/services/ai/openaiChat.service.js && \
git commit -m "fix(ai): route openaiChat.service through proxy (no direct api.openai.com)

Replaces the hard-coded 'https://api.openai.com/v1/chat/completions'
URL with process.env.OPENAI_API_URL (the local malika-llm-proxy).
Throws at module load if the env var is missing — fail loud, never
silently bypass."
```

---

## Task 9: Close proxy bypass — `keywordExtractor.service.js` (2 sites)

**Why:** Spec §4.3 #18. Two `fetch(... || 'https://generativelanguage.googleapis.com/...')` fallbacks. Remove the literal Google URL; require the env var.

**Files:**
- Modify: `backend/src/services/ai/keywordExtractor.service.js` (lines 177, 445)

- [ ] **Step 1: Backup**

```bash
cp /var/www/html/project-data-strategis/backend/src/services/ai/keywordExtractor.service.js \
   /var/www/html/project-data-strategis/backend/src/services/ai/keywordExtractor.service.js.backup
```

- [ ] **Step 2: Add module-load env check near the top of the file (after the existing constants)**

Find the section that declares constants (`LLM_MODEL`, `LLM_TIMEOUT_MS`, etc., around lines 25-30). After them, add:

```js

// Proxy-only rule (2026-05-16): all chat calls must terminate at the local
// malika-llm-proxy. Crash loud at module load if OPENAI_API_URL is missing.
const CHAT_URL = process.env.OPENAI_API_URL;
if (!CHAT_URL) {
  throw new Error('[keywordExtractor.service] OPENAI_API_URL env var must be set (must point at malika-llm-proxy)');
}
```

- [ ] **Step 3: Replace line 177**

Old:

```js
    const response = await fetch(process.env.OPENAI_API_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
```

New:

```js
    const response = await fetch(CHAT_URL, {
```

- [ ] **Step 4: Replace line 445**

Same pattern — old:

```js
    const response = await fetch(process.env.OPENAI_API_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
```

New:

```js
    const response = await fetch(CHAT_URL, {
```

- [ ] **Step 5: Verify no remaining direct Google URL**

```bash
grep -n 'generativelanguage.googleapis.com' \
  /var/www/html/project-data-strategis/backend/src/services/ai/keywordExtractor.service.js
```

Expected: no output.

- [ ] **Step 6: Module loads**

```bash
cd /var/www/html/project-data-strategis/backend && \
  OPENAI_API_URL=http://127.0.0.1:3031/v1/chat/completions \
  node -e "require('./src/services/ai/keywordExtractor.service'); console.log('ok')"
```

Expected: `ok`.

- [ ] **Step 7: Commit**

```bash
cd /var/www/html/project-data-strategis && \
git add backend/src/services/ai/keywordExtractor.service.js && \
git commit -m "fix(ai): route keywordExtractor.service through proxy (no direct Gemini fallback)

Drops the two 'generativelanguage.googleapis.com' fallback URLs in
fetch() calls. Module now throws at load if OPENAI_API_URL is missing."
```

---

## Task 10: Close proxy bypass — `services/ai/client/openaiClient.js`

**Why:** Spec §4.3 #19. The `OPENAI_API_URL` constant on line 12 falls back to a literal Google URL. Drop the fallback; require the env. Leave `OPENAI_EMBEDDINGS_URL` (line 14) alone — embedding path is out of scope.

**Files:**
- Modify: `backend/src/services/ai/client/openaiClient.js` (line 12)

- [ ] **Step 1: Backup**

```bash
cp /var/www/html/project-data-strategis/backend/src/services/ai/client/openaiClient.js \
   /var/www/html/project-data-strategis/backend/src/services/ai/client/openaiClient.js.backup
```

- [ ] **Step 2: Replace line 12**

Old:

```js
const OPENAI_API_URL = process.env.OPENAI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai';
```

New:

```js
// Proxy-only rule (2026-05-16): chat calls must terminate at malika-llm-proxy.
// Throw at module load if OPENAI_API_BASE_URL is missing — never silently bypass.
const OPENAI_API_URL = process.env.OPENAI_API_BASE_URL;
if (!OPENAI_API_URL) {
  throw new Error('[ai/client/openaiClient] OPENAI_API_BASE_URL env var must be set (must point at malika-llm-proxy)');
}
```

- [ ] **Step 3: Verify line 14 still has the embeddings fallback (intentionally left)**

```bash
sed -n '13,15p' /var/www/html/project-data-strategis/backend/src/services/ai/client/openaiClient.js
```

Expected: shows `OPENAI_EMBEDDINGS_URL` with the `|| 'https://api.openai.com/v1'` fallback intact (embeddings out of scope).

- [ ] **Step 4: Module loads**

```bash
cd /var/www/html/project-data-strategis/backend && \
  OPENAI_API_URL=http://127.0.0.1:3031/v1/chat/completions \
  OPENAI_API_BASE_URL=http://127.0.0.1:3031/v1 \
  node -e "require('./src/services/ai/client/openaiClient'); console.log('ok')"
```

Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
cd /var/www/html/project-data-strategis && \
git add backend/src/services/ai/client/openaiClient.js && \
git commit -m "fix(ai): require OPENAI_API_BASE_URL env, drop Gemini fallback in shared client

Throws at module load if OPENAI_API_BASE_URL is unset. The embedding
URL fallback (line 14) is left intact — out of scope here."
```

---

## Task 11: Close proxy bypass — frontend `/api/insights/route.ts`

**Why:** Spec §4.3 #20. A Next.js server route currently `fetch`-es OpenAI directly. Re-route through the proxy.

**Files:**
- Modify: `frontend/src/app/api/insights/route.ts` (around line 2300, plus the `key` setup earlier in the function)

- [ ] **Step 1: Backup**

```bash
cp /var/www/html/project-data-strategis/frontend/src/app/api/insights/route.ts \
   /var/www/html/project-data-strategis/frontend/src/app/api/insights/route.ts.backup
```

- [ ] **Step 2: Find where `key` and `model` are defined in this function**

```bash
grep -n 'const key\|let key\|const model\|let model\|OPENAI_API_KEY\|OPENAI_API_URL' \
  /var/www/html/project-data-strategis/frontend/src/app/api/insights/route.ts | head -20
```

This locates the variable bindings that feed the fetch call on line 2300. The fetch uses `Authorization: Bearer ${key}` and `model` in the body — both must keep working after the URL flip.

- [ ] **Step 3: Replace the fetch URL on line 2300**

Old:

```ts
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
```

New (use env, fall back to the literal proxy URL since this is a server-side Next route that may not have process.env loaded the same way as the backend):

```ts
      const PROXY_URL = process.env.OPENAI_API_URL || "http://127.0.0.1:3031/v1/chat/completions";
      const res = await fetch(PROXY_URL, {
```

- [ ] **Step 4: Sanity-check the proxy will accept the request**

The proxy ignores `body.model` and `Authorization` (it has its own keys). So existing `key` and `model` in the body are harmless — the proxy will route via tier 1 (Sonnet). No further code change needed in this route.

- [ ] **Step 5: Verify no remaining `api.openai.com` in frontend chat path**

```bash
grep -rIn 'api\.openai\.com' /var/www/html/project-data-strategis/frontend/src 2>/dev/null \
  | grep -v node_modules | grep -v '\.next/'
```

Expected: empty (this was the last frontend direct call).

- [ ] **Step 6: TypeScript check**

```bash
cd /var/www/html/project-data-strategis/frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no new errors.

- [ ] **Step 7: Frontend build**

```bash
cd /var/www/html/project-data-strategis/frontend && npm run build 2>&1 | tail -20
```

Expected: build completes.

- [ ] **Step 8: Commit**

```bash
cd /var/www/html/project-data-strategis && \
git add frontend/src/app/api/insights/route.ts && \
git commit -m "fix(frontend): route /api/insights through malika-llm-proxy

Drops the direct fetch to api.openai.com. Reads OPENAI_API_URL with a
hard fallback to 127.0.0.1:3031/v1/chat/completions for local dev. The
proxy ignores body.model and the Authorization header (it has its own
auth), so existing key/model passing is harmless."
```

---

## Task 12: Verification grep + manual smoke

**Why:** Spec §7.2 + §7.4. The proxy-only rule is enforced by a grep that must return empty. Manual smoke confirms the full chat path still works post-deploy.

**Files:** none modified — verification only.

- [ ] **Step 1: Run the bypass verification grep**

```bash
grep -rIn -E 'api\.(anthropic|openai)\.com|generativelanguage\.googleapis\.com' \
  /var/www/html/project-data-strategis/backend/src \
  /var/www/html/project-data-strategis/frontend/src \
  --include='*.ts' --include='*.tsx' --include='*.js' 2>/dev/null \
  | grep -v node_modules \
  | grep -v embedding
```

Expected: **empty.** Any output is a violation; stop and add a closure task before continuing.

(Note: `embedding` is filtered because the OpenAI text-embeddings code path is intentionally out of scope per the spec.)

- [ ] **Step 2: Reload services**

```bash
cd /var/www/html/project-data-strategis/backend && pm2 reload pds-backend --update-env
cd /var/www/html/project-data-strategis/backend/admin && npm run build && pm2 reload pds-admin --update-env
cd /var/www/html/project-data-strategis/frontend && npm run build && pm2 reload pds-frontend --update-env
```

Expected: each reload completes; `pm2 list` shows all three as `online`.

- [ ] **Step 3: Tail the proxy log**

In a separate terminal (or background):

```bash
pm2 logs malika-llm-proxy --lines 0
```

Leave running for the next steps.

- [ ] **Step 4: Manual smoke — greeting**

In a browser, open `https://malika.bpsmalut.com`. Open chat. Send: `selamat pagi`.

Expected:
- Streaming response arrives in <5s.
- Proxy log shows `[proxy] Tier 1/4 → anthropic/claude-sonnet-4-6`.

- [ ] **Step 5: Manual smoke — data query**

Send: `IPM Maluku Utara 2024`.

Expected:
- Response includes data with citations.
- Proxy log shows another `Tier 1/4 → anthropic/claude-sonnet-4-6`.

- [ ] **Step 6: Manual smoke — deep query**

Send: `perbandingan IPM antar kabupaten Maluku Utara 2020-2024`.

Expected:
- Response includes extended-thinking-style reasoning (or thinking summary in the UI).
- Proxy log shows tier 1, and the request body would have `thinking.budgetTokens` non-zero (cannot directly inspect from outside; trust the tier-router code path).

- [ ] **Step 7: Confirm no dropdown is visible in chat UI**

Visual check: the chat input area should NOT show a model picker button or dropdown.

- [ ] **Step 8: No commit — verification step only.**

---

## Task 13: Re-run eval suite

**Why:** Spec §7.3. The B-grade eval suite should produce the same scores as the latest pre-merge run (`backend/evals/reports/eval-2026-05-13-*`) since production traffic was already all-Sonnet. Any regression means we missed something.

**Files:** none modified — verification step.

- [ ] **Step 1: Find the latest pre-merge eval report**

```bash
ls -t /var/www/html/project-data-strategis/backend/evals/reports/ | head -5
```

Expected: shows the 4 untracked `eval-2026-05-12-*` and `eval-2026-05-13-*` reports as the latest baseline.

- [ ] **Step 2: Run the eval suite**

```bash
cd /var/www/html/project-data-strategis/backend && bash evals/master-test-runner.sh
```

Expected: ~5-10 minute run; produces a new `eval-2026-05-16-HH-MM.md` report under `evals/reports/`.

- [ ] **Step 3: Compare scores against the most recent prior report**

```bash
diff <(grep -E '^- |^\*\*Score' /var/www/html/project-data-strategis/backend/evals/reports/eval-2026-05-13-01-57.md) \
     <(grep -E '^- |^\*\*Score' /var/www/html/project-data-strategis/backend/evals/reports/eval-2026-05-16-*.md | tail -100)
```

(Adjust filenames to the actual latest reports.)

Expected: no score regression — same B-grade pass rate as 2026-05-13. If the score drops, the change broke something the spec missed; investigate before committing the new report.

- [ ] **Step 4: Commit the new eval report (only if scores hold)**

```bash
cd /var/www/html/project-data-strategis && \
git add backend/evals/reports/eval-2026-05-16-*.md && \
git commit -m "docs(evals): post-Sonnet-cleanup baseline (2026-05-16)

Same B-grade pass rate as the 2026-05-13 baseline. Confirms the
single-lane refactor was behavior-preserving — production was already
all-Sonnet via the proxy, so the cleanup was pure dead-code removal."
```

---

## Task 14: Memory updates + final push

**Why:** Spec §10. Persist the single-lane decision into the auto-memory so future sessions don't propose re-introducing a flash lane.

**Files:**
- Create: `/root/.claude/projects/-var-www-html/memory/single_lane_decision.md`
- Modify: `/root/.claude/projects/-var-www-html/memory/MEMORY.md`
- Modify: `/root/.claude/projects/-var-www-html/memory/malika_llm_proxy.md` (deprecation note)

- [ ] **Step 1: Backup existing memory files that get edited**

```bash
cp /root/.claude/projects/-var-www-html/memory/MEMORY.md \
   /root/.claude/projects/-var-www-html/memory/MEMORY.md.backup
cp /root/.claude/projects/-var-www-html/memory/malika_llm_proxy.md \
   /root/.claude/projects/-var-www-html/memory/malika_llm_proxy.md.backup
```

- [ ] **Step 2: Create `single_lane_decision.md`**

File content:

```markdown
---
name: MALIKA single-lane Sonnet rule (2026-05-16)
description: All MALIKA chat/LLM traffic goes through 127.0.0.1:3031 (malika-llm-proxy), model is always claude-sonnet-4-6. No Opus, no Haiku, no Gemini in code. Reject suggestions that add a flash lane or call providers directly.
type: project
---

# Single-lane Sonnet via malika-llm-proxy

**Rule:** Every chat/LLM call from backend or frontend MUST:
1. Terminate at `http://127.0.0.1:3031/v1/chat/completions` (the local `malika-llm-proxy`).
2. Request model = `claude-sonnet-4-6`.

There is exactly one lane. No Opus. No Haiku. No Gemini referenced in our code (the proxy maintains a Gemini fallback chain for outages — that's its concern, not ours).

**Why:** decision recorded 2026-05-16 after audit found a "flash" lane (Haiku in frontend dropdown, gemini-flash defaults in 7 backend services) that was already a lie — proxy tier 1 was always Sonnet. The pretense was generating dead-code surface and (in 4 files) direct-provider HTTP calls that bypassed the proxy entirely. User decision: collapse to one lane, kill all pretense.

**How to apply:**
- Reject any suggestion to add a "fast" / "flash" / "lite" / "preview" model lane. Point at this memory + the spec at `docs/superpowers/specs/2026-05-16-malika-sonnet-only-single-lane-design.md`.
- Reject any new code that imports `@anthropic-ai/sdk`, `@google/genai`, or fetches `api.openai.com` / `api.anthropic.com` / `generativelanguage.googleapis.com` directly. Embeddings (`text-embedding-3-large`) are the one exception — they live outside the proxy and outside this rule's scope.
- The verification grep enforces it: `grep -rIn -E 'api\.(anthropic|openai)\.com|generativelanguage\.googleapis\.com' backend/src frontend/src --include='*.ts' --include='*.tsx' --include='*.js' | grep -v node_modules | grep -v embedding` must return empty.
- `backend/src/services/chat/streaming/config.js` has a startup assertion that crashes if `OPENAI_API_URL` is not `127.0.0.1:3031`. Don't disable it.
- Deprecated env vars: `MODEL_GREETING`, `MODEL_SIMPLE`, `MODEL_COMPLEX`, `MODEL_DEEP`, `CHAT_FORCE_MODEL` — no longer honored. The modelRouter warns at module load if any are still set.
```

- [ ] **Step 3: Append a deprecation note to `malika_llm_proxy.md`**

Find the end of the file (after the worker-pool section) and append:

```markdown

## 2026-05-16 — Single-lane Sonnet
- `MODEL_GREETING`, `MODEL_SIMPLE`, `MODEL_COMPLEX`, `MODEL_DEEP`, and `CHAT_FORCE_MODEL` env vars are deprecated; the backend `modelRouter.service.js` no longer reads them and logs a warn at module load if any are set. Remove from `.env` files.
- Backend now refuses to start unless `OPENAI_API_URL=http://127.0.0.1:3031/v1/chat/completions` (host 127.0.0.1/localhost, port 3031). See assertion in `backend/src/services/chat/streaming/config.js`.
- See `single_lane_decision.md` for the rule + verification grep.
```

- [ ] **Step 4: Add an index line in `MEMORY.md` under "Architecture (Quick Summary)" or "User Preferences"**

In `MEMORY.md`, find the "User Preferences" section and append a new bullet:

```markdown
- **Single-lane Sonnet via malika-llm-proxy** — see [single_lane_decision.md](single_lane_decision.md). All chat traffic must terminate at 127.0.0.1:3031 with model=claude-sonnet-4-6. Reject suggestions for flash/haiku/gemini lanes.
```

- [ ] **Step 5: Verify memory files**

```bash
ls -la /root/.claude/projects/-var-www-html/memory/single_lane_decision.md
diff /root/.claude/projects/-var-www-html/memory/MEMORY.md.backup \
     /root/.claude/projects/-var-www-html/memory/MEMORY.md
diff /root/.claude/projects/-var-www-html/memory/malika_llm_proxy.md.backup \
     /root/.claude/projects/-var-www-html/memory/malika_llm_proxy.md
```

Expected: new file exists, MEMORY.md gains one bullet, malika_llm_proxy.md gains one section at end.

- [ ] **Step 6: Push all the implementation commits to origin**

```bash
cd /var/www/html/project-data-strategis && git push origin main
```

Expected: ~11 commits pushed (one per task that committed). Confirm at https://github.com/gumxlarcw/malika/commits/main.

- [ ] **Step 7: No commit on memory files** (they live outside the project tree; the auto-memory system is local to this machine and not tracked in the malika repo).

---

## Self-Review

Spec coverage check (run mentally against `docs/superpowers/specs/2026-05-16-malika-sonnet-only-single-lane-design.md`):

- §3 reality vs perception — covered conceptually by Tasks 4 + 7 (whitelist + dropdown removal); the "lie" is documented in commit messages.
- §4.1 #1 modelRouter — Task 3. ✓
- §4.1 #2 streaming.service — Task 2. ✓
- §4.1 #3 ALLOWED_OVERRIDES — Task 4. ✓
- §4.1 #4-10 service defaults — Task 5. ✓
- §4.1 #11 costTracker — Task 5. ✓
- §4.1 #12 .env.example — Task 5. ✓
- §4.1 #13 modelRouter test delete — Task 3. ✓
- §4.1 #14 openaiClient test fixture — Task 5. ✓
- §4.2 #14 chatConstants — Task 6. ✓
- §4.2 #15 chatTransport — Task 6. ✓
- §4.2 #16 ChatPageClient — Task 7. ✓
- §4.3 #17 openaiChat.service — Task 8. ✓
- §4.3 #18 keywordExtractor — Task 9. ✓
- §4.3 #19 client/openaiClient — Task 10. ✓
- §4.3 #20 frontend insights/route — Task 11. ✓
- §4.4 startup assertion — Task 1. ✓
- §6 error-handling — covered by `ALLOWED_OVERRIDES` whitelist (6.1), localStorage cleanup (6.2), deprecated env warning (6.3 in Task 3), startup assertion (6.5 in Task 1). ✓
- §7.2 verification grep — Task 12 Step 1. ✓
- §7.3 eval re-run — Task 13. ✓
- §7.4 smoke checks — Task 12 Steps 4-7. ✓
- §8 deployment sequence — Task 12 Step 2. ✓
- §10 memory updates — Task 14. ✓

Placeholder scan: no "TBD", "TODO", "implement later", "fill in details", or unscoped "appropriate error handling" found in any task. ✓

Type consistency: same constant `'claude-sonnet-4-6'` used throughout (never `'sonnet'` or `'claude-sonnet'` or `'claude-sonnet-4-6-...'`). Same env var name `OPENAI_API_URL` referenced consistently. ✓
