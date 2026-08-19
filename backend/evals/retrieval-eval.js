#!/usr/bin/env node
/**
 * Knowledge-base retrieval eval.
 *
 * Answers one question: when a fact exists in the corpus, does retrieval return
 * the chunk that holds it? Reports recall@5, recall@10, MRR and — deliberately —
 * the similarity SPREAD of the top 10.
 *
 * Spread is here because the failure being measured is not "wrong answer" but
 * "no discrimination": the observed top-10 band is ~0.02 wide, so a change can
 * reorder results without the ranking meaning anything more than before. A lane
 * that improves recall while the spread stays flat has probably got lucky.
 *
 * Ground truth is a content predicate, never a chunk id — re-chunking renumbers
 * every chunk, and that is one of the changes this harness exists to judge.
 *
 * Usage:
 *   node evals/retrieval-eval.js --validate     # check labels, no retrieval
 *   node evals/retrieval-eval.js                # run, print table
 *   node evals/retrieval-eval.js --json out.json
 *   node evals/retrieval-eval.js --topn 20 --case kepadatan-ternate-2016
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const fs = require('fs');
const sequelize = require('../src/config/db');
const { searchRetrieval } = require('../src/services/ai/retrieval.service');
const { parseDocPeriod, parseQuarterFromText, selectDocsByPeriod } = require('../src/services/chat/chatUtils');

const FIXTURE = path.join(__dirname, 'fixtures', 'retrieval-deepdoc-cases.json');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i === -1 || i + 1 >= args.length ? d : args[i + 1]; };

const TOP_N = parseInt(val('--topn', '10'), 10);
const ONLY = val('--case', null);
const JSON_OUT = val('--json', null);
// --period: fetch a wide pool, re-rank by period, then trim to TOP_N. This is the
// lane the chat path will use; without it the run measures raw vector order.
const PERIOD = has('--period');
const POOL = parseInt(val('--pool', '50'), 10);

// The chat path takes year/month from query_builder. Here they are read from the
// query text with the same parser used on document titles, so the eval does not
// depend on the LLM intent call being available.
function queryPeriod(q) {
  const p = parseDocPeriod(q) || {};
  const year = p.year || null;
  let month = p.month && p.month >= 1 ? p.month : null;
  if (!month) {
    const quarter = parseQuarterFromText ? parseQuarterFromText(q) : null;
    if (quarter && quarter.monthStart) month = null; // a quarter spans months; year alone is the safe key
  }
  return { year, month };
}

// PDF-extracted text carries erratic spacing; compare on collapsed whitespace.
const norm = (s) => String(s || '').replace(/\s+/g, ' ').toLowerCase();
const satisfies = (text, mustMatch) => {
  const t = norm(text);
  return mustMatch.every(m => t.includes(norm(m)));
};

async function validate(cases) {
  console.log('Validating labels against the corpus\n');
  const [rows] = await sequelize.query(
    "SELECT id, title, content_text FROM retrieval_chunks WHERE source_kind IN ('knowledge_chunk','knowledge_doc')"
  );
  console.log(`corpus: ${rows.length} chunks\n`);

  // A predicate matching many chunks is not automatically bad: BPS reprints the
  // same table across publications, and retrieving ANY chunk that carries the
  // answer is a genuine success. What actually corrupts the metric is a predicate
  // loose enough that random retrieval would satisfy it — so the criterion is the
  // random-hit baseline, not a raw cap.
  //   p = matches / corpus;  random recall@10 = 1 - (1-p)^10
  const RANDOM_RECALL_CEILING = 0.10;

  let bad = 0;
  console.log('case                            matches   share   rand@10  verdict');
  console.log('─'.repeat(76));
  for (const c of cases) {
    const hits = rows.filter(r => satisfies(r.content_text, c.must_match));
    const p = hits.length / rows.length;
    const rand10 = 1 - Math.pow(1 - p, 10);
    let verdict;
    if (hits.length === 0) { verdict = 'BROKEN — no chunk contains this'; bad++; }
    else if (rand10 > RANDOM_RECALL_CEILING) { verdict = 'TOO LOOSE — chance alone would pass'; bad++; }
    else verdict = 'ok';
    console.log(
      `${c.id.padEnd(30)} ${String(hits.length).padStart(6)}  ${(100 * p).toFixed(2).padStart(6)}%  ${(100 * rand10).toFixed(1).padStart(6)}%  ${verdict}`
    );
    if (hits.length > 0 && hits.length <= 3) {
      hits.slice(0, 2).forEach(h => console.log(`${' '.repeat(32)}└ ${String(h.title).slice(0, 74)}`));
    }
  }
  console.log('─'.repeat(76));
  console.log(bad === 0
    ? `all labels usable (random recall@10 stays under ${100 * RANDOM_RECALL_CEILING}%)`
    : `${bad} label(s) need attention`);
  return bad;
}

async function run(cases) {
  const results = [];
  for (const c of cases) {
    const fetchN = PERIOD ? POOL : TOP_N;
    const { results: raw } = await searchRetrieval(c.query, { topN: fetchN });
    let hits = raw;
    if (PERIOD) {
      const { year, month } = queryPeriod(c.query);
      hits = selectDocsByPeriod(raw, { year, month, limit: TOP_N });
    }
    const rank = hits.findIndex(h => satisfies(h.content, c.must_match)) + 1; // 0 = miss
    // Spread is always taken from the RAW vector order, never the re-ranked list:
    // it measures how well the lane separates candidates, and a re-rank that lifts
    // a lower-similarity document would otherwise report a negative "spread" and
    // look like improved discrimination when nothing about the lane changed.
    const sims = raw.slice(0, TOP_N).map(h => h.similarity);
    results.push({
      id: c.id,
      difficulty: c.difficulty,
      topic: c.topic,
      query: c.query,
      rank: rank || null,
      hit5: rank > 0 && rank <= 5,
      hit10: rank > 0 && rank <= 10,
      rr: rank > 0 ? 1 / rank : 0,
      simTop1: sims[0] ?? null,
      simTopN: sims[sims.length - 1] ?? null,
      spread: sims.length > 1 ? sims[0] - sims[sims.length - 1] : null,
      top1Title: hits[0] ? String(hits[0].title).slice(0, 60) : null,
    });
    process.stderr.write(`  ${c.id} → ${rank ? '#' + rank : 'MISS'}\n`);
  }
  return results;
}

function report(results) {
  const n = results.length;
  const pct = (x) => (100 * x / n).toFixed(1) + '%';
  const avg = (f) => results.reduce((a, r) => a + (f(r) || 0), 0) / n;

  console.log('\nid                              diff        rank   sim@1   spread  top-1 result');
  console.log('─'.repeat(104));
  for (const r of results) {
    console.log(
      r.id.padEnd(32) +
      String(r.difficulty).padEnd(11) +
      (r.rank ? ('#' + r.rank).padStart(5) : ' MISS') + '  ' +
      (r.simTop1 != null ? r.simTop1.toFixed(3) : '  -  ') + '  ' +
      (r.spread != null ? r.spread.toFixed(3) : '  -  ') + '   ' +
      String(r.top1Title || '')
    );
  }
  console.log('─'.repeat(104));
  console.log(`cases            ${n}`);
  console.log(`recall@5         ${pct(results.filter(r => r.hit5).length)}   (${results.filter(r => r.hit5).length}/${n})`);
  console.log(`recall@10        ${pct(results.filter(r => r.hit10).length)}   (${results.filter(r => r.hit10).length}/${n})`);
  console.log(`MRR              ${avg(r => r.rr).toFixed(3)}`);
  console.log(`mean sim@1       ${avg(r => r.simTop1).toFixed(4)}`);
  console.log(`mean spread@${TOP_N}   ${avg(r => r.spread).toFixed(4)}   <- discrimination; flat means ranking is near-arbitrary`);

  const byDiff = {};
  for (const r of results) (byDiff[r.difficulty] ||= []).push(r);
  console.log('\nby difficulty:');
  for (const [d, rs] of Object.entries(byDiff)) {
    const h10 = rs.filter(r => r.hit10).length;
    console.log(`  ${d.padEnd(11)} recall@10 ${h10}/${rs.length}`);
  }
}

(async () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  let cases = fixture.cases;
  if (ONLY) cases = cases.filter(c => c.id === ONLY);
  if (!cases.length) throw new Error('no cases selected');

  if (has('--validate')) {
    const bad = await validate(cases);
    await sequelize.close();
    process.exit(bad === 0 ? 0 : 1);
  }

  console.log(PERIOD ? `mode: period re-rank (pool ${POOL} → top ${TOP_N})` : `mode: vector only (top ${TOP_N})`);
  const results = await run(cases);
  report(results);
  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({ topN: TOP_N, results }, null, 2));
    console.log(`\nwrote ${JSON_OUT}`);
  }
  await sequelize.close();
  process.exit(0);
})().catch(e => { console.error('FATAL', e.stack); process.exit(1); });
