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
| 2026-05-08 | Production chat persistence path is `streaming.service.js`, **not** `chat.service.js:sendMessage`. The latter handles the dormant non-streaming `POST /chat/threads/:id/messages` route (controller line 47); the frontend always uses streaming. Same truncation-cap bug pattern existed in both files but only the streaming sites were live and were fixed. | (note only; see chat-pipeline.md for the fix entry) |
| 2026-03-02 | Initial audit & documentation | - |
