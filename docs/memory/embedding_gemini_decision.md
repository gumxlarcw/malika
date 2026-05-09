---
name: Embedding Provider Decision — Self-Hosted e5-base
description: 2026-05-09 evolution: Gemini-only → e5-large fallback → e5-base (768d) self-hosted via @xenova/transformers. Driven by Gemini key suspensions (3 of 10 keys gone) + i5-4590T performance reality. Final pick: e5-base for 30× speedup over e5-large at acceptable score loss.
type: project
originSessionId: 37e1fd58-1485-413f-bec5-fe58210c8f74
---

# UPDATE 2026-05-09 (later in day)

The Gemini-only plan in this file was attempted and FAILED:

1. Aggressive 10-way concurrent backfill burned through free-tier daily quotas in minutes.
2. **3 of 10 Gemini API keys got permanently SUSPENDED** (not just rate-limited):
   - `AIzaSyBi7yfNt0pRL61Jh6bTZboZYRniolTcnig`
   - `AIzaSyCUjrgYS1PLFq6mSB6oq1-BTmxxzL2Q7Ss`
   - `AIzaSyDTKxBUEA8czHXTtR71PUgyJ03STtXAGxM`
3. Other 7 keys hit daily quota — needs 24h cooldown each.

Pivoted to **self-hosted via `@xenova/transformers`** (ONNX runtime in Node).

## Final pick: `Xenova/multilingual-e5-base` @ 768d

**Why not e5-large-instruct (originally chosen after Gemini failed)**:
- HF gated 401 on `Xenova/multilingual-e5-large-instruct/tokenizer.json` (auth required for download)
- Fallback `Xenova/multilingual-e5-large` runs at **23 rows/min on i5-4590T** → 20-hour ETA, impractical
- Even with Metabase stopped (1.1 GB freed), the 1.3 GB resident model + ONNX runtime overhead pushes swap to 5.7 GB
- Smoke test on long inputs: ~1500 ms/inference. Unworkable for backfill or real-time chat.

**Why e5-base wins on this hardware**:
- Smoke test: warm passage embed **48-69 ms** (30× faster than e5-large)
- Resident: ~280 MB INT8 quantized (vs 1.3 GB)
- Schema: VECTOR(768) — same as original Gemini plan, no change required
- Cosine similarity 0.85+ on relevant Indonesian BPS query/passage pairs — semantic quality validated
- ETA: ~52 min for full 28K backfill (CONCURRENCY=1, ONNX uses all 4 cores per single inference)

**Score expectations**:
- MIRACL Indonesian nDCG@10: ~68 (vs e5-large ~72, vs Gemini ~78, vs OpenAI 3072d ~64)
- Estimated deep-doc regression suite: 17-19/21 (historical: 20/21 with OpenAI 3072d)
- The ~3 MTEB drop vs e5-large is largely absorbed by `documentJudge.service.js` reranker

## Service implementation

`backend/src/services/bpsMetadata/embedding.service.js`:
- Primary: `Xenova/multilingual-e5-base` (768d, INT8 quantized via `quantized: true`)
- Fallback: `Xenova/multilingual-e5-small` (384d — note dim mismatch, would require schema change, only triggers if base download fails)
- FP32 not viable: e5 unquantized has external `.onnx_data` shard that @xenova/transformers v2.17.2 does not fetch
- Prompts: `passage: {text}` for indexing, `query: {text}` for chat-time
- Input chars cap: **1500** (~370 tokens, well under e5's 512 limit; avoids wasting CPU on text the model would truncate anyway)

## Metabase status (memory pressure mitigation)

Stopped via `pm2 stop metabase` + `pm2 save` (kept registered in PM2 list, no auto-restart, no resurrect on boot). Frees ~1.1 GB RAM. To restart manually: `pm2 start metabase`. User explicitly chose temporary disable, not permanent removal.

## Backfill orchestration learned the hard way

1. **DO NOT run backfill + repack in parallel** — both load their own model copy (2 × 280 MB or 2 × 1.3 GB), thrashes swap, halves throughput.
2. **CONCURRENCY=1 in the script, not 3 or 10** — ONNX runtime auto-parallelizes across all CPU cores per inference. Multiple JS workers serialize at the runtime layer and just add memory pressure.
3. **Set `MAX_INPUT_CHARS = 1500`** in the embedding service — long inputs get truncated by the tokenizer to 512 tokens anyway; passing 8000 chars wastes tokenization time.
4. Backfill writes through `embedPassage` (passage prefix). Chat queries use `embedQuery` (query prefix). E5 family demands these prefixes — skipping drops recall ~3-4 points.

## Recovery if e5-base proves inadequate later

- Upgrade to e5-large with patience: change MODEL_ID, ALTER VECTOR(768)→1024, TRUNCATE, re-backfill (would take ~20h on this server, or migrate to a beefier server first)
- Wait for Gemini quotas to reset (24h+) and retry with strict CONCURRENCY=1 + throttle=2s
- Try `Xenova/bge-m3` (multilingual SOTA, 1024d, reportedly ~10% faster than e5-large at similar quality)

---

# (Original 2026-05-09 Gemini-only plan retained below for historical context — superseded by update above)

---

# Embedding Provider Decision — Gemini Only (2026-05-09, original)

> **Why:** User budget constraint — no more spend on OpenAI or any paid embedding API. Available infra is malika-llm-proxy on PM2 (running) + the existing 10-key Google API pool at `/opt/openclaw/malika-llm-proxy.config.js`.
> **How to apply:** Treat `services/bpsMetadata/embedding.service.js` (Gemini `gemini-embedding-001` @ 768d) as the single source of truth for embedding generation. Any new code that calls OpenAI text-embedding-* is wrong — flag and redirect to the Gemini wrapper.

## What changed

- **Provider**: OpenAI `text-embedding-3-large/small` → Gemini `gemini-embedding-001`
- **Dim**: 3072 (or 1536 stragglers) → 768
- **Cost**: $0.13/M tokens → $0 (free tier, 10M tokens/min/key × 10 keys)
- **Service location**: `services/ai/embedding.service.js` becomes a thin wrapper that re-exports `services/bpsMetadata/embedding.service.js`. Direct imports of the old path keep working.

## Live data delta

| Store | Before | After C4/C5 |
|---|---|---|
| `data_sources.embedding` (313) | 3072 OpenAI | 768 Gemini in `retrieval_chunks` (re-embed) |
| `knowledge_base.embedding` (28,103) | 3072 OpenAI (×28102) + 1536 (×1) | 768 Gemini in `retrieval_chunks` (re-embed) |
| `indicator_meta.embedding` (302) | 768 Gemini | 768 Gemini in `retrieval_chunks` (repack — no API call) |
| `chat_threads.embedding` (1) | 1536 OpenAI | abandoned (skip — likely test row) |

The original 3072d OpenAI vectors in `knowledge_base` and `data_sources` are **abandoned in place** during the soak window; they're dropped by the Phase C8 migration once retrieval_chunks is canonical.

## Why Gemini works at our scale

- **Free tier**: 10M tokens/min per project. 10 keys = effectively unlimited for 14M-token one-time backfill (28K rows × ~500 tokens).
- **Multilingual**: Gemini embeddings are competitive with OpenAI text-embedding-3-large on Indonesian-language MTEB tasks (BPS data is Indonesian-heavy).
- **Already proven**: 302 `indicator_meta` rows successfully embedded by this exact service.
- **Retry/rotation built in**: `nextKey()` cursor rotates across keys; 429/403 trigger key skip.

## Implementation invariants (must not violate)

1. **Never mix embedding models in one VECTOR INDEX.** All 28,415 retrieval_chunks rows use `embedding_model='gemini-embedding-001'`. The column is enforced NOT NULL so a future OpenAI escapee would fail to insert without explicit kind.
2. **Always use `taskType: 'SEMANTIC_SIMILARITY'`** when calling Gemini. The existing service does. Mixing task types degrades recall.
3. **Throttle backfill to 80 ms per call.** With 10-key round-robin that's ~50 req/sec aggregate, well under per-key quotas.
4. **The legacy retrieval path is dead the moment C1 lands.** Once `services/ai/embedding.service.js` returns 768d Gemini vectors, the in-memory cache built from old 3072d OpenAI vectors becomes incompatible. There is no soak window — Phase C7 must default `USE_UNIFIED_RETRIEVAL=true` and pass the regression suite on first try.

## File-of-truth

`services/bpsMetadata/embedding.service.js` (despite its name suggesting BPS-specific scope, it is *the* embedding generator for the whole project after this change). The docstring on line 4 mentions "text-embedding-004" — that's a stale comment; the constant on line 18 is correct: `MODEL = 'gemini-embedding-001'`.

## Recovery path (if Gemini ever throttles or revokes keys)

The codebase still has OpenAI HTTP plumbing in `services/ai/embedding.service.js.backup` (Task C1 backup). To revive:
1. `cp services/ai/embedding.service.js.backup services/ai/embedding.service.js`
2. Re-embed everything at 3072d via OpenAI → costs ~$2 for one-time backfill.
3. Update `retrieval_chunks` schema to `VECTOR(3072)` via a new migration.
But: prefer self-hosting (e.g. multilingual-e5-small @ 384d via Python service or @xenova/transformers in Node) over re-paying OpenAI.
