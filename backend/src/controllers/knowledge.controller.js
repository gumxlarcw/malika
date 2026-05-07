/**
 * Knowledge Controller
 * API endpoints for managing embeddings and vector search
 */

const embeddingService = require('../services/ai/embedding.service');
const vectorSearchService = require('../services/ai/vectorSearch.service');
const knowledgeDocService = require('../services/ai/knowledgeDoc.service');

// Knowledge patterns service for dynamic FAQ pattern detection
let knowledgePatternsService = null;
try {
  knowledgePatternsService = require('../services/ai/knowledgePatterns.service');
} catch (e) {
  console.warn('[Knowledge] Knowledge patterns service not available:', e.message);
}

/**
 * Helper: Invalidate knowledge patterns cache after document changes
 */
function invalidateKnowledgePatterns() {
  if (knowledgePatternsService) {
    knowledgePatternsService.invalidateCache();
    // Preload updated patterns
    knowledgePatternsService.preloadPatterns().catch(e => {
      console.warn('[Knowledge] Pattern preload failed:', e.message);
    });
  }
}

/**
 * GET /knowledge/stats
 * Get embedding statistics
 */
async function getStats(req, res) {
  try {
    const stats = await embeddingService.getEmbeddingStats();
    const cacheStats = vectorSearchService.getCacheStats();
    
    res.json({
      ...stats,
      cache: cacheStats,
    });
  } catch (e) {
    console.error('[Knowledge] getStats error:', e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /knowledge/datasources
 * Get all datasources with embedding status
 */
async function getDatasources(req, res) {
  try {
    const datasources = await embeddingService.getDatasourcesWithEmbeddingStatus();
    res.json({ datasources });
  } catch (e) {
    console.error('[Knowledge] getDatasources error:', e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /knowledge/embed/:id
 * Embed a single datasource
 */
async function embedSingle(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'Invalid datasource ID' });
    }

    const result = await embeddingService.embedDatasource(id);
    
    // Invalidate cache so next search loads fresh embeddings
    vectorSearchService.invalidateCache();
    
    res.json(result);
  } catch (e) {
    console.error('[Knowledge] embedSingle error:', e);
    const status = e.statusCode || 500;
    res.status(status).json({ error: e.message, code: e.code });
  }
}

/**
 * POST /knowledge/embed-all
 * Embed all datasources
 */
async function embedAll(req, res) {
  try {
    const force = req.query.force === '1' || req.query.force === 'true';
    const startTime = Date.now();
    
    const result = await embeddingService.embedAllDatasources({ force });
    
    // Invalidate cache
    vectorSearchService.invalidateCache();
    
    res.json({
      ok: true,
      ...result,
      duration_ms: Date.now() - startTime,
    });
  } catch (e) {
    console.error('[Knowledge] embedAll error:', e);
    const status = e.statusCode || 500;
    res.status(status).json({ ok: false, error: e.message, code: e.code });
  }
}

/**
 * DELETE /knowledge/embed/:id
 * Clear embedding for a datasource
 */
async function clearEmbedding(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'Invalid datasource ID' });
    }

    await embeddingService.clearEmbedding(id);
    
    // Invalidate cache
    vectorSearchService.invalidateCache();
    
    res.json({ ok: true });
  } catch (e) {
    console.error('[Knowledge] clearEmbedding error:', e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /knowledge/search
 * Search datasources using vector similarity
 */
async function search(req, res) {
  try {
    const { query, topN = 10 } = req.body;
    
    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'Missing or invalid query' });
    }

    const n = Math.min(Math.max(1, parseInt(topN, 10) || 10), 50);
    const result = await vectorSearchService.searchAll(query.trim(), n);
    
    res.json({
      ok: true,
      ...result,
    });
  } catch (e) {
    console.error('[Knowledge] search error:', e);
    const status = e.statusCode || 500;
    res.status(status).json({ ok: false, error: e.message, code: e.code });
  }
}

/**
 * POST /knowledge/invalidate-cache
 * Force invalidate the embeddings cache
 */
async function invalidateCache(req, res) {
  vectorSearchService.invalidateCache();
  res.json({ ok: true, message: 'Cache invalidated' });
}

// =====================
// Custom Knowledge Documents
// =====================

/**
 * GET /knowledge/documents/stats
 * Get custom knowledge document statistics
 */
async function getDocumentStats(req, res) {
  try {
    const stats = await knowledgeDocService.getKnowledgeStats();
    res.json(stats);
  } catch (e) {
    console.error('[Knowledge] getDocumentStats error:', e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /knowledge/documents
 * Get all custom knowledge documents
 */
async function getDocuments(req, res) {
  try {
    const documents = await knowledgeDocService.getAllDocuments();
    res.json({ documents });
  } catch (e) {
    console.error('[Knowledge] getDocuments error:', e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /knowledge/documents/text
 * Create knowledge document from text
 */
async function createFromText(req, res) {
  try {
    const { title, content, description, category } = req.body;
    
    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    const result = await knowledgeDocService.createFromText({
      title,
      content,
      description,
      category,
      createdBy: req.user?.id || null,
    });
    
    // Invalidate knowledge patterns cache so new document topics are recognized
    invalidateKnowledgePatterns();
    
    res.json(result);
  } catch (e) {
    console.error('[Knowledge] createFromText error:', e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /knowledge/documents/pdf
 * Create knowledge document from PDF upload
 * Query params:
 *   forceOcr=1 - Force OCR even if text layer exists
 */
async function createFromPdf(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'PDF file is required' });
    }

    const { title, description, category } = req.body;
    const forceOcr = req.query.forceOcr === '1' || req.body.forceOcr === '1' || req.body.forceOcr === true;
    
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const result = await knowledgeDocService.createFromPdf({
      title,
      pdfBuffer: req.file.buffer,
      filename: req.file.originalname,
      description,
      category,
      createdBy: req.user?.id || null,
      forceOcr,
    });
    
    // Invalidate knowledge patterns cache so new document topics are recognized
    invalidateKnowledgePatterns();
    
    res.json(result);
  } catch (e) {
    console.error('[Knowledge] createFromPdf error:', e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /knowledge/documents/:id/re-embed
 * Re-embed a knowledge document
 */
async function reEmbedDocument(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'Invalid document ID' });
    }

    const result = await knowledgeDocService.reEmbed(id);
    res.json(result);
  } catch (e) {
    console.error('[Knowledge] reEmbedDocument error:', e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * DELETE /knowledge/documents/:id
 * Delete a knowledge document
 */
async function deleteDocument(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'Invalid document ID' });
    }

    const result = await knowledgeDocService.deleteDocument(id);
    
    // Invalidate knowledge patterns cache after document deletion
    invalidateKnowledgePatterns();
    
    res.json(result);
  } catch (e) {
    console.error('[Knowledge] deleteDocument error:', e);
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  getStats,
  getDatasources,
  embedSingle,
  embedAll,
  clearEmbedding,
  search,
  invalidateCache,
  // Custom documents
  getDocumentStats,
  getDocuments,
  createFromText,
  createFromPdf,
  reEmbedDocument,
  deleteDocument,
};
