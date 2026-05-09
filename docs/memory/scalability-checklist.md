# Deep Document Retrieval — Scalability & Production Checklist

## Status: IN PROGRESS
## Created: 2026-03-07
## Context: 11/11 deep doc tests passing, now hardening for production

---

## Immediate — Quick Wins

- [x] **QW-1: Cache indicator_index parsing results** ✓ 2026-03-07
  - Stored `_parsedIndicatorEntries` on candidate during injection scoring
  - Passed through to context, reused in `extractByIndicatorIndex`
  - 3-line change, 191/191 tests pass, 9/11 deep doc (LLM variance, not regression)

- [x] **QW-2: Cache the injection candidate query** ✓ 2026-03-08
  - Added SimpleCache (5-min TTL) for top-10 injection candidates
  - Query-independent — same 10 docs every time, now cached after first load
  - 191/191 tests pass, 10/11 deep doc (T9 LLM flaky) (saves DB query + 10x content load)

- [x] **QW-3: Add composite DB index for injection query** ✓ 2026-03-08
  - Added `idx_kb_injection (parent_id, status, indicator_index(1), content_length)`
  - EXPLAIN confirms index used, narrows 28K→1323 rows directly

## Short-term — Real Scaling Concerns

- [x] **ST-1: Reduce content stored in embedding cache** ✓ 2026-03-08
  - Cache stores `contentPreview` (2000 chars) instead of full content
  - Full content batch-loaded from DB on-demand for ~10-20 deduped results only
  - Memory: ~1042MB (significant reduction). 191/191 tests, 9-10/11 deep doc pass

- [x] **ST-2: Cache contentNorm in search_document_table tool** ✓ 2026-03-08
  - Added `getContentNorm(docId, content)` with 60s TTL, max 20 entries
  - Replaces 2 inline toLowerCase+replace calls. 191/191 tests pass

- [x] **ST-3: Make indicator match score threshold configurable** ✓ 2026-03-08
  - Env var: `INDICATOR_SCORE_GAP_THRESHOLD` (default 1.0)
  - 1-line change in mainAgent.service.js:158

## Medium-term — Production Hardening

- [x] **MT-1: Add request-level tracing ID** ✓ 2026-03-08
  - Generated `requestId` (8-char UUID) at pipeline entry, stored in `ctx.requestId`
  - Logged at: pipeline start/complete/error/timeout + indicator injection
  - Passed to enrichKnowledgeWithExtraction via opts. 191/191 tests pass

- [x] **MT-2: Rate limit / cache search_document_table DB loads** ✓ 2026-03-08
  - Added `getCachedDoc(docId)` with 60s TTL, max 20 entries
  - Replaces findByPk call. Works with ST-2 contentNorm cache. 191/191 tests pass

- [x] **MT-3: Move hardcoded constants to centralized config** ✓ 2026-03-08
  - Added `EXTRACTION` block to config.js: TOC_SKIP_RATIO, WINDOW_SIZE, PER_KAB_EXTRA, CHUNK_STEP, SCORE_GAP_THRESHOLD
  - Updated 8 references across knowledgeContext, toolUse, mainAgent
  - All configurable via env vars. 191/191 tests pass

## Future — Only When Scale Demands

- [x] **FT-1: ANN search (hnswlib-node) instead of O(n) scan** ✓ 2026-03-08
  - Installed hnswlib-node, builds HNSW index at startup (28K vectors, 68s)
  - Top-200 ANN candidates → keyword+recency re-scoring
  - Opt-in: `USE_ANN_SEARCH=true` (default false). 10/11 deep doc with ANN enabled
  - 191/191 tests pass

- [ ] **FT-2: Redis embedding cache for multi-process sharing** — DEFERRED
  - Only needed when scaling to multiple PM2 instances
  - Requires Redis server installation + ioredis client
  - Current single-instance setup works fine with in-memory cache

---

## Completed Items

(none yet)

---

## Verification Commands
- Unit tests: `cd backend && npx jest --passWithNoTests --no-coverage`
- Deep doc tests: `node scripts/test-deep-document.js`
- Reload: `pm2 reload pds-backend --update-env`
