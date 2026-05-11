'use strict';
/**
 * indicator_meta → retrieval_chunks resync service.
 *
 * indicator_meta rows are upserted by `persistMetadata` whenever the BPS
 * metadata extractor refreshes a source. Those upserts do NOT touch
 * retrieval_chunks, so the embedding for source_kind='indicator_meta' drifts
 * out of sync with the latest flat_text.
 *
 * This service:
 *   - finds rows where retrieval_chunks is missing OR stale
 *     (rc.embedding_generated_at < im.fetched_at)
 *   - re-embeds via xenova multilingual-e5-base
 *   - DELETE+INSERTs into retrieval_chunks so updates are picked up
 *
 * Idempotent. Called daily by the boot-time scheduler.
 */
const sequelize = require('../../config/db');
const { embedPassage, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } = require('./embedding.service');
const logger = require('../../utils/logger').child({ service: 'IndicatorMetaSync' });

async function findStaleRows() {
  const [rows] = await sequelize.query(
    `SELECT im.source_id, im.title_clean, im.flat_text
     FROM indicator_meta im
     LEFT JOIN retrieval_chunks rc
       ON rc.source_kind = 'indicator_meta' AND rc.source_ref_id = im.source_id
     WHERE rc.id IS NULL
        OR rc.embedding_generated_at < im.fetched_at`
  );
  return rows;
}

async function upsertOne(row) {
  const text = String(row.flat_text || row.title_clean || '').slice(0, 8000);
  if (!text) return { ok: false, reason: 'empty' };

  const emb = await embedPassage(text);
  if (!Array.isArray(emb) || emb.length !== EMBEDDING_DIMENSIONS) {
    return { ok: false, reason: `bad_dim_${emb && emb.length}` };
  }

  await sequelize.query(
    `DELETE FROM retrieval_chunks
     WHERE source_kind = 'indicator_meta' AND source_ref_id = ?`,
    { replacements: [row.source_id] }
  );
  await sequelize.query(
    `INSERT INTO retrieval_chunks
       (source_kind, source_ref_id, chunk_index, title, content_text, metadata,
        embedding, embedding_model, embedding_generated_at)
     VALUES ('indicator_meta', ?, 0, ?, ?, '{}', VEC_FromText(?), ?, NOW())`,
    {
      replacements: [
        row.source_id,
        row.title_clean || `indicator_meta_${row.source_id}`,
        text,
        JSON.stringify(emb),
        EMBEDDING_MODEL,
      ],
    }
  );
  return { ok: true };
}

/**
 * Resync all stale indicator_meta rows into retrieval_chunks.
 * @returns {Promise<{checked:number, reembedded:number, skipped:number, errors:number, durationMs:number}>}
 */
async function resyncStaleRows() {
  const t0 = Date.now();
  const rows = await findStaleRows();
  logger.info({ stale: rows.length }, 'indicator_meta resync starting');

  const stats = { checked: rows.length, reembedded: 0, skipped: 0, errors: 0, durationMs: 0 };
  for (const row of rows) {
    try {
      const r = await upsertOne(row);
      if (r.ok) stats.reembedded += 1;
      else stats.skipped += 1;
    } catch (err) {
      stats.errors += 1;
      logger.warn({ source_id: row.source_id, err: err.message }, 'resync row failed');
    }
  }
  stats.durationMs = Date.now() - t0;
  logger.info(stats, 'indicator_meta resync done');
  return stats;
}

module.exports = {
  findStaleRows,
  resyncStaleRows,
};
