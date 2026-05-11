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
| 2026-05-08 | Production chat persistence path is `streaming.service.js`, **not** `chat.service.js:sendMessage`. The latter handles the dormant non-streaming `POST /chat/threads/:id/messages` route (controller line 47); the frontend always uses streaming. Same truncation-cap bug pattern existed in both files but only the streaming sites were live and were fixed. | (note only; see chat-pipeline.md for the fix entry) |
| 2026-03-02 | Initial audit & documentation | - |
