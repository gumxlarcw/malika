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

## Change Log
| Date | Change | Files Affected |
|---|---|---|
| 2026-03-02 | Initial audit & documentation | - |
