#!/usr/bin/env node
/**
 * Rebuild retrieval_chunks so every embedding covers the text it claims to.
 *
 * The old index embedded each knowledge_base row from its first 1,500 characters
 * while rows averaged 3,508 — 57.5% of the corpus (56M of 98M chars, 98.1% of
 * chunks) had no representation in any vector. The 2016 population table sat at
 * offset 3,204 of its chunk: indexed, embedded, and unreachable.
 *
 * Windows are sized by TOKENS, not characters. This corpus runs 1.51-5.54 chars
 * per token (median 3.82); the digit-dense statistical tables that matter most sit
 * at 2.50-2.96, where 1,800 characters is already 513 tokens. No character budget
 * is safe for both prose and tables.
 *
 * Also drops the 1,334 parent rows whose text is entirely duplicated by their own
 * children (93.2M chars, each embedded as ONE vector from its first 1,500 chars).
 * They contribute nothing a child does not and crowd real chunks out of the top-N.
 * The 34 standalone parents that have no children are kept.
 *
 * Writes to a shadow table and never mutates the live one; --cutover swaps them in
 * a single atomic RENAME.
 *
 *   node scripts/rebuild-retrieval-chunks.js --status
 *   node scripts/rebuild-retrieval-chunks.js --sample 40
 *   node scripts/rebuild-retrieval-chunks.js              # full run, resumable
 *   node scripts/rebuild-retrieval-chunks.js --cutover
 *   node scripts/rebuild-retrieval-chunks.js --rollback
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sequelize = require('../src/config/db');
const { embedPassage, countTokens, EMBEDDING_MODEL } = require('../src/services/bpsMetadata/embedding.service');
const { windowByTokens } = require('../src/services/ai/tokenWindow.service');

const LIVE = 'retrieval_chunks';
const SHADOW = 'retrieval_chunks_rebuild';

// 480 leaves room under the model's 512 for the "passage: " prefix.
const MAX_TOKENS = 480;
const OVERLAP_TOKENS = 60;
const BATCH = 200;
// Measured on this box (4 cores, 3 production apps): 45 windows/min sequential,
// 82 at concurrency 2, 74 at concurrency 3 — past two workers it contends with
// production rather than adding throughput.
const CONCURRENCY = 2;

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const num = (f, d) => { const i = args.indexOf(f); return i === -1 ? d : parseInt(args[i + 1], 10) || d; };

const sql = (q, replacements) => sequelize.query(q, replacements ? { replacements } : undefined);

async function tableExists(name) {
  const [r] = await sql(
    'SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?', [name]);
  return Number(r[0].n) > 0;
}

async function status() {
  for (const t of [LIVE, SHADOW]) {
    if (!(await tableExists(t))) { console.log(`${t}: (absent)`); continue; }
    const [r] = await sql(`SELECT source_kind, COUNT(*) n FROM \`${t}\` GROUP BY source_kind`);
    const total = r.reduce((a, x) => a + Number(x.n), 0);
    console.log(`${t}: ${total} rows — ${r.map(x => `${x.source_kind}=${x.n}`).join(', ')}`);
  }
  const [k] = await sql(`SELECT COUNT(*) n FROM knowledge_base WHERE parent_id IS NOT NULL`);
  console.log(`knowledge_base children to window: ${k[0].n}`);
}

async function createShadow() {
  if (await tableExists(SHADOW)) return false;
  await sql(`CREATE TABLE \`${SHADOW}\` LIKE \`${LIVE}\``);
  console.log(`created ${SHADOW}`);
  return true;
}

/** Rows that are not knowledge: copied verbatim, their embeddings are still valid. */
async function copyNonKnowledge() {
  const [r] = await sql(
    `INSERT IGNORE INTO \`${SHADOW}\`
       (source_kind, source_ref_id, parent_chunk_id, chunk_index, title, content_text,
        metadata, embedding, embedding_model, embedding_generated_at)
     SELECT source_kind, source_ref_id, parent_chunk_id, chunk_index, title, content_text,
            metadata, embedding, embedding_model, embedding_generated_at
       FROM \`${LIVE}\` WHERE source_kind IN ('datasource','indicator_meta')`);
  const [c] = await sql(`SELECT COUNT(*) n FROM \`${SHADOW}\` WHERE source_kind IN ('datasource','indicator_meta')`);
  console.log(`carried over datasource + indicator_meta: ${c[0].n} rows`);
  return r;
}

/** knowledge_base rows worth embedding: every child, plus parents that have none. */
async function sourceRows(limit) {
  const [rows] = await sql(
    `SELECT k.id, k.parent_id, k.title, k.category, k.keywords, k.content
       FROM knowledge_base k
      WHERE k.parent_id IS NOT NULL
         OR NOT EXISTS (SELECT 1 FROM knowledge_base c WHERE c.parent_id = k.id)
      ORDER BY k.id ${limit ? `LIMIT ${Number(limit)}` : ''}`);
  return rows;
}

// Presence is not completion: a document whose first window failed to insert but
// whose second succeeded would otherwise be skipped for ever, leaving a hole that
// nothing reports. Each window records how many windows its document has, so a
// document counts as done only when it is all there.
async function alreadyDone() {
  const [rows] = await sql(
    `SELECT source_ref_id, COUNT(*) got, MAX(JSON_EXTRACT(metadata,'$.windows')) want
       FROM \`${SHADOW}\` WHERE source_kind IN ('knowledge_doc','knowledge_chunk')
      GROUP BY source_ref_id`);
  const done = new Set();
  const partial = [];
  for (const r of rows) {
    if (Number(r.got) === Number(r.want)) done.add(Number(r.source_ref_id));
    else partial.push(Number(r.source_ref_id));
  }
  if (partial.length) {
    // Clear the partial ones so they are rebuilt whole rather than topped up.
    await sql(
      `DELETE FROM \`${SHADOW}\` WHERE source_kind IN ('knowledge_doc','knowledge_chunk') AND source_ref_id IN (${partial.map(() => '?').join(',')})`,
      partial);
    console.log(`cleared ${partial.length} partially written document(s) for rebuild`);
  }
  return done;
}

async function run() {
  const sample = num('--sample', 0);
  await createShadow();
  await copyNonKnowledge();

  const rows = await sourceRows(sample);
  const done = await alreadyDone();
  const todo = rows.filter(r => !done.has(Number(r.id)));
  console.log(`source rows: ${rows.length}, already embedded: ${rows.length - todo.length}, to do: ${todo.length}`);

  let windows = 0, docs = 0, failed = 0;
  const t0 = Date.now();

  // Two workers inserting into a table carrying a VECTOR KEY deadlocked within
  // seconds, and a lost insert is a hole in the index rather than a slow run. The
  // expensive half is embedding, so that stays concurrent while writes are taken
  // one at a time; the retry is the net under the remaining contention.
  let writeLock = Promise.resolve();
  function withWriteLock(fn) {
    const run = writeLock.then(fn, fn);
    writeLock = run.then(() => undefined, () => undefined);
    return run;
  }

  async function insertWindow(params, label) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        return await withWriteLock(() => sql(
          `INSERT IGNORE INTO \`${SHADOW}\`
             (source_kind, source_ref_id, parent_chunk_id, chunk_index, title, content_text,
              metadata, embedding, embedding_model, embedding_generated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, VEC_FromText(?), ?, NOW())`, params));
      } catch (e) {
        const retryable = /deadlock|lock wait timeout/i.test(e.message || '');
        if (!retryable || attempt === 4) throw e;
        await new Promise(r => setTimeout(r, 150 * attempt));
      }
    }
  }

  async function processRow(r) {
    const kind = r.parent_id == null ? 'knowledge_doc' : 'knowledge_chunk';
    const body = String(r.content || '').trim();
    if (!body) return;

    let parts;
    try {
      parts = await windowByTokensAsync(body, r.title);
    } catch (e) {
      console.error(`  window fail kb=${r.id}: ${e.message}`); failed++; return;
    }

    for (let w = 0; w < parts.length; w++) {
      // The title carries the period that parseDocPeriod reads, so it is embedded
      // with every window rather than only the first.
      const text = `${r.title}\n\n${parts[w]}`;
      try {
        const emb = await embedPassage(text);
        await insertWindow([
          kind, r.id, r.parent_id, w, r.title, parts[w],
          JSON.stringify({ category: r.category || null, keywords: r.keywords || null, window: w, windows: parts.length }),
          JSON.stringify(emb), EMBEDDING_MODEL,
        ]);
        windows++;
      } catch (e) {
        console.error(`  embed fail kb=${r.id} w=${w}: ${e.message}`); failed++;
      }
    }
    docs++;
    if (docs % 50 === 0) {
      const mins = (Date.now() - t0) / 60000;
      const rate = docs / mins;
      const eta = (todo.length - docs) / Math.max(rate, 0.01);
      console.log(`  ${docs}/${todo.length} docs · ${windows} windows · ${(windows / mins).toFixed(0)} win/min · ETA ${(eta / 60).toFixed(1)}h · failed ${failed}`);
    }
  }

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    await Promise.all(todo.slice(i, i + CONCURRENCY).map(processRow));
  }
  console.log(`\ndone: ${docs} docs → ${windows} windows, ${failed} failures, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}

// Windows are ESTIMATED cheaply and then VERIFIED against the real tokenizer.
//
// Estimation alone was not good enough, and the failure was silent in exactly the
// way this rebuild exists to remove: a first attempt subtracted the tokenizer's
// per-line [CLS]/[SEP] pair from summed line counts and produced 166 of 394
// windows over the 512-token limit (max 593). Two causes — the correction
// over-shot, and the document title is prepended at embed time but was never
// charged to the budget. A window that overflows is truncated by the model and its
// tail becomes unsearchable, which is the original bug wearing a new hat.
//
// So the tokenizer is the gate, not the estimate: any window that does not fit is
// halved until it does. Halving always terminates and needs no ratio to be right.
const HARD_LIMIT = 512;

async function windowByTokensAsync(text, title) {
  const prefix = `passage: ${title}\n\n`;
  const prefixTokens = await countTokens(prefix);
  // Charge the title to the budget, and keep headroom for estimator error.
  const budget = Math.max(64, MAX_TOKENS - prefixTokens);

  const lines = String(text).split('\n').map(x => x.trim()).filter(Boolean);
  const cache = new Map();
  let minRatio = Infinity;
  for (const l of lines) {
    if (!cache.has(l)) {
      const t = await countTokens(l);
      cache.set(l, t);
      if (t > 0) minRatio = Math.min(minRatio, l.length / t);
    }
  }
  const ratio = Math.max(1.4, Math.min(minRatio === Infinity ? 3 : minRatio, 6));
  const SPECIAL_TOKENS_PER_LINE = 2;
  const est = (x) => {
    const str = String(x);
    if (cache.has(str)) return cache.get(str);
    if (str.includes('\n')) {
      const parts = str.split('\n');
      const sum = parts.reduce((a, q) => a + est(q), 0);
      return Math.max(1, sum - SPECIAL_TOKENS_PER_LINE * (parts.length - 1));
    }
    return Math.ceil(str.length / ratio);
  };

  const draft = windowByTokens(text, { maxTokens: budget, overlapTokens: OVERLAP_TOKENS, countTokens: est });

  const verified = [];
  const queue = [...draft];
  while (queue.length) {
    const piece = queue.shift();
    const real = await countTokens(prefix + piece);
    if (real <= HARD_LIMIT) { verified.push(piece); continue; }
    const lines2 = piece.split('\n');
    if (lines2.length > 1) {
      const mid = Math.ceil(lines2.length / 2);
      queue.unshift(lines2.slice(0, mid).join('\n'), lines2.slice(mid).join('\n'));
      continue;
    }
    const words = piece.split(/\s+/);
    if (words.length > 1) {
      const mid = Math.ceil(words.length / 2);
      queue.unshift(words.slice(0, mid).join(' '), words.slice(mid).join(' '));
      continue;
    }
    verified.push(piece); // a single token-dense word; nothing left to split
  }
  return verified;
}

async function cutover() {
  if (!(await tableExists(SHADOW))) throw new Error(`${SHADOW} does not exist`);
  const [s] = await sql(`SELECT COUNT(*) n FROM \`${SHADOW}\``);
  const [l] = await sql(`SELECT COUNT(*) n FROM \`${LIVE}\``);
  console.log(`shadow=${s[0].n} rows, live=${l[0].n} rows`);
  if (Number(s[0].n) < 1000) throw new Error('shadow table looks incomplete; refusing to cut over');
  await sql(`RENAME TABLE \`${LIVE}\` TO \`${LIVE}_old\`, \`${SHADOW}\` TO \`${LIVE}\``);
  console.log(`cut over. previous table kept as ${LIVE}_old`);
}

async function rollback() {
  if (!(await tableExists(`${LIVE}_old`))) throw new Error(`${LIVE}_old does not exist`);
  await sql(`RENAME TABLE \`${LIVE}\` TO \`${SHADOW}\`, \`${LIVE}_old\` TO \`${LIVE}\``);
  console.log('rolled back');
}

(async () => {
  if (has('--status')) await status();
  else if (has('--cutover')) await cutover();
  else if (has('--rollback')) await rollback();
  else await run();
  await sequelize.close();
  process.exit(0);
})().catch(e => { console.error('FATAL', e.stack); process.exit(1); });
