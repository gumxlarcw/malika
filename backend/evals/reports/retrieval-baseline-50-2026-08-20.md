# Retrieval baseline — 50 cases, document level — 2026-08-20

Replaces `retrieval-baseline-2026-08-19.md` as the reference point. Two things
changed: the labelled set went from 15 cases to 50, and the harness gained a
document-level mode so comparisons no longer need a throwaway script each time.

```bash
cd backend && node evals/retrieval-eval.js --level doc --period --pool 200
```

## Baseline

| metric | vector only | **period re-rank** |
|---|---|---|
| recall@5 | 22.0% (11/50) | **34.0%** (17/50) |
| recall@10 | 32.0% (16/50) | **38–40%** (19–20/50) |
| MRR | 0.147 | **0.203–0.213** |

| difficulty | cases | recall@10 (period) |
|---|---|---|
| **deep-body** | **39** | **10/39 (26%)** |
| body | 5 | 5/5 |
| headline | 6 | 4/6 |

The period re-rank remains the only lever that has ever moved this number, and it
still does at 50 cases: recall@10 32% → 38%, MRR 0.147 → 0.203.

The honest headline is the deep-body row. **26% of deep-document questions succeed.**
The old set contained four such cases and reported 1/4; it could not distinguish a
win from a loss. Now there are 39.

## Why document level

Chunk level asks whether one retrieved row contained the answer. That is not
comparable across indexes with different chunk sizes — after the re-chunk a row is
~1,360 chars where it was ~3,500, so the same predicate gets strictly harder for
reasons unrelated to retrieval quality. It is what made the rebuilt index look worse
than it was.

Document level asks whether the right *document* surfaced, collapsing a document's
windows to its best match — the order the chat path actually consumes. Ground truth is
built from `knowledge_base` content, so it is identical regardless of how the index is
chunked.

## How the 35 new cases were built

Mined from the corpus, not invented. Each pairs a figure found **past offset 1500** of
its chunk — the region the old embedding window never reached — with a distinctive word
from the same table caption, so the pair identifies one table unambiguously. Ten
further candidates were generated and dropped because no single document contained
both strings; the validator rejected them before they could enter the set.

All 50 pass the random-baseline check (a predicate loose enough for chance to satisfy
is rejected — the criterion, not a raw match cap).

## Variance — read before trusting a small difference

Two consecutive runs of the identical configuration gave **20/50 and 19/50**
(MRR 0.213 and 0.212). The vector index is approximate, and at pool 200 the candidate
set is not perfectly stable.

**Treat differences below ~2 cases (4%) as noise.** For close comparisons, run each arm
2–3 times and report the range rather than a single figure. A 15-case set could not
resolve anything under ~13%; this one still cannot resolve anything under ~4%.

## Method note

Every ad-hoc comparison script written on 2026-08-20 was an opportunity to introduce a
harness bug, and one did: two arms differed in whether they re-sorted before ranking,
which changed tie-breaking and moved the baseline by two cases. That is why
`--level doc` now lives in the committed tool. **Comparisons should go through
`retrieval-eval.js` with flags, not through a new script.**
