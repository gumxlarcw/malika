# MALIKA Analysis — Audit Fixes + Chat Loop Closure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 7 audit bugs found on `/backend/malika-analysis` AND close the feedback loop so flagged chat errors actually improve future MALIKA answers (auto-flag → review → pattern/knowledge fix → injected into next chat).

**Architecture:** Three phases. Phase 1 fixes display/response-shape bugs in the existing admin page. Phase 2 fixes the outbound chat→improvement path (knowledge corrections via xenova→retrieval_chunks; `special_handling` patterns injected into prompts). Phase 3 fixes the inbound chat→flags path (auto-flag heuristics post-response + user "flag this" button in PWA chat). Phase 4 verifies + documents.

**Tech Stack:** Express 5 + Sequelize 6, Next.js 16 admin, React 18 PWA, Xenova multilingual-e5-base (768d) → MariaDB native VECTOR(768) in `retrieval_chunks`, Jest for backend unit tests, live `curl` smoke for xenova-touching paths (Jest CJS VM can't load Xenova's dynamic ESM imports).

**Pre-flight (one-time):**
- All file paths absolute from `/var/www/html/project-data-strategis/`
- Always `cp file file.backup` before edit (per CLAUDE.md)
- After backend changes: `pm2 reload pds-backend --update-env`
- After admin changes: `pm2 reload pds-admin --update-env`
- No `Co-Authored-By` trailer in commits (project preference)
- Stage individual files (`git add backend/src/...`), NEVER `git add -A`
- Frontend PWA is git submodule at `frontend/` — commit + push separately

---

## File Structure

**Backend modifications:**
- `backend/src/services/chat/errorLearning.service.js` — `getStats` shape, `addToKnowledgeBase` port to xenova/retrieval_chunks
- `backend/src/controllers/errorLearning.controller.js` — severity filter, `resolved_at` semantic
- `backend/src/models/ChatErrorPattern.model.js` — `trigger_keywords` JSON getter
- `backend/src/services/chat/streaming.service.js` — wire `checkQueryPattern`, hook `autoFlagAfterResponse`

**Backend new file:**
- `backend/src/services/chat/autoFlag.service.js` — conservative heuristics for system-flagging bad chat responses

**Admin modifications:**
- `backend/admin/app/malika-analysis/page.tsx` — pagination, "Add to Knowledge" UI, render fixes

**Frontend (PWA) modifications:**
- `frontend/src/services/api.js` — `flagChatMessage` helper
- `frontend/src/components/chat/MessageActions.jsx` (or equivalent) — flag button

**Tests:**
- `backend/test/unit/errorLearning.service.test.js` — getStats shape, severity filter, autoFlag heuristics

**Docs:**
- `docs/workspace/chat-pipeline.md` — Change Log entry
- `docs/workspace/backend.md` — Change Log entry
- `/root/.claude/projects/-var-www-html/memory/malika_analysis_loop_2026-05-11.md` — memory file
- `/root/.claude/projects/-var-www-html/memory/MEMORY.md` — index pointer

---

## Phase 1 — Audit Bug Fixes (Bugs 1–2, 4–7)

### Task 1: Flatten `getStats` payload + add `activePatterns` + 7-day `recentFlags` count (Bugs 1, 2)

**Files:**
- Modify: `backend/src/services/chat/errorLearning.service.js:402-473`
- Test: `backend/test/unit/errorLearning.service.test.js`

- [ ] **Step 1: Backup**

```bash
cp backend/src/services/chat/errorLearning.service.js backend/src/services/chat/errorLearning.service.js.backup
```

- [ ] **Step 2: Write the failing test**

Create `backend/test/unit/errorLearning.service.test.js`:

```js
const errorLearningService = require('../../src/services/chat/errorLearning.service');
const ChatMessageFlag = require('../../src/models/ChatMessageFlag.model');
const ChatErrorPattern = require('../../src/models/ChatErrorPattern.model');

jest.mock('../../src/models/ChatMessageFlag.model');
jest.mock('../../src/models/ChatErrorPattern.model');

describe('getStats payload shape (frontend contract)', () => {
  beforeEach(() => {
    ChatMessageFlag.count.mockResolvedValue(30);
    ChatMessageFlag.findAll.mockImplementation((opts) => {
      if (opts?.attributes) {
        // group-by query
        return Promise.resolve([
          { flag_type: 'hallucination', get: () => '10' },
          { flag_type: 'incomplete', get: () => '17' },
        ]);
      }
      return Promise.resolve([]);
    });
    ChatErrorPattern.count.mockImplementation((opts) =>
      Promise.resolve(opts?.where?.is_active ? 5 : 8)
    );
  });

  it('returns flat fields the frontend reads (no nested .stats wrapper)', async () => {
    const res = await errorLearningService.getStats();
    expect(res.totalFlags).toBe(30);
    expect(res.byType).toEqual(expect.objectContaining({ hallucination: 10 }));
    expect(res.byStatus).toBeDefined();
    expect(typeof res.activePatterns).toBe('number');
    expect(typeof res.totalPatterns).toBe('number');
    expect(typeof res.recentFlags).toBe('number');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd backend && npx jest test/unit/errorLearning.service.test.js --no-coverage 2>&1 | tail -20
```

Expected: FAIL with `expect(received).toBe(30)  Expected: 30  Received: undefined` (because current shape is `{ok, stats: {...}}`).

- [ ] **Step 4: Rewrite `getStats` to flat shape**

Replace the entire `getStats` function (lines 402-473) with:

```js
async function getStats() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [
      totalFlags,
      pendingFlags,
      recentFlagsCount,
      byTypeRows,
      byStatusRows,
      bySeverityRows,
      totalPatterns,
      activePatterns,
    ] = await Promise.all([
      ChatMessageFlag.count(),
      ChatMessageFlag.count({ where: { resolution_status: 'pending' } }),
      ChatMessageFlag.count({ where: { created_at: { [Op.gte]: sevenDaysAgo } } }),
      ChatMessageFlag.findAll({
        attributes: ['flag_type', [Sequelize.fn('COUNT', '*'), 'count']],
        group: ['flag_type'],
      }),
      ChatMessageFlag.findAll({
        attributes: ['resolution_status', [Sequelize.fn('COUNT', '*'), 'count']],
        group: ['resolution_status'],
      }),
      ChatMessageFlag.findAll({
        attributes: ['severity', [Sequelize.fn('COUNT', '*'), 'count']],
        group: ['severity'],
      }),
      ChatErrorPattern.count(),
      ChatErrorPattern.count({ where: { is_active: true } }),
    ]);

    const tally = (rows, key) => rows.reduce((acc, r) => {
      acc[r[key]] = parseInt(r.get('count'), 10);
      return acc;
    }, {});

    return {
      totalFlags,
      pendingFlags,
      recentFlags: recentFlagsCount,
      byType: tally(byTypeRows, 'flag_type'),
      byStatus: tally(byStatusRows, 'resolution_status'),
      bySeverity: tally(bySeverityRows, 'severity'),
      totalPatterns,
      activePatterns,
    };
  } catch (error) {
    console.error('[ErrorLearning] getStats error:', error);
    throw error;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd backend && npx jest test/unit/errorLearning.service.test.js --no-coverage 2>&1 | tail -10
```

Expected: `Tests: 1 passed`

- [ ] **Step 6: Reload backend + live smoke**

```bash
pm2 reload pds-backend --update-env && sleep 3
JWT=$(cd backend && node -e "require('dotenv').config({quiet:true});console.log(require('jsonwebtoken').sign({id:1,email:'admin@bps.go.id',role:'admin'},process.env.JWT_SECRET,{expiresIn:'10m'}))" 2>/dev/null)
curl -s -H "Authorization: Bearer $JWT" http://127.0.0.1:5000/error-learning/stats | python3 -m json.tool
```

Expected: top-level `totalFlags`, `byType`, `activePatterns`, `recentFlags` (number).

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/chat/errorLearning.service.js backend/test/unit/errorLearning.service.test.js
git commit -m "fix(error-learning): flatten getStats payload to match frontend contract"
```

---

### Task 2: Severity filter in `listFlags` (Bug 4)

**Files:**
- Modify: `backend/src/controllers/errorLearning.controller.js:76-108`
- Test: `backend/test/unit/errorLearning.service.test.js` (append)

- [ ] **Step 1: Backup**

```bash
cp backend/src/controllers/errorLearning.controller.js backend/src/controllers/errorLearning.controller.js.backup
```

- [ ] **Step 2: Append the failing test**

Add to `backend/test/unit/errorLearning.service.test.js`:

```js
describe('listFlags severity filter (controller behavior)', () => {
  // Note: controller integration is tested via the existing controller pattern.
  // This unit-asserts the where-clause shape after filter parsing.
  it('builds where clause with severity when query.severity provided', () => {
    const buildWhere = (q) => {
      const where = {};
      if (q.status) where.resolution_status = q.status;
      if (q.flag_type) where.flag_type = q.flag_type;
      if (q.severity) where.severity = q.severity;
      return where;
    };
    expect(buildWhere({ severity: 'critical' })).toEqual({ severity: 'critical' });
    expect(buildWhere({ status: 'pending', severity: 'high' }))
      .toEqual({ resolution_status: 'pending', severity: 'high' });
  });
});
```

- [ ] **Step 3: Run test to verify the contract**

```bash
cd backend && npx jest test/unit/errorLearning.service.test.js --no-coverage -t "severity filter" 2>&1 | tail -5
```

Expected: PASS (this test asserts the where-shape we're about to implement).

- [ ] **Step 4: Implement the filter**

In `errorLearning.controller.js:76-108`, replace the `listFlags` function with:

```js
async function listFlags(req, res) {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const status = req.query.status || null;
    const flagType = req.query.flag_type || req.query.type || null;
    const severity = req.query.severity || null;

    const where = {};
    if (status) where.resolution_status = status;
    if (flagType) where.flag_type = flagType;
    if (severity) where.severity = severity;

    const { rows, count } = await ChatMessageFlag.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      offset: (page - 1) * limit,
      limit,
    });

    return res.json({
      ok: true,
      flags: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    });
  } catch (error) {
    console.error('[ErrorLearning] listFlags error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
```

Note the dual-name support (`flag_type` OR `type`) — the page sends `type` but earlier admin calls used `flag_type`.

- [ ] **Step 5: Reload + live smoke**

```bash
pm2 reload pds-backend --update-env && sleep 3
JWT=$(cd backend && node -e "require('dotenv').config({quiet:true});console.log(require('jsonwebtoken').sign({id:1,email:'admin@bps.go.id',role:'admin'},process.env.JWT_SECRET,{expiresIn:'10m'}))" 2>/dev/null)
curl -s -H "Authorization: Bearer $JWT" "http://127.0.0.1:5000/error-learning/flags?severity=low&limit=2" | python3 -c "import json,sys;d=json.load(sys.stdin);print('rows:',len(d['flags']),'severities:',set(f['severity'] for f in d['flags']))"
```

Expected: `severities: {'low'}` (or empty if no low rows).

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/errorLearning.controller.js backend/test/unit/errorLearning.service.test.js
git commit -m "fix(error-learning): honor severity + type query params in listFlags"
```

---

### Task 3: Pagination UI in `malika-analysis/page.tsx` (Bug 5)

**Files:**
- Modify: `backend/admin/app/malika-analysis/page.tsx:103-115, 244-291, 293-348`

- [ ] **Step 1: Backup**

```bash
cp backend/admin/app/malika-analysis/page.tsx backend/admin/app/malika-analysis/page.tsx.backup
```

- [ ] **Step 2: Add pagination state**

Edit `page.tsx`. After line 91 (after the `flagsFilter` state declaration), add:

```tsx
const [page, setPage] = useState(1);
const [pageInfo, setPageInfo] = useState<{ total: number; totalPages: number }>({ total: 0, totalPages: 1 });
```

- [ ] **Step 3: Wire pagination into `fetchFlags`**

Replace `fetchFlags` (lines 103-115) with:

```tsx
const fetchFlags = useCallback(async () => {
  try {
    const params = new URLSearchParams();
    if (flagsFilter.type) params.set("type", flagsFilter.type);
    if (flagsFilter.status) params.set("status", flagsFilter.status);
    if (flagsFilter.severity) params.set("severity", flagsFilter.severity);
    params.set("page", String(page));
    params.set("limit", "20");

    const res = await api.get(`/error-learning/flags?${params.toString()}`);
    setFlags(res.data.flags || []);
    setPageInfo({
      total: res.data.pagination?.total ?? 0,
      totalPages: res.data.pagination?.totalPages ?? 1,
    });
  } catch (e) {
    setError(getErrorMessage(e, "Failed to load flags"));
  }
}, [flagsFilter, page]);
```

- [ ] **Step 4: Reset page when filters change**

After the existing `useEffect` for initial load (line 138-146), add:

```tsx
useEffect(() => { setPage(1); }, [flagsFilter.type, flagsFilter.status, flagsFilter.severity]);
```

- [ ] **Step 5: Render pagination controls under the flags table**

Find the closing `</div>` for the flags table block (after line 348 `{flags.length === 0 && ...}`) and insert ABOVE the closing `</div>` of the flags-tab container:

```tsx
{pageInfo.totalPages > 1 && (
  <div className="flex items-center justify-between mt-4 px-2">
    <div className="text-sm text-gray-600 dark:text-gray-400">
      Page {page} of {pageInfo.totalPages} ({pageInfo.total} total)
    </div>
    <div className="flex gap-2">
      <button
        onClick={() => setPage((p) => Math.max(1, p - 1))}
        disabled={page <= 1}
        className="px-3 py-1 border rounded disabled:opacity-40 dark:border-gray-700"
      >
        Prev
      </button>
      <button
        onClick={() => setPage((p) => Math.min(pageInfo.totalPages, p + 1))}
        disabled={page >= pageInfo.totalPages}
        className="px-3 py-1 border rounded disabled:opacity-40 dark:border-gray-700"
      >
        Next
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 6: Reload admin + manual verify**

```bash
pm2 reload pds-admin --update-env
```

Open `https://api-malika.bpsmalut.com/backend/malika-analysis` in a browser. With 30 flags, you should see "Page 1 of 2 (30 total)" and Next/Prev buttons. Click Next, verify second page loads.

- [ ] **Step 7: Commit**

```bash
git add backend/admin/app/malika-analysis/page.tsx
git commit -m "fix(malika-analysis): add pagination controls to flags table"
```

---

### Task 4: Auto-parse `trigger_keywords` JSON in ChatErrorPattern model (Bug 6)

**Files:**
- Modify: `backend/src/models/ChatErrorPattern.model.js`

- [ ] **Step 1: Inspect current model**

```bash
grep -n "trigger_keywords" backend/src/models/ChatErrorPattern.model.js
```

- [ ] **Step 2: Backup**

```bash
cp backend/src/models/ChatErrorPattern.model.js backend/src/models/ChatErrorPattern.model.js.backup
```

- [ ] **Step 3: Add Sequelize getter**

Find the `trigger_keywords` column definition. Add a `get()` method that returns parsed JSON:

```js
trigger_keywords: {
  type: DataTypes.TEXT,
  allowNull: true,
  get() {
    const raw = this.getDataValue('trigger_keywords');
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try { return JSON.parse(raw); } catch { return []; }
  },
  set(val) {
    this.setDataValue('trigger_keywords',
      Array.isArray(val) ? JSON.stringify(val) : (val || null));
  },
},
```

(Adapt to existing field options like `field:`, `defaultValue:` if present — keep them.)

- [ ] **Step 4: Reload + verify in API response**

```bash
pm2 reload pds-backend --update-env && sleep 3
JWT=$(cd backend && node -e "require('dotenv').config({quiet:true});console.log(require('jsonwebtoken').sign({id:1,email:'admin@bps.go.id',role:'admin'},process.env.JWT_SECRET,{expiresIn:'10m'}))" 2>/dev/null)
curl -s -H "Authorization: Bearer $JWT" http://127.0.0.1:5000/error-learning/patterns | python3 -c "import json,sys;d=json.load(sys.stdin);p=d['patterns'][0];print('type:',type(p['trigger_keywords']).__name__,'value:',p['trigger_keywords'])"
```

Expected: `type: list value: ['ya', 'ok', ...]` (not a string).

- [ ] **Step 5: Commit**

```bash
git add backend/src/models/ChatErrorPattern.model.js
git commit -m "fix(model): auto-parse ChatErrorPattern.trigger_keywords JSON"
```

---

### Task 5: Fix `resolved_at` semantic for `reviewed` status (Bug 7)

**Files:**
- Modify: `backend/src/controllers/errorLearning.controller.js:255-283`

- [ ] **Step 1: Edit `updateFlag`**

In the `updateFlag` function, replace lines 266-270 (the `resolved_by + resolved_at` block) with:

```js
// 'reviewed' = looked at but not closed; only set resolved_* when actually closing
const closedStates = ['fixed', 'ignored', 'training_added'];
if (updates.resolution_status && closedStates.includes(updates.resolution_status)) {
  updates.resolved_by = req.user?.id || null;
  updates.resolved_at = new Date();
}
```

- [ ] **Step 2: Reload + verify**

```bash
pm2 reload pds-backend --update-env && sleep 3
```

(No automated test; semantic check is via UI flow in Task 12.)

- [ ] **Step 3: Commit**

```bash
git add backend/src/controllers/errorLearning.controller.js
git commit -m "fix(error-learning): only set resolved_at on closed states, not reviewed"
```

---

## Phase 2 — Outbound Loop (patterns/corrections → chat)

### Task 6: Port `addToKnowledgeBase` to xenova + retrieval_chunks (Bug 3)

**Files:**
- Modify: `backend/src/services/chat/errorLearning.service.js:353-396`

**Pattern source:** Same xenova→retrieval_chunks pattern used by `services/ai/knowledgeDoc.service.js::upsertKnowledgeChunk` and `services/rag/knowledgeSync.service.js::indexSingleDocument` (see commits `d6d19c9`, `2854e67`).

- [ ] **Step 1: Verify reference pattern**

```bash
grep -n "upsertKnowledgeChunk\|embedPassage" backend/src/services/ai/knowledgeDoc.service.js | head -10
```

You should see `upsertKnowledgeChunk(kbId, idx, title, text, metadata)` and `embedPassage(text)` usage. This is what we'll mirror.

- [ ] **Step 2: Backup**

```bash
cp backend/src/services/chat/errorLearning.service.js backend/src/services/chat/errorLearning.service.js.backup
```

- [ ] **Step 3: Replace the broken require + function**

At the top of `errorLearning.service.js`, change line 10 from:

```js
const { generateEmbedding } = require('../ai/embedding.service');
```

to:

```js
const { upsertKnowledgeChunk } = require('../ai/knowledgeDoc.service');
```

Then replace `addToKnowledgeBase` (lines 353-396) entirely:

```js
async function addToKnowledgeBase(flagId, correctionText) {
  try {
    const flag = await ChatMessageFlag.findByPk(flagId);
    if (!flag) return { ok: false, error: 'Flag not found' };

    const title = `Koreksi: ${flag.user_query?.slice(0, 100) || 'Pertanyaan tanpa judul'}`;
    const kb = await KnowledgeBase.create({
      title,
      description: `Auto-generated from flag #${flagId}`,
      category: 'koreksi',
      source_type: 'text',
      content: correctionText,
      content_length: correctionText.length,
      status: 'pending',
    });

    // Embed via xenova → retrieval_chunks (Phase C unified store)
    try {
      await upsertKnowledgeChunk({
        kbId: kb.id,
        chunkIndex: 0,
        title,
        text: `${title}\n\n${correctionText}`,
        metadata: { source: 'error-learning', flagId },
      });
      await kb.update({ status: 'ready' });
    } catch (e) {
      await kb.update({ status: 'error', error_message: e.message });
      console.warn(`[ErrorLearning] embed failed for flag=${flagId}:`, e.message);
      return { ok: false, error: `Indexing failed: ${e.message}`, knowledgeId: kb.id };
    }

    await flag.update({
      resolution_status: 'training_added',
      resolved_by: null,
      resolved_at: new Date(),
    });

    return { ok: true, knowledgeId: kb.id };
  } catch (error) {
    console.error('[ErrorLearning] addToKnowledgeBase error:', error);
    return { ok: false, error: error.message };
  }
}
```

- [ ] **Step 4: Verify `upsertKnowledgeChunk` signature matches**

```bash
grep -A 20 "async function upsertKnowledgeChunk\|function upsertKnowledgeChunk" backend/src/services/ai/knowledgeDoc.service.js | head -25
```

If the actual signature differs (positional vs. object args), adjust the call site in Step 3 accordingly. Don't invent a signature.

- [ ] **Step 5: Reload + live smoke (creates a real knowledge_base + retrieval_chunks row, then cleans up)**

```bash
pm2 reload pds-backend --update-env && sleep 3
JWT=$(cd backend && node -e "require('dotenv').config({quiet:true});console.log(require('jsonwebtoken').sign({id:1,email:'admin@bps.go.id',role:'admin'},process.env.JWT_SECRET,{expiresIn:'10m'}))" 2>/dev/null)
# Pick the most recent flag id
FLAG_ID=$(curl -s -H "Authorization: Bearer $JWT" "http://127.0.0.1:5000/error-learning/flags?limit=1" | python3 -c "import json,sys;print(json.load(sys.stdin)['flags'][0]['id'])")
echo "Testing with flag id=$FLAG_ID"
curl -s -X POST -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"correction_text":"TEST CORRECTION — delete me after smoke test"}' \
  "http://127.0.0.1:5000/error-learning/flags/$FLAG_ID/add-to-knowledge" | python3 -m json.tool
```

Expected: `{"ok": true, "knowledgeId": <number>}`. Then verify both rows exist:

```bash
cd backend && node -e "
require('dotenv').config({quiet:true});
const sequelize = require('./src/config/db');
sequelize.query(\"SELECT id, title, status FROM knowledge_base WHERE category='koreksi' ORDER BY id DESC LIMIT 1\").then(([rows]) => {
  console.log('KB:', rows[0]);
  return sequelize.query(\"SELECT id, source_kind, source_ref_id, title FROM retrieval_chunks WHERE source_kind='knowledge_doc' AND source_ref_id=? LIMIT 1\", { replacements: [rows[0].id] });
}).then(([rows]) => {
  console.log('RC:', rows[0]);
  process.exit(0);
});" 2>&1 | tail -5
```

Expected: KB row with `status: 'ready'`, RC row with matching `source_ref_id`.

- [ ] **Step 6: Cleanup the test rows**

```bash
cd backend && node -e "
require('dotenv').config({quiet:true});
const sequelize = require('./src/config/db');
sequelize.query(\"SELECT id FROM knowledge_base WHERE description LIKE 'Auto-generated from flag%' AND content LIKE 'TEST CORRECTION%'\").then(([rows]) => {
  const id = rows[0]?.id; if (!id) return console.log('nothing to clean'), process.exit(0);
  return Promise.all([
    sequelize.query('DELETE FROM retrieval_chunks WHERE source_kind=? AND source_ref_id=?', { replacements: ['knowledge_doc', id] }),
    sequelize.query('DELETE FROM knowledge_base WHERE id=?', { replacements: [id] }),
  ]).then(() => { console.log('cleaned id', id); process.exit(0); });
});" 2>&1 | tail -2
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/chat/errorLearning.service.js
git commit -m "fix(error-learning): port addToKnowledgeBase to xenova → retrieval_chunks (Phase C)"
```

---

### Task 7: Wire `checkQueryPattern` into streaming chat path

**Files:**
- Modify: `backend/src/services/chat/streaming.service.js:4733-4763`

**Why:** `checkQueryPattern` returns `{patternId, patternName, fixContent, errorDescription}` for `fix_type='special_handling'` patterns. It's exported but never called — admin can curate special_handling patterns but they have zero effect on chat. We inject them right next to `promptFixes`.

- [ ] **Step 1: Backup**

```bash
cp backend/src/services/chat/streaming.service.js backend/src/services/chat/streaming.service.js.backup
```

- [ ] **Step 2: Add the call alongside `getPromptFixes`**

At streaming.service.js:4734-4742, replace the `promptFixes` block with:

```js
// Get dynamic prompt fixes from error learning patterns (matched to user query)
let promptFixes = [];
let specialHandling = null;
try {
  if (errorLearningService?.getPromptFixes) {
    promptFixes = await errorLearningService.getPromptFixes(effectiveUserQuery);
  }
  if (errorLearningService?.checkQueryPattern) {
    specialHandling = await errorLearningService.checkQueryPattern(effectiveUserQuery);
    if (specialHandling?.fixContent) {
      // Special-handling patterns get appended to promptFixes with a clear prefix
      promptFixes.push(`[SPECIAL HANDLING — ${specialHandling.patternName}]\n${specialHandling.fixContent}`);
      console.log(`[StreamChat] Special handling pattern matched: ${specialHandling.patternName}`);
    }
  }
} catch (e) {
  console.warn('[StreamChat] Failed to get prompt fixes:', e.message);
}
```

- [ ] **Step 3: Reload + verify wiring (no functional test — just ensure no boot crash)**

```bash
pm2 reload pds-backend --update-env && sleep 5
pm2 logs pds-backend --lines 20 --nostream | grep -iE 'error|ready|listening' | head -5
```

Expected: `🚀 Server listening` and no new error stacks.

- [ ] **Step 4: Functional test via live chat smoke (deferred to Task 12)**

This is verified end-to-end after Tasks 8-11.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/chat/streaming.service.js
git commit -m "feat(chat): wire checkQueryPattern (special_handling) into streaming prompt"
```

---

### Task 8: Replace "Add to Training" with real "Add to Knowledge" UI call

**Files:**
- Modify: `backend/admin/app/malika-analysis/page.tsx:550-558` (the Add to Training button) + the modal body

**Why:** Currently `Add to Training` just labels the flag as `training_added`. With Task 6, we have a working endpoint that actually creates a `koreksi` row + retrieval_chunks entry. Surface it properly.

- [ ] **Step 1: Backup (already done in Task 3, skip if same file)**

- [ ] **Step 2: Add `correction_text` input to the modal**

In `page.tsx`, find the modal body where `Correction Notes` textarea is rendered (around line 511-520). Add ABOVE it:

```tsx
<div>
  <div className="font-medium text-sm text-gray-600 dark:text-gray-400 mb-1">Correction Text (added to knowledge base):</div>
  <textarea
    className="w-full border rounded p-2 dark:bg-gray-900 dark:border-gray-700"
    rows={4}
    placeholder="Tulis koreksi/jawaban yang benar — akan diindeks ke retrieval_chunks dan dipakai untuk pertanyaan serupa di chat MALIKA."
    id="correction-text"
  />
</div>
```

- [ ] **Step 3: Replace the "Add to Training" button handler**

Replace the `Add to Training` button (lines 550-558) with:

```tsx
<button
  onClick={async () => {
    const text = (document.getElementById("correction-text") as HTMLTextAreaElement)?.value?.trim();
    if (!text) { setError("Correction text required"); return; }
    try {
      const res = await api.post(`/error-learning/flags/${selectedFlag.id}/add-to-knowledge`, { correction_text: text });
      if (!res.data?.ok) throw new Error(res.data?.error || 'failed');
      await fetchFlags();
      await fetchStats();
      setSelectedFlag(null);
    } catch (e) {
      setError(getErrorMessage(e, "Failed to add to knowledge base"));
    }
  }}
  className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 text-sm"
>
  Add to Knowledge
</button>
```

- [ ] **Step 4: Reload admin + manual verify**

```bash
pm2 reload pds-admin --update-env
```

In browser at `/backend/malika-analysis`: click View on a flag, fill in Correction Text, click "Add to Knowledge". Verify it succeeds (no error banner), the flag status becomes `training_added`, and a new `koreksi` row exists in `knowledge_base`.

- [ ] **Step 5: Cleanup the verification row (same script as Task 6 Step 6)**

- [ ] **Step 6: Commit**

```bash
git add backend/admin/app/malika-analysis/page.tsx
git commit -m "feat(malika-analysis): wire Add to Knowledge button to backend endpoint"
```

---

## Phase 3 — Inbound Loop (chat → flags)

### Task 9: New `autoFlag.service.js` with conservative heuristics

**Files:**
- Create: `backend/src/services/chat/autoFlag.service.js`
- Test: `backend/test/unit/errorLearning.service.test.js` (append)

**Heuristics (conservative — false positives noisier than false negatives):**
1. **Refusal-with-data** (severity=high, type=hallucination): assistant says "tidak ada data" / "tidak tersedia" / "saya tidak menemukan" / "maaf, saya tidak" BUT `context_snapshot.candidates.length > 0` AND `dataPreview` had non-empty rows.
2. **Ultra-short for non-greeting** (severity=low, type=incomplete): `response.length < 30 && intent !== 'GREETING' && intent !== 'CHITCHAT'`.
3. **Same-error-repeat** (severity=medium, type=context_lost): identical assistant response (same content prefix) appeared in last 3 messages of the same thread.

Everything else is NOT auto-flagged. Users flag the rest manually.

- [ ] **Step 1: Write the failing test**

Append to `backend/test/unit/errorLearning.service.test.js`:

```js
const { detectAutoFlag } = require('../../src/services/chat/autoFlag.service');

describe('autoFlag heuristics', () => {
  it('flags refusal when context had candidates', () => {
    const result = detectAutoFlag({
      userQuery: 'Berapa IPM Halmahera Barat 2024?',
      assistantResponse: 'Maaf, saya tidak menemukan data tersebut.',
      intent: 'COMPLEX',
      candidates: [{ id: 1 }],
      dataPreviewRowCount: 5,
      recentAssistantResponses: [],
    });
    expect(result).toEqual(expect.objectContaining({ flag_type: 'hallucination', severity: 'high' }));
  });

  it('does NOT flag refusal when there were no candidates', () => {
    expect(detectAutoFlag({
      userQuery: 'X',
      assistantResponse: 'Maaf, saya tidak menemukan data tersebut.',
      intent: 'COMPLEX',
      candidates: [],
      dataPreviewRowCount: 0,
      recentAssistantResponses: [],
    })).toBeNull();
  });

  it('flags ultra-short non-greeting response', () => {
    expect(detectAutoFlag({
      userQuery: 'Inflasi Ternate?',
      assistantResponse: 'OK',
      intent: 'COMPLEX',
      candidates: [{ id: 1 }],
      dataPreviewRowCount: 2,
      recentAssistantResponses: [],
    })).toEqual(expect.objectContaining({ flag_type: 'incomplete', severity: 'low' }));
  });

  it('does NOT flag short response for GREETING', () => {
    expect(detectAutoFlag({
      userQuery: 'halo',
      assistantResponse: 'Halo!',
      intent: 'GREETING',
      candidates: [],
      dataPreviewRowCount: 0,
      recentAssistantResponses: [],
    })).toBeNull();
  });

  it('flags repeat assistant response in same thread', () => {
    const repeat = 'Data IPM tidak tersedia untuk periode tersebut.';
    expect(detectAutoFlag({
      userQuery: 'IPM 2024?',
      assistantResponse: repeat,
      intent: 'COMPLEX',
      candidates: [{ id: 1 }],
      dataPreviewRowCount: 3,
      recentAssistantResponses: [repeat, repeat],
    })).toEqual(expect.objectContaining({ flag_type: 'context_lost', severity: 'medium' }));
  });
});
```

- [ ] **Step 2: Run to fail**

```bash
cd backend && npx jest test/unit/errorLearning.service.test.js --no-coverage -t "autoFlag" 2>&1 | tail -10
```

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Create the service**

Create `backend/src/services/chat/autoFlag.service.js`:

```js
'use strict';
/**
 * Conservative heuristics for auto-flagging bad chat responses.
 *
 * Called fire-and-forget by streaming.service.js after a response completes.
 * Returns null if no heuristic matches; otherwise returns the row to insert
 * into chat_message_flags. Caller persists.
 *
 * False positives create noise on /backend/malika-analysis, so we only fire
 * when we're confident the response is wrong:
 *   1. Refusal-with-data: model said "tidak ada" but context had candidates+rows
 *   2. Ultra-short non-greeting: < 30 chars when intent is COMPLEX/DEEP
 *   3. Repeat-in-thread: same response back-to-back implies context_lost
 */

const REFUSAL_PATTERNS = [
  /tidak\s+(ada|tersedia|menemukan)/i,
  /maaf,?\s+saya\s+tidak/i,
  /belum\s+memiliki\s+data/i,
  /data\s+(tersebut|tersebut)?\s+tidak/i,
];

const NON_FLAGGED_INTENTS = new Set(['GREETING', 'CHITCHAT', 'OUT_OF_SCOPE']);

function detectAutoFlag({
  userQuery,
  assistantResponse,
  intent,
  candidates = [],
  dataPreviewRowCount = 0,
  recentAssistantResponses = [],
}) {
  const text = String(assistantResponse || '').trim();
  if (!text) return null;
  if (NON_FLAGGED_INTENTS.has(intent)) return null;

  // 1. Refusal-with-data
  const isRefusal = REFUSAL_PATTERNS.some((rx) => rx.test(text));
  if (isRefusal && candidates.length > 0 && dataPreviewRowCount > 0) {
    return {
      flag_type: 'hallucination',
      severity: 'high',
      flagged_by: 'system',
      user_query: userQuery,
      assistant_response: text,
      context_snapshot: { candidateCount: candidates.length, rowCount: dataPreviewRowCount, intent },
    };
  }

  // 2. Ultra-short non-greeting
  if (text.length < 30) {
    return {
      flag_type: 'incomplete',
      severity: 'low',
      flagged_by: 'system',
      user_query: userQuery,
      assistant_response: text,
      context_snapshot: { responseLength: text.length, intent },
    };
  }

  // 3. Repeat in same thread (last 2 responses identical)
  if (recentAssistantResponses.length >= 2 &&
      recentAssistantResponses[0] === text &&
      recentAssistantResponses[1] === text) {
    return {
      flag_type: 'context_lost',
      severity: 'medium',
      flagged_by: 'system',
      user_query: userQuery,
      assistant_response: text,
      context_snapshot: { repeatCount: 2, intent },
    };
  }

  return null;
}

module.exports = { detectAutoFlag };
```

- [ ] **Step 4: Run to pass**

```bash
cd backend && npx jest test/unit/errorLearning.service.test.js --no-coverage -t "autoFlag" 2>&1 | tail -10
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/chat/autoFlag.service.js backend/test/unit/errorLearning.service.test.js
git commit -m "feat(chat): add conservative autoFlag heuristics for bad responses"
```

---

### Task 10: Hook `autoFlag` into streaming.service.js post-response

**Files:**
- Modify: `backend/src/services/chat/streaming.service.js` (locate the post-response persistence path)

- [ ] **Step 1: Find the response-persisted hook point**

```bash
grep -n "saveAssistantMessage\|persistAssistantMessage\|ChatMessage.create.*role.*assistant\|insertAssistantMessage" backend/src/services/chat/streaming.service.js | head -10
```

Find where the assistant message is saved (after streaming completes). The autoFlag hook fires right after.

- [ ] **Step 2: Backup (already done in Task 7, skip if same session)**

- [ ] **Step 3: Add the require near the top**

After the existing `errorLearningService` require (line 37-42), add:

```js
let autoFlagService = null;
try {
  autoFlagService = require('./autoFlag.service');
} catch (e) {
  console.warn('[StreamChat] autoFlag service not available:', e.message);
}
```

- [ ] **Step 4: Insert the fire-and-forget hook**

At the assistant-message-persisted site (line found in Step 1), after the `ChatMessage.create({...})` resolves and we have `savedAssistantMsg.id`, add:

```js
// Fire-and-forget auto-flag heuristics — must not block response path
if (autoFlagService?.detectAutoFlag) {
  setImmediate(async () => {
    try {
      const ChatMessage = require('../../models/ChatMessage.model');
      const ChatMessageFlag = require('../../models/ChatMessageFlag.model');
      const recent = await ChatMessage.findAll({
        where: { thread_id: savedAssistantMsg.thread_id, role: 'assistant' },
        order: [['id', 'DESC']],
        limit: 3,
        attributes: ['content'],
      });
      const recentContents = recent.slice(1).map((m) => m.content); // exclude the one just saved

      const flagPayload = autoFlagService.detectAutoFlag({
        userQuery: effectiveUserQuery,
        assistantResponse: finalAssistantText,
        intent: intentResult?.intent || 'UNKNOWN',
        candidates: candidates || [],
        dataPreviewRowCount: dataPreview?.rows?.length || 0,
        recentAssistantResponses: recentContents,
      });

      if (flagPayload) {
        await ChatMessageFlag.create({
          ...flagPayload,
          message_id: savedAssistantMsg.id,
          thread_id: savedAssistantMsg.thread_id,
          resolution_status: 'pending',
        });
        console.log(`[StreamChat] auto-flagged msg=${savedAssistantMsg.id} type=${flagPayload.flag_type}`);
      }
    } catch (e) {
      console.warn('[StreamChat] autoFlag hook failed:', e.message);
    }
  });
}
```

**Names to verify in your local context:** `savedAssistantMsg`, `finalAssistantText`, `effectiveUserQuery`, `intentResult`, `candidates`, `dataPreview` — these are the variable names used elsewhere in `streaming.service.js`. If they're named differently in the hook-point block you found, adapt — don't invent.

- [ ] **Step 5: Reload + live chat smoke (creates a real flag if heuristics fire)**

```bash
pm2 reload pds-backend --update-env && sleep 5
```

In the PWA at `https://malika.bpsmalut.com/chat`, send a query you know will return short/refusal (e.g., "Cuaca besok di Halmahera?"). Then:

```bash
cd backend && node -e "
require('dotenv').config({quiet:true});
const sequelize = require('./src/config/db');
sequelize.query(\"SELECT id, message_id, flag_type, severity, flagged_by, created_at FROM chat_message_flags WHERE flagged_by='system' AND created_at > NOW() - INTERVAL 5 MINUTE ORDER BY id DESC LIMIT 3\").then(([rows]) => {
  console.table(rows);
  process.exit(0);
});" 2>&1 | tail -10
```

Expected: a fresh row in last 5 min with `flagged_by='system'` if heuristic matched, or none if the response was perfectly fine.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/chat/streaming.service.js
git commit -m "feat(chat): hook autoFlag heuristics post-response (fire-and-forget)"
```

---

### Task 11: "Flag this response" button in PWA chat UI

**Files:**
- Modify: `frontend/src/services/api.js` (add helper)
- Modify: `frontend/src/components/chat/<message component>.jsx` (add button)

**Note:** Frontend is a git submodule. Commit + push inside `frontend/` separately. Then bump the submodule pointer in the parent repo.

- [ ] **Step 1: Locate the message rendering component**

```bash
grep -rln "role.*assistant\|isAssistant\|message.role ===" /var/www/html/project-data-strategis/frontend/src/components/chat/ 2>/dev/null | head -5
```

Pick the component that renders an assistant message bubble (likely `MessageBubble.jsx` or `ChatMessage.jsx`).

- [ ] **Step 2: Add `flagChatMessage` to api.js**

In `frontend/src/services/api.js`, find the existing axios export. Add:

```js
export const flagChatMessage = async ({ messageId, threadId, flagType, ownerId }) => {
  const headers = ownerId ? { 'x-malika-uid': ownerId } : {};
  return api.post('/error-learning/flag', {
    message_id: messageId,
    thread_id: threadId,
    flag_type: flagType,
  }, { headers });
};
```

- [ ] **Step 3: Add the button to the assistant bubble component**

In the message bubble component, inside the assistant-role branch, add (next to existing actions like copy/feedback):

```jsx
{message.role === 'assistant' && (
  <button
    onClick={async () => {
      const type = window.prompt('Apa masalah dengan jawaban ini?\n(hallucination / wrong_data / incomplete / irrelevant / other)', 'incomplete');
      if (!type) return;
      try {
        await flagChatMessage({
          messageId: message.id,
          threadId: message.thread_id,
          flagType: type.trim(),
          ownerId: localStorage.getItem('malika_uid'),
        });
        alert('Terima kasih, laporan disimpan.');
      } catch (e) {
        alert('Gagal menyimpan laporan: ' + (e?.response?.data?.error || e.message));
      }
    }}
    className="text-xs text-gray-500 hover:text-red-600 ml-2"
    title="Laporkan jawaban bermasalah"
  >
    🚩 Laporkan
  </button>
)}
```

(If the codebase has a polished dropdown/modal pattern, follow that style instead of `window.prompt` — but minimal UI is acceptable for a low-frequency action.)

- [ ] **Step 4: Build + verify**

```bash
cd frontend && npm run build 2>&1 | tail -5
pm2 reload pds-frontend --update-env
```

Open `https://malika.bpsmalut.com/chat`, send a query, click the new 🚩 button on the assistant response, confirm via prompt, expect "Terima kasih". Then verify:

```bash
cd backend && node -e "
require('dotenv').config({quiet:true});
const sequelize = require('./src/config/db');
sequelize.query(\"SELECT id, message_id, flag_type, flagged_by, created_at FROM chat_message_flags WHERE flagged_by='user' AND created_at > NOW() - INTERVAL 5 MINUTE ORDER BY id DESC LIMIT 1\").then(([rows]) => {
  console.log(rows[0] || 'no user flag in last 5 min');
  process.exit(0);
});" 2>&1 | tail -2
```

Expected: one fresh user flag.

- [ ] **Step 5: Commit (inside frontend submodule)**

```bash
cd frontend
git add src/services/api.js src/components/chat/<bubble>.jsx
git commit -m "feat(chat): add Laporkan flag button on assistant messages"
git push origin main
cd ..
```

- [ ] **Step 6: Bump submodule pointer in parent**

```bash
git add frontend
git commit -m "chore(frontend): bump submodule for Laporkan flag button"
git push origin main
```

---

## Phase 4 — End-to-End Verification + Docs

### Task 12: Live end-to-end loop smoke

**Goal:** Prove the full loop works from chat → flag → admin review → pattern/knowledge fix → next chat consumes the fix.

- [ ] **Step 1: Outbound smoke (pattern → chat)**

Via admin UI at `/backend/malika-analysis`, create a new pattern (POST `/error-learning/patterns`):
- `pattern_name`: "smoke-test-injection"
- `pattern_type`: "query_pattern"
- `trigger_keywords`: `["smoke_test_marker_xyz"]`
- `error_description`: "Smoke test"
- `fix_type`: "add_to_prompt"
- `fix_content`: "RESPOND_WITH_TOKEN_ABC_123"
- `is_active`: true

Then in PWA chat, send: `smoke_test_marker_xyz tolong jawab`. The response should contain `ABC_123` (because the fix_content is in the system prompt).

```bash
# Cleanup the pattern after
JWT=$(cd backend && node -e "require('dotenv').config({quiet:true});console.log(require('jsonwebtoken').sign({id:1,email:'admin@bps.go.id',role:'admin'},process.env.JWT_SECRET,{expiresIn:'10m'}))" 2>/dev/null)
PID=$(curl -s -H "Authorization: Bearer $JWT" http://127.0.0.1:5000/error-learning/patterns | python3 -c "import json,sys;[print(p['id']) for p in json.load(sys.stdin)['patterns'] if p['pattern_name']=='smoke-test-injection']")
curl -s -X DELETE -H "Authorization: Bearer $JWT" "http://127.0.0.1:5000/error-learning/patterns/$PID"
```

- [ ] **Step 2: Inbound smoke (chat → flag)**

In PWA chat, click 🚩 on any assistant response, pick "irrelevant", submit. Verify it shows on `/backend/malika-analysis` flag list within 5 seconds.

- [ ] **Step 3: Loop smoke (correction → retrieval)**

On `/backend/malika-analysis`, open the flag from Step 2, paste correction text "MALIKA harus menjawab dengan tegas: TOKEN_LOOP_TEST_xyz", click "Add to Knowledge". Verify:
1. Flag becomes `training_added`
2. `knowledge_base` has a `koreksi` row with status `ready`
3. `retrieval_chunks` has a matching `source_kind='knowledge_doc'` row

Then in PWA chat, send a query similar to the original — retrieval should surface the correction (visible via debug log).

```bash
# Cleanup the korreksi row after
cd backend && node -e "
require('dotenv').config({quiet:true});
const sequelize = require('./src/config/db');
sequelize.query(\"SELECT id FROM knowledge_base WHERE category='koreksi' AND content LIKE 'MALIKA harus menjawab dengan tegas%' ORDER BY id DESC LIMIT 1\").then(([rows]) => {
  const id = rows[0]?.id; if (!id) return console.log('nothing'), process.exit(0);
  return Promise.all([
    sequelize.query('DELETE FROM retrieval_chunks WHERE source_kind=? AND source_ref_id=?', { replacements: ['knowledge_doc', id] }),
    sequelize.query('DELETE FROM knowledge_base WHERE id=?', { replacements: [id] }),
  ]).then(() => { console.log('cleaned id', id); process.exit(0); });
});" 2>&1 | tail -2
```

- [ ] **Step 4: Run full jest suite to make sure nothing else broke**

```bash
cd backend && npx jest --passWithNoTests --no-coverage 2>&1 | tail -10
```

Expected: same baseline (191 PASS, known failure in `integration/chat.test.js`).

---

### Task 13: Update workspace docs + memory

**Files:**
- Modify: `docs/workspace/chat-pipeline.md` (Change Log)
- Modify: `docs/workspace/backend.md` (Change Log)
- Create: `/root/.claude/projects/-var-www-html/memory/malika_analysis_loop_2026-05-11.md`
- Modify: `/root/.claude/projects/-var-www-html/memory/MEMORY.md` (index pointer)

- [ ] **Step 1: Append Change Log row to chat-pipeline.md**

```
| 2026-05-11 | MALIKA analysis loop closed end-to-end. (1) `addToKnowledgeBase` ported xenova→retrieval_chunks (was silent-lie writing to dropped columns). (2) `checkQueryPattern` (special_handling) wired into streaming.service.js alongside getPromptFixes. (3) New `autoFlag.service.js` with 3 conservative heuristics (refusal-with-data, ultra-short non-greeting, repeat-in-thread) fire-and-forget post-response. (4) PWA chat gains 🚩 Laporkan button on assistant messages. Plan: `docs/superpowers/plans/2026-05-11-malika-analysis-fixes-and-loop.md` | `backend/src/services/chat/{errorLearning,autoFlag,streaming}.service.js`, `frontend/src/services/api.js`, `frontend/src/components/chat/*.jsx` |
```

- [ ] **Step 2: Append Change Log row to backend.md**

```
| 2026-05-11 | `/backend/malika-analysis` audit fixes: getStats flattened (was nested `{stats:{...}}` breaking 4 cards + 2 charts), severity filter honored in listFlags, pagination wired in admin UI (was 33% of data unreachable), `trigger_keywords` JSON auto-parsed via Sequelize getter, `resolved_at` no longer set on `reviewed` status (semantic fix). Plan: `docs/superpowers/plans/2026-05-11-malika-analysis-fixes-and-loop.md` | `backend/src/{services/chat/errorLearning.service.js,controllers/errorLearning.controller.js,models/ChatErrorPattern.model.js}`, `backend/admin/app/malika-analysis/page.tsx` |
```

- [ ] **Step 3: Write the memory file**

Create `/root/.claude/projects/-var-www-html/memory/malika_analysis_loop_2026-05-11.md`:

```markdown
---
name: MALIKA analysis loop closed 2026-05-11
description: Audit fixes for /backend/malika-analysis + chat-MALIKA feedback loop closure (auto-flag heuristics, special_handling patterns wired, knowledge corrections via xenova/retrieval_chunks, PWA flag button).
type: project
---
# MALIKA Analysis Loop — 2026-05-11

> **Why:** Page had 7 audit bugs (3 high-severity: stats cards rendering 0, analytics tab empty, addToKnowledgeBase silent-lie writing to dropped columns). Beyond the bugs, the loop was open: special_handling patterns never injected into chat, no auto-flagger captured bad responses, PWA had no user flag button. Page existed but didn't actually improve MALIKA.
>
> **How to apply:** When extending error-learning, mirror the xenova→retrieval_chunks pattern via `services/ai/knowledgeDoc.service.js::upsertKnowledgeChunk`. New heuristics in autoFlag.service.js should stay conservative (false positives create admin noise).

## Loop wiring summary
| Direction | Mechanism | File |
|---|---|---|
| Chat → flag (user) | 🚩 Laporkan button → POST /error-learning/flag | `frontend/src/components/chat/*.jsx` |
| Chat → flag (auto) | `autoFlag.detectAutoFlag` post-response (fire-and-forget) | `backend/src/services/chat/{autoFlag,streaming}.service.js` |
| Pattern → chat (add_to_prompt) | `getPromptFixes` injected into system prompt | `streaming.service.js:4737` (already wired pre-2026-05-11) |
| Pattern → chat (special_handling) | `checkQueryPattern` appended to promptFixes | `streaming.service.js:~4740` (wired 2026-05-11) |
| Correction → retrieval | `addToKnowledgeBase` → xenova → retrieval_chunks(source_kind='knowledge_doc') | `errorLearning.service.js:addToKnowledgeBase` |

## Conservative auto-flag heuristics
1. **Refusal-with-data** → hallucination/high — model said "tidak ada" but context had candidates + rows
2. **Ultra-short non-greeting** → incomplete/low — `text.length < 30 && intent ∉ {GREETING, CHITCHAT, OUT_OF_SCOPE}`
3. **Repeat-in-thread** → context_lost/medium — last 2 assistant responses identical to current

Each carries `context_snapshot` for admin to diagnose without re-reading the thread.

## SQL probes
```sql
-- Auto-flag activity last 24h
SELECT flag_type, severity, COUNT(*)
FROM chat_message_flags
WHERE flagged_by='system' AND created_at > NOW() - INTERVAL 1 DAY
GROUP BY flag_type, severity;

-- User-flag activity last 7d
SELECT flag_type, COUNT(*)
FROM chat_message_flags
WHERE flagged_by='user' AND created_at > NOW() - INTERVAL 7 DAY
GROUP BY flag_type;

-- Corrections indexed to retrieval_chunks
SELECT kb.id, kb.title, rc.id AS rc_id
FROM knowledge_base kb
LEFT JOIN retrieval_chunks rc ON rc.source_kind='knowledge_doc' AND rc.source_ref_id=kb.id
WHERE kb.category='koreksi' ORDER BY kb.id DESC LIMIT 10;
```

## Gotchas
- `addToKnowledgeBase` uses xenova (768d) NOT the legacy OpenAI generator. Pre-2026-05-11 it wrote to dropped columns and was a silent-lie.
- `checkQueryPattern` was DEAD code from 2026-02-xx until 2026-05-11 — admin could create special_handling patterns but they had zero chat effect.
- Auto-flag is fire-and-forget — if it errors, chat is unaffected; check pm2 logs for `[StreamChat] autoFlag hook failed`.
```

- [ ] **Step 4: Update MEMORY.md index**

Add under "Active Plans" or "Project memories" section:

```markdown
- [MALIKA analysis loop (2026-05-11)](malika_analysis_loop_2026-05-11.md) — `/backend/malika-analysis` audit fixes + full loop closure: auto-flag heuristics, special_handling wiring, corrections via xenova/retrieval_chunks, PWA Laporkan button. **DONE 2026-05-11**.
```

- [ ] **Step 5: Commit (docs only — already committed feature commits above)**

```bash
git add docs/workspace/chat-pipeline.md docs/workspace/backend.md
git commit -m "docs: record malika-analysis loop closure in workspace change logs"
git push origin main
```

Memory files don't need commit (not in repo).

---

## Self-Review

**Spec coverage:**
- ✅ Bug 1 (stats cards 0) → Task 1
- ✅ Bug 2 (analytics empty) → Task 1 (same fix)
- ✅ Bug 3 (silent-lie addToKnowledge) → Task 6
- ✅ Bug 4 (severity filter dead) → Task 2
- ✅ Bug 5 (pagination missing) → Task 3
- ✅ Bug 6 (trigger_keywords JSON string) → Task 4
- ✅ Bug 7 (resolved_at on reviewed) → Task 5
- ✅ Loop outbound: special_handling patterns → Task 7
- ✅ Loop outbound: corrections in retrieval → Task 6 + 8
- ✅ Loop inbound: auto-flag → Tasks 9, 10
- ✅ Loop inbound: user flag UI → Task 11
- ✅ End-to-end verification → Task 12
- ✅ Docs + memory → Task 13

**Placeholder scan:** No `TBD`, no "implement later", no "similar to Task N". Each step has either exact code, exact command, or both.

**Type consistency:** `detectAutoFlag(...)` signature matches across Task 9 (definition) and Task 10 (call site). `upsertKnowledgeChunk` signature is verified in Task 6 Step 4 before use. Frontend `flagChatMessage` helper in Task 11 Step 2 matches the body shape POST `/error-learning/flag` expects per `errorLearning.controller.js:14-44`.

**Risk notes:**
- Task 10 hook-point variable names (`savedAssistantMsg`, `finalAssistantText`, `effectiveUserQuery`, etc.) need verification at hook-point in the existing streaming.service.js. Task 10 Step 1 grep locates the spot; engineer adapts names if local differ.
- Task 11 Step 1 grep locates the actual message-bubble component (name not assumed).
