# Backend (Express + Sequelize)

## Overview
- API server with public and protected endpoints.
- Uses Sequelize for DB access and caching processed payloads.
- Admin (Next.js) lives in `backend/admin` and consumes these APIs.

## Run (Development)
```bash
cd backend
npm install
npm start
```
Defaults: `PORT=5000`. Required env below.

## Required Environment
Set these in `backend/.env` (or system env):
- `DB_NAME`: database name
- `DB_USER`: database user
- `DB_PASS`: database password
- `DB_HOST`: database host
- `JWT_SECRET`: JWT HMAC secret (non-empty)
- `PORT` (optional): defaults to 5000

Env is validated at startup in `src/config/env.js`.

## Key Endpoints
- Public: `/dynamic`, `/interop`, `/static`
- Auth: `/auth`
- Protected: `/datasource`, `/period`, `/summary` (JWT / cookie)

## Search: Intent (Backend-First)

Backend endpoint that combines deterministic datasource search with the OpenAI query builder to produce a guarded deep-link plan.

- `GET /search/intent?q=...`
  - Response: `{ ok, query_builder, datasource, plan }`
  - Guardrail: only returns `plan.action="deeplink"` when a year is present.

### Caching (optional)
To reduce OpenAI calls for repeated queries, `/search/intent` uses an in-memory per-process TTL cache.

- `SEARCH_INTENT_CACHE_TTL_MS` (default: `15000`; set `0` to disable)
- `SEARCH_INTENT_CACHE_MAX` (default: `500` entries)

Response includes `X-Cache: HIT|MISS` for debugging.

## AI: Query Builder (OpenAI)

Optional server-side endpoint to translate a free-text query into strict JSON intent.

### Environment variables
- `OPENAI_API_KEY_QUERY_BUILDER` (required to enable)
- `OPENAI_QUERY_BUILDER_MODEL` (optional; default: `gpt-4.1-mini`)
- `OPENAI_QUERY_BUILDER_MODEL_FALLBACK` (optional; default: `gpt-4.1`)

### Endpoint
- `POST /ai/query-builder`
  - Body: `{ "q": "impor menurut komoditas hs2 januari 2024" }`
  - Response: `{ "ok": true, "result": { ...strict JSON... } }`

Notes:
- Keys are read from server env only.
- Output is validated against `src/services/ai/queryBuilder.schema.json`.

## Architecture
- Entry: `server.js` loads models, connects DB, `sequelize.sync()`, starts server.
- Routes: `src/routes/*` → Controllers in `src/controllers/*`.
- Services: domain logic in `src/services/*`.
- Caching: `src/services/cache/cache.service.js` with `ProcessedCache` model.
- Auth: `src/middleware/auth.middleware.js` attaches `req.user` and guards routes.

## Security & Stability
- Rate limiting: `/auth` and protected routes in `app.js`.
- Global error handler: standardized JSON error responses.
- CORS: allowlisted origins with credentials.

## Scripts
Add common scripts to `backend/package.json`:
```json
{
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "jest",
    "lint": "eslint src --ext .js"
  }
}
```

## Testing
- Unit: services (fetch, cache, processors)
- Integration: routes via Supertest with a test DB

Run (after adding dev deps):
```bash
npm run test
```

## Admin (Next.js)
See `backend/admin/README.md`. In dev: `npm run dev` from that folder.

## PM2
Use `ecosystem.config.js` at repo root to run and manage processes.
