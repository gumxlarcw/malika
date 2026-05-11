---
name: Knowledge admin fixes 2026-05-11
description: Port /backend/knowledge admin page from legacy OpenAI 1536d/dropped-column code to live retrieval_chunks + xenova 768d pipeline. 3 read endpoints + 4 write endpoints migrated, searchAll gated on USE_UNIFIED_RETRIEVAL, deleteDocument now cascades to retrieval_chunks, legacy embedding.service deprecated.
type: project
originSessionId: 37e1fd58-1485-413f-bec5-fe58210c8f74
---
# Knowledge admin page fixes — 2026-05-11

> **Why:** Browser console reported 500s on /knowledge/{stats,datasources,documents}. Root cause: Phase C (2026-05-09) dropped data_sources.embedding* and knowledge_base.embedding* columns but services/ai/embedding.service.js + knowledgeDoc.service.js + vectorSearch.service.js were never migrated. Worst was a silent lie: POST /knowledge/embed-all returned ok:true with errors:311 (OpenAI 429 + Sequelize silently dropping the unknown column on UPDATE). Admin was clicking "Embed all" thinking it worked.
>
> **How to apply:** Reference for future RAG admin work. Plan at docs/superpowers/plans/2026-05-11-knowledge-admin-fixes.md.

## What changed (commits 8f3a733..3d2822f)

| Task | Commit | Change |
|--:|---|---|
| 1 | 8f3a733 | getEmbeddingStats() reads retrieval_chunks (source_kind='datasource') for embedded count + MIN/MAX(embedding_generated_at). |
| 2 | 0e1defe | getDatasourcesWithEmbeddingStatus() LEFT JOIN retrieval_chunks for hasEmbedding + embeddingUpdatedAt. |
| 3 | 2b90bf0 | getAllDocuments() drops embedding_updated_at SELECT; looks up hasEmbedding via grouped query on retrieval_chunks. |
| 4 | b356aa5 | embedDatasource / embedAllDatasources / clearEmbedding DELETE+INSERT into retrieval_chunks via xenova. Kills the embed-all silent lie. |
| 5 | 213eb0c | processEmbeddings / reEmbed write to retrieval_chunks; deleteDocument cascade-cleans retrieval_chunks for parent + children. |
| 6 | 3d2822f | searchAll() gated on USE_UNIFIED_RETRIEVAL (was the only ungated entry); legacy loaders annotated as dead; deprecation comment on embedding.service.js. |

## Behaviors to remember
- **Live embedder**: `services/bpsMetadata/embedding.service.js` exports `embedPassage(text)` for indexing and `embedQuery(text)` for search-side. Both produce 768d via Xenova/multilingual-e5-base.
- **Storage**: `retrieval_chunks` table, columns include `source_kind` enum {datasource, knowledge_doc, knowledge_chunk, indicator_meta, chat_thread}, `source_ref_id`, `chunk_index`, `embedding VECTOR(768)`, `embedding_model`, `embedding_generated_at`.
- **Write pattern**: DELETE existing row(s) by (source_kind, source_ref_id [, chunk_index]) then INSERT with `VEC_FromText(?)`. Matches `scripts/backfill-retrieval-chunks.js:102-113` canonical insert.
- **Read pattern**: native `VEC_DISTANCE_COSINE(embedding, VEC_FromText(?))` — see `services/ai/retrieval.service.js:24`.
- **searchAll/searchKnowledge** both gate on `USE_UNIFIED_RETRIEVAL=true` (env). Production runs with true; legacy fallback only fires if the unified path throws (loud warning logged).
- **embedding.service.js (legacy)** is `@deprecated` — its OpenAI `generateEmbedding` and `buildEmbeddingText` helpers remain only so `scripts/reembed-all.js` doesn't import-fail; don't call them from new code.

## Live verified (2026-05-11)
- GET /knowledge/stats → total=311, embedded=311, oldest/newest populated
- GET /knowledge/datasources → count=311, hasEmbedding=311
- GET /knowledge/documents → count=1332, hasEmbedding=1331
- GET /knowledge/documents/stats → 200
- POST /knowledge/embed/2 → upsert (old row 28105 → new row 28718)
- POST /knowledge/embed-all → total=311, skipped=311, errors=0 (was: ok:true with 311 silent errors)
- POST /knowledge/search "PDRB" → unified=true, 2 results
- DELETE /knowledge/documents/:id → both kb + rc rows cleaned
- POST /knowledge/documents/:id/re-embed → row timestamp 2026-05-09 → 2026-05-11
- POST /knowledge/documents/text → status=ready, 1 retrieval_chunks row
- GET admin /backend/knowledge (Next.js) → 200

## Notes
- Tests for write paths under xenova use dynamic ESM (`@xenova/transformers`); Jest CJS VM can't load them without `--experimental-vm-modules`. The xenova-dependent tests are `describe.skip`'d with a comment pointing to live smoke. Read-path tests run normally.
- One thing to watch: PM2 reload during a fire-and-forget `processEmbeddings` (post-create-text/pdf flow) could orphan an in-flight kb row. Out of scope for this pass; pattern is the same as the automation run-job durability fix from earlier today (see automation_flow_fixes_2026-05-11.md if needed).
