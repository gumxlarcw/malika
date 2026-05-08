#!/usr/bin/env node
'use strict';
/**
 * One-shot backfill: re-embed knowledge_base + data_sources via the self-hosted
 * Xenova/multilingual-e5-large (1024d) ONNX model and write into retrieval_chunks.
 *
 * Idempotent: INSERT IGNORE on UNIQUE KEY (source_kind, source_ref_id, chunk_index).
 * Resume-safe: rowExists check skips rows already in retrieval_chunks.
 *
 * Imports bpsMetadata embedding service directly. Calls embedPassage (the
 * passage-side prompt convention) — query-side prompt is reserved for chat-time.
 *
 * Concurrency: 3 workers (CPU-bound on 4-core Haswell, no API keys to rotate).
 * No per-worker throttle needed; the ONNX runtime saturates available threads.
 *
 * ETA at our scale: ~28K rows × ~110 ms/row / 3 workers ≈ ~17 min wall-clock,
 * but real wall-clock will be higher (model warm-up + DB write latency).
 * Original spec budgeted 2.5-3 h; expect well under that.
 */

const sequelize = require('../src/config/db');
const KB = require('../src/models/KnowledgeBase.model');
const DS = require('../src/models/DataSource.model');
const { embedPassage, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } = require('../src/services/bpsMetadata/embedding.service');

const CONCURRENCY = 1;  // reduced from 3 — ONNX runtime auto-uses all 4 cores per single inference; multiple JS workers serialize at the runtime layer and just add memory pressure
const PER_WORKER_THROTTLE_MS = 0;
const PROGRESS_EVERY = 200;

function buildKnowledgeText(r) {
  return [r.title, r.keywords, r.content]
    .filter(Boolean)
    .map(s => String(s).slice(0, 8000))
    .join('\n')
    .slice(0, 8000);
}

function buildDatasourceText(r) {
  return [r.name, r.description, r.aliases, r.category]
    .filter(Boolean)
    .map(s => String(s).trim())
    .join('. ')
    .slice(0, 8000);
}

async function processInParallel(items, workerFn, concurrency) {
  let nextIdx = 0;
  const totals = { ok: 0, skipped: 0, fail: 0, total: items.length };
  const workers = [];
  for (let w = 0; w < concurrency; w++) {
    workers.push((async () => {
      while (true) {
        const i = nextIdx++;
        if (i >= items.length) break;
        const result = await workerFn(items[i]);
        totals[result]++;
        if ((totals.ok + totals.skipped) % PROGRESS_EVERY === 0) {
          console.log(`[parallel] ok=${totals.ok} skip=${totals.skipped} fail=${totals.fail} total=${totals.ok + totals.skipped + totals.fail}/${totals.total}`);
        }
        await new Promise(res => setTimeout(res, PER_WORKER_THROTTLE_MS));
      }
    })());
  }
  await Promise.all(workers);
  return totals;
}

async function getExistingKbKeys() {
  const [rows] = await sequelize.query(
    `SELECT source_kind, source_ref_id, chunk_index FROM retrieval_chunks
     WHERE source_kind IN ('knowledge_doc','knowledge_chunk')`
  );
  const set = new Set();
  for (const r of rows) set.add(`${r.source_kind}:${r.source_ref_id}:${r.chunk_index}`);
  return set;
}

async function getExistingDsKeys() {
  const [rows] = await sequelize.query(
    `SELECT source_ref_id FROM retrieval_chunks WHERE source_kind='datasource'`
  );
  const set = new Set();
  for (const r of rows) set.add(String(r.source_ref_id));
  return set;
}

async function processKnowledgeRow(r, existing) {
  const kind = r.parent_id == null ? 'knowledge_doc' : 'knowledge_chunk';
  const chunkIdx = r.chunk_index || 0;
  if (existing.has(`${kind}:${r.id}:${chunkIdx}`)) return 'skipped';

  const text = buildKnowledgeText(r);
  if (!text) return 'skipped';

  try {
    const emb = await embedPassage(text);
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
    return 'ok';
  } catch (err) {
    console.error(`  fail kb_id=${r.id}: ${err.message}`);
    return 'fail';
  }
}

async function processDatasourceRow(r, existing) {
  if (existing.has(String(r.id))) return 'skipped';
  const text = buildDatasourceText(r);
  if (!text) return 'skipped';

  try {
    const emb = await embedPassage(text);
    const metadata = { category: r.category, type: r.type };
    await sequelize.query(
      `INSERT IGNORE INTO retrieval_chunks
        (source_kind, source_ref_id, chunk_index, title, content_text, metadata, embedding, embedding_model, embedding_generated_at)
       VALUES ('datasource', ?, 0, ?, ?, ?, VEC_FromText(?), ?, NOW())`,
      { replacements: [r.id, r.name, r.description || '', JSON.stringify(metadata), JSON.stringify(emb), EMBEDDING_MODEL] }
    );
    return 'ok';
  } catch (err) {
    console.error(`  fail ds_id=${r.id}: ${err.message}`);
    return 'fail';
  }
}

(async () => {
  const startedAt = Date.now();
  console.log(`Backfill starting. model=${EMBEDDING_MODEL} dim=${EMBEDDING_DIMENSIONS} concurrency=${CONCURRENCY}`);

  // Knowledge base
  console.log('[kb] loading rows + existing-keys index...');
  const kbExisting = await getExistingKbKeys();
  console.log(`[kb] ${kbExisting.size} rows already in retrieval_chunks (will skip)`);

  const kbRows = await KB.findAll({
    attributes: ['id', 'parent_id', 'chunk_index', 'title', 'content', 'category', 'keywords', 'indicator_index'],
    order: [['id', 'ASC']],
  });
  console.log(`[kb] ${kbRows.length} rows to consider`);

  const kbResult = await processInParallel(
    kbRows,
    (r) => processKnowledgeRow(r, kbExisting),
    CONCURRENCY
  );
  console.log(`[kb] done`, kbResult);

  // Data sources
  const dsExisting = await getExistingDsKeys();
  const dsRows = await DS.findAll({
    where: { status: true },
    attributes: ['id', 'name', 'description', 'aliases', 'category', 'type'],
  });
  const dsResult = await processInParallel(
    dsRows,
    (r) => processDatasourceRow(r, dsExisting),
    CONCURRENCY
  );
  console.log(`[ds] done`, dsResult);

  const elapsedMin = ((Date.now() - startedAt) / 1000 / 60).toFixed(1);
  console.log(`Done. Elapsed: ${elapsedMin} min`);
  await sequelize.close();
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
