---
name: Data MALIKA design implementation (Claude Design handoff)
description: How the /data?source_id=… viewer redesign from Claude Design (handoff RWEMGilAN2OAn_p79cpG5g) was structured, plus the four regressions an audit caught and the fixes shipped on PR #1.
type: project
originSessionId: d0319318-3ffd-4ede-bd35-ec8a8064dbe8
---
A Claude Design handoff bundle (`api.anthropic.com/v1/design/h/RWEMGilAN2OAn_p79cpG5g`) shipped HTML/JSX prototypes for `/data` viewer redesign — **one direction** (no variants), already a desktop+mobile synthesis. Initial implementation in commit `54cc9e9` (2026-05-09). Two follow-up audits found regressions:
- **PR #1** (`fix/data-audit-regressions` → main): B1/B2/I1/I2 — smarter `aggregateColumn` picker, hoisted `toNumberLoose`, dark-mode shadow class, shared `backendBaseUrl()` helper.
- **PR #3** (`fix/data-audit-second-pass` → stacked on PR #1): C1/C2/C3/C4 — `COLUMN_BLOCKLIST` to drop the backend's `value_codes` metadata column, `buildRowSeries` aligned with `aggregateColumn` (consistency invariant), `pct` guarded against divide-by-zero (rendered as null/em-dash when `firstValid === 0`), `validIdx` filters NaN only (genuine zeros are real data).

**Why:** the user asked to fetch + read + implement the design for both viewports, then later asked for an audit and fixes.

**How to apply:**
- All data-private code lives under `frontend/src/app/(admin)/data/` with two underscore-prefixed colocation folders: `_lib/` (palette, value-code style, parent-category resolver) and `_components/` (atoms + Hero + FilterBar + DataTable + StuckContextBar + ChartCard + InterpretationCard).
- **Source-type palette** (`_lib/sourceTypePalette.ts`) maps Dinamis/Interop/EXIM/Statis to `{label, bar, barDark, light: {bg, text, dot, ring}, dark: {bg, text, dot, ring}}`. The hero pill, filter-bar primary button (Unduh), chart fills, and tooltip accents all source from this. Don't introduce parallel hex maps elsewhere.
- **Per-category tinting** (the parent category, e.g. green for Pertanian) reuses the kategori folder's `_lib/categoryIcons.tsx::getCategoryDesign(name)`. Cross-segment import is intentional — keeping a single source of truth for category palette/icons across both `/kategori` and `/data`.
- **Class-based dark mode for dynamic colors**: same CSS-vars + Tailwind arbitrary-value pattern as the kategori redesign — `style={{ '--cat-bg-light': …, '--cat-bg-dark': … }} className="bg-[var(--cat-bg-light)] dark:bg-[var(--cat-bg-dark)]"`. Already documented in [kategori_malika_design.md](kategori_malika_design.md); applies identically here.
- **Hero composition**: title + meta strip + breadcrumb on the left; on `lg+`, a 260px-wide sparkline summary card on the right showing Total provinsi + delta% + 7-year trend line. Mobile collapses to an inline sparkline next to the meta.
- **Sticky-stack layout**: AppHeader (fixed, 76/89px) → StuckContextBar (sticky `top-[76px] md:top-[89px]`, slides in via opacity transition once user scrolls past hero) → FilterBar (sticky `top-[120px] md:top-[133px]`, right below). When StuckContextBar is hidden via `display:none` from scroll state, the gap is absorbed by hero scrolling underneath.
- **Year switcher**: on `lg+`, a timeline-style scrubber with brand-tinted progress + dot-per-year. On smaller, a horizontal pill row. Both call the same `setSelectedYear`.
- **DataTable architecture**:
  - Sticky first column on horizontal scroll (geographic anchor) + sticky header on vertical scroll (column anchor).
  - Per-row sparkline column with delta% (emerald up / rose down).
  - Cell hover tooltip (`onMouseMove` mouse-anchored, no portal) with provenance + value-code definition.
  - Provincial-total row gets a source-type-colored accent rail. Heuristic: `isProvincialTotalRow` matches `"maluku utara" | "indonesia" | contains("total"|"provinsi")` — first column value, case-insensitive.
  - Right-edge fade so users sense more cols when scrollable.
  - Value codes render as **amber chips** (high contrast, much better than the old gray sub).
- **Hero aggregateColumn picker** (post-audit fix): scores each non-first column by parseable-number coverage across all years. Tie-breaker: rightmost. Necessary because wide multi-commodity tables (e.g. source 368 = "Produksi Tanaman Sayuran" with 25 fruit columns) often have a sparse column at the alphabetic end. The picker prefers density over position.
- **`buildRowSeries` MUST use `aggregateColumn`** — not `lastDataCol`. PR #1 migrated `totalSeries` but missed `buildRowSeries`; PR #3 fixed the inconsistency. If you add a third sparkline-series builder, route it through `aggregateColumn` too. The hero summary and per-row sparklines must agree on which column is "the data column", or readers see contradictory shapes.
- **`COLUMN_BLOCKLIST = new Set(["value_codes"])`** at module scope filters out metadata keys the backend leaks into `data.columns`. Verified leak on sources 383 (Padi/Interop) and 211 (Inflasi/Dynamic). If new metadata keys appear (e.g. `last_update_per_cell`), extend the Set — don't try to fix the backend first; this is a defensive frontend layer.
- **Divide-by-zero guard on delta %**: every place that computes `((last - first) / Math.abs(first)) * 100` MUST first check `first !== 0`. A kabupaten with zero production in its first year is real data; the trend % renders as em-dash, not "Infinity%". Same pattern applied in Hero (summary) and DataTable (per-row trend cell).
- **`validIdx` filter filters NaN only** — `if (Number.isFinite(v))`. Don't add `&& v !== 0` — that silently drops genuine zero data points and shifts the sparkline start year, mis-labelling it.
- **`toNumberLoose` is hoisted** at module scope, used by both `formatNumberId` and the sparkline-series builders. Don't reintroduce the closure version — round-tripping via the locale formatter drops value-code-suffixed numbers like `"1234 r"` to NaN.
- **Backend env vars**: always use `backendBaseUrl()` from `src/lib/backendBaseUrl.ts` for any server-side fetch. The 6-key priority chain (`BACKEND_BASE_URL` → `BACKEND_INTERNAL_API_URL` → `INTERNAL_BACKEND_API_URL` → `BACKEND_API_URL` → `NEXT_PUBLIC_BACKEND_API_URL` → `BACKEND_URL` → fallback `127.0.0.1:5000`) is the canonical order — drift will silently break container deployments.

**Wrappers around existing components** (don't redesign these):
- `ChartCard.tsx` wraps `@/components/search/SearchInsightsChart` — only adds card chrome (header strip + source-type-tinted year pill + footer with publication date). Internal chart logic, axis layout, "Bar/Tren/Peta" toggles all stay in the existing component.
- `InterpretationCard.tsx` wraps `@/components/search/InterpretationPanel` — only adds the title bar with source-type-tinted icon avatar + the streaming pulse glow via `.malika-rail-glow` on the body. Streaming behaviour, error states, content all come from the existing component.
- See [insights_template_mode_error.md](insights_template_mode_error.md) for the pre-existing `/api/insights` wiring issue surfaced during audit.

**Server-side parent-category resolution** in `page.tsx`:
- Added during initial impl: parallel-fetched `/categories` server-side, scanned for the source's parent. Lets the hero render category chip + back link without a second client fetch.
- Costs one extra HTTP call per page load. Memo'd in production by Next's `cache: "no-store"` semantics — i.e. NOT cached, paid every request. Acceptable for a leaf page.

**EXIM-specific behaviour preserved**:
- `eximColumnLabel` + `eximCellValue` rename `pod`/`ctr`/`kodehs`/`value`/`netweight` to user-facing labels and resolve "all"/"-" placeholders to `"Semua Pelabuhan"` etc.
- `detectEximModeFromName` toggles "Negara Asal" vs "Negara Tujuan" on the `ctr` column based on whether the indikator name contains "impor" or "ekspor".
- The `aggregateColumn` picker handles EXIM data fine because numeric `value` and `netweight` columns score high.

**What was NOT redesigned** (deliberate scope cut, called out in the design brief):
- The app shell (sidebar / topbar / mobile bottom nav) — provided by `(admin)/layout.tsx`, untouched.
- The download handlers (Excel/CSV/PDF/JSON) and print — only the entry-point UI changed; handlers preserved verbatim. Print rewritten with `createElement`/`textContent` (no inline-DOM-string injection — XSS-safer).
- The InterpretationPanel + SearchInsightsChart internals.

Recovery path: if anything regresses, the pre-redesign code is in `*.backup` siblings (CLAUDE.md workflow), git-ignored from the repo via `.scripts/sync-from-production.sh`.
