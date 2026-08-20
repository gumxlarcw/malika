#!/usr/bin/env node
/**
 * Does a stronger bi-encoder rank this corpus better?
 *
 * e5-base gets the known failure backwards: for "kepadatan penduduk Kota Ternate
 * 2016" it scores the inflation release ABOVE the density table (-0.0034). e5-large
 * (+0.0328) and bge-m3 (+0.0417) both get it right. This measures whether that holds
 * across the 50 labelled cases.
 *
 * Ranking only, not recall: candidates come from the existing index, and the answer
 * documents are force-included, so this asks "given these documents, does the model
 * order them better?" A model could also improve recall by retrieving things the
 * current one never surfaces, and that is NOT measured here — it would need a full
 * re-index (42 h for the live table at 5.2 s/doc).
 *
 *   node scripts/eval-bi-encoder.js --cand 30
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const sequelize = require('../src/config/db');
const { searchRetrieval } = require('../src/services/ai/retrieval.service');
const { dedupeBySourceRef } = require('../src/services/ai/vectorSearch.service');

const args = process.argv.slice(2);
const num = (f, d) => { const i = args.indexOf(f); return i === -1 ? d : parseInt(args[i + 1], 10) || d; };
const CAND = num('--cand', 30);
const CLIP = 1500; // what the live index effectively embedded
// Embeddings are checkpointed to disk. The first run of this script lost 700 of 1,444
// documents when the session that owned it exited — hours of compute held only in
// memory. At 5.2 s/doc for e5-large that is not a risk worth re-taking.
const CACHE_DIR = process.env.BIENC_CACHE || path.join(__dirname, '..', 'backups', 'bienc-cache');
const CHECKPOINT_EVERY = 50;

const ALL_MODELS = {
  'e5-base': { id: 'Xenova/multilingual-e5-base', q: 'query: ', p: 'passage: ' },
  'e5-large': { id: 'Xenova/multilingual-e5-large', q: 'query: ', p: 'passage: ' },
  // bge-m3 takes no prefix, and emits 1024 dims — adopting it needs the vector
  // column widened from 768.
  'bge-m3': { id: 'Xenova/bge-m3', q: '', p: '' },
};
const pick = (() => { const i = args.indexOf('--models'); return i === -1 ? null : args[i + 1]; })();
const MODELS = (pick ? pick.split(',') : ['e5-base', 'e5-large'])
  .map(k => ALL_MODELS[k] || (() => { throw new Error(`unknown model "${k}"`); })());

const norm = x => String(x || '').replace(/\s+/g, ' ').toLowerCase();
const sat = (t, mm) => { const x = norm(t); return mm.every(m => x.includes(norm(m))); };
const cos = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; };

(async () => {
  const { pipeline, env } = await import('@xenova/transformers');
  env.allowRemoteModels = true;

  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'evals/fixtures/retrieval-deepdoc-cases.json'), 'utf8')).cases;
  const [kb] = await sequelize.query(
    `SELECT id, title, content FROM knowledge_base
      WHERE parent_id IS NOT NULL
         OR NOT EXISTS (SELECT 1 FROM knowledge_base c WHERE c.parent_id = knowledge_base.id)`);
  const byId = new Map(kb.map(r => [Number(r.id), r]));
  const truth = new Map(cases.map(c => [c.id, new Set(kb.filter(r => sat(r.content, c.must_match)).map(r => Number(r.id)))]));

  // Build one candidate set per case, from the CURRENT index, with answers forced in.
  console.log(`building candidate sets (top ${CAND} + answer documents)...`);
  const sets = [];
  const need = new Set();
  for (const c of cases) {
    const { results } = await searchRetrieval(c.query, { topN: 200 });
    const docs = dedupeBySourceRef(results.map(r => ({ ...r, id: Number(r.sourceRefId) }))).slice(0, CAND);
    const ids = new Set(docs.map(d => Number(d.id)));
    for (const t of truth.get(c.id)) ids.add(t);           // force answers in: this measures ranking
    const kept = [...ids].filter(id => byId.has(id));
    kept.forEach(id => need.add(id));
    sets.push({ c, ids: kept });
  }
  console.log(`unique documents to embed: ${need.size}\n`);

  for (const M of MODELS) {
    const pipe = await pipeline('feature-extraction', M.id, { quantized: true });
    const emb = async (t) => Array.from((await pipe(t, { pooling: 'mean', normalize: true })).data);
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const cacheFile = path.join(CACHE_DIR, `${M.id.replace(/[^\w.-]/g, '_')}.json`);
    let vec = new Map();
    if (fs.existsSync(cacheFile)) {
      vec = new Map(Object.entries(JSON.parse(fs.readFileSync(cacheFile, 'utf8'))).map(([k, v]) => [Number(k), v]));
      console.log(`  ${M.id}: resumed ${vec.size} cached embeddings`);
    }
    const save = () => fs.writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(vec)));
    const t0 = Date.now();
    let n = 0, fresh = 0;
    for (const id of need) {
      n++;
      if (vec.has(id)) continue;
      const r = byId.get(id);
      vec.set(id, await emb(M.p + `${r.title}\n${r.content}`.slice(0, CLIP)));
      if (++fresh % CHECKPOINT_EVERY === 0) {
        save();
        const rate = fresh / ((Date.now() - t0) / 60000);
        process.stdout.write(`  ${M.id}: ${n}/${need.size} (${fresh} new, ${rate.toFixed(0)}/min, ETA ${((need.size - n) / Math.max(rate, 0.1)).toFixed(0)}m)\r`);
      }
    }
    save();
    let r5 = 0, r10 = 0, mrr = 0;
    for (const { c, ids } of sets) {
      const qv = await emb(M.q + c.query);
      const ranked = ids.map(id => ({ id, s: cos(qv, vec.get(id)) })).sort((a, b) => b.s - a.s);
      const i = ranked.findIndex(x => truth.get(c.id).has(x.id)) + 1;
      if (i > 0 && i <= 5) r5++; if (i > 0 && i <= 10) r10++; if (i > 0) mrr += 1 / i;
    }
    const N = cases.length;
    console.log(`\n${M.id.padEnd(30)} recall@5 ${r5}/${N} (${(100*r5/N).toFixed(0)}%) · recall@10 ${r10}/${N} (${(100*r10/N).toFixed(0)}%) · MRR ${(mrr/N).toFixed(3)} · ${((Date.now()-t0)/60000).toFixed(0)}m`);
  }
  await sequelize.close(); process.exit(0);
})().catch(e => { console.error('FATAL', e.stack); process.exit(1); });
