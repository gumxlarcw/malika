<!-- Purpose: guidance for AI coding agents working on this repository. -->
# Copilot / AI Agent Instructions

Concise, repo-specific guidance to help AI agents be productive here.

**Big Picture**
- **Backend API:** Express + Sequelize in `backend/`. Entry: `backend/app.js` (middleware + route mounting) and `backend/server.js` (loads models, connects DB, `sequelize.sync()`, starts server).
- **Admin UI:** Next.js app in `backend/admin/`. Dev runs separately (port 5050 via `ecosystem.config.js` or `npm run dev`).
- **Public PWA:** Next.js app in `frontend/` (user-facing search + data views). It has its own API routes (e.g. `/api/search`) that aggregate results from the backend + BPS public APIs.
- **Static/Admin (PHP):** `backend/public/` contains legacy/admin PHP pages served by the backend using `express.static(...)` and can be accessed directly under `/`.
- **Data Types Supported:** Dynamic (BPS tables), Interop, EXIM, Press Release (NEW)

**Orientation (start here)**
- See routing in `backend/app.js`: public endpoints `/dynamic`, `/interop`, `/static`; protected `/datasource`, `/period`, `/summary` behind `authMiddleware`.
- New: merged/processed endpoints live under `/cache/*` (see **Merged Processed JSON** section below).
- Models are explicitly loaded in `backend/server.js` before `sync()`. When adding models, follow the existing `require('./src/models/ModelName')` pattern.
- Domain logic lives in `backend/src/services/*` (fetching, caching, processing). Controllers in `backend/src/controllers/*` orchestrate services; routes in `backend/src/routes/*` map URLs to controllers.

**Data Flow & Patterns**
- Request → route → controller → service(s) → Sequelize models → response.
- External fetches: use `backend/src/services/datasource/fetch.service.js` (axios + retries). It logs to `FetchLog` and handles retry/backoff; reuse it for any HTTP calls to keep logs consistent.
- Processing: Multiple processors for different data types:
	- `dynamic.processor.js`: shapes API payloads into `{ period, columns, data, source, last_update }`.
	- `exim.processor.js`: processes EXIM (export-import) data with year/month structure.
	- `pressrelease.processor.js`: transforms press release details into document format.
	- `interop.processor.js`, `static.processor.js`, `timeline.processor.js` for other source types.
	- Use helpers in `backend/src/utils/parser.js` (e.g., `decodeKeyUsingMetadata`) for parsing.
- Caching: `backend/src/services/cache/cache.service.js` uses `ProcessedCache.upsert()` and `getCache(source_id, period)` to store/read latest processed JSON.
- Merged cache: `data_merged_cache` stores merged processed JSON keyed by `source_id` and a merge `signature` (via `MergedCache` model).
- Merging: `backend/src/services/merge/mergeBuilder.service.js` merges multiple processed JSONs; respects EXIM-specific merge logic (year-based, not th_id-based).
- Period discovery: `backend/src/services/period/*` services fetch available periods from APIs and generate/manage period maps.
- Replication: `backend/src/services/replication/indicatorTableBps.service.js` replicates merged data to `data_bps` database per-indicator tables.

**Search & Deep-links (PWA)**
- PWA unified search aggregator: `frontend/src/app/api/search/route.ts`.
	- It merges:
		- Backend intent + ranked datasource candidates (`GET /search/intent?q=...&includeCandidates=1&limit=...`).
		  - Backend handles most datasource scoring/ranking; frontend must avoid double-applying the same bonuses.
		- BPS public API results for publications/press releases (as implemented).
		- EXIM intent parsing + deep-links.
- Deep-link conventions (PWA):
	- Dynamic tables: `/data?source_id=<id>&period=<year>&month=<1-12>` (PWA normalizes year → BPS `period_value` where needed).
	- EXIM: `/data?source_id=<id>&type=exim&period=<year>&code_hs=<hs>&pod=<pod>&ctr=<ctr>&metric=value|netweight`.
	- Guardrail: only deep-link directly to `/data` when query contains a year; otherwise fall back to `/search?q=...`.

**Geo Handling (PWA search + deeplinks)**
- `frontend/src/lib/geoIntent.ts` provides deterministic Maluku Utara geo extraction + shorthand expansions.
- Deeplink `geo=` must mean: the dataset is *filterable by wilayah* (kab/kota dimension), not merely “indicator about a kab/kota”.
  - The PWA uses conservative signals from datasource title (e.g. “Menurut Kabupaten/Kota”, “Kabupaten/Kota”, “Kab/Kota”).
  - For ambiguous cases, the PWA may probe a small number of top candidates by calling backend public endpoints:
    - `GET /dynamic/:id?period=<year>`
    - `GET /interop/:id?period=<year>`
    and checking `data.columns` for kab/kota labels.
- `/data` applies geo filtering defensively (only if it matches at least one row; otherwise fall back to unfiltered rows).

**Suggestions Ordering (BRS/Pubs)**
- Keyword expansion: `frontend/src/lib/bpsKeyword.ts`.
- Ranking: relevance-first, then newest as a tie-breaker; when query has no period, a small bounded recency bonus is applied.

**Datasource Aliases (for search relevance)**
- `data_sources.aliases` exists to improve discoverability (e.g. synonyms/keywords).
- Ensure backend search matches against `aliases` (in addition to name/description).
- Admin UI includes an “Alias (untuk search)” field for dynamic datasources.

**Merged Processed JSON (NEW)**
- Merge endpoint (computed on-demand): `GET /cache/merge/:id?all=true` or `GET /cache/merge/:id?th_ids=124,125`.
- Save merged result (persist): add `&save=true` to the merge request.
- Read saved merged (persisted): `GET /cache/merged/:id?signature=all|124,125`.
- Output shape (merge response):
	- `metrics`: list of metric keys discovered from rows.
	- `years[]`: grouped by year with `months[]` and `values`.
	- `table`: flat `{ columns, data }` view for direct rendering.

**Auth & Permissions**
- `backend/src/middleware/auth.middleware.js` reads JWT from `Authorization: Bearer <token>` or `token` cookie, attaches `req.user`, and exposes `requireAdmin` for admin-only endpoints.

**Repo-Specific Conventions**
- Keep controllers thin; concentrate business logic in `src/services/*` and processors in `src/services/processor/*`.
- Always log outbound fetches via `fetch.service.js`; do not call axios directly from controllers.
- Cache writes must go through `ProcessedCache.upsert()`; reads through `getCache()` to ensure consistent retrieval of most recent records.
- When adding models, update `backend/server.js` `require()` list before `sequelize.sync()`.
- **EXIM-specific**: EXIM data is year-based (not th_id-based). Use `eximYearDiscovery.service.js` to find available years; `exim.processor.js` to process raw responses.
- **Formula services** in `backend/src/services/formula/` (growth, mom, yoy, ratio, score) compute derived metrics; use them in summary/aggregation logic.
- **Datasource URL parsing**: use `parseDatasourceUrl.service.js` to resolve new datasource definitions (supports dynamic and exim type detection).

**LLM / OpenAI Integration (NEW)**
- Preferred use: **interpretation / query-to-JSON** (NLU). Do not let the LLM become the “source of truth” for data; it must only translate user text → structured intent.
- Retrieval and data serving remain deterministic:
	- Search/ranking uses DB + rules (e.g. `data_sources.name/description/aliases`).
	- Indicator data must remain **data_bps-only** (no upstream fallback) to avoid wrong-scope leakage.
- **Never call OpenAI from the browser**. All OpenAI calls must run server-side:
	- Backend Express controller/service, OR
	- Next.js API route (`frontend/src/app/api/*`) running on the server.
- Use 3 separate API keys (for cost tracking & independent disable/revoke):
	- `OPENAI_API_KEY_QUERY_BUILDER`: user query → strict JSON (routing parameters)
	- `OPENAI_API_KEY_INTERPRETATION`: disambiguation/normalization (still JSON)
	- `OPENAI_API_KEY_CHAT`: chat/Q&A/explanations (freeform text is OK)
- Model recommendations (adjust as needed):
	- Query builder: `gpt-4.1-mini` (default), fallback `gpt-4.1` when output is invalid/ambiguous.
	- Interpretation: `gpt-4.1-mini` (default), fallback `gpt-4.1` for difficult disambiguation.
	- Chat: `gpt-4.1` for best quality; `gpt-4.1-mini` if cost/latency is prioritized.
- Output contracts:
	- Query builder + interpretation must return **strict JSON** validated by server-side schema.
	- Enforce whitelists for fields and values (e.g., `type`, `group`, `metric`). Reject/repair invalid outputs.
	- The app (not the model) must decide final deep-links and enforce guardrails (e.g., require year before deep-linking to `/data`).
- Operational guardrails:
	- Add timeouts, retries (limited), and rate limiting.
	- Log requests/responses safely (do not log API keys; avoid logging raw user PII).
	- Prefer passing only minimal context needed for the task.

**RAG (Retrieval-Augmented Generation)**
- Self-hosted RAG using MySQL + in-memory cosine similarity (no external vector DB needed).
- Embeddings stored in `data_sources.embedding` (JSON array of 1536 floats).
- Services:
	- `backend/src/services/ai/embedding.service.js`: generate embeddings via OpenAI API, store in MySQL.
	- `backend/src/services/ai/vectorSearch.service.js`: in-memory cosine similarity search.
- Integration with Query Builder:
	- Before calling OpenAI, `buildQueryFromText()` searches for top-5 candidate datasources using vector similarity.
	- Candidates are injected into the system prompt to help LLM pick correct `source_id`.
	- Can be disabled by passing `useVectorSearch: false`.
- Admin UI: `/backend/knowledge` for managing embeddings (embed all, test search, clear).
- Documentation: `RAG_IMPLEMENTATION.md`.

**Databases & Replication (NEW)**
- Primary DB (default): `project_data_strategis` (configured via `DB_*` envs).
- Optional replica/target DB: `data_bps` via `backend/src/config/db_bps.js`.
	- Defaults DB name to `data_bps`.
	- Uses `DB_BPS_USER/DB_BPS_PASS/DB_BPS_HOST` if provided; otherwise falls back to `DB_USER/DB_PASS/DB_HOST`.
	- Replication is best-effort: failures are logged and should not break the API response.
- Table created manually (recommended) or via Sequelize sync: `data_merged_cache`.
- For Metabase/production reporting, merge save also populates a per-indicator table in `data_bps`:
	- Table name: `indikator_<source_id>` (example: `indikator_1`).
	- Row shape: one row per `(th_id, month_no, metric)` with `value`, `year`, and timestamps.
	- Created automatically on first save (`CREATE TABLE IF NOT EXISTS`).
- EXIM POD filtering: `exim_pod_filters` table (model: `EximPodFilter.model.js`) allows per-indicator allowlist for production replication.
	- Enabled filters prevent unwanted EXIM PODs from being replicated to `data_bps.indikator_*`.

**Automation & Scheduling (NEW)**
- Background job scheduler: `backend/src/services/automation/scheduler.service.js` manages periodic tasks (disabled by default; enable via config).
- Services:
	- `automationRunner.service.js`: executes merge + save + replication jobs per configured automation rule.
	- `automationStatusJob.service.js`: tracks job execution status and results.
	- `automationRunJob.service.js`: lower-level job orchestration.
- Models: `AutomationConfig` (rules) and `AutomationRunLog` (execution history).
- Routes: `backend/src/routes/automation.routes.js` (admin-only, requires `requireAdmin` middleware).

**Notifications & Push**
- Notifications are stored in `app_notifications` with a unique `unique_key` to dedupe.
- Push subscriptions are stored in `push_subscriptions`; broadcast uses VAPID when configured.
- When implementing new notifications:
	- Prefer “content-derived” dedupe keys (e.g. IDs or upstream timestamps), not runtime timestamps.
	- Keep writes best-effort; do not break main API responses.

**Merged Cache Update Notifications (Data Statistik)**
- Goal: send “indikator diperbarui” when upstream data truly changes.
- Source of truth is `data_merged_cache.last_update` (derived from upstream `processed.last_update`).
- IMPORTANT: do NOT use `data_merged_cache.updated_at` to detect changes (it updates on every save, including automation runs).
- Watcher service: `backend/src/services/notification/mergedCacheWatch.service.js`
	- Stores a checkpoint in ProcessedCache via a hidden system datasource (`api_url=system:mergedcache-watch`).
	- Detects changes by querying rows where `last_update > checkpoint`.
- Scheduler: `backend/src/services/notification/mergedCacheScheduler.service.js`
	- Intentionally off-by-default; enable via env.

**Dev & Run Commands**
- Backend (dev):
```bash
cd backend
npm install
npm start   # runs node server.js
```
- Admin (Next.js) dev:
```bash
cd backend/admin
npm install
npm run dev  # starts Next.js on port 5050
```
- PM2 (optional):
```bash
pm2 start ecosystem.config.js
pm2 status
```

**Testing & Debugging**
- Jest tests live in `backend/src/__tests__/`. Run from `backend/`:
```bash
cd backend
npm test
```
- Frontend/PWA tests (non-EXIM focus):
```bash
cd frontend
npm run test:nonexim
```
- Useful tests to read: fetch retry behavior (`__tests__/fetch.service.retry.test.js`), cache contract (`__tests__/cache.service.test.js`), processor output shape (`__tests__/dynamic.processor.test.js`), auth routes (`__tests__/routes.auth.test.js`) and protected endpoints.
- If the server fails to start, check DB env vars and connectivity. `backend/src/config/env.js` and `backend/src/config/db.js` load `.env` and configure Sequelize.
- For fetch issues, inspect `FetchLog` table entries and retry logs produced by `fetch.service.js`.
- For auth issues, verify `JWT_SECRET` and request headers/cookies.

**Integration Points**
- External APIs: all outbound calls go through `fetch.service.js` and are recorded in `FetchLog` with retry metadata.
- Admin UI → Backend: Admin pages (Next.js or PHP) consume processed data shaped by processors and caches under `/dynamic`, `/summary`, etc.

**Files to Reference**
- `backend/app.js`, `backend/server.js`, `backend/src/middleware/auth.middleware.js`.
- PWA search + intent routing:
	- `frontend/src/app/api/search/route.ts`
	- `frontend/src/lib/geoIntent.ts`
	- `frontend/src/lib/bpsKeyword.ts`
- Services: 
	- `backend/src/services/datasource/fetch.service.js` (all HTTP calls)
	- `backend/src/services/cache/cache.service.js` (processed cache)
	- `backend/src/services/search/datasourceSearch.service.js` (datasource scoring/ranking)
	- `backend/src/services/merge/mergeBuilder.service.js` (merge logic)
	- `backend/src/services/processor/dynamic.processor.js` (dynamic data shaping)
	- `backend/src/services/processor/pressrelease.processor.js` (press release formatting)
	- `backend/src/services/pressrelease/list.service.js` (PR list fetching - multi-page)
	- `backend/src/services/pressrelease/detail.service.js` (PR detail fetching - parallel)
	- `backend/src/services/exim/eximYearDiscovery.service.js` (EXIM year detection)
	- `backend/src/services/replication/indicatorTableBps.service.js` (BPS replication)
	- `backend/src/services/automation/scheduler.service.js` (job scheduling)
- Utils: `backend/src/utils/parser.js`, `backend/src/utils/period.js`, `backend/src/utils/formatter.js`.
- Formula: `backend/src/services/formula/` (growth, mom, yoy, ratio, score).
- Admin: `backend/admin/README.md` and `backend/admin/lib/axios.js` for client conventions.

**Checkpoint Docs**
- Latest search stability checkpoint: `CHECKPOINT_SEARCH_STABILITY_2026-01-06.md`

If anything is unclear or you need deeper examples, ask which parts to expand (services, processors, tests, or admin integration) and we’ll iterate.
**EXIM Data Integration (NEW)**
- EXIM (export-import) sources are processed differently from BPS dynamic tables (year-based vs th_id-based).
- Year discovery: `backend/src/services/exim/eximYearDiscovery.service.js` queries available years from EXIM API.
- Processing: `backend/src/services/processor/exim.processor.js` flattens year/month data into standardized rows with th_id = year.
- Merge behavior: EXIM merges iterate through years (e.g., 2020 to latest available) rather than th_ids; reflected in `cache.merge.controller.js`.
- POD filtering: EXIM-specific export ("HS code") filtering via `EximPodFilter` table; applies allowlist during replication to `data_bps`.
- Seed job: `eximSeedJob.service.js` populates initial period map and caches for EXIM sources.

**Press Release Data Integration (NEW)**
- Press Release (pressrelease) sources fetch documents from BPS API based on keyword.
- List fetching: `backend/src/services/pressrelease/list.service.js` queries all pages (pagination) from list API and collects brs_ids.
  - URL template: `https://webapi.bps.go.id/v1/api/list/model/pressrelease/domain/8200/page/{page}/keyword/{keyword}/key/{api_key}/`
  - Extracts: `pages`, `total`, array of items with `brs_id`.
- Detail fetching: `backend/src/services/pressrelease/detail.service.js` fetches full content per brs_id with controlled concurrency.
  - URL: `https://webapi.bps.go.id/v1/api/view/domain/8200/model/pressrelease/lang/ind/id/{brs_id}/key/{api_key}/`
  - Extracts: title, abstract, rl_date, pdf_url, slide_url, thumbnail_url, subcsa.
- Processing: `backend/src/services/processor/pressrelease.processor.js` transforms detail map into table format.
- Output: `{ source, period (date range), columns, data (rows with metadata), last_update }`.
- Caching: Cached by (source_id, keyword) via ProcessedCache table.
- Route: `GET /pressrelease/:id?keyword=inflasi` (public endpoint).
- UI: Admin cache page has conditional input for keyword (pressrelease) vs period (dynamic/interop/exim).

**Important Notes (Harap Dibaca)**
- Harap selalu mengecek instruction ini sebelum memberikan jawaban atau melakukan perubahan.
- BasePath admin Next.js adalah `/backend` (lihat `backend/admin/next.config.ts`).
- IMPORTANT (Cloudflared path routing): pada host `api-malika.bpsmalut.com`, Cloudflared hanya meneruskan `/backend/*` ke Next.js (port 5050). Jadi redirect ke `/login` (tanpa `/backend`) akan masuk ke backend Node (port 5000) dan memunculkan 404/CSP.
	- Gunakan redirect eksplisit ke `/backend/login` untuk client-side navigations yang memakai `window.location.*`.
	- Sudah diterapkan pada: `backend/admin/components/RequireAuth.tsx`, `backend/admin/components/AuthProvider.tsx`, dan interceptor 401 di `backend/admin/lib/axios.js`.

**Struktur & Database (ringkas)**
- Struktur backend lengkap tersedia di output `tree` pada folder `backend/` (controllers, routes, services, models, utils). Lihat daftar di pesan ini bila perlu referensi cepat.
- Tabel utama (phpMyAdmin: `project_data_strategis`):
	- `data_sources`: sumber data dan metadata (kolom: `type`, `api_url`, `period_key`, `visible`, `display_order`, dll.).
	- `data_period_map`: peta periode per `source_id` (`period_value`, `api_url_override`).
	- `data_processed_cache`: cache hasil proses per `source_id` dan `period_value` (`processed_json`, `last_update`).
	- `data_merged_cache`: cache hasil merge per `source_id` + `signature` (`merged_json`, `last_update`, `updated_at`).
	- `fetch_logs`: log outbound fetch (status, message).
	- `users`: autentikasi (`email`, `password_hash`, `role`).

**Pola Parsing (Dynamic Table)**
- Vervar/var/turvar/tahun/turtahun memiliki panjang stabil:
	- vervar: 1–2 digit (bulan 1–12)
	- var: 3 digit (kode variabel)
	- turvar: 3 digit (kode turunan variabel)
	- tahun: 3 digit (contoh 125 = 2025)
	- turtahun: 1 digit (biasanya "0")
- Gunakan helper di `backend/src/utils/parser.js` saat memetakan/decoding kunci payload berdasarkan metadata.

**Env & Deploy Tips**
- Backend membutuhkan env wajib: `DB_NAME`, `DB_USER`, `DB_PASS`, `DB_HOST`, `JWT_SECRET`. Jika hilang, `src/config/env.js` akan melempar error.
- PM2: `ecosystem.config.js` mendefinisikan `project-backend` (port 5000) dan admin Next (dev 5050, prod standalone). Set env via `.env` di `backend/` atau `env_production` PM2.
- Cloudflared: rute `/backend/*` mengarah ke port 5050 (admin). Pastikan redirect di `app/page.tsx` memakai `/login` (tanpa `/backend`).
