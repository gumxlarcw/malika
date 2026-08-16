# Frontend PWA — Project Line

> Last updated: 2026-05-08

## Current State
- **Framework**: Next.js 16.0.10 + React 19.2.0 + Tailwind CSS v4
- **Port**: 6060 (PM2: pds-frontend)
- **Git**: Submodule (push terpisah)
- **Origin**: TailAdmin template, heavily customized

## Pages
Admin: `/` (dashboard), `/chat`, `/data`, `/brs`, `/feedback`, `/kategori`, `/kategori/[slug]`, `/notifications`, `/publikasi`, `/search`, `/settings`
Auth: `/signin`, `/signup`, `/error-404`

## Key Components
- Chat: 20+ files (`ChatPageClient.tsx` ~3600 lines, `UnifiedActivityFeed`, `DataSummaryBubble`, `ToolCallCard`, etc.)
- Layout: `AppHeader.tsx`, `AppSidebar.tsx`, `MobileBottomNav.tsx`
- PWA: ServiceWorkerRegister, InstallNudge, PushOnboarding, OfflineIndicator

## Contexts: ChatProcess, Sidebar, Theme
## Hooks: useChatRating, useVoiceInput, useLocalMessages, useAnalytics, useGoBack, useModal
## Libs: chatTransport.ts (SSE), chartDataProfiler.ts, tableRowOrdering.ts, geoIntent.ts

## Change Log
| Date | Change | Files Affected |
|---|---|---|
| 2026-08-17 | **Landing page (Claude Design handoff `2099e02b-3055-4a6b-9a33-4457345001ab`, file `MALIKA Landing.dc.html`)**: new public landing at `/beranda` in a shell-free `(landing)` route group — `(admin)` and `/` (Metabase dashboard) untouched, so promoting it to `/` later is a 3-line change (AppSidebar, MobileBottomNav, the layout's `isDashboard` check). Sections: sticky header + mobile chip nav, navy hero with typewriter ask box, 8 menu tiles wired to real routes, 4 headline figures, Peta Tematik preview, Konsultasi (4-step strip + specialist carousel + CTA), 12 kategori cards, rilis + trending, about strip, 4 BPS service cards, footer, and 4 dialogs (reservation / sign-in / notifications / officer profile — UI only, no backend). Full ID/EN dictionary in `_lib/copy.ts` with a header toggle. **Three mockup mechanisms deliberately not ported:** (1) its JS dark-mode swap of 13 CSS custom properties → `dark:` variants on the existing `.dark` class, since every colour in the design is already a `globals.css` token (`#465fff`=brand-500, `#161950`=brand-950, …); (2) its `vw<=720` React-state breakpoint → `md:` classes, removing a hydration mismatch (the one place a viewport check is unavoidable — carousel slide count — uses `useSyncExternalStore` in `_lib/useIsDesktop.ts`); (3) its runtime TopoJSON fetch from raw.githubusercontent.com → geometry pre-projected offline by `scripts/generate-landing-map.mjs` into `_lib/regionShapes.generated.ts`. That last one matters: `peta_kabko_malut.geojson` is ~11 MB / 302k coordinate pairs and exceeds Next's 2 MB data-cache ceiling, so it is re-proxied from the backend on every request — fine for `/peta-tematik` where the map is the page, not for a 420px thumbnail. Simplified (Douglas–Peucker, ε 0.05) to 4,088 points / 64 KB, no runtime fetch, guarded by an e2e regression test. Region labels come from each polygon's own `nama_kab` rather than a code→name table, so a label can never describe a different shape. Scroll reveals use framer-motion `whileInView`; because the hidden state is server-rendered, `landing-reveal` + a `<noscript>` override + an `@media print` rule keep the page readable without scripting or on paper. | (landing)/layout.tsx, (landing)/beranda/{page.tsx,_components/*.tsx,_lib/*.ts}, scripts/generate-landing-map.mjs, app/globals.css, e2e/landing-beranda.spec.ts |
| 2026-05-08 | **Kategori redesign (Claude Design handoff `K4KpeIAzPwJoXqt2YTX1UA`)**: full rewrite of `/kategori` (list) and `/kategori/[slug]` (detail) for both mobile + desktop. List = Atlas dark brand hero (gradient brand-950→brand-700, dot pattern, malika-rail-glow accent, summary panel with composition DistributionBar + per-type stat grid on lg+) + sticky filter + 4-col featured tinted cards + 3-col secondary compact cards with inline distribution bars. Detail = color-tinted hero per category (CSS custom-props + `dark:bg-[var(--cat-bg-dark)]` for class-based dark mode of dynamic colors) + donut chart on lg+ + sticky search + segmented type filter + 2-col source grid. Per-category palette + SVG icons live in private `_lib/categoryIcons.tsx` (replaces emoji icons from `src/lib/categoryStyles.ts`). Atoms (TypeBadge, DistributionBar, CompositionDonut, SectionHeader, EmptyState) in `_components/atoms.tsx`. **Structural fix in same commit**: `[slug]/page.tsx` is now an async server component that fetches `${BACKEND_URL}/categories`, finds the slug, and calls `notFound()` if missing — eliminates the duplicate client-side fetch the old detail page did, AND should return real 404 (but Next 16 quirk emits 200 anyway — see [next16_notfound_status.md](next16_notfound_status.md)). Sticky filter offset is `top-[76px] md:top-[89px]` to clear the fixed AppHeader. Pre-redesign cleanups also in this commit: dropped duplicate `\| MALIKA` from page titles (root layout's `template: "%s \| MALIKA"` was double-applying), removed no-op `force-dynamic` on the list page, removed unused `useCallback`/`useRef` imports, dropped dead `count === 1 ? "indikator" : "indikator"` ternary, replaced broken `avgScore vs binary 0/1` indicator-vs-category ordering with `hasExactIndicators` rule (indicators win when search returns exact matches). | (admin)/kategori/page.tsx, KategoriPageClient.tsx, [slug]/page.tsx, [slug]/KategoriDetailClient.tsx, [slug]/not-found.tsx, _lib/{types,typeColors,categoryIcons}.{ts,tsx}, _components/atoms.tsx |
| 2026-05-08 | Fix /data page: per-cell `value_code` superscripts (`<sup title>`) were never rendered because Phase 6.3 wired `renderCellWithCode` into orphan `DataTableClient.tsx`. Live render path is in `DataPageClient`. Inlined a wrapper that reuses local `formatCell` (preserves EXIM/numeric formatting) and adds `<sup>` from `row.value_codes`. Deleted orphan component. Added regression e2e. | DataPageClient.tsx, e2e/data-value-codes.spec.ts, DataTableClient.tsx (deleted) |
| 2026-05-08 | Extend `BPS_VALUE_CODE_LABELS` with `–` ("Data nihil atau tidak ada"), `...` ("Data belum tersedia"), `NA` ("Tidak berlaku") — codes seen in real interop data that previously fell through to the `Catatan: <code>` generic fallback. | lib/cellRender.tsx |
| 2026-03-02 | Fix 404: apiBase missing `/chat` prefix — `GET /threads` → `GET /chat/threads` | ChatPageClient.tsx:233 |
| 2026-03-02 | Fix build: install missing npm packages (clsx, @assistant-ui/react, exceljs, jspdf, jspdf-autotable, lottie-web, react-pdf, pdfjs-dist, highlight.js, driver.js, react-markdown, remark-gfm, rehype-highlight, @tanstack/react-virtual) | package.json |
| 2026-03-02 | Fix build: create 7 missing component/helper files | icons.tsx, TimingBar.tsx, DnaMetadataSection.tsx, ChatExportModal.tsx, ChatRatingModal.tsx, ChatShortcutsModal.tsx, chatHelpers.tsx |
| 2026-03-02 | Fix build: add MODEL_ALIASES + WELCOME_PROMPTS exports | chatConstants.ts |
| 2026-03-02 | Fix build: add ThinkingItem type + extend BackendMessage/MalikaUiMetaV1 | types/chat.ts |
| 2026-03-02 | Fix build: extend component props (MalikaThread, MalikaUserMessage, MalikaAssistantMessage, MalikaQuickReplies, DataSummaryBubble) | AssistantThread.tsx, DataSummaryBubble.tsx |
| 2026-03-02 | Fix build: exclude playwright.config.ts and e2e/ from tsconfig | tsconfig.json |
| 2026-03-02 | Fix splash screen: replace missing logo images with text | AppSplashScreen.tsx |
| 2026-03-02 | Initial audit & documentation | - |
