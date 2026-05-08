'use strict';
/**
 * Unified retrieval over retrieval_chunks using MariaDB native VECTOR INDEX.
 * Replaces the in-memory HNSW + JSON-text scan in vectorSearch.service.js.
 * Imports bpsMetadata embedding service directly (Gemini, free).
 */
const sequelize = require('../../config/db');
const { generateEmbedding } = require('../bpsMetadata/embedding.service');

const ALLOWED_KINDS = ['datasource', 'knowledge_doc', 'knowledge_chunk', 'indicator_meta'];

async function searchRetrieval(query, options) {
  const opts = options || {};
  const topN = opts.topN || 20;
  const kinds = opts.kinds || ALLOWED_KINDS;
  const minSimilarity = opts.minSimilarity || 0.0;
  const t0 = Date.now();
  const queryEmb = await generateEmbedding(query);
  const kindsCsv = kinds.map(() => '?').join(',');

  const [rows] = await sequelize.query(
    `SELECT id, source_kind, source_ref_id, parent_chunk_id, chunk_index,
            title, content_text, metadata,
            VEC_DISTANCE_COSINE(embedding, VEC_FromText(?)) AS distance
     FROM retrieval_chunks
     WHERE source_kind IN (${kindsCsv})
     ORDER BY distance ASC
     LIMIT ?`,
    { replacements: [JSON.stringify(queryEmb), ...kinds, topN] }
  );

  const results = rows
    .map(r => ({
      id: r.id,
      sourceKind: r.source_kind,
      sourceRefId: r.source_ref_id,
      parentChunkId: r.parent_chunk_id,
      chunkIndex: r.chunk_index,
      title: r.title,
      content: r.content_text,
      metadata: r.metadata ? JSON.parse(r.metadata) : null,
      similarity: 1 - r.distance,
    }))
    .filter(r => r.similarity >= minSimilarity);

  return { results, durationMs: Date.now() - t0 };
}

module.exports = { searchRetrieval, ALLOWED_KINDS };
