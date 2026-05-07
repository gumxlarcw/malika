# Admin Panel — Project Line

> Last updated: 2026-03-02

## Current State
- **Framework**: Next.js 16.1.3 + React 19.2.1 + TypeScript 5
- **Port**: 5050 (PM2: pds-admin)
- **basePath**: `/backend` → semua route di `api-malika.bpsmalut.com/backend/*`
- **Output**: standalone

## Pages (35+)
Core: `/dashboard`, `/datasources`, `/datasources/[id]`, `/cache`, `/chats`, `/knowledge`, `/users`
Automation: `/automation`, `/knowledge-sync`, `/automation-notifications`, `/notifications-control`, `/push-subscribers`
AI: `/feedback`, `/rag-trial`, `/malika-analysis`
Tools: `/search-test`, `/intent-stats`, `/fetch-logs`, `/audit-logs`, `/geojson`, `/exim-hs`, `/metabase`, `/period`, `/period-availability`, `/merge`

## State Management
- Zustand (`useUiStore`): sidebar, table density, filters
- React Query: server state (staleTime 30s)
- react-hook-form + zod: forms

## Key Components
- `AppShell.tsx` (Cmd+K, G-chord), `Sidebar.tsx` (6 groups), `AuthProvider.tsx`, `ThemeProvider.tsx`
- `DataTable.tsx`, `Toast.tsx`, `GlobalSearchDialog.tsx`, `ErrorBoundary.tsx`

## Dependencies
axios, @tanstack/react-query, @tanstack/react-table, zustand, lucide-react, leaflet, xlsx

## Change Log
| Date | Change | Files Affected |
|---|---|---|
| 2026-03-02 | Initial audit & documentation | - |
