#!/usr/bin/env node
'use strict';
/**
 * One-shot repack: indicator_meta.embedding (already 768d Gemini) → retrieval_chunks.
 * No API calls — just JSON.parse + INSERT.
 */
const sequelize = require('../src/config/db');
const IndicatorMeta = require('../src/models/IndicatorMeta.model');
const { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } = require('../src/services/bpsMetadata/embedding.service');

(async () => {
  const rows = await IndicatorMeta.findAll({
    where: { embedding: { [sequelize.Sequelize.Op.ne]: null } },
    attributes: ['source_id', 'flat_text', 'title_clean', 'embedding'],
  });
  console.log(`Repacking ${rows.length} indicator_meta rows (no API calls)`);

  let ok = 0, skipped = 0, fail = 0;
  for (const r of rows) {
    let emb;
    try { emb = JSON.parse(r.embedding); } catch (parseErr) { fail++; continue; }
    if (!Array.isArray(emb) || emb.length !== EMBEDDING_DIMENSIONS) {
      console.warn(`  skip source_id=${r.source_id}: dim=${emb && emb.length} (expected ${EMBEDDING_DIMENSIONS})`);
      skipped++;
      continue;
    }

    const text = String(r.flat_text || r.title_clean || '').slice(0, 8000);
    try {
      await sequelize.query(
        `INSERT IGNORE INTO retrieval_chunks
          (source_kind, source_ref_id, chunk_index, title, content_text, metadata, embedding, embedding_model, embedding_generated_at)
         VALUES ('indicator_meta', ?, 0, ?, ?, '{}', VEC_FromText(?), ?, NOW())`,
        {
          replacements: [
            r.source_id,
            r.title_clean || `indicator_meta_${r.source_id}`,
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
