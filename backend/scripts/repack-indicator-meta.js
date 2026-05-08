#!/usr/bin/env node
'use strict';
/**
 * One-shot re-embed: indicator_meta → retrieval_chunks.
 *
 * Originally a pure repack of stored 768d Gemini vectors. After the 2026-05-09
 * pivot to self-hosted Xenova/multilingual-e5-large (1024d), the cached vectors
 * in indicator_meta.embedding are dimensionally incompatible — every row must
 * be re-embedded from `flat_text` / `title_clean` via embedPassage.
 *
 * Idempotent on retrieval_chunks via INSERT IGNORE on the unique key.
 */
const sequelize = require('../src/config/db');
const IndicatorMeta = require('../src/models/IndicatorMeta.model');
const { embedPassage, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } = require('../src/services/bpsMetadata/embedding.service');

(async () => {
  const rows = await IndicatorMeta.findAll({
    attributes: ['source_id', 'flat_text', 'title_clean'],
  });
  console.log(`Re-embedding ${rows.length} indicator_meta rows via ${EMBEDDING_MODEL} (${EMBEDDING_DIMENSIONS}d)`);

  let ok = 0, skipped = 0, fail = 0;
  for (const r of rows) {
    const text = String(r.flat_text || r.title_clean || '').slice(0, 8000);
    if (!text) {
      skipped++;
      continue;
    }

    let emb;
    try {
      emb = await embedPassage(text);
    } catch (embedErr) {
      fail++;
      console.error(`  embed-fail source_id=${r.source_id}: ${embedErr.message}`);
      continue;
    }

    if (!Array.isArray(emb) || emb.length !== EMBEDDING_DIMENSIONS) {
      console.warn(`  skip source_id=${r.source_id}: dim=${emb && emb.length} (expected ${EMBEDDING_DIMENSIONS})`);
      skipped++;
      continue;
    }

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
      console.error(`  insert-fail source_id=${r.source_id}: ${err.message}`);
    }
  }
  console.log(`Done. ok=${ok} skipped=${skipped} fail=${fail}`);
  await sequelize.close();
})().catch(err => { console.error(err); process.exit(1); });
