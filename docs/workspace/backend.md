# Backend API — Project Line

> Last updated: 2026-03-02

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
| 2026-03-02 | Initial audit & documentation | - |
