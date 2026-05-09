---
name: Kategori MALIKA design implementation (Claude Design handoff)
description: How the /kategori list + /kategori/[slug] detail redesign from Claude Design (handoff K4KpeIAzPwJoXqt2YTX1UA) was structured and shipped 2026-05-08.
type: project
originSessionId: d0319318-3ffd-4ede-bd35-ec8a8064dbe8
---
A Claude Design handoff bundle (`api.anthropic.com/v1/design/h/K4KpeIAzPwJoXqt2YTX1UA`) shipped HTML/JSX prototypes for the Kategori redesign — three mobile variants (Editorial / Atlas / Indeks) plus a desktop "best of three" synthesis. The user picked the synthesis aesthetic for both mobile + desktop ("Decide for me" pattern in chat).

**Why:** the user asked to fetch + read + implement the design for both viewports.

**How to apply:**
- All kategori-private code lives under `frontend/src/app/(admin)/kategori/` with two underscore-prefixed colocation folders: `_lib/` (types, palette, icon registry) and `_components/` (atoms). These are private by Next.js convention — no route is created. Don't move them to `src/lib/` or `src/components/` unless they're used elsewhere.
- **Per-category palette + SVG icons** are in `_lib/categoryIcons.tsx` via `getCategoryDesign(name)`. This is parallel to (NOT replacing) `src/lib/categoryStyles.ts`, which still uses emoji + Tailwind class strings and serves the search/insights components. Both maps are regex-keyed by category name; keep the rules in sync if BPS adds a new topic.
- **Per-category dark-mode tinting** uses CSS custom properties + Tailwind arbitrary values: `style={{ '--cat-bg-light': design.light.bg, '--cat-bg-dark': design.dark.bg }} className="bg-[var(--cat-bg-light)] dark:bg-[var(--cat-bg-dark)]"`. This is the only clean way to make dynamic colors respect class-based dark mode in Tailwind v4. Use the same pattern if you add another color-tinted surface.
- **Type palettes** (Dinamis/Interop/EXIM/Statis) have two parallel sources: `_lib/typeColors.ts` exports raw hex (used by inline SVG slices in `CompositionDonut` and forced-dark contexts), while `_components/atoms.tsx` uses Tailwind class maps for `auto` mode. The `palette: "auto" | "dark"` prop on TypeBadge / DistributionBar / CompositionDonut switches between them — use `dark` when the surface is always-dark regardless of theme (the brand-950 hero), otherwise `auto`.
- **Hero patterns**: list page uses always-dark brand band (`bg-brand-950 → brand-700` gradient + dot pattern + `malika-rail-glow` from globals.css). Detail page uses category-tinted band that flips with dark mode. Both are full-bleed via `-mx-4 md:-mx-6` to escape `<main>`'s padding.
- **Sticky filter offset** is `top-[76px] md:top-[89px]`, matching `(admin)/layout.tsx`'s `pt-[76px] md:pt-[89px]` (which clears the fixed `AppHeader`). The chat page uses `top-[60px]` because chat has different layout padding — do NOT copy chat's values for non-chat pages.
- **Donut centerpiece** in `CompositionDonut`: pure prefix-sum to compute slice offsets (no closure-mutating `let offset = 0` accumulator — that triggers `react-hooks/immutability` lint). The SVG is rotated `-90deg` so slices start at 12 o'clock going clockwise.
- **Indicator-vs-category ordering** when search is active: indicators win only when `data.exact.datasources` is non-empty. This replaced an earlier broken `avgScore > binary 0/1` comparison.

**Structural fix folded into the same commit:**
- `[slug]/page.tsx` is now an `async` server component that fetches `${BACKEND_URL || "http://127.0.0.1:5000"}/categories`, finds the slug, calls `notFound()` if missing, and passes the `Category` as a prop. The client component used to re-fetch the entire categories list on mount and filter client-side — duplicate fetch + no real 404 status.
- Note the 404 status caveat: Next 16 emits 200 with the not-found UI body even though `notFound()` is called — see [next16_notfound_status.md](next16_notfound_status.md).

**What was NOT implemented from the design** (deliberate scope cut):
- The MALIKA app shell (sidebar + topbar) from `kategori-desktop.jsx` was skipped — the existing `(admin)/layout.tsx` already provides this chrome via `AppSidebar` + `AppHeader` + `MobileBottomNav`. Re-implementing the design's shell would have duplicated UI.
- The per-source-type colored stripe on detail-page source rows uses 1×9 vertical bars (`bg-blue-500 dark:bg-blue-400` etc.) — the design used 4×30 thicker pills; current is more compact for 2-col grid.

Recovery path: if anything regresses, the pre-redesign code is in `*.backup` siblings (CLAUDE.md workflow), but those are git-ignored from the malika-fresh repo via the sync script's `--exclude='*.backup'` rule.
