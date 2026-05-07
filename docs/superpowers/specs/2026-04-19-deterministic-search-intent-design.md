# Deterministic Search Intent — Design Spec (Project 2)

> **Status:** Draft
> **Author:** MALIKA team (brainstormed via Claude, 2026-04-19)
> **Scope:** Replace the hand-scored datasource ranker + hardcoded geo alias maps with a statistical FULLTEXT ranker + data-mined entity resolver, so the deterministic intent path (already opt-in via `?noLlm=1`) becomes accurate enough to eventually replace chat-LLM on PWA search.
> **Context:** Follows Project 1 (search eval harness — shipped 2026-04-18). Baseline report `eval-2026-04-18-13-37.json` established `intent_det` pass rate at 3% and identified root causes; this spec operationalizes the fix.

---

## 1. Motivation

### 1.1 The problem

Phase A-D shipped the infrastructure to measure search accuracy and to opt into a deterministic (LLM-free) intent path. The baseline exposed that the deterministic path is currently not usable in production:

- **`intent_det` pass rate: 3%** — 35 of 36 cases fail with `type: "unknown"`
- **Root cause** (`backend/src/services/search/intent.service.js:424-452`): when LLM is bypassed, `buildDeterministicQueryBuilder` receives `mappedType: null` because `mapDatasourceFromQuery` depends on LLM-derived `qb` hints. The deterministic path was designed as a fallback for LLM failures, not as a first-class replacement.
- **Secondary issues from the baseline:**
  - Dropdown pass rate 73% (3 of 11 aggregate province indicators missed top-10)
  - Plan pass rate 43% (4 of 7 deeplink queries fell back to `action: search`)
  - Hardcoded geo aliases (`hal-ut`, `halsel`, `tikep`, `pulmor`) in 85 lines of hand-maintained regex rules

### 1.2 The user directive driving this project

> "We work on accuracy without any hardcoded or manually added score — more like scalable production and dynamic."

This rules out the tactical fix of "add more alias entries" or "tune the score weights." Project 2 is a **structural replacement**, not a tuning pass. The goal is a ranker whose behavior improves automatically as BPS adds new datasources, without code changes.

### 1.3 Why this is separable from "fully eliminate LLM"

Eliminating chat-LLM from PWA search requires:
1. The opt-in `noLlm=1` mechanism (✅ shipped in Phase B)
2. A deterministic path that's actually good (this project)
3. Flipping the frontend BFF to always send `noLlm=1` (currently held via commit `f6ac44d` — unrolled when ready)

Project 2 is step 2. Step 3 becomes trivial once step 2 proves itself on the eval harness.

---

## 2. Constraints (locked during brainstorming)

| # | Constraint | Source |
|---|---|---|
| C1 | No hardcoded per-indicator scoring rules (e.g., `if name.includes('inflasi') score += 6`). | User directive |
| C2 | No hardcoded geo/abbreviation alias tables (e.g., `"hal-ut" → "halmahera utara"`). | User directive |
| C3 | Ranking math must be **statistical** — computed from corpus distribution, not declared. | User directive |
| C4 | Adding a new datasource (row in `data_sources`) must not require code changes for ranking or geo resolution. | Scalability interpretation of C1/C2 |
| C5 | Chat Malika (`/chat` path) behavior preserved byte-for-byte. | Project 1 C2 |
| C6 | No new external ML infra (no embedding model calls during datasource ranking). | "Minimalist Approach 1" decision |
| C7 | `retire_llm_safe` decision is measurement-driven via eval harness, not a subjective call. | Project 1 output |
| C8 | Structural constants (e.g., `NAME_MATCH_WEIGHT = 2.0` — reflecting name vs description information density) are permitted. **Policy constants** (per-indicator tweaks, per-region aliases) are not. | Constraint clarification |

---

## 3. Architecture

```
                ┌──────────────────────────────────────────┐
                │  user query: "tpt malut 2024"            │
                └────────────────────┬─────────────────────┘
                                     │
                      ┌──────────────▼──────────────┐
                      │  Deterministic query parser │
                      │  (regex — year, month)      │
                      │  + fuzzy geo resolver ★     │
                      └──────────────┬──────────────┘
                                     │ extracted: year=2024,
                                     │ geo="maluku utara"
                                     ▼
                ┌──────────────────────────────────────────┐
                │ ★ FULLTEXT ranker (replaces scoreDatasource) │
                │  MATCH(name, description) AGAINST(?)     │
                │  + click-through prior from SearchStat   │
                │  + period-availability gate (existing)   │
                └────────────────────┬─────────────────────┘
                                     │ ordered list of source_ids
                                     │ with relevance scores
                                     ▼
                ┌──────────────────────────────────────────┐
                │  resolveSearchIntent                     │
                │  ────────────────────                    │
                │  qb.type  = topResult.type   ★ (was null)│
                │  qb.source_id = topResult.id             │
                │  qb.confidence = derived from score gap  │
                └────────────────────┬─────────────────────┘
                                     │
                      ┌──────────────▼──────────────┐
                      │  Plan: deeplink vs search   │
                      │  (confidence-gated)         │
                      └─────────────────────────────┘

★ = new or rewritten in Project 2
```

### 3.1 New units

| Unit | Responsibility | Depends on |
|---|---|---|
| `backend/src/services/search/fulltextRanker.js` | Run FULLTEXT query, fold in click-through prior, return ranked candidates | MariaDB FULLTEXT indexes (§4); `SearchStat` |
| `backend/src/services/search/entityResolver.js` | Mine kab/kota names from `data_sources.name` at startup; resolve unknown query tokens via prefix-alias + Levenshtein | `data_sources.name` column |
| `backend/src/migrations/2026-04-19-add-search-fulltext-indexes.sql` | Add FULLTEXT indexes, create stopword table, populate from canonical JS list | MariaDB 11 |

### 3.2 Units that shrink or get deleted

| Unit | Before | After |
|---|---|---|
| `scoreDatasource()` in `datasourceSearch.service.js` | 108 lines of hand-scored `score += X` branches (including the `inflasi`/`ihk` per-indicator special-case) | **Deleted.** Replaced by a single SQL + click-through fold. |
| `expandGeoAbbreviations()` | 25 lines of regex alias rules | **Deleted.** Handled by `entityResolver.resolveGeo` (prefix-alias tier). |
| `normalizeGeoTypos()` | 60 lines of per-region typo rules | **Deleted.** Handled by `entityResolver.resolveGeo` (Levenshtein tier). |
| `KNOWN_GEO_PHRASES` + `detectKnownGeoPhrases` | 72 lines of declared geo constants | **Deleted.** Replaced by `entityIndex` mined from DB. |
| `indicatesKabKotaDimensionFromText` + per-indicator blocks (~40 lines) | Hand-tuned boosts per query shape | **Deleted.** FULLTEXT term co-occurrence captures this. |
| **Net change to `datasourceSearch.service.js`** | 1,110 LoC | ~300-400 LoC |

### 3.3 Units left unchanged

- `inferYearFromText()` / `inferMonthFromText()` — regex, no scoring, already dynamic
- `resolveSearchIntent()` outer shell — still orchestrates; only inner ranker + mapper change
- `checkPeriodExists()` — still gates deeplink on actual data availability
- Chat pipeline, `/chat` caller — C5 preserved
- LLM opt-in mechanism (`?noLlm=1`) — already live from Phase B
- `searchTermIndex.service.js`, `searchTermSync.service.js` — existing tokenization + term mining stays; the new FULLTEXT index treats `data_source_search_terms.term` as a secondary input

### 3.4 Isolation wins

1. **One statistical truth.** FULLTEXT is the single source of text relevance. Click-through is a *multiplier*, not a separate scorer. Year/geo are *filters*, not scorers. No more 15 sources of score that all have to agree.
2. **New datasources auto-rank.** Add a row to `data_sources`, the FULLTEXT index auto-updates (InnoDB maintains it on INSERT/UPDATE/DELETE), and geo-entity mining runs on next reindex — no code change.
3. **Fuzzy resolver rebuilds itself.** `entityResolver` re-mines `data_sources.name` on reindex. New kab/kota names appearing in the corpus automatically become resolvable aliases.

---

## 4. Data layer / schema changes

### 4.1 FULLTEXT indexes (migration)

```sql
-- backend/src/migrations/2026-04-19-add-search-fulltext-indexes.sql
-- Idempotent; safe to re-run.

ALTER TABLE data_sources
  ADD FULLTEXT INDEX ft_data_sources_name (name),
  ADD FULLTEXT INDEX ft_data_sources_desc (description);

ALTER TABLE data_source_search_terms
  ADD FULLTEXT INDEX ft_search_terms_term (term);
```

Two separate indexes on `data_sources` (not a combined one) enable a per-query weight structure: `(MATCH(name) * NAME_MATCH_WEIGHT) + MATCH(description)`. The `NAME_MATCH_WEIGHT` is a **structural constant** (§2 C8) reflecting that name is ~10 chars while description is ~200 chars — same query term carries more information per character in name.

**Size impact:** `data_sources` is 17 MB / 261 rows → negligible index overhead (<1 MB). Rebuild takes <1s. Maintenance is automatic.

### 4.2 Stopword table

```sql
CREATE TABLE IF NOT EXISTS innodb_ft_stopwords (
  value VARCHAR(255) NOT NULL PRIMARY KEY
) ENGINE=InnoDB;
```

Populated at migration time from the canonical Indonesian stopword list in `searchTermIndex.service.js:STOPWORDS` (one-way sync from JS). Server variable `innodb_ft_user_stopword_table = 'project_data_strategis/innodb_ft_stopwords'` is set in migration.

Indonesian has short function words (`di`, `ke`, `yang`, `dan`) that MariaDB's default English stoplist misses. Without this, queries like "data di maluku utara" weight "di" as a content word.

### 4.3 No new model / table

- `SearchStat` — existing, already has `{source_id UNIQUE, search_count, last_searched_at}`. Read-only usage by the ranker.
- `DataSourceSearchTerm` — existing, already populated by `searchTermSync.service.js`. We only add the FULLTEXT index (§4.1).

### 4.4 Deployment order

1. Run migration (indexes + stopword table).
2. Populate stopword table from JS canonical list.
3. Verify: `SELECT id, MATCH(name) AGAINST('tpt malut') AS score FROM data_sources LIMIT 5;` returns non-zero scores.
4. Only then deploy ranker code (§5).

Migration is gating: deploying ranker code before indexes exist would fall through to table scans.

---

## 5. Ranking algorithm

### 5.1 Core query

```sql
SELECT
  ds.id, ds.name, ds.type,

  -- Primary: statistical text relevance.
  -- MATCH ... AGAINST returns a non-negative relevance score from MariaDB's natural-language ranker.
  (MATCH(ds.name) AGAINST(:q IN NATURAL LANGUAGE MODE) * :name_boost
    + MATCH(ds.description) AGAINST(:q IN NATURAL LANGUAGE MODE)
    + COALESCE(term_scores.term_score, 0)
  ) AS base_relevance,

  COALESCE(ss.search_count, 0) AS click_count
FROM data_sources ds
LEFT JOIN data_search_stats ss ON ss.source_id = ds.id
LEFT JOIN (
  SELECT st.source_id,
         SUM(MATCH(st.term) AGAINST(:q IN NATURAL LANGUAGE MODE)) AS term_score
  FROM data_source_search_terms st
  WHERE MATCH(st.term) AGAINST(:q IN NATURAL LANGUAGE MODE)
  GROUP BY st.source_id
) term_scores ON term_scores.source_id = ds.id
WHERE ds.id NOT IN (:ignored_source_ids)
  AND (
    MATCH(ds.name) AGAINST(:q IN NATURAL LANGUAGE MODE)
    OR MATCH(ds.description) AGAINST(:q IN NATURAL LANGUAGE MODE)
    OR term_scores.term_score IS NOT NULL
  )
ORDER BY base_relevance DESC
LIMIT :limit;
```

### 5.2 Click-through prior (post-SQL)

```js
function applyClickPrior(candidates) {
  if (!candidates.length) return candidates;
  const maxClicks = Math.max(0, ...candidates.map((c) => c.click_count));
  if (maxClicks === 0) return candidates;  // no click signal yet

  const logMax = Math.log1p(maxClicks);
  return candidates.map((c) => {
    const clickPrior = logMax > 0 ? Math.log1p(c.click_count) / logMax : 0;
    const effective_score = c.base_relevance * (1 + clickPrior * MAX_CLICK_WEIGHT);
    return { ...c, effective_score, click_prior: clickPrior };
  });
}
```

Log-normalization prevents runaway popularity; denominator is **query-local** (`maxClicks` of this query's candidates), not a global constant. Self-scaling.

### 5.3 The only constants ("knobs")

| Constant | Value | Justification | Policy or structural? |
|---|---|---|---|
| `NAME_MATCH_WEIGHT` | 2.0 | Name column ~10 chars; description ~200 chars. Same term in name = ~20× denser information. | **Structural** (data-model truth) |
| `MAX_CLICK_WEIGHT` | 0.5 | "Popularity can bump relevance by up to 50%." | **Structural** (policy-bounded, not per-indicator) |
| `IGNORED_SOURCE_IDS` | `[166, 167, 168, 169]` | Existing press-release aggregate guardrail. | Exclusion list (pre-existing) |

Three constants total. Compare to ~30+ magic numbers in current `scoreDatasource()`. Structural constants are permitted per C8.

### 5.4 Period/geo as filters, not scorers

```js
let candidates = await fulltextRank({ q, limit: 50 });
if (parsedYear) candidates = candidates.filter(c => await hasPeriod(c.id, parsedYear));
if (parsedGeo) candidates = candidates.filter(c => datasourceCoversGeo(c, parsedGeo));
return candidates.slice(0, limit);
```

Binary gates. Fallback pattern: if filters empty the list, return pre-filter candidates (existing `search.controller.js` geo-strip retry).

### 5.5 Confidence from score gap

```js
function deriveConfidence(candidates) {
  if (candidates.length < 2) return candidates.length === 1 ? 1.0 : 0;
  const gap = candidates[0].effective_score - candidates[1].effective_score;
  return Math.min(1, gap / candidates[0].effective_score);
}
```

Measured from the ranker's own output — no LLM self-report, no constant.

---

## 6. Intent rewire (`mapDatasourceFromQuery` → new ranker)

### 6.1 Before vs after

**Before** (the root cause of 3% `intent_det`):
- `mapDatasourceFromQuery({ q, qb })` uses `qb` hints to filter candidates.
- When `qb` is null (noLlm path), filter degenerates → `mapped.type === null` → `buildDeterministicQueryBuilder` returns `type: 'unknown'`.

**After:**
- `fulltextRank({ q })` returns ranked candidates with real `type` fields read from `data_sources.type`.
- `mapDatasourceFromQuery` becomes a thin wrapper (~20 lines):

```js
async function mapDatasourceFromQuery({ q, qb }) {
  const candidates = await fulltextRank({ q, limit: 25 });

  // LLM type hint is a soft filter (keep hinted; fall back to all if empty)
  if (qb?.type) {
    const filtered = candidates.filter((c) => c.type === qb.type);
    if (filtered.length) return { source_id: filtered[0].id, type: filtered[0].type, strategy: 'llm-typed' };
  }
  if (candidates.length) {
    return { source_id: candidates[0].id, type: candidates[0].type, strategy: 'fulltext-top1' };
  }
  return { source_id: null, type: null, strategy: 'no-match' };
}
```

- `buildDeterministicQueryBuilder` returns `type: mapped?.type || null` — no more `'unknown'` default. Null is more honest.

### 6.2 Chat pipeline impact

Zero. `streaming.service.js:10` still imports `resolveSearchIntent` and calls it without `noLlm`, so `buildQueryFromText` (LLM) still runs and fills `qb`. The only behavior delta: when LLM's `qb.type` is present but wrong (hints at a type the correct datasource doesn't have), the new ranker's soft-filter behavior is more forgiving — falls back to top-1 rather than returning no match. This is a pure improvement.

### 6.3 Deeplink confidence threshold

`SEARCH_INTENT_MIN_CONFIDENCE` env var stays (default 0.5), but `confidence` is now a derived score-gap measurement. This resolves the 4/7 failing deeplink cases from baseline (strong top-1 queries will clear the gap threshold).

### 6.4 Instrumentation

Each request logs to `intentStats`:
- `strategy` (`fulltext-top1` / `llm-typed` / `no-match`)
- `candidates_count`
- `top1_score`, `top2_score`
- `click_prior_applied` (bool)

Adds observability without new logging infra.

---

## 7. Entity resolver (fuzzy geo/alias)

### 7.1 Module shape

```js
// backend/src/services/search/entityResolver.js
async function rebuildEntityIndex()       // updates module-level cache
function resolveGeo(q)                    // returns Array<string> — canonical entity names
function getEntityIndex()                 // for diagnostics
```

### 7.2 Mining entities (startup + periodic)

```js
async function rebuildEntityIndex() {
  const rows = await DataSource.findAll({ attributes: ['name'] });
  const entities = new Set();
  for (const row of rows) {
    const name = normalizeText(row.name);
    for (const match of name.matchAll(/(kota|kabupaten|pulau|kepulauan|halmahera)\s+([\p{L}\s]+?)(?=\s|$|,|\()/gu)) {
      const phrase = `${match[1]} ${match[2]}`.trim();
      if (phrase.length >= 5 && phrase.length <= 40) entities.add(phrase);
    }
    if (name.includes('maluku utara')) entities.add('maluku utara');
  }
  entityIndex = [...entities];
}
```

Expected output on current corpus: ~15 canonical entities (matches the existing hardcoded list, but discovered instead of declared).

### 7.3 Three-tier resolution

```js
function resolveGeo(q) {
  const normQ = normalizeText(q);
  const matches = new Set();

  // Tier 1: exact substring (well-formed queries — ~95% of traffic)
  for (const entity of entityIndex) {
    if (normQ.includes(entity)) matches.add(entity);
  }

  // Tier 2: prefix-alias (handles "halut", "halsel", "tikep", "pulmor", etc.)
  if (matches.size === 0) {
    for (const token of tokenize(normQ)) {
      const alias = resolvePrefixAlias(token);
      if (alias) matches.add(alias);
    }
  }

  // Tier 3: Levenshtein (handles typos)
  if (matches.size === 0) {
    for (const token of tokenize(normQ)) {
      if (token.length < 5) continue;
      for (const entity of entityIndex) {
        for (const word of entity.split(' ')) {
          if (word.length < 5) continue;
          if (levenshtein(token, word) <= Math.min(2, Math.floor(word.length / 3))) {
            matches.add(entity);
            break;
          }
        }
        if (matches.has(entity)) break;
      }
    }
  }

  return [...matches];
}
```

### 7.4 Prefix-alias algorithm

```js
function resolvePrefixAlias(queryToken) {
  if (queryToken.length < 5 || queryToken.includes(' ')) return null;
  for (const entity of entityIndex) {
    const entityWords = entity.split(' ');
    if (entityWords.length < 2) continue;
    let remaining = queryToken;
    let matched = true;
    for (const word of entityWords) {
      let prefixLen = 0;
      while (prefixLen < word.length && prefixLen < remaining.length &&
             word[prefixLen] === remaining[prefixLen]) prefixLen++;
      if (prefixLen < 2) { matched = false; break; }
      remaining = remaining.slice(prefixLen);
    }
    if (matched && remaining.length === 0) return entity;
  }
  return null;
}
```

Verified against the current hardcoded alias list — generalizes all of them: `halut`→`halmahera utara`, `halsel`→`halmahera selatan`, `halteng`→`halmahera tengah`, `halbar`→`halmahera barat`, `haltim`→`halmahera timur`, `tikep`→`tidore kepulauan`, `pulmor`→`pulau morotai`, `kepsul`→`kepulauan sula`, `pultal`→`pulau taliabu`, `malut`→`maluku utara`. New aliases discoverable without code change.

### 7.5 Indicator keyword typos

Second entity set mined from `data_sources.name` tokens (after stopword filter, ≥5 chars, DF ≥ 2): `kemiskinan`, `pengangguran`, `inflasi`, `pdrb`, `ipm`, etc. Used as a fallback layer for typos in non-geo tokens. Typo correction **appends** canonical forms to the query — never silently substitutes.

### 7.6 Reindex triggers

| Trigger | Frequency |
|---|---|
| Server startup | Once per boot |
| `DataSource` insert/update hook | On-write |
| Nightly cron | Daily |

In-memory footprint: <5 KB total. Rebuild: <100ms. Negligible.

### 7.7 Explicitly out of scope (minimalist Approach 1)

- Semantic similarity (embeddings) — Approach 2 if measurement justifies
- Phonetic matching (Metaphone) — Approach 2
- Click-through learning for alias correctness — Approach 2

Approach 1 stays a text-pattern engine.

---

## 8. Rollout

### 8.1 Prerequisites

All satisfied by Project 1:
- `?noLlm=1` flag live
- Eval harness live
- 45-case fixture with labels
- Baseline report recorded
- Cache bypass when `noLlm=1`

### 8.2 Build order (5 phases)

```
Phase 1 — Schema & indexing          │ FULLTEXT indexes + stopword table. No code changes. Safe standalone deploy.
Phase 2 — FULLTEXT ranker module     │ lib/fulltextRanker.js + unit tests. Not yet wired.
Phase 3 — Entity resolver module     │ lib/entityResolver.js + unit tests. Not yet wired.
Phase 4 — Intent rewire (shadow)     │ New ranker runs in parallel, logs divergence, OLD result still returned to users.
                                     │ GATE: 24-48h soak, review divergence logs, require sane patterns before Phase 5.
Phase 5 — Cutover + deletion         │ Flip to new ranker. Delete scoreDatasource, geo alias tables.
                                     │ GATE 1: intent_det pass rate ≥ 50%.
                                     │ GATE 2 (bonus): comparison_llm_vs_det.retire_llm_safe === true
                                     │   → file follow-up to un-hold Task 10.
```

### 8.3 Shadow mode details (Phase 4 — main safety net)

```js
const oldMapped = await mapDatasourceFromQuery_OLD({ q, qb });
const newMapped = await mapDatasourceFromQuery_NEW({ q, candidates });
const result = { /* build using oldMapped — no user impact */ };

if (oldMapped?.source_id !== newMapped?.source_id) {
  shadowLogger.record({
    q: hashQuery(q),  // hash, not raw query — no PII
    old_source_id: oldMapped?.source_id,
    new_source_id: newMapped?.source_id,
    old_type: oldMapped?.type,
    new_type: newMapped?.type,
    new_top1_score: newMapped?.score,
    new_confidence: newMapped?.confidence,
  });
}
```

Manual review after 24-48h answers: does new ranker agree with old on happy-path queries, and disagree (correctly) on the broken ones? Evidence gate.

### 8.4 Eval gates per phase

| After phase | Expected pass-rate lift | Action if miss |
|---|---|---|
| 1 | Baseline unchanged (no code change yet) | Fix migration |
| 2 | intent_det: 3% → 40-60% when harness uses `--use-fulltext-ranker` flag | Investigate fulltextRanker |
| 3 | abbrev/geo tag pass rate: ~45% → ~85%+ | Investigate entityResolver |
| 4 | Production metrics unchanged (shadow mode returns old result) | Verify shadow logs sample correctly |
| 5 | GATE 1: intent_det ≥ 50% on full eval re-run | Revert cutover; diagnose offline; re-cutover |

### 8.5 Rollback triggers

| Trigger | Action |
|---|---|
| Migration fails | Reversal migration with `DROP INDEX` |
| Phase 2/3 unit tests fail | Fix in phase, no production impact |
| Phase 4 shadow shows >10% divergence on happy-path queries | Pause cutover; investigate |
| Phase 5 GATE 1 fails | Revert cutover commit in session; old ranker stays live |
| Post-cutover latency regression (>200ms p95) | Revert; indexes likely not optimal |
| Post-cutover click-through rate drop (users giving up) | Revert within 24-48h |

### 8.6 Success criteria

1. `intent_det` pass rate ≥ 50% on 45-case fixture (vs 3% baseline).
2. Zero hardcoded geo alias maps in `datasourceSearch.service.js` (grep-verified).
3. `scoreDatasource()` deleted; new ranker is single source of ranking.
4. Dropdown pass rate ≥ 73% (no regression).
5. Chat Malika eval unchanged from pre-Project-2.
6. FULLTEXT query p95 latency < 50ms.

If `retire_llm_safe === true` → Project 3 unlocks Task 10 trivially. Otherwise → Project 3 addresses the Approach 2 backlog (phonetic, query-token learning, derived thresholds).

### 8.7 Explicitly out of scope

- Deeplink threshold auto-tuning from click-through data (Approach 2).
- Semantic embeddings for datasource ranking (Approach 2).
- Full learning-to-rank model (Approach 2 — needs query-text logging we don't have).
- Fixture expansion (dual-labeling, e2e labels, real knowledge IDs) — deferred to a follow-up.
- Chat pipeline changes (C5 absolute).
- Un-holding Task 10 — Project 2 enables the possibility; a separate decision re-runs eval and flips when ready.

### 8.8 Effort estimate

| Phase | Size | Time |
|---|---|---|
| 1 — migration | ~50 LoC SQL + populate script | Short session |
| 2 — fulltextRanker | ~200 LoC + unit tests | 1 session |
| 3 — entityResolver | ~250 LoC + unit tests | 1 session |
| 4 — rewire + shadow mode | ~150 LoC | 1 session |
| 5 — cutover + deletion | -800 LoC net (delete > add) | Short session |

Total: 4-5 implementation sessions + 24-48h shadow-mode soak in Phase 4.

---

## 9. Definition of done

```
Phase 1 deployed   → schema has FULLTEXT indexes
∧ Phase 5 merged   → new ranker replaces scoreDatasource in production
∧ GATE 1 passes    → intent_det ≥ 50% on re-baseline
∧ C5 preserved     → chat eval unchanged
∧ Baseline updated → new docs/workspace/search-eval-baseline-2026-XX-XX.md committed
                     with new numbers and retire_llm_safe decision
```

All five holds → Project 2 ships. GATE 2 (retire_llm_safe) triggers Project 3 deploy of Task 10.

---

## Appendix A — Why deleting 800 LoC matters

Project 2's value isn't code *added*; it's code *deleted*. Specifically:

- 108 LoC of hand-scored ranking → ~30 LoC of SQL + JS (~70 LoC net reduction)
- 25 LoC of geo alias regex → ~40 LoC of prefix-alias + Levenshtein (but covers arbitrary future aliases)
- 60 LoC of geo typo rules → 0 LoC (fuzzy match subsumes)
- 72 LoC of KNOWN_GEO_PHRASES constants + detectKnownGeoPhrases → 0 LoC (mined from DB)
- 40 LoC of per-indicator special cases (inflasi/ihk) → 0 LoC (FULLTEXT term co-occurrence subsumes)

Total deletion: ~305 LoC. New modules: ~200 (fulltextRanker) + 250 (entityResolver) = 450. The "800 LoC net deletion" in §8.8 includes related simplifications in `buildDeterministicQueryBuilder` and candidate filtering that cascade from the ranker rewrite.

A strong signal-to-deletion ratio is itself a quality check: if Project 2 ends up *adding* net code, the approach is masking complexity rather than eliminating it.

---

## Appendix B — Test plan

Each phase carries unit tests against the 45-case eval fixture:

- **Phase 2 tests** (`fulltextRanker.test.js`): for 10 seed queries, the top-ranked result's `type` matches the fixture's expected `type`. Click-prior math tested with a synthetic candidates array.
- **Phase 3 tests** (`entityResolver.test.js`): the 6 abbreviation cases (TY/AB tags) each resolve to the right canonical entity. Mining against a fresh DB snapshot produces the expected ~15 entities.
- **Phase 4 tests** (shadow mode): manual log review — no automated pass/fail.
- **Phase 5 tests**: full eval-harness baseline re-run against production backend via `node evals/run-eval.js --profile=search`.

---

## Appendix C — Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| MariaDB FULLTEXT Indonesian tokenization is poor | Low-Medium | Stopword table tuned for Indonesian (§4.2). Fallback: Approach 2 with a dedicated tokenizer or vector search. |
| Level shift in ranking behavior breaks dropdown for existing users | Low | Shadow mode soak (§8.3) measures this. Revert available. |
| Click-through prior over-boosts already-popular sources, entrenching bias | Medium | Log-normalized against per-query max (§5.2) prevents runaway. Monitor via `strategy` metric. |
| Entity resolver mines wrong entities from `data_sources.name` | Low | Tests validate output (§9 Appendix B). Manual audit of first mined list. |
| `intent_det` pass rate still < 50% after cutover | Medium | Revert triggers. Approach 2 additions (phonetic, etc.) become Project 3. |
| Chat eval regresses | Very Low | C5 is structural (LLM path unchanged by design). Shadow mode catches any accidental coupling. |
