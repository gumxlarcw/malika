# Re-chunk outcome — 2026-08-20

**The rebuild completed successfully and must not be cut over.** It fixed the defect
it targeted and did not improve retrieval, because that defect was not the binding
constraint. This is a negative result, recorded in full.

## What was built

27,981 documents → **81,762 windows**, 0 failures, 13.7 h. Verified on a 1,200-window
sample: **0 windows over the 512-token limit** (max 480, mean 410 = 80% of budget).

| | before | after |
|---|---|---|
| corpus text with any vector representation | 42.5% | **100%** |
| windows exceeding the model's token limit | 98.1% of chunks truncated | 0 |
| rows | 29,933 | 82,380 |
| table size | 1,018 MB | 438 MB (1,334 redundant parents dropped) |

The stated goal was met exactly. The 57.5%-invisible finding was real and is now fixed.

## Measured result: no improvement

Document-level, mirroring production order (dedupe windows → rank → top 10), pool 200:

| index | recall@5 | recall@10 | MRR |
|---|---|---|---|
| live (1 row/doc) | 8–9/15 | **11–12/15** | 0.355–0.375 |
| rebuilt (all windows) | 6–7/15 | 9/15 | 0.347–0.373 |
| rebuilt (first window only) | 7/15 | 8/15 | 0.273 |

MRR is a wash; recall@10 is 2–3 cases worse. Run-to-run variation on this set is ±1
case, so the gap is small — but there is certainly no demonstrated gain.

Two hypotheses tested and **refuted** along the way:

- *Window dilution* — that extra windows crowd the pool. Restricting to first windows
  is **worse** (8/15 vs 9/15), so the added windows do help, just not enough.
- *Dropped `keywords` field* — the old index embedded `title + keywords + content`.
  Measured: `keywords` is empty for **all 27,947** children. Not a factor.

## The decisive test: it did not fix the motivating case

`"jumlah penduduk Kota Ternate tahun 2016"` (answer `218 028`, previously at offset
3,204 — beyond the old window and therefore never embedded):

| index | rank of the chunk holding the answer |
|---|---|
| live | not in top 200 |
| **rebuilt** | **not in top 200** |

Same for `kepadatan … 2016` / `1957,34`. The text is now embedded and still unreachable.

## Why — the actual binding constraint

Cosine similarity of the query `kepadatan penduduk Kota Ternate tahun 2016` against
the window that holds the answer:

| variant | cosine |
|---|---|
| as indexed (with its corrupted title) | 0.7852 |
| with the **correct** title | 0.8276 |
| content only, no title | 0.8179 |
| **what currently ranks #1**: *"Inflasi Kota Ternate 2017 — Tabel 82: JAYA"* | **0.8706** |

Three things follow.

1. **The corrupted title actively harms it** — 0.7852 with the wrong title versus
   0.8179 with no title at all. Naming the chunk after the wrong table costs 0.033.
2. **Fixing the title is necessary but not sufficient.** The correct title gains
   0.042 and still loses to an inflation document by 0.043.
3. **e5-base cannot discriminate this corpus.** A document about *inflation* outranks
   the actual population-density table for a population-density query, because both
   contain "Kota Ternate" and a year. No amount of chunking fixes a model that ranks
   them this way.

Naive keyword search does not rescue it either: chunk-scoped FULLTEXT for both queries
returned the target **outside the top 20**.

## What this changes

The scope document deprioritised replacing the embedding model, reasoning that the
~4-point nDCG gap between e5-base and e5-large shrinks to ~2 points once a reranker is
applied. **That judgement now looks wrong**, and this is the correction: the gap being
measured here is not 2 points of nDCG, it is a semantically wrong document winning by
0.043 cosine.

Revised priorities:

1. **Reranking over a wide pool.** The target sits at rank ~19–22 within a 200-candidate
   pool in both indexes — it *is* retrieved, just not ranked. A cross-encoder
   (bge-reranker-v2-m3) over the top 50–200 is the cheapest path to surfacing it, and
   needs no re-embedding. Test against both indexes; finer windows may favour it.
2. **Fix the corrupted chunk titles.** Worth 0.033–0.042 cosine and it fixes wrong
   citations regardless.
3. **Re-evaluate the embedding model.** Measure e5-large (or a stronger multilingual
   retriever) on this same 15-case set before committing to another long rebuild.
4. Hybrid keyword lane — still worth having for exact figures, but demoted: naive
   FULLTEXT did not find these cases.

## Disposition

- **No cutover.** `retrieval_chunks` is untouched and still serving.
- The shadow table is **kept** (438 MB) — it is paid for, its MRR is comparable, and it
  is the better substrate for a reranker experiment since its windows are precise.
- `searchRetrieval` now accepts a whitelisted `table` option, and
  `evals/retrieval-eval.js` a `--table` flag, so any future rebuild can be measured
  before it goes live rather than after.

## Honest note on the eval

15 cases cannot resolve a 2-case difference. Before the next long rebuild the labelled
set should be 50+, and it should include cases whose answers sit deep in a document —
the four `deep-body` cases are 0/4 on **both** indexes, which means the harness cannot
currently tell a deep-document win from a deep-document loss.
