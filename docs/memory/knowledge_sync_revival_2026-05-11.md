---
name: Knowledge sync revival 2026-05-11
description: BRS + Publikasi auto-embed restored via xenova → retrieval_chunks. Boot-time daily scheduler (06:00 WIT default), 4 /knowledge/sync routes wired, state persisted to app_settings, status banner on /knowledge.
type: project
originSessionId: 37e1fd58-1485-413f-bec5-fe58210c8f74
---
# Knowledge sync revival — 2026-05-11

> **Why:** The /backend/knowledge-sync admin page existed but every backend endpoint 404'd. The underlying knowledgeSync.service.js still called OpenAI generateEmbedding + wrote to dropped columns. Auto-indexing for BRS + Publikasi had been silent-dead since 2026-03-08.
>
> **How to apply:** Reference when extending auto-embed to other content types (datasource, pressrelease, indicator_meta — out of scope today).

## What changed (commits da80b79..73506a3)

| Task | Commit | Change |
|--:|---|---|
| 1 | da80b79 | indexSingleDocument ports to chunkText + processEmbeddings (xenova → retrieval_chunks); drops broken rechunkDocument import + legacy vectorSearch cache invalidate |
| 2 | bfe4d6e | Scheduler state tracker — app_settings:scheduler:knowledge-sync + _runningFlag + runDailySyncTracked wrapper + getSchedulerState/updateSchedule helpers |
| 3 | 77bf831 | 4 routes wired: GET /knowledge/sync/stats, GET /knowledge/sync/config, POST /knowledge/sync, PUT /knowledge/sync/schedule |
| 4 | 38678fb | Boot-time daily scheduler (knowledgeSyncScheduler.service.js); slot 5 of 6 in server.js bootstrap array |
| 6 | 41200e4 | Auto-sync banner on /backend/knowledge — Aktif badge + jadwal + last/next/result + "Kelola →" link |
| L1 | 0057f0d | Initial log capture: pino logger wrapped to tee into in-memory buffer; snapshot frozen onto lastResult.logs at each terminal state |
| L2 | 8c25bdd | Sync Logs panel rendered on /backend/knowledge-sync (live + frozen views) |
| L3 | 73506a3 | **Rolling 1000-line buffer** persisted to app_settings.persistedLogs; never auto-clears between runs; hydrated lazily on first getSchedulerState call after PM2 reload; START/END separator lines per run; lastResult.logs removed (redundant) |

## Behaviors to remember
- **Source of truth**: `app_settings:scheduler:knowledge-sync` row stores `{enabled, hour, minute, lastRunAt, lastResult, history, persistedLogs}`. PM2 reload doesn't lose state.
- **In-memory `_runningFlag`** prevents concurrent runs. Manual POST returns 409 if scheduler tick is mid-run.
- **runDailySyncTracked** is the wrapper that updates persistent state; raw `runDailySync` still exported for one-off scripts.
- **Default schedule**: 06:00 WIT daily. UI form persists via `PUT /knowledge/sync/schedule`, which calls `restartKnowledgeSyncScheduler()` to re-arm.
- **WIT-aware scheduler** (`knowledgeSyncScheduler.service.js`): computes next-run delay against UTC+9 wall-clock, no DST in WIT.
- **MAX_NEW_PER_SYNC = 20** in `SYNC_CONFIG` caps runaway runs (e.g., BPS backlog after a long outage). Raise in code if needed.
- **indexSingleDocument** lifecycle: create parent KB row → keywords → indicator_index (large docs) → chunk + create children → `processEmbeddings([parent, ...chunks])` → audit row in `indexed_brs_publikasi`.
- The legacy `vectorSearch.loadKnowledgeEmbeddings(true)` cache-invalidate was removed — unified retrieval reads `retrieval_chunks` live, no in-memory cache.
- **Log capture (rolling 1000)**: `logger.info/warn/error` inside `knowledgeSync.service` tees to pino AND a module-level `_runLogs` ring. NEVER auto-clears between runs. Persisted to `app_settings.persistedLogs` on each terminal sync state (success+error). Hydrated lazily from app_settings on the first `getSchedulerState()` call after boot (`_hydrated` guard prevents double-load race). Surfaced via `scheduler.currentRunLogs` on `/knowledge/sync/stats`.
- **Run boundaries**: `_pushSeparator('START sync ...')` and `_pushSeparator('END sync OK · brs=N/+Merr ...')` lines bookend each run for visual demarcation in the UI panel.
- **`debug` level is not captured** — too noisy. Stays pino-only.
- **Storage footprint**: ~200KB max on `app_settings.value_json` (LONGTEXT). Refreshed once per terminal sync state.

## Out of scope (explicitly deferred)
- Datasource auto-embed on `POST /datasources` — separate plan.
- Pressrelease → retrieval_chunks indexing — design decision pending (new `source_kind='pressrelease'` vs reuse `knowledge_doc`).
- indicator_meta auto re-index — `scripts/repack-indicator-meta.js` exists but unscheduled.

## Verify it's working
- Boot log line: `Knowledge-sync scheduler armed { nextAt: '<ISO>', delayMs: <ms> }`
- `GET /knowledge/sync/stats` returns `{indexed, knowledgeBase, scheduler{name,enabled,schedule,running,lastRunAt,lastResult,nextRunAt,history,currentRunLogs}}`
- /backend/knowledge shows banner near title with status + "Kelola →" link
- /backend/knowledge-sync renders 5 panels (Scheduler Status, Indexed Documents, Schedule Configuration, Sync Configuration, **Sync Logs**)
- After manual `POST /knowledge/sync`, new rows in `retrieval_chunks` have `embedding_model='Xenova/multilingual-e5-base'` (NOT `text-embedding-3-small`)
- Sync Logs panel shows START/END separator lines per run + per-doc indexed events; rolling buffer survives PM2 reload via `app_settings.persistedLogs`

## SQL probes for ops
```sql
-- Current rolling buffer size + scheduler state
SELECT JSON_LENGTH(value_json -> '$.persistedLogs') AS logs_count,
       JSON_UNQUOTE(value_json -> '$.lastRunAt') AS last_run,
       JSON_UNQUOTE(value_json -> '$.lastResult.success') AS last_ok,
       LENGTH(value_json) AS bytes
FROM app_settings WHERE `key`='scheduler:knowledge-sync';

-- Reset rolling buffer (e.g., after a debug session)
UPDATE app_settings
SET value_json = JSON_SET(value_json, '$.persistedLogs', JSON_ARRAY())
WHERE `key`='scheduler:knowledge-sync';
-- Then: pm2 reload pds-backend  (to clear in-memory buffer too)

-- Disable auto-sync without code revert
UPDATE app_settings
SET value_json = JSON_SET(value_json, '$.enabled', CAST('false' AS JSON))
WHERE `key`='scheduler:knowledge-sync';
-- Then: pm2 reload pds-backend  (so the scheduler arms with new state)
```
