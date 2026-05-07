/**
 * UI Metadata Service
 * 
 * Builds UI metadata for chat responses including candidates, suggestions,
 * data tables, and sources.
 * 
 * Extracted from streaming.service.js during Phase 4+ refactor.
 */

'use strict';

const { buildContextualSuggestions } = require('./chatHelpers');
const logger = require('../../../utils/logger').child({ service: 'UIMetadata' });

// ============================================================================
// BUILD UI METADATA
// ============================================================================

/**
 * Build UI metadata object for frontend rendering
 * @param {Object} intentResult - Intent resolution result
 * @param {Array} candidates - Datasource candidates
 * @param {Object} dataPreview - Data preview object
 * @param {Object|null} periodFallback - Period fallback info
 * @param {Array|null} contextualSuggestions - Pre-built suggestions
 * @param {Object|null} eximParams - EXIM-specific parameters
 * @param {boolean} isKnowledgeMode - Whether in knowledge/FAQ mode
 * @param {string|null} conversationTopic - Current conversation topic
 * @param {Object|null} brsContext - BRS/Publication context
 * @param {Array|null} knowledgeContext - Knowledge base results
 * @param {Array|null} externalLinks - External web search results (display-only, not in AI context)
 * @param {boolean} aiFilterApplied - Whether AI relevance filter was applied (prevents unfiltered fallback)
 * @returns {Object} UI metadata object
 */
function buildUIMetadata(
  intentResultOrOpts, 
  candidates, 
  dataPreview, 
  periodFallback = null, 
  contextualSuggestions = null, 
  eximParams = null, 
  isKnowledgeMode = false, 
  conversationTopic = null, 
  brsContext = null, 
  knowledgeContext = null,
  externalLinks = null,
  aiFilterApplied = false,
  agentRecommendations = null,
  confidenceInfo = null,
  dataPreviewSecondary = null
) {
  // Support both options-object and positional args (backward compat)
  let intentResult;
  if (intentResultOrOpts && typeof intentResultOrOpts === 'object' && '_opts' in intentResultOrOpts) {
    // Options object style: buildUIMetadata({ _opts: true, intentResult, candidates, ... })
    const o = intentResultOrOpts;
    intentResult = o.intentResult;
    candidates = o.candidates || [];
    dataPreview = o.dataPreview || null;
    periodFallback = o.periodFallback || null;
    contextualSuggestions = o.contextualSuggestions || null;
    eximParams = o.eximParams || null;
    isKnowledgeMode = o.isKnowledgeMode || false;
    conversationTopic = o.conversationTopic || null;
    brsContext = o.brsContext || null;
    knowledgeContext = o.knowledgeContext || null;
    externalLinks = o.externalLinks || null;
    aiFilterApplied = o.aiFilterApplied || false;
    agentRecommendations = o.agentRecommendations || null;
    confidenceInfo = o.confidenceInfo || null;
    dataPreviewSecondary = o.dataPreviewSecondary || null;
  } else {
    intentResult = intentResultOrOpts;
  }
  const qb = intentResult?.query_builder;
  const year = periodFallback?.actualYear || qb?.params?.year || null;
  const month = eximParams?.month || qb?.params?.month || null;
  const geo = qb?.params?.geo || null;
  
  // Build suggestions if not provided
  const suggestions = contextualSuggestions || buildContextualSuggestions({
    conversationTopic: conversationTopic,
    currentSourceName: candidates?.[0]?.name || null,
    requestedYear: year,
    requestedGeo: geo,
    candidates,
    hasDataPreview: Boolean(dataPreview),
    isKnowledgeMode: isKnowledgeMode,
  });

  // Build knowledge candidates (BRS/Publications) as separate cluster
  // Pass aiFilterApplied to prevent unfiltered fallback when AI already rejected results
  const knowledgeCandidates = buildKnowledgeCandidates(brsContext, knowledgeContext, !!dataPreview, aiFilterApplied);

  return {
    v: 1,
    query: qb?.params?.q || intentResult?.query || null,
    preview_mode: dataPreview ? 'auto' : 'none',
    candidates: candidates.slice(0, 5).map(c => {
      const params = new URLSearchParams();
      params.set('source_id', String(c.id));
      if (c.type) params.set('type', c.type);
      if (year) params.set('period', String(year));
      if (month) params.set('month', String(month));
      if (geo) params.set('geo', geo);
      
      // Include EXIM-specific params
      const isEximSource = c.type === 'exim' || c.id === 159 || c.id === 160;
      if (isEximSource && eximParams) {
        if (eximParams.group) params.set('group', eximParams.group);
        if (eximParams.facets?.code_hs) params.set('code_hs', eximParams.facets.code_hs);
        if (eximParams.facets?.pod) params.set('pod', eximParams.facets.pod);
        if (eximParams.facets?.ctr) params.set('ctr', eximParams.facets.ctr);
      }
      
      return {
        id: c.id,
        name: c.name,
        type: c.type,
        score: c.score,
        href: `/data?${params.toString()}`,
      };
    }),
    // NEW: Knowledge candidates as separate cluster (BRS, Publikasi)
    knowledgeCandidates: knowledgeCandidates,
    // External links from web search (display-only, NOT part of AI context)
    externalLinks: buildExternalLinksForUI(externalLinks),
    period_fallback: periodFallback || null,
    table: dataPreview ? buildTableMeta(dataPreview) : null,
    table2: dataPreviewSecondary ? buildTableMeta(dataPreviewSecondary) : null,
    sources: buildSources(brsContext, knowledgeContext, !!dataPreview),
    suggestions: suggestions.slice(0, 5),
    // OpenClaw-inspired: Agent recommendations for related topics
    recommendations: agentRecommendations || [],
    // OpenClaw-inspired: Confidence scoring for response reliability
    confidence: confidenceInfo || null,
  };
}

/**
 * Build table metadata from data preview
 */
function buildTableMeta(dataPreview) {
  const metricColumns = (dataPreview.columns || []).filter(c => 
    !['Bulan', 'Wilayah', 'Tahun', 'Period', 'Periode', 'Kabupaten/Kota'].includes(c)
  );
  
  // Filter rows where at least one metric column has non-null value
  const filteredRows = (dataPreview.rows || []).filter(row => {
    return metricColumns.some(col => row[col] !== null && row[col] !== undefined);
  });
  
  return {
    kind: 'data',
    title: dataPreview.title,
    columns: dataPreview.columns,
    rows: filteredRows,
    total_rows: filteredRows.length,
    periodRange: dataPreview.periodRange || null,
    eximGroup: dataPreview.eximGroup || null,
    eximMode: dataPreview.eximMode || null,
    bps_web_url: dataPreview.bps_web_url || null,
    // All-years data for modal year-tab UI
    source_id: dataPreview.source_id || null,
    allRows: dataPreview.allRows || null,
    allColumns: dataPreview.allColumns || null,
    availableYears: dataPreview.availableYears || null,
    defaultYear: dataPreview.defaultYear || null,
  };
}

// ============================================================================
// BUILD SOURCES
// ============================================================================

/**
 * Build sources array from BRS context OR knowledge context for frontend display
 * @param {Object|null} brsContext - BRS/Publication context {brs: Array, publications: Array}
 * @param {Array|null} knowledgeContext - Knowledge base search results
 * @param {boolean} isDataQuery - If true, don't fallback to knowledgeContext when brsContext is empty
 */
function buildSources(brsContext, knowledgeContext = null, isDataQuery = false) {
  const sources = [];
  
  logger.debug({ 
    brsContext: !!brsContext, 
    brsCount: brsContext?.brs?.length || 0, 
    pubCount: brsContext?.publications?.length || 0,
    knowledgeCount: knowledgeContext?.length || 0, 
    isDataQuery 
  }, 'buildSources called');
  
  // IMPORTANT: Use ONLY knowledgeContext (which is filtered by AI relevance filter)
  // brsContext is NOT filtered and may contain irrelevant results
  if (knowledgeContext && knowledgeContext.length > 0) {
    for (const doc of knowledgeContext.slice(0, 4)) {
      const category = doc.category || 'Other';
      sources.push({
        type: category === 'BRS' ? 'brs' : (category === 'Publikasi' ? 'publication' : 'other'),
        id: doc.id,
        title: doc.title || doc.name,
        similarity: doc.similarity,
        category: category,
      });
    }
  }
  
  // Fallback to brsContext ONLY if knowledgeContext is empty
  if (sources.length === 0 && brsContext) {
    if (brsContext.brs && brsContext.brs.length > 0) {
      for (const brs of brsContext.brs.slice(0, 2)) {
        logger.debug({ id: brs.id, name: brs.name?.slice(0, 50) }, 'Adding BRS source (fallback)');
        sources.push({
          type: 'brs',
          id: brs.id,
          title: brs.title || brs.name,
          similarity: brs.similarity,
          category: 'BRS',
        });
      }
    }
    
    if (brsContext.publications && brsContext.publications.length > 0) {
      for (const pub of brsContext.publications.slice(0, 2)) {
        logger.debug({ id: pub.id, name: pub.name?.slice(0, 50) }, 'Adding Publication source (fallback)');
        sources.push({
          type: 'publication',
          id: pub.id,
          title: pub.title || pub.name,
          similarity: pub.similarity,
          category: 'Publikasi',
        });
      }
    }
  }
  
  logger.debug({ sourceCount: sources.length }, 'buildSources result');
  return sources.length > 0 ? sources : null;
}

// ============================================================================
// BUILD KNOWLEDGE CANDIDATES
// ============================================================================

/**
 * Build knowledge candidates array (BRS/Publications) as clickable chips
 * Separate from datasource candidates for distinct UI clustering
 * 
 * @param {Object|null} brsContext - BRS/Publication context from searchBrsForInterpretation
 * @param {Array|null} knowledgeContext - Knowledge base search results
 * @param {boolean} isDataQuery - If true, prioritize datasource candidates
 * @param {boolean} aiFilterApplied - If true, AI filter was used; don't fallback to unfiltered brsContext
 * @returns {Array|null} Knowledge candidates array or null if empty
 */
function buildKnowledgeCandidates(brsContext, knowledgeContext = null, isDataQuery = false, aiFilterApplied = false) {
  const candidates = [];
  
  // Minimum similarity threshold to avoid showing irrelevant references
  const MIN_SIMILARITY = 0.65;
  
  logger.debug({ 
    brsContext: !!brsContext, 
    brsCount: brsContext?.brs?.length || 0, 
    pubCount: brsContext?.publications?.length || 0,
    knowledgeCount: knowledgeContext?.length || 0, 
    isDataQuery 
  }, 'buildKnowledgeCandidates called');
  
  // IMPORTANT: Use ONLY knowledgeContext (which is filtered by AI relevance filter)
  // brsContext is NOT filtered and may contain irrelevant results
  // Priority: Prioritize BRS first, then Publikasi to ensure both types are shown
  if (knowledgeContext && knowledgeContext.length > 0) {
    // Track existing IDs to avoid duplicates
    const existingIds = new Set();
    
    // Filter by minimum similarity to exclude irrelevant results
    const relevantDocs = knowledgeContext.filter(doc => (doc.similarity || 0) >= MIN_SIMILARITY);
    
    if (relevantDocs.length < knowledgeContext.length) {
      logger.debug({
        total: knowledgeContext.length,
        filtered: relevantDocs.length,
        removed: knowledgeContext.length - relevantDocs.length,
        threshold: MIN_SIMILARITY,
      }, 'Knowledge candidates filtered by similarity threshold');
    }
    
    // Separate categories from knowledge context
    const PPID_CATEGORIES = new Set(['PPID', 'FAQ', 'Guide', 'Custom']);
    const brsFromKnowledge = relevantDocs.filter(doc => doc.category === 'BRS');
    const pubFromKnowledge = relevantDocs.filter(doc => doc.category === 'Publikasi');
    const ppidFromKnowledge = relevantDocs.filter(doc => PPID_CATEGORIES.has(doc.category));
    
    // Add up to 3 BRS first
    for (const doc of brsFromKnowledge.slice(0, 3)) {
      if (existingIds.has(doc.id)) continue;
      
      candidates.push({
        id: doc.id,
        name: doc.title || doc.name,
        type: 'brs',
        category: 'BRS',
        similarity: doc.similarity,
        href: `/brs/${doc.id}`,
      });
      existingIds.add(doc.id);
    }
    
    // Then add up to 3 Publikasi
    for (const doc of pubFromKnowledge.slice(0, 3)) {
      if (existingIds.has(doc.id)) continue;
      
      candidates.push({
        id: doc.id,
        name: doc.title || doc.name,
        type: 'publication',
        category: 'Publikasi',
        similarity: doc.similarity,
        href: `/publikasi/${doc.id}`,
      });
      existingIds.add(doc.id);
    }
    
    // Add up to 3 PPID/FAQ/Guide/Custom docs (institutional/custom content)
    for (const doc of ppidFromKnowledge.slice(0, 3)) {
      if (existingIds.has(doc.id)) continue;
      
      candidates.push({
        id: doc.id,
        name: doc.title || doc.name,
        type: 'ppid',
        category: doc.category || 'PPID',
        similarity: doc.similarity,
        href: null, // Opens in KnowledgeModal, not external link
      });
      existingIds.add(doc.id);
    }
  }
  
  // Fallback to brsContext ONLY if:
  // 1. knowledgeContext is empty, AND
  // 2. AI filter was NOT applied (brsContext is also filtered or filter didn't run)
  // When AI filter ran and removed all results, don't use unfiltered brsContext
  if (candidates.length === 0 && brsContext && !aiFilterApplied) {
    // Add BRS candidates
    if (brsContext.brs && brsContext.brs.length > 0) {
      for (const brs of brsContext.brs.slice(0, 3)) {
        candidates.push({
          id: brs.id,
          name: brs.title || brs.name,
          type: 'brs',
          category: 'BRS',
          similarity: brs.similarity,
          href: `/brs/${brs.id}`,
        });
      }
    }
    
    // Add Publication candidates
    if (brsContext.publications && brsContext.publications.length > 0) {
      for (const pub of brsContext.publications.slice(0, 3)) {
        candidates.push({
          id: pub.id,
          name: pub.title || pub.name,
          type: 'publication',
          category: 'Publikasi',
          similarity: pub.similarity,
          href: `/publikasi/${pub.id}`,
        });
      }
    }
  }
  
  logger.debug({ candidateCount: candidates.length }, 'buildKnowledgeCandidates result');
  
  // Return null if empty (so frontend can check easily)
  return candidates.length > 0 ? candidates : null;
}

// ============================================================================
// BUILD EXTERNAL LINKS (Web Search)
// ============================================================================

/**
 * Build external links array for UI display
 * These links are from external government sources (not BPS)
 * and are display-only - NOT included in AI context
 * 
 * @param {Array|null} externalLinks - Raw web search results
 * @returns {Array|null}
 */
function buildExternalLinksForUI(externalLinks) {
  if (!Array.isArray(externalLinks) || externalLinks.length === 0) {
    return null;
  }
  
  return externalLinks.slice(0, 3).map(link => ({
    title: link.title || '',
    url: link.url || '',
    domain: link.domain || '',
    snippet: (link.snippet || '').slice(0, 150),
    publishedDate: link.publishedDate || null,
    trustBadge: link.trustBadge || 'Pemerintah',
    matchedGeo: link.matchedGeo || null,
  }));
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  buildUIMetadata,
  buildTableMeta,
  buildSources,
  buildKnowledgeCandidates,
  buildExternalLinksForUI,
};
