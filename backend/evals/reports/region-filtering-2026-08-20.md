# Region filtering — rejected on corpus structure — 2026-08-20

Not built. Region cannot discriminate documents in this corpus, and filtering on it
would make the known failure worse. Two corpus facts settle it, independent of any
ranking measurement.

## Fact 1: the answer documents do not name the region

Of the 15 labelled cases, 3 name a kabupaten/kota. For **all 3**, the document that
actually contains the answer has a title that does **not** mention that region:

| case | region asked | correct doc title carries it? |
|---|---|---|
| kepadatan-ternate-2016 | Ternate | **no** (4 answer docs) |
| penduduk-ternate-2016 | Ternate | **no** (33 answer docs) |
| kepadatan-halbar-2016 | Halmahera Barat | **no** (6 answer docs) |

The reason is structural: BPS publishes **province-level documents containing
all-region tables**. The answer for Kota Ternate lives in a row of a table inside
*"Provinsi Maluku Utara Dalam Angka 2017"*. Region is a property of a row, not of a
document — so it cannot separate documents.

## Fact 2: region in a title correlates with the wrong answer

93.9% of knowledge titles contain "Maluku Utara" — useless as a filter. The
kabupaten/kota names are discriminative in titles (Ternate 6.6%, Tidore 0.7%,
Halmahera Barat 0.3%) but they point the wrong way:

| what the 1,925 "Ternate"-titled chunks are | |
|---|---|
| inflation / price publications | **1,372 (71%)** |

Kota Ternate is the IHK reference city, so BPS inflation releases are titled *"Inflasi
Kota Ternate …"*. Boosting a title match on "Ternate" therefore promotes inflation
documents — which is precisely the failure already on record: for `kepadatan penduduk
Kota Ternate 2016`, *"Inflasi Kota Ternate 2017"* already outranks the density table
by cosine. Region boosting would widen that gap, not close it.

## Measured

Demoting documents whose title names a **different** region than asked (the only form
that is not actively counter-productive) was measured against an otherwise identical
pipeline: **byte-identical results** — r@10 8/15, MRR 0.302 both arms. It never fires,
because a wrong-region document rarely competes; the competitor usually names the
*right* region while being about the wrong subject.

## A measurement problem found along the way

Two ad-hoc comparison scripts produced different baselines — 11/15 and 8/15 — for what
should have been equivalent configurations. The committed harness
(`evals/retrieval-eval.js`) is deterministic: four consecutive runs gave identical
recall@10 and MRR to three decimals. The inconsistency is in the throwaway scripts,
not the data.

**Consequence: fine-grained conclusions from ad-hoc scripts in this and the
cross-encoder report should be treated as unverified.** The coarse ones survive,
because they rest on corpus facts or on large gaps:

- region filtering is counter-indicated — rests on Facts 1 and 2, not on ranking
- the cross-encoder is 30× slower — rests on a 12–16 s vs 0.4 s latency gap

## What to do instead

Four levers have now been tested and none moved the number: full-coverage re-chunking,
title correction, cross-encoder reranking, region filtering. Only the period re-rank
ever worked. Continuing to test levers against a 15-case set measured by ad-hoc
scripts is not going to resolve anything.

**Fix the measurement first:**

1. Expand the labelled set to 50+, weighted toward the cases that fail — the four
   `deep-body` cases are the whole point and the set has only four of them.
2. Make document-level evaluation a first-class mode of `retrieval-eval.js`
   (`--level doc`), so every comparison runs through one deterministic harness
   instead of a new script each time. Every ad-hoc script written today was a chance
   to introduce exactly the tie-breaking bug that was introduced.
3. Only then test the remaining lever with real prospects: **a stronger bi-encoder**.
   The cross-encoder proved the discrimination gap is closable by a better model
   (+4.520 vs −7.502 where cosine has the ordering backwards); a better bi-encoder
   closes it at index time with no per-query cost, which a reranker cannot.
