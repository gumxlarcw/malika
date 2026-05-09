# Admin Panel Code Audit & Refactoring Analysis

**Tanggal Audit:** 20 Januari 2026  
**Tujuan:** Mengidentifikasi kode yang bisa diringkas dan diperbaiki untuk memudahkan maintenance  
**Status:** Analisis (belum ada perubahan)

---

## Executive Summary

Admin panel saat ini terdiri dari **14 pages** dengan total estimasi **~10,000+ baris kode**. Terdapat banyak pola yang berulang dan bisa diextract menjadi shared components/hooks untuk mengurangi duplikasi dan meningkatkan maintainability.

### Key Findings

| Kategori | Jumlah Halaman | Estimasi Lines | Prioritas Refactor |
|----------|---------------|----------------|-------------------|
| Halaman Besar (>500 LOC) | 6 | ~7000 | 🔴 High |
| Halaman Medium (200-500 LOC) | 5 | ~1800 | 🟡 Medium |
| Halaman Kecil (<200 LOC) | 3 | ~450 | 🟢 Low |

---

## Inventory Halaman Admin

| # | Path | File | LOC | Fungsi |
|---|------|------|-----|--------|
| 1 | `/automation` | `automation/page.tsx` | 1288 | Automasi indikator + POD filter |
| 2 | `/automation-notifications` | `automation-notifications/page.tsx` | 606 | Notifikasi + scheduler settings |
| 3 | `/cache` | `cache/page.tsx` | 286 | Preview cache data |
| 4 | `/chats` | `chats/page.tsx` | 575 | Log percakapan Malika |
| 5 | `/dashboard` | `dashboard/page.jsx` | 158 | Overview statistik |
| 6 | `/datasources` | `datasources/page.tsx` | 1746 | CRUD datasources |
| 7 | `/datasources/[id]` | `datasources/[id]/page.tsx` | 211 | Detail datasource |
| 8 | `/feedback` | `feedback/page.tsx` | 222 | Feedback pengguna |
| 9 | `/geojson` | `geojson/page.tsx` | 892 | Upload/edit GeoJSON |
| 10 | `/intent-stats` | `intent-stats/page.tsx` | 163 | Live search intent stats |
| 11 | `/knowledge` | `knowledge/page.tsx` | 702 | RAG knowledge base |
| 12 | `/login` | `login/page.jsx` | 78 | Login form |
| 13 | `/merge` | `merge/page.tsx` | 272 | Merge processed cache |
| 14 | `/period` | `period/page.tsx` | 231 | Period map generator |
| 15 | `/users` | `users/page.tsx` | 65 | User management (minimal) |

---

## Pola Duplikasi yang Ditemukan

### 1. 🔴 Fungsi `getErrorMessage()` — Duplikasi di 10+ Files

**Lokasi:** Hampir semua page  
**Kode:**
```tsx
function getErrorMessage(e: unknown, fallback: string) {
  if (typeof e === "object" && e) {
    const maybeAxios = e as { response?: { status?: number; data?: { message?: unknown; error?: unknown } } };
    // ... logic sama persis
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
```

**Rekomendasi:**
- Pindahkan ke `lib/errors.ts`
- Export sebagai utility function
- **Penghematan:** ~50 baris × 10 file = **~500 baris**

---

### 2. 🔴 Fungsi `fmt()` (Date Formatter) — Duplikasi di 6+ Files

**Lokasi:** `automation`, `automation-notifications`, `geojson`, `dashboard`, `chats`, `feedback`  
**Kode:**
```tsx
function fmt(dt: string | null) {
  if (!dt) return "-";
  try {
    return new Date(dt).toLocaleString("id-ID", { timeZone: "Asia/Jayapura" });
  } catch {
    return dt;
  }
}
```

**Rekomendasi:**
- Pindahkan ke `lib/formatters.ts`
- Sertakan variasi lain: `formatDate()`, `formatDateTime()`, `formatRelativeTime()`
- **Penghematan:** ~30 baris × 6 file = **~180 baris**

---

### 3. 🔴 Data Table Pattern — Duplikasi Struktur di 12+ Tempat

**Lokasi:** Hampir semua halaman list  
**Pattern yang sama:**
```tsx
<div className="rounded-xl border border-border bg-card text-card-foreground overflow-hidden">
  <div className="w-full max-w-full overflow-x-auto overscroll-x-contain">
    <table className="min-w-full text-sm">
      <thead>
        <tr className="bg-muted">
          <th className="px-4 py-2 text-left">...</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className="border-t border-border hover:bg-muted/50">
            <td className="px-4 py-2">...</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</div>
```

**Rekomendasi:**
- Buat komponen `DataTable<T>` generic:
  ```tsx
  <DataTable
    columns={[{ key: "id", label: "ID" }, { key: "name", label: "Nama" }]}
    data={items}
    onRowClick={(item) => handleClick(item)}
    emptyMessage="Tidak ada data"
  />
  ```
- **Penghematan:** ~40 baris × 12 tempat = **~480 baris**

---

### 4. 🔴 Pagination Pattern — Duplikasi di 5+ Halaman

**Lokasi:** `chats`, `automation-notifications`, `datasources`, `feedback`, `knowledge`  
**Pattern:**
```tsx
const [page, setPage] = useState(1);
const [offset, setOffset] = useState(0);
const [limit] = useState(50);

// Dalam render:
<div className="flex items-center justify-between">
  <button onClick={() => loadData(offset - limit)} disabled={offset <= 0}>Prev</button>
  <span>offset={offset} limit={limit}</span>
  <button onClick={() => loadData(offset + limit)}>Next</button>
</div>
```

**Rekomendasi:**
- Buat hook `usePagination(initialLimit)`:
  ```tsx
  const { page, offset, limit, next, prev, canPrev, canNext, reset } = usePagination(50);
  ```
- Buat komponen `<Pagination pagination={...} onPageChange={...} />`
- **Penghematan:** ~25 baris × 5 halaman = **~125 baris**

---

### 5. 🟡 Loading/Error State Pattern — Duplikasi di Semua Halaman

**Pattern berulang:**
```tsx
const [loading, setLoading] = useState(true);
const [error, setError] = useState("");
const [success, setSuccess] = useState("");

// Dalam render:
{loading && <LoadingSpinner label="..." />}
{error && <Alert variant="error">{error}</Alert>}
{success && <Alert variant="success">{success}</Alert>}
```

**Rekomendasi:**
- Buat hook `useAsyncState()`:
  ```tsx
  const { loading, error, success, setLoading, setError, setSuccess, clearMessages } = useAsyncState();
  ```
- Buat komponen `<AsyncStateMessages loading={...} error={...} success={...} />`
- **Penghematan:** ~15 baris × 15 halaman = **~225 baris**

---

### 6. 🟡 Modal Pattern — Duplikasi di 6+ Halaman

**Lokasi:** `chats`, `datasources`, `knowledge`, `automation`  
**Pattern:**
```tsx
{modalOpen && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div className="bg-background rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col m-4">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2>Title</h2>
        <button onClick={() => setModalOpen(false)}>Tutup</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {/* content */}
      </div>
    </div>
  </div>
)}
```

**Rekomendasi:**
- Buat komponen `<Modal isOpen title onClose children />`
- **Penghematan:** ~20 baris × 6 halaman = **~120 baris**

---

### 7. 🟡 Scheduler Settings Form — Duplikasi di 2 Halaman

**Lokasi:** `automation/page.tsx`, `automation-notifications/page.tsx`  
**Kode identik untuk:**
- Load scheduler settings
- Form mode (daily/interval)
- Save scheduler settings

**Rekomendasi:**
- Extract ke komponen `<SchedulerSettingsCard target="automation|publication|mergedcache" />`
- **Penghematan:** ~100 baris

---

### 8. 🟡 InlineSpinner — Duplikasi Definisi

**Lokasi:** `automation/page.tsx` (local definition), berbeda dari `LoadingSpinner.tsx`  
**Kode:**
```tsx
function InlineSpinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">...</svg>
      {label ? <span>{label}</span> : null}
    </div>
  );
}
```

**Rekomendasi:**
- Tambahkan prop `variant="inline|block"` ke `LoadingSpinner`
- **Penghematan:** ~15 baris

---

### 9. 🟢 Type Definitions — Duplikasi Partial

**Contoh:** `SchedulerSettings` didefinisikan di:
- `automation/page.tsx`
- `automation-notifications/page.tsx`

**Rekomendasi:**
- Buat file `types/automation.ts` untuk shared types
- **Penghematan:** ~30 baris

---

### 10. 🟢 API Response Types — Bisa Lebih DRY

**Pattern:**
```tsx
type SomeResponse = {
  ok: boolean;
  data?: SomeData;
  message?: string;
};
```

**Rekomendasi:**
- Buat generic type:
  ```tsx
  type ApiResponse<T> = {
    ok: boolean;
    data?: T;
    message?: string;
  };
  ```

---

## Halaman yang Perlu Refactor Besar

### 1. `datasources/page.tsx` (1746 LOC) — 🔴 CRITICAL

**Masalah:**
- Terlalu banyak modal dalam satu file (Add, Edit, Bulk Import, Press Release)
- State terlalu banyak (30+ useState)
- Logika bulk import kompleks (~200 LOC)

**Rekomendasi Split:**
```
datasources/
├── page.tsx              (~300 LOC) - main list + orchestration
├── components/
│   ├── DatasourceTable.tsx
│   ├── AddEditModal.tsx
│   ├── BulkImportModal.tsx
│   ├── PressReleaseModal.tsx
│   └── ReindexMetaModal.tsx
├── hooks/
│   └── useDatasourceCrud.ts
└── types.ts
```

**Estimasi pengurangan:** 1746 → ~800 LOC di main page

---

### 2. `automation/page.tsx` (1288 LOC) — 🔴 HIGH

**Masalah:**
- Banyak logika untuk batch run, POD filter, scheduler
- Multiple complex modals
- ID range parser bisa extract

**Rekomendasi Split:**
```
automation/
├── page.tsx              (~400 LOC)
├── components/
│   ├── AutomationTable.tsx
│   ├── BatchRunModal.tsx
│   ├── PodFilterPanel.tsx
│   ├── SchedulerSettings.tsx
│   └── LogModal.tsx
├── hooks/
│   └── useAutomationRunner.ts
└── utils/
    └── parseIdRange.ts
```

---

### 3. `geojson/page.tsx` (892 LOC) — 🟡 MEDIUM

**Masalah:**
- Leaflet integration mixed dengan form logic
- Mapping parser inline

**Rekomendasi Split:**
```
geojson/
├── page.tsx              (~300 LOC)
├── components/
│   ├── UploadForm.tsx
│   ├── GeojsonList.tsx
│   ├── MapPreview.tsx
│   └── PropertyEditor.tsx
└── utils/
    └── mappingParser.ts
```

---

### 4. `knowledge/page.tsx` (702 LOC) — 🟡 MEDIUM

**Masalah:**
- Dua tabs (datasources + documents) dalam satu file
- Upload modal inline

**Rekomendasi Split:**
```
knowledge/
├── page.tsx              (~200 LOC) - tabs orchestration
├── components/
│   ├── DatasourcesTab.tsx
│   ├── DocumentsTab.tsx
│   ├── UploadModal.tsx
│   ├── SearchTest.tsx
│   └── StatsCards.tsx
```

---

## Komponen Baru yang Direkomendasikan

### Core Components (High Impact)

| Komponen | Kegunaan | Estimasi Penghematan |
|----------|----------|---------------------|
| `<DataTable>` | Generic table dengan sorting, pagination | 480 LOC |
| `<Modal>` | Wrapper modal standar | 120 LOC |
| `<Pagination>` | Navigasi halaman | 125 LOC |
| `<AsyncStateMessages>` | Loading/error/success display | 225 LOC |
| `<ConfirmDialog>` | Dialog konfirmasi (replace window.confirm) | 50 LOC |

### Utility Hooks

| Hook | Kegunaan | Estimasi Penghematan |
|------|----------|---------------------|
| `usePagination` | State pagination | 100 LOC |
| `useAsyncState` | Loading/error/success state | 150 LOC |
| `useAsyncAction` | Wrapper untuk async with loading | 100 LOC |
| `useConfirmDialog` | Hook untuk dialog konfirmasi | 50 LOC |

### Utilities

| Utility | Kegunaan | Estimasi Penghematan |
|---------|----------|---------------------|
| `lib/errors.ts` | `getErrorMessage()` | 500 LOC |
| `lib/formatters.ts` | Date/number formatters | 180 LOC |
| `types/api.ts` | Shared API response types | 100 LOC |

---

## Prioritas Refactoring

### Phase 1: Quick Wins (Est: 4 jam)
1. ✅ Extract `getErrorMessage()` ke `lib/errors.ts`
2. ✅ Extract `fmt()` dan formatters ke `lib/formatters.ts`
3. ✅ Buat shared types di `types/`
4. **Pengurangan:** ~780 LOC duplikasi

### Phase 2: Core Components (Est: 8 jam)
1. ✅ Buat `<DataTable>` component
2. ✅ Buat `<Modal>` component
3. ✅ Buat `<Pagination>` component
4. ✅ Buat `useAsyncState` hook
5. **Pengurangan:** ~600 LOC duplikasi

### Phase 3: Page Refactoring (Est: 16 jam)
1. Refactor `datasources/page.tsx`
2. Refactor `automation/page.tsx`
3. Refactor `geojson/page.tsx`
4. **Pengurangan:** ~1500 LOC

### Phase 4: Polish (Est: 4 jam)
1. Consistent naming conventions
2. Add JSDoc comments
3. Create component storybook (optional)

---

## Estimasi Total Pengurangan

| Kategori | Before | After | Savings |
|----------|--------|-------|---------|
| Utility duplikasi | ~780 LOC | ~80 LOC | 700 LOC |
| Component patterns | ~800 LOC | ~200 LOC | 600 LOC |
| Page refactoring | ~4500 LOC | ~2500 LOC | 2000 LOC |
| **TOTAL** | ~10000 LOC | ~6700 LOC | **~3300 LOC (33%)** |

---

## Struktur Folder Setelah Refactoring

```
backend/admin/
├── app/
│   ├── automation/
│   │   ├── page.tsx
│   │   └── components/
│   ├── datasources/
│   │   ├── page.tsx
│   │   ├── [id]/page.tsx
│   │   └── components/
│   ├── ... (other pages)
├── components/
│   ├── ui/                    # NEW: Reusable UI primitives
│   │   ├── DataTable.tsx
│   │   ├── Modal.tsx
│   │   ├── Pagination.tsx
│   │   ├── ConfirmDialog.tsx
│   │   └── AsyncStateMessages.tsx
│   ├── Alert.tsx              # Existing
│   ├── LoadingSpinner.tsx     # Existing (enhanced)
│   ├── StatCard.tsx           # Existing
│   └── ...
├── hooks/                     # NEW
│   ├── useAsyncState.ts
│   ├── usePagination.ts
│   └── useConfirmDialog.ts
├── lib/
│   ├── axios.js               # Existing
│   ├── utils.ts               # Existing
│   ├── errors.ts              # NEW
│   └── formatters.ts          # NEW
└── types/                     # NEW
    ├── api.ts
    ├── automation.ts
    └── datasource.ts
```

---

## Catatan Tambahan

### Hal yang Sudah Baik
1. ✅ Sudah ada `RequireAuth` wrapper untuk protected pages
2. ✅ Sudah ada shared `Alert`, `LoadingSpinner`, `StatCard`
3. ✅ Axios instance sudah centralized di `lib/axios.js`
4. ✅ Theme provider sudah ada
5. ✅ AppShell dengan sidebar/topbar sudah bagus

### Hal yang Perlu Dipertimbangkan
1. ⚠️ Beberapa halaman masih JSX (`dashboard`, `login`) — bisa dimigrate ke TSX
2. ⚠️ Tidak ada unit tests untuk components
3. ⚠️ Tidak ada Storybook untuk visual testing
4. ⚠️ `window.confirm()` digunakan — sebaiknya replace dengan custom dialog

---

## Kesimpulan

Admin panel saat ini functional tapi memiliki banyak duplikasi kode yang menyulitkan maintenance. Dengan refactoring bertahap, kita bisa mengurangi ~33% kode sambil meningkatkan:

1. **Maintainability** — Perubahan di satu tempat propagate otomatis
2. **Consistency** — UI behavior sama di semua halaman
3. **Developer Experience** — Lebih mudah menambah fitur baru
4. **Testability** — Components kecil lebih mudah ditest

**Rekomendasi:** Mulai dari Phase 1 (Quick Wins) karena low-risk dan immediate benefit.

---

## Functional Gap Analysis (Backend vs Admin UI)

**Tanggal Analisis:** 20 Januari 2026

### 🔴 High Priority Gaps (Backend ada, Admin belum)

| # | Gap | Backend Endpoint | Admin Status | Priority |
|---|-----|------------------|--------------|----------|
| 1 | **User Management** | `POST /auth/register`, `GET /auth/users`, `DELETE /auth/users/:id` | ✅ IMPLEMENTED | 🔴 HIGH |
| 2 | **Fetch Logs Viewer** | `GET /logs/fetch`, `GET /logs/fetch/stats`, `DELETE /logs/fetch` | ✅ IMPLEMENTED | 🔴 HIGH |
| 3 | **Search Testing** | `GET /search/intent`, `GET /search/datasource`, `GET /search/knowledge` | ✅ IMPLEMENTED | 🔴 HIGH |
| 4 | **Notifications Controls** | `POST /notifications/clear`, `POST /notifications/test-push` | ✅ IMPLEMENTED | 🟡 MEDIUM |

### 🟡 Medium Priority Gaps

| # | Gap | Backend Endpoint | Admin Status |
|---|-----|------------------|--------------|
| 5 | **Chat Export** | `GET /chat/admin/export/owner/:ownerId` | ✅ IMPLEMENTED (Export button) |
| 6 | **Push Subscribers** | `push_subscriptions` table | ✅ IMPLEMENTED |
| 7 | **Hard Delete Datasource** | `DELETE /datasource/:id/hard` | ✅ ALREADY EXISTS (hardRemove178) |
| 8 | **Cache Refresh** | `POST /cache/refresh` | ✅ IMPLEMENTED (Force Refresh button) |

### 🟢 Low Priority Gaps

| # | Gap | Backend Endpoint | Admin Status |
|---|-----|------------------|--------------|
| 9 | **EXIM HS Code Lookup** | `GET /exim/hs2` | ✅ IMPLEMENTED |
| 10 | **Period Availability** | `GET /period/:id`, `GET /period/:id/months` | ✅ IMPLEMENTED |
| 11 | **Metabase Embed** | `GET /metabase/embed-dashboard/:id` | ✅ IMPLEMENTED |

---

## Progress Tracking

### ✅ Phase 1: Quick Wins (COMPLETED - 20 Jan 2026)
- [x] Extract `getErrorMessage()` ke `lib/errors.ts`
- [x] Extract `fmt()` dan formatters ke `lib/formatters.ts`
- [x] Update 12 pages untuk menggunakan centralized utilities
- [x] Fix Next.js 16 middleware deprecation
- [x] PM2 cleanup (hapus dev processes)

### ✅ Phase 1.5: Page Audit (COMPLETED - 20 Jan 2026)
- [x] Audit semua 17 pages (modals, features, functionality)
- [x] Identifikasi dan hapus duplicate page (`/datasources/[id]/processed`)
- [x] UI/UX: Sidebar dengan icons dan grouping
- [x] UI/UX: Layout metadata fix
- [x] UI/UX: Dashboard imports refactor

### 🔄 Phase 1.7: Functional Gaps (COMPLETED - 20 Jan 2026)
- [x] User Management Enhancement (list + create + delete users)
- [x] Fetch Logs Viewer page (`/fetch-logs`)
- [x] Search Test Console page (`/search-test`)
- [x] Update Sidebar dengan menu baru
- [x] Backend routes: `GET/DELETE /auth/users`, `/logs/*`

### ✅ Phase 1.8: Complete Functional Gaps (COMPLETED - 21 Jan 2026)
- [x] Notifications Controls page (`/notifications-control`)
  - Clear all notifications / clear by type
  - Test push notification
  - Emit latest merged update
  - Rebroadcast failed push
- [x] Push Subscribers page (`/push-subscribers`)
  - View all push subscriptions with pagination
  - Delete individual subscriptions
  - Parse user agent and endpoint info
  - Backend routes: `GET/DELETE /push/subscriptions`
- [x] Chat Export enhancement (`/chats`)
  - Added Export button per owner_id
  - Downloads JSON export via backend
- [x] Cache Force Refresh (`/cache`)
  - Added Force Refresh button alongside Preview
  - Shows success/refreshing states
- [x] EXIM HS Code Lookup page (`/exim-hs`)
  - Search HS codes by number or description
  - Quick reference section for common codes
- [x] Period Availability page (`/period-availability`)
  - Fetch available years from BPS API
  - Click year to see available months
  - Visual month grid display
- [x] Metabase Embed page (`/metabase`)
  - Load dashboard by ID
  - Iframe embed with proper styling
  - Quick access buttons for common dashboards
- [x] Update Sidebar with 5 new menu items

### ✅ Phase 2: Core Components (COMPLETED - 21 Jan 2026)
- [x] Buat `<DataTable>` component (`components/ui/DataTable.tsx`)
  - Generic table with typed columns
  - Loading skeleton state
  - Empty state handling
  - Row click support
  - Sticky header option
- [x] Buat `<Modal>` component (`components/ui/Modal.tsx`)
  - Multiple sizes (sm, md, lg, xl, full)
  - Close on ESC and overlay click
  - Header/body/footer layout
  - `<ConfirmModal>` convenience wrapper
- [x] Buat `<Pagination>` component (`components/ui/Pagination.tsx`)
  - Page-based pagination
  - `<OffsetPagination>` for offset/limit APIs
  - First/last page buttons
  - Item range info display
- [x] Buat `useAsyncState` hook (`hooks/useAsyncState.ts`)
  - Loading/error/success state management
  - Helper methods: startLoading, finishWithError, finishWithSuccess
  - `useAsyncAction` wrapper for async functions
- [x] Buat `usePagination` hook (`hooks/usePagination.ts`)
  - Page-based with computed offset
  - `useOffsetPagination` for offset/limit APIs
- [x] Buat `<AsyncStateMessages>` component (`components/ui/AsyncStateMessages.tsx`)
- [x] Refactored `/push-subscribers` and `/fetch-logs` to use new components
  - Reduced ~100 LOC per page
  - Replaced `window.confirm()` with `<ConfirmModal>`

### ⏳ Phase 3: Page Refactoring (PENDING)
- [ ] Refactor `datasources/page.tsx` (split components)
- [ ] Refactor `automation/page.tsx` (split components)
- [ ] Refactor `geojson/page.tsx` (split components)

---

## Checkpoints

| Checkpoint | Date | Location | Contents |
|------------|------|----------|----------|
| Phase 1 Refactor | 2026-01-20 | `backups/2026-01-20-admin-refactor/` | Original files sebelum utility extraction |
| Phase 1.5 UI/UX | 2026-01-20 | `backups/2026-01-20-admin-uiux/` | Sidebar, Layout, Dashboard, deleted page |
| Phase 1.7 Functional | 2026-01-20 | N/A (new features) | Users, Fetch Logs, Search Test pages + backend routes |
| Phase 1.8 Complete | 2026-01-21 | N/A (new features) | All functional gaps implemented (see below) |
| Phase 2 Components | 2026-01-21 | `components/ui/`, `hooks/` | DataTable, Modal, Pagination, useAsyncState, usePagination |

---

## New Pages Added (Phase 1.7)

| Page | Path | Features |
|------|------|----------|
| **Users** | `/users` | List all users, add user, delete user (with role badges) |
| **Fetch Logs** | `/fetch-logs` | View fetch logs, stats cards, filter by source/status, clear old logs |
| **Search Test** | `/search-test` | Test datasource search, intent parsing, knowledge base search |

## New Pages Added (Phase 1.8)

| Page | Path | Features |
|------|------|----------|
| **Notifications Control** | `/notifications-control` | Clear notifs, test push, emit latest, rebroadcast failed |
| **Push Subscribers** | `/push-subscribers` | View/delete push subscriptions, pagination, user agent parsing |
| **EXIM HS Lookup** | `/exim-hs` | Search HS codes by number/description, quick reference |
| **Period Availability** | `/period-availability` | Check available years/months from BPS API |
| **Metabase Embed** | `/metabase` | Embed Metabase dashboards by ID |

## Enhanced Pages (Phase 1.8)

| Page | Path | Enhancement |
|------|------|-------------|
| **Chats** | `/chats` | Added Export button per owner_id |
| **Cache** | `/cache` | Added Force Refresh button with success states |

## New Backend Routes Added

| Route | Method | Description |
|-------|--------|-------------|
| `/auth/users` | GET | List all users (admin only) |
| `/auth/users/:id` | DELETE | Delete user (admin only, cannot self-delete) |
| `/logs/fetch` | GET | List fetch logs with pagination and filters |
| `/logs/fetch/stats` | GET | Fetch log statistics |
| `/logs/fetch` | DELETE | Clear old logs, keep last N |
| `/push/subscriptions` | GET | List push subscriptions with pagination |
| `/push/subscriptions/:id` | DELETE | Delete push subscription |
| `/push/subscriptions/stats` | GET | Push subscription statistics |
