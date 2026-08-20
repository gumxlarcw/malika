# Handoff — accuracy, and making the 9-step flow real

> Written 2026-08-20 while the bge-m3 re-index runs. Two threads for the next
> session: finish the accuracy work that is in flight, and make the 9-step chat
> flow substantive rather than decorative.

## In flight right now

**bge-m3 re-index** → `retrieval_chunks_bge`, ~11 h at 45 rows/min.

```bash
sudo sh backend/scripts/reindex-monitor.sh          # live progress
cd backend && sudo -n sh -c 'setsid nohup nice -n 10 env EMBEDDING_MODEL_ID=Xenova/bge-m3 node scripts/reindex-embeddings.js >> backups/reindex-bge.log 2>&1 < /dev/null &'   # resume
```

Resumable, checkpointed in the database, live index untouched. **Nothing switches
automatically** — `EMBEDDING_MODEL_ID` is deliberately absent from `.env`, so
production stays on e5-base until someone sets it and reloads.

### When it finishes, in this order

1. `cd backend && node evals/retrieval-eval.js --table retrieval_chunks_bge --level doc --period --pool 200`
2. Compare against the production baseline: **recall@10 38–40%, MRR 0.203–0.213**.
   Differences under ~2 cases are noise — run each arm 2–3 times.
3. Only if it wins: `node scripts/reindex-embeddings.js --cutover`, then set
   `EMBEDDING_MODEL_ID=Xenova/bge-m3` in `backend/.env` and reload `pds-backend`.
   `--rollback` reverses the rename; the old index is kept as `retrieval_chunks_old`.

**The 60%/80% figure is not the number to expect.** That test force-included the
answer documents, isolating ranking from retrieval. The honest read is "bge-m3
orders far better than e5-base"; whether that survives real retrieval is exactly
what step 1 measures.

## Thread 2 — the 9-step flow is structurally honest and substantively thin

This is the more interesting problem, and the framing "not only gimmick" is correct.

**What is real:** nine `status` events fire at nine genuine pipeline transitions,
in order, verified live (`normalize dna search preview knowledge thinking deepdive
generating format`). The rail draws all nine from second 0, marks pending ones
MENUNGGU, and brackets 3–5 as parallel. No step is inferred from timing.

**What is missing.** Every status event is `{ message, stage }` and nothing else:

| the design shows | backend sends |
|---|---|
| per-step elapsed (`0,4s`, `1,1s`, `3,1s`) | nothing — the rail has no timings |
| per-step findings (`12 indikator cocok · skor tertinggi 0,91`) | nothing — `detail` is never populated |
| nested tool calls (`search_data 0,9s`, `get_data_preview 1,2s`) | **zero `tool_call` events in the stream** |
| result chips (`Tabel 11 baris × 6 kolom siap`) | nothing |

`ProcessStepLike` already has a `detail` field and `ProgressRail` already renders
it (`<Detail>`); the frontend is waiting for data the backend does not send. So the
panel currently proves *that* work happened, never *what* it found — which is the
difference between a progress bar and an audit trail.

### What would make it real

1. **Populate `detail` on each status event** from values already in scope at the
   emit site — the resolved geo/year for `normalize`, candidate count and top score
   for `search`, table dimensions for `preview`, document count for `knowledge`,
   token count for `thinking`. All of this exists as local variables already; none
   of it needs new work, only passing.
2. **Emit a `done` status per stage** carrying elapsed. Currently a stage is
   inferred complete because a later one started (`buildRail` does this), which is
   why no row can show its own duration.
3. **Emit `tool_call` events.** The chat path does real tool-shaped work —
   `search_data`, `get_data_preview` — but never announces it. `ToolCallCard.tsx`
   and `UnifiedActivityFeed.tsx` already exist to render these and are wired to a
   different surface. This is the largest gap and the one that turns the rail into
   a genuine trace.
4. **Persisted panel parity.** `ThinkingFeed` (history replay) is not given the
   steps at all, so a restored conversation shows no rail. The design's finished
   state (`paham 0,4 / cari 3,1 / analisis 8,2 / susun 4,3`) needs per-step
   durations threaded through persistence.

## What was measured this session, so it is not retried

| lever | outcome |
|---|---|
| re-chunk to 100% embedding coverage (14 h) | **no gain** — coverage was never the constraint |
| fix 21,421 corrupted chunk titles | **+0.0012 cosine** — fixed citations, not ranking |
| cross-encoder reranker (bge-reranker-base) | **worse** than the period re-rank, 30× slower |
| region filtering | rejected on corpus structure |
| **period-aware selection** | **recall@10 33% → 67%** — the one lever that worked |
| **bge-m3 vs e5-base** (ranking only) | recall@10 60% → 80%, MRR 0.258 → 0.338 |

The pattern: on this corpus, **query understanding and metadata filters beat heavier
models**. Statistical questions are dominated by period, region and indicator —
structured facts you can filter on, not semantics to infer. Every heavier-model
lever landed inside the noise band except bge-m3, and that one is still unproven
against real retrieval.

Reports: `backend/evals/reports/` — `rechunk-outcome`, `cross-encoder`,
`chunk-titles`, `retrieval-period`, `retrieval-baseline-50`.

## Standing facts worth not rediscovering

- **Measure with the committed harness, not a fresh script.** An ad-hoc comparison
  bug moved a baseline by two cases this session. `retrieval-eval.js` takes
  `--table`, `--level doc`, `--period`, `--pool`.
- **Chunk-level and document-level scores are not comparable across indexes** with
  different chunk sizes. Use `--level doc`.
- **The eval is not perfectly deterministic** at pool 200 (±1 case, HNSW is
  approximate). 50 cases cannot resolve anything under ~4%.
- **The serving model is set in the proxy, not the backend.** `backend/.env` names
  `claude-sonnet-4-6` for every role and the proxy ignores it;
  `/opt/malika-llm-proxy/.env` `PROXY_PRIMARY_TIER` decides, currently DeepSeek.
- **The number-grounding guard does not protect production.**
  `cleanAssistantTextAgainstDb` is called only from `chat.service.js`; production
  serves via `streamChatResponse`, which never calls it.
- **DNA Nucleus is 1,336 lines with zero live callers** — still queued, unmeasured.
- CI has been `startup_failure` since 2026-05-08. The local suite (674 passing) is
  the only gate.
- Long jobs must be `setsid nohup` and checkpointed. A session restart and a power
  outage each killed one this session; the checkpointed ones lost nothing.
