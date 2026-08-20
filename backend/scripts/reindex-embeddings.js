#!/usr/bin/env node
/**
 * Re-embed retrieval_chunks with a different model, into a shadow table.
 *
 * Measured on 50 labelled cases (ranking only — answer documents force-included,
 * so this isolates ordering from recall):
 *   e5-base  recall@5 42% · recall@10 60% · MRR 0.258
 *   bge-m3   recall@5 60% · recall@10 80% · MRR 0.338
 *
 * The model change is not a hot swap: bge-m3 emits 1024 dims against the live
 * column's 768, so the whole index has to be rebuilt before anything can use it.
 * Live is never touched; --cutover swaps in one RENAME and --rollback swaps back.
 *
 *   EMBEDDING_MODEL_ID=Xenova/bge-m3 node scripts/reindex-embeddings.js --status
 *   EMBEDDING_MODEL_ID=Xenova/bge-m3 node scripts/reindex-embeddings.js
 *   EMBEDDING_MODEL_ID=Xenova/bge-m3 node scripts/reindex-embeddings.js --cutover
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sequelize = require('../src/config/db');
const {
  embedPassage, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, EMBEDDING_PREFIX,
} = require('../src/services/bpsMetadata/embedding.service');

const LIVE = 'retrieval_chunks';
const TARGET = process.env.REINDEX_TARGET || 'retrieval_chunks_bge';
const BATCH = 500;

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const sql = (q, r) => sequelize.query(q, r ? { replacements: r } : undefined);

async function exists(t) {
  const [r] = await sql('SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?', [t]);
  return Number(r[0].n) > 0;
}

/** CREATE TABLE LIKE cannot change the vector width, so the DDL is rewritten. */
async function createTarget() {
  if (await exists(TARGET)) return false;
  const [r] = await sql(`SHOW CREATE TABLE \`${LIVE}\``);
  let ddl = Object.values(r[0])[1];
  ddl = ddl.replace(/CREATE TABLE `[^`]+`/, `CREATE TABLE \`${TARGET}\``)
           .replace(/vector\(\d+\)/gi, `vector(${EMBEDDING_DIMENSIONS})`)
           .replace(/AUTO_INCREMENT=\d+\s*/i, '');
  await sql(ddl);
  console.log(`created ${TARGET} with vector(${EMBEDDING_DIMENSIONS})`);
  return true;
}

async function status() {
  console.log(`model : ${EMBEDDING_MODEL} (${EMBEDDING_DIMENSIONS}d, prefix ${JSON.stringify(EMBEDDING_PREFIX)})`);
  const [l] = await sql(`SELECT COUNT(*) n FROM \`${LIVE}\``);
  console.log(`${LIVE}: ${l[0].n} rows (live, untouched)`);
  if (!(await exists(TARGET))) return console.log(`${TARGET}: (absent)`);
  const [t] = await sql(`SELECT COUNT(*) n FROM \`${TARGET}\``);
  const pct = (100 * Number(t[0].n) / Number(l[0].n)).toFixed(1);
  console.log(`${TARGET}: ${t[0].n} rows (${pct}%)`);
}

async function run() {
  if (!EMBEDDING_DIMENSIONS) throw new Error(`unknown dimensions for ${EMBEDDING_MODEL}`);
  await createTarget();

  const [done] = await sql(`SELECT source_kind, source_ref_id, chunk_index FROM \`${TARGET}\``);
  const seen = new Set(done.map(r => `${r.source_kind}:${r.source_ref_id}:${r.chunk_index}`));
  const [rows] = await sql(
    `SELECT source_kind, source_ref_id, parent_chunk_id, chunk_index, title, content_text, metadata
       FROM \`${LIVE}\` ORDER BY id`);
  const todo = rows.filter(r => !seen.has(`${r.source_kind}:${r.source_ref_id}:${r.chunk_index}`));
  console.log(`${EMBEDDING_MODEL}: ${rows.length} rows, ${rows.length - todo.length} already done, ${todo.length} to embed`);

  const t0 = Date.now();
  let n = 0, failed = 0;
  for (const r of todo) {
    try {
      // Same text the row already carries: this isolates the model change.
      const emb = await embedPassage(`${r.title}\n${r.content_text}`);
      await sql(
        `INSERT IGNORE INTO \`${TARGET}\`
           (source_kind, source_ref_id, parent_chunk_id, chunk_index, title, content_text,
            metadata, embedding, embedding_model, embedding_generated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, VEC_FromText(?), ?, NOW())`,
        [r.source_kind, r.source_ref_id, r.parent_chunk_id, r.chunk_index, r.title,
         r.content_text, r.metadata, JSON.stringify(emb), EMBEDDING_MODEL]);
    } catch (e) {
      failed++;
      if (failed <= 5) console.error(`  fail ${r.source_kind}:${r.source_ref_id}: ${e.message.slice(0, 90)}`);
    }
    if (++n % BATCH === 0) {
      const rate = n / ((Date.now() - t0) / 60000);
      console.log(`  ${n}/${todo.length} · ${rate.toFixed(0)}/min · ETA ${((todo.length - n) / rate / 60).toFixed(1)}h · failed ${failed}`);
    }
  }
  console.log(`\ndone: ${n} embedded, ${failed} failures, ${((Date.now() - t0) / 3600000).toFixed(1)}h`);
}

async function cutover() {
  const [t] = await sql(`SELECT COUNT(*) n FROM \`${TARGET}\``);
  const [l] = await sql(`SELECT COUNT(*) n FROM \`${LIVE}\``);
  if (Number(t[0].n) < Number(l[0].n) * 0.99) {
    throw new Error(`${TARGET} has ${t[0].n} of ${l[0].n} rows — refusing to cut over an incomplete index`);
  }
  await sql(`RENAME TABLE \`${LIVE}\` TO \`${LIVE}_old\`, \`${TARGET}\` TO \`${LIVE}\``);
  console.log(`cut over. previous index kept as ${LIVE}_old — set EMBEDDING_MODEL_ID in .env and reload pds-backend.`);
}

async function rollback() {
  await sql(`RENAME TABLE \`${LIVE}\` TO \`${TARGET}\`, \`${LIVE}_old\` TO \`${LIVE}\``);
  console.log('rolled back');
}

(async () => {
  if (has('--status')) await status();
  else if (has('--cutover')) await cutover();
  else if (has('--rollback')) await rollback();
  else await run();
  await sequelize.close(); process.exit(0);
})().catch(e => { console.error('FATAL', e.stack); process.exit(1); });
