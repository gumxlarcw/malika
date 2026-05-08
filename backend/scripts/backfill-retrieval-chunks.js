#!/usr/bin/env node
'use strict';
/**
 * One-shot backfill: re-embed knowledge_base + data_sources via Gemini
 * (gemini-embedding-001, 768d) and write into retrieval_chunks.
 *
 * Idempotent: INSERT IGNORE on UNIQUE KEY (source_kind, source_ref_id, chunk_index).
 * Safe to interrupt and resume.
 *
 * Imports bpsMetadata embedding service directly to avoid coupling with the
 * still-OpenAI services/ai/embedding.service.js. After Phase C cutover, that
 * file becomes a Gemini wrapper too.
 *
 * Throttle: 80ms sleep between calls, 10-key round-robin → ~50 req/sec aggregate.
 * 28K rows × 80ms = ~37 min wall-clock.
 */

const sequelize = require('../src/config/db');
const KB = require('../src/models/KnowledgeBase.model');
const DS = require('../src/models/DataSource.model');
const { generateEmbedding, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } = require('../src/services/bpsMetadata/embedding.service');

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
      total++;
      if (await rowExists(kind, r.id, chunkIdx)) { skipped++; continue; }

      const text = buildKnowledgeText(r);
      if (!text) { skipped++; continue; }

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
      if (ok % 100 === 0 && ok > 0) console.log(`[backfill][kb] ok=${ok} skip=${skipped} fail=${fail} total=${total}`);
      await new Promise(res => setTimeout(res, THROTTLE_MS));
    }
    offset += rows.length;
    if (rows.length < BATCH) break;
  }
  return { ok, skipped, fail, total };
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
