/**
 * Daily Knowledge Sync Service
 * 
 * Automatically syncs new BRS and Publikasi from BPS API:
 * 1. Fetches latest items from BPS API
 * 2. Checks which are not yet indexed
 * 3. Adds to knowledge_base with embeddings
 * 
 * Run daily via scheduler at configurable time
 */

'use strict';

const { fetchBrsList } = require('./brsFetcher.service');
const { fetchPublicationList } = require('./publicationFetcher.service');
const { extractTextFromUrl } = require('./pdfExtractor.service');
const KnowledgeBase = require('../../models/KnowledgeBase.model');
const IndexedBrsPublikasi = require('../../models/IndexedBrsPublikasi.model');
const { generateEmbedding } = require('../ai/embedding.service');
const { rechunkDocument } = require('../ai/knowledgeDoc.service');
const { extractAllKeywords } = require('../ai/keywordExtractor.service');
const { extractIndicatorIndex } = require('../../../scripts/populate-indicator-index');
const vectorSearch = require('../ai/vectorSearch.service');
const logger = require('../../utils/logger').child({ service: 'KnowledgeSync' });

// Configuration
const SYNC_CONFIG = {
  BRS_PAGES_TO_CHECK: 3,          // Check first 3 pages of BRS (~30 items)
  PUBLIKASI_PAGES_TO_CHECK: 3,    // Check first 3 pages of Publications (~30 items)
  BATCH_DELAY_MS: 1000,           // Delay between items (chunking generates multiple embeddings)
  MAX_NEW_PER_SYNC: 20,           // Max new items to index per sync run
  INDEX_MODE: 'abstract+pdf',     // Fetch PDF content for richer knowledge
  PDF_TIMEOUT_MS: 30000,          // PDF download timeout
};

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if document is already indexed
 * @param {string} docType - 'brs' or 'publication'
 * @param {string|number} externalId - BRS ID or Publication ID
 * @returns {Promise<boolean>}
 */
async function isAlreadyIndexed(docType, externalId) {
  const existing = await IndexedBrsPublikasi.findOne({
    where: { 
      doc_type: docType, 
      external_id: String(externalId) 
    },
  });
  return !!existing;
}

/**
 * Index a single document to knowledge base
 * @param {object} doc - Document to index
 * @param {string} docType - 'brs' or 'publication'
 * @returns {Promise<{success: boolean, id?: number, error?: string}>}
 */
async function indexSingleDocument(doc, docType) {
  const externalId = docType === 'brs' ? doc.brs_id : doc.pub_id;
  const pdfUrl = doc.pdf_url || doc.pdf;
  
  try {
    // Build base content from abstract
    let content = `${doc.title}\n\n${doc.abstract || doc.description || ''}`;
    let indexMode = 'abstract';
    let pdfExtracted = false;
    
    // Try to fetch PDF content if URL is available
    if (pdfUrl && SYNC_CONFIG.INDEX_MODE.includes('pdf')) {
      try {
        logger.debug({ externalId, docType, pdfUrl }, 'Fetching PDF content');
        const pdfResult = await extractTextFromUrl(pdfUrl, { 
          timeout: SYNC_CONFIG.PDF_TIMEOUT_MS 
        });
        
        if (pdfResult && pdfResult.text && pdfResult.text.length > 100) {
          // Combine abstract with PDF content
          content = `${doc.title}\n\n${doc.abstract || doc.description || ''}\n\n--- PDF Content ---\n\n${pdfResult.text}`;
          indexMode = 'abstract+pdf';
          pdfExtracted = true;
          
          logger.info({
            externalId,
            docType,
            pdfPages: pdfResult.pages,
            textLength: pdfResult.text.length,
          }, 'PDF content extracted');
        }
      } catch (pdfErr) {
        logger.warn({ externalId, docType, error: pdfErr.message }, 'PDF extraction failed, using abstract only');
        // Continue with abstract only
      }
    }
    
    // Extract year from release_date
    let year = null;
    const releaseDate = doc.release_date || doc.rl_date;
    if (releaseDate) {
      const match = String(releaseDate).match(/(\d{4})/);
      if (match) year = parseInt(match[1]);
    }
    
    // Create knowledge base entry
    const kbDoc = await KnowledgeBase.create({
      title: doc.title,
      description: `${docType === 'brs' ? 'BRS' : 'Publikasi'} - ${releaseDate || 'Unknown'} [${indexMode}]`,
      category: docType === 'brs' ? 'BRS' : 'Publikasi',
      source_type: 'text',
      source_url: pdfUrl,
      content,
      content_length: content.length,
      status: 'pending',
    });
    
    // Extract statistical keywords via LLM (title + deep content)
    try {
      const keywords = await extractAllKeywords(
        doc.title,
        doc.abstract || doc.description,
        content,  // pass full content for deep TOC extraction
      );
      if (keywords) {
        await kbDoc.update({ keywords });
        logger.info({ externalId, docType, keywords: keywords.slice(0, 80) }, 'Keywords extracted');
      }
    } catch (kwErr) {
      logger.warn({ externalId, docType, error: kwErr.message }, 'Keyword extraction failed (non-fatal)');
    }
    
    // Generate embedding
    let embeddingSuccess = false;
    try {
      // Use first 5500 chars for embedding (API limit)
      const textToEmbed = `${doc.title}\n${doc.abstract || doc.description || ''}\n${content.slice(0, 5500)}`;
      const embedding = await generateEmbedding(textToEmbed);
      
      if (embedding && embedding.length > 0) {
        await kbDoc.update({
          embedding: JSON.stringify(embedding),
          embedding_updated_at: new Date(),
          status: 'ready',
        });
        embeddingSuccess = true;
      }
    } catch (embedErr) {
      logger.warn({ externalId, docType, error: embedErr.message }, 'Embedding generation failed');
      await kbDoc.update({
        status: 'error',
        error_message: embedErr.message,
      });
    }
    
    // Track in indexed table
    await IndexedBrsPublikasi.create({
      doc_type: docType,
      external_id: String(externalId),
      title: doc.title,
      release_date: releaseDate,
      year,
      index_mode: indexMode,
      knowledge_doc_id: kbDoc.id,
      content_length: content.length,
      pdf_url: pdfUrl,
      status: embeddingSuccess ? 'success' : 'error',
      created_at: new Date(),
      updated_at: new Date(),
    });
    
    // Chunk long documents for deep-content vector coverage
    // Parent keeps full content + first-6K embedding; children get 4K overlapping chunks
    let chunksCreated = 0;
    if (embeddingSuccess && content.length > 4000) {
      try {
        const chunkResult = await rechunkDocument(kbDoc.id, { embedChunks: true });
        chunksCreated = chunkResult.chunksCreated || 0;
        if (chunksCreated > 0) {
          logger.info({
            externalId,
            docType,
            parentId: kbDoc.id,
            chunksCreated,
            chunksEmbedded: chunkResult.chunksEmbedded,
          }, 'Document chunked for deep-content search');
        }
      } catch (chunkErr) {
        // Non-fatal: parent doc still works, just won't have deep-content chunks
        logger.warn({ externalId, docType, error: chunkErr.message }, 'Chunking failed (parent doc preserved)');
      }
    }
    
    // Extract indicator_index (DAFTAR TABEL / DAFTAR ISI) for large documents
    // This enables indicator-guided extraction in the chat pipeline
    let indicatorEntries = 0;
    if (embeddingSuccess && content.length > 10000) {
      try {
        const category = docType === 'brs' ? 'BRS' : 'Publikasi';
        const indicatorIndex = extractIndicatorIndex(content, category);
        if (indicatorIndex && indicatorIndex.length > 10) {
          await KnowledgeBase.update({ indicator_index: indicatorIndex }, { where: { id: kbDoc.id } });
          // Propagate to chunks
          if (chunksCreated > 0) {
            await KnowledgeBase.update({ indicator_index: indicatorIndex }, { where: { parent_id: kbDoc.id } });
          }
          indicatorEntries = indicatorIndex.split('\n').length;
          logger.info({ externalId, docType, entries: indicatorEntries }, 'Indicator index extracted');
        }
      } catch (idxErr) {
        logger.warn({ externalId, docType, error: idxErr.message }, 'Indicator index extraction failed (non-fatal)');
      }
    }

    logger.info({
      docType,
      externalId,
      title: doc.title?.slice(0, 50),
      indexMode,
      contentLength: content.length,
      pdfExtracted,
      embeddingSuccess,
      chunksCreated,
      indicatorEntries,
    }, 'Document indexed');

    return { success: true, id: kbDoc.id, pdfExtracted };
  } catch (error) {
    logger.error({
      docType,
      externalId,
      error: error.message,
    }, 'Failed to index document');
    
    return { success: false, error: error.message };
  }
}

/**
 * Sync new BRS from BPS API
 * @returns {Promise<{fetched: number, newItems: number, indexed: number, errors: number}>}
 */
async function syncBrs() {
  const stats = { fetched: 0, newItems: 0, indexed: 0, errors: 0 };
  
  try {
    // Fetch recent BRS (check multiple pages)
    for (let page = 1; page <= SYNC_CONFIG.BRS_PAGES_TO_CHECK; page++) {
      if (stats.indexed >= SYNC_CONFIG.MAX_NEW_PER_SYNC) break;
      
      const result = await fetchBrsList({ page, perPage: 10 });
      stats.fetched += result.items.length;
      
      for (const item of result.items) {
        if (stats.indexed >= SYNC_CONFIG.MAX_NEW_PER_SYNC) break;
        
        // Check if already indexed
        const indexed = await isAlreadyIndexed('brs', item.brs_id);
        if (indexed) continue;
        
        stats.newItems++;
        
        // Index new document
        const indexResult = await indexSingleDocument(item, 'brs');
        if (indexResult.success) {
          stats.indexed++;
        } else {
          stats.errors++;
        }
        
        // Rate limiting
        await sleep(SYNC_CONFIG.BATCH_DELAY_MS);
      }
      
      // Delay between pages
      await sleep(200);
    }
    
    logger.info(stats, 'BRS sync completed');
    return stats;
  } catch (error) {
    logger.error({ error: error.message }, 'BRS sync failed');
    stats.errors++;
    return stats;
  }
}

/**
 * Sync new Publications from BPS API
 * @returns {Promise<{fetched: number, newItems: number, indexed: number, errors: number}>}
 */
async function syncPublikasi() {
  const stats = { fetched: 0, newItems: 0, indexed: 0, errors: 0 };
  
  try {
    // Fetch recent publications
    for (let page = 1; page <= SYNC_CONFIG.PUBLIKASI_PAGES_TO_CHECK; page++) {
      if (stats.indexed >= SYNC_CONFIG.MAX_NEW_PER_SYNC) break;
      
      const result = await fetchPublicationList({ page, perPage: 10 });
      stats.fetched += result.items.length;
      
      for (const item of result.items) {
        if (stats.indexed >= SYNC_CONFIG.MAX_NEW_PER_SYNC) break;
        
        // Check if already indexed
        const indexed = await isAlreadyIndexed('publication', item.pub_id);
        if (indexed) continue;
        
        stats.newItems++;
        
        // Index new document
        const indexResult = await indexSingleDocument(item, 'publication');
        if (indexResult.success) {
          stats.indexed++;
        } else {
          stats.errors++;
        }
        
        // Rate limiting
        await sleep(SYNC_CONFIG.BATCH_DELAY_MS);
      }
      
      // Delay between pages
      await sleep(200);
    }
    
    logger.info(stats, 'Publikasi sync completed');
    return stats;
  } catch (error) {
    logger.error({ error: error.message }, 'Publikasi sync failed');
    stats.errors++;
    return stats;
  }
}

/**
 * Run full daily sync (BRS + Publikasi)
 * @returns {Promise<{brs: object, publikasi: object, cacheInvalidated: boolean}>}
 */
async function runDailySync() {
  const startTime = Date.now();
  logger.info('Starting daily knowledge sync');
  
  // Sync BRS
  const brsStats = await syncBrs();
  
  // Small delay between BRS and Publikasi
  await sleep(1000);
  
  // Sync Publikasi
  const pubStats = await syncPublikasi();
  
  // Invalidate vector search cache if any new docs were indexed
  let cacheInvalidated = false;
  if (brsStats.indexed > 0 || pubStats.indexed > 0) {
    try {
      if (vectorSearch.loadKnowledgeEmbeddings) {
        await vectorSearch.loadKnowledgeEmbeddings(true); // force reload
        cacheInvalidated = true;
        logger.info('Vector search cache invalidated');
      }
    } catch (e) {
      logger.warn({ error: e.message }, 'Cache invalidation failed');
    }

    // Refresh keyword index so new KB keywords are discoverable immediately
    try {
      const { refreshIndex } = require('../chat/datasourceKeywordIndex.service');
      await refreshIndex();
      logger.info('Keyword index refreshed after sync');
    } catch (e) {
      logger.warn({ error: e.message }, 'Keyword index refresh failed (non-fatal)');
    }
  }
  
  const duration = Date.now() - startTime;
  logger.info({
    durationMs: duration,
    brs: brsStats,
    publikasi: pubStats,
    cacheInvalidated,
  }, 'Daily sync completed');
  
  return {
    brs: brsStats,
    publikasi: pubStats,
    cacheInvalidated,
    durationMs: duration,
  };
}

/**
 * Get sync statistics
 * @returns {Promise<object>}
 */
async function getSyncStats() {
  const [brsCount] = await IndexedBrsPublikasi.sequelize.query(
    `SELECT COUNT(*) as cnt FROM indexed_brs_publikasi WHERE doc_type = 'brs'`
  );
  const [pubCount] = await IndexedBrsPublikasi.sequelize.query(
    `SELECT COUNT(*) as cnt FROM indexed_brs_publikasi WHERE doc_type = 'publication'`
  );
  const [kbCount] = await KnowledgeBase.sequelize.query(
    `SELECT category, COUNT(*) as cnt, MAX(created_at) as latest 
     FROM knowledge_base WHERE category IN ('BRS', 'Publikasi') 
     GROUP BY category`
  );
  
  return {
    indexed: {
      brs: brsCount[0]?.cnt || 0,
      publikasi: pubCount[0]?.cnt || 0,
    },
    knowledgeBase: kbCount,
  };
}

module.exports = {
  runDailySync,
  syncBrs,
  syncPublikasi,
  isAlreadyIndexed,
  indexSingleDocument,
  getSyncStats,
  SYNC_CONFIG,
};
