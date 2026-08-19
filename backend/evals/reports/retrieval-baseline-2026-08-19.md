# Retrieval baseline — 2026-08-19

Vector-only lane (`retrieval.service.js` → `VEC_DISTANCE_COSINE` over `retrieval_chunks`),
before any deep-document work. Reproduce with:

```bash
cd backend && node evals/retrieval-eval.js
```

15 labelled cases, all verified to exist in the corpus, worst-case random recall@10 = 4.5%.

| metric | value |
|---|---|
| recall@5 | **26.7%** (4/15) |
| recall@10 | **33.3%** (5/15) |
| MRR | **0.141** |
| mean similarity@1 | 0.8805 |
| **mean spread@10** | **0.0090** |

| difficulty | recall@10 |
|---|---|
| deep-body (figure buried mid-chunk, title names another table) | **0 / 4** |
| body (figure in body, title related) | 2 / 5 |
| headline (figure in the title itself) | 3 / 6 |

## What the numbers say

**Deep-body is 0/4.** Every case where the answer sits past the 1,500-char embedding
window missed. This is the predicted consequence of 57.5% of chunk text having no vector
representation, and it is now measured rather than argued.

**The spread is 0.009.** The whole top-10 fits inside nine thousandths of cosine
similarity. At that width the ordering is not carrying much information, which is why
`kepadatan penduduk Kota Ternate 2016` returns *Inflasi Kota Ternate 2016* first: the
lane matches "Kota Ternate" and "2016" and has nothing left to separate topic with.
Any future change that lifts recall while leaving the spread flat should be treated as
luck until shown otherwise.

**Headline cases fail on period, not topic** — the unexpected finding. The figure is in
the title, embedded, and still:

| case | asked for | top-1 returned |
|---|---|---|
| `miskin-mar2025` | penduduk miskin **Maret 2025** | penduduk miskin **Maret 2021** |
| `miskin-sep2024` | penduduk miskin **September 2024** | Profil Kemiskinan **Maret 2023** |
| `ntp-okt2025` | NTP **Oktober 2025** | Keadaan Angkatan Kerja Agustus 2025 |
| `ekonomi-tw3-2025` | ekonomi **TW III 2025** | ekonomi **TW III 2020** |

The lane finds the right subject and the wrong period, repeatedly. `orderKnowledgeDocsByPeriod`
(2026-08-18) re-ranks by period *after* retrieval, so it can only reorder what the top-N
already contains — when the right period never enters the candidate set, it has nothing
to promote. A period filter or boost belongs in the retrieval query, not only after it.

## Notes for the next run

- Deterministic: same model, same corpus, same result. Differences are real.
- Re-validate labels (`--validate`) after any re-chunk — predicates are content-based and
  survive renumbering, but a chunk boundary landing mid-table can split a pair
  (e.g. `["66,14","19,34"]`) across two chunks and turn a hit into a miss for reasons that
  have nothing to do with retrieval quality.
