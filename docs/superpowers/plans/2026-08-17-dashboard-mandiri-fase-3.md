# Dashboard Mandiri — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff choose which indicators lead the dashboard and in what order the category sections appear, instead of relying on the automatic fallback.

**Architecture:** Two `app_settings` rows (`dashboard:headline`, `dashboard:categoryOrder`) read by the existing `dashboard.service.getSummary()`, written through a new auth-gated admin endpoint, edited on a new page in the admin panel. No new tables, no schema change.

**Tech Stack:** Express 5 + Sequelize (backend), Next.js 16 admin panel with axios + `RequireAuth`, Jest + Supertest (backend), Vitest (admin).

**Spec:** `docs/superpowers/specs/2026-08-17-dashboard-mandiri-design.md`

**Depends on:** Phase 1 (read layer + `GET /dashboard/public/summary`) and Phase 2 (`/dashboard` page), both shipped 2026-08-17.

## Why this matters now

The dashboard is live and its headline strip is the automatic fallback — "the first six `province`-shaped cards by `display_order`". In production that currently surfaces *Jumlah Pelanggan dan Air Yang Disalurkan* and *Realisasie Pendapatan dan Belanja Pemerintah Desa* as the province's headline statistics. They are real figures, but they are not what a statistics agency would choose to lead with. **Which six lead is an editorial decision for BPS, not a technical one** — this phase builds the mechanism and hands them the choice.

## Global Constraints

- **CommonJS** in `backend/` (`require`/`module.exports`), `'use strict';` at the top of new service files, 2-space indent.
- **Admin routes are gated**: mount with `authMiddleware, csrfMiddleware, apiLimiter` exactly as `app.js` does for `/datasource` and `/period`. A curation endpoint that writes settings must never be public.
- **Validate the request body with explicit type checks** and reject early with `400`. Never trust ids from the client into a table name or an unbounded array.
- **Do not touch `backend/admin/app/dashboard/page.tsx`** — it has uncommitted changes from another session. The new admin page is a separate route.
- **Run `git` from `/var/www/html/project-data-strategis`**, never from `frontend/` (second git repo lives there). Confirm `git rev-parse --abbrev-ref HEAD` prints `main` before each commit.
- **Admin panel needs a build before reload**: `cd backend/admin && npm run build && pm2 reload pds-admin --update-env`.

---

### Task 1: Category order in the summary

**Files:**
- Modify: `backend/src/services/dashboard/dashboard.service.js`
- Modify: `backend/src/__tests__/dashboard.service.test.js`

**Interfaces:**
- Produces: `CATEGORY_ORDER_SETTING_KEY = 'dashboard:categoryOrder'`; `getSummary()` orders `categories` by that list when set, with unlisted categories following in their existing order.

Unlisted categories must not disappear. A saved order captured last month will not mention a category added since, and silently dropping it would hide real indicators.

- [ ] **Step 1: Write the failing test**

Append inside the `describe("getSummary")` block of `backend/src/__tests__/dashboard.service.test.js`:

```js
    test('orders categories by the saved categoryOrder', async () => {
      DataSource.findAll.mockResolvedValue([
        { id: 1, name: 'A', category: 'Sosial', visible: true, display_order: 1, icon: null, color: null },
        { id: 2, name: 'B', category: 'Ekonomi', visible: true, display_order: 2, icon: null, color: null },
      ]);
      appSettings.getJson.mockImplementation((key) =>
        Promise.resolve(key === 'dashboard:categoryOrder' ? ['Ekonomi', 'Sosial'] : null)
      );

      const out = await svc.getSummary();

      expect(out.categories.map((c) => c.name)).toEqual(['Ekonomi', 'Sosial']);
    });

    // A saved order predates any category added since; dropping the unlisted ones
    // would silently hide real indicators.
    test('keeps categories that the saved order does not mention', async () => {
      DataSource.findAll.mockResolvedValue([
        { id: 1, name: 'A', category: 'Sosial', visible: true, display_order: 1, icon: null, color: null },
        { id: 2, name: 'B', category: 'Baru', visible: true, display_order: 2, icon: null, color: null },
      ]);
      appSettings.getJson.mockImplementation((key) =>
        Promise.resolve(key === 'dashboard:categoryOrder' ? ['Sosial'] : null)
      );

      const out = await svc.getSummary();

      expect(out.categories.map((c) => c.name)).toEqual(['Sosial', 'Baru']);
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest src/__tests__/dashboard.service.test.js`
Expected: FAIL — categories come back in insertion order, `['Sosial', 'Ekonomi']`.

- [ ] **Step 3: Write the implementation**

In `backend/src/services/dashboard/dashboard.service.js`, add beside the existing key constant:

```js
const CATEGORY_ORDER_SETTING_KEY = 'dashboard:categoryOrder';
```

In `getSummary()`, extend the settings read:

```js
  const [metas, metricMetas, headlineIds, categoryOrder] = await Promise.all([
    IndicatorMeta.findAll({ raw: true }),
    IndicatorMetricMeta.findAll({ raw: true }),
    appSettings.getJson(HEADLINE_SETTING_KEY),
    appSettings.getJson(CATEGORY_ORDER_SETTING_KEY),
  ]);
```

Then, immediately before `return { headline, categories, generatedAt ... }`, sort:

```js
  // Categories the saved order does not mention keep their existing position at
  // the end, so a stale order can never hide a newly added category.
  if (Array.isArray(categoryOrder) && categoryOrder.length) {
    const rank = new Map(categoryOrder.map((name, i) => [String(name), i]));
    categories.sort((a, b) => {
      const ra = rank.has(a.name) ? rank.get(a.name) : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.name) ? rank.get(b.name) : Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
  }
```

Update the exports to include `CATEGORY_ORDER_SETTING_KEY`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx jest src/__tests__/dashboard.service.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
cd /var/www/html/project-data-strategis
git rev-parse --abbrev-ref HEAD   # must print: main
git add backend/src/services/dashboard/dashboard.service.js backend/src/__tests__/dashboard.service.test.js
git commit -m "feat(dashboard): urutan kategori dari AppSetting"
```

---

### Task 2: Admin curation endpoint

**Files:**
- Create: `backend/src/services/dashboard/curation.service.js`
- Modify: `backend/src/controllers/dashboard.controller.js`
- Create: `backend/src/routes/dashboard.admin.routes.js`
- Modify: `backend/app.js`
- Test: `backend/src/__tests__/dashboard.curation.test.js`

**Interfaces:**
- Produces:
  - `getCuration() -> { headline: number[], categoryOrder: string[], candidates: Array<{ sourceId, name, category, shape }>, categories: string[] }`
  - `saveCuration({ headline, categoryOrder }) -> { headline, categoryOrder }` — throws `Error('Invalid headline')` / `Error('Invalid categoryOrder')`
  - `MAX_HEADLINE = 12`
  - `GET /dashboard/admin/curation`, `PUT /dashboard/admin/curation`

Candidates come from the same `getSummary()` the public page uses, reduced to the four fields the picker needs — the admin UI must not have to download the full 194 KB payload.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/dashboard.curation.test.js`:

```js
'use strict';

jest.mock('../services/dashboard/dashboard.service', () => ({
  getSummary: jest.fn(),
  HEADLINE_SETTING_KEY: 'dashboard:headline',
  CATEGORY_ORDER_SETTING_KEY: 'dashboard:categoryOrder',
}));
jest.mock('../services/settings/appSettings.service', () => ({
  getJson: jest.fn(),
  setJson: jest.fn(),
}));

const dashboardService = require('../services/dashboard/dashboard.service');
const appSettings = require('../services/settings/appSettings.service');
const curation = require('../services/dashboard/curation.service');

describe('dashboard/curation.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    appSettings.getJson.mockResolvedValue(null);
    appSettings.setJson.mockResolvedValue(undefined);
    dashboardService.getSummary.mockResolvedValue({
      headline: [],
      categories: [
        { name: 'Ekonomi', indicators: [{ sourceId: 1, name: 'A', category: 'Ekonomi', shape: 'province' }] },
        { name: 'Sosial', indicators: [{ sourceId: 2, name: 'B', category: 'Sosial', shape: 'regional' }] },
      ],
      generatedAt: '2026-08-17T00:00:00.000Z',
    });
  });

  describe('getCuration', () => {
    test('returns saved settings plus a trimmed candidate list', async () => {
      appSettings.getJson.mockImplementation((k) =>
        Promise.resolve(k === 'dashboard:headline' ? [1] : ['Sosial'])
      );

      const out = await curation.getCuration();

      expect(out.headline).toEqual([1]);
      expect(out.categoryOrder).toEqual(['Sosial']);
      expect(out.categories).toEqual(['Ekonomi', 'Sosial']);
      // Only the fields the picker needs — never the whole payload.
      expect(out.candidates).toEqual([
        { sourceId: 1, name: 'A', category: 'Ekonomi', shape: 'province' },
        { sourceId: 2, name: 'B', category: 'Sosial', shape: 'regional' },
      ]);
    });

    test('returns empty arrays when nothing is saved yet', async () => {
      const out = await curation.getCuration();
      expect(out.headline).toEqual([]);
      expect(out.categoryOrder).toEqual([]);
    });
  });

  describe('saveCuration', () => {
    test('persists both settings', async () => {
      await curation.saveCuration({ headline: [3, 1], categoryOrder: ['Sosial', 'Ekonomi'] });

      expect(appSettings.setJson).toHaveBeenCalledWith('dashboard:headline', [3, 1]);
      expect(appSettings.setJson).toHaveBeenCalledWith('dashboard:categoryOrder', ['Sosial', 'Ekonomi']);
    });

    test('rejects a headline that is not a list of positive integers', async () => {
      await expect(curation.saveCuration({ headline: 'nope', categoryOrder: [] }))
        .rejects.toThrow('Invalid headline');
      await expect(curation.saveCuration({ headline: [0], categoryOrder: [] }))
        .rejects.toThrow('Invalid headline');
      await expect(curation.saveCuration({ headline: [1.5], categoryOrder: [] }))
        .rejects.toThrow('Invalid headline');
      expect(appSettings.setJson).not.toHaveBeenCalled();
    });

    test('caps the headline length', async () => {
      const tooMany = Array.from({ length: curation.MAX_HEADLINE + 1 }, (_, i) => i + 1);
      await expect(curation.saveCuration({ headline: tooMany, categoryOrder: [] }))
        .rejects.toThrow('Invalid headline');
    });

    test('rejects a categoryOrder that is not a list of strings', async () => {
      await expect(curation.saveCuration({ headline: [], categoryOrder: [1, 2] }))
        .rejects.toThrow('Invalid categoryOrder');
      expect(appSettings.setJson).not.toHaveBeenCalled();
    });

    test('de-duplicates the headline while preserving order', async () => {
      await curation.saveCuration({ headline: [2, 1, 2], categoryOrder: [] });
      expect(appSettings.setJson).toHaveBeenCalledWith('dashboard:headline', [2, 1]);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest src/__tests__/dashboard.curation.test.js`
Expected: FAIL — `Cannot find module '../services/dashboard/curation.service'`

- [ ] **Step 3: Write the service**

Create `backend/src/services/dashboard/curation.service.js`:

```js
'use strict';

/**
 * Read and write the two editorial settings behind the dashboard:
 * which indicators lead it, and what order the category sections appear in.
 *
 * Both live in `app_settings`, so there is no schema to migrate and the values
 * are visible to anyone reading the table.
 */

const appSettings = require('../settings/appSettings.service');
const dashboardService = require('./dashboard.service');

const MAX_HEADLINE = 12;

function normaliseHeadline(value) {
  if (!Array.isArray(value)) throw new Error('Invalid headline');
  if (value.length > MAX_HEADLINE) throw new Error('Invalid headline');
  const out = [];
  for (const raw of value) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0 || n > 99999) throw new Error('Invalid headline');
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

function normaliseCategoryOrder(value) {
  if (!Array.isArray(value)) throw new Error('Invalid categoryOrder');
  const out = [];
  for (const raw of value) {
    if (typeof raw !== 'string') throw new Error('Invalid categoryOrder');
    const name = raw.trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

async function getCuration() {
  const [headline, categoryOrder, summary] = await Promise.all([
    appSettings.getJson(dashboardService.HEADLINE_SETTING_KEY),
    appSettings.getJson(dashboardService.CATEGORY_ORDER_SETTING_KEY),
    dashboardService.getSummary(),
  ]);

  // Only what the picker renders. The full summary is ~194 KB and the admin page
  // has no use for values, trends or units.
  const candidates = summary.categories.flatMap((c) =>
    c.indicators.map((i) => ({
      sourceId: i.sourceId,
      name: i.name,
      category: i.category,
      shape: i.shape,
    }))
  );

  return {
    headline: Array.isArray(headline) ? headline : [],
    categoryOrder: Array.isArray(categoryOrder) ? categoryOrder : [],
    categories: summary.categories.map((c) => c.name),
    candidates,
  };
}

async function saveCuration({ headline, categoryOrder }) {
  const cleanHeadline = normaliseHeadline(headline);
  const cleanOrder = normaliseCategoryOrder(categoryOrder);

  await appSettings.setJson(dashboardService.HEADLINE_SETTING_KEY, cleanHeadline);
  await appSettings.setJson(dashboardService.CATEGORY_ORDER_SETTING_KEY, cleanOrder);

  return { headline: cleanHeadline, categoryOrder: cleanOrder };
}

module.exports = { getCuration, saveCuration, MAX_HEADLINE };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx jest src/__tests__/dashboard.curation.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Add controller handlers**

In `backend/src/controllers/dashboard.controller.js`, add the require and two handlers, then extend the exports:

```js
const curation = require('../services/dashboard/curation.service');
```

```js
async function getCuration(req, res) {
  return withGuard(req, res, () => curation.getCuration());
}

async function putCuration(req, res) {
  return withGuard(req, res, async () => {
    const body = req.body || {};
    return curation.saveCuration({
      headline: body.headline,
      categoryOrder: body.categoryOrder,
    });
  });
}
```

```js
module.exports = { getSummary, getCuration, putCuration };
```

`withGuard` already maps a message matching `/Invalid/` to `400` and anything else to a generic `500`, so the validation errors surface correctly without leaking internals.

- [ ] **Step 6: Add the route and mount it**

Create `backend/src/routes/dashboard.admin.routes.js`:

```js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/dashboard.controller');

// Admin-only. Auth, CSRF and rate limiting are applied at app.js registration.
router.get('/curation', ctrl.getCuration);
router.put('/curation', ctrl.putCuration);

module.exports = router;
```

In `backend/app.js`, beside the other admin mounts (near the `/datasource` line), add:

```js
app.use("/dashboard/admin", authMiddleware, csrfMiddleware, apiLimiter, createAuditLogMiddleware({ resource: 'dashboard-curation' }), require("./src/routes/dashboard.admin.routes"));
```

Mount it **after** the existing public `app.use("/dashboard/public", ...)` line so neither path shadows the other.

- [ ] **Step 7: Verify the route is gated**

```bash
cd /var/www/html/project-data-strategis
pm2 reload pds-backend --update-env
sleep 5
echo "unauthenticated GET (must NOT be 200):"
curl -s -o /dev/null -w "  %{http_code}\n" --max-time 30 http://127.0.0.1:5000/dashboard/admin/curation
echo "public summary still fine:"
curl -s -o /dev/null -w "  %{http_code}\n" --max-time 60 http://127.0.0.1:5000/dashboard/public/summary
```

Expected: `401` (or `403`) for the admin route, `200` for the public one. A `200` on the first means the mount is missing `authMiddleware` — stop and fix before continuing.

- [ ] **Step 8: Commit**

```bash
cd /var/www/html/project-data-strategis
git add backend/src/services/dashboard/curation.service.js backend/src/controllers/dashboard.controller.js backend/src/routes/dashboard.admin.routes.js backend/app.js backend/src/__tests__/dashboard.curation.test.js
git commit -m "feat(dashboard): endpoint admin kurasi headline dan urutan kategori"
```

---

### Task 3: Admin curation page

**Files:**
- Create: `backend/admin/app/dashboard-curation/page.tsx`
- Modify: `backend/admin/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `GET`/`PUT /dashboard/admin/curation` via `api` from `@/lib/axios`.

Follows the pattern in `app/cache/page.tsx`: a `"use client"` page wrapped in `RequireAuth`, using `api`, `getErrorMessage`, `LoadingSpinner` and `Alert`. Verified against that file: `Alert` takes `variant="error" | "success"` with the message as **children** (not `type`/`message` props), and `LoadingSpinner` takes a `label`.

Deliberately plain controls — checkboxes for the headline and move-up/move-down buttons for the order. No drag-and-drop library: it would be a new dependency and a keyboard-accessibility problem for a list edited a few times a year.

- [ ] **Step 1: Write the page**

Create `backend/admin/app/dashboard-curation/page.tsx`:

```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/axios";
import { getErrorMessage } from "@/lib/errors";
import LoadingSpinner from "@/components/LoadingSpinner";
import Alert from "@/components/Alert";
import RequireAuth from "@/components/RequireAuth";
import { ArrowDown, ArrowUp, Save } from "lucide-react";

type Candidate = {
  sourceId: number;
  name: string;
  category: string;
  shape: "province" | "regional" | "dimensional";
};

const MAX_HEADLINE = 12;

function DashboardCurationPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [headline, setHeadline] = useState<number[]>([]);
  const [categoryOrder, setCategoryOrder] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const { data } = await api.get("/dashboard/admin/curation");
        setCandidates(data.candidates || []);
        setHeadline(data.headline || []);
        // Fall back to the live category list so the order editor is never empty.
        setCategoryOrder(
          (data.categoryOrder || []).length ? data.categoryOrder : data.categories || []
        );
      } catch (e) {
        setError(getErrorMessage(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Only province-shaped indicators carry a headline number worth leading with.
  const pickable = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates
      .filter((c) => c.shape === "province")
      .filter((c) => (q ? c.name.toLowerCase().includes(q) : true));
  }, [candidates, search]);

  const byId = useMemo(() => new Map(candidates.map((c) => [c.sourceId, c])), [candidates]);

  function toggle(sourceId: number) {
    setHeadline((prev) =>
      prev.includes(sourceId)
        ? prev.filter((id) => id !== sourceId)
        : prev.length >= MAX_HEADLINE
          ? prev
          : [...prev, sourceId]
    );
  }

  function moveCategory(index: number, delta: number) {
    setCategoryOrder((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await api.put("/dashboard/admin/curation", { headline, categoryOrder });
      setSuccess("Kurasi dashboard tersimpan.");
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingSpinner label="Memuat kurasi dashboard…" />;

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-xl font-semibold">Kurasi Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Pilih indikator yang tampil di strip &ldquo;Angka utama&rdquo; dan atur urutan seksi
          kategori pada halaman /dashboard.
        </p>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}

      <section className="rounded-lg border border-gray-200 p-4">
        <h2 className="font-medium">
          Angka utama{" "}
          <span className="text-sm font-normal text-gray-500">
            ({headline.length}/{MAX_HEADLINE} dipilih)
          </span>
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Hanya indikator yang punya baris provinsi yang bisa dipilih — indikator lain tidak
          memiliki satu angka tingkat provinsi untuk ditampilkan.
        </p>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari indikator…"
          aria-label="Cari indikator"
          className="mt-3 h-9 w-full max-w-md rounded border border-gray-300 px-3 text-sm"
        />

        {headline.length > 0 ? (
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
            {headline.map((id) => (
              <li key={id}>{byId.get(id)?.name ?? `#${id}`}</li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-sm text-gray-500">
            Belum ada pilihan — dashboard memakai enam kartu provinsi pertama secara otomatis.
          </p>
        )}

        <div className="mt-3 max-h-80 overflow-y-auto rounded border border-gray-100">
          {pickable.map((c) => (
            <label
              key={c.sourceId}
              className="flex items-start gap-2 border-b border-gray-100 p-2 text-sm last:border-b-0"
            >
              <input
                type="checkbox"
                checked={headline.includes(c.sourceId)}
                onChange={() => toggle(c.sourceId)}
                className="mt-0.5"
              />
              <span>
                <span className="block">{c.name}</span>
                <span className="block text-xs text-gray-500">{c.category}</span>
              </span>
            </label>
          ))}
          {pickable.length === 0 ? (
            <p className="p-3 text-sm text-gray-500">Tidak ada indikator yang cocok.</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 p-4">
        <h2 className="font-medium">Urutan kategori</h2>
        <p className="mt-1 text-sm text-gray-500">
          Kategori yang belum ada dalam daftar ini tetap tampil, di urutan paling bawah.
        </p>
        <ul className="mt-3 divide-y divide-gray-100 rounded border border-gray-100">
          {categoryOrder.map((name, i) => (
            <li key={name} className="flex items-center justify-between gap-2 p-2 text-sm">
              <span>
                <span className="mr-2 text-gray-400">{i + 1}.</span>
                {name}
              </span>
              <span className="flex gap-1">
                <button
                  type="button"
                  onClick={() => moveCategory(i, -1)}
                  disabled={i === 0}
                  aria-label={`Naikkan ${name}`}
                  className="rounded border border-gray-200 p-1 disabled:opacity-40"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => moveCategory(i, 1)}
                  disabled={i === categoryOrder.length - 1}
                  aria-label={`Turunkan ${name}`}
                  className="rounded border border-gray-200 p-1 disabled:opacity-40"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="inline-flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        <Save className="h-4 w-4" />
        {saving ? "Menyimpan…" : "Simpan"}
      </button>
    </div>
  );
}

export default function Page() {
  return (
    <RequireAuth>
      <DashboardCurationPage />
    </RequireAuth>
  );
}
```

- [ ] **Step 2: Add the sidebar entry**

In `backend/admin/components/Sidebar.tsx`, add an entry next to the other dashboard-related items (the file uses `{ href, label, icon }` objects; `LayoutDashboard` is already imported for `/dashboard`, so import one more icon such as `Star` from `lucide-react`):

```tsx
      { href: "/dashboard-curation", label: "Kurasi Dashboard", icon: <Star className="h-4 w-4" /> },
```

- [ ] **Step 3: Verify**

```bash
cd /var/www/html/project-data-strategis/backend/admin
npx tsc --noEmit
npm run lint
npm test
npm run build
```

Expected: all clean; the build lists `/dashboard-curation`.

- [ ] **Step 4: Commit**

```bash
cd /var/www/html/project-data-strategis
git add backend/admin/app/dashboard-curation/page.tsx backend/admin/components/Sidebar.tsx
git commit -m "feat(admin): halaman kurasi dashboard"
```

---

### Task 4: Verify end to end, deploy, document

- [ ] **Step 1: Deploy both apps**

```bash
cd /var/www/html/project-data-strategis/backend/admin && npm run build && pm2 reload pds-admin --update-env
cd /var/www/html/project-data-strategis && pm2 reload pds-backend --update-env
sleep 8
pm2 list | grep -E "pds-admin|pds-backend|pds-frontend"
```

Expected: all `online`, restart counts not climbing.

- [ ] **Step 2: Save a curation from the admin UI and confirm the public dashboard changes**

Open `https://api-malika.bpsmalut.com/dashboard-curation` (admin panel), sign in, pick a handful of headline indicators, reorder a category, and save. Then:

```bash
curl -s --max-time 60 http://127.0.0.1:5000/dashboard/public/summary \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);
      console.log('headline:', j.headline.map(c=>c.name.slice(0,40)));
      console.log('first 3 categories:', j.categories.slice(0,3).map(c=>c.name));})"
```

Expected: the headline names match what was picked, in the picked order, and the category order reflects the change. This is the whole phase working end to end — the settings are read by the same `getSummary()` the public page uses.

- [ ] **Step 3: Confirm the live page shows it**

Run: `PWA_BASE_URL=https://malika.bpsmalut.com npx playwright test dashboard --reporter=list` (from `frontend/`)
Expected: 5 passed. The headline assertions are shape-based, so a curated set does not break them.

- [ ] **Step 4: Update the workspace docs and push**

Add Change Log rows to `docs/workspace/backend.md` (curation endpoint, category order setting, both `app_settings` keys) and `docs/workspace/admin.md` (the new page). Then:

```bash
cd /var/www/html/project-data-strategis
git add docs/workspace/backend.md docs/workspace/admin.md
git commit -m "docs: catat kurasi dashboard fase 3"
git push origin main
```

---

## Done when

- `cd backend && npx jest src/__tests__/dashboard.*.test.js` passes.
- `cd backend/admin && npm test && npm run build` passes.
- `GET /dashboard/admin/curation` is **not** reachable without authentication.
- Saving in the admin UI changes what `/dashboard` shows, in both headline content and category order.
- A category missing from a saved order still appears, at the end.
