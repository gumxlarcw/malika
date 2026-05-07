# MALIKA Redesign — Handoff for Claude Design

**Two web apps to redesign. 39 pages. ~78 viewport designs (mobile + desktop per page).** With light + dark mode: ~156 frames total.

> **Important — no login UI.** The PWA Frontend is fully public; identity is anonymous via a device UUID stored in localStorage. Do **not** design signin/signup/profile pages for the PWA. Only the Admin Panel has authentication.

| App | What it is | Who uses it | URL |
|---|---|---|---|
| **PWA Frontend** | Public statistics portal + AI chat | End users (researchers, students, public, journalists) on mobile and desktop | https://malika.bpsmalut.com |
| **Admin Panel** | Operator console for content, automation, AI training, logs | BPS staff (admin + viewer roles), desktop-first | https://api-malika.bpsmalut.com/backend |

Both apps are responsive — there are no separate mobile route trees. **Every production page below needs a mobile (≤640px) and desktop (≥1024px) design.**

---

## 1. PWA Frontend — 13 pages

End-user portal. Bahasa Indonesia UI. PWA-installable. Push notifications. Dark mode supported.

**No authentication.** Personalization (chat threads, notification prefs, feedback ownership) is per-device via an anonymous UUID (`x-malika-uid` header, persisted in localStorage). There is no login, signup, or user profile concept.

### 1.1 Authenticated pages (sidebar + header shell)

Local dev URL prefix: `http://localhost:6060` · Production prefix: `https://malika.bpsmalut.com`

| # | Route | Purpose | Mobile vs desktop UX |
|---|---|---|---|
| 1 | `/` | Embedded statistics dashboard (Metabase iframe) | Iframe full-bleed; minimal divergence |
| 2 | `/chat` | MALIKA AI chat — converses with statistics knowledge base | **Major:** desktop = chat + history sidebar; mobile = chat only with history slide-over drawer |
| 3 | `/brs` | Berita Resmi Statistik (official statistics news) | Card grid: 1 col → 2 → 3 |
| 4 | `/data` | Statistical data tables — filter by year, area, search | **Major:** filter bar collapses to bottom sheet on mobile; tables scroll horizontally |
| 5 | `/feedback` | User reviews + ratings + distribution chart | Stat-card grid 2→4→6 cols; review cards 1→2→3 cols |
| 6 | `/kategori` | Browse data categories | Card grid 1→2→3→4 cols |
| 7 | `/kategori/[slug]` | Category detail — data sources + indicators | Tabs / nested cards stack on mobile |
| 8 | `/notifications` | Notification log (Publikasi, BRS, Data updates) | Vertical list; minimal divergence |
| 9 | `/publikasi` | Publication browser | Card grid |
| 10 | `/search` | Global search (data + publikasi + kategori) | Mobile virtual-keyboard handling |
| 11 | `/settings` | Push notification prefs, quiet hours, PWA install, tour restart, **device ID display / reset** | Form sections stack on mobile |

### 1.2 Error pages (no sidebar, full-width shell)

| # | Route | Purpose | Mobile vs desktop UX |
|---|---|---|---|
| 12 | `/error-404` | Explicit 404 illustration | Centered |
| 13 | `not-found` (catch-all) | Global 404 fallback | Same shell as error-404 |

---

## 2. Admin Panel — 26 pages

Operator console. Bahasa Indonesia mixed with English technical terms. Currently **desktop-first**; mobile is functional but minimal.

> **Important design decision:** the current admin is desktop-optimized — tables overflow-scroll on mobile, no card-list patterns. If first-class mobile admin is a goal, design proper mobile patterns (card lists, bottom-sheet filters, action sheets) rather than just shrinking desktop layouts. Confirm scope with project owner before starting mobile designs.

Local dev URL prefix: `http://localhost:5050/backend` · Production prefix: `https://api-malika.bpsmalut.com/backend`

### 2.1 Auth (no chrome)

| # | Route | Purpose |
|---|---|---|
| 1 | `/login` | Admin login with rate-limit lockout (5 attempts / 60s) |

### 2.2 Dashboard

| # | Route | Purpose |
|---|---|---|
| 2 | `/dashboard` | Live analytics — visitor heatmap, datasource stats, automation status, scheduler config (auto-refresh every 30s) |

### 2.3 Data Management

| # | Route | Purpose |
|---|---|---|
| 3 | `/datasources` | Datasource CRUD + bulk import + press-release create + EXIM seed + reindex |
| 4 | `/datasources/[id]` | Single datasource detail; period selection; metadata reindex |
| 5 | `/cache` | Data preview / force-refresh upstream cache |
| 6 | `/period` | Period map generator (per source / all) |
| 7 | `/merge` | Merge & save — replicate datasource into BPS cache + indicator tables |

### 2.4 Automation

| # | Route | Purpose |
|---|---|---|
| 8 | `/automation` | 200+ indicator toggle grid, batch run, scheduler, EXIM-pod filter, log viewer modal, job-progress polling |
| 9 | `/automation-notifications` | Notification routing for automation events |
| 10 | `/notifications-control` | Notification configuration |
| 11 | `/push-subscribers` | Push subscriber management |

### 2.5 AI / Knowledge

| # | Route | Purpose |
|---|---|---|
| 12 | `/knowledge` | RAG management — Datasources tab + Custom Documents tab + vector search test |
| 13 | `/knowledge-sync` | Knowledge base sync utility |
| 14 | `/chats` | Chat-log viewer — thread modal with message rendering, JSON export |
| 15 | `/feedback` | User reviews — rating distribution + feedback list |
| 16 | `/malika-analysis` | Error analysis / response-quality metrics |
| 17 | `/rag-trial` | RAG testing / trial mode |

### 2.6 Logs & Monitoring

| # | Route | Purpose |
|---|---|---|
| 18 | `/audit-logs` | Audit log with filters and stats (paginated 50/page) |
| 19 | `/fetch-logs` | API fetch / HTTP request logs |
| 20 | `/intent-stats` | Intent-classification NLP metrics |

### 2.7 Tools

| # | Route | Purpose |
|---|---|---|
| 21 | `/search-test` | Search engine testing/debug |
| 22 | `/geojson` | Leaflet GeoJSON editor — upload, download, edit properties, map preview |
| 23 | `/metabase` | Metabase embed tool — input dashboard ID → signed URL → iframe |
| 24 | `/exim-hs` | EXIM HS-code lookup (import/export trade data) |
| 25 | `/period-availability` | Datasource freshness checker |

### 2.8 Settings

| # | Route | Purpose |
|---|---|---|
| 26 | `/users` | User CRUD — role assignment (admin / viewer), self-delete protection |

---

## 3. Shared layouts (design once, reused on many pages)

### 3.1 PWA Frontend layouts

| Layout | Where it wraps | Mobile vs desktop |
|---|---|---|
| **Root** | Whole app | PWA install nudge, push permission prompt, offline indicator, splash screen |
| **Main app shell** | All pages in §1.1 | Desktop: collapsible left sidebar (290px expanded ↔ 90px icon-only) + top header. Mobile: bottom nav bar (touch devices) + drawer. **Header has no user menu** — no auth. Suggest: theme toggle + notification bell + maybe a "Settings" icon link. |
| **Full-width** | 404 / error pages | No sidebar/header — clean canvas |

### 3.2 Admin Panel layout

| Layout | Where it wraps |
|---|---|
| **AppShell** (single layout for all admin pages except `/login`) | Top header (h-56px) with sidebar toggle + user menu + theme toggle. Left sidebar 224px expanded / 64px collapsed (desktop). Mobile: drawer 288px wide. Scrollable main + fixed footer. |

Sidebar nav groups (admin):
- Overview · Data Management · Automation · Tools · AI & Analytics · Settings

---

## 4. Cross-cutting components (design once, reused everywhere)

Designing these as a system saves significant work because they appear on most pages.

### 4.1 PWA Frontend

**Navigation & shells**
- Sidebar nav item (active / hover / collapsed icon-only states)
- Mobile bottom-nav (touch only)
- Top header (search bar, notification bell, theme toggle, settings icon-link — **no user dropdown / avatar**)
- PWA install prompt
- Offline indicator banner
- Push permission nudge
- Splash screen

**Content patterns**
- Chat composer (text input + send + voice / file)
- Chat bubbles (user / assistant variants, with streaming dots, tool-use blocks, table rendering)
- BRS news card
- Publikasi card
- Kategori card
- Data table row (with year-column variants)
- Filter bar (year selector + area selector + search input)
- Star-rating control (input + display)
- Notification list-item (Publikasi / BRS / Data icon variants)

### 4.2 Admin Panel

**Navigation & shells**
- AppShell header
- Sidebar nav-item with group headings
- Mobile drawer
- Floating theme toggle (top-right)
- User dropdown

**Content patterns**
- StatCard (title + value + subtitle, variants: primary / destructive / default)
- DataTable + Pagination (every list page)
- Alert banner (error / success / warning / info)
- LoadingSpinner + Skeleton placeholder
- Generic Modal (used heavily — add/edit/detail/log flows)
- Form input pack (text, select, file upload, textarea)

---

## 5. Design tokens (existing — match these)

Both apps already have token systems. Designs should plug into these rather than invent parallel scales.

### 5.1 Admin Panel (`backend/admin/app/globals.css`)

Uses shadcn-style **OKLCH color variables**. Design system already includes:

```
Light mode tokens:
  --background       white
  --foreground       near-black
  --card             white
  --primary          near-black
  --primary-fg       near-white
  --secondary        light-gray
  --muted            light-gray
  --muted-fg         mid-gray
  --accent           light-gray
  --destructive      red
  --border           light-gray
  --ring             mid-gray
  --sidebar          off-white

Charts: --chart-1 through --chart-5 (orange, teal, deep-blue, yellow, gold)

Radii:   --radius      0.625rem  (10px)
         --radius-sm   6px
         --radius-md   8px
         --radius-lg   10px
         --radius-xl   14px

Fonts:   --font-sans   Geist Sans
         --font-mono   Geist Mono
```

Dark mode is supported — design both palettes.

### 5.2 PWA Frontend (`frontend/src/app/globals.css`)

Tailwind v4 + custom utilities. WCAG-AA contrast pass already applied (gray-400 → gray-500, gray-500 → gray-600 in light mode).

```
Focus ring:   2px solid #3b82f6 (blue-500)
Dark focus:   #60a5fa (blue-400)
Reduced-motion override: animations clamped to 0.01ms

Brand:        BPS palette (logo: blue + white + Indonesia red accents)
Logos:        public/images/logo/Logo-BPS-color.png
              public/images/logo/Logo-SE2026.png
```

---

## 6. Counts (for scoping)

| Surface | Pages | Layouts | × 2 viewports = | × 2 (light/dark) = |
|---|---:|---:|---:|---:|
| PWA Frontend | 13 | 3 | **26** | **52** |
| Admin Panel | 26 | 1 | **52** | **104** |
| **Total** | **39** | **4** | **~78 viewports** | **~156 frames** |

Plus shared component sets (§4) — design once, drop into pages.

---

## 7. Notes for the designer

- **No login UI.** PWA is public; identity is anonymous via device UUID. Don't design signin/signup/profile pages or user-account flows for the PWA. Don't put avatars or user dropdowns in the PWA header.
- **Language:** Bahasa Indonesia primary, occasional English technical terms (especially in admin)
- **Brand:** BPS (Badan Pusat Statistik — Statistics Indonesia). Conservative, government-trustworthy aesthetic. Logos and color references in `frontend/public/images/logo/`
- **Dark mode:** Both apps support it; design both light + dark for every page
- **Accessibility:** WCAG AA contrast already partially enforced — keep it. Focus rings are mandatory (visible on Tab navigation)
- **Touch targets:** Mobile bottom-nav and chat composer get used on phones — minimum 44×44px tap targets
- **Indonesian context:** Some pages reference Maluku Utara administrative areas (kab/kota — kabupaten/kota = regency/city); category names use Indonesian statistical terminology (e.g., "Berita Resmi Statistik", "Indikator", "Periode")

---

## 8. Local screenshot capture (current state)

Spin up dev servers and screenshot every route to give the designer current-state references:

```bash
# PWA frontend
cd frontend && npm run dev          # → http://localhost:6060

# Admin panel
cd backend/admin && npm run dev     # → http://localhost:5050/backend
```

Then capture each route from §1 and §2 in both viewport sizes (375×812 mobile, 1440×900 desktop).
