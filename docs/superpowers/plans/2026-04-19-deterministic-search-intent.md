# Deterministic Search Intent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 1,100-line hand-scored datasource ranker + 157 lines of hardcoded geo/alias regex maps with (a) MariaDB FULLTEXT + click-through prior statistical ranking and (b) a data-mined entity resolver. Lift `intent_det` eval pass rate from 3% to ≥50%.

**Architecture:** New modules `fulltextRanker.js` + `entityResolver.js` replace `scoreDatasource()` and `expandGeoAbbreviations()`. Schema gets two FULLTEXT indexes on `data_sources` + one on `data_source_search_terms`, plus an Indonesian stopword table. Rollout uses shadow mode (Phase 4) to validate the new ranker against the old before cutover (Phase 5).

**Tech Stack:** Node.js v25, MariaDB 11.8 InnoDB FULLTEXT, Sequelize 6, Jest 29.

**Spec:** `docs/superpowers/specs/2026-04-19-deterministic-search-intent-design.md`

---

## Pre-flight

This plan executes on a dedicated worktree. The `<WORKTREE>` placeholder below refers to the worktree root — the `using-git-worktrees` skill (via `subagent-driven-development`) sets this up.

Expected worktree path pattern: `/var/www/html/.worktrees/<branch-name>/`
Relevant subpaths:
- Project dir: `<WORKTREE>/project-data-strategis/`
- Backend dir: `<WORKTREE>/project-data-strategis/backend/`
- Eval harness: `<WORKTREE>/project-data-strategis/backend/evals/` (from Project 1)

Before every `git add`/`commit`, every subagent must verify branch:
```bash
git -C <WORKTREE> branch --show-current
```
Must print the feature branch (e.g., `project-2-deterministic-intent`). If it prints `main`, STOP — the subagent is in the wrong checkout.

All shell commands in this plan use **absolute paths** to prevent the "work ended up on main" failure mode from Project 1 Task 10.

---

## Phase 1 — Schema & indexing

### Task 1: Add `ensureSearchFullTextIndexes` migration function

**Files:**
- Create: `<WORKTREE>/project-data-strategis/backend/src/migrations/search-fulltext-indexes.js` — new idempotent migration module
- Modify: `<WORKTREE>/project-data-strategis/backend/server.js` — call the migration at startup alongside existing `ensure*` functions
- Test: `<WORKTREE>/project-data-strategis/backend/src/__tests__/migrations.searchFulltext.test.js`

**Why:** Spec §4 requires FULLTEXT indexes on `data_sources(name, description)` and `data_source_search_terms(term)`, plus an Indonesian stopword table. The existing project pattern is idempotent JS functions called on startup, not SQL files. We follow the pattern.

- [ ] **Step 1.1: Read the existing migration pattern for reference**

```bash
cat <WORKTREE>/project-data-strategis/backend/server.js | head -75
```

Expected: see `ensureDataSourceTypeEnumSupportsAllKnownTypes`, `ensureDataSourceHasAliasesColumn`, `ensureAppSettingsTableExists`. The new function follows this shape.

- [ ] **Step 1.2: Write the failing test**

Create `<WORKTREE>/project-data-strategis/backend/src/__tests__/migrations.searchFulltext.test.js`:

```js
'use strict';

const sequelize = require('../config/db');
const { ensureSearchFullTextIndexes } = require('../migrations/search-fulltext-indexes');

// This test is an integration test — it hits the real DB.
// Skip when env SKIP_DB_TESTS=1 (e.g., CI without DB).
const runDb = process.env.SKIP_DB_TESTS !== '1';

(runDb ? describe : describe.skip)('ensureSearchFullTextIndexes', () => {
  afterAll(async () => {
    await sequelize.close();
  });

  test('creates FULLTEXT index on data_sources(name)', async () => {
    await ensureSearchFullTextIndexes();
    const [rows] = await sequelize.query(`
      SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'data_sources'
        AND INDEX_NAME = 'ft_data_sources_name'
      LIMIT 1
    `);
    expect(rows.length).toBe(1);
  });

  test('creates FULLTEXT index on data_sources(description)', async () => {
    await ensureSearchFullTextIndexes();
    const [rows] = await sequelize.query(`
      SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'data_sources'
        AND INDEX_NAME = 'ft_data_sources_desc'
      LIMIT 1
    `);
    expect(rows.length).toBe(1);
  });

  test('creates FULLTEXT index on data_source_search_terms(term)', async () => {
    await ensureSearchFullTextIndexes();
    const [rows] = await sequelize.query(`
      SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'data_source_search_terms'
        AND INDEX_NAME = 'ft_search_terms_term'
      LIMIT 1
    `);
    expect(rows.length).toBe(1);
  });

  test('creates innodb_ft_stopwords table and populates with Indonesian stopwords', async () => {
    await ensureSearchFullTextIndexes();
    const [rows] = await sequelize.query(
      `SELECT COUNT(*) AS n FROM innodb_ft_stopwords WHERE value IN ('di', 'dan', 'yang')`
    );
    expect(Number(rows[0].n)).toBeGreaterThanOrEqual(3);
  });

  test('is idempotent — running twice does not error', async () => {
    await expect(ensureSearchFullTextIndexes()).resolves.not.toThrow();
    await expect(ensureSearchFullTextIndexes()).resolves.not.toThrow();
  });
});
```

- [ ] **Step 1.3: Run to verify failure**

```bash
cd <WORKTREE>/project-data-strategis/backend && npx jest src/__tests__/migrations.searchFulltext.test.js 2>&1 | tail -10
```

Expected: FAIL — "Cannot find module '../migrations/search-fulltext-indexes'".

- [ ] **Step 1.4: Create the migration module**

Create `<WORKTREE>/project-data-strategis/backend/src/migrations/search-fulltext-indexes.js`:

```js
'use strict';

const sequelize = require('../config/db');

// Canonical Indonesian stopword list — mirrors searchTermIndex.service.js STOPWORDS.
// Kept here as a module-local constant to avoid circular imports during migration phase.
// If searchTermIndex's STOPWORDS diverges, run ensureSearchFullTextIndexes to resync.
const INDONESIAN_STOPWORDS = [
  'dan', 'atau', 'yang', 'dengan', 'untuk', 'pada', 'di', 'ke', 'dari',
  'menurut', 'berdasarkan', 'per', 'tahun', 'bulan', 'seperti', 'juga',
  'ini', 'itu', 'adalah', 'akan', 'sudah', 'belum', 'oleh', 'bagi',
  'telah', 'ada', 'tidak', 'bukan', 'atas', 'bawah', 'dalam', 'luar',
];

async function indexExists(tableName, indexName) {
  const [rows] = await sequelize.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND INDEX_NAME = :i LIMIT 1`,
    { replacements: { t: tableName, i: indexName } }
  );
  return rows.length > 0;
}

async function tableExists(tableName) {
  const [rows] = await sequelize.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t LIMIT 1`,
    { replacements: { t: tableName } }
  );
  return rows.length > 0;
}

async function ensureStopwordsTable() {
  if (!(await tableExists('innodb_ft_stopwords'))) {
    await sequelize.query(`
      CREATE TABLE innodb_ft_stopwords (
        value VARCHAR(255) NOT NULL PRIMARY KEY
      ) ENGINE=InnoDB
    `);
  }
  // Upsert stopwords — safe to re-run.
  for (const w of INDONESIAN_STOPWORDS) {
    await sequelize.query(
      `INSERT INTO innodb_ft_stopwords (value) VALUES (:v) ON DUPLICATE KEY UPDATE value = value`,
      { replacements: { v: w } }
    );
  }
  // Direct the InnoDB FT engine at our table. Set server variable for the session;
  // persistent config must be done in my.cnf by an operator (one-time manual step documented in the runbook).
  try {
    await sequelize.query(
      `SET GLOBAL innodb_ft_user_stopword_table = 'project_data_strategis/innodb_ft_stopwords'`
    );
  } catch (e) {
    // Some environments won't allow SET GLOBAL; log and continue — default stoplist still works,
    // stopwords table just isn't active. Operator must persist in my.cnf.
    console.warn('[migrations] Could not SET GLOBAL innodb_ft_user_stopword_table:', e?.message || String(e));
  }
}

async function ensureSearchFullTextIndexes() {
  if (!(await indexExists('data_sources', 'ft_data_sources_name'))) {
    await sequelize.query(`ALTER TABLE data_sources ADD FULLTEXT INDEX ft_data_sources_name (name)`);
  }
  if (!(await indexExists('data_sources', 'ft_data_sources_desc'))) {
    await sequelize.query(`ALTER TABLE data_sources ADD FULLTEXT INDEX ft_data_sources_desc (description)`);
  }
  if (!(await indexExists('data_source_search_terms', 'ft_search_terms_term'))) {
    await sequelize.query(`ALTER TABLE data_source_search_terms ADD FULLTEXT INDEX ft_search_terms_term (term)`);
  }
  await ensureStopwordsTable();
}

module.exports = { ensureSearchFullTextIndexes, INDONESIAN_STOPWORDS };
```

- [ ] **Step 1.5: Run tests to verify pass**

```bash
cd <WORKTREE>/project-data-strategis/backend && npx jest src/__tests__/migrations.searchFulltext.test.js 2>&1 | tail -10
```

Expected: `Tests: 5 passed, 5 total`.

If DB is unavailable (connection refused, missing creds): the test auto-skips due to `SKIP_DB_TESTS=1`. Set that env var manually and rerun to confirm skip behavior:
```bash
cd <WORKTREE>/project-data-strategis/backend && SKIP_DB_TESTS=1 npx jest src/__tests__/migrations.searchFulltext.test.js 2>&1 | tail -5
```
Expected: 5 tests skipped.

- [ ] **Step 1.6: Wire the migration into `server.js`**

Back up first (per CLAUDE.md):
```bash
cp <WORKTREE>/project-data-strategis/backend/server.js <WORKTREE>/project-data-strategis/backend/server.js.backup
```

Open `<WORKTREE>/project-data-strategis/backend/server.js`. Near the top (after existing `ensure*` function imports or definitions, before `startup()`), add:

```js
const { ensureSearchFullTextIndexes } = require('./src/migrations/search-fulltext-indexes');
```

Inside the startup function (around line 113-115 where the existing ensures are called), add a new call:

```js
        await ensureDataSourceTypeEnumSupportsAllKnownTypes();
        await ensureDataSourceHasAliasesColumn();
        await ensureAppSettingsTableExists();
        await ensureSearchFullTextIndexes();  // ← add this line
```

Do NOT reorder the existing calls — just insert after them.

- [ ] **Step 1.7: Smoke test — syntax check server.js**

```bash
cd <WORKTREE>/project-data-strategis/backend && node -c server.js && echo "syntax OK"
```

Expected: `syntax OK`.

- [ ] **Step 1.8: Commit**

Verify branch:
```bash
git -C <WORKTREE> branch --show-current
```

Then:
```bash
git -C <WORKTREE> add \
  project-data-strategis/backend/src/migrations/search-fulltext-indexes.js \
  project-data-strategis/backend/src/__tests__/migrations.searchFulltext.test.js \
  project-data-strategis/backend/server.js

git -C <WORKTREE> commit -m "feat(search): add FULLTEXT index migration with Indonesian stopwords"
```

---

## Phase 2 — FULLTEXT ranker module

### Task 2: `lib/fulltextRanker.js` — core SQL ranking + unit tests

**Files:**
- Create: `<WORKTREE>/project-data-strategis/backend/src/services/search/fulltextRanker.js`
- Test: `<WORKTREE>/project-data-strategis/backend/src/__tests__/fulltextRanker.test.js`

**Why:** Spec §5 — new module performs the single SQL query (FULLTEXT MATCH...AGAINST + click-through JOIN) and returns ranked candidates with `base_relevance` + `click_count`.

- [ ] **Step 2.1: Write the failing test**

Create `<WORKTREE>/project-data-strategis/backend/src/__tests__/fulltextRanker.test.js`:

```js
'use strict';

jest.mock('../config/db', () => {
  const query = jest.fn();
  return { query, close: jest.fn() };
});

const sequelize = require('../config/db');
const { rankByQuery, NAME_MATCH_WEIGHT } = require('../services/search/fulltextRanker');

describe('rankByQuery', () => {
  beforeEach(() => sequelize.query.mockReset());

  test('builds SQL with name boost and term_scores join, returns candidates', async () => {
    sequelize.query.mockResolvedValueOnce([[
      { id: 19, name: 'TPT Menurut Jenis Kelamin', type: 'dynamic', base_relevance: 5.2, click_count: 100 },
      { id: 201, name: 'TPT Kabupaten/Kota',       type: 'dynamic', base_relevance: 4.1, click_count: 30 },
    ]]);

    const result = await rankByQuery({ q: 'tpt malut 2024', limit: 10 });

    expect(sequelize.query).toHaveBeenCalledTimes(1);
    const [sql, opts] = sequelize.query.mock.calls[0];
    expect(sql).toMatch(/MATCH\(ds\.name\) AGAINST\(:q/);
    expect(sql).toMatch(/MATCH\(ds\.description\) AGAINST\(:q/);
    expect(sql).toMatch(/LEFT JOIN data_search_stats ss/);
    expect(sql).toMatch(/ORDER BY base_relevance DESC/);
    expect(opts.replacements.q).toBe('tpt malut 2024');
    expect(opts.replacements.limit).toBe(10);
    expect(opts.replacements.name_boost).toBe(NAME_MATCH_WEIGHT);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(19);
    expect(result[0].base_relevance).toBe(5.2);
  });

  test('respects ignored_source_ids', async () => {
    sequelize.query.mockResolvedValueOnce([[]]);
    await rankByQuery({ q: 'x', limit: 5, ignoredIds: [166, 167] });
    const opts = sequelize.query.mock.calls[0][1];
    expect(opts.replacements.ignored_source_ids).toEqual([166, 167]);
  });

  test('returns empty array on empty query', async () => {
    const result = await rankByQuery({ q: '', limit: 10 });
    expect(result).toEqual([]);
    expect(sequelize.query).not.toHaveBeenCalled();
  });

  test('NAME_MATCH_WEIGHT is a structural constant', () => {
    expect(NAME_MATCH_WEIGHT).toBe(2.0);
  });
});
```

- [ ] **Step 2.2: Run to verify failure**

```bash
cd <WORKTREE>/project-data-strategis/backend && npx jest src/__tests__/fulltextRanker.test.js 2>&1 | tail -10
```

Expected: FAIL — "Cannot find module '../services/search/fulltextRanker'".

- [ ] **Step 2.3: Create the module**

Create `<WORKTREE>/project-data-strategis/backend/src/services/search/fulltextRanker.js`:

```js
'use strict';

const sequelize = require('../../config/db');

// Structural constant: data_sources.name (~10 chars) carries denser information per character
// than description (~200 chars). Same query term in name = ~20x more informative, weighted down to 2.0
// to avoid saturating the score.
const NAME_MATCH_WEIGHT = 2.0;

// Structural guardrail list (pre-existing in datasourceSearch.service.js — kept as default).
// Callers can pass their own via ignoredIds param.
const DEFAULT_IGNORED_SOURCE_IDS = [166, 167, 168, 169];

const RANK_SQL = `
  SELECT
    ds.id, ds.name, ds.type,
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
  LIMIT :limit
`;

async function rankByQuery({ q, limit = 25, ignoredIds = DEFAULT_IGNORED_SOURCE_IDS }) {
  const query = String(q || '').trim();
  if (!query) return [];

  const [rows] = await sequelize.query(RANK_SQL, {
    replacements: {
      q: query,
      name_boost: NAME_MATCH_WEIGHT,
      ignored_source_ids: ignoredIds.length ? ignoredIds : [-1],  // :ignored_source_ids must not be empty
      limit: Math.max(1, Math.min(100, Math.floor(limit))),
    },
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    base_relevance: Number(r.base_relevance) || 0,
    click_count: Number(r.click_count) || 0,
  }));
}

module.exports = { rankByQuery, NAME_MATCH_WEIGHT, DEFAULT_IGNORED_SOURCE_IDS };
```

- [ ] **Step 2.4: Run tests to verify pass**

```bash
cd <WORKTREE>/project-data-strategis/backend && npx jest src/__tests__/fulltextRanker.test.js 2>&1 | tail -10
```

Expected: `Tests: 4 passed, 4 total`.

- [ ] **Step 2.5: Commit**

```bash
git -C <WORKTREE> branch --show-current
# must print feature branch

git -C <WORKTREE> add \
  project-data-strategis/backend/src/services/search/fulltextRanker.js \
  project-data-strategis/backend/src/__tests__/fulltextRanker.test.js

git -C <WORKTREE> commit -m "feat(search): add fulltextRanker.rankByQuery with click-through join"
```

---

### Task 3: `applyClickPrior` — post-SQL click-through multiplier + tests

**Files:**
- Modify: `<WORKTREE>/project-data-strategis/backend/src/services/search/fulltextRanker.js`
- Modify: `<WORKTREE>/project-data-strategis/backend/src/__tests__/fulltextRanker.test.js`

**Why:** Spec §5.2 — click-through is a *multiplier* (not a second scorer), applied in JS post-SQL with log-normalization against a query-local maximum.

- [ ] **Step 3.1: Append failing tests**

Append to `<WORKTREE>/project-data-strategis/backend/src/__tests__/fulltextRanker.test.js`:

```js
describe('applyClickPrior', () => {
  const { applyClickPrior, MAX_CLICK_WEIGHT } = require('../services/search/fulltextRanker');

  test('returns candidates unchanged when all have zero clicks', () => {
    const input = [
      { id: 1, base_relevance: 5, click_count: 0 },
      { id: 2, base_relevance: 3, click_count: 0 },
    ];
    const out = applyClickPrior(input);
    expect(out).toEqual(input);
  });

  test('scales effective_score by up to MAX_CLICK_WEIGHT for most-clicked candidate', () => {
    const input = [
      { id: 1, base_relevance: 5, click_count: 100 },  // top clicks
      { id: 2, base_relevance: 4, click_count: 1 },    // minimal clicks
    ];
    const out = applyClickPrior(input);
    // Most-clicked gets full boost (click_prior = 1.0)
    expect(out[0].click_prior).toBe(1);
    expect(out[0].effective_score).toBeCloseTo(5 * (1 + MAX_CLICK_WEIGHT), 5);
    // Low-clicked gets a small boost (log(2) / log(101) ≈ 0.15)
    expect(out[1].click_prior).toBeGreaterThan(0);
    expect(out[1].click_prior).toBeLessThan(0.3);
  });

  test('empty input returns empty array', () => {
    expect(applyClickPrior([])).toEqual([]);
  });

  test('MAX_CLICK_WEIGHT is a structural constant', () => {
    expect(MAX_CLICK_WEIGHT).toBe(0.5);
  });
});

describe('deriveConfidence', () => {
  const { deriveConfidence } = require('../services/search/fulltextRanker');

  test('0 candidates → 0 confidence', () => {
    expect(deriveConfidence([])).toBe(0);
  });

  test('1 candidate → full confidence', () => {
    expect(deriveConfidence([{ effective_score: 5 }])).toBe(1);
  });

  test('tied top two → near-zero confidence', () => {
    const r = deriveConfidence([
      { effective_score: 5 },
      { effective_score: 5 },
    ]);
    expect(r).toBeCloseTo(0);
  });

  test('top dominates second → high confidence', () => {
    const r = deriveConfidence([
      { effective_score: 10 },
      { effective_score: 2 },
    ]);
    expect(r).toBeCloseTo(0.8, 1);  // (10-2)/10 = 0.8
  });
});
```

- [ ] **Step 3.2: Run to verify failure**

```bash
cd <WORKTREE>/project-data-strategis/backend && npx jest src/__tests__/fulltextRanker.test.js 2>&1 | tail -15
```

Expected: FAIL — "applyClickPrior is not a function" or similar.

- [ ] **Step 3.3: Extend `fulltextRanker.js`**

Open `<WORKTREE>/project-data-strategis/backend/src/services/search/fulltextRanker.js`. After the `NAME_MATCH_WEIGHT` constant, add:

```js
// Structural policy bound: popularity can boost relevance by up to 50%.
// Not a per-indicator weight — applies corpus-wide to any source with non-zero clicks.
const MAX_CLICK_WEIGHT = 0.5;
```

Before `module.exports`, add the two new functions:

```js
function applyClickPrior(candidates) {
  if (!candidates.length) return candidates;

  // Corpus-derived denominator: max click count among this query's candidates.
  // Self-scaling — nothing hardcoded globally.
  const maxClicks = Math.max(0, ...candidates.map((c) => c.click_count || 0));
  if (maxClicks === 0) return candidates;

  const logMax = Math.log1p(maxClicks);
  return candidates.map((c) => {
    const clickPrior = logMax > 0 ? Math.log1p(c.click_count || 0) / logMax : 0;
    const effective_score = (c.base_relevance || 0) * (1 + clickPrior * MAX_CLICK_WEIGHT);
    return { ...c, effective_score, click_prior: clickPrior };
  });
}

// Confidence = (top1 - top2) / top1. Single candidate → 1. Empty → 0.
// Measures how unambiguous the top result is, purely from the score distribution.
function deriveConfidence(candidates) {
  if (!candidates.length) return 0;
  if (candidates.length === 1) return 1;
  const top1 = candidates[0].effective_score || 0;
  if (top1 <= 0) return 0;
  const gap = top1 - (candidates[1].effective_score || 0);
  return Math.min(1, Math.max(0, gap / top1));
}
```

Update the module exports line to include the new symbols:

```js
module.exports = {
  rankByQuery,
  applyClickPrior,
  deriveConfidence,
  NAME_MATCH_WEIGHT,
  MAX_CLICK_WEIGHT,
  DEFAULT_IGNORED_SOURCE_IDS,
};
```

- [ ] **Step 3.4: Run tests to verify pass**

```bash
cd <WORKTREE>/project-data-strategis/backend && npx jest src/__tests__/fulltextRanker.test.js 2>&1 | tail -8
```

Expected: `Tests: 12 passed, 12 total` (4 prior + 4 new applyClickPrior + 4 new deriveConfidence).

- [ ] **Step 3.5: Commit**

```bash
git -C <WORKTREE> add \
  project-data-strategis/backend/src/services/search/fulltextRanker.js \
  project-data-strategis/backend/src/__tests__/fulltextRanker.test.js

git -C <WORKTREE> commit -m "feat(search): add applyClickPrior + deriveConfidence to fulltextRanker"
```

---

## Phase 3 — Entity resolver module

### Task 4: `entityResolver.rebuildEntityIndex` — entity mining from data_sources.name

**Files:**
- Create: `<WORKTREE>/project-data-strategis/backend/src/services/search/entityResolver.js`
- Test: `<WORKTREE>/project-data-strategis/backend/src/__tests__/entityResolver.test.js`

**Why:** Spec §7.2 — mine kab/kota/regional entity names dynamically from `data_sources.name` at startup. Replaces `KNOWN_GEO_PHRASES` hardcoded list.

- [ ] **Step 4.1: Write the failing test**

Create `<WORKTREE>/project-data-strategis/backend/src/__tests__/entityResolver.test.js`:

```js
'use strict';

jest.mock('../models/DataSource.model', () => {
  return {
    findAll: jest.fn(),
  };
}, { virtual: true });

const DataSource = require('../models/DataSource.model');
const { rebuildEntityIndex, getEntityIndex } = require('../services/search/entityResolver');

describe('rebuildEntityIndex', () => {
  beforeEach(() => DataSource.findAll.mockReset());

  test('mines geo entities from data_sources.name column', async () => {
    DataSource.findAll.mockResolvedValueOnce([
      { name: 'Inflasi Provinsi Maluku Utara (2022 = 100)' },
      { name: 'Indeks Pembangunan Manusia Menurut Kabupaten/Kota' },
      { name: 'Inflasi Kota Ternate (2022 = 100)' },
      { name: 'Inflasi Kabupaten Halmahera Tengah (2022 = 100)' },
      { name: 'Jumlah Penduduk Miskin Kepulauan Sula' },
      { name: 'Indeks Harga Konsumen Pulau Morotai' },
    ]);

    await rebuildEntityIndex();
    const index = getEntityIndex();

    // Should include multi-word regional entities from the corpus
    expect(index).toEqual(expect.arrayContaining([
      'maluku utara',
      'kota ternate',
      'kabupaten halmahera tengah',
      'kepulauan sula',
      'pulau morotai',
    ]));
  });

  test('handles empty corpus', async () => {
    DataSource.findAll.mockResolvedValueOnce([]);
    await rebuildEntityIndex();
    expect(getEntityIndex()).toEqual([]);
  });

  test('deduplicates identical entities', async () => {
    DataSource.findAll.mockResolvedValueOnce([
      { name: 'Data A Kota Ternate 2020' },
      { name: 'Data B Kota Ternate 2021' },
      { name: 'Data C Kota Ternate 2022' },
    ]);
    await rebuildEntityIndex();
    const index = getEntityIndex();
    const tenarteCount = index.filter((e) => e === 'kota ternate').length;
    expect(tenarteCount).toBe(1);
  });
});
```

- [ ] **Step 4.2: Verify failure**

```bash
cd <WORKTREE>/project-data-strategis/backend && npx jest src/__tests__/entityResolver.test.js 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 4.3: Create the module**

Create `<WORKTREE>/project-data-strategis/backend/src/services/search/entityResolver.js`:

```js
'use strict';

const DataSource = require('../../models/DataSource.model');

// Module-level cache of mined entities. Rebuilt by rebuildEntityIndex().
// Shape: Array<string> of canonical (lowercase, whitespace-normalized) entity names.
let entityIndex = [];

function normalizeText(input) {
  return String(input || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Pattern captures compound regional names: <prefix> + <noun-phrase>.
// Stops at whitespace/end/comma/open-paren to avoid grabbing trailing "2022 = 100" or similar.
const GEO_PATTERN = /(kota|kabupaten|pulau|kepulauan|halmahera)\s+([\p{L}][\p{L}\s]*?)(?=\s+\d|\s*[,()\/]|\s*$)/giu;

async function rebuildEntityIndex() {
  const rows = await DataSource.findAll({ attributes: ['name'] });
  const entities = new Set();

  for (const row of rows) {
    const name = normalizeText(row.name);

    // Extract via the geo pattern — one pass per row.
    for (const match of name.matchAll(GEO_PATTERN)) {
      const phrase = `${match[1]} ${match[2]}`.trim();
      if (phrase.length >= 5 && phrase.length <= 40) entities.add(phrase);
    }

    // Province-level special-case: "maluku utara" is the parent region, no prefix word.
    if (name.includes('maluku utara')) entities.add('maluku utara');
  }

  entityIndex = [...entities].sort();
}

function getEntityIndex() {
  return entityIndex.slice();
}

module.exports = { rebuildEntityIndex, getEntityIndex };
```

- [ ] **Step 4.4: Verify tests pass**

```bash
cd <WORKTREE>/project-data-strategis/backend && npx jest src/__tests__/entityResolver.test.js 2>&1 | tail -10
```

Expected: `Tests: 3 passed, 3 total`.

- [ ] **Step 4.5: Commit**

```bash
git -C <WORKTREE> branch --show-current
git -C <WORKTREE> add \
  project-data-strategis/backend/src/services/search/entityResolver.js \
  project-data-strategis/backend/src/__tests__/entityResolver.test.js
git -C <WORKTREE> commit -m "feat(search): add entityResolver.rebuildEntityIndex (mine geo entities from data_sources)"
```

---

### Task 5: `resolvePrefixAlias` — handle abbreviations like `halut`, `tikep`, `pulmor`

**Files:**
- Modify: `<WORKTREE>/project-data-strategis/backend/src/services/search/entityResolver.js`
- Modify: `<WORKTREE>/project-data-strategis/backend/src/__tests__/entityResolver.test.js`

**Why:** Spec §7.4 — the prefix-alias algorithm generalizes the current hardcoded alias table. Test covers every alias in `expandGeoAbbreviations`.

- [ ] **Step 5.1: Append failing tests**

Append to `<WORKTREE>/project-data-strategis/backend/src/__tests__/entityResolver.test.js`:

```js
describe('resolvePrefixAlias', () => {
  const { resolvePrefixAlias, _setIndexForTesting } = require('../services/search/entityResolver');

  beforeAll(() => {
    _setIndexForTesting([
      'maluku utara',
      'halmahera utara',
      'halmahera selatan',
      'halmahera tengah',
      'halmahera barat',
      'halmahera timur',
      'tidore kepulauan',
      'kepulauan sula',
      'pulau morotai',
      'pulau taliabu',
      'kota ternate',
    ]);
  });

  test.each([
    ['halut',   'halmahera utara'],
    ['halsel',  'halmahera selatan'],
    ['halteng', 'halmahera tengah'],
    ['halbar',  'halmahera barat'],
    ['haltim',  'halmahera timur'],
    ['tikep',   'tidore kepulauan'],
    ['pulmor',  'pulau morotai'],
    ['kepsul',  'kepulauan sula'],
    ['pultal',  'pulau taliabu'],
    ['malut',   'maluku utara'],
  ])('resolves concatenated-prefix alias "%s" → "%s"', (alias, expected) => {
    expect(resolvePrefixAlias(alias)).toBe(expected);
  });

  test('returns null for tokens with spaces', () => {
    expect(resolvePrefixAlias('hal ut')).toBe(null);
  });

  test('returns null for tokens shorter than 5 chars', () => {
    expect(resolvePrefixAlias('hal')).toBe(null);
  });

  test('returns null when no match', () => {
    expect(resolvePrefixAlias('xyzzy')).toBe(null);
  });

  test('does not match single-word entities', () => {
    _setIndexForTesting(['indonesia']);
    expect(resolvePrefixAlias('ind')).toBe(null);  // single-word entity, algorithm requires ≥2 words
  });
});
```

- [ ] **Step 5.2: Verify failure**

```bash
cd <WORKTREE>/project-data-strategis/backend && npx jest src/__tests__/entityResolver.test.js 2>&1 | tail -20
```

Expected: FAIL — `resolvePrefixAlias is not a function`.

- [ ] **Step 5.3: Extend the module**

Open `<WORKTREE>/project-data-strategis/backend/src/services/search/entityResolver.js`. Before `module.exports`, add:

```js
function resolvePrefixAlias(queryToken) {
  const tok = normalizeText(queryToken);
  if (tok.length < 5 || tok.includes(' ')) return null;

  for (const entity of entityIndex) {
    const words = entity.split(' ');
    if (words.length < 2) continue;  // prefix-alias only for multi-word entities

    let remaining = tok;
    let matched = true;
    for (const word of words) {
      // Greedy: consume chars from remaining matching word's prefix
      let prefixLen = 0;
      while (
        prefixLen < word.length &&
        prefixLen < remaining.length &&
        word[prefixLen] === remaining[prefixLen]
      ) {
        prefixLen++;
      }
      // Each entity word must contribute ≥2 prefix chars — defends against "hal" alone matching "halmahera utara"
      if (prefixLen < 2) { matched = false; break; }
      remaining = remaining.slice(prefixLen);
    }

    if (matched && remaining.length === 0) return entity;
  }
  return null;
}

// Test-only setter — lets tests inject a fixed index without calling rebuildEntityIndex.
function _setIndexForTesting(entities) {
  entityIndex = entities.slice();
}
```

Update `module.exports`:

```js
module.exports = { rebuildEntityIndex, getEntityIndex, resolvePrefixAlias, _setIndexForTesting };
```

- [ ] **Step 5.4: Verify tests pass**

```bash
cd <WORKTREE>/project-data-strategis/backend && npx jest src/__tests__/entityResolver.test.js 2>&1 | tail -10
```

Expected: `Tests: 17 passed, 17 total` (3 prior + 14 new).

- [ ] **Step 5.5: Commit**

```bash
git -C <WORKTREE> add \
  project-data-strategis/backend/src/services/search/entityResolver.js \
  project-data-strategis/backend/src/__tests__/entityResolver.test.js
git -C <WORKTREE> commit -m "feat(search): add resolvePrefixAlias for dynamic abbreviation handling"
```

---

### Task 6: `resolveGeo` — composition of Tier 1 + Tier 2 + Tier 3

**Files:**
- Modify: `<WORKTREE>/project-data-strategis/backend/src/services/search/entityResolver.js`
- Modify: `<WORKTREE>/project-data-strategis/backend/src/__tests__/entityResolver.test.js`

**Why:** Spec §7.3 — three-tier resolver. Tier 1 is exact substring. Tier 2 is prefix-alias (Task 5). Tier 3 is Levenshtein for typos.

- [ ] **Step 6.1: Append failing tests**

Append to `<WORKTREE>/project-data-strategis/backend/src/__tests__/entityResolver.test.js`:

```js
describe('resolveGeo (tiered)', () => {
  const { resolveGeo, _setIndexForTesting } = require('../services/search/entityResolver');

  beforeEach(() => {
    _setIndexForTesting([
      'maluku utara',
      'halmahera utara',
      'halmahera selatan',
      'pulau morotai',
      'kota ternate',
      'kabupaten halmahera tengah',
    ]);
  });

  test('Tier 1: exact substring match', () => {
    expect(resolveGeo('pengangguran maluku utara 2024')).toContain('maluku utara');
    expect(resolveGeo('kemiskinan kota ternate')).toContain('kota ternate');
  });

  test('Tier 2: prefix-alias for abbreviation', () => {
    expect(resolveGeo('tpt halut 2024')).toContain('halmahera utara');
    expect(resolveGeo('inflasi pulmor')).toContain('pulau morotai');
  });

  test('Tier 3: Levenshtein for single-word typo in multi-word entity', () => {
    // "tenarte" → "ternate" (single edit)
    expect(resolveGeo('inflasi kota tenarte')).toContain('kota ternate');
  });

  test('multiple matches from the query', () => {
    const result = resolveGeo('perbandingan halmahera utara dan halmahera selatan');
    expect(result).toContain('halmahera utara');
    expect(result).toContain('halmahera selatan');
  });

  test('returns empty array when no entity matches', () => {
    expect(resolveGeo('halo apa kabar')).toEqual([]);
  });

  test('empty query returns empty array', () => {
    expect(resolveGeo('')).toEqual([]);
  });
});
```

- [ ] **Step 6.2: Verify failure**

```bash
cd <WORKTREE>/project-data-strategis/backend && npx jest src/__tests__/entityResolver.test.js 2>&1 | tail -10
```

Expected: FAIL — `resolveGeo is not a function`.

- [ ] **Step 6.3: Extend the module**

Open `<WORKTREE>/project-data-strategis/backend/src/services/search/entityResolver.js`. Before `module.exports`, add:

```js
// Classic iterative Levenshtein distance (O(mn) time, O(n) space).
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function tokenize(text) {
  return String(text || '')
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}-]/gu, ''))
    .filter((t) => t.length > 0);
}

function resolveGeo(q) {
  const normQ = normalizeText(q);
  if (!normQ) return [];
  const matches = new Set();

  // Tier 1: exact substring (cheapest — ~95% of well-formed queries)
  for (const entity of entityIndex) {
    if (normQ.includes(entity)) matches.add(entity);
  }

  // Tier 2: prefix-alias for abbreviations (only if Tier 1 missed)
  if (matches.size === 0) {
    for (const token of tokenize(normQ)) {
      const alias = resolvePrefixAlias(token);
      if (alias) matches.add(alias);
    }
  }

  // Tier 3: Levenshtein for typos (only if Tier 1+2 missed)
  if (matches.size === 0) {
    for (const token of tokenize(normQ)) {
      if (token.length < 5) continue;
      for (const entity of entityIndex) {
        const entityWords = entity.split(' ');
        for (const word of entityWords) {
          if (word.length < 5) continue;
          const tolerance = Math.min(2, Math.floor(word.length / 3));
          if (levenshtein(token, word) <= tolerance) {
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

Update `module.exports`:

```js
module.exports = {
  rebuildEntityIndex, getEntityIndex, resolvePrefixAlias, resolveGeo,
  _setIndexForTesting,
  // expose for focused unit testing
  _levenshtein: levenshtein,
  _tokenize: tokenize,
};
```

- [ ] **Step 6.4: Verify tests pass**

```bash
cd <WORKTREE>/project-data-strategis/backend && npx jest src/__tests__/entityResolver.test.js 2>&1 | tail -8
```

Expected: `Tests: 23 passed, 23 total` (17 prior + 6 new).

- [ ] **Step 6.5: Commit**

```bash
git -C <WORKTREE> add \
  project-data-strategis/backend/src/services/search/entityResolver.js \
  project-data-strategis/backend/src/__tests__/entityResolver.test.js
git -C <WORKTREE> commit -m "feat(search): add resolveGeo three-tier resolver (exact → prefix → Levenshtein)"
```

---

## Phase 4 — Intent rewire (shadow mode)

### Task 7: Shadow logger service

**Files:**
- Create: `<WORKTREE>/project-data-strategis/backend/src/services/search/shadowLogger.service.js`
- Test: `<WORKTREE>/project-data-strategis/backend/src/__tests__/shadowLogger.test.js`

**Why:** Spec §8.3 — shadow mode logs divergence between old and new rankers without affecting users. Hashed query only (no PII).

- [ ] **Step 7.1: Write the failing test**

Create `<WORKTREE>/project-data-strategis/backend/src/__tests__/shadowLogger.test.js`:

```js
'use strict';

const {
  recordDivergence,
  snapshot,
  reset,
  hashQuery,
} = require('../services/search/shadowLogger.service');

describe('shadowLogger', () => {
  beforeEach(() => reset());

  test('hashQuery produces a short, deterministic, non-reversible digest', () => {
    const h1 = hashQuery('tpt malut 2024');
    const h2 = hashQuery('tpt malut 2024');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(12);
    expect(h1).not.toContain('tpt');
    expect(h1).not.toContain('malut');
  });

  test('recordDivergence accumulates entries', () => {
    recordDivergence({ q: 'a', oldSourceId: 1, newSourceId: 2, oldType: 'dynamic', newType: 'interop' });
    recordDivergence({ q: 'b', oldSourceId: 3, newSourceId: 3, oldType: 'dynamic', newType: 'dynamic' });
    const s = snapshot();
    expect(s.total_divergent).toBe(1);  // only 1 had different source_id
    expect(s.total_recorded).toBe(2);
  });

  test('snapshot groups divergences by old→new source_id pair', () => {
    recordDivergence({ q: 'q1', oldSourceId: 1, newSourceId: 2 });
    recordDivergence({ q: 'q2', oldSourceId: 1, newSourceId: 2 });
    recordDivergence({ q: 'q3', oldSourceId: 3, newSourceId: 4 });
    const s = snapshot();
    expect(s.divergence_pairs['1→2']).toBe(2);
    expect(s.divergence_pairs['3→4']).toBe(1);
  });

  test('reset clears accumulated data', () => {
    recordDivergence({ q: 'a', oldSourceId: 1, newSourceId: 2 });
    reset();
    expect(snapshot().total_recorded).toBe(0);
  });
});
```

- [ ] **Step 7.2: Verify failure**

```bash
cd <WORKTREE>/project-data-strategis/backend && npx jest src/__tests__/shadowLogger.test.js 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 7.3: Create the module**

Create `<WORKTREE>/project-data-strategis/backend/src/services/search/shadowLogger.service.js`:

```js
'use strict';

const crypto = require('crypto');

let recorded = [];
const pairCounts = new Map();

function hashQuery(q) {
  const s = String(q || '');
  if (!s) return '';
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
}

function recordDivergence({ q, oldSourceId, newSourceId, oldType, newType, newTop1Score, newConfidence }) {
  const entry = {
    q_hash: hashQuery(q),
    old_source_id: oldSourceId == null ? null : Number(oldSourceId),
    new_source_id: newSourceId == null ? null : Number(newSourceId),
    old_type: oldType || null,
    new_type: newType || null,
    new_top1_score: newTop1Score == null ? null : Number(newTop1Score),
    new_confidence: newConfidence == null ? null : Number(newConfidence),
    ts: new Date().toISOString(),
  };
  recorded.push(entry);

  if (entry.old_source_id !== entry.new_source_id) {
    const key = `${entry.old_source_id}→${entry.new_source_id}`;
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }
}

function snapshot() {
  const divergent = recorded.filter((r) => r.old_source_id !== r.new_source_id);
  return {
    total_recorded: recorded.length,
    total_divergent: divergent.length,
    divergence_pairs: Object.fromEntries(pairCounts.entries()),
    sample: divergent.slice(-20),  // last 20 divergences for spot-inspection
  };
}

function reset() {
  recorded = [];
  pairCounts.clear();
}

module.exports = { recordDivergence, snapshot, reset, hashQuery };
```

- [ ] **Step 7.4: Verify tests pass**

```bash
cd <WORKTREE>/project-data-strategis/backend && npx jest src/__tests__/shadowLogger.test.js 2>&1 | tail -8
```

Expected: `Tests: 4 passed, 4 total`.

- [ ] **Step 7.5: Commit**

```bash
git -C <WORKTREE> add \
  project-data-strategis/backend/src/services/search/shadowLogger.service.js \
  project-data-strategis/backend/src/__tests__/shadowLogger.test.js
git -C <WORKTREE> commit -m "feat(search): add shadowLogger service for phase 4 divergence tracking"
```

---

### Task 8: Intent rewire with shadow mode

**Files:**
- Modify: `<WORKTREE>/project-data-strategis/backend/src/services/search/intent.service.js`
- Create: `<WORKTREE>/project-data-strategis/backend/src/controllers/searchAdmin.controller.js` extension — add shadow snapshot endpoint

**Why:** Spec §6 + §8.3 — run new ranker in parallel with old `mapDatasourceFromQuery`. Return OLD result to users. Log divergence. Expose a snapshot endpoint for manual review.

- [ ] **Step 8.1: Back up intent.service.js**

```bash
cp <WORKTREE>/project-data-strategis/backend/src/services/search/intent.service.js \
   <WORKTREE>/project-data-strategis/backend/src/services/search/intent.service.js.backup
```

- [ ] **Step 8.2: Write shadow-mode test**

Create `<WORKTREE>/project-data-strategis/backend/src/__tests__/intent.shadowMode.test.js`:

```js
'use strict';

jest.mock('../services/search/fulltextRanker', () => ({
  rankByQuery:     jest.fn(),
  applyClickPrior: (c) => c,  // identity for tests
  deriveConfidence: () => 0.8,
  NAME_MATCH_WEIGHT: 2.0,
  MAX_CLICK_WEIGHT: 0.5,
}));
jest.mock('../services/search/entityResolver', () => ({
  resolveGeo: jest.fn(() => []),
  rebuildEntityIndex: jest.fn(),
  getEntityIndex: jest.fn(() => []),
}));
jest.mock('../services/ai/queryBuilder.service', () => ({
  buildQueryFromText: jest.fn().mockResolvedValue({
    intent: 'data', type: 'dynamic', params: { year: 2024 }, confidence: 0.9,
  }),
}));
jest.mock('../services/search/datasourceSearch.service', () => ({
  searchDatasources: jest.fn().mockResolvedValue([
    { id: 19, type: 'dynamic' },
  ]),
  expandIndicatorAbbreviations: jest.fn((q) => q),
}));
jest.mock('../services/bpsRead/indicatorAvailability.service', () => ({
  indicatorTableExistsInBps: jest.fn().mockResolvedValue({ available: true }),
}));
jest.mock('../models/DataSource.model', () => ({ findOne: jest.fn() }), { virtual: true });
jest.mock('../models/DataPeriod.model', () => ({ findAll: jest.fn().mockResolvedValue([]) }), { virtual: true });

const { rankByQuery } = require('../services/search/fulltextRanker');
const { recordDivergence, snapshot, reset } = require('../services/search/shadowLogger.service');
const { resolveSearchIntent } = require('../services/search/intent.service');

describe('shadow mode', () => {
  beforeEach(() => {
    rankByQuery.mockReset();
    reset();
  });

  test('with SEARCH_SHADOW_MODE=1, records divergence when old!=new', async () => {
    process.env.SEARCH_SHADOW_MODE = '1';
    // Old path picks source_id 19 (via mapDatasourceFromQuery → searchDatasources mock)
    // New path picks source_id 42 (via rankByQuery mock)
    rankByQuery.mockResolvedValueOnce([{ id: 42, type: 'interop', base_relevance: 5 }]);

    const result = await resolveSearchIntent({ q: 'tpt malut 2024' });

    // User gets OLD result
    expect(result.ok).toBe(true);
    // Divergence recorded (19 → 42)
    const s = snapshot();
    expect(s.total_divergent).toBe(1);
    expect(s.divergence_pairs['19→42']).toBe(1);

    delete process.env.SEARCH_SHADOW_MODE;
  });

  test('without SEARCH_SHADOW_MODE, no divergence recording', async () => {
    delete process.env.SEARCH_SHADOW_MODE;
    rankByQuery.mockResolvedValueOnce([{ id: 42, type: 'interop', base_relevance: 5 }]);

    await resolveSearchIntent({ q: 'tpt malut 2024' });

    expect(snapshot().total_recorded).toBe(0);
  });

  test('no divergence recorded when old and new agree', async () => {
    process.env.SEARCH_SHADOW_MODE = '1';
    rankByQuery.mockResolvedValueOnce([{ id: 19, type: 'dynamic', base_relevance: 5 }]);

    await resolveSearchIntent({ q: 'tpt malut 2024' });

    const s = snapshot();
    expect(s.total_divergent).toBe(0);
    expect(s.total_recorded).toBe(1);  // agreement is still recorded, just not as divergence

    delete process.env.SEARCH_SHADOW_MODE;
  });
});
```

- [ ] **Step 8.3: Run — verify failure**

```bash
cd <WORKTREE>/project-data-strategis/backend && npx jest src/__tests__/intent.shadowMode.test.js 2>&1 | tail -15
```

Expected: FAIL — shadow logic not wired yet.

- [ ] **Step 8.4: Rewire `resolveSearchIntent`**

Open `<WORKTREE>/project-data-strategis/backend/src/services/search/intent.service.js`.

Near the top, add the new requires alongside existing imports:

```js
const { rankByQuery, applyClickPrior, deriveConfidence } = require('../search/fulltextRanker');
const { recordDivergence } = require('../search/shadowLogger.service');
```

(Note: the file is already in `services/search/`, so relative path is `./fulltextRanker` — adjust based on actual path in your file. If `intent.service.js` sits alongside, use `'./fulltextRanker'`.)

Find `resolveSearchIntent` (around line 482). Inside the function, AFTER the existing `mapped = await mapDatasourceFromQuery({ q, qb })` call (which produces the OLD result), add a shadow-mode block:

```js
  // SHADOW MODE (Phase 4): run the new ranker in parallel, record divergence.
  // Users still receive the OLD result (mapped, above). No user-visible behavior change.
  if (process.env.SEARCH_SHADOW_MODE === '1') {
    try {
      const newCandidates = await rankByQuery({ q: query, limit: 25 });
      const ranked = applyClickPrior(newCandidates);
      const newTop = ranked[0] || null;

      recordDivergence({
        q: query,
        oldSourceId: mapped?.source_id ?? null,
        newSourceId: newTop?.id ?? null,
        oldType: mapped?.type ?? null,
        newType: newTop?.type ?? null,
        newTop1Score: newTop?.effective_score ?? null,
        newConfidence: deriveConfidence(ranked),
      });
    } catch (e) {
      // Shadow errors MUST NOT affect user-facing behavior
      console.warn('[intent] shadow mode error:', e?.message || String(e));
    }
  }
```

**Critical:** place this block AFTER `mapped` is resolved and BEFORE any return/plan computation. Do not short-circuit user flow on shadow errors — the `try/catch` is load-bearing.

- [ ] **Step 8.5: Run tests**

```bash
cd <WORKTREE>/project-data-strategis/backend && npx jest src/__tests__/intent.shadowMode.test.js src/__tests__/intent.service.noLlm.test.js 2>&1 | tail -10
```

Expected: `Tests: 6 passed, 6 total` (3 shadow + 3 prior noLlm).

- [ ] **Step 8.6: Add snapshot endpoint to admin controller**

Open `<WORKTREE>/project-data-strategis/backend/src/controllers/searchAdmin.controller.js`. Add a new handler:

```js
const shadowLogger = require('../services/search/shadowLogger.service');

async function shadowSnapshot(req, res) {
  return res.json(shadowLogger.snapshot());
}

module.exports = {
  // ...existing exports
  shadowSnapshot,
};
```

(Preserve the existing exports — add `shadowSnapshot` to the list, don't replace it.)

Add a route in `<WORKTREE>/project-data-strategis/backend/src/routes/search.admin.routes.js`:

```js
router.get('/shadow-snapshot', controller.shadowSnapshot);
```

(Route it under whatever admin-auth middleware the other `search.admin` routes use.)

- [ ] **Step 8.7: Smoke test the endpoint registration**

```bash
cd <WORKTREE>/project-data-strategis/backend && node -c src/controllers/searchAdmin.controller.js && node -c src/routes/search.admin.routes.js && echo "syntax OK"
```

Expected: `syntax OK`.

- [ ] **Step 8.8: Commit**

```bash
git -C <WORKTREE> add \
  project-data-strategis/backend/src/services/search/intent.service.js \
  project-data-strategis/backend/src/__tests__/intent.shadowMode.test.js \
  project-data-strategis/backend/src/controllers/searchAdmin.controller.js \
  project-data-strategis/backend/src/routes/search.admin.routes.js
git -C <WORKTREE> commit -m "feat(search): wire shadow mode for Phase 4 safety gate"
```

---

### Task 9: Deploy shadow mode, 24-48h soak (operator step)

**Files:** none (configuration only)

**Why:** Spec §8.3 — shadow mode must accumulate real-traffic divergence data before cutover.

- [ ] **Step 9.1: Add SEARCH_SHADOW_MODE=1 to backend env**

Add to `<WORKTREE>/project-data-strategis/backend/.env` (or the deploy config):
```
SEARCH_SHADOW_MODE=1
```

- [ ] **Step 9.2: Deploy backend**

```bash
pm2 reload pds-backend --update-env
```

- [ ] **Step 9.3: Verify shadow mode is active**

```bash
curl -s "http://127.0.0.1:5000/search/intent?q=tpt+malut+2024" > /dev/null
# Wait 5s, check snapshot
curl -s "http://127.0.0.1:5000/search/admin/shadow-snapshot" | python3 -m json.tool | head -30
```

Expected: `total_recorded > 0`.

- [ ] **Step 9.4: Soak window**

Leave shadow mode running for 24-48 hours to accumulate real production traffic. No code action during this window.

- [ ] **Step 9.5: Review divergence after soak**

```bash
curl -s "http://127.0.0.1:5000/search/admin/shadow-snapshot" > /tmp/shadow-snapshot-$(date +%Y%m%d).json
cat /tmp/shadow-snapshot-*.json | python3 -m json.tool
```

Review the output:
- `total_recorded` — how many queries shadow-ran
- `total_divergent` — how many produced different source_id
- `divergence_pairs` — top source_id transitions (`19→42`, etc.)
- `sample` — 20 example divergences for manual inspection

**GATE:** only proceed to Phase 5 if:
- Divergence rate < 50% (new ranker agrees with old on majority of happy-path queries)
- Sample inspection confirms divergences are sensible (e.g., new ranker picking a better-matching source)
- No pattern of catastrophic mis-routing (e.g., every "kemiskinan" query routed to an unrelated source)

If GATE fails, pause — file issues for the divergences and iterate on `fulltextRanker` before proceeding.

- [ ] **Step 9.6: (manual) Document findings in a markdown file**

Create `<WORKTREE>/project-data-strategis/docs/workspace/search-shadow-soak-2026-XX-XX.md`:

```markdown
# Shadow Mode Soak Report — 2026-XX-XX

**Duration:** YYYY-MM-DD to YYYY-MM-DD
**Queries shadow-ran:** <total_recorded>
**Divergences:** <total_divergent> (<pct>%)

## Top divergence pairs
<copy from snapshot.divergence_pairs>

## Sample inspection (20 cases)
<paste snapshot.sample, annotate each as PASS / FAIL / IGNORE>

## Gate decision
- [ ] Divergence rate < 50%: <rate>
- [ ] Sample inspection sensible: <yes/no>
- [ ] No catastrophic patterns: <yes/no>

**Decision:** PROCEED to cutover / PAUSE to iterate
```

Then:
```bash
git -C <WORKTREE> add project-data-strategis/docs/workspace/search-shadow-soak-*.md
git -C <WORKTREE> commit -m "chore(search): shadow mode soak report YYYY-MM-DD"
```

---

## Phase 5 — Cutover + deletion

### Task 10: Flip `mapDatasourceFromQuery` to new ranker + add entity resolver startup hook

**Files:**
- Modify: `<WORKTREE>/project-data-strategis/backend/src/services/search/intent.service.js` — rewire `mapDatasourceFromQuery`, remove shadow-only branch
- Modify: `<WORKTREE>/project-data-strategis/backend/server.js` — call `rebuildEntityIndex()` at startup

**Why:** Spec §6 — make the new ranker the primary, not just shadow.

- [ ] **Step 10.1: Update the failing tests**

Update `<WORKTREE>/project-data-strategis/backend/src/__tests__/intent.service.noLlm.test.js` — change the test for `skips LLM when noLlm=true` so it asserts that the fulltextRanker was called (not the old searchDatasources):

Near the top of the test file, add:
```js
jest.mock('../services/search/fulltextRanker', () => ({
  rankByQuery: jest.fn().mockResolvedValue([{ id: 19, type: 'dynamic', base_relevance: 5 }]),
  applyClickPrior: (c) => c,
  deriveConfidence: () => 0.8,
  NAME_MATCH_WEIGHT: 2.0,
  MAX_CLICK_WEIGHT: 0.5,
}));
jest.mock('../services/search/entityResolver', () => ({
  resolveGeo: jest.fn(() => []),
  rebuildEntityIndex: jest.fn(),
  getEntityIndex: jest.fn(() => []),
}));
jest.mock('../services/search/shadowLogger.service', () => ({
  recordDivergence: jest.fn(),
}));
```

Add a new test at the end of the existing `describe` block:

```js
  test('uses fulltextRanker when noLlm=true and returns top-ranked source_id', async () => {
    const { rankByQuery } = require('../services/search/fulltextRanker');
    rankByQuery.mockResolvedValueOnce([{ id: 201, type: 'dynamic', base_relevance: 6 }]);
    const r = await resolveSearchIntent({ q: 'tpt kab/kota 2024', noLlm: true });
    expect(r.datasource?.source_id).toBe(201);
    expect(r.query_builder?.type).toBe('dynamic');  // no more 'unknown'
  });
```

- [ ] **Step 10.2: Rewire `mapDatasourceFromQuery`**

Open `<WORKTREE>/project-data-strategis/backend/src/services/search/intent.service.js`.

Find the existing `mapDatasourceFromQuery` function (around line 329). Replace its body with the new implementation:

```js
async function mapDatasourceFromQuery({ q, qb }) {
  const candidates = await rankByQuery({ q, limit: 25 });
  const ranked = applyClickPrior(candidates);

  if (qb?.type) {
    const filtered = ranked.filter((c) => c.type === qb.type);
    if (filtered.length) {
      return { source_id: filtered[0].id, type: filtered[0].type, strategy: 'llm-typed' };
    }
  }

  if (ranked.length) {
    return { source_id: ranked[0].id, type: ranked[0].type, strategy: 'fulltext-top1' };
  }

  return { source_id: null, type: null, strategy: 'no-match' };
}
```

Find `buildDeterministicQueryBuilder` (around line 424). Replace its body:

```js
function buildDeterministicQueryBuilder({ q, mappedType }) {
  const query = String(q || '').trim();
  const year = inferYearFromText(query);
  const month = inferMonthFromText(query);
  const intent = inferIntentFromText(query);

  return {
    version: 2,
    intent,
    type: mappedType || null,  // honest null instead of 'unknown'
    confidence: 0,  // Overridden by resolveSearchIntent using deriveConfidence from candidates
    params: {
      q: query,
      year: year || null,
      month: month || null,
      geo: null,  // Populated by resolveSearchIntent via entityResolver
      group: null, metric: null, code_hs: null, pod: null, ctr: null,
    },
    clauses: [],
  };
}
```

Find the shadow-mode block added in Task 8.4. Remove it (now that the new ranker is primary, shadow is redundant):

```js
  // Delete the entire `if (process.env.SEARCH_SHADOW_MODE === '1') { ... }` block
```

In `resolveSearchIntent`, after `mapped = await mapDatasourceFromQuery(...)`, compute confidence from the ranker's own output:

```js
  // Replace the current confidence assignment. After mapped is set:
  const candidates = await rankByQuery({ q: query, limit: 5 });
  const ranked = applyClickPrior(candidates);
  if (qb) qb.confidence = deriveConfidence(ranked);

  // Populate geo via entityResolver (was previously only in expandGeoAbbreviations)
  const resolvedGeo = resolveGeo(query);
  if (qb && qb.params && resolvedGeo.length && !qb.params.geo) {
    qb.params.geo = resolvedGeo[0];
  }
```

Also add at the top: `const { resolveGeo } = require('./entityResolver');`.

- [ ] **Step 10.3: Add entity index rebuild to server startup**

Open `<WORKTREE>/project-data-strategis/backend/server.js`.

Add near the top:
```js
const { rebuildEntityIndex } = require('./src/services/search/entityResolver');
```

Inside the startup function, after the migration calls:
```js
        await ensureSearchFullTextIndexes();
        await rebuildEntityIndex();  // ← add this line
```

- [ ] **Step 10.4: Run tests**

```bash
cd <WORKTREE>/project-data-strategis/backend && npx jest src/__tests__/intent 2>&1 | tail -10
```

Expected: all intent tests pass. If any fail because they assert on old behavior (e.g., checking for specific boost values), update them to reflect the new ranker semantics.

- [ ] **Step 10.5: Remove `SEARCH_SHADOW_MODE` env var from production config**

The shadow-mode block is now deleted from the code, but the env var should also be cleaned up:

```bash
# Remove SEARCH_SHADOW_MODE from .env (operator step)
```

- [ ] **Step 10.6: Commit**

```bash
git -C <WORKTREE> branch --show-current
git -C <WORKTREE> add \
  project-data-strategis/backend/src/services/search/intent.service.js \
  project-data-strategis/backend/src/__tests__/intent.service.noLlm.test.js \
  project-data-strategis/backend/server.js
git -C <WORKTREE> commit -m "feat(search): cutover — mapDatasourceFromQuery uses fulltextRanker as primary"
```

---

### Task 11: Delete obsolete code from `datasourceSearch.service.js`

**Files:**
- Modify: `<WORKTREE>/project-data-strategis/backend/src/services/search/datasourceSearch.service.js` — delete `scoreDatasource`, `expandGeoAbbreviations`, `normalizeGeoTypos`, `KNOWN_GEO_PHRASES`, `detectKnownGeoPhrases`, `indicatesKabKotaDimensionFromText`

**Why:** Spec §3.2 — hand-scored and hardcoded code is now dead. Delete, don't comment out.

- [ ] **Step 11.1: Back up the file**

```bash
cp <WORKTREE>/project-data-strategis/backend/src/services/search/datasourceSearch.service.js \
   <WORKTREE>/project-data-strategis/backend/src/services/search/datasourceSearch.service.js.backup
```

- [ ] **Step 11.2: Verify no callers remain**

```bash
cd <WORKTREE>/project-data-strategis/backend && grep -rn "scoreDatasource\|expandGeoAbbreviations\|normalizeGeoTypos\|KNOWN_GEO_PHRASES\|detectKnownGeoPhrases\|indicatesKabKotaDimensionFromText" src/ --include="*.js" | grep -v ".backup" | grep -v "datasourceSearch.service.js"
```

Expected: **no output**. If any file outside `datasourceSearch.service.js` itself references these, STOP and update those callers first.

- [ ] **Step 11.3: Delete the obsolete functions**

Open `<WORKTREE>/project-data-strategis/backend/src/services/search/datasourceSearch.service.js`.

Delete the following (line ranges approximate — verify against your copy):
- `function expandGeoAbbreviations` and its body (lines ~41-61)
- `function normalizeGeoTypos` and its body (lines ~173-230)
- `const KNOWN_GEO_PHRASES = [...]` (lines ~23-39)
- `function detectKnownGeoPhrases` and its body (lines ~232-287)
- `function indicatesKabKotaDimensionFromText` (lines ~462-472)
- `function scoreDatasource` and its body (lines ~474-700)

Also delete unused helper functions that were only called by the above (e.g., if `escapeRegExp` is only used by the deleted functions, delete it too — check with grep).

The resulting file should still export `searchDatasources` and `findDatasourceCandidates` (the dropdown typeahead path is separate from intent and still uses these).

For `searchDatasources`/`findDatasourceCandidates`, simplify their body to use `rankByQuery` internally:

At the top of the file:
```js
const { rankByQuery, applyClickPrior } = require('./fulltextRanker');
```

Replace `searchDatasources` body with:
```js
async function searchDatasources({ q, limit = 10 }) {
  const candidates = await rankByQuery({ q, limit });
  const ranked = applyClickPrior(candidates);
  return ranked.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    score: c.effective_score,
  }));
}
```

Delete `findDatasourceCandidates` entirely if no remaining caller — or alias it to `rankByQuery`.

- [ ] **Step 11.4: Run dropdown test**

```bash
cd <WORKTREE>/project-data-strategis/backend && npx jest src/__tests__/datasourceSearch 2>&1 | tail -10
```

Expected: existing datasourceSearch tests pass OR fail only because they assert old scoring behavior. If they fail due to scoring assertions (e.g., `expect(score).toBe(14)`), update them to assert via FULLTEXT semantics or delete them if they're testing deleted logic.

- [ ] **Step 11.5: Run full eval suite test (dropdown path)**

```bash
cd <WORKTREE>/project-data-strategis/backend && npx jest evals/__tests__/ 2>&1 | tail -8
```

Expected: all eval unit tests still pass.

- [ ] **Step 11.6: Syntax check**

```bash
cd <WORKTREE>/project-data-strategis/backend && node -c src/services/search/datasourceSearch.service.js && node -c src/services/search/intent.service.js && echo "syntax OK"
```

Expected: `syntax OK`.

- [ ] **Step 11.7: Verify grep for hardcoded geo aliases (spec §8.6 success criterion #2)**

```bash
cd <WORKTREE>/project-data-strategis/backend && grep -rE "hal-ut|halsel|tikep|pulmor|halbar|haltim|halteng|kepsul|pultal" src/ --include="*.js" | grep -v ".backup"
```

Expected: **no output** (no hardcoded aliases remain in shipped code).

- [ ] **Step 11.8: Report LoC reduction**

```bash
wc -l <WORKTREE>/project-data-strategis/backend/src/services/search/datasourceSearch.service.js <WORKTREE>/project-data-strategis/backend/src/services/search/datasourceSearch.service.js.backup
```

Expected: new file is ~300-400 LoC vs 1110 LoC backup. Net deletion ~700+ lines. If net is smaller than 500 lines deleted, something wasn't fully removed — investigate.

- [ ] **Step 11.9: Commit**

```bash
git -C <WORKTREE> add project-data-strategis/backend/src/services/search/datasourceSearch.service.js
git -C <WORKTREE> commit -m "refactor(search): delete hand-scored ranker + hardcoded geo aliases (≈700 LoC removed)"
```

---

### Task 12: Run post-cutover baseline + one-pager (GATE 1)

**Files:**
- Create: `<WORKTREE>/project-data-strategis/docs/workspace/search-eval-baseline-2026-XX-XX.md`
- Will create: `<WORKTREE>/project-data-strategis/backend/evals/reports/eval-YYYY-MM-DD-HHMM.{json,md}`

**Why:** Spec §8.6 GATE 1 — verify `intent_det` pass rate ≥ 50% on full fixture.

- [ ] **Step 12.1: Verify backend is running latest code**

```bash
pm2 reload pds-backend --update-env
sleep 5
pm2 logs pds-backend --lines 10 --nostream 2>&1 | tail -10
```

Expected: no errors in last 10 lines; `ensureSearchFullTextIndexes` completed; entity index rebuilt.

- [ ] **Step 12.2: Verify FULLTEXT index is populated**

```bash
mysql -u root -p17Agustus project_data_strategis -e "SELECT id, MATCH(name) AGAINST('tpt malut' IN NATURAL LANGUAGE MODE) AS score FROM data_sources WHERE MATCH(name) AGAINST('tpt malut' IN NATURAL LANGUAGE MODE) ORDER BY score DESC LIMIT 5" 2>&1 | head -8
```

Expected: non-zero scores, matching TPT-related datasources at top.

- [ ] **Step 12.3: Run full eval baseline**

```bash
cd <WORKTREE>/project-data-strategis/backend && time node evals/run-eval.js --profile=search 2>&1 | tail -20
```

Expected: 45 cases complete, reports saved to `evals/reports/`.

- [ ] **Step 12.4: Inspect the numbers**

```bash
cat $(ls -t <WORKTREE>/project-data-strategis/backend/evals/reports/eval-*.md | head -1)
```

Look for:
- `intent_det` pass rate — **must be ≥ 0.50 to pass GATE 1**
- Dropdown pass rate — must be ≥ 0.73 (baseline, no regression)
- Knowledge pass rate — must be unchanged (we didn't touch knowledge)

- [ ] **Step 12.5: Write the one-pager**

Create `<WORKTREE>/project-data-strategis/docs/workspace/search-eval-baseline-post-project-2-YYYY-MM-DD.md`:

```markdown
# Post–Project 2 Eval Baseline — YYYY-MM-DD

**Report:** `backend/evals/reports/eval-YYYY-MM-DD-HHMM.json` + .md
**Fixture:** 45 labeled cases (unchanged from Project 1)
**Backend state:** post-cutover (fulltextRanker is primary; scoreDatasource deleted)

## Headline

| Stage | Pre-Project-2 | Post-Project-2 | Δ |
|---|---|---|---|
| Dropdown | 0.727 | <fill> | <fill> |
| Intent (deterministic) | 0.028 | <fill> | <fill> |
| Knowledge | 1.00 | <fill> | <fill> |
| Plan | 0.429 | <fill> | <fill> |

## GATE 1 (intent_det ≥ 0.50)

**Status:** PASS / FAIL
**intent_det pass rate:** <fill>

## GATE 2 (retire_llm_safe — bonus)

**Status:** TRUE / FALSE
**llm_wins:** <fill>
**det_wins:** <fill>
**Action:** <if TRUE: file follow-up to un-hold Task 10. If FALSE: document remaining gaps for Project 3>

## Decision

- [ ] GATE 1 passes → Project 2 ships
- [ ] GATE 1 fails → revert cutover (Task 10+11) and iterate

## Top remaining failures

<paste top 5 failing cases from report, annotate each with apparent root cause>
```

- [ ] **Step 12.6: Commit the baseline + one-pager**

```bash
git -C <WORKTREE> add \
  project-data-strategis/backend/evals/reports/ \
  project-data-strategis/docs/workspace/search-eval-baseline-post-project-2-*.md
git -C <WORKTREE> commit -m "chore(evals): post-Project-2 baseline + one-pager (GATE 1 <PASS/FAIL>)"
```

- [ ] **Step 12.7: GATE 1 decision**

If `intent_det ≥ 0.50`:
- Project 2 is done.
- If GATE 2 also passes (`retire_llm_safe === true`), file a follow-up task to un-hold Task 10 (revert the `f6ac44d` commit).

If `intent_det < 0.50`:
- Revert Tasks 10 + 11:
  ```bash
  git -C <WORKTREE> revert --no-edit HEAD~N HEAD~M  # adjust N, M to the task 10 and 11 SHAs
  ```
- File issue documenting specific failures.
- Iterate offline (likely tune entity mining or FULLTEXT query shape).
- Re-cutover when metrics justify.

---

## Post-flight verification (Definition of Done)

- [ ] **Step 13.1: All spec success criteria met**

```bash
# 1. intent_det ≥ 0.50  (from Step 12.4)
# 2. No hardcoded geo aliases  (from Step 11.7)
# 3. scoreDatasource deleted  (from Step 11.8 LoC count)
# 4. Dropdown pass rate ≥ 0.73  (from Step 12.4)
# 5. Chat Malika eval unchanged (run chat profile; compare to pre-Project-2)
cd <WORKTREE>/project-data-strategis/backend && EVAL_DELAY_MS=100 node evals/run-eval.js --profile=chat --id=greeting-01 2>&1 | tail -5
# 6. FULLTEXT query p95 < 50ms (from intent_det latency in the post-Project-2 report)
```

- [ ] **Step 13.2: Document push-to-main decision**

If GATE 1 passed on worktree, the cutover is ready for main. Invoke the `finishing-a-development-branch` skill to decide: merge directly, PR, or leave the branch for staged rollout.

---

## Self-review summary

**Spec coverage check:**
- §3 Architecture — Task 1 (schema), Tasks 2-3 (fulltextRanker), Tasks 4-6 (entityResolver), Tasks 7-9 (shadow mode), Task 10 (cutover), Task 11 (deletion), Task 12 (baseline).
- §4 Schema changes — Task 1.
- §5 Ranking algorithm — Tasks 2-3.
- §6 Intent rewire — Task 10.
- §7 Entity resolver — Tasks 4-6.
- §8 Rollout — Tasks 1-12 mapping directly to Phases 1-5.
- §8.6 Success criteria — Step 13.1.

**Placeholder scan:** `<fill>` placeholders in Step 12.5's one-pager template are intentional — the executor populates from the real report data after Step 12.4. `<WORKTREE>` is the documented placeholder for the dedicated worktree root.

**Type consistency:** `rankByQuery` signature `({ q, limit, ignoredIds })` is consistent across Tasks 2, 3, 8, 10, 11. Returns `{id, name, type, base_relevance, click_count}` — matches consumer code in 8 and 10. `applyClickPrior` adds `effective_score, click_prior`. `deriveConfidence` reads `effective_score`. Chain consistent.

**No placeholder code:** every code block is complete and runnable.
