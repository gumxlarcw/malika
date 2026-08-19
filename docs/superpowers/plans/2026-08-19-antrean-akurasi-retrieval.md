# Queue — accuracy & retrieval

> Written 2026-08-19, while the `retrieval_chunks` rebuild runs. Every claim below
> was measured on this system today; nothing is generic advice.

## Queued (in order)

### 1. Wire DNA Nucleus into the prompt — *after the rebuild lands*

`src/services/dna/dnaNucleus.service.js` is **1,336 lines, fully built, API key set,
357 rows already cached — and has zero live callers.** Verified per export:

| export | callers outside the service |
|---|---|
| `buildDnaContextBlock` | 0 |
| `buildDnaUiMetadata` | 0 |
| `searchKegiatan` (survey/census activities) | 0 |
| `searchSmart` / `warmupCache` / `getCachedSmart` | 0 |
| `lookupAbbreviation` | only `bpsAbbreviations.lookupAbbreviationDynamic()`, which is itself never called |

`buildDnaContextBlock` exists precisely to inject concept/definition/method context
into the prompt. Wiring it is small; **validating it is not**, so treat it as a
measured change, not a switch-on:

- Build ~15 labelled metadata questions (definisi, konsep, metode, referensi waktu,
  frekuensi, produsen data) the same way as `retrieval-deepdoc-cases.json`.
- Baseline them first — today they are answered incidentally from publication text
  (verified live: garis kemiskinan → GKM/GKBM, 2.100 kkal, 52 komoditas, correct).
- Then add DNA and re-measure. Do not assume an unused 1,336-line service works as
  advertised: the sampled `dna_cache` rows had `metode` and `frekuensi` NULL, and
  357 rows is thin coverage.
- Guard latency: the service's own comment notes MSVAR responses ~17s.

### 2. Hybrid retrieval — highest confidence, already half-built

`hybridSearch.service.js` and `fulltextRanker.js` exist with **0 callers from the
chat path**, and `retrieval_chunks` has **no FULLTEXT index**. Measured on the
failing query: the vector lane returned 8/8 *inflation* documents; chunk-scoped
keyword returned *Profil Kependudukan* / *Proyeksi Penduduk* — right subject area.

Exact tokens (`2016`, `Maret`, `kepadatan`, a figure like `218 028`) are precisely
what a 768-dim average cannot preserve. Add FULLTEXT on
`retrieval_chunks(title, content_text)`, fuse with the vector lane by reciprocal-rank
fusion, and scope to chunks — parent rows outrank children on raw term frequency
(measured: the 531 KB parents took all 8 top slots).

### 3. Replace the LLM reranker with a cross-encoder

`documentJudge` is an LLM asked to rank 20 candidates. It costs 2–9 s, caps output
at 10, is non-deterministic, and **discarded the correct answer** for
`komoditas … Maret 2025` — its own recorded reasoning shows it preferring the Maret
2026 release. It is now period-aware, but the structural problem stands: a reranker
with opinions can throw away a correct retrieval.

A cross-encoder (bge-reranker-v2-m3 or similar, CPU-friendly) is the standard
alternative: deterministic, ~50 ms, and it scores relevance rather than composing a
narrative. Keep the LLM judge behind a flag for comparison and decide on measurement.

### 4. Fix chunk titles

Chunk 44 of *Dalam Angka 2017* is titled *"Tabel 3.2.8 …yang Bekerja"* but contains
the **population projection** table; chunk 46 is titled *"Peserta Latihan BLKI"* but
holds population + households. `enrich-chunk-titles.js` appears to take the *next*
table caption when a chunk straddles a boundary. The title is embedded **and** shown
to the model as the citation, so this costs recall and produces wrong attributions.

### 5. Move period matching into the query, not only the re-rank

`selectDocsByPeriod` re-ranks after retrieval. Metadata filtering at the SQL level
(a period column on `retrieval_chunks`, filtered in the `WHERE`) is the standard
approach and cannot be defeated by a candidate set that never contained the period.

## Grounding — the actual anti-hallucination gap

**The number-grounding guard does not protect production.**
`cleanAssistantTextAgainstDb` is called only from `chat.service.js`, the
**non-streaming** path. Production serves via `streamChatResponse`
(`chat.controller.js:146`), which never calls it. Verified: 0 occurrences in
`streaming.service.js`.

Recommended, in order:

1. **Port the guard to the streaming lane.** Streaming makes this harder — you cannot
   un-send a token — so it must run on the buffered final text before persistence,
   with the correction surfaced rather than silently applied.
2. **Numeric groundedness check.** Every figure in the answer should appear in
   `dataPreview` or `knowledgeContext`. This is mechanical and catches the failure
   class that matters most for a statistics agency.
3. **Faithfulness eval (RAGAS-style):** groundedness, context precision, context
   recall, answer relevance. We now measure *retrieval* (`evals/retrieval-eval.js`);
   nothing yet measures *generation*.
4. **Keep the flag loop alive.** `chat_message_flags` holds 45 human-reviewed rows —
   31 of them hallucination — and is a genuinely valuable asset, but **the newest is
   2026-05-16**. It stopped collecting. Wire flagging into the UI and use it as a
   standing regression set.

## On "delete the hallucinating model"

**No model can be blamed from the current evidence, and the premise needs correcting
in two ways.**

**First, the config is misleading.** `backend/.env` names `claude-sonnet-4-6` for
every role — chat, reasoning, interpretation, query builder, reranker. The proxy
ignores all of it. `/opt/malika-llm-proxy/.env` sets:

```
PROXY_PRIMARY_TIER=neuralwatt/deepseek-v4-flash,neuralwatt/deepseek-v4-flash-flex,openagentic/glm-5
```

`anthropic/claude-sonnet-4-6` is only the hardcoded last resort when that variable is
empty — which it is not. **Production is served by DeepSeek V4 Flash.** Changing the
serving model means editing the proxy, not the backend.

**Second, the flag data cannot attribute blame.** All 31 hallucination flags date to
2026-05-16 or earlier, which is before the current tier chain *and* before the
2026-08-18 fix to `chat_messages.model` — until then that column recorded a config
default rather than the model that actually answered. So the "26 hallucination /
claude-sonnet-4-6" split is not evidence. Several flagged rows also are not
hallucinations at all (refusing Jakarta data is correct behaviour for a Maluku Utara
service).

**Third, and most important: nothing found today was model confabulation.** Every
defect was a grounding failure the model reported faithfully —

- a table whose every cell was `"..."`, reported as "kosong"
- a province age-bracket table labelled "Kota Ternate", summed to 1,34 juta
- a Maret 2021 release answering a Maret 2025 question
- 57.5% of the corpus with no vector representation

Swapping models would have fixed **none** of them. Retrieval and grounding are where
the accuracy is.

That said, one legitimate concern remains: `deepseek-v4-flash` is a small, fast model
carrying a grounding-critical statistical workload. The industry pattern is a cheap
model for routing/classification and a stronger one for grounded generation. That is
worth an A/B — held-out questions, same contexts, faithfulness scored — rather than a
swap on suspicion. The tier chain makes the experiment cheap: change one env line.
