'use strict';
/**
 * Unified retrieval over retrieval_chunks using MariaDB native VECTOR INDEX.
 * Replaces the in-memory HNSW + JSON-text scan in vectorSearch.service.js.
 * Imports bpsMetadata embedding service directly (Gemini, free).
 */
const sequelize = require('../../config/db');
const { generateEmbedding } = require('../bpsMetadata/embedding.service');

const ALLOWED_KINDS = ['datasource', 'knowledge_doc', 'knowledge_chunk', 'indicator_meta'];

// A rebuilt index must be measurable before it is cut over, so the table is
// selectable. A table name cannot be a bound parameter — it reaches the query by
// interpolation — so the accepted set is closed rather than sanitised.
const RETRIEVAL_TABLES = ['retrieval_chunks', 'retrieval_chunks_rebuild', 'retrieval_chunks_old'];

function resolveRetrievalTable(table) {
  if (!table) return RETRIEVAL_TABLES[0];
  if (!RETRIEVAL_TABLES.includes(table)) {
    throw new Error(`"${table}" is not a known retrieval table`);
  }
  return table;
}

async function searchRetrieval(query, options) {
  const opts = options || {};
  const topN = opts.topN || 20;
  const kinds = opts.kinds || ALLOWED_KINDS;
  const minSimilarity = opts.minSimilarity || 0.0;
  const t0 = Date.now();
  const queryEmb = await generateEmbedding(query);
  const kindsCsv = kinds.map(() => '?').join(',');

  const table = resolveRetrievalTable(opts.table);

  const [rows] = await sequelize.query(
    `SELECT id, source_kind, source_ref_id, parent_chunk_id, chunk_index,
            title, content_text, metadata,
            VEC_DISTANCE_COSINE(embedding, VEC_FromText(?)) AS distance
     FROM \`${table}\`
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

module.exports = { searchRetrieval, ALLOWED_KINDS, RETRIEVAL_TABLES, resolveRetrievalTable };
