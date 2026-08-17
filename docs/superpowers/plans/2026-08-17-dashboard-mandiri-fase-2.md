# Dashboard Mandiri — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Metabase iframe at `/dashboard` with a real page rendered from `GET /dashboard/public/summary`, built in phase 1.

**Architecture:** A server component fetches the summary through a thin `/api/dashboard/summary` proxy and renders a headline strip plus one section per category. Cards are presentational only — every value, unit and label comes from the API, so adding an indicator to the catalog makes it appear with no frontend change.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript (strict), Tailwind v4, existing `components/chat/MiniSparkline.tsx` for sparklines, Playwright for e2e, `node --test` for unit tests.

**Spec:** `docs/superpowers/specs/2026-08-17-dashboard-mandiri-design.md`

**Depends on:** Phase 1 (`docs/superpowers/plans/2026-08-17-dashboard-mandiri-fase-1.md`), shipped 2026-08-17. `GET /dashboard/public/summary` is live and returns 34 categories / 285 cards.

## Global Constraints

- **TypeScript strict.** No `any` without a short comment justifying it.
- **2-space indentation.** Named exports for components/utils; default export only where Next requires it (pages/layouts).
- **Tailwind v4 utility classes.** Avoid inline `style={}` except for genuinely dynamic values.
- **`@/` path alias** for intra-app imports; relative paths only for siblings.
- **Never apply `unit_multiplier`.** Spec, revised 2026-08-17: the flag disagrees with its own data (source 179 "Rumah Tangga" is raw counts, source 186 "Penduduk" is genuinely thousands — both flagged `3`/"ribu"). Display the value exactly as the API returns it, and render neither a multiplication nor a "ribu" label.
- **`unit_id` may contain HTML** (`km<sup>2</sup>`, `m<sup>2</sup>`, `m<sup>3</sup>`). Never use `dangerouslySetInnerHTML` on it.
- **Run `git` from `/var/www/html/project-data-strategis`**, never from `frontend/` — that directory contains a second, unrelated git repo (the TailAdmin template). Confirm `git rev-parse --abbrev-ref HEAD` prints `main` before every commit.
- **Next.js apps must be built before reload.** `pm2 reload pds-frontend` alone re-execs the existing `.next` bundle and your changes silently do not ship.

---

### Task 1: Promote the shared surface tokens

The landing page's token constants live in `(landing)/_lib/ui.ts`. The dashboard needs the same card/surface/text pairs. Importing across route groups works but couples two unrelated features, so move the constants to `src/lib/` and have both import from there.

**Files:**
- Create: `frontend/src/lib/surfaceTokens.ts`
- Modify: `frontend/src/app/(landing)/_lib/ui.ts` (re-export, keeping landing-only values local)

**Interfaces:**
- Produces: `SURFACE`, `BORDER`, `CARD`, `SURFACE_2`, `SURFACE_BRAND`, `SURFACE_BRAND_2`, `BRAND_BORDER`, `TEXT`, `TEXT_2`, `TEXT_3`, `TEXT_4`, `TEXT_5`, `BRAND_TEXT`, `CARD_HOVER`, `MONO` — all `string` of Tailwind classes.

- [ ] **Step 1: Create the shared module**

Create `frontend/src/lib/surfaceTokens.ts` by moving these constants verbatim out of `frontend/src/app/(landing)/_lib/ui.ts`:

```ts
/**
 * Light/dark surface, border and text pairs shared by the landing page and the
 * dashboard.
 *
 * The design these came from carried its palette as CSS custom properties
 * swapped by JavaScript. Every value is already a named token in globals.css, so
 * each one is expressed here as a light/dark Tailwind pair driven by the app's
 * existing `.dark` class — no JS, and no flash of light theme on load.
 */

/** `--surface` + `--border` */
export const SURFACE = "bg-white dark:bg-gray-dark";
export const BORDER = "border-gray-200 dark:border-[#2b3648]";
export const CARD = `rounded-2xl border ${BORDER} ${SURFACE}`;

/** The quieter fill behind pills and icon chips. */
export const SURFACE_2 = "bg-gray-100 dark:bg-gray-800";

export const SURFACE_BRAND = "bg-brand-25 dark:bg-[#141a33]";
export const SURFACE_BRAND_2 = "bg-brand-50 dark:bg-brand-500/[0.16]";
export const BRAND_BORDER = "border-brand-200 dark:border-brand-500/45";

export const TEXT = "text-gray-900 dark:text-gray-100";
export const TEXT_2 = "text-gray-700 dark:text-gray-200";
export const TEXT_3 = "text-gray-600 dark:text-gray-300";
export const TEXT_4 = "text-gray-500 dark:text-gray-400";
export const TEXT_5 = "text-gray-400 dark:text-[#7d8799]";

export const BRAND_TEXT = "text-brand-600 dark:text-brand-300";

/** Lift-on-hover shared by tile, category and service cards. */
export const CARD_HOVER =
  "transition-[transform,border-color,box-shadow] duration-150 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-theme-lg dark:hover:border-brand-500/60";

/** Monospace numerals. */
export const MONO = "font-[family-name:var(--font-ibm-plex-mono)]";
```

- [ ] **Step 2: Re-export from the landing module**

Replace the moved constants in `frontend/src/app/(landing)/_lib/ui.ts` with a re-export, keeping the landing-only values (`PAGE_BG`, `SECTION`, `SCROLL_ANCHOR`, `NAVY_PANEL`) defined locally:

```ts
export {
  SURFACE,
  BORDER,
  CARD,
  SURFACE_2,
  SURFACE_BRAND,
  SURFACE_BRAND_2,
  BRAND_BORDER,
  TEXT,
  TEXT_2,
  TEXT_3,
  TEXT_4,
  TEXT_5,
  BRAND_TEXT,
  CARD_HOVER,
  MONO,
} from "@/lib/surfaceTokens";
```

- [ ] **Step 3: Verify nothing broke**

```bash
cd /var/www/html/project-data-strategis/frontend
npx tsc --noEmit
npx eslint "src/app/(landing)" src/lib/surfaceTokens.ts
```

Expected: both clean. A missing export shows up here as a TS error in a landing component.

- [ ] **Step 4: Commit**

```bash
cd /var/www/html/project-data-strategis
git rev-parse --abbrev-ref HEAD   # must print: main
git add frontend/src/lib/surfaceTokens.ts "frontend/src/app/(landing)/_lib/ui.ts"
git commit -m "refactor(frontend): pindahkan token permukaan ke src/lib agar dipakai bersama"
```

---

### Task 2: Types and the API proxy

**Files:**
- Create: `frontend/src/app/(admin)/dashboard/_lib/types.ts`
- Create: `frontend/src/app/api/dashboard/summary/route.ts`

**Interfaces:**
- Produces:
  - `type CardShape = "province" | "regional" | "dimensional"`
  - `type TrendPoint = { year: number; month_no: number; periodLabel: string; value: number }`
  - `type Delta = { absolute: number; previousValue: number; previousLabel: string }`
  - `type IndicatorCardData = { sourceId, name, category, icon, color, metric, unit, unitMultiplier, decimalPlaces, periodCount, dimKey, shape, latest, trend, error }`
  - `type DashboardSummary = { ok: boolean; headline: IndicatorCardData[]; categories: Array<{ name: string; indicators: IndicatorCardData[] }>; generatedAt: string }`
  - `GET /api/dashboard/summary` proxying the backend.

Types mirror the payload phase 1 actually returns; verify against a live response before writing them (`curl -s http://127.0.0.1:5000/dashboard/public/summary | head -c 1200`).

- [ ] **Step 1: Write the types**

Create `frontend/src/app/(admin)/dashboard/_lib/types.ts`:

```ts
/** Shape of GET /dashboard/public/summary (backend services/dashboard). */

export type CardShape = "province" | "regional" | "dimensional";

export type TrendPoint = {
  year: number;
  month_no: number;
  periodLabel: string;
  value: number;
};

export type Delta = {
  absolute: number;
  previousValue: number;
  previousLabel: string;
};

export type LatestValue = {
  value: number;
  year: number;
  month_no: number;
  periodLabel: string;
  scope: "province";
};

export type IndicatorCardData = {
  sourceId: number;
  name: string;
  category: string;
  icon: string | null;
  color: string | null;
  metric: string | null;
  unit: string | null;
  /** Present in the payload but deliberately never applied — see the spec. */
  unitMultiplier: number | null;
  decimalPlaces: number | null;
  periodCount: number;
  dimKey: string | null;
  shape: CardShape;
  latest: LatestValue | null;
  trend: { points: TrendPoint[]; delta: Delta | null };
  error: boolean;
};

export type DashboardCategory = {
  name: string;
  indicators: IndicatorCardData[];
};

export type DashboardSummary = {
  ok: boolean;
  headline: IndicatorCardData[];
  categories: DashboardCategory[];
  generatedAt: string;
};
```

- [ ] **Step 2: Write the proxy route**

Create `frontend/src/app/api/dashboard/summary/route.ts`, matching the convention in `src/app/api/peta-tematik/summary/route.ts`:

```ts
import { NextResponse } from "next/server";
import { backendBaseUrl } from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const res = await fetch(`${backendBaseUrl()}/dashboard/public/summary`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Backend ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    // Log server-side; return a generic message so internals never reach the client.
    console.error("[api/dashboard/summary]", e);
    return NextResponse.json({ error: "Failed to fetch dashboard summary" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify**

```bash
cd /var/www/html/project-data-strategis/frontend
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd /var/www/html/project-data-strategis
git add "frontend/src/app/(admin)/dashboard/_lib/types.ts" frontend/src/app/api/dashboard/summary/route.ts
git commit -m "feat(dashboard): tipe payload dan proxy /api/dashboard/summary"
```

---

### Task 3: Value formatting

The one place numbers turn into strings. Unit-tested with `node --test`, which runs TypeScript natively on this Node (v26) — no new dependency. Imports in test files need an explicit `.ts` extension or Node's ESM resolver cannot find them.

**Files:**
- Create: `frontend/src/app/(admin)/dashboard/_lib/format.ts`
- Test: `frontend/tests/dashboardFormat.test.ts`

**Interfaces:**
- Produces:
  - `formatValue(value: number, decimalPlaces: number | null): string` — Indonesian locale, `.` thousands and `,` decimals
  - `formatDelta(delta: Delta | null, decimalPlaces: number | null): { text: string; direction: "up" | "down" | "flat" } | null`
  - `parseUnit(unit: string | null): Array<{ text: string; sup: boolean }>` — splits `km<sup>2</sup>` into renderable parts without HTML injection

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/dashboardFormat.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { formatValue, formatDelta, parseUnit } from "../src/app/(admin)/dashboard/_lib/format.ts";

test("formatValue uses Indonesian separators", () => {
  assert.equal(formatValue(1234567.891, 2), "1.234.567,89");
  assert.equal(formatValue(5.93, 2), "5,93");
  assert.equal(formatValue(259368, 0), "259.368");
});

test("formatValue falls back to two decimals when decimalPlaces is null", () => {
  assert.equal(formatValue(5.9, null), "5,90");
});

test("formatDelta reports direction and a signed value", () => {
  const up = formatDelta({ absolute: 1.7, previousValue: 18.79, previousLabel: "Triwulan I 2026" }, 2);
  assert.equal(up?.direction, "up");
  assert.equal(up?.text, "1,70");

  const down = formatDelta({ absolute: -0.26, previousValue: 6.19, previousLabel: "Maret 2025" }, 2);
  assert.equal(down?.direction, "down");
  assert.equal(down?.text, "0,26");

  const flat = formatDelta({ absolute: 0, previousValue: 5, previousLabel: "2025" }, 2);
  assert.equal(flat?.direction, "flat");
});

test("formatDelta returns null when there is nothing to compare", () => {
  assert.equal(formatDelta(null, 2), null);
});

// unit_id really contains values like "km<sup>2</sup>"; rendering it as text
// shows literal tags and rendering it as HTML is an injection surface.
test("parseUnit splits a superscript unit into safe parts", () => {
  assert.deepEqual(parseUnit("km<sup>2</sup>"), [
    { text: "km", sup: false },
    { text: "2", sup: true },
  ]);
  assert.deepEqual(parseUnit("Persen"), [{ text: "Persen", sup: false }]);
  assert.deepEqual(parseUnit(null), []);
});

test("parseUnit does not pass through other markup", () => {
  const parts = parseUnit('<img src=x onerror=alert(1)>kg');
  const joined = parts.map((p) => p.text).join("");
  assert.ok(!joined.includes("<"), "angle brackets must not survive");
  assert.ok(!joined.includes("onerror"), "attributes must not survive");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && node --test tests/dashboardFormat.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `format.ts`

- [ ] **Step 3: Write the implementation**

Create `frontend/src/app/(admin)/dashboard/_lib/format.ts`:

```ts
import type { Delta } from "./types";

/**
 * The only place dashboard numbers become strings.
 *
 * `unit_multiplier` is deliberately absent: the flag disagrees with its own data
 * (source 179 "Rumah Tangga" carries raw counts, source 186 "Penduduk" genuinely
 * thousands, both flagged 3/"ribu"), so applying it would inflate one by a
 * thousand and labelling with it would mislabel the other. Values are shown
 * exactly as BPS replicated them. See the spec's risks section.
 */

const DEFAULT_DECIMALS = 2;

export function formatValue(value: number, decimalPlaces: number | null): string {
  const digits = decimalPlaces == null ? DEFAULT_DECIMALS : Math.max(0, Math.min(6, decimalPlaces));
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatDelta(
  delta: Delta | null,
  decimalPlaces: number | null
): { text: string; direction: "up" | "down" | "flat" } | null {
  if (!delta) return null;
  const direction = delta.absolute > 0 ? "up" : delta.absolute < 0 ? "down" : "flat";
  return { text: formatValue(Math.abs(delta.absolute), decimalPlaces), direction };
}

/**
 * Units arrive as stored strings that may contain a superscript, e.g.
 * `km<sup>2</sup>`. Only that one tag is understood; everything else is
 * stripped, so the value can be rendered as plain React children with no
 * `dangerouslySetInnerHTML` anywhere.
 */
export function parseUnit(unit: string | null): Array<{ text: string; sup: boolean }> {
  if (!unit) return [];
  const parts: Array<{ text: string; sup: boolean }> = [];
  const pattern = /<sup>([^<]*)<\/sup>/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  const pushPlain = (raw: string) => {
    const text = raw.replace(/<[^>]*>/g, "").trim();
    if (text) parts.push({ text, sup: false });
  };

  while ((match = pattern.exec(unit)) !== null) {
    pushPlain(unit.slice(cursor, match.index));
    const sup = match[1].replace(/<[^>]*>/g, "").trim();
    if (sup) parts.push({ text: sup, sup: true });
    cursor = match.index + match[0].length;
  }
  pushPlain(unit.slice(cursor));
  return parts;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && node --test tests/dashboardFormat.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
cd /var/www/html/project-data-strategis
git add "frontend/src/app/(admin)/dashboard/_lib/format.ts" frontend/tests/dashboardFormat.test.ts
git commit -m "feat(dashboard): pemformatan nilai, delta, dan satuan ber-superscript"
```

---

### Task 4: IndicatorCard

**Files:**
- Create: `frontend/src/app/(admin)/dashboard/_components/IndicatorCard.tsx`

**Interfaces:**
- Consumes: `IndicatorCardData` (Task 2), `formatValue`/`formatDelta`/`parseUnit` (Task 3), surface tokens (Task 1), `components/chat/MiniSparkline`.
- Produces: `export function IndicatorCard({ card }: { card: IndicatorCardData })`

Three shapes, exactly as the spec defines them:

| `shape` | Renders |
|---|---|
| `province` | headline value + unit + delta pill + sparkline + period label |
| `regional` | dimension name + "per kabupaten/kota" + link to `/peta-tematik` |
| `dimensional` | dimension name + period count + link to `/data?source=NNN` |

A card with `error: true` shows the name and a muted "data tidak tersedia" line — never a zero, which would read as a real measurement.

- [ ] **Step 1: Write the component**

Create `frontend/src/app/(admin)/dashboard/_components/IndicatorCard.tsx`:

```tsx
"use client";

import React from "react";
import Link from "next/link";
import MiniSparkline from "@/components/chat/MiniSparkline";
import { cn } from "@/lib/utils";
import {
  BORDER,
  BRAND_TEXT,
  CARD_HOVER,
  MONO,
  SURFACE,
  TEXT,
  TEXT_4,
  TEXT_5,
} from "@/lib/surfaceTokens";
import { formatDelta, formatValue, parseUnit } from "../_lib/format";
import type { IndicatorCardData } from "../_lib/types";

function Unit({ unit }: { unit: string | null }) {
  const parts = parseUnit(unit);
  if (!parts.length) return null;
  return (
    <span className={cn("ml-1 text-sm font-normal", TEXT_4)}>
      {parts.map((p, i) => (p.sup ? <sup key={i}>{p.text}</sup> : <span key={i}>{p.text}</span>))}
    </span>
  );
}

export function IndicatorCard({ card }: { card: IndicatorCardData }) {
  const delta = formatDelta(card.trend.delta, card.decimalPlaces);
  const href = card.shape === "regional" ? "/peta-tematik" : `/data?source=${card.sourceId}`;

  return (
    <Link
      href={href}
      className={cn("flex flex-col gap-3 rounded-2xl border p-5", BORDER, SURFACE, CARD_HOVER)}
    >
      <span className={cn("line-clamp-2 text-sm font-medium leading-5", TEXT)}>{card.name}</span>

      {card.error ? (
        <span className={cn("text-sm", TEXT_5)}>Data tidak tersedia</span>
      ) : card.shape === "province" && card.latest ? (
        <>
          <span className="flex items-baseline">
            <span className={cn("text-2xl font-medium leading-8", MONO, TEXT)}>
              {formatValue(card.latest.value, card.decimalPlaces)}
            </span>
            <Unit unit={card.unit} />
          </span>
          <span className="flex flex-wrap items-center gap-2">
            {delta ? (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  delta.direction === "up"
                    ? "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400"
                    : delta.direction === "down"
                      ? "bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400"
                      : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                )}
              >
                {delta.direction === "up" ? "▲" : delta.direction === "down" ? "▼" : "="} {delta.text}
              </span>
            ) : null}
            <span className={cn("text-xs", TEXT_4)}>{card.latest.periodLabel}</span>
          </span>
          {card.trend.points.length > 1 ? (
            <MiniSparkline
              values={card.trend.points.map((p) => p.value)}
              labels={card.trend.points.map((p) => p.periodLabel)}
              width={180}
              height={36}
              showArea
            />
          ) : null}
        </>
      ) : (
        <>
          <span className={cn("text-sm", TEXT_4)}>
            {card.shape === "regional"
              ? "Tersedia per kabupaten/kota"
              : card.dimKey
                ? `Rincian menurut ${card.dimKey}`
                : "Rincian tersedia"}
          </span>
          <span className={cn("text-xs", TEXT_5)}>{card.periodCount} periode</span>
        </>
      )}

      <span className={cn("mt-auto text-xs font-medium", BRAND_TEXT)}>
        {card.shape === "regional" ? "Lihat peta" : "Lihat data"}
      </span>
    </Link>
  );
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /var/www/html/project-data-strategis/frontend
npx tsc --noEmit
```

Expected: clean. (Verified while writing this plan: `MiniSparkline.tsx` exports the
component both named at line 27 and as default at line 203, and its props are
`values: number[]`, `labels?: string[]`, `width?`, `height?`, `color?`,
`showArea?`, `title?` — the default import and prop names above are correct.)

- [ ] **Step 3: Commit**

```bash
cd /var/www/html/project-data-strategis
git add "frontend/src/app/(admin)/dashboard/_components/IndicatorCard.tsx"
git commit -m "feat(dashboard): komponen kartu indikator tiga bentuk"
```

---

### Task 5: The page, replacing the iframe

**Files:**
- Modify: `frontend/src/app/(admin)/dashboard/page.tsx` (full rewrite — the Metabase embed goes)
- Create: `frontend/src/app/(admin)/dashboard/_components/DashboardClient.tsx`
- Modify: `frontend/src/app/(admin)/layout.tsx` (drop the full-bleed gate)

**Interfaces:**
- Consumes: `DashboardSummary` (Task 2), `IndicatorCard` (Task 4).
- Produces: the `/dashboard` route.

`(admin)/layout.tsx` currently gives `/dashboard` a non-scrolling, zero-padding main area because an iframe needed it. A scrolling page must not inherit that, so `isDashboard` is removed and `/chat` keeps its own gate.

- [ ] **Step 1: Rewrite the page as a server component**

Replace the contents of `frontend/src/app/(admin)/dashboard/page.tsx` with:

```tsx
import type { Metadata } from "next";
import React from "react";
import { backendBaseUrl } from "@/lib/apiHelpers";
import DashboardClient from "./_components/DashboardClient";
import type { DashboardSummary } from "./_lib/types";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Indikator strategis Maluku Utara dari Badan Pusat Statistik.",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadSummary(): Promise<DashboardSummary | null> {
  try {
    const res = await fetch(`${backendBaseUrl()}/dashboard/public/summary`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as DashboardSummary;
  } catch {
    // Rendered as an empty-state below rather than crashing the route.
    return null;
  }
}

export default async function DashboardPage() {
  const summary = await loadSummary();
  return <DashboardClient summary={summary} />;
}
```

- [ ] **Step 2: Write the client shell**

Create `frontend/src/app/(admin)/dashboard/_components/DashboardClient.tsx`:

```tsx
"use client";

import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { BORDER, SURFACE, TEXT, TEXT_4 } from "@/lib/surfaceTokens";
import { IndicatorCard } from "./IndicatorCard";
import type { DashboardSummary } from "../_lib/types";

export default function DashboardClient({ summary }: { summary: DashboardSummary | null }) {
  const [query, setQuery] = useState("");

  const categories = useMemo(() => {
    if (!summary) return [];
    const q = query.trim().toLowerCase();
    if (!q) return summary.categories;
    return summary.categories
      .map((c) => ({ ...c, indicators: c.indicators.filter((i) => i.name.toLowerCase().includes(q)) }))
      .filter((c) => c.indicators.length > 0);
  }, [summary, query]);

  if (!summary) {
    return (
      <div className={cn("rounded-2xl border p-6", BORDER, SURFACE)}>
        <h1 className={cn("text-lg font-semibold", TEXT)}>Dashboard</h1>
        <p className={cn("mt-2 text-sm", TEXT_4)}>
          Data dashboard sedang tidak tersedia. Coba muat ulang beberapa saat lagi.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className={cn("text-2xl font-semibold leading-8", TEXT)}>Indikator Strategis</h1>
          <p className={cn("mt-1 text-sm", TEXT_4)}>
            Maluku Utara · {summary.categories.reduce((n, c) => n + c.indicators.length, 0)} indikator
            dari Badan Pusat Statistik
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari indikator…"
          aria-label="Cari indikator"
          className={cn(
            "h-10 w-full rounded-lg border px-3 text-sm outline-none focus:border-brand-400 md:w-72",
            BORDER,
            SURFACE,
            TEXT
          )}
        />
      </header>

      {summary.headline.length > 0 && !query ? (
        <section aria-label="Angka utama">
          <h2 className={cn("mb-3 text-sm font-semibold uppercase tracking-wide", TEXT_4)}>
            Angka utama
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {summary.headline.map((card) => (
              <IndicatorCard key={`headline-${card.sourceId}`} card={card} />
            ))}
          </div>
        </section>
      ) : null}

      {categories.length === 0 ? (
        <p className={cn("text-sm", TEXT_4)}>Tidak ada indikator yang cocok dengan pencarian.</p>
      ) : (
        categories.map((category) => (
          <section key={category.name} aria-label={category.name}>
            <h2 className={cn("mb-3 text-sm font-semibold uppercase tracking-wide", TEXT_4)}>
              {category.name}
              <span className={cn("ml-2 font-normal normal-case")}>({category.indicators.length})</span>
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {category.indicators.map((card) => (
                <IndicatorCard key={card.sourceId} card={card} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 3: Remove the full-bleed gate**

In `frontend/src/app/(admin)/layout.tsx`, delete the `isDashboard` constant and its comment, and change every use so only `/chat` keeps the non-scrolling treatment:

- `const isDashboard = pathname === "/dashboard";` → delete the line and the two comment lines above it
- `isDashboard || isChat` → `isChat`
- `isTouchDevice && !isDashboard && !isChat` → `isTouchDevice && !isChat`

- [ ] **Step 4: Verify**

```bash
cd /var/www/html/project-data-strategis/frontend
npx tsc --noEmit
npx eslint "src/app/(admin)/dashboard" "src/app/(admin)/layout.tsx"
npm run build
```

Expected: tsc and eslint clean; build succeeds and lists `/dashboard`.

- [ ] **Step 5: Commit**

```bash
cd /var/www/html/project-data-strategis
git add "frontend/src/app/(admin)/dashboard/page.tsx" "frontend/src/app/(admin)/dashboard/_components/DashboardClient.tsx" "frontend/src/app/(admin)/layout.tsx"
git commit -m "feat(dashboard): halaman mandiri menggantikan embed Metabase"
```

---

### Task 6: End-to-end coverage

**Files:**
- Create: `frontend/e2e/dashboard.spec.ts`

Mirrors the structure of `e2e/landing.spec.ts`: an `isReachable` guard, `waitForLoadState("load")`, and a wait for `AppSplashScreen` to unmount before interacting.

- [ ] **Step 1: Write the spec**

Create `frontend/e2e/dashboard.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { isReachable } from "./utils";

const BASE = process.env.PWA_BASE_URL || "http://127.0.0.1:3000";
const URL = `${BASE}/dashboard`;

test.describe("Dashboard (/dashboard)", () => {
  test.beforeEach(async ({ page }) => {
    if (!(await isReachable(URL))) test.skip(true, `Dashboard not reachable at ${URL}`);
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load");
    // AppSplashScreen covers the viewport for ~3s after load.
    await page.waitForFunction(() => !document.querySelector('[class*="2147483647"]'), null, {
      timeout: 20_000,
    });
  });

  test("renders indicator cards, not a Metabase iframe", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Indikator Strategis" })).toBeVisible();
    // The whole point of the phase: no embed left.
    await expect(page.locator('iframe[title="Metabase Dashboard"]')).toHaveCount(0);
    await expect(page.locator('a[href^="/data?source="], a[href="/peta-tematik"]').first()).toBeVisible();
  });

  test("shows at least one headline value with a period label", async ({ page }) => {
    const headline = page.locator('section[aria-label="Angka utama"]');
    await expect(headline).toBeVisible();
    // A province card always carries a period label such as "2026" or "Triwulan II 2026".
    await expect(headline.getByText(/\b(19|20)\d{2}\b/).first()).toBeVisible();
  });

  test("search filters the category sections", async ({ page }) => {
    const search = page.getByRole("searchbox", { name: "Cari indikator" });
    await search.fill("zzzzznotanindicator");
    await expect(page.getByText("Tidak ada indikator yang cocok dengan pencarian.")).toBeVisible();

    await search.fill("");
    await expect(page.locator("section").first()).toBeVisible();
  });

  test("the page scrolls — it must not inherit the iframe's full-bleed layout", async ({ page }) => {
    const scrollable = await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight
    );
    expect(scrollable).toBe(true);
  });

  test("never scrolls sideways at any width", async ({ page }) => {
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(300);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth, `width ${width}`).toBeLessThanOrEqual(clientWidth + 2);
    }
  });
});
```

- [ ] **Step 2: Build and serve the current build on a scratch port**

```bash
cd /var/www/html/project-data-strategis/frontend
npm run build
ss -lptn 'sport = :6199' 2>/dev/null | tail -1 | grep -oE 'pid=[0-9]+' | cut -d= -f2 | xargs -r kill
sleep 2
(npx next start -p 6199 > /tmp/next-6199.log 2>&1 &)
sleep 8
curl -s -o /dev/null -w "%{http_code}\n" --max-time 30 http://127.0.0.1:6199/dashboard
```

Expected: `200`.

- [ ] **Step 3: Run the spec**

Run: `PWA_BASE_URL=http://127.0.0.1:6199 npx playwright test dashboard --reporter=list`
Expected: 5 passed.

- [ ] **Step 4: Commit**

```bash
cd /var/www/html/project-data-strategis
git add frontend/e2e/dashboard.spec.ts
git commit -m "test(dashboard): cakupan e2e halaman dashboard mandiri"
```

---

### Task 7: Visual check, deploy, document

- [ ] **Step 1: Look at the page**

Take screenshots at desktop light, desktop dark and mobile against `http://127.0.0.1:6199/dashboard`, using the same approach as the landing page: wait for the splash to unmount, then capture. Confirm by eye that headline cards show a value, a unit, a delta pill and a sparkline; that regional cards say "Tersedia per kabupaten/kota"; and that no card shows a bare `0`.

- [ ] **Step 2: Regenerate the visual baseline if `/` is affected**

`/dashboard` has no baseline, so nothing to regenerate. Confirm the landing baseline still passes:

Run: `PWA_BASE_URL=http://127.0.0.1:6199 npx playwright test visual --reporter=list`
Expected: `homepage` shows no diff. `search-results` and `chat` fail against stale 2026-05-09 baselines — pre-existing, leave them.

- [ ] **Step 3: Deploy**

```bash
cd /var/www/html/project-data-strategis/frontend
npm run build && pm2 reload pds-frontend --update-env
sleep 8
for u in / /dashboard /chat /kategori /peta-tematik; do
  printf "  %-16s %s\n" "$u" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 https://malika.bpsmalut.com$u)"
done
```

Expected: all `200`.

- [ ] **Step 4: Verify in production**

Run: `PWA_BASE_URL=https://malika.bpsmalut.com npx playwright test dashboard --reporter=list`
Expected: 5 passed.

- [ ] **Step 5: Update the workspace doc and commit**

Add a Change Log row to `docs/workspace/frontend.md` recording: `/dashboard` replaced the Metabase iframe with a catalog-driven page; surface tokens moved to `src/lib/surfaceTokens.ts`; the `isDashboard` full-bleed gate removed from `(admin)/layout.tsx`; `unit_multiplier` deliberately not applied and why; `unit_id` superscript parsing; sparklines reuse `MiniSparkline` rather than recharts.

```bash
cd /var/www/html/project-data-strategis
git add docs/workspace/frontend.md
git commit -m "docs(frontend): catat halaman dashboard mandiri"
git push origin main
```

---

## Done when

- `/dashboard` renders indicator cards and contains no Metabase iframe.
- `npx tsc --noEmit` and `npx eslint` are clean; `npm run build` succeeds.
- `node --test tests/dashboardFormat.test.ts` passes.
- `npx playwright test dashboard` passes locally and against production.
- No card displays a value derived from `unit_multiplier`, and no `unit_id` renders as literal `<sup>` text.
- Adding an indicator to `data_sources` makes a card appear with no frontend change.
