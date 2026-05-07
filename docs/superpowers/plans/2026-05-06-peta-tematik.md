# Peta Tematik Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Peta Tematik" choropleth map section at the bottom of the admin `/dashboard` page (Next.js, port 5050), wired to 203 eligible BPS indicators in `data_bps`, with searchable indicator picker, adaptive year/month filter, info panel (provinsi total + top/bottom 3 + sparkline trend), and PNG export.

**Architecture:** Express backend exposes 5 cached endpoints under `/peta-tematik/*`; service layer queries `data_bps.indikator_*` tables via existing `getSequelizeBps()`; pure functions handle source_name → kategori (7 buckets + "Lainnya") and dim_value → kdkab mapping. Frontend uses react-leaflet for the map, cmdk for grouped searchable dropdown, html2canvas for PNG export. Section lazy-renders via IntersectionObserver to keep dashboard interactive while the map bundle loads.

**Tech Stack:** Express + Sequelize (existing) + lru-cache (new) | Next.js 16 + React 19 + react-leaflet 4 + cmdk + html2canvas (new) + Tailwind (existing) | Jest backend tests + Playwright E2E (existing infra)

**Spec reference:** `docs/superpowers/specs/2026-05-06-peta-tematik-design.md`

**Worktree note:** Execute this plan in an isolated worktree. The branch `feat/peta-tematik` already exists (created during brainstorming); add a worktree for it via `git worktree add /tmp/peta-tematik-wt feat/peta-tematik`. Working dir for execution: `/tmp/peta-tematik-wt/project-data-strategis/`.

---

## Conventions (from existing codebase)

- **Backend tests:** `backend/src/__tests__/<name>.test.js` (flat dir, jest)
- **Backend services:** `backend/src/services/<subdir>/<name>.service.js`
- **Backend routes:** `backend/src/routes/<name>.routes.js`
- **Backend controllers:** `backend/src/controllers/<name>.controller.js` with `module.exports = { async fn(req, res) }` pattern, try/catch + `{ ok: false, error }` response shape
- **DB access (data_bps):** `const getSequelizeBps = require('../../config/db_bps'); const seq = getSequelizeBps(); const [rows] = await seq.query(sql, { replacements: [...] });`
- **Auth middleware:** `require('../middleware/auth.middleware')` → `authMiddleware, requireAdmin`
- **Frontend admin:** `backend/admin/app/<route>/page.tsx`, components in `backend/admin/components/<feature>/`
- **Backup before edit:** Per global CLAUDE.md, before modifying any existing file: `cp <file> <file>.backup`

---

## File Structure (locked-in)

### Backend — CREATE

```
backend/src/services/petaTematik/
├── regionMap.service.js              ~30 LoC — pure: dim_value → kdkab
├── categorization.service.js         ~80 LoC — pure: source_name → kategori
├── cache.service.js                  ~40 LoC — lru-cache wrapper
├── eligibilityScanner.service.js    ~120 LoC — boot scan 311 tabel
└── petaTematik.service.js           ~250 LoC — DB query orchestrator

backend/src/controllers/peta-tematik.controller.js   ~120 LoC
backend/src/routes/peta-tematik.routes.js             ~30 LoC

backend/src/__tests__/
├── petaTematik.regionMap.test.js
├── petaTematik.categorization.test.js
├── petaTematik.cache.test.js
├── petaTematik.eligibilityScanner.test.js
└── petaTematik.service.test.js
```

### Backend — MODIFY

```
backend/src/server.js          — register route + invoke boot scanner
backend/package.json           — add lru-cache (if not already)
```

### Frontend (admin) — CREATE

```
backend/admin/components/peta-tematik/
├── PetaTematikSection.tsx     ~120 LoC — wrapper + lazy mount + state
├── FilterBar.tsx              ~60 LoC  — container for picker + selects
├── IndikatorPicker.tsx        ~80 LoC  — cmdk searchable grouped dropdown
├── ChoroplethMap.tsx          ~150 LoC — react-leaflet container
├── MapLegend.tsx              ~40 LoC  — 5-bin scale label
├── InfoPanel.tsx              ~50 LoC  — wrapper for sub-cards
├── ProvinsiTotalCard.tsx      ~30 LoC
├── TopBottomList.tsx          ~40 LoC
├── TrendSparkline.tsx         ~50 LoC  — inline SVG
├── ExportButton.tsx           ~30 LoC
├── api.ts                     ~50 LoC  — axios wrappers + react-query keys
├── colorScale.ts              ~30 LoC  — quantile binning + color
└── types.ts                   ~40 LoC
```

### Frontend (admin) — MODIFY

```
backend/admin/app/dashboard/page.tsx     — import + render <PetaTematikSection />
backend/admin/package.json               — add react-leaflet, html2canvas, cmdk
```

### E2E + Docs

```
frontend/e2e/peta-tematik.spec.ts        — Playwright happy-path test
docs/workspace/admin.md                  — update Pages list + Change Log
docs/workspace/backend.md                — update routes/services + Change Log
docs/workspace/database.md               — note audit + region mapping
```

---

## Task 1: Backend setup + scaffold + placeholder route

**Files:**
- Create: `backend/src/services/petaTematik/.gitkeep` (empty marker)
- Create: `backend/src/routes/peta-tematik.routes.js`
- Create: `backend/src/controllers/peta-tematik.controller.js`
- Modify: `backend/src/server.js` (register route — find the `app.use(...)` block)
- Modify: `backend/package.json` (add `lru-cache`)

- [ ] **Step 1: Backup files to be modified**

```bash
cp backend/src/server.js backend/src/server.js.backup
cp backend/package.json backend/package.json.backup
```

- [ ] **Step 2: Install lru-cache**

```bash
cd backend && npm install lru-cache@^10.2.0 --save && cd ..
```

Expected: `lru-cache` appears in `backend/package.json` dependencies.

- [ ] **Step 3: Create directory + placeholder route**

Create `backend/src/services/petaTematik/.gitkeep` (touch is fine).

Create `backend/src/routes/peta-tematik.routes.js`:

```javascript
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/peta-tematik.controller');
const { authMiddleware, requireAdmin } = require('../middleware/auth.middleware');

router.use(authMiddleware, requireAdmin);

router.get('/indikator-list', ctrl.getIndikatorList);
router.get('/years', ctrl.getYears);
router.get('/metrics', ctrl.getMetrics);
router.get('/data', ctrl.getData);
router.get('/summary', ctrl.getSummary);

module.exports = router;
```

- [ ] **Step 4: Create controller skeleton (placeholder methods that 501)**

Create `backend/src/controllers/peta-tematik.controller.js`:

```javascript
/**
 * Peta Tematik Controller
 * Choropleth map for /dashboard section. See spec:
 *   docs/superpowers/specs/2026-05-06-peta-tematik-design.md
 */

module.exports = {
  async getIndikatorList(req, res) {
    return res.status(501).json({ ok: false, error: 'Not implemented' });
  },
  async getYears(req, res) {
    return res.status(501).json({ ok: false, error: 'Not implemented' });
  },
  async getMetrics(req, res) {
    return res.status(501).json({ ok: false, error: 'Not implemented' });
  },
  async getData(req, res) {
    return res.status(501).json({ ok: false, error: 'Not implemented' });
  },
  async getSummary(req, res) {
    return res.status(501).json({ ok: false, error: 'Not implemented' });
  },
};
```

- [ ] **Step 5: Wire route in server.js**

Find the section in `backend/src/server.js` where other routes are registered (search for `app.use('/analytics'` or similar). Add:

```javascript
app.use('/peta-tematik', require('./routes/peta-tematik.routes'));
```

- [ ] **Step 6: Smoke test — server boots, route 401s without auth**

```bash
cd backend && npm start &
sleep 30   # PM2-style 20-45s startup
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5000/peta-tematik/indikator-list
# Expected: 401 (auth required) or 501 (auth bypass dev mode)
kill %1
```

Expected: 401 or 501 (not 404). If 404, route not registered correctly.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/petaTematik/.gitkeep \
        backend/src/routes/peta-tematik.routes.js \
        backend/src/controllers/peta-tematik.controller.js \
        backend/src/server.js \
        backend/package.json \
        backend/package-lock.json
git commit -m "feat(peta-tematik): backend scaffold + placeholder routes

Add /peta-tematik/* route group with 5 endpoints (501-stubbed).
Install lru-cache@10. No service logic yet."
```

---

## Task 2: regionMap.service.js (pure function)

**Files:**
- Create: `backend/src/services/petaTematik/regionMap.service.js`
- Test: `backend/src/__tests__/petaTematik.regionMap.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/petaTematik.regionMap.test.js`:

```javascript
const { dimValueToKdkab, KDKAB_TO_NAMA } = require('../services/petaTematik/regionMap.service');

describe('regionMap', () => {
  describe('dimValueToKdkab', () => {
    test('maps plain kab/kota names to kdkab', () => {
      expect(dimValueToKdkab('Halmahera Barat')).toBe('01');
      expect(dimValueToKdkab('Halmahera Tengah')).toBe('02');
      expect(dimValueToKdkab('Halmahera Utara')).toBe('03');
      expect(dimValueToKdkab('Halmahera Selatan')).toBe('04');
      expect(dimValueToKdkab('Kepulauan Sula')).toBe('05');
      expect(dimValueToKdkab('Halmahera Timur')).toBe('06');
      expect(dimValueToKdkab('Pulau Morotai')).toBe('07');
      expect(dimValueToKdkab('Pulau Taliabu')).toBe('08');
      expect(dimValueToKdkab('Ternate')).toBe('71');
      expect(dimValueToKdkab('Tidore Kepulauan')).toBe('72');
    });

    test('strips "Kabupaten "/"Kota " prefix', () => {
      expect(dimValueToKdkab('Kabupaten Halmahera Barat')).toBe('01');
      expect(dimValueToKdkab('Kota Ternate')).toBe('71');
      expect(dimValueToKdkab('Kota Tidore Kepulauan')).toBe('72');
    });

    test('case-insensitive', () => {
      expect(dimValueToKdkab('halmahera barat')).toBe('01');
      expect(dimValueToKdkab('TERNATE')).toBe('71');
    });

    test('returns null for province total', () => {
      expect(dimValueToKdkab('Maluku Utara')).toBeNull();
    });

    test('returns null for unknown / falsy', () => {
      expect(dimValueToKdkab('')).toBeNull();
      expect(dimValueToKdkab(null)).toBeNull();
      expect(dimValueToKdkab(undefined)).toBeNull();
      expect(dimValueToKdkab('Kalimantan Barat')).toBeNull();
      expect(dimValueToKdkab('garbage')).toBeNull();
    });
  });

  describe('KDKAB_TO_NAMA', () => {
    test('contains all 10 entries', () => {
      expect(Object.keys(KDKAB_TO_NAMA)).toHaveLength(10);
      expect(KDKAB_TO_NAMA['01']).toBe('Halmahera Barat');
      expect(KDKAB_TO_NAMA['71']).toBe('Ternate');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest petaTematik.regionMap --no-coverage
```

Expected: FAIL with "Cannot find module ... regionMap.service".

- [ ] **Step 3: Implement regionMap.service.js**

Create `backend/src/services/petaTematik/regionMap.service.js`:

```javascript
'use strict';

/**
 * Maps BPS indikator dim_value (e.g. "Halmahera Barat", "Kota Ternate")
 * to kdkab code matching properties.kdkab in peta_kabko_malut.geojson.
 *
 * Province total ("Maluku Utara") and unknown values return null —
 * callers should skip them from polygon coloring.
 */

const NAME_TO_KDKAB = Object.freeze({
  'halmahera barat': '01',
  'halmahera tengah': '02',
  'halmahera utara': '03',
  'halmahera selatan': '04',
  'kepulauan sula': '05',
  'halmahera timur': '06',
  'pulau morotai': '07',
  'pulau taliabu': '08',
  'ternate': '71',
  'tidore kepulauan': '72',
});

const KDKAB_TO_NAMA = Object.freeze({
  '01': 'Halmahera Barat',
  '02': 'Halmahera Tengah',
  '03': 'Halmahera Utara',
  '04': 'Halmahera Selatan',
  '05': 'Kepulauan Sula',
  '06': 'Halmahera Timur',
  '07': 'Pulau Morotai',
  '08': 'Pulau Taliabu',
  '71': 'Ternate',
  '72': 'Tidore Kepulauan',
});

function dimValueToKdkab(dimValue) {
  if (!dimValue || typeof dimValue !== 'string') return null;
  const cleaned = dimValue
    .replace(/^(Kabupaten|Kota)\s+/i, '')
    .trim()
    .toLowerCase();
  return NAME_TO_KDKAB[cleaned] || null;
}

module.exports = { dimValueToKdkab, KDKAB_TO_NAMA, NAME_TO_KDKAB };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx jest petaTematik.regionMap --no-coverage
```

Expected: PASS, all assertions green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/petaTematik/regionMap.service.js \
        backend/src/__tests__/petaTematik.regionMap.test.js
git commit -m "feat(peta-tematik): regionMap.service — dim_value → kdkab pure fn

10-entry static map for Maluku Utara kab/kota. Province total returns
null. Strips Kabupaten/Kota prefix, case-insensitive."
```

---

## Task 3: categorization.service.js (pure function)

**Files:**
- Create: `backend/src/services/petaTematik/categorization.service.js`
- Test: `backend/src/__tests__/petaTematik.categorization.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/petaTematik.categorization.test.js`:

```javascript
const { classify, KATEGORI_LIST } = require('../services/petaTematik/categorization.service');

describe('categorization', () => {
  describe('classify', () => {
    test('Kependudukan keywords', () => {
      expect(classify('Proyeksi Penduduk Menurut Kabupaten/Kota')).toBe('Kependudukan');
      expect(classify('Kepadatan Penduduk Menurut Kabupten/Kota')).toBe('Kependudukan');
      expect(classify('Rasio Jenis Kelamin Menurut Kabupaten/Kota')).toBe('Kependudukan');
      expect(classify('Rumah Tangga dan Rata-rata Banyaknya Anggota Rumah Tangga')).toBe('Kependudukan');
    });

    test('Ketenagakerjaan keywords', () => {
      expect(classify('Tingkat Pengangguran Terbuka (TPT) Kabupaten/Kota')).toBe('Ketenagakerjaan');
      expect(classify('Tingkat Partisipasi Angkatan Kerja (TPAK) Menurut Kabupaten/Kota')).toBe('Ketenagakerjaan');
      expect(classify('Pencari Kerja Terdaftar')).toBe('Ketenagakerjaan');
    });

    test('Pendidikan keywords', () => {
      expect(classify('Harapan Lama Sekolah Menurut Kabupaten/Kota (Tahun)')).toBe('Pendidikan');
      expect(classify('Rata-Rata Lama Sekolah Menurut Kabupaten/Kota (Tahun)')).toBe('Pendidikan');
    });

    test('Kesehatan keywords', () => {
      expect(classify('[Metode Baru] Umur Harapan Hidup Saat Lahir (UHH)')).toBe('Kesehatan');
    });

    test('Ekonomi keywords', () => {
      expect(classify('[Seri 2010] Produk Domestik Regional Bruto Menurut Kabupaten/Kota')).toBe('Ekonomi');
      expect(classify('Persentase Penduduk Miskin Maluku Utara')).toBe('Ekonomi');
      expect(classify('Inflasi Provinsi Maluku Utara')).toBe('Ekonomi');
      expect(classify('Nilai Tukar Petani')).toBe('Ekonomi');
    });

    test('Pariwisata & Akomodasi keywords', () => {
      expect(classify('Jumlah Perjalanan Wisatawan Nusantara Menurut Kabupaten Tujuan'))
        .toBe('Pariwisata & Akomodasi');
      expect(classify('Tingkat Penghunian Kamar Hotel Bintang dan Non Bintang'))
        .toBe('Pariwisata & Akomodasi');
    });

    test('Pembangunan & Sosial keywords', () => {
      expect(classify('[Metode Baru] Indeks Pembangunan Manusia')).toBe('Pembangunan & Sosial');
      expect(classify('Jumlah Perceraian Menurut Kabupaten/Kota')).toBe('Pembangunan & Sosial');
    });

    test('falls back to Lainnya', () => {
      expect(classify('Some Random Indikator Title Without Keyword')).toBe('Lainnya');
      expect(classify('XYZ ABC')).toBe('Lainnya');
    });

    test('handles falsy input', () => {
      expect(classify('')).toBe('Lainnya');
      expect(classify(null)).toBe('Lainnya');
      expect(classify(undefined)).toBe('Lainnya');
    });

    test('case-insensitive', () => {
      expect(classify('PENDUDUK MISKIN')).toBe('Ekonomi');
      expect(classify('penduduk miskin')).toBe('Ekonomi');
    });
  });

  describe('KATEGORI_LIST', () => {
    test('exposes 8 kategori (7 + Lainnya) in order', () => {
      expect(KATEGORI_LIST).toEqual([
        'Kependudukan',
        'Ketenagakerjaan',
        'Pendidikan',
        'Kesehatan',
        'Ekonomi',
        'Pariwisata & Akomodasi',
        'Pembangunan & Sosial',
        'Lainnya',
      ]);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest petaTematik.categorization --no-coverage
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement categorization.service.js**

Create `backend/src/services/petaTematik/categorization.service.js`:

```javascript
'use strict';

/**
 * Maps BPS indikator source_name to one of 8 kategori (7 + Lainnya fallback).
 * First-match wins. Keywords matched as case-insensitive substring.
 *
 * Keywords curated based on audit of 311 indikator tables — see
 * docs/superpowers/specs/2026-05-06-peta-tematik-design.md sec 3.
 */

const RULES = Object.freeze([
  Object.freeze({ kategori: 'Kependudukan', keywords: [
    'penduduk', 'rumah tangga', 'proyeksi', 'migrasi',
    'kepadatan', 'rasio jenis kelamin'
  ]}),
  Object.freeze({ kategori: 'Ketenagakerjaan', keywords: [
    'tpak', 'tpt', 'pengangguran', 'pekerja', 'bekerja',
    'pencari kerja', 'lowongan', 'angkatan kerja'
  ]}),
  Object.freeze({ kategori: 'Pendidikan', keywords: [
    'sekolah', 'pendidikan', 'melek huruf',
    'aps', 'apk', 'apm', 'harapan lama sekolah', 'rata-rata lama sekolah'
  ]}),
  Object.freeze({ kategori: 'Kesehatan', keywords: [
    'umur harapan hidup', 'uhh', 'kesehatan', 'gizi',
    'imunisasi', 'puskesmas', 'posyandu', 'kematian', 'kelahiran'
  ]}),
  Object.freeze({ kategori: 'Ekonomi', keywords: [
    'pdrb', 'pendapatan', 'pengeluaran', 'kemiskinan', 'gini',
    'koperasi', 'umkm', 'industri', 'produksi', 'pertanian',
    'perikanan', 'peternakan', 'tukar petani', 'inflasi'
  ]}),
  Object.freeze({ kategori: 'Pariwisata & Akomodasi', keywords: [
    'wisata', 'wisatawan', 'hotel', 'akomodasi', 'kamar', 'tamu menginap',
    'penghunian'
  ]}),
  Object.freeze({ kategori: 'Pembangunan & Sosial', keywords: [
    'ipm', 'pembangunan manusia', 'perceraian', 'gender',
    'ikg', 'idi', 'desa'
  ]}),
]);

const KATEGORI_LIST = Object.freeze([
  ...RULES.map(r => r.kategori),
  'Lainnya',
]);

function classify(sourceName) {
  if (!sourceName || typeof sourceName !== 'string') return 'Lainnya';
  const lower = sourceName.toLowerCase();
  for (const rule of RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return rule.kategori;
    }
  }
  return 'Lainnya';
}

module.exports = { classify, KATEGORI_LIST, RULES };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx jest petaTematik.categorization --no-coverage
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/petaTematik/categorization.service.js \
        backend/src/__tests__/petaTematik.categorization.test.js
git commit -m "feat(peta-tematik): categorization.service — source_name → kategori

7 kategori (Kependudukan, Ketenagakerjaan, Pendidikan, Kesehatan,
Ekonomi, Pariwisata & Akomodasi, Pembangunan & Sosial) + Lainnya
fallback. Pure function, case-insensitive substring match."
```

---

## Task 4: cache.service.js (lru wrapper)

**Files:**
- Create: `backend/src/services/petaTematik/cache.service.js`
- Test: `backend/src/__tests__/petaTematik.cache.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/petaTematik.cache.test.js`:

```javascript
const cache = require('../services/petaTematik/cache.service');

describe('petaTematik.cache', () => {
  beforeEach(() => cache.clear());

  test('get returns undefined for missing key', () => {
    expect(cache.get('missing')).toBeUndefined();
  });

  test('set then get round-trip', () => {
    cache.set('a', { foo: 1 });
    expect(cache.get('a')).toEqual({ foo: 1 });
  });

  test('keys are isolated', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
  });

  test('getOrCompute uses cached value', async () => {
    cache.set('k', 'cached');
    const compute = jest.fn(async () => 'fresh');
    const v = await cache.getOrCompute('k', compute);
    expect(v).toBe('cached');
    expect(compute).not.toHaveBeenCalled();
  });

  test('getOrCompute computes and stores on miss', async () => {
    const compute = jest.fn(async () => 'computed');
    const v = await cache.getOrCompute('miss', compute);
    expect(v).toBe('computed');
    expect(cache.get('miss')).toBe('computed');
    expect(compute).toHaveBeenCalledTimes(1);
  });

  test('clear removes all entries', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest petaTematik.cache --no-coverage
```

Expected: FAIL.

- [ ] **Step 3: Implement cache.service.js**

Create `backend/src/services/petaTematik/cache.service.js`:

```javascript
'use strict';

const { LRUCache } = require('lru-cache');

const TTL_MS = 60 * 60 * 1000;   // 1 jam
const MAX_ENTRIES = 500;

const lru = new LRUCache({
  max: MAX_ENTRIES,
  ttl: TTL_MS,
});

function get(key) {
  return lru.get(key);
}

function set(key, value) {
  lru.set(key, value);
}

function clear() {
  lru.clear();
}

async function getOrCompute(key, computeFn) {
  const cached = lru.get(key);
  if (cached !== undefined) return cached;
  const fresh = await computeFn();
  lru.set(key, fresh);
  return fresh;
}

module.exports = { get, set, clear, getOrCompute, TTL_MS, MAX_ENTRIES };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx jest petaTematik.cache --no-coverage
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/petaTematik/cache.service.js \
        backend/src/__tests__/petaTematik.cache.test.js
git commit -m "feat(peta-tematik): cache.service — lru-cache wrapper

TTL 1 jam, max 500 entries. Exposes get/set/clear/getOrCompute. Used
by service layer to memoize indikator-list, years, metrics, data, summary."
```

---

## Task 5: eligibilityScanner.service.js

**Files:**
- Create: `backend/src/services/petaTematik/eligibilityScanner.service.js`
- Test: `backend/src/__tests__/petaTematik.eligibilityScanner.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/petaTematik.eligibilityScanner.test.js`:

```javascript
const { scanEligibility, buildIndikatorList } = require('../services/petaTematik/eligibilityScanner.service');

describe('eligibilityScanner', () => {
  describe('scanEligibility', () => {
    test('marks table eligible when dim_value contains a Malut kab/kota', async () => {
      // Mock sequelize.query: first call returns table list,
      // subsequent calls return per-table aggregate
      const queryMock = jest.fn();
      queryMock.mockResolvedValueOnce([[
        { TABLE_NAME: 'indikator_182' },
        { TABLE_NAME: 'indikator_1' },
      ]]);
      queryMock.mockResolvedValueOnce([[{
        source_id: 182,
        source_name: 'Kepadatan Penduduk Menurut Kabupten/Kota',
        region_rows: 50,
      }]]);
      queryMock.mockResolvedValueOnce([[{
        source_id: 1,
        source_name: 'Inflasi Provinsi Maluku Utara',
        region_rows: 0,
      }]]);

      const seq = { query: queryMock };
      const result = await scanEligibility(seq);

      expect(result).toHaveLength(2);
      const ind182 = result.find(r => r.tableName === 'indikator_182');
      expect(ind182.eligible).toBe(true);
      expect(ind182.sourceId).toBe(182);
      expect(ind182.sourceName).toContain('Kepadatan Penduduk');

      const ind1 = result.find(r => r.tableName === 'indikator_1');
      expect(ind1.eligible).toBe(false);
    });

    test('handles empty table list', async () => {
      const seq = { query: jest.fn().mockResolvedValueOnce([[]]) };
      const result = await scanEligibility(seq);
      expect(result).toEqual([]);
    });

    test('skips indikator_418 (multi-dim, MVP exclusion)', async () => {
      const queryMock = jest.fn();
      queryMock.mockResolvedValueOnce([[{ TABLE_NAME: 'indikator_418' }]]);
      queryMock.mockResolvedValueOnce([[{
        source_id: 418, source_name: 'Pelanggan Listrik', region_rows: 50
      }]]);
      const seq = { query: queryMock };
      const result = await scanEligibility(seq);
      expect(result.find(r => r.tableName === 'indikator_418').eligible).toBe(false);
    });
  });

  describe('buildIndikatorList', () => {
    test('groups eligible by kategori, sorted', () => {
      const scanResults = [
        { tableName: 'indikator_182', sourceId: 182, sourceName: 'Kepadatan Penduduk', eligible: true },
        { tableName: 'indikator_13',  sourceId: 13,  sourceName: 'Harapan Lama Sekolah', eligible: true },
        { tableName: 'indikator_1',   sourceId: 1,   sourceName: 'Inflasi Provinsi', eligible: false },
        { tableName: 'indikator_201', sourceId: 201, sourceName: 'TPT Kabupaten/Kota', eligible: true },
      ];
      const list = buildIndikatorList(scanResults);

      expect(list.kategori).toBeDefined();
      expect(list.totalEligible).toBe(3);
      expect(list.kategori.Kependudukan).toHaveLength(1);
      expect(list.kategori.Kependudukan[0].sourceName).toBe('Kepadatan Penduduk');
      expect(list.kategori.Pendidikan).toHaveLength(1);
      expect(list.kategori.Ketenagakerjaan).toHaveLength(1);
      // No Inflasi (not eligible)
      expect(list.kategori.Ekonomi).toBeUndefined();
    });

    test('returns empty kategori map when no eligible', () => {
      const list = buildIndikatorList([]);
      expect(list.totalEligible).toBe(0);
      expect(list.kategori).toEqual({});
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest petaTematik.eligibilityScanner --no-coverage
```

Expected: FAIL.

- [ ] **Step 3: Implement eligibilityScanner.service.js**

Create `backend/src/services/petaTematik/eligibilityScanner.service.js`:

```javascript
'use strict';

const { classify } = require('./categorization.service');
const { NAME_TO_KDKAB } = require('./regionMap.service');

const EXCLUDED_TABLES = new Set([
  'indikator_418',  // multi-dim Pelanggan Listrik (MVP exclusion)
  'indikator_159',  // EXIM Ekspor (multidim pipe-separated)
  'indikator_160',  // EXIM Impor
]);

// 10 kab/kota Malut + variants with Kabupaten/Kota prefix
const KABKOTA_NAMES = (() => {
  const names = Object.keys(NAME_TO_KDKAB).map(n =>
    n.replace(/\b\w/g, c => c.toUpperCase()) // title case "halmahera barat" → "Halmahera Barat"
  );
  const variants = [];
  for (const n of names) {
    variants.push(n);
    if (['Ternate', 'Tidore Kepulauan'].includes(n)) {
      variants.push(`Kota ${n}`);
    } else {
      variants.push(`Kabupaten ${n}`);
    }
  }
  return variants;
})();

async function scanEligibility(sequelizeBps) {
  const [tables] = await sequelizeBps.query(
    `SELECT TABLE_NAME
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME LIKE 'indikator_%'
      ORDER BY TABLE_NAME`
  );

  const results = [];
  for (const row of tables) {
    const tableName = row.TABLE_NAME;
    if (EXCLUDED_TABLES.has(tableName)) {
      results.push({ tableName, sourceId: null, sourceName: null, eligible: false });
      continue;
    }
    try {
      const placeholders = KABKOTA_NAMES.map(() => '?').join(',');
      const [aggRows] = await sequelizeBps.query(
        `SELECT MAX(source_id) AS source_id,
                MAX(source_name) AS source_name,
                SUM(CASE WHEN dim_value IN (${placeholders}) THEN 1 ELSE 0 END) AS region_rows
           FROM \`${tableName}\``,
        { replacements: KABKOTA_NAMES }
      );
      const agg = aggRows[0] || {};
      results.push({
        tableName,
        sourceId: agg.source_id ? Number(agg.source_id) : null,
        sourceName: agg.source_name || null,
        eligible: Number(agg.region_rows || 0) > 0,
      });
    } catch (e) {
      // Table might be malformed; log + skip
      console.warn(`[petaTematik] scan skipped ${tableName}: ${e.message}`);
      results.push({ tableName, sourceId: null, sourceName: null, eligible: false });
    }
  }
  return results;
}

function buildIndikatorList(scanResults) {
  const kategori = {};
  let totalEligible = 0;
  for (const r of scanResults) {
    if (!r.eligible || !r.sourceId || !r.sourceName) continue;
    totalEligible++;
    const k = classify(r.sourceName);
    if (!kategori[k]) kategori[k] = [];
    kategori[k].push({
      sourceId: r.sourceId,
      sourceName: r.sourceName,
      tableName: r.tableName,
    });
  }
  // Sort indikator alphabetically within each kategori
  for (const k of Object.keys(kategori)) {
    kategori[k].sort((a, b) => a.sourceName.localeCompare(b.sourceName, 'id'));
  }
  return { totalEligible, kategori };
}

module.exports = { scanEligibility, buildIndikatorList, EXCLUDED_TABLES };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx jest petaTematik.eligibilityScanner --no-coverage
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/petaTematik/eligibilityScanner.service.js \
        backend/src/__tests__/petaTematik.eligibilityScanner.test.js
git commit -m "feat(peta-tematik): eligibilityScanner — boot scan 311 tabel

scanEligibility iterates information_schema, queries each indikator_*
for region_rows count. buildIndikatorList groups eligible by 7 kategori.
Excludes indikator_418, _159, _160 (multi-dim, MVP-out)."
```

---

## Task 6: petaTematik.service.js — getYears + getMetrics

**Files:**
- Create: `backend/src/services/petaTematik/petaTematik.service.js`
- Test: `backend/src/__tests__/petaTematik.service.test.js`

- [ ] **Step 1: Write failing tests for getYears + getMetrics**

Create `backend/src/__tests__/petaTematik.service.test.js`:

```javascript
const svc = require('../services/petaTematik/petaTematik.service');
const cache = require('../services/petaTematik/cache.service');

// Mock the DB module
jest.mock('../config/db_bps', () => {
  const queryMock = jest.fn();
  return jest.fn(() => ({ query: queryMock, _queryMock: queryMock }));
});

const getSequelizeBps = require('../config/db_bps');

describe('petaTematik.service', () => {
  beforeEach(() => {
    cache.clear();
    getSequelizeBps()._queryMock.mockReset();
  });

  describe('getYears', () => {
    test('returns sorted years and has_monthly flag', async () => {
      getSequelizeBps()._queryMock.mockResolvedValueOnce([[
        { year: 2024 }, { year: 2023 }, { year: 2022 },
      ]]);
      getSequelizeBps()._queryMock.mockResolvedValueOnce([[
        { has_monthly: 1 },
      ]]);

      const result = await svc.getYears(182);
      expect(result.years).toEqual([2022, 2023, 2024]);
      expect(result.has_monthly).toBe(true);
    });

    test('rejects invalid indikator id', async () => {
      await expect(svc.getYears('abc')).rejects.toThrow('Invalid indikator');
      await expect(svc.getYears(0)).rejects.toThrow('Invalid indikator');
      await expect(svc.getYears(-5)).rejects.toThrow('Invalid indikator');
    });

    test('caches result', async () => {
      const m = getSequelizeBps()._queryMock;
      m.mockResolvedValueOnce([[{ year: 2024 }]]);
      m.mockResolvedValueOnce([[{ has_monthly: 0 }]]);

      await svc.getYears(182);
      await svc.getYears(182);  // should hit cache
      expect(m).toHaveBeenCalledTimes(2); // 2 calls only on first invocation
    });
  });

  describe('getMetrics', () => {
    test('returns distinct metrics', async () => {
      getSequelizeBps()._queryMock.mockResolvedValueOnce([[
        { metric: 'value' }, { metric: 'month-to-month' },
      ]]);
      const result = await svc.getMetrics(182);
      expect(result.metrics).toEqual(['month-to-month', 'value']); // sorted
    });

    test('includes empty/null metric as "value" fallback', async () => {
      getSequelizeBps()._queryMock.mockResolvedValueOnce([[
        { metric: '' },
      ]]);
      const result = await svc.getMetrics(182);
      expect(result.metrics).toEqual(['value']);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && npx jest petaTematik.service --no-coverage
```

Expected: FAIL.

- [ ] **Step 3: Implement getYears + getMetrics**

Create `backend/src/services/petaTematik/petaTematik.service.js`:

```javascript
'use strict';

const getSequelizeBps = require('../../config/db_bps');
const cache = require('./cache.service');
const { dimValueToKdkab, KDKAB_TO_NAMA } = require('./regionMap.service');

function validateIndikatorId(id) {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new Error('Invalid indikator id');
  }
  return n;
}

function tableName(id) {
  return `indikator_${validateIndikatorId(id)}`;
}

async function getYears(indikatorId) {
  const id = validateIndikatorId(indikatorId);
  return cache.getOrCompute(`ind:${id}:years`, async () => {
    const seq = getSequelizeBps();
    const [yearRows] = await seq.query(
      `SELECT DISTINCT year FROM \`${tableName(id)}\`
        WHERE year > 0 ORDER BY year ASC`
    );
    const [hmRows] = await seq.query(
      `SELECT (SUM(CASE WHEN month_no BETWEEN 1 AND 12 THEN 1 ELSE 0 END) > 0) AS has_monthly
         FROM \`${tableName(id)}\``
    );
    return {
      years: yearRows.map(r => Number(r.year)),
      has_monthly: Number(hmRows[0]?.has_monthly || 0) === 1,
    };
  });
}

async function getMetrics(indikatorId) {
  const id = validateIndikatorId(indikatorId);
  return cache.getOrCompute(`ind:${id}:metrics`, async () => {
    const seq = getSequelizeBps();
    const [rows] = await seq.query(
      `SELECT DISTINCT COALESCE(NULLIF(metric, ''), 'value') AS metric
         FROM \`${tableName(id)}\` WHERE year > 0`
    );
    const set = new Set(rows.map(r => r.metric));
    return { metrics: [...set].sort() };
  });
}

module.exports = { getYears, getMetrics, validateIndikatorId };
```

- [ ] **Step 4: Run test**

```bash
cd backend && npx jest petaTematik.service --no-coverage
```

Expected: PASS for getYears + getMetrics tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/petaTematik/petaTematik.service.js \
        backend/src/__tests__/petaTematik.service.test.js
git commit -m "feat(peta-tematik): service.getYears + getMetrics

Validate indikator id (integer > 0). Filter year > 0. has_monthly flag
computed from any month_no in 1-12. Empty metric coalesced to 'value'.
Cached via cache.service."
```

---

## Task 7: petaTematik.service — getData

**Files:**
- Modify: `backend/src/services/petaTematik/petaTematik.service.js`
- Modify: `backend/src/__tests__/petaTematik.service.test.js`

- [ ] **Step 1: Backup**

```bash
cp backend/src/services/petaTematik/petaTematik.service.js \
   backend/src/services/petaTematik/petaTematik.service.js.backup
cp backend/src/__tests__/petaTematik.service.test.js \
   backend/src/__tests__/petaTematik.service.test.js.backup
```

- [ ] **Step 2: Add failing test for getData**

Append to `backend/src/__tests__/petaTematik.service.test.js`:

```javascript
  describe('getData', () => {
    test('returns 10 polygons with kdkab + value, null for missing kab', async () => {
      getSequelizeBps()._queryMock.mockResolvedValueOnce([[
        { dim_value: 'Halmahera Barat', value: 80.71 },
        { dim_value: 'Ternate', value: 1856.05 },
        // 8 missing
      ]]);

      const result = await svc.getData({ indikator: 182, year: 2022 });
      expect(result).toHaveLength(10);
      const halbar = result.find(r => r.kdkab === '01');
      expect(halbar.nama_kab).toBe('Halmahera Barat');
      expect(halbar.value).toBeCloseTo(80.71);
      const ternate = result.find(r => r.kdkab === '71');
      expect(ternate.value).toBeCloseTo(1856.05);
      // Missing kab → value: null
      const halteng = result.find(r => r.kdkab === '02');
      expect(halteng.value).toBeNull();
    });

    test('skips Maluku Utara (province total)', async () => {
      getSequelizeBps()._queryMock.mockResolvedValueOnce([[
        { dim_value: 'Maluku Utara', value: 41.25 },
        { dim_value: 'Halmahera Barat', value: 80.71 },
      ]]);
      const result = await svc.getData({ indikator: 182, year: 2022 });
      // No row with kdkab matching Maluku Utara — only 10 kab/kota
      expect(result).toHaveLength(10);
      expect(result.every(r => r.kdkab !== null)).toBe(true);
    });

    test('passes month + metric filters when provided', async () => {
      const m = getSequelizeBps()._queryMock;
      m.mockResolvedValueOnce([[{ dim_value: 'Ternate', value: 100 }]]);
      await svc.getData({ indikator: 182, year: 2024, month: 6, metric: 'value' });
      const callArgs = m.mock.calls[0];
      expect(callArgs[0]).toMatch(/month_no = \?/);
      expect(callArgs[0]).toMatch(/metric = \?/);
      expect(callArgs[1].replacements).toContain(6);
      expect(callArgs[1].replacements).toContain('value');
    });

    test('rejects invalid year', async () => {
      await expect(svc.getData({ indikator: 182, year: 0 })).rejects.toThrow('Invalid year');
      await expect(svc.getData({ indikator: 182, year: 'abc' })).rejects.toThrow('Invalid year');
    });
  });
```

- [ ] **Step 3: Run test to verify failure**

```bash
cd backend && npx jest petaTematik.service --no-coverage
```

Expected: getData tests FAIL.

- [ ] **Step 4: Add getData to service**

Append to `backend/src/services/petaTematik/petaTematik.service.js` (before `module.exports`):

```javascript
function validateYear(y) {
  const n = Number(y);
  if (!Number.isInteger(n) || n <= 0 || n > 9999) {
    throw new Error('Invalid year');
  }
  return n;
}

const KABKOTA_NAMES_FULL = [
  'Halmahera Barat', 'Halmahera Tengah', 'Halmahera Utara', 'Halmahera Selatan',
  'Kepulauan Sula', 'Halmahera Timur', 'Pulau Morotai', 'Pulau Taliabu',
  'Ternate', 'Tidore Kepulauan',
  'Kabupaten Halmahera Barat', 'Kabupaten Halmahera Tengah',
  'Kabupaten Halmahera Utara', 'Kabupaten Halmahera Selatan',
  'Kabupaten Kepulauan Sula', 'Kabupaten Halmahera Timur',
  'Kabupaten Pulau Morotai', 'Kabupaten Pulau Taliabu',
  'Kota Ternate', 'Kota Tidore Kepulauan',
];

async function getData({ indikator, year, month = null, metric = null }) {
  const id = validateIndikatorId(indikator);
  const y = validateYear(year);
  const m = month == null ? null : validateYear(month); // 1-12 fits validateYear range
  const cacheKey = `data:${id}:${y}:${m || 0}:${metric || '*'}`;

  return cache.getOrCompute(cacheKey, async () => {
    const seq = getSequelizeBps();
    const placeholders = KABKOTA_NAMES_FULL.map(() => '?').join(',');
    const monthClause = m == null ? '' : 'AND month_no = ?';
    const metricClause = metric == null ? '' : "AND metric = ?";
    const replacements = [y, ...KABKOTA_NAMES_FULL];
    if (m != null) replacements.push(m);
    if (metric != null) replacements.push(metric);

    const [rows] = await seq.query(
      `SELECT dim_value, AVG(value) AS value
         FROM \`indikator_${id}\`
        WHERE year = ?
          AND year > 0
          ${monthClause}
          ${metricClause}
          AND dim_value IN (${placeholders})
        GROUP BY dim_value`,
      { replacements }
    );

    // Build kdkab → value map (skip nulls / Maluku Utara)
    const valueByKdkab = {};
    for (const r of rows) {
      const kdkab = dimValueToKdkab(r.dim_value);
      if (!kdkab) continue;
      const v = r.value == null ? null : Number(r.value);
      // If multiple variants of same kab (e.g. "Halbar" + "Kabupaten Halbar"), AVG them
      if (valueByKdkab[kdkab] == null) {
        valueByKdkab[kdkab] = v;
      } else if (v != null) {
        valueByKdkab[kdkab] = (valueByKdkab[kdkab] + v) / 2;
      }
    }

    // Always return all 10 polygons (null for missing)
    return Object.entries(KDKAB_TO_NAMA).map(([kdkab, nama_kab]) => ({
      kdkab,
      nama_kab,
      value: valueByKdkab[kdkab] ?? null,
    }));
  });
}
```

Update the `module.exports` line to:
```javascript
module.exports = { getYears, getMetrics, getData, validateIndikatorId };
```

- [ ] **Step 5: Run test**

```bash
cd backend && npx jest petaTematik.service --no-coverage
```

Expected: PASS all tests including new getData.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/petaTematik/petaTematik.service.js \
        backend/src/__tests__/petaTematik.service.test.js
git commit -m "feat(peta-tematik): service.getData — choropleth values per polygon

Returns 10 polygons (kdkab + nama_kab + value), null for kab/kota
without data. Skips 'Maluku Utara' province total. Adaptive month/metric
filters. AVG aggregation across multiple rows per polygon."
```

---

## Task 8: petaTematik.service — getSummary

**Files:**
- Modify: `backend/src/services/petaTematik/petaTematik.service.js`
- Modify: `backend/src/__tests__/petaTematik.service.test.js`

- [ ] **Step 1: Backup**

```bash
cp backend/src/services/petaTematik/petaTematik.service.js \
   backend/src/services/petaTematik/petaTematik.service.js.backup
cp backend/src/__tests__/petaTematik.service.test.js \
   backend/src/__tests__/petaTematik.service.test.js.backup
```

- [ ] **Step 2: Add failing test**

Append to `backend/src/__tests__/petaTematik.service.test.js`:

```javascript
  describe('getSummary', () => {
    test('returns provinsi_total + top3 + bottom3 + trend', async () => {
      const m = getSequelizeBps()._queryMock;
      // 1st call: provinsi total
      m.mockResolvedValueOnce([[{ provinsi_total: 41.25 }]]);
      // 2nd call: per-kab values for top/bottom
      m.mockResolvedValueOnce([[
        { dim_value: 'Ternate', value: 1856 },
        { dim_value: 'Halmahera Barat', value: 80 },
        { dim_value: 'Tidore Kepulauan', value: 71 },
        { dim_value: 'Halmahera Utara', value: 52 },
        { dim_value: 'Pulau Taliabu', value: 40 },
        { dim_value: 'Kepulauan Sula', value: 32 },
        { dim_value: 'Pulau Morotai', value: 31 },
        { dim_value: 'Halmahera Selatan', value: 31 },
        { dim_value: 'Halmahera Tengah', value: 22 },
        { dim_value: 'Halmahera Timur', value: 14 },
      ]]);
      // 3rd call: trend (last 5 years provinsi)
      m.mockResolvedValueOnce([[
        { year: 2020, provinsi_total: 38 },
        { year: 2021, provinsi_total: 39 },
        { year: 2022, provinsi_total: 41.25 },
      ]]);

      const result = await svc.getSummary({ indikator: 182, year: 2022 });
      expect(result.provinsi_total).toBeCloseTo(41.25);
      expect(result.top3).toHaveLength(3);
      expect(result.top3[0].nama_kab).toBe('Ternate');
      expect(result.top3[0].value).toBeCloseTo(1856);
      expect(result.bottom3).toHaveLength(3);
      expect(result.bottom3[0].nama_kab).toBe('Halmahera Timur');
      expect(result.trend).toHaveLength(3);
      expect(result.trend[2]).toEqual({ year: 2022, provinsi_total: 41.25 });
    });

    test('returns null provinsi_total if no row', async () => {
      const m = getSequelizeBps()._queryMock;
      m.mockResolvedValueOnce([[]]);  // no provinsi total
      m.mockResolvedValueOnce([[]]);  // no kab values
      m.mockResolvedValueOnce([[]]);  // no trend

      const result = await svc.getSummary({ indikator: 182, year: 2022 });
      expect(result.provinsi_total).toBeNull();
      expect(result.top3).toEqual([]);
      expect(result.bottom3).toEqual([]);
      expect(result.trend).toEqual([]);
    });
  });
```

- [ ] **Step 3: Run test to verify failure**

```bash
cd backend && npx jest petaTematik.service --no-coverage
```

Expected: getSummary tests FAIL.

- [ ] **Step 4: Add getSummary to service**

Append to `backend/src/services/petaTematik/petaTematik.service.js` (before `module.exports`):

```javascript
async function getSummary({ indikator, year, month = null, metric = null }) {
  const id = validateIndikatorId(indikator);
  const y = validateYear(year);
  const m = month == null ? null : validateYear(month);
  const cacheKey = `summary:${id}:${y}:${m || 0}:${metric || '*'}`;

  return cache.getOrCompute(cacheKey, async () => {
    const seq = getSequelizeBps();
    const monthClause = m == null ? '' : 'AND month_no = ?';
    const metricClause = metric == null ? '' : 'AND metric = ?';

    // 1. Provinsi total — try dim_value='Maluku Utara' first
    const provReplacements = [y];
    if (m != null) provReplacements.push(m);
    if (metric != null) provReplacements.push(metric);
    const [provRows] = await seq.query(
      `SELECT AVG(value) AS provinsi_total
         FROM \`indikator_${id}\`
        WHERE year = ? AND year > 0
          ${monthClause} ${metricClause}
          AND dim_value = 'Maluku Utara'`,
      { replacements: provReplacements }
    );
    const provinsi_total = provRows[0]?.provinsi_total != null
      ? Number(provRows[0].provinsi_total) : null;

    // 2. Per-kab values for top/bottom
    const data = await getData({ indikator: id, year: y, month: m, metric });
    const withValues = data.filter(d => d.value != null);
    const sorted = [...withValues].sort((a, b) => b.value - a.value);
    const top3 = sorted.slice(0, 3).map(d => ({ nama_kab: d.nama_kab, value: d.value }));
    const bottom3 = sorted.slice(-3).reverse()
      .map(d => ({ nama_kab: d.nama_kab, value: d.value }));

    // 3. Trend — last 5 years provinsi total
    const trendReplacements = [y];
    if (m != null) trendReplacements.push(m);
    if (metric != null) trendReplacements.push(metric);
    const [trendRows] = await seq.query(
      `SELECT year, AVG(value) AS provinsi_total
         FROM \`indikator_${id}\`
        WHERE year BETWEEN ? - 4 AND ?
          AND year > 0
          ${monthClause} ${metricClause}
          AND dim_value = 'Maluku Utara'
        GROUP BY year
        ORDER BY year ASC`,
      { replacements: [y, ...trendReplacements] }
    );
    const trend = trendRows.map(r => ({
      year: Number(r.year),
      provinsi_total: r.provinsi_total != null ? Number(r.provinsi_total) : null,
    }));

    return { provinsi_total, top3, bottom3, trend };
  });
}
```

Update `module.exports`:
```javascript
module.exports = { getYears, getMetrics, getData, getSummary, validateIndikatorId };
```

- [ ] **Step 5: Run test**

```bash
cd backend && npx jest petaTematik.service --no-coverage
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/petaTematik/petaTematik.service.js \
        backend/src/__tests__/petaTematik.service.test.js
git commit -m "feat(peta-tematik): service.getSummary — info panel data

Returns { provinsi_total, top3, bottom3, trend (5y) }. Reuses getData
internally for top/bottom ordering. Trend queries dim_value='Maluku Utara'
for last 5 years."
```

---

## Task 9: Wire indikatorList in service + boot scanner

**Files:**
- Modify: `backend/src/services/petaTematik/petaTematik.service.js`
- Modify: `backend/src/__tests__/petaTematik.service.test.js`

- [ ] **Step 1: Backup**

```bash
cp backend/src/services/petaTematik/petaTematik.service.js \
   backend/src/services/petaTematik/petaTematik.service.js.backup
```

- [ ] **Step 2: Add failing test for getIndikatorList + initIndikatorList**

Append to `backend/src/__tests__/petaTematik.service.test.js`:

```javascript
  describe('getIndikatorList + initIndikatorList', () => {
    test('initIndikatorList caches result; getIndikatorList returns it', async () => {
      // Mock scanEligibility's underlying queries
      const m = getSequelizeBps()._queryMock;
      m.mockResolvedValueOnce([[ // table list
        { TABLE_NAME: 'indikator_182' },
      ]]);
      m.mockResolvedValueOnce([[ // per-table aggregate
        { source_id: 182, source_name: 'Kepadatan Penduduk', region_rows: 50 },
      ]]);

      await svc.initIndikatorList();
      const list = await svc.getIndikatorList();

      expect(list.totalEligible).toBe(1);
      expect(list.kategori.Kependudukan).toHaveLength(1);
      expect(list.kategori.Kependudukan[0].sourceId).toBe(182);
    });

    test('getIndikatorList without prior init returns empty fallback', async () => {
      cache.clear();
      const list = await svc.getIndikatorList();
      expect(list.totalEligible).toBe(0);
      expect(list.kategori).toEqual({});
    });
  });
```

- [ ] **Step 3: Run test to verify failure**

```bash
cd backend && npx jest petaTematik.service --no-coverage
```

Expected: FAIL.

- [ ] **Step 4: Add getIndikatorList + initIndikatorList**

Append to `backend/src/services/petaTematik/petaTematik.service.js` (top of file, after the existing `require`s):

```javascript
const { scanEligibility, buildIndikatorList } = require('./eligibilityScanner.service');
```

Add functions before `module.exports`:

```javascript
const INDIKATOR_LIST_KEY = 'ind:list';

async function initIndikatorList() {
  const seq = getSequelizeBps();
  if (!seq) {
    cache.set(INDIKATOR_LIST_KEY, { totalEligible: 0, kategori: {} });
    return;
  }
  try {
    const scanResults = await scanEligibility(seq);
    const list = buildIndikatorList(scanResults);
    cache.set(INDIKATOR_LIST_KEY, list);
    console.log(`[petaTematik] indikator list ready: ${list.totalEligible} eligible`);
  } catch (e) {
    console.error('[petaTematik] initIndikatorList failed:', e.message);
    cache.set(INDIKATOR_LIST_KEY, { totalEligible: 0, kategori: {} });
  }
}

async function getIndikatorList() {
  const cached = cache.get(INDIKATOR_LIST_KEY);
  if (cached) return cached;
  return { totalEligible: 0, kategori: {} };
}

function isValidIndikator(id) {
  const list = cache.get(INDIKATOR_LIST_KEY);
  if (!list || !list.kategori) return false;
  for (const items of Object.values(list.kategori)) {
    if (items.some(it => it.sourceId === Number(id))) return true;
  }
  return false;
}
```

Update `module.exports`:
```javascript
module.exports = {
  getYears, getMetrics, getData, getSummary,
  getIndikatorList, initIndikatorList, isValidIndikator,
  validateIndikatorId,
};
```

- [ ] **Step 5: Run test**

```bash
cd backend && npx jest petaTematik.service --no-coverage
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/petaTematik/petaTematik.service.js \
        backend/src/__tests__/petaTematik.service.test.js
git commit -m "feat(peta-tematik): service.initIndikatorList + getIndikatorList

initIndikatorList runs eligibility scanner + buildIndikatorList, caches
result under 'ind:list'. getIndikatorList returns from cache (empty
fallback if not initialized). isValidIndikator is whitelist check used
by routes for SQL injection guard."
```

---

## Task 10: Wire boot scanner in server.js

**Files:**
- Modify: `backend/src/server.js`

- [ ] **Step 1: Backup**

```bash
cp backend/src/server.js backend/src/server.js.backup
```

- [ ] **Step 2: Find process.send('ready') call in server.js**

```bash
grep -n "process.send('ready')\|server.listen" backend/src/server.js | head -5
```

Note the line number — boot scanner runs **after** ready signal.

- [ ] **Step 3: Add boot scanner invocation after process.send('ready')**

Insert after `process.send('ready')` (or after `app.listen` callback):

```javascript
// Peta Tematik: pre-build indikator list async (non-blocking)
const petaTematikSvc = require('./services/petaTematik/petaTematik.service');
petaTematikSvc.initIndikatorList()
  .catch(e => console.error('[petaTematik] init failed:', e.message));
```

- [ ] **Step 4: Smoke test — server boots, indikator-list endpoint returns data**

```bash
cd backend && npm start &
SERVER_PID=$!
# Wait for ready signal + scanner ~1-2s extra
sleep 60
# Get auth token first (use existing test admin login flow)
# For dev: skip auth or use token. Example assumes admin token in env.
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:5000/peta-tematik/indikator-list | jq '.totalEligible'
# Expected: ~203 (eligible count)
kill $SERVER_PID
```

If `totalEligible` < 100, scanner failed silently — check server logs.

- [ ] **Step 5: Commit**

```bash
git add backend/src/server.js
git commit -m "feat(peta-tematik): wire boot-time indikator list scanner

Runs after process.send('ready') so PM2 doesn't wait. Logs eligible count.
Failure is non-fatal (indikator list endpoint returns empty fallback)."
```

---

## Task 11: Implement controller methods

**Files:**
- Modify: `backend/src/controllers/peta-tematik.controller.js`

- [ ] **Step 1: Backup**

```bash
cp backend/src/controllers/peta-tematik.controller.js \
   backend/src/controllers/peta-tematik.controller.js.backup
```

- [ ] **Step 2: Replace controller skeleton with full implementation**

Overwrite `backend/src/controllers/peta-tematik.controller.js`:

```javascript
'use strict';

const svc = require('../services/petaTematik/petaTematik.service');

function parseInt32(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 99999 ? n : null;
}

async function withGuard(req, res, fn) {
  try {
    const result = await fn();
    res.json({ ok: true, ...result });
  } catch (e) {
    const code = /Invalid/.test(e.message) ? 400 : 500;
    res.status(code).json({ ok: false, error: e.message || 'Server error' });
  }
}

module.exports = {
  async getIndikatorList(req, res) {
    return withGuard(req, res, async () => {
      const list = await svc.getIndikatorList();
      return list;
    });
  },

  async getYears(req, res) {
    return withGuard(req, res, async () => {
      const id = parseInt32(req.query.indikator);
      if (!id) throw new Error('Invalid indikator id');
      if (!svc.isValidIndikator(id)) throw new Error('Invalid indikator (not in eligible list)');
      return svc.getYears(id);
    });
  },

  async getMetrics(req, res) {
    return withGuard(req, res, async () => {
      const id = parseInt32(req.query.indikator);
      if (!id) throw new Error('Invalid indikator id');
      if (!svc.isValidIndikator(id)) throw new Error('Invalid indikator (not in eligible list)');
      return svc.getMetrics(id);
    });
  },

  async getData(req, res) {
    return withGuard(req, res, async () => {
      const id = parseInt32(req.query.indikator);
      const year = parseInt32(req.query.year);
      if (!id || !year) throw new Error('Invalid indikator or year');
      if (!svc.isValidIndikator(id)) throw new Error('Invalid indikator (not in eligible list)');
      const month = req.query.month ? parseInt32(req.query.month) : null;
      const metric = typeof req.query.metric === 'string' && req.query.metric ? req.query.metric : null;
      const rows = await svc.getData({ indikator: id, year, month, metric });
      return { data: rows };
    });
  },

  async getSummary(req, res) {
    return withGuard(req, res, async () => {
      const id = parseInt32(req.query.indikator);
      const year = parseInt32(req.query.year);
      if (!id || !year) throw new Error('Invalid indikator or year');
      if (!svc.isValidIndikator(id)) throw new Error('Invalid indikator (not in eligible list)');
      const month = req.query.month ? parseInt32(req.query.month) : null;
      const metric = typeof req.query.metric === 'string' && req.query.metric ? req.query.metric : null;
      return svc.getSummary({ indikator: id, year, month, metric });
    });
  },
};
```

- [ ] **Step 3: Smoke-test endpoints (run server, hit each)**

```bash
cd backend && npm start &
SERVER_PID=$!
sleep 60   # wait for boot + scanner

# Replace $ADMIN_TOKEN with a valid token from existing auth flow
TOKEN="$ADMIN_TOKEN"
H="Authorization: Bearer $TOKEN"
B="http://localhost:5000/peta-tematik"

curl -s -H "$H" "$B/indikator-list" | jq '.totalEligible' # ~203
INDIKATOR_ID=$(curl -s -H "$H" "$B/indikator-list" | jq -r '.kategori.Kependudukan[0].sourceId')
echo "Picked indikator: $INDIKATOR_ID"

curl -s -H "$H" "$B/years?indikator=$INDIKATOR_ID" | jq
curl -s -H "$H" "$B/metrics?indikator=$INDIKATOR_ID" | jq
YEAR=$(curl -s -H "$H" "$B/years?indikator=$INDIKATOR_ID" | jq '.years[-1]')
curl -s -H "$H" "$B/data?indikator=$INDIKATOR_ID&year=$YEAR" | jq '.data | length'
# Expected: 10
curl -s -H "$H" "$B/summary?indikator=$INDIKATOR_ID&year=$YEAR" | jq '.top3 | length'
# Expected: 3

# Bad input
curl -s -o /dev/null -w "%{http_code}\n" -H "$H" "$B/data?indikator=abc&year=2024"
# Expected: 400
curl -s -o /dev/null -w "%{http_code}\n" -H "$H" "$B/data?indikator=999999&year=2024"
# Expected: 400 (not in eligible list)

kill $SERVER_PID
```

All endpoints should return 200 with valid JSON. Bad inputs return 400.

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/peta-tematik.controller.js
git commit -m "feat(peta-tematik): controller — wire 5 endpoints

Validates indikator id (integer + whitelist via isValidIndikator).
Returns 400 for invalid params, 500 for service errors. Standard
{ ok, ...payload } / { ok: false, error } response shape."
```

---

## Task 12: Frontend setup — install deps + types/api/colorScale

**Files:**
- Modify: `backend/admin/package.json`
- Create: `backend/admin/components/peta-tematik/types.ts`
- Create: `backend/admin/components/peta-tematik/api.ts`
- Create: `backend/admin/components/peta-tematik/colorScale.ts`

- [ ] **Step 1: Backup admin package.json**

```bash
cp backend/admin/package.json backend/admin/package.json.backup
```

- [ ] **Step 2: Install frontend deps**

```bash
cd backend/admin && npm install \
  react-leaflet@^4.2.1 \
  html2canvas@^1.4.1 \
  cmdk@^1.0.0 \
  --save && cd ../..
```

- [ ] **Step 3: Create types.ts**

Create `backend/admin/components/peta-tematik/types.ts`:

```typescript
export interface IndikatorItem {
  sourceId: number;
  sourceName: string;
  tableName: string;
}

export interface IndikatorList {
  totalEligible: number;
  kategori: Record<string, IndikatorItem[]>;
}

export interface YearsResponse {
  ok: boolean;
  years: number[];
  has_monthly: boolean;
}

export interface MetricsResponse {
  ok: boolean;
  metrics: string[];
}

export interface DataPoint {
  kdkab: string;
  nama_kab: string;
  value: number | null;
}

export interface DataResponse {
  ok: boolean;
  data: DataPoint[];
}

export interface SummaryResponse {
  ok: boolean;
  provinsi_total: number | null;
  top3: { nama_kab: string; value: number }[];
  bottom3: { nama_kab: string; value: number }[];
  trend: { year: number; provinsi_total: number | null }[];
}

export interface FilterState {
  indikator: number | null;
  year: number | null;
  month: number | null;
  metric: string | null;
}
```

- [ ] **Step 4: Create api.ts**

Create `backend/admin/components/peta-tematik/api.ts`:

```typescript
import { api } from '@/lib/axios';
import type {
  IndikatorList, YearsResponse, MetricsResponse, DataResponse, SummaryResponse,
} from './types';

export const QUERY_KEYS = {
  indikatorList: ['peta-tematik', 'indikator-list'] as const,
  years: (id: number) => ['peta-tematik', 'years', id] as const,
  metrics: (id: number) => ['peta-tematik', 'metrics', id] as const,
  data: (id: number, year: number, month: number | null, metric: string | null) =>
    ['peta-tematik', 'data', id, year, month, metric] as const,
  summary: (id: number, year: number, month: number | null, metric: string | null) =>
    ['peta-tematik', 'summary', id, year, month, metric] as const,
};

export async function fetchIndikatorList(): Promise<IndikatorList> {
  const { data } = await api.get('/peta-tematik/indikator-list');
  return { totalEligible: data.totalEligible, kategori: data.kategori };
}

export async function fetchYears(indikator: number): Promise<YearsResponse> {
  const { data } = await api.get('/peta-tematik/years', { params: { indikator } });
  return data;
}

export async function fetchMetrics(indikator: number): Promise<MetricsResponse> {
  const { data } = await api.get('/peta-tematik/metrics', { params: { indikator } });
  return data;
}

export async function fetchData(
  indikator: number, year: number, month: number | null, metric: string | null,
): Promise<DataResponse> {
  const { data } = await api.get('/peta-tematik/data', {
    params: { indikator, year, ...(month != null ? { month } : {}), ...(metric ? { metric } : {}) },
  });
  return data;
}

export async function fetchSummary(
  indikator: number, year: number, month: number | null, metric: string | null,
): Promise<SummaryResponse> {
  const { data } = await api.get('/peta-tematik/summary', {
    params: { indikator, year, ...(month != null ? { month } : {}), ...(metric ? { metric } : {}) },
  });
  return data;
}
```

- [ ] **Step 5: Create colorScale.ts**

Create `backend/admin/components/peta-tematik/colorScale.ts`:

```typescript
export const SCALE_COLORS = [
  '#DBEAFE',  // bin 0 — lowest (blue-100)
  '#93C5FD',  // bin 1 (blue-300)
  '#3B82F6',  // bin 2 (blue-500)
  '#1D4ED8',  // bin 3 (blue-700)
  '#1E3A8A',  // bin 4 — highest (blue-900)
];
export const NO_DATA_COLOR = '#D1D5DB';   // gray-300

/**
 * Quantile classification: divide values into 5 equal-population bins.
 * Returns the bin (0-4) for a given value, given the sorted values.
 */
export function quantileBins(values: number[]): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  // Compute breakpoints at 20/40/60/80 percentiles
  const breaks = [0.2, 0.4, 0.6, 0.8].map(p => sorted[Math.floor(p * n)]);
  return breaks;
}

export function colorForValue(
  value: number | null,
  breaks: number[],
): string {
  if (value == null) return NO_DATA_COLOR;
  for (let i = 0; i < breaks.length; i++) {
    if (value <= breaks[i]) return SCALE_COLORS[i];
  }
  return SCALE_COLORS[SCALE_COLORS.length - 1];
}

export function formatRangeLabel(min: number, max: number): string {
  return `${formatNumber(min)} – ${formatNumber(max)}`;
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);
}
```

- [ ] **Step 6: Lint check (admin uses eslint)**

```bash
cd backend/admin && npx eslint components/peta-tematik --ext .ts,.tsx
```

Expected: no errors. If there are warnings, fix inline.

- [ ] **Step 7: Commit**

```bash
git add backend/admin/components/peta-tematik/types.ts \
        backend/admin/components/peta-tematik/api.ts \
        backend/admin/components/peta-tematik/colorScale.ts \
        backend/admin/package.json \
        backend/admin/package-lock.json
git commit -m "feat(peta-tematik): admin types + api wrappers + color scale

Install react-leaflet@4.2.1, html2canvas@1.4.1, cmdk@1. Define TypeScript
interfaces for all 5 endpoint responses. axios wrappers + react-query
keys. Quantile binning util + 5-bin sequential blue palette."
```

---

## Task 13: PetaTematikSection skeleton + lazy mount

**Files:**
- Create: `backend/admin/components/peta-tematik/PetaTematikSection.tsx`

- [ ] **Step 1: Create skeleton with IntersectionObserver lazy-mount**

Create `backend/admin/components/peta-tematik/PetaTematikSection.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { fetchIndikatorList, QUERY_KEYS } from "./api";
import type { FilterState } from "./types";
import Skeleton from "@/components/Skeleton";

export default function PetaTematikSection() {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [activated, setActivated] = useState(false);

  // Lazy-mount: only fetch when scrolled into view
  useEffect(() => {
    const node = wrapperRef.current;
    if (!node || activated) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setActivated(true);
          obs.disconnect();
        }
      },
      { rootMargin: "100px" },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [activated]);

  return (
    <div ref={wrapperRef} className="space-y-3 pt-4 border-t border-gray-200">
      <h2 className="text-lg font-semibold text-gray-700 flex items-center gap-2">
        <MapPin className="h-5 w-5 text-blue-600" />
        Peta Tematik
      </h2>
      {!activated ? (
        <Skeleton className="h-[60vh]" />
      ) : (
        <PetaTematikInner />
      )}
    </div>
  );
}

function PetaTematikInner() {
  const [filters, setFilters] = useState<FilterState>({
    indikator: null, year: null, month: null, metric: null,
  });

  const { data: indikatorList, isLoading: listLoading } = useQuery({
    queryKey: QUERY_KEYS.indikatorList,
    queryFn: fetchIndikatorList,
    staleTime: 60 * 60 * 1000, // 1h, matches backend cache TTL
  });

  // Set default indikator when list arrives
  useEffect(() => {
    if (!filters.indikator && indikatorList?.kategori) {
      const kependudukan = indikatorList.kategori["Kependudukan"];
      if (kependudukan?.length > 0) {
        setFilters(f => ({ ...f, indikator: kependudukan[0].sourceId }));
      } else {
        // Fallback: first non-empty kategori
        const firstNonEmpty = Object.values(indikatorList.kategori)
          .find(arr => arr.length > 0);
        if (firstNonEmpty) {
          setFilters(f => ({ ...f, indikator: firstNonEmpty[0].sourceId }));
        }
      }
    }
  }, [indikatorList, filters.indikator]);

  if (listLoading) return <Skeleton className="h-[60vh]" />;
  if (!indikatorList || indikatorList.totalEligible === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-card p-6 text-center text-gray-500">
        Tidak ada indikator yang tersedia untuk peta tematik.
      </div>
    );
  }

  return (
    <div className="space-y-4" id="peta-tematik-export-area">
      <div className="text-sm text-gray-500">
        {indikatorList.totalEligible} indikator tersedia.
        Filter, peta, dan info panel akan ditambahkan di task berikutnya.
      </div>
      {/* TODO: <FilterBar />, <ChoroplethMap />, <InfoPanel /> — Tasks 14-16 */}
      <pre className="text-xs bg-gray-50 p-3 rounded">
        {JSON.stringify(filters, null, 2)}
      </pre>
    </div>
  );
}
```

- [ ] **Step 2: Smoke test — render in dashboard**

For testing without modifying dashboard yet, manually visit a page that includes
this component. Skip until Task 22 (inject into dashboard).

For now: typecheck only.

```bash
cd backend/admin && npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add backend/admin/components/peta-tematik/PetaTematikSection.tsx
git commit -m "feat(peta-tematik): section skeleton with lazy mount

IntersectionObserver triggers fetch when scrolled into view (rootMargin
100px). Inner component fetches indikator-list, sets default indikator
to first 'Kependudukan' (fallback: first non-empty kategori)."
```

---

## Task 14: IndikatorPicker (cmdk grouped searchable)

**Files:**
- Create: `backend/admin/components/peta-tematik/IndikatorPicker.tsx`
- Modify: `backend/admin/components/peta-tematik/PetaTematikSection.tsx`

- [ ] **Step 1: Backup section**

```bash
cp backend/admin/components/peta-tematik/PetaTematikSection.tsx \
   backend/admin/components/peta-tematik/PetaTematikSection.tsx.backup
```

- [ ] **Step 2: Create IndikatorPicker**

Create `backend/admin/components/peta-tematik/IndikatorPicker.tsx`:

```tsx
"use client";

import { useState, useMemo } from "react";
import { Command } from "cmdk";
import { ChevronDown, Search } from "lucide-react";
import type { IndikatorList } from "./types";

interface Props {
  list: IndikatorList;
  value: number | null;
  onChange: (id: number) => void;
}

export default function IndikatorPicker({ list, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedName = useMemo(() => {
    for (const items of Object.values(list.kategori)) {
      const found = items.find(it => it.sourceId === value);
      if (found) return found.sourceName;
    }
    return "Pilih indikator…";
  }, [list, value]);

  const KATEGORI_ORDER = [
    "Kependudukan", "Ketenagakerjaan", "Pendidikan", "Kesehatan",
    "Ekonomi", "Pariwisata & Akomodasi", "Pembangunan & Sosial", "Lainnya",
  ];

  return (
    <div className="relative w-full sm:w-[480px]">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg
                   border border-border bg-background text-left text-sm
                   hover:bg-muted transition-colors"
      >
        <span className="truncate">{selectedName}</span>
        <ChevronDown className="h-4 w-4 flex-shrink-0 text-gray-400" />
      </button>

      {open && (
        <>
          {/* backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <Command className="absolute z-20 mt-2 w-full bg-background border border-border
                              rounded-lg shadow-lg overflow-hidden">
            <div className="flex items-center gap-2 px-3 border-b border-border">
              <Search className="h-4 w-4 text-gray-400" />
              <Command.Input
                placeholder="Cari indikator…"
                value={query}
                onValueChange={setQuery}
                className="w-full py-2 text-sm bg-transparent outline-none"
              />
            </div>
            <Command.List className="max-h-[400px] overflow-y-auto py-2">
              <Command.Empty className="py-4 text-center text-sm text-gray-500">
                Tidak ada hasil.
              </Command.Empty>
              {KATEGORI_ORDER.filter(k => list.kategori[k]?.length > 0).map(kategori => (
                <Command.Group
                  key={kategori}
                  heading={`${kategori} (${list.kategori[kategori].length})`}
                  className="text-xs text-gray-500 [&_[cmdk-group-heading]]:px-3
                             [&_[cmdk-group-heading]]:py-1
                             [&_[cmdk-group-heading]]:font-semibold
                             [&_[cmdk-group-heading]]:uppercase"
                >
                  {list.kategori[kategori].map(item => (
                    <Command.Item
                      key={item.sourceId}
                      value={item.sourceName}
                      onSelect={() => {
                        onChange(item.sourceId);
                        setOpen(false);
                        setQuery("");
                      }}
                      className="px-3 py-2 text-sm cursor-pointer
                                 aria-selected:bg-blue-50 aria-selected:text-blue-700"
                    >
                      {item.sourceName}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire IndikatorPicker into PetaTematikSection**

In `PetaTematikSection.tsx` `PetaTematikInner`, replace the `<pre>{JSON.stringify(filters)}</pre>` block with:

```tsx
import IndikatorPicker from "./IndikatorPicker";
// ...
return (
  <div className="space-y-4" id="peta-tematik-export-area">
    <IndikatorPicker
      list={indikatorList}
      value={filters.indikator}
      onChange={(id) => setFilters(f => ({ ...f, indikator: id, year: null, month: null, metric: null }))}
    />
    <pre className="text-xs bg-gray-50 p-3 rounded">
      {JSON.stringify(filters, null, 2)}
    </pre>
  </div>
);
```

- [ ] **Step 4: Typecheck + smoke**

```bash
cd backend/admin && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/admin/components/peta-tematik/IndikatorPicker.tsx \
        backend/admin/components/peta-tematik/PetaTematikSection.tsx
git commit -m "feat(peta-tematik): IndikatorPicker with cmdk grouped search

Searchable dropdown over 7 kategori + Lainnya. Empty kategori hidden.
Backdrop click closes. Reset year/month/metric on indikator change."
```

---

## Task 15: FilterBar (Year/Month/Metric selects, adaptive)

**Files:**
- Create: `backend/admin/components/peta-tematik/FilterBar.tsx`
- Modify: `backend/admin/components/peta-tematik/PetaTematikSection.tsx`

- [ ] **Step 1: Backup**

```bash
cp backend/admin/components/peta-tematik/PetaTematikSection.tsx \
   backend/admin/components/peta-tematik/PetaTematikSection.tsx.backup
```

- [ ] **Step 2: Create FilterBar**

Create `backend/admin/components/peta-tematik/FilterBar.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import IndikatorPicker from "./IndikatorPicker";
import { fetchYears, fetchMetrics, QUERY_KEYS } from "./api";
import type { IndikatorList, FilterState } from "./types";

interface Props {
  list: IndikatorList;
  filters: FilterState;
  setFilters: (updater: (prev: FilterState) => FilterState) => void;
}

const MONTH_NAMES = [
  "", "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

export default function FilterBar({ list, filters, setFilters }: Props) {
  const yearsQuery = useQuery({
    queryKey: QUERY_KEYS.years(filters.indikator!),
    queryFn: () => fetchYears(filters.indikator!),
    enabled: !!filters.indikator,
    staleTime: 60 * 60 * 1000,
  });

  const metricsQuery = useQuery({
    queryKey: QUERY_KEYS.metrics(filters.indikator!),
    queryFn: () => fetchMetrics(filters.indikator!),
    enabled: !!filters.indikator,
    staleTime: 60 * 60 * 1000,
  });

  // Set default year + month + metric once data arrives
  useEffect(() => {
    if (!yearsQuery.data || filters.year != null) return;
    const years = yearsQuery.data.years;
    if (years.length === 0) return;
    const latestYear = years[years.length - 1];
    setFilters(f => ({
      ...f,
      year: latestYear,
      month: yearsQuery.data!.has_monthly ? 12 : null,
    }));
  }, [yearsQuery.data, filters.year, setFilters]);

  useEffect(() => {
    if (!metricsQuery.data || filters.metric != null) return;
    const metrics = metricsQuery.data.metrics;
    if (metrics.length === 0) return;
    const preferred = metrics.includes("value") ? "value" : metrics[0];
    setFilters(f => ({ ...f, metric: preferred }));
  }, [metricsQuery.data, filters.metric, setFilters]);

  const hasMonthly = yearsQuery.data?.has_monthly === true;
  const showMetricSelect = (metricsQuery.data?.metrics.length ?? 0) > 1;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <IndikatorPicker
        list={list}
        value={filters.indikator}
        onChange={(id) => setFilters(f => ({
          ...f, indikator: id, year: null, month: null, metric: null,
        }))}
      />

      {filters.indikator && yearsQuery.data && (
        <select
          value={filters.year ?? ""}
          onChange={(e) => setFilters(f => ({ ...f, year: Number(e.target.value) }))}
          className="px-3 py-2 rounded-lg border border-border bg-background text-sm"
        >
          <option value="" disabled>Tahun…</option>
          {yearsQuery.data.years.map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      )}

      {hasMonthly && filters.year && (
        <select
          value={filters.month ?? ""}
          onChange={(e) => setFilters(f => ({ ...f, month: Number(e.target.value) }))}
          className="px-3 py-2 rounded-lg border border-border bg-background text-sm"
        >
          <option value="" disabled>Bulan…</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
            <option key={m} value={m}>{MONTH_NAMES[m]}</option>
          ))}
        </select>
      )}

      {showMetricSelect && (
        <select
          value={filters.metric ?? ""}
          onChange={(e) => setFilters(f => ({ ...f, metric: e.target.value }))}
          className="px-3 py-2 rounded-lg border border-border bg-background text-sm"
        >
          {metricsQuery.data!.metrics.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire FilterBar into PetaTematikSection**

Replace the IndikatorPicker block in `PetaTematikInner` with:

```tsx
import FilterBar from "./FilterBar";
// ...
<FilterBar list={indikatorList} filters={filters} setFilters={setFilters} />
```

- [ ] **Step 4: Typecheck**

```bash
cd backend/admin && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/admin/components/peta-tematik/FilterBar.tsx \
        backend/admin/components/peta-tematik/PetaTematikSection.tsx
git commit -m "feat(peta-tematik): FilterBar with adaptive Year/Month/Metric

Year select always shown when indikator picked. Month select only when
has_monthly=true. Metric select only when >1 metric. Defaults: latest
year, month=12, metric prefers 'value'."
```

---

## Task 16: ChoroplethMap basic + GeoJSON load

**Files:**
- Create: `backend/admin/components/peta-tematik/ChoroplethMap.tsx`
- Modify: `backend/admin/components/peta-tematik/PetaTematikSection.tsx`

- [ ] **Step 1: Backup**

```bash
cp backend/admin/components/peta-tematik/PetaTematikSection.tsx \
   backend/admin/components/peta-tematik/PetaTematikSection.tsx.backup
```

- [ ] **Step 2: Create ChoroplethMap (basic, no styling yet)**

Create `backend/admin/components/peta-tematik/ChoroplethMap.tsx`:

```tsx
"use client";

import { useEffect, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import "leaflet/dist/leaflet.css";
import { fetchData, QUERY_KEYS } from "./api";
import type { DataPoint, FilterState } from "./types";

// Dynamic-import react-leaflet (no SSR)
const MapContainer = dynamic(
  () => import("react-leaflet").then(m => m.MapContainer), { ssr: false });
const TileLayer = dynamic(
  () => import("react-leaflet").then(m => m.TileLayer), { ssr: false });
const GeoJSON = dynamic(
  () => import("react-leaflet").then(m => m.GeoJSON), { ssr: false });

interface Props {
  filters: FilterState;
}

const MALUT_CENTER: [number, number] = [-0.78, 127.85];
const MALUT_ZOOM = 7;

export default function ChoroplethMap({ filters }: Props) {
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [geoError, setGeoError] = useState(false);

  // Load GeoJSON once
  useEffect(() => {
    fetch("/geojson/peta_kabko_malut.geojson")
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setGeojson)
      .catch(e => {
        console.error("GeoJSON load failed:", e);
        setGeoError(true);
      });
  }, []);

  const dataQuery = useQuery({
    queryKey: QUERY_KEYS.data(filters.indikator!, filters.year!, filters.month, filters.metric),
    queryFn: () => fetchData(filters.indikator!, filters.year!, filters.month, filters.metric),
    enabled: !!filters.indikator && !!filters.year,
    staleTime: 60 * 60 * 1000,
  });

  if (geoError) {
    return <FallbackTable data={dataQuery.data?.data ?? []} />;
  }
  if (!geojson) {
    return <div className="h-[60vh] bg-gray-100 animate-pulse rounded-xl" />;
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <MapContainer
        center={MALUT_CENTER}
        zoom={MALUT_ZOOM}
        style={{ height: "60vh", width: "100%" }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <GeoJSON data={geojson} />
      </MapContainer>
    </div>
  );
}

function FallbackTable({ data }: { data: DataPoint[] }) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
              Kabupaten/Kota
            </th>
            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
              Nilai
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {data.map(d => (
            <tr key={d.kdkab}>
              <td className="px-4 py-2 text-sm">{d.nama_kab}</td>
              <td className="px-4 py-2 text-sm text-right">
                {d.value == null
                  ? "-"
                  : new Intl.NumberFormat("id-ID").format(d.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Wire into PetaTematikSection**

Append after FilterBar in `PetaTematikInner`:

```tsx
import ChoroplethMap from "./ChoroplethMap";
// ...
{filters.indikator && filters.year && (
  <ChoroplethMap filters={filters} />
)}
```

- [ ] **Step 4: Typecheck + start admin dev server to verify**

```bash
cd backend/admin && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/admin/components/peta-tematik/ChoroplethMap.tsx \
        backend/admin/components/peta-tematik/PetaTematikSection.tsx
git commit -m "feat(peta-tematik): ChoroplethMap renders 10 polygons (no color yet)

Loads GeoJSON from /geojson/peta_kabko_malut.geojson. Dynamic import
react-leaflet (no SSR). Fallback to list table if GeoJSON load fails."
```

---

## Task 17: ChoroplethMap styling + tooltip + legend

**Files:**
- Modify: `backend/admin/components/peta-tematik/ChoroplethMap.tsx`
- Create: `backend/admin/components/peta-tematik/MapLegend.tsx`

- [ ] **Step 1: Backup**

```bash
cp backend/admin/components/peta-tematik/ChoroplethMap.tsx \
   backend/admin/components/peta-tematik/ChoroplethMap.tsx.backup
```

- [ ] **Step 2: Create MapLegend**

Create `backend/admin/components/peta-tematik/MapLegend.tsx`:

```tsx
"use client";

import { SCALE_COLORS, NO_DATA_COLOR } from "./colorScale";

interface Props {
  breaks: number[];     // 4 breakpoints, sorted ASC
  hasNoData?: boolean;
}

export default function MapLegend({ breaks, hasNoData }: Props) {
  if (breaks.length === 0) return null;
  const fmt = (n: number) =>
    new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(n);

  // Build labels: < b0 | b0–b1 | b1–b2 | b2–b3 | > b3
  const labels = [
    `< ${fmt(breaks[0])}`,
    `${fmt(breaks[0])} – ${fmt(breaks[1])}`,
    `${fmt(breaks[1])} – ${fmt(breaks[2])}`,
    `${fmt(breaks[2])} – ${fmt(breaks[3])}`,
    `> ${fmt(breaks[3])}`,
  ];

  return (
    <div className="absolute bottom-4 left-4 z-[1000] bg-white/95 rounded-lg
                    shadow-lg border border-gray-200 p-3 text-xs">
      <div className="font-semibold text-gray-700 mb-2">Skala</div>
      <div className="flex flex-col gap-1">
        {SCALE_COLORS.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-5 h-3 rounded" style={{ backgroundColor: c }} />
            <span className="text-gray-600">{labels[i]}</span>
          </div>
        ))}
        {hasNoData && (
          <div className="flex items-center gap-2 mt-1 pt-1 border-t border-gray-200">
            <span className="w-5 h-3 rounded opacity-50" style={{ backgroundColor: NO_DATA_COLOR }} />
            <span className="text-gray-500">Data tidak tersedia</span>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update ChoroplethMap with styling + tooltip + legend**

Replace `ChoroplethMap.tsx` content (full rewrite) with:

```tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import "leaflet/dist/leaflet.css";
import type { Layer, PathOptions } from "leaflet";
import type { Feature } from "geojson";
import { fetchData, QUERY_KEYS } from "./api";
import { quantileBins, colorForValue, NO_DATA_COLOR } from "./colorScale";
import MapLegend from "./MapLegend";
import type { DataPoint, FilterState } from "./types";

const MapContainer = dynamic(
  () => import("react-leaflet").then(m => m.MapContainer), { ssr: false });
const TileLayer = dynamic(
  () => import("react-leaflet").then(m => m.TileLayer), { ssr: false });
const GeoJSON = dynamic(
  () => import("react-leaflet").then(m => m.GeoJSON), { ssr: false });

interface Props {
  filters: FilterState;
}

const MALUT_CENTER: [number, number] = [-0.78, 127.85];
const MALUT_ZOOM = 7;

const fmtNumber = (n: number) =>
  new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(n);

export default function ChoroplethMap({ filters }: Props) {
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [geoError, setGeoError] = useState(false);

  useEffect(() => {
    fetch("/geojson/peta_kabko_malut.geojson")
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setGeojson)
      .catch(e => { console.error("GeoJSON load failed:", e); setGeoError(true); });
  }, []);

  const dataQuery = useQuery({
    queryKey: QUERY_KEYS.data(filters.indikator!, filters.year!, filters.month, filters.metric),
    queryFn: () => fetchData(filters.indikator!, filters.year!, filters.month, filters.metric),
    enabled: !!filters.indikator && !!filters.year,
    staleTime: 60 * 60 * 1000,
  });

  // Previous-year data for delta tooltip
  const prevYearQuery = useQuery({
    queryKey: QUERY_KEYS.data(filters.indikator!, filters.year! - 1, filters.month, filters.metric),
    queryFn: () => fetchData(filters.indikator!, filters.year! - 1, filters.month, filters.metric),
    enabled: !!filters.indikator && !!filters.year && filters.year > 0,
    staleTime: 60 * 60 * 1000,
  });

  const valueByKdkab = useMemo(() => {
    const m: Record<string, number | null> = {};
    for (const d of dataQuery.data?.data ?? []) m[d.kdkab] = d.value;
    return m;
  }, [dataQuery.data]);

  const prevValueByKdkab = useMemo(() => {
    const m: Record<string, number | null> = {};
    for (const d of prevYearQuery.data?.data ?? []) m[d.kdkab] = d.value;
    return m;
  }, [prevYearQuery.data]);

  const breaks = useMemo(() => {
    const values = (dataQuery.data?.data ?? [])
      .filter(d => d.value != null)
      .map(d => d.value as number);
    return quantileBins(values);
  }, [dataQuery.data]);

  const styleFn = (feature?: Feature): PathOptions => {
    const kdkab = feature?.properties?.kdkab as string;
    const v = valueByKdkab[kdkab];
    return {
      fillColor: v == null ? NO_DATA_COLOR : colorForValue(v, breaks),
      fillOpacity: v == null ? 0.4 : 0.7,
      weight: 1,
      color: "white",
    };
  };

  const onEachFeature = (feature: Feature, layer: Layer) => {
    const kdkab = feature.properties?.kdkab as string;
    const namaKab = (feature.properties?.nama_kab as string)
      ?.replace(/^(Kabupaten|Kota)\s+/i, "")
      ?? kdkab;
    const v = valueByKdkab[kdkab];
    const prev = prevValueByKdkab[kdkab];

    const valueLine = v == null
      ? '<span class="text-gray-500">Data tidak tersedia</span>'
      : `<strong>${fmtNumber(v)}</strong>`;

    let deltaLine = "";
    if (v != null && prev != null && prev !== 0) {
      const delta = v - prev;
      const pct = (delta / prev) * 100;
      const arrow = delta >= 0 ? "▲" : "▼";
      const cls = delta >= 0 ? "text-green-600" : "text-red-600";
      deltaLine = `<div class="${cls} mt-1">${arrow} ${fmtNumber(delta)} (${pct.toFixed(1)}%)</div>`;
    }

    layer.bindTooltip(
      `<div class="text-sm">
         <div class="font-semibold mb-1">${namaKab}</div>
         <div>${valueLine}</div>
         ${deltaLine}
       </div>`,
      { sticky: true, direction: "top" }
    );

    layer.on({
      mouseover: (e) => {
        const l = e.target;
        l.setStyle({ weight: 2.5, color: "#1e40af", fillOpacity: 0.9 });
        l.bringToFront();
      },
      mouseout: (e) => {
        e.target.setStyle(styleFn(feature));
      },
    });
  };

  if (geoError) {
    return <FallbackTable data={dataQuery.data?.data ?? []} />;
  }
  if (!geojson) {
    return <div className="h-[60vh] bg-gray-100 animate-pulse rounded-xl" />;
  }

  const hasNoData = (dataQuery.data?.data ?? []).some(d => d.value == null);

  return (
    <div className="relative rounded-xl border border-border overflow-hidden">
      <MapContainer
        center={MALUT_CENTER}
        zoom={MALUT_ZOOM}
        style={{ height: "60vh", width: "100%" }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <GeoJSON
          key={`${filters.indikator}-${filters.year}-${filters.month ?? 0}-${filters.metric ?? "*"}`}
          data={geojson}
          style={styleFn as () => PathOptions}
          onEachFeature={onEachFeature}
        />
      </MapContainer>
      <MapLegend breaks={breaks} hasNoData={hasNoData} />
    </div>
  );
}

function FallbackTable({ data }: { data: DataPoint[] }) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
              Kabupaten/Kota
            </th>
            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
              Nilai
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {data.map(d => (
            <tr key={d.kdkab}>
              <td className="px-4 py-2 text-sm">{d.nama_kab}</td>
              <td className="px-4 py-2 text-sm text-right">
                {d.value == null ? "-" : fmtNumber(d.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

```bash
cd backend/admin && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/admin/components/peta-tematik/ChoroplethMap.tsx \
        backend/admin/components/peta-tematik/MapLegend.tsx
git commit -m "feat(peta-tematik): choropleth styling, tooltip, legend

Quantile 5-bin classification with sequential blue palette. Hover
tooltip shows nama_kab + value + delta vs prev year (▲ green / ▼ red).
Legend with bin ranges + 'Data tidak tersedia' indicator."
```

---

## Task 18: InfoPanel — ProvinsiTotalCard + TopBottomList + TrendSparkline

**Files:**
- Create: `backend/admin/components/peta-tematik/ProvinsiTotalCard.tsx`
- Create: `backend/admin/components/peta-tematik/TopBottomList.tsx`
- Create: `backend/admin/components/peta-tematik/TrendSparkline.tsx`
- Create: `backend/admin/components/peta-tematik/InfoPanel.tsx`
- Modify: `backend/admin/components/peta-tematik/PetaTematikSection.tsx`

- [ ] **Step 1: Backup section**

```bash
cp backend/admin/components/peta-tematik/PetaTematikSection.tsx \
   backend/admin/components/peta-tematik/PetaTematikSection.tsx.backup
```

- [ ] **Step 2: Create ProvinsiTotalCard**

Create `backend/admin/components/peta-tematik/ProvinsiTotalCard.tsx`:

```tsx
"use client";

interface Props {
  total: number | null;
  year: number;
  prevTotal?: number | null;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(n);

export default function ProvinsiTotalCard({ total, year, prevTotal }: Props) {
  if (total == null) {
    return (
      <div className="rounded-lg border border-border p-3 bg-card">
        <div className="text-xs uppercase text-gray-500 font-semibold">
          Provinsi Maluku Utara
        </div>
        <div className="text-2xl font-bold text-gray-400 mt-1">—</div>
        <div className="text-xs text-gray-400 mt-1">Data tidak tersedia</div>
      </div>
    );
  }

  let deltaEl = null;
  if (prevTotal != null && prevTotal !== 0) {
    const delta = total - prevTotal;
    const pct = (delta / prevTotal) * 100;
    const arrow = delta >= 0 ? "▲" : "▼";
    const cls = delta >= 0 ? "text-green-600" : "text-red-600";
    deltaEl = (
      <div className={`text-xs ${cls} mt-1`}>
        {arrow} {fmt(delta)} ({pct.toFixed(1)}%) dari {year - 1}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-3 bg-card">
      <div className="text-xs uppercase text-gray-500 font-semibold">
        📊 Provinsi Maluku Utara
      </div>
      <div className="text-2xl font-bold text-gray-900 mt-1">{fmt(total)}</div>
      <div className="text-xs text-gray-500">({year})</div>
      {deltaEl}
    </div>
  );
}
```

- [ ] **Step 3: Create TopBottomList**

Create `backend/admin/components/peta-tematik/TopBottomList.tsx`:

```tsx
"use client";

interface Item { nama_kab: string; value: number; }
interface Props {
  top3: Item[];
  bottom3: Item[];
}

const fmt = (n: number) =>
  new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(n);

export default function TopBottomList({ top3, bottom3 }: Props) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border p-3 bg-card">
        <div className="text-xs uppercase text-green-700 font-semibold mb-2">
          ▲ Tertinggi
        </div>
        {top3.length === 0 ? (
          <div className="text-sm text-gray-400">—</div>
        ) : (
          <ol className="space-y-1">
            {top3.map((it, i) => (
              <li key={it.nama_kab} className="flex justify-between text-sm">
                <span className="text-gray-700">{i + 1}. {it.nama_kab}</span>
                <span className="font-medium tabular-nums">{fmt(it.value)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="rounded-lg border border-border p-3 bg-card">
        <div className="text-xs uppercase text-red-700 font-semibold mb-2">
          ▼ Terendah
        </div>
        {bottom3.length === 0 ? (
          <div className="text-sm text-gray-400">—</div>
        ) : (
          <ol className="space-y-1">
            {bottom3.map((it, i) => (
              <li key={it.nama_kab} className="flex justify-between text-sm">
                <span className="text-gray-700">{i + 1}. {it.nama_kab}</span>
                <span className="font-medium tabular-nums">{fmt(it.value)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create TrendSparkline (inline SVG)**

Create `backend/admin/components/peta-tematik/TrendSparkline.tsx`:

```tsx
"use client";

interface Point { year: number; provinsi_total: number | null; }
interface Props {
  points: Point[];
}

export default function TrendSparkline({ points }: Props) {
  const valid = points.filter(p => p.provinsi_total != null) as
    Array<{ year: number; provinsi_total: number }>;
  if (valid.length < 2) {
    return (
      <div className="rounded-lg border border-border p-3 bg-card">
        <div className="text-xs uppercase text-gray-500 font-semibold mb-2">
          📈 Trend Provinsi
        </div>
        <div className="text-sm text-gray-400">Data trend tidak cukup.</div>
      </div>
    );
  }

  const W = 240, H = 50, P = 4;
  const xs = valid.map(p => p.year);
  const ys = valid.map(p => p.provinsi_total);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xScale = (x: number) =>
    P + ((x - xMin) / (xMax - xMin || 1)) * (W - 2 * P);
  const yScale = (y: number) =>
    H - P - ((y - yMin) / (yMax - yMin || 1)) * (H - 2 * P);

  const path = valid.map((p, i) =>
    `${i === 0 ? "M" : "L"}${xScale(p.year).toFixed(1)},${yScale(p.provinsi_total).toFixed(1)}`
  ).join(" ");

  return (
    <div className="rounded-lg border border-border p-3 bg-card">
      <div className="text-xs uppercase text-gray-500 font-semibold mb-2">
        📈 Trend Provinsi {xMin}–{xMax}
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <path d={path} stroke="#3B82F6" strokeWidth="2" fill="none" />
        {valid.map(p => (
          <circle
            key={p.year}
            cx={xScale(p.year)}
            cy={yScale(p.provinsi_total)}
            r="2"
            fill="#3B82F6"
          />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-gray-500 mt-1 px-1">
        <span>{xMin}</span><span>{xMax}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create InfoPanel wrapper**

Create `backend/admin/components/peta-tematik/InfoPanel.tsx`:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import ProvinsiTotalCard from "./ProvinsiTotalCard";
import TopBottomList from "./TopBottomList";
import TrendSparkline from "./TrendSparkline";
import { fetchSummary, QUERY_KEYS } from "./api";
import type { FilterState } from "./types";

interface Props {
  filters: FilterState;
}

export default function InfoPanel({ filters }: Props) {
  const summaryQuery = useQuery({
    queryKey: QUERY_KEYS.summary(filters.indikator!, filters.year!, filters.month, filters.metric),
    queryFn: () => fetchSummary(filters.indikator!, filters.year!, filters.month, filters.metric),
    enabled: !!filters.indikator && !!filters.year,
    staleTime: 60 * 60 * 1000,
  });

  if (summaryQuery.isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-20 bg-gray-100 animate-pulse rounded-lg" />
        <div className="h-32 bg-gray-100 animate-pulse rounded-lg" />
        <div className="h-24 bg-gray-100 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (summaryQuery.isError || !summaryQuery.data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
        Panel info gagal dimuat.
      </div>
    );
  }

  const s = summaryQuery.data;
  const prevTotal = s.trend.length >= 2
    ? s.trend[s.trend.length - 2].provinsi_total : null;

  return (
    <div className="space-y-3">
      <ProvinsiTotalCard
        total={s.provinsi_total}
        year={filters.year!}
        prevTotal={prevTotal}
      />
      <TopBottomList top3={s.top3} bottom3={s.bottom3} />
      <TrendSparkline points={s.trend} />
    </div>
  );
}
```

- [ ] **Step 6: Update PetaTematikSection layout (grid 2/3 + 1/3)**

In `PetaTematikInner`, wrap map + panel in grid:

```tsx
import InfoPanel from "./InfoPanel";
// ...
return (
  <div className="space-y-4" id="peta-tematik-export-area">
    <FilterBar list={indikatorList} filters={filters} setFilters={setFilters} />
    {filters.indikator && filters.year ? (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <ChoroplethMap filters={filters} />
        </div>
        <div className="lg:col-span-1">
          <InfoPanel filters={filters} />
        </div>
      </div>
    ) : (
      <div className="rounded-xl border border-border bg-card p-6 text-center text-gray-500">
        Pilih indikator dan tahun untuk menampilkan peta.
      </div>
    )}
  </div>
);
```

- [ ] **Step 7: Typecheck**

```bash
cd backend/admin && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add backend/admin/components/peta-tematik/ProvinsiTotalCard.tsx \
        backend/admin/components/peta-tematik/TopBottomList.tsx \
        backend/admin/components/peta-tematik/TrendSparkline.tsx \
        backend/admin/components/peta-tematik/InfoPanel.tsx \
        backend/admin/components/peta-tematik/PetaTematikSection.tsx
git commit -m "feat(peta-tematik): InfoPanel with provinsi total + top/bottom + trend

ProvinsiTotalCard shows total + delta vs prev year. TopBottomList renders
top 3 + bottom 3 kab/kota. TrendSparkline draws inline SVG line chart
for last 5 years provinsi totals. Grid layout 2/3 map + 1/3 panel."
```

---

## Task 19: ExportButton (html2canvas → PNG)

**Files:**
- Create: `backend/admin/components/peta-tematik/ExportButton.tsx`
- Modify: `backend/admin/components/peta-tematik/PetaTematikSection.tsx`

- [ ] **Step 1: Backup**

```bash
cp backend/admin/components/peta-tematik/PetaTematikSection.tsx \
   backend/admin/components/peta-tematik/PetaTematikSection.tsx.backup
```

- [ ] **Step 2: Create ExportButton**

Create `backend/admin/components/peta-tematik/ExportButton.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Download } from "lucide-react";

interface Props {
  fileNameSeed: string;   // e.g. "indikator-182-2024"
  targetId?: string;       // default "peta-tematik-export-area"
}

export default function ExportButton({ fileNameSeed, targetId = "peta-tematik-export-area" }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    if (loading) return;
    setLoading(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const node = document.getElementById(targetId);
      if (!node) throw new Error("Export area not found");
      const canvas = await html2canvas(node, {
        backgroundColor: "#fff",
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob(b => b ? resolve(b) : reject(new Error("toBlob failed"))));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `peta-tematik-${fileNameSeed}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export PNG failed:", e);
      alert("Gagal export PNG. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={loading}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border
                 hover:bg-muted text-sm transition-colors disabled:opacity-50"
    >
      <Download className="h-4 w-4" />
      <span>{loading ? "Exporting…" : "Export PNG"}</span>
    </button>
  );
}
```

- [ ] **Step 3: Wire ExportButton in section header**

In `PetaTematikSection.tsx`, change the header to include ExportButton:

```tsx
import ExportButton from "./ExportButton";
// ...
return (
  <div ref={wrapperRef} className="space-y-3 pt-4 border-t border-gray-200">
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-semibold text-gray-700 flex items-center gap-2">
        <MapPin className="h-5 w-5 text-blue-600" />
        Peta Tematik
      </h2>
      {activated && (
        <ExportButton fileNameSeed="dashboard" />
      )}
    </div>
    {!activated ? (
      <Skeleton className="h-[60vh]" />
    ) : (
      <PetaTematikInner />
    )}
  </div>
);
```

For more contextual filename, we could thread `filters` up — defer to follow-up.

- [ ] **Step 4: Typecheck**

```bash
cd backend/admin && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/admin/components/peta-tematik/ExportButton.tsx \
        backend/admin/components/peta-tematik/PetaTematikSection.tsx
git commit -m "feat(peta-tematik): ExportButton with html2canvas PNG capture

Dynamic-imports html2canvas (lazy chunk). Captures #peta-tematik-export-area,
download as PNG. Shows 'Exporting…' state, alerts on failure."
```

---

## Task 20: Inject `<PetaTematikSection />` into /dashboard page

**Files:**
- Modify: `backend/admin/app/dashboard/page.tsx`

- [ ] **Step 1: Backup**

```bash
cp backend/admin/app/dashboard/page.tsx \
   backend/admin/app/dashboard/page.tsx.backup
```

- [ ] **Step 2: Add import + render at bottom**

In `backend/admin/app/dashboard/page.tsx`:

1. Add import at top (after existing imports):

```tsx
import PetaTematikSection from "@/components/peta-tematik/PetaTematikSection";
```

2. Find the closing `</>` after the "🔄 Sync Status" section (search for `Sync Status`). Just before that closing `</>`, add:

```tsx
{/* ==================== PETA TEMATIK ==================== */}
<PetaTematikSection />
```

- [ ] **Step 3: Typecheck**

```bash
cd backend/admin && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Manual smoke test (start dev server, visit /dashboard)**

```bash
cd backend/admin && npm run dev
# Open http://localhost:5050/dashboard in browser, scroll to bottom.
# Expected:
#   1. Page loads, top sections (Live Analytics, Data Mgmt, Sync Status) appear
#   2. Scroll near bottom — "Peta Tematik" section starts loading (skeleton)
#   3. Indikator dropdown opens, lists 7 kategori
#   4. Pick "Kependudukan" > first item → year dropdown appears
#   5. Pick latest year → map renders with 10 colored polygons
#   6. Hover a polygon → tooltip with nama + value + delta
#   7. Right panel shows provinsi total + top3/bottom3 + sparkline
#   8. Export PNG button downloads .png file
```

If any step fails, check browser console for errors. Common issues:
- 401 → check auth middleware on /peta-tematik routes
- CSP violation on tile server → add `https://*.tile.openstreetmap.org` to next.config CSP if strict
- GeoJSON 404 → confirm `peta_kabko_malut.geojson` is served from `/geojson/` (Next.js public dir or backend static)

- [ ] **Step 5: Commit**

```bash
git add backend/admin/app/dashboard/page.tsx
git commit -m "feat(peta-tematik): inject section into /dashboard page

Renders <PetaTematikSection /> at bottom (after Sync Status). Lazy-mounts
via IntersectionObserver — top of dashboard stays interactive."
```

---

## Task 21: Playwright E2E happy-path test

**Files:**
- Create: `frontend/e2e/peta-tematik.spec.ts` (NB: `frontend/e2e` is the project's Playwright dir per MEMORY.md; verify pattern)

- [ ] **Step 1: Verify Playwright location**

```bash
ls frontend/e2e/ 2>/dev/null | head -5
# If empty / doesn't exist, check:
find . -name "playwright.config*" -maxdepth 3 2>/dev/null
```

If Playwright is elsewhere (e.g. `backend/admin/e2e`), adjust file path accordingly.

- [ ] **Step 2: Create E2E test**

Create `frontend/e2e/peta-tematik.spec.ts` (or location verified above):

```typescript
import { test, expect } from "@playwright/test";

const ADMIN_URL = process.env.ADMIN_URL || "http://localhost:5050";

test.describe("Peta Tematik dashboard section", () => {
  test.beforeEach(async ({ page }) => {
    // Existing project should have an auth helper or fixture; adapt
    await page.goto(`${ADMIN_URL}/dashboard`);
  });

  test("loads section, picks indikator, renders map", async ({ page }) => {
    // Scroll to peta tematik section to trigger lazy-mount
    await page.locator("text=Peta Tematik").scrollIntoViewIfNeeded();

    // Wait for indikator picker
    const picker = page.locator('button:has-text("Pilih indikator")').first();
    await expect(picker).toBeVisible({ timeout: 10000 });

    // Open picker, search, pick a Kependudukan indikator
    await picker.click();
    await page.locator('input[placeholder="Cari indikator…"]').fill("Penduduk");
    const firstResult = page.locator('[cmdk-item]').first();
    await firstResult.click();

    // Year select should appear
    const yearSelect = page.locator('select').first();
    await expect(yearSelect).toBeVisible({ timeout: 5000 });

    // Wait for map to render (Leaflet container)
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10000 });

    // Wait for at least one GeoJSON path to render
    await expect(page.locator('.leaflet-interactive').first()).toBeVisible({ timeout: 10000 });

    // InfoPanel — Provinsi total card
    await expect(page.locator('text=Provinsi Maluku Utara')).toBeVisible();
  });

  test("changing year refetches data", async ({ page }) => {
    await page.locator("text=Peta Tematik").scrollIntoViewIfNeeded();
    const picker = page.locator('button:has-text("Pilih indikator")').first();
    await picker.click();
    await page.locator('[cmdk-item]').first().click();

    const yearSelect = page.locator('select').first();
    await expect(yearSelect).toBeVisible({ timeout: 5000 });

    // Pick a different year (not the latest)
    const yearOptions = await yearSelect.locator('option').all();
    if (yearOptions.length < 2) test.skip();
    await yearSelect.selectOption({ index: yearOptions.length - 2 });

    // Map should still be present (re-rendered)
    await expect(page.locator('.leaflet-container')).toBeVisible();
  });
});
```

- [ ] **Step 3: Run E2E (assumes admin dev/prod server is running)**

```bash
cd frontend && npx playwright test e2e/peta-tematik.spec.ts --reporter=list
```

Expected: 2 tests pass.

If fails: investigate via `--headed` flag or check screenshots in `test-results/`.

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/peta-tematik.spec.ts
git commit -m "test(peta-tematik): Playwright E2E happy-path

Loads /dashboard, scrolls to peta section, picks Kependudukan indikator,
verifies map renders with polygons + InfoPanel populated. Year-change
test verifies data refetch."
```

---

## Task 22: Update workspace docs

**Files:**
- Modify: `docs/workspace/admin.md`
- Modify: `docs/workspace/backend.md`
- Modify: `docs/workspace/database.md`

- [ ] **Step 1: Backup**

```bash
cp docs/workspace/admin.md docs/workspace/admin.md.backup
cp docs/workspace/backend.md docs/workspace/backend.md.backup
cp docs/workspace/database.md docs/workspace/database.md.backup
```

- [ ] **Step 2: Update `docs/workspace/admin.md`**

Update the `## Pages` section — add `peta-tematik` (note: section, not standalone page; mention it's embedded in /dashboard). Update Change Log:

Add to Change Log table at bottom:

```markdown
| 2026-05-06 | Add Peta Tematik section di /dashboard (choropleth Maluku Utara, 203 indikator, react-leaflet + cmdk + html2canvas) | components/peta-tematik/*, app/dashboard/page.tsx, package.json |
```

- [ ] **Step 3: Update `docs/workspace/backend.md`**

Add a Routes section entry for `/peta-tematik/*` and a Services section for `services/petaTematik/*`. Update Change Log:

```markdown
| 2026-05-06 | Add /peta-tematik/* routes (5 endpoints) + services/petaTematik (regionMap, categorization, cache, eligibilityScanner, petaTematik.service). Boot-time scan 311 tabel data_bps; 203 ELIGIBLE for choropleth. | src/routes/peta-tematik.routes.js, src/controllers/peta-tematik.controller.js, src/services/petaTematik/*, src/server.js |
```

- [ ] **Step 4: Update `docs/workspace/database.md`**

Add a section noting:
- 203 of 311 `data_bps.indikator_*` tables eligible for peta tematik (have per-kab/kota breakdown)
- Excluded: `indikator_418` (multi-dim Pelanggan Listrik), `indikator_159, _160` (EXIM multidim)
- Reference audit: `tmp/peta_tematik_audit_report.md`, `tmp/indikator_audit.tsv`
- Region mapping convention: dim_value (e.g. "Halmahera Barat", "Kabupaten Halmahera Barat") → kdkab (`01`-`08`, `71`, `72`)

Update Change Log accordingly.

- [ ] **Step 5: Commit**

```bash
git add docs/workspace/admin.md docs/workspace/backend.md docs/workspace/database.md
git commit -m "docs(workspace): peta tematik changes (admin/backend/database)

Section in /dashboard, 5 backend endpoints, 203 eligible indikator,
3 excluded (418, 159, 160). Region mapping via dim_value normalization."
```

---

## Task 23: Final verification + deploy notes

- [ ] **Step 1: Full test suite (backend + admin typecheck)**

```bash
cd backend && npx jest --passWithNoTests --no-coverage
# Expected: ALL pass (191 existing + ~25 new petaTematik tests = 216+)

cd ../backend/admin && npx tsc --noEmit
# Expected: no errors

cd ../.. && git status --short
# Expected: clean (everything committed)
```

- [ ] **Step 2: Boot-time smoke (PM2 reload)**

If deploying to the same server:

```bash
cd /var/www/html/project-data-strategis
pm2 reload pds-backend --update-env
# Wait 60s for boot + scanner
sleep 60
pm2 logs pds-backend --lines 20 --nostream | grep -i 'peta'
# Expected: '[petaTematik] indikator list ready: ~203 eligible'
```

```bash
pm2 reload pds-admin --update-env
sleep 30
# Visit https://api-malika.bpsmalut.com/backend/dashboard manually
```

- [ ] **Step 3: Update auto-memory**

Per CLAUDE.md auto-memory pattern, optionally invoke `claude-md-management:revise-claude-md` skill OR add a brief note to `MEMORY.md`:

```markdown
## Peta Tematik (added 2026-05-06)
- Section di admin /dashboard. Choropleth Maluku Utara, 203 dari 311 indikator BPS eligible.
- Backend: /peta-tematik/* (5 endpoints), services/petaTematik/*, lru-cache TTL 1 jam.
- Frontend: components/peta-tematik/* (react-leaflet, cmdk, html2canvas).
- Audit detail: tmp/peta_tematik_audit_report.md, tmp/indikator_audit.tsv.
- Excluded indikator: 418 (multi-dim), 159+160 (EXIM multidim).
```

- [ ] **Step 4: Optional — push branch**

```bash
git push -u origin feat/peta-tematik
# (Only if user approves push to remote)
```

- [ ] **Step 5: Cleanup .backup files**

Per global CLAUDE.md, .backup files are working-state artifacts — should not be committed. Verify they're not tracked:

```bash
git status --ignored --short | grep '\.backup' | head -10
# Expected: lots of .backup files but as untracked/ignored, not tracked
```

If any `.backup` files were accidentally committed during the plan, remove them in a final commit.

---

## Summary

**Tasks:** 23
**Estimated effort:** 7–10 days (matches spec section 7.6)
**Files created:** ~25 (backend services + admin components + tests + e2e)
**Files modified:** 5 (server.js, dashboard/page.tsx, admin & backend package.json, workspace docs)
**LoC:** ~1.7K bersih
**No DB migration. No infra change. No external service.**

The terminal state of this plan is: choropleth map of Maluku Utara at the bottom of `/dashboard`, populated from any of 203 BPS indikator with adaptive year/month/metric filter, info panel with provinsi total + top/bottom 3 + sparkline trend, PNG export, lazy-mounted to keep dashboard interactive.
