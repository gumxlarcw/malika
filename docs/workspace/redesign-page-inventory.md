# MALIKA — Redesign Page Inventory (for Claude Design)

**Generated:** 2026-05-04
**Scope:** Every redesignable page across the public PWA frontend and the admin panel, with mobile + desktop coverage notes.
**Source of truth:** Exhaustive `find` over `frontend/src/app/**` and `backend/admin/app/**` (Next.js App Router conventions).

---

## 0. How to use this document

- **Two viewports per page.** Both apps are 100% responsive via Tailwind — there are no separate mobile route trees. Every production page below needs a **mobile (≤640px)** and **desktop (≥1024px)** design in Claude Design.
- **Tablet (~768px)** is currently treated as "small desktop" via `md:` breakpoints; design only if the design team specifically wants tablet variants.
- **Mark up "real UX divergence" pages.** Some pages don't just reflow — they swap layouts (sidebar↔drawer, table↔card-list, split-panel↔stacked). Flagged in the **UX Divergence** column.
- **Template demo pages were removed 2026-05-04** — 13 unlinked TailAdmin starter pages were deleted from the frontend. `/profile` was kept (linked from `UserDropdown`).

---

## 1. PUBLIC PWA FRONTEND

**Path:** `frontend/` (Next.js, port 6060)
**Production URL:** `https://malika.bpsmalut.com`
**Total production pages:** 13

> **PWA has no authentication.** Verified across frontend code, backend API, live production HTTP, and deployment config. The PWA uses anonymous device-identity (`x-malika-uid` header — UUID stored in localStorage) for chat ownership and feedback isolation. There is no user account system. The signin/signup/profile pages from the original TailAdmin starter were deleted 2026-05-04.

### 1.1 Production pages (must redesign)

| # | Route | File | Purpose | UX Divergence (mobile vs desktop) |
|---|---|---|---|---|
| 1 | `/` | `(admin)/page.tsx` | Embedded Metabase dashboard (signed iframe) | Iframe full-bleed; minimal divergence |
| 2 | `/chat` | `(admin)/chat/page.tsx` | MALIKA AI chat interface | **Major:** desktop sidebar (history) ↔ mobile slide-over drawer |
| 3 | `/brs` | `(admin)/brs/page.tsx` | Berita Resmi Statistik (official statistics news) | Card grid 1↔2↔3 cols |
| 4 | `/data` | `(admin)/data/page.tsx` | Statistical data tables w/ year/geo/search filters | **Major:** filter bar collapses to bottom sheet on mobile; tables horiz-scroll |
| 5 | `/feedback` | `(admin)/feedback/page.tsx` | Star ratings + reviews + distribution | Stat-card grid 2→4→6 cols; review cards 1→2→3 cols |
| 6 | `/kategori` | `(admin)/kategori/page.tsx` | Data category browser (cards) | Grid 1→2→3→4 cols |
| 7 | `/kategori/[slug]` | `(admin)/kategori/[slug]/page.tsx` | Category detail (sources + indicators) | Tabs / nested cards stack on mobile |
| 8 | `/notifications` | `(admin)/notifications/page.tsx` | Notification log (Publikasi / BRS / Data) | Vertical list; minimal divergence |
| 9 | `/publikasi` | `(admin)/publikasi/page.tsx` | Publications listing | Card grid |
| 10 | `/search` | `(admin)/search/page.tsx` | Global search (data, publikasi, kategori) | Mobile keyboard / virtual keyboard handling |
| 11 | `/settings` | `(admin)/settings/page.tsx` | Push prefs, quiet hours, notif categories, PWA install, tour restart | Form grouping stacks |
| 12 | `/error-404` | `(full-width-pages)/(error-pages)/error-404/page.tsx` | Explicit 404 illustration | Centered illustration; minimal divergence |
| 13 | `not-found` | `app/not-found.tsx` | Global catch-all 404 fallback | Same shell as error-404 |

### 1.2 Layouts (design separately — they wrap multiple pages)

| Layout | File | Scope | Mobile/desktop concerns |
|---|---|---|---|
| Root | `app/layout.tsx` | Whole app | PWA install nudge, push permission prompt, offline indicator, splash screen |
| Admin shell | `(admin)/layout.tsx` | All main app pages (route group, NOT auth-gated) | **Sidebar (desktop) ↔ bottom-nav (mobile/touch)** + header. Sidebar collapses (`lg:ml-[290px]` ↔ `lg:ml-[90px]`) |
| Full-width | `(full-width-pages)/layout.tsx` | 404 / error pages only | Strips sidebar/header (passthrough wrapper) |
| Chat | `(admin)/chat/layout.tsx` | `/chat` only | No visual change (provides ChatProcessProvider context) |

### 1.3 Special files

| File | Purpose |
|---|---|
| `(admin)/loading.tsx` | Generic admin loading skeleton |
| `(admin)/chat/loading.tsx` | Chat-specific skeleton |
| `(admin)/feedback/loading.tsx` | Feedback skeleton |
| `(admin)/notifications/loading.tsx` | Notifications skeleton |
| `(admin)/settings/loading.tsx` | Settings skeleton |
| `app/not-found.tsx` | Global 404 |

**No `error.tsx`, `default.tsx`, or `template.tsx` files** — error handling is per-page or via Next.js defaults.

### 1.4 Template scaffolding — ALL REMOVED 2026-05-04

Two cleanup passes deleted everything that was TailAdmin starter scaffolding with no production wiring:

**Pass 1 (13 demo pages):** `/blank`, `/calendar`, `/bar-chart`, `/line-chart`, `/form-elements`, `/basic-tables`, `/alerts`, `/avatars`, `/badge`, `/buttons`, `/images`, `/modals`, `/videos`. Empty route groups pruned: `(ui-elements)`, `(others-pages)/(chart)`, `(others-pages)/(forms)`, `(others-pages)/(tables)`.

**Pass 2 (auth + profile, after deep verification):** `/signin`, `/signup`, `/profile`. Components: `SignInForm.tsx`, `SignUpForm.tsx`, `UserDropdown.tsx` (the latter was confirmed dead — zero imports anywhere). Route groups pruned: `(full-width-pages)/(auth)/`, `(admin)/(others-pages)/`, `components/auth/`.

**Verification for Pass 2** (all confirmed before delete):
- No `next-auth` / `@auth/*` / Firebase / Clerk / Supabase auth deps in `package.json`
- `SignInForm.tsx` had no `onSubmit`, `onChange`, fetch, or state handlers — pure UI
- No `middleware.ts`, no `useAuth` / `AuthProvider` references anywhere in src
- No `.env.production.local` auth vars (`NEXTAUTH_*`, `JWT_*`, etc.)
- Backend API confirmed: PWA endpoints all public (no `authMiddleware`); only Admin Panel uses `/auth/login` etc.
- Live production probe: `/signin` was returning `x-nextjs-prerender: 1` (statically cached, not auth-aware)
- Backend `User` model has only `role: "admin"` — no concept of PWA-tier users
- PWA identity is fully anonymous via `x-malika-uid` header (device UUID in localStorage)

### 1.5 API routes (NOT designed — server-only)

For reference, the PWA frontend hosts 21 server-side API routes under `frontend/src/app/api/**`. These are JSON endpoints, not pages, and are out of scope for the design redesign:

`/api/analytics/[...path]`, `/api/categories`, `/api/chat/threads`, `/api/chat/threads/[id]/{messages,stream,suggestions}`, `/api/chat-feedback`, `/api/client-error`, `/api/data-preview`, `/api/feedback`, `/api/feedback/mine`, `/api/insights`, `/api/notifications`, `/api/pdf`, `/api/periods`, `/api/publikasi`, `/api/push/subscribe`, `/api/search`, `/api/search/knowledge/[id]`, `/api/search/track`, `/api/thumbnail`.

---

## 2. ADMIN PANEL (operator/admin facing)

**Path:** `backend/admin/` (Next.js, port 5050, `basePath: /backend`)
**Production URL:** `https://api-malika.bpsmalut.com/backend`
**Total pages:** 26 (+ 1 dead `login/page.jsx` to remove)

> **Mobile reality check:** The admin panel is currently desktop-first. Mobile fallbacks are minimal (sidebar→drawer, tables→horizontal scroll). If the redesign aims for first-class mobile admin UX, treat these as greenfield mobile designs (card-list rows, action sheets, bottom-sheet filters) rather than just "make it responsive."

### 2.1 Auth (no chrome — sidebar/header stripped)

| # | Route | File | Purpose |
|---|---|---|---|
| 1 | `/login` | `app/login/page.tsx` | Admin login w/ rate limit (5 attempts / 60s lockout); auto-redirect to `/dashboard` if logged in |
| - | `/` | `app/page.tsx` | Redirect: `/backend` → `/login` (no UI to design) |

> ✅ **Stale `app/login/page.jsx` was deleted 2026-05-04** (commit pending on `feat/chat-proxy-routing`).

### 2.2 Dashboard

| # | Route | File | Purpose |
|---|---|---|---|
| 2 | `/dashboard` | `app/dashboard/page.tsx` | Live analytics (30s auto-refresh): users, page views, daily visitor heatmap, datasource stats, automation status, scheduler config |

### 2.3 Data Management

| # | Route | File | Purpose |
|---|---|---|---|
| 3 | `/datasources` | `app/datasources/page.tsx` | Datasource CRUD + bulk import + press release create + EXIM seed + reindex; filter by category/type; pagination 20 |
| 4 | `/datasources/[id]` | `app/datasources/[id]/page.tsx` | Datasource detail; period selection; reindex search metadata (with dry-run) |
| 5 | `/cache` | `app/cache/page.tsx` | Data preview/refresh: select source, keyword/period, fetch live data, force refresh upstream |
| 6 | `/period` | `app/period/page.tsx` | Period map generator (per-source / all); 6-col responsive grid |
| 7 | `/merge` | `app/merge/page.tsx` | Merge & save: select source/years, view merged table, replicate to BPS cache/indicator tables |

### 2.4 Automation

| # | Route | File | Purpose |
|---|---|---|---|
| 8 | `/automation` | `app/automation/page.tsx` | 200+ indicator toggles, mode select (daily/smart), batch run, scheduler settings, EXIM-pod filter, log modal, job-progress polling |
| 9 | `/automation-notifications` | `app/automation-notifications/page.tsx` | Notification routing for automation events |
| 10 | `/notifications-control` | `app/notifications-control/page.tsx` | Notification config dashboard |
| 11 | `/push-subscribers` | `app/push-subscribers/page.tsx` | Push notification subscriber management |

### 2.5 AI / Knowledge Base

| # | Route | File | Purpose |
|---|---|---|---|
| 12 | `/knowledge` | `app/knowledge/page.tsx` | RAG mgmt — Datasources tab + Custom Documents tab + vector search test panel; embed/clear/re-embed buttons; in-progress polling 3s |
| 13 | `/knowledge-sync` | `app/knowledge-sync/page.tsx` | Knowledge base sync utility |
| 14 | `/chats` | `app/chats/page.tsx` | Chat-log viewer; thread modal w/ malika_ui JSON block rendering (queries, candidates, tables, links, suggestions); export JSON |
| 15 | `/feedback` | `app/feedback/page.tsx` | User reviews — rating distribution chart + feedback list |
| 16 | `/malika-analysis` | `app/malika-analysis/page.tsx` | Error analysis / response-quality metrics |
| 17 | `/rag-trial` | `app/rag-trial/page.tsx` | RAG testing / trial mode |

### 2.6 Logs & Monitoring

| # | Route | File | Purpose |
|---|---|---|---|
| 18 | `/audit-logs` | `app/audit-logs/page.tsx` | Audit log w/ filters (user/action/resource/status/keyword); stats; pagination 50 |
| 19 | `/fetch-logs` | `app/fetch-logs/page.tsx` | API fetch / HTTP request logs |
| 20 | `/intent-stats` | `app/intent-stats/page.tsx` | Intent-classification NLP metrics |

### 2.7 Tools

| # | Route | File | Purpose |
|---|---|---|---|
| 21 | `/search-test` | `app/search-test/page.tsx` | Search engine testing/debug tool |
| 22 | `/geojson` | `app/geojson/page.tsx` | Leaflet GeoJSON editor (upload/download/edit properties/visual map preview) |
| 23 | `/metabase` | `app/metabase/page.tsx` | Metabase embed tool (input dashboard ID → signed URL → iframe) |
| 24 | `/exim-hs` | `app/exim-hs/page.tsx` | EXIM HS-code lookup tool |
| 25 | `/period-availability` | `app/period-availability/page.tsx` | Datasource freshness checker |

### 2.8 Settings

| # | Route | File | Purpose |
|---|---|---|---|
| 26 | `/users` | `app/users/page.tsx` | User CRUD; role assignment (admin/viewer); self-delete protection |

### 2.9 Layout

| Layout | File | Scope |
|---|---|---|
| Root | `app/layout.tsx` | All admin pages (wraps with `<AppShell>`, theme + auth contexts) |
| AppShell component | `components/AppShell.tsx` | Header (h-14) + collapsible sidebar (`w-56` / `w-16` / mobile drawer `w-72 max-w-[80vw]`) + scrollable main + fixed footer + floating theme toggle. **Bypassed on `/login`.** |

> Sidebar nav groups (defined in `components/Sidebar.tsx`):
> Overview · Data Management · Automation · Tools · AI & Analytics · Settings

### 2.10 Special files

**None.** No `error.tsx`, `loading.tsx`, `not-found.tsx`, `default.tsx`, or `template.tsx` files anywhere in `backend/admin/app/`. Loading/error handling is inline per page using `<LoadingSpinner>`, `<Skeleton>`, `<Alert>`, and `<ErrorBoundary>` components.

---

## 3. Cross-cutting components to redesign as a system

These appear across many pages — design once, reuse. Saves significant Claude Design work.

### 3.1 Public PWA (frontend/)
- **Sidebar nav** + collapsed-state icons
- **Mobile bottom-nav** (touch devices only)
- **Header** (search, notif bell, theme toggle, user menu)
- **Chat composer** + chat bubble (user/assistant variants) + streaming indicator + tool-use blocks
- **BRS card** / **publikasi card** / **kategori card** (3 distinct card patterns)
- **Data table** row + filter bar (year selector, geo selector, search input)
- **Star rating** input + display
- **Notification list-item** (with category icon)
- **PWA install prompt**, **offline indicator**, **push permission nudge**
- **Splash screen** (`AppSplashScreen.tsx`)

### 3.2 Admin (backend/admin/)
- **AppShell** (header + collapsible sidebar / mobile drawer + footer)
- **Sidebar nav-item** (active/hover/collapsed states, group headers)
- **StatCard** (title + value + subtitle, variants: primary/destructive/default)
- **DataTable + Pagination** (used on every list page)
- **Alert banner** (error/success/warning/info)
- **LoadingSpinner** + **Skeleton**
- **Generic Modal shell** (used heavily for add/edit/detail/log flows)
- **Form input pack** (text, select, file upload, textarea — no form framework, all raw)
- **Theme toggle** (floating button, top-right)

---

## 4. Counts & Claude Design workload

| Surface | Production pages | Layouts | Special pages | **Viewport designs (×2)** |
|---|---:|---:|---:|---:|
| PWA frontend | 13 | 3 + 1 ctx | 2 (404s) | **26** |
| Admin panel | 26 | 1 (AppShell) | 0 | **52** |
| **Total** | **39** | **4** | **2** | **~78** |

With light + dark mode for every page: **~156 total frames**.

---

## 5. Recommended next steps before design starts

1. ✅ ~~Triage 13 PWA template demo pages~~ — **done 2026-05-04**.
2. ✅ ~~Delete `backend/admin/app/login/page.jsx`~~ — **done 2026-05-04**.
3. ✅ ~~Resolve UserDropdown placeholder data~~ — **done 2026-05-04** (deleted; was dead code with no imports).
4. ✅ ~~Resolve PWA auth pages~~ — **done 2026-05-04** (deleted after verifying PWA has no auth; uses anonymous `x-malika-uid` device identity).
5. **Decide mobile-admin ambition level:**
   - "Responsive fallback" (current): tables horizontal-scroll, drawer for nav. Cheap to ship.
   - "First-class mobile admin": redesign list pages as card-lists, filters as bottom sheets, modals as full-screen sheets. Significantly more design work but unlocks mobile usage.
6. **Confirm scope of "AI & Knowledge" cluster** (§2.5) — `/malika-analysis`, `/rag-trial`, `/knowledge-sync` purposes are inferred from filenames; verify with the team whether they're production tools or experimental and whether they need full redesign or thin internal-tool styling.
7. **Lock down design tokens** (colors, type scale, spacing, radii, shadow elevation) **before** Claude Design page work — both apps already use Tailwind w/ custom CSS variables (`bg`, `fg`, `muted`, `border`, `ring`, `primary`); a single token system can drive both apps.

---

## Change log

| Date | Change | By |
|---|---|---|
| 2026-05-04 | Initial inventory generated from exhaustive `find` over both Next.js apps. 41 production pages + 5 layouts + 13 template demos catalogued. | Claude Code |
| 2026-05-04 | Cleanup: deleted 13 unlinked TailAdmin demo pages from frontend (`refactor/chat-module`) + stale `admin/app/login/page.jsx` from main repo (`feat/chat-proxy-routing`). `/profile` kept (linked from UserDropdown). Empty route group folders pruned. Counts updated: 41 → 42 production pages (profile reclassified as production). | Claude Code |
| 2026-05-04 | Pass 2 cleanup: after deep auth verification (PWA has no real auth — anonymous via `x-malika-uid`), deleted `/signin`, `/signup`, `/profile`, plus `SignInForm.tsx`, `SignUpForm.tsx`, `UserDropdown.tsx` (last was dead code, 0 imports). Pruned `(full-width-pages)/(auth)/`, `(admin)/(others-pages)/`, `components/auth/`. PWA scope: 16 → 13 production pages (~84 → ~78 viewport designs). | Claude Code |
