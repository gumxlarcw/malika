# Search Eval Harness — Design Spec

> **Status:** Draft
> **Author:** MALIKA team (brainstormed via Claude, 2026-04-18)
> **Project scope:** Build an evaluation harness for the PWA `/search` pipeline (Project 1 of 2). Targeted accuracy fixes (Project 2) will be designed separately, driven by findings from this harness.

---

## 1. Motivation

The PWA search (`malika.bpsmalut.com/search`) has accuracy and logic issues whose exact shape is unknown. Before we fix anything, we need a **data-driven defect map**: which stage fails on which queries, with what latency, and by how much.

Secondary goal: the user has mandated **no chat-LLM in the PWA `/search` path** (chat Malika keeps LLM). The harness must measure whether the existing deterministic fallback can safely replace the LLM — quantitatively, per-case.

---

## 2. Constraints (locked during brainstorming)

| # | Constraint | Source |
|---|---|---|
| C1 | PWA `/search` path must use **zero chat-LLM calls**. | User directive |
| C2 | Chat Malika (`/chat` path) keeps LLM — no behavior change. | User directive |
| C3 | Embedding model calls (knowledge search) are NOT "LLM" for this project's purposes — they stay. | Scope clarification |
| C4 | `InterpretationPanel` (LLM-generated paragraph on results page) goes behind a feature flag, default off on `/search`. Full removal is a later project. | Scope decision |
| C5 | Existing chat eval (`run-eval.js` + 31 cases in `eval-set.json`) must not regress — all cases produce byte-identical output post-refactor. | Safety gate |
| C6 | No CI gating in v1. Report-only. | Rollout discipline |
| C7 | No production log mining — raw queries are not stored in prod (by design). | Privacy preservation |

---

## 3. Architecture

```
backend/evals/
├── run-eval.js                    (profile dispatcher — renamed from today's runner)
├── lib/
│   ├── httpClient.js              (fetch wrapper + timing, shared by profiles)
│   ├── reportWriter.js            (JSON + .md writer, shared)
│   ├── scoring.js                 (regex scorer + structural scorer)
│   └── profiles/
│       ├── chat.js                (existing 75-case logic, unchanged behavior)
│       └── search.js              (new — 7 stages)
├── fixtures/
│   ├── chat-cases.json            (= today's eval-set.json, renamed)
│   └── search-cases.json          (new, 40-50 cases)
└── reports/
    └── eval-YYYY-MM-DD-HHmm.{json,md}
```

### 3.1 Profile contract

Every profile is a module exporting:

```js
module.exports = {
  name: 'search' | 'chat',
  loadFixture(): Case[],
  async runCase(case, ctx): Result,
  summarize(results): Summary,
};
```

### 3.2 Runner flow

```
parse CLI flags
  → resolve profiles to run ('search', 'chat', or both)
  → for each profile: loadFixture → runCase (sequential, honoring --concurrency)
  → aggregate results
  → reportWriter.write({ profiles: { search: {...}, chat: {...} } })
```

### 3.3 Isolation wins

- **Scoring is per-profile.** Regex (chat) vs structural (search) never share code paths.
- **Endpoints are per-profile.** `httpClient` is generic; profiles know their own URLs.
- **Fixture files are separate.** No migration needed for the 75 existing chat cases.

---

## 4. Stage coverage (search profile)

| # | Stage | Endpoint | Label | Metric |
|---|---|---|---|---|
| 1 | Dropdown typeahead | `GET /search/datasource?q=` | `expect_dropdown.top_source_ids` | precision@1, recall@5, MRR |
| 2 | Intent (LLM path) | `GET /search/intent?q=` | `expect_intent_llm` | per-field exact-match rate |
| 3 | Intent (deterministic) | `GET /search/intent?q=&noLlm=1` | `expect_intent_det` | per-field exact-match rate |
| 4 | Knowledge retrieval | `GET /search/knowledge?q=` | `expect_knowledge` | precision@5, recall@5 |
| 5 | Deeplink plan | reuses response from stages 2/3 | `expect_plan` | action match + source_id match when `action=deeplink` |
| 6 | End-to-end | `GET /api/search?q=` (port 6060 BFF) | `expect_e2e` | top-1 accuracy in `exact.datasources` |
| 7 | Latency | all stages | n/a | p50, p95 per stage |

Chat profile has one stage: end-to-end chat response, scored by regex (existing behavior).

Note: the chat profile preserves today's weighted scoring with letter grades (A/B/C/D/F), driven by the existing `heuristicScore` function. "Passed" in summary counts = grades A or B (composite ≥ 0.8).

### 4.1 Explicitly out of scope for v1
- Chart config correctness (rendered in frontend, not an API)
- Interpretation panel quality (LLM-generated, out of "no LLM on search" constraint)
- Click-through accuracy (no click logs exist)

---

## 5. Fixture shape

### 5.1 `fixtures/chat-cases.json` (unchanged, just renamed)

Existing `eval-set.json` format, zero edits. Schema: `{id, category, query, expect: { shouldContain, shouldNotContain, mustCiteNumber, minLength, maxLatencyMs, tier }}` — structured criteria, not regex. The runner's `heuristicScore` function is preserved as-is.

### 5.2 `fixtures/search-cases.json` (new)

**Sparse labeling:** each case labels only the stages it's testing. Unlabeled stages are skipped for that case.

```json
{
  "version": "1.0.0",
  "created": "2026-04-18",
  "description": "Search eval corpus — PWA /search path (deterministic, no chat-LLM).",
  "cases": [
    {
      "id": "DS01",
      "query": "TPT Malut 2024",
      "tags": ["core", "abbrev", "deeplink"],
      "expect_dropdown": {
        "top_source_ids": [42],
        "must_appear_in_top_k": { "k": 5, "ids": [42] }
      },
      "expect_intent_llm": { "type": "dynamic", "year": 2024, "geo": "maluku utara", "source_id": 42, "min_confidence": 0.6 },
      "expect_intent_det": { "type": "dynamic", "year": 2024, "geo": "maluku utara", "source_id": 42 },
      "expect_plan":       { "action": "deeplink", "source_id": 42 },
      "expect_e2e":        { "top_datasource_id": 42, "bucket": "exact" }
    },
    {
      "id": "KB01",
      "query": "apa itu gini ratio",
      "tags": ["knowledge"],
      "expect_knowledge": {
        "must_contain_ids": [117, 203],
        "min_precision_at_5": 0.4
      }
    },
    {
      "id": "GE03",
      "query": "kemiskinan di Hal-Ut",
      "tags": ["geo", "abbrev"],
      "expect_intent_det": { "type": "dynamic", "geo": "halmahera utara" }
    }
  ]
}
```

### 5.3 Scoring rules

| Field | Stage | Pass criterion |
|---|---|---|
| `expect_dropdown.top_source_ids[0]` | 1 | `result.items[0].id === expected[0]` |
| `expect_dropdown.must_appear_in_top_k` | 1 | all `ids` appear in `result.items.slice(0, k)` |
| `expect_intent_llm` | 2 | every labeled field equals result field; `min_confidence` is soft-check |
| `expect_intent_det` | 3 | every labeled field equals result field (strict) |
| `expect_knowledge.must_contain_ids` | 4 | `\|labeled ∩ result_ids\| ≥ N` (default N=1) |
| `expect_knowledge.min_precision_at_5` | 4 | `\|labeled ∩ top5\| / 5 ≥ threshold` |
| `expect_plan` | 5 | `result.action === expected.action`; if `deeplink`, also source_id matches |
| `expect_e2e` | 6 | `response.exact.datasources[0].id === expected.top_datasource_id` |
| (no field) | that stage | skipped — not scored either way |

### 5.4 Initial coverage target (~45 cases)

| Tag | Count | Examples |
|---|---|---|
| `core` (indicator + year) | 10 | TPT 2024, IPM Malut, inflasi bulan ini |
| `geo` | 8 | each kab/kota × 1 indicator |
| `abbrev` | 6 | Hal-Ut, halsel, tikep, pulmor, TPT, IPM |
| `period` | 6 | triwulan, semester, bulanan, range years |
| `knowledge` | 6 | definisi, cara hitung, metode, konsep |
| `deeplink` | 4 | high-confidence single-answer queries |
| `nomatch` | 3 | off-topic — should NOT deeplink |
| `typo` | 2 | `kemikisnan`, `pengngguran` |

---

## 6. Runner CLI

```bash
# default — run everything against localhost
node evals/run-eval.js

# profile + stage selection
node evals/run-eval.js --profile=search
node evals/run-eval.js --profile=search --stage=intent_det
node evals/run-eval.js --profile=search --stage=dropdown,e2e
node evals/run-eval.js --profile=chat
node evals/run-eval.js --profile=all                      # default

# case selection
node evals/run-eval.js --id=DS01
node evals/run-eval.js --tag=geo
node evals/run-eval.js --category=period                  # chat only

# environment targeting
node evals/run-eval.js --base=http://127.0.0.1:5000
node evals/run-eval.js --bff=http://127.0.0.1:6060
node evals/run-eval.js --staging                          # reads .env.eval.staging

# offline / CI mode
node evals/run-eval.js --stub-llm                         # substitute LLM response with deterministic (search only)

# performance & output
node evals/run-eval.js --concurrency=4                    # default 1
node evals/run-eval.js --delay=100                        # ms between cases
node evals/run-eval.js --verbose
node evals/run-eval.js --no-report
node evals/run-eval.js --fail-on=0.9                      # exit 1 if overall < threshold (opt-in)
```

### 6.1 Exit codes

| Code | Meaning |
|---|---|
| 0 | All cases completed. `--fail-on` not specified OR threshold met |
| 1 | `--fail-on` threshold breached |
| 2 | Fatal (backend unreachable, fixture malformed) |

### 6.2 Env vars (CLI always wins)

| Var | Default | Purpose |
|---|---|---|
| `EVAL_API_BASE` | `http://localhost:5000` | Backend URL |
| `EVAL_BFF_BASE` | `http://localhost:6060` | Frontend BFF URL |
| `EVAL_DELAY_MS` | profile-default | Per-case delay |
| `EVAL_PROFILE` | `all` | Which profile(s) |

### 6.3 Per-profile delay defaults
- **chat**: 5000ms (LLM TPM limits)
- **search**: 100ms (no chat-LLM on hot path)

### 6.4 Flag rules
- `--stage` is search-only; invoking with `--profile=chat` returns an error.
- `--stub-llm` only affects search stage 2 (`intent_llm`).
- `--concurrency=1` is the safe default; chat profile cannot parallelize.

---

## 7. Report format

Two artifacts per run, same timestamp: `reports/eval-YYYY-MM-DD-HHmm.json` and `.md`.

### 7.1 JSON report (shape summary)

```json
{
  "meta": {
    "started_at": "...", "finished_at": "...", "duration_ms": 0,
    "runner_version": "1.0.0",
    "git_sha": "...", "git_branch": "main",
    "host": { "base": "...", "bff": "..." },
    "flags": { "profile": "all", "stub_llm": false, "concurrency": 1 }
  },
  "profiles": {
    "search": {
      "summary": {
        "cases_total": 45,
        "cases_passed_all_stages": 32,
        "cases_partial": 11,
        "cases_failed_all": 2,
        "overall_score": 0.71,
        "stages": {
          "dropdown":   { "cases": 40, "precision_at_1": 0.88, "recall_at_5": 0.95, "mean_latency_ms": 42,   "p95_latency_ms": 86 },
          "intent_llm": { "cases": 38, "field_accuracy": { "type": 0.92, "year": 0.85, "geo": 0.90, "source_id": 0.76 }, "mean_latency_ms": 1240, "p95_latency_ms": 2980 },
          "intent_det": { "cases": 38, "field_accuracy": { "type": 0.78, "year": 0.95, "geo": 0.94, "source_id": 0.61 }, "mean_latency_ms": 48,   "p95_latency_ms": 95 },
          "knowledge":  { "cases": 8,  "precision_at_5": 0.55, "recall_at_5": 0.67, "mean_latency_ms": 180,  "p95_latency_ms": 320 },
          "plan":       { "cases": 20, "action_accuracy": 0.90, "deeplink_source_id_accuracy": 0.80 },
          "e2e":        { "cases": 30, "top_1_accuracy": 0.73, "mean_latency_ms": 520, "p95_latency_ms": 1100 }
        },
        "comparison_llm_vs_det": {
          "llm_wins": 6, "det_wins": 3, "both_pass": 29, "both_fail": 0,
          "retire_llm_safe": false,
          "retire_llm_reason": "3 cases where det fails but llm succeeds — widen abbrev map first"
        }
      },
      "cases": [ /* per-case stage-level results with `diffs: []` arrays */ ]
    },
    "chat": {
      "summary": {
        "cases_total": 75, "cases_passed": 68, "overall_score": 0.906,
        "by_category": { /* counts per cat */ },
        "mean_latency_ms": 18400, "p95_latency_ms": 31200
      },
      "cases": [ /* per-case result with match string or failure reason */ ]
    }
  }
}
```

### 7.2 Markdown summary

Human-readable table of per-stage metrics, per-category chat scores, top failing cases list, and regression diff vs previous run.

### 7.3 Regression diff

Runner auto-reads the most recent prior report (by filename timestamp) and computes a `Δ` column. Omitted if no prior report exists.

### 7.4 Key first-class fields

- **`comparison_llm_vs_det`** — drives the "can we retire LLM?" decision quantitatively.
- **`retire_llm_safe: boolean`** — conservative rule: `det wins or ties on every case where LLM passes`.
- **Case-level `diffs: []`** — explicit diff per failing stage; no log grepping needed.

### 7.5 `reports/` is committed to git
Small JSON + markdown, high historical value. Enables `git log reports/` time-travel.

---

## 8. Rollout

### 8.1 Prerequisite code changes (PR-0 — must land before stage 3 works)

| # | File | Change | Why |
|---|---|---|---|
| 1 | `backend/src/services/search/intent.service.js` | `resolveSearchIntent({ q, noLlm })` — when true, skip `buildQueryFromText` and use `buildDeterministicQueryBuilder` directly | Enables stage 3 in harness + enforces C1 |
| 2 | `backend/src/controllers/searchIntent.controller.js` | Forward `req.query.noLlm === '1'` to service | Expose flag over HTTP |
| 3 | `frontend/src/app/api/search/route.ts:1197` | Always append `&noLlm=1` to `/search/intent` call | Enforce C1 in production |
| 4 | PWA callers of `InterpretationPanel` (`SearchPageClient.tsx`, `QuickDataPreviewCard.tsx`, `DataPageClient.tsx`) | Gate render behind `NEXT_PUBLIC_ENABLE_INSIGHT_PANEL` env var; default off on `/search`, can stay on for `/data` | Enforce C4; non-destructive |

### 8.2 Build order (one commit per step)

1. Rename `eval-set.json` → `fixtures/chat-cases.json`; update `run-eval.js` path reference at line 29.
2. Extract `httpClient.js`, `reportWriter.js`, `scoring.js` into `lib/` (behavior identical).
3. Introduce profile abstraction; create `lib/profiles/chat.js`; `run-eval.js` becomes dispatcher. **Safety gate: `--profile=chat` output matches pre-refactor byte-for-byte.**
4. Land PR-0 prerequisites.
5. Add `lib/profiles/search.js` + seed `fixtures/search-cases.json` (10 canary cases: IPM, TPT, kemiskinan × 3 geos).
6. Expand fixture to 40-50 cases (~2h labeling session).
7. First full baseline run; commit report; write one-pager on findings.

### 8.3 Verification plan

| After step | Verification |
|---|---|
| 3 | `node evals/run-eval.js --profile=chat` output matches pre-refactor. Safety gate for the whole refactor. |
| 5 | `node evals/run-eval.js --profile=search --verbose` — all 7 stages return data, latencies are plausible, field names match spec. |
| 7 | Baseline report committed; `comparison_llm_vs_det.retire_llm_safe` read and documented. |

### 8.4 Rollback triggers

| Trigger | Action |
|---|---|
| After step 3, chat numbers differ from pre-refactor by >2% on any category | Revert step 3; investigate; reland. |
| After step 4 (PR-0), PWA `/search` returns 500s or empty results | Revert; fix; reland. |
| After step 4, chat quality drops on next eval run | We wired the flag wrong — chat accidentally flipped to deterministic. Revert. |
| At any step, runner produces non-deterministic results on repeat runs against same commit | Pause; fix (caches, concurrency, embedding variance) before continuing. |

### 8.5 Explicitly out of v1

- No CI integration (add `--fail-on` gate later, once baseline is stable for a week).
- No production eval runs (harness targets local/staging only).
- No LLM-as-judge scoring (regex + structural only).
- No dashboard UI (markdown + JSON is the UI).
- No alerting (report is the signal).

### 8.6 Estimated effort

| Phase | Size | Time |
|---|---|---|
| Steps 1–3 (rename + refactor + profile shell) | ~500 LoC, mostly moves | 1 session |
| Step 4 (PR-0 prerequisites) | ~80 LoC across 4 files | short session |
| Step 5 (search profile + 7 stages + 10 seed cases) | ~600 LoC new | 1 session |
| Step 6 (expand to 45 cases) | labeling work, near-zero code | 2h |
| Step 7 (baseline + one-pager) | near-zero code | 1h |

---

## 9. Success criteria

This project (Project 1) is complete when:

1. `node evals/run-eval.js --profile=all` produces a signed-off baseline report.
2. `--profile=chat` output matches pre-refactor byte-for-byte.
3. PWA `/search` makes zero chat-LLM calls in production (verified via malika-llm-proxy access log spot-check).
4. `comparison_llm_vs_det.retire_llm_safe` is a documented decision (true → Project 2 retires LLM; false → Project 2 strengthens deterministic layer first).
5. Spec doc and one-pager findings committed.

---

## 10. Open questions deferred to later projects

1. Should `InterpretationPanel` be deleted entirely, or stay on non-search surfaces (`/data`)?
2. Should the ranking formula in `datasourceSearch.service.js` be tuned? — answer depends on stage 1 + stage 6 baseline numbers.
3. Should we port LLM-as-judge to the search profile? — revisit once we see how far deterministic scoring goes.
4. Should the abbreviation/synonym map be data-driven (DB table) rather than hardcoded? — revisit once we know which abbreviations are most-missed.
5. Should we split the 4,094-line `SearchPageClient.tsx`? — separate refactor project.

---

## Appendix A — Why no chat-LLM on PWA `/search`

The user directive (C1) isn't arbitrary. The current `/search/intent` LLM call introduces:

- **~1-3s latency** per search submission (observed in pipeline metrics)
- **Proxy dependency** — if `malika-llm-proxy` is down, search degrades to deterministic fallback anyway (via the existing `try/catch` at `intent.service.js:498-504`)
- **Non-determinism** — same query can produce different `source_id` candidates across runs, making caching and tests harder
- **Cost** — every search query = ~500 tokens of context to Claude Sonnet 4.6

Chat Malika needs LLM for conversational synthesis; search does not — search needs **ranking + parsing**, both of which are fundamentally deterministic problems. This spec operationalizes that distinction.

---

## Appendix B — Why the hybrid (HTTP + in-process BFF) approach

- Stages 1-5 hit backend via HTTP (`:5000`) — catches middleware/validation/rate-limit regressions.
- Stage 6 hits BFF via HTTP (`:6060/api/search`) — exercises the 1,600+ line BFF that does `exact`/`suggestions` splitting and BPS keyword expansion. In-process calls would skip this layer.
- `--stub-llm` is a narrow escape hatch for offline dev (search stage 2 only).
- Matches the existing chat eval's HTTP-only pattern — zero new ops mental model.
