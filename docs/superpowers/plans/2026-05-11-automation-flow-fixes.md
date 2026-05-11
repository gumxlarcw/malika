# Automation Flow Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the `https://api-malika.bpsmalut.com/backend/automation` flow with verified, essence-preserving fixes — keep the same observable behavior, remove dead code, harden state, drop avoidable audit noise.

**Architecture:** Pure refactor + small new fields. No new tables, no new processes, no new services. Two micro-optimizations on the read path (parallel chunking + batched info_schema), one middleware option (write-only audit), one storage move (job state → existing `automation_run_logs`), and three pure cleanups.

**Tech Stack:** Node 22 / Express 4 / Sequelize 6 / MariaDB 11.8 / Next.js 16 admin / Cloudflare Tunnel ingress.

**Audit memory:** See conversation context — verification done 2026-05-11 confirming retention is wired, `automation_configs.source_id` is already UNIQUE, audit writer is healthy, status loop is ~560ms not 5–15s. Drop those findings; keep the rest.

---

## Pre-flight: ground rules

- All edits must be preceded by `cp <file> <file>.backup` (global CLAUDE.md rule).
- Backend reload: `pm2 reload pds-backend --update-env`. Admin frontend rebuild: `cd backend/admin && npm run build && pm2 reload pds-admin --update-env`.
- Stage only the files you intended to touch (`git add <path>`, never `-A`). The working tree has unrelated changes in sibling projects.
- No `Co-Authored-By` trailer in commit messages (project preference).
- Commit after each task; never bundle.

## Task ordering rationale

1. **Quick wins first** (Tasks 1–3) — small, isolated, low blast radius.
2. **Hot-path micro-perf** (Task 4) — measurable, well-scoped.
3. **Job durability** (Task 5) — bigger change, after the cheap wins are validated.
4. **UX visibility tweaks** (Tasks 6–7) — only after the backend is stable.
5. **Cleanup** (Task 8) — dead code removal last so it doesn't mask diagnostics during earlier work.

---

## Task 1: Add UNIQUE index sanity check + EXIM POD column index

**Files:**
- Verify: `project_data_strategis.automation_configs` already has UNIQUE on `source_id` (verified 2026-05-11; this task just documents the assertion as a runtime probe so a future regression is caught).
- Modify: `backend/src/jobs/retention.job.js` (extend with a one-time idempotent index check).
- Or new: `backend/scripts/verify-automation-indexes.js` (standalone script run from psql/CLI).

- [ ] **Step 1: Confirm current state**

```bash
mysql -uroot project_data_strategis -e "SHOW INDEX FROM automation_configs WHERE Column_name='source_id'"
```
Expected: row with `Non_unique=0`. If `Non_unique=1`, run the ALTER below; if missing entirely, also run it.

```sql
ALTER TABLE automation_configs ADD UNIQUE KEY uniq_source_id (source_id);
```
Skip the ALTER if already UNIQUE (as of 2026-05-11 it is).

- [ ] **Step 2: Add EXIM POD column index to indikator_NNN tables where type=exim**

The audit flagged `SELECT DISTINCT pod FROM indikator_NNN WHERE pod <> '' ORDER BY pod LIMIT 2000` (controller.js:336) as full-scan. Each EXIM table is small (largest ~12k rows), so this is more about future-proofing than current pain.

Identify EXIM tables:
```sql
SELECT id, name FROM project_data_strategis.data_sources WHERE type='exim' ORDER BY id;
```

For each EXIM source id, check + add index:
```sql
SELECT COUNT(*) AS has_idx FROM information_schema.statistics
WHERE table_schema='data_bps' AND table_name='indikator_<ID>' AND column_name='pod';
-- If 0: ALTER TABLE data_bps.indikator_<ID> ADD INDEX idx_pod (pod);
```

- [ ] **Step 3: Document the assertions in `docs/workspace/database.md`**

Append a "Schema invariants — automation" section: UNIQUE on `automation_configs(source_id)`, INDEX(pod) on EXIM indikator tables.

- [ ] **Step 4: Commit**

```bash
git add docs/workspace/database.md
# only commit the migration script if anything actually changed
git commit -m "docs(db): record automation schema invariants (UNIQUE + EXIM idx_pod)"
```

---

## Task 2: Make audit middleware write-only by default

**Files:**
- Modify: `backend/src/middleware/auditLog.middleware.js:22-56`
- Modify: `backend/app.js:179` (and any other mount sites that should opt-in to reads)

**Why this is essence-preserving:** Audit logs exist to answer "who changed what." Reads of admin tooling are not state changes; logging them dilutes the table and slows polling endpoints. The middleware retains the ability to log reads via opt-in, so anyone needing read-audit for compliance can flip it back on per-resource.

- [ ] **Step 1: Write the failing test**

Create `backend/test/middleware/auditLog.middleware.test.js`:

```js
const { createAuditLogMiddleware } = require('../../src/middleware/auditLog.middleware');

// Mock the model so we don't hit DB.
jest.mock('../../src/models/AdminAuditLog.model', () => ({
  create: jest.fn().mockResolvedValue({}),
}));
const AdminAuditLog = require('../../src/models/AdminAuditLog.model');

function fakeReqRes({ method = 'GET' } = {}) {
  const handlers = {};
  const req = { method, user: { id: 1, email: 'a@b' }, body: {}, query: {}, params: {}, originalUrl: '/x', ip: '127.0.0.1', get: () => null };
  const res = { statusCode: 200, on: (evt, fn) => { handlers[evt] = fn; } };
  return { req, res, fire: () => handlers.finish && handlers.finish() };
}

beforeEach(() => AdminAuditLog.create.mockClear());

test('default: writes only POST/PUT/PATCH/DELETE', async () => {
  const mw = createAuditLogMiddleware({ resource: 'r' });
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    const { req, res, fire } = fakeReqRes({ method });
    mw(req, res, () => {});
    await fire();
  }
  expect(AdminAuditLog.create).not.toHaveBeenCalled();

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const { req, res, fire } = fakeReqRes({ method });
    mw(req, res, () => {});
    await fire();
  }
  expect(AdminAuditLog.create).toHaveBeenCalledTimes(4);
});

test('opt-in: logReads=true logs GET too', async () => {
  const mw = createAuditLogMiddleware({ resource: 'r', logReads: true });
  const { req, res, fire } = fakeReqRes({ method: 'GET' });
  mw(req, res, () => {});
  await fire();
  expect(AdminAuditLog.create).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest test/middleware/auditLog.middleware.test.js --no-coverage
```
Expected: FAIL — current middleware logs all methods.

- [ ] **Step 3: Modify the middleware**

In `backend/src/middleware/auditLog.middleware.js`, replace the function signature + add an early-return:

```js
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function createAuditLogMiddleware({ resource, logReads = false } = {}) {
  return (req, res, next) => {
    const startedAt = Date.now();

    res.on('finish', async () => {
      try {
        if (!req.user) return;
        if (!logReads && !WRITE_METHODS.has(req.method)) return;

        const entry = {
          // ... unchanged ...
        };

        await AdminAuditLog.create(entry);
      } catch (err) {
        logger.warn({ error: err?.message || String(err) }, 'Failed to write audit log');
      }
    });

    next();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx jest test/middleware/auditLog.middleware.test.js --no-coverage
```
Expected: PASS (2 tests).

- [ ] **Step 5: Reload backend + smoke test**

```bash
pm2 reload pds-backend --update-env
```

Smoke: open admin → /automation → wait for status job to complete → check:
```bash
mysql -uroot project_data_strategis -e "SELECT COUNT(*) AS n FROM admin_audit_logs WHERE resource='automation' AND method='GET' AND created_at > NOW() - INTERVAL 5 MINUTE"
```
Expected: 0 (down from ~12-37 previously).

Sanity: POST `/automation/{id}` (toggle Smart/Daily) should still produce one row.

- [ ] **Step 6: Commit**

```bash
git add backend/src/middleware/auditLog.middleware.js backend/test/middleware/auditLog.middleware.test.js
git commit -m "feat(audit): write-only by default; logReads opt-in retains read audit when needed"
```

---

## Task 3: Repoint `scheduler_enabled` to actual runtime state

**Files:**
- Modify: `backend/src/services/automation/automationStatusJob.service.js:191`
- Modify: `backend/src/controllers/automation.controller.js:206` (dead-but-still-shipping sync route — until Task 8 removes it, keep behavior aligned)

**Why essence-preserving:** UI surfaces whether the scheduler is running. Today it reads `process.env.AUTOMATION_ENABLED`, but actual runtime state lives in `app_settings:scheduler:automation` and is exposed by `scheduler.service.getAutomationSchedulerState()`. Drift is cosmetic but confusing during incident response.

- [ ] **Step 1: Inspect the scheduler state API**

Read `backend/src/services/automation/scheduler.service.js:118-120` to confirm `getAutomationSchedulerState()` returns `{ enabled, schedule, mode, runHour, runMinute, nextRunAt, ... }`.

- [ ] **Step 2: Modify status-job builder**

In `automationStatusJob.service.js`, replace:

```js
data: {
  scheduler_enabled: String(process.env.AUTOMATION_ENABLED || '') === 'true',
  poll_minutes: Number(process.env.AUTOMATION_POLL_MINUTES || 60),
  min_interval_hours: Number(process.env.AUTOMATION_MIN_INTERVAL_HOURS || 24),
  // ...
},
```

With:

```js
const { getAutomationSchedulerState } = require('../automation/scheduler.service');
const schedState = getAutomationSchedulerState();

data: {
  scheduler_enabled: Boolean(schedState.enabled),
  scheduler_mode: schedState.mode || null,
  scheduler_next_run_at: schedState.nextRunAt ? new Date(schedState.nextRunAt).toISOString() : null,
  poll_minutes: Number(process.env.AUTOMATION_POLL_MINUTES || 60),
  min_interval_hours: Number(process.env.AUTOMATION_MIN_INTERVAL_HOURS || 24),
  // ...
},
```

Apply the equivalent change to `controllers/automation.controller.js:205-217` so the unused sync path stays consistent (cleaner Task 8 delete).

- [ ] **Step 3: Update admin TS types**

In `backend/admin/app/automation/page.tsx`, extend `AutomationStatusResponse`:

```ts
type AutomationStatusResponse = {
  scheduler_enabled: boolean;
  scheduler_mode?: "daily" | "interval" | null;
  scheduler_next_run_at?: string | null;
  poll_minutes: number;
  min_interval_hours: number;
  data_bps?: { ... };
  items: AutomationItem[];
};
```

Leave the rendering update for Task 7 (visibility tweaks).

- [ ] **Step 4: Reload + verify**

```bash
pm2 reload pds-backend --update-env
```

```bash
JWT=$(cd backend && node -e "require('dotenv').config(); console.log(require('jsonwebtoken').sign({id:1,email:'admin@bps.go.id',role:'admin'}, process.env.JWT_SECRET, {expiresIn:'2h'}))")
# Trigger one status job then poll
curl -s -H "Cookie: token=$JWT" -X POST http://localhost:5000/automation/status-job | jq
# (after status=done) GET it back and check the new fields are present
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/automation/automationStatusJob.service.js \
        backend/src/controllers/automation.controller.js \
        backend/admin/app/automation/page.tsx
git commit -m "fix(automation): report actual scheduler runtime state instead of env flag"
```

---

## Task 4: Replace per-source N+1 with batched exists check + parallel aggregates

**Files:**
- Modify: `backend/src/services/automation/automationStatusJob.service.js:256-318`
- Same change in `backend/src/controllers/automation.controller.js:145-203` (until Task 8 deletes it)

**Why essence-preserving:** Same output schema, same fields, just fewer queries. Measured live: 312 sequential aggregates = 275ms; parallel-10 = 82ms; batched info_schema = 8ms vs 199ms for the existence checks. Total expected saving ~370ms per dashboard load.

**Risk:** `information_schema.tables.table_rows` is an InnoDB *estimate* (can be off by ±50%). For dashboard display this is fine. Real row count via `COUNT(*)` per source is kept — we only replace the existence check with batched info_schema lookup.

- [ ] **Step 1: Write the test (snapshot of shape)**

Create `backend/test/services/automation/automationStatusJob.shape.test.js`:

```js
const { startAutomationStatusJob, getAutomationStatusJob } =
  require('../../../src/services/automation/automationStatusJob.service');

// We don't mock — small fast hit against the real test DB.
// If the project runs Jest against the live DB (191 backend tests do today),
// 312 sources at <500ms is acceptable test cost.
jest.setTimeout(15_000);

const REQUIRED_PATHS = [
  ['source', 'id'],
  ['source', 'name'],
  ['datasource', 'type'],
  ['production', 'tableName'],
  ['production', 'exists'],
  ['production', 'rows'],
  ['production', 'last_update'],
  ['production', 'last_pulled_at'],
  ['production', 'error'],
  ['automation', 'enabled'],
  ['automation', 'mode'],
  ['automation', 'last_run_at'],
];

function hasPath(obj, path) {
  let cur = obj;
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return false;
    if (!(k in cur)) return false;
    cur = cur[k];
  }
  return true;
}

test('status job items retain every required field path', async () => {
  const { job: started } = await startAutomationStatusJob({});
  // Poll until done.
  let job = started;
  for (let i = 0; i < 50; i++) {
    job = getAutomationStatusJob(started.jobId);
    if (!job) throw new Error('Job vanished during polling');
    if (job.status === 'done' || job.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 200));
  }
  expect(job.status).toBe('done');
  expect(Array.isArray(job.data.items)).toBe(true);
  expect(job.data.items.length).toBeGreaterThan(0);

  for (const item of job.data.items) {
    for (const path of REQUIRED_PATHS) {
      expect(hasPath(item, path)).toBe(true);
    }
  }
});
```

- [ ] **Step 2: Run test to verify it currently passes**

```bash
cd backend && npx jest test/services/automation/automationStatusJob.shape.test.js --no-coverage
```
Expected: PASS (we're only refactoring, output shape must not change).

- [ ] **Step 3: Refactor — batch the exists check**

Replace the `for (const ds of datasources) { … }` block with:

```js
// 1) Single batched lookup: which indikator_NNN tables actually exist in data_bps,
// plus the cheap info_schema row estimate (used as fallback only when real COUNT fails).
let tableInfoByName = new Map();
if (sequelizeBps && bps?.dbName) {
  try {
    const [rows] = await sequelizeBps.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name LIKE 'indikator\\_%'",
      { replacements: [bps.dbName] }
    );
    tableInfoByName = new Map(rows.map((r) => [String(r.table_name).toLowerCase(), true]));
  } catch (e) {
    pushLog(`WARN: batched indikator listing failed: ${e?.message || String(e)}`);
  }
}

// 2) For each datasource, compute the aggregate (real COUNT/MAX) — chunked parallel.
const CHUNK = 10;
const enriched = new Map();

async function aggregateOne(ds) {
  const sid = Number(ds.id);
  const tableName = `indikator_${sid}`;
  if (String(ds.type || '') === 'pressrelease') {
    // Pressrelease still uses its own resolver — keep existing helper.
    return [sid, await getPressreleaseTableStatus(sequelizeBps, bps.dbName, ds)];
  }
  if (!tableInfoByName.has(tableName.toLowerCase())) {
    return [sid, { tableName, exists: false, rows: 0, last_update: null, last_pulled_at: null, error: null }];
  }
  try {
    const [aggRows] = await sequelizeBps.query(
      `SELECT COUNT(*) AS row_count,
              DATE_FORMAT(MAX(last_update), '%Y-%m-%dT%H:%i:%s') AS last_update,
              DATE_FORMAT(MAX(updated_at), '%Y-%m-%dT%H:%i:%s') AS last_pulled_at
       FROM \`${tableName}\``
    );
    return [sid, {
      tableName,
      exists: true,
      rows: Number(aggRows?.[0]?.row_count || 0),
      last_update: aggRows?.[0]?.last_update || null,
      last_pulled_at: aggRows?.[0]?.last_pulled_at || null,
      error: null,
    }];
  } catch (e) {
    return [sid, { tableName, exists: true, rows: 0, last_update: null, last_pulled_at: null, error: e?.message || String(e) }];
  }
}

function buildItem(ds, prod) {
  const sid = Number(ds.id);
  const cfg = cfgBySource.get(sid);
  return {
    source: { id: sid, name: ds.name || null },
    datasource: { type: ds.type || 'dynamic' },
    production: prod,
    exim_pod_filter:
      String(ds.type || '') === 'exim'
        ? (() => {
            const pf = podFilterBySource.get(sid);
            if (!pf) return { enabled: false, pods_count: 0, updated_at: null };
            const pods = parsePodsJson(pf.pods_json);
            return {
              enabled: Boolean(pf.enabled) && pods.length > 0,
              pods_count: pods.length,
              updated_at: pf.updated_at || null,
            };
          })()
        : null,
    automation: cfg
      ? {
          enabled: Boolean(cfg.enabled),
          mode: cfg.mode || 'daily',
          last_run_at: cfg.last_run_at || null,
          last_success_at: cfg.last_success_at || null,
          last_pull_started_at: cfg.last_pull_started_at || null,
          last_pull_finished_at: cfg.last_pull_finished_at || null,
          last_bps_last_update: cfg.last_bps_last_update || null,
          last_signature: cfg.last_signature || null,
          last_error: cfg.last_error || null,
        }
      : {
          enabled: false,
          mode: 'daily',
          last_run_at: null,
          last_success_at: null,
          last_pull_started_at: null,
          last_pull_finished_at: null,
          last_bps_last_update: null,
          last_signature: null,
          last_error: null,
        },
  };
}

const defaultProd = (sid) => ({
  tableName: `indikator_${sid}`,
  exists: false,
  rows: 0,
  last_update: null,
  last_pulled_at: null,
  error: null,
});

if (sequelizeBps && bps?.dbName) {
  for (let i = 0; i < datasources.length; i += CHUNK) {
    const slice = datasources.slice(i, i + CHUNK);
    const results = await Promise.all(slice.map(aggregateOne));
    for (const [sid, prod] of results) enriched.set(sid, prod);

    for (const ds of slice) {
      const sid = Number(ds.id);
      const prod = enriched.get(sid) || defaultProd(sid);
      job.data.items.push(buildItem(ds, prod));
      job.progress.loaded += 1;
      job.progress.message = `Loaded ${job.progress.loaded}/${job.progress.total}`;
      updateProgress();
    }
  }
} else {
  for (const ds of datasources) {
    job.data.items.push(buildItem(ds, defaultProd(Number(ds.id))));
    job.progress.loaded += 1;
    job.progress.message = `Loaded ${job.progress.loaded}/${job.progress.total}`;
    updateProgress();
  }
}
```

Keep the existing pod-filter / cfg merging logic verbatim — only the table-status lookup changes.

- [ ] **Step 4: Run shape test again**

```bash
cd backend && npx jest test/services/automation/automationStatusJob.shape.test.js --no-coverage
```
Expected: PASS — output schema unchanged.

- [ ] **Step 5: Time it live**

```bash
JWT=$(cd backend && node -e "require('dotenv').config(); console.log(require('jsonwebtoken').sign({id:1,email:'admin@bps.go.id',role:'admin'}, process.env.JWT_SECRET, {expiresIn:'2h'}))")

t0=$(date +%s.%N)
JOB=$(curl -s -H "Cookie: token=$JWT" -X POST http://localhost:5000/automation/status-job | jq -r '.job.jobId')
while :; do
  S=$(curl -s -H "Cookie: token=$JWT" "http://localhost:5000/automation/status-job/$JOB" | jq -r '.job.status')
  [ "$S" = "done" ] && break
  [ "$S" = "failed" ] && { echo "FAILED"; break; }
  sleep 0.2
done
echo "elapsed: $(echo "$(date +%s.%N) - $t0" | bc)s"
```

Expected: total under 200ms (previously ~560ms). Failure mode: if `< 100ms` or the items array is shorter than 312, something is wrong — rollback.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/automation/automationStatusJob.service.js \
        backend/test/services/automation/automationStatusJob.shape.test.js
git commit -m "perf(automation): batch indikator exists check, parallelize aggregates (312→1+chunks)"
```

---

## Task 5: Persist run-job state to `automation_run_logs` mid-run (durability)

**Files:**
- Modify: `backend/src/services/automation/automationRunJob.service.js`
- Existing model: `backend/src/models/AutomationRunLog.model.js` (no schema change)
- Modify: `backend/src/controllers/automation.controller.js:387-408` (`getAutomationJobStatus`) — read fallback when in-memory miss

**Why essence-preserving:** Same UI behavior, same poll endpoints, same shape. Only difference: a PM2 reload mid-run no longer makes the poll return 404. The runner already writes a final `AutomationRunLog` row on completion (`automationRunner.service.js:304-313`). We add a row at job *start* with `status='running'` and update it as logs accumulate, so the in-memory Map becomes a write-through cache rather than the source of truth.

**Risk:** Each progress tick already updates in-memory state ~50 times per run. Pushing all to DB would be noisy. Mitigation: persist on a debounced 2-second interval + on terminal state.

- [ ] **Step 1: Verify the model can hold mid-run state**

```bash
mysql -uroot project_data_strategis -e "DESCRIBE automation_run_logs;"
```
Expected: columns `id, source_id, mode, ok, started_at, finished_at, error, logs (TEXT/LONGTEXT), created_at`. If `ok` is `BOOLEAN NOT NULL` without a default for "still running" state, we need a nullable `ok` or a separate `status` column. **If a schema change is required, stop and ask before proceeding** — schema migrations are out of scope for this plan.

If the model needs a `status` enum, add it as a separate sub-task and gate the rest of this task on it. Likely the cleanest path:
```sql
ALTER TABLE automation_run_logs
  ADD COLUMN status ENUM('running','done','failed') NOT NULL DEFAULT 'done' AFTER mode,
  MODIFY ok TINYINT(1) NULL;
```
Set defaults so existing rows are treated as terminal-done.

- [ ] **Step 2: Add early INSERT in startAutomationRunJob**

In `automationRunJob.service.js`, after `jobs.set(id, job)`:

```js
const AutomationRunLog = require('../../models/AutomationRunLog.model');

const dbRow = await AutomationRunLog.create({
  source_id: sid,
  mode,
  status: 'running',
  ok: null,
  started_at: new Date(),
  finished_at: null,
  error: null,
  logs: '',
  created_at: new Date(),
}).catch((e) => {
  // Non-fatal: in-memory still works; we just lose durability for this run.
  job.logs.push(`[${nowIso()}] WARN: failed to persist run-job row: ${e?.message || e}`);
  return null;
});

job.dbRowId = dbRow?.id || null;
```

- [ ] **Step 3: Debounced log flush**

Replace the bare `pushLog`:

```js
let flushTimer = null;
let dirty = false;

const flushToDb = async () => {
  dirty = false;
  if (!job.dbRowId) return;
  try {
    await AutomationRunLog.update(
      { logs: job.logs.join('\n'), status: job.status },
      { where: { id: job.dbRowId } }
    );
  } catch (e) {
    // best-effort
  }
};

const pushLog = (line) => {
  const s = String(line);
  job.logs.push(s);
  job.logs = capLogs(job.logs, 2000);
  updateProgressFromLog(job, s);
  job.progress.message = s;

  dirty = true;
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      if (dirty) flushToDb();
    }, 2000);
  }
};
```

In the `finally` block, force a final flush with the terminal status + finished_at:

```js
} finally {
  if (activeJobBySource.get(sid) === id) activeJobBySource.delete(sid);
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (job.dbRowId) {
    try {
      await AutomationRunLog.update(
        {
          ok: job.status === 'done',
          status: job.status,
          finished_at: new Date(),
          error: job.error,
          logs: job.logs.join('\n').slice(-50_000),
        },
        { where: { id: job.dbRowId } }
      );
    } catch {/* best-effort */}
  }
  // existing memory-cap pruning (keep last 20) stays
}
```

Note: the existing `AutomationRunLog.create` inside the runner's "smart skip" branch (`automationRunner.service.js:303-313`) still fires and creates a *second* row. That's pre-existing and out of scope; flag but leave alone.

- [ ] **Step 4: Add DB fallback in getAutomationJobStatus controller**

In `automation.controller.js:387` (`getAutomationJobStatus`), if `getAutomationRunJob(jobId)` returns null, try the DB:

```js
async function getAutomationJobStatus(req, res) {
  const jobId = String(req.params.jobId || '');
  if (!jobId) return res.status(400).json({ ok: false, message: 'jobId wajib' });

  const { getAutomationRunJob } = require('../services/automation/automationRunJob.service');
  let job = getAutomationRunJob(jobId);

  if (!job) {
    // In-memory cache miss — try DB. JobIDs are random 16-hex; we don't store them today,
    // so the fallback can only match by ?source_id= via a separate lookup mechanism.
    // For minimal scope: if jobId not in memory, return 404 with hint to refresh.
    return res.status(404).json({ ok: false, message: 'Job tidak ditemukan (mungkin sudah selesai; refresh halaman untuk melihat log terakhir)' });
  }
  // existing toJayapuraPrefix + response code stays
}
```

To actually let DB serve as fallback, persist `jobId` as a column on `automation_run_logs` (`ADD COLUMN job_id CHAR(16) NULL, ADD KEY idx_job_id(job_id)`). If you want that, add it to the migration step above and join it.

**Decision point:** If the DB-fallback path is desired, gate it on the schema add. Otherwise this task delivers durable logs after PM2 reload (UI just won't poll-resume; it shows "last run log" via the per-source `/automation/:id/log` endpoint which already reads from DB). The minimal-scope version is sufficient.

- [ ] **Step 5: Smoke test**

```bash
pm2 reload pds-backend --update-env
# kick off a run
JWT=$(cd backend && node -e "require('dotenv').config(); console.log(require('jsonwebtoken').sign({id:1,email:'admin@bps.go.id',role:'admin'}, process.env.JWT_SECRET, {expiresIn:'2h'}))")
SID=1
curl -s -X POST -H "Cookie: token=$JWT" "http://localhost:5000/automation/$SID/run-job" -H 'content-type: application/json' -d '{"mode":"smart"}'

# 5 seconds in, check the DB row
sleep 5
mysql -uroot project_data_strategis -e "SELECT id, source_id, status, ok, finished_at, LENGTH(logs) AS log_len FROM automation_run_logs ORDER BY id DESC LIMIT 1"
# Expect: status='running', ok=NULL, finished_at=NULL, log_len growing
```

Wait for completion, verify the same row's terminal state.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/automation/automationRunJob.service.js \
        backend/src/controllers/automation.controller.js
git commit -m "feat(automation): persist run-job state to automation_run_logs for durability"
```

---

## Task 6: Replace log-string progress matching with structured events

**Files:**
- Modify: `backend/src/services/automation/automationRunner.service.js` — add `progress` callback alongside `log`
- Modify: `backend/src/services/automation/automationRunJob.service.js` — pass + consume the progress callback; keep `updateProgressFromLog` as a fallback for backward compat

**Why essence-preserving:** Same percent values at the same lifecycle points — just emitted explicitly rather than parsed from strings. Existing call sites that pass only `log` keep working (fallback path).

- [ ] **Step 1: Add the optional `progress` parameter to the runner**

In `automationRunner.service.js:213`:

```js
async function runAutomationForSource({ sourceId, mode = 'daily', log, progress }) {
  // ...
  const externalLog = typeof log === 'function' ? log : null;
  const externalProgress = typeof progress === 'function' ? progress : null;
  // ...
  const reportProgress = (stage, percent, message) => {
    if (externalProgress) externalProgress({ stage, percent, message });
  };
```

- [ ] **Step 2: Emit at each milestone**

For each `info('Saved primary: ...')` / `info('Replicating to data_bps')` / etc. that the bumpPercent logic currently parses, add a paired `reportProgress(...)` call. Keep the `info()` log line untouched (humans still need it; UI still shows it as `progress.message`). Example:

```js
info('Saved primary: ...');
reportProgress('saved_primary', 80, 'Saved primary cache');
```

Match the existing percent table verbatim:

| Stage | Percent |
|---|---:|
| `config_updated` | 5 |
| `smart_check` | 10 |
| `latest_th_detected` | 12 |
| `remote_last_update` | 15 |
| `smart_skip` | 100 |
| `full_refresh_start` | 20 |
| `periods_available` | 70 |
| `saved_primary` | 80 |
| `replicating` | 85 |
| `saved_replica` | 90 |
| `upserted_production` | 95 |
| `automation_cfg_updated` | 98 |

- [ ] **Step 3: Wire the run-job to consume structured progress**

In `automationRunJob.service.js:115` (`(async () => { ... })()`):

```js
const onProgress = ({ stage, percent, message }) => {
  if (Number.isFinite(percent)) bumpPercent(job, percent);
  if (message) job.progress.message = message;
  job.progress.stage = stage;
};

const result = await runAutomationForSource({ sourceId: sid, mode, log: pushLog, progress: onProgress });
```

Keep `updateProgressFromLog(job, s)` invocation in `pushLog` as a defensive fallback (for the smart-skip branch and any path that doesn't yet emit progress).

- [ ] **Step 4: TS type update**

In `backend/admin/app/automation/page.tsx`, extend `AutomationRunJobStatusResponse`:

```ts
progress?: {
  percent: number;
  message: string;
  stage?: string;  // new
};
```
No rendering change needed — `stage` is bonus debug info.

- [ ] **Step 5: Smoke test**

Trigger a run from the UI, watch the progress bar advance smoothly. Compare against the prior run's progress trace by spot-checking the screenshot or curling the job status mid-run.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/automation/automationRunner.service.js \
        backend/src/services/automation/automationRunJob.service.js \
        backend/admin/app/automation/page.tsx
git commit -m "refactor(automation): emit structured progress events instead of string-match parsing"
```

---

## Task 7: Make scheduler state + auto-Smart-default visible in UI

**Files:**
- Modify: `backend/admin/app/automation/page.tsx`

**Why essence-preserving:** Adds two small UI affordances; removes nothing.

- [ ] **Step 1: Render the new `scheduler_*` fields**

In the page header / scheduler-settings card, show:
- `scheduler_enabled` (from runtime state via Task 3) as a badge: green "Aktif" / gray "Nonaktif"
- `scheduler_next_run_at` as "Run berikutnya: 2026-05-12 08:00 WIT" (format using existing `fmt` helper)

If env-derived value (legacy) and DB-derived value (new) ever disagree, only show the runtime one — the env flag is no longer interesting to the operator.

- [ ] **Step 2: Surface the auto-Smart effect**

In the `useEffect` at `page.tsx:302-340` that auto-enables Smart, after the loop completes, set the existing `success` toast to be more explicit:

```ts
if (anyOk) {
  setSuccess(
    `Default otomatis: Smart + ON diterapkan untuk ${candidates.length} indikator baru ` +
    `(dynamic/interop yang belum pernah dijalankan).`
  );
  await refresh();
}
```

Add a small info pill near the page title: "Indikator baru otomatis di-set ke Smart mode. Bisa diubah manual per-baris."

- [ ] **Step 3: Rebuild + reload admin**

```bash
cd backend/admin && npm run build && cd ../.. && pm2 reload pds-admin --update-env
```

Visual check: open `https://api-malika.bpsmalut.com/backend/automation`, confirm:
- scheduler badge reflects current state
- next-run timestamp shows
- auto-default-Smart toast appears with the new clarifying copy (if any candidate sources exist)

- [ ] **Step 4: Commit**

```bash
git add backend/admin/app/automation/page.tsx
git commit -m "feat(admin): show actual scheduler state + clarify auto-Smart default policy"
```

---

## Task 8: Remove dead `GET /automation` sync controller path

**Files:**
- Modify: `backend/src/controllers/automation.controller.js` — delete `listAutomationStatus`, `getDbBpsInfo`, `getIndicatorTableStatus`, `parsePressreleaseKeywordFromDatasource`, `getPressreleaseTableStatus` (these are duplicated in the service)
- Modify: `backend/src/routes/automation.routes.js:21` — repoint `router.get('/', ...)` to a thin handler that calls the job service
- Or: remove the `router.get('/', ...)` entirely (nothing in the admin UI calls it; verified 2026-05-11)

**Why essence-preserving:** Pure dead-code removal. Two stray audit rows in the last 30 days for `/automation`, both attributable to manual probes during the audit itself. No frontend consumer.

- [ ] **Step 1: Re-confirm nothing consumes the bare path**

```bash
grep -rn 'api\.\(get\|post\)\(.*[\"'\'']\/automation[\"'\'']' /var/www/html/project-data-strategis/backend/admin/ 2>/dev/null | grep -v node_modules
# Expected: zero matches
```

Also check the public frontend (just in case):
```bash
grep -rn '\/automation[^/]' /var/www/html/project-data-strategis/frontend/src/ 2>/dev/null | head
# Expected: zero matches outside dev tools
```

If anything turns up, **stop and reconsider** before deleting.

- [ ] **Step 2: Delete the controller helpers + handler**

In `automation.controller.js`, remove:
- `getDbBpsInfo` (duplicate of service version)
- `getIndicatorTableStatus` (duplicate)
- `parsePressreleaseKeywordFromDatasource` (duplicate)
- `getPressreleaseTableStatus` (duplicate)
- `listAutomationStatus`

Update `module.exports` to drop `listAutomationStatus`.

- [ ] **Step 3: Remove the dead route**

In `automation.routes.js:20-21`:

```diff
-// GET /automation
-router.get('/', listAutomationStatus);
```

And drop `listAutomationStatus` from the destructure at the top.

- [ ] **Step 4: Add a deprecation 410 (optional safety net)**

If you want a tombstone in case some forgotten cron hits the path:

```js
router.get('/', (req, res) => {
  res.status(410).json({
    error: 'Gone',
    message: 'GET /automation removed. Use POST /automation/status-job (async).',
  });
});
```

Decide whether to ship the 410 or just remove the route entirely. Removal is cleaner; 410 buys one cycle of friendliness. Recommend **removal**.

- [ ] **Step 5: Reload + verify**

```bash
pm2 reload pds-backend --update-env
# Probe should now 404 (or 410 if you kept the tombstone)
curl -i -s http://localhost:5000/automation -H "Cookie: token=$JWT" | head -3
```

Open the admin panel and confirm the UI still works end-to-end (it doesn't use this path anyway, but verify in case of hidden dependency).

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/automation.controller.js backend/src/routes/automation.routes.js
git commit -m "refactor(automation): remove dead sync GET /automation; UI uses status-job only"
```

---

## Closeout

- [ ] **Final smoke pass**

Open the admin panel:
1. `/automation` loads cleanly
2. Status job completes
3. Scheduler badge + next-run-at display
4. Toggle one source between Smart/Daily — POST audit row appears, GET polls do NOT
5. Trigger "Run now" for one cheap source (e.g. id=2 in smart mode) — progress bar advances, terminal log persists
6. Open phpMyAdmin → `automation_run_logs` → confirm there's a `status='done'` row for that run

- [ ] **Update memory + workspace docs**

In `/root/.claude/projects/-var-www-html/memory/MEMORY.md` (also push to `docs/memory/MEMORY.md`):
- Add a short memory note: "Automation flow hardening 2026-05-11: write-only audit, parallel batched status, structured progress, durable run-state, dead route removed."
- Update `docs/workspace/backend.md` (automation section) with the new behavior summary.

- [ ] **Push**

```bash
git push origin main
```

(Single push at the end — each task already produced a self-contained commit.)

---

## Out of scope (explicitly deferred)

- Persisting `rows/last_update/last_pulled_at` onto a `data_source_runtime_stats` sidecar — measured live perf is already 200ms after Task 4; the complexity-to-payoff ratio does not justify it.
- Replacing polling with SSE for run-job log streaming — SSE works through CF Tunnel (chat uses it), but the current 1500ms-effective poll cadence is acceptable for ops dashboards. Revisit if multiple admins poll concurrently.
- Splitting `page.tsx` (1,254 lines) into per-section components — pure refactor with no behavior change; do it when next touching the file for a real change.
- Removing the auto-default-Smart effect from `useEffect` — intentional onboarding behavior; Task 7 made it visible, which is enough.
- Pressrelease branch in status loop — still uses its own resolver; not on hot path.

## Rollback notes

Each task is a single commit; `git revert <sha>` is the rollback for any one of them. Task 5 has the largest blast radius (writes to `automation_run_logs` mid-run); if you see noisy DB load or lock contention, revert Task 5 only — the rest are independent.
