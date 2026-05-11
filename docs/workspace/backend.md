# Backend API — Project Line

> Last updated: 2026-05-08

## Current State
- **Framework**: Express 5.2.1 + Sequelize 6.37.7
- **Port**: 5000 (PM2: pds-backend)
- **Entry**: `backend/server.js` → `backend/app.js`

## Routes (34 files)
Public: `/dynamic`, `/pressrelease`, `/interop`, `/static`, `/exim`, `/metabase`, `/notifications`, `/push`, `/search`, `/categories`, `/analytics`, `/period/public`, `/ai`, `/chat`, `/chat-feedback`, `/geojson`, `/error-learning`
Auth: `/auth`, `/csrf-token`
Admin: `/datasource`, `/period`, `/summary`, `/cache`, `/automation`, `/search/admin`, `/chat/admin`, `/knowledge`, `/rag-trial`, `/logs`, `/notifications/admin`

## Controllers: 33 files
## Models: 26 Sequelize models
## Middleware: auth, csrf, rateLimit, auditLog, observability, validate
## Services: 122+ files across 26 subdirectories
## Utils: 18 files | Shared: 3 files

## Change Log
| Date | Change | Files Affected |
|---|---|---|
| 2026-05-11 | Automation flow hardened: audit middleware write-only by default (`logReads:true` opt-in), batched/parallel status load (560ms→175ms warm), durable AutomationRunLog row updated in place via `persistRunLog(payload, runLogRowId)`, structured progress events (12 stages) alongside log-string fallback, scheduler badge + next-run-at in admin UI, dead `GET /automation` controller removed (-210 LOC). Plan: `docs/superpowers/plans/2026-05-11-automation-flow-fixes.md` | `backend/src/middleware/auditLog.middleware.js`, `backend/src/services/automation/automation{StatusJob,RunJob,Runner}.service.js`, `backend/src/controllers/automation.controller.js`, `backend/src/routes/automation.routes.js`, `backend/admin/app/automation/page.tsx` |
| 2026-05-11 | Knowledge admin `/backend/knowledge` page restored after Phase C drift: 3 read endpoints (stats/datasources/documents) now LEFT JOIN retrieval_chunks for hasEmbedding/embeddingUpdatedAt; 4 write paths (embed, embed-all, clearEmbedding, processEmbeddings, reEmbed) DELETE+INSERT into retrieval_chunks via xenova multilingual-e5-base; deleteDocument cascade-cleans retrieval_chunks; searchAll() gated on `USE_UNIFIED_RETRIEVAL` (was silently 429ing); legacy embedding.service.js `@deprecated`. Kills the embed-all silent-lie (ok:true while writing nothing). Plan: `docs/superpowers/plans/2026-05-11-knowledge-admin-fixes.md` | `backend/src/services/ai/embedding.service.js`, `backend/src/services/ai/knowledgeDoc.service.js`, `backend/src/services/ai/vectorSearch.service.js` |
| 2026-05-11 | BRS+Publikasi auto-sync revived end-to-end via xenova → retrieval_chunks. `indexSingleDocument` ports to chunkText + processEmbeddings; scheduler state persists to `app_settings:scheduler:knowledge-sync` (enabled/hour/minute/lastRunAt/lastResult/history); 4 routes wired (`GET/POST/PUT /knowledge/sync*`); new boot-time scheduler `knowledgeSyncScheduler.service.js` armed at 06:00 WIT daily; auto-sync status banner on `/backend/knowledge` linking to `/backend/knowledge-sync`. Last auto-indexing before fix: 2026-03-08 (silent-dead 2 months). First post-fix sync indexed 12 BRS + 5 Publikasi with 0 errors via Xenova/multilingual-e5-base. Plan: `docs/superpowers/plans/2026-05-11-knowledge-sync-revival.md` | `backend/src/services/rag/{knowledgeSync,knowledgeSyncScheduler}.service.js`, `backend/src/controllers/knowledge.controller.js`, `backend/src/routes/knowledge.routes.js`, `backend/server.js`, `backend/admin/app/knowledge/page.tsx` |
| 2026-05-11 | Knowledge-sync rolling log buffer (1000 lines) persisted to `app_settings.persistedLogs`; survives both multiple sync runs and PM2 reload. Logger wrapped to tee every info/warn/error call into `_runLogs` ring (debug stays pino-only). Hydrated lazily on first `getSchedulerState()` call after boot. Each run pushes START/END separator lines for visual demarcation. `/backend/knowledge-sync` gains a 5th panel ("Sync Logs") showing the live + frozen rolling buffer with LIVE pulse badge during runs. `lastResult.logs` field removed (redundant). | `backend/src/services/rag/knowledgeSync.service.js`, `backend/admin/app/knowledge-sync/page.tsx` |
| 2026-05-11 | Datasource auto-embed wired (closes deferred item from knowledge admin plan). `POST /datasource` fire-and-forget `embedDatasource(id)` after create when active; `PUT /datasource/:id` re-embeds only when `name/description/aliases/category` changed OR status flipped inactive→active; cleanup on inactive flip + soft + hard delete. `setImmediate` keeps the response path off the xenova hot path; failures log to pm2 as `[datasource auto-embed] <context> id=N FAILED:`. Live verified CREATE→UPDATE-text→UPDATE-non-text→DELETE cycle on probe id=461. | `backend/src/controllers/datasource.controller.js` |
| 2026-05-11 | Pressrelease indexing deferred item **closed without code change** — verified that `data_bps.pressrelease_kw_*` is a separate per-topic browsing cache; the same press release content is already indexed via `services/rag/brsFetcher.service.js` → `knowledge_base.category='BRS'` → retrieval_chunks `source_kind='knowledge_doc'`. `/knowledge/search` returns press releases at similarity 0.86. Added clarifying comment on the `vectorSearch.service.js:158` exclusion site so future audits don't re-investigate. | `backend/src/services/ai/vectorSearch.service.js` (comment only) |
| 2026-05-08 | Production chat persistence path is `streaming.service.js`, **not** `chat.service.js:sendMessage`. The latter handles the dormant non-streaming `POST /chat/threads/:id/messages` route (controller line 47); the frontend always uses streaming. Same truncation-cap bug pattern existed in both files but only the streaming sites were live and were fixed. | (note only; see chat-pipeline.md for the fix entry) |
| 2026-03-02 | Initial audit & documentation | - |
