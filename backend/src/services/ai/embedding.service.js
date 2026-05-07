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

/**
 * Embed a single datasource
 * @param {number} sourceId - Datasource ID
 * @returns {Promise<{ok: boolean, message: string}>}
 */
async function embedDatasource(sourceId) {
  const source = await DataSource.findByPk(sourceId);
  if (!source) {
    throw new Error(`Datasource ${sourceId} not found`);
  }

  const text = buildEmbeddingText(source);
  if (!text) {
    return { ok: false, message: 'No text to embed' };
  }

  const embedding = await generateEmbedding(text);
  
  // Store as JSON string
  await source.update({
    embedding: JSON.stringify(embedding),
    embedding_updated_at: new Date(),
  });

  return { ok: true, message: `Embedded ${text.length} chars` };
}

/**
 * Embed all datasources that don't have embeddings yet
 * @param {object} options - Options
 * @param {boolean} options.force - Re-embed even if already embedded
 * @param {function} options.onProgress - Progress callback
 * @returns {Promise<{total: number, embedded: number, skipped: number, errors: number, errorDetails: string[]}>}
 */
async function embedAllDatasources({ force = false, onProgress } = {}) {
  const sources = await DataSource.findAll({
    where: { status: true },
    order: [['id', 'ASC']],
  });

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

    // Skip if already embedded (unless force)
    if (!force && source.embedding) {
      result.skipped++;
      continue;
    }

    try {
      const text = buildEmbeddingText(source);
      if (!text) {
        result.skipped++;
        continue;
      }

      const embedding = await generateEmbedding(text);
      await source.update({
        embedding: JSON.stringify(embedding),
        embedding_updated_at: new Date(),
      });
      result.embedded++;
      
      // Small delay to avoid rate limiting
      if (i < sources.length - 1) {
        await new Promise(r => setTimeout(r, 100));
      }
    } catch (e) {
      result.errors++;
      result.errorDetails.push(`ID ${source.id}: ${e.message}`);
    }
  }

  return result;
}

/**
 * Get embedding statistics
 * @returns {Promise<object>}
 */
async function getEmbeddingStats() {
  const [total, embedded] = await Promise.all([
    DataSource.count({ where: { status: true } }),
    DataSource.count({ 
      where: { 
        status: true,
        embedding: { [require('sequelize').Op.ne]: null }
      }
    }),
  ]);

  // Get date range
  const { Sequelize } = require('sequelize');
  const oldest = await DataSource.findOne({
    where: { embedding: { [Sequelize.Op.ne]: null } },
    order: [['embedding_updated_at', 'ASC']],
    attributes: ['embedding_updated_at'],
  });
  
  const newest = await DataSource.findOne({
    where: { embedding: { [Sequelize.Op.ne]: null } },
    order: [['embedding_updated_at', 'DESC']],
    attributes: ['embedding_updated_at'],
  });

  return {
    total,
    embedded,
    notEmbedded: total - embedded,
    oldestEmbedding: oldest?.embedding_updated_at || null,
    newestEmbedding: newest?.embedding_updated_at || null,
    lastUpdated: newest?.embedding_updated_at || null,
  };
}

/**
 * Get datasources with embedding status
 * @returns {Promise<object[]>}
 */
async function getDatasourcesWithEmbeddingStatus() {
  const sources = await DataSource.findAll({
    where: { status: true },
    order: [['id', 'ASC']],
    attributes: ['id', 'name', 'type', 'description', 'aliases', 'embedding', 'embedding_updated_at'],
  });

  return sources.map(s => ({
    id: s.id,
    name: s.name,
    type: s.type,
    hasEmbedding: !!s.embedding,
    embeddingUpdatedAt: s.embedding_updated_at,
    textLength: buildEmbeddingText(s).length,
  }));
}

/**
 * Clear embedding for a datasource
 * @param {number} sourceId 
 */
async function clearEmbedding(sourceId) {
  const source = await DataSource.findByPk(sourceId);
  if (!source) {
    throw new Error(`Datasource ${sourceId} not found`);
  }
  await source.update({
    embedding: null,
    embedding_updated_at: null,
  });
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
