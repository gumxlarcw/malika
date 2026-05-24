# Halaman Admin "Status WebAPI BPS" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bangun halaman admin `/webapi-bps-status` yang menampilkan kesehatan akses WebAPI BPS, dengan probe 4 endpoint sentinel tiap 15 menit + tombol probe manual + dashboard pasif + log berurutan.

**Architecture:** Backend service `webapiBpsHealth/` (probeTargets + probe + scheduler) menulis ke tabel baru `webapi_health_logs`; 4 endpoint REST (`/status`, `/history`, `/logs`, `POST /probe`) di-protect admin-only; frontend Next.js page memakai React Query polling 30dtk dengan komponen reusable existing (`StatCard`, `DataTable`, `OffsetPagination`).

**Tech Stack:**
- Backend: Node.js + Express 5 + Sequelize 6 + MariaDB 11.8 + Jest 29 (existing). `crypto.randomUUID()` untuk run_id (tidak ada `ulid` dep; tidak install baru).
- Frontend admin: Next.js 16 + React 19 + TypeScript 5 + React Query 5 + Vitest 1.6 + RTL (existing).
- Pola scheduler: sesuai `services/automation/scheduler.service.js` & `jobs/retention.job.js`.
- Pola route mount: di `backend/app.js`, sama dengan `logs.routes.js` line 195.

**Spec reference:** `docs/superpowers/specs/2026-05-24-webapi-bps-status-design.md`.

**Konvensi project (penting):**
- Backup before edit: `cp <file> <file>.backup` sebelum modifikasi.
- Read file dulu sebelum edit.
- Stage hanya file yang ditambah/diubah di task (jangan `git add -A`).
- **Jangan** tambah `Co-Authored-By` trailer.
- Backend reload setelah `.js` change: `pm2 reload pds-backend --update-env`.
- Admin reload setelah `.tsx`/`.ts` change: `cd backend/admin && npm run build && pm2 reload pds-admin --update-env`.

---

## File Map

**Create (18 file):**

Backend:
- `docs/runbook/2026-05-24-webapi-health-logs-ddl.sql` — DDL manual untuk tabel baru
- `backend/src/models/WebapiHealthLog.model.js` — Sequelize model
- `backend/src/services/webapiBpsHealth/probeTargets.js` — konstanta 4 endpoint sentinel
- `backend/src/services/webapiBpsHealth/probe.service.js` — runProbe + klasifikasi + mutex
- `backend/src/services/webapiBpsHealth/scheduler.service.js` — startWebapiBpsHealthScheduler
- `backend/src/routes/webapiBps.routes.js` — 4 endpoint REST
- `backend/src/__tests__/webapiBpsHealth.probe.test.js` — klasifikasi (6 case)
- `backend/src/__tests__/webapiBpsHealth.probe.mutex.test.js` — concurrency guard
- `backend/src/__tests__/webapiBpsHealth.probe.apikey.test.js` — apikey null path
- `backend/src/__tests__/webapiBps.routes.test.js` — happy path + auth

Frontend admin:
- `backend/admin/app/webapi-bps-status/types.ts` — TS types
- `backend/admin/app/webapi-bps-status/page.tsx` — entry
- `backend/admin/app/webapi-bps-status/_components/OverallStatusCard.tsx`
- `backend/admin/app/webapi-bps-status/_components/CircuitBreakerCard.tsx`
- `backend/admin/app/webapi-bps-status/_components/PerFamilyTable.tsx`
- `backend/admin/app/webapi-bps-status/_components/HistoryChart.tsx`
- `backend/admin/app/webapi-bps-status/_components/ProbeLogTable.tsx`
- `backend/admin/app/webapi-bps-status/_components/ProbeNowButton.tsx`
- `backend/admin/app/webapi-bps-status/__tests__/OverallStatusCard.test.tsx`
- `backend/admin/app/webapi-bps-status/__tests__/HistoryChart.test.tsx`
- `backend/admin/app/webapi-bps-status/__tests__/ProbeNowButton.test.tsx`

**Modify (5 file):**
- `backend/app.js` — mount route baru (after line 195)
- `backend/server.js` — register scheduler di array loader (line 155-165)
- `backend/src/jobs/retention.job.js` — tambah policy row (line 5-9 POLICIES)
- `backend/admin/components/Sidebar.tsx` — tambah link di group "Tools" (line 72-77 area)
- `docs/workspace/admin.md` — page count 27→28; tambah ke list "Tools"

**Spec deviation (catat di sini, bukan placeholder spec):**
- DB `run_id`: spec bilang `CHAR(26)` ULID. **Plan pakai `CHAR(36)` + `crypto.randomUUID()`** karena tidak ada `ulid` dep — menghindari install dependency baru. UUID v4 juga lexicographic-sortable tidak terjamin, jadi dashboard yang butuh sort harus `ORDER BY created_at, id` bukan `ORDER BY run_id`.

---

## Task 1: Buat & terapkan DDL `webapi_health_logs`

**Files:**
- Create: `docs/runbook/2026-05-24-webapi-health-logs-ddl.sql`

- [ ] **Step 1: Tulis DDL file**

Create `docs/runbook/2026-05-24-webapi-health-logs-ddl.sql`:

```sql
-- 2026-05-24: tabel untuk health-probe WebAPI BPS
-- Spec: docs/superpowers/specs/2026-05-24-webapi-bps-status-design.md §4.1
-- Run dengan: mysql -u <user> -p project_data_strategis < this_file.sql

CREATE TABLE IF NOT EXISTS webapi_health_logs (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  run_id          CHAR(36) NOT NULL,                          -- crypto.randomUUID()
  probe_kind      ENUM('scheduled','manual','recovery') NOT NULL,
  endpoint_family VARCHAR(32) NOT NULL,
  url_template    VARCHAR(255) NOT NULL,
  http_status     SMALLINT NULL,
  latency_ms      INT NULL,
  ok              TINYINT(1) NOT NULL,
  error_code      VARCHAR(64) NULL,
  error_message   VARCHAR(500) NULL,
  bytes_received  INT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_created (created_at),
  INDEX idx_family_created (endpoint_family, created_at),
  INDEX idx_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 2: Terapkan DDL ke DB**

Cek user DB di `backend/.env` (cari `DB_USER`, `DB_NAME`):
```bash
grep -E "^DB_" backend/.env
```

Lalu apply:
```bash
mysql -u <DB_USER> -p<DB_PASSWORD> <DB_NAME> < docs/runbook/2026-05-24-webapi-health-logs-ddl.sql
```

Verifikasi:
```bash
mysql -u <DB_USER> -p<DB_PASSWORD> <DB_NAME> -e "DESCRIBE webapi_health_logs;"
```

Expected: 12 kolom sesuai DDL.

- [ ] **Step 3: Commit**

```bash
git add docs/runbook/2026-05-24-webapi-health-logs-ddl.sql
git commit -m "feat(db): add webapi_health_logs table DDL"
```

---

## Task 2: Sequelize model `WebapiHealthLog`

**Files:**
- Create: `backend/src/models/WebapiHealthLog.model.js`
- Reference pattern: `backend/src/models/FetchLog.model.js`

- [ ] **Step 1: Tulis model**

Create `backend/src/models/WebapiHealthLog.model.js`:

```js
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const WebapiHealthLog = sequelize.define("WebapiHealthLog", {
  id:              { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  run_id:          { type: DataTypes.CHAR(36), allowNull: false },
  probe_kind:      { type: DataTypes.ENUM('scheduled','manual','recovery'), allowNull: false },
  endpoint_family: { type: DataTypes.STRING(32), allowNull: false },
  url_template:    { type: DataTypes.STRING(255), allowNull: false },
  http_status:     { type: DataTypes.SMALLINT, allowNull: true },
  latency_ms:      { type: DataTypes.INTEGER, allowNull: true },
  ok:              { type: DataTypes.TINYINT, allowNull: false },
  error_code:      { type: DataTypes.STRING(64), allowNull: true },
  error_message:   { type: DataTypes.STRING(500), allowNull: true },
  bytes_received:  { type: DataTypes.INTEGER, allowNull: true },
  created_at:      { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: "webapi_health_logs",
  timestamps: false,
  freezeTableName: true,
});

module.exports = WebapiHealthLog;
```

- [ ] **Step 2: Smoke test — model loads tanpa error**

Backup target file dulu (tidak ada karena baru — skip). Tambahkan test baru:

Create `backend/src/__tests__/webapiHealthLog.model.test.js`:

```js
describe('WebapiHealthLog model', () => {
  test('loads without throwing', () => {
    const M = require('../models/WebapiHealthLog.model');
    expect(M).toBeDefined();
    expect(M.tableName).toBe('webapi_health_logs');
  });

  test('has required fields', () => {
    const M = require('../models/WebapiHealthLog.model');
    const attrs = M.rawAttributes;
    expect(attrs.run_id).toBeDefined();
    expect(attrs.probe_kind).toBeDefined();
    expect(attrs.endpoint_family).toBeDefined();
    expect(attrs.ok).toBeDefined();
  });
});
```

- [ ] **Step 3: Jalankan test**

```bash
cd backend && npx jest src/__tests__/webapiHealthLog.model.test.js
```

Expected: 2 passed.

- [ ] **Step 4: Commit**

```bash
git add backend/src/models/WebapiHealthLog.model.js backend/src/__tests__/webapiHealthLog.model.test.js
git commit -m "feat(model): add WebapiHealthLog Sequelize model"
```

---

## Task 3: `probeTargets.js` konstanta endpoint sentinel

**Files:**
- Create: `backend/src/services/webapiBpsHealth/probeTargets.js`

- [ ] **Step 1: Buat folder service & file konstanta**

```bash
mkdir -p backend/src/services/webapiBpsHealth
```

Create `backend/src/services/webapiBpsHealth/probeTargets.js`:

```js
'use strict';

// 4 endpoint sentinel WebAPI BPS yang di-probe tiap 15 menit.
// Spec: docs/superpowers/specs/2026-05-24-webapi-bps-status-design.md §5.1
//
// WISNU: STABLE_VAR_ID di bawah perlu diisi nilai nyata sebelum smoke test.
// Pilih variabel di domain 8200 (BPS Malut) yang Anda yakin sudah ada sejak
// tahun lama dan tidak akan dihapus. Contoh kandidat: '13' (Penduduk).
// Salah pilih = probe 'th' false-positive setiap 15 menit.

const DEFAULT_DOMAIN_ID = '8200';   // BPS Maluku Utara
const STABLE_VAR_ID     = '13';     // TODO(Wisnu): konfirmasi nilai stabil
                                     // Default '13' (Penduduk) — common, tapi validasi dulu

function buildTargets(apiKey) {
  return [
    {
      family: 'domain',
      url: `https://webapi.bps.go.id/v1/api/list/model/domain/lang/ind/key/${apiKey}/`,
      urlTemplate: 'list/model/domain/lang/ind/key/<REDACTED>/',
    },
    {
      family: 'var',
      url: `https://webapi.bps.go.id/v1/api/list/model/var/lang/ind/domain/${DEFAULT_DOMAIN_ID}/key/${apiKey}/page/1`,
      urlTemplate: `list/model/var/lang/ind/domain/${DEFAULT_DOMAIN_ID}/key/<REDACTED>/page/1`,
    },
    {
      family: 'th',
      url: `https://webapi.bps.go.id/v1/api/list/model/th/lang/ind/domain/${DEFAULT_DOMAIN_ID}/var/${STABLE_VAR_ID}/key/${apiKey}/`,
      urlTemplate: `list/model/th/lang/ind/domain/${DEFAULT_DOMAIN_ID}/var/${STABLE_VAR_ID}/key/<REDACTED>/`,
    },
    {
      family: 'pressrelease',
      url: `https://webapi.bps.go.id/v1/api/list/model/pressrelease/lang/ind/domain/${DEFAULT_DOMAIN_ID}/key/${apiKey}/page/1`,
      urlTemplate: `list/model/pressrelease/lang/ind/domain/${DEFAULT_DOMAIN_ID}/key/<REDACTED>/page/1`,
    },
  ];
}

// Headers identik dengan datasource/fetch.service.js — penting untuk WAF
const PROBE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/117.0',
  'Accept': 'application/json,text/html,*/*',
  'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://www.bps.go.id/',
  'Origin': 'https://www.bps.go.id',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'DNT': '1',
  'Connection': 'keep-alive',
};

const PROBE_TIMEOUT_MS = 8000;

module.exports = {
  buildTargets,
  PROBE_HEADERS,
  PROBE_TIMEOUT_MS,
  DEFAULT_DOMAIN_ID,
  STABLE_VAR_ID,
};
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/services/webapiBpsHealth/probeTargets.js
git commit -m "feat(probe): add WebAPI BPS sentinel endpoint targets"
```

---

## Task 4: `probe.service.js` — klasifikasi (TDD: 6 case)

**Files:**
- Create: `backend/src/__tests__/webapiBpsHealth.probe.test.js`
- Create: `backend/src/services/webapiBpsHealth/probe.service.js`

- [ ] **Step 1: Tulis failing test untuk 6 klasifikasi**

Create `backend/src/__tests__/webapiBpsHealth.probe.test.js`:

```js
jest.mock('axios');
jest.mock('../models/WebapiHealthLog.model', () => ({
  create: jest.fn().mockResolvedValue({}),
}));
jest.mock('../services/pressrelease/apiKey.service', () => ({
  resolveBpsApiKey: jest.fn().mockResolvedValue('TEST_KEY'),
}));

const axios = require('axios');
const WebapiHealthLog = require('../models/WebapiHealthLog.model');
const { runProbe, _classifyResponse } = require('../services/webapiBpsHealth/probe.service');

describe('webapiBpsHealth probe — classification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('2xx + JSON valid → ok=1', () => {
    const r = _classifyResponse({ status: 200, data: { domain: [] } });
    expect(r.ok).toBe(1);
    expect(r.errorCode).toBeNull();
  });

  test('response starts with "<" → HTML_RESPONSE (WAF block)', () => {
    const r = _classifyResponse({ status: 200, data: '<!DOCTYPE html>...' });
    expect(r.ok).toBe(0);
    expect(r.errorCode).toBe('HTML_RESPONSE');
  });

  test('401 → AUTH_INVALID', () => {
    const r = _classifyResponse({ status: 401, data: '' });
    expect(r.ok).toBe(0);
    expect(r.errorCode).toBe('AUTH_INVALID');
  });

  test('429 → RATE_LIMITED', () => {
    const r = _classifyResponse({ status: 429, data: '' });
    expect(r.ok).toBe(0);
    expect(r.errorCode).toBe('RATE_LIMITED');
  });

  test('503 → HTTP_5XX', () => {
    const r = _classifyResponse({ status: 503, data: '' });
    expect(r.ok).toBe(0);
    expect(r.errorCode).toBe('HTTP_5XX');
  });

  test('runProbe writes 4 rows + computes overall=UP when all ok', async () => {
    axios.get.mockResolvedValue({ status: 200, data: { domain: [{}] } });
    const result = await runProbe({ trigger: 'manual' });
    expect(result.overall).toBe('UP');
    expect(result.perFamily).toHaveLength(4);
    expect(WebapiHealthLog.create).toHaveBeenCalledTimes(4);
  });

  test('runProbe with mixed results → DEGRADED', async () => {
    axios.get
      .mockResolvedValueOnce({ status: 200, data: { domain: [] } })
      .mockResolvedValueOnce({ status: 200, data: { variabel: [] } })
      .mockResolvedValueOnce({ status: 503, data: '' })
      .mockResolvedValueOnce({ status: 200, data: { pressrelease: [] } });
    const result = await runProbe({ trigger: 'manual' });
    expect(result.overall).toBe('DEGRADED');
  });

  test('runProbe with all failures → DOWN', async () => {
    axios.get.mockResolvedValue({ status: 503, data: '' });
    const result = await runProbe({ trigger: 'manual' });
    expect(result.overall).toBe('DOWN');
  });

  test('runProbe with network exception → ok=0 error_code=NETWORK', async () => {
    const err = new Error('ENOTFOUND');
    err.code = 'ENOTFOUND';
    axios.get.mockRejectedValue(err);
    const result = await runProbe({ trigger: 'manual' });
    expect(result.overall).toBe('DOWN');
    expect(result.perFamily.every(f => f.ok === 0)).toBe(true);
  });

  test('runProbe with ECONNABORTED → TIMEOUT', async () => {
    const err = new Error('timeout of 8000ms exceeded');
    err.code = 'ECONNABORTED';
    axios.get.mockRejectedValue(err);
    const result = await runProbe({ trigger: 'manual' });
    expect(result.perFamily[0].errorCode).toBe('TIMEOUT');
  });
});
```

- [ ] **Step 2: Run test — should fail (no module yet)**

```bash
cd backend && npx jest src/__tests__/webapiBpsHealth.probe.test.js
```

Expected: FAIL — "Cannot find module '../services/webapiBpsHealth/probe.service'".

- [ ] **Step 3: Implement `probe.service.js`**

Create `backend/src/services/webapiBpsHealth/probe.service.js`:

```js
'use strict';

const axios = require('axios');
const crypto = require('crypto');
const WebapiHealthLog = require('../../models/WebapiHealthLog.model');
const { resolveBpsApiKey } = require('../pressrelease/apiKey.service');
const { bpsAPICircuit } = require('../../utils/circuitBreaker');
const { buildTargets, PROBE_HEADERS, PROBE_TIMEOUT_MS } = require('./probeTargets');
const logger = require('../../utils/logger').child({ service: 'WebapiBpsHealth' });

let probeMutex = false;

function _classifyResponse(resp) {
  // resp = { status, data, bytesReceived? }
  const { status, data } = resp;

  if (typeof data === 'string' && data.trimStart().startsWith('<')) {
    return { ok: 0, errorCode: 'HTML_RESPONSE', errorMessage: 'WAF returned HTML' };
  }
  if (status === 401 || status === 403) {
    return { ok: 0, errorCode: 'AUTH_INVALID', errorMessage: `HTTP ${status}` };
  }
  if (status === 429) {
    return { ok: 0, errorCode: 'RATE_LIMITED', errorMessage: 'HTTP 429' };
  }
  if (status >= 500) {
    return { ok: 0, errorCode: 'HTTP_5XX', errorMessage: `HTTP ${status}` };
  }
  if (status >= 400) {
    return { ok: 0, errorCode: 'HTTP_4XX', errorMessage: `HTTP ${status}` };
  }
  if (status >= 200 && status < 300) {
    return { ok: 1, errorCode: null, errorMessage: null };
  }
  return { ok: 0, errorCode: 'UNKNOWN_STATUS', errorMessage: `HTTP ${status}` };
}

function _classifyException(err) {
  if (err && err.code === 'ECONNABORTED') {
    return { ok: 0, errorCode: 'TIMEOUT', errorMessage: err.message };
  }
  return { ok: 0, errorCode: 'NETWORK', errorMessage: err.message || String(err) };
}

async function _probeOne(target, runId, probeKind) {
  const startedAt = Date.now();
  let classification;
  let httpStatus = null;
  let bytesReceived = null;

  try {
    const resp = await axios.get(target.url, {
      timeout: PROBE_TIMEOUT_MS,
      validateStatus: () => true,
      headers: PROBE_HEADERS,
      responseType: 'json',
      transitional: { silentJSONParsing: false, forcedJSONParsing: false },
    });
    httpStatus = resp.status;
    bytesReceived = typeof resp.data === 'string'
      ? Buffer.byteLength(resp.data, 'utf8')
      : Buffer.byteLength(JSON.stringify(resp.data || ''), 'utf8');
    classification = _classifyResponse(resp);
  } catch (err) {
    classification = _classifyException(err);
  }

  const latencyMs = Date.now() - startedAt;

  // Persist (log error but don't throw — probe must not crash)
  try {
    await WebapiHealthLog.create({
      run_id: runId,
      probe_kind: probeKind,
      endpoint_family: target.family,
      url_template: target.urlTemplate,
      http_status: httpStatus,
      latency_ms: classification.ok ? latencyMs : (httpStatus ? latencyMs : null),
      ok: classification.ok,
      error_code: classification.errorCode,
      error_message: classification.errorMessage,
      bytes_received: bytesReceived,
    });
  } catch (dbErr) {
    logger.error({ family: target.family, err: dbErr.message }, 'Failed to persist probe row');
  }

  return {
    family: target.family,
    ok: classification.ok,
    latencyMs: classification.ok ? latencyMs : null,
    httpStatus,
    errorCode: classification.errorCode,
  };
}

async function runProbe({ trigger = 'scheduled' } = {}) {
  if (probeMutex) {
    return { skipped: true, reason: 'probe_already_running' };
  }
  probeMutex = true;

  const startTotal = Date.now();
  const runId = crypto.randomUUID();
  const probeKind = trigger === 'manual' ? 'manual' : (trigger === 'recovery' ? 'recovery' : 'scheduled');

  try {
    const apiKey = await resolveBpsApiKey();
    if (!apiKey) {
      return {
        runId,
        overall: 'UNKNOWN',
        error: 'API_KEY_MISSING',
        perFamily: [],
        durationMs: Date.now() - startTotal,
      };
    }

    const targets = buildTargets(apiKey);
    const settled = await Promise.allSettled(
      targets.map(t => _probeOne(t, runId, probeKind))
    );
    const perFamily = settled.map((s, i) => {
      if (s.status === 'fulfilled') return s.value;
      return { family: targets[i].family, ok: 0, latencyMs: null, httpStatus: null, errorCode: 'INTERNAL' };
    });

    const okCount = perFamily.filter(p => p.ok).length;
    const overall = okCount === perFamily.length ? 'UP'
                  : okCount === 0 ? 'DOWN'
                  : 'DEGRADED';

    // Update circuit breaker (read-only consumer for now; nothing else writes to it)
    if (overall === 'DOWN') {
      try { bpsAPICircuit.onFailure(); } catch { /* ignore */ }
    } else if (overall === 'UP') {
      try { bpsAPICircuit.onSuccess(); } catch { /* ignore */ }
    }

    return {
      runId,
      overall,
      perFamily,
      durationMs: Date.now() - startTotal,
    };
  } finally {
    probeMutex = false;
  }
}

module.exports = {
  runProbe,
  _classifyResponse,
  _classifyException,
};
```

- [ ] **Step 4: Run test — should pass**

```bash
cd backend && npx jest src/__tests__/webapiBpsHealth.probe.test.js
```

Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/webapiBpsHealth/probe.service.js backend/src/__tests__/webapiBpsHealth.probe.test.js
git commit -m "feat(probe): implement runProbe with 7 error classifications"
```

---

## Task 5: Mutex concurrency guard (TDD)

**Files:**
- Create: `backend/src/__tests__/webapiBpsHealth.probe.mutex.test.js`

- [ ] **Step 1: Tulis test concurrent runs**

Create `backend/src/__tests__/webapiBpsHealth.probe.mutex.test.js`:

```js
jest.mock('axios');
jest.mock('../models/WebapiHealthLog.model', () => ({
  create: jest.fn().mockResolvedValue({}),
}));
jest.mock('../services/pressrelease/apiKey.service', () => ({
  resolveBpsApiKey: jest.fn().mockResolvedValue('TEST_KEY'),
}));

const axios = require('axios');
const { runProbe } = require('../services/webapiBpsHealth/probe.service');

describe('webapiBpsHealth probe — mutex', () => {
  test('concurrent runProbe: 2nd call returns skipped', async () => {
    // axios.get takes 100ms
    axios.get.mockImplementation(() => new Promise(resolve => {
      setTimeout(() => resolve({ status: 200, data: { ok: true } }), 100);
    }));

    const [first, second] = await Promise.all([
      runProbe({ trigger: 'manual' }),
      runProbe({ trigger: 'manual' }),
    ]);

    // Exactly one of them is the real result, the other is skipped
    const skipped = [first, second].find(r => r.skipped);
    const real = [first, second].find(r => !r.skipped);

    expect(skipped).toBeDefined();
    expect(skipped.reason).toBe('probe_already_running');
    expect(real).toBeDefined();
    expect(real.overall).toBe('UP');
  });
});
```

- [ ] **Step 2: Run test — should pass (mutex already implemented in Task 4)**

```bash
cd backend && npx jest src/__tests__/webapiBpsHealth.probe.mutex.test.js
```

Expected: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add backend/src/__tests__/webapiBpsHealth.probe.mutex.test.js
git commit -m "test(probe): cover concurrency mutex guard"
```

---

## Task 6: API key absent path (TDD)

**Files:**
- Create: `backend/src/__tests__/webapiBpsHealth.probe.apikey.test.js`

- [ ] **Step 1: Tulis test apikey null**

Create `backend/src/__tests__/webapiBpsHealth.probe.apikey.test.js`:

```js
jest.mock('axios');
jest.mock('../models/WebapiHealthLog.model', () => ({
  create: jest.fn().mockResolvedValue({}),
}));
jest.mock('../services/pressrelease/apiKey.service', () => ({
  resolveBpsApiKey: jest.fn().mockResolvedValue(null),
}));

const axios = require('axios');
const { runProbe } = require('../services/webapiBpsHealth/probe.service');

describe('webapiBpsHealth probe — apikey missing', () => {
  test('returns UNKNOWN without calling axios when api key absent', async () => {
    const result = await runProbe({ trigger: 'manual' });
    expect(result.overall).toBe('UNKNOWN');
    expect(result.error).toBe('API_KEY_MISSING');
    expect(result.perFamily).toEqual([]);
    expect(axios.get).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test — should pass**

```bash
cd backend && npx jest src/__tests__/webapiBpsHealth.probe.apikey.test.js
```

Expected: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add backend/src/__tests__/webapiBpsHealth.probe.apikey.test.js
git commit -m "test(probe): cover API_KEY_MISSING path returns UNKNOWN"
```

---

## Task 7: Scheduler service

**Files:**
- Create: `backend/src/services/webapiBpsHealth/scheduler.service.js`

- [ ] **Step 1: Tulis scheduler**

Create `backend/src/services/webapiBpsHealth/scheduler.service.js`:

```js
'use strict';

const { runProbe } = require('./probe.service');
const logger = require('../../utils/logger').child({ service: 'WebapiBpsHealthScheduler' });

const INTERVAL_MS = 15 * 60 * 1000; // 15 menit

let timer = null;

async function tick() {
  try {
    const result = await runProbe({ trigger: 'scheduled' });
    if (result.skipped) {
      logger.warn({ reason: result.reason }, 'Scheduled probe skipped');
    } else if (result.overall !== 'UP') {
      logger.warn({ runId: result.runId, overall: result.overall, durationMs: result.durationMs }, 'Scheduled probe non-UP');
    } else {
      logger.info({ runId: result.runId, durationMs: result.durationMs }, 'Scheduled probe OK');
    }
  } catch (err) {
    // Defense: must never crash scheduler
    logger.error({ err: err.message }, 'Scheduled probe threw — scheduler continues');
  }
}

function startWebapiBpsHealthScheduler() {
  if (timer) {
    logger.warn('Scheduler already started — skipping duplicate init');
    return;
  }
  // IMPORTANT: defer first run by INTERVAL (do NOT run on startup) to prevent
  // probe storm during PM2 restart loops.
  timer = setInterval(tick, INTERVAL_MS);
  logger.info({ intervalMs: INTERVAL_MS }, 'WebAPI BPS health scheduler started');
}

function stopWebapiBpsHealthScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  startWebapiBpsHealthScheduler,
  stopWebapiBpsHealthScheduler,
  INTERVAL_MS,
};
```

- [ ] **Step 2: Smoke test scheduler module loads**

Create `backend/src/__tests__/webapiBpsHealth.scheduler.test.js`:

```js
jest.mock('../services/webapiBpsHealth/probe.service', () => ({
  runProbe: jest.fn().mockResolvedValue({ overall: 'UP', runId: 'x', durationMs: 5 }),
}));

describe('webapiBpsHealth scheduler', () => {
  test('start/stop without throw', () => {
    const { startWebapiBpsHealthScheduler, stopWebapiBpsHealthScheduler, INTERVAL_MS } =
      require('../services/webapiBpsHealth/scheduler.service');
    expect(INTERVAL_MS).toBe(15 * 60 * 1000);
    startWebapiBpsHealthScheduler();
    stopWebapiBpsHealthScheduler();
  });
});
```

- [ ] **Step 3: Run test**

```bash
cd backend && npx jest src/__tests__/webapiBpsHealth.scheduler.test.js
```

Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/webapiBpsHealth/scheduler.service.js backend/src/__tests__/webapiBpsHealth.scheduler.test.js
git commit -m "feat(probe): add scheduler (15min interval, deferred first run)"
```

---

## Task 8: REST routes — `GET /webapi-bps/status`

**Files:**
- Create: `backend/src/__tests__/webapiBps.routes.test.js`
- Create: `backend/src/routes/webapiBps.routes.js`

- [ ] **Step 1: Tulis failing test untuk /status**

Create `backend/src/__tests__/webapiBps.routes.test.js`:

```js
jest.mock('axios');
jest.mock('../models/WebapiHealthLog.model', () => {
  const M = jest.fn();
  M.create = jest.fn().mockResolvedValue({});
  M.findOne = jest.fn().mockResolvedValue(null);
  M.findAll = jest.fn().mockResolvedValue([]);
  M.findAndCountAll = jest.fn().mockResolvedValue({ count: 0, rows: [] });
  return M;
});
jest.mock('../services/pressrelease/apiKey.service', () => ({
  resolveBpsApiKey: jest.fn().mockResolvedValue('TEST_KEY'),
}));
jest.mock('../services/webapiBpsHealth/probe.service', () => ({
  runProbe: jest.fn().mockResolvedValue({
    runId: 'abc',
    overall: 'UP',
    durationMs: 100,
    perFamily: [
      { family: 'domain', ok: 1, latencyMs: 100, httpStatus: 200, errorCode: null },
    ],
  }),
}));
jest.mock('../config/db', () => ({
  query: jest.fn().mockResolvedValue([[{ uptime: 1, total: 4, failed: 0, p50: 100, p95: 200 }]]),
}));

const express = require('express');
const request = require('supertest');
const webapiBpsRouter = require('../routes/webapiBps.routes');

function app() {
  const a = express();
  a.use(express.json());
  // No auth — test the router in isolation
  a.use('/webapi-bps', webapiBpsRouter);
  return a;
}

describe('webapiBps routes', () => {
  test('GET /webapi-bps/status returns snapshot', async () => {
    const r = await request(app()).get('/webapi-bps/status');
    expect(r.status).toBe(200);
    expect(r.body.overall).toBeDefined();
    expect(r.body.perFamily).toBeDefined();
    expect(r.body.circuit).toBeDefined();
    expect(r.body.apiKeyPresent).toBe(true);
  });
});
```

- [ ] **Step 2: Verify supertest available**

```bash
cd backend && node -e "require('supertest')" 2>&1
```

If "Cannot find module" → install: `cd backend && npm install --save-dev supertest`. (Note: many node test suites already include supertest — check `package.json` devDependencies first.)

```bash
grep supertest backend/package.json
```

- [ ] **Step 3: Run test — should fail**

```bash
cd backend && npx jest src/__tests__/webapiBps.routes.test.js -t status
```

Expected: FAIL — "Cannot find module '../routes/webapiBps.routes'".

- [ ] **Step 4: Implement `/status` endpoint**

Create `backend/src/routes/webapiBps.routes.js`:

```js
'use strict';

const express = require('express');
const router = express.Router();
const { Op, fn, col, literal } = require('sequelize');
const WebapiHealthLog = require('../models/WebapiHealthLog.model');
const { runProbe } = require('../services/webapiBpsHealth/probe.service');
const { resolveBpsApiKey } = require('../services/pressrelease/apiKey.service');
const { bpsAPICircuit } = require('../utils/circuitBreaker');
const sequelize = require('../config/db');
const logger = require('../utils/logger').child({ service: 'WebapiBpsRoutes' });

// In-memory 30s cache for /status (dashboard polls 30s — perfect cache TTL)
let statusCache = { ts: 0, data: null };
const STATUS_CACHE_MS = 30_000;

router.get('/status', async (req, res) => {
  try {
    if (statusCache.data && Date.now() - statusCache.ts < STATUS_CACHE_MS) {
      return res.json(statusCache.data);
    }

    // Per-family last status
    const families = ['domain', 'var', 'th', 'pressrelease'];
    const perFamily = await Promise.all(families.map(async (family) => {
      const last = await WebapiHealthLog.findOne({
        where: { endpoint_family: family },
        order: [['id', 'DESC']],
      });
      return {
        family,
        lastOk: last ? !!last.ok : null,
        lastLatencyMs: last ? last.latency_ms : null,
        lastErrorCode: last ? last.error_code : null,
        lastCheckedAt: last ? last.created_at : null,
      };
    }));

    // Last probe run summary
    const lastAny = await WebapiHealthLog.findOne({ order: [['id', 'DESC']] });

    // 24h aggregate (scheduled only) — raw SQL for percentile
    const [aggRows] = await sequelize.query(`
      SELECT
        COUNT(*)            AS total,
        SUM(1 - ok)         AS failed,
        AVG(ok)             AS uptime,
        AVG(latency_ms)     AS avg_latency,
        MAX(latency_ms)     AS max_latency
      FROM webapi_health_logs
      WHERE probe_kind = 'scheduled' AND created_at >= NOW() - INTERVAL 24 HOUR
    `);
    const agg = aggRows[0] || {};

    // p50/p95 via separate query (MariaDB 11+ window functions)
    const [pRows] = await sequelize.query(`
      SELECT
        MAX(CASE WHEN cum_pct <= 0.50 THEN latency_ms END) AS p50,
        MAX(CASE WHEN cum_pct <= 0.95 THEN latency_ms END) AS p95
      FROM (
        SELECT latency_ms,
               PERCENT_RANK() OVER (ORDER BY latency_ms) AS cum_pct
        FROM webapi_health_logs
        WHERE probe_kind = 'scheduled' AND ok = 1 AND latency_ms IS NOT NULL
          AND created_at >= NOW() - INTERVAL 24 HOUR
      ) t
    `);
    const p = pRows[0] || {};

    // Overall: derive from latest run
    let overall = 'UNKNOWN';
    if (lastAny) {
      const sameRun = await WebapiHealthLog.findAll({ where: { run_id: lastAny.run_id } });
      const okCount = sameRun.filter(r => r.ok).length;
      overall = okCount === sameRun.length ? 'UP' : okCount === 0 ? 'DOWN' : 'DEGRADED';
    }

    const apiKey = await resolveBpsApiKey();
    const circuit = bpsAPICircuit.getStatus();

    const out = {
      overall,
      lastProbeAt: lastAny ? lastAny.created_at : null,
      lastProbeRunId: lastAny ? lastAny.run_id : null,
      uptime24h: agg.uptime !== null && agg.uptime !== undefined ? Number(agg.uptime) : null,
      p50LatencyMs24h: p.p50 !== null ? Number(p.p50) : null,
      p95LatencyMs24h: p.p95 !== null ? Number(p.p95) : null,
      totalProbes24h: Number(agg.total || 0),
      failedProbes24h: Number(agg.failed || 0),
      perFamily,
      circuit: {
        state: circuit.state,
        failureCount: circuit.failureCount,
        lastFailureAt: circuit.lastFailureTime ? new Date(circuit.lastFailureTime).toISOString() : null,
        nextAttemptAt: circuit.nextAttemptTime ? new Date(circuit.nextAttemptTime).toISOString() : null,
      },
      apiKeyPresent: !!apiKey,
    };

    statusCache = { ts: Date.now(), data: out };
    return res.json(out);
  } catch (err) {
    logger.error({ err: err.message }, 'GET /webapi-bps/status failed');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
```

- [ ] **Step 5: Run test — should pass**

```bash
cd backend && npx jest src/__tests__/webapiBps.routes.test.js -t status
```

Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/webapiBps.routes.js backend/src/__tests__/webapiBps.routes.test.js
git commit -m "feat(api): GET /webapi-bps/status with 30s in-memory cache"
```

---

## Task 9: Routes — `GET /webapi-bps/history`

**Files:**
- Modify: `backend/src/routes/webapiBps.routes.js`
- Modify: `backend/src/__tests__/webapiBps.routes.test.js`

- [ ] **Step 1: Backup existing files**

```bash
cp backend/src/routes/webapiBps.routes.js backend/src/routes/webapiBps.routes.js.backup
cp backend/src/__tests__/webapiBps.routes.test.js backend/src/__tests__/webapiBps.routes.test.js.backup
```

- [ ] **Step 2: Tambah test untuk /history**

Append to `backend/src/__tests__/webapiBps.routes.test.js` inside the `describe` block (before closing `});`):

```js
  test('GET /webapi-bps/history returns bucketed data', async () => {
    const sequelize = require('../config/db');
    sequelize.query.mockResolvedValueOnce([[
      { bucket_start: '2026-05-23 04:00:00', probes: 4, failed: 0, p95: 290 },
      { bucket_start: '2026-05-23 05:00:00', probes: 4, failed: 1, p95: 1820 },
    ]]);
    const r = await request(app()).get('/webapi-bps/history?hours=24&bucket=1h');
    expect(r.status).toBe(200);
    expect(r.body.bucket).toBe('1h');
    expect(r.body.buckets).toHaveLength(2);
    expect(r.body.buckets[0]).toMatchObject({ probes: 4, failed: 0 });
  });

  test('GET /webapi-bps/history rejects bucket=5m hours>24', async () => {
    const r = await request(app()).get('/webapi-bps/history?hours=168&bucket=5m');
    expect(r.status).toBe(400);
  });
```

- [ ] **Step 3: Tambah handler /history**

Edit `backend/src/routes/webapiBps.routes.js` — tambahkan setelah handler `/status`, sebelum `module.exports`:

```js
// GET /webapi-bps/history?hours=24&bucket=1h
router.get('/history', async (req, res) => {
  try {
    const hours = Math.min(Math.max(parseInt(req.query.hours) || 24, 1), 168);
    const bucket = String(req.query.bucket || '1h');

    // Validate bucket combinations (cap total points at ~300)
    const bucketSec = bucket === '5m' ? 300 : bucket === '15m' ? 900 : bucket === '1h' ? 3600 : null;
    if (!bucketSec) {
      return res.status(400).json({ error: 'bucket must be one of: 5m, 15m, 1h' });
    }
    const totalPoints = (hours * 3600) / bucketSec;
    if (totalPoints > 300) {
      return res.status(400).json({ error: `Too many buckets (${totalPoints}); reduce hours or use larger bucket` });
    }

    // Group-by SQL — server-side bucketing
    const format = bucket === '1h' ? '%Y-%m-%d %H:00:00'
                 : bucket === '15m' ? '%Y-%m-%d %H:%i:00'  // post-process for 15m
                 : '%Y-%m-%d %H:%i:00';

    const [rows] = await sequelize.query(`
      SELECT
        DATE_FORMAT(created_at, ?) AS bucket_start,
        COUNT(*)                    AS probes,
        SUM(1 - ok)                 AS failed,
        AVG(latency_ms)             AS avg_latency
      FROM webapi_health_logs
      WHERE probe_kind = 'scheduled'
        AND created_at >= NOW() - INTERVAL ? HOUR
      GROUP BY bucket_start
      ORDER BY bucket_start ASC
    `, { replacements: [format, hours] });

    return res.json({
      bucket,
      hours,
      buckets: rows.map(r => ({
        t: new Date(r.bucket_start + 'Z').toISOString(),
        probes: Number(r.probes),
        failed: Number(r.failed),
        p95LatencyMs: r.p95 != null ? Number(r.p95) : (r.avg_latency != null ? Number(r.avg_latency) : null),
      })),
    });
  } catch (err) {
    logger.error({ err: err.message }, 'GET /webapi-bps/history failed');
    return res.status(500).json({ error: 'Internal server error' });
  }
});
```

- [ ] **Step 4: Run tests**

```bash
cd backend && npx jest src/__tests__/webapiBps.routes.test.js
```

Expected: 3 passed (status + 2 history tests).

- [ ] **Step 5: Verify diff & commit**

```bash
diff backend/src/routes/webapiBps.routes.js.backup backend/src/routes/webapiBps.routes.js | head -50
rm backend/src/routes/webapiBps.routes.js.backup backend/src/__tests__/webapiBps.routes.test.js.backup
git add backend/src/routes/webapiBps.routes.js backend/src/__tests__/webapiBps.routes.test.js
git commit -m "feat(api): GET /webapi-bps/history with bucket validation"
```

---

## Task 10: Routes — `GET /webapi-bps/logs`

**Files:**
- Modify: `backend/src/routes/webapiBps.routes.js`
- Modify: `backend/src/__tests__/webapiBps.routes.test.js`

- [ ] **Step 1: Backup**

```bash
cp backend/src/routes/webapiBps.routes.js backend/src/routes/webapiBps.routes.js.backup
cp backend/src/__tests__/webapiBps.routes.test.js backend/src/__tests__/webapiBps.routes.test.js.backup
```

- [ ] **Step 2: Tambah test untuk /logs**

Append inside `describe`:

```js
  test('GET /webapi-bps/logs returns paginated logs', async () => {
    WebapiHealthLog.findAndCountAll.mockResolvedValueOnce({
      count: 2,
      rows: [
        { id: 2, run_id: 'r2', probe_kind: 'scheduled', endpoint_family: 'th',
          url_template: 'list/model/th/.../key/<REDACTED>/', http_status: null,
          latency_ms: null, ok: 0, error_code: 'TIMEOUT', error_message: 'timeout',
          bytes_received: null, created_at: '2026-05-24T03:45:18Z' },
        { id: 1, run_id: 'r1', probe_kind: 'scheduled', endpoint_family: 'domain',
          url_template: 'list/model/domain/.../key/<REDACTED>/', http_status: 200,
          latency_ms: 312, ok: 1, error_code: null, error_message: null,
          bytes_received: 1024, created_at: '2026-05-24T03:45:17Z' },
      ],
    });
    const r = await request(app()).get('/webapi-bps/logs?limit=50&offset=0');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);
    expect(r.body.logs).toHaveLength(2);
    expect(r.body.logs[0].endpoint_family).toBe('th');
  });

  test('GET /webapi-bps/logs respects status=error filter', async () => {
    WebapiHealthLog.findAndCountAll.mockResolvedValueOnce({ count: 0, rows: [] });
    const r = await request(app()).get('/webapi-bps/logs?status=error');
    expect(r.status).toBe(200);
    expect(WebapiHealthLog.findAndCountAll).toHaveBeenCalled();
    const args = WebapiHealthLog.findAndCountAll.mock.calls.at(-1)[0];
    expect(args.where.ok).toBe(0);
  });
```

- [ ] **Step 3: Tambah handler /logs**

Edit `backend/src/routes/webapiBps.routes.js`, tambah sebelum `module.exports`:

```js
// GET /webapi-bps/logs?limit&offset&family&status&kind&runId
router.get('/logs', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const where = {};
    if (req.query.family) where.endpoint_family = String(req.query.family);
    if (req.query.kind) where.probe_kind = String(req.query.kind);
    if (req.query.runId) where.run_id = String(req.query.runId);
    if (req.query.status === 'ok') where.ok = 1;
    else if (req.query.status === 'error') where.ok = 0;

    const { count, rows } = await WebapiHealthLog.findAndCountAll({
      where,
      order: [['id', 'DESC']],
      limit,
      offset,
    });

    return res.json({ total: count, limit, offset, logs: rows });
  } catch (err) {
    logger.error({ err: err.message }, 'GET /webapi-bps/logs failed');
    return res.status(500).json({ error: 'Internal server error' });
  }
});
```

- [ ] **Step 4: Run tests**

```bash
cd backend && npx jest src/__tests__/webapiBps.routes.test.js
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
rm backend/src/routes/webapiBps.routes.js.backup backend/src/__tests__/webapiBps.routes.test.js.backup
git add backend/src/routes/webapiBps.routes.js backend/src/__tests__/webapiBps.routes.test.js
git commit -m "feat(api): GET /webapi-bps/logs with family/status/kind filters"
```

---

## Task 11: Routes — `POST /webapi-bps/probe` (rate-limit + audit)

**Files:**
- Modify: `backend/src/routes/webapiBps.routes.js`
- Modify: `backend/src/__tests__/webapiBps.routes.test.js`

- [ ] **Step 1: Backup**

```bash
cp backend/src/routes/webapiBps.routes.js backend/src/routes/webapiBps.routes.js.backup
cp backend/src/__tests__/webapiBps.routes.test.js backend/src/__tests__/webapiBps.routes.test.js.backup
```

- [ ] **Step 2: Tambah test untuk POST /probe**

Append inside `describe`:

```js
  test('POST /webapi-bps/probe triggers probe and returns result', async () => {
    const r = await request(app()).post('/webapi-bps/probe');
    expect(r.status).toBe(200);
    expect(r.body.runId).toBe('abc');
    expect(r.body.overall).toBe('UP');
  });

  test('POST /webapi-bps/probe returns 409 when probe already running', async () => {
    const { runProbe } = require('../services/webapiBpsHealth/probe.service');
    runProbe.mockResolvedValueOnce({ skipped: true, reason: 'probe_already_running' });
    const r = await request(app()).post('/webapi-bps/probe');
    expect(r.status).toBe(409);
    expect(r.body.reason).toBe('probe_already_running');
  });

  test('POST /webapi-bps/probe rate-limits after 6 requests/min per ip', async () => {
    // Hit 7 times rapidly
    let last;
    for (let i = 0; i < 7; i++) {
      last = await request(app()).post('/webapi-bps/probe');
    }
    expect(last.status).toBe(429);
  });
```

- [ ] **Step 3: Tambah handler POST /probe**

Edit `backend/src/routes/webapiBps.routes.js`, tambah sebelum `module.exports`:

```js
// In-memory rate-limit: max 6 manual probes per minute per key (ip|user)
const probeRateMap = new Map(); // key → [timestamp, ...]
const PROBE_RATE_MAX = 6;
const PROBE_RATE_WINDOW_MS = 60_000;

function checkRateLimit(key) {
  const now = Date.now();
  const arr = (probeRateMap.get(key) || []).filter(t => now - t < PROBE_RATE_WINDOW_MS);
  arr.push(now);
  probeRateMap.set(key, arr);
  return arr.length <= PROBE_RATE_MAX;
}

// POST /webapi-bps/probe — manual trigger
router.post('/probe', async (req, res) => {
  try {
    const rateKey = (req.user && req.user.id) || req.ip || 'anonymous';
    if (!checkRateLimit(String(rateKey))) {
      res.set('Retry-After', '60');
      return res.status(429).json({ error: 'rate_limited', message: 'Too many manual probes; wait 1 minute' });
    }

    const result = await runProbe({ trigger: 'manual' });

    if (result.skipped) {
      return res.status(409).json(result);
    }

    // Invalidate status cache so next GET /status sees fresh data
    statusCache = { ts: 0, data: null };

    // Audit log (best-effort)
    try {
      const AdminAuditLog = require('../models/AdminAuditLog.model');
      await AdminAuditLog.create({
        user_id: req.user && req.user.id,
        user_email: req.user && req.user.email,
        action: 'webapi_bps_probe_manual',
        resource: 'webapi-bps',
        resource_id: result.runId,
        ip: req.ip,
        status_code: 200,
      });
    } catch (auditErr) {
      logger.warn({ err: auditErr.message }, 'Audit log write failed (non-fatal)');
    }

    return res.json(result);
  } catch (err) {
    logger.error({ err: err.message }, 'POST /webapi-bps/probe failed');
    return res.status(500).json({ error: 'Internal server error' });
  }
});
```

- [ ] **Step 4: Add AdminAuditLog mock to test file**

Insert at top of test file, after other `jest.mock` calls:

```js
jest.mock('../models/AdminAuditLog.model', () => ({
  create: jest.fn().mockResolvedValue({}),
}));
```

- [ ] **Step 5: Run tests**

```bash
cd backend && npx jest src/__tests__/webapiBps.routes.test.js
```

Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
rm backend/src/routes/webapiBps.routes.js.backup backend/src/__tests__/webapiBps.routes.test.js.backup
git add backend/src/routes/webapiBps.routes.js backend/src/__tests__/webapiBps.routes.test.js
git commit -m "feat(api): POST /webapi-bps/probe with rate-limit + audit log"
```

---

## Task 12: Mount route + register scheduler in `app.js` & `server.js`

**Files:**
- Modify: `backend/app.js` (add mount near line 195)
- Modify: `backend/server.js` (add scheduler in loader array near line 155)

- [ ] **Step 1: Backup**

```bash
cp backend/app.js backend/app.js.backup
cp backend/server.js backend/server.js.backup
```

- [ ] **Step 2: Read existing files**

```bash
grep -n "logs.routes\|logsRoutes" backend/app.js | head -5
grep -n "scheduler\|loader\|knowledge-sync" backend/server.js | head -10
```

- [ ] **Step 3: Mount route in `app.js`**

Find line ~40 where `logsRoutes` is required. Add directly after:
```js
const webapiBpsRoutes = require("./src/routes/webapiBps.routes");
```

Find line ~195 with `app.use("/logs", ...)`. Add directly after:
```js
// Admin-only: WebAPI BPS health probe + dashboard
app.use("/webapi-bps", authMiddleware, csrfMiddleware, apiLimiter, requireAdmin, createAuditLogMiddleware({ resource: 'webapi-bps' }), webapiBpsRoutes);
```

- [ ] **Step 4: Register scheduler in `server.js`**

Find the loader array (line ~155 starting with `['knowledge-sync', ...]`). Add entry:
```js
['webapi-bps-health', () => require('./src/services/webapiBpsHealth/scheduler.service').startWebapiBpsHealthScheduler()],
```

(Position: after `['indicator-meta', ...]` works fine — keep grouped with other monitoring schedulers.)

- [ ] **Step 5: Reload backend & smoke test**

```bash
cd backend && pm2 reload pds-backend --update-env
pm2 logs pds-backend --lines 50 --nostream | grep -i "webapi\|scheduler"
```

Expected log line: `WebAPI BPS health scheduler started`.

- [ ] **Step 6: Verify mounted endpoint responds 401 without auth**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5000/webapi-bps/status
```

Expected: `401` (auth middleware kicks in — confirms route is mounted).

- [ ] **Step 7: Verify diff & commit**

```bash
diff backend/app.js.backup backend/app.js
diff backend/server.js.backup backend/server.js
rm backend/app.js.backup backend/server.js.backup
git add backend/app.js backend/server.js
git commit -m "feat(probe): mount /webapi-bps routes + register scheduler"
```

---

## Task 13: Retention policy untuk `webapi_health_logs`

**Files:**
- Modify: `backend/src/jobs/retention.job.js`

- [ ] **Step 1: Backup & inspect**

```bash
cp backend/src/jobs/retention.job.js backend/src/jobs/retention.job.js.backup
cat backend/src/jobs/retention.job.js
```

- [ ] **Step 2: Tambah policy row**

Edit `backend/src/jobs/retention.job.js`. Di array `POLICIES`, tambahkan row baru:

```js
const POLICIES = [
  { table: 'fetch_logs',          days: 90,  column: 'created_at' },
  { table: 'automation_run_logs', days: 30,  column: 'created_at' },
  { table: 'admin_audit_logs',    days: 365, column: 'created_at' },
  { table: 'webapi_health_logs',  days: 90,  column: 'created_at' },  // ← new
];
```

- [ ] **Step 3: Verify diff & commit**

```bash
diff backend/src/jobs/retention.job.js.backup backend/src/jobs/retention.job.js
rm backend/src/jobs/retention.job.js.backup
git add backend/src/jobs/retention.job.js
git commit -m "feat(retention): purge webapi_health_logs older than 90 days"
```

---

## Task 14: Frontend types

**Files:**
- Create: `backend/admin/app/webapi-bps-status/types.ts`

- [ ] **Step 1: Buat folder & types file**

```bash
mkdir -p backend/admin/app/webapi-bps-status/_components
mkdir -p backend/admin/app/webapi-bps-status/__tests__
```

Create `backend/admin/app/webapi-bps-status/types.ts`:

```ts
export type Overall = "UP" | "DEGRADED" | "DOWN" | "UNKNOWN";
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";
export type ProbeKind = "scheduled" | "manual" | "recovery";
export type EndpointFamily = "domain" | "var" | "th" | "pressrelease";
export type ErrorCode =
  | "HTML_RESPONSE" | "AUTH_INVALID" | "RATE_LIMITED"
  | "HTTP_5XX" | "HTTP_4XX" | "TIMEOUT" | "NETWORK"
  | "UNKNOWN_STATUS" | "INTERNAL" | "API_KEY_MISSING";

export interface PerFamilySummary {
  family: EndpointFamily;
  lastOk: boolean | null;
  lastLatencyMs: number | null;
  lastErrorCode: ErrorCode | null;
  lastCheckedAt: string | null;
}

export interface CircuitSummary {
  state: CircuitState;
  failureCount: number;
  lastFailureAt: string | null;
  nextAttemptAt: string | null;
}

export interface StatusResponse {
  overall: Overall;
  lastProbeAt: string | null;
  lastProbeRunId: string | null;
  uptime24h: number | null;
  p50LatencyMs24h: number | null;
  p95LatencyMs24h: number | null;
  totalProbes24h: number;
  failedProbes24h: number;
  perFamily: PerFamilySummary[];
  circuit: CircuitSummary;
  apiKeyPresent: boolean;
}

export interface HistoryBucket {
  t: string;
  probes: number;
  failed: number;
  p95LatencyMs: number | null;
}

export interface HistoryResponse {
  bucket: "5m" | "15m" | "1h";
  hours: number;
  buckets: HistoryBucket[];
}

export interface ProbeLog {
  id: number;
  run_id: string;
  probe_kind: ProbeKind;
  endpoint_family: EndpointFamily;
  url_template: string;
  http_status: number | null;
  latency_ms: number | null;
  ok: 0 | 1;
  error_code: ErrorCode | null;
  error_message: string | null;
  bytes_received: number | null;
  created_at: string;
}

export interface LogsResponse {
  total: number;
  limit: number;
  offset: number;
  logs: ProbeLog[];
}

export interface ProbeResult {
  runId: string;
  overall: Overall;
  durationMs: number;
  perFamily: Array<{
    family: EndpointFamily;
    ok: 0 | 1;
    latencyMs: number | null;
    httpStatus: number | null;
    errorCode: ErrorCode | null;
  }>;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/admin/app/webapi-bps-status/types.ts
git commit -m "feat(admin): add WebAPI BPS status TS types"
```

---

## Task 15: `OverallStatusCard` component (TDD)

**Files:**
- Create: `backend/admin/app/webapi-bps-status/_components/OverallStatusCard.tsx`
- Create: `backend/admin/app/webapi-bps-status/__tests__/OverallStatusCard.test.tsx`

- [ ] **Step 1: Tulis failing test**

Create `backend/admin/app/webapi-bps-status/__tests__/OverallStatusCard.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import OverallStatusCard from "../_components/OverallStatusCard";
import type { StatusResponse } from "../types";

function mkStatus(o: Partial<StatusResponse> = {}): StatusResponse {
  return {
    overall: "UP",
    lastProbeAt: "2026-05-24T03:00:00.000Z",
    lastProbeRunId: "abc",
    uptime24h: 0.9931,
    p50LatencyMs24h: 287,
    p95LatencyMs24h: 1240,
    totalProbes24h: 96,
    failedProbes24h: 4,
    perFamily: [],
    circuit: { state: "CLOSED", failureCount: 0, lastFailureAt: null, nextAttemptAt: null },
    apiKeyPresent: true,
    ...o,
  };
}

describe("OverallStatusCard", () => {
  it("renders UP state in green", () => {
    render(<OverallStatusCard status={mkStatus()} />);
    expect(screen.getByText(/UP/i)).toBeInTheDocument();
    expect(screen.getByText(/99\.31/)).toBeInTheDocument();
  });

  it("renders DOWN state in red", () => {
    render(<OverallStatusCard status={mkStatus({ overall: "DOWN" })} />);
    expect(screen.getByText(/DOWN/i)).toBeInTheDocument();
  });

  it("renders UNKNOWN when api key missing", () => {
    render(<OverallStatusCard status={mkStatus({ overall: "UNKNOWN", apiKeyPresent: false })} />);
    expect(screen.getByText(/UNKNOWN/i)).toBeInTheDocument();
    expect(screen.getByText(/API key BPS belum/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
cd backend/admin && npx vitest run app/webapi-bps-status/__tests__/OverallStatusCard.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement component**

Create `backend/admin/app/webapi-bps-status/_components/OverallStatusCard.tsx`:

```tsx
"use client";
import { CheckCircle, XCircle, AlertCircle, HelpCircle } from "lucide-react";
import { formatDateTime, formatPercent, formatNumber } from "@/lib/formatters";
import type { StatusResponse } from "../types";

interface Props {
  status: StatusResponse;
}

const colorByOverall: Record<string, string> = {
  UP:        "text-green-600 border-green-300 bg-green-50",
  DEGRADED:  "text-amber-600 border-amber-300 bg-amber-50",
  DOWN:      "text-red-600   border-red-300   bg-red-50",
  UNKNOWN:   "text-gray-600  border-gray-300  bg-gray-50",
};

const IconByOverall: Record<string, React.ComponentType<{ className?: string }>> = {
  UP:       CheckCircle,
  DEGRADED: AlertCircle,
  DOWN:     XCircle,
  UNKNOWN:  HelpCircle,
};

export default function OverallStatusCard({ status }: Props) {
  const Icon = IconByOverall[status.overall] || HelpCircle;
  const cls = colorByOverall[status.overall] || colorByOverall.UNKNOWN;

  return (
    <div className={`rounded-2xl border p-4 ${cls}`}>
      <div className="flex items-center gap-3">
        <Icon className="h-8 w-8" />
        <div>
          <div className="text-xs uppercase tracking-wide opacity-70">Status</div>
          <div className="text-2xl font-bold">{status.overall}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="opacity-60">Uptime 24h</div>
          <div className="font-semibold">
            {status.uptime24h != null ? formatPercent(status.uptime24h) : "-"}
          </div>
        </div>
        <div>
          <div className="opacity-60">p95 latency</div>
          <div className="font-semibold">
            {status.p95LatencyMs24h != null ? `${formatNumber(status.p95LatencyMs24h)} ms` : "-"}
          </div>
        </div>
        <div>
          <div className="opacity-60">Probe terakhir</div>
          <div className="font-semibold">
            {status.lastProbeAt ? formatDateTime(status.lastProbeAt) : "-"}
          </div>
        </div>
        <div>
          <div className="opacity-60">Total 24h</div>
          <div className="font-semibold">
            {formatNumber(status.totalProbes24h)} ({formatNumber(status.failedProbes24h)} gagal)
          </div>
        </div>
      </div>

      {!status.apiKeyPresent && (
        <div className="mt-3 rounded-lg bg-yellow-100 px-3 py-2 text-xs text-yellow-900">
          API key BPS belum di-konfigurasi. Set <code>BPS_API_KEY</code> di <code>.env</code>.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run — should pass**

```bash
cd backend/admin && npx vitest run app/webapi-bps-status/__tests__/OverallStatusCard.test.tsx
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/admin/app/webapi-bps-status/_components/OverallStatusCard.tsx backend/admin/app/webapi-bps-status/__tests__/OverallStatusCard.test.tsx
git commit -m "feat(admin): add OverallStatusCard component"
```

---

## Task 16: `CircuitBreakerCard` component

**Files:**
- Create: `backend/admin/app/webapi-bps-status/_components/CircuitBreakerCard.tsx`

- [ ] **Step 1: Implement**

Create `backend/admin/app/webapi-bps-status/_components/CircuitBreakerCard.tsx`:

```tsx
"use client";
import { Zap, ShieldOff, Shield, AlertTriangle } from "lucide-react";
import { formatDateTime } from "@/lib/formatters";
import type { CircuitSummary } from "../types";

interface Props {
  circuit: CircuitSummary;
}

const colorByState: Record<string, string> = {
  CLOSED:    "text-green-600 border-green-300 bg-green-50",
  OPEN:      "text-red-600   border-red-300   bg-red-50",
  HALF_OPEN: "text-amber-600 border-amber-300 bg-amber-50",
};

const IconByState: Record<string, React.ComponentType<{ className?: string }>> = {
  CLOSED:    Shield,
  OPEN:      ShieldOff,
  HALF_OPEN: AlertTriangle,
};

export default function CircuitBreakerCard({ circuit }: Props) {
  const Icon = IconByState[circuit.state] || Shield;
  const cls = colorByState[circuit.state] || colorByState.CLOSED;

  return (
    <div className={`rounded-2xl border p-4 ${cls}`}>
      <div className="flex items-center gap-3">
        <Icon className="h-8 w-8" />
        <div>
          <div className="text-xs uppercase tracking-wide opacity-70">Circuit Breaker</div>
          <div className="text-2xl font-bold">{circuit.state}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="opacity-60">Failure count</div>
          <div className="font-semibold">{circuit.failureCount}</div>
        </div>
        <div>
          <div className="opacity-60">Last failure</div>
          <div className="font-semibold">{circuit.lastFailureAt ? formatDateTime(circuit.lastFailureAt) : "-"}</div>
        </div>
        <div className="col-span-2">
          <div className="opacity-60">Next attempt</div>
          <div className="font-semibold">{circuit.nextAttemptAt ? formatDateTime(circuit.nextAttemptAt) : "-"}</div>
        </div>
      </div>

      <div className="mt-3 text-xs opacity-70">
        Status read-only dari <code>bpsAPICircuit</code> singleton. Hanya probe yang menulis ke state ini saat ini.
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify (no test required — pure render)**

```bash
cd backend/admin && npx tsc --noEmit app/webapi-bps-status/_components/CircuitBreakerCard.tsx
```

Expected: no output (success). If errors → fix and retry.

- [ ] **Step 3: Commit**

```bash
git add backend/admin/app/webapi-bps-status/_components/CircuitBreakerCard.tsx
git commit -m "feat(admin): add CircuitBreakerCard component"
```

---

## Task 17: `PerFamilyTable` component

**Files:**
- Create: `backend/admin/app/webapi-bps-status/_components/PerFamilyTable.tsx`

- [ ] **Step 1: Implement**

Create `backend/admin/app/webapi-bps-status/_components/PerFamilyTable.tsx`:

```tsx
"use client";
import { CheckCircle, XCircle, MinusCircle } from "lucide-react";
import { formatDateTime, formatNumber } from "@/lib/formatters";
import type { PerFamilySummary } from "../types";

interface Props {
  perFamily: PerFamilySummary[];
}

export default function PerFamilyTable({ perFamily }: Props) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="font-semibold">Status per Famili Endpoint</h3>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr className="text-left">
            <th className="px-4 py-2">Family</th>
            <th className="px-4 py-2 text-center">Status</th>
            <th className="px-4 py-2 text-right">Latency</th>
            <th className="px-4 py-2">Error</th>
            <th className="px-4 py-2">Checked</th>
          </tr>
        </thead>
        <tbody>
          {perFamily.map(f => (
            <tr key={f.family} className="border-t border-border">
              <td className="px-4 py-2 font-mono">{f.family}</td>
              <td className="px-4 py-2 text-center">
                {f.lastOk === null
                  ? <MinusCircle className="inline h-4 w-4 text-gray-400" />
                  : f.lastOk
                    ? <CheckCircle className="inline h-4 w-4 text-green-600" />
                    : <XCircle className="inline h-4 w-4 text-red-600" />}
              </td>
              <td className="px-4 py-2 text-right text-muted-foreground">
                {f.lastLatencyMs != null ? `${formatNumber(f.lastLatencyMs)} ms` : "-"}
              </td>
              <td className="px-4 py-2 text-muted-foreground">{f.lastErrorCode || "-"}</td>
              <td className="px-4 py-2 text-muted-foreground">{f.lastCheckedAt ? formatDateTime(f.lastCheckedAt) : "-"}</td>
            </tr>
          ))}
          {perFamily.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Belum ada data probe</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Type-check & commit**

```bash
cd backend/admin && npx tsc --noEmit app/webapi-bps-status/_components/PerFamilyTable.tsx
git add backend/admin/app/webapi-bps-status/_components/PerFamilyTable.tsx
git commit -m "feat(admin): add PerFamilyTable component"
```

---

## Task 18: `HistoryChart` component (TDD — SVG inline)

**Files:**
- Create: `backend/admin/app/webapi-bps-status/_components/HistoryChart.tsx`
- Create: `backend/admin/app/webapi-bps-status/__tests__/HistoryChart.test.tsx`

- [ ] **Step 1: Tulis test**

Create `backend/admin/app/webapi-bps-status/__tests__/HistoryChart.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import HistoryChart from "../_components/HistoryChart";
import type { HistoryBucket } from "../types";

function mkBuckets(n: number, failedAt: number[] = []): HistoryBucket[] {
  return Array.from({ length: n }, (_, i) => ({
    t: new Date(Date.now() - (n - i) * 3600_000).toISOString(),
    probes: 4,
    failed: failedAt.includes(i) ? 4 : 0,
    p95LatencyMs: 300,
  }));
}

describe("HistoryChart", () => {
  it("renders N bars for N buckets", () => {
    const { container } = render(<HistoryChart buckets={mkBuckets(24)} />);
    expect(container.querySelectorAll("rect")).toHaveLength(24);
  });

  it("renders empty state when no buckets", () => {
    const { container } = render(<HistoryChart buckets={[]} />);
    expect(container.textContent).toMatch(/Belum ada data/i);
  });

  it("colors failed-bucket red", () => {
    const { container } = render(<HistoryChart buckets={mkBuckets(3, [1])} />);
    const rects = container.querySelectorAll("rect");
    expect(rects[1].getAttribute("fill")).toMatch(/red|#dc2626|#ef4444/);
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
cd backend/admin && npx vitest run app/webapi-bps-status/__tests__/HistoryChart.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `backend/admin/app/webapi-bps-status/_components/HistoryChart.tsx`:

```tsx
"use client";
import type { HistoryBucket } from "../types";

interface Props {
  buckets: HistoryBucket[];
}

const BAR_W = 16;
const BAR_GAP = 2;
const H = 80;

function colorFor(failed: number, probes: number): string {
  if (probes === 0) return "#e5e7eb";
  const ratio = failed / probes;
  if (ratio === 0) return "#16a34a"; // green-600
  if (ratio <= 0.25) return "#f59e0b"; // amber-500
  return "#dc2626"; // red-600
}

export default function HistoryChart({ buckets }: Props) {
  if (buckets.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="text-sm text-muted-foreground">Belum ada data 24 jam terakhir.</div>
      </div>
    );
  }

  const width = buckets.length * (BAR_W + BAR_GAP);

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">Failed Probes (24h)</h3>
        <div className="text-xs text-muted-foreground">
          Tiap bar = 1 jam · merah = &gt;25% gagal · kuning = ≤25% · hijau = OK
        </div>
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${width} ${H}`} preserveAspectRatio="none">
        {buckets.map((b, i) => {
          const h = b.probes === 0 ? 4 : Math.max(4, (b.failed / b.probes) * (H - 4));
          return (
            <rect
              key={b.t}
              x={i * (BAR_W + BAR_GAP)}
              y={H - h}
              width={BAR_W}
              height={h}
              fill={colorFor(b.failed, b.probes)}
            >
              <title>{`${new Date(b.t).toLocaleString("id-ID")} — ${b.failed}/${b.probes} gagal`}</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}
```

- [ ] **Step 4: Run — should pass**

```bash
cd backend/admin && npx vitest run app/webapi-bps-status/__tests__/HistoryChart.test.tsx
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/admin/app/webapi-bps-status/_components/HistoryChart.tsx backend/admin/app/webapi-bps-status/__tests__/HistoryChart.test.tsx
git commit -m "feat(admin): add HistoryChart inline SVG"
```

---

## Task 19: `ProbeLogTable` component

**Files:**
- Create: `backend/admin/app/webapi-bps-status/_components/ProbeLogTable.tsx`

- [ ] **Step 1: Implement**

Create `backend/admin/app/webapi-bps-status/_components/ProbeLogTable.tsx`:

```tsx
"use client";
import { CheckCircle, XCircle, Filter } from "lucide-react";
import { DataTable, OffsetPagination } from "@/components/ui";
import type { Column } from "@/components/ui/DataTable";
import { formatDateTime, formatNumber, truncate } from "@/lib/formatters";
import type { ProbeLog, EndpointFamily } from "../types";

interface Props {
  logs: ProbeLog[];
  total: number;
  offset: number;
  limit: number;
  loading: boolean;
  onOffsetChange: (n: number) => void;
  familyFilter: EndpointFamily | "";
  setFamilyFilter: (v: EndpointFamily | "") => void;
  statusFilter: "" | "ok" | "error";
  setStatusFilter: (v: "" | "ok" | "error") => void;
  kindFilter: "" | "scheduled" | "manual";
  setKindFilter: (v: "" | "scheduled" | "manual") => void;
}

const columns: Column<ProbeLog>[] = [
  { key: "id", label: "ID", render: (l) => <span className="font-mono text-xs">{l.id}</span> },
  { key: "created_at", label: "Waktu", render: (l) => <span className="text-xs">{formatDateTime(l.created_at)}</span> },
  { key: "probe_kind", label: "Kind", render: (l) => <span className="text-xs">{l.probe_kind}</span> },
  { key: "endpoint_family", label: "Family", render: (l) => <span className="font-mono text-xs">{l.endpoint_family}</span> },
  {
    key: "ok", label: "Status", className: "text-center",
    render: (l) => l.ok
      ? <CheckCircle className="inline h-4 w-4 text-green-600" />
      : <XCircle className="inline h-4 w-4 text-red-600" />,
  },
  {
    key: "http_status", label: "HTTP",
    render: (l) => <span className="font-mono text-xs">{l.http_status ?? "-"}</span>,
  },
  {
    key: "latency_ms", label: "Latency",
    render: (l) => <span className="text-xs">{l.latency_ms != null ? `${formatNumber(l.latency_ms)} ms` : "-"}</span>,
  },
  {
    key: "error_code", label: "Error",
    render: (l) => <span className="text-xs">{l.error_code || "-"}</span>,
  },
  {
    key: "error_message", label: "Message",
    render: (l) => l.error_message
      ? <span className="block max-w-md truncate text-xs text-muted-foreground" title={l.error_message}>{truncate(l.error_message, 80)}</span>
      : <span className="text-xs text-muted-foreground">-</span>,
  },
];

export default function ProbeLogTable(props: Props) {
  const {
    logs, total, offset, limit, loading, onOffsetChange,
    familyFilter, setFamilyFilter, statusFilter, setStatusFilter, kindFilter, setKindFilter,
  } = props;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-border bg-card">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <select
          value={familyFilter}
          onChange={(e) => setFamilyFilter(e.target.value as EndpointFamily | "")}
          className="px-3 py-1.5 rounded-lg border border-border bg-background"
        >
          <option value="">Semua Family</option>
          <option value="domain">domain</option>
          <option value="var">var</option>
          <option value="th">th</option>
          <option value="pressrelease">pressrelease</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "" | "ok" | "error")}
          className="px-3 py-1.5 rounded-lg border border-border bg-background"
        >
          <option value="">Semua Status</option>
          <option value="ok">OK</option>
          <option value="error">Error</option>
        </select>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as "" | "scheduled" | "manual")}
          className="px-3 py-1.5 rounded-lg border border-border bg-background"
        >
          <option value="">Semua Kind</option>
          <option value="scheduled">scheduled</option>
          <option value="manual">manual</option>
        </select>
        {(familyFilter || statusFilter || kindFilter) && (
          <button
            onClick={() => { setFamilyFilter(""); setStatusFilter(""); setKindFilter(""); }}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Reset filter
          </button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={logs}
        keyField="id"
        loading={loading}
        loadingRows={10}
        emptyMessage="Tidak ada log probe"
      />

      <OffsetPagination
        offset={offset}
        limit={limit}
        total={total}
        onOffsetChange={onOffsetChange}
      />
    </div>
  );
}
```

- [ ] **Step 2: Type-check & commit**

```bash
cd backend/admin && npx tsc --noEmit app/webapi-bps-status/_components/ProbeLogTable.tsx
git add backend/admin/app/webapi-bps-status/_components/ProbeLogTable.tsx
git commit -m "feat(admin): add ProbeLogTable with family/status/kind filters"
```

---

## Task 20: `ProbeNowButton` component (TDD — 409/429 handling)

**Files:**
- Create: `backend/admin/app/webapi-bps-status/_components/ProbeNowButton.tsx`
- Create: `backend/admin/app/webapi-bps-status/__tests__/ProbeNowButton.test.tsx`

- [ ] **Step 1: Tulis test**

Create `backend/admin/app/webapi-bps-status/__tests__/ProbeNowButton.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProbeNowButton from "../_components/ProbeNowButton";

vi.mock("@/lib/axios", () => ({
  api: { post: vi.fn() },
}));

const { api } = await import("@/lib/axios");

function withQuery(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe("ProbeNowButton", () => {
  beforeEach(() => vi.clearAllMocks());

  it("triggers probe on click and shows success message", async () => {
    (api.post as any).mockResolvedValueOnce({ data: { runId: "x", overall: "UP", durationMs: 100, perFamily: [] } });
    render(withQuery(<ProbeNowButton />));
    fireEvent.click(screen.getByRole("button", { name: /Probe Sekarang/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/webapi-bps/probe"));
  });

  it("shows 409 message when probe already running", async () => {
    const err: any = new Error("409");
    err.response = { status: 409, data: { reason: "probe_already_running" } };
    (api.post as any).mockRejectedValueOnce(err);
    render(withQuery(<ProbeNowButton />));
    fireEvent.click(screen.getByRole("button", { name: /Probe Sekarang/i }));
    await waitFor(() => expect(screen.getByText(/Probe sedang berjalan/i)).toBeInTheDocument());
  });

  it("shows 429 message when rate limited", async () => {
    const err: any = new Error("429");
    err.response = { status: 429 };
    (api.post as any).mockRejectedValueOnce(err);
    render(withQuery(<ProbeNowButton />));
    fireEvent.click(screen.getByRole("button", { name: /Probe Sekarang/i }));
    await waitFor(() => expect(screen.getByText(/Terlalu banyak probe/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run — should fail**

```bash
cd backend/admin && npx vitest run app/webapi-bps-status/__tests__/ProbeNowButton.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `backend/admin/app/webapi-bps-status/_components/ProbeNowButton.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import { api } from "@/lib/axios";
import { getErrorMessage, isHttpError } from "@/lib/errors";
import type { ProbeResult } from "../types";

export default function ProbeNowButton() {
  const qc = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [variant, setVariant] = useState<"success" | "warning" | "error">("success");

  const mutation = useMutation<ProbeResult, unknown>({
    mutationFn: () => api.post("/webapi-bps/probe").then(r => r.data as ProbeResult),
    onSuccess: (data) => {
      setVariant("success");
      setMessage(`Probe selesai: ${data.overall} (${data.durationMs}ms)`);
      qc.invalidateQueries({ queryKey: ["webapi-bps", "status"] });
      qc.invalidateQueries({ queryKey: ["webapi-bps", "history"] });
      qc.invalidateQueries({ queryKey: ["webapi-bps", "logs"] });
      setTimeout(() => setMessage(null), 5000);
    },
    onError: (e) => {
      if (isHttpError(e, 409)) {
        setVariant("warning");
        setMessage("Probe sedang berjalan, tunggu sebentar");
      } else if (isHttpError(e, 429)) {
        setVariant("warning");
        setMessage("Terlalu banyak probe manual, coba 1 menit lagi");
      } else {
        setVariant("error");
        setMessage(getErrorMessage(e, "Probe gagal"));
      }
      setTimeout(() => setMessage(null), 6000);
    },
  });

  const variantClasses: Record<string, string> = {
    success: "bg-green-100 text-green-900",
    warning: "bg-yellow-100 text-yellow-900",
    error:   "bg-red-100   text-red-900",
  };

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        <Zap className={`h-4 w-4 ${mutation.isPending ? "animate-pulse" : ""}`} />
        <span>Probe Sekarang</span>
      </button>
      {message && (
        <span className={`text-xs px-3 py-1 rounded-lg ${variantClasses[variant]}`}>{message}</span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run — should pass**

```bash
cd backend/admin && npx vitest run app/webapi-bps-status/__tests__/ProbeNowButton.test.tsx
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/admin/app/webapi-bps-status/_components/ProbeNowButton.tsx backend/admin/app/webapi-bps-status/__tests__/ProbeNowButton.test.tsx
git commit -m "feat(admin): add ProbeNowButton with 409/429 handling"
```

---

## Task 21: Page entry `page.tsx`

**Files:**
- Create: `backend/admin/app/webapi-bps-status/page.tsx`

- [ ] **Step 1: Implement**

Create `backend/admin/app/webapi-bps-status/page.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, RefreshCw } from "lucide-react";
import RequireAuth from "@/components/RequireAuth";
import { AsyncStateMessages } from "@/components/ui";
import { useOffsetPagination } from "@/hooks";
import { api } from "@/lib/axios";
import { getErrorMessage } from "@/lib/errors";
import OverallStatusCard from "./_components/OverallStatusCard";
import CircuitBreakerCard from "./_components/CircuitBreakerCard";
import PerFamilyTable from "./_components/PerFamilyTable";
import HistoryChart from "./_components/HistoryChart";
import ProbeLogTable from "./_components/ProbeLogTable";
import ProbeNowButton from "./_components/ProbeNowButton";
import type { StatusResponse, HistoryResponse, LogsResponse, EndpointFamily } from "./types";

export default function WebapiBpsStatusPage() {
  const pagination = useOffsetPagination(50);
  const [familyFilter, setFamilyFilter] = useState<EndpointFamily | "">("");
  const [statusFilter, setStatusFilter] = useState<"" | "ok" | "error">("");
  const [kindFilter, setKindFilter] = useState<"" | "scheduled" | "manual">("");

  const status = useQuery<StatusResponse>({
    queryKey: ["webapi-bps", "status"],
    queryFn: () => api.get("/webapi-bps/status").then(r => r.data),
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const history = useQuery<HistoryResponse>({
    queryKey: ["webapi-bps", "history", 24, "1h"],
    queryFn: () => api.get("/webapi-bps/history?hours=24&bucket=1h").then(r => r.data),
    refetchInterval: 60_000,
  });

  const logs = useQuery<LogsResponse>({
    queryKey: ["webapi-bps", "logs", familyFilter, statusFilter, kindFilter, pagination.offset, pagination.limit],
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set("limit", String(pagination.limit));
      qs.set("offset", String(pagination.offset));
      if (familyFilter) qs.set("family", familyFilter);
      if (statusFilter) qs.set("status", statusFilter);
      if (kindFilter) qs.set("kind", kindFilter);
      return api.get(`/webapi-bps/logs?${qs.toString()}`).then(r => {
        pagination.setTotal(r.data.total);
        return r.data;
      });
    },
    placeholderData: (prev) => prev,
  });

  const error = [status.error, history.error, logs.error]
    .map(e => e ? getErrorMessage(e, "Gagal memuat") : null)
    .filter(Boolean)[0] as string | undefined;

  return (
    <RequireAuth>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Activity className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Status WebAPI BPS</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { status.refetch(); history.refetch(); logs.refetch(); }}
              disabled={status.isFetching || history.isFetching || logs.isFetching}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${(status.isFetching || history.isFetching || logs.isFetching) ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <ProbeNowButton />
          </div>
        </div>

        {error && <AsyncStateMessages error={error} success="" onClearError={() => {}} onClearSuccess={() => {}} />}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {status.data
            ? <OverallStatusCard status={status.data} />
            : <div className="rounded-2xl border border-border bg-card p-4 h-40 animate-pulse" />}
          {status.data
            ? <CircuitBreakerCard circuit={status.data.circuit} />
            : <div className="rounded-2xl border border-border bg-card p-4 h-40 animate-pulse" />}
        </div>

        <HistoryChart buckets={history.data?.buckets || []} />

        <PerFamilyTable perFamily={status.data?.perFamily || []} />

        <ProbeLogTable
          logs={logs.data?.logs || []}
          total={pagination.total}
          offset={pagination.offset}
          limit={pagination.limit}
          loading={logs.isLoading}
          onOffsetChange={pagination.setOffset}
          familyFilter={familyFilter}
          setFamilyFilter={(v) => { setFamilyFilter(v); pagination.reset(); }}
          statusFilter={statusFilter}
          setStatusFilter={(v) => { setStatusFilter(v); pagination.reset(); }}
          kindFilter={kindFilter}
          setKindFilter={(v) => { setKindFilter(v); pagination.reset(); }}
        />
      </div>
    </RequireAuth>
  );
}
```

- [ ] **Step 2: Build (catch type errors)**

```bash
cd backend/admin && npm run build 2>&1 | tail -30
```

Expected: build succeeds. If error → fix imports/types and rebuild.

- [ ] **Step 3: Commit**

```bash
git add backend/admin/app/webapi-bps-status/page.tsx
git commit -m "feat(admin): add /webapi-bps-status page entry"
```

---

## Task 22: Sidebar entry

**Files:**
- Modify: `backend/admin/components/Sidebar.tsx`

- [ ] **Step 1: Backup & locate Tools group**

```bash
cp backend/admin/components/Sidebar.tsx backend/admin/components/Sidebar.tsx.backup
grep -n "fetch-logs\|Tools\|FileText\|Activity" backend/admin/components/Sidebar.tsx | head -10
```

- [ ] **Step 2: Add link**

Edit `backend/admin/components/Sidebar.tsx`. Find the line:
```tsx
{ href: "/fetch-logs", label: "Fetch Logs", icon: <FileText className="h-4 w-4" /> },
```

Add directly above it (so it appears first in Tools group):
```tsx
{ href: "/webapi-bps-status", label: "Status WebAPI BPS", icon: <Activity className="h-4 w-4" /> },
```

If `Activity` is not yet imported from `lucide-react` at the top of the file:
```tsx
import { ..., Activity } from "lucide-react";
```

(Find the existing `lucide-react` import line and add `Activity` to it.)

- [ ] **Step 3: Build & verify**

```bash
cd backend/admin && npm run build 2>&1 | tail -10
diff backend/admin/components/Sidebar.tsx.backup backend/admin/components/Sidebar.tsx
rm backend/admin/components/Sidebar.tsx.backup
```

- [ ] **Step 4: Reload admin & smoke-test page loads in browser**

```bash
pm2 reload pds-admin --update-env
```

Open `https://api-malika.bpsmalut.com/backend/webapi-bps-status` di browser. Expected: halaman render dengan card "UP" (atau "UNKNOWN" kalau belum ada probe yang jalan).

- [ ] **Step 5: Commit**

```bash
git add backend/admin/components/Sidebar.tsx
git commit -m "feat(admin): add Status WebAPI BPS entry to Tools sidebar"
```

---

## Task 23: Docs update — `admin.md` & `backend.md`

**Files:**
- Modify: `docs/workspace/admin.md`
- Modify: `docs/workspace/backend.md`

- [ ] **Step 1: Backup**

```bash
cp docs/workspace/admin.md docs/workspace/admin.md.backup
cp docs/workspace/backend.md docs/workspace/backend.md.backup
```

- [ ] **Step 2: Update `admin.md`**

In `docs/workspace/admin.md`:

- Change `## Pages (27 total)` → `## Pages (28 total)`
- In the "Tools" line, add `/webapi-bps-status` between `/fetch-logs` and `/audit-logs`:
  ```
  Tools: `/search-test`, `/intent-stats`, `/webapi-bps-status`, `/fetch-logs`, `/audit-logs`, ...
  ```
- Add row to Change Log:
  ```
  | 2026-05-24 | New page /webapi-bps-status: WebAPI BPS health probe + dashboard | spec 2026-05-24 |
  ```

- [ ] **Step 3: Update `backend.md`**

In `docs/workspace/backend.md`, add to relevant section (services or routes list):
- New service `services/webapiBpsHealth/` (probeTargets, probe, scheduler)
- New route `routes/webapiBps.routes.js` → `/webapi-bps/{status,history,logs,probe}`
- New table `webapi_health_logs`
- Add change-log entry dated 2026-05-24

(Read the file structure first to follow existing conventions.)

- [ ] **Step 4: Commit**

```bash
diff docs/workspace/admin.md.backup docs/workspace/admin.md
diff docs/workspace/backend.md.backup docs/workspace/backend.md
rm docs/workspace/admin.md.backup docs/workspace/backend.md.backup
git add docs/workspace/admin.md docs/workspace/backend.md
git commit -m "docs(workspace): document /webapi-bps-status page + service"
```

---

## Task 24: End-to-end smoke test + verify `STABLE_VAR_ID`

**Files:**
- Possibly modify: `backend/src/services/webapiBpsHealth/probeTargets.js` (kalau VAR_ID default 13 ternyata tidak valid)

- [ ] **Step 1: Trigger manual probe via curl**

Login dulu di admin browser, dapatkan session cookie. Atau via API:

```bash
# Cara 1: via browser dev tools (klik tombol Probe Sekarang di halaman)
# Cara 2: via curl dengan cookie (lebih lambat — skip kalau via browser)
```

Setelah klik tombol, periksa response.

- [ ] **Step 2: Verifikasi semua 4 famili ok=1**

```bash
mysql -u <DB_USER> -p<DB_PASSWORD> <DB_NAME> -e "
  SELECT endpoint_family, ok, error_code, http_status, latency_ms
  FROM webapi_health_logs
  ORDER BY id DESC LIMIT 4;
"
```

Expected: 4 rows, semua `ok=1`.

- [ ] **Step 3: Jika famili `th` gagal — VAR_ID tidak valid**

Jika hanya `th` yang gagal (HTTP 200 tapi data kosong, atau 404):

```bash
cp backend/src/services/webapiBpsHealth/probeTargets.js backend/src/services/webapiBpsHealth/probeTargets.js.backup
```

Cari VAR_ID yang valid:
```bash
# Manual: cek webapi.bps.go.id docs untuk domain 8200, atau via curl dengan key Anda:
curl "https://webapi.bps.go.id/v1/api/list/model/var/lang/ind/domain/8200/key/<YOUR_KEY>/page/1" | head -200
```

Pilih satu VAR_ID dari hasil list. Update di `probeTargets.js`:
```js
const STABLE_VAR_ID = '<NILAI BARU>';
```

```bash
pm2 reload pds-backend --update-env
# Trigger probe lagi via tombol UI
diff backend/src/services/webapiBpsHealth/probeTargets.js.backup backend/src/services/webapiBpsHealth/probeTargets.js
rm backend/src/services/webapiBpsHealth/probeTargets.js.backup
git add backend/src/services/webapiBpsHealth/probeTargets.js
git commit -m "fix(probe): set STABLE_VAR_ID to <NILAI> (verified stable in domain 8200)"
```

- [ ] **Step 4: Verifikasi UI**

Buka `https://api-malika.bpsmalut.com/backend/webapi-bps-status`:
- [ ] OverallStatusCard menampilkan **UP** hijau
- [ ] CircuitBreakerCard menampilkan **CLOSED** hijau
- [ ] PerFamilyTable: 4 row, semua hijau check
- [ ] HistoryChart: minimal 1 bar terlihat (probe manual yang baru saja)
- [ ] ProbeLogTable: 4+ entries terbaru
- [ ] Tombol "Probe Sekarang" trigger probe + invalidate queries (data refresh)
- [ ] Klik 7× cepat → toast "Terlalu banyak probe"

- [ ] **Step 5: Verifikasi scheduler hidup**

```bash
pm2 logs pds-backend --lines 100 --nostream | grep -i "webapibpshealth\|webapi-bps"
```

Expected line saat startup: `WebAPI BPS health scheduler started`. Setelah 15 menit pertama berjalan: `Scheduled probe OK`.

---

## Self-Review Checklist (oleh implementor sebelum mark plan completed)

- [ ] DDL ter-apply, `DESCRIBE webapi_health_logs` menunjukkan 12 kolom.
- [ ] Semua Jest test pass: `cd backend && npx jest webapiBpsHealth webapiBps`.
- [ ] Semua Vitest test pass: `cd backend/admin && npx vitest run app/webapi-bps-status`.
- [ ] `pm2 logs pds-backend` menunjukkan `WebAPI BPS health scheduler started` saat startup.
- [ ] Halaman `/webapi-bps-status` accessible & render 5 section.
- [ ] Tombol "Probe Sekarang" bekerja; 409 & 429 di-handle.
- [ ] `STABLE_VAR_ID` nilai nyata (bukan default `13` kalau ternyata tidak valid).
- [ ] Sidebar punya entry baru.
- [ ] `admin.md` page count 28.
- [ ] Retention policy `webapi_health_logs: 90d` tertambah.
- [ ] Tidak ada file `.backup` tersisa di repo.
