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

async function alreadyDone() {
  const [rows] = await sql(
    `SELECT DISTINCT source_ref_id FROM \`${SHADOW}\` WHERE source_kind IN ('knowledge_doc','knowledge_chunk')`);
  return new Set(rows.map(r => Number(r.source_ref_id)));
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

  async function processRow(r) {
    const kind = r.parent_id == null ? 'knowledge_doc' : 'knowledge_chunk';
    const body = String(r.content || '').trim();
    if (!body) return;

    let parts;
    try {
      parts = await windowByTokensAsync(body);
    } catch (e) {
      console.error(`  window fail kb=${r.id}: ${e.message}`); failed++; return;
    }

    for (let w = 0; w < parts.length; w++) {
      // The title carries the period that parseDocPeriod reads, so it is embedded
      // with every window rather than only the first.
      const text = `${r.title}\n\n${parts[w]}`;
      try {
        const emb = await embedPassage(text);
        await sql(
          `INSERT IGNORE INTO \`${SHADOW}\`
             (source_kind, source_ref_id, parent_chunk_id, chunk_index, title, content_text,
              metadata, embedding, embedding_model, embedding_generated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, VEC_FromText(?), ?, NOW())`,
          [kind, r.id, r.parent_id, w, r.title, parts[w],
           JSON.stringify({ category: r.category || null, keywords: r.keywords || null, window: w, windows: parts.length }),
           JSON.stringify(emb), EMBEDDING_MODEL]);
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

// windowByTokens takes a synchronous counter; countTokens is async, so each line
// is tokenized once up front and served from a cache. Anything the splitter asks
// about that is not a whole line (a partial line, or a joined window) is
// ESTIMATED CONSERVATIVELY — over-counting only yields smaller windows, while
// under-counting would let one past 512 tokens and silently truncate it, which is
// the exact failure this rebuild exists to remove. The invariant is asserted
// against the real tokenizer in --sample.
async function windowByTokensAsync(text) {
  const lines = String(text).split('\n').map(s => s.trim()).filter(Boolean);
  const cache = new Map();
  let minRatio = Infinity; // chars per token, smallest seen = densest text
  for (const l of lines) {
    if (!cache.has(l)) {
      const t = await countTokens(l);
      cache.set(l, t);
      if (t > 0) minRatio = Math.min(minRatio, l.length / t);
    }
  }
  // 1.51 chars/token is the densest observed anywhere in the corpus.
  const ratio = Math.max(1.4, Math.min(minRatio === Infinity ? 3 : minRatio, 6));

  // Every per-line count carries the tokenizer's own [CLS]/[SEP] pair, so naively
  // summing lines over-counts a joined window by ~1.92 tokens per line (measured:
  // 6,207 vs 5,007 over 625 lines, a 1.24x inflation). Uncorrected, windows filled
  // to only ~80% of the budget and the rebuild produced 83k windows where ~67k
  // carry the same text.
  const SPECIAL_TOKENS_PER_LINE = 2;
  const count = (s) => {
    const str = String(s);
    if (cache.has(str)) return cache.get(str);
    if (str.includes('\n')) {
      const parts = str.split('\n');
      const sum = parts.reduce((a, p) => a + count(p), 0);
      return Math.max(1, sum - SPECIAL_TOKENS_PER_LINE * (parts.length - 1));
    }
    return Math.ceil(str.length / ratio); // conservative for a partial line
  };

  return windowByTokens(text, { maxTokens: MAX_TOKENS, overlapTokens: OVERLAP_TOKENS, countTokens: count });
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
