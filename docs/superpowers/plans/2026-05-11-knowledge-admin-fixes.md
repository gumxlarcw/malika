# Knowledge Admin Page Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the `/backend/knowledge` admin page (status display + manage actions) by porting every legacy `data_sources.embedding` / `knowledge_base.embedding_updated_at` reference onto the live `retrieval_chunks` storage that has been the single source of truth since Phase C (2026-05-09).

**Architecture:** Pure port — same API contract, same UI response shapes (`hasEmbedding`, `embeddingUpdatedAt`, stats fields). Reads switch from "select dropped column" to "LEFT JOIN retrieval_chunks". Writes switch from "OpenAI 1536d -> data_sources.embedding column" to "xenova 768d -> retrieval_chunks row". No new tables, no new model files, no admin UI changes.

**Tech Stack:** Node 22 / Express / Sequelize 6 / MariaDB 11.8 (native VECTOR(768) cosine HNSW on `retrieval_chunks.embedding`) / xenova `@xenova/transformers` (multilingual-e5-base).

---

## Verified ground truth (2026-05-11)

| Fact | Evidence |
|---|---|
| `data_sources.embedding` / `embedding_updated_at` dropped | `SHOW COLUMNS FROM data_sources LIKE 'embedding%'` -> empty |
| `knowledge_base.embedding` / `embedding_updated_at` dropped | `SHOW COLUMNS FROM knowledge_base LIKE 'embedding%'` -> empty |
| `DataSource.model.js` / `KnowledgeBase.model.js` don't declare those fields | grep confirms |
| `retrieval_chunks` is populated and healthy | 311 datasource + 1331 knowledge_doc + 26772 knowledge_chunk + 302 indicator_meta, latest 2026-05-09 |
| `USE_UNIFIED_RETRIEVAL=true` in `.env` | confirmed |
| Live embedder is xenova multilingual-e5-base @ 768d | `services/bpsMetadata/embedding.service.js` exports `embedPassage`, `embedQuery`, `generateEmbedding` |
| Live read path is `services/ai/retrieval.service.js -> searchRetrieval()` | confirmed; uses `VEC_DISTANCE_COSINE` |
| Canonical INSERT pattern for retrieval_chunks | `scripts/backfill-retrieval-chunks.js:102-113` (INSERT IGNORE ... VEC_FromText) |

## Failure surface (live probe 2026-05-11)

| Endpoint | Current status | Why |
|---|---|---|
| `GET /knowledge/stats` | 500 | `WHERE data_sources.embedding IS NOT NULL` -> "Unknown column" |
| `GET /knowledge/datasources` | 500 | `SELECT embedding, embedding_updated_at FROM data_sources` |
| `GET /knowledge/documents` | 500 | `SELECT embedding_updated_at FROM knowledge_base` |
| `POST /knowledge/embed-all` | **silent lie**: 200 + `errors:311` | OpenAI 429 (key abandoned) + write to dropped column |
| `POST /knowledge/embed/:id` | 500 | same as above |
| `DELETE /knowledge/embed/:id` | 200 but **no-op** | Sequelize silently drops unknown `embedding`/`embedding_updated_at` from UPDATE |
| `POST /knowledge/documents/:id/re-embed` | 500 | OpenAI key + dropped column |
| `POST /knowledge/documents/text` | 200 (create works) | background embedding step fails silently |
| `POST /knowledge/documents/pdf` | 200 (create works) | background embedding step fails silently |
| `DELETE /knowledge/documents/:id` | 200 (works) | doesn't touch embedding columns |
| `POST /knowledge/search` | 200 (works) | gated on `USE_UNIFIED_RETRIEVAL=true`, routes to `searchRetrieval()` |

## Pre-flight ground rules

- Backup before edit: `cp <file> <file>.backup` (CLAUDE.md global rule).
- Backend reload: `pm2 reload pds-backend --update-env`. Admin doesn't need rebuild (response shape unchanged).
- Stage only intended files; never `git add -A`.
- No `Co-Authored-By` trailer.
- Commit after each task.

## Drift checklist (what we WILL NOT change)

- API paths (`/knowledge/stats`, `/knowledge/datasources`, etc.) — preserved verbatim.
- Response shape: `hasEmbedding`, `embeddingUpdatedAt`, `total`, `embedded`, `notEmbedded`, `oldestEmbedding`, `newestEmbedding`, `lastUpdated`, `cache` — preserved verbatim.
- Admin `page.tsx` — untouched (it consumes the same shapes).
- The legacy OpenAI embedding service file (`services/ai/embedding.service.js`) is left in place but flagged as deprecated; its exports stay so `scripts/reembed-all.js` doesn't import-fail (that script is broken anyway and out of scope to delete).

---

## Task 1: Repair `GET /knowledge/stats`

**File:** `backend/src/services/ai/embedding.service.js`

**Why essence-preserving:** Same numbers (active count, embedded count, oldest, newest) — derived from `retrieval_chunks` instead of a dropped column.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/embeddingStats.shape.test.js`:

```js
const { getEmbeddingStats } = require('../services/ai/embedding.service');

jest.setTimeout(10_000);

const REQUIRED_FIELDS = [
  'total',
  'embedded',
  'notEmbedded',
  'oldestEmbedding',
  'newestEmbedding',
  'lastUpdated',
];

test('getEmbeddingStats returns the canonical shape', async () => {
  const stats = await getEmbeddingStats();
  for (const f of REQUIRED_FIELDS) {
    expect(stats).toHaveProperty(f);
  }
  expect(typeof stats.total).toBe('number');
  expect(typeof stats.embedded).toBe('number');
  expect(typeof stats.notEmbedded).toBe('number');
  expect(stats.total).toBeGreaterThan(0);
  // Embedded count must reflect retrieval_chunks reality (>= 1)
  expect(stats.embedded).toBeGreaterThan(0);
  expect(stats.notEmbedded).toBe(stats.total - stats.embedded);
});
```

- [ ] **Step 2: Run test to verify it fails (today)**

```bash
cd backend && npx jest src/__tests__/embeddingStats.shape.test.js --no-coverage
```
Expected: FAIL with `Unknown column 'DataSource.embedding'`.

- [ ] **Step 3: Rewrite `getEmbeddingStats()` to query retrieval_chunks**

Replace the function body in `backend/src/services/ai/embedding.service.js`:

```js
async function getEmbeddingStats() {
  const DataSource = require('../../models/DataSource.model');
  const sequelize = require('../../config/db');

  const [total, embeddedRowsRes, datesRes] = await Promise.all([
    DataSource.count({ where: { status: true } }),
    sequelize.query(
      `SELECT COUNT(DISTINCT rc.source_ref_id) AS embedded
       FROM retrieval_chunks rc
       INNER JOIN data_sources ds ON ds.id = rc.source_ref_id
       WHERE rc.source_kind = 'datasource' AND ds.status = 1`,
      { type: sequelize.QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT MIN(embedding_generated_at) AS oldest,
              MAX(embedding_generated_at) AS newest
       FROM retrieval_chunks
       WHERE source_kind = 'datasource'`,
      { type: sequelize.QueryTypes.SELECT }
    ),
  ]);

  const embedded = Number(embeddedRowsRes?.[0]?.embedded || 0);
  const oldest = datesRes?.[0]?.oldest || null;
  const newest = datesRes?.[0]?.newest || null;

  return {
    total,
    embedded,
    notEmbedded: Math.max(0, total - embedded),
    oldestEmbedding: oldest,
    newestEmbedding: newest,
    lastUpdated: newest,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && npx jest src/__tests__/embeddingStats.shape.test.js --no-coverage
```
Expected: PASS.

- [ ] **Step 5: Reload + live smoke**

```bash
pm2 reload pds-backend --update-env
sleep 6
JWT=$(cd backend && node -e "require('dotenv').config({quiet:true}); console.log(require('jsonwebtoken').sign({id:1,email:'admin@bps.go.id',role:'admin'}, process.env.JWT_SECRET, {expiresIn:'2h'}))")
curl -s -H "Authorization: Bearer $JWT" http://localhost:5000/knowledge/stats | head -c 300
```
Expected: JSON with `total`, `embedded > 0`, `oldestEmbedding`/`newestEmbedding` populated.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/ai/embedding.service.js backend/src/__tests__/embeddingStats.shape.test.js
git commit --no-gpg-sign -m "fix(knowledge): /knowledge/stats reads retrieval_chunks not dropped column"
```

---

## Task 2: Repair `GET /knowledge/datasources`

**File:** `backend/src/services/ai/embedding.service.js`

**Why essence-preserving:** Same per-source list with `hasEmbedding` + `embeddingUpdatedAt` — derived from `retrieval_chunks` rows keyed by `source_ref_id`.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/__tests__/embeddingStats.shape.test.js`:

```js
const { getDatasourcesWithEmbeddingStatus } = require('../services/ai/embedding.service');

test('getDatasourcesWithEmbeddingStatus returns per-source rows', async () => {
  const rows = await getDatasourcesWithEmbeddingStatus();
  expect(Array.isArray(rows)).toBe(true);
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows.slice(0, 5)) {
    expect(r).toHaveProperty('id');
    expect(r).toHaveProperty('name');
    expect(r).toHaveProperty('type');
    expect(r).toHaveProperty('hasEmbedding');
    expect(typeof r.hasEmbedding).toBe('boolean');
    expect(r).toHaveProperty('embeddingUpdatedAt');
    expect(r).toHaveProperty('textLength');
    expect(typeof r.textLength).toBe('number');
  }
  // At least some sources must show hasEmbedding=true given live retrieval_chunks state.
  expect(rows.filter(r => r.hasEmbedding).length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Confirm test fails**

```bash
cd backend && npx jest src/__tests__/embeddingStats.shape.test.js --no-coverage
```
Expected: 2nd test fails with same Unknown-column class of error.

- [ ] **Step 3: Rewrite `getDatasourcesWithEmbeddingStatus()`**

Replace in `embedding.service.js`:

```js
async function getDatasourcesWithEmbeddingStatus() {
  const sequelize = require('../../config/db');

  const [rows] = await sequelize.query(
    `SELECT ds.id, ds.name, ds.type, ds.description, ds.aliases, ds.category,
            rc.embedding_generated_at AS embedding_updated_at
     FROM data_sources ds
     LEFT JOIN retrieval_chunks rc
       ON rc.source_kind = 'datasource' AND rc.source_ref_id = ds.id
     WHERE ds.status = 1
     ORDER BY ds.id ASC`
  );

  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    hasEmbedding: Boolean(s.embedding_updated_at),
    embeddingUpdatedAt: s.embedding_updated_at || null,
    textLength: buildEmbeddingText({
      name: s.name,
      description: s.description,
      aliases: s.aliases,
      category: s.category,
    }).length,
  }));
}
```

- [ ] **Step 4: Run test**

```bash
cd backend && npx jest src/__tests__/embeddingStats.shape.test.js --no-coverage
```
Expected: both tests PASS.

- [ ] **Step 5: Reload + live smoke**

```bash
pm2 reload pds-backend --update-env
sleep 6
JWT=$(cd backend && node -e "require('dotenv').config({quiet:true}); console.log(require('jsonwebtoken').sign({id:1,email:'admin@bps.go.id',role:'admin'}, process.env.JWT_SECRET, {expiresIn:'2h'}))")
curl -s -H "Authorization: Bearer $JWT" http://localhost:5000/knowledge/datasources | python3 -c "import sys,json; d=json.load(sys.stdin); print('count=', len(d['datasources']), 'hasEmbedding count=', sum(1 for x in d['datasources'] if x['hasEmbedding']))"
```
Expected: count=309-ish, hasEmbedding count > 200.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/ai/embedding.service.js backend/src/__tests__/embeddingStats.shape.test.js
git commit --no-gpg-sign -m "fix(knowledge): /knowledge/datasources reads retrieval_chunks not dropped columns"
```

---

## Task 3: Repair `GET /knowledge/documents`

**File:** `backend/src/services/ai/knowledgeDoc.service.js`

**Why essence-preserving:** Same list of root knowledge docs, same chunk-count + total-length + `hasEmbedding` aggregation — just sourced from `retrieval_chunks` and the existing `status` column instead of a dropped column.

- [ ] **Step 1: Write the failing test**

Create `backend/src/__tests__/knowledgeDocAll.shape.test.js`:

```js
const { getAllDocuments } = require('../services/ai/knowledgeDoc.service');

jest.setTimeout(10_000);

test('getAllDocuments returns canonical shape', async () => {
  const docs = await getAllDocuments();
  expect(Array.isArray(docs)).toBe(true);
  for (const d of docs.slice(0, 3)) {
    expect(d).toHaveProperty('id');
    expect(d).toHaveProperty('title');
    expect(d).toHaveProperty('chunks');
    expect(typeof d.chunks).toBe('number');
    expect(d).toHaveProperty('content_length');
    expect(typeof d.content_length).toBe('number');
    expect(d).toHaveProperty('status');
    expect(d).toHaveProperty('hasEmbedding');
    expect(typeof d.hasEmbedding).toBe('boolean');
  }
});
```

- [ ] **Step 2: Confirm test fails**

```bash
cd backend && npx jest src/__tests__/knowledgeDocAll.shape.test.js --no-coverage
```
Expected: FAIL — "Unknown column 'embedding_updated_at'".

- [ ] **Step 3: Rewrite `getAllDocuments()`**

In `knowledgeDoc.service.js`, replace the function body. Drop `embedding_updated_at` from `attributes`. Look up `hasEmbedding` from `retrieval_chunks`:

```js
async function getAllDocuments() {
  const sequelize = require('../../config/db');
  const { Sequelize, Op } = require('sequelize');

  const docs = await KnowledgeBase.findAll({
    where: { parent_id: null },
    order: [['created_at', 'DESC']],
    attributes: [
      'id', 'title', 'description', 'category', 'source_type',
      'source_filename', 'content_length', 'status', 'created_at',
    ],
  });

  // Chunk counts per root.
  const chunkCounts = await KnowledgeBase.findAll({
    where: { parent_id: { [Op.ne]: null } },
    attributes: ['parent_id', [Sequelize.fn('COUNT', Sequelize.col('id')), 'chunks']],
    group: ['parent_id'],
    raw: true,
  });
  const chunkMap = new Map(chunkCounts.map((c) => [c.parent_id, parseInt(c.chunks, 10)]));

  // Total content length per root (sum across parent + chunks).
  const docIds = docs.map((d) => d.id);
  if (docIds.length === 0) return [];

  const totalLengthResults = await KnowledgeBase.findAll({
    where: {
      [Op.or]: [
        { id: { [Op.in]: docIds } },
        { parent_id: { [Op.in]: docIds } },
      ],
    },
    attributes: [
      [Sequelize.literal('COALESCE(parent_id, id)'), 'root_id'],
      [Sequelize.fn('SUM', Sequelize.fn('CHAR_LENGTH', Sequelize.col('content'))), 'total_length'],
    ],
    group: [Sequelize.literal('COALESCE(parent_id, id)')],
    raw: true,
  });
  const totalLengthMap = new Map(
    totalLengthResults.map((r) => [r.root_id, parseInt(r.total_length || 0, 10)])
  );

  // hasEmbedding + embeddingUpdatedAt from retrieval_chunks for source_kind='knowledge_doc'.
  const [embRows] = await sequelize.query(
    `SELECT source_ref_id, MAX(embedding_generated_at) AS embedded_at
     FROM retrieval_chunks
     WHERE source_kind = 'knowledge_doc' AND source_ref_id IN (?)
     GROUP BY source_ref_id`,
    { replacements: [docIds] }
  );
  const embMap = new Map(embRows.map((r) => [r.source_ref_id, r.embedded_at]));

  return docs.map((d) => ({
    ...d.toJSON(),
    chunks: (chunkMap.get(d.id) || 0) + 1,
    content_length: totalLengthMap.get(d.id) || d.content_length || 0,
    hasEmbedding: embMap.has(d.id),
    embedding_updated_at: embMap.get(d.id) || null,
  }));
}
```

- [ ] **Step 4: Run test**

```bash
cd backend && npx jest src/__tests__/knowledgeDocAll.shape.test.js --no-coverage
```
Expected: PASS.

- [ ] **Step 5: Reload + live smoke**

```bash
pm2 reload pds-backend --update-env
sleep 6
JWT=$(cd backend && node -e "require('dotenv').config({quiet:true}); console.log(require('jsonwebtoken').sign({id:1,email:'admin@bps.go.id',role:'admin'}, process.env.JWT_SECRET, {expiresIn:'2h'}))")
curl -s -H "Authorization: Bearer $JWT" http://localhost:5000/knowledge/documents | python3 -c "import sys,json; d=json.load(sys.stdin); print('count=', len(d['documents']), 'hasEmbedding count=', sum(1 for x in d['documents'] if x.get('hasEmbedding')))"
```
Expected: count=~1331 root docs (or near), hasEmbedding count > 1000.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/ai/knowledgeDoc.service.js backend/src/__tests__/knowledgeDocAll.shape.test.js
git commit --no-gpg-sign -m "fix(knowledge): /knowledge/documents reads retrieval_chunks for hasEmbedding"
```

---

## Task 4: Migrate datasource write paths to retrieval_chunks

**Files:**
- `backend/src/services/ai/embedding.service.js` (`embedDatasource`, `embedAllDatasources`, `clearEmbedding`)
- `backend/src/controllers/knowledge.controller.js` (no change needed; controller passes through)

**Why essence-preserving:** Same admin actions (embed / re-embed / clear), same response keys; new pipeline writes to `retrieval_chunks` via xenova so the data is actually persisted. Eliminates the **silent-lie** failure mode of `embed-all` that currently reports `ok:true` while writing nothing.

- [ ] **Step 1: Write the failing test for write path**

Create `backend/src/__tests__/embeddingWrite.test.js`:

```js
const { embedDatasource, clearEmbedding } =
  require('../services/ai/embedding.service');
const sequelize = require('../config/db');

jest.setTimeout(60_000);

// Source id=2 is "IHK Halmahera Tengah" - always present per data audit.
const TEST_SID = 2;

async function readState(sid) {
  const [rows] = await sequelize.query(
    `SELECT id, embedding_generated_at FROM retrieval_chunks
     WHERE source_kind='datasource' AND source_ref_id = ?`,
    { replacements: [sid] }
  );
  return rows[0] || null;
}

test('embedDatasource upserts a retrieval_chunks row', async () => {
  const before = await readState(TEST_SID);
  const result = await embedDatasource(TEST_SID);
  expect(result).toHaveProperty('ok');
  expect(result.ok).toBe(true);

  const after = await readState(TEST_SID);
  expect(after).not.toBeNull();
  if (before) {
    expect(new Date(after.embedding_generated_at).getTime())
      .toBeGreaterThanOrEqual(new Date(before.embedding_generated_at).getTime());
  }
});

test('clearEmbedding removes the retrieval_chunks row for that source', async () => {
  await embedDatasource(TEST_SID);
  expect(await readState(TEST_SID)).not.toBeNull();
  await clearEmbedding(TEST_SID);
  expect(await readState(TEST_SID)).toBeNull();
  // Restore so next test runs / production stays whole.
  await embedDatasource(TEST_SID);
  expect(await readState(TEST_SID)).not.toBeNull();
});
```

- [ ] **Step 2: Confirm test fails (today calls dropped column)**

```bash
cd backend && npx jest src/__tests__/embeddingWrite.test.js --no-coverage
```
Expected: FAIL with Unknown column or OpenAI 429.

- [ ] **Step 3: Rewrite the three write functions**

Replace in `embedding.service.js`:

```js
const sequelize = require('../../config/db');
const { embedPassage } = require('../bpsMetadata/embedding.service');

const LIVE_EMBEDDING_MODEL = 'Xenova/multilingual-e5-base';

async function upsertDatasourceChunk(source) {
  const text = buildEmbeddingText(source);
  if (!text) return { ok: false, message: 'No text to embed' };

  const emb = await embedPassage(text);
  const metadata = { category: source.category || null, type: source.type || null };

  await sequelize.query(
    `DELETE FROM retrieval_chunks
     WHERE source_kind = 'datasource' AND source_ref_id = ?`,
    { replacements: [source.id] }
  );
  await sequelize.query(
    `INSERT INTO retrieval_chunks
       (source_kind, source_ref_id, chunk_index, title, content_text, metadata,
        embedding, embedding_model, embedding_generated_at)
     VALUES ('datasource', ?, 0, ?, ?, ?, VEC_FromText(?), ?, NOW())`,
    {
      replacements: [
        source.id,
        source.name,
        source.description || '',
        JSON.stringify(metadata),
        JSON.stringify(emb),
        LIVE_EMBEDDING_MODEL,
      ],
    }
  );

  return { ok: true, message: `Embedded ${text.length} chars via ${LIVE_EMBEDDING_MODEL}` };
}

async function embedDatasource(sourceId) {
  const DataSource = require('../../models/DataSource.model');
  const source = await DataSource.findByPk(sourceId);
  if (!source) {
    const err = new Error(`Datasource ${sourceId} not found`);
    err.statusCode = 404;
    throw err;
  }
  return upsertDatasourceChunk(source);
}

async function embedAllDatasources({ force = false, onProgress } = {}) {
  const DataSource = require('../../models/DataSource.model');
  const sources = await DataSource.findAll({
    where: { status: true },
    order: [['id', 'ASC']],
  });

  const [existingRows] = await sequelize.query(
    `SELECT source_ref_id FROM retrieval_chunks WHERE source_kind='datasource'`
  );
  const existing = new Set(existingRows.map((r) => Number(r.source_ref_id)));

  const result = {
    total: sources.length,
    embedded: 0,
    skipped: 0,
    errors: 0,
    errorDetails: [],
  };

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    if (onProgress) onProgress({ current: i + 1, total: sources.length, name: source.name });

    if (!force && existing.has(Number(source.id))) {
      result.skipped++;
      continue;
    }
    try {
      const r = await upsertDatasourceChunk(source);
      if (r.ok) result.embedded++;
      else result.skipped++;
    } catch (e) {
      result.errors++;
      result.errorDetails.push(`ID ${source.id}: ${e.message}`);
    }
  }

  return result;
}

async function clearEmbedding(sourceId) {
  await sequelize.query(
    `DELETE FROM retrieval_chunks
     WHERE source_kind = 'datasource' AND source_ref_id = ?`,
    { replacements: [sourceId] }
  );
  return { ok: true };
}
```

- [ ] **Step 4: Run write tests**

```bash
cd backend && npx jest src/__tests__/embeddingWrite.test.js --no-coverage
```
Expected: PASS (both tests).

- [ ] **Step 5: Reload + smoke `embed-all` no longer lies**

```bash
pm2 reload pds-backend --update-env
sleep 6
JWT=$(cd backend && node -e "require('dotenv').config({quiet:true}); console.log(require('jsonwebtoken').sign({id:1,email:'admin@bps.go.id',role:'admin'}, process.env.JWT_SECRET, {expiresIn:'2h'}))")
curl -s -X POST -H "Authorization: Bearer $JWT" -H "Cookie: csrf_token=t" -H "X-CSRF-Token: t" -H "content-type: application/json" -d '{}' http://localhost:5000/knowledge/embed-all
```
Expected: `{"ok":true,"total":~311,"embedded":0,"skipped":~311,"errors":0,"errorDetails":[]}`

- [ ] **Step 6: Smoke single embed**

```bash
curl -s -X POST -H "Authorization: Bearer $JWT" -H "Cookie: csrf_token=t" -H "X-CSRF-Token: t" -H "content-type: application/json" -d '{}' http://localhost:5000/knowledge/embed/2
```
Expected: `{"ok":true,"message":"Embedded NNN chars via Xenova/multilingual-e5-base"}`.

Verify row in DB:
```bash
mysql -uroot project_data_strategis -e "SELECT id, source_ref_id, embedding_model, embedding_generated_at FROM retrieval_chunks WHERE source_kind='datasource' AND source_ref_id=2"
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/ai/embedding.service.js backend/src/__tests__/embeddingWrite.test.js
git commit --no-gpg-sign -m "feat(knowledge): datasource embed/embed-all/clear write to retrieval_chunks via xenova"
```

---

## Task 5: Migrate knowledge-doc write paths to retrieval_chunks

**Files:**
- `backend/src/services/ai/knowledgeDoc.service.js` (`processEmbeddings`, `reEmbed`)
- The post-create flows (`createFromText`, `createFromPdf`) call `processEmbeddings(ids)` after creating rows — same entry point, no change needed there.

**Why essence-preserving:** Same per-doc admin action ("Re-embed" button) and same automatic post-create indexing, just persisted to `retrieval_chunks` for `source_kind='knowledge_doc'` (parents) and `source_kind='knowledge_chunk'` (chunks). The `status` column on `knowledge_base` (`pending -> processing -> ready/error`) is preserved as the lifecycle indicator.

- [ ] **Step 1: Add a helper for one knowledge row**

Add to `knowledgeDoc.service.js` near the top alongside existing imports:

```js
const sequelize = require('../../config/db');
const { embedPassage } = require('../bpsMetadata/embedding.service');

const KNOWLEDGE_EMBEDDING_MODEL = 'Xenova/multilingual-e5-base';

async function upsertKnowledgeChunk(doc) {
  const kind = doc.parent_id == null ? 'knowledge_doc' : 'knowledge_chunk';
  const chunkIdx = doc.chunk_index || 0;

  const titleParts = [doc.title, doc.description].filter(Boolean);
  const text = [...titleParts, doc.content || ''].join('\n\n').slice(0, 8000);
  if (!text.trim()) return { ok: false, message: 'No text to embed' };

  const emb = await embedPassage(text);
  const metadata = {
    category: doc.category || null,
    keywords: doc.keywords || null,
    indicator_index: doc.indicator_index || null,
  };

  await sequelize.query(
    `DELETE FROM retrieval_chunks
     WHERE source_kind = ? AND source_ref_id = ? AND chunk_index = ?`,
    { replacements: [kind, doc.id, chunkIdx] }
  );
  await sequelize.query(
    `INSERT INTO retrieval_chunks
       (source_kind, source_ref_id, parent_chunk_id, chunk_index, title,
        content_text, metadata, embedding, embedding_model, embedding_generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, VEC_FromText(?), ?, NOW())`,
    {
      replacements: [
        kind, doc.id, doc.parent_id || null, chunkIdx,
        doc.title || '', doc.content || '', JSON.stringify(metadata),
        JSON.stringify(emb), KNOWLEDGE_EMBEDDING_MODEL,
      ],
    }
  );

  return { ok: true };
}
```

- [ ] **Step 2: Rewrite `processEmbeddings()`**

Replace the function body:

```js
async function processEmbeddings(ids) {
  for (const id of ids) {
    try {
      const doc = await KnowledgeBase.findByPk(id);
      if (!doc) continue;

      await doc.update({ status: 'processing' });
      await upsertKnowledgeChunk(doc);
      await doc.update({ status: 'ready', error_message: null });
    } catch (e) {
      console.error(`[KnowledgeDoc] Embed error for ${id}:`, e.message);
      await KnowledgeBase.update(
        { status: 'error', error_message: e.message },
        { where: { id } }
      );
    }
  }
}
```

- [ ] **Step 3: Rewrite `reEmbed()`**

Replace:

```js
async function reEmbed(id) {
  const doc = await KnowledgeBase.findByPk(id);
  if (!doc) {
    const err = new Error('Document not found');
    err.statusCode = 404;
    throw err;
  }

  await doc.update({ status: 'processing' });
  try {
    await upsertKnowledgeChunk(doc);
    const children = await KnowledgeBase.findAll({ where: { parent_id: id } });
    for (const c of children) {
      try { await upsertKnowledgeChunk(c); } catch { /* per-chunk best-effort */ }
    }
    await doc.update({ status: 'ready', error_message: null });
    return { ok: true };
  } catch (e) {
    await doc.update({ status: 'error', error_message: e.message });
    throw e;
  }
}
```

- [ ] **Step 4: Drop the now-orphaned legacy generateEmbedding import**

At the top of `knowledgeDoc.service.js` remove (if present):
```js
// REMOVE: const { generateEmbedding, EMBEDDING_DIMENSIONS } = require('./embedding.service');
```
Only remove if no other code in the file references it (grep first). `EMBEDDING_DIMENSIONS` may be re-used elsewhere; keep that line if so.

- [ ] **Step 5: Live smoke — re-embed an existing doc**

```bash
pm2 reload pds-backend --update-env
sleep 6
JWT=$(cd backend && node -e "require('dotenv').config({quiet:true}); console.log(require('jsonwebtoken').sign({id:1,email:'admin@bps.go.id',role:'admin'}, process.env.JWT_SECRET, {expiresIn:'2h'}))")
DOCID=$(mysql -uroot project_data_strategis -sN -e "SELECT id FROM knowledge_base WHERE parent_id IS NULL ORDER BY id DESC LIMIT 1")
echo "DOCID=$DOCID"
mysql -uroot project_data_strategis -e "SELECT MAX(embedding_generated_at) AS before_re_embed FROM retrieval_chunks WHERE source_kind='knowledge_doc' AND source_ref_id=$DOCID"
curl -s -X POST -H "Authorization: Bearer $JWT" -H "Cookie: csrf_token=t" -H "X-CSRF-Token: t" -H "content-type: application/json" -d '{}' http://localhost:5000/knowledge/documents/$DOCID/re-embed
mysql -uroot project_data_strategis -e "SELECT MAX(embedding_generated_at) AS after_re_embed FROM retrieval_chunks WHERE source_kind='knowledge_doc' AND source_ref_id=$DOCID"
```
Expected: `after_re_embed` > `before_re_embed`; HTTP response `{"ok":true}`.

- [ ] **Step 6: Live smoke — create-from-text triggers indexing**

```bash
TITLE="Probe re-embedding $(date +%s)"
RES=$(curl -s -X POST -H "Authorization: Bearer $JWT" -H "Cookie: csrf_token=t" -H "X-CSRF-Token: t" -H "content-type: application/json" -d "{\"title\":\"$TITLE\",\"content\":\"Probe document for verifying knowledge-doc indexing through xenova multilingual-e5-base.\",\"category\":\"probe\"}" http://localhost:5000/knowledge/documents/text)
echo "$RES"
NEWID=$(echo "$RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id') or d.get('documents', [{}])[0].get('id', ''))")
echo "NEWID=$NEWID"
sleep 8
mysql -uroot project_data_strategis -e "SELECT status FROM knowledge_base WHERE id=$NEWID"
mysql -uroot project_data_strategis -e "SELECT COUNT(*) AS n FROM retrieval_chunks WHERE source_kind='knowledge_doc' AND source_ref_id=$NEWID"
curl -s -X DELETE -H "Authorization: Bearer $JWT" -H "Cookie: csrf_token=t" -H "X-CSRF-Token: t" http://localhost:5000/knowledge/documents/$NEWID
mysql -uroot project_data_strategis -e "DELETE FROM retrieval_chunks WHERE source_kind='knowledge_doc' AND source_ref_id=$NEWID"
```
Expected: status='ready', retrieval_chunks count=1.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/ai/knowledgeDoc.service.js
git commit --no-gpg-sign -m "feat(knowledge): knowledge-doc re-embed/create-text/pdf write to retrieval_chunks via xenova"
```

---

## Task 6: Deprecate legacy embedding service paths + cleanup

**Files:**
- `backend/src/services/ai/embedding.service.js` — top-of-file deprecation comment
- `backend/src/services/ai/vectorSearch.service.js` — dead `loadEmbeddings`/`loadKnowledgeEmbeddings` paths are still in the file; mark or remove per scope

**Why essence-preserving:** Documentation-only. Marks the OpenAI 1536d code paths as DO-NOT-USE so future contributors don't reintroduce dropped-column calls. No runtime change.

- [ ] **Step 1: Add deprecation header**

Insert at top of `backend/src/services/ai/embedding.service.js`:

```js
/**
 * @deprecated 2026-05-11
 *
 * The OpenAI text-embedding-3-small (1536d) pipeline is no longer the live
 * embedder. As of Phase C (2026-05-09), embeddings are stored in
 * project_data_strategis.retrieval_chunks as VECTOR(768) and generated by
 * services/bpsMetadata/embedding.service.js (xenova multilingual-e5-base).
 *
 * The public methods on this module (getEmbeddingStats,
 * getDatasourcesWithEmbeddingStatus, embedDatasource, embedAllDatasources,
 * clearEmbedding) have been ported to query/write retrieval_chunks. The
 * legacy generateEmbedding() and buildEmbeddingText() helpers remain so
 * that scripts/reembed-all.js doesn't import-fail, but they should NOT be
 * called from new code.
 *
 * Do not add new callers of generateEmbedding() here. Use:
 *   const { embedPassage, embedQuery } = require('../bpsMetadata/embedding.service');
 */
```

- [ ] **Step 2: Audit `vectorSearch.service.js` for dead helpers**

```bash
grep -n "loadEmbeddings\|loadKnowledgeEmbeddings" /var/www/html/project-data-strategis/backend/src/services/ai/vectorSearch.service.js | head
```

If `loadEmbeddings` and `loadKnowledgeEmbeddings` are only called when `USE_UNIFIED_RETRIEVAL=false`, document this in a one-line comment near each function:

```js
// NOTE: Legacy in-memory cache path. Only reachable when USE_UNIFIED_RETRIEVAL=false.
// Production runs with USE_UNIFIED_RETRIEVAL=true (.env), so this code is dead at runtime.
async function loadEmbeddings(force = false) {
  ...
```

Do not delete — production env could in theory toggle the flag back. Leave the dead paths annotated.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/ai/embedding.service.js backend/src/services/ai/vectorSearch.service.js
git commit --no-gpg-sign -m "docs(knowledge): deprecate legacy OpenAI embedding path; annotate dead loaders"
```

---

## Task 7: Closeout — smoke, memory, push

- [ ] **Step 1: Full surface smoke**

```bash
JWT=$(cd backend && node -e "require('dotenv').config({quiet:true}); console.log(require('jsonwebtoken').sign({id:1,email:'admin@bps.go.id',role:'admin'}, process.env.JWT_SECRET, {expiresIn:'2h'}))")

echo "===READ==="
for ep in stats datasources documents documents/stats; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $JWT" "http://localhost:5000/knowledge/$ep")
  echo "GET /knowledge/$ep -> $code (expect 200)"
done

echo "===WRITE (idempotent, restores state)==="
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $JWT" -H "Cookie: csrf_token=t" -H "X-CSRF-Token: t" -H "content-type: application/json" -d '{}' http://localhost:5000/knowledge/embed/2)
echo "POST /knowledge/embed/2 -> $code (expect 200)"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $JWT" -H "Cookie: csrf_token=t" -H "X-CSRF-Token: t" -H "content-type: application/json" -d '{}' http://localhost:5000/knowledge/embed-all)
echo "POST /knowledge/embed-all -> $code (expect 200, skipped=~311)"

echo "===admin page renders==="
code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5050/backend/knowledge)
echo "GET admin /backend/knowledge -> $code (expect 200)"
```

All endpoints should return 200. `embed-all` should report `skipped ~= 311`, `errors=0`.

- [ ] **Step 2: Update memory**

Create `/root/.claude/projects/-var-www-html/memory/knowledge_admin_fixes_2026-05-11.md` with summary (read paths from retrieval_chunks, write paths via xenova). Add one-liner to MEMORY.md Active Plans. Mirror to `docs/memory/`.

Update `docs/workspace/backend.md` Change Log with a one-line entry pointing to the plan.

- [ ] **Step 3: Commit + push**

```bash
git add docs/memory/MEMORY.md docs/memory/knowledge_admin_fixes_2026-05-11.md docs/workspace/backend.md docs/superpowers/plans/2026-05-11-knowledge-admin-fixes.md
git commit --no-gpg-sign -m "docs(memory): knowledge admin fixes 2026-05-11 closeout"
git push origin main
```

---

## Out of scope (explicitly deferred)

- **Delete `scripts/reembed-all.js`** — old migration script that imports legacy OpenAI exports. Broken (queries dropped columns) but unused in normal ops. Cleanup later.
- **Delete `vectorSearch.service.js` legacy paths** — `loadEmbeddings`/`loadKnowledgeEmbeddings` are dead at runtime with `USE_UNIFIED_RETRIEVAL=true`, but the file is large and shared with other live code. Annotate only.
- **Remove the `embedding` field from `DataSource.model.js`** — already absent (verified). No-op.
- **Per-chunk knowledge re-embedding granularity** — Task 5's `reEmbed()` re-embeds parent + all children sequentially. For docs with 100+ chunks this is slow. Out of scope; current flow accepts the wait.

## Rollback notes

Each task ships as a single commit; `git revert <sha>` is the rollback. Task 4 has the largest blast radius (writes to retrieval_chunks). If a rollback is needed, the existing retrieval_chunks rows aren't lost — the legacy code never wrote them in the first place, so reverting to the legacy code returns the page to the broken-500 state, not data loss.

## Risk register

| Risk | Mitigation |
|---|---|
| xenova model not loaded in time after pm2 reload (15-30s warmup) | Tests have `setTimeout(60_000)`; live smoke includes `sleep 6` after reload |
| `embed-all` blocks the loop for 311 sources x ~150ms inference | Already sequential today; not a regression. Future: parallel chunks (matches Task 4 pattern from automation plan) |
| `DELETE FROM retrieval_chunks` for clearEmbedding could affect chat retrieval if mid-flight query | Negligible — chat reads via `SELECT ... ORDER BY VEC_DISTANCE_COSINE ASC LIMIT N`, missing rows just don't surface in topN |
| Concurrent embed for same source produces duplicate rows | DELETE+INSERT is not atomic. Admin clicks aren't concurrent; if needed later, add a UNIQUE on `(source_kind, source_ref_id, chunk_index)` (deferred) |
