/**
 * RAG Trial Controller
 * Admin endpoints for testing BRS/Publication RAG indexing
 */

const brsFetcher = require('../services/rag/brsFetcher.service');
const publicationFetcher = require('../services/rag/publicationFetcher.service');
const pdfExtractor = require('../services/rag/pdfExtractor.service');
const { generateEmbedding } = require('../services/ai/embedding.service');
const { countTextTokens } = require('../utils/tokenizer');
const {
  extractPeriodFromQuery,
  buildPeriodPattern,
  buildContentPeriodPattern,
  analyzeQueryRouting,
  isStatisticalCategory,
  isCustomDocCategory,
  CUSTOM_DOC_CATEGORIES,
} = require('../utils/queryAnalysis');

// =====================================================
// CONTROLLER FUNCTIONS
// =====================================================

// =====================================================
// CONTROLLER FUNCTIONS
// =====================================================

/**
 * GET /rag-trial/brs
 * Fetch BRS list from BPS API
 */
async function getBrsList(req, res) {
  try {
    const page = parseInt(req.query.page) || 1;
    const year = req.query.year ? parseInt(req.query.year) : undefined;
    
    const result = await brsFetcher.fetchBrsList({ page, year });
    
    res.json({
      success: true,
      data: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('[RAGTrial] Error fetching BRS:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * GET /rag-trial/publications
 * Fetch publications list from BPS API
 */
async function getPublicationsList(req, res) {
  try {
    const page = parseInt(req.query.page) || 1;
    const year = req.query.year ? parseInt(req.query.year) : undefined;
    
    const result = await publicationFetcher.fetchPublicationList({ page, year });
    
    res.json({
      success: true,
      data: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('[RAGTrial] Error fetching publications:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * GET /rag-trial/stats
 * Get total counts
 */
async function getStats(req, res) {
  try {
    const [brsResult, pubResult] = await Promise.all([
      brsFetcher.fetchBrsList({ page: 1 }),
      publicationFetcher.fetchPublicationList({ page: 1 }),
    ]);
    
    res.json({
      success: true,
      stats: {
        brs: {
          total: brsResult.pagination.total,
          pages: brsResult.pagination.pages,
        },
        publications: {
          total: pubResult.pagination.total,
          pages: pubResult.pagination.pages,
        },
        combined: brsResult.pagination.total + pubResult.pagination.total,
      },
    });
  } catch (error) {
    console.error('[RAGTrial] Error fetching stats:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * GET /rag-trial/available-years
 * Get available year range for BRS and Publications from BPS API
 * Fetches first and last page to determine year range
 */
async function getAvailableYears(req, res) {
  try {
    // Fetch first page of each to get newest and pagination info
    const [brsFirst, pubFirst] = await Promise.all([
      brsFetcher.fetchBrsList({ page: 1 }),
      publicationFetcher.fetchPublicationList({ page: 1 }),
    ]);
    
    // Fetch last page to get oldest items
    const [brsLast, pubLast] = await Promise.all([
      brsFetcher.fetchBrsList({ page: brsFirst.pagination.pages }),
      publicationFetcher.fetchPublicationList({ page: pubFirst.pagination.pages }),
    ]);
    
    // Extract years from release dates
    const getYear = (dateStr) => {
      if (!dateStr) return null;
      const match = dateStr.match(/(\d{4})/);
      return match ? parseInt(match[1]) : null;
    };
    
    // Get min/max years for BRS
    const brsNewestYear = brsFirst.items.length > 0 ? getYear(brsFirst.items[0].release_date) : null;
    const brsOldestYear = brsLast.items.length > 0 ? getYear(brsLast.items[brsLast.items.length - 1].release_date) : null;
    
    // Get min/max years for Publications
    const pubNewestYear = pubFirst.items.length > 0 ? getYear(pubFirst.items[0].release_date) : null;
    const pubOldestYear = pubLast.items.length > 0 ? getYear(pubLast.items[pubLast.items.length - 1].release_date) : null;
    
    // Current year for upper bound
    const currentYear = new Date().getFullYear();
    
    // Build year arrays (from newest to oldest)
    const brsYears = [];
    if (brsNewestYear && brsOldestYear) {
      for (let y = Math.min(brsNewestYear, currentYear); y >= brsOldestYear; y--) {
        brsYears.push(y);
      }
    }
    
    const pubYears = [];
    if (pubNewestYear && pubOldestYear) {
      for (let y = Math.min(pubNewestYear, currentYear); y >= pubOldestYear; y--) {
        pubYears.push(y);
      }
    }
    
    res.json({
      success: true,
      brs: {
        years: brsYears,
        newestYear: brsNewestYear,
        oldestYear: brsOldestYear,
        total: brsFirst.pagination.total,
      },
      publications: {
        years: pubYears,
        newestYear: pubNewestYear,
        oldestYear: pubOldestYear,
        total: pubFirst.pagination.total,
      },
    });
  } catch (error) {
    console.error('[RAGTrial] Error fetching available years:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * POST /rag-trial/extract-pdf
 * Extract text from a PDF URL
 */
async function extractPdf(req, res) {
  try {
    const { pdfUrl, useOcr = false } = req.body;
    
    if (!pdfUrl) {
      return res.status(400).json({
        success: false,
        error: 'pdfUrl is required',
      });
    }
    
    console.log('[RAGTrial] Extracting PDF from:', pdfUrl.slice(0, 100) + '...', useOcr ? '(with OCR)' : '');
    
    let extractResult;
    let ocrUsed = false;
    
    if (useOcr) {
      // Use Vision OCR
      try {
        const { extractTextFromImages, isVisionAvailable } = require('../services/ai/visionOcr.service');
        
        if (!isVisionAvailable()) {
          return res.status(400).json({
            success: false,
            error: 'Vision OCR is not available. Check OPENAI_API_KEY configuration.',
          });
        }
        
        // Download PDF first
        const pdfBuffer = await pdfExtractor.downloadPdf(pdfUrl, { timeout: 60000 });
        
        // Convert PDF to images and OCR
        const ocrResult = await extractTextFromImages(pdfBuffer, { maxPages: 50 });
        
        extractResult = {
          text: ocrResult.text,
          pages: ocrResult.pageCount,
          textLength: ocrResult.text.length,
          downloadSize: pdfBuffer.length,
          info: { ocrUsed: true, pagesProcessed: ocrResult.pagesProcessed },
        };
        ocrUsed = true;
      } catch (ocrError) {
        console.error('[RAGTrial] OCR failed, falling back to text extraction:', ocrError.message);
        // Fall back to regular extraction
        extractResult = await pdfExtractor.extractTextFromUrl(pdfUrl, {
          timeout: 60000,
        });
      }
    } else {
      // Regular text extraction
      extractResult = await pdfExtractor.extractTextFromUrl(pdfUrl, {
        timeout: 60000,
      });
    }
    
    const analysis = pdfExtractor.analyzeTextQuality(extractResult.text);
    
    // Chunk the text
    const chunks = pdfExtractor.chunkText(extractResult.text, {
      chunkSize: 2000,
      overlap: 200,
    });
    
    res.json({
      success: true,
      ocrUsed,
      extraction: {
        pages: extractResult.pages,
        textLength: extractResult.textLength,
        downloadSize: extractResult.downloadSize,
        info: extractResult.info,
      },
      analysis,
      chunks: {
        count: chunks.length,
        preview: chunks.slice(0, 3).map(c => ({
          index: c.index,
          length: c.chunk.length,
          preview: c.chunk.slice(0, 500) + (c.chunk.length > 500 ? '...' : ''),
        })),
      },
      fullText: extractResult.text.slice(0, 10000) + (extractResult.text.length > 10000 ? '\n\n[... truncated ...]' : ''),
    });
  } catch (error) {
    console.error('[RAGTrial] Error extracting PDF:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * POST /rag-trial/test-embed
 * Test embedding generation for text
 */
async function testEmbed(req, res) {
  try {
    const { text, title } = req.body;
    
    if (!text) {
      return res.status(400).json({
        success: false,
        error: 'text is required',
      });
    }
    
    // Combine title + text for embedding (like datasources do)
    const combinedText = title ? `${title}\n\n${text}` : text;
    
    // Count tokens using BPE tokenizer (o200k_base)
    const estimatedTokens = countTextTokens(combinedText);
    const estimatedCost = (estimatedTokens / 1000) * 0.00002; // $0.00002 per 1K tokens
    
    console.log('[RAGTrial] Generating embedding for', combinedText.length, 'chars (~', estimatedTokens, 'tokens)');
    
    const startTime = Date.now();
    const embedding = await generateEmbedding(combinedText);
    const duration = Date.now() - startTime;
    
    res.json({
      success: true,
      embedding: {
        dimensions: embedding.length,
        sample: embedding.slice(0, 10), // First 10 dimensions as sample
        magnitude: Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0)),
      },
      stats: {
        inputLength: combinedText.length,
        estimatedTokens,
        estimatedCostUsd: estimatedCost.toFixed(8),
        durationMs: duration,
      },
    });
  } catch (error) {
    console.error('[RAGTrial] Error generating embedding:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * POST /rag-trial/analyze-abstract
 * Analyze abstract quality and generate embedding preview
 */
async function analyzeAbstract(req, res) {
  try {
    const { title, abstract, type } = req.body;
    
    if (!abstract) {
      return res.status(400).json({
        success: false,
        error: 'abstract is required',
      });
    }
    
    // Clean the abstract
    const cleanAbstract = brsFetcher.cleanHtml(abstract);
    
    // Prepare text for embedding
    const embeddingText = `${title || ''}\n\n${cleanAbstract}`;
    
    // Count tokens using BPE tokenizer
    const estimatedTokens = countTextTokens(embeddingText);
    const estimatedCost = (estimatedTokens / 1000) * 0.00002;
    
    // Analyze content
    const wordCount = cleanAbstract.split(/\s+/).filter(w => w.length > 0).length;
    const hasNumbers = /\d+[,.]?\d*/.test(cleanAbstract);
    const hasPercentage = /%|persen/.test(cleanAbstract);
    
    res.json({
      success: true,
      original: {
        length: abstract.length,
        hasHtml: abstract !== cleanAbstract,
      },
      cleaned: {
        text: cleanAbstract,
        length: cleanAbstract.length,
        wordCount,
      },
      forEmbedding: {
        text: embeddingText.slice(0, 500) + (embeddingText.length > 500 ? '...' : ''),
        totalLength: embeddingText.length,
        estimatedTokens,
        estimatedCostUsd: estimatedCost.toFixed(8),
      },
      contentAnalysis: {
        hasNumbers,
        hasPercentage,
        type: type || 'unknown',
        quality: wordCount > 30 ? 'good' : wordCount > 10 ? 'moderate' : 'short',
      },
    });
  } catch (error) {
    console.error('[RAGTrial] Error analyzing abstract:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * POST /rag-trial/compare
 * Compare abstract vs PDF extraction
 */
async function compareExtraction(req, res) {
  try {
    const { title, abstract, pdfUrl } = req.body;
    
    if (!abstract || !pdfUrl) {
      return res.status(400).json({
        success: false,
        error: 'abstract and pdfUrl are required',
      });
    }
    
    // Clean abstract
    const cleanAbstract = brsFetcher.cleanHtml(abstract);
    
    // Extract PDF
    let pdfResult = null;
    let pdfError = null;
    
    try {
      pdfResult = await pdfExtractor.extractTextFromUrl(pdfUrl, { timeout: 60000 });
    } catch (e) {
      pdfError = e.message;
    }
    
    // Compare
    const comparison = {
      abstract: {
        length: cleanAbstract.length,
        tokens: countTextTokens(cleanAbstract),
        cost: (countTextTokens(cleanAbstract) / 1000 * 0.00002).toFixed(8),
        preview: cleanAbstract.slice(0, 500),
      },
      pdf: pdfResult ? {
        pages: pdfResult.pages,
        length: pdfResult.textLength,
        tokens: countTextTokens(pdfResult.text || ''),
        cost: (countTextTokens(pdfResult.text || '') / 1000 * 0.00002).toFixed(8),
        quality: pdfExtractor.analyzeTextQuality(pdfResult.text),
        preview: pdfResult.text.slice(0, 1000),
      } : {
        error: pdfError,
      },
    };
    
    // Recommendation
    let recommendation = '';
    if (pdfError) {
      recommendation = 'PDF extraction failed - use abstract only';
    } else if (pdfResult.textLength < cleanAbstract.length * 2) {
      recommendation = 'PDF has little additional content - abstract may be sufficient';
    } else if (comparison.pdf.quality?.quality === 'poor') {
      recommendation = 'PDF extraction quality is poor - consider Vision OCR or use abstract only';
    } else if (comparison.pdf.quality?.quality === 'good') {
      recommendation = 'PDF extraction is good - can use full text for richer context';
    } else {
      recommendation = 'PDF has moderate quality - test with real queries before deciding';
    }
    
    res.json({
      success: true,
      title,
      comparison,
      recommendation,
      costDifference: {
        abstractCost: comparison.abstract.cost,
        pdfCost: comparison.pdf.cost || '0',
        multiplier: pdfResult ? Math.round(pdfResult.textLength / cleanAbstract.length) : 0,
      },
    });
  } catch (error) {
    console.error('[RAGTrial] Error comparing:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * POST /rag-trial/test-search
 * Test RAG search against knowledge base
 */
async function testSearch(req, res) {
  try {
    const { query, topN = 5, includeEmbedding = false } = req.body;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'query is required',
      });
    }
    
    console.log('[RAGTrial] Testing RAG search:', query.slice(0, 100));
    
    // Lazy load vectorSearch to avoid circular deps
    let vectorSearchService;
    try {
      vectorSearchService = require('../services/ai/vectorSearch.service');
    } catch (e) {
      return res.status(500).json({
        success: false,
        error: 'Vector search service not available: ' + e.message,
      });
    }
    
    const startTime = Date.now();
    
    // =====================================================
    // PERIOD EXTRACTION from query
    // =====================================================
    const extractedPeriod = extractPeriodFromQuery(query);
    console.log('[RAGTrial] Extracted period:', extractedPeriod);
    
    // Test knowledge base search - ensure arrays
    let knowledgeResults = [];
    let datasourceResults = [];
    
    try {
      if (vectorSearchService.searchKnowledge) {
        const kbResult = await vectorSearchService.searchKnowledge(query, topN * 2); // Get more for filtering
        // searchKnowledge returns { results: [...], reranked, ... } or array
        knowledgeResults = Array.isArray(kbResult) 
          ? kbResult 
          : (Array.isArray(kbResult?.results) ? kbResult.results : []);
      }
    } catch (kbErr) {
      console.warn('[RAGTrial] Knowledge search failed:', kbErr.message);
    }
    
    try {
      if (vectorSearchService.searchDatasources) {
        const dsResult = await vectorSearchService.searchDatasources(query, topN * 2); // Get more for filtering
        // searchDatasources returns { results: [...] } or array
        datasourceResults = Array.isArray(dsResult) 
          ? dsResult 
          : (Array.isArray(dsResult?.results) ? dsResult.results : []);
      }
    } catch (dsErr) {
      console.warn('[RAGTrial] Datasource search failed:', dsErr.message);
    }
    
    // =====================================================
    // PERIOD-BASED FILTERING
    // =====================================================
    let periodFilterApplied = false;
    let datasourcePeriodMatches = [];
    
    // Filter datasources by period availability
    // Note: searchDatasources returns { id, name, type, ... } not source_id
    if (extractedPeriod.hasPeriod && datasourceResults.length > 0) {
      const DataPeriod = require('../models/DataPeriod.model');
      const periodPattern = buildPeriodPattern(extractedPeriod);
      
      // Get source_ids that have matching period
      const matchingPeriods = await DataPeriod.findAll({
        where: {
          source_id: datasourceResults.map(d => d.id), // Use 'id' not 'source_id'
        },
        attributes: ['source_id', 'period_value'],
      });
      
      // Group by source_id
      const periodsBySource = {};
      for (const p of matchingPeriods) {
        if (!periodsBySource[p.source_id]) periodsBySource[p.source_id] = [];
        periodsBySource[p.source_id].push(p.period_value);
      }
      
      // Filter datasources that have matching period
      datasourceResults = datasourceResults.filter(ds => {
        const periods = periodsBySource[ds.id] || []; // Use 'id' not 'source_id'
        const hasMatchingPeriod = periods.some(pv => periodPattern.test(pv));
        if (hasMatchingPeriod) {
          datasourcePeriodMatches.push({
            source_id: ds.id,
            matchedPeriod: periods.find(pv => periodPattern.test(pv)),
          });
        }
        return hasMatchingPeriod;
      });
      
      periodFilterApplied = true;
    }
    
    // Filter BRS/Publications by content context (title + content should mention period)
    if (extractedPeriod.hasPeriod) {
      const contentPattern = buildContentPeriodPattern(extractedPeriod);
      
      knowledgeResults = knowledgeResults.filter(kr => {
        const category = String(kr.category || '').toLowerCase();
        
        // Only filter BRS and Publications by period context
        if (category === 'brs' || category === 'publication') {
          const textToCheck = `${kr.title || ''} ${kr.content || ''} ${kr.snippet || ''}`.toLowerCase();
          return contentPattern.test(textToCheck);
        }
        
        // Keep all custom docs (PPID, FAQ, etc.) - they don't need period matching
        return true;
      });
      
      periodFilterApplied = true;
    }
    
    // =====================================================
    // RELEVANCE THRESHOLD FILTERING
    // =====================================================
    // Only show results with meaningful similarity (filter out noise)
    const SIMILARITY_THRESHOLD_KNOWLEDGE = 0.35; // Knowledge docs (BRS/Pub/Custom)
    const SIMILARITY_THRESHOLD_DATASOURCE = 0.40; // Datasources need higher match
    
    // Filter by relevance - keep only sufficiently similar results
    const beforeFilterKnowledge = knowledgeResults.length;
    const beforeFilterDatasource = datasourceResults.length;
    
    knowledgeResults = knowledgeResults.filter(r => 
      (r.similarity || 0) >= SIMILARITY_THRESHOLD_KNOWLEDGE
    );
    datasourceResults = datasourceResults.filter(r => 
      (r.similarity || 0) >= SIMILARITY_THRESHOLD_DATASOURCE
    );
    
    const relevanceFilterApplied = 
      (beforeFilterKnowledge > knowledgeResults.length) || 
      (beforeFilterDatasource > datasourceResults.length);
    
    // Limit results after filtering
    datasourceResults = datasourceResults.slice(0, topN);
    knowledgeResults = knowledgeResults.slice(0, topN);
    
    // =====================================================
    // AI RELEVANCE FILTER (for statistical package)
    // =====================================================
    // Use GPT to determine which results are TRULY relevant to the query
    // This filters out results that are similar by embedding but not semantically relevant
    let aiRelevanceFilter = { applied: false };
    const useAiFilter = req.query.useAiFilter !== 'false'; // Default: enabled
    
    if (useAiFilter && (datasourceResults.length > 0 || knowledgeResults.filter(r => isStatisticalCategory(r.category)).length > 0)) {
      try {
        const { filterStatisticalRelevance } = require('../services/ai/reranker.service');
        
        // Only filter statistical knowledge docs (BRS, publications), keep custom docs as-is
        const statisticalKnowledge = knowledgeResults.filter(r => isStatisticalCategory(r.category));
        const customKnowledge = knowledgeResults.filter(r => !isStatisticalCategory(r.category));
        
        const filterResult = await filterStatisticalRelevance(
          query,
          datasourceResults,
          statisticalKnowledge,
          { maxCandidates: 8 }
        );
        
        if (filterResult.filtered) {
          datasourceResults = filterResult.datasources;
          // Merge back custom knowledge with filtered statistical knowledge
          knowledgeResults = [...filterResult.knowledge, ...customKnowledge];
          
          aiRelevanceFilter = {
            applied: true,
            reason: filterResult.reason,
            latencyMs: filterResult.latencyMs,
            stats: filterResult.stats,
            relevantIds: filterResult.relevantIds,
          };
          console.log(`[RAGTrial] AI filter applied: DS ${filterResult.stats?.before?.datasources}→${filterResult.stats?.after?.datasources}, KB ${filterResult.stats?.before?.knowledge}→${filterResult.stats?.after?.knowledge}`);
        }
      } catch (filterErr) {
        console.warn('[RAGTrial] AI relevance filter failed:', filterErr.message);
        aiRelevanceFilter = { applied: false, error: filterErr.message };
      }
    }
    
    const duration = Date.now() - startTime;
    
    // IMPORTANT: For routing decision, only use CUSTOM DOCS (PPID, FAQ, guides)
    // BRS and Publications are STATISTICAL content, not knowledge/service
    const customDocsResults = knowledgeResults.filter(r => 
      isCustomDocCategory(r.category)
    );
    const statisticalDocsResults = knowledgeResults.filter(r => 
      isStatisticalCategory(r.category)
    );
    
    // Use ONLY custom docs similarity for routing decision
    const topCustomDocSimilarity = customDocsResults[0]?.similarity || 0;
    // Keep track of top BRS/Pub for display
    const topStatisticalDocSimilarity = statisticalDocsResults[0]?.similarity || 0;
    
    // Use shared query routing analysis
    const routingAnalysis = analyzeQueryRouting(query, topCustomDocSimilarity);
    
    // Generate query embedding for comparison
    let queryEmbedding = null;
    if (includeEmbedding) {
      queryEmbedding = await generateEmbedding(query);
    }
    
    res.json({
      success: true,
      query,
      periodFilter: {
        applied: periodFilterApplied,
        extracted: extractedPeriod.hasPeriod || extractedPeriod.hasPartialPeriod ? extractedPeriod : null,
        datasourceMatches: datasourcePeriodMatches,
        note: extractedPeriod.hasPartialPeriod 
          ? 'Bulan/triwulan terdeteksi tanpa tahun - period filter tidak diterapkan' 
          : null,
      },
      queryRouting: {
        type: routingAnalysis.type,
        reason: routingAnalysis.reason,
        signals: routingAnalysis.signals,
        topCustomDocSimilarity: topCustomDocSimilarity.toFixed(4),
        topStatisticalDocSimilarity: topStatisticalDocSimilarity.toFixed(4),
        recommendation: routingAnalysis.type === 'non-statistical' 
          ? 'Use custom docs context (PPID/FAQ), skip data table' 
          : 'Show data table + include BRS/Publications as context',
      },
      results: {
        knowledge: knowledgeResults.map(r => ({
          id: r.id,
          title: r.title,
          category: r.category,
          source: r.source,
          isStatistical: isStatisticalCategory(r.category),
          similarity: r.similarity?.toFixed(4),
          snippet: r.snippet?.slice(0, 300) || r.content?.slice(0, 300),
        })),
        datasources: datasourceResults.map(r => {
          const periodMatch = datasourcePeriodMatches.find(pm => pm.source_id === r.id);
          return {
            id: r.id, // searchDatasources returns 'id' not 'source_id'
            name: r.name,
            type: r.type,
            similarity: r.similarity?.toFixed(4),
            description: r.description?.slice(0, 200),
            matchedPeriod: periodMatch?.matchedPeriod || null,
          };
        }),
      },
      stats: {
        durationMs: duration,
        knowledgeCount: knowledgeResults.length,
        datasourceCount: datasourceResults.length,
        relevanceFilter: {
          applied: relevanceFilterApplied,
          thresholds: {
            knowledge: SIMILARITY_THRESHOLD_KNOWLEDGE,
            datasource: SIMILARITY_THRESHOLD_DATASOURCE,
          },
          filtered: {
            knowledge: beforeFilterKnowledge - knowledgeResults.length,
            datasource: beforeFilterDatasource - datasourceResults.length,
          },
        },
        aiRelevanceFilter,
      },
      queryEmbedding: queryEmbedding ? {
        dimensions: queryEmbedding.length,
        sample: queryEmbedding.slice(0, 5),
      } : null,
    });
  } catch (error) {
    console.error('[RAGTrial] Error testing search:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * GET /rag-trial/indexed
 * Get list of indexed BRS/Publications
 */
async function getIndexedList(req, res) {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const doc_type = req.query.doc_type || req.query.type;
    const { year, status } = req.query;
    
    const { IndexedBrsPublikasi } = require('../models');
    
    const where = {};
    if (doc_type) where.doc_type = doc_type;
    if (year) where.year = parseInt(year);
    if (status) where.status = status;
    
    const offset = (page - 1) * limit;
    
    const { count, rows } = await IndexedBrsPublikasi.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });
    
    res.json({
      success: true,
      data: rows,
      pagination: {
        total: count,
        page,
        pages: Math.ceil(count / limit),
        limit,
      },
    });
  } catch (error) {
    console.error('[RAGTrial] Error fetching indexed list:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * GET /rag-trial/indexed/stats
 * Get indexed statistics
 */
async function getIndexedStats(req, res) {
  try {
    const { IndexedBrsPublikasi } = require('../models');
    const { Op, fn, col } = require('sequelize');
    
    // Count by type
    const byType = await IndexedBrsPublikasi.findAll({
      attributes: [
        'doc_type',
        [fn('COUNT', col('id')), 'count'],
      ],
      group: ['doc_type'],
    });
    
    // Count by status
    const byStatus = await IndexedBrsPublikasi.findAll({
      attributes: [
        'status',
        [fn('COUNT', col('id')), 'count'],
      ],
      group: ['status'],
    });
    
    // Count by year
    const byYear = await IndexedBrsPublikasi.findAll({
      attributes: [
        'year',
        [fn('COUNT', col('id')), 'count'],
      ],
      where: { year: { [Op.not]: null } },
      group: ['year'],
      order: [['year', 'DESC']],
    });
    
    // Total
    const total = await IndexedBrsPublikasi.count();
    const success = await IndexedBrsPublikasi.count({ where: { status: 'success' } });
    const errors = await IndexedBrsPublikasi.count({ where: { status: 'error' } });
    
    res.json({
      success: true,
      stats: {
        total,
        success,
        errors,
        byType: byType.reduce((acc, r) => ({ ...acc, [r.doc_type]: parseInt(r.get('count')) }), {}),
        byStatus: byStatus.reduce((acc, r) => ({ ...acc, [r.status]: parseInt(r.get('count')) }), {}),
        byYear: byYear.map(r => ({ year: r.year, count: parseInt(r.get('count')) })),
      },
    });
  } catch (error) {
    console.error('[RAGTrial] Error fetching indexed stats:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * POST /rag-trial/index
 * Index a BRS/Publication to Knowledge Base
 */
async function indexDocument(req, res) {
  try {
    // Support both camelCase and snake_case from frontend
    const doc_type = req.body.doc_type || req.body.docType;
    const external_id = String(req.body.external_id || req.body.externalId); // Ensure string for VARCHAR column
    const { title, abstract, pdf_url, index_mode } = req.body;
    const release_date = req.body.release_date || req.body.releaseDate;
    const mode = index_mode || req.body.mode || 'abstract';
    
    if (!doc_type || !external_id || !title) {
      return res.status(400).json({
        success: false,
        error: 'doc_type, external_id, and title are required',
      });
    }
    
    const { IndexedBrsPublikasi, KnowledgeBase } = require('../models');
    
    // Check if already indexed
    const existing = await IndexedBrsPublikasi.findOne({
      where: { doc_type, external_id },
    });
    
    if (existing) {
      return res.json({
        success: true,
        message: 'Already indexed',
        existing: true,
        data: existing,
        status: existing.status,
      });
    }
    
    // Build content
    let content = `${title}\n\n${abstract || ''}`;
    let pdfError = null;
    
    if (mode === 'abstract+pdf' || mode === 'abstract+ocr') {
      try {
        console.log(`[RAGTrial] Extracting PDF from: ${pdf_url}`);
        const extractResult = await pdfExtractor.extractTextFromUrl(pdf_url, { 
          timeout: 60000,
          useOcr: mode === 'abstract+ocr',
        });
        if (extractResult.text && extractResult.text.length > 100) {
          content += `\n\n--- PDF Content ---\n\n${extractResult.text}`;
        }
      } catch (e) {
        console.warn(`[RAGTrial] PDF extraction failed for ${external_id}:`, e.message);
        pdfError = e.message;
        // Continue with abstract only
      }
    }
    
    // Extract year from release_date
    let year = req.body.year;
    if (!year && release_date) {
      const match = String(release_date).match(/(\d{4})/);
      if (match) year = parseInt(match[1]);
    }
    
    // Create knowledge base document
    const kbDoc = await KnowledgeBase.create({
      title,
      description: `${doc_type === 'brs' ? 'BRS' : 'Publikasi'} - ${release_date || 'Unknown date'} [${mode}]`,
      category: doc_type === 'brs' ? 'BRS' : 'Publikasi',
      source_type: 'text',
      content,
      status: 'pending',
    });
    
    // Generate embedding for the document
    let embeddingSuccess = false;
    try {
      const embeddingService = require('../services/ai/embedding.service');
      // Use ~5500 chars to leave room for title/abstract and stay within 8192 token limit
      const textToEmbed = `${title}\n${abstract || ''}\n${content.slice(0, 5500)}`;
      const embedding = await embeddingService.generateEmbedding(textToEmbed);
      
      if (embedding && embedding.length > 0) {
        await kbDoc.update({
          embedding: JSON.stringify(embedding),
          status: 'ready',
        });
        embeddingSuccess = true;
        console.log(`[RAGTrial] Embedding generated for ${doc_type} ${external_id}, ${embedding.length} dimensions`);
      }
    } catch (embedErr) {
      console.warn(`[RAGTrial] Embedding generation failed for ${external_id}:`, embedErr.message);
      // Document is still created but without embedding
    }
    
    // Invalidate vector search cache so new doc appears in search
    if (embeddingSuccess) {
      try {
        const vectorSearch = require('../services/ai/vectorSearch.service');
        if (vectorSearch.loadKnowledgeEmbeddings) {
          await vectorSearch.loadKnowledgeEmbeddings(true); // force reload
        }
      } catch (cacheErr) {
        console.warn('[RAGTrial] Cache invalidation failed:', cacheErr.message);
      }
    }
    
    // Track in indexed table
    const indexed = await IndexedBrsPublikasi.create({
      doc_type,
      external_id,
      title,
      release_date,
      year,
      index_mode: mode,
      knowledge_doc_id: kbDoc.id,
      content_length: content.length,
      status: embeddingSuccess ? 'success' : 'error',
      error_message: pdfError || (embeddingSuccess ? null : 'Embedding generation failed'),
      pdf_url,
    });
    
    res.json({
      success: true,
      data: indexed,
      knowledgeDocId: kbDoc.id,
      contentLength: content.length,
      pdfError,
      embeddingSuccess,
      status: embeddingSuccess ? 'success' : 'partial',
    });
  } catch (error) {
    console.error('[RAGTrial] Error indexing document:', error.message);
    
    // Try to track the error
    try {
      const { IndexedBrsPublikasi } = require('../models');
      const doc_type = req.body.doc_type || req.body.docType || 'brs';
      const external_id = String(req.body.external_id || req.body.externalId || '0'); // Ensure string
      const release_date = req.body.release_date || req.body.releaseDate;
      const index_mode = req.body.index_mode || req.body.mode || 'abstract';
      const pdf_url = req.body.pdf_url || req.body.pdfUrl;
      
      await IndexedBrsPublikasi.create({
        doc_type,
        external_id,
        title: req.body.title || 'Unknown',
        release_date,
        year: req.body.year,
        index_mode,
        status: 'error',
        error_message: error.message,
        pdf_url,
      });
    } catch (trackError) {
      console.error('[RAGTrial] Failed to track error:', trackError.message);
    }
    
    res.status(500).json({
      success: false,
      error: error.message,
      status: 'error',
    });
  }
}

/**
 * DELETE /rag-trial/indexed/:id
 * Remove an indexed document
 */
async function removeIndexed(req, res) {
  try {
    const { id } = req.params;
    const { IndexedBrsPublikasi } = require('../models');
    
    const doc = await IndexedBrsPublikasi.findByPk(id);
    if (!doc) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    
    await doc.destroy();
    
    res.json({ success: true, message: 'Removed' });
  } catch (error) {
    console.error('[RAGTrial] Error removing indexed:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * POST /rag-trial/check-indexed
 * Check which items are already indexed
 */
async function checkIndexed(req, res) {
  try {
    const { items } = req.body; // Array of { doc_type, external_id } or { docType, externalId }
    
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ success: false, error: 'items array required' });
    }
    
    const { IndexedBrsPublikasi } = require('../models');
    const { Op } = require('sequelize');
    
    // Support both snake_case (from frontend) and camelCase formats
    const normalizedItems = items.map(item => ({
      doc_type: item.doc_type || item.docType,
      external_id: String(item.external_id || item.externalId), // Ensure string for VARCHAR column
    })).filter(item => item.doc_type && item.external_id); // Filter out invalid items
    
    if (normalizedItems.length === 0) {
      return res.json({ success: true, indexed: {}, count: 0 });
    }
    
    const indexed = await IndexedBrsPublikasi.findAll({
      where: {
        [Op.or]: normalizedItems.map(item => ({
          doc_type: item.doc_type,
          external_id: item.external_id,
        })),
      },
      attributes: ['doc_type', 'external_id', 'status', 'created_at'],
    });
    
    const indexedMap = {};
    indexed.forEach(doc => {
      indexedMap[`${doc.doc_type}_${doc.external_id}`] = {
        status: doc.status,
        indexedAt: doc.created_at,
      };
    });
    
    res.json({
      success: true,
      indexed: indexedMap,
      count: indexed.length,
    });
  } catch (error) {
    console.error('[RAGTrial] Error checking indexed:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = {
  getBrsList,
  getPublicationsList,
  getStats,
  getAvailableYears,
  extractPdf,
  testEmbed,
  analyzeAbstract,
  compareExtraction,
  testSearch,
  getIndexedList,
  getIndexedStats,
  indexDocument,
  removeIndexed,
  checkIndexed,
};
