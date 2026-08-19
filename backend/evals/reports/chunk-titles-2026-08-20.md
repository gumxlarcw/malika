# Chunk title correction — 2026-08-20

21,421 of 27,761 chunk titles (77%) named the wrong table. They now name the right
one. **This fixes citations, not retrieval** — the measured retrieval effect is
approximately zero, and that is reported here rather than glossed.

## Three defects, one of them mine to find

`enrich-chunk-titles.js` estimated a chunk's position as `chunkIndex × 3600`,
assuming uniform chunk length. Observed lengths run 53–4,000 chars, so the estimate
drifts and the error accumulates. Measured on *Dalam Angka 2017*:

| chunk | assumed offset | actual | drift |
|---|---|---|---|
| 10 | 36,000 | 32,690 | −3,310 |
| 45 | 162,000 | 149,948 | −12,052 |
| 157 | 565,200 | 526,751 | −38,449 |
| worst across the document | | | **−278,476 (~77 chunks)** |

It then chose the last caption appearing before the chunk *ended*, so a chunk made of
Table A's rows was renamed after Table B whenever B's caption fell inside it.

A third hypothesis — that captions were resolving to the table of contents rather
than the body — was **tested and refuted**: "Tabel 3.1.4" occurs exactly once, at
151,970, which is the body position. The TOC line omits the word "Tabel" so the
pattern never matches it. Caption mapping was sound.

## The rule now

Offsets are found by locating the chunk's own opening text in the parent, not
estimated. The title then names the captions the chunk **physically carries**, because
a caption inside the chunk is a fact about the text while a carried-over section is an
inference. Chunks with no caption of their own fall back to the covering section.

Verified on the chunk holding the 2016 density figure (`1957,34`):

| | title |
|---|---|
| was | Tabel 3.2.11: **Jumlah Pencari Kerja** |
| now | Tabel 3.1.3: Jumlah Penduduk…; **Tabel 3.1.4: Distribusi dan Kepadatan** |

## Measured effect on retrieval: none

| | cosine vs "kepadatan penduduk Kota Ternate 2016" |
|---|---|
| old (wrong) title | 0.7990 |
| **new title** | **0.8002** |
| no title at all | 0.7971 |
| the document currently ranked #1 | 0.8706 |

**+0.0012.** An earlier probe suggested +0.042, but that used a hand-written ideal
title; the generated one leads with the irrelevant sibling table 3.1.3 and truncates
3.1.4's label, and most of the gain disappears.

Eval, period re-rank mode: **9/15 recall@10, MRR 0.389**, against 10/15 / 0.398
before. That is inside the ±1-case noise band established earlier, so this is "no
change", not "a regression" — but it is certainly not an improvement.

## Effect on period parsing: small, mostly positive

Compared exactly, before against after, across all 21,421 changed titles:

| | count |
|---|---|
| period gained (was undated, now dated) | 63 |
| period moved | 130 |
| period **lost** | 6 |
| total changed | 199 (**0.93%**) |

Live regression check unchanged: `penduduk miskin Maret 2025` → **5,81 persen**.

## Why it was still worth doing

The system was citing *"Tabel 3.2.11: Jumlah Pencari Kerja"* as the source of a
population-density figure. For a statistics agency that is a trust problem
independent of ranking: the number was right and the attribution was wrong. 77% of
chunks carried a wrong attribution and now do not.

It also feeds `documentJudge`, which sees titles in its candidate list, and any future
reranker — both make better decisions with honest labels.

## Rollback and caveats

- Every prior title is preserved at
  `backend/backups/kb-titles-before-retitle-2026-08-20.json` (27,947 rows, 4.7 MB,
  not tracked in git). Restoring is an id→title replay.
- **The live embeddings still encode the old titles.** Only the stored/displayed title
  changed. That mismatch is deliberate: re-embedding 21,421 rows costs hours and buys
  +0.0012 cosine. Citations are correct now; the vectors are unchanged.
- `retrieval_chunks_rebuild` is **not** synced — the update hit a lock wait timeout
  while the live sync held the rows, and the shadow is not in use. It must be synced
  before that table is ever considered for cutover.
- 11 chunks could not be located in their parent (text no longer matches) and kept
  their old titles.
