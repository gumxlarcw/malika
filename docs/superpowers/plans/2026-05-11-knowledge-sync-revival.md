# Knowledge Sync Revival Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore BRS + Publikasi auto-embed end-to-end using **our own xenova embedder** (not OpenAI) writing to `retrieval_chunks`, and make the admin `/backend/knowledge-sync` page fully trackable + maintainable. Add a small status banner on `/backend/knowledge` so the operator sees the auto-sync state at a glance.

**Architecture:**
- Port `knowledgeSync.indexSingleDocument` to follow the same pattern as `knowledgeDoc.createFromText`: write parent KnowledgeBase row + chunked children + call the (already-migrated) `processEmbeddings` which writes to `retrieval_chunks` via xenova.
- Wire 4 admin endpoints the `/knowledge-sync` page already calls: `GET /knowledge/sync/stats`, `GET /knowledge/sync/config`, `POST /knowledge/sync`, `PUT /knowledge/sync/schedule`.
- Add a boot-time daily scheduler entry alongside the existing automation/publication/pressrelease ones in `server.js`.
- Persist runtime state (`enabled, hour, minute, lastRunAt, lastResult, history`) to `app_settings:scheduler:knowledge-sync` so it survives PM2 reload. In-memory `running` flag prevents concurrent runs.
- Add a one-row "Auto-sync: enabled · last ran X · next Y" banner on `/backend/knowledge` linking to `/backend/knowledge-sync` for deeper config.

**Tech Stack:** Node 22 / Express / Sequelize 6 / MariaDB 11.8 / xenova `@xenova/transformers` (multilingual-e5-base, 768d) / Next.js 16 admin.

---

## Verified ground truth (2026-05-11)

| Fact | Evidence |
|---|---|
| `indexed_brs_publikasi` last row 2026-03-08 21:01:03 | live query — auto-sync silent-dead 2 months |
| `/knowledge/sync/*` all 404 | live curl probe — no routes registered |
| `runDailySync()` has zero callers | grep across `/server.js`, `/services/`, `/scripts/` |
| `indexSingleDocument` calls OpenAI `generateEmbedding` + writes dropped columns | `services/rag/knowledgeSync.service.js:144-150` |
| `rechunkDocument` import is broken (function doesn't exist in `knowledgeDoc.service`) | grep returns 0 definitions |
| `/knowledge-sync` admin page is fully designed (4 panels: scheduler status, indexed counts, schedule config, sync config) | `admin/app/knowledge-sync/page.tsx` line-by-line read |
| Required response shapes | `SchedulerState`, `KnowledgeBaseStats`, `SyncStats`, `SyncConfig` — all typed in page.tsx |
| Existing scheduler pattern to copy | `services/automation/scheduler.service.js:122-211` (interval/daily mode + `app_settings` persistence) |
| Live embedder API for indexing | `bpsMetadata/embedding.service.js → embedPassage()` (768d xenova) |
| `processEmbeddings` already writes to retrieval_chunks | committed today in commit `213eb0c` |

## Failure surface (live probe)

| Endpoint | Today | Why |
|---|---|---|
| `GET /knowledge/sync/stats` | 404 | route missing |
| `GET /knowledge/sync/config` | 404 | route missing |
| `POST /knowledge/sync` | 404 | route missing |
| `PUT /knowledge/sync/schedule` | 404 | route missing |
| `/backend/knowledge-sync` (admin) | renders, all data loads fail | page UI is fine; backend is the gap |
| Daily auto-sync at 06:00 WIT | never fires | no scheduler entry in `server.js:149-154` |
| New BRS published today | not indexed | manual workflow doesn't exist either |

## Pre-flight ground rules

- Backup before edit: `cp <file> <file>.backup` (global CLAUDE.md rule).
- Backend reload: `pm2 reload pds-backend --update-env`. Admin needs rebuild only for Task 6 (page edit).
- Stage only intended files; never `git add -A`.
- No `Co-Authored-By` trailer.
- Commit per task.

## Drift checklist (what we WILL NOT change)

- The admin `/backend/knowledge-sync` page UI — preserved. We only fix the backend it depends on.
- Existing `SchedulerState` / `SyncStats` / `SyncConfig` TypeScript types — preserved verbatim (line 11-49 of `page.tsx`).
- `indexed_brs_publikasi` schema — preserved.
- `KnowledgeBase` table semantics (parent + child chunks) — preserved.
- Daily 06:00 WIT default schedule (matches the page's default `scheduleHour=6`).

---

## Task 1: Port `indexSingleDocument` to xenova + retrieval_chunks

**File:** `backend/src/services/rag/knowledgeSync.service.js`

**Why essence-preserving:** Same input (a BRS or Publikasi item from the BPS API), same outputs (a KnowledgeBase row + IndexedBrsPublikasi row + optional chunks), same lifecycle status. Only the embedding pipeline + storage switches. The `indexed_brs_publikasi` tracking table stays as the per-doc audit log.

**Approach:** Replace the inline `generateEmbedding` + dropped-column UPDATE with the same flow that `knowledgeDoc.createFromText` uses today: create parent + chunked children, then call `processEmbeddings([parentId, ...chunkIds])` which writes to retrieval_chunks via xenova.

- [ ] **Step 1: Replace import**

In `knowledgeSync.service.js` top:

```js
// REMOVE: const { generateEmbedding } = require('../ai/embedding.service');
// REMOVE: const { rechunkDocument } = require('../ai/knowledgeDoc.service');  // function doesn't exist
const { chunkText, processEmbeddings, MAX_CHUNK_SIZE, CHUNK_OVERLAP } = require('../ai/knowledgeDoc.service');
```

- [ ] **Step 2: Rewrite `indexSingleDocument`**

Replace the function body (lines 65-241) with:

```js
async function indexSingleDocument(doc, docType) {
  const externalId = docType === 'brs' ? doc.brs_id : doc.pub_id;
  const pdfUrl = doc.pdf_url || doc.pdf;

  try {
    // Build base content from abstract; optionally augment with PDF.
    let content = `${doc.title}\n\n${doc.abstract || doc.description || ''}`;
    let indexMode = 'abstract';
    let pdfExtracted = false;

    if (pdfUrl && SYNC_CONFIG.INDEX_MODE.includes('pdf')) {
      try {
        const pdfResult = await extractTextFromUrl(pdfUrl, {
          timeout: SYNC_CONFIG.PDF_TIMEOUT_MS,
        });
        if (pdfResult && pdfResult.text && pdfResult.text.length > 100) {
          content = `${doc.title}\n\n${doc.abstract || doc.description || ''}\n\n--- PDF Content ---\n\n${pdfResult.text}`;
          indexMode = 'abstract+pdf';
          pdfExtracted = true;
          logger.info({ externalId, docType, pdfPages: pdfResult.pages, textLength: pdfResult.text.length }, 'PDF content extracted');
        }
      } catch (pdfErr) {
        logger.warn({ externalId, docType, error: pdfErr.message }, 'PDF extraction failed, using abstract only');
      }
    }

    // Year from release_date
    let year = null;
    const releaseDate = doc.release_date || doc.rl_date;
    if (releaseDate) {
      const match = String(releaseDate).match(/(\d{4})/);
      if (match) year = parseInt(match[1]);
    }

    // 1) Create parent KnowledgeBase row
    const kbDoc = await KnowledgeBase.create({
      title: doc.title,
      description: `${docType === 'brs' ? 'BRS' : 'Publikasi'} - ${releaseDate || 'Unknown'} [${indexMode}]`,
      category: docType === 'brs' ? 'BRS' : 'Publikasi',
      source_type: 'text',
      source_url: pdfUrl,
      content,
      content_length: content.length,
      status: 'pending',
    });

    // 2) Keywords (best-effort, parent only)
    try {
      const keywords = await extractAllKeywords(doc.title, doc.abstract || doc.description, content);
      if (keywords) {
        await kbDoc.update({ keywords });
      }
    } catch (kwErr) {
      logger.warn({ externalId, docType, error: kwErr.message }, 'Keyword extraction failed (non-fatal)');
    }

    // 3) Indicator index (large docs only)
    if (content.length > 10000) {
      try {
        const indicatorIndex = extractIndicatorIndex(content, docType === 'brs' ? 'BRS' : 'Publikasi');
        if (indicatorIndex && indicatorIndex.length > 10) {
          await kbDoc.update({ indicator_index: indicatorIndex });
        }
      } catch (idxErr) {
        logger.warn({ externalId, docType, error: idxErr.message }, 'Indicator index extraction failed (non-fatal)');
      }
    }

    // 4) Chunk the body and create child rows (parent_id = kbDoc.id)
    const chunkIds = [];
    if (content.length > MAX_CHUNK_SIZE) {
      const chunks = chunkText(content, MAX_CHUNK_SIZE, CHUNK_OVERLAP);
      for (let i = 0; i < chunks.length; i++) {
        const child = await KnowledgeBase.create({
          title: `${doc.title} (${i + 1}/${chunks.length})`,
          category: kbDoc.category,
          source_type: 'text',
          source_url: pdfUrl,
          content: chunks[i],
          content_length: chunks[i].length,
          chunk_index: i,
          parent_id: kbDoc.id,
          status: 'pending',
        });
        chunkIds.push(child.id);
      }
    }

    // 5) Embed parent + chunks via xenova → retrieval_chunks (in-place upsert).
    await processEmbeddings([kbDoc.id, ...chunkIds]);

    // 6) Read back lifecycle status (processEmbeddings flips it to 'ready' or 'error')
    await kbDoc.reload();
    const embeddingSuccess = kbDoc.status === 'ready';

    // 7) Track in indexed table — audit row regardless of embedding outcome
    await IndexedBrsPublikasi.create({
      doc_type: docType,
      external_id: String(externalId),
      title: doc.title,
      release_date: releaseDate,
      year,
      index_mode: indexMode,
      knowledge_doc_id: kbDoc.id,
      content_length: content.length,
      pdf_url: pdfUrl,
      status: embeddingSuccess ? 'success' : 'error',
      error_message: embeddingSuccess ? null : (kbDoc.error_message || 'Embedding failed'),
      created_at: new Date(),
      updated_at: new Date(),
    });

    logger.info({
      docType, externalId, title: doc.title?.slice(0, 50),
      indexMode, contentLength: content.length, pdfExtracted,
      embeddingSuccess, chunksCreated: chunkIds.length,
    }, 'Document indexed');

    return { success: embeddingSuccess, id: kbDoc.id, pdfExtracted, chunksCreated: chunkIds.length };
  } catch (error) {
    logger.error({ docType, externalId, error: error.message }, 'Failed to index document');
    return { success: false, error: error.message };
  }
}
```

- [ ] **Step 3: Drop the `vectorSearch.loadKnowledgeEmbeddings` cache-invalidate**

In `runDailySync` (line 358-369), remove the `loadKnowledgeEmbeddings(true)` call — the unified retrieval path queries `retrieval_chunks` live, no in-memory cache to invalidate.

```js
// REPLACE:
//   if (vectorSearch.loadKnowledgeEmbeddings) {
//     await vectorSearch.loadKnowledgeEmbeddings(true);
//     cacheInvalidated = true;
//     ...
//   }
// WITH:
//   // No cache to invalidate — unified retrieval reads retrieval_chunks live.
//   cacheInvalidated = false;
```

Keep the keyword index refresh (still useful).

- [ ] **Step 4: Verify module loads cleanly**

```bash
cd /var/www/html/project-data-strategis/backend && node -e "require('./src/services/rag/knowledgeSync.service')"
```
Expected: no error (was previously broken because `rechunkDocument` import was undefined, but never called at top-level).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/rag/knowledgeSync.service.js
git commit --no-gpg-sign -m "feat(knowledge-sync): port indexSingleDocument to xenova + retrieval_chunks"
```

---

## Task 2: Add scheduler state tracker + persistence

**File:** `backend/src/services/rag/knowledgeSync.service.js`

**Why essence-preserving:** State tracking is **new code** but the function set the page expects (`getSyncStats()` returning a `scheduler` object) is fully defined by the existing UI's `SchedulerState` type. We're filling in the wire format the page already speaks.

- [ ] **Step 1: Add in-memory + persisted state**

Append to `knowledgeSync.service.js` (after `getSyncStats`):

```js
// ── Scheduler state ─────────────────────────────────────────────────────
const { getJson, setJson } = require('../settings/appSettings.service');

const STATE_KEY = 'scheduler:knowledge-sync';
const DEFAULT_STATE = {
  enabled: true,
  hour: 6,
  minute: 0,
  lastRunAt: null,
  lastResult: null,
  history: [],     // last 5 runs (most recent first)
};

let _runningFlag = false;
let _intervalTimer = null;
let _nextRunAt = null;

async function loadState() {
  const saved = await getJson(STATE_KEY);
  return { ...DEFAULT_STATE, ...(saved || {}) };
}

async function saveState(state) {
  await setJson(STATE_KEY, state);
}

function isRunning() {
  return _runningFlag;
}

function getNextRunAt() {
  return _nextRunAt;
}

async function getSchedulerState() {
  const state = await loadState();
  return {
    name: 'knowledge-sync',
    enabled: Boolean(state.enabled),
    schedule: `${String(state.hour).padStart(2, '0')}:${String(state.minute).padStart(2, '0')}`,
    running: _runningFlag,
    lastRunAt: state.lastRunAt,
    lastResult: state.lastResult,
    nextRunAt: _nextRunAt ? _nextRunAt.toISOString() : null,
    history: state.history || [],
  };
}

async function updateSchedule({ enabled, hour, minute }) {
  const state = await loadState();
  const next = { ...state };
  if (typeof enabled === 'boolean') next.enabled = enabled;
  if (Number.isFinite(hour) && hour >= 0 && hour <= 23) next.hour = Number(hour);
  if (Number.isFinite(minute) && minute >= 0 && minute <= 59) next.minute = Number(minute);
  await saveState(next);
  return next;
}
```

- [ ] **Step 2: Wrap `runDailySync` with tracker**

Add a new exported `runDailySyncTracked()` that wraps `runDailySync` with state updates:

```js
async function runDailySyncTracked() {
  if (_runningFlag) {
    return { skipped: true, reason: 'Already running' };
  }
  _runningFlag = true;
  const startedAt = new Date();

  try {
    const result = await runDailySync();
    const state = await loadState();
    const finishedAt = new Date();
    const lastResult = {
      success: true,
      brs: { indexed: result.brs.indexed, errors: result.brs.errors },
      publikasi: { indexed: result.publikasi.indexed, errors: result.publikasi.errors },
      durationMs: result.durationMs,
      timestamp: finishedAt.toISOString(),
    };
    const newState = {
      ...state,
      lastRunAt: finishedAt.toISOString(),
      lastResult,
      history: [lastResult, ...(state.history || [])].slice(0, 5),
    };
    await saveState(newState);
    return result;
  } catch (e) {
    const state = await loadState();
    const finishedAt = new Date();
    const lastResult = {
      success: false,
      error: e?.message || String(e),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      timestamp: finishedAt.toISOString(),
    };
    const newState = {
      ...state,
      lastRunAt: finishedAt.toISOString(),
      lastResult,
      history: [lastResult, ...(state.history || [])].slice(0, 5),
    };
    await saveState(newState);
    throw e;
  } finally {
    _runningFlag = false;
  }
}
```

- [ ] **Step 3: Extend `getSyncStats` to include scheduler**

Update the existing `getSyncStats` to merge scheduler state:

```js
async function getSyncStats() {
  const [brsCount] = await IndexedBrsPublikasi.sequelize.query(
    `SELECT COUNT(*) as cnt FROM indexed_brs_publikasi WHERE doc_type = 'brs'`
  );
  const [pubCount] = await IndexedBrsPublikasi.sequelize.query(
    `SELECT COUNT(*) as cnt FROM indexed_brs_publikasi WHERE doc_type = 'publication'`
  );
  const [kbCount] = await KnowledgeBase.sequelize.query(
    `SELECT category, COUNT(*) as cnt, MAX(created_at) as latest
     FROM knowledge_base WHERE category IN ('BRS', 'Publikasi')
     GROUP BY category`
  );

  const scheduler = await getSchedulerState();

  return {
    indexed: {
      brs: brsCount[0]?.cnt || 0,
      publikasi: pubCount[0]?.cnt || 0,
    },
    knowledgeBase: kbCount,
    scheduler,
  };
}
```

- [ ] **Step 4: Export the new helpers**

Update `module.exports` to include `runDailySyncTracked`, `getSchedulerState`, `updateSchedule`, `isRunning`, `getNextRunAt`, `_setNextRunAt` (one setter for the scheduler to update `_nextRunAt`).

```js
function _setNextRunAt(d) { _nextRunAt = d; }

module.exports = {
  runDailySync,
  runDailySyncTracked,
  syncBrs,
  syncPublikasi,
  isAlreadyIndexed,
  indexSingleDocument,
  getSyncStats,
  getSchedulerState,
  updateSchedule,
  isRunning,
  getNextRunAt,
  _setNextRunAt,
  SYNC_CONFIG,
};
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/rag/knowledgeSync.service.js
git commit --no-gpg-sign -m "feat(knowledge-sync): add scheduler state tracker (in-memory + app_settings)"
```

---

## Task 3: Wire `/knowledge/sync/*` routes + controller

**Files:**
- `backend/src/controllers/knowledge.controller.js` — append 4 handlers
- `backend/src/routes/knowledge.routes.js` — register 4 routes

**Why essence-preserving:** The admin page's `SchedulerState`, `SyncStats`, `SyncConfig` types are the API contract. We're wiring backends that match those shapes verbatim.

- [ ] **Step 1: Add controller handlers**

Append to `backend/src/controllers/knowledge.controller.js` (before `module.exports`):

```js
async function getSyncStats(req, res) {
  try {
    const knowledgeSyncService = require('../services/rag/knowledgeSync.service');
    const stats = await knowledgeSyncService.getSyncStats();
    res.json(stats);
  } catch (e) {
    console.error('[Knowledge] getSyncStats error:', e);
    res.status(500).json({ error: e.message });
  }
}

async function getSyncConfig(req, res) {
  try {
    const knowledgeSyncService = require('../services/rag/knowledgeSync.service');
    res.json(knowledgeSyncService.SYNC_CONFIG);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function runManualSync(req, res) {
  try {
    const knowledgeSyncService = require('../services/rag/knowledgeSync.service');
    if (knowledgeSyncService.isRunning()) {
      return res.status(409).json({ error: 'Sync already running', running: true });
    }
    const result = await knowledgeSyncService.runDailySyncTracked();
    res.json(result);
  } catch (e) {
    console.error('[Knowledge] runManualSync error:', e);
    res.status(500).json({ error: e.message });
  }
}

async function updateSyncSchedule(req, res) {
  try {
    const knowledgeSyncService = require('../services/rag/knowledgeSync.service');
    const { enabled, hour, minute } = req.body || {};
    const newState = await knowledgeSyncService.updateSchedule({
      enabled: typeof enabled === 'boolean' ? enabled : undefined,
      hour: Number.isFinite(Number(hour)) ? Number(hour) : undefined,
      minute: Number.isFinite(Number(minute)) ? Number(minute) : undefined,
    });
    // Restart scheduler to apply new config
    try {
      const { restartKnowledgeSyncScheduler } = require('../services/rag/knowledgeSyncScheduler.service');
      await restartKnowledgeSyncScheduler();
    } catch (schedErr) {
      console.warn('[Knowledge] scheduler restart failed:', schedErr.message);
    }
    res.json({ ok: true, schedule: newState });
  } catch (e) {
    console.error('[Knowledge] updateSyncSchedule error:', e);
    res.status(500).json({ error: e.message });
  }
}
```

Add the 4 names to `module.exports`.

- [ ] **Step 2: Register routes**

In `backend/src/routes/knowledge.routes.js`, add **before the existing routes** (or at end, doesn't matter — there's no `/:id` ambiguity for these paths):

```js
// Knowledge Sync (BRS + Publikasi auto-embed)
router.get('/sync/stats', knowledgeController.getSyncStats);
router.get('/sync/config', knowledgeController.getSyncConfig);
router.post('/sync', knowledgeController.runManualSync);
router.put('/sync/schedule', knowledgeController.updateSyncSchedule);
```

- [ ] **Step 3: Reload + smoke**

```bash
pm2 reload pds-backend --update-env
sleep 6
cd /var/www/html/project-data-strategis/backend
JWT=$(node -e "require('dotenv').config({quiet:true}); console.log(require('jsonwebtoken').sign({id:1,email:'admin@bps.go.id',role:'admin'}, process.env.JWT_SECRET, {expiresIn:'2h'}))")
echo "GET /knowledge/sync/stats:"
curl -s -H "Authorization: Bearer $JWT" http://localhost:5000/knowledge/sync/stats | python3 -m json.tool | head -30
echo "GET /knowledge/sync/config:"
curl -s -H "Authorization: Bearer $JWT" http://localhost:5000/knowledge/sync/config
echo
echo "PUT /knowledge/sync/schedule (hour=6,minute=0,enabled=true):"
curl -s -X PUT -H "Authorization: Bearer $JWT" -H "Cookie: csrf_token=t" -H "X-CSRF-Token: t" -H "content-type: application/json" -d '{"enabled":true,"hour":6,"minute":0}' http://localhost:5000/knowledge/sync/schedule
```

Expected: stats returns `{indexed, knowledgeBase, scheduler}` shape, config returns SYNC_CONFIG, PUT returns `{ok:true, schedule:{...}}`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/knowledge.controller.js backend/src/routes/knowledge.routes.js
git commit --no-gpg-sign -m "feat(knowledge-sync): wire /knowledge/sync stats/config/manual-trigger/schedule"
```

---

## Task 4: Boot-time scheduler that fires `runDailySyncTracked` daily

**Files:**
- `backend/src/services/rag/knowledgeSyncScheduler.service.js` (NEW)
- `backend/server.js` — register at bootstrap alongside other schedulers

**Why essence-preserving:** New file, but **the pattern is copied from `automation/scheduler.service.js`** — a daily-mode timer that:
- Reads schedule from `app_settings:scheduler:knowledge-sync`
- Sets `_nextRunAt` so the UI shows the right "next run" timestamp
- Calls `runDailySyncTracked()` at the configured time
- Reschedules itself for the next day

No new tables, no new abstractions.

- [ ] **Step 1: Create the scheduler service**

Write `backend/src/services/rag/knowledgeSyncScheduler.service.js`:

```js
'use strict';

const knowledgeSyncService = require('./knowledgeSync.service');
const logger = require('../../utils/logger').child({ service: 'KnowledgeSyncScheduler' });

let _dailyTimer = null;

function getNextRunDelayMs({ hour, minute }) {
  const now = new Date();
  // App default tz is UTC; admin sees WIT = UTC+9. We schedule based on
  // WIT wall-clock so 06:00 means 06:00 in Jayapura.
  // Convert "next WIT hour:minute" to a UTC Date.
  const nowMs = Date.now();
  const witNow = new Date(nowMs + 9 * 60 * 60 * 1000);
  const witNext = new Date(witNow);
  witNext.setUTCHours(hour, minute, 0, 0);
  if (witNext.getTime() <= witNow.getTime()) {
    witNext.setUTCDate(witNext.getUTCDate() + 1);
  }
  const nextUtcMs = witNext.getTime() - 9 * 60 * 60 * 1000;
  return Math.max(0, nextUtcMs - nowMs);
}

function getNextRunAt({ hour, minute }) {
  const ms = getNextRunDelayMs({ hour, minute });
  return new Date(Date.now() + ms);
}

function stopKnowledgeSyncScheduler() {
  if (_dailyTimer) clearTimeout(_dailyTimer);
  _dailyTimer = null;
  knowledgeSyncService._setNextRunAt(null);
}

async function startKnowledgeSyncScheduler() {
  stopKnowledgeSyncScheduler();

  const state = await knowledgeSyncService.getSchedulerState();
  if (!state.enabled) {
    logger.info('Scheduler disabled in app_settings; not arming timer');
    return false;
  }

  const [hourStr, minuteStr] = String(state.schedule).split(':');
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  const scheduleNext = () => {
    const delayMs = getNextRunDelayMs({ hour, minute });
    const nextAt = getNextRunAt({ hour, minute });
    knowledgeSyncService._setNextRunAt(nextAt);
    logger.info({ nextAt: nextAt.toISOString(), delayMs }, 'Knowledge-sync scheduler armed');

    _dailyTimer = setTimeout(async () => {
      try {
        await knowledgeSyncService.runDailySyncTracked();
      } catch (e) {
        logger.warn({ err: e.message }, 'Tracked knowledge-sync run failed');
      } finally {
        scheduleNext();
      }
    }, delayMs);
  };

  scheduleNext();
  return true;
}

async function restartKnowledgeSyncScheduler() {
  stopKnowledgeSyncScheduler();
  return await startKnowledgeSyncScheduler();
}

module.exports = {
  startKnowledgeSyncScheduler,
  stopKnowledgeSyncScheduler,
  restartKnowledgeSyncScheduler,
};
```

- [ ] **Step 2: Wire at bootstrap**

In `backend/server.js:148-154`, add the new scheduler to the array:

```js
for (const [label, loader] of [
    ['automation',      () => require('./src/services/automation/scheduler.service').startAutomationScheduler()],
    ['publication',     () => require('./src/services/publication/scheduler.service').startPublicationNotificationScheduler()],
    ['mergedcache',     () => require('./src/services/notification/mergedCacheScheduler.service').startMergedCacheNotificationScheduler()],
    ['pressrelease',    () => require('./src/services/pressrelease/scheduler.service').startPressReleaseNotificationScheduler()],
    ['knowledge-sync',  () => require('./src/services/rag/knowledgeSyncScheduler.service').startKnowledgeSyncScheduler()],  // NEW
    ['petatematik',     () => require('./src/services/petaTematik/petaTematik.service').initIndikatorList()],
]) {
```

- [ ] **Step 3: Reload + verify timer arms**

```bash
pm2 reload pds-backend --update-env
sleep 8
# Backend logs should show "Knowledge-sync scheduler armed { nextAt: ... }"
pm2 logs pds-backend --lines 20 --nostream | grep -i knowledge-sync | head
echo "---live state check==="
cd /var/www/html/project-data-strategis/backend
JWT=$(node -e "require('dotenv').config({quiet:true}); console.log(require('jsonwebtoken').sign({id:1,email:'admin@bps.go.id',role:'admin'}, process.env.JWT_SECRET, {expiresIn:'2h'}))")
curl -s -H "Authorization: Bearer $JWT" http://localhost:5000/knowledge/sync/stats | python3 -c "import sys,json; d=json.load(sys.stdin); s=d['scheduler']; print('enabled=', s['enabled'], 'schedule=', s['schedule'], 'nextRunAt=', s['nextRunAt'])"
```
Expected: nextRunAt populated, schedule="06:00", enabled=true.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/rag/knowledgeSyncScheduler.service.js backend/server.js
git commit --no-gpg-sign -m "feat(knowledge-sync): boot-time daily scheduler (default 06:00 WIT)"
```

---

## Task 5: Live smoke — manual sync indexes a real BRS via xenova

**Files:** None (verification step)

**Why essence-preserving:** End-to-end proof that BRS auto-sync works through xenova → retrieval_chunks. Limits the run to `MAX_NEW_PER_SYNC=20` so it doesn't hammer BPS or the embedder.

- [ ] **Step 1: Snapshot before**

```bash
cd /var/www/html/project-data-strategis/backend
JWT=$(node -e "require('dotenv').config({quiet:true}); console.log(require('jsonwebtoken').sign({id:1,email:'admin@bps.go.id',role:'admin'}, process.env.JWT_SECRET, {expiresIn:'2h'}))")
echo "===before==="
mysql -uroot project_data_strategis -e "SELECT COUNT(*) AS brs_count, MAX(created_at) AS latest_brs FROM indexed_brs_publikasi WHERE doc_type='brs'"
mysql -uroot project_data_strategis -e "SELECT COUNT(*) AS rc_knowledge_doc FROM retrieval_chunks WHERE source_kind='knowledge_doc'"
```

- [ ] **Step 2: Trigger manual sync**

```bash
echo "===POST /knowledge/sync (will take 1-3 minutes for ~20 docs)==="
curl -s -X POST -H "Authorization: Bearer $JWT" -H "Cookie: csrf_token=t" -H "X-CSRF-Token: t" -H "content-type: application/json" -d '{}' http://localhost:5000/knowledge/sync
```

Expected: `{brs: {fetched, newItems, indexed, errors}, publikasi: {...}, durationMs, cacheInvalidated: false}`.

If the response shows `indexed > 0`, BPS had new docs and indexing worked. If `indexed === 0 && newItems === 0`, that means every recent doc was already in `indexed_brs_publikasi` from the 2026-03-08 backfill — still a valid pass.

- [ ] **Step 3: Verify rows landed in retrieval_chunks**

```bash
echo "===after==="
mysql -uroot project_data_strategis -e "SELECT COUNT(*) AS brs_count, MAX(created_at) AS latest_brs FROM indexed_brs_publikasi WHERE doc_type='brs'"
mysql -uroot project_data_strategis -e "SELECT COUNT(*) AS rc_knowledge_doc FROM retrieval_chunks WHERE source_kind='knowledge_doc'"
echo "===recent retrieval_chunks for kb new docs==="
mysql -uroot project_data_strategis -e "SELECT source_kind, source_ref_id, embedding_model, embedding_generated_at FROM retrieval_chunks WHERE embedding_generated_at > NOW() - INTERVAL 5 MINUTE ORDER BY id DESC LIMIT 10"
```

Acceptance:
- New rows in retrieval_chunks have `embedding_model='Xenova/multilingual-e5-base'`
- `indexed_brs_publikasi.created_at` shows a row from today
- No `embedding_model='text-embedding-3-small'` for new rows

- [ ] **Step 4: Verify scheduler state surfaces correctly**

```bash
curl -s -H "Authorization: Bearer $JWT" http://localhost:5000/knowledge/sync/stats | python3 -c "import sys,json; d=json.load(sys.stdin); s=d['scheduler']; print('lastRunAt=', s['lastRunAt']); print('lastResult=', json.dumps(s.get('lastResult'), indent=2)); print('history len=', len(s.get('history', [])))"
```
Expected: lastRunAt populated, lastResult shows BRS/Publikasi indexed counts, history has 1 entry.

- [ ] **Step 5: No commit (verification only)**

---

## Task 6: Auto-sync status banner on `/backend/knowledge`

**File:** `backend/admin/app/knowledge/page.tsx`

**Why essence-preserving:** Adds a one-row banner near the existing page header. No removal, no behavior change, just a "Auto-sync: enabled · last ran X · next Y · click to manage" hint with a link to `/backend/knowledge-sync`. The deeper management lives on the existing knowledge-sync page (which now works after Tasks 1-4).

- [ ] **Step 1: Fetch + render the banner**

In `page.tsx`, add at the top of the component body alongside the existing `useState`/`useEffect`:

```ts
type SyncBannerState = {
  enabled: boolean;
  schedule: string;          // "HH:MM"
  lastRunAt: string | null;
  nextRunAt: string | null;
  running: boolean;
  lastResult: {
    success: boolean;
    brs?: { indexed: number; errors: number };
    publikasi?: { indexed: number; errors: number };
  } | null;
} | null;

const [syncBanner, setSyncBanner] = useState<SyncBannerState>(null);

useEffect(() => {
  (async () => {
    try {
      const res = await api.get<{ scheduler: SyncBannerState }>("/knowledge/sync/stats");
      setSyncBanner(res.data.scheduler || null);
    } catch {
      // Banner is best-effort; silent failure is OK.
    }
  })();
}, []);
```

Render near the existing page title (the page currently has a header section — insert after it):

```tsx
{syncBanner && (
  <div className="rounded-lg border border-border bg-card p-3 flex items-center justify-between text-sm">
    <div className="flex items-center gap-3">
      <span
        className={
          "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium " +
          (syncBanner.enabled
            ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200"
            : "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300")
        }
      >
        Auto-sync BRS+Publikasi: {syncBanner.enabled ? "Aktif" : "Nonaktif"}
      </span>
      {syncBanner.enabled && (
        <span className="text-muted-foreground">
          {syncBanner.running
            ? "Sedang sync..."
            : `Jadwal harian ${syncBanner.schedule} WIT`}
          {syncBanner.lastRunAt
            ? ` · Run terakhir ${new Date(syncBanner.lastRunAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}`
            : " · Belum pernah berjalan"}
          {syncBanner.lastResult && syncBanner.lastResult.success
            ? ` (BRS +${syncBanner.lastResult.brs?.indexed || 0}, Publikasi +${syncBanner.lastResult.publikasi?.indexed || 0})`
            : ""}
        </span>
      )}
    </div>
    <a
      href="/backend/knowledge-sync"
      className="text-primary hover:underline text-xs font-medium"
    >
      Kelola →
    </a>
  </div>
)}
```

- [ ] **Step 2: Build admin + reload**

```bash
cd /var/www/html/project-data-strategis/backend/admin && npm run build
pm2 reload pds-admin --update-env
sleep 4
curl -i -s http://localhost:5050/backend/knowledge | head -3
```
Expected: HTTP 200.

- [ ] **Step 3: Visual smoke**

Open `https://api-malika.bpsmalut.com/backend/knowledge` in browser; confirm the banner shows enabled state + last-run + "Kelola →" link goes to `/backend/knowledge-sync` which now also renders without errors.

- [ ] **Step 4: Commit**

```bash
git add backend/admin/app/knowledge/page.tsx
git commit --no-gpg-sign -m "feat(admin): auto-sync status banner on /backend/knowledge"
```

---

## Task 7: Closeout — memory + push

- [ ] **Step 1: Full surface smoke**

```bash
cd /var/www/html/project-data-strategis/backend
JWT=$(node -e "require('dotenv').config({quiet:true}); console.log(require('jsonwebtoken').sign({id:1,email:'admin@bps.go.id',role:'admin'}, process.env.JWT_SECRET, {expiresIn:'2h'}))")

for ep in "sync/stats" "sync/config"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $JWT" "http://localhost:5000/knowledge/$ep")
  echo "GET /knowledge/$ep → $code"
done

code=$(curl -s -o /dev/null -w "%{http_code}" -X PUT -H "Authorization: Bearer $JWT" -H "Cookie: csrf_token=t" -H "X-CSRF-Token: t" -H "content-type: application/json" -d '{"enabled":true,"hour":6,"minute":0}' "http://localhost:5000/knowledge/sync/schedule")
echo "PUT /knowledge/sync/schedule → $code"

for path in "/backend/knowledge" "/backend/knowledge-sync"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:5050$path")
  echo "GET admin $path → $code"
done
```

All should return 200.

- [ ] **Step 2: Update memory**

Create `/root/.claude/projects/-var-www-html/memory/knowledge_sync_revival_2026-05-11.md`:

```markdown
---
name: Knowledge sync revival 2026-05-11
description: BRS + Publikasi auto-embed restored via xenova → retrieval_chunks. Boot-time daily scheduler (06:00 WIT default), 4 /knowledge/sync routes wired, state persisted to app_settings, status banner on /knowledge.
type: project
---
# Knowledge sync revival — 2026-05-11

> **Why:** The /backend/knowledge-sync admin page existed but every backend endpoint 404'd. The underlying knowledgeSync.service.js still called OpenAI generateEmbedding + wrote to dropped columns. Auto-indexing for BRS+Publikasi had been silent-dead since 2026-03-08.
>
> **How to apply:** Reference when extending auto-embed to other content types (datasource, pressrelease, indicator_meta — out of scope today).

## What changed
- knowledgeSync.indexSingleDocument ports to chunkText + processEmbeddings (existing migrated path; xenova → retrieval_chunks).
- New service: services/rag/knowledgeSyncScheduler.service.js (daily timer, WIT-aware).
- 4 routes on /knowledge/{sync,sync/stats,sync/config,sync/schedule}.
- Scheduler state persisted to app_settings:scheduler:knowledge-sync (enabled, hour, minute, lastRunAt, lastResult, history[]).
- Status banner on /backend/knowledge linking to /backend/knowledge-sync.

## Behaviors to remember
- `app_settings:scheduler:knowledge-sync` is the source of truth for schedule + last-result. PM2 reload doesn't lose state.
- In-memory `_runningFlag` prevents concurrent syncs; both manual POST and scheduler tick respect it.
- `runDailySyncTracked` is the wrapper that updates state; raw `runDailySync` is still exported for one-off scripts.
- Default schedule: 06:00 WIT daily. The page UI form persists changes via PUT /knowledge/sync/schedule, which restarts the scheduler.
- `MAX_NEW_PER_SYNC = 20` cap (in SYNC_CONFIG) prevents runaway runs; raise via code if BPS publishes a backlog.

## Out of scope (explicitly deferred)
- Datasource auto-embed on POST /datasources — separate plan.
- Pressrelease → retrieval_chunks indexing — design decision pending (new source_kind vs reuse 'knowledge_doc').
- indicator_meta auto re-index — `scripts/repack-indicator-meta.js` exists but unscheduled.
```

Add one-liner to MEMORY.md Active Plans. Mirror to `docs/memory/`.

- [ ] **Step 3: Update workspace doc**

Append to `docs/workspace/backend.md` change log:

```
| 2026-05-11 | BRS+Publikasi auto-sync revived via xenova → retrieval_chunks. Wired 4 /knowledge/sync routes the admin page already called; new knowledgeSyncScheduler.service.js fires runDailySyncTracked() at the WIT time persisted in app_settings; status banner on /backend/knowledge. Last auto-indexing was 2026-03-08; new auto-runs will populate retrieval_chunks at the daily schedule. Plan: docs/superpowers/plans/2026-05-11-knowledge-sync-revival.md | services/rag/{knowledgeSync,knowledgeSyncScheduler}.service.js, controllers/knowledge.controller.js, routes/knowledge.routes.js, server.js, admin/app/knowledge/page.tsx |
```

- [ ] **Step 4: Commit + push**

```bash
git add docs/memory/MEMORY.md docs/memory/knowledge_sync_revival_2026-05-11.md docs/workspace/backend.md docs/superpowers/plans/2026-05-11-knowledge-sync-revival.md
git commit --no-gpg-sign -m "docs(memory): knowledge sync revival 2026-05-11 closeout"
git push origin main
```

---

## Out of scope (explicitly deferred)

- **Auto-embed on new datasource POST** — When admin creates a new data_source via `/datasources`, nothing triggers `embedDatasource(id)`. Separate small plan because it touches the datasource controller + needs a "should I block on the embed or fire-and-forget?" decision. Not silent-broken today — admin can manually click "Embed" on `/backend/knowledge`. Tracking as future work.
- **Pressrelease → retrieval_chunks indexing** — `pullPressRelease` writes to `data_bps.pressrelease_kw_*` but never indexes into retrieval_chunks. Design decision pending: introduce a new `source_kind='pressrelease'` (cleaner) vs reuse `knowledge_doc` (less code). Separate plan.
- **indicator_meta auto re-index** — `scripts/repack-indicator-meta.js` exists for backfill but no scheduler runs it after metadata updates. Smallest of the three; could be a 10-line cron addition.
- **History UI rows** — current plan persists `history: [last 5 runs]` in app_settings. The page already renders `lastResult` but not the history array. Future tweak to show a small "previous runs" table.
- **PDF OCR fallback for image-only PDFs** — `extractTextFromUrl` has OCR plumbing but it's heavy and disabled here for runtime safety. If a BRS PDF is image-only, sync logs a warn + indexes the abstract only.

## Rollback notes

Each task is one commit; revert with `git revert <sha>`. Task 4 has the largest behavioral change (boot-time scheduler arming). If something misbehaves at 06:00 WIT, set `app_settings.scheduler:knowledge-sync.enabled = false` via `PUT /knowledge/sync/schedule {"enabled":false}` — no code revert needed, the scheduler reads from app_settings on every restart and on PUT.

## Risk register

| Risk | Mitigation |
|---|---|
| xenova warmup on first sync (~15-30s pipeline init) | Acceptable; runs daily once. Per-doc inference is ~100-300ms. |
| BPS API rate limit on `fetchBrsList` / `fetchPublicationList` | Existing `BATCH_DELAY_MS=1000` + `await sleep(200)` between pages already in place. |
| PDF extraction timeout (`PDF_TIMEOUT_MS=30000`) blocks per-doc embedding | Catch falls through to abstract-only; doc still gets a `knowledge_doc` row. |
| Concurrent runs: scheduler tick + manual POST | `_runningFlag` guard rejects the second. Controller returns 409. |
| Bad schedule input via PUT (e.g., hour=99) | Service-level validation: `hour 0-23, minute 0-59`. Invalid values silently ignored, existing value kept. |
| App_settings JSON gets corrupted | `loadState()` merges with `DEFAULT_STATE` so missing keys fall back. Replacing the row via SQL is a recoverable manual fix. |
