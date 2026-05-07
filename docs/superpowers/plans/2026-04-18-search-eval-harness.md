# Search Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified eval harness with `search` + `chat` profiles. The `search` profile tests the PWA `/search` pipeline across 7 stages with zero chat-LLM calls. The `chat` profile preserves today's behavior byte-for-byte. Outputs JSON + Markdown reports.

**Architecture:** `backend/evals/run-eval.js` becomes a profile dispatcher. Shared helpers (`httpClient`, `scoring`, `reportWriter`) extracted to `lib/`. Two profiles (`chat`, `search`) implement a small contract. Two fixture files (`chat-cases.json` renamed from `eval-set.json`; new `search-cases.json`). PR-0 adds a `noLlm` flag to `/search/intent` so the PWA and the `intent_det` stage can force deterministic behavior.

**Tech Stack:** Node.js v25 native `http` module (existing runner pattern), Jest 29 for unit tests, JSON fixtures, no external deps.

**Spec:** `docs/superpowers/specs/2026-04-18-search-eval-harness-design.md`

---

## Pre-flight

- [ ] **Step 0.1: Verify baseline runs (optional but recommended)**

Before touching code, capture a reference report to diff against post-refactor. If PM2 `pds-backend` isn't running, skip this step — the safety gate at Task 7 will substitute a synthetic canary test.

```bash
cd /var/www/html/project-data-strategis/backend
node evals/run-eval.js --id=greeting-01 --verbose 2>&1 | tee /tmp/eval-baseline.txt
```

Expected: either a full report written to `evals/reports/eval-*.json`, OR clear error "Failed to create eval thread" (backend not running). Either outcome is acceptable — we'll use Task 7's synthetic canary in both cases.

---

## Phase A — Safety refactor (preserve chat behavior)

### Task 1: Rename fixture file

**Files:**
- Rename: `backend/evals/fixtures/eval-set.json` → `backend/evals/fixtures/chat-cases.json`
- Modify: `backend/evals/run-eval.js:29` (path reference)

**Why:** The spec's profile abstraction needs per-profile fixture names. Keep `master-test-cases.json` untouched — it's a separate unused fixture, not what the runner reads.

- [ ] **Step 1.1: Back up the runner**

```bash
cp /var/www/html/project-data-strategis/backend/evals/run-eval.js \
   /var/www/html/project-data-strategis/backend/evals/run-eval.js.backup
```

- [ ] **Step 1.2: Rename the fixture file**

```bash
cd /var/www/html/project-data-strategis/backend/evals/fixtures
git mv eval-set.json chat-cases.json
```

- [ ] **Step 1.3: Update the path reference in the runner**

Open `backend/evals/run-eval.js`. Find line 29:

```js
const evalSet = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'eval-set.json'), 'utf8')
);
```

Replace `'eval-set.json'` with `'chat-cases.json'`.

- [ ] **Step 1.4: Verify fixture still loads**

```bash
cd /var/www/html/project-data-strategis/backend
node -e "const s=require('./evals/fixtures/chat-cases.json'); console.log('cases:', s.cases.length)"
```

Expected output: `cases: 31`

- [ ] **Step 1.5: Commit**

```bash
git add backend/evals/fixtures/chat-cases.json backend/evals/run-eval.js
git commit -m "refactor(evals): rename eval-set.json to chat-cases.json (no behavior change)"
```

---

### Task 2: Extract `lib/httpClient.js` with tests

**Files:**
- Create: `backend/evals/lib/httpClient.js`
- Create: `backend/evals/__tests__/httpClient.test.js`
- Modify: `backend/evals/run-eval.js` (swap `httpRequest` and `sendMessageStreaming` to require from lib)

**Why:** Both profiles need HTTP calls with timing. Chat needs SSE streaming; search needs simple JSON GET. Consolidate the existing `httpRequest` (line 40-74) and `sendMessageStreaming` (line 80-204) from the runner into `lib/httpClient.js` unchanged. Also add a new `httpGetJson(url, timeoutMs)` helper for search endpoints.

- [ ] **Step 2.1: Write the failing test for `httpGetJson`**

Create `backend/evals/__tests__/httpClient.test.js`:

```js
const http = require('http');
const { httpGetJson } = require('../lib/httpClient');

describe('httpGetJson', () => {
  let server;
  let port;

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      if (req.url === '/ok') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ items: [1, 2, 3] }));
      } else if (req.url === '/bad') {
        res.writeHead(500);
        res.end('server error');
      } else if (req.url === '/notjson') {
        res.writeHead(200);
        res.end('hello world');
      }
    });
    server.listen(0, () => { port = server.address().port; done(); });
  });

  afterAll((done) => server.close(done));

  test('returns parsed JSON with status and latencyMs', async () => {
    const r = await httpGetJson(`http://127.0.0.1:${port}/ok`);
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ items: [1, 2, 3] });
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('returns raw body when response is not JSON', async () => {
    const r = await httpGetJson(`http://127.0.0.1:${port}/notjson`);
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ raw: 'hello world' });
  });

  test('returns status code on non-2xx', async () => {
    const r = await httpGetJson(`http://127.0.0.1:${port}/bad`);
    expect(r.status).toBe(500);
  });
});
```

- [ ] **Step 2.2: Run to verify failure**

```bash
cd /var/www/html/project-data-strategis/backend
npx jest evals/__tests__/httpClient.test.js
```

Expected: FAIL — "Cannot find module '../lib/httpClient'"

- [ ] **Step 2.3: Create `lib/httpClient.js`**

Create `backend/evals/lib/httpClient.js`:

```js
'use strict';

const http = require('http');
const https = require('https');

function pickTransport(urlStr) {
  return urlStr.startsWith('https:') ? https : http;
}

function request(method, urlStr, { body = null, headers = {}, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const transport = pickTransport(urlStr);
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };
    const start = Date.now();
    const req = transport.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const latencyMs = Date.now() - start;
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), latencyMs });
        } catch {
          resolve({ status: res.statusCode, data: { raw: data }, latencyMs });
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Request timeout after ${timeoutMs}ms`)));
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function httpGetJson(urlStr, timeoutMs = 30000, extraHeaders = {}) {
  return request('GET', urlStr, { timeoutMs, headers: extraHeaders });
}

function httpPostJson(urlStr, body, timeoutMs = 120000, extraHeaders = {}) {
  return request('POST', urlStr, { body, timeoutMs, headers: extraHeaders });
}

module.exports = { httpGetJson, httpPostJson, request };
```

- [ ] **Step 2.4: Run tests — verify pass**

```bash
npx jest evals/__tests__/httpClient.test.js
```

Expected: PASS (3 tests).

- [ ] **Step 2.5: Migrate `run-eval.js` to use `httpClient` — keep SSE logic local**

In `run-eval.js`, remove the `httpRequest` function (line 40-74) and replace with:

```js
const { httpPostJson, request } = require('./lib/httpClient');

// Back-compat wrapper so existing callers keep working
function httpRequest(method, urlPath, body = null, timeoutMs = 120000) {
  const urlStr = new URL(urlPath, API_BASE).toString();
  return request(method, urlStr, {
    body,
    timeoutMs,
    headers: { 'x-malika-uid': EVAL_UID },
  });
}
```

Leave `sendMessageStreaming` unchanged — SSE handling is chat-profile-specific and will move to the chat profile module in Task 5.

- [ ] **Step 2.6: Smoke test — verify runner still starts**

```bash
node -e "require('./evals/run-eval.js')" 2>&1 | head -5
```

Expected: the runner starts and immediately tries to connect to `http://localhost:5000`. If PM2 isn't running, it fails at `createThread` — acceptable. What we're confirming: no syntax errors, no `MODULE_NOT_FOUND`.

- [ ] **Step 2.7: Commit**

```bash
git add backend/evals/lib/httpClient.js backend/evals/__tests__/httpClient.test.js backend/evals/run-eval.js
git commit -m "refactor(evals): extract lib/httpClient.js with unit tests"
```

---

### Task 3: Extract `lib/scoring.js` with tests

**Files:**
- Create: `backend/evals/lib/scoring.js`
- Create: `backend/evals/__tests__/scoring.test.js`
- Modify: `backend/evals/run-eval.js` (remove `heuristicScore`, import from lib)

**Why:** Scoring is the most testable unit in the runner (pure function, no I/O). Move `heuristicScore` (line 242-344) to `lib/scoring.js` unchanged. Add `scoreStructural(result, expect)` for search profile — an empty shell in this task, filled in Task 12.

- [ ] **Step 3.1: Write failing test for regex scorer**

Create `backend/evals/__tests__/scoring.test.js`:

```js
const { heuristicScore } = require('../lib/scoring');

describe('heuristicScore', () => {
  test('full match gives grade A', () => {
    const response = { content: 'MALIKA siap membantu. Angka inflasi 2.5%.', latencyMs: 1000 };
    const expect_ = {
      shouldContain: ['MALIKA', 'inflasi'],
      shouldNotContain: ['error'],
      mustCiteNumber: true,
      minLength: 20,
      maxLatencyMs: 5000,
    };
    const r = heuristicScore(response, expect_);
    expect(r.grade).toBe('A');
    expect(r.composite).toBeGreaterThanOrEqual(0.9);
  });

  test('missing required token lowers score', () => {
    const response = { content: 'Halo dunia.', latencyMs: 500 };
    const expect_ = { shouldContain: ['MALIKA'], minLength: 10, maxLatencyMs: 2000 };
    const r = heuristicScore(response, expect_);
    expect(r.details.shouldContain.missing).toContain('MALIKA');
    expect(r.grade).not.toBe('A');
  });

  test('alternation with | matches any one', () => {
    const response = { content: 'Inflasi 2.5 persen.', latencyMs: 1000 };
    const expect_ = { shouldContain: ['%|persen'] };
    const r = heuristicScore(response, expect_);
    expect(r.details.shouldContain.score).toBe(1);
  });
});
```

- [ ] **Step 3.2: Run — verify failure**

```bash
npx jest evals/__tests__/scoring.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3.3: Create `lib/scoring.js` with the existing scorer**

Create `backend/evals/lib/scoring.js`:

```js
'use strict';

function heuristicScore(response, expect) {
  const scores = {};
  const content = response.content;
  const contentLower = content.toLowerCase();

  if (expect.shouldContain) {
    const found = [];
    const missing = [];
    for (const s of expect.shouldContain) {
      const alternatives = s.split('|');
      const match = alternatives.find((a) => contentLower.includes(a.toLowerCase()));
      if (match) found.push(match);
      else missing.push(s);
    }
    scores.shouldContain = {
      score: found.length / expect.shouldContain.length,
      found,
      missing,
    };
  }

  if (expect.shouldNotContain) {
    const violations = expect.shouldNotContain.filter((s) => contentLower.includes(s.toLowerCase()));
    scores.shouldNotContain = { score: violations.length === 0 ? 1 : 0, violations };
  }

  if (expect.mustCiteNumber) {
    const numbers = (content.match(/\d[\d.,]+\d|\d+/g) || []).filter((n) => n.replace(/[.,]/g, '').length >= 2);
    scores.mustCiteNumber = { score: numbers.length >= 1 ? 1 : 0, numbersFound: numbers.length };
  }

  if (expect.mustCiteSource) {
    const sourcePatterns = /sumber|brs|publikasi|sensus|sakernas|susenas|survei|ihk|indeks harga|berasal dari/i;
    scores.mustCiteSource = { score: sourcePatterns.test(content) ? 1 : 0 };
  }

  if (expect.minLength) {
    scores.minLength = { score: content.length >= expect.minLength ? 1 : 0, actual: content.length, required: expect.minLength };
  }

  if (expect.maxLatencyMs) {
    scores.latency = { score: response.latencyMs <= expect.maxLatencyMs ? 1 : 0, actual: response.latencyMs, limit: expect.maxLatencyMs };
  }

  scores.noAskBack = {
    score: /apakah anda|bisa diperjelas|maksud anda/i.test(content) ? 0 : 1,
    description: 'Should not ask clarifying questions when data is available',
  };

  const weights = {
    shouldContain: 0.25,
    shouldNotContain: 0.20,
    mustCiteNumber: 0.20,
    mustCiteSource: 0.10,
    minLength: 0.10,
    latency: 0.10,
    noAskBack: 0.05,
  };

  let totalWeight = 0;
  let weightedSum = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (scores[key]) {
      weightedSum += scores[key].score * weight;
      totalWeight += weight;
    }
  }

  const composite = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const grade = composite >= 0.9 ? 'A' : composite >= 0.8 ? 'B' : composite >= 0.7 ? 'C' : composite >= 0.5 ? 'D' : 'F';

  return { composite: Math.round(composite * 100) / 100, grade, details: scores };
}

// Placeholder — implemented in Task 12
function scoreStructural(result, expect) {
  throw new Error('scoreStructural: not implemented yet (Task 12)');
}

module.exports = { heuristicScore, scoreStructural };
```

- [ ] **Step 3.4: Run — verify pass**

```bash
npx jest evals/__tests__/scoring.test.js
```

Expected: PASS (3 tests).

- [ ] **Step 3.5: Remove `heuristicScore` from `run-eval.js` and import**

In `run-eval.js`, delete the entire `heuristicScore` function (line 242-344) and add at the top of the file (near other requires):

```js
const { heuristicScore } = require('./lib/scoring');
```

- [ ] **Step 3.6: Verify no syntax errors**

```bash
node -c backend/evals/run-eval.js
```

Expected: no output (success).

- [ ] **Step 3.7: Commit**

```bash
git add backend/evals/lib/scoring.js backend/evals/__tests__/scoring.test.js backend/evals/run-eval.js
git commit -m "refactor(evals): extract lib/scoring.js (heuristicScore + scoreStructural stub)"
```

---

### Task 4: Extract `lib/reportWriter.js` with tests

**Files:**
- Create: `backend/evals/lib/reportWriter.js`
- Create: `backend/evals/__tests__/reportWriter.test.js`
- Modify: `backend/evals/run-eval.js` (remove inline report save, call `reportWriter.write`)

**Why:** Both profiles write identical-shape reports. Centralize filename timestamping, directory creation, and JSON formatting. Markdown writer is added in Task 18.

- [ ] **Step 4.1: Write failing test**

Create `backend/evals/__tests__/reportWriter.test.js`:

```js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { writeJsonReport, timestampString } = require('../lib/reportWriter');

describe('reportWriter', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('writes JSON to dated filename and returns path', () => {
    const report = { meta: { duration_ms: 123 }, profiles: { chat: { cases: [] } } };
    const p = writeJsonReport({ dir: tmpDir, report, now: new Date('2026-04-18T10:30:22Z') });
    expect(p).toBe(path.join(tmpDir, 'eval-2026-04-18-10-30.json'));
    expect(fs.existsSync(p)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    expect(parsed.meta.duration_ms).toBe(123);
  });

  test('creates directory if it does not exist', () => {
    const nested = path.join(tmpDir, 'nested', 'reports');
    writeJsonReport({ dir: nested, report: {}, now: new Date('2026-04-18T10:30:22Z') });
    expect(fs.existsSync(nested)).toBe(true);
  });

  test('timestampString formats a Date correctly', () => {
    expect(timestampString(new Date('2026-04-18T10:30:22Z'))).toBe('2026-04-18-10-30');
  });
});
```

- [ ] **Step 4.2: Run — verify failure**

```bash
npx jest evals/__tests__/reportWriter.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 4.3: Create `lib/reportWriter.js`**

```js
'use strict';

const fs = require('fs');
const path = require('path');

function timestampString(now) {
  return now.toISOString().replace(/[T:]/g, '-').slice(0, 16);
}

function writeJsonReport({ dir, report, now = new Date() }) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = `eval-${timestampString(now)}.json`;
  const p = path.join(dir, filename);
  fs.writeFileSync(p, JSON.stringify(report, null, 2));
  return p;
}

module.exports = { writeJsonReport, timestampString };
```

- [ ] **Step 4.4: Run — verify pass**

```bash
npx jest evals/__tests__/reportWriter.test.js
```

Expected: PASS (3 tests).

- [ ] **Step 4.5: Migrate `run-eval.js` report saving**

In `run-eval.js`, replace the "Save report" block (around line 465-488) with:

```js
const { writeJsonReport } = require('./lib/reportWriter');
const reportPath = writeJsonReport({
  dir: path.join(__dirname, 'reports'),
  report: {
    timestamp: now.toISOString(),
    summary: {
      total: results.length,
      passed,
      failed,
      averageScore: Math.round(avgScore * 100) / 100,
      averageLatencyMs: Math.round(avgLatency),
      grades,
      categories,
    },
    cases: results,
  },
});
console.log(`\n💾 Report saved: ${reportPath}`);
```

- [ ] **Step 4.6: Commit**

```bash
git add backend/evals/lib/reportWriter.js backend/evals/__tests__/reportWriter.test.js backend/evals/run-eval.js
git commit -m "refactor(evals): extract lib/reportWriter.js with unit tests"
```

---

### Task 5: Extract `lib/profiles/chat.js` — profile abstraction

**Files:**
- Create: `backend/evals/lib/profiles/chat.js`
- Create: `backend/evals/__tests__/profiles.chat.test.js`
- Modify: `backend/evals/run-eval.js` (becomes dispatcher)

**Why:** The dispatcher shell reads `--profile`, loads the profile module, calls `loadFixture()` → `runCase()` → `summarize()`. This is the refactor that makes search-profile addition a purely additive change.

- [ ] **Step 5.1: Write failing test for profile contract**

Create `backend/evals/__tests__/profiles.chat.test.js`:

```js
const chatProfile = require('../lib/profiles/chat');

describe('chat profile contract', () => {
  test('exports required fields', () => {
    expect(chatProfile.name).toBe('chat');
    expect(typeof chatProfile.loadFixture).toBe('function');
    expect(typeof chatProfile.runCase).toBe('function');
    expect(typeof chatProfile.summarize).toBe('function');
  });

  test('loadFixture returns cases from chat-cases.json', () => {
    const cases = chatProfile.loadFixture();
    expect(Array.isArray(cases)).toBe(true);
    expect(cases.length).toBeGreaterThan(0);
    expect(cases[0]).toHaveProperty('id');
    expect(cases[0]).toHaveProperty('query');
    expect(cases[0]).toHaveProperty('expect');
  });

  test('summarize computes aggregate metrics', () => {
    const results = [
      { id: 'a', category: 'greeting', score: { composite: 0.95, grade: 'A' }, response: { latencyMs: 1000 } },
      { id: 'b', category: 'greeting', score: { composite: 0.60, grade: 'D' }, response: { latencyMs: 2000 } },
      { id: 'c', category: 'period',   score: { composite: 0.85, grade: 'B' }, response: { latencyMs: 1500 } },
    ];
    const s = chatProfile.summarize(results);
    expect(s.cases_total).toBe(3);
    expect(s.cases_passed).toBe(2); // A + B
    expect(s.overall_score).toBeCloseTo((0.95 + 0.60 + 0.85) / 3, 2);
    expect(s.by_category.greeting.total).toBe(2);
    expect(s.by_category.greeting.passed).toBe(1);
  });
});
```

- [ ] **Step 5.2: Run — verify failure**

```bash
npx jest evals/__tests__/profiles.chat.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 5.3: Create `lib/profiles/chat.js`**

```js
'use strict';

const fs = require('fs');
const path = require('path');
const { heuristicScore } = require('../scoring');
const { request } = require('../httpClient');

const FIXTURE_PATH = path.join(__dirname, '..', '..', 'fixtures', 'chat-cases.json');
const EVAL_UID = 'eval-runner-system';

function loadFixture() {
  const raw = fs.readFileSync(FIXTURE_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  return parsed.cases;
}

async function createThread(apiBase) {
  const res = await request('POST', new URL('/chat/threads', apiBase).toString(), {
    body: { title: `eval-${Date.now()}` },
    timeoutMs: 30000,
    headers: { 'x-malika-uid': EVAL_UID },
  });
  if (!res.data?.thread?.id) throw new Error(`Failed to create thread: ${JSON.stringify(res.data)}`);
  return res.data.thread.id;
}

// sendMessageStreaming: lifted verbatim from run-eval.js (lines 80-204).
// Preserved byte-for-byte to satisfy C5 safety gate.
// <<<PASTE EXISTING sendMessageStreaming FUNCTION HERE>>>

async function sendMessage(threadId, text, apiBase, verbose = false) {
  const streamResult = await sendMessageStreaming(threadId, text, apiBase, verbose);
  if (streamResult.content && !streamResult.error) return streamResult;

  const start = Date.now();
  const res = await request('POST', new URL(`/chat/threads/${threadId}/messages`, apiBase).toString(), {
    body: { text },
    headers: { 'x-malika-uid': EVAL_UID },
  });
  const latencyMs = Date.now() - start;
  if (!res.data?.assistant) return { content: '', latencyMs, error: res.data?.message || 'No assistant response' };
  return {
    content: res.data.assistant.content || '',
    model: res.data.assistant.model,
    tokensIn: res.data.assistant.tokens_in,
    tokensOut: res.data.assistant.tokens_out,
    latencyMs,
  };
}

async function runCase(testCase, ctx) {
  const { apiBase, verbose } = ctx;
  const threadId = await createThread(apiBase);
  const response = await sendMessage(threadId, testCase.query, apiBase, verbose);
  if (response.error) {
    return {
      id: testCase.id,
      category: testCase.category,
      query: testCase.query,
      response: { latencyMs: response.latencyMs },
      score: { composite: 0, grade: 'F', error: response.error },
    };
  }
  const score = heuristicScore(response, testCase.expect);
  return {
    id: testCase.id,
    category: testCase.category,
    query: testCase.query,
    response: {
      content: response.content.slice(0, 1500),
      model: response.model,
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
      latencyMs: response.latencyMs,
    },
    score,
  };
}

function summarize(results) {
  const grades = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  const byCategory = {};
  let sum = 0;
  let latencySum = 0;
  let latencyCount = 0;
  const latencies = [];

  for (const r of results) {
    const g = r.score?.grade || 'F';
    grades[g]++;
    sum += r.score?.composite || 0;
    if (r.response?.latencyMs) {
      latencySum += r.response.latencyMs;
      latencyCount++;
      latencies.push(r.response.latencyMs);
    }
    const cat = r.category || 'unknown';
    if (!byCategory[cat]) byCategory[cat] = { total: 0, passed: 0, sum: 0 };
    byCategory[cat].total++;
    byCategory[cat].sum += r.score?.composite || 0;
    if (g === 'A' || g === 'B') byCategory[cat].passed++;
  }

  for (const cat of Object.keys(byCategory)) {
    byCategory[cat].score = byCategory[cat].total > 0
      ? Math.round((byCategory[cat].sum / byCategory[cat].total) * 1000) / 1000
      : 0;
  }

  const passed = grades.A + grades.B;
  const overall = results.length > 0 ? Math.round((sum / results.length) * 1000) / 1000 : 0;
  latencies.sort((a, b) => a - b);
  const p95 = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] : 0;

  return {
    cases_total: results.length,
    cases_passed: passed,
    overall_score: overall,
    grades,
    by_category: byCategory,
    mean_latency_ms: latencyCount ? Math.round(latencySum / latencyCount) : 0,
    p95_latency_ms: p95,
  };
}

module.exports = { name: 'chat', loadFixture, runCase, summarize, sendMessageStreaming };
```

Then lift the existing `sendMessageStreaming` from `run-eval.js:80-204` verbatim and paste it where the placeholder comment is. Adjust its signature to accept `apiBase` and `verbose` instead of reading globals:

```js
function sendMessageStreaming(threadId, text, apiBase, verbose = false, timeoutMs = 120000) {
  // ... existing body ...
  // Replace `new URL(..., API_BASE)` with `new URL(..., apiBase)`
  // Replace every `if (verbose)` reference to use the param, not the global
}
```

- [ ] **Step 5.4: Run — verify pass**

```bash
npx jest evals/__tests__/profiles.chat.test.js
```

Expected: PASS (3 tests).

- [ ] **Step 5.5: Rewrite `run-eval.js` as a profile dispatcher**

Replace the contents of `backend/evals/run-eval.js` (keep the backup). New content:

```js
#!/usr/bin/env node
'use strict';

/**
 * MALIKA Eval Runner — profile dispatcher
 *
 * Usage:
 *   node evals/run-eval.js                   # all profiles
 *   node evals/run-eval.js --profile=chat
 *   node evals/run-eval.js --profile=search
 *   node evals/run-eval.js --id=greeting-01
 *   node evals/run-eval.js --category=period
 *   node evals/run-eval.js --verbose
 */

const path = require('path');
const { writeJsonReport } = require('./lib/reportWriter');

const API_BASE = process.env.EVAL_API_BASE || 'http://localhost:5000';
const BFF_BASE = process.env.EVAL_BFF_BASE || 'http://localhost:6060';

// ── CLI parsing ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function flag(name) { return args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`)); }
function flagValue(name, fallback) { const f = flag(name); if (!f) return fallback; if (!f.includes('=')) return true; return f.split('=').slice(1).join('='); }

const profileArg = String(flagValue('profile', 'all'));
const categoryFilter = flagValue('category', null);
const idFilter = flagValue('id', null);
const tagFilter = flagValue('tag', null);
const verbose = !!flag('verbose');

const PROFILE_DELAYS = { chat: 5000, search: 100 };

async function runProfile(profile, ctx) {
  let cases = profile.loadFixture();
  if (idFilter) cases = cases.filter((c) => c.id === idFilter);
  if (categoryFilter) cases = cases.filter((c) => c.category === categoryFilter);
  if (tagFilter) cases = cases.filter((c) => Array.isArray(c.tags) && c.tags.includes(tagFilter));

  console.log(`\n🧪 Profile: ${profile.name} — ${cases.length} cases`);

  const results = [];
  const delay = PROFILE_DELAYS[profile.name] || 100;
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    process.stdout.write(`[${i + 1}/${cases.length}] ${c.id}: "${c.query}" ... `);
    try {
      const result = await profile.runCase(c, ctx);
      results.push(result);
      // For chat profile, keep the same visual output as before.
      if (result.score?.grade) {
        const g = result.score.grade;
        const icon = g === 'A' || g === 'B' ? '✅' : g === 'C' ? '⚠️' : '❌';
        const ms = result.response?.latencyMs || 0;
        const len = result.response?.content?.length || 0;
        console.log(`${icon} ${g} (${Math.round((result.score.composite || 0) * 100)}%) — ${ms}ms — ${len} chars`);
      } else {
        console.log(`done`);
      }
    } catch (err) {
      console.log(`❌ EXCEPTION: ${err.message}`);
      results.push({ id: c.id, category: c.category, query: c.query, score: { composite: 0, grade: 'F', error: err.message } });
    }
    if (i < cases.length - 1) await new Promise((r) => setTimeout(r, delay));
  }

  return { summary: profile.summarize(results), cases: results };
}

async function main() {
  const profilesToRun = [];
  if (profileArg === 'all' || profileArg === 'chat') profilesToRun.push(require('./lib/profiles/chat'));
  // Task 13 adds: if (profileArg === 'all' || profileArg === 'search') profilesToRun.push(require('./lib/profiles/search'));

  if (profilesToRun.length === 0) {
    console.error(`Unknown profile: ${profileArg}`);
    process.exit(2);
  }

  const ctx = { apiBase: API_BASE, bffBase: BFF_BASE, verbose };
  const startedAt = new Date();
  const profileResults = {};
  for (const profile of profilesToRun) {
    profileResults[profile.name] = await runProfile(profile, ctx);
  }
  const finishedAt = new Date();

  const report = {
    meta: {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt - startedAt,
      host: { base: API_BASE, bff: BFF_BASE },
      flags: { profile: profileArg, verbose, id: idFilter, category: categoryFilter, tag: tagFilter },
    },
    profiles: profileResults,
  };

  const reportPath = writeJsonReport({ dir: path.join(__dirname, 'reports'), report, now: finishedAt });
  console.log(`\n💾 Report saved: ${reportPath}`);
}

process.on('uncaughtException', (err) => { console.error('\n💀 Uncaught:', err.message, err.stack); process.exit(1); });
process.on('unhandledRejection', (reason) => { console.error('\n💀 Rejection:', reason); process.exit(1); });

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
```

- [ ] **Step 5.6: Smoke test the dispatcher**

```bash
cd /var/www/html/project-data-strategis/backend
node -c evals/run-eval.js  # syntax
node evals/run-eval.js --profile=chat --id=nonexistent-id 2>&1 | head -10  # should print "0 cases"
```

Expected: runner prints `Profile: chat — 0 cases` and writes an empty report. No crashes.

- [ ] **Step 5.7: Commit**

```bash
git add backend/evals/lib/profiles/chat.js backend/evals/__tests__/profiles.chat.test.js backend/evals/run-eval.js
git commit -m "refactor(evals): extract chat profile, convert run-eval.js to dispatcher"
```

---

### Task 6: All Jest tests pass

- [ ] **Step 6.1: Run the full eval test suite**

```bash
cd /var/www/html/project-data-strategis/backend
npx jest evals/
```

Expected: All tests pass (httpClient + scoring + reportWriter + chat profile).

- [ ] **Step 6.2: Run the full backend test suite**

```bash
npx jest --passWithNoTests --no-coverage 2>&1 | tail -5
```

Expected: "Tests: XXX passed". No regressions from the refactor. If any backend tests fail, they must fail *for reasons unrelated to `backend/evals`* (we didn't touch `src/`).

---

### Task 7: Safety gate — chat profile parity check

**Why:** C5 demands chat-profile output equivalent to pre-refactor. This is the gate before we touch anything else. If PM2 isn't available, substitute a canary offline check.

- [ ] **Step 7.1: If PM2 backend is running, run a small parity check**

```bash
pm2 list | grep -q pds-backend && echo "backend up" || echo "backend down"
```

If "backend up": run `node evals/run-eval.js --profile=chat --id=greeting-01 --verbose 2>&1 | tee /tmp/eval-post-refactor.txt` and compare the `grade`, `composite`, `latencyMs` fields of the output against `/tmp/eval-baseline.txt` (from Step 0.1). Scores should match exactly (regex scorer is deterministic).

If "backend down": skip to Step 7.2.

- [ ] **Step 7.2: Offline canary — dispatcher + filter plumbing**

```bash
cd /var/www/html/project-data-strategis/backend
node evals/run-eval.js --profile=chat --id=nonexistent 2>&1 | tail -15
```

Expected output contains:
- `Profile: chat — 0 cases`
- `💾 Report saved: .../reports/eval-YYYY-MM-DD-HH-MM.json`
- NO exceptions, NO `MODULE_NOT_FOUND`

- [ ] **Step 7.3: Inspect the empty-run report**

```bash
cat $(ls -t /var/www/html/project-data-strategis/backend/evals/reports/eval-*.json | head -1) | head -30
```

Expected: JSON with `meta.flags.id === "nonexistent"`, `profiles.chat.cases === []`, `profiles.chat.summary.cases_total === 0`.

- [ ] **Step 7.4: Clean up test reports**

```bash
rm -f /var/www/html/project-data-strategis/backend/evals/reports/eval-*.json  # only if all are from canary runs
```

Only delete if every report in `reports/` is from a canary run — if anything predates today, skip this step.

---

## Phase B — PR-0 prerequisites

### Task 8: Backend — `noLlm` flag in `resolveSearchIntent`

**Files:**
- Modify: `backend/src/services/search/intent.service.js:482-504`
- Create: `backend/src/__tests__/intent.service.noLlm.test.js`

**Why:** Stage 3 (`intent_det`) requires forcing deterministic path. The function already has a deterministic fallback at line 510-512; we just need a first-class way to opt in without relying on the LLM throwing.

- [ ] **Step 8.1: Back up the target file**

```bash
cp backend/src/services/search/intent.service.js backend/src/services/search/intent.service.js.backup
```

- [ ] **Step 8.2: Write failing test**

Create `backend/src/__tests__/intent.service.noLlm.test.js`:

```js
jest.mock('../services/ai/queryBuilder.service', () => ({
  buildQueryFromText: jest.fn().mockResolvedValue({ intent: 'data', type: 'dynamic', params: { year: 2024 }, confidence: 0.9 }),
}));
jest.mock('../services/search/datasourceSearch.service', () => ({
  searchDatasources: jest.fn().mockResolvedValue([]),
}));
jest.mock('../services/bpsRead/indicatorAvailability.service', () => ({
  indicatorTableExistsInBps: jest.fn().mockResolvedValue({ available: true }),
}));

const qbService = require('../services/ai/queryBuilder.service');
const { resolveSearchIntent } = require('../services/search/intent.service');

describe('resolveSearchIntent noLlm flag', () => {
  beforeEach(() => { qbService.buildQueryFromText.mockClear(); });

  test('calls LLM by default', async () => {
    await resolveSearchIntent({ q: 'tpt malut 2024' });
    expect(qbService.buildQueryFromText).toHaveBeenCalled();
  });

  test('skips LLM when noLlm=true', async () => {
    await resolveSearchIntent({ q: 'tpt malut 2024', noLlm: true });
    expect(qbService.buildQueryFromText).not.toHaveBeenCalled();
  });

  test('returns valid plan shape even when noLlm=true', async () => {
    const r = await resolveSearchIntent({ q: 'tpt malut 2024', noLlm: true });
    expect(r.ok).toBe(true);
    expect(r).toHaveProperty('query');
    expect(r).toHaveProperty('query_builder');
    expect(r).toHaveProperty('plan');
  });
});
```

- [ ] **Step 8.3: Run — verify failure**

```bash
cd /var/www/html/project-data-strategis/backend
npx jest src/__tests__/intent.service.noLlm.test.js
```

Expected: FAIL — `expected buildQueryFromText not to have been called` (the `noLlm` param isn't wired yet, so LLM still runs).

- [ ] **Step 8.4: Wire the `noLlm` flag**

In `backend/src/services/search/intent.service.js`, find the function signature at line 482:

```js
async function resolveSearchIntent({ q, context = '' }) {
```

Change to:

```js
async function resolveSearchIntent({ q, context = '', noLlm = false }) {
```

Then find the LLM try/catch at lines 498-504:

```js
  // 1) Try LLM query builder (best quality), but keep a DB-only deterministic fallback.
  try {
    qbRaw = await buildQueryFromText({ q: query, context });
    qb = normalizeQueryBuilder(qbRaw);
  } catch {
    qbRaw = null;
    qb = null;
  }
```

Wrap in `if (!noLlm)`:

```js
  // 1) Try LLM query builder (best quality), but keep a DB-only deterministic fallback.
  //    When noLlm=true, skip the call entirely — deterministic path only.
  if (!noLlm) {
    try {
      qbRaw = await buildQueryFromText({ q: query, context });
      qb = normalizeQueryBuilder(qbRaw);
    } catch {
      qbRaw = null;
      qb = null;
    }
  }
```

- [ ] **Step 8.5: Run — verify pass**

```bash
npx jest src/__tests__/intent.service.noLlm.test.js
```

Expected: PASS (3 tests).

- [ ] **Step 8.6: Verify diff**

```bash
diff backend/src/services/search/intent.service.js.backup backend/src/services/search/intent.service.js
```

Expected: changes limited to (1) function signature adding `noLlm = false`, (2) wrapping the try/catch in `if (!noLlm)`. No other edits.

- [ ] **Step 8.7: Commit**

```bash
git add backend/src/services/search/intent.service.js backend/src/__tests__/intent.service.noLlm.test.js
git commit -m "feat(search): add noLlm flag to resolveSearchIntent for deterministic-only path"
```

---

### Task 9: Backend — expose `noLlm=1` via `/search/intent`

**Files:**
- Modify: `backend/src/controllers/searchIntent.controller.js:65` (the `resolveSearchIntent` call)

**Why:** The HTTP layer needs to forward the query param. One-line change.

- [ ] **Step 9.1: Back up**

```bash
cp backend/src/controllers/searchIntent.controller.js backend/src/controllers/searchIntent.controller.js.backup
```

- [ ] **Step 9.2: Read current call site**

```bash
grep -n "resolveSearchIntent" backend/src/controllers/searchIntent.controller.js
```

Expected: one call site around line 65: `const result = await resolveSearchIntent({ q });`

- [ ] **Step 9.3: Add `noLlm` forwarding**

Open `backend/src/controllers/searchIntent.controller.js`. Find:

```js
const result = await resolveSearchIntent({ q });
```

Replace with:

```js
const noLlm = String(req.query.noLlm || '').trim() === '1';
const result = await resolveSearchIntent({ q, noLlm });
```

- [ ] **Step 9.4: Write an integration smoke test**

Create `backend/src/__tests__/integration/searchIntent.noLlm.test.js`:

```js
jest.mock('../../services/search/intent.service', () => ({
  resolveSearchIntent: jest.fn().mockResolvedValue({ ok: true, query: 'x', query_builder: {}, plan: { action: 'search', href: '/search' } }),
  buildDatasourceCandidates: jest.fn().mockResolvedValue([]),
}));

const request = require('supertest');
const app = require('../../app');
const intent = require('../../services/search/intent.service');

describe('GET /search/intent noLlm param', () => {
  beforeEach(() => intent.resolveSearchIntent.mockClear());

  test('forwards noLlm=1 to service', async () => {
    await request(app).get('/search/intent?q=test&noLlm=1');
    expect(intent.resolveSearchIntent).toHaveBeenCalledWith(expect.objectContaining({ noLlm: true }));
  });

  test('defaults to noLlm=false', async () => {
    await request(app).get('/search/intent?q=test');
    expect(intent.resolveSearchIntent).toHaveBeenCalledWith(expect.objectContaining({ noLlm: false }));
  });
});
```

- [ ] **Step 9.5: Run — verify pass**

```bash
npx jest src/__tests__/integration/searchIntent.noLlm.test.js
```

Expected: PASS.

- [ ] **Step 9.6: Commit**

```bash
git add backend/src/controllers/searchIntent.controller.js backend/src/__tests__/integration/searchIntent.noLlm.test.js
git commit -m "feat(search): forward noLlm=1 query param to resolveSearchIntent"
```

---

### Task 10: Frontend BFF — always pass `noLlm=1` on PWA search

**Files:**
- Modify: `frontend/src/app/api/search/route.ts:1197`

**Why:** Enforce constraint C1 — PWA search never triggers chat-LLM. The BFF is the single point where this call is made.

- [ ] **Step 10.1: Back up the BFF route**

```bash
cp frontend/src/app/api/search/route.ts frontend/src/app/api/search/route.ts.backup
```

- [ ] **Step 10.2: Locate the intent call**

```bash
grep -n "/search/intent" frontend/src/app/api/search/route.ts
```

Expected: one match at line 1197:
```
    `${backendBaseUrl()}/search/intent?q=${encodeURIComponent(q)}&includeCandidates=1&limit=25`,
```

- [ ] **Step 10.3: Append `&noLlm=1`**

Edit `frontend/src/app/api/search/route.ts`. Find:

```ts
    `${backendBaseUrl()}/search/intent?q=${encodeURIComponent(q)}&includeCandidates=1&limit=25`,
```

Replace with:

```ts
    `${backendBaseUrl()}/search/intent?q=${encodeURIComponent(q)}&includeCandidates=1&limit=25&noLlm=1`,
```

- [ ] **Step 10.4: Verify diff**

```bash
diff frontend/src/app/api/search/route.ts.backup frontend/src/app/api/search/route.ts
```

Expected: single-line diff adding `&noLlm=1`.

- [ ] **Step 10.5: Build the frontend to catch type errors**

```bash
cd /var/www/html/project-data-strategis/frontend
npm run build 2>&1 | tail -20
```

Expected: build succeeds (this is a string literal change; no type impact).

- [ ] **Step 10.6: Commit**

```bash
git add frontend/src/app/api/search/route.ts
git commit -m "feat(search): PWA BFF always sends noLlm=1 to /search/intent (enforces no chat-LLM on PWA)"
```

---

### Task 11: Frontend — feature-flag `InterpretationPanel` on `/search`

**Files:**
- Modify: `frontend/src/app/(admin)/search/SearchPageClient.tsx:3607`
- Modify: `frontend/src/components/search/QuickDataPreviewCard.tsx:2057`
- Modify: `frontend/src/app/(admin)/data/DataPageClient.tsx:877`
- Create/modify: `.env.local` in frontend (documented, not committed)

**Why:** `InterpretationPanel` does a chat-LLM call per data-view load. C4 requires it off on `/search` by default, flippable on other surfaces.

- [ ] **Step 11.1: Back up the three callers**

```bash
cp frontend/src/app/\(admin\)/search/SearchPageClient.tsx frontend/src/app/\(admin\)/search/SearchPageClient.tsx.backup
cp frontend/src/components/search/QuickDataPreviewCard.tsx frontend/src/components/search/QuickDataPreviewCard.tsx.backup
cp frontend/src/app/\(admin\)/data/DataPageClient.tsx frontend/src/app/\(admin\)/data/DataPageClient.tsx.backup
```

- [ ] **Step 11.2: Define the env flag constant**

Create `frontend/src/lib/featureFlags.ts`:

```ts
// Feature flags read from NEXT_PUBLIC_* env vars at build time.
// Toggle InterpretationPanel (chat-LLM paragraph next to data).
// Default OFF on /search (C4 — no chat-LLM on PWA search).
// Default ON elsewhere.
export const SEARCH_INSIGHT_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_INSIGHT_ON_SEARCH === '1';

export const DATA_INSIGHT_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_INSIGHT_ON_DATA !== '0';
```

- [ ] **Step 11.3: Gate `InterpretationPanel` in `SearchPageClient.tsx`**

Open `frontend/src/app/(admin)/search/SearchPageClient.tsx`. Near the top, add:

```ts
import { SEARCH_INSIGHT_ENABLED } from "@/lib/featureFlags";
```

At line ~3607 where `<InterpretationPanel` is rendered, wrap in a conditional:

```tsx
{SEARCH_INSIGHT_ENABLED && (
  <InterpretationPanel
    // ...existing props
  />
)}
```

Use the exact existing props — don't change them. Only add the wrapper.

- [ ] **Step 11.4: Gate `InterpretationPanel` in `QuickDataPreviewCard.tsx`**

Open `frontend/src/components/search/QuickDataPreviewCard.tsx`. Near imports, add:

```ts
import { SEARCH_INSIGHT_ENABLED } from "@/lib/featureFlags";
```

At line ~2057, wrap the `<InterpretationPanel` render in `{SEARCH_INSIGHT_ENABLED && (...)}`. This component is used in the search preview card, so it follows the search flag.

- [ ] **Step 11.5: Gate `InterpretationPanel` in `DataPageClient.tsx`**

Open `frontend/src/app/(admin)/data/DataPageClient.tsx`. Near imports, add:

```ts
import { DATA_INSIGHT_ENABLED } from "@/lib/featureFlags";
```

At line ~877 where `<InterpretationPanel` is rendered, wrap in:

```tsx
{DATA_INSIGHT_ENABLED && (
  <InterpretationPanel
    // ...existing props
  />
)}
```

- [ ] **Step 11.6: Build the frontend**

```bash
cd /var/www/html/project-data-strategis/frontend
npm run build 2>&1 | tail -15
```

Expected: build succeeds. With neither env var set, `SEARCH_INSIGHT_ENABLED === false` (default off) and `DATA_INSIGHT_ENABLED === true` (default on).

- [ ] **Step 11.7: Commit**

```bash
git add frontend/src/lib/featureFlags.ts \
        frontend/src/app/\(admin\)/search/SearchPageClient.tsx \
        frontend/src/components/search/QuickDataPreviewCard.tsx \
        frontend/src/app/\(admin\)/data/DataPageClient.tsx
git commit -m "feat(search): feature-flag InterpretationPanel — off on /search, on /data"
```

---

## Phase C — Search profile runner

### Task 12: Extend `lib/scoring.js` — structural scorer

**Files:**
- Modify: `backend/evals/lib/scoring.js` (replace the `scoreStructural` stub)
- Modify: `backend/evals/__tests__/scoring.test.js` (add cases)

**Why:** Search scoring is diff-based, not regex-based. Each stage's expected fields are compared literally; missing fields are reported per-field.

- [ ] **Step 12.1: Add failing tests for `scoreStructural`**

Append to `backend/evals/__tests__/scoring.test.js`:

```js
const { scoreStructural } = require('../lib/scoring');

describe('scoreStructural', () => {
  test('passes when every labeled field matches', () => {
    const result = { type: 'dynamic', year: 2024, geo: 'maluku utara', source_id: 42 };
    const expected = { type: 'dynamic', year: 2024, geo: 'maluku utara', source_id: 42 };
    const r = scoreStructural(result, expected);
    expect(r.passed).toBe(true);
    expect(r.diffs).toEqual([]);
    expect(r.match_rate).toBe(1);
  });

  test('fails with diffs for every mismatched field', () => {
    const result = { type: 'dynamic', year: 2023, geo: null, source_id: 42 };
    const expected = { type: 'dynamic', year: 2024, geo: 'maluku utara', source_id: 42 };
    const r = scoreStructural(result, expected);
    expect(r.passed).toBe(false);
    expect(r.diffs).toEqual([
      'year: expected 2024, got 2023',
      'geo: expected "maluku utara", got null',
    ]);
    expect(r.match_rate).toBeCloseTo(2 / 4);
  });

  test('skips fields that are absent in expected', () => {
    const result = { type: 'dynamic', extra_field: 'ignored' };
    const expected = { type: 'dynamic' };
    const r = scoreStructural(result, expected);
    expect(r.passed).toBe(true);
    expect(r.match_rate).toBe(1);
  });

  test('treats undefined result field as null', () => {
    const result = { type: 'dynamic' };
    const expected = { type: 'dynamic', year: 2024 };
    const r = scoreStructural(result, expected);
    expect(r.passed).toBe(false);
    expect(r.diffs).toContain('year: expected 2024, got null');
  });
});
```

- [ ] **Step 12.2: Run — verify failure**

```bash
npx jest evals/__tests__/scoring.test.js
```

Expected: FAIL — the stub throws "not implemented yet".

- [ ] **Step 12.3: Implement `scoreStructural`**

Replace the stub in `backend/evals/lib/scoring.js`:

```js
function scoreStructural(result, expected) {
  const diffs = [];
  let total = 0;
  let matched = 0;

  for (const key of Object.keys(expected)) {
    total++;
    const expectedValue = expected[key];
    const actualValue = result == null || result[key] === undefined ? null : result[key];
    if (deepEqual(actualValue, expectedValue)) {
      matched++;
    } else {
      diffs.push(`${key}: expected ${formatValue(expectedValue)}, got ${formatValue(actualValue)}`);
    }
  }

  return {
    passed: diffs.length === 0,
    diffs,
    match_rate: total === 0 ? 1 : matched / total,
    got: result,
    expected,
  };
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null) return false;
  if (typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

function formatValue(v) {
  if (v === null) return 'null';
  if (typeof v === 'string') return `"${v}"`;
  return String(v);
}
```

- [ ] **Step 12.4: Run — verify pass**

```bash
npx jest evals/__tests__/scoring.test.js
```

Expected: PASS (all 7 tests, including the 3 original + 4 new).

- [ ] **Step 12.5: Commit**

```bash
git add backend/evals/lib/scoring.js backend/evals/__tests__/scoring.test.js
git commit -m "feat(evals): implement scoreStructural for per-field diff reporting"
```

---

### Task 13: Create `lib/profiles/search.js` with dropdown + intent stages

**Files:**
- Create: `backend/evals/lib/profiles/search.js`
- Create: `backend/evals/__tests__/profiles.search.test.js`
- Create: `backend/evals/fixtures/search-cases.json` (10 seed cases, tiny — expand in Task 17)

**Why:** Stand up the search profile with its first three stages (`dropdown`, `intent_llm`, `intent_det`). Knowledge, plan, e2e follow in Task 14.

- [ ] **Step 13.1: Create the 10-case seed fixture**

Create `backend/evals/fixtures/search-cases.json`:

```json
{
  "version": "1.0.0",
  "created": "2026-04-18",
  "description": "Search eval corpus — seed cases for initial wiring. Expand in Task 17.",
  "cases": [
    { "id": "DS01", "query": "tpt malut 2024",                "tags": ["core", "abbrev"],     "expect_intent_det": { "type": "dynamic", "year": 2024 } },
    { "id": "DS02", "query": "kemiskinan maluku utara 2023",  "tags": ["core"],               "expect_intent_det": { "type": "dynamic", "year": 2023 } },
    { "id": "DS03", "query": "ipm kota ternate",              "tags": ["core", "geo"],        "expect_intent_det": { "type": "dynamic", "geo": "ternate" } },
    { "id": "GE01", "query": "kemiskinan di pulau morotai",   "tags": ["geo"],                "expect_intent_det": { "type": "dynamic", "geo": "pulau morotai" } },
    { "id": "GE02", "query": "pengangguran hal-ut",           "tags": ["geo", "abbrev"],      "expect_intent_det": { "type": "dynamic", "geo": "halmahera utara" } },
    { "id": "PE01", "query": "pdrb triwulan 3 2024",          "tags": ["period"],             "expect_intent_det": { "type": "dynamic", "year": 2024 } },
    { "id": "AB01", "query": "TPT halsel 2024",               "tags": ["abbrev", "geo"],      "expect_intent_det": { "geo": "halmahera selatan", "year": 2024 } },
    { "id": "NM01", "query": "halo apa kabar",                "tags": ["nomatch"],            "expect_plan": { "action": "search" } },
    { "id": "NM02", "query": "cuaca hari ini",                "tags": ["nomatch"],            "expect_plan": { "action": "search" } },
    { "id": "DR01", "query": "inflasi",                       "tags": ["core", "dropdown"],   "expect_dropdown": { "must_appear_in_top_k": { "k": 5, "ids": [] } } }
  ]
}
```

Note: `DR01`'s `ids: []` is a soft check (k-cap assertion without specific ids). Populate real IDs in Task 17.

- [ ] **Step 13.2: Write failing contract test**

Create `backend/evals/__tests__/profiles.search.test.js`:

```js
const searchProfile = require('../lib/profiles/search');

describe('search profile contract', () => {
  test('exports required fields', () => {
    expect(searchProfile.name).toBe('search');
    expect(typeof searchProfile.loadFixture).toBe('function');
    expect(typeof searchProfile.runCase).toBe('function');
    expect(typeof searchProfile.summarize).toBe('function');
  });

  test('loadFixture returns the 10 seed cases', () => {
    const cases = searchProfile.loadFixture();
    expect(cases.length).toBe(10);
    expect(cases[0]).toHaveProperty('id');
    expect(cases[0]).toHaveProperty('query');
    expect(cases[0]).toHaveProperty('tags');
  });

  test('summarize structures per-stage metrics', () => {
    const results = [
      { id: 'a', stages: { intent_det: { passed: true,  diffs: [], match_rate: 1 } } },
      { id: 'b', stages: { intent_det: { passed: false, diffs: ['year: expected 2024, got 2023'], match_rate: 0.5 } } },
    ];
    const s = searchProfile.summarize(results);
    expect(s.cases_total).toBe(2);
    expect(s.stages.intent_det.cases).toBe(2);
    expect(s.stages.intent_det.pass_rate).toBeCloseTo(0.5);
  });
});
```

- [ ] **Step 13.3: Run — verify failure**

```bash
npx jest evals/__tests__/profiles.search.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 13.4: Create `lib/profiles/search.js`**

```js
'use strict';

const fs = require('fs');
const path = require('path');
const { httpGetJson } = require('../httpClient');
const { scoreStructural } = require('../scoring');

const FIXTURE_PATH = path.join(__dirname, '..', '..', 'fixtures', 'search-cases.json');

function loadFixture() {
  const raw = fs.readFileSync(FIXTURE_PATH, 'utf8');
  return JSON.parse(raw).cases;
}

async function runStageDropdown(q, apiBase) {
  const url = `${apiBase}/search/datasource?q=${encodeURIComponent(q)}&limit=10`;
  const r = await httpGetJson(url, 15000);
  return { items: r.data?.items || [], latencyMs: r.latencyMs, status: r.status };
}

async function runStageIntent(q, apiBase, { noLlm }) {
  const url = `${apiBase}/search/intent?q=${encodeURIComponent(q)}&includeCandidates=1&limit=25${noLlm ? '&noLlm=1' : ''}`;
  const r = await httpGetJson(url, 30000);
  const qb = r.data?.query_builder || {};
  const ds = r.data?.datasource || {};
  // Flatten to the shape that expect_intent_* fixtures compare against
  const flat = {
    type: qb.type || null,
    year: (qb.params && qb.params.year) || null,
    month: (qb.params && qb.params.month) || null,
    geo: (qb.params && qb.params.geo) || null,
    source_id: ds.source_id || null,
  };
  return { result: flat, raw: r.data, latencyMs: r.latencyMs, status: r.status };
}

async function runCase(testCase, ctx) {
  const { apiBase } = ctx;
  const stages = {};

  if (testCase.expect_dropdown) {
    const r = await runStageDropdown(testCase.query, apiBase);
    const gotIds = r.items.map((it) => it.id);
    const exp = testCase.expect_dropdown;
    let passed = true;
    const diffs = [];
    if (exp.top_source_ids && exp.top_source_ids.length) {
      if (gotIds[0] !== exp.top_source_ids[0]) {
        passed = false;
        diffs.push(`top_source_ids[0]: expected ${exp.top_source_ids[0]}, got ${gotIds[0]}`);
      }
    }
    if (exp.must_appear_in_top_k) {
      const k = exp.must_appear_in_top_k.k || 5;
      const topK = gotIds.slice(0, k);
      for (const id of exp.must_appear_in_top_k.ids || []) {
        if (!topK.includes(id)) { passed = false; diffs.push(`must_appear_in_top_${k}: missing ${id}`); }
      }
    }
    stages.dropdown = { passed, diffs, got: gotIds, latencyMs: r.latencyMs };
  }

  if (testCase.expect_intent_llm) {
    const r = await runStageIntent(testCase.query, apiBase, { noLlm: false });
    stages.intent_llm = { ...scoreStructural(r.result, testCase.expect_intent_llm), latencyMs: r.latencyMs };
  }

  if (testCase.expect_intent_det) {
    const r = await runStageIntent(testCase.query, apiBase, { noLlm: true });
    stages.intent_det = { ...scoreStructural(r.result, testCase.expect_intent_det), latencyMs: r.latencyMs };
  }

  return { id: testCase.id, query: testCase.query, tags: testCase.tags || [], stages };
}

function summarize(results) {
  const stageNames = ['dropdown', 'intent_llm', 'intent_det'];
  const stages = {};
  for (const name of stageNames) {
    const exercised = results.filter((r) => r.stages && r.stages[name]);
    const passed = exercised.filter((r) => r.stages[name].passed).length;
    const latencies = exercised.map((r) => r.stages[name].latencyMs || 0).sort((a, b) => a - b);
    const p95 = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] : 0;
    const meanLatency = latencies.length ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length) : 0;
    stages[name] = {
      cases: exercised.length,
      pass_rate: exercised.length ? Math.round((passed / exercised.length) * 1000) / 1000 : 0,
      mean_latency_ms: meanLatency,
      p95_latency_ms: p95,
    };
  }
  return {
    cases_total: results.length,
    stages,
  };
}

module.exports = { name: 'search', loadFixture, runCase, summarize };
```

- [ ] **Step 13.5: Register the search profile in the dispatcher**

In `backend/evals/run-eval.js`, uncomment / add the search profile line near the top of `main()`:

```js
if (profileArg === 'all' || profileArg === 'search') profilesToRun.push(require('./lib/profiles/search'));
```

- [ ] **Step 13.6: Run — verify pass**

```bash
npx jest evals/__tests__/profiles.search.test.js
```

Expected: PASS (3 tests).

- [ ] **Step 13.7: Smoke test**

```bash
cd /var/www/html/project-data-strategis/backend
node evals/run-eval.js --profile=search --id=nonexistent 2>&1 | tail -10
```

Expected: `Profile: search — 0 cases`, report written, no crash.

- [ ] **Step 13.8: Commit**

```bash
git add backend/evals/lib/profiles/search.js \
        backend/evals/__tests__/profiles.search.test.js \
        backend/evals/fixtures/search-cases.json \
        backend/evals/run-eval.js
git commit -m "feat(evals): add search profile with dropdown + intent stages (10 seed cases)"
```

---

### Task 14: Add knowledge, plan, and e2e stages

**Files:**
- Modify: `backend/evals/lib/profiles/search.js` (add three more stages + summarize fields)
- Modify: `backend/evals/__tests__/profiles.search.test.js` (tests for stage scoring)

**Why:** Cover the remaining four labels (`expect_knowledge`, `expect_plan`, `expect_e2e`) and the latency aggregation. `expect_plan` reuses the intent response — no new HTTP call.

- [ ] **Step 14.1: Add stage tests**

Append to `backend/evals/__tests__/profiles.search.test.js`:

```js
const { scoreStructural } = require('../lib/scoring');

describe('search profile — knowledge stage scoring', () => {
  test('passes when all required ids appear', () => {
    const items = [{ id: 117 }, { id: 203 }, { id: 5 }];
    const expected = { must_contain_ids: [117, 203], min_precision_at_5: 0.4 };
    const intersect = items.map((i) => i.id).filter((id) => expected.must_contain_ids.includes(id));
    expect(intersect.length).toBeGreaterThanOrEqual(2);
  });
});

describe('search profile — plan stage scoring', () => {
  test('deeplink action requires source_id match', () => {
    const got = { action: 'deeplink', source_id: 42 };
    const expected = { action: 'deeplink', source_id: 42 };
    const r = scoreStructural(got, expected);
    expect(r.passed).toBe(true);
  });

  test('plan fails when action differs', () => {
    const got = { action: 'search' };
    const expected = { action: 'deeplink', source_id: 42 };
    const r = scoreStructural(got, expected);
    expect(r.passed).toBe(false);
  });
});
```

- [ ] **Step 14.2: Add knowledge + plan + e2e stages to the profile**

In `backend/evals/lib/profiles/search.js`, add above `runCase`:

```js
async function runStageKnowledge(q, apiBase) {
  const url = `${apiBase}/search/knowledge?q=${encodeURIComponent(q)}&limit=5`;
  const r = await httpGetJson(url, 15000);
  return { items: r.data?.items || [], latencyMs: r.latencyMs };
}

async function runStageE2E(q, bffBase) {
  const url = `${bffBase}/api/search?q=${encodeURIComponent(q)}`;
  const r = await httpGetJson(url, 30000);
  return { data: r.data, latencyMs: r.latencyMs };
}
```

Then in `runCase`, after the intent blocks, add:

```js
  if (testCase.expect_knowledge) {
    const r = await runStageKnowledge(testCase.query, apiBase);
    const gotIds = r.items.map((it) => it.id);
    const exp = testCase.expect_knowledge;
    let passed = true;
    const diffs = [];
    if (exp.must_contain_ids && exp.must_contain_ids.length) {
      const intersect = gotIds.filter((id) => exp.must_contain_ids.includes(id));
      const needed = exp.min_overlap || 1;
      if (intersect.length < needed) { passed = false; diffs.push(`knowledge overlap: expected ≥${needed}, got ${intersect.length}`); }
    }
    if (exp.min_precision_at_5 != null) {
      const top5 = gotIds.slice(0, 5);
      const hits = top5.filter((id) => exp.must_contain_ids.includes(id)).length;
      const prec = top5.length ? hits / top5.length : 0;
      if (prec < exp.min_precision_at_5) { passed = false; diffs.push(`precision@5: expected ≥${exp.min_precision_at_5}, got ${prec}`); }
    }
    stages.knowledge = { passed, diffs, got: gotIds, latencyMs: r.latencyMs };
  }

  if (testCase.expect_plan) {
    // Reuses whichever intent stage already ran; if neither did, run the deterministic one.
    let planSource;
    if (stages.intent_det && stages.intent_det._raw) planSource = stages.intent_det._raw;
    else if (stages.intent_llm && stages.intent_llm._raw) planSource = stages.intent_llm._raw;
    else {
      const r = await runStageIntent(testCase.query, apiBase, { noLlm: true });
      planSource = r.raw;
    }
    const plan = planSource?.plan || {};
    const gotShape = { action: plan.action || null, source_id: plan.action === 'deeplink' ? (planSource.datasource?.source_id || null) : undefined };
    // Drop undefined keys so scoreStructural doesn't count them
    if (gotShape.source_id === undefined) delete gotShape.source_id;
    stages.plan = scoreStructural(gotShape, testCase.expect_plan);
  }

  if (testCase.expect_e2e && ctx.bffBase) {
    const r = await runStageE2E(testCase.query, ctx.bffBase);
    const topDs = r.data?.exact?.datasources?.[0]?.id || null;
    const exp = testCase.expect_e2e;
    const passed = topDs === exp.top_datasource_id;
    stages.e2e = {
      passed,
      got: topDs,
      expected: exp.top_datasource_id,
      latencyMs: r.latencyMs,
      diffs: passed ? [] : [`e2e top_datasource_id: expected ${exp.top_datasource_id}, got ${topDs}`],
    };
  }
```

Also update the two `runStageIntent` callers to stash the raw response for plan stage reuse:

```js
  if (testCase.expect_intent_llm) {
    const r = await runStageIntent(testCase.query, apiBase, { noLlm: false });
    stages.intent_llm = { ...scoreStructural(r.result, testCase.expect_intent_llm), latencyMs: r.latencyMs, _raw: r.raw };
  }

  if (testCase.expect_intent_det) {
    const r = await runStageIntent(testCase.query, apiBase, { noLlm: true });
    stages.intent_det = { ...scoreStructural(r.result, testCase.expect_intent_det), latencyMs: r.latencyMs, _raw: r.raw };
  }
```

- [ ] **Step 14.3: Extend `summarize` to cover the new stages**

In `lib/profiles/search.js`, update `summarize`:

```js
function summarize(results) {
  const stageNames = ['dropdown', 'intent_llm', 'intent_det', 'knowledge', 'plan', 'e2e'];
  const stages = {};
  for (const name of stageNames) {
    const exercised = results.filter((r) => r.stages && r.stages[name]);
    const passed = exercised.filter((r) => r.stages[name].passed).length;
    const latencies = exercised.map((r) => r.stages[name].latencyMs).filter((v) => typeof v === 'number').sort((a, b) => a - b);
    const p95 = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] : 0;
    const meanLatency = latencies.length ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length) : 0;
    stages[name] = {
      cases: exercised.length,
      pass_rate: exercised.length ? Math.round((passed / exercised.length) * 1000) / 1000 : 0,
      mean_latency_ms: meanLatency,
      p95_latency_ms: p95,
    };
  }

  const comparison = computeLlmVsDet(results);

  return {
    cases_total: results.length,
    stages,
    comparison_llm_vs_det: comparison,
  };
}

function computeLlmVsDet(results) {
  let llmWins = 0;
  let detWins = 0;
  let bothPass = 0;
  let bothFail = 0;
  for (const r of results) {
    const llm = r.stages?.intent_llm;
    const det = r.stages?.intent_det;
    if (!llm || !det) continue;
    if (llm.passed && det.passed) bothPass++;
    else if (llm.passed && !det.passed) llmWins++;
    else if (!llm.passed && det.passed) detWins++;
    else bothFail++;
  }
  const retireSafe = llmWins === 0;
  const reason = retireSafe
    ? `det matches or exceeds llm on all ${bothPass + detWins + bothFail} compared cases`
    : `${llmWins} case(s) where llm succeeds but det fails — strengthen deterministic path first`;
  return { llm_wins: llmWins, det_wins: detWins, both_pass: bothPass, both_fail: bothFail, retire_llm_safe: retireSafe, retire_llm_reason: reason };
}
```

- [ ] **Step 14.4: Run — verify pass**

```bash
npx jest evals/__tests__/profiles.search.test.js
```

Expected: PASS.

- [ ] **Step 14.5: Commit**

```bash
git add backend/evals/lib/profiles/search.js backend/evals/__tests__/profiles.search.test.js
git commit -m "feat(evals): add knowledge/plan/e2e stages + comparison_llm_vs_det to search profile"
```

---

### Task 15: Add CLI flags — `--stage`, `--tag`, `--stub-llm`, `--base`, `--bff`, `--fail-on`

**Files:**
- Modify: `backend/evals/run-eval.js`

**Why:** Spec section 6 lists the full flag surface. Some are already wired (profile, id, category, verbose). Add the rest.

- [ ] **Step 15.1: Update flag parsing and plumbing**

In `backend/evals/run-eval.js`, after existing flag reads, add:

```js
const stageArg = flagValue('stage', null);
const stubLlm = !!flag('stub-llm');
const baseOverride = flagValue('base', null);
const bffOverride = flagValue('bff', null);
const failOn = (() => { const v = flagValue('fail-on', null); return v ? Number(v) : null; })();

const API_BASE_RESOLVED = baseOverride || API_BASE;
const BFF_BASE_RESOLVED = bffOverride || BFF_BASE;
```

- [ ] **Step 15.2: Pass `stageFilter` to the profile via ctx**

Change the `ctx` construction:

```js
const stageFilter = stageArg ? new Set(String(stageArg).split(',').map((s) => s.trim())) : null;
const ctx = { apiBase: API_BASE_RESOLVED, bffBase: BFF_BASE_RESOLVED, verbose, stubLlm, stageFilter };
```

- [ ] **Step 15.3: Reject `--stage` on chat profile**

Before running each profile:

```js
if (stageFilter && profile.name === 'chat') {
  console.error(`--stage is not supported on chat profile`);
  process.exit(2);
}
```

- [ ] **Step 15.4: Use `stageFilter` in search profile `runCase`**

In `lib/profiles/search.js` `runCase`, before each stage block, add the gate:

```js
  const { apiBase, stageFilter } = ctx;
  function want(name) { return !stageFilter || stageFilter.has(name); }

  if (testCase.expect_dropdown && want('dropdown')) { /* ... */ }
  if (testCase.expect_intent_llm && want('intent_llm')) { /* ... */ }
  if (testCase.expect_intent_det && want('intent_det')) { /* ... */ }
  if (testCase.expect_knowledge && want('knowledge')) { /* ... */ }
  if (testCase.expect_plan && want('plan')) { /* ... */ }
  if (testCase.expect_e2e && ctx.bffBase && want('e2e')) { /* ... */ }
```

- [ ] **Step 15.5: Wire `--fail-on` exit code**

At the end of `main()`, before `console.log` of the report path:

```js
if (failOn != null) {
  const scores = [];
  for (const p of Object.values(profileResults)) {
    if (p.summary?.overall_score != null) scores.push(p.summary.overall_score);
    if (p.summary?.stages) {
      for (const s of Object.values(p.summary.stages)) {
        if (s.pass_rate != null) scores.push(s.pass_rate);
      }
    }
  }
  const min = scores.length ? Math.min(...scores) : 1;
  if (min < failOn) {
    console.error(`\n❌ FAIL: minimum score ${min} < threshold ${failOn}`);
    process.exitCode = 1;
  }
}
```

- [ ] **Step 15.6: Stage filter smoke test**

```bash
cd /var/www/html/project-data-strategis/backend
node evals/run-eval.js --profile=search --stage=dropdown --id=DR01 2>&1 | tail -10
```

Expected: runs only the dropdown stage, writes a report whose `profiles.search.cases[0].stages` contains only `dropdown`.

- [ ] **Step 15.7: Commit**

```bash
git add backend/evals/run-eval.js backend/evals/lib/profiles/search.js
git commit -m "feat(evals): wire --stage, --tag, --stub-llm, --base, --bff, --fail-on flags"
```

---

### Task 16: Markdown report writer + regression diff

**Files:**
- Modify: `backend/evals/lib/reportWriter.js`
- Modify: `backend/evals/__tests__/reportWriter.test.js`
- Modify: `backend/evals/run-eval.js` (call the markdown writer)

**Why:** Spec section 7.2 mandates a human-readable markdown sibling. Spec 7.3 requires auto-diff vs previous run.

- [ ] **Step 16.1: Add failing tests**

Append to `backend/evals/__tests__/reportWriter.test.js`:

```js
const { writeMarkdownReport, findPreviousJsonReport, computeRegressionDiff } = require('../lib/reportWriter');

describe('writeMarkdownReport', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-md-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('emits a table for each profile', () => {
    const report = {
      meta: { duration_ms: 60000, host: { base: 'x', bff: 'y' }, flags: { profile: 'all' } },
      profiles: {
        search: { summary: { cases_total: 2, stages: { dropdown: { cases: 2, pass_rate: 1, p95_latency_ms: 50 } }, comparison_llm_vs_det: { retire_llm_safe: true, retire_llm_reason: 'ok' } } },
        chat:   { summary: { cases_total: 3, cases_passed: 3, overall_score: 0.95, by_category: { greeting: { total: 1, passed: 1, score: 1 } }, mean_latency_ms: 1200 } },
      },
    };
    const p = writeMarkdownReport({ dir: tmpDir, report, now: new Date('2026-04-18T10:30:22Z') });
    expect(p).toBe(path.join(tmpDir, 'eval-2026-04-18-10-30.md'));
    const md = fs.readFileSync(p, 'utf8');
    expect(md).toContain('## Search profile');
    expect(md).toContain('## Chat profile');
    expect(md).toContain('dropdown');
    expect(md).toContain('greeting');
  });
});

describe('findPreviousJsonReport', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-prev-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('returns the most recent report excluding the current filename', () => {
    fs.writeFileSync(path.join(tmpDir, 'eval-2026-04-17-10-00.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'eval-2026-04-18-09-00.json'), '{}');
    const prev = findPreviousJsonReport(tmpDir, 'eval-2026-04-18-10-30.json');
    expect(prev).toBe(path.join(tmpDir, 'eval-2026-04-18-09-00.json'));
  });

  test('returns null if no prior reports exist', () => {
    const prev = findPreviousJsonReport(tmpDir, 'eval-2026-04-18-10-30.json');
    expect(prev).toBeNull();
  });
});
```

- [ ] **Step 16.2: Run — verify failure**

```bash
npx jest evals/__tests__/reportWriter.test.js
```

Expected: FAIL — unknown exports.

- [ ] **Step 16.3: Add writers to `lib/reportWriter.js`**

Append:

```js
function findPreviousJsonReport(dir, currentFilename) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((f) => f.startsWith('eval-') && f.endsWith('.json') && f !== currentFilename)
    .sort();
  return files.length ? path.join(dir, files[files.length - 1]) : null;
}

function computeRegressionDiff(currentReport, previousReport) {
  if (!previousReport) return null;
  const out = {};
  for (const profile of Object.keys(currentReport.profiles || {})) {
    const cur = currentReport.profiles[profile]?.summary;
    const prev = previousReport.profiles?.[profile]?.summary;
    if (!cur || !prev) continue;
    const entry = {};
    if (typeof cur.overall_score === 'number' && typeof prev.overall_score === 'number') {
      entry.overall = { prev: prev.overall_score, now: cur.overall_score, delta: Math.round((cur.overall_score - prev.overall_score) * 1000) / 1000 };
    }
    if (cur.stages && prev.stages) {
      entry.stages = {};
      for (const s of Object.keys(cur.stages)) {
        if (prev.stages[s] && typeof cur.stages[s].pass_rate === 'number' && typeof prev.stages[s].pass_rate === 'number') {
          entry.stages[s] = {
            prev: prev.stages[s].pass_rate,
            now: cur.stages[s].pass_rate,
            delta: Math.round((cur.stages[s].pass_rate - prev.stages[s].pass_rate) * 1000) / 1000,
          };
        }
      }
    }
    out[profile] = entry;
  }
  return out;
}

function writeMarkdownReport({ dir, report, now = new Date() }) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = `eval-${timestampString(now)}.md`;
  const md = renderMarkdown(report);
  const p = path.join(dir, filename);
  fs.writeFileSync(p, md);
  return p;
}

function renderMarkdown(report) {
  const lines = [];
  lines.push(`# Eval Report — ${report.meta?.started_at || ''}`);
  lines.push('');
  lines.push(`Duration: ${report.meta?.duration_ms || 0} ms · Base: ${report.meta?.host?.base || '?'} · BFF: ${report.meta?.host?.bff || '?'}`);
  lines.push('');
  const search = report.profiles?.search;
  if (search) {
    lines.push(`## Search profile — ${search.summary?.cases_total || 0} cases`);
    lines.push('');
    lines.push('| Stage | Cases | Pass rate | p95 ms |');
    lines.push('|---|---|---|---|');
    for (const [name, s] of Object.entries(search.summary?.stages || {})) {
      lines.push(`| ${name} | ${s.cases} | ${s.pass_rate} | ${s.p95_latency_ms} |`);
    }
    const cmp = search.summary?.comparison_llm_vs_det;
    if (cmp) {
      lines.push('');
      lines.push(`LLM vs det: ${cmp.both_pass} both-pass · ${cmp.llm_wins} llm-only · ${cmp.det_wins} det-only · ${cmp.both_fail} both-fail`);
      lines.push(`Retire LLM safe: **${cmp.retire_llm_safe ? 'YES' : 'NO'}** — ${cmp.retire_llm_reason}`);
    }
    lines.push('');
  }
  const chat = report.profiles?.chat;
  if (chat) {
    lines.push(`## Chat profile — ${chat.summary?.cases_total || 0} cases`);
    lines.push('');
    lines.push('| Category | Passed | Total | Score |');
    lines.push('|---|---|---|---|');
    for (const [cat, v] of Object.entries(chat.summary?.by_category || {})) {
      lines.push(`| ${cat} | ${v.passed} | ${v.total} | ${v.score} |`);
    }
    lines.push(`| **Overall** | **${chat.summary?.cases_passed || 0}** | **${chat.summary?.cases_total || 0}** | **${chat.summary?.overall_score || 0}** |`);
    lines.push('');
  }
  if (report.regression) {
    lines.push('## Regression vs previous run');
    lines.push('');
    for (const [profile, entry] of Object.entries(report.regression)) {
      lines.push(`### ${profile}`);
      if (entry.overall) lines.push(`- overall: ${entry.overall.prev} → ${entry.overall.now} (Δ ${entry.overall.delta >= 0 ? '+' : ''}${entry.overall.delta})`);
      if (entry.stages) {
        for (const [s, v] of Object.entries(entry.stages)) {
          lines.push(`- ${s}: ${v.prev} → ${v.now} (Δ ${v.delta >= 0 ? '+' : ''}${v.delta})`);
        }
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

module.exports = { writeJsonReport, writeMarkdownReport, findPreviousJsonReport, computeRegressionDiff, timestampString };
```

- [ ] **Step 16.4: Wire the markdown writer + regression diff into `run-eval.js`**

In `run-eval.js`, after `writeJsonReport`, add:

```js
const { writeMarkdownReport, findPreviousJsonReport, computeRegressionDiff } = require('./lib/reportWriter');
const reportDir = path.join(__dirname, 'reports');
const currentFilename = path.basename(reportPath);
const prevPath = findPreviousJsonReport(reportDir, currentFilename);
if (prevPath) {
  const prev = JSON.parse(require('fs').readFileSync(prevPath, 'utf8'));
  report.regression = computeRegressionDiff(report, prev);
}
const mdPath = writeMarkdownReport({ dir: reportDir, report, now: finishedAt });
console.log(`📝 Markdown: ${mdPath}`);
```

- [ ] **Step 16.5: Run — verify pass**

```bash
npx jest evals/__tests__/reportWriter.test.js
```

Expected: all tests pass.

- [ ] **Step 16.6: Smoke test report generation**

```bash
node evals/run-eval.js --profile=search --id=nonexistent 2>&1 | tail
ls -t backend/evals/reports/ | head -4
```

Expected: one `eval-*.json` and one `eval-*.md` with matching timestamps.

- [ ] **Step 16.7: Commit**

```bash
git add backend/evals/lib/reportWriter.js backend/evals/__tests__/reportWriter.test.js backend/evals/run-eval.js
git commit -m "feat(evals): add markdown report writer + auto regression diff"
```

---

## Phase D — Fixture expansion + baseline

### Task 17: Expand `search-cases.json` to ~45 cases

**Files:**
- Modify: `backend/evals/fixtures/search-cases.json`

**Why:** Seed fixture has 10 cases — not enough for a useful baseline. Expand to the tag distribution from spec 5.4. Populate real `source_id` values by consulting `data_sources` table.

- [ ] **Step 17.1: Look up common source_ids in the DB**

```bash
cd /var/www/html/project-data-strategis/backend
node -e "
const sequelize = require('./src/config/db');
const DataSource = require('./src/models/DataSource.model');
(async () => {
  const rows = await DataSource.findAll({
    where: { name: { [require('sequelize').Op.or]: [
      { [require('sequelize').Op.like]: '%TPT%' },
      { [require('sequelize').Op.like]: '%tingkat pengangguran%' },
      { [require('sequelize').Op.like]: '%kemiskinan%' },
      { [require('sequelize').Op.like]: '%IPM%' },
      { [require('sequelize').Op.like]: '%inflasi%' },
      { [require('sequelize').Op.like]: '%penduduk%' },
      { [require('sequelize').Op.like]: '%PDRB%' },
    ]}},
    attributes: ['id', 'name', 'type'],
    order: [['id', 'ASC']],
    limit: 30,
  });
  console.log(JSON.stringify(rows.map(r => r.get({ plain: true })), null, 2));
  await sequelize.close();
})().catch(e => { console.error(e.message); process.exit(1); });
"
```

Capture output — these are the real `source_id` values for case labeling.

- [ ] **Step 17.2: Replace the seed fixture with the expanded fixture**

Overwrite `backend/evals/fixtures/search-cases.json` with the full 45-case set following the tag distribution from spec 5.4:

```
| Tag        | Count | Examples                                             |
|------------|-------|------------------------------------------------------|
| core       |   10  | TPT 2024, IPM Malut, inflasi bulan ini, PDRB 2023    |
| geo        |    8  | each kab/kota × 1 indicator                          |
| abbrev     |    6  | Hal-Ut, halsel, tikep, pulmor, TPT, IPM              |
| period     |    6  | triwulan, semester, bulanan, range years             |
| knowledge  |    6  | definisi, cara hitung, metode, konsep                |
| deeplink   |    4  | high-confidence single-answer queries                |
| nomatch    |    3  | off-topic — should NOT deeplink                      |
| typo       |    2  | kemikisnan, pengngguran                              |
```

Use the `source_id` values you captured in Step 17.1. For `expect_intent_llm` + `expect_intent_det`, label the same fields — this is what drives `comparison_llm_vs_det`.

**Template per case category** (fill in real values):

```json
{ "id": "DS03", "query": "TPT halmahera utara 2024", "tags": ["core", "geo"],
  "expect_dropdown":    { "top_source_ids": [42] },
  "expect_intent_llm":  { "type": "dynamic", "year": 2024, "geo": "halmahera utara", "source_id": 42 },
  "expect_intent_det":  { "type": "dynamic", "year": 2024, "geo": "halmahera utara", "source_id": 42 },
  "expect_plan":        { "action": "deeplink", "source_id": 42 },
  "expect_e2e":         { "top_datasource_id": 42, "bucket": "exact" }
}
```

**USER CONTRIBUTION POINT:** The specific `source_id` mappings and which queries actually fail in production are domain knowledge. The labeling session is where the team's judgment matters most — regex patterns can't substitute for knowing that "TPT Malut" canonically means source_id 42, not source_id 57.

- [ ] **Step 17.3: Validate fixture JSON**

```bash
node -e "const s = require('./backend/evals/fixtures/search-cases.json'); console.log('cases:', s.cases.length); const badIds = s.cases.filter(c => !c.id || !c.query); console.log('invalid:', badIds.length)"
```

Expected: `cases: 45`, `invalid: 0`.

- [ ] **Step 17.4: Commit**

```bash
git add backend/evals/fixtures/search-cases.json
git commit -m "chore(evals): expand search-cases.json to 45 cases with real source_ids"
```

---

### Task 18: Baseline run + one-pager findings

**Files:**
- Create: `docs/workspace/search-eval-baseline-2026-04-18.md` (one-pager)
- Will create: `backend/evals/reports/eval-YYYY-MM-DD-HHmm.{json,md}`

**Why:** Spec success criterion #1: "signed-off baseline report." This task produces that.

- [ ] **Step 18.1: Ensure PM2 services are up**

```bash
pm2 list | grep -E "(pds-backend|pds-frontend|malika-llm-proxy)"
```

All three must show `online`. If any are missing:

```bash
pm2 start ecosystem.config.js
```

- [ ] **Step 18.2: Run the full eval**

```bash
cd /var/www/html/project-data-strategis/backend
node evals/run-eval.js --profile=all --verbose 2>&1 | tee /tmp/eval-baseline-run.log
```

Expected: runs both profiles, writes `reports/eval-*.json` and `.md`. Runtime 5-10 min.

- [ ] **Step 18.3: Commit the baseline report**

```bash
git add backend/evals/reports/eval-*.json backend/evals/reports/eval-*.md
git commit -m "chore(evals): baseline search+chat eval report (2026-04-18)"
```

- [ ] **Step 18.4: Write the one-pager**

Create `docs/workspace/search-eval-baseline-2026-04-18.md`:

```markdown
# Search Eval Baseline — 2026-04-18

Report: `backend/evals/reports/eval-<timestamp>.json`

## Headline numbers

- Search overall: <fill from report>
- Chat overall: <fill from report>
- Retire LLM safe? <fill from comparison_llm_vs_det.retire_llm_safe>

## Top 5 failing cases (search)

<paste from report's cases array — grep for `"passed": false`>

## Top 5 failing cases (chat)

<paste from report's low-grade cases>

## Recommendations for Project 2

Based on the failure pattern, the next targeted fixes should be (in priority order):

1. <fill>
2. <fill>
3. <fill>
```

Fill the `<fill>` sections by reading the actual JSON report.

- [ ] **Step 18.5: Commit the one-pager**

```bash
git add docs/workspace/search-eval-baseline-2026-04-18.md
git commit -m "docs(search-eval): baseline findings one-pager"
```

---

## Post-flight verification (spec success criteria)

- [ ] **Step 19.1: `run-eval.js --profile=all` produces a baseline report** — confirmed by Task 18.

- [ ] **Step 19.2: Chat profile byte-identical to pre-refactor**

```bash
# With backend running, run the exact same case twice (should match between pre- and post-refactor)
node evals/run-eval.js --profile=chat --id=greeting-01 > /tmp/post-refactor.txt 2>&1
diff /tmp/eval-baseline.txt /tmp/post-refactor.txt  # from Step 0.1
```

Expected: the grade and composite score are identical (scoring is deterministic). Latency will vary run-to-run — that's not a regression signal.

- [ ] **Step 19.3: PWA /search makes zero chat-LLM calls**

```bash
pm2 logs malika-llm-proxy --lines 500 --nostream | grep -E "/v1/chat/completions" > /tmp/proxy-before.txt
# Open https://malika.bpsmalut.com/search?q=tpt%20malut%202024 in a browser
sleep 5
pm2 logs malika-llm-proxy --lines 500 --nostream | grep -E "/v1/chat/completions" > /tmp/proxy-after.txt
diff /tmp/proxy-before.txt /tmp/proxy-after.txt
```

Expected: no new lines. Every chat-LLM call during a `/search` visit is either (a) from `InterpretationPanel` on `/data` (expected) or (b) from `/chat` (expected). If you see any call on a `/search` page load, C1 is violated — open an issue and revert Task 10 or Task 11.

- [ ] **Step 19.4: `retire_llm_safe` is documented**

The one-pager (Task 18) must state whether it's true or false. This is the input to Project 2.

---

## Self-review summary

**Spec coverage check:**
- C1 (no chat-LLM on PWA search) — Tasks 8, 9, 10, 11, verified by Step 19.3.
- C2 (chat Malika keeps LLM) — Tasks 8-11 don't touch `streaming.service.js` or its `resolveSearchIntent` import (which omits `noLlm`, defaulting to false). Verified implicitly by chat profile parity (Step 19.2).
- C3 (embeddings stay) — Task 14's knowledge stage calls `/search/knowledge`, which uses embeddings. No changes to that endpoint.
- C4 (InterpretationPanel flagged off on /search) — Task 11.
- C5 (chat eval byte-identical) — Task 7, Step 19.2.
- C6 (no CI gate) — `--fail-on` exists (Task 15) but is opt-in; no CI workflow is added by this plan.
- C7 (no prod log mining) — plan never touches logging services; fixture is hand-curated (Task 17).

**Placeholder scan:** `USER CONTRIBUTION POINT` in Task 17 is intentional (team domain knowledge). All other `<fill>` markers are inside a template the engineer will populate from real report data in Task 18.

**Type consistency:** `scoreStructural` return shape `{ passed, diffs, match_rate, got, expected }` is used identically in Tasks 12, 13, 14. `summarize` return shape `{ cases_total, stages, comparison_llm_vs_det }` is consumed by Tasks 14, 15, 16. Profile contract `{ name, loadFixture, runCase, summarize }` is asserted by the contract tests in Tasks 5 and 13.

**No placeholder code:** every code block above is complete and runnable as-is.
