/**
 * Embedding Service
 * Generate and store embeddings using OpenAI text-embedding-3-small
 */

const axios = require('axios');
const DataSource = require('../../models/DataSource.model');

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

/**
 * Get OpenAI API key for embeddings
 */
function getApiKey() {
  const key = process.env.OPENAI_API_KEY_EMBEDDINGS 
    || process.env.OPENAI_API_KEY_QUERY_BUILDER
    || process.env.OPENAI_API_KEY;
  return key && String(key).trim() ? String(key).trim() : null;
}

/**
 * Generate embedding for text using OpenAI API
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} - Embedding vector (1536 dimensions)
 */
async function generateEmbedding(text) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error('Missing OpenAI API key for embeddings');
    err.statusCode = 503;
    err.code = 'OPENAI_DISABLED';
    throw err;
  }

  const cleanText = String(text || '').trim().slice(0, 8000); // Max ~8000 chars
  if (!cleanText) {
    throw new Error('Empty text provided for embedding');
  }

  const response = await axios.post(
    'https://api.openai.com/v1/embeddings',
    {
      model: EMBEDDING_MODEL,
      input: cleanText,
    },
    {
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const embedding = response.data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error('Invalid embedding response from OpenAI');
  }

  return embedding;
}

/**
 * Build text to embed from datasource
 * @param {object} source - Datasource object
 * @returns {string} - Combined text for embedding
 */
function buildEmbeddingText(source) {
  const parts = [
    source.name,
    source.description,
    source.aliases,
    source.category,
  ].filter(Boolean).map(s => String(s).trim()).filter(Boolean);
  
  return parts.join('. ');
}

// ── Live embedding pipeline (Phase C 2026-05-09) ──────────────────────────
// Writes to project_data_strategis.retrieval_chunks (VECTOR(768)) via
// xenova multilingual-e5-base. Replaces the OpenAI 1536d → dropped column
// path that lived here before.
const sequelize_pds = require('../../config/db');
const { embedPassage } = require('../bpsMetadata/embedding.service');

const LIVE_EMBEDDING_MODEL = 'Xenova/multilingual-e5-base';

async function upsertDatasourceChunk(source) {
  const text = buildEmbeddingText(source);
  if (!text) return { ok: false, message: 'No text to embed' };

  const emb = await embedPassage(text);
  const metadata = { category: source.category || null, type: source.type || null };

  await sequelize_pds.query(
    `DELETE FROM retrieval_chunks
     WHERE source_kind = 'datasource' AND source_ref_id = ?`,
    { replacements: [source.id] }
  );
  await sequelize_pds.query(
    `INSERT INTO retrieval_chunks
       (source_kind, source_ref_id, chunk_index, title, content_text, metadata,
        embedding, embedding_model, embedding_generated_at)
     VALUES ('datasource', ?, 0, ?, ?, ?, VEC_FromText(?), ?, NOW())`,
    {
      replacements: [
        source.id,
        source.name,
        source.description || '',
        JSON.stringify(metadata),
        JSON.stringify(emb),
        LIVE_EMBEDDING_MODEL,
      ],
    }
  );

  return { ok: true, message: `Embedded ${text.length} chars via ${LIVE_EMBEDDING_MODEL}` };
}

/**
 * Embed a single datasource — writes to retrieval_chunks.
 * @param {number} sourceId
 * @returns {Promise<{ok: boolean, message: string}>}
 */
async function embedDatasource(sourceId) {
  const source = await DataSource.findByPk(sourceId);
  if (!source) {
    const err = new Error(`Datasource ${sourceId} not found`);
    err.statusCode = 404;
    throw err;
  }
  return upsertDatasourceChunk(source);
}

/**
 * Embed all active datasources. Skips already-indexed sources unless force=true.
 * @param {{force?: boolean, onProgress?: function}} options
 */
async function embedAllDatasources({ force = false, onProgress } = {}) {
  const sources = await DataSource.findAll({
    where: { status: true },
    order: [['id', 'ASC']],
  });

  const [existingRows] = await sequelize_pds.query(
    `SELECT source_ref_id FROM retrieval_chunks WHERE source_kind='datasource'`
  );
  const existing = new Set(existingRows.map((r) => Number(r.source_ref_id)));

  const result = {
    total: sources.length,
    embedded: 0,
    skipped: 0,
    errors: 0,
    errorDetails: [],
  };

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    if (onProgress) {
      onProgress({ current: i + 1, total: sources.length, name: source.name });
    }

    if (!force && existing.has(Number(source.id))) {
      result.skipped++;
      continue;
    }
    try {
      const r = await upsertDatasourceChunk(source);
      if (r.ok) result.embedded++;
      else result.skipped++;
    } catch (e) {
      result.errors++;
      result.errorDetails.push(`ID ${source.id}: ${e.message}`);
    }
  }

  return result;
}

/**
 * Get embedding statistics — sourced from retrieval_chunks (Phase C 2026-05-09)
 * not data_sources.embedding (dropped column).
 * @returns {Promise<object>}
 */
async function getEmbeddingStats() {
  const sequelize = require('../../config/db');

  const [total, embeddedRowsRes, datesRes] = await Promise.all([
    DataSource.count({ where: { status: true } }),
    sequelize.query(
      `SELECT COUNT(DISTINCT rc.source_ref_id) AS embedded
       FROM retrieval_chunks rc
       INNER JOIN data_sources ds ON ds.id = rc.source_ref_id
       WHERE rc.source_kind = 'datasource' AND ds.status = 1`,
      { type: sequelize.QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT MIN(embedding_generated_at) AS oldest,
              MAX(embedding_generated_at) AS newest
       FROM retrieval_chunks
       WHERE source_kind = 'datasource'`,
      { type: sequelize.QueryTypes.SELECT }
    ),
  ]);

  const embedded = Number(embeddedRowsRes?.[0]?.embedded || 0);
  const oldest = datesRes?.[0]?.oldest || null;
  const newest = datesRes?.[0]?.newest || null;

  return {
    total,
    embedded,
    notEmbedded: Math.max(0, total - embedded),
    oldestEmbedding: oldest,
    newestEmbedding: newest,
    lastUpdated: newest,
  };
}

/**
 * Get datasources with embedding status — sourced from retrieval_chunks
 * (Phase C 2026-05-09) not data_sources.embedding (dropped column).
 * @returns {Promise<object[]>}
 */
async function getDatasourcesWithEmbeddingStatus() {
  const sequelize = require('../../config/db');

  const [rows] = await sequelize.query(
    `SELECT ds.id, ds.name, ds.type, ds.description, ds.aliases, ds.category,
            rc.embedding_generated_at AS embedding_updated_at
     FROM data_sources ds
     LEFT JOIN retrieval_chunks rc
       ON rc.source_kind = 'datasource' AND rc.source_ref_id = ds.id
     WHERE ds.status = 1
     ORDER BY ds.id ASC`
  );

  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    hasEmbedding: Boolean(s.embedding_updated_at),
    embeddingUpdatedAt: s.embedding_updated_at || null,
    textLength: buildEmbeddingText({
      name: s.name,
      description: s.description,
      aliases: s.aliases,
      category: s.category,
    }).length,
  }));
}

/**
 * Clear embedding for a datasource — removes the retrieval_chunks row.
 * @param {number} sourceId
 */
async function clearEmbedding(sourceId) {
  await sequelize_pds.query(
    `DELETE FROM retrieval_chunks
     WHERE source_kind = 'datasource' AND source_ref_id = ?`,
    { replacements: [sourceId] }
  );
  return { ok: true };
}

module.exports = {
  generateEmbedding,
  buildEmbeddingText,
  embedDatasource,
  embedAllDatasources,
  getEmbeddingStats,
  getDatasourcesWithEmbeddingStatus,
  clearEmbedding,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
};
