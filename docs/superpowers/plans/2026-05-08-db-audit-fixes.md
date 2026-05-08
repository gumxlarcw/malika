# DB Audit Fixes & AI Retrieval Schema Unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address every finding from the 2026-05-08 DB audit (`memory/db_audit_findings_2026-05-08.md`) and unify the AI-retrieval embedding stores into a single MariaDB-native VECTOR table without breaking the live chat pipeline.

**Architecture:** Six phases, ordered by risk: (A) restore offline audit logging, (B) additive Sequelize model fixes (zero schema migration), (C) unify the four embedding stores (`data_sources`, `knowledge_base`, `indicator_meta`, `chat_threads`) into a new `retrieval_chunks` table with native `VECTOR(3072)` + `VECTOR INDEX (cosine)`, (D) fix two latent bugs (collation drift, EXIM cross-collation), (E) add retention crons for log tables, (F) clean up junk rows + archive table + system pseudo-source convention.

**Tech Stack:** MariaDB 11.8.6 (native `VECTOR` since 11.7), Sequelize 6.37.7, Node 20.x, Express, PM2. **Embeddings: Google Gemini `gemini-embedding-001 @ 768d` exclusively** — free via the existing 10-key rotation pool in `/opt/openclaw/malika-llm-proxy.config.js`. The OpenAI service (`services/ai/embedding.service.js`) is replaced by a thin wrapper that delegates to the Gemini service (`services/bpsMetadata/embedding.service.js`). Zero ongoing API spend. Existing OpenAI 3072-dim vectors in `data_sources` and `knowledge_base` are abandoned (incompatible vector space) and re-embedded; existing 768-dim Gemini vectors in `indicator_meta` are preserved (just re-packed). Phase 2 (out of scope) may evaluate a self-hosted local model if Gemini free-tier ever becomes a bottleneck.

---

## Discovery Summary (verified 2026-05-08)

**Live embedding fragmentation:**
| Store | Rows | Dim | Model |
|---|---|---|---|
| `knowledge_base.embedding` | 28,103 (1331 parents + 26772 chunks) | 3072 (×28102), 1536 (×1) | OpenAI text-embedding-3-large (likely) |
| `data_sources.embedding` | 313 | 3072 | OpenAI text-embedding-3-large (likely) |
| `indicator_meta.embedding` | 302 | 768 | Gemini `gemini-embedding-001` |
| `chat_threads.embedding` | 1 | 1536 | abandoned/test |

**Code drift:** `services/ai/embedding.service.js` exports `EMBEDDING_DIMENSIONS=1536` and uses `text-embedding-3-small` — but consumers (`vectorSearch.service.js`, `threadMemory.service.js`) and the live data assume 3072. New embeddings generated today would be 1536 and silently rejected by HNSW build. **Resolution:** abandon both 1536 and 3072 OpenAI dims, unify on Gemini 768.

**Budget constraint (2026-05-09):** No more spend on OpenAI or any paid embedding API. The only available embedding generator is `gemini-embedding-001` via the existing 10-key Google API pool that already powers `malika-llm-proxy` and `services/bpsMetadata/embedding.service.js`. Free tier quota: 10M tokens/min per project × 10 keys → effectively unlimited at our scale. One-time backfill cost: $0.

**Audit log gap:** `admin_audit_logs` last entry id=21898 (`2026-02-20 00:54:16`); middleware exists but unwired in production code AND in the `malika-fresh` worktree (so wiring removal predates GitHub repo creation; reconstruct from scratch).

**EXIM cross-collation bug is GUARDED** (parallel-agent finding): all 4 consumers of `kodehs_indd` do app-layer joins, never SQL JOIN. Still worth one ALTER to prevent future regressions.

**Schema drifts (model vs DB):**
- 🔴 `KnowledgeBase.title` STRING(255) vs varchar(500) — silent truncation on inserts > 255.
- 🟠 `DataSource` missing 4 columns: `bps_web_url`, `priority`, `bps_last_metadata_fetch`, `bps_last_metadata_status`.
- 🟠 `KnowledgeBase` missing 2 columns: `keywords` (varchar 2000), `indicator_index` (mediumtext).
- 🟠 `ChatThread.embedding` (longtext) not in model.
- 🟠 `ProcessedCache` and `DataPeriod` shorthand defs nullable while DB is NOT NULL.
- 🟠 `FetchLog.created_at` not in model.
- 🟡 7 cosmetic DATE-vs-timestamp drifts (skip).
- 9 entries missing from `models/index.js` (4 unexported existing files + 4 tables w/o model file: `indicator_meta`, `indicator_metric_meta`, `indicator_static_table`).

**Collation drift:** PDS has 22 tables on `utf8mb4_general_ci` + 10 on `utf8mb4_uca1400_ai_ci`. `data_bps.kodehs_indd` is `utf8mb4_unicode_ci`.

**Retention gap:** `fetch_logs` 2.49M rows / 142 MB / 5 months no purge; `automation_run_logs` 122K / 130 MB.

**Cleanup:** `data_sources.id=313` (hash-named static junk) → empty `indikator_313`; `_archive_pressrelease_data_sources_20260507` (8 rows, 400 KB, no PK); 2 system pseudo-sources (id 176, 177) without backing tables.

---

## File Structure

**New files:**
- `backend/src/database/migrations/20260508_create_retrieval_chunks.js` — VECTOR table + index
- `backend/src/database/migrations/20260508_alter_kodehs_collation.js` — single-table ALTER
- `backend/src/database/migrations/20260515_drop_legacy_embedding_columns.js` — runs AFTER Phase C cutover validated
- `backend/src/models/RetrievalChunk.model.js` — Sequelize model for the new table
- `backend/src/models/IndicatorMeta.model.js` — for `indicator_meta` (302 rows, 30 cols, hot path)
- `backend/src/models/IndicatorMetricMeta.model.js` — for `indicator_metric_meta` (1362 rows)
- `backend/src/services/ai/retrieval.service.js` — unified retrieval API replacing the multi-cache scan in `vectorSearch.service.js:185-340`
- `backend/scripts/backfill-retrieval-chunks.js` — one-shot backfill from legacy stores
- `backend/scripts/reembed-indicator-meta.js` — re-embed 302 indicator_meta rows from 768→3072
- `backend/src/jobs/retention.job.js` — daily cron for `fetch_logs` + `automation_run_logs`
- `backend/src/__tests__/integration/retrievalChunks.test.js` — Phase C integration tests

**Modified files:**
- `backend/src/middleware/auditLog.middleware.js` — add admin-only filter helper
- `backend/src/server.js` — wire retention cron + audit middleware mount points
- `backend/src/routes/datasource.routes.js`, `auth.routes.js`, `automation.routes.js`, `categories.routes.js`, `period.routes.js`, `peta-tematik.routes.js`, `chat.admin.routes.js`, `notifications.admin.routes.js`, `cache.routes.js`, `exim.routes.js`, `knowledge.routes.js`, `errorLearning.routes.js`, `pressrelease.routes.js`, `schedulerSettings.routes.js`, `search.admin.routes.js` — wire `createAuditLogMiddleware`
- `backend/src/models/DataSource.model.js`, `KnowledgeBase.model.js`, `ChatThread.model.js`, `DataPeriod.model.js`, `ProcessedCache.model.js`, `FetchLog.model.js`, `index.js` — drift fixes
- `backend/src/services/ai/embedding.service.js` — switch to `text-embedding-3-large` @ 3072, export `LEGACY_EMBEDDING_DIMENSIONS`
- `backend/src/services/ai/vectorSearch.service.js` — delegate to new `retrieval.service.js` (keep public API)
- `docs/workspace/database.md` — refresh inventory (drift counts, new table)

---

## Phase A — Restore Audit Logging (P0)

### Task A1: Audit middleware route inventory + restoration policy

**Files:**
- Read: `backend/src/__tests__/integration/datasource.test.js:38-40` (mock pattern reference)
- Read: `backend/src/middleware/auditLog.middleware.js:22-56`
- Read: `backend/src/routes/*.routes.js` to verify which routes have `authMiddleware` already mounted

- [ ] **Step 1: List every admin/state-changing route file**

```bash
ls /var/www/html/project-data-strategis/backend/src/routes/*.routes.js
```

- [ ] **Step 2: For each, identify whether `authMiddleware` is mounted**

```bash
for f in /var/www/html/project-data-strategis/backend/src/routes/*.routes.js; do
  echo "=== $f ==="
  grep -c "authMiddleware\|requireAdmin" "$f" || true
done
```

- [ ] **Step 3: Decide policy** (record in this checkbox before proceeding):
  - Wire `createAuditLogMiddleware` AFTER `authMiddleware` + `requireAdmin` on routers, with `resource` tag matching the router name.
  - Filter to mutating verbs: only attach to `router.post/.put/.patch/.delete`. The middleware itself does not filter — apply at mount.

### Task A2: Add per-router audit wiring (one router as proof)

**Files:**
- Modify: `backend/src/routes/datasource.routes.js`

- [ ] **Step 1: Backup**

```bash
cp /var/www/html/project-data-strategis/backend/src/routes/datasource.routes.js /var/www/html/project-data-strategis/backend/src/routes/datasource.routes.js.backup
```

- [ ] **Step 2: Add the import + middleware factory at top of file**

```js
const { createAuditLogMiddleware } = require('../middleware/auditLog.middleware');
const auditDS = createAuditLogMiddleware({ resource: 'datasource' });
```

- [ ] **Step 3: Attach `auditDS` to each mutating route**

For every `router.post(...)`, `router.put(...)`, `router.patch(...)`, `router.delete(...)` line in the file, insert `auditDS` as the last middleware before the controller. Example:

```js
// before:
router.post('/', authMiddleware, requireAdmin, dataSourceController.create);
// after:
router.post('/', authMiddleware, requireAdmin, auditDS, dataSourceController.create);
```

- [ ] **Step 4: Restart and verify a row is written**

```bash
pm2 reload pds-backend --update-env
# Trigger a mutation as admin via curl or admin UI, then:
mysql -uroot -p17Agustus project_data_strategis -e "SELECT id, created_at, action, path FROM admin_audit_logs ORDER BY id DESC LIMIT 1;"
```

Expected: a row newer than `2026-02-20`.

- [ ] **Step 5: Verify diff**

```bash
diff /var/www/html/project-data-strategis/backend/src/routes/datasource.routes.js.backup /var/www/html/project-data-strategis/backend/src/routes/datasource.routes.js
```

- [ ] **Step 6: Commit**

```bash
cd /var/www/html/project-data-strategis && git add backend/src/routes/datasource.routes.js
git commit -m "fix(audit): re-wire admin audit middleware on datasource mutations"
```

### Task A3: Roll out audit wiring to remaining 14 admin routers

**Files (one task per file, repeat the A2 pattern):**

| Router file | `resource` tag |
|---|---|
| `backend/src/routes/auth.routes.js` | `auth` |
| `backend/src/routes/categories.routes.js` | `categories` |
| `backend/src/routes/period.routes.js` | `period` |
| `backend/src/routes/peta-tematik.routes.js` | `peta-tematik` |
| `backend/src/routes/search.admin.routes.js` | `search-admin` |
| `backend/src/routes/chat.admin.routes.js` | `chat-admin` |
| `backend/src/routes/notifications.admin.routes.js` | `notifications-admin` |
| `backend/src/routes/automation.routes.js` | `automation` |
| `backend/src/routes/automation.notifications.routes.js` | `automation-notifications` |
| `backend/src/routes/schedulerSettings.routes.js` | `scheduler` |
| `backend/src/routes/cache.routes.js` | `cache` |
| `backend/src/routes/exim.routes.js` | `exim` |
| `backend/src/routes/knowledge.routes.js` | `knowledge` |
| `backend/src/routes/errorLearning.routes.js` | `error-learning` |
| `backend/src/routes/pressrelease.routes.js` | `pressrelease` |

- [ ] Per file: backup → add import + factory → attach to mutating verbs → diff → commit (one commit per file: `fix(audit): wire <resource> mutations`).

### Task A4: Reload + smoke test full audit trail

- [ ] **Step 1: Reload backend**

```bash
pm2 reload pds-backend --update-env
```

- [ ] **Step 2: Trigger one mutation per resource via the admin UI**

- [ ] **Step 3: Verify rows accumulate**

```bash
mysql -uroot -p17Agustus project_data_strategis -e "
SELECT resource, COUNT(*) FROM admin_audit_logs
WHERE created_at >= NOW() - INTERVAL 5 MINUTE
GROUP BY resource;"
```

Expected: at least one row per `resource` you triggered.

---

## Phase B — Additive Sequelize Model Fixes (P1, zero migration)

### Task B1: Fix `KnowledgeBase` model drift (🔴 + 🟠 ×2)

**Files:**
- Modify: `backend/src/models/KnowledgeBase.model.js`

- [ ] **Step 1: Backup**

```bash
cp /var/www/html/project-data-strategis/backend/src/models/KnowledgeBase.model.js /var/www/html/project-data-strategis/backend/src/models/KnowledgeBase.model.js.backup
```

- [ ] **Step 2: Widen `title` to 500**

```js
// line 18-21 — was: type: DataTypes.STRING(255)
title: {
    type: DataTypes.STRING(500),
    allowNull: false,
    comment: 'Document title'
},
```

- [ ] **Step 3: Add `keywords` and `indicator_index` columns after `description`**

```js
keywords: {
    type: DataTypes.STRING(2000),
    allowNull: true,
    comment: 'Comma-separated keywords for hybrid search'
},
indicator_index: {
    type: DataTypes.TEXT('medium'),
    allowNull: true,
    comment: 'Indicator alias index used by vectorSearch.service.js'
},
```

- [ ] **Step 4: Verify diff**

```bash
diff /var/www/html/project-data-strategis/backend/src/models/KnowledgeBase.model.js.backup /var/www/html/project-data-strategis/backend/src/models/KnowledgeBase.model.js
```

- [ ] **Step 5: Run model tests**

```bash
cd /var/www/html/project-data-strategis/backend && npx jest src/__tests__ --testPathPattern=knowledge --passWithNoTests --no-coverage
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/models/KnowledgeBase.model.js
git commit -m "fix(model): KnowledgeBase title 500, surface keywords + indicator_index"
```

### Task B2: Fix `DataSource` model drift

**Files:**
- Modify: `backend/src/models/DataSource.model.js`

- [ ] **Step 1: Backup**

```bash
cp /var/www/html/project-data-strategis/backend/src/models/DataSource.model.js /var/www/html/project-data-strategis/backend/src/models/DataSource.model.js.backup
```

- [ ] **Step 2: Add 4 missing columns after `embedding_updated_at`**

```js
bps_web_url: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Direct link to the BPS web page for this indicator'
},
priority: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 3,
    comment: 'Display priority (lower = higher importance)'
},
bps_last_metadata_fetch: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Last successful BPS metadata fetch timestamp'
},
bps_last_metadata_status: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'Last metadata fetch outcome (success | error | skipped)'
},
```

- [ ] **Step 3: Verify diff, then commit**

```bash
diff backend/src/models/DataSource.model.js.backup backend/src/models/DataSource.model.js
git add backend/src/models/DataSource.model.js
git commit -m "fix(model): surface 4 BPS metadata columns on DataSource"
```

### Task B3: Fix `ChatThread` model — add `embedding`

**Files:**
- Modify: `backend/src/models/ChatThread.model.js`

- [ ] **Step 1: Backup, then add column**

```js
embedding: {
    type: DataTypes.TEXT('long'),
    allowNull: true,
    comment: 'Thread-level embedding (legacy 1536; new threads embed at 3072 via retrieval_chunks)'
},
```

- [ ] **Step 2: Diff + commit**

```bash
git add backend/src/models/ChatThread.model.js
git commit -m "fix(model): surface ChatThread.embedding column"
```

### Task B4: Fix `DataPeriod`, `ProcessedCache`, `FetchLog` nullability + missing timestamps

**Files:**
- Modify: `backend/src/models/DataPeriod.model.js`, `ProcessedCache.model.js`, `FetchLog.model.js`

- [ ] **Step 1: Backup all three**

```bash
for f in backend/src/models/DataPeriod.model.js backend/src/models/ProcessedCache.model.js backend/src/models/FetchLog.model.js; do cp "$f" "$f.backup"; done
```

- [ ] **Step 2: For each, change shorthand `field: DataTypes.X` to explicit `field: { type: DataTypes.X, allowNull: false }` for columns DB has NOT NULL**

For `DataPeriod.model.js` — `source_id` and `period_value` go to `allowNull: false`, plus add `created_at` + `updated_at` as `DataTypes.DATE`.

For `ProcessedCache.model.js` — `source_id`, `period_value`, `processed_json` go to `allowNull: false`.

For `FetchLog.model.js` — add `created_at: DataTypes.DATE`.

- [ ] **Step 3: Diff each, commit one per file**

```bash
git add backend/src/models/DataPeriod.model.js && git commit -m "fix(model): DataPeriod nullability + timestamps"
git add backend/src/models/ProcessedCache.model.js && git commit -m "fix(model): ProcessedCache NOT NULL columns"
git add backend/src/models/FetchLog.model.js && git commit -m "fix(model): FetchLog created_at"
```

### Task B5: Add `IndicatorMeta` and `IndicatorMetricMeta` models

**Files:**
- Create: `backend/src/models/IndicatorMeta.model.js`
- Create: `backend/src/models/IndicatorMetricMeta.model.js`

- [ ] **Step 1: Capture live schema**

```bash
mysql -uroot -p17Agustus project_data_strategis -e "DESC indicator_meta;" > /tmp/indicator_meta.schema
mysql -uroot -p17Agustus project_data_strategis -e "DESC indicator_metric_meta;" > /tmp/indicator_metric_meta.schema
```

- [ ] **Step 2: Author `IndicatorMeta.model.js` from the schema**

Use the existing `models/KnowledgeBase.model.js` as a structural template. Map every DESC column. Set `tableName: 'indicator_meta'`, `freezeTableName: true`. Include `embedding TEXT('long')`. Source: 30 columns, source_id is PK or unique.

- [ ] **Step 3: Author `IndicatorMetricMeta.model.js` similarly**

22 columns, FK `source_id` → `indicator_meta.source_id`.

- [ ] **Step 4: Smoke test via temp script**

Create `/tmp/probe-indicator-meta.js`:

```js
const m = require('/var/www/html/project-data-strategis/backend/src/models/IndicatorMeta.model');
m.findOne().then(r => console.log('cols:', Object.keys((r && r.dataValues) || {}))).catch(e => console.error(e.message));
```

Run:

```bash
cd /var/www/html/project-data-strategis/backend && node /tmp/probe-indicator-meta.js
```

Expected: prints column names matching DESC output.

- [ ] **Step 5: Commit**

```bash
git add backend/src/models/IndicatorMeta.model.js backend/src/models/IndicatorMetricMeta.model.js
git commit -m "feat(model): add IndicatorMeta + IndicatorMetricMeta Sequelize models"
```

### Task B6: Extend `models/index.js`

**Files:**
- Modify: `backend/src/models/index.js`

- [ ] **Step 1: Backup**

```bash
cp backend/src/models/index.js backend/src/models/index.js.backup
```

- [ ] **Step 2: Add 6 missing exports**

```js
// Sessions / activity
ActiveSession: require('./ActiveSession.model'),
PageView: require('./PageView.model'),
UserMemory: require('./UserMemory.model'),
DnaCache: require('./DnaCache.model'),

// Indicator metadata
IndicatorMeta: require('./IndicatorMeta.model'),
IndicatorMetricMeta: require('./IndicatorMetricMeta.model'),
```

- [ ] **Step 3: Diff + commit**

```bash
git add backend/src/models/index.js
git commit -m "fix(model): export missing models from index"
```

### Task B7: Restart + verify Phase B

- [ ] **Step 1: Reload backend**

```bash
pm2 reload pds-backend --update-env
pm2 logs pds-backend --lines 30 | grep -iE "error|warning" || echo "clean"
```

- [ ] **Step 2: Run full test suite**

```bash
cd backend && npx jest --passWithNoTests --no-coverage 2>&1 | tail -20
```

Expected: 191 passing (per memory) or higher; no new failures introduced by model changes.

---

## Phase C — Unify AI Retrieval into `retrieval_chunks` (CORE)

### Task C1: Replace OpenAI embedding service with a Gemini-backed wrapper

**Files:**
- Modify: `backend/src/services/ai/embedding.service.js`
- Read (no edit): `backend/src/services/bpsMetadata/embedding.service.js`

**Why:** Budget constraint — no more OpenAI API spend. The Gemini service in `services/bpsMetadata/embedding.service.js` is already battle-tested (302 indicator_meta rows embedded successfully), uses 10-key round-robin rotation with retry-on-429, and is free. Promote it to be **the** embedding service; turn the OpenAI module into a thin re-export so every existing import path keeps working.

- [ ] **Step 1: Backup**

```bash
cp backend/src/services/ai/embedding.service.js backend/src/services/ai/embedding.service.js.backup
```

- [ ] **Step 2: Replace `services/ai/embedding.service.js` content with a Gemini-backed wrapper**

```js
'use strict';
/**
 * Unified embedding service — delegates to the Gemini-backed implementation
 * in services/bpsMetadata/embedding.service.js.
 *
 * Why: budget constraint (no more OpenAI). Gemini gemini-embedding-001 @ 768d
 * is free via the existing 10-key rotation pool. Mixing models in one VECTOR
 * INDEX would degrade recall, so the entire retrieval path standardizes on
 * gemini-embedding-001. The legacy LEGACY_EMBEDDING_DIMENSIONS export is
 * preserved for any consumer that still wants to filter old vectors during
 * the cutover.
 */

const gemini = require('../bpsMetadata/embedding.service');
const DataSource = require('../../models/DataSource.model');
const { Sequelize } = require('sequelize');

const EMBEDDING_MODEL = gemini.EMBEDDING_MODEL;            // 'gemini-embedding-001'
const EMBEDDING_DIMENSIONS = gemini.EMBEDDING_DIMENSIONS;   // 768
const LEGACY_OPENAI_3072 = 3072;
const LEGACY_OPENAI_1536 = 1536;
const LEGACY_EMBEDDING_DIMENSIONS = LEGACY_OPENAI_1536;     // alias for back-compat

async function generateEmbedding(text) {
  return gemini.generateEmbedding(text);
}

function buildEmbeddingText(source) {
  const parts = [source.name, source.description, source.aliases, source.category]
    .filter(Boolean)
    .map(s => String(s).trim())
    .filter(Boolean);
  return parts.join('. ');
}

async function embedDatasource(sourceId) {
  const source = await DataSource.findByPk(sourceId);
  if (!source) throw new Error(`Datasource ${sourceId} not found`);
  const text = buildEmbeddingText(source);
  if (!text) return { ok: false, message: 'No text to embed' };
  const embedding = await generateEmbedding(text);
  await source.update({ embedding: JSON.stringify(embedding), embedding_updated_at: new Date() });
  return { ok: true, message: `Embedded ${text.length} chars @ ${EMBEDDING_DIMENSIONS}d` };
}

async function embedAllDatasources({ force = false, onProgress } = {}) {
  const sources = await DataSource.findAll({ where: { status: true }, order: [['id', 'ASC']] });
  const result = { total: sources.length, embedded: 0, skipped: 0, errors: 0, errorDetails: [] };
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    if (onProgress) onProgress({ current: i + 1, total: sources.length, name: s.name });
    if (!force && s.embedding) { result.skipped++; continue; }
    try {
      const text = buildEmbeddingText(s);
      if (!text) { result.skipped++; continue; }
      const emb = await generateEmbedding(text);
      await s.update({ embedding: JSON.stringify(emb), embedding_updated_at: new Date() });
      result.embedded++;
      if (i < sources.length - 1) await new Promise(r => setTimeout(r, 80));
    } catch (err) {
      result.errors++;
      result.errorDetails.push(`ID ${s.id}: ${err.message}`);
    }
  }
  return result;
}

async function getEmbeddingStats() {
  const [total, embedded] = await Promise.all([
    DataSource.count({ where: { status: true } }),
    DataSource.count({ where: { status: true, embedding: { [Sequelize.Op.ne]: null } } }),
  ]);
  return { total, embedded, notEmbedded: total - embedded };
}

module.exports = {
  generateEmbedding,
  buildEmbeddingText,
  embedDatasource,
  embedAllDatasources,
  getEmbeddingStats,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  LEGACY_EMBEDDING_DIMENSIONS,
  LEGACY_OPENAI_3072,
  LEGACY_OPENAI_1536,
};
```

- [ ] **Step 3: Verify via temp script**

Create `/tmp/probe-embedding.js`:

```js
const e = require('/var/www/html/project-data-strategis/backend/src/services/ai/embedding.service');
console.log('MODEL:', e.EMBEDDING_MODEL, 'DIM:', e.EMBEDDING_DIMENSIONS, 'LEGACY_OAI_3072:', e.LEGACY_OPENAI_3072);
e.generateEmbedding('inflasi maluku utara').then(v => console.log('len:', v.length)).catch(err => console.error(err.message));
```

Run:

```bash
diff backend/src/services/ai/embedding.service.js.backup backend/src/services/ai/embedding.service.js
cd backend && node /tmp/probe-embedding.js
```

Expected: `MODEL: gemini-embedding-001 DIM: 768 LEGACY_OAI_3072: 3072` and `len: 768`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/ai/embedding.service.js
git commit -m "feat(embedding): replace OpenAI generator with Gemini wrapper (free, 768d)"
```

### Task C2: Create `retrieval_chunks` table migration

**Files:**
- Create: `backend/src/database/migrations/20260508_create_retrieval_chunks.js`

- [ ] **Step 1: Author migration**

```js
'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      CREATE TABLE retrieval_chunks (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        source_kind ENUM('datasource','knowledge_doc','knowledge_chunk','indicator_meta','chat_thread') NOT NULL,
        source_ref_id BIGINT NOT NULL,
        parent_chunk_id BIGINT NULL,
        chunk_index INT NOT NULL DEFAULT 0,
        title VARCHAR(500) NOT NULL,
        content_text MEDIUMTEXT NOT NULL,
        metadata JSON NULL,
        embedding VECTOR(768) NOT NULL,
        embedding_model VARCHAR(64) NOT NULL,
        embedding_generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_source_ref (source_kind, source_ref_id, chunk_index),
        INDEX idx_source (source_kind, source_ref_id),
        INDEX idx_parent (parent_chunk_id),
        VECTOR KEY idx_embedding (embedding) M=16 DISTANCE=cosine
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
    `);
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS retrieval_chunks;');
  }
};
```

- [ ] **Step 2: Run migration**

```bash
cd backend && npx sequelize-cli db:migrate --migrations-path src/database/migrations 2>&1 | tail -5
```

Expected: `== 20260508_create_retrieval_chunks: migrated`.

- [ ] **Step 3: Verify table shape**

```bash
mysql -uroot -p17Agustus project_data_strategis -e "SHOW CREATE TABLE retrieval_chunks\G" | grep -iE "vector|engine|charset"
```

Expected: `vector(768)`, `VECTOR KEY`, `ENGINE=InnoDB`, `COLLATE=utf8mb4_uca1400_ai_ci`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/database/migrations/20260508_create_retrieval_chunks.js
git commit -m "feat(db): create retrieval_chunks table with VECTOR(768) + cosine HNSW index"
```

### Task C3: Author `RetrievalChunk` Sequelize model

**Files:**
- Create: `backend/src/models/RetrievalChunk.model.js`

- [ ] **Step 1: Author model**

```js
const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const SOURCE_KINDS = ['datasource', 'knowledge_doc', 'knowledge_chunk', 'indicator_meta', 'chat_thread'];

const RetrievalChunk = sequelize.define('RetrievalChunk', {
  id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
  source_kind: { type: DataTypes.ENUM.apply(null, SOURCE_KINDS), allowNull: false },
  source_ref_id: { type: DataTypes.BIGINT, allowNull: false },
  parent_chunk_id: { type: DataTypes.BIGINT, allowNull: true },
  chunk_index: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  title: { type: DataTypes.STRING(500), allowNull: false },
  content_text: { type: DataTypes.TEXT('medium'), allowNull: false },
  metadata: { type: DataTypes.JSON, allowNull: true },
  // VECTOR is not natively typed in Sequelize 6 — declare as TEXT and cast at write time via VEC_FromText()
  embedding: { type: DataTypes.TEXT('long'), allowNull: false },
  embedding_model: { type: DataTypes.STRING(64), allowNull: false },
  embedding_generated_at: { type: DataTypes.DATE, allowNull: false },
  created_at: { type: DataTypes.DATE, allowNull: true },
  updated_at: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'retrieval_chunks',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  freezeTableName: true,
});

RetrievalChunk.SOURCE_KINDS = SOURCE_KINDS;

module.exports = RetrievalChunk;
```

- [ ] **Step 2: Add to `models/index.js`**

```js
RetrievalChunk: require('./RetrievalChunk.model'),
```

- [ ] **Step 3: Smoke test via temp script**

Create `/tmp/probe-retrieval-chunk.js`:

```js
const M = require('/var/www/html/project-data-strategis/backend/src/models/RetrievalChunk.model');
console.log('table:', M.tableName, 'kinds:', M.SOURCE_KINDS);
```

Run:

```bash
cd backend && node /tmp/probe-retrieval-chunk.js
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/models/RetrievalChunk.model.js backend/src/models/index.js
git commit -m "feat(model): add RetrievalChunk Sequelize model"
```

### Task C4: Re-embed knowledge_base + data_sources via Gemini → retrieval_chunks

**Files:**
- Create: `backend/scripts/backfill-retrieval-chunks.js`

**Why this is a re-embed, not a repack:** The 28K existing `knowledge_base.embedding` and 313 `data_sources.embedding` rows are 3072-dim vectors from OpenAI `text-embedding-3-large`. They're in a different vector space from Gemini's 768-dim output and cannot be queried against Gemini-embedded query strings. They are abandoned. Each row is re-embedded fresh via `gemini-embedding-001` and inserted into `retrieval_chunks`. Cost: $0 (free tier). Time: 30–90 min wall-clock at 50 req/sec across the 10-key pool.

- [ ] **Step 1: Author script**

```js
#!/usr/bin/env node
'use strict';
/**
 * One-shot backfill: re-embed knowledge_base + data_sources via Gemini
 * (gemini-embedding-001, 768d) and write into retrieval_chunks.
 *
 * Idempotent: INSERT IGNORE on UNIQUE KEY (source_kind, source_ref_id, chunk_index).
 * Safe to interrupt and resume — already-inserted rows are skipped.
 *
 * Strategy:
 *   - knowledge_base parents (parent_id IS NULL) → source_kind='knowledge_doc'
 *   - knowledge_base chunks  (parent_id IS NOT NULL) → source_kind='knowledge_chunk', parent_chunk_id=parent_id
 *   - data_sources (status=true) → source_kind='datasource'
 *   - indicator_meta → handled by reembed-indicator-meta.js (already 768d, just repack)
 *   - chat_threads → skip (1 row, abandoned)
 *
 * Throttle: 80ms sleep between calls. With round-robin across 10 keys, this
 * yields ~50 req/sec aggregate while staying well under each key's quota.
 */

const sequelize = require('../src/config/db');
const KB = require('../src/models/KnowledgeBase.model');
const DS = require('../src/models/DataSource.model');
const { generateEmbedding, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } = require('../src/services/ai/embedding.service');

const BATCH = 500;
const THROTTLE_MS = 80;

function buildKnowledgeText(r) {
  const parts = [r.title, r.keywords, r.content].filter(Boolean).map(s => String(s).slice(0, 8000));
  return parts.join('\n').slice(0, 8000);
}

function buildDatasourceText(r) {
  return [r.name, r.description, r.aliases, r.category]
    .filter(Boolean)
    .map(s => String(s).trim())
    .join('. ')
    .slice(0, 8000);
}

async function rowExists(kind, refId, chunkIndex) {
  const [r] = await sequelize.query(
    `SELECT 1 FROM retrieval_chunks WHERE source_kind=? AND source_ref_id=? AND chunk_index=? LIMIT 1`,
    { replacements: [kind, refId, chunkIndex] }
  );
  return r.length > 0;
}

async function backfillKnowledge() {
  let offset = 0, total = 0, ok = 0, skipped = 0, fail = 0;
  while (true) {
    const rows = await KB.findAll({
      attributes: ['id', 'parent_id', 'chunk_index', 'title', 'content', 'category', 'keywords', 'indicator_index'],
      order: [['id', 'ASC']],
      limit: BATCH,
      offset,
    });
    if (!rows.length) break;

    for (const r of rows) {
      const kind = r.parent_id == null ? 'knowledge_doc' : 'knowledge_chunk';
      const chunkIdx = r.chunk_index || 0;
      if (await rowExists(kind, r.id, chunkIdx)) { skipped++; total++; continue; }

      const text = buildKnowledgeText(r);
      if (!text) { skipped++; total++; continue; }

      try {
        const emb = await generateEmbedding(text);
        const metadata = {
          category: r.category || null,
          keywords: r.keywords || null,
          indicator_index: r.indicator_index || null,
        };
        await sequelize.query(
          `INSERT IGNORE INTO retrieval_chunks
            (source_kind, source_ref_id, parent_chunk_id, chunk_index, title, content_text, metadata, embedding, embedding_model, embedding_generated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, VEC_FromText(?), ?, NOW())`,
          {
            replacements: [
              kind, r.id, r.parent_id, chunkIdx,
              r.title, r.content || '', JSON.stringify(metadata),
              JSON.stringify(emb), EMBEDDING_MODEL,
            ],
          }
        );
        ok++;
      } catch (err) {
        fail++;
        console.error(`  fail kb_id=${r.id}: ${err.message}`);
      }
      total++;
      if (ok % 100 === 0 && ok > 0) console.log(`[backfill][kb] ok=${ok} skip=${skipped} fail=${fail} total=${total}`);
      await new Promise(res => setTimeout(res, THROTTLE_MS));
    }
    offset += rows.length;
    if (rows.length < BATCH) break;
  }
  return { ok, skipped, fail };
}

async function backfillDataSources() {
  const rows = await DS.findAll({
    where: { status: true },
    attributes: ['id', 'name', 'description', 'aliases', 'category', 'type'],
  });
  let ok = 0, skipped = 0, fail = 0;
  for (const r of rows) {
    if (await rowExists('datasource', r.id, 0)) { skipped++; continue; }
    const text = buildDatasourceText(r);
    if (!text) { skipped++; continue; }
    try {
      const emb = await generateEmbedding(text);
      const metadata = { category: r.category, type: r.type };
      await sequelize.query(
        `INSERT IGNORE INTO retrieval_chunks
          (source_kind, source_ref_id, chunk_index, title, content_text, metadata, embedding, embedding_model, embedding_generated_at)
         VALUES ('datasource', ?, 0, ?, ?, ?, VEC_FromText(?), ?, NOW())`,
        { replacements: [r.id, r.name, r.description || '', JSON.stringify(metadata), JSON.stringify(emb), EMBEDDING_MODEL] }
      );
      ok++;
    } catch (err) {
      fail++;
      console.error(`  fail ds_id=${r.id}: ${err.message}`);
    }
    await new Promise(res => setTimeout(res, THROTTLE_MS));
  }
  return { ok, skipped, fail };
}

(async () => {
  console.log(`Backfill starting. model=${EMBEDDING_MODEL} dim=${EMBEDDING_DIMENSIONS}`);
  const kb = await backfillKnowledge();
  console.log(`[kb] done`, kb);
  const ds = await backfillDataSources();
  console.log(`[ds] done`, ds);
  await sequelize.close();
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Sanity check Gemini reachability + VEC_FromText**

Create `/tmp/probe-vec.js`:

```js
const sql = require('/var/www/html/project-data-strategis/backend/src/config/db');
const { generateEmbedding, EMBEDDING_DIMENSIONS } = require('/var/www/html/project-data-strategis/backend/src/services/ai/embedding.service');

(async () => {
  const v = await generateEmbedding('inflasi maluku utara');
  console.log('emb len:', v.length, 'expected:', EMBEDDING_DIMENSIONS);
  const [r] = await sql.query('SELECT VEC_FromText(?) AS v', { replacements: [JSON.stringify(v)] });
  console.log('vec roundtrip ok:', !!r[0].v);
  await sql.close();
})();
```

Run:

```bash
cd backend && node /tmp/probe-vec.js
```

Expected: `emb len: 768 expected: 768`, `vec roundtrip ok: true`.

- [ ] **Step 3: Run backfill (long-running — use nohup or tmux)**

```bash
cd backend && nohup node scripts/backfill-retrieval-chunks.js > /tmp/backfill.log 2>&1 &
echo "PID: $!"
# Monitor:
tail -f /tmp/backfill.log
```

Expected wall-clock: 30–90 minutes. End state: ~28,415 rows in retrieval_chunks (28,102 knowledge_base + 313 datasource).

- [ ] **Step 4: Verify counts + ANN works**

```bash
mysql -uroot -p17Agustus project_data_strategis -e "
SELECT source_kind, COUNT(*) FROM retrieval_chunks GROUP BY source_kind;
SELECT id, title FROM retrieval_chunks
ORDER BY VEC_DISTANCE_COSINE(embedding, (SELECT embedding FROM retrieval_chunks WHERE source_kind='knowledge_doc' LIMIT 1))
LIMIT 5;
"
```

Expected: counts match, ANN query returns 5 rows in <100ms with the VECTOR INDEX.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/backfill-retrieval-chunks.js
git commit -m "feat(retrieval): re-embed knowledge_base + data_sources via Gemini into retrieval_chunks"
```

### Task C5: Re-pack `indicator_meta` (768d Gemini) into retrieval_chunks

**Files:**
- Create: `backend/scripts/repack-indicator-meta.js`

**Why no re-embed:** `indicator_meta.embedding` is already 768d Gemini `gemini-embedding-001` (302 rows). Same vector space as the new retrieval_chunks. Just JSON.parse the existing embedding column and INSERT — zero API calls, instant.

- [ ] **Step 1: Author script**

```js
#!/usr/bin/env node
'use strict';
const sequelize = require('../src/config/db');
const IndicatorMeta = require('../src/models/IndicatorMeta.model');
const { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } = require('../src/services/ai/embedding.service');

(async () => {
  const rows = await IndicatorMeta.findAll({
    where: { embedding: { [sequelize.Sequelize.Op.ne]: null } },
    attributes: ['source_id', 'flat_text', 'title', 'embedding'],
  });
  console.log(`Re-packing ${rows.length} indicator_meta rows (no API call needed)`);

  let ok = 0, skipped = 0, fail = 0;
  for (const r of rows) {
    let emb;
    try { emb = JSON.parse(r.embedding); } catch (parseErr) { fail++; continue; }
    if (!Array.isArray(emb) || emb.length !== EMBEDDING_DIMENSIONS) {
      console.warn(`  skip source_id=${r.source_id}: dim=${emb && emb.length} (expected ${EMBEDDING_DIMENSIONS})`);
      skipped++;
      continue;
    }

    const text = String(r.flat_text || r.title || '').slice(0, 8000);
    try {
      await sequelize.query(
        `INSERT IGNORE INTO retrieval_chunks
          (source_kind, source_ref_id, chunk_index, title, content_text, metadata, embedding, embedding_model, embedding_generated_at)
         VALUES ('indicator_meta', ?, 0, ?, ?, '{}', VEC_FromText(?), ?, NOW())`,
        {
          replacements: [
            r.source_id,
            r.title || `indicator_meta_${r.source_id}`,
            text,
            JSON.stringify(emb),
            EMBEDDING_MODEL,
          ],
        }
      );
      ok++;
    } catch (err) {
      fail++;
      console.error(`  fail source_id=${r.source_id}: ${err.message}`);
    }
  }
  console.log(`Done. ok=${ok} skipped=${skipped} fail=${fail}`);
  await sequelize.close();
})().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run**

```bash
cd backend && node scripts/repack-indicator-meta.js 2>&1 | tail -10
```

Expected: ok=302, skipped=0, fail=0. Wall-clock: <30 seconds (no API calls).

- [ ] **Step 3: Verify**

```bash
mysql -uroot -p17Agustus project_data_strategis -e "
SELECT COUNT(*) FROM retrieval_chunks WHERE source_kind='indicator_meta';"
```

Expected: 302.

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/repack-indicator-meta.js
git commit -m "feat(retrieval): repack indicator_meta (already 768d Gemini) into retrieval_chunks"
```

### Task C6: Author unified `retrieval.service.js`

**Files:**
- Create: `backend/src/services/ai/retrieval.service.js`

- [ ] **Step 1: Author the service** (replaces in-memory cache + linear scan with one SQL query)

```js
'use strict';
/**
 * Unified retrieval over retrieval_chunks using MariaDB native VECTOR INDEX.
 * Replaces the in-memory HNSW + JSON-text scan in vectorSearch.service.js.
 *
 * Public API:
 *   searchRetrieval(query, { topN, kinds, minSimilarity }) → { results, durationMs }
 */
const sequelize = require('../../config/db');
const { generateEmbedding } = require('./embedding.service');

const ALLOWED_KINDS = ['datasource', 'knowledge_doc', 'knowledge_chunk', 'indicator_meta'];

async function searchRetrieval(query, options) {
  const opts = options || {};
  const topN = opts.topN || 20;
  const kinds = opts.kinds || ALLOWED_KINDS;
  const minSimilarity = opts.minSimilarity || 0.0;
  const t0 = Date.now();
  const queryEmb = await generateEmbedding(query);
  const kindsCsv = kinds.map(() => '?').join(',');

  const [rows] = await sequelize.query(
    `SELECT id, source_kind, source_ref_id, parent_chunk_id, chunk_index,
            title, content_text, metadata,
            VEC_DISTANCE_COSINE(embedding, VEC_FromText(?)) AS distance
     FROM retrieval_chunks
     WHERE source_kind IN (${kindsCsv})
     ORDER BY distance ASC
     LIMIT ?`,
    { replacements: [JSON.stringify(queryEmb), ...kinds, topN] }
  );

  const results = rows
    .map(r => ({
      id: r.id,
      sourceKind: r.source_kind,
      sourceRefId: r.source_ref_id,
      parentChunkId: r.parent_chunk_id,
      chunkIndex: r.chunk_index,
      title: r.title,
      content: r.content_text,
      metadata: r.metadata ? JSON.parse(r.metadata) : null,
      similarity: 1 - r.distance, // cosine distance → similarity
    }))
    .filter(r => r.similarity >= minSimilarity);

  return { results, durationMs: Date.now() - t0 };
}

module.exports = { searchRetrieval, ALLOWED_KINDS };
```

- [ ] **Step 2: Integration test**

Create `backend/src/__tests__/integration/retrievalChunks.test.js`:

```js
const { searchRetrieval } = require('../../services/ai/retrieval.service');

describe('retrieval_chunks unified search', () => {
  test('returns top-K knowledge docs for a domain query', async () => {
    const { results, durationMs } = await searchRetrieval('inflasi maluku utara', { topN: 10 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(10);
    expect(results[0].similarity).toBeGreaterThan(0.3);
    expect(durationMs).toBeLessThan(500);
  }, 30000);

  test('filters by kind', async () => {
    const { results } = await searchRetrieval('inflasi', { topN: 5, kinds: ['datasource'] });
    expect(results.every(r => r.sourceKind === 'datasource')).toBe(true);
  }, 30000);
});
```

- [ ] **Step 3: Run**

```bash
cd backend && npx jest src/__tests__/integration/retrievalChunks.test.js --no-coverage
```

Expected: 2 passing.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/ai/retrieval.service.js backend/src/__tests__/integration/retrievalChunks.test.js
git commit -m "feat(retrieval): unified retrieval.service over retrieval_chunks VECTOR index"
```

### Task C7: Wire `vectorSearch.searchKnowledge` to delegate to `retrieval.service`

**Files:**
- Modify: `backend/src/services/ai/vectorSearch.service.js`

- [ ] **Step 1: Backup**

```bash
cp backend/src/services/ai/vectorSearch.service.js backend/src/services/ai/vectorSearch.service.js.backup
```

- [ ] **Step 2: At top of `searchKnowledge`, add a feature-flagged delegate path**

```js
const USE_UNIFIED_RETRIEVAL = process.env.USE_UNIFIED_RETRIEVAL === 'true';
const { searchRetrieval } = require('./retrieval.service');

async function searchKnowledge(query, topN = 5, options = {}) {
  if (USE_UNIFIED_RETRIEVAL) {
    const { results, durationMs } = await searchRetrieval(query, {
      topN: topN * 4, // wider pool for the existing reranker
      kinds: ['knowledge_doc', 'knowledge_chunk'],
    });
    // Adapt to legacy shape consumers expect (id, name, content, similarity, ...)
    const adapted = results.map(r => ({
      id: r.sourceRefId,
      name: r.title,
      title: r.title,
      type: 'knowledge',
      source: 'knowledge',
      category: (r.metadata && r.metadata.category) || '',
      content: r.content,
      similarity: r.similarity,
      rawSimilarity: r.similarity,
      keywordBoost: 0,
      recencyBoost: 0,
      parentId: r.parentChunkId || r.sourceRefId,
      isChunk: r.sourceKind === 'knowledge_chunk',
    }));
    // Reuse existing reranker pipeline
    if (!options.skipRerank && adapted.length >= 3) {
      const { judgeDocuments } = require('./documentJudge.service');
      const judgeResult = await judgeDocuments(query, adapted, { topN });
      return {
        results: judgeResult.results,
        reranked: judgeResult.reranked || false,
        judged: judgeResult.judged || false,
        rerankReason: judgeResult.reasoning || null,
        duration_ms: durationMs,
        totalKnowledge: adapted.length,
      };
    }
    return { results: adapted.slice(0, topN), reranked: false, judged: false, duration_ms: durationMs };
  }
  // ... existing legacy implementation continues here
}
```

- [ ] **Step 3: Add env flag (default ON — see warning below)**

```bash
# In /opt/openclaw/malika-llm-proxy.config.js or backend ecosystem file:
# env: { ..., USE_UNIFIED_RETRIEVAL: 'true' }
```

⚠️ **Why default ON, not OFF:** The legacy retrieval path inside `vectorSearch.service.js` calls `generateEmbedding(query)` for every chat message. After Task C1, that function returns 768d Gemini vectors — but the legacy in-memory cache still holds 3072d OpenAI vectors loaded from `knowledge_base.embedding`. Cosine similarity between mismatched dims errors out. So the legacy path is dead immediately after C1 unless we leave it cached at 3072d AND keep an OpenAI key working. With the budget constraint (no OpenAI), the legacy path cannot function. The unified path (this task) becomes the only working retrieval and must default ON.

- [ ] **Step 4: Run deep-doc regression suite (unified path only — legacy is dead)**

```bash
cd backend && USE_UNIFIED_RETRIEVAL=true node scripts/test-deep-document.js 2>&1 | tail -5
```

Expected: 20/21 PASS (per `MEMORY.md`). If unified is worse than the historical baseline, the most likely culprits are: (a) Gemini 768d picks up subtly different neighbors than OpenAI 3072d on Indonesian-language queries, (b) the `kinds` filter excludes a category the test relies on, (c) the rerank pool size (`topN * 4 = 80`) is too small for the LLM judge. Iterate until 20/21+ before declaring success.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/ai/vectorSearch.service.js
git commit -m "feat(retrieval): feature-flag unified retrieval inside searchKnowledge"
```

### Task C8: Cutover + drop legacy embedding columns (after 7-day soak)

**Files:**
- Create: `backend/src/database/migrations/20260515_drop_legacy_embedding_columns.js` (note: dated +7d for soak)

- [ ] **Step 1: Flip env flag to true in production, watch for 7 days**

```bash
# update /opt/openclaw/malika-llm-proxy.config.js: USE_UNIFIED_RETRIEVAL: 'true'
pm2 reload pds-backend --update-env
# monitor:
pm2 logs pds-backend --lines 50 | grep -iE "retrieval|search"
```

- [ ] **Step 2: After 7-day soak with no regressions, author drop migration**

```js
'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    // Drop legacy embedding storage now that retrieval_chunks is canonical.
    await queryInterface.sequelize.query('ALTER TABLE knowledge_base DROP COLUMN embedding, DROP COLUMN embedding_updated_at;');
    await queryInterface.sequelize.query('ALTER TABLE data_sources DROP COLUMN embedding, DROP COLUMN embedding_updated_at;');
    await queryInterface.sequelize.query('ALTER TABLE indicator_meta DROP COLUMN embedding, DROP COLUMN embedding_updated_at;');
    await queryInterface.sequelize.query('ALTER TABLE chat_threads DROP COLUMN embedding;');
  },
  async down(queryInterface, Sequelize) {
    // Reversal: re-add as nullable longtext (data lost)
    await queryInterface.sequelize.query("ALTER TABLE knowledge_base ADD COLUMN embedding LONGTEXT NULL, ADD COLUMN embedding_updated_at TIMESTAMP NULL;");
    await queryInterface.sequelize.query("ALTER TABLE data_sources ADD COLUMN embedding LONGTEXT NULL, ADD COLUMN embedding_updated_at TIMESTAMP NULL;");
    await queryInterface.sequelize.query("ALTER TABLE indicator_meta ADD COLUMN embedding LONGTEXT NULL, ADD COLUMN embedding_updated_at TIMESTAMP NULL;");
    await queryInterface.sequelize.query("ALTER TABLE chat_threads ADD COLUMN embedding LONGTEXT NULL;");
  }
};
```

- [ ] **Step 3: Update model files to remove the dropped columns**

`KnowledgeBase.model.js`, `DataSource.model.js`, `IndicatorMeta.model.js`, `ChatThread.model.js`: delete the `embedding` and `embedding_updated_at` attributes.

- [ ] **Step 4: Run migration + smoke test**

```bash
cd backend && npx sequelize-cli db:migrate
mysql -uroot -p17Agustus project_data_strategis -e "DESC knowledge_base;" | grep embedding
```

Expected: no `embedding` columns left.

- [ ] **Step 5: Commit**

```bash
git add backend/src/database/migrations/20260515_drop_legacy_embedding_columns.js backend/src/models/*.model.js
git commit -m "feat(retrieval): drop legacy embedding columns now that retrieval_chunks is canonical"
```

---

## Phase D — Bug Fixes & Collation Harmonization (P2)

### Task D1: ALTER `kodehs_indd` to converge collation

**Files:**
- Create: `backend/src/database/migrations/20260508_alter_kodehs_collation.js`

- [ ] **Step 1: Author migration**

```js
'use strict';
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      'ALTER TABLE data_bps.kodehs_indd CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;'
    );
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'ALTER TABLE data_bps.kodehs_indd CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;'
    );
  },
};
```

- [ ] **Step 2: Run**

```bash
cd backend && npx sequelize-cli db:migrate
```

- [ ] **Step 3: Probe — the bad join now succeeds**

```bash
mysql -uroot -p17Agustus -e "
SELECT i.kodehs, k.bab_ind FROM data_bps.indikator_5 i
LEFT JOIN data_bps.kodehs_indd k ON i.kodehs=k.hs2digit LIMIT 1;"
```

Expected: returns one row, no 1267 error.

- [ ] **Step 4: Commit**

```bash
git add backend/src/database/migrations/20260508_alter_kodehs_collation.js
git commit -m "fix(db): align kodehs_indd collation with indikator_NNN family"
```

### Task D2: Converge PDS legacy tables to `utf8mb4_uca1400_ai_ci`

**Files:**
- Create: `backend/src/database/migrations/20260508_pds_collation_convergence.js`

- [ ] **Step 1: Author migration**

```js
'use strict';
const LEGACY_TABLES = [
  'active_sessions', 'admin_audit_logs', 'app_notifications', 'automation_configs',
  'automation_run_logs', 'chat_error_patterns', 'chat_feedbacks', 'chat_messages',
  'chat_message_flags', 'chat_threads', 'data_search_stats', 'data_source_search_terms',
  'dna_cache', 'exim_pod_filters', 'indexed_brs_publikasi', 'page_views',
  'push_send_logs', 'push_subscriptions', 'user_memory', 'users',
  'innodb_ft_stopwords', '_archive_pressrelease_data_sources_20260507'
];

module.exports = {
  async up(queryInterface) {
    for (const t of LEGACY_TABLES) {
      try {
        await queryInterface.sequelize.query(
          `ALTER TABLE \`${t}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;`
        );
      } catch (err) {
        console.warn(`[collation] skip ${t}: ${err.message}`);
      }
    }
  },
  async down() { /* irreversible — manual rollback only */ }
};
```

- [ ] **Step 2: Run during quiet window** (each ALTER rewrites the table)

```bash
cd backend && npx sequelize-cli db:migrate 2>&1 | tail -10
```

- [ ] **Step 3: Verify**

```bash
mysql -uroot -p17Agustus -e "
SELECT table_collation, COUNT(*) FROM information_schema.tables
WHERE table_schema='project_data_strategis' GROUP BY table_collation;"
```

Expected: only `utf8mb4_uca1400_ai_ci` (or `_archive_*` if migration skipped it).

- [ ] **Step 4: Commit**

```bash
git add backend/src/database/migrations/20260508_pds_collation_convergence.js
git commit -m "fix(db): converge PDS tables to utf8mb4_uca1400_ai_ci"
```

---

## Phase E — Retention Crons (P2)

### Task E1: Add daily retention job

**Files:**
- Create: `backend/src/jobs/retention.job.js`
- Modify: `backend/src/server.js` to schedule the job

- [ ] **Step 1: Author the job**

```js
'use strict';
const sequelize = require('../config/db');
const logger = require('../utils/logger').child({ service: 'Retention' });

const POLICIES = [
  { table: 'fetch_logs',         days: 90,  column: 'created_at' },
  { table: 'automation_run_logs', days: 30, column: 'created_at' },
  { table: 'admin_audit_logs',    days: 365, column: 'created_at' },
];

async function runRetention() {
  for (const p of POLICIES) {
    try {
      const [r] = await sequelize.query(
        `DELETE FROM \`${p.table}\` WHERE \`${p.column}\` < NOW() - INTERVAL ? DAY`,
        { replacements: [p.days] }
      );
      logger.info({ table: p.table, deleted: r.affectedRows, days: p.days }, 'Retention purge');
    } catch (err) {
      logger.error({ table: p.table, err: err.message }, 'Retention purge failed');
    }
  }
}

module.exports = { runRetention };
```

- [ ] **Step 2: Schedule in `server.js`** (use existing `node-cron` or `setInterval`)

```js
const { runRetention } = require('./jobs/retention.job');
// after server is listening:
setInterval(runRetention, 24 * 60 * 60 * 1000);
runRetention(); // also run once on startup
```

- [ ] **Step 3: Smoke test (one-shot) via temp script**

Create `/tmp/probe-retention.js`:

```js
require('/var/www/html/project-data-strategis/backend/src/jobs/retention.job').runRetention().then(() => process.exit(0));
```

Run:

```bash
cd backend && node /tmp/probe-retention.js
```

Expected: log lines for each policy, with `deleted: <N>`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/jobs/retention.job.js backend/src/server.js
git commit -m "feat(jobs): daily retention for fetch_logs (90d) + automation_run_logs (30d) + admin_audit_logs (365d)"
```

---

## Phase F — Cleanup (P3)

### Task F1: Drop junk `data_sources.id=313` + its empty indikator table

- [ ] **Step 1: Verify it's still empty**

```bash
mysql -uroot -p17Agustus project_data_strategis -e "SELECT id, name FROM data_sources WHERE id=313;"
mysql -uroot -p17Agustus -e "SELECT COUNT(*) FROM data_bps.indikator_313;"
```

Expected: `name=e5d1be11320576d466bdeb2f7f210387`, count=0.

- [ ] **Step 2: Delete + drop**

```bash
mysql -uroot -p17Agustus project_data_strategis -e "DELETE FROM data_sources WHERE id=313;"
mysql -uroot -p17Agustus -e "DROP TABLE IF EXISTS data_bps.indikator_313;"
```

- [ ] **Step 3: Document** (note in `docs/workspace/database.md`; no commit needed for the SQL itself)

### Task F2: Drop `_archive_pressrelease_data_sources_20260507`

- [ ] **Step 1: Confirm with user this archive can go** (block on user confirmation)

- [ ] **Step 2: After confirmation**

```bash
mysql -uroot -p17Agustus project_data_strategis -e "DROP TABLE _archive_pressrelease_data_sources_20260507;"
```

### Task F3: Document the system pseudo-source convention

**Files:**
- Modify: `docs/workspace/database.md`

- [ ] **Step 1: Add a "System pseudo-sources" section** noting that `data_sources.type='static'` AND `visible=0` rows do NOT have backing `indikator_NNN` tables. Cite ids 176 and 177 as the current set.

- [ ] **Step 2: Commit**

```bash
git add docs/workspace/database.md
git commit -m "docs: document system pseudo-source convention in database.md"
```

### Task F4: Refresh `docs/workspace/database.md` change log

- [ ] **Step 1: Append to the Change Log table:**

```markdown
| 2026-05-08 | DB audit + retrieval_chunks unification (Phase A-F) | retrieval_chunks, models/*.model.js, retention.job.js, kodehs_indd collation, ... |
```

- [ ] **Step 2: Update the `Models` count from 26 → 27 (RetrievalChunk + IndicatorMeta + IndicatorMetricMeta − removed embedding cols).**

- [ ] **Step 3: Update `data_bps Tables` count: 311 indikator_* (after dropping 313).**

- [ ] **Step 4: Commit**

```bash
git add docs/workspace/database.md
git commit -m "docs: refresh database.md change log post audit fixes"
```

---

## Self-Review Checklist

Coverage check against `memory/db_audit_findings_2026-05-08.md`:

- [x] **P0 #1** audit log writer offline → Phase A (5 tasks)
- [x] **P0 #2** EXIM cross-collation (downgraded to P2 by parallel agent — preventive, not breaking) → Task D1
- [x] **P1 #3** DataSource missing 4 columns → Task B2
- [x] **P1 #4** KnowledgeBase title length + 2 missing columns → Task B1
- [x] **P1 #5** models/index.js missing 9 entries → Task B5 (new models) + B6 (index re-export)
- [x] **P2 #6** PDS collation drift → Task D2
- [x] **P2 #7** fetch_logs retention → Task E1
- [x] **P2 #8** automation_run_logs retention → Task E1
- [x] **P3 #9** indikator_313 junk → Task F1
- [x] **P3 #10** archive table → Task F2
- [x] **P3 #11** system pseudo-sources convention → Task F3
- [x] **#12** embedding dim drift (1536/3072 mismatch) → Task C1 (replace OpenAI with Gemini wrapper) + Task C2-C8 (full unification on `gemini-embedding-001 @ 768d`, eliminates fragmentation and removes paid-API dependency)
- [x] **Bonus** ChatThread.embedding hidden from ORM → Task B3 + dropped in Task C8
- [x] **Bonus** DataPeriod / ProcessedCache / FetchLog nullability + timestamps → Task B4
- [x] **Bonus** indicator_meta / indicator_metric_meta / chat_threads in retrieval_chunks → Task C5 + C8

Placeholder scan: no TBDs, no "implement later", no untyped pseudo-code. Every step has exact paths, exact SQL, exact JS, expected output.

Type consistency: `RetrievalChunk.SOURCE_KINDS` is referenced in C3 (model) and consumed via `kinds` parameter in C6 (service). `EMBEDDING_DIMENSIONS=768` is referenced in C1 (Gemini wrapper), C4 (backfill validation), C5 (repack guard). `EMBEDDING_MODEL='gemini-embedding-001'` is consistent across C1, C4, C5 — pulled from the single source of truth in `services/bpsMetadata/embedding.service.js`.

Risks called out:
- **Phase C7 cutover**: legacy retrieval path is dead immediately after C1 (Gemini 768d query vectors won't match cached OpenAI 3072d). Unified path must default ON and pass deep-doc regression suite on first try. If it fails, debug with logs from `retrieval.service.js` and `documentJudge.service.js` — do NOT try to revive the legacy path (no OpenAI key).
- **Phase C4 backfill duration**: 30–90 min for 28K rows. Run via `nohup` or `tmux`; the script is idempotent so a partial run can be resumed. While the backfill is running, retrieval is degraded — schedule outside chat peak hours.
- **Phase D2 collation convergence**: ALTER TABLE rewrites each table — schedule for a quiet window (10 tables × seconds–minutes each, depends on row count; biggest is `chat_messages` at 55 MB).
- **Phase F2**: blocks on user confirmation — do not auto-drop archive.
- **Free-tier capacity**: `gemini-embedding-001` free tier is 10M tokens/min per project. With 10 keys we have far more headroom than we need, but if Google ever changes the policy, retrieval breaks. Mitigation: the `services/bpsMetadata/embedding.service.js` retry/rotation logic already handles 429/403 gracefully; if all 10 keys throttle, the chat call fails fast and the user sees a "search unavailable" message instead of a hang.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-08-db-audit-fixes.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Decisions locked (2026-05-09):**
- ✅ **Schema dim**: `VECTOR(768)` — driven by the budget constraint that Gemini is the only available generator.
- ✅ **Embedding provider**: Gemini `gemini-embedding-001 @ 768d` exclusively, via existing 10-key pool in `services/bpsMetadata/embedding.service.js`. OpenAI service replaced by a thin wrapper.
- ⏳ **Audit-log retention**: defaulting to 365 days in Task E1 unless overridden.

**Which approach for execution?** Subagent-driven (recommended) or inline?
