# Period-aware re-rank — 2026-08-19

Compared against `retrieval-baseline-2026-08-19.md` on the same 15 labelled cases.

```bash
cd backend && node evals/retrieval-eval.js                      # baseline
cd backend && node evals/retrieval-eval.js --period --pool 50   # with re-rank
```

| metric | baseline | period re-rank |
|---|---|---|
| recall@5 | 26.7% (4/15) | **60.0%** (9/15) |
| recall@10 | 33.3% (5/15) | **66.7%** (10/15) |
| MRR | 0.141 | **0.398** |
| mean spread@10 | 0.0087 | 0.0086 *(unchanged — see below)* |

| difficulty | baseline | period re-rank |
|---|---|---|
| deep-body | 0 / 4 | 1 / 4 |
| body | 2 / 5 | **5 / 5** |
| headline | 3 / 6 | 4 / 6 |

The spread is deliberately unchanged: it is measured on the **raw** vector order in
both modes. A re-rank promotes a lower-similarity document, so measuring spread
after it would report a negative number and look like improved discrimination when
nothing about the lane changed. The lane is exactly as undiscriminating as before —
this change works around that, it does not fix it.

## How the band was set

Not chosen: measured. Over the 15 cases the document that actually answers is always
within **0.021** cosine of the top hit (median 0.0098), so promotion is capped at a
0.03 band. Beyond that a period match is not a near-miss on ranking — it is a
different subject that happens to share a year.

## The compendium rule

BPS titles annual compendia by publication year while they report the year before.
Verified across six editions of *Provinsi Maluku Utara Dalam Angka* — in every one
the year before the title dominates the text roughly 2:1:

| edition | Y-2 | Y-1 | Y |
|---|---|---|---|
| 2019 | 377 | **1231** | 571 |
| 2021 | 625 | **1170** | 638 |
| 2023 | 801 | **1341** | 691 |
| 2024 | 898 | **1535** | 768 |
| 2025 | 1030 | **1588** | 721 |
| 2026 | 977 | **1685** | 809 |

So `year + 1` counts as the asked year. Scoring it as a mismatch pushed the chunk
holding the 2016 population table from rank 11 down to 23.

Nothing is scored below neutral. Demoting a stated mismatch changed no case on the
labelled set and risks exactly the failure above, so a document is never pushed down
for its period — only pulled up.

## Verified live

`berapa persentase penduduk miskin Maluku Utara Maret 2025` → **5,81 persen**.
Before this change the same question was answered from the **Maret 2021** release.

## What this does not fix, and the new binding constraint

`komoditas … garis kemiskinan perkotaan Maret 2025` still answers from *Profil
Kemiskinan Maret 2026*. The cause is downstream of retrieval and downstream of this
change:

`vectorSearch.searchKnowledge` does not return `topN`. It asks the index for
`topN * 4` and hands the result to the **documentJudge LLM reranker**, which emits at
most **10** documents however many it was asked for. For that query the judge's own
recorded reasoning is *"Prioritas diberikan pada BRS Maret 2026 … BRS Maret 2025 dan
publikasi …"* — it dropped the Maret 2025 commodity chunk from its output entirely.
Period selection cannot promote a document that is no longer in the list.

**The judge is now the binding constraint on this path, not pool width.** That is why
`KB_POOL_SIZE` is 10 and not 50: asking for 50 made the index return 200 rows and the
judge rank 200 of them to emit the same ten.

The eval measures the vector lane only, so it does not see the judge. Its numbers are
an upper bound on what the chat path receives — treat them as measuring retrieval, not
the pipeline.

## Caveats

- Retrieval itself is deterministic (5 identical runs, and `topN=10` equals the first
  10 of `topN=50`). Across the full 15-case set, occasional single-position moves are
  still seen; treat a one-case / ±0.01 MRR difference as noise. The effect reported
  here is far outside that.
- Latency through the judge could not be attributed to pool size — repeated
  measurements were dominated by LLM proxy variance (`topN=50` returned *faster* than
  `topN=10` on one pass). Any latency claim about this change would be unfounded.
- Unrelated, pre-existing: `kemiskinan Kota Ternate 2017` now answers with the poverty
  *indices* (P1 0,37 / P2 0,09) from "Indeks Kemiskinan Menurut Kabupaten/Kota" rather
  than the 2,73% / 6,04 ribu recorded as canonical in `chat-pipeline.md`. Confirmed by
  reverting this change and re-running: the behaviour is identical without it, so it
  predates this work and is not caused by it. Worth a separate look.
