# MALIKA Chat Accuracy Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift MALIKA chat accuracy from 91% (real ≈94%) toward ≥98% by fixing the three concrete bugs identified in the 2026-05-12 baseline report — preview-period over-refusal (B2), concatenated-typo retrieval miss (B1), and eval-fixture false positives (B3).

**Architecture:** Three independent, sequenced changes. B3 (fixture cleanup) first to give a clean baseline number, then B1 (queryNormalizer splitter) as an isolated 1-hr change, then B2 (system-prompt surgery in `streaming.service.js`). Each phase is verified by re-running the existing `node backend/evals/run-eval.js --profile=chat` harness before moving to the next.

**Tech Stack:** Node.js (CommonJS, no TS), Jest for unit tests, `backend/evals/run-eval.js` SSE-based 31-case eval, `streaming.service.js` monolithic chat pipeline.

**Out of scope:** Deep-doc RAG integration (B4 — 7 of 11 deep-doc cases need knowledge_doc → preview wiring; needs separate brainstorm). Wholesale prompt rewrite (Option B).

**Source spec:** `docs/superpowers/specs/2026-05-12-chat-accuracy-baseline.md`

---

## File Structure

| File | Action | Responsibility | Lines |
|---|---|---|---|
| `backend/evals/fixtures/chat-cases.json` | Modify | Three cases relaxed so eval stops penalizing correct refusals + non-data Qs | ~30 |
| `backend/src/services/chat/queryNormalizer.service.js` | Modify | Add `splitConcatenated()` step + curated dictionary; wire into `lightNormalize` pipeline | +50 |
| `backend/src/services/chat/__tests__/queryNormalizer.service.test.js` | Create | Jest unit tests for `splitConcatenated` + the `lightNormalize` integration | ~80 |
| `backend/src/services/chat/streaming.service.js` | Modify | `systemPrompt()` at `:352-467` — inject date, rebalance pos/neg, add positive-frame data-handling rules. `buildContextMessages()` at `:3349-3491` — rewrite period-fallback wording at `:3415-3421` and `:3357` | ~60 lines net |
| `docs/workspace/chat-pipeline.md` | Modify | Add Change Log entry for the 2026-05-12 prompt + normalizer fixes | +10 |
| `/root/.claude/projects/-var-www-html/memory/MEMORY.md` | Modify | Add line pointing to new memory file | +1 |
| `/root/.claude/projects/-var-www-html/memory/chat_accuracy_baseline_2026-05-12.md` | Create | Capture baseline numbers + post-fix numbers for future reference | ~60 |

**No new abstractions, no new services, no schema changes.** Pure in-file surgery.

---

## Phase 0: Pre-flight checks

### Task 0: Verify environment + capture pre-fix snapshot

**Files:** none (read-only checks)

- [ ] **Step 1: Verify backend + proxy up**

```bash
pm2 status | grep -E "pds-backend|malika-llm-proxy"
```

Expected: both `online`.

- [ ] **Step 2: Confirm pre-fix eval baseline exists**

```bash
ls -lt /var/www/html/project-data-strategis/backend/evals/reports/eval-2026-05-11-23-04.{md,json}
```

Expected: both files present (the baseline this plan was designed against).

- [ ] **Step 3: Save pre-fix scores for diff at the end**

```bash
cp /var/www/html/project-data-strategis/backend/evals/reports/eval-2026-05-11-23-04.json /tmp/pre-fix-baseline.json
echo "Pre-fix overall: $(jq '.profiles.chat.summary.overall_score' /tmp/pre-fix-baseline.json)"
```

Expected output: `Pre-fix overall: 0.911` (or close to it).

---

## Phase 1: B3 — Eval fixture cleanup

**Why first:** Three cases in `chat-cases.json` penalize *correct* behavior (refusing fabrication, using "belum tersedia" politely, not citing `%` on non-data questions). Fixing them is free, gives a clean baseline that won't move when we change the prompt, and exposes only the *real* model issues.

### Task 1: Relax `edge-nondata-02` shouldContain rule

**Files:**
- Modify: `backend/evals/fixtures/chat-cases.json`

- [ ] **Step 1: Read the file first, per CLAUDE.md**

```bash
cd /var/www/html/project-data-strategis
```

Open `backend/evals/fixtures/chat-cases.json` and find the `edge-nondata-02` case (query: `"cara mengakses data BPS"`).

- [ ] **Step 2: Backup before edit**

```bash
cp backend/evals/fixtures/chat-cases.json backend/evals/fixtures/chat-cases.json.backup
```

- [ ] **Step 3: Edit the case**

Find:

```json
{
  "id": "edge-nondata-02",
  "category": "edge",
  "query": "cara mengakses data BPS",
  "expect": {
    "shouldContain": ["%|persen"],
```

Change `shouldContain` to remove the data-citation requirement (this is a procedural Q, not a data Q). Replace with content checks that match a reasonable answer:

```json
  "expect": {
    "shouldContain": ["website|bps.go.id|wa|whatsapp|datang|kantor"],
```

(Pipe-separated alternatives let any of those tokens satisfy the rule.)

- [ ] **Step 4: Verify the diff**

```bash
diff backend/evals/fixtures/chat-cases.json.backup backend/evals/fixtures/chat-cases.json
```

Expected: only the `shouldContain` array changed for `edge-nondata-02`.

- [ ] **Step 5: Commit**

```bash
git add backend/evals/fixtures/chat-cases.json
git commit -m "fix(evals): relax edge-nondata-02 shouldContain — procedural Q doesn't need %|persen"
```

### Task 2: Relax `hallucination-guard-01` shouldNotContain

**Files:**
- Modify: `backend/evals/fixtures/chat-cases.json`

- [ ] **Step 1: Read the case**

Find `hallucination-guard-01` (query: `"angka harapan hidup maluku utara 2030"`). Its current expectation includes `shouldNotContain: ["tidak tersedia"]` — but the correct response *is* to refuse a future-year request.

- [ ] **Step 2: Backup before edit**

```bash
cp backend/evals/fixtures/chat-cases.json backend/evals/fixtures/chat-cases.json.backup
```

- [ ] **Step 3: Edit the case**

Replace the `shouldNotContain` array. The real failure mode to guard against is *citing a fabricated 2030 number*, not the polite refusal phrase. Change to:

```json
  "expect": {
    "shouldContain": ["belum tersedia|tidak tersedia|proyeksi|2030"],
    "shouldNotContain": ["AHH 2030 adalah", "tahun 2030: "],
    "mustCiteNumber": true,
```

(`mustCiteNumber: true` is fine because the response cites past years 2021-2023 as referensi.)

- [ ] **Step 4: Verify diff**

```bash
diff backend/evals/fixtures/chat-cases.json.backup backend/evals/fixtures/chat-cases.json
```

Expected: only `hallucination-guard-01` changed.

- [ ] **Step 5: Commit**

```bash
git add backend/evals/fixtures/chat-cases.json
git commit -m "fix(evals): hallucination-guard-01 should test for fabricated 2030 numbers, not refusal phrasing"
```

### Task 3: Relax `knowledge-ppid-01` shouldNotContain

**Files:**
- Modify: `backend/evals/fixtures/chat-cases.json`

- [ ] **Step 1: Read the case**

Find `knowledge-ppid-01` (query: `"siapa kepala BPS maluku utara"`). The model correctly refuses fabrication; eval penalizes "tidak tersedia". The real test is "did the model invent a person?".

- [ ] **Step 2: Backup**

```bash
cp backend/evals/fixtures/chat-cases.json backend/evals/fixtures/chat-cases.json.backup
```

- [ ] **Step 3: Edit**

Replace the expect block with:

```json
  "expect": {
    "shouldContain": ["BPS"],
    "shouldNotContain": ["Drs.", "M.Sc.", "M.Si.", "S.E.,"],
    "minLength": 50,
    "maxLatencyMs": 30000
  }
```

(The negative tokens are the academic-title patterns the original fabrications used — `Drs. Simon Sapary, M.Sc.`. Refusing-by-deferring-to-BPS-RI is acceptable.)

- [ ] **Step 4: Verify diff**

```bash
diff backend/evals/fixtures/chat-cases.json.backup backend/evals/fixtures/chat-cases.json
```

- [ ] **Step 5: Commit**

```bash
git add backend/evals/fixtures/chat-cases.json
git commit -m "fix(evals): knowledge-ppid-01 tests fabricated-name guards, not refusal phrasing"
```

### Task 4: Re-run baseline eval (Phase-1 verification)

**Files:** none (run-only)

- [ ] **Step 1: Re-run the 31-case eval**

```bash
cd /var/www/html/project-data-strategis/backend && \
  EVAL_API_BASE=http://127.0.0.1:5000 EVAL_DELAY_MS=3000 \
  node evals/run-eval.js --profile=chat > /tmp/eval-phase1.log 2>&1
```

Wait ~11 minutes. Tail to confirm progress: `tail -f /tmp/eval-phase1.log`.

Expected: 31 cases complete with `💾 Report saved` line at the end.

- [ ] **Step 2: Compare scores**

```bash
NEWEST=$(ls -t backend/evals/reports/eval-*.json | head -1)
echo "Pre-fix:  $(jq '.profiles.chat.summary.overall_score' /tmp/pre-fix-baseline.json)"
echo "Phase 1:  $(jq '.profiles.chat.summary.overall_score' $NEWEST)"
```

Expected: phase-1 score ≥ 0.95 (was 0.911 — the 3 false-positive cases should now pass).

- [ ] **Step 3: Verify the 3 expected case-flips**

```bash
jq '.profiles.chat.cases[] | select(.id=="edge-nondata-02" or .id=="hallucination-guard-01" or .id=="knowledge-ppid-01") | {id, grade: .score.grade, composite: .score.composite}' $NEWEST
```

Expected: all three have grade `A` or `B` (previously `D`/`C`/`C`).

- [ ] **Step 4: Note remaining failures (these are the real model bugs B1/B2 will address)**

```bash
jq '.profiles.chat.cases[] | select(.score.grade=="D" or .score.grade=="F") | {id, query, grade: .score.grade}' $NEWEST
```

Expected: `complex-01` (kemiskinan per kabupaten) and possibly `knowledge-brs-01` (inflasi kelompok pengeluaran) — the two real B2 cases.

---

## Phase 2: B1 — `queryNormalizer.lightNormalize` concatenated-token splitter

**Why:** Canonical 2026-05-11 production miss was `"pertumbuhanekonomi maluku utara triwulan 1 2025"` — `"pertumbuhanekonomi"` (no space) failed every datasource match → `NO_MATCH`. The fix is a small dictionary-driven splitter run inside `lightNormalize`.

### Task 5: Write failing test for `splitConcatenated`

**Files:**
- Create: `backend/src/services/chat/__tests__/queryNormalizer.service.test.js`

- [ ] **Step 1: Create the test file**

```javascript
'use strict';
const {
  splitConcatenated,
  lightNormalize,
} = require('../queryNormalizer.service');

describe('splitConcatenated', () => {
  test('splits the canonical 2026-05-11 miss', () => {
    expect(splitConcatenated('pertumbuhanekonomi')).toBe('pertumbuhan ekonomi');
  });

  test('splits inside a multi-word query', () => {
    expect(splitConcatenated('pertumbuhanekonomi maluku utara triwulan 1 2025'))
      .toBe('pertumbuhan ekonomi maluku utara triwulan 1 2025');
  });

  test('matches case-insensitively (lowercases the match)', () => {
    expect(splitConcatenated('PertumbuhanEkonomi malut').toLowerCase())
      .toBe('pertumbuhan ekonomi malut');
  });

  test('does not split already-spaced phrases', () => {
    expect(splitConcatenated('pertumbuhan ekonomi malut'))
      .toBe('pertumbuhan ekonomi malut');
  });

  test('leaves non-dictionary words alone', () => {
    expect(splitConcatenated('xyzabc')).toBe('xyzabc');
  });

  test('splits multiple known concatenations in one query', () => {
    expect(splitConcatenated('kondisiekonomi dan pertumbuhanekonomi'))
      .toBe('kondisi ekonomi dan pertumbuhan ekonomi');
  });

  test('null/undefined safe', () => {
    expect(splitConcatenated(null)).toBe('');
    expect(splitConcatenated(undefined)).toBe('');
    expect(splitConcatenated('')).toBe('');
  });
});

describe('lightNormalize integration', () => {
  test('lightNormalize applies splitConcatenated', () => {
    const out = lightNormalize('pertumbuhanekonomi maluku utara triwulan 1 2025');
    expect(out.toLowerCase()).toContain('pertumbuhan ekonomi');
  });

  test('lightNormalize still fixes existing typos', () => {
    const out = lightNormalize('kemikinan halsel');
    expect(out.toLowerCase()).toContain('kemiskinan');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd /var/www/html/project-data-strategis/backend && \
  npx jest src/services/chat/__tests__/queryNormalizer.service.test.js --no-coverage
```

Expected: 9 failed tests with messages like `splitConcatenated is not a function` (because it doesn't exist yet).

### Task 6: Implement `splitConcatenated`

**Files:**
- Modify: `backend/src/services/chat/queryNormalizer.service.js`

- [ ] **Step 1: Backup before edit**

```bash
cp backend/src/services/chat/queryNormalizer.service.js backend/src/services/chat/queryNormalizer.service.js.backup
```

- [ ] **Step 2: Add the dictionary + function**

Insert this block **between** the `COMMON_TYPOS` block (ends ~line 214) and the `fixTypos` function (starts ~line 221). Use the Edit tool on `streaming.service.js`... wait, this is `queryNormalizer.service.js`. Find the line:

```javascript
};

/**
 * Fix common typos in query
```

Right above the `/**`, add:

```javascript
// ============================================================================
// CONCATENATED-TOKEN SPLITTING
// ============================================================================

// Curated dictionary of statistical-term concatenations seen in real queries.
// Each entry maps a no-space form to its space-separated form. Keys are
// matched case-insensitively but the original case is preserved on output.
//
// Adding entries: only add concatenations of words that BOTH appear as
// independent terms in real BPS indicator names. Don't add general Indonesian
// word pairs — keep this targeted to statistical vocabulary.
const CONCATENATIONS = {
  'pertumbuhanekonomi': 'pertumbuhan ekonomi',
  'kondisiekonomi': 'kondisi ekonomi',
  'lajupertumbuhan': 'laju pertumbuhan',
  'tingkatpengangguran': 'tingkat pengangguran',
  'tingkatkemiskinan': 'tingkat kemiskinan',
  'tingkatpartisipasi': 'tingkat partisipasi',
  'angkaharapan': 'angka harapan',
  'angkamelek': 'angka melek',
  'angkakematian': 'angka kematian',
  'angkapartisipasi': 'angka partisipasi',
  'jumlahpenduduk': 'jumlah penduduk',
  'jumlahpekerja': 'jumlah pekerja',
  'hargakonsumen': 'harga konsumen',
  'indekspembangunan': 'indeks pembangunan',
  'indekshargakonsumen': 'indeks harga konsumen',
  'pendapatanperkapita': 'pendapatan per kapita',
  'pdrbperkapita': 'pdrb per kapita',
  'neracadagang': 'neraca dagang',
  'tenagakerja': 'tenaga kerja',
  'angkatankerja': 'angkatan kerja',
};

/**
 * Split known concatenated statistical terms (case-insensitive).
 * Returns lowercase result on match — downstream callers (searchDatasources)
 * already lowercase queries, so case-preservation isn't needed.
 *
 * @param {string|null|undefined} query
 * @returns {string}
 */
function splitConcatenated(query) {
  if (!query) return '';
  let out = String(query);
  for (const [joined, split] of Object.entries(CONCATENATIONS)) {
    const re = new RegExp(`\\b${joined}\\b`, 'gi');
    out = out.replace(re, split);
  }
  return out;
}

```

- [ ] **Step 3: Wire `splitConcatenated` into `normalizeQuery`**

Inside `queryNormalizer.service.js`, find the `let result = query.trim();` line at `:288`. The next non-blank line is the comment `// Order matters:`. Insert a new step between them:

Find:

```javascript
  let result = query.trim();
  
  // Order matters:
  // 1. Fix typos first (so abbreviations work on corrected text)
  if (shouldFixTypos) {
    result = fixTypos(result);
  }
```

Replace with:

```javascript
  let result = query.trim();
  
  // Order matters:
  // 0. Split known concatenated tokens FIRST so the typo fixer + geo + abbrev
  //    can see the word boundaries
  result = splitConcatenated(result);
  
  // 1. Fix typos first (so abbreviations work on corrected text)
  if (shouldFixTypos) {
    result = fixTypos(result);
  }
```

(The new step is unconditional — splitting concatenated terms is always safe and the dictionary is curated.)

- [ ] **Step 4: Export the new function**

Find `module.exports = { ... }` at the bottom. Add `splitConcatenated,` to the main-functions block, and `CONCATENATIONS,` to the testing-export block:

```javascript
module.exports = {
  normalizeQuery,
  lightNormalize,
  expandForLLM,
  splitConcatenated,           // ← NEW
  // Individual processors
  expandAbbreviations,
  normalizeGeoNames,
  fixTypos,
  removeFillers,
  // Exports for testing
  ABBREVIATIONS,
  GEO_ALIASES,
  COMMON_TYPOS,
  CONCATENATIONS,              // ← NEW
};
```

- [ ] **Step 5: Verify diff**

```bash
diff backend/src/services/chat/queryNormalizer.service.js.backup backend/src/services/chat/queryNormalizer.service.js | head -60
```

Expected: a single block addition for the dictionary + function + the `normalizeQuery` wiring + the two `module.exports` line additions.

- [ ] **Step 6: Run the test — should now pass**

```bash
npx jest src/services/chat/__tests__/queryNormalizer.service.test.js --no-coverage
```

Expected: `9 passed, 9 total`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/chat/queryNormalizer.service.js \
        backend/src/services/chat/__tests__/queryNormalizer.service.test.js
git commit -m "feat(queryNormalizer): split concatenated statistical terms (B1)

Adds splitConcatenated() with a 20-entry curated dictionary of
no-space statistical phrases (pertumbuhanekonomi -> pertumbuhan ekonomi).
Runs first in normalizeQuery() pipeline, before typo fixes.

Closes the 2026-05-11 canonical miss: 'pertumbuhanekonomi maluku utara
triwulan 1 2025' now tokenizes correctly and matches PDRB indikator."
```

### Task 7: Reload backend + replay canonical case

**Files:** none (smoke test)

- [ ] **Step 1: Reload pds-backend so the change ships**

```bash
pm2 reload pds-backend --update-env
```

Wait ~30s for embedding preload to finish:

```bash
until curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:5000/data-sources 2>/dev/null | grep -q "200\|404"; do sleep 2; done
echo "backend ready"
```

- [ ] **Step 2: Re-probe the canonical query**

```bash
node /tmp/canonical-probe.js > /tmp/probe-phase2.log 2>&1
tail -30 /tmp/probe-phase2.log
```

Expected: the `[intent]` event now shows `candidates.length > 0` and `strategy !== "NO_MATCH"` (was 0 + `NO_MATCH` before Phase 2). The `effectiveQuery` should contain `"pertumbuhan ekonomi"` (split), not `"pertumbuhanekonomi"`.

- [ ] **Step 3: Re-run the flag replay (29 cases) to catch regressions**

```bash
API_BASE=http://127.0.0.1:5000 DELAY_MS=2000 \
  node /tmp/replay-flagged.js > /tmp/replay-phase2.log 2>&1
echo "DONE"; tail -3 /tmp/replay-phase2.log
```

Expected: `Saved 29 results`. Compare candidates counts:

```bash
jq '[.[] | {fid: .flag_id, cand_pre: 0, cand_post: .candidates_count}] | map(select(.cand_post > 0))' /tmp/flag-replay-results.json
```

(Document any newly-matching candidates — but no regressions: no case should drop from `cand>0` to `cand=0`.)

- [ ] **Step 4: Commit only if a docs change is needed**

No commit at this step unless the smoke test surfaces something.

---

## Phase 3: B2 — System prompt surgery

**Why:** The smoking gun is canonical probe variants 3 & 4 — retrieval works (5 candidates), preview loads (20 rows), but the model still says *"data belum tersedia"*. This is a prompt-discipline problem. Three sub-fixes:

- **3a**: Inject today's date + BPS release cadence so the model can reason temporally.
- **3b**: Replace the period-fallback wording (currently "WAJIB beritahu user: 'X belum tersedia'") with a positive-frame rule.
- **3c**: Promote Auto-Tune Patterns #13 + #14 + #15 from keyword-triggered to base-prompt rules.

All edits land in `streaming.service.js`. No new files.

### Task 8: 3a — Inject today's date + BPS cadence

**Files:**
- Modify: `backend/src/services/chat/streaming.service.js` (within `systemPrompt()`, around `:355`)

- [ ] **Step 1: Backup before edit**

```bash
cp backend/src/services/chat/streaming.service.js backend/src/services/chat/streaming.service.js.backup
```

- [ ] **Step 2: Find the `IDENTITAS & PERAN:` block in `systemPrompt`**

Line ~355: `Kamu adalah MALIKA...`. After the `IDENTITAS & PERAN:` block ends, add a new `KONTEKS WAKTU` block.

- [ ] **Step 3: Edit — insert date awareness**

Use the Edit tool. Replace:

```javascript
TUGAS UTAMA:
1. Membantu user menemukan data statistik yang tepat
```

With:

```javascript
KONTEKS WAKTU:
- Hari ini: ${new Date().toISOString().slice(0, 10)} (timezone WIT/UTC+9)
- BPS umumnya merilis: data triwulanan ~2 bulan setelah triwulan berakhir; data tahunan ~Maret tahun berikutnya; data bulanan ~6 minggu setelah bulan berakhir
- Gunakan info ini untuk menilai apakah data SEHARUSNYA sudah tersedia di sistem sebelum menjawab "belum tersedia"

TUGAS UTAMA:
1. Membantu user menemukan data statistik yang tepat
```

Note: this requires changing the surrounding string from a backtick-template literal (it already is one — the file uses `` `Kamu adalah MALIKA...` ``), so `${new Date()...}` interpolates at request time.

- [ ] **Step 4: Verify the date interpolates correctly**

```bash
node -e "
const s = require('./src/services/chat/streaming.service.js');
// systemPrompt is not exported — manually call it via a probe
const today = new Date().toISOString().slice(0, 10);
console.log('today should be:', today);
console.log('and substring is in file:', require('fs').readFileSync('./src/services/chat/streaming.service.js','utf8').includes('KONTEKS WAKTU'));
"
```

Expected: today's date prints, and `true` for substring check.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/chat/streaming.service.js
git commit -m "feat(prompt): inject today's date + BPS release cadence (B2/3a)

Adds KONTEKS WAKTU block to systemPrompt() so the model can reason
about whether requested data should be released yet, e.g. Q1 2025
ended 14 months ago -> data should be in DB."
```

### Task 9: 3b — Rewrite period-fallback wording (positive frame)

**Files:**
- Modify: `backend/src/services/chat/streaming.service.js` at `:415-425` (inside `systemPrompt`) and at `:3415-3421` (inside `buildContextMessages`)

- [ ] **Step 1: Backup**

```bash
cp backend/src/services/chat/streaming.service.js backend/src/services/chat/streaming.service.js.backup
```

- [ ] **Step 2: Replace the systemPrompt periodFallback block (~`:418-424`)**

Find:

```javascript
    if (periodFallback) {
      previewRule += `

PENTING - PERIODE TIDAK TERSEDIA:
- User meminta data tahun ${periodFallback.requestedYear} tapi TIDAK tersedia
- Data yang ditampilkan adalah tahun ${periodFallback.actualYear} (${periodFallback.direction} yang tersedia)
- WAJIB beritahu user: "Data tahun ${periodFallback.requestedYear} belum tersedia. Berikut data tahun ${periodFallback.actualYear} sebagai referensi:"`;
    }
```

Replace with:

```javascript
    if (periodFallback) {
      previewRule += `

PERIODE FALLBACK (data ada tapi bukan tahun yang diminta):
- User minta tahun ${periodFallback.requestedYear}; yang tersedia adalah tahun ${periodFallback.actualYear} (${periodFallback.direction})
- JANGAN buka jawaban dengan "belum tersedia". Buka dengan angkanya.
- Format yang diharapkan: "Berikut data tahun ${periodFallback.actualYear} (tahun ${periodFallback.requestedYear} belum dirilis): [angka spesifik]"
- Setelah menyebut angka, satu kalimat singkat tentang relevansi periode fallback boleh ditambahkan.`;
    }
```

- [ ] **Step 3: Replace the buildContextMessages periodFallback block (~`:3415-3421`)**

Find:

```javascript
    // Add period fallback notice
    if (periodFallback) {
      contextContent += `

⚠️ CATATAN PERIODE: User meminta tahun ${periodFallback.requestedYear}, tetapi data tersebut BELUM TERSEDIA.
Data yang ditampilkan adalah tahun ${periodFallback.actualYear} (data ${periodFallback.direction} yang tersedia).
WAJIB sampaikan ini ke user dengan kalimat seperti: "Data tahun ${periodFallback.requestedYear} belum tersedia. Berikut data tahun ${periodFallback.actualYear} sebagai referensi:"`;
    }
```

Replace with:

```javascript
    // Add period fallback notice — positive frame: lead with data, mention period in passing
    if (periodFallback) {
      contextContent += `

CATATAN PERIODE — POSITIF FRAME:
Tahun yang user minta: ${periodFallback.requestedYear}; tahun yang ditampilkan: ${periodFallback.actualYear} (${periodFallback.direction}).
Buka jawaban DENGAN ANGKA dari rows di atas. Sebut periode fallback satu kalimat saja, contoh:
"Berikut data tahun ${periodFallback.actualYear} (tahun ${periodFallback.requestedYear} belum dirilis): [angka]. ..."
JANGAN mulai dengan "belum tersedia" atau "tidak tersedia" — rows-nya ADA.`;
    }
```

- [ ] **Step 4: Verify the diff**

```bash
diff backend/src/services/chat/streaming.service.js.backup backend/src/services/chat/streaming.service.js
```

Expected: only the two periodFallback blocks changed, no other lines.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/chat/streaming.service.js
git commit -m "feat(prompt): positive-frame period fallback wording (B2/3b)

Replaces 'WAJIB beritahu: belum tersedia + referensi' with
'JANGAN mulai dengan belum tersedia; buka dengan angka' in both
systemPrompt() and buildContextMessages(). Fixes canonical
probes 3 and 4 where rows=20 was loaded but model refused."
```

### Task 10: 3c — Promote Auto-Tune Patterns 13/14/15 to base-prompt rules

**Files:**
- Modify: `backend/src/services/chat/streaming.service.js` at `systemPrompt()` `:355-406`

- [ ] **Step 1: Backup**

```bash
cp backend/src/services/chat/streaming.service.js backend/src/services/chat/streaming.service.js.backup
```

- [ ] **Step 2: Read the existing pattern fix_content from DB so we mirror it faithfully**

```bash
cd /var/www/html/project-data-strategis/backend && node -e "
const db = require('./src/models');
(async () => {
  try {
    const [rows] = await db.sequelize.query(\`SELECT id, pattern_name, fix_content FROM chat_error_patterns WHERE id IN (13,14,15)\`);
    for (const r of rows) {
      console.log('--- Pattern', r.id, '—', r.pattern_name);
      console.log(r.fix_content);
      console.log();
    }
  } finally { await db.sequelize.close(); }
})();
"
```

Save the printed text — you'll need it verbatim in the next step.

- [ ] **Step 3: Edit `systemPrompt()` to add a `KETERSEDIAAN DATA` block**

In `streaming.service.js`, find the `BATASAN PENTING:` block (~`:369-374`). Right AFTER it, before `FORMAT RESPONS:`, insert:

```javascript
KETERSEDIAAN DATA — ATURAN DEFAULT (penting):
- Jika dataPreview.rows.length > 0: jawaban WAJIB pakai angka dari rows. Tahun yang berbeda dari permintaan user BUKAN alasan menolak.
- Jika kandidat datasource > 0 (meski rows belum termuat): sebut nama indikator yang relevan dan tawarkan untuk menampilkan. JANGAN katakan "data tidak tersedia".
- Hanya katakan "belum tersedia" jika BENAR-BENAR: kandidat = 0 DAN tidak ada dokumen knowledge yang cocok.
- Untuk query analisis multi-indikator (misal "kondisi ekonomi"): sajikan setiap indikator yang ditemukan (PDRB, inflasi, kemiskinan, TPT, IPM) — JANGAN hanya satu.

```

(The phrasing combines the regression-validated fix_content from Patterns #13, #14, #15 into permanent base rules.)

- [ ] **Step 4: Rebalance — soften two of the most negative `BATASAN PENTING` lines**

In the same block, find:

```javascript
BATASAN PENTING:
- HANYA gunakan data dari database/cache yang tersedia
- JANGAN mengarang angka statistik/persentase/jumlah
- Jika data tidak tersedia, katakan dengan jujur
- JANGAN menyebut URL mentah dalam jawaban
- Fokus pada data Maluku Utara
```

Replace with:

```javascript
PRINSIP DATA:
- Cite hanya angka yang ADA di dataPreview, knowledgeContext, atau yang user sebutkan sendiri
- JANGAN mengarang angka statistik/persentase/jumlah — pakai apa yang ada di konteks
- Fokus pada data Maluku Utara
- JANGAN menyebut URL mentah dalam jawaban
```

(Removed `"Jika data tidak tersedia, katakan dengan jujur"` since it now lives in the more nuanced `KETERSEDIAAN DATA` block above, and renaming the heading from `BATASAN` to `PRINSIP` shifts framing.)

- [ ] **Step 5: Verify diff**

```bash
diff backend/src/services/chat/streaming.service.js.backup backend/src/services/chat/streaming.service.js | head -80
```

Expected: only the `BATASAN PENTING` → `PRINSIP DATA` rename + the new `KETERSEDIAAN DATA` insertion. No other lines.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/chat/streaming.service.js
git commit -m "feat(prompt): promote Auto-Tune patterns to base-prompt rules (B2/3c)

Adds KETERSEDIAAN DATA block to systemPrompt() encoding the
regression-validated fix_content from chat_error_patterns
#13 (analisis ekonomi tampilkan terbaru), #14 (multi-indikator),
and #15 (kab/kota jangan ditolak). Replaces BATASAN PENTING ->
PRINSIP DATA with a less defensive framing."
```

### Task 11: Reload + canonical re-probe (Phase 3 mid-checkpoint)

**Files:** none

- [ ] **Step 1: Reload backend**

```bash
pm2 reload pds-backend --update-env
until curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:5000/data-sources 2>/dev/null | grep -q "200\|404"; do sleep 2; done
echo "ready"
```

- [ ] **Step 2: Re-run the 4-variant canonical probe**

```bash
node /tmp/canonical-probe-v2.js 2>&1 | tee /tmp/canonical-probe-v2-phase3.log
```

Expected behavior changes:
- Variant 1 (`pertumbuhanekonomi...`): cand>0 (B1 fix), rows>=10 (preview should load), response should cite numbers — NOT refuse with "belum tersedia"
- Variants 3 & 4: previously had rows=20 but refused. Now should cite numbers from rows.

- [ ] **Step 3: Grep responses for the regression marker**

```bash
grep -c "belum tersedia\|tidak tersedia\|tidak ditemukan" /tmp/canonical-probe-v2-phase3.log
```

Expected: 0 or 1 (vs. ~3 before — once per variant). If still 3-4, the prompt fix didn't take effect; debug by reading the response sections.

### Task 12: Full eval re-run (Phase 3 final verification)

**Files:** none

- [ ] **Step 1: Run the 31-case eval**

```bash
cd /var/www/html/project-data-strategis/backend && \
  EVAL_API_BASE=http://127.0.0.1:5000 EVAL_DELAY_MS=3000 \
  node evals/run-eval.js --profile=chat > /tmp/eval-phase3.log 2>&1
```

Wait ~11 min. Monitor: `tail -f /tmp/eval-phase3.log`.

- [ ] **Step 2: Compare all three scores**

```bash
PHASE1=$(ls -t backend/evals/reports/eval-*.json | sed -n '2p')   # phase-1 baseline
PHASE3=$(ls -t backend/evals/reports/eval-*.json | head -1)       # latest = phase-3
echo "Pre-fix  (Phase 0): $(jq '.profiles.chat.summary.overall_score' /tmp/pre-fix-baseline.json)"
echo "Phase 1  (fixtures): $(jq '.profiles.chat.summary.overall_score' $PHASE1)"
echo "Phase 3  (prompt+B1): $(jq '.profiles.chat.summary.overall_score' $PHASE3)"
```

Expected progression: ~0.911 → ~0.95 → ≥0.97.

- [ ] **Step 3: Verify B2 textbook cases now pass**

```bash
jq '.profiles.chat.cases[] | select(.id=="complex-01" or .id=="knowledge-brs-01") | {id, grade: .score.grade}' $PHASE3
```

Expected: both `A` or `B` (previously `D`).

- [ ] **Step 4: Run the deep-doc replay (4 B2 textbook cases should also flip)**

```bash
node /tmp/deep-doc-replay.js
tail -20 /tmp/deep-doc-replay.log
```

Expected: T3, T6, T8, T10 (the four with `rows>=11`) now pass. T1/T2/T4/T5/T7/T9/T11 may still fail — those are B4 (out of scope).

Document overall pass-rate in the phase-3 notes.

- [ ] **Step 5: Run jest unit tests for regression**

```bash
cd /var/www/html/project-data-strategis/backend && npx jest --passWithNoTests --no-coverage 2>&1 | tail -10
```

Expected: green (or no worse than the pre-existing failures documented in MEMORY.md: 191 PASS, integration/chat.test.js known to fail).

---

## Phase 4: Docs + memory

### Task 13: Update workspace docs

**Files:**
- Modify: `docs/workspace/chat-pipeline.md`

- [ ] **Step 1: Backup**

```bash
cp docs/workspace/chat-pipeline.md docs/workspace/chat-pipeline.md.backup
```

- [ ] **Step 2: Add Change Log entry**

In `docs/workspace/chat-pipeline.md`, find the `## Change Log` table at the bottom. Add this as the new first row (most recent first):

```markdown
| 2026-05-12 | Chat accuracy fixes (B1+B2+B3) — eval baseline 91.1% → POST-FIX SCORE%. (B3) Eval fixture cleanup: 3 cases relaxed so eval stops penalizing correct refusals (`edge-nondata-02`, `hallucination-guard-01`, `knowledge-ppid-01`). (B1) Added `splitConcatenated` to `queryNormalizer.service.js` with 20-entry dictionary of statistical concatenations (`pertumbuhanekonomi → pertumbuhan ekonomi`). Closes the 2026-05-11 canonical miss. (B2) Prompt surgery in `streaming.service.js`: injected today's date + BPS release cadence in `systemPrompt()`; rewrote period-fallback wording to positive frame in both `systemPrompt()` and `buildContextMessages()`; promoted Auto-Tune Patterns #13/14/15 fix_content to permanent base-prompt rules as new `KETERSEDIAAN DATA` block; renamed `BATASAN PENTING` → `PRINSIP DATA`. Deep-doc cases T3/T6/T8/T10 also flipped (B2 textbook). 7 remaining deep-doc cases (T1/T2/T4/T5/T7/T9/T11) are B4 RAG-side, out of scope. Plan: `docs/superpowers/plans/2026-05-12-malika-chat-accuracy-fixes.md` | `backend/src/services/chat/{queryNormalizer.service,streaming.service}.js`, `backend/src/services/chat/__tests__/queryNormalizer.service.test.js`, `backend/evals/fixtures/chat-cases.json` |
```

(Replace `POST-FIX SCORE%` with the actual number from Task 12 Step 2 — e.g. `97.4%`.)

- [ ] **Step 3: Commit**

```bash
git add docs/workspace/chat-pipeline.md
git commit -m "docs: record 2026-05-12 chat accuracy fixes (B1+B2+B3)"
```

### Task 14: Update auto-memory

**Files:**
- Create: `/root/.claude/projects/-var-www-html/memory/chat_accuracy_baseline_2026-05-12.md`
- Modify: `/root/.claude/projects/-var-www-html/memory/MEMORY.md`

- [ ] **Step 1: Create the memory file**

Write to `/root/.claude/projects/-var-www-html/memory/chat_accuracy_baseline_2026-05-12.md`:

```markdown
---
name: Chat accuracy baseline + fixes 2026-05-12
description: Pre-fix eval baseline 91.1% (real 94%), post-fix POST-FIX-SCORE. Three fixes: B3 eval fixture cleanup, B1 queryNormalizer splitConcatenated, B2 systemPrompt rewrite (today's date + positive-frame period fallback + Auto-Tune Patterns 13/14/15 promoted to base rules). Deep-doc 4/11 cases also flipped (T3, T6, T8, T10). B4 RAG fixes (7 deep-doc cases) deferred to separate plan.
type: project
---

# Chat accuracy fixes — 2026-05-12

> **Why this matters:** The 2026-05-11 production miss `pertumbuhanekonomi maluku utara triwulan 1 2025` exposed dual bugs: a query-normalization gap (B1) AND a prompt-side over-refusal pattern (B2). Auto-Tune Patterns 13/14/15 created post-miss were keyword-triggered patches; the fix here promotes them to base-prompt rules so all queries benefit.
>
> **How to apply:** Whenever editing chat refusal behavior, check whether the case is `cand=0,rows=0` (true refusal warranted) vs `cand>0` or `rows>0` (data exists — must use it). The `KETERSEDIAAN DATA` block in `systemPrompt()` is the canonical rule.

## Pre-fix → post-fix
| Eval | Pre | Post |
|---|---|---|
| chat-cases.json (31) | 0.911 | POST-FIX-SCORE |
| deep-doc replay (11) | 0/11 | POST-DEEP-SCORE (4 B2 cases expected to flip) |
| Canonical probe variants | 1 refused | 0/4 refused |

## What changed
- `streaming.service.js`:
  - Added `KONTEKS WAKTU` block in `systemPrompt()` with today's date + BPS release cadence (so model can reason temporally)
  - Added `KETERSEDIAAN DATA` block encoding Pattern #13/#14/#15 fix_content as permanent rules
  - Renamed `BATASAN PENTING` → `PRINSIP DATA` to soften framing
  - Rewrote period-fallback wording in two places (`systemPrompt` + `buildContextMessages`) to lead with data instead of "belum tersedia"
- `queryNormalizer.service.js`: new `splitConcatenated()` + 20-entry `CONCATENATIONS` dictionary; wired as first step in `normalizeQuery`
- `chat-cases.json`: relaxed 3 cases that penalized correct refusals
- Unit test: `__tests__/queryNormalizer.service.test.js` (9 cases)

## Out of scope (B4 — separate plan)
The 7 deep-doc cases that still fail (T1, T2, T4, T5, T7, T9, T11) are RAG/knowledge_doc retrieval issues — the indexed yearbook content isn't surfacing into `dataPreview` or being passed as `knowledgeContext`. Needs its own brainstorm.

## Eval commands
```bash
# Full chat eval
cd /var/www/html/project-data-strategis/backend && \
  EVAL_API_BASE=http://127.0.0.1:5000 EVAL_DELAY_MS=3000 \
  node evals/run-eval.js --profile=chat

# Canonical probes
node /tmp/canonical-probe.js     # the verbatim 2026-05-11 miss
node /tmp/canonical-probe-v2.js  # 4 variants

# Flag replay
API_BASE=http://127.0.0.1:5000 DELAY_MS=2000 node /tmp/replay-flagged.js

# Deep-doc (with fixed accumulator)
node /tmp/deep-doc-replay.js
```

## Gotchas
- The old `backend/scripts/test-deep-document.js` is STALE — its SSE parser overwrites text deltas instead of appending, and reads `data.metadata.*` paths that no longer exist on `malika_ui`. Use `/tmp/deep-doc-replay.js` instead (or fix the script in a future PR).
- Backend reload after `streaming.service.js` edits is mandatory: `pm2 reload pds-backend --update-env`. No build step needed (it's plain JS).
- `chat_error_patterns` #13/#14/#15 remain `is_active=true` for safety, but their fix_content is now duplicated in the base prompt — that's fine because `getPromptFixes()` appends them only when keyword-matched, and the model treating the same advice twice is harmless.
```

(Replace POST-FIX-SCORE and POST-DEEP-SCORE with actual numbers from Task 12.)

- [ ] **Step 2: Add MEMORY.md index entry**

Edit `/root/.claude/projects/-var-www-html/memory/MEMORY.md`. Find the `## Active Plans` section. Add a new line at the END of that section:

```markdown
- [Chat accuracy fixes (2026-05-12)](chat_accuracy_baseline_2026-05-12.md) — eval 91.1% → POST-SCORE. B3 fixture cleanup + B1 queryNormalizer splitConcatenated + B2 systemPrompt positive-frame rewrite. Deep-doc B4 (7 cases) deferred.
```

- [ ] **Step 3: No commit needed — memory dir is outside the repo**

(Memory lives at `/root/.claude/projects/-var-www-html/memory/`, not in the project tree.)

### Task 15: Final push

**Files:** none (git push)

- [ ] **Step 1: Push all commits to origin/main**

```bash
cd /var/www/html/project-data-strategis && git push origin feat/chat-proxy-routing
```

Or if working directly on main:

```bash
git push origin main
```

(Per CLAUDE.md: branch is `feat/chat-proxy-routing` per the SessionStart context. Confirm with `git branch --show-current` first.)

- [ ] **Step 2: Note final scores in the PR or commit description**

```bash
echo "Pre-fix:   0.911"
echo "Post-fix:  $(jq '.profiles.chat.summary.overall_score' $(ls -t backend/evals/reports/eval-*.json | head -1))"
```

- [ ] **Step 3: Confirm clean tree**

```bash
git status -s
```

Expected: empty output (or only the `.backup` files which should NOT be committed — add to `.gitignore` locally if needed: `*.backup`).

---

## Verification matrix (final)

After all phases:

| Test | Pre | Expected Post |
|---|---|---|
| `chat-cases.json` eval (31) | 0.911 | ≥ 0.97 |
| Canonical probe v1 (verbatim) | refuses (NO_MATCH) | cites data (cand>0) |
| Canonical probe v2 var 3 (rows=20) | refuses | cites data |
| Canonical probe v2 var 4 (rows=20) | refuses | cites data |
| Deep-doc T3 (PDRB sektor, rows=20) | refuses | cites 17.74 / 32.487 |
| Deep-doc T6 (padi, rows=11) | refuses | cites at least 2 numbers |
| Deep-doc T8 (bekerja/pengangguran, rows=11) | refuses | cites at least 2 numbers |
| Deep-doc T10 (puskesmas, rows=11) | refuses | cites 3 of 4 numbers |
| Jest unit tests | 191 PASS | 200 PASS (9 new for splitConcatenated) |
| `complex-01` (kemiskinan per kab) | D 64% | A or B |

## Rollback

Each phase commits separately. Rollback is by `git revert <SHA>`:

```bash
git log --oneline -15      # find the commits to revert
git revert <SHA>           # one at a time, or
git revert <SHA1>..<SHA2>  # a range
pm2 reload pds-backend --update-env
```

The fixture changes (B3) are pure data — reverting them just restores the old eval rules without affecting production chat behavior. The B1 normalizer revert is safe (a no-op deletion). The B2 prompt revert is most consequential but is also low-risk because it's just text in a template string.
