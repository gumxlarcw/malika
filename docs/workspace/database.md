# Database — Project Line

> Last updated: 2026-03-02

## Connections
- **Primary**: `project_data_strategis` (localhost, root/17Agustus)
- **Replica**: `data_bps` (read-only, 316+ tables)
- **ORM**: Sequelize 6.37.7
- **Pool**: max 20, min 5, acquire 30s, idle 10s, slow query 100ms

## Models (26 — backend/src/models/)
User, DataSource, DataPeriod, ProcessedCache, MergedCache, FetchLog,
ChatThread, ChatMessage, ChatFeedback, ChatMessageFlag, ChatErrorPattern,
KnowledgeBase, DataSourceSearchTerm, SearchStat, Notification,
PushSubscription, PushSendLog, AutomationConfig, AutomationRunLog,
AdminAuditLog, EximPodFilter, IndexedBrsPublikasi, UserMemory,
AppSetting, DnaCache, index.js

## data_bps Tables
- 310 `indikator_*` tables (157 dynamic, 150 interop, 1 static, 2 exim)
- `kodehs_indd` (HS2 lookup)
- `data_merged_cache`
- 4 `pressrelease_kw_*` tables

## Auto-Migrations (server.js)
- `ensureDataSourceTypeEnumSupportsAllKnownTypes()`
- `ensureDataSourceHasAliasesColumn()`
- `ensureAppSettingsTableExists()`

## Per-cell BPS flags (`indikator_NNN.value_code`)
- Column: `value_code VARCHAR(8) NULL` on every `indikator_NNN` table (added by `ensureIndicatorTable`).
- Source: `row.variables[colId].value_code` from BPS interop API → `interop.processor` emits `row.value_codes = { [metricKey]: code }` → `replicateMergedToIndicatorTableBps` writes one column per (kode_wilayah, metric_key, dim_key) row.
- Read shape: `indicatorTableGenericRead.service` attaches `row.value_codes = { [metricKey]: code }` sidecar on each grouped output row.
- Frontend: `lib/cellRender.tsx` `renderCellWithCode` consumes the sidecar and emits `<sup title="...">code</sup>` next to the value. `BPS_VALUE_CODE_LABELS` maps known codes (`r`, `*`, `**`, `***`, `e`, `p`, `x`).
- **Render call sites**: `app/(admin)/data/DataTableClient.tsx` (data page) and `components/chat/ChatTableModal.tsx` (chat result modal — both virtualized and non-virtualized branches).
- **EXIM is excluded**: `indicatorTableRead.service` aggregates with SUM, where per-cell codes have no meaning.
- **Multi-source chat preview is excluded**: `streaming/dataPreview.service.js` builds merged rows fresh from looked-up values; per-cell codes from source rows have no joined cell to attach to.

## Change Log
| Date | Change | Files Affected |
|---|---|---|
| 2026-03-02 | Initial audit & documentation | - |
| 2026-05-08 | Phase 6.3 — `value_code` per-cell flags through live ingestion + render | `replication/indicatorTableBps.service.js`, `processor/interop.processor.js`, `bpsRead/indicatorTableGenericRead.service.js`, `frontend/lib/cellRender.tsx`, `frontend/.../DataTableClient.tsx`, `frontend/components/chat/ChatTableModal.tsx` |
