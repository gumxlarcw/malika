# Database — Project Line

> Last updated: 2026-03-02

## Connections
- **Primary**: `project_data_strategis` (localhost, root/17Agustus)
- **Replica**: `data_bps` (read-only, 316+ tables)
- **ORM**: Sequelize 6.37.7
- **Pool**: max 20, min 5, acquire 30s, idle 10s, slow query 100ms

## Models (28 — backend/src/models/)
User, DataSource, DataPeriod, ProcessedCache, MergedCache, FetchLog,
ChatThread, ChatMessage, ChatFeedback, ChatMessageFlag, ChatErrorPattern,
KnowledgeBase, DataSourceSearchTerm, SearchStat, Notification,
PushSubscription, PushSendLog, AutomationConfig, AutomationRunLog,
AdminAuditLog, EximPodFilter, IndexedBrsPublikasi, UserMemory,
AppSetting, DnaCache, IndicatorMeta, IndicatorMetricMeta, index.js

## data_bps Tables
- 310 `indikator_*` tables (157 dynamic, 150 interop, 1 static, 2 exim)
- `kodehs_indd` (HS2 lookup)
- `data_merged_cache`
- 4 `pressrelease_kw_*` tables

## System pseudo-sources
`data_sources.type='static'` AND `visible=0` rows do NOT have backing `indikator_NNN` tables in `data_bps`. They are "marker rows" used by automation flows that don't ship public data. Current set:
- id 176: `System: Publikasi Notifications`
- id 177: `System: MergedCache Watcher`

Any orphan-detection query over `data_sources ↔ indikator_NNN` must filter these out (`AND visible=1`).

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
| 2026-05-09 | DB audit fixes Phase A+B+D1/E1/F1 — audit middleware re-wired (5 mounts, 2 router files), 7 model drifts fixed, IndicatorMeta + IndicatorMetricMeta added, kodehs_indd collation aligned, retention cron added, junk source 313 dropped | `backend/app.js`, `backend/src/routes/{auth,errorLearning}.routes.js`, `backend/src/models/*.model.js`, `backend/src/database/migrations/20260508_alter_kodehs_collation.js`, `backend/src/jobs/retention.job.js`, `backend/server.js` |
