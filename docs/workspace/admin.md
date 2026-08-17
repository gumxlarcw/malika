# Admin Panel — Project Line

> Last updated: 2026-05-09

## Current State
- **Framework**: Next.js 16.1.3 + React 19.2.1 + TypeScript 5
- **Port**: 5050 (PM2: pds-admin)
- **basePath**: `/backend` → semua route di `api-malika.bpsmalut.com/backend/*`
- **Output**: standalone

## Pages (28 total)
Core: `/dashboard`, `/datasources`, `/datasources/[id]`, `/cache`, `/chats`, `/knowledge`, `/users`
Automation: `/automation`, `/knowledge-sync`, `/automation-notifications`, `/notifications-control`, `/push-subscribers`
AI: `/feedback`, `/rag-trial`, `/malika-analysis`
Tools: `/webapi-bps-status`, `/search-test`, `/intent-stats`, `/fetch-logs`, `/audit-logs`, `/geojson`, `/exim-hs`, `/metabase`, `/period`, `/period-availability`, `/merge`

## State Management
- Zustand (`lib/store/useUiStore`): sidebar, table density, filters
- React Query (`@tanstack/react-query`): server state (staleTime 30s)
- No global form library — pages use plain `useState` + the centralized `lib/axios` client

## Key Components
- `AppShell.tsx` — Cmd+K, G-chord, wraps content in `ErrorBoundary`
- `Sidebar.tsx` — 6 groups
- `AuthProvider.tsx`, `ThemeProvider.tsx`
- `RequireAuth.tsx` — gates 26/28 pages
- `ErrorBoundary.tsx` — fallback UI when a page render throws
- `ui/Modal.tsx` — has focus trap (`useFocusTrap`) and `role="dialog"`
- `DataTable.tsx`, `Alert.tsx`, `Skeleton.tsx`, `LoadingSpinner.tsx`, `StatCard.tsx`

## Shared Utilities
- `lib/axios.ts` — central axios client; CSRF auto-attach, 401 redirect, 403-CSRF cookie clear, baseURL sanitize (`sanitizeBaseUrl`)
- `lib/errors.ts` — `getErrorMessage`, `isHttpError`, `getErrorCode`
- `lib/formatters.ts` — `formatDateTime`/`fmt`, `formatDate`, `formatTime`, `formatBytes`, `formatNumber`, `formatPercent`, `truncate`, `maxDate`, `clampPercent`
- `lib/sanitize.ts`
- `hooks/useAsyncState`, `hooks/usePagination`, `hooks/useFocusTrap`

## Dependencies
axios · @tanstack/react-query · @tanstack/react-table · zustand · lucide-react · leaflet · react-leaflet (legacy peer w/ React 19) · html2canvas-pro (Tailwind 4 oklch-safe)

## Tests
Vitest + React Testing Library + jsdom. Run with `npm test`. Coverage focused on `lib/` and `components/ui/Modal`, `components/ErrorBoundary`, `hooks/useFocusTrap`. Page-level tests not yet written.

## Change Log
| Date | Change | Files Affected |
|---|---|---|
| 2026-08-17 | **Halaman Kurasi Dashboard** (`/backend/dashboard-curation`, grup Overview di sidebar). Memilih indikator untuk strip "Angka utama" dan mengatur urutan seksi kategori pada `/dashboard` PWA, lewat `GET`/`PUT /dashboard/admin/curation`. Hanya indikator berbentuk `province` yang bisa dipilih — indikator lain tidak punya satu angka tingkat provinsi untuk ditampilkan. Kontrol sengaja sederhana: checkbox dan tombol naik/turun, bukan drag-and-drop, agar tidak menambah dependensi dan tetap bisa dipakai lewat papan ketik. Halaman dibungkus `RequireAuth`, dan endpointnya di backend dibatasi `requireAdmin`. | `app/dashboard-curation/page.tsx`, `components/Sidebar.tsx` |
| 2026-03-02 | Initial audit & documentation | - |
| 2026-05-09 | Post-audit refresh: page count corrected (27, not 35+); ErrorBoundary added; Modal focus trap; html2canvas → html2canvas-pro; lib/axios migrated to TS; Vitest + RTL test infrastructure added | per `2026-05-09-admin-panel-audit-fixes` plan |
| 2026-05-24 | New page /webapi-bps-status: WebAPI BPS health probe + dashboard | spec 2026-05-24 |
