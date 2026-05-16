# Sonnet-only Follow-ups Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out all 7 follow-ups from `docs/superpowers/followups/2026-05-16-sonnet-only-followups.md`, plus manual browser smoke test of the shipped single-lane work, plus close retrospective PR #5.

**Architecture:** Small focused commits direct to `main` (matches recent project pattern — 17 commits direct-to-main last session). No feature branch. Each follow-up is its own commit so any single change can be reverted cleanly. Test-harness fix is a parser-tolerance change (reconstruct `full_text` from `chunk` events when the `done` event omits it). The `requireProxyUrl()` helper covers two env-var names (`OPENAI_API_URL` and `OPENAI_API_BASE_URL`) since both are used in the bypass closures.

**Tech Stack:** Node.js (backend services), Next.js 15 / TypeScript (frontend `/api/insights` route), Python 3 (test harness), bash (`master-test-runner.sh`), Jest (backend tests), pm2 (process management), `gh` CLI (PR close).

---

## File Inventory

**Create:**
- `backend/src/utils/requireProxyUrl.js` — shared env-var assertion helper (Task 3)
- `backend/src/utils/__tests__/requireProxyUrl.test.js` — Jest unit test for the helper (Task 3)
- `backend/evals/__tests__/test-evaluate-chat-result.py` — pytest-style covering the parser fallback (Task 2)

**Modify:**
- `backend/evals/evaluate-chat-result.py` — fallback to chunk events when `full_text` empty (Task 2)
- `backend/src/services/ai/openaiChat.service.js:1-9` — use helper (Task 3)
- `backend/src/services/ai/keywordExtractor.service.js:33-38, 439-442` — use helper + unify deep-path key resolution (Tasks 3, 4)
- `backend/src/services/ai/client/openaiClient.js:12-17` — use helper with `OPENAI_API_BASE_URL` arg (Task 3)
- `frontend/src/app/api/insights/route.ts:2300` — read env first, keep fallback as defense-in-depth (Task 5)
- `backend/src/services/chat/streaming/config.js:164-168` — delete stale `MODEL_ALIASES` (Task 6)
- `backend/src/services/chat/streaming.service.js:95` — fix contradictory comment (Task 7)

**Delete:**
- Stale `.backup` files older than 7 days under `backend/src/` and `frontend/src/` (Task 8)

**Close:**
- GitHub PR #5 (retrospective audit PR) and any leftover throwaway branches (Task 9)

**Manual:**
- Browser smoke test at `https://malika.bpsmalut.com` (Task 1)

---

## Task 1: Manual browser smoke test of the single Sonnet lane

**Purpose:** This is the only thing in the recap that didn't get done last session. Confirms the shipped work actually works end-to-end before we layer more changes on top of it.

**Files:** None (manual verification).

- [ ] **Step 1: Confirm services up**

Run:
```bash
pm2 status | grep -E 'pds-backend|pds-frontend|pds-admin|malika-llm-proxy'
```
Expected: all four show `online`, uptime in days/hours, restart count low (<5).

If anything shows `errored` or recent restarts: STOP and investigate `pm2 logs <name> --lines 50` before proceeding.

- [ ] **Step 2: Confirm proxy responds**

Run:
```bash
curl -sS -m 5 -X POST http://127.0.0.1:3031/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer test' \
  -d '{"model":"claude-sonnet-4-6","messages":[{"role":"user","content":"hi"}],"max_tokens":10}' \
  | head -c 300
```
Expected: a JSON response with `choices[0].message.content` populated. If `Connection refused`: `pm2 restart malika-llm-proxy` then retry.

- [ ] **Step 3: Browser smoke — open chat UI**

In a browser, open `https://malika.bpsmalut.com`. Open DevTools → Network tab, filter on `chat`.

Verify:
- No model picker UI element anywhere in the input area (single lane → nothing to pick).
- Page loads without console errors.

- [ ] **Step 4: Browser smoke — greeting**

In the chat input, type `halo` and send. Observe:
- Reply arrives within ~10s.
- Reply is non-empty (the test-harness false-fail is harness-side; the actual UI should render fine).
- Network tab: one POST to `/api/chat/threads/.../stream`. Status 200. Response is `text/event-stream`.

- [ ] **Step 5: Browser smoke — data query**

In the same thread, send `tampilkan inflasi maluku utara terbaru`. Observe:
- Reply contains numbers + a citation/source line.
- Latency 5-20s acceptable.
- No 4xx/5xx in Network tab.

- [ ] **Step 6: Browser smoke — deep query**

In a new thread, send `analisis tren pertumbuhan ekonomi maluku utara 2020-2024`. Observe:
- Reply is longer, structured (bullets/sections).
- Latency may be 20-60s — this is normal for deep.
- No errors.

- [ ] **Step 7: Record outcome**

If all 3 queries pass: write a one-line note to the followups doc footer (`## Verification — 2026-05-16`) noting smoke pass. If any failed: capture the failing query + observed response + network trace, STOP the plan, escalate to user.

- [ ] **Step 8: Commit (only if footer note added)**

```bash
cp docs/superpowers/followups/2026-05-16-sonnet-only-followups.md \
   docs/superpowers/followups/2026-05-16-sonnet-only-followups.md.backup
# (manually append the verification note via Edit tool)
git add docs/superpowers/followups/2026-05-16-sonnet-only-followups.md
git commit -m "docs(followups): record manual browser smoke pass for sonnet-only lane"
```

---

## Task 2: [P1] Fix test-harness false-fail on greeting cases

**Files:**
- Modify: `backend/evals/evaluate-chat-result.py` (currently 82 lines)
- Create: `backend/evals/__tests__/test-evaluate-chat-result.py`
- Re-run: `master-test-runner.sh` on the 3 known false-fail cases

**Why this design:** The followup hypothesis says the SSE files have valid content but the harness reports `empty_response`. The parser reads `d.get("full_text", "")` from the `done` event only. For short greetings the backend may emit `chunk` events with the text but pack an empty `full_text` into `done`. Rather than chase that across the backend, the parser becomes tolerant: when `full_text` is empty, reconstruct from `chunk` events. Robust to whatever the upstream emission shape is.

- [ ] **Step 1: Inspect a known-bad SSE file to confirm hypothesis**

Run:
```bash
ls /tmp/malika_master_tests_20260516_154215/ 2>/dev/null | head
# If that tmp dir is gone, look in backend/evals/reports/ for the most recent
# results dir, or capture a fresh greeting:
TID=$(curl -s -X POST http://localhost:5000/chat/threads \
  -H 'Content-Type: application/json' -H 'x-malika-uid: smoke' -d '{}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['thread']['id'])")
curl -s -N "http://localhost:5000/chat/threads/$TID/stream?text=halo" \
  -H 'Accept: text/event-stream' -H 'x-malika-uid: smoke' \
  --max-time 30 > /tmp/G01-recheck.sse
grep -c 'event: chunk' /tmp/G01-recheck.sse
python3 -c "
import re, json
d = open('/tmp/G01-recheck.sse').read()
m = re.search(r'event:\s*done\ndata:\s*(.+)', d)
if m:
    j = json.loads(m.group(1))
    print('full_text len:', len(j.get('full_text','')))
    print('full_text preview:', repr(j.get('full_text','')[:80]))
"
```
Expected: either `full_text len: 0` (confirms hypothesis — fix is in parser) OR `full_text len > 0` (hypothesis wrong — different bug, STOP and reassess).

- [ ] **Step 2: Write a failing test**

Create `backend/evals/__tests__/test-evaluate-chat-result.py`:

```python
#!/usr/bin/env python3
"""Tests for evaluate-chat-result.py — focus on greeting false-fail fix."""
import subprocess, tempfile, os, sys

SCRIPT = os.path.join(os.path.dirname(__file__), '..', 'evaluate-chat-result.py')

def run_evaluator(sse_content, expect='', must_not=''):
    """Run evaluate-chat-result.py against an SSE blob, return (status, reason)."""
    with tempfile.NamedTemporaryFile('w', suffix='.sse', delete=False) as f:
        f.write(sse_content)
        path = f.name
    try:
        out = subprocess.check_output(
            ['python3', SCRIPT, path, '1000', expect, must_not],
            text=True
        ).strip()
        parts = out.split('|')
        return parts[0], parts[8] if len(parts) > 8 else ''
    finally:
        os.unlink(path)

def test_greeting_with_chunks_and_empty_full_text():
    """Done event has empty full_text, but chunk events have content. Should PASS, not FAIL with empty_response."""
    sse = (
        'event: chunk\ndata: {"text":"Halo! "}\n\n'
        'event: chunk\ndata: {"text":"Ada yang bisa "}\n\n'
        'event: chunk\ndata: {"text":"saya bantu?"}\n\n'
        'event: done\ndata: {"full_text":"","metadata":{"model":"claude-sonnet-4-6","pipeline_ms":{"total":1500},"tokens":{"input":50,"output":10}}}\n\n'
    )
    status, reason = run_evaluator(sse, expect='halo|bantu')
    assert status == 'PASS', f"Expected PASS, got {status} ({reason})"

def test_normal_full_text_path_still_works():
    """Done event has populated full_text. Should PASS via the existing path."""
    sse = 'event: done\ndata: {"full_text":"Inflasi Maluku Utara per April 2026 adalah 0.3%.","metadata":{"model":"claude-sonnet-4-6","pipeline_ms":{"total":3000},"tokens":{"input":200,"output":50}}}\n\n'
    status, reason = run_evaluator(sse, expect='inflasi')
    assert status == 'PASS', f"Expected PASS, got {status} ({reason})"

def test_genuinely_empty_response_still_fails():
    """No content anywhere — should still FAIL with empty_response."""
    sse = 'event: done\ndata: {"full_text":"","metadata":{}}\n\n'
    status, reason = run_evaluator(sse)
    assert status == 'FAIL'
    assert reason == 'empty_response'

if __name__ == '__main__':
    test_greeting_with_chunks_and_empty_full_text()
    test_normal_full_text_path_still_works()
    test_genuinely_empty_response_still_fails()
    print('All 3 tests passed.')
```

- [ ] **Step 3: Run tests, expect the first one fails**

Run:
```bash
python3 backend/evals/__tests__/test-evaluate-chat-result.py
```
Expected: AssertionError on `test_greeting_with_chunks_and_empty_full_text` — current parser returns FAIL/empty_response.

- [ ] **Step 4: Backup and modify `evaluate-chat-result.py`**

Run:
```bash
cp backend/evals/evaluate-chat-result.py backend/evals/evaluate-chat-result.py.backup
```

Replace the section between `ft = d.get("full_text", "")` and `text_len = len(ft)` (currently around lines 34-36) with chunk-event fallback:

```python
    ft = d.get("full_text", "")

    # Fallback: when the `done` event packs an empty full_text (observed on
    # greeting/chitchat replies), reconstruct from `chunk` events. Each chunk
    # event looks like:  event: chunk\ndata: {"text": "..."}
    if not ft:
        chunks = re.findall(r'event:\s*chunk\ndata:\s*(\{[^\n]*\})', data)
        pieces = []
        for c in chunks:
            try:
                pieces.append(json.loads(c).get('text', ''))
            except json.JSONDecodeError:
                pass
        ft = ''.join(pieces)

    model = meta.get("model", "?")
    text_len = len(ft)
```

- [ ] **Step 5: Re-run unit tests, expect all pass**

Run:
```bash
python3 backend/evals/__tests__/test-evaluate-chat-result.py
```
Expected: `All 3 tests passed.`

- [ ] **Step 6: Run the real harness on the 3 known false-fail IDs**

Run:
```bash
cd backend/evals && ./master-test-runner.sh --chat --id=G01,G02,G06 --quick 2>&1 | tail -30
```
Expected: all 3 PASS (or whatever their real verdict is — but NOT `empty_response` FAIL).

- [ ] **Step 7: Commit**

```bash
diff backend/evals/evaluate-chat-result.py.backup backend/evals/evaluate-chat-result.py
git add backend/evals/evaluate-chat-result.py backend/evals/__tests__/test-evaluate-chat-result.py
git commit -m "fix(evals): reconstruct full_text from chunks when done-event empty

Greeting cases (G01/G02/G06) emit valid SSE chunk events but the done
event packs an empty full_text, causing evaluate-chat-result.py to
report FAIL/empty_response. The fix makes the parser tolerant by
falling back to concatenating chunk-event text when full_text is empty.

Adds 3 unit tests covering the fallback path, the normal path, and
the genuinely-empty case (which still fails as expected)."
```

---

## Task 3: [P2] Extract `requireProxyUrl()` helper and apply to backend bypass closures

**Files:**
- Create: `backend/src/utils/requireProxyUrl.js`
- Create: `backend/src/utils/__tests__/requireProxyUrl.test.js`
- Modify: `backend/src/services/ai/openaiChat.service.js:1-9`
- Modify: `backend/src/services/ai/keywordExtractor.service.js:33-38`
- Modify: `backend/src/services/ai/client/openaiClient.js:12-17`

**Why this design:** Three near-identical blocks. The helper takes the module name and the env var name (defaults to `OPENAI_API_URL`) because `openaiClient.js` uses `OPENAI_API_BASE_URL` — same intent, different name. Single source of truth for the error message format.

- [ ] **Step 1: Write the failing test**

Create `backend/src/utils/__tests__/requireProxyUrl.test.js`:

```javascript
'use strict';

describe('requireProxyUrl', () => {
  let originalEnv;
  const HELPER_PATH = require.resolve('../requireProxyUrl');

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.OPENAI_API_URL;
    delete process.env.OPENAI_API_BASE_URL;
    delete require.cache[HELPER_PATH];
  });

  afterEach(() => {
    process.env = originalEnv;
    delete require.cache[HELPER_PATH];
  });

  test('returns the env value when set (default env var name)', () => {
    process.env.OPENAI_API_URL = 'http://127.0.0.1:3031/v1/chat/completions';
    const requireProxyUrl = require('../requireProxyUrl');
    expect(requireProxyUrl('test.module')).toBe('http://127.0.0.1:3031/v1/chat/completions');
  });

  test('returns the env value when set (custom env var name)', () => {
    process.env.OPENAI_API_BASE_URL = 'http://127.0.0.1:3031/v1';
    const requireProxyUrl = require('../requireProxyUrl');
    expect(requireProxyUrl('test.module', 'OPENAI_API_BASE_URL')).toBe('http://127.0.0.1:3031/v1');
  });

  test('throws with module name + env var name when missing', () => {
    const requireProxyUrl = require('../requireProxyUrl');
    expect(() => requireProxyUrl('my.module'))
      .toThrow(/\[my\.module\].*OPENAI_API_URL.*malika-llm-proxy/);
  });

  test('throws on empty-string env value (whitespace counts as missing)', () => {
    process.env.OPENAI_API_URL = '   ';
    const requireProxyUrl = require('../requireProxyUrl');
    expect(() => requireProxyUrl('m')).toThrow(/OPENAI_API_URL/);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL (module does not exist)**

Run:
```bash
cd backend && npx jest src/utils/__tests__/requireProxyUrl.test.js 2>&1 | tail -10
```
Expected: `Cannot find module '../requireProxyUrl'`.

- [ ] **Step 3: Implement helper**

Create `backend/src/utils/requireProxyUrl.js`:

```javascript
'use strict';

/**
 * Proxy-only rule (2026-05-16): all LLM chat calls must terminate at the
 * local malika-llm-proxy. Modules that issue chat HTTP requests call this
 * at load-time so misconfig fails loud at boot instead of silently bypassing
 * the proxy at request time.
 *
 * @param {string} moduleName - tag for the error message, e.g. 'openaiChat.service'
 * @param {string} [envVarName='OPENAI_API_URL'] - env var to read
 * @returns {string} the trimmed env value
 * @throws {Error} when the env var is unset or whitespace-only
 */
module.exports = function requireProxyUrl(moduleName, envVarName = 'OPENAI_API_URL') {
  const v = process.env[envVarName];
  if (!v || !String(v).trim()) {
    throw new Error(
      `[${moduleName}] ${envVarName} env var must be set (must point at malika-llm-proxy)`
    );
  }
  return String(v).trim();
};
```

- [ ] **Step 4: Re-run tests, expect PASS**

Run:
```bash
cd backend && npx jest src/utils/__tests__/requireProxyUrl.test.js 2>&1 | tail -10
```
Expected: 4 passed.

- [ ] **Step 5: Backup + apply helper in `openaiChat.service.js`**

Run:
```bash
cp backend/src/services/ai/openaiChat.service.js backend/src/services/ai/openaiChat.service.js.backup
```

Replace the existing top-of-file block (lines 1-9):

```javascript
const axios = require('axios');

// Proxy-only rule (2026-05-16): see backend/src/utils/requireProxyUrl.js
const CHAT_URL = require('../../utils/requireProxyUrl')('openaiChat.service');
```

- [ ] **Step 6: Backup + apply helper in `keywordExtractor.service.js`**

Run:
```bash
cp backend/src/services/ai/keywordExtractor.service.js backend/src/services/ai/keywordExtractor.service.js.backup
```

Replace lines 33-38:

```javascript
// Proxy-only rule (2026-05-16): see backend/src/utils/requireProxyUrl.js
const CHAT_URL = require('../../utils/requireProxyUrl')('keywordExtractor.service');
```

- [ ] **Step 7: Backup + apply helper in `client/openaiClient.js`**

Run:
```bash
cp backend/src/services/ai/client/openaiClient.js backend/src/services/ai/client/openaiClient.js.backup
```

Replace lines 12-17:

```javascript
// Proxy-only rule (2026-05-16): see backend/src/utils/requireProxyUrl.js
const OPENAI_API_URL = require('../../../utils/requireProxyUrl')(
  'ai/client/openaiClient', 'OPENAI_API_BASE_URL'
);
```

- [ ] **Step 8: Confirm diffs look right**

Run:
```bash
diff backend/src/services/ai/openaiChat.service.js.backup backend/src/services/ai/openaiChat.service.js
diff backend/src/services/ai/keywordExtractor.service.js.backup backend/src/services/ai/keywordExtractor.service.js
diff backend/src/services/ai/client/openaiClient.js.backup backend/src/services/ai/client/openaiClient.js
```
Expected: each diff removes the 5-7-line throw block, adds a 1-2-line `require(...)` call. No other changes.

- [ ] **Step 9: Verify backend still boots (proxy-only assertion still fires)**

Run:
```bash
# Happy path
cd backend && node -e "require('./src/services/ai/openaiChat.service'); require('./src/services/ai/keywordExtractor.service'); require('./src/services/ai/client/openaiClient'); console.log('OK')"
```
Expected: `OK` (with current `.env` loaded — backend `.env` has both env vars set in production).

If `OPENAI_API_URL` is not in your shell env, source it: `set -a; source backend/.env; set +a` before running. The actual pm2 process loads `.env` automatically.

Then verify the failure path:
```bash
cd backend && env -u OPENAI_API_URL -u OPENAI_API_BASE_URL node -e "require('./src/services/ai/openaiChat.service')" 2>&1 | tail -3
```
Expected: `Error: [openaiChat.service] OPENAI_API_URL env var must be set ...`

- [ ] **Step 10: Run backend jest suite, confirm baseline maintained**

Run:
```bash
cd backend && npm test 2>&1 | tail -5
```
Expected: 291+ passed / 18 failed (the pre-existing baseline from last session — same suite count, no new failures from this change). If the new helper test isn't picked up, add `'<rootDir>/src/utils/__tests__/'` to jest config — but recent commit `09dfe44` should already cover it.

- [ ] **Step 11: Reload backend in pm2**

Run:
```bash
pm2 reload pds-backend --update-env
pm2 logs pds-backend --lines 20 --nostream | tail -15
```
Expected: clean restart, no FATAL exits, sees "OPENAI.API_URL=..." log line from `config.js:162`.

- [ ] **Step 12: Commit**

```bash
git add backend/src/utils/requireProxyUrl.js \
        backend/src/utils/__tests__/requireProxyUrl.test.js \
        backend/src/services/ai/openaiChat.service.js \
        backend/src/services/ai/keywordExtractor.service.js \
        backend/src/services/ai/client/openaiClient.js
git commit -m "refactor(ai): extract requireProxyUrl() helper for proxy-only assertion

Replaces 3 near-identical 'throw if !process.env.X' blocks (added in
commits efc6d45, e0ef09a, and openaiClient.js) with one shared helper.
Helper takes the module tag and (optional) env var name — accommodates
both OPENAI_API_URL (chat services) and OPENAI_API_BASE_URL (openai
client). Closes followup #2."
```

---

## Task 4: [P3] Unify `keywordExtractor.service.js` deep-path key handling

**Files:**
- Modify: `backend/src/services/ai/keywordExtractor.service.js:439-444`

**Why:** Followup #6. After Task 3, the title path uses `getNextKey()` + the helper-provided `CHAT_URL`. The deep path (lines 439-444) still reads `OPENAI_API_KEY_CHAT|_INTERPRETATION|_QUERY_BUILDER` directly. Make both paths consistent.

- [ ] **Step 1: Inspect the title path to see what helper it uses**

Run:
```bash
grep -n "getNextKey\|apiKey" backend/src/services/ai/keywordExtractor.service.js | head -20
```
Note which key-resolution function the title path calls (likely `getNextKey()` from `./client/geminiKeyRotation`).

- [ ] **Step 2: Backup + update deep path**

Run:
```bash
cp backend/src/services/ai/keywordExtractor.service.js backend/src/services/ai/keywordExtractor.service.js.backup
```

Replace lines 439-444 (the `const apiKey = process.env.X || Y || Z || ''; if (!apiKey) return '';` block) with:

```javascript
  const apiKey = getNextKey();
  if (!apiKey) return '';
```

(`getNextKey` is already imported on line 29.)

- [ ] **Step 3: Verify the file still parses**

Run:
```bash
node -c backend/src/services/ai/keywordExtractor.service.js && echo OK
```
Expected: `OK`.

- [ ] **Step 4: Check no other code reads the OPENAI_API_KEY_* names**

Run:
```bash
grep -rn "OPENAI_API_KEY_CHAT\|OPENAI_API_KEY_INTERPRETATION\|OPENAI_API_KEY_QUERY_BUILDER" backend/src frontend/src 2>/dev/null | grep -v '.backup'
```
Expected: zero results, OR results that are also using `getNextKey()` already (those are fine). If the env vars are still in active use elsewhere, leave them in `.env` — this task just stops the keyword service from reading them directly.

- [ ] **Step 5: Quick smoke — run the keyword extractor against a sample doc**

Run:
```bash
cd backend && node -e "
require('dotenv').config();
const ke = require('./src/services/ai/keywordExtractor.service');
ke.extractKeywords('Inflasi Maluku Utara April 2026', 'Berita Resmi Statistik tentang inflasi bulanan dan tahunan Maluku Utara per April 2026, dengan rincian kelompok pengeluaran...')
  .then(r => console.log('OK:', r))
  .catch(e => { console.error('FAIL:', e.message); process.exit(1); });
" 2>&1 | tail -5
```
Expected: `OK: <comma-separated keywords>`. If FAIL with key error: revert and reassess.

- [ ] **Step 6: Commit**

```bash
diff backend/src/services/ai/keywordExtractor.service.js.backup backend/src/services/ai/keywordExtractor.service.js
git add backend/src/services/ai/keywordExtractor.service.js
git commit -m "refactor(ai): unify deep-extraction key resolution with title path

Deep-extraction path was reading OPENAI_API_KEY_CHAT|_INTERPRETATION|
_QUERY_BUILDER directly while the title path used getNextKey(). Both
paths now use getNextKey() for consistent key rotation behavior.
Closes followup #6."
```

---

## Task 5: [P3] Frontend `/api/insights` env parity with backend

**Files:**
- Modify: `frontend/src/app/api/insights/route.ts:2300`
- Modify: `frontend/.env.production.local` (add `OPENAI_API_URL`)
- Modify: `docs/workspace/ai-llm.md` (document the asymmetry)

**Why:** Followup #7. Backend bypass closures throw at load if `OPENAI_API_URL` is missing. Frontend silently falls back to `http://127.0.0.1:3031/v1/chat/completions`. Asymmetric. Add the env var to frontend env and keep the fallback (defense-in-depth — proxy is always on the same host, so the fallback is harmless when env is set, and a working safety net during dev).

- [ ] **Step 1: Confirm current frontend env state**

Run:
```bash
grep -n "OPENAI_API_URL\|OPENAI_API_BASE_URL" frontend/.env.production.local 2>/dev/null || echo "(not set)"
```

- [ ] **Step 2: Add OPENAI_API_URL to frontend env (if not already there)**

If the grep above showed `(not set)` or only the BASE_URL form, append:

```bash
echo 'OPENAI_API_URL=http://127.0.0.1:3031/v1/chat/completions' >> frontend/.env.production.local
```

If already set: skip — no edit needed.

- [ ] **Step 3: Backup + add a clarifying comment in route.ts**

Run:
```bash
cp frontend/src/app/api/insights/route.ts frontend/src/app/api/insights/route.ts.backup
```

Replace line 2300:

```typescript
      // Proxy-only rule: prefer env (set in frontend/.env.production.local).
      // Hardcoded fallback retained as defense-in-depth — the malika-llm-proxy
      // is always co-located on 127.0.0.1:3031 on this host. See followup #7.
      const PROXY_URL = process.env.OPENAI_API_URL || "http://127.0.0.1:3031/v1/chat/completions";
```

(Net effect: 3 comment lines added above the existing line. The fallback stays — followup explicitly says "either keep the fallback (defense in depth) or remove it"; keeping it is the safer choice.)

- [ ] **Step 4: Rebuild frontend (CLAUDE.md mandate — pm2 reload alone doesn't rebuild Next.js)**

Run:
```bash
cd frontend && npm run build 2>&1 | tail -10
```
Expected: successful build, no TS errors in the modified file.

- [ ] **Step 5: Reload pm2**

Run:
```bash
pm2 reload pds-frontend --update-env
pm2 logs pds-frontend --lines 20 --nostream | tail -15
```
Expected: clean restart.

- [ ] **Step 6: Smoke — hit the insights route from the browser**

In a browser, open any page that calls `/api/insights` (the homepage data widgets do). Open DevTools → Network → look for `/api/insights` requests. Expected: 200 with normal JSON body.

- [ ] **Step 7: Document the asymmetry in workspace doc**

Open `docs/workspace/ai-llm.md`. Append (or insert into the existing deployment-notes section if present):

```markdown
## Why frontend keeps a hardcoded proxy URL fallback

Backend services (`backend/src/utils/requireProxyUrl.js`) throw at module
load if `OPENAI_API_URL` is missing. The Next.js `/api/insights` route
silently falls back to `http://127.0.0.1:3031/v1/chat/completions`
because Next server routes don't auto-load `backend/.env`. The fallback
is safe because the proxy is always co-located on this host. Both
codepaths target the same URL in practice.
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/api/insights/route.ts frontend/.env.production.local docs/workspace/ai-llm.md
git commit -m "chore(frontend): add OPENAI_API_URL env, document fallback asymmetry

Sets OPENAI_API_URL in frontend/.env.production.local so the insights
route now reads from env instead of relying on its hardcoded fallback.
Fallback retained as defense-in-depth — proxy is always co-located on
127.0.0.1:3031 and Next.js server routes don't auto-load backend/.env.
Closes followup #7."
```

---

## Task 6: [P2] Delete stale `MODEL_ALIASES` from backend `config.js`

**Files:**
- Modify: `backend/src/services/chat/streaming/config.js:164-168, 181`

**Why:** Followup #3. The MODEL_ALIASES keys (`gpt-5-mini`, `gpt-4.1`) reference models not in the chat path anymore. The followup notes "not user-visible — backend MODEL_ALIASES has no consumers post-cleanup". Verify that claim first, then delete.

- [ ] **Step 1: Verify no consumer**

Run:
```bash
grep -rn "MODEL_ALIASES" backend/src 2>/dev/null
```
Expected: only the definition + the `module.exports` line in `config.js`. If anything else imports/destructures it: STOP and either update consumers or keep the const (replace keys with `claude-sonnet-4-6` per the followup's alternate suggestion).

- [ ] **Step 2: Backup + delete the const + the export entry**

Run:
```bash
cp backend/src/services/chat/streaming/config.js backend/src/services/chat/streaming/config.js.backup
```

Delete lines 164-168 (the entire `// Model display names...` comment + the const). Also remove the `MODEL_ALIASES,` line from the `module.exports` block (line ~181).

After edit, lines 162-167 should read:

```javascript
console.log(`[config.js] OPENAI.API_URL=${OPENAI.API_URL} key=${OPENAI.API_KEY ? '(configured)' : '(missing)'}`);

module.exports = {
  OPENAI,
  DATA,
  PERIOD,
  SIMILARITY,
```

And the `module.exports` block no longer contains `MODEL_ALIASES,`.

- [ ] **Step 3: Verify diff and parse**

Run:
```bash
diff backend/src/services/chat/streaming/config.js.backup backend/src/services/chat/streaming/config.js
node -c backend/src/services/chat/streaming/config.js && echo OK
```
Expected: diff shows the 5-line const + 1 export line removed. `OK` printed.

- [ ] **Step 4: Re-confirm no broken imports**

Run:
```bash
grep -rn "MODEL_ALIASES" backend/src 2>/dev/null
```
Expected: zero results.

- [ ] **Step 5: Backend smoke — reload + ensure no startup error**

Run:
```bash
pm2 reload pds-backend --update-env
sleep 2
pm2 logs pds-backend --lines 30 --nostream | grep -iE 'error|fatal' || echo "(no errors)"
```
Expected: `(no errors)`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/chat/streaming/config.js
git commit -m "chore(backend): drop stale MODEL_ALIASES from streaming/config.js

The two keys (gpt-5-mini, gpt-4.1) referenced models that are no longer
in the chat path. Verified zero consumers in backend/src before delete.
Frontend has its own MODEL_ALIASES which is the actual source of truth
for display names. Closes followup #3."
```

---

## Task 7: [P3] Fix contradictory comment at `streaming.service.js:95`

**Files:**
- Modify: `backend/src/services/chat/streaming.service.js:95`

- [ ] **Step 1: Backup + edit**

Run:
```bash
cp backend/src/services/chat/streaming.service.js backend/src/services/chat/streaming.service.js.backup
```

Replace line 95:

```javascript
// shared openaiClient.chat() helper. Single Sonnet lane — no tier-based selection.
```

- [ ] **Step 2: Verify diff**

Run:
```bash
diff backend/src/services/chat/streaming.service.js.backup backend/src/services/chat/streaming.service.js
```
Expected: one-line replacement of the contradictory comment, nothing else.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/chat/streaming.service.js
git commit -m "docs(backend): fix contradictory comment about tier-based model selection

Line 95 referenced modelForTier, contradicting line 98 which (correctly)
notes modelForTier/MODEL_TIERS were removed 2026-05-16. Closes
followup #4."
```

---

## Task 8: [P3] Clean up stale `.backup` files

**Files:**
- Delete: `.backup` files older than 7 days under `backend/src/` and `frontend/src/`

**Why:** Followup #5. The CLAUDE.md backup rule + many sessions = ~60 stale files. Gitignored, so no functional impact, but disk + `ls` noise.

- [ ] **Step 1: Preview what would be deleted (dry run)**

Run:
```bash
find /var/www/html/project-data-strategis/backend/src \
     /var/www/html/project-data-strategis/frontend/src \
     -name '*.backup' -mtime +7 -print 2>/dev/null | wc -l
find /var/www/html/project-data-strategis/backend/src \
     /var/www/html/project-data-strategis/frontend/src \
     -name '*.backup' -mtime +7 -print 2>/dev/null | head -10
```
Expected: a count (likely 30-60), and a sample of paths.

- [ ] **Step 2: Confirm gitignored (we should never delete tracked files)**

Run:
```bash
git status --ignored backend/src frontend/src 2>&1 | grep -c '\.backup$' || echo 0
git ls-files backend/src frontend/src | grep -c '\.backup$' || echo 0
```
Expected: first count > 0 (gitignored), second count = 0 (not tracked).

- [ ] **Step 3: Delete**

Run:
```bash
find /var/www/html/project-data-strategis/backend/src \
     /var/www/html/project-data-strategis/frontend/src \
     -name '*.backup' -mtime +7 -delete
```
Expected: silent success.

- [ ] **Step 4: Confirm git status is unchanged**

Run:
```bash
git status -s | grep -c '.backup$' || echo 0
```
Expected: `0` — no tracked file was touched.

- [ ] **Step 5: No commit needed**

This task touches nothing in the repo. Move on.

---

## Task 9: Close PR #5 (retrospective audit) and any throwaway branches

**Files:** GitHub state only.

**Why:** Retrospective PR was opened just for audit on the shipped work. Now that the followups are closed it can be closed without merging (the work is already on main).

- [ ] **Step 1: Auth gh CLI**

Run:
```bash
gh auth status 2>&1 | tail -5
```
If "not logged in": stop and ask the user to run `gh auth login` themselves (interactive). The user can use the `!` prefix to run it inline. If logged in, proceed.

- [ ] **Step 2: View PR #5 + list any open throwaway branches**

Run:
```bash
gh pr view 5 --repo gumxlarcw/malika --json state,title,url,headRefName
git branch -a --list 'origin/*' | grep -v 'origin/main' | grep -v 'origin/HEAD'
```
Expected: PR is `OPEN`. List of any non-main branches on origin.

- [ ] **Step 3: Close PR #5 with a comment**

Run:
```bash
gh pr close 5 --repo gumxlarcw/malika --comment "Closing — this was a retrospective audit PR for work that's already on main (commits e0ef09a..3459331). Follow-ups tracked in docs/superpowers/followups/2026-05-16-sonnet-only-followups.md are now also closed (see plan 2026-05-16-sonnet-only-followups-cleanup.md)."
```
Expected: `Closed pull request #5`.

- [ ] **Step 4: Delete the PR's source branch (remote)**

Get the head ref from Step 2's output (likely something like `audit/sonnet-only-2026-05-16`). Then:

```bash
gh api -X DELETE "repos/gumxlarcw/malika/git/refs/heads/<HEAD_REF_FROM_STEP_2>"
```

If there are other throwaway branches (per Step 2's `git branch -a` listing) and the user confirms they're disposable, delete each:

```bash
gh api -X DELETE "repos/gumxlarcw/malika/git/refs/heads/<branch-name>"
```

**Caveat:** Do not delete `origin/main` or any branch you can't verify is disposable. If unsure, list them to the user and ask before deleting.

- [ ] **Step 5: Prune local tracking refs**

Run:
```bash
git fetch --prune origin
git branch -r
```
Expected: `origin/main` plus only branches that actually exist remotely.

- [ ] **Step 6: No commit needed**

GitHub side only. Move on.

---

## Task 10: Final verification + push

**Files:** None (verification + push).

- [ ] **Step 1: Confirm working tree is what we expect**

Run:
```bash
git status -s
```
Expected: still shows the 3 pre-existing modified frontend files + 4 untracked report files from prior sessions (these were present at session start and we did NOT touch them per CLAUDE.md). No other untracked or modified files (everything we changed should already be committed by Tasks 2-7).

- [ ] **Step 2: Confirm we have N new commits ahead of origin**

Run:
```bash
git log origin/main..HEAD --oneline
```
Expected: 5-7 commits (Task 1's optional doc commit + Tasks 2, 3, 4, 5, 6, 7). Task 8 and 9 don't commit.

- [ ] **Step 3: Run backend jest, confirm baseline**

Run:
```bash
cd backend && npm test 2>&1 | tail -5
```
Expected: 291+ passed / 18 failed (same baseline as session start). Any new failure → STOP, investigate, fix before pushing.

- [ ] **Step 4: Confirm backend starts clean**

Run:
```bash
pm2 status | grep pds-backend
pm2 logs pds-backend --lines 20 --nostream | grep -iE 'error|fatal' || echo "(no errors)"
```
Expected: `online`, no errors in recent logs.

- [ ] **Step 5: Push to origin**

Run:
```bash
git push origin main
```
Expected: clean fast-forward push. If rejected with non-fast-forward: STOP — someone pushed concurrently; reassess.

- [ ] **Step 6: Update follow-ups doc to mark all closed**

Backup + edit `docs/superpowers/followups/2026-05-16-sonnet-only-followups.md` to add a header note:

```markdown
> **Status (2026-05-16):** All 7 followups closed. See plan
> `docs/superpowers/plans/2026-05-16-sonnet-only-followups-cleanup.md`
> and commits in `git log --since=2026-05-16 --grep='followup\|requireProxyUrl\|MODEL_ALIASES\|evaluate-chat-result'`.
```

Commit and push:

```bash
git add docs/superpowers/followups/2026-05-16-sonnet-only-followups.md
git commit -m "docs(followups): mark all 7 sonnet-only followups closed"
git push origin main
```

- [ ] **Step 7: Update memory pointers**

If during execution any new project memory needs updating (e.g., the test-harness false-fail memory `eval_harness_greeting_falsefail.md` should now point at the fix commit), update it via the Write tool. Don't create new memory entries unless something genuinely non-obvious surfaced.

- [ ] **Step 8: Final status check**

Run:
```bash
git log --oneline -10
git status -s
gh pr list --repo gumxlarcw/malika --state open 2>/dev/null | head -5
```
Expected:
- 6-8 new commits on main from this plan
- working tree shows only the same pre-existing files from session start
- PR #5 no longer in the open list

---

## Risk notes

- **Backend reload fails after a Task 3-6 change** → restore from the relevant `.backup` file, debug locally, retry.
- **Frontend build fails in Task 5** → likely a TS lint issue with the added comment block. Adjust comment formatting; do not skip the build (CLAUDE.md mandate: pm2 reload alone doesn't rebuild).
- **Jest baseline drifts** → if jest count drops below 291 passed, do not push. Investigate the new failure first; it's likely a test that imports a module we just refactored.
- **gh CLI not authed** → Task 9 stalls. Tell the user to `! gh auth login` and resume from Step 1 of Task 9. Don't try to auth on the user's behalf.
- **Manual smoke test fails (Task 1)** → STOP the entire plan. The shipped work isn't actually working in production; followup cleanups are premature.

## What this plan deliberately does NOT do

- Does not open a new retrospective PR. Old PR #5 is being closed; recent project pattern is direct-to-main commits.
- Does not delete the `OPENAI_API_KEY_CHAT|_INTERPRETATION|_QUERY_BUILDER` env vars themselves — Task 4 only stops one consumer from reading them. Other consumers may still depend on them. Removing them is a separate concern.
- Does not rebuild Next.js admin (`pds-admin`) — none of these changes touch admin code.
- Does not add new tests beyond the two narrow ones (test-harness fallback, requireProxyUrl helper). Followups are cleanup, not new behavior to verify.
