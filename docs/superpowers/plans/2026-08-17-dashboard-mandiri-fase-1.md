# Dashboard Mandiri — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend read layer that serves a catalog-driven dashboard from the 310 `indikator_*` tables, cached so that refreshed data is served immediately and never staler than the database.

**Architecture:** A shared `services/indicator/` layer (watermark → cache → read) consumed by a thin `services/dashboard/` feature service, exposed at `GET /dashboard/public/summary`. Cache keys embed `MAX(last_update)` of the indicator's own table, so new data yields a new key and stale entries are simply never read again. No new tables, no migration, no hook in the automation runner.

**Tech Stack:** Node 20, Express 5, Sequelize 6 (two connections: `config/db` → `project_data_strategis`, `config/db_bps` → `data_bps`), `lru-cache`, Jest + Supertest.

**Spec:** `docs/superpowers/specs/2026-08-17-dashboard-mandiri-design.md`

## Global Constraints

- **CommonJS only** in `backend/` (`require` / `module.exports`). No ESM.
- **2-space indentation**, no tabs. `'use strict';` at the top of every new service file, matching `services/petaTematik/*`.
- **Never string-concatenate user input into SQL.** Use Sequelize `replacements` with positional `?`, in the same order as the placeholders.
- **Indicator id must be validated** before it reaches a table name. Table names cannot be parameterised, so the id is the injection surface: integer, `> 0`, `<= 99999`.
- **No `Co-Authored-By` trailer** in commits. Stage explicit paths, never `git add -A` — the working tree contains unrelated changes from other sessions.
- **Run backend commands from `backend/`** — but note `frontend/` contains a second, unrelated git repo (`frontend/.git`, the TailAdmin template). Always `cd /var/www/html/project-data-strategis` before any `git` command and confirm `git rev-parse --abbrev-ref HEAD` prints `main`.
- **Province rule (from the spec, non-negotiable):** a province-level figure is emitted **only** when the source provides an explicit province row. Never aggregate kabupaten/kota rows into a provincial number.
- **Phase 1 returns raw values plus formatting metadata** (`unit`, `unitMultiplier`, `decimalPlaces`). It does **not** apply the multiplier. Formatting happens once, in phase 2's frontend helper. Applying it in both places would double-scale the figure.

---

### Task 1: Watermark service

Reads `MAX(last_update)` from an indicator's own table. This one number is what makes every cache below self-invalidating.

**Files:**
- Create: `backend/src/services/indicator/watermark.service.js`
- Test: `backend/src/__tests__/indicator.watermark.test.js`

**Interfaces:**
- Consumes: `config/db_bps` (default-exported factory: `require('../../config/db_bps')()` returns a Sequelize instance or `null`).
- Produces:
  - `validateIndicatorId(id) -> number` (throws `Error('Invalid indikator')`)
  - `tableName(id) -> string` (e.g. `indikator_182`)
  - `async getWatermark(indicatorId) -> number` — epoch ms, `0` when the table is empty or unreadable
  - `clearWatermarkMemo() -> void` (test seam)
  - `MEMO_TTL_MS = 30000`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/indicator.watermark.test.js`:

```js
'use strict';

jest.mock('../config/db_bps', () => {
  const queryMock = jest.fn();
  return jest.fn(() => ({ query: queryMock, _queryMock: queryMock }));
});

const getSequelizeBps = require('../config/db_bps');
const wm = require('../services/indicator/watermark.service');

describe('indicator/watermark.service', () => {
  beforeEach(() => {
    wm.clearWatermarkMemo();
    getSequelizeBps()._queryMock.mockReset();
  });

  test('validateIndicatorId rejects anything that is not a positive integer', () => {
    expect(() => wm.validateIndicatorId('abc')).toThrow('Invalid indikator');
    expect(() => wm.validateIndicatorId(0)).toThrow('Invalid indikator');
    expect(() => wm.validateIndicatorId(-5)).toThrow('Invalid indikator');
    expect(() => wm.validateIndicatorId(1.5)).toThrow('Invalid indikator');
    expect(() => wm.validateIndicatorId(100000)).toThrow('Invalid indikator');
    expect(wm.validateIndicatorId('182')).toBe(182);
  });

  test('returns MAX(last_update) as epoch ms', async () => {
    const when = new Date('2026-06-30T09:00:00Z');
    getSequelizeBps()._queryMock.mockResolvedValueOnce([{ lu: when }]);

    await expect(wm.getWatermark(182)).resolves.toBe(when.getTime());
  });

  test('returns 0 when the table has no rows', async () => {
    getSequelizeBps()._queryMock.mockResolvedValueOnce([{ lu: null }]);
    await expect(wm.getWatermark(182)).resolves.toBe(0);
  });

  test('returns 0 instead of throwing when the query fails', async () => {
    getSequelizeBps()._queryMock.mockRejectedValueOnce(new Error('no such table'));
    await expect(wm.getWatermark(999)).resolves.toBe(0);
  });

  test('memoises so a page of cards does not issue one query per card', async () => {
    const m = getSequelizeBps()._queryMock;
    m.mockResolvedValueOnce([{ lu: new Date('2026-06-30T09:00:00Z') }]);

    await wm.getWatermark(182);
    await wm.getWatermark(182);
    await wm.getWatermark(182);

    expect(m).toHaveBeenCalledTimes(1);
  });

  test('memo is per-indicator, not global', async () => {
    const m = getSequelizeBps()._queryMock;
    m.mockResolvedValueOnce([{ lu: new Date('2026-01-01T00:00:00Z') }]);
    m.mockResolvedValueOnce([{ lu: new Date('2026-02-02T00:00:00Z') }]);

    const a = await wm.getWatermark(182);
    const b = await wm.getWatermark(183);

    expect(a).not.toBe(b);
    expect(m).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest src/__tests__/indicator.watermark.test.js`
Expected: FAIL — `Cannot find module '../services/indicator/watermark.service'`

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/indicator/watermark.service.js`:

```js
'use strict';

/**
 * Data-freshness watermark for one indicator.
 *
 * Every `indikator_NNN` table carries its own `last_update`. Reading MAX() of it
 * costs ~6ms and tells us exactly when the automation runner last wrote to that
 * indicator. Cache keys built on this number invalidate themselves: new data
 * produces a new watermark, hence a new key, and the stale entry is simply never
 * read again. See docs/superpowers/specs/2026-08-17-dashboard-mandiri-design.md.
 */

const getSequelizeBps = require('../../config/db_bps');
const { QueryTypes } = require('sequelize');

/** A 40-card page would otherwise issue 40 watermark queries per render. */
const MEMO_TTL_MS = 30000;

const memo = new Map(); // indicatorId -> { value, expiresAt }

function validateIndicatorId(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0 || n > 99999) {
    throw new Error('Invalid indikator');
  }
  return n;
}

/** Table names cannot be parameterised, so the id is validated first. */
function tableName(id) {
  return `indikator_${validateIndicatorId(id)}`;
}

function clearWatermarkMemo() {
  memo.clear();
}

async function getWatermark(indicatorId) {
  const id = validateIndicatorId(indicatorId);
  const hit = memo.get(id);
  const now = Date.now();
  if (hit && hit.expiresAt > now) return hit.value;

  let value = 0;
  try {
    const seq = getSequelizeBps();
    if (seq) {
      const rows = await seq.query(
        `SELECT MAX(last_update) AS lu FROM \`${tableName(id)}\``,
        { type: QueryTypes.SELECT }
      );
      const lu = rows && rows[0] ? rows[0].lu : null;
      value = lu ? new Date(lu).getTime() : 0;
    }
  } catch {
    // An unreadable indicator must not take the dashboard down. 0 is a valid
    // watermark: it simply means "nothing known", and the caller still caches.
    value = 0;
  }

  memo.set(id, { value, expiresAt: now + MEMO_TTL_MS });
  return value;
}

module.exports = {
  validateIndicatorId,
  tableName,
  getWatermark,
  clearWatermarkMemo,
  MEMO_TTL_MS,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx jest src/__tests__/indicator.watermark.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
cd /var/www/html/project-data-strategis
git rev-parse --abbrev-ref HEAD   # must print: main
git add backend/src/services/indicator/watermark.service.js backend/src/__tests__/indicator.watermark.test.js
git commit -m "feat(indicator): watermark service dari MAX(last_update)"
```

---

### Task 2: Watermark-keyed cache

**Files:**
- Create: `backend/src/services/indicator/cache.js`
- Test: `backend/src/__tests__/indicator.cache.test.js`

**Interfaces:**
- Consumes: `lru-cache` (already a dependency — used by `services/petaTematik/cache.service.js`).
- Produces:
  - `buildKey(namespace, indicatorId, watermarkMs, ...parts) -> string`
  - `async getOrCompute(namespace, indicatorId, watermarkMs, parts, computeFn) -> any`
  - `get(key)`, `set(key, value)`, `clear()`, `size()`
  - `MAX_ENTRIES = 2000`, `TTL_MS = 24 * 60 * 60 * 1000`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/indicator.cache.test.js`:

```js
'use strict';

const cache = require('../services/indicator/cache');

describe('indicator/cache', () => {
  beforeEach(() => cache.clear());

  test('key includes the watermark so refreshed data cannot collide', () => {
    const a = cache.buildKey('latest', 182, 1000, 'metricA');
    const b = cache.buildKey('latest', 182, 2000, 'metricA');
    expect(a).not.toBe(b);
  });

  test('key is stable for the same inputs', () => {
    expect(cache.buildKey('latest', 182, 1000, 'm')).toBe(cache.buildKey('latest', 182, 1000, 'm'));
  });

  test('computes once and serves the cached value after', async () => {
    const compute = jest.fn().mockResolvedValue({ value: 5 });

    const first = await cache.getOrCompute('latest', 182, 1000, ['m'], compute);
    const second = await cache.getOrCompute('latest', 182, 1000, ['m'], compute);

    expect(first).toEqual({ value: 5 });
    expect(second).toEqual({ value: 5 });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  // This is the freshness guarantee of the whole design, asserted rather than assumed.
  test('a new watermark recomputes instead of serving the old value', async () => {
    const compute = jest.fn()
      .mockResolvedValueOnce({ value: 'old' })
      .mockResolvedValueOnce({ value: 'new' });

    const before = await cache.getOrCompute('latest', 182, 1000, ['m'], compute);
    const after = await cache.getOrCompute('latest', 182, 2000, ['m'], compute);

    expect(before).toEqual({ value: 'old' });
    expect(after).toEqual({ value: 'new' });
    expect(compute).toHaveBeenCalledTimes(2);
  });

  test('caches null results so an empty indicator is not recomputed every request', async () => {
    const compute = jest.fn().mockResolvedValue(null);

    await cache.getOrCompute('latest', 182, 1000, ['m'], compute);
    await cache.getOrCompute('latest', 182, 1000, ['m'], compute);

    expect(compute).toHaveBeenCalledTimes(1);
  });

  test('does not cache a rejection', async () => {
    const compute = jest.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ value: 1 });

    await expect(cache.getOrCompute('latest', 182, 1000, ['m'], compute)).rejects.toThrow('boom');
    await expect(cache.getOrCompute('latest', 182, 1000, ['m'], compute)).resolves.toEqual({ value: 1 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest src/__tests__/indicator.cache.test.js`
Expected: FAIL — `Cannot find module '../services/indicator/cache'`

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/indicator/cache.js`:

```js
'use strict';

/**
 * Watermark-keyed cache shared by the dashboard and peta-tematik.
 *
 * Entries are never invalidated explicitly. The indicator's data watermark is
 * part of the key, so a refresh produces a different key and the previous entry
 * ages out on its own. The long TTL is a memory bound, not a freshness
 * mechanism — freshness comes entirely from the key.
 *
 * Kept behind a four-method interface (get/set/clear/getOrCompute) so this can
 * become Redis in one file. That matters the day PM2 runs more than
 * `instances: 1`: with an in-process cache, two workers hold different values
 * and users see different numbers depending on which one answers.
 */

const { LRUCache } = require('lru-cache');

const MAX_ENTRIES = 2000;
const TTL_MS = 24 * 60 * 60 * 1000;

const lru = new LRUCache({ max: MAX_ENTRIES, ttl: TTL_MS });

/** `undefined` marks a miss, so cached nulls need a sentinel. */
const NULL_SENTINEL = Symbol.for('malika.indicator.cache.null');

function buildKey(namespace, indicatorId, watermarkMs, ...parts) {
  return [namespace, indicatorId, watermarkMs, ...parts.map((p) => (p == null ? '*' : String(p)))].join(':');
}

function get(key) {
  const v = lru.get(key);
  if (v === NULL_SENTINEL) return null;
  return v;
}

function set(key, value) {
  lru.set(key, value === null ? NULL_SENTINEL : value);
}

function clear() {
  lru.clear();
}

function size() {
  return lru.size;
}

async function getOrCompute(namespace, indicatorId, watermarkMs, parts, computeFn) {
  const key = buildKey(namespace, indicatorId, watermarkMs, ...(parts || []));
  const cached = lru.get(key);
  if (cached !== undefined) return cached === NULL_SENTINEL ? null : cached;

  // A rejection is deliberately not cached: a transient DB error must not be
  // pinned for the life of the watermark.
  const fresh = await computeFn();
  set(key, fresh);
  return fresh;
}

module.exports = { buildKey, get, set, clear, size, getOrCompute, MAX_ENTRIES, TTL_MS };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx jest src/__tests__/indicator.cache.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
cd /var/www/html/project-data-strategis
git add backend/src/services/indicator/cache.js backend/src/__tests__/indicator.cache.test.js
git commit -m "feat(indicator): cache berkunci watermark"
```

---

### Task 3: Period helpers (BPS `month_no` sentinels)

"Previous period" must compare like with like. `month_no` is a sentinel set, not a month number, so a naive `ORDER BY year, month_no DESC LIMIT 2` compares Triwulan IV against Tahunan and reports a nonsense delta.

**Files:**
- Create: `backend/src/services/indicator/period.js`
- Test: `backend/src/__tests__/indicator.period.test.js`

**Interfaces:**
- Produces:
  - `periodClass(monthNo) -> 'annual' | 'monthly' | 'quarterly' | 'semester' | 'unknown'`
  - `periodLabel(year, monthNo) -> string` (Indonesian, e.g. `Triwulan II 2026`)
  - `sortPeriodsDesc(rows) -> rows` — rows are `{ year, month_no }`, newest first

Reference (`docs/workspace/database.md`): `0` = unknown/annual rollup, `1`–`12` = months, `31`–`34` = Triwulan I–IV, `35` = Tahunan, `36`–`37` = semester markers (Maret/September, used for Kemiskinan).

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/indicator.period.test.js`:

```js
'use strict';

const p = require('../services/indicator/period');

describe('indicator/period', () => {
  test('classifies the BPS sentinel set', () => {
    expect(p.periodClass(0)).toBe('annual');
    expect(p.periodClass(35)).toBe('annual');
    expect(p.periodClass(1)).toBe('monthly');
    expect(p.periodClass(12)).toBe('monthly');
    expect(p.periodClass(31)).toBe('quarterly');
    expect(p.periodClass(34)).toBe('quarterly');
    expect(p.periodClass(36)).toBe('semester');
    expect(p.periodClass(37)).toBe('semester');
    expect(p.periodClass(99)).toBe('unknown');
    expect(p.periodClass(null)).toBe('annual');
  });

  test('labels periods the way BPS writes them', () => {
    expect(p.periodLabel(2026, 35)).toBe('2026');
    expect(p.periodLabel(2026, 0)).toBe('2026');
    expect(p.periodLabel(2026, 7)).toBe('Juli 2026');
    expect(p.periodLabel(2026, 32)).toBe('Triwulan II 2026');
    expect(p.periodLabel(2026, 36)).toBe('Maret 2026');
    expect(p.periodLabel(2026, 37)).toBe('September 2026');
  });

  test('sorts newest first within a year', () => {
    const rows = [
      { year: 2025, month_no: 34 },
      { year: 2026, month_no: 31 },
      { year: 2026, month_no: 33 },
    ];
    expect(p.sortPeriodsDesc(rows)).toEqual([
      { year: 2026, month_no: 33 },
      { year: 2026, month_no: 31 },
      { year: 2025, month_no: 34 },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest src/__tests__/indicator.period.test.js`
Expected: FAIL — `Cannot find module '../services/indicator/period'`

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/indicator/period.js`:

```js
'use strict';

/**
 * BPS `month_no` is a sentinel set, not a calendar month.
 * See docs/workspace/database.md:
 *   0        unknown / annual rollup
 *   1..12    January..December
 *   31..34   Triwulan I..IV
 *   35       Tahunan
 *   36, 37   semester markers (Maret / September, used for Kemiskinan)
 *
 * Comparing across classes produces nonsense deltas — Triwulan IV against
 * Tahunan is not a quarter-on-quarter change — so callers group by class first.
 */

const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

const ROMAN = ['I', 'II', 'III', 'IV'];

function periodClass(monthNo) {
  const m = monthNo == null ? 0 : Number(monthNo);
  if (m === 0 || m === 35) return 'annual';
  if (m >= 1 && m <= 12) return 'monthly';
  if (m >= 31 && m <= 34) return 'quarterly';
  if (m === 36 || m === 37) return 'semester';
  return 'unknown';
}

function periodLabel(year, monthNo) {
  const m = monthNo == null ? 0 : Number(monthNo);
  const y = String(year);
  switch (periodClass(m)) {
    case 'annual': return y;
    case 'monthly': return `${MONTHS_ID[m - 1]} ${y}`;
    case 'quarterly': return `Triwulan ${ROMAN[m - 31]} ${y}`;
    case 'semester': return `${m === 36 ? 'Maret' : 'September'} ${y}`;
    default: return y;
  }
}

function sortPeriodsDesc(rows) {
  return [...rows].sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year;
    return Number(b.month_no || 0) - Number(a.month_no || 0);
  });
}

module.exports = { periodClass, periodLabel, sortPeriodsDesc, MONTHS_ID };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx jest src/__tests__/indicator.period.test.js`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
cd /var/www/html/project-data-strategis
git add backend/src/services/indicator/period.js backend/src/__tests__/indicator.period.test.js
git commit -m "feat(indicator): helper periode untuk sentinel month_no BPS"
```

---

### Task 4: Read service — province detection and `getLatest`

The correctness heart of the phase. Emits a headline value **only** when the source provides a province row.

**Files:**
- Create: `backend/src/services/indicator/read.service.js`
- Test: `backend/src/__tests__/indicator.read.test.js`

**Interfaces:**
- Consumes: `watermark.service` (`getWatermark`, `tableName`, `validateIndicatorId`), `cache` (`getOrCompute`), `period` (`periodClass`, `periodLabel`, `sortPeriodsDesc`), `services/petaTematik/regionMap.service` (`dimValueToKdkab`).
- Produces:
  - `isProvinceDimValue(dimValue) -> boolean`
  - `isRegionDimValue(dimValue) -> boolean`
  - `async getLatest(indicatorId, { metric }) -> null | { value, year, month_no, periodLabel, scope: 'province' }`

`dimValueToKdkab` returns a kabupaten/kota code for region rows and `null` otherwise — that is the region test. A province row is a `dim_value` matching the province aliases in `shared/geo-regions.json` (`maluku utara`, `malut`, `provinsi maluku utara`, `north maluku`) that is *not* a kabupaten/kota.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/indicator.read.test.js`:

```js
'use strict';

jest.mock('../config/db_bps', () => {
  const queryMock = jest.fn();
  return jest.fn(() => ({ query: queryMock, _queryMock: queryMock }));
});

const getSequelizeBps = require('../config/db_bps');
const cache = require('../services/indicator/cache');
const wm = require('../services/indicator/watermark.service');
const read = require('../services/indicator/read.service');

function mockWatermark(ms) {
  getSequelizeBps()._queryMock.mockResolvedValueOnce([{ lu: new Date(ms) }]);
}

describe('indicator/read.service', () => {
  beforeEach(() => {
    cache.clear();
    wm.clearWatermarkMemo();
    getSequelizeBps()._queryMock.mockReset();
  });

  describe('dim_value classification', () => {
    test('recognises province rows', () => {
      expect(read.isProvinceDimValue('Maluku Utara')).toBe(true);
      expect(read.isProvinceDimValue('MALUKU UTARA')).toBe(true);
      expect(read.isProvinceDimValue('Provinsi Maluku Utara')).toBe(true);
    });

    test('does not mistake a kabupaten/kota for the province', () => {
      expect(read.isProvinceDimValue('Halmahera Barat')).toBe(false);
      expect(read.isProvinceDimValue('Kota Ternate')).toBe(false);
      expect(read.isRegionDimValue('Kota Ternate')).toBe(true);
      expect(read.isRegionDimValue('Maluku Utara')).toBe(false);
    });

    test('a non-geographic dimension is neither', () => {
      expect(read.isProvinceDimValue('A. Pertanian, Kehutanan, dan Perikanan')).toBe(false);
      expect(read.isRegionDimValue('A. Pertanian, Kehutanan, dan Perikanan')).toBe(false);
    });
  });

  describe('getLatest', () => {
    test('returns the province value for the newest period', async () => {
      mockWatermark(1000);
      getSequelizeBps()._queryMock.mockResolvedValueOnce([
        { year: 2026, month_no: 35, dim_value: 'Maluku Utara', value: 5.93 },
      ]);

      await expect(read.getLatest(182, { metric: 'm1' })).resolves.toEqual({
        value: 5.93,
        year: 2026,
        month_no: 35,
        periodLabel: '2026',
        scope: 'province',
      });
    });

    // The rule that must never regress: averaging regions is not a provincial figure.
    test('returns null when only kabupaten/kota rows exist', async () => {
      mockWatermark(1000);
      getSequelizeBps()._queryMock.mockResolvedValueOnce([
        { year: 2026, month_no: 35, dim_value: 'Halmahera Barat', value: 6.48 },
        { year: 2026, month_no: 35, dim_value: 'Kota Ternate', value: 8.21 },
      ]);

      await expect(read.getLatest(182, { metric: 'm1' })).resolves.toBeNull();
    });

    test('returns null when the indicator has no rows at all', async () => {
      mockWatermark(1000);
      getSequelizeBps()._queryMock.mockResolvedValueOnce([]);
      await expect(read.getLatest(182, { metric: 'm1' })).resolves.toBeNull();
    });

    test('serves from cache on the second call with the same watermark', async () => {
      const m = getSequelizeBps()._queryMock;
      mockWatermark(1000);
      m.mockResolvedValueOnce([{ year: 2026, month_no: 35, dim_value: 'Maluku Utara', value: 1 }]);

      await read.getLatest(182, { metric: 'm1' });
      const callsAfterFirst = m.mock.calls.length;
      await read.getLatest(182, { metric: 'm1' });

      expect(m.mock.calls.length).toBe(callsAfterFirst);
    });

    test('rejects an invalid indicator id before touching the database', async () => {
      await expect(read.getLatest('abc', { metric: 'm' })).rejects.toThrow('Invalid indikator');
      expect(getSequelizeBps()._queryMock).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest src/__tests__/indicator.read.test.js`
Expected: FAIL — `Cannot find module '../services/indicator/read.service'`

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/indicator/read.service.js`:

```js
'use strict';

/**
 * Dashboard-shaped reads over a single `indikator_NNN` table.
 *
 * PROVINCE RULE (spec, non-negotiable): a provincial figure is returned only
 * when the source provides an explicit province row. Averaging ten
 * kabupaten/kota does not yield the provincial poverty rate — that needs
 * population weighting — and summing is wrong for rates and indices. Publishing
 * either under a BPS masthead would be a fabricated official statistic, so when
 * no province row exists this returns null and the caller renders a different
 * card shape.
 */

const { QueryTypes } = require('sequelize');
const getSequelizeBps = require('../../config/db_bps');
const { validateIndicatorId, tableName, getWatermark } = require('./watermark.service');
const cache = require('./cache');
const { periodLabel, sortPeriodsDesc } = require('./period');
const { dimValueToKdkab } = require('../petaTematik/regionMap.service');

/** From shared/geo-regions.json — provinceAliases. */
const PROVINCE_ALIASES = ['maluku utara', 'malut', 'provinsi maluku utara', 'north maluku'];

function normalise(dimValue) {
  return String(dimValue == null ? '' : dimValue).trim().toLowerCase();
}

function isRegionDimValue(dimValue) {
  return dimValueToKdkab(dimValue) != null;
}

function isProvinceDimValue(dimValue) {
  if (isRegionDimValue(dimValue)) return false;
  return PROVINCE_ALIASES.includes(normalise(dimValue));
}

async function fetchRows(id, metric) {
  const seq = getSequelizeBps();
  if (!seq) return [];
  const metricClause = metric == null ? '' : 'AND metric = ?';
  const replacements = metric == null ? [] : [metric];
  return seq.query(
    `SELECT year, month_no, dim_value, value
       FROM \`${tableName(id)}\`
      WHERE value IS NOT NULL
        AND year > 0
        ${metricClause}
      ORDER BY year DESC, month_no DESC
      LIMIT 500`,
    { replacements, type: QueryTypes.SELECT }
  );
}

async function getLatest(indicatorId, { metric = null } = {}) {
  const id = validateIndicatorId(indicatorId);
  const watermark = await getWatermark(id);

  return cache.getOrCompute('latest', id, watermark, [metric], async () => {
    let rows = [];
    try {
      rows = await fetchRows(id, metric);
    } catch {
      return null;
    }
    if (!rows.length) return null;

    const provinceRows = rows.filter((r) => isProvinceDimValue(r.dim_value));
    if (!provinceRows.length) return null; // See PROVINCE RULE above.

    const newest = sortPeriodsDesc(provinceRows)[0];
    return {
      value: Number(newest.value),
      year: Number(newest.year),
      month_no: Number(newest.month_no || 0),
      periodLabel: periodLabel(newest.year, newest.month_no),
      scope: 'province',
    };
  });
}

module.exports = { isProvinceDimValue, isRegionDimValue, getLatest };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx jest src/__tests__/indicator.read.test.js`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
cd /var/www/html/project-data-strategis
git add backend/src/services/indicator/read.service.js backend/src/__tests__/indicator.read.test.js
git commit -m "feat(indicator): getLatest dengan aturan baris provinsi"
```

---

### Task 5: Read service — `getTrend` and delta

**Files:**
- Modify: `backend/src/services/indicator/read.service.js`
- Modify: `backend/src/__tests__/indicator.read.test.js` (append a `describe`)

**Interfaces:**
- Produces:
  - `async getTrend(indicatorId, { metric, limit }) -> { points: Array<{ year, month_no, periodLabel, value }>, delta: null | { absolute, previousValue, previousLabel } }`
  - `limit` defaults to `6`; points are oldest-first so a sparkline can render them directly.
  - `async getPeriodCount(indicatorId, { metric }) -> number` — distinct `(year, month_no)` pairs carrying a non-null value, across **all** dimensions.

Delta compares only within the same period class (Task 3) — quarter against quarter, never quarter against annual.

`getPeriodCount` is the eligibility signal required by the spec ("fewer than two
periods carrying non-null values is not eligible for a card"). It deliberately
ignores `dim_value`: a region-only indicator has no province points but is still
a legitimate card, so eligibility cannot be judged from `getTrend`.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/__tests__/indicator.read.test.js`, inside the top-level `describe`:

```js
  describe('getTrend', () => {
    test('returns province points oldest-first with a like-for-like delta', async () => {
      mockWatermark(1000);
      getSequelizeBps()._queryMock.mockResolvedValueOnce([
        { year: 2026, month_no: 32, dim_value: 'Maluku Utara', value: 20.49 },
        { year: 2026, month_no: 31, dim_value: 'Maluku Utara', value: 18.79 },
        { year: 2025, month_no: 34, dim_value: 'Maluku Utara', value: 17.10 },
      ]);

      const t = await read.getTrend(182, { metric: 'm1', limit: 6 });

      expect(t.points.map((p) => p.value)).toEqual([17.1, 18.79, 20.49]);
      expect(t.points[2].periodLabel).toBe('Triwulan II 2026');
      expect(t.delta.absolute).toBeCloseTo(1.7, 5);
      expect(t.delta.previousLabel).toBe('Triwulan I 2026');
    });

    test('does not compare across period classes', async () => {
      mockWatermark(1000);
      // Newest is quarterly; the only other row is annual — not comparable.
      getSequelizeBps()._queryMock.mockResolvedValueOnce([
        { year: 2026, month_no: 32, dim_value: 'Maluku Utara', value: 20.49 },
        { year: 2025, month_no: 35, dim_value: 'Maluku Utara', value: 17.10 },
      ]);

      const t = await read.getTrend(182, { metric: 'm1' });

      expect(t.delta).toBeNull();
    });

    test('returns empty points when there is no province row', async () => {
      mockWatermark(1000);
      getSequelizeBps()._queryMock.mockResolvedValueOnce([
        { year: 2026, month_no: 35, dim_value: 'Kota Ternate', value: 8.21 },
      ]);

      const t = await read.getTrend(182, { metric: 'm1' });

      expect(t.points).toEqual([]);
      expect(t.delta).toBeNull();
    });
  });

  describe('getPeriodCount', () => {
    test('counts distinct periods regardless of dimension', async () => {
      mockWatermark(1000);
      getSequelizeBps()._queryMock.mockResolvedValueOnce([{ n: 4 }]);

      await expect(read.getPeriodCount(182, { metric: 'm1' })).resolves.toBe(4);
    });

    // A region-only indicator has no province points but is still a real card,
    // so eligibility must not be judged from getTrend.
    test('counts region-only indicators too', async () => {
      mockWatermark(1000);
      getSequelizeBps()._queryMock.mockResolvedValueOnce([{ n: 2 }]);

      await expect(read.getPeriodCount(183, { metric: null })).resolves.toBe(2);
    });

    test('returns 0 when the query fails', async () => {
      mockWatermark(1000);
      getSequelizeBps()._queryMock.mockRejectedValueOnce(new Error('no such table'));

      await expect(read.getPeriodCount(999, { metric: null })).resolves.toBe(0);
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest src/__tests__/indicator.read.test.js`
Expected: FAIL — `read.getTrend is not a function`

- [ ] **Step 3: Write the implementation**

In `backend/src/services/indicator/read.service.js`, add `periodClass` to the `./period` import so the line reads:

```js
const { periodClass, periodLabel, sortPeriodsDesc } = require('./period');
```

Then add before `module.exports`:

```js
async function getTrend(indicatorId, { metric = null, limit = 6 } = {}) {
  const id = validateIndicatorId(indicatorId);
  const watermark = await getWatermark(id);
  const n = Number.isInteger(limit) && limit > 0 && limit <= 40 ? limit : 6;

  return cache.getOrCompute('trend', id, watermark, [metric, n], async () => {
    let rows = [];
    try {
      rows = await fetchRows(id, metric);
    } catch {
      return { points: [], delta: null };
    }

    const provinceRows = sortPeriodsDesc(rows.filter((r) => isProvinceDimValue(r.dim_value)));
    if (!provinceRows.length) return { points: [], delta: null };

    const newest = provinceRows[0];
    const cls = periodClass(newest.month_no);

    // Only periods of the same class are comparable: Triwulan IV against
    // Tahunan is not a quarter-on-quarter change.
    const sameClass = provinceRows.filter((r) => periodClass(r.month_no) === cls);

    const recent = sameClass.slice(0, n);
    const points = [...recent].reverse().map((r) => ({
      year: Number(r.year),
      month_no: Number(r.month_no || 0),
      periodLabel: periodLabel(r.year, r.month_no),
      value: Number(r.value),
    }));

    let delta = null;
    if (sameClass.length >= 2) {
      const prev = sameClass[1];
      delta = {
        absolute: Number(newest.value) - Number(prev.value),
        previousValue: Number(prev.value),
        previousLabel: periodLabel(prev.year, prev.month_no),
      };
    }

    return { points, delta };
  });
}
```

Also add `getPeriodCount`:

```js
async function getPeriodCount(indicatorId, { metric = null } = {}) {
  const id = validateIndicatorId(indicatorId);
  const watermark = await getWatermark(id);

  return cache.getOrCompute('periodcount', id, watermark, [metric], async () => {
    try {
      const seq = getSequelizeBps();
      if (!seq) return 0;
      const metricClause = metric == null ? '' : 'AND metric = ?';
      const replacements = metric == null ? [] : [metric];
      const rows = await seq.query(
        `SELECT COUNT(DISTINCT year, month_no) AS n
           FROM \`${tableName(id)}\`
          WHERE value IS NOT NULL
            AND year > 0
            ${metricClause}`,
        { replacements, type: QueryTypes.SELECT }
      );
      return rows && rows[0] ? Number(rows[0].n) || 0 : 0;
    } catch {
      return 0;
    }
  });
}
```

Update the exports line to:

```js
module.exports = { isProvinceDimValue, isRegionDimValue, getLatest, getTrend, getPeriodCount };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx jest src/__tests__/indicator.read.test.js`
Expected: PASS, 14 tests

- [ ] **Step 5: Commit**

```bash
cd /var/www/html/project-data-strategis
git add backend/src/services/indicator/read.service.js backend/src/__tests__/indicator.read.test.js
git commit -m "feat(indicator): getTrend dan getPeriodCount"
```

---

### Task 6: Dashboard service — card assembly

**Files:**
- Create: `backend/src/services/dashboard/dashboard.service.js`
- Test: `backend/src/__tests__/dashboard.service.test.js`

**Interfaces:**
- Consumes: `services/indicator/read.service` (`getLatest`, `getTrend`), `models/DataSource.model`, `models/IndicatorMeta.model`, `models/IndicatorMetricMeta.model`, `services/settings/appSettings.service` (`getJson`).
- Produces:
  - `pickMetric(metricMetas) -> null | string`
  - `async buildCard(source) -> card`
  - `async getSummary() -> { headline: card[], categories: Array<{ name, indicators: card[] }>, generatedAt }`

Card shape (raw values plus formatting metadata; the multiplier is **not** applied here — see Global Constraints):

```js
{
  sourceId: 182,
  name: 'Tingkat Kemiskinan',
  category: 'Kemiskinan & Kesejahteraan',
  icon: null, color: null,
  metric: 'm1',
  unit: 'persen',
  unitMultiplier: null,
  decimalPlaces: 2,
  shape: 'province' | 'regional' | 'dimensional',
  latest: null | { value, year, month_no, periodLabel, scope },
  trend: { points: [...], delta: null | {...} },
}
```

`pickMetric` needs an explicit rule: `IndicatorMetricMeta` has **no ordering column**, only `id`. Preference order `percent` → `index` → `count` → `numeric` → `currency` → anything else, then lowest `id`. Without a rule, "the first metric" changes across re-ingestion.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/dashboard.service.test.js`:

```js
'use strict';

jest.mock('../models/DataSource.model', () => ({ findAll: jest.fn() }));
jest.mock('../models/IndicatorMeta.model', () => ({ findAll: jest.fn() }));
jest.mock('../models/IndicatorMetricMeta.model', () => ({ findAll: jest.fn() }));
jest.mock('../services/settings/appSettings.service', () => ({ getJson: jest.fn(), setJson: jest.fn() }));
jest.mock('../services/indicator/read.service', () => ({
  getLatest: jest.fn(),
  getTrend: jest.fn(),
  getPeriodCount: jest.fn(),
}));

const DataSource = require('../models/DataSource.model');
const IndicatorMeta = require('../models/IndicatorMeta.model');
const IndicatorMetricMeta = require('../models/IndicatorMetricMeta.model');
const appSettings = require('../services/settings/appSettings.service');
const read = require('../services/indicator/read.service');
const svc = require('../services/dashboard/dashboard.service');

describe('dashboard.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    appSettings.getJson.mockResolvedValue(null);
    IndicatorMeta.findAll.mockResolvedValue([]);
    IndicatorMetricMeta.findAll.mockResolvedValue([]);
    read.getLatest.mockResolvedValue(null);
    read.getTrend.mockResolvedValue({ points: [], delta: null });
    read.getPeriodCount.mockResolvedValue(4); // eligible unless a test says otherwise
  });

  describe('pickMetric', () => {
    test('prefers percent over other types', () => {
      expect(svc.pickMetric([
        { id: 9, metric_key: 'count_a', metric_type: 'count' },
        { id: 3, metric_key: 'pct_a', metric_type: 'percent' },
      ])).toBe('pct_a');
    });

    test('falls back to the lowest id when types are equal', () => {
      expect(svc.pickMetric([
        { id: 9, metric_key: 'b', metric_type: 'numeric' },
        { id: 3, metric_key: 'a', metric_type: 'numeric' },
      ])).toBe('a');
    });

    test('returns null when there are no metrics', () => {
      expect(svc.pickMetric([])).toBeNull();
    });
  });

  describe('getSummary', () => {
    test('groups visible sources by category', async () => {
      DataSource.findAll.mockResolvedValue([
        { id: 1, name: 'A', category: 'Ekonomi', visible: true, display_order: 1, icon: null, color: null },
        { id: 2, name: 'B', category: 'Ekonomi', visible: true, display_order: 2, icon: null, color: null },
        { id: 3, name: 'C', category: 'Sosial', visible: true, display_order: 1, icon: null, color: null },
      ]);
      read.getTrend.mockResolvedValue({ points: [{ year: 2026, month_no: 35, periodLabel: '2026', value: 1 }], delta: null });

      const out = await svc.getSummary();

      expect(out.categories.map((c) => c.name)).toEqual(['Ekonomi', 'Sosial']);
      expect(out.categories[0].indicators.map((i) => i.sourceId)).toEqual([1, 2]);
    });

    test('an indicator with a province row gets shape "province"', async () => {
      DataSource.findAll.mockResolvedValue([
        { id: 1, name: 'A', category: 'Ekonomi', visible: true, display_order: 1, icon: null, color: null },
      ]);
      read.getLatest.mockResolvedValue({ value: 5.93, year: 2026, month_no: 35, periodLabel: '2026', scope: 'province' });
      read.getTrend.mockResolvedValue({ points: [{ year: 2026, month_no: 35, periodLabel: '2026', value: 5.93 }], delta: null });

      const out = await svc.getSummary();

      expect(out.categories[0].indicators[0].shape).toBe('province');
      expect(out.categories[0].indicators[0].latest.value).toBe(5.93);
    });

    test('an indicator without a province row is not given a headline value', async () => {
      DataSource.findAll.mockResolvedValue([
        { id: 1, name: 'A', category: 'Ekonomi', visible: true, display_order: 1, icon: null, color: null },
      ]);
      read.getLatest.mockResolvedValue(null);
      read.getTrend.mockResolvedValue({ points: [], delta: null });

      const out = await svc.getSummary();

      const card = out.categories[0].indicators[0];
      expect(card.latest).toBeNull();
      expect(card.shape).not.toBe('province');
    });

    test('headline follows the appSettings list when present', async () => {
      DataSource.findAll.mockResolvedValue([
        { id: 1, name: 'A', category: 'Ekonomi', visible: true, display_order: 1, icon: null, color: null },
        { id: 2, name: 'B', category: 'Ekonomi', visible: true, display_order: 2, icon: null, color: null },
      ]);
      appSettings.getJson.mockResolvedValue([2]);

      const out = await svc.getSummary();

      expect(out.headline.map((c) => c.sourceId)).toEqual([2]);
    });

    // Spec: fewer than two periods carrying values is not eligible for a card.
    test('excludes an indicator with fewer than two periods of data', async () => {
      DataSource.findAll.mockResolvedValue([
        { id: 1, name: 'A', category: 'Ekonomi', visible: true, display_order: 1, icon: null, color: null },
        { id: 2, name: 'B', category: 'Ekonomi', visible: true, display_order: 2, icon: null, color: null },
      ]);
      read.getPeriodCount.mockImplementation((id) => Promise.resolve(id === 1 ? 1 : 5));

      const out = await svc.getSummary();

      expect(out.categories[0].indicators.map((i) => i.sourceId)).toEqual([2]);
    });

    test('drops a category that ends up with no eligible indicators', async () => {
      DataSource.findAll.mockResolvedValue([
        { id: 1, name: 'A', category: 'Kosong', visible: true, display_order: 1, icon: null, color: null },
      ]);
      read.getPeriodCount.mockResolvedValue(0);

      const out = await svc.getSummary();

      expect(out.categories).toEqual([]);
    });

    test('one broken indicator does not fail the whole dashboard', async () => {
      DataSource.findAll.mockResolvedValue([
        { id: 1, name: 'A', category: 'Ekonomi', visible: true, display_order: 1, icon: null, color: null },
        { id: 2, name: 'B', category: 'Ekonomi', visible: true, display_order: 2, icon: null, color: null },
      ]);
      read.getTrend.mockImplementation((id) => {
        if (id === 1) return Promise.reject(new Error('boom'));
        return Promise.resolve({ points: [], delta: null });
      });

      const out = await svc.getSummary();

      expect(out.categories[0].indicators.map((i) => i.sourceId)).toEqual([1, 2]);
      expect(out.categories[0].indicators[0].error).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest src/__tests__/dashboard.service.test.js`
Expected: FAIL — `Cannot find module '../services/dashboard/dashboard.service'`

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/dashboard/dashboard.service.js`:

```js
'use strict';

/**
 * Catalog-driven dashboard assembly.
 *
 * Nothing here is hardcoded per indicator: the card list comes from
 * `data_sources` (which already carries category/icon/color/display_order),
 * labels and units come from IndicatorMeta / IndicatorMetricMeta, and values
 * come from services/indicator. Adding an indicator to the catalog makes it
 * appear with no code change.
 */

const DataSource = require('../../models/DataSource.model');
const IndicatorMeta = require('../../models/IndicatorMeta.model');
const IndicatorMetricMeta = require('../../models/IndicatorMetricMeta.model');
const appSettings = require('../settings/appSettings.service');
const read = require('../indicator/read.service');

const HEADLINE_SETTING_KEY = 'dashboard:headline';

/** Spec eligibility rule: a card needs at least two periods carrying values. */
const MIN_PERIODS_FOR_CARD = 2;

/**
 * IndicatorMetricMeta has no ordering column, only `id`. Picking "the first
 * metric" would therefore change across re-ingestion, so the preference is
 * explicit and the id is only a tie-breaker.
 */
const METRIC_TYPE_RANK = ['percent', 'index', 'count', 'numeric', 'currency', 'weight', 'area', 'text'];

function pickMetric(metricMetas) {
  if (!Array.isArray(metricMetas) || !metricMetas.length) return null;
  const ranked = [...metricMetas].sort((a, b) => {
    const ra = METRIC_TYPE_RANK.indexOf(a.metric_type);
    const rb = METRIC_TYPE_RANK.indexOf(b.metric_type);
    const na = ra === -1 ? METRIC_TYPE_RANK.length : ra;
    const nb = rb === -1 ? METRIC_TYPE_RANK.length : rb;
    if (na !== nb) return na - nb;
    return Number(a.id) - Number(b.id);
  });
  return ranked[0].metric_key || null;
}

function buildIndexes(metas, metricMetas) {
  const metaBySource = new Map();
  for (const m of metas) metaBySource.set(Number(m.source_id), m);

  const metricsBySource = new Map();
  for (const mm of metricMetas) {
    const k = Number(mm.source_id);
    if (!metricsBySource.has(k)) metricsBySource.set(k, []);
    metricsBySource.get(k).push(mm);
  }
  return { metaBySource, metricsBySource };
}

async function buildCard(source, meta, metricMetas) {
  const sourceId = Number(source.id);
  const metric = pickMetric(metricMetas);
  const metricMeta = (metricMetas || []).find((m) => m.metric_key === metric) || null;

  const base = {
    sourceId,
    name: (meta && meta.title_clean) || source.name,
    category: (source.category || '').trim() || 'Lainnya',
    icon: source.icon || null,
    color: source.color || null,
    metric,
    unit: (metricMeta && metricMeta.unit_id) || (meta && meta.unit_id) || null,
    // Raw value + multiplier: formatting happens once, in the frontend helper.
    unitMultiplier: (metricMeta && metricMeta.unit_multiplier) || null,
    decimalPlaces: meta && meta.decimal_places != null ? Number(meta.decimal_places) : null,
  };

  // Fetched separately from latest/trend: a failing trend query must not zero the
  // period count and silently drop an otherwise-valid indicator from the page.
  let periodCount = 0;
  try {
    periodCount = await read.getPeriodCount(sourceId, { metric });
  } catch {
    periodCount = 0;
  }

  try {
    const [latest, trend] = await Promise.all([
      read.getLatest(sourceId, { metric }),
      read.getTrend(sourceId, { metric }),
    ]);
    return {
      ...base,
      periodCount,
      shape: latest ? 'province' : (trend.points.length ? 'regional' : 'dimensional'),
      latest,
      trend,
      error: false,
    };
  } catch {
    // One unreadable indicator must not blank the whole dashboard.
    return {
      ...base,
      periodCount,
      shape: 'dimensional',
      latest: null,
      trend: { points: [], delta: null },
      error: true,
    };
  }
}

async function getSummary() {
  const sources = await DataSource.findAll({
    where: { visible: true },
    attributes: ['id', 'name', 'category', 'icon', 'color', 'display_order', 'visible'],
    order: [['display_order', 'ASC'], ['id', 'ASC']],
    raw: true,
  });

  const [metas, metricMetas, headlineIds] = await Promise.all([
    IndicatorMeta.findAll({ raw: true }),
    IndicatorMetricMeta.findAll({ raw: true }),
    appSettings.getJson(HEADLINE_SETTING_KEY),
  ]);

  const { metaBySource, metricsBySource } = buildIndexes(metas || [], metricMetas || []);

  const cards = await Promise.all(
    sources.map((s) => buildCard(s, metaBySource.get(Number(s.id)) || null, metricsBySource.get(Number(s.id)) || []))
  );

  // Spec: an indicator with fewer than two periods carrying non-null values is
  // not eligible for a card; it stays discoverable via /kategori.
  const eligible = cards.filter((c) => c.periodCount >= MIN_PERIODS_FOR_CARD);

  const byId = new Map(eligible.map((c) => [c.sourceId, c]));
  const headline = Array.isArray(headlineIds)
    ? headlineIds.map((id) => byId.get(Number(id))).filter(Boolean)
    : eligible.filter((c) => c.shape === 'province').slice(0, 6);

  const categories = [];
  const seen = new Map();
  for (const card of eligible) {
    if (!seen.has(card.category)) {
      seen.set(card.category, { name: card.category, indicators: [] });
      categories.push(seen.get(card.category));
    }
    seen.get(card.category).indicators.push(card);
  }

  return { headline, categories, generatedAt: new Date().toISOString() };
}

module.exports = { pickMetric, buildCard, getSummary, HEADLINE_SETTING_KEY, MIN_PERIODS_FOR_CARD };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx jest src/__tests__/dashboard.service.test.js`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
cd /var/www/html/project-data-strategis
git add backend/src/services/dashboard/dashboard.service.js backend/src/__tests__/dashboard.service.test.js
git commit -m "feat(dashboard): perakitan kartu berbasis katalog"
```

---

### Task 7: Controller, route and registration

**Files:**
- Create: `backend/src/controllers/dashboard.controller.js`
- Create: `backend/src/routes/dashboard.public.routes.js`
- Modify: `backend/app.js` (add after the `peta-tematik/public` block, around line 104)
- Test: `backend/src/__tests__/dashboard.routes.test.js`

**Interfaces:**
- Consumes: `services/dashboard/dashboard.service` (`getSummary`).
- Produces: `GET /dashboard/public/summary` → `{ ok: true, headline, categories, generatedAt }`.

Mirrors `controllers/peta-tematik.controller.js`: a `withGuard` wrapper, `{ ok: true, ...result }` on success, `400` when the message matches `/Invalid/`, `500` otherwise.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/dashboard.routes.test.js`:

```js
'use strict';

jest.mock('../services/dashboard/dashboard.service', () => ({
  getSummary: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const svc = require('../services/dashboard/dashboard.service');

function makeApp() {
  const app = express();
  app.use('/dashboard/public', require('../routes/dashboard.public.routes'));
  return app;
}

describe('GET /dashboard/public/summary', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the summary payload', async () => {
    svc.getSummary.mockResolvedValue({
      headline: [{ sourceId: 1 }],
      categories: [{ name: 'Ekonomi', indicators: [{ sourceId: 1 }] }],
      generatedAt: '2026-08-17T00:00:00.000Z',
    });

    const res = await request(makeApp()).get('/dashboard/public/summary');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.categories[0].name).toBe('Ekonomi');
  });

  test('returns 500 with a generic message when the service throws', async () => {
    svc.getSummary.mockRejectedValue(new Error('db exploded'));

    const res = await request(makeApp()).get('/dashboard/public/summary');

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    // Never leak internals to the client (see .claude/rules/api-conventions.md).
    expect(JSON.stringify(res.body)).not.toMatch(/db exploded/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest src/__tests__/dashboard.routes.test.js`
Expected: FAIL — `Cannot find module '../routes/dashboard.public.routes'`

- [ ] **Step 3: Write the implementation**

Create `backend/src/controllers/dashboard.controller.js`:

```js
'use strict';

/**
 * Dashboard controller.
 * Spec: docs/superpowers/specs/2026-08-17-dashboard-mandiri-design.md
 */

const svc = require('../services/dashboard/dashboard.service');

async function withGuard(req, res, fn) {
  try {
    const result = await fn();
    res.json({ ok: true, ...result });
  } catch (e) {
    const invalid = /Invalid/.test(e && e.message ? e.message : '');
    // Log server-side, return a generic message: responses must not leak internals.
    if (!invalid) console.error('[dashboard]', e);
    res.status(invalid ? 400 : 500).json({
      ok: false,
      error: invalid ? e.message : 'Server error',
    });
  }
}

async function getSummary(req, res) {
  return withGuard(req, res, () => svc.getSummary());
}

module.exports = { getSummary };
```

Create `backend/src/routes/dashboard.public.routes.js`:

```js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/dashboard.controller');

// Public routes for the PWA dashboard — no auth.
// Rate limiting is applied at app.js registration.
router.get('/summary', ctrl.getSummary);

module.exports = router;
```

In `backend/app.js`, immediately after the `app.use("/peta-tematik/public", ...)` line, add:

```js
// Dashboard public (PWA) — no auth, rate-limited (120/min)
const dashboardPublicLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use("/dashboard/public", dashboardPublicLimiter, require("./src/routes/dashboard.public.routes"));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx jest src/__tests__/dashboard.routes.test.js`
Expected: PASS, 2 tests

- [ ] **Step 5: Verify the route is live against the running backend**

```bash
cd /var/www/html/project-data-strategis
pm2 reload pds-backend --update-env
sleep 5
curl -s -o /dev/null -w "%{http_code}\n" --max-time 30 http://127.0.0.1:5000/dashboard/public/summary
```

Expected: `200`. If it prints `404`, the `app.js` registration was not added or the reload did not pick it up.

- [ ] **Step 6: Commit**

```bash
cd /var/www/html/project-data-strategis
git add backend/src/controllers/dashboard.controller.js backend/src/routes/dashboard.public.routes.js backend/app.js backend/src/__tests__/dashboard.routes.test.js
git commit -m "feat(dashboard): endpoint publik GET /dashboard/public/summary"
```

---

### Task 8: Retrofit peta-tematik onto watermark keying

Fixes the pre-existing bug: `services/petaTematik/cache.service.js` uses a blind one-hour TTL with no invalidation, so the thematic map can serve figures up to an hour behind the database after a refresh.

**Files:**
- Modify: `backend/src/services/petaTematik/petaTematik.service.js` (the four `cache.getOrCompute` call sites at roughly lines 27, 61, 100, 151)
- Test: `backend/src/__tests__/petaTematik.freshness.test.js`
- Leave `backend/src/__tests__/petaTematik.service.test.js` passing unchanged.

**Interfaces:**
- Consumes: `services/indicator/watermark.service` (`getWatermark`).
- Produces: no signature changes — `getYears`, `getMetrics`, `getData`, `getSummary` keep their current shapes. Only the cache key changes.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/petaTematik.freshness.test.js`:

```js
'use strict';

jest.mock('../config/db_bps', () => {
  const queryMock = jest.fn();
  return jest.fn(() => ({ query: queryMock, _queryMock: queryMock }));
});

const getSequelizeBps = require('../config/db_bps');
const cache = require('../services/petaTematik/cache.service');
const wm = require('../services/indicator/watermark.service');
const svc = require('../services/petaTematik/petaTematik.service');

describe('petaTematik freshness', () => {
  beforeEach(() => {
    cache.clear();
    wm.clearWatermarkMemo();
    getSequelizeBps()._queryMock.mockReset();
  });

  test('recomputes after the watermark advances instead of serving the old value', async () => {
    const m = getSequelizeBps()._queryMock;

    // First call: watermark = T1, then the years query.
    m.mockResolvedValueOnce([{ lu: new Date(1000) }]);
    m.mockResolvedValueOnce([[{ year: 2024 }]]);
    m.mockResolvedValueOnce([[{ has_monthly: 0 }]]);

    const before = await svc.getYears(182);
    expect(before.years).toEqual([2024]);

    // Data refreshes: watermark moves to T2 and a new year exists.
    wm.clearWatermarkMemo();
    m.mockResolvedValueOnce([{ lu: new Date(2000) }]);
    m.mockResolvedValueOnce([[{ year: 2025 }, { year: 2024 }]]);
    m.mockResolvedValueOnce([[{ has_monthly: 0 }]]);

    const after = await svc.getYears(182);
    expect(after.years).toEqual([2024, 2025]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest src/__tests__/petaTematik.freshness.test.js`
Expected: FAIL — the second call returns the cached `[2024]` because the key has no watermark in it.

- [ ] **Step 3: Write the implementation**

In `backend/src/services/petaTematik/petaTematik.service.js`, add near the other requires:

```js
const { getWatermark } = require('../indicator/watermark.service');
```

Then prefix each of the four cache keys with the watermark. In `getYears`, replace:

```js
  return cache.getOrCompute(`ind:${id}:years:v2`, async () => {
```

with:

```js
  const watermark = await getWatermark(id);
  return cache.getOrCompute(`ind:${id}:${watermark}:years:v2`, async () => {
```

Apply the same change to the other three call sites, inserting `${watermark}` after `${id}` in each key:

- `getMetrics`: `` `ind:${id}:metrics` `` → `` `ind:${id}:${watermark}:metrics` ``
- `getData`: `` `data:${id}:${y}:${m || 0}:${metric || '*'}` `` → `` `data:${id}:${watermark}:${y}:${m || 0}:${metric || '*'}` ``
- `getSummary`: `` `summary:${id}:${y}:${m || 0}:${metric || '*'}` `` → `` `summary:${id}:${watermark}:${y}:${m || 0}:${metric || '*'}` ``

Each needs `const watermark = await getWatermark(id);` before its `cache.getOrCompute` call, placed after the existing id/year validation so an invalid id still throws before any query.

- [ ] **Step 4: Run both peta-tematik test files to verify they pass**

Run: `cd backend && npx jest src/__tests__/petaTematik.freshness.test.js src/__tests__/petaTematik.service.test.js`
Expected: PASS. If `petaTematik.service.test.js` now fails on call counts, its mocks need one extra `mockResolvedValueOnce([{ lu: ... }])` per service call for the watermark query — update those fixtures, do not remove the assertions.

- [ ] **Step 5: Run the whole backend suite**

Run: `cd backend && npm test`
Expected: no new failures compared with the pre-task baseline.

- [ ] **Step 6: Commit**

```bash
cd /var/www/html/project-data-strategis
git add backend/src/services/petaTematik/petaTematik.service.js backend/src/__tests__/petaTematik.freshness.test.js backend/src/__tests__/petaTematik.service.test.js
git commit -m "fix(peta-tematik): kunci cache berbasis watermark, hapus TTL buta 1 jam"
```

---

### Task 9: Verify against real data and document

**Files:**
- Modify: `docs/workspace/backend.md` (route list + Change Log)

- [ ] **Step 1: Confirm the endpoint returns real cards**

```bash
cd /var/www/html/project-data-strategis
pm2 reload pds-backend --update-env
sleep 5
curl -s --max-time 60 http://127.0.0.1:5000/dashboard/public/summary \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);
      console.log('ok:', j.ok);
      console.log('categories:', j.categories.length);
      console.log('cards:', j.categories.reduce((n,c)=>n+c.indicators.length,0));
      console.log('headline:', j.headline.length);
      const shapes={};j.categories.forEach(c=>c.indicators.forEach(i=>{shapes[i.shape]=(shapes[i.shape]||0)+1}));
      console.log('shapes:', JSON.stringify(shapes));
      console.log('errors:', j.categories.reduce((n,c)=>n+c.indicators.filter(i=>i.error).length,0));})"
```

Expected: `ok: true`, a non-zero card count, and a `shapes` breakdown containing `province`. Roughly two thirds of indicators are expected to be `province`; a result of zero means the province rule is rejecting everything and `isProvinceDimValue` needs checking against real `dim_value` spellings.

- [ ] **Step 2: Measure cold and warm response time**

```bash
curl -s -o /dev/null -w "cold: %{time_total}s\n" --max-time 120 http://127.0.0.1:5000/dashboard/public/summary
curl -s -o /dev/null -w "warm: %{time_total}s\n" --max-time 120 http://127.0.0.1:5000/dashboard/public/summary
```

Expected: cold on the order of 2s (the measured full-catalog sweep was 1.6s), warm well under 200ms. If warm is not dramatically faster, the cache is not being hit — check that the watermark is stable between calls rather than changing every request.

- [ ] **Step 3: Update the backend workspace doc**

In `docs/workspace/backend.md`, add `/dashboard/public` to the public route list, and add a Change Log row describing: the new `services/indicator/` shared layer, watermark-keyed caching, `GET /dashboard/public/summary`, the province rule, and the peta-tematik retrofit that removed the blind one-hour TTL.

- [ ] **Step 4: Commit**

```bash
cd /var/www/html/project-data-strategis
git add docs/workspace/backend.md
git commit -m "docs(backend): catat endpoint dashboard dan lapisan indicator"
```

---

## Done when

- `cd backend && npm test` passes with no new failures.
- `GET /dashboard/public/summary` returns `ok: true` with cards grouped by category and a non-empty `headline`.
- Warm responses are served from cache; advancing an indicator's `last_update` changes what the endpoint returns on the next request.
- No indicator without an explicit province row reports a province-level value.
- Phase 2 (the `/dashboard` page) can be built entirely against this endpoint.
