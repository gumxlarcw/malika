#!/usr/bin/env node
/**
 * Re-title knowledge_base chunks from their real position in the parent document.
 *
 * Supersedes enrich-chunk-titles.js, which had two defects that between them made
 * the assigned table largely unrelated to the chunk's contents:
 *
 *  1. It estimated a chunk's offset as `chunkIndex * STRIDE`, assuming every chunk
 *     is the same length. They are not (observed 53 to 4000 chars), so the estimate
 *     drifts. Measured on Dalam Angka 2017: -12,052 chars by chunk 45 and -278,476
 *     at worst — about 77 chunks away from the truth.
 *  2. It then took the last caption appearing before the chunk *ended*, so a chunk
 *     made of Table A's rows was renamed after Table B whenever B's caption fell
 *     inside it.
 *
 * Result: the chunk holding the 2016 population-density table is titled "Tabel
 * 3.2.11: Jumlah Pencari Kerja". That is not cosmetic — the title is embedded with
 * the chunk and cited to the user, and measured against a density query the wrong
 * title scores 0.7852 where no title at all scores 0.8179.
 *
 * Here the offset is found by locating the chunk's own opening text in the parent,
 * and the title names the captions the chunk actually carries.
 *
 *   node scripts/fix-chunk-titles.js                # dry run, reports what would change
 *   node scripts/fix-chunk-titles.js --parent 1193  # one document
 *   node scripts/fix-chunk-titles.js --execute      # apply
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sequelize = require('../src/config/db');
const { QueryTypes } = require('sequelize');
const { sectionsForChunk } = require('../src/services/ai/chunkTitle.service');
const { parseIndicatorIndex, mapEntryPositions } = require('../src/services/ai/chunkTitle.service');

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const LIMIT = (() => { const i = args.indexOf('--limit'); return i === -1 ? 0 : parseInt(args[i + 1], 10) || 0; })();
const PARENT = (() => { const i = args.indexOf('--parent'); return i === -1 ? null : parseInt(args[i + 1], 10); })();
const SHOW = (() => { const i = args.indexOf('--show'); return i === -1 ? 5 : parseInt(args[i + 1], 10) || 5; })();

/** Strip any previously appended " — Tabel …" so re-runs are idempotent. */
function baseTitle(title) {
  return String(title || '').replace(/\s+—\s+(Tabel|Bab|Gambar|Lampiran)\s.*$/s, '').trim();
}

(async () => {
  console.log(EXECUTE ? 'MODE: EXECUTE (will update knowledge_base.title)' : 'MODE: dry run');

  const parents = await sequelize.query(
    `SELECT id, title, content, indicator_index FROM knowledge_base
      WHERE parent_id IS NULL AND indicator_index IS NOT NULL AND LENGTH(indicator_index) > 10
        ${PARENT ? 'AND id = :pid' : ''}
      ORDER BY id ${LIMIT ? `LIMIT ${LIMIT}` : ''}`,
    { type: QueryTypes.SELECT, replacements: PARENT ? { pid: PARENT } : {} });

  console.log(`parents with an index: ${parents.length}`);

  let seen = 0, changed = 0, unlocatable = 0, noSection = 0, shown = 0;
  const updates = [];

  for (const p of parents) {
    const entries = mapEntryPositions(parseIndicatorIndex(p.indicator_index), p.content);
    if (entries.length === 0) continue;

    const kids = await sequelize.query(
      'SELECT id, chunk_index, title, content FROM knowledge_base WHERE parent_id = :pid ORDER BY chunk_index',
      { type: QueryTypes.SELECT, replacements: { pid: p.id } });

    for (const k of kids) {
      seen++;
      // Real offset, not an assumed stride.
      const probe = String(k.content || '').slice(0, 80);
      const start = probe ? p.content.indexOf(probe) : -1;
      if (start < 0) { unlocatable++; continue; }
      const end = start + String(k.content || '').length;

      const secs = sectionsForChunk(start, end, entries);
      if (secs.length === 0) { noSection++; continue; }

      const base = baseTitle(k.title);
      const suffix = secs.map(s => s.label).join('; ');
      let next = `${base} — ${suffix}`;
      if (next.length > 490) next = next.slice(0, 487) + '...';

      if (next !== k.title) {
        changed++;
        updates.push({ id: k.id, title: next });
        if (shown < SHOW) {
          console.log(`\n  #${k.id} (chunk ${k.chunk_index}, offset ${start})`);
          console.log(`    was: ${String(k.title).slice(0, 120)}`);
          console.log(`    now: ${next.slice(0, 120)}`);
          shown++;
        }
      }
    }
  }

  console.log(`\nchunks examined      : ${seen}`);
  console.log(`titles changed       : ${changed}`);
  console.log(`chunk text not found : ${unlocatable}`);
  console.log(`no section matched   : ${noSection}`);

  if (!EXECUTE) { console.log('\ndry run — nothing written. Re-run with --execute to apply.'); await sequelize.close(); process.exit(0); }

  for (let i = 0; i < updates.length; i += 200) {
    const batch = updates.slice(i, i + 200);
    const cases = batch.map(() => 'WHEN ? THEN ?').join(' ');
    const repl = batch.flatMap(u => [u.id, u.title]);
    await sequelize.query(
      `UPDATE knowledge_base SET title = CASE id ${cases} END WHERE id IN (${batch.map(() => '?').join(',')})`,
      { replacements: [...repl, ...batch.map(u => u.id)] });
    process.stdout.write(`  updated ${Math.min(i + 200, updates.length)}/${updates.length}\r`);
  }
  console.log(`\napplied ${updates.length} title updates`);
  await sequelize.close(); process.exit(0);
})().catch(e => { console.error('FATAL', e.stack); process.exit(1); });
