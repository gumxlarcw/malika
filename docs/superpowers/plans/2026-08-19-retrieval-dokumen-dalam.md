# Deep-Document Retrieval — Scope

> Written 2026-08-19. Follow-on to the hollow-table fix (`e968dff`), which closed the
> tabular half of "MALIKA cannot answer 2016 questions". This is the other half: facts
> that exist only in publications and cannot be retrieved.

## The problem, measured

The knowledge base is chunked, embedded, and indexed — and still cannot find its own
contents. Three independent causes, each verified on this machine.

### 1. 57.5% of chunk text has no representation in any vector

`MAX_INPUT_CHARS = 1500` in `src/services/bpsMetadata/embedding.service.js:28`, against
`knowledge_chunk` rows averaging 3,508 chars.

```
knowledge_chunk rows                     27,947
rows exceeding the 1500-char window      27,417   (98.1%)
total chars stored                   98,027,187
chars actually embedded              41,654,912
never seen by any embedding                57.5%
```

Concretely: the chunk holding the 2016 kabupaten/kota population table (`knowledge_base`
id 20793) carries `218 028` at **offset 3,204**. The vector was built from the first
1,500 characters. The number is indexed and unreachable.

### 2. The window cannot simply be raised — but it is set too low anyway

e5-base truncates at 512 tokens, so widening the char window has a hard ceiling.
Measured over 60 chunks of 3,000–4,000 chars:

| | measured |
|---|---|
| chars per token (this corpus) | 3.81 |
| tokens in a full average chunk | 1,052 (max 1,518) |
| chunks exceeding the 512-token limit | **60 / 60** |
| tokens in the current 1,500-char window | 405 |
| chars that fit in 512 tokens | **~1,949** |

So the current window wastes ~107 tokens (21%) of the model's capacity, and the inline
comment justifying it — *"~370 tokens, well under the 512-token model limit"* — is
measurably wrong for these chunks. Raising 1500 → ~1900 is free. It is also not enough:
at 3,508-char chunks that still covers only 54%.

**The chunks must shrink to fit the model, not the reverse.**

### 3. Chunk titles name the wrong table

In `Provinsi Maluku Utara Dalam Angka 2017` (id 1193, 157 chunks):

| chunk | title says | content actually holds |
|---|---|---|
| 44 | Tabel 3.2.8 — *…yang Bekerja Selama Seminggu* | population projection table (incl. Ternate 218 028) |
| 45 | Tabel 3.2.11 — *Jumlah Pencari Kerja* | population by sex + sex ratio |
| 46 | Tabel 3.2.12 — *Peserta Latihan BLKI Ternate* | population + households |

`enrich-chunk-titles.js` appears to take the *next* table caption when a chunk straddles
a table boundary. The title is embedded **and** is shown to the model as the citation, so
this costs recall and would produce a wrong source attribution even on a hit.

### Consequence

`kepadatan penduduk Kota Ternate tahun 2016` → vector search returns **8 inflation
documents**, similarities crammed into 0.855–0.860. The correct chunk ranks #14 on one
phrasing and outside the top 30 on another.

## Constraints, measured on this box

| | |
|---|---|
| cores | 4 (i5-4590T), shared with 3 PM2 production apps |
| RAM | 15 Gi total, **3.3 Gi available** — the binding constraint |
| disk | 206 G free — not a constraint |
| embedding throughput | **687 ms/chunk, 87 chunks/min**, single-threaded |
| `retrieval_chunks` | 1,018 MB data, 5 MB index, 29,933 rows |

Re-embedding wall-clock at that throughput:

- re-embed the existing 27,947 chunks → **5.3 hours**
- re-chunk to ≤1,900 chars (~51,000 chunks) and embed → **9.7 hours**

Vector growth is modest: 29,933 × 3 KB ≈ 90 MB today → 51,000 × 3 KB ≈ 153 MB. Stored
text does not grow (same corpus, more boundaries).

## Landmine to avoid

There are **two** embedding services and they disagree:

| service | model | dims | used by |
|---|---|---|---|
| `src/services/ai/embedding.service.js` | `text-embedding-3-small` | 1536 | `scripts/rechunk-all.js` |
| `src/services/bpsMetadata/embedding.service.js` | `Xenova/multilingual-e5-base` | **768** | live retrieval, `scripts/backfill-retrieval-chunks.js` |

`rechunk-all.js --dry-run` reports *"Embedding Model: text-embedding-3-small (1536 dims),
Estimated embedding cost: ~$24.64"*. Running it with embedding enabled would spend money
on OpenAI and produce 1536-d vectors the live 768-d `VEC_DISTANCE_COSINE` path cannot
use. **Use `rechunk-all.js --chunk-only`, then embed via `backfill-retrieval-chunks.js`.**

Also note `MAX_CHUNK_SIZE = 2000` in `knowledgeDoc.service.js:66`, while live chunks
average 3,508 (max 4,000) — the rows in the database were not produced by the current
config. Whatever produced them is not the code path we would re-run.

## Options

### A — Widen the window only
`MAX_INPUT_CHARS` 1500 → 1900, re-embed 27,947 chunks. **5.3 h.**
Coverage 43% → 54%. One constant. Subsumed by B; not worth a separate re-embed pass.

### B — Re-chunk to fit the model, then re-embed  *(the actual fix)*
Chunk to ≤1,900 chars so every chunk is fully represented. ~51,000 chunks. **9.7 h.**
Coverage → **100%**. Requires `--chunk-only` + `backfill-retrieval-chunks.js`.

### C — Add the keyword lane  *(cheapest real gain, no re-embedding)*
`hybridSearch.service.js` and `fulltextRanker.js` already exist and have **zero live
importers** — dead code. `retrieval_chunks` has **no FULLTEXT index**; `knowledge_base`
has `ft_knowledge_title_content(title, content)`.

Measured on the failing query, chunk-scoped fulltext against `knowledge_base`:

- vector lane → 8/8 **inflation** documents
- keyword lane → *Profil Kependudukan*, *Indikator Kesejahteraan Rakyat*, *Proyeksi
  Penduduk Kabupaten/Kota* — topically correct, wrong period

Keyword does not find the target chunk either (its title says "yang Bekerja" — cause 3),
but it lands in the right subject area where vectors do not. Exact tokens like `2016`
and `kepadatan` are precisely what a 768-d average cannot preserve.

Work: add FULLTEXT on `retrieval_chunks(title, content_text)`, wire a keyword lane into
the chat retrieval path, fuse with the vector lane (reciprocal-rank fusion), scope to
chunks (parent rows outrank children on raw term frequency — measured, the 531 KB
parents took all 8 top slots).

### D — Fix chunk titles
Correctness bug independent of lane choice. Re-run title enrichment so a chunk is titled
by the table its rows belong to, not the next caption. Cheap; no re-embedding *unless*
titles are part of the embedded text — they are, so it pairs naturally with B.

## Recommended sequence

1. **C + D first.** No re-embedding, hours not days, and they attack the ranking failure
   directly. D is a correctness bug worth fixing regardless.
2. **Then B**, as a nice'd background job off-peak, into a shadow table with a cutover —
   not in place. Fold A into it (window 1900, chunk ≤1900).

Rationale: B is the principled fix but costs ~10 h of contended CPU and cannot be
evaluated honestly without a measurement harness — which C and D require anyway.

## Verification plan (build before changing anything)

Nothing here can be judged by eyeballing one query; the current similarity band is 0.02
wide, so movement is easy to imagine and hard to prove.

1. Label a fixed set of ~20 deep-document questions with their known answer chunk
   (2016 population/density, garis kemiskinan komoditas, TPK hotel, IPM by year …).
   Sources: `backend/evals/fixtures/chat-cases.json`,
   `docs/workspace/search-eval-baseline-2026-04-18.md`.
2. Record **recall@5 / recall@10 / MRR** and the **similarity spread** of the top 10
   before any change. Spread is the honest signal — a lane that only shifts scores
   inside a 0.02 band has not improved discrimination.
3. Re-measure after C, after D, after B. Keep each as its own row.
4. Regression: the five canonical answers must not move —
   `kemiskinan Kota Ternate 2017` 2,73% / 6,04 ribu · `IPM Halmahera Utara 2024` 70,52 ·
   `penduduk Kota Ternate 2024` 214,4 ribu · `jumlah penduduk Ternate 2016` 218.028 ·
   `kepadatan Kota Ternate 2016` 740 (2017).

## Risks and rollback

| risk | handling |
|---|---|
| 3.3 Gi RAM available; ONNX + MariaDB both want more | run the backfill nice'd, off-peak, batched; watch `max_memory_restart` |
| 10 h job competing with 3 production apps | background, resumable (`--start-id`), stoppable |
| re-chunk breaks live chat mid-run | build into a shadow table, cut over atomically; never mutate `retrieval_chunks` in place |
| accidental 1536-d vectors + OpenAI spend | never run `rechunk-all.js` without `--chunk-only` |
| FULLTEXT index on a 1 GB table | index build is minutes; `innodb_ft_min_token_size` default 3 admits `2016` |

## Explicitly not in scope

- Replacing e5-base with a larger model — the 4-point nDCG gain was already weighed
  against 4–5× inference cost on this hardware (see the header of `embedding.service.js`).
- Reworking the `knowledge_doc` whole-document rows beyond demoting them from retrieval:
  1,368 rows averaging 67 KB (max 1.13 MB), each embedded from its first 1,500 chars.
  They are noise in the ranking and should be excluded from the chat lane, but deleting
  them is a separate decision — BM25 over full parents may still have a use.
