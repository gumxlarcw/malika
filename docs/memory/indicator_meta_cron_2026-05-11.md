---
name: Indicator-meta auto re-index cron 2026-05-11
description: Closes the last deferred item — `indicator_meta` rows whose flat_text was refreshed by the BPS metadata processor are now auto-re-embedded into retrieval_chunks daily at 06:30 WIT.
type: project
originSessionId: 37e1fd58-1485-413f-bec5-fe58210c8f74
---
# Indicator-meta auto re-index cron — 2026-05-11

> **Why:** `persistMetadata` upserts `indicator_meta` rows whenever the BPS metadata extractor refreshes a source, but it doesn't touch `retrieval_chunks`. Result: retrieval_chunks `source_kind='indicator_meta'` rows drift stale. Verified 2026-05-11 morning: 149 of 302 indicator_meta rows had `rc.embedding_generated_at < im.fetched_at`.
>
> **How to apply:** Reference when extending this pattern. Same scheduler shape as `knowledgeSync` and `automation` schedulers — copy it for any future "background re-embed" need.

## What changed
- New service `backend/src/services/bpsMetadata/indicatorMetaSync.service.js` — finds stale rows (missing rc OR `rc.embedding_generated_at < im.fetched_at`), re-embeds via `embedPassage` from `bpsMetadata/embedding.service.js`, DELETE+INSERTs into retrieval_chunks. Returns `{checked, reembedded, skipped, errors, durationMs}`.
- New service `backend/src/services/bpsMetadata/indicatorMetaScheduler.service.js` — daily WIT-aware timer at **06:30 WIT** (30 min after knowledge-sync at 06:00 WIT so the embed loads don't compete). In-memory `_running` guard prevents overlap.
- Wired in `backend/server.js:149-156` bootstrap array as `indicator-meta` slot 6 of 7.

## Behaviors to remember
- Daily at 06:30 WIT, the scheduler calls `resyncStaleRows()`. Stale = retrieval_chunks row missing OR its `embedding_generated_at < indicator_meta.fetched_at`.
- Pattern: DELETE+INSERT (not INSERT IGNORE) so updates to `flat_text` actually re-embed. Differs from the original one-shot `scripts/repack-indicator-meta.js` which uses INSERT IGNORE.
- Boot log line: `indicator-meta scheduler armed { nextAt: '...', delayMs: ... }`.
- Manual trigger (no admin UI; not needed at this cadence):
  ```bash
  cd backend && node -e "
    require('dotenv').config({quiet:true});
    require('./src/services/bpsMetadata/indicatorMetaSync.service')
      .resyncStaleRows().then(s => console.log(JSON.stringify(s)));"
  ```
- Manual one-shot via the legacy script is still possible but covers only insert-new (not refresh):
  ```bash
  node scripts/repack-indicator-meta.js
  ```

## SQL probes for ops
```sql
-- Count stale rows
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN rc.id IS NULL THEN 1 ELSE 0 END) AS missing_rc,
  SUM(CASE WHEN rc.embedding_generated_at < im.fetched_at THEN 1 ELSE 0 END) AS stale_rc
FROM indicator_meta im
LEFT JOIN retrieval_chunks rc
  ON rc.source_kind='indicator_meta' AND rc.source_ref_id = im.source_id;
```

## Out of scope (deferred to future)
- Post-write hook in `persistMetadata` for synchronous re-embed at upsert time (would catch the drift the same hour, not next-morning). Daily cron is fine for now; latency isn't critical.
- Admin UI surface (status panel like /backend/knowledge-sync). Not needed at current scale; failures land in pm2 logs as `[IndicatorMetaScheduler] indicator-meta resync failed`.
