# Cross-encoder reranker — evaluated and rejected — 2026-08-20

`Xenova/bge-reranker-base` was tested as the replacement for `documentJudge`. It
**discriminates beautifully and still loses to the period re-rank we already ship**,
at 30–40× the latency. Not adopted. No production code was written.

## It does discriminate

Scored against `kepadatan penduduk Kota Ternate tahun 2016`:

| document | logit |
|---|---|
| Tabel 3.1.4 Distribusi dan Kepadatan Penduduk … 2016 | **+4.520** |
| Jumlah penduduk Kota Ternate 2016 (218 028) | +1.611 |
| Sensus Pertanian 2023 | −6.960 |
| **Inflasi Kota Ternate 2017** — *the document cosine currently ranks #1* | **−7.502** |

A 12-point separation between the right table and the inflation document that the
bi-encoder puts first. The capability gap identified in `rechunk-outcome` is real and
this model closes it.

## And it still loses

Same 15 cases, same candidate pool, document-level:

| mode | r@3 | r@5 | r@10 | MRR | latency |
|---|---|---|---|---|---|
| **period re-rank only** *(shipping today)* | **9/15** | 10/15 | **12/15** | **0.478** | **0.4 s** |
| cross-encoder only | 7/15 | 8/15 | 8/15 | 0.291 | 12.6 s |
| period → cross-encoder | 8/15 | 11/15 | 11/15 | 0.402 | 15.9 s |
| cross-encoder → period | 6/15 | 8/15 | 8/15 | 0.286 | 15.6 s |

Only r@5 improves (10 → 11), and that is inside the ±1-case noise band. Every other
measure is worse, and the cost is 12–16 s per query against 0.4 s.

## The mistake worth recording

The first measurement looked like a clear win — recall@5 **3/15 → 7/15**, recall@10
5 → 8, MRR 0.154 → 0.236. That comparison was against **raw cosine order**, which is
not what production does. Against the actual shipping ranking the result reverses.

A reranker is only ever as good as the baseline you measure it against. Comparing to
the strawman nearly bought a 15-second regression.

## Why it is slow here

`bge-reranker-base` is 278M parameters on a 4-core i5-4590T with no AVX-512:

| max_length | per pair | 25 candidates |
|---|---|---|
| 512 | 1,145 ms | 28.6 s |
| 256 | 485 ms | 12.1 s |
| 192 | 414 ms | 10.3 s |
| 128 | 235 ms | 5.9 s |

Truncation buys speed and costs accuracy — at 128 tokens recall@10 falls from 8/15
back to 6/15, because the answer is often past the first 128 tokens. There is no
setting that is both fast and accurate on this hardware.

## Operational note

The tokenizer recurses per token and **overflows its stack** on long inputs — a
`knowledge_doc` row of 500k chars crashes it with `RangeError: Maximum call stack size
exceeded`. Any future use needs a character-level pre-truncate (3,000 chars is a safe
ceiling for a 512-token budget) before the tokenizer is called.

## What this means for the queue

Three of the four levers from the accuracy queue have now been measured and none moved
the number:

| lever | outcome |
|---|---|
| re-chunk for full coverage | no gain — coverage was not the constraint |
| fix corrupted chunk titles | +0.0012 cosine — fixed citations, not ranking |
| cross-encoder reranker | worse than the period re-rank, 30× slower |

The one lever that *did* work remains the period re-rank (recall@10 33% → 67% when it
shipped). That is a signal about where the remaining wins are: **query understanding
and metadata filters beat heavier models on this corpus.** Statistical questions are
dominated by period, region and indicator — all of which are structured facts that can
be filtered on, not semantics to be inferred.

Recommended next, in order:

1. **Region filtering**, the exact analogue of the period fix. `geoInference` already
   resolves the region; retrieval does not use it.
2. **Indicator filtering** using `indicator_meta`, likewise already parsed and unused.
3. Re-test a stronger *embedding* model (not a reranker) — the discrimination gap is
   in the bi-encoder, and unlike a reranker it costs nothing per query.
4. DNA Nucleus for metadata questions — still queued, still unmeasured.
