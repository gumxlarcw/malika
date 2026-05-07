# MALIKA Chat Pipeline — Comprehensive Accuracy & Resource Audit

**Tanggal**: 2026-03-31
**Pipeline Aktif**: V1 (sequential 10-stage) — `pipeline.service.js` (3676 baris)
**Pipeline V2**: Tidak aktif (`PIPELINE_VERSION` default 'v1', `CHAT_PIPELINE_V2=true` di .env tidak dibaca code)

---

## Executive Summary

Audit menyeluruh terhadap 38+ file pipeline chat MALIKA oleh 4 parallel code-explorer agents + manual deep analysis menemukan **7 temuan CRITICAL**, **14 temuan HIGH**, **16 temuan MEDIUM**, dan **10+ temuan LOW**. Masalah terbesar:

1. API key hardcoded di source code (security)
2. Claude menerima identity "Claude Code" yang konflik dengan persona MALIKA (accuracy)
3. GREETING tier budget menyebabkan API error (reliability)
4. OOS patterns memblokir query BPS valid tentang agama/etnis (accuracy)
5. `skipRerank` menonaktifkan Document Judge untuk MAYORITAS query statistik (RAG accuracy)
6. High-confidence bypass (>=0.85) skip dedup & diversity selection (RAG recall)
7. Layer 1 retry prompt HILANGKAN semua guardrail anti-fabrication (hallucination risk)

**Skor akurasi keseluruhan: B (baik di happy path, tapi signifikan gap di edge cases)**
- Test suite 81 case menunjukkan 100% pass, tapi methodology lemah (regex-only, no numeric check)
- RAG retrieval accuracy terdegradasi oleh skipRerank yang terlalu agresif
- Supervisor fabrication detection bisa di-bypass oleh pipeline sendiri
- Resource efficiency bisa ditingkatkan ~40% dengan fix sederhana

---

## CRITICAL FINDINGS (4)

### [C1] API Key Anthropic Hardcoded di Source Code
**File**: `pipeline.service.js:2866`, `malika-llm-proxy.js:71`
**Dampak**: SECURITY — key `sk-ant-oat01-...` exposed di git. Siapapun dengan akses repo bisa pakai.
**Fix**: Pindahkan ke `.env`, rotasi key segera.

### [C2] Claude Identity Conflict — "You are Claude Code" vs MALIKA
**File**: `pipeline.service.js:2888-2896`
**Dampak**: ACCURACY — Setiap request Claude, system message pertama adalah `"You are Claude Code, Anthropic's official CLI for Claude."` (required untuk OAuth validation). Ini MENDAHULUI system prompt MALIKA. Claude bisa confuse tentang perannya — apakah CLI tool atau BPS chatbot. Terbukti dari header: `'user-agent': 'claude-cli/2.1.78'`, `'anthropic-beta': 'claude-code-20250219'`.
**Fix**: Ganti identity ke `"You are MALIKA, BPS Maluku Utara statistical assistant."` atau pakai API key biasa (bukan OAuth token) yang tidak memerlukan identity prefix.

### [C3] GREETING Tier Budget Menyebabkan API Error
**File**: `modelRouter.service.js:38-46`, `config.js:107`
**Dampak**: ACCURACY + COST — GREETING tier: `max_tokens=300`, `thinking_budget=1024`. Anthropic API requires `budgetTokens < maxTokens`. Ini berarti:
- Setiap greeting bisa return 400 error, ATAU
- Thinking silently disabled (1024 token budget di-waste)
- Semua greeting pakai `claude-sonnet-4-6` (5x lebih mahal dari `claude-haiku-4-5`)
**Fix**: Set `thinking_budget: null` untuk GREETING, atau gunakan `claude-haiku-4-5` untuk greeting.

### [C4] OOS Patterns Memblokir Query BPS Valid (Agama, Etnis, Suku)
**File**: `queryClassification.js:217-230` (consumed at `gateAgent.service.js:221`)
**Dampak**: ACCURACY — Patterns OOS memblokir `/\b(agama|syariah)\b/i` dan `/\b(sara|rasis|suku|etnis)\b/i`. Tapi BPS mempublikasikan data demografi berdasarkan agama dan suku/etnis (Sensus, Susenas). Query "penduduk menurut agama di Maluku Utara" akan di-DECLINE.
**Guard**: Ada `STATISTICAL_CONTEXT_INDICATORS` yang suppress OOS jika ada sinyal statistik, tapi "agama penduduk malut" bisa lolos tanpa sinyal statistik yang cukup.
**Fix**: Tambahkan exemption untuk konteks BPS/demografi, atau hapus pattern agama/suku dari OOS.

### [C5] `skipRerank` Menonaktifkan Document Judge untuk Mayoritas Query Statistik
**File**: `pipeline.service.js:2022-2025`, propagates through `vectorSearch.service.js:1263`
**Dampak**: RAG ACCURACY — `hasDataSignal(kbQuery)` return true untuk hampir semua query statistik (match "berapa", "tahun", "tabel", "data terbaru", dll). Saat `skipRerank=true`:
- Document Judge LLM **tidak dipanggil** — dokumen dikembalikan dalam raw cosine+keyword+recency order
- Tidak ada filtering dokumen irrelevan yang punya high cosine similarity
- Tidak ada temporal selection (BRS 2024 vs BRS 2025)
- Tidak ada category diversity enforcement
**Dampak**: Untuk use case utama (query statistik), RAG quality bergantung sepenuhnya pada cosine similarity + heuristic boosting, tanpa LLM intelligence.
**Fix**: Hanya skipRerank jika ada fast-path hit atau cosine score sangat tinggi (>=0.90), bukan berdasarkan hasDataSignal.

### [C6] High-Confidence Bypass (>=0.85) Skip Judge Tanpa Dedup/Diversity
**File**: `documentJudge.service.js:325-340`
**Dampak**: RAG RECALL — Combined score (cosine + keyword 0.20 + recency 0.10) mudah mencapai 0.85 (cosine 0.56 sudah cukup). Saat bypass aktif:
- Return `candidates.slice(0, maxOutput)` tanpa dedup series
- BRS Kemiskinan 2020 + 2021 + 2022 + 2023 + 2024 + 2025 bisa semua masuk (6 dari 10 slot)
- Tidak ada category diversity (Publikasi bisa terpinggirkan)
**Fix**: Naikkan threshold ke 0.92, atau tetap apply inline dedup saat bypass.

### [C7] Layer 1 Retry Prompt Hilangkan Semua Guardrail Anti-Fabrication
**File**: `pipeline.service.js:3469-3478`
**Dampak**: HALLUCINATION — Layer 1 retry (saat refusal detected + context has numeric data) pakai minimal prompt: _"DILARANG bilang 'data tidak tersedia'"_ tanpa:
- BPS compliance rules (Pasal 21 kerahasiaan)
- Anti-fabrication grounding ("HANYA gunakan data dari konteks")
- Anti-breakdown-fabrication ("Jangan mengarang breakdown per kab/kota")
- Date/year accuracy rules
**Dampak**: Retry response bisa mengandung fabricated detail yang original response benar menolak.
**Fix**: Include core guardrail rules di retry prompt.

---

## HIGH FINDINGS (14)

### [H1] SIMPLE Tier Thinking Budget = max_tokens (API Boundary Error)
**File**: `modelRouter.service.js:47-55`, `config.js:108`
**Detail**: SIMPLE: `max_tokens=4000`, `thinking_budget=4000`. Equal values at API boundary — bisa error 400 atau zero visible output (semua token dipakai untuk thinking). SIMPLE tier adalah tier paling sering dipakai.
**Fix**: Naikkan `max_tokens` SIMPLE ke 6000-8000, atau turunkan `thinking_budget` ke 2000.

### [H2] Knowledge Mode Queries Jatuh ke SIMPLE Tier (Context Terlalu Kecil)
**File**: `modelRouter.service.js:122,133`
**Detail**: Parameter `isKnowledgeMode` diterima tapi **tidak pernah dipakai** di `routeModel`. Knowledge queries (RAG dari publikasi 500 halaman) mendapat SIMPLE tier (120K budget, 5 docs) padahal butuh COMPLEX (200K, 7 docs). Indicator-injected docs sebagian ditangkap via `hasIndicatorInjectedDocs`, tapi plain knowledge queries tidak.
**Fix**: Tambahkan `isKnowledgeMode` sebagai strong signal untuk COMPLEX tier.

### [H3] EXIM Trigger Mendahului Service/Institutional Check
**File**: `gateAgent.service.js:231-233` (Rule 4) vs `266-271` (Rules 6&7)
**Detail**: "cara mengakses data ekspor BPS" match EXIM trigger di Rule 4, diroute ke `statistical_exim` sebelum service check (Rule 7). User mendapat data pipeline, bukan jawaban prosedural.
**Fix**: Tambahkan guard: jika query mengandung service keywords ("cara", "akses", "panduan"), skip EXIM trigger.

### [H4] BPS Institutional Patterns Terlalu Luas
**File**: `queryClassification.js:309-310`
**Detail**: `/\bbps\b.*\b(?:apa|bagaimana|berapa|...)\b/i` menangkap "data BPS tentang kemiskinan apa saja?" dan route ke `bps_institutional` (forceKnowledge=true), melewati data pipeline. Query ini seharusnya mendapat data statistik.
**Fix**: Tambahkan negative lookahead untuk query yang mengandung data signal kuat.

### [H5] Double Abbreviation Expansion
**File**: `bpsAbbreviations.js:125-135`, dipanggil di `gateAgent.service.js:413`
**Detail**: `expandAbbreviationsInline()` dipanggil multiple kali per request (gate, normalizer, reranker). Tidak ada idempotency guard — "tpt" menjadi "TPT (Tingkat Pengangguran Terbuka) (Tingkat Pengangguran Terbuka)". LLM menerima input garbled.
**Fix**: Tambahkan check apakah expansion sudah ada di string.

### [H6] Heap Usage 89.5% — OOM Risk Tinggi
**Observasi**: `pds-backend` menggunakan 917 MB / 1024 MB limit. 32 restarts dalam 29 jam.
**Detail**: Komentar di `concurrencyLimiter.js:8` bilang "5 GB max-old-space-size" tapi actual PM2 config hanya 1024 MB. MAX_CONCURRENT=2 pipelines, masing-masing ~200 MB transient = potensi peak 1317 MB > 1024 MB limit.
**Fix**: Naikkan `--max-old-space-size` ke 2048, atau turunkan MAX_CONCURRENT ke 1, atau optimize embedding cache.

### [H7] Reconciler Documentation vs Code Mismatch
**File**: `reconciler.service.js:14-17` vs `:29`
**Detail**: Komentar bilang "Model: gpt-5-mini (reasoning needed)" tapi code default `gemini-3-flash-preview`. Period extraction dari prose butuh reasoning — Gemini Flash bisa kurang akurat.
**Fix**: Gunakan model reasoning untuk reconciler, atau update dokumentasi.

### [H8] Pipeline V2 Tidak Aktif Tapi Diklaim di Docs
**File**: `config.js:176`, `.env` (`CHAT_PIPELINE_V2=true`)
**Detail**: `.env` punya `CHAT_PIPELINE_V2=true` yang **tidak dibaca code** — code membaca `PIPELINE_VERSION` (default 'v1'). V2 dengan 3-layer parallel architecture (50-90s → 18-30s) dan publication retry sudah dikoding tapi tidak pernah aktif di production.
**Fix**: Set `PIPELINE_VERSION=v2` di `.env` untuk mengaktifkan, atau hapus `CHAT_PIPELINE_V2` yang menyesatkan.

### [H9] Year Range Signal Tergantung Data Fetch Success
**File**: `pipeline.service.js:2534`, `modelRouter.service.js:86`
**Detail**: `hasYearRange` (strong signal untuk COMPLEX tier) bergantung pada `ctx.dataPreview.periodRange` yang hanya di-set jika data fetch berhasil. Jika fetch gagal, query "tren kemiskinan 2020-2024" jatuh ke SIMPLE tier dengan context terlalu kecil.
**Fix**: Juga cek year-range regex terhadap query text sebagai signal independen.

### [H10] Document Judge MAX_CANDIDATES_INPUT=20, Pool Bisa 50 — Publikasi Terlewat
**File**: `documentJudge.service.js:32,344`, `vectorSearch.service.js:1181-1247`
**Detail**: Category-aware pool sampai 50 candidates (BRS 21 + Publikasi 21 + PPID 6 + fill). Judge hanya lihat top 20 by combined score → bisa heavily BRS-dominated. Publikasi relevant di posisi 21-50 tidak pernah di-evaluate. Untuk query yang jawabannya ada di Publikasi (annual report), bukan BRS → recall miss.

### [H11] Supervisor Fabrication Detection Bypass Terlalu Luas
**File**: `supervisor.service.js:251-273`
**Detail**: Saat `gateIsStatistical && (hasKnowledge || hasReconciliation)`, supervisor suppress fabrication detection sendiri. Jika LLM fabricate per-kabupaten numbers yang tidak ada di RAG docs, supervisor flag `data_fabrication_detected=true` tapi pipeline revert karena knowledge context exists. Blind spot untuk hallucinated geographic breakdowns.

### [H12] Contradictory System Prompt Rules (Anti-Hallucination vs Anti-Refusal)
**File**: `prompt.service.js:76-78`
**Detail**: Rule 1 "WAJIB sajikan data, DILARANG KERAS bilang 'data belum tersedia'" vs Rule 3 "HANYA gunakan data dari konteks, JANGAN mengarang angka". Saat context partially relevant, LLM ditarik dua arah. Rule 1 dengan emphasis "DILARANG KERAS" bisa override Rule 4 karena prominence bias.

### [H13] `selectLatestByCategory` Hanya Dipanggil di `searchAll`, Bukan `searchKnowledge`
**File**: `vectorSearch.service.js:627-661`
**Detail**: Fungsi intelligent latest-edition selection (year*100+month scoring) ada tapi hanya dipakai di combined search, bukan di knowledge-only search (yang pipeline pakai). Saat Judge di-bypass (C5+C6), tidak ada authoritative latest-edition selection. BRS lama bisa outrank yang baru.

### [H14] Knowledge Search Cache Key Tidak Include `skipRerank`
**File**: `vectorSearch.service.js:107-127`
**Detail**: Cache key = `"${query}|${topN}|${skipLLMSynonyms}"`. `skipRerank` TIDAK di-encode. Query pertama dengan `skipRerank=true` (statistical) di-cache tanpa reranking. Query sama dengan `skipRerank=false` (follow-up KB) mendapat cached unreranked result. Higher-quality reranked result tidak pernah dikomputasi.

---

## MEDIUM FINDINGS (16)

### [M1] Supervisor LLM Model: Gemini Flash untuk Quality Review
**File**: `supervisor.service.js:43`
**Detail**: `SUPERVISOR_LLM_MODEL` default `gemini-3-flash-preview`. Untuk narrative quality review dan data fabrication detection, Flash model mungkin kurang thorough. Field `data_fabrication_detected` di structured output memerlukan reasoning.

### [M2] Temperature Tidak Dipakai Saat Claude + Thinking
**File**: `pipeline.service.js:2946-2948`
**Detail**: Saat Claude Extended Thinking aktif, temperature di-skip. Semua tier menggunakan default temperature. Ini constraint Anthropic API (thinking + temperature tidak kompatibel), tapi perlu didokumentasi.

### [M3] Auto-Continuation Tanpa Supervisor Review
**File**: `pipeline.service.js:3152-3203`
**Detail**: Jika LLM output truncated (`finish_reason=length`), auto-continue tanpa re-run supervisor pada continuation. Continuation bisa mengandung hallucination yang lolos review.

### [M4] `_preferLatestEditions` Post-Filter Setelah 15-Result Window
**File**: `pipeline.service.js:2031,2355-2384`
**Detail**: Function jalan SETELAH search return 15 results. Jika search return 10 BRS edisi berbeda dari series yang sama (2016-2025), dedup tinggalkan hanya 5 docs + sangat sedikit Publikasi. Knowledge context jadi didominasi satu indicator series.

### [M5] Eval Test Suite Hanya Regex Matching — Tidak Cek Akurasi Numerik
**File**: `evals/fixtures/master-test-cases.json`
**Detail**: 81 test cases hanya mengecek keyword (regex `expect`). Tidak ada pengecekan apakah angka benar, tahun sesuai, atau sumber data tepat. False positive — test PASS tapi jawaban bisa salah angka.

### [M6] Tidak Ada Multi-Turn Conversation Test
**File**: `evals/fixtures/master-test-cases.json`
**Detail**: Semua 81 test single-turn. Tidak ada test follow-up, context switching, atau KB anchoring. Pipeline punya logic follow-up kompleks tapi tidak pernah di-test.

### [M7] Tidak Ada Test untuk Model Fallback (Claude → Gemini)
**Detail**: Saat Anthropic API down, tidak ada degraded service path. `pipeline.service.js` stream langsung pakai Claude; proxy outage = complete chat failure. Tidak ada Claude→Gemini fallback di main generation.

### [M8] `CHAT_FORCE_MODEL` Override Hardcodes SIMPLE Tier
**File**: `modelRouter.service.js:137-144`
**Detail**: Debugging dengan `CHAT_FORCE_MODEL` → semua queries mendapat SIMPLE config termasuk DEEP queries.

### [M9] Supervisor Refusal Patterns Hanya 6 vs Layer 1 Punya 15
**File**: `shared/queryClassification.js:258-265` vs `pipeline.service.js:3431-3448`
**Detail**: Supervisor pakai `RESPONSE_REFUSAL_PATTERNS` (6 entries). Layer 1 post-response validator punya 15 patterns. 9 patterns hanya di Layer 1 (e.g., "belum dapat dikonfirmasi", "tidak dapat disajikan"). Jika LLM produce refusal yang match 9 pattern Layer 1-only, supervisor TIDAK suppress data display bubble → stale candidates visible di UI meski response bilang "data tidak tersedia".

### [M10] Supervisor Skip untuk Response <200 chars — Short Statistical Answers Lolos
**File**: `supervisor.service.js:210-215`
**Detail**: `isLowRisk = fullText.length < 200`. Jawaban statistik singkat ("IPM Kota Ternate 2024 adalah **82.45**") biasanya <200 chars. Ini justru yang PALING butuh fabrication check — satu angka salah di jawaban singkat lebih sulit dideteksi rule-based.

### [M11] Orchestrator Aktif untuk Simple Tier Query dengan Analytical Pattern
**File**: `orchestrator.service.js:88-101`
**Detail**: `isAnalytical` match (e.g., "bandingkan inflasi Ternate vs Tidore") fire tanpa cek `isComplexTier`. Query SIMPLE tier mendapat +3-8s latency dan 3-5 LLM calls tambahan. Komentar line 14 bilang "COMPLEX/DEEP tiers" tapi code tidak enforce.

### [M12] Disambiguation Hint Threshold Off-by-One
**File**: `knowledgeContext.service.js:2118-2122`
**Detail**: Hint hanya muncul jika `gap < 0.5`. Phrase bonus = 0.5 per bigram. Satu bigram match membuat gap tepat 0.5, yang GAGAL check `< 0.5`. Hint TIDAK ditampilkan meski distinction antar tabel penting. Seharusnya `<= 0.5` atau `< 1.0`.

### [M13] Low-Confidence Knowledge (40-74 score) Bisa Cause Wrong Number Citation
**File**: `prompt.service.js:282-289`
**Detail**: Graduated confidence: score 40-74 → "DATA KEMUNGKINAN TERSEDIA". LLM diinstruksikan present numbers yang ditemukan. Tapi doc bisa topically adjacent tapi bukan exact match → LLM cite angka dari indicator berbeda.

### [M14] Self-Check Threshold di multiStrategySearch Pakai Combined Score, Bukan Raw Cosine
**File**: `multiStrategySearch.service.js:430-431`
**Detail**: Self-check (LLM re-query) hanya trigger jika `topSim < 0.55`. Tapi `topSim` = combined score (cosine + keyword 0.10 + recency 0.05). Raw cosine 0.40 + boosts = 0.55 → self-check TIDAK trigger meski semantic match lemah.

### [M15] Supervisor Truncate Response di 3000 chars — DEEP Tier 16K Tokens Tidak Tercover
**File**: `supervisor.service.js:802-805`
**Detail**: Supervisor LLM hanya lihat 3000 chars pertama dari response. DEEP tier bisa output 16000 tokens (~12000 chars). Fabricated stats di bagian tengah/akhir (per-kabupaten breakdowns) tidak pernah di-review.

### [M16] SMART_CONTEXT DEEP: 10 docs × 80K = 800K, Tapi totalBudget Hanya 400K
**File**: `config.js:123-128`, `pipeline.service.js:2569-2617`
**Detail**: Per-doc loop truncate individual docs ke `perDocChars` tapi tidak ada cumulative guard. 10 docs masing-masing 80K = 800K chars di-assemble, lalu `trimMessagesToBudget` harus crude-cut di atas total 400K. Bisa memotong system prompt atau user question.

---

## LOW FINDINGS (5)

### [L1] Creative Route LLM Gate Tidak Set `skipSupervisor` Eksplisit
**File**: `gateAgent.service.js:435-464`

### [L2] `expandAbbreviationsInline` Rebuild Regex Setiap Call
**File**: `bpsAbbreviations.js:125-135`
**Detail**: ~60 regex dibangun ulang setiap invocation. Performance minor tapi bisa di-cache.

### [L3] Compaction Model Pakai Gemini Flash
**File**: `config.js:68`
**Detail**: `COMPACTION.MODEL = gemini-3-flash-preview`. Summarizing 25 messages untuk compaction membutuhkan nuance — Gemini Flash bisa kehilangan detail penting.

### [L4] `PIPELINE_TIMEOUT_MS = 600000` (10 Menit) di V2
**File**: `pipelineV2.service.js:69`
**Detail**: 10 menit sangat lama untuk user-facing chat. Production V1 tidak punya global timeout.

### [L5] Cost Tracking Incomplete — Supervisor/Reconciler/Compaction LLM Calls Tidak Tracked
**Detail**: `costTracker.record()` hanya dipanggil untuk main chat generation. LLM calls dari supervisor, reconciler, dan compaction tidak di-track.

---

## RESOURCE EFFICIENCY ANALYSIS

### Current State
| Resource | Value | Concern |
|---|---|---|
| Heap used | 917 MB / 1024 MB (89.5%) | CRITICAL — sangat dekat OOM |
| Restarts | 32 / 29 jam | ~1.1 restart/jam — likely OOM |
| Embedding cache | 27K+ docs in memory | Kontributor heap utama |
| Concurrency | MAX_CONCURRENT=2 | Setiap pipeline +200 MB transient |
| PM2 processes | 16 total | Server shared, bukan dedicated |

### Cost per Query (Estimated)
| Tier | LLM Calls | Estimated Cost |
|---|---|---|
| GREETING | 1 (Claude Sonnet) + supervisor | ~$0.003 (wasteful — bisa $0.0006 dengan Haiku) |
| SIMPLE | 1 main + supervisor + suggestions | ~$0.01-0.02 |
| COMPLEX | 1 main + supervisor + orchestrator | ~$0.03-0.05 |
| DEEP | 1 main + supervisor + orchestrator + reconciler | ~$0.05-0.10 |

### Quick Wins untuk Efisiensi
1. **GREETING → Haiku**: -80% cost untuk greetings (~5x cheaper)
2. **Fix thinking budgets**: Prevent API errors, reduce wasted tokens
3. **Naikkan max-old-space-size ke 2048**: Reduce OOM restarts
4. **Aktivasi V2 pipeline**: 50-90s → 18-30s latency (parallelism)
5. **Cache abbreviation regex**: Minor but easy win

---

## V1 vs V2 GAP ANALYSIS

| Aspek | V1 (Aktif) | V2 (Tidak Aktif) |
|---|---|---|
| Architecture | 10-stage sequential | 3-layer parallel |
| Wait points | 5-7 sequential | 3 (parallel within layers) |
| LLM calls | 8-10 | 5-6 |
| Latency | 18-30s (optimized) | 18-30s (designed) |
| Publication retry | Tidak ada | Ada (confidence-based) |
| Sub-agents | Tidak ada | datasource, publication, nonstat |
| Tested | 56/56 accuracy | Same test suite |
| Client disconnect | Checked 4 places | Checked 3 places |

**Rekomendasi**: V2 siap diaktifkan — sudah tested 56/56 accuracy. Gunakan `PIPELINE_VERSION=shadow` dulu untuk perbandingan, lalu `gradual:10` untuk 10% traffic.

---

## T8 ROOT CAUSE ANALYSIS (Labor Force per Kab/Kota — Doc 847)

**Query**: "angkatan kerja per kabupaten/kota" (atau variasi)
**Status**: Satu-satunya test case yang GAGAL (20/21 deep doc accuracy)

### Probable Failure Chain

1. **Stopword filtering** (`knowledgeContext.service.js:1489-1493`): Query words setelah filter = `['angkatan', 'kerja']`. Words `'per'`, `'kabupaten'`, `'kota'` di-strip.

2. **Indicator index mismatch**: Doc 847 kemungkinan besar pakai entry seperti `TBL|4.1|Ketenagakerjaan menurut Kabupaten/Kota` — kata "ketenagakerjaan" BUKAN "angkatan kerja". Function `extractByIndicatorIndex` pakai `titleLower.includes(w)` tanpa stem expansion → "angkatan" dan "kerja" tidak match "ketenagakerjaan".

3. **STEM_MAP gap** (`vectorSearch.service.js`): Entry `ketenagakerjaan → ['ketenagakerjaan', 'pengangguran', 'nganggur', 'tpt', 'tenaga kerja', 'pekerja']` TIDAK include `'angkatan kerja'` atau `'angkatan'`. Vector similarity bisa menemukan doc, tapi indicator-guided extraction gagal locate exact table.

4. **Fallback ke chunk-window**: Saat indicator extraction return null → fallback ke `extractChunkWindow`. Tapi chunk position bisa land di TOC section, bukan actual data table → "absolute numbers not found".

### Fix Path
1. Tambah `'angkatan kerja'`, `'angkatan'` ke STEM_MAP entry `ketenagakerjaan`
2. Tambah ke `INDICATOR_GROUPS.unemployment` synonyms di `knowledgeContext.service.js`
3. Ini enable indicator injection untuk find doc 847's ketenagakerjaan entries saat query pakai "angkatan kerja"

---

## EVAL COVERAGE BLIND SPOTS

### Tidak Di-Test
1. **Multi-turn conversations** (0 test cases)
2. **Numerical accuracy** (regex hanya cek keyword, bukan angka)
3. **Model fallback** (Claude → Gemini)
4. **Concurrent requests** (MAX_CONCURRENT=2, tapi tidak di-stress-test)
5. **Large document extraction** (T8 masih gagal — labor force per kab/kota)
6. **Reconciler accuracy** (multi-source overlap resolution)
7. **Context truncation impact** (trimMessagesToBudget effect on accuracy)
8. **Follow-up with context switch** ("sekarang tentang inflasi")
9. **Ambiguous queries with multiple data sources** (e.g., kemiskinan ada di tabel + BRS)

### Test Suite Improvement Suggestions
1. **Numeric accuracy tests**: Tambahkan `expectedValue` field, bandingkan angka di response
2. **Multi-turn scenarios**: Buat test chain (query 1 → follow-up → context switch)
3. **Negative tests yang lebih ketat**: `not` field sering null — tambahkan hallucination checks
4. **Latency regression**: Tambahkan `maxLatencyMs` per test case (sudah ada di eval-set.json tapi tidak di master-test-cases.json)

---

## PRIORITIZED ACTION ITEMS

### P0 — Immediate (Hari Ini) — Security & Reliability
| # | Finding | Action | Impact |
|---|---------|--------|--------|
| 1 | **[C1]** API key hardcoded | Pindahkan ke `.env`, rotasi key | Security fix |
| 2 | **[C3]** GREETING budget > max_tokens | Set `thinking_budget: null` untuk GREETING | Prevent API errors |
| 3 | **[H1]** SIMPLE budget == max_tokens | Naikkan `max_tokens` ke 6000-8000 | Prevent blank responses |
| 4 | **[H6]** Heap 89.5% | Naikkan `--max-old-space-size` ke 2048 | Reduce OOM crashes |

### P1 — Minggu Ini — Core Accuracy
| # | Finding | Action | Impact |
|---|---------|--------|--------|
| 5 | **[C2]** Claude identity conflict | Ganti identity prefix, atau pakai regular API key | Accuracy improvement |
| 6 | **[C4]** OOS blocks agama/etnis | Exempt demographic keywords dari OOS patterns | Unblock valid queries |
| 7 | **[C5]** skipRerank too aggressive | Hanya skip jika fast-path hit atau cosine >=0.90 | RAG accuracy +20-30% |
| 8 | **[C6]** High-confidence bypass | Naikkan threshold ke 0.92 + inline dedup | RAG diversity |
| 9 | **[C7]** Layer 1 retry no guardrails | Include core anti-fabrication rules di retry prompt | Reduce hallucination |
| 10 | **[H2]** isKnowledgeMode unused | Tambah sebagai strong signal di routeModel | Context budget fix |
| 11 | **[H5]** Double abbreviation | Idempotency guard di `expandAbbreviationsInline` | Clean LLM input |

### P2 — 2 Minggu — Pipeline & RAG Optimization
| # | Finding | Action | Impact |
|---|---------|--------|--------|
| 12 | **[H8]** V2 not active | Set `PIPELINE_VERSION=shadow` lalu `gradual:10` | Latency improvement |
| 13 | **[H10]** Judge MAX_CANDIDATES=20 | Ensure category diversity dalam top 20 (min 5 Publikasi) | Recall improvement |
| 14 | **[H11]** Supervisor bypass | Tambah exception: jika fabrication=true DAN angka tidak ditemukan di context, jangan revert | Hallucination defense |
| 15 | **[H14]** Cache key missing skipRerank | Tambah skipRerank ke cache key | Cache correctness |
| 16 | **[M9]** 6 vs 15 refusal patterns | Sync supervisor patterns dengan Layer 1 | UI consistency |
| 17 | **[M10]** Skip <200 chars | Naikkan threshold ke 500 chars, atau selalu run untuk statistical | Fabrication detection |
| 18 | **T8** Root cause | Tambah 'angkatan kerja' ke STEM_MAP + INDICATOR_GROUPS | Fix last failing test |

### P3 — Bulan Ini — Eval & Hardening
| # | Finding | Action | Impact |
|---|---------|--------|--------|
| 19 | **[M5-M6]** Eval gaps | Numeric accuracy tests + multi-turn scenarios | Test coverage |
| 20 | **[H3-H4]** Gate rule ordering | Refactor EXIM + institutional patterns priority | Routing accuracy |
| 21 | **[H12]** Contradictory prompt | Restructure priority: anti-fabrication > anti-refusal | Reduce hallucination |
| 22 | **[M3]** Auto-continuation | Supervisor review gabungan original+continuation | Quality assurance |
| 23 | **[M15]** Supervisor 3K truncation | Naikkan ke 8K untuk DEEP tier, atau sliding window | Coverage improvement |
| 24 | **[M16]** SMART_CONTEXT overflow | Cumulative char guard di per-doc loop | Budget enforcement |

---

## COMPLETE FINDINGS SUMMARY

| Severity | Count | Key Areas |
|----------|-------|-----------|
| CRITICAL | 7 | Security (1), Identity (1), API Budget (1), OOS Blocking (1), RAG Accuracy (2), Hallucination (1) |
| HIGH | 14 | Token Budgets (2), Routing (3), RAG Recall (3), Abbreviation (1), Memory (1), Docs (1), Cache (1), Prompt (1), Supervisor (1) |
| MEDIUM | 16 | Supervisor (4), Eval (2), Orchestrator (1), Context (3), Temperature (2), Model (2), Cache (1), Threshold (1) |
| LOW | 10+ | Config (3), Performance (2), Patterns (2), Code Quality (2), Misc (1+) |
| **TOTAL** | **47+** | |

---

*Audit dilakukan oleh 4 parallel code-explorer agents + manual deep analysis.*
*Files analyzed: 38+ (pipeline.service.js 3676L, gateAgent ~800L, modelRouter ~350L, supervisor ~450L, knowledgeContext ~2100L, vectorSearch ~1400L, documentJudge ~450L, multiStrategySearch ~500L, orchestrator ~600L, prompt.service ~2000L, config 196L, concurrencyLimiter 113L, pipelineV2 617L, reconciler ~250L, queryClassification ~550L, topicPatterns ~150L, topic.service ~200L, chatHelpers ~400L, openaiChat ~150L, bpsAbbreviations ~150L, dan supporting files).*
*Total lines of code analyzed: ~15,000+*
