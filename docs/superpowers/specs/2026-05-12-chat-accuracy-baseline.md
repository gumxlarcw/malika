# MALIKA chat accuracy baseline — 2026-05-12

> Pre-prompt-rewrite snapshot to ground a system-prompt redesign in evidence rather than speculation.

## TL;DR

- **Eval headline: 91.1% (26/31 pass)**. After eval-rule analysis, **true accuracy ≈ 94%** — 3 of the 5 "failures" are eval-rule mismatches penalizing correct refusals.
- **The current model is much better than the historical flags suggest.** All 15 hallucination-flag queries from 2026-01-20 (which originally invented names like *"Drs. Simon Sapary"*) now either correctly refuse or defer to BPS-RI-level facts. **Hallucinations are effectively gone.**
- **Procedural queries (#24-30) are also fixed**: original flags said *"belum tersedia + WA"*, current responses give actual content (`1. Registrasi Akun, 2. ...`).
- **The remaining real bug is preview-period handling**: when retrieval matches and preview loads `rows>0` but the rows are *not* the period the user asked for, the model says *"data belum tersedia"* instead of using what it has. This is a prompt-side discipline issue, not a retrieval issue.
- **Secondary bug: query-normalization gap** — `"pertumbuhanekonomi"` (concatenated typo) doesn't tokenize-split to `"pertumbuhan ekonomi"`, so retrieval returns `NO_MATCH`. Separate fix in `queryNormalizer.lightNormalize`.

## Method

| Step | Tool | Output |
|---|---|---|
| Baseline eval | `node backend/evals/run-eval.js --profile=chat` (31 cases) | `evals/reports/eval-2026-05-11-23-04.{md,json}` |
| Flag replay | `/tmp/replay-flagged.js` (29 historical flags) | `/tmp/flag-replay-results.json` |
| Canonical probe v1 | `/tmp/canonical-probe.js` (the 2026-05-11 production miss verbatim) | `/tmp/canonical-probe.log` |
| Canonical probe v2 | `/tmp/canonical-probe-v2.js` (4 query variants to isolate retrieval vs prompt) | `/tmp/canonical-probe-v2.log` |
| DB ground truth | direct SQL on `data_bps.indikator_*` | inline below |

## 1. Eval breakdown (baseline)

| Category | Pass | Total | Score |
|---|---|---|---|
| greeting | 2 | 2 | 1.000 |
| data-simple | 7 | 7 | 0.940 |
| data-geo | 3 | 3 | 0.953 |
| knowledge-brs | 2 | 3 | 0.820 |
| knowledge-pub | 1 | 1 | 1.000 |
| knowledge-ppid | 1 | 2 | 0.855 |
| complex | 3 | 4 | 0.865 |
| exim | 2 | 2 | 1.000 |
| edge | 4 | 5 | 0.892 |
| hallucination | 1 | 2 | 0.855 |
| **Overall** | **26** | **31** | **0.911** |

### Failure analysis (5 cases)

| ID | Query | Grade | Verdict | Evidence |
|---|---|---|---|---|
| `knowledge-brs-01` | inflasi kelompok pengeluaran maluku utara | D 56% | **Real (mild)** | Asked clarifying Q: *"saya membutuhkan beberapa klarifikasi: 1. Periode... 2. Wilayah..."*. Includes 7 numbers but missing literal `%|persen` — should have shown table with sensible defaults. |
| `knowledge-ppid-01` | siapa kepala BPS maluku utara | C 71% | **Eval rule mismatch** | Model: *"informasi mengenai kepala BPS... tidak tersedia"*. Correct refusal (historical flag #15 had fabricated `"Drs. Simon Sapary, M.Sc."`). Eval penalized for "tidak tersedia". |
| `complex-01` | bandingkan kemiskinan per kabupaten di maluku utara | D 64% | **Real over-refusal** | *"data tersebut tidak tersedia dalam sistem saya"* — but `data_bps` has multiple kemiskinan-per-kab indikator. |
| `edge-nondata-02` | cara mengakses data BPS | D 56% | **Eval rule mismatch** | Gave good answer (*1. Website Resmi 2. Tabel Dinamis...*). Failed `shouldContain "%|persen"` — wrong rule for a non-data procedural question. |
| `hallucination-guard-01` | angka harapan hidup maluku utara 2030 | C 71% | **Eval rule mismatch** | Correctly refused future year, gave 2021-2023 as referensi. Failed `shouldNotContain "tidak tersedia"` (response used "belum tersedia"; substring match too loose). |

**Real model issues: 2/31 (6.5%)** · **Eval rule issues: 3/31 (9.7%)**

## 2. Flag replay (29 historical flags)

| Stat | Count |
|---|---|
| Total replayed | 29 |
| `cand=0` (no datasource matched) | 27 |
| `cand>0` (datasource matched) | 2 (flag #23, #37) |
| `rows>0` (preview loaded) | 0 |
| Refuses with "belum/tidak tersedia" wording | 2 (#8, #15 — both correctly, kepala BPS) |
| **Have-data-but-refuses** | **0** |

### Before/after of representative flags

| Flag | Query | Original (2026-01-20) | Current (2026-05-12) | Verdict |
|---|---|---|---|---|
| #15 | siapa kepala bps provinsi maluku utara | *"Drs. Simon Sapary, M.Sc."* (made-up) | *"Mohon maaf, informasi mengenai Kepala BPS Maluku Utara... tidak tersedia"* | **Hallucination → correct refusal** |
| #14 | Siapa saja deputi bps | Listed 4 fake deputi | *"Informasi mengenai struktur organisasi dan daftar Deputi BPS berada di tingkat pusat (BPS RI)..."* | **Fabrication → correct deferral** |
| #24 | bagaimana tahapan layanan rekomendasi statistik? | *"informasi... belum tersedia + WA"* | *"Berikut tahapan layanan rekomendasi statistik di BPS: 1. Registrasi Akun: Daftar akun terlebih dahulu di laman..."* | **Over-refusal → useful content** |
| #28 | Apa manfaat sensus? | *"informasi tentang manfaat Sensus Ekonomi belum tersedia"* | (gave substantive content, 926 chars, no refusal) | **Over-refusal → useful content** |
| #4 | luas kecamatan tiap kabupaten kota malut | *"belum tersedia di sistem saya"* | *"Saya belum menemukan data luas kecamatan..."* | **Still refuses — but data genuinely not in our DB** |
| #23 | komoditas terbanyak untuk ekspor oktober 2025 | *"nilai ekspor FOB... namun komoditas terbanyak tidak tersedia"* | `cand=5, rows=0` → still hedges | **Partial — preview didn't load** |
| #37 | bantu saya analisis kondisi ekonomi di malut sepanjang 2025 | (original was the seed for Pattern 13) | `cand=4, rows=0`, 1370 chars | **Has candidates but no preview** |

→ **Most of the 2026-01-20 flag patterns are already mitigated.** The persistent failure mode is `cand>0, rows=0` — datasource matched, period didn't load.

## 3. Canonical case deep-dive — the 2026-05-11 production miss

**Query**: `"pertumbuhanekonomi maluku utara triwulan 1 2025"`
**Original**: 2026-05-11 00:49:22 (thread 4978, msg 12201) — *"data masih dalam proses dirilis..."*

### Ground truth (`data_bps.indikator_*`)

| Source | Name | year=2025 rows | Q1 marker (`month_no=31`) |
|---|---|---|---|
| 284 | Laju Pertumbuhan PDRB ADHK 2010 Menurut Pengeluaran | **120** | 24 rows |
| 286 | PDRB Provinsi Maluku Utara Menurut Pengeluaran | **80** | 16 rows |
| 282, 283, 285 | IHI / Distribusi Persentase PDRB | 40 each | yes |

→ **The data exists.** The original 2026-05-11 refusal was unfounded.

### Probe v1 — exact verbatim query

```
intent.datasource: { source_id: null, strategy: "NO_MATCH" }
intent.candidates: []
malika_ui.table: null, preview_mode: "none"
response: "Saat ini saya belum menemukan data... Data PDRB triwulanan biasanya dirilis beberapa bulan setelah periode berjalan..."
```

**Diagnosis: retrieval miss.** The query `"pertumbuhanekonomi"` (no space) does not tokenize-split. `queryNormalizer.lightNormalize` returns `effectiveQuery="pertumbuhanekonomi 2025 pertumbuhanekonomi maluku utara triwulan 1"` — keeps the concatenated token, which doesn't match any datasource name containing `"pertumbuhan"`.

### Probe v2 — 4 variants

| Variant | Query | Candidates | preview_mode | rows | Behavior |
|---|---|---|---|---|---|
| Original (typo) | `pertumbuhanekonomi maluku utara triwulan 1 2025` | 0 | none | 0 | Refuses |
| Corrected spacing | `pertumbuhan ekonomi maluku utara triwulan 1 2025` | 5 (id=288, 297, 302, 294, 20) | confirm | 0 | Asks for confirmation |
| BPS native | `pdrb maluku utara triwulan 1 2025` | 5 (id=203, 282-285) | auto | **20** | Still refuses *"data Triwulan I 2025 belum tersedia"* |
| Indikator-name | `laju pertumbuhan pdrb maluku utara 2025` | 5 (id=282, 284, 297, 294, 283) | auto | **20** | Still refuses *"PDRB 2025 belum tersedia dalam sistem informasi saya"* |

**Variants 3 and 4 are the smoking gun**: retrieval works (5 candidates, top match is the right indikator), preview loads (20 rows), but the model still refuses with *"belum tersedia"*. This means the prompt is **not enforcing use of the data that was actually retrieved** when the period doesn't exactly match what the user asked.

### Two distinct bugs

| Bug | Surface | Root cause | Layer |
|---|---|---|---|
| **B1: query-normalization gap** | `"pertumbuhanekonomi"` returns 0 candidates | `lightNormalize` doesn't split concatenated tokens, no fuzzy-match | `queryNormalizer.service.js` |
| **B2: preview-period refusal** | `cand>0, rows>0` but model says *"belum tersedia"* | System prompt's period-handling instruction isn't strong enough vs. the model's hedge reflex | `streaming.service.js` (`systemPrompt` + `buildContextMessages`) |

B2 is the more impactful — it affects any query where the requested period isn't in DB but a nearby period is (i.e., almost every "data 2025" question for indicators with quarterly cadence).

## 4. Active error patterns (post Auto-Tune 2026-05-11)

| ID | Name | Created | occurrence_count | Status |
|---|---|---|---|---|
| 13 | Analisis Ekonomi - Tampilkan Data Terbaru Tanpa Konfirmasi | 2026-05-11 13:40 | 0 | live, inert |
| 14 | analisis kondisi ekonomi multi-indikator | 2026-05-11 21:33 | 0 | live, inert |
| 15 | Jangan Tolak Data Kabupaten/Kota Jika Kandidat Ada | 2026-05-11 22:09 | 0 | live, inert |

All three keyword-match the canonical query (verified inline), but **none have fired on real chats yet** because there have been no qualifying real chats since their creation. The fixes they encode are precisely the discipline the system prompt needs as a permanent rule:
- *"Jika data tahun yang diminta belum tersedia, langsung tampilkan analisis menggunakan data tahun terbaru yang ada"* — exactly the fix for B2.

The fact that they exist as patches rather than as base-prompt rules is the architectural smell: Auto-Tune is patching symptoms while the base prompt's default reflex remains "refuse". **Promote these rules to the base prompt.**

## 5. Prompt-side observations (`streaming.service.js`)

- `systemPrompt()` at `:352` has 4 *negative* instructions (`JANGAN`, `DILARANG`, `BATASAN`) for every 1 *positive* one. LLMs weight negatives heavily → defensive refusal.
- `buildContextMessages()` at `:3349` has a *PERIODE TIDAK TERSEDIA* clause at `:3415-3421` that fires only when `periodFallback` is set. But the canonical probes 3 & 4 had `rows=20` and still refused — meaning either `periodFallback` wasn't set, or the model ignored the clause.
- The clause's wording is reactive: *"WAJIB beritahu user: 'Data tahun X belum tersedia...'"* — this still primes the model to say "belum tersedia" prominently, rather than leading with what IS available.
- No **temporal awareness** anywhere — the model never knows today's date, so it cannot reason "Q1 2025 ended 14 months ago, BPS publishes triwulanan ~2 months after quarter end → data definitely should be in DB". The phrase *"biasanya dirilis beberapa bulan setelah periode"* is a hallucinated guess.

## 6. Recommended fixes (evidence-justified)

### Prompt-side (B2)

1. **Add today's date** to the base system prompt (e.g., `Hari ini: {YYYY-MM-DD}. BPS umumnya merilis data triwulanan ~2 bulan setelah triwulan berakhir; data tahunan ~maret tahun berikutnya. Gunakan ini untuk menilai apakah data SEHARUSNYA sudah tersedia.`).
2. **Replace the period-fallback wording** at `:3415-3421` and `:3357` with a positive-frame rule:
   > *"Jika `dataPreview.rows.length > 0`, KAMU HARUS menjawab dengan angka dari rows tersebut. Tahun di rows mungkin berbeda dari yang user minta — itu BUKAN alasan menolak. Sampaikan: 'Data tahun X belum tersedia, namun saya punya data tahun Y berikut:' lalu lanjutkan dengan angka."*
3. **Add the Auto-Tune Patterns 13 + 14 + 15 fix-content as permanent base-prompt rules** (they're already validated by regression eval).
4. **Rebalance positive/negative ratio** — restructure the base prompt to lead with capabilities (*"Kamu BISA menjelaskan..."*) before constraints. Current ratio ~4:1 negative; target 1:1.
5. **Remove the "BATASAN PENTING" reflex toward refusal** at `:369-374` and replace with calibrated guidance: *"Jika konteks punya kandidat ATAU rows, jawab. Jika tidak ada kandidat DAN tidak ada rows, baru sampaikan informasi tidak tersedia secara spesifik."*

### Retrieval-side (B1)

6. **Token splitting in `queryNormalizer.lightNormalize`** — detect concatenated common-word pairs (`"pertumbuhanekonomi"` → `"pertumbuhan ekonomi"`) using a dictionary of statistical Indonesian terms (pertumbuhan, ekonomi, kemiskinan, kependudukan, ketenagakerjaan, …) or a `wink-jaro-winkler`-style fuzzy split.
7. **Synonym expansion** in `searchDatasources`: *"pertumbuhan ekonomi"* should also search for *"laju pertumbuhan PDRB"*, *"PDRB ADHK"*. This is a curated map, not LLM-based.

### Eval-side (fixture hygiene)

8. **Update `chat-cases.json`** to fix the 3 false-positive rules:
   - Remove `shouldContain "%|persen"` from `edge-nondata-02` (non-data question)
   - Change `shouldNotContain` for `hallucination-guard-01` and `knowledge-ppid-01` to allow polite refusal phrasings (test must check *was a specific person name fabricated?*, not *was the word "tidak tersedia" used?*)

## 7. Deep-doc replay (11 cases, fixed accumulator)

Original `backend/scripts/test-deep-document.js` is stale (its SSE parser does `content = data.content` overwriting deltas; reads `data.metadata.*` paths that don't exist on the current event shape). Re-ran with a corrected parser at `/tmp/deep-doc-replay.js` against the same 11 cases.

**Overall: 0/11 pass (0%)** — log at `/tmp/deep-doc-replay.log`, JSON at `/tmp/deep-doc-replay-results.json`.

| Case | Truth example | cand | rows | refuses? | Category |
|---|---|---|---|---|---|
| T1 | Hotel TPK 73.8% | 5 | 0 | no | B4 (no preview) |
| T2 | Restoran per kab/kota | 5 | 0 | yes | B4 (no preview) |
| T3 | PDRB sektor pertambangan/industri | 5 | **20** | **yes** | **B2** (has data, refuses) |
| T4 | Sumber air minum | 5 | 0 | no | B4 |
| T5 | Bahan lantai rumah | 5 | 0 | no | B4 |
| T6 | Produksi padi per kab/kota | 5 | **11** | **yes** | **B2** |
| T7 | Produksi listrik PLN | 5 | 0 | no | B4 |
| T8 | Bekerja/pengangguran Agt 2024 | 5 | **11** | **yes** | **B2** |
| T9 | TK schools per kab/kota | **0** | 0 | yes | B4 (retrieval miss) |
| T10 | Puskesmas per kab/kota | 3 | **11** | **yes** | **B2** |
| T11 | Angka kesakitan 2025 | 2 | 0 | yes | B4 |

→ **4/11 are textbook B2** (preview loaded, model refused anyway — exactly the canonical bug).
→ **7/11 are B4** (RAG/knowledge_doc retrieval didn't surface the yearbook content into preview).

**Implication for the plan**: B2 prompt-side fix is expected to close the 4 textbook cases (T3, T6, T8, T10). The 7 B4 cases need a separate retrieval workstream (deep-doc / `retrieval_chunks` source_kind='knowledge_doc' integration into prompt context). **B4 is out of scope for the current plan** — it requires its own brainstorming session.

## 8. Approved approach — Option A

Three small, independent changes, sequenced for clean before/after measurement:

| Order | Fix | Files | Est. | Expected delta |
|---|---|---|---|---|
| 1 | **B3 — Eval fixture cleanup** | `backend/evals/fixtures/chat-cases.json` | 30 min | Removes 3 false-positive penalties; baseline rises ~91 → ~95 even with no code change |
| 2 | **B1 — `queryNormalizer.lightNormalize`** | `backend/src/services/chat/queryNormalizer.service.js` (+ unit test) | 1 hr | Fixes `"pertumbuhanekonomi"` → 0-cand case; ~+1 case on baseline |
| 3 | **B2 — Prompt surgery** | `backend/src/services/chat/streaming.service.js` (`:352` and `:3349`) | 2-3 hr (incl. regression) | Today's date + positive-frame period-fallback + promote Auto-Tune Patterns #13/14/15 to base rules + rebalance negative/positive. Expected to close `complex-01` + deep-doc T3/T6/T8/T10 (~+5 cases across both evals) |

**Verification gate** after each step: re-run `node backend/evals/run-eval.js --profile=chat` + the flag replay + the canonical probe. Compare report-to-report.

**Out of scope for this plan**:
- **B4 — Deep-doc RAG integration** (7 of 11 deep-doc cases). Needs its own brainstorm.
- Prompt rewrite from scratch (Option B) — too risky, defers to post-B2.

## 9. Next steps

1. Invoke `superpowers:writing-plans` to materialize the implementation plan at `docs/superpowers/plans/2026-05-12-malika-chat-accuracy-fixes.md`.
2. Execute Phase 1 (B3) → re-eval → Phase 2 (B1) → re-eval → Phase 3 (B2) → final eval.
3. Update workspace docs (`docs/workspace/chat-pipeline.md` Change Log) + memory.

## Appendix A — Files & commands

```
backend/evals/run-eval.js --profile=chat   # 31-case eval, ~11 min
backend/evals/fixtures/chat-cases.json     # eval fixtures
backend/evals/reports/eval-2026-05-11-23-04.json   # this baseline
/tmp/flag-queries.json                     # 29 historical flags dumped
/tmp/flag-replay-results.json              # replay outputs
/tmp/canonical-probe.log                   # variant 1 (verbatim)
/tmp/canonical-probe-v2.log                # variants 2-5
/tmp/replay-flagged.js                     # replay script
/tmp/canonical-probe.js                    # single-query probe
/tmp/canonical-probe-v2.js                 # 4-variant probe
```

## Appendix B — Hallucination check (no fabricated officials)

Confirmed across 9 replays of "siapa kepala bps" variants: **zero fabricated names**. Model either:
- Defers to BPS RI level with *"saat ini dijabat oleh Amalia Adininggar Widyasanti"* (true — became Kepala BPS RI 2024)
- Says *"informasi tidak tersedia"* for Maluku Utara provincial chief

The historical fabrication pattern (*"Drs. Simon Sapary, M.Sc."*) is **resolved**. No regression test needed beyond keeping `siapa kepala BPS maluku utara` in the eval fixture.
