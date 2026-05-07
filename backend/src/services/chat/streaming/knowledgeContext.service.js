/**
 * Knowledge Context Service
 *
 * Extracted from streaming.service.js for modularity.
 * 
 * NOTE: Uses canonical knowledgeSearch.service for actual search operations.
 * 
 * ENHANCEMENT (2026-01-25): Added in-document search to extract query-relevant
 * content from large BRS/Publikasi documents before sending to LLM.
 * 
 * ENHANCEMENT (2026-01-25): Added LLM-based synonym expansion for better
 * keyword matching when initial search finds few results (scalable approach).
 * 
 * ENHANCEMENT (2026-01-25): LLM-based table understanding for scalable
 * disambiguation of similar tables in statistical documents.
 */

'use strict';

const logger = require('../../../utils/logger').child({ service: 'KnowledgeContext' });
const { INDICATOR_INJECTION, SMART_CONTEXT, EXTRACTION } = require('./config');
const { analyzeQueryRouting, MONTH_MAP_NUMERIC, MONTH_YEAR_REGEX } = require('../../../utils/queryAnalysis');
const { isProceduralFaqQuery } = require('./queryContext.service');
const { stripMarkdownFormatting } = require('./chatHelpers');
const { SHORT_WORD_WHITELIST } = require('../../../shared/bpsAbbreviations');

// Import canonical knowledge search service
const { searchKnowledge: canonicalSearch } = require('../knowledgeSearch.service');

// QW-2: Cache injection candidate docs (query-independent, 5-min TTL)
const { SimpleCache } = require('../../../utils/simpleCache');
const _injectionCandidateCache = new SimpleCache(5 * 60 * 1000, 1);

// Import KnowledgeBase model for full content fetch
const KnowledgeBase = require('../../../models/KnowledgeBase.model');

// Import synonym expansion service (LLM-based, scalable)
const { 
  expandWithSynonyms, 
  shouldExpandSynonyms,
  expandGeoTerms,
} = require('../../ai/synonymExpansion.service');

// Import LLM-based table understanding (scalable, no hardcoded patterns)
const {
  analyzeTablesForQuery,
  isInIrrelevantSection,
  isInRelevantSection,
} = require('../../ai/tableUnderstanding.service');

// Import centralized search config (scalable, no hard-coded values)
const {
  STOPWORDS,
  getAllGeoAliases,
  SCORING_WEIGHTS,
  STATISTICAL_TOPICS,
} = require('../../../config/search.config');

// Get all geo aliases for matching
const MALUT_REGIONS = getAllGeoAliases();

/**
 * Detect where actual data starts in a BPS publication, replacing the fixed
 * 15% heuristic. Scans for TOC-style dotted reference lines ("...... 123")
 * in the first 25% of the document and returns the position just after.
 * Falls back to EXTRACTION.TOC_SKIP_RATIO if no TOC refs are found.
 *
 * @param {string} content - Full document content
 * @returns {number} - Character position where data section starts
 */
const _tocEndCache = new Map();
const TOC_END_CACHE_TTL = 5 * 60_000;
function detectDataStart(content) {
  if (!content || content.length < 5000) return 0;

  // Cache by content length + first 200 chars hash (cheap proxy for doc identity)
  const cacheKey = `${content.length}:${content.slice(0, 200)}`;
  const cached = _tocEndCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TOC_END_CACHE_TTL) return cached.pos;

  const scanLimit = Math.floor(content.length * 0.25);
  const scanArea = content.slice(0, scanLimit);

  // Pattern: dotted lines followed by page numbers (TOC entries)
  // Matches "............ 123" or "...... 45" at end of line
  const tocRefPattern = /\.{3,}\s+\d{1,4}\s*$/gm;
  let lastTocRefEnd = 0;
  let m;
  while ((m = tocRefPattern.exec(scanArea)) !== null) {
    lastTocRefEnd = m.index + m[0].length;
  }

  let dataStart;
  if (lastTocRefEnd > 0) {
    // Add margin: skip "PENJELASAN UMUM" section (~2-5% of doc after TOC refs)
    // Margin of 3000 chars catches the explanatory notes section
    dataStart = Math.min(lastTocRefEnd + 3000, content.length);
  } else {
    // Fallback to percentage-based heuristic
    dataStart = Math.floor(content.length * EXTRACTION.TOC_SKIP_RATIO);
  }

  _tocEndCache.set(cacheKey, { pos: dataStart, ts: Date.now() });
  // Keep cache small
  if (_tocEndCache.size > 50) {
    const oldest = [..._tocEndCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) _tocEndCache.delete(oldest[0]);
  }

  return dataStart;
}

/**
 * Extract query-relevant content from a large document
 * 
 * When a BRS/Publikasi is found but content is large (>10KB), this function:
 * 1. Fetches full content from database
 * 2. Searches for query keywords within the document
 * 3. If few matches, expands keywords with LLM-generated synonyms (scalable)
 * 4. Extracts and returns only the relevant sections
 * 
 * @param {number} docId - Knowledge base document ID
 * @param {string} query - User query
 * @param {number} maxChars - Maximum characters to return (default 8000)
 * @param {object} options - Additional options
 * @param {boolean} options.useSynonyms - Enable synonym expansion (default: true)
 * @returns {Promise<{content: string, extractedSections: number, totalLines: number}>}
 */
async function extractRelevantContent(docId, query, maxChars = 80000, options = {}) {
  const { useSynonyms = true } = options;
  
  try {
    const doc = await KnowledgeBase.findByPk(docId, {
      attributes: ['id', 'title', 'content', 'content_length'],
    });
    
    if (!doc || !doc.content) {
      return null;
    }
    
    const contentLength = doc.content_length || doc.content.length;
    
    // If content is small enough, return as-is
    if (contentLength <= maxChars) {
      return {
        content: doc.content,
        extractedSections: 0,
        totalLines: doc.content.split('\n').length,
        method: 'full',
      };
    }
    
    // Extract keywords from query (using centralized stopwords config)
    const queryLower = query.toLowerCase();
    const queryWords = queryLower
      .split(/\s+/)
      .filter(w => (w.length >= 3 || SHORT_WORD_WHITELIST.has(w)) && !STOPWORDS.includes(w));
    
    // Add region-specific keywords (high priority) - expanded with local synonyms
    const regionKeywords = MALUT_REGIONS.filter(r => queryLower.includes(r));
    const expandedGeoTerms = expandGeoTerms(regionKeywords);
    
    let searchTerms = [...new Set([...queryWords, ...expandedGeoTerms])];
    
    // Mark which terms are geo-related for priority scoring
    const geoTerms = new Set(expandedGeoTerms);
    
    if (searchTerms.length === 0) {
      // No specific keywords - return first chunk
      return {
        content: doc.content.slice(0, maxChars),
        extractedSections: 0,
        totalLines: doc.content.split('\n').length,
        method: 'truncated',
      };
    }
    
    logger.debug({ docId, searchTerms }, 'Extracting relevant content from large document');
    
    // Split content into lines and find relevant sections
    const lines = doc.content.split('\n');
    const contextWindow = 5; // Lines before/after a match to include
    
    // ============================================================
    // LLM-BASED TABLE UNDERSTANDING (Scalable, Production-Ready)
    // ============================================================
    // Use LLM to intelligently identify which table sections are relevant
    // for the user's query. This replaces hardcoded pattern matching.
    // ============================================================
    
    let tableAnalysis = { relevantSections: [], irrelevantSections: [], reasoning: '' };
    
    // Run LLM table analysis for ALL documents — no size gate at all.
    // Even short docs may contain small tables worth understanding.
    const shouldAnalyzeTables = true;
    
    if (shouldAnalyzeTables) {
      try {
        tableAnalysis = await analyzeTablesForQuery(doc.content, query, { maxTables: 8 });
        logger.info({
          docId,
          query: query.substring(0, 50),
          relevantCount: tableAnalysis.relevantSections?.length || 0,
          irrelevantCount: tableAnalysis.irrelevantSections?.length || 0,
          reasoning: tableAnalysis.reasoning,
        }, 'LLM table analysis completed');
      } catch (err) {
        logger.warn({ err: err.message, docId }, 'LLM table analysis failed, using basic extraction');
      }
    }
    
    /**
     * Helper: Score lines based on search terms
     * @param {string[]} terms - Terms to search for
     * @param {Set<string>} geoSet - Set of geo-related terms
     * @returns {Array} - Scored lines sorted by relevance
     */
    const scoreLines = (terms, geoSet) => {
      return lines.map((line, idx) => {
        const lineLower = line.toLowerCase();
        let score = 0;
        let matchedTerms = [];
        let hasGeoMatch = false;
        let hasNumbers = /\d+[.,]?\d*\s+\d+/.test(line); // Multiple numbers = likely data row
        
        for (const term of terms) {
          if (lineLower.includes(term)) {
            matchedTerms.push(term);
            
            // Geo terms get much higher priority (e.g., "ternate")
            if (geoSet.has(term)) {
              score += 30;
              hasGeoMatch = true;
            } else {
              score += 10;
            }
          }
        }
        
        // Bonus for lines with multiple numbers (more likely actual data rows)
        if (hasNumbers && matchedTerms.length > 0) {
          score += hasGeoMatch ? 20 : 5;
        }
        
        // LLM-BASED TABLE CONTEXT SCORING (Scalable)
        // Use LLM analysis results instead of hardcoded patterns
        if (tableAnalysis.relevantSections?.length > 0) {
          const inRelevant = isInRelevantSection(idx, tableAnalysis.relevantSections);
          const inIrrelevant = isInIrrelevantSection(idx, tableAnalysis.irrelevantSections);
          
          if (inRelevant) {
            // LLM identified this section as relevant - boost significantly
            score += 150;
          } else if (inIrrelevant) {
            // LLM identified this section as irrelevant - exclude
            score = -100;
          } else if (hasGeoMatch && hasNumbers) {
            // This is a data line NOT in analyzed sections
            // Apply penalty to prefer LLM-approved sections
            // But don't completely exclude in case LLM missed something
            score -= 30;
          }
        }
        
        return { idx, line, score, matchedTerms, hasGeoMatch };
      }).filter(l => l.score > 0).sort((a, b) => b.score - a.score);
    };
    
    // Initial scoring with original terms
    let scoredLines = scoreLines(searchTerms, geoTerms);
    let finalSearchTerms = searchTerms;
    let usedSynonyms = false;
    
    // If few matches found and synonyms enabled, expand with LLM
    if (useSynonyms && shouldExpandSynonyms(scoredLines.length, 3)) {
      logger.info({ 
        docId, 
        initialMatches: scoredLines.length, 
        originalTerms: searchTerms,
      }, 'Few matches found, expanding with LLM synonyms');
      
      try {
        const expansion = await expandWithSynonyms(queryWords, 'statistik BPS Maluku Utara');
        
        if (expansion.expanded.length > 0) {
          // Combine original + expanded terms
          finalSearchTerms = [...new Set([...searchTerms, ...expansion.allTerms])];
          
          // Re-score with expanded terms
          scoredLines = scoreLines(finalSearchTerms, geoTerms);
          usedSynonyms = true;
          
          logger.info({
            docId,
            originalTerms: searchTerms.length,
            expandedTerms: finalSearchTerms.length,
            newMatches: scoredLines.length,
            synonyms: expansion.synonymMap,
          }, 'Re-scored with synonym expansion');
        }
      } catch (err) {
        logger.warn({ err, docId }, 'Synonym expansion failed, using original terms');
      }
    }
    
    // Get document title (first non-empty line with reasonable length)
    let title = '';
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      if (lines[i].trim().length > 20 && lines[i].trim().length < 200) {
        title = lines[i].trim();
        break;
      }
    }
    
    // Build content: Start with title, then immediately add geo-matched data sections
    let extractedContent = title + '\n\n';
    extractedContent += `[Data yang relevan dengan: "${searchTerms.join('", "')}"]:\n\n`;
    
    // Track which lines we've already added
    const addedIndices = new Set();
    
    // Add LLM reasoning as guidance if available
    if (tableAnalysis.reasoning) {
      extractedContent += `⚠️ KONTEKS TABEL: ${tableAnalysis.reasoning}\n\n`;
    }
    
    // Add column interpretation guide for migration tables
    // This helps LLM understand which column to read
    const queryLowerCheck = query.toLowerCase();
    if (queryLowerCheck.includes('pendatang') || queryLowerCheck.includes('migrasi masuk')) {
      extractedContent += `📊 PANDUAN KOLOM: Untuk "pendatang", gunakan kolom "Migrasi Masuk/In Migration" (kolom 2-4). Struktur tabel migrasi: [Wilayah] [Masuk L] [Masuk P] [MASUK TOTAL] [Keluar L] [Keluar P] [Keluar Total] [Neto L] [Neto P] [Neto Total]. Contoh: Ternate 25.714 29.409 *55.122* ...\n\n`;
    }
    
    // Add top-scoring line groups with context - prioritize geo-matched lines
    for (const scored of scoredLines) {
      if (extractedContent.length >= maxChars - 200) break;
      
      // Get context window around this line
      const startIdx = Math.max(0, scored.idx - contextWindow);
      const endIdx = Math.min(lines.length - 1, scored.idx + contextWindow);
      
      // Check if we've already covered this range
      if (addedIndices.has(scored.idx)) continue;
      
      // SKIP lines from LLM-identified irrelevant sections (scalable approach)
      if (tableAnalysis.irrelevantSections?.length > 0 &&
          isInIrrelevantSection(scored.idx, tableAnalysis.irrelevantSections)) {
        continue; // LLM said this section is not relevant - skip it
      }
      
      // When LLM analysis exists, STRONGLY PREFER relevant sections
      // Only include non-relevant sections if we haven't filled the content yet
      const hasRelevantSections = tableAnalysis.relevantSections?.length > 0;
      const inRelevantSection = hasRelevantSections && isInRelevantSection(scored.idx, tableAnalysis.relevantSections);
      
      // If we have relevant sections, prioritize them for the first ~60% of content
      if (hasRelevantSections && !inRelevantSection && extractedContent.length < maxChars * 0.6) {
        // Check if there are still unprocessed relevant lines with higher priority
        const hasUnprocessedRelevantLines = scoredLines.some(s => 
          !addedIndices.has(s.idx) && 
          s.score > scored.score - 50 &&
          isInRelevantSection(s.idx, tableAnalysis.relevantSections)
        );
        if (hasUnprocessedRelevantLines) {
          continue; // Skip this non-relevant line, more relevant lines available
        }
      }
      
      // Add separator if not the first section
      if (addedIndices.size > 0) {
        extractedContent += '\n[...]\n';
      }
      
      // Find and add table header (generic detection, not hardcoded patterns)
      const hasDataPattern = /\d[\d\s.,]+\d/.test(scored.line);
      if (hasDataPattern) {
        // Look backwards to find the table header
        for (let h = scored.idx - 1; h >= Math.max(0, scored.idx - 30); h--) {
          const headerLine = lines[h].toLowerCase();
          // Generic header detection: "tabel", column headers, or title-like lines
          if (headerLine.includes('tabel') || headerLine.includes('table') ||
              (headerLine.includes('kabupaten') || headerLine.includes('wilayah')) ||
              /^[a-z].*:$/.test(headerLine.trim())) {
            if (!addedIndices.has(h)) {
              extractedContent += `[HEADER: ${lines[h].trim()}]\n`;
              addedIndices.add(h);
              break;
            }
          }
        }
      }
      
      // Add the context window
      for (let i = startIdx; i <= endIdx; i++) {
        if (!addedIndices.has(i)) {
          extractedContent += lines[i] + '\n';
          addedIndices.add(i);
        }
      }
      
      if (extractedContent.length >= maxChars) {
        extractedContent = extractedContent.slice(0, maxChars) + '\n[... konten dipotong ...]';
        break;
      }
    }
    
    logger.info({
      docId,
      originalLength: contentLength,
      extractedLength: extractedContent.length,
      matchedSections: addedIndices.size,
      searchTerms: finalSearchTerms,
      usedSynonyms,
    }, 'Extracted query-relevant content from document');
    
    return {
      content: extractedContent.trim(),
      extractedSections: addedIndices.size,
      totalLines: lines.length,
      method: usedSynonyms ? 'extracted-with-synonyms' : 'extracted',
      searchTerms: finalSearchTerms,
      usedSynonyms,
    };
    
  } catch (err) {
    logger.error({ err, docId }, 'Error extracting relevant content');
    return null;
  }
}

/**
 * Search knowledge base for relevant documents
 * Uses canonical knowledgeSearch.service for caching and consistency
 * Uses centralized config for topics and thresholds (scalable)
 * 
 * @param {string} query - User query
 * @param {number} topN - Number of results
 * @param {object} deps - Dependency injection (optional, for testing)
 * @returns {Promise<Array>} - Knowledge documents with similarity > threshold
 */
async function searchKnowledgeBase(query, topN = 5, deps = {}) {
  const q = String(query || '').toLowerCase();
  
  // Check against centralized STATISTICAL_TOPICS config (scalable)
  const isStatisticalTopic = STATISTICAL_TOPICS.some(t => 
    q.includes(t.topic) || t.aliases.some(a => q.includes(a))
  );
  
  // Use config-based thresholds
  const effectiveTopN = isStatisticalTopic 
    ? Math.max(topN, SCORING_WEIGHTS.STATISTICAL_TOP_N || 8) 
    : topN;
  const minSimilarity = isStatisticalTopic 
    ? SCORING_WEIGHTS.STATISTICAL_MIN_SIMILARITY 
    : SCORING_WEIGHTS.KNOWLEDGE_MIN_SIMILARITY;

  // Use canonical service which handles caching
  return canonicalSearch({
    query,
    topN: effectiveTopN, 
    minSimilarity,
    deps,
    skipLLMSynonyms: deps.skipLLMSynonyms || false, // Flash mode: skip LLM synonyms
  });
}

/**
 * Check if query is a knowledge/non-data question (scalable approach)
 */
function isKnowledgeTypeQuery(query, knowledgeSimilarity = 0) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return false;

  // FIRST: Check if this is a procedural/FAQ query (should skip data regardless of similarity)
  if (isProceduralFaqQuery(q)) {
    return true; // Skip data preview for FAQ queries
  }

  // Minimum threshold for considering this a knowledge query
  if (knowledgeSimilarity < 0.40) return false;

  // Use shared query routing analysis
  // knowledgeSimilarity here is from custom docs (PPID/FAQ), not statistical docs (BRS)
  const routing = analyzeQueryRouting(query, knowledgeSimilarity);

  // non-statistical = knowledge query (show knowledge base, skip data table)
  // statistical = data query (show data table)
  return routing.type === 'non-statistical';
}

// ============================================================================
// MULTI-SOURCE OVERLAP DETECTION
// ============================================================================

/**
 * BPS statistical indicator synonym groups.
 * Used to detect topic overlap between a datasource table and BRS/Publikasi
 * even when they use DIFFERENT words for the same indicator.
 * e.g., "Produk Domestik Regional Bruto" (table) ↔ "Ekonomi Triwulan Tumbuh" (BRS)
 */
const INDICATOR_GROUPS = {
  poverty:       ['kemiskinan', 'miskin', 'penduduk miskin', 'garis kemiskinan'],
  gdp:           ['pdrb', 'produk domestik', 'regional bruto', 'ekonomi', 'pertumbuhan ekonomi'],
  inflation:     ['inflasi', 'ihk', 'indeks harga konsumen', 'harga konsumen', 'deflasi'],
  unemployment:  ['pengangguran', 'tpt', 'tingkat pengangguran', 'tpak', 'angkatan kerja', 'ketenagakerjaan', 'naker', 'tenaga kerja'],
  hdi:           ['ipm', 'pembangunan manusia', 'human development'],
  gini:          ['gini', 'ketimpangan', 'rasio gini'],
  population:    ['kependudukan', 'demografi', 'sensus', 'proyeksi penduduk'],
  trade:         ['ekspor', 'impor', 'perdagangan', 'neraca perdagangan'],
  wages:         ['upah', 'upah minimum', 'umr', 'ump'],
  agriculture:   ['pertanian', 'tanaman pangan', 'ntp', 'nilai tukar petani', 'padi'],
  tourism:       ['pariwisata', 'wisatawan', 'hotel', 'restoran', 'akomodasi', 'tamu'],
  construction:  ['konstruksi', 'bangunan'],
  industry:      ['industri', 'manufaktur'],
  fishery:       ['perikanan', 'nelayan', 'ikan'],
  migration:     ['migrasi', 'pendatang', 'perpindahan', 'mobilitas'],
  welfare:       ['kesejahteraan', 'susenas'],
};

/**
 * Get the set of indicator group IDs that match a given text.
 * Used for cross-title overlap detection via synonym awareness.
 * @param {string} text - Title or text to analyze
 * @returns {Set<string>} Set of indicator group keys (e.g., 'gdp', 'poverty')
 */
function _getIndicatorGroups(text) {
  if (!text) return new Set();
  const t = text.toLowerCase();
  const groups = new Set();
  for (const [groupId, terms] of Object.entries(INDICATOR_GROUPS)) {
    for (const term of terms) {
      if (t.includes(term)) {
        groups.add(groupId);
        break;
      }
    }
  }
  return groups;
}

/**
 * Extract significant topic words from a title for overlap detection.
 * Strips stopwords, geo terms, temporal terms, and common BPS metadata words.
 * @param {string} text - Document or table title
 * @returns {string[]} Array of significant lowercase words
 */
function _extractTopicWords(text) {
  if (!text) return [];
  /* eslint-disable comma-spacing */
  const STOP = new Set([
    'di','dan','yang','dari','untuk','pada','dengan','ini','itu','ke','se',
    'adalah','oleh','akan','telah','sudah','per','dalam','menurut','serta',
    // Temporal & geographic (not useful for topic matching)
    'tahun','provinsi','maluku','utara','kabupaten','kota','kepulauan',
    'halmahera','ternate','tidore','sula','morotai','taliabu',
    'barat','timur','tengah','selatan','pulau','kab','kep',
    // Common BPS metadata words
    'data','statistik','bps','angka','tabel','berita','resmi','persen',
    'jumlah','menurut','number','group','over','age','population',
    'the','of','and','in','to','for','by','with',
  ]);
  /* eslint-enable comma-spacing */
  return text.toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP.has(w));
}

/**
 * Check if two titles share enough topic to indicate data overlap.
 * Uses TWO strategies:
 * 1. INDICATOR_GROUPS synonym matching (e.g., PDRB ↔ Ekonomi → both 'gdp')
 * 2. Word-level overlap fallback (≥ minShared shared significant words)
 *
 * @param {string} title1 - First title (e.g., datasource table title)
 * @param {string} title2 - Second title (e.g., BRS or Publikasi title)
 * @param {number} [minShared=2] - Minimum shared words for word-level fallback
 * @returns {boolean}
 */
function _hasTopicOverlap(title1, title2, minShared = 2) {
  // Strategy 1: Indicator synonym groups (catches PDRB ↔ Ekonomi, etc.)
  const groups1 = _getIndicatorGroups(title1);
  const groups2 = _getIndicatorGroups(title2);
  for (const g of groups1) {
    if (groups2.has(g)) return true;
  }

  // Strategy 2: Word-level overlap fallback (for indicators not in INDICATOR_GROUPS)
  const words1 = new Set(_extractTopicWords(title1));
  const words2 = _extractTopicWords(title2);
  let shared = 0;
  for (const w of words2) {
    if (words1.has(w)) {
      shared++;
      if (shared >= minShared) return true;
    }
  }
  return false;
}

/**
 * Build dynamic instruction for high-confidence BRS/Publication documents.
 * Detects content type from knowledgeText and provides relevant reading guidance
 * WITHOUT hardcoded numerical values (which become stale and mislead the LLM).
 *
 * Replaces the former ~3000-token hardcoded instruction block that contained
 * specific inflation percentages, migration example numbers, etc.
 * This dynamic version is ~500–600 tokens and adapts to actual content.
 */
function buildDynamicBRSInstruction(knowledgeText) {
  const parts = [];

  // Detect document content types
  const hasInflation = /inflasi|ihk|indeks.harga.konsumen|kelompok.pengeluaran/i.test(knowledgeText);
  const hasMigration = /migrasi|pendatang|perpindahan|risen.migrasi/i.test(knowledgeText);
  const hasPopulation = /penduduk|populasi|sensus|jumlah.jiwa/i.test(knowledgeText);
  const hasPoverty = /kemiskinan|miskin|garis.kemiskinan|p[012]/i.test(knowledgeText);
  const hasEmployment = /pengangguran|tpt|ketenagakerjaan|tpak|angkatan.kerja/i.test(knowledgeText);
  const hasTable = /\|.*\|.*\|/m.test(knowledgeText) || /\t/.test(knowledgeText);

  // ── Universal header ──
  parts.push(`DOKUMEN BRS/PUBLIKASI RESMI BPS:\n\n${knowledgeText}`);

  // ── Universal rules (compact) ──
  parts.push(
`⛔ ATURAN UTAMA:
• Dokumen di atas SUDAH berisi data LENGKAP — LANGSUNG jawab, JANGAN bertanya balik
• WAJIB sebutkan ANGKA SPESIFIK dari dokumen (bukan hanya deskripsi)
• JANGAN cantumkan "Sumber: ..." di akhir jawaban — referensi sudah ditampilkan terpisah oleh sistem
• Breakdown by gender (L/P) jika tersedia
• Jika data tidak tersedia, cukup katakan data belum tersedia — JANGAN cantumkan nomor telepon/WhatsApp
• DILARANG menggunakan markdown formatting (**, *, #)`
  );

  // ── Topic-specific reading guidance ──
  if (hasInflation) {
    parts.push(
`📊 PANDUAN BACA DATA INFLASI:
• Default ke inflasi y-on-y (year-on-year) kecuali user minta m-to-m
• Jika ada tabel kelompok pengeluaran, sebutkan SEMUA kelompok dengan nilai y-on-y
• JANGAN baca kolom "Andil" — baca kolom "Tingkat Inflasi y-on-y"
• Data kelompok pengeluaran HANYA tersedia tingkat PROVINSI, bukan per kab/kota
• Jika user tanya per kab/kota, jelaskan keterbatasan dan berikan data provinsi`
    );
  }

  if (hasMigration) {
    parts.push(
`📊 PANDUAN BACA DATA MIGRASI:
• "Pendatang" = "Migrasi Masuk", default ke "migrasi masuk seumur hidup"
• Baca BARIS yang MULAI dengan nama wilayah yang ditanya, BUKAN baris "Jumlah/Total"
• Kolom biasanya: [Wilayah] [Masuk L] [Masuk P] [Masuk Total] [Keluar L] [Keluar P] [Keluar Total] [Neto L] [Neto P] [Neto Total]
• "Migrasi Neto" = Masuk − Keluar (positif = lebih banyak pendatang masuk)
• Breakdown by gender (L/P) jika tersedia`
    );
  }

  if (hasPopulation) {
    parts.push(
`📊 PANDUAN BACA DATA PENDUDUK:
• Default ke jumlah total penduduk, breakdown L/P jika tersedia
• Baca BARIS wilayah spesifik, BUKAN baris "Total" atau "Jumlah"`
    );
  }

  if (hasPoverty) {
    parts.push(
`📊 PANDUAN BACA DATA KEMISKINAN:
• Default ke persentase penduduk miskin terbaru
• Bedakan: jumlah (ribu jiwa) vs persentase (%)
• Perhatikan garis kemiskinan (Rp/kapita/bulan) jika ditanya`
    );
  }

  if (hasEmployment) {
    parts.push(
`📊 PANDUAN BACA DATA KETENAGAKERJAAN:
• TPT = Tingkat Pengangguran Terbuka (%)
• TPAK = Tingkat Partisipasi Angkatan Kerja (%)
• Bedakan angkatan kerja, bekerja, dan pengangguran`
    );
  }

  // ── Table reading guard (critical for all tabular docs) ──
  if (hasTable) {
    parts.push(
`⚠️ PANDUAN BACA TABEL:
• Cari BARIS yang MULAI dengan nama wilayah yang ditanya user
• JANGAN baca baris "Jumlah", "Total", atau "Indonesia" sebagai data wilayah spesifik
• Perhatikan URUTAN KOLOM — baca header tabel untuk tahu kolom mana berisi apa
• Jika tabel punya banyak kolom numerik, sebutkan LABEL kolom saat mengutip angka`
    );
  }

  // ── Geo handling (always relevant for Maluku Utara) ──
  parts.push(
`🌐 PENANGANAN GEO:
• Jika user tidak sebut wilayah spesifik → default Provinsi Maluku Utara
• Jika user sebut kab/kota tertentu → cari data kab/kota tersebut di tabel
• Jika data kab/kota tidak tersedia → jelaskan dan tawarkan data provinsi`
  );

  return parts.join('\n\n');
}

/**
 * Build context messages for OpenAI based on intent and data
 */
function buildContextMessages({
  intentResult,
  candidates,
  dataPreview,
  dataPreviewSecondary,
  historyMessages,
  periodFallback,
  knowledgeContext,
  isServiceQueryWithoutKnowledge,
  availableYearsInfo,
  brsContext,
  isRangeQuery,
  threadSummary, // Compacted conversation summary (OpenClaw-inspired)
  periodPriorityContext, // Period cross-check result (when BRS/Pub has newer data than table)
  pastThreadContext, // Cross-thread memory (OpenClaw-inspired)
  reconciliationContext, // Data Reconciler map (per-row source selection from reconciler.service)
}) {
  const contextMessages = [];

  // CROSS-THREAD MEMORY: Add context from past similar conversations
  // This helps with queries like "apa yang pernah saya tanyakan tentang PDRB?"
  if (pastThreadContext && pastThreadContext.summary) {
    contextMessages.push({
      role: 'system',
      content: `KONTEKS DARI PERCAKAPAN SEBELUMNYA (thread berbeda):
Topik: ${pastThreadContext.title || 'Tidak ada judul'}
${pastThreadContext.summary}

(User mungkin ingin melanjutkan atau merujuk percakapan sebelumnya tentang topik yang sama. Perhatikan konteks ini tapi tetap prioritaskan pertanyaan saat ini.)`,
    });
  }

  // COMPACTION: Add thread summary as context (if available)
  // This provides long-term memory from compacted older messages
  if (threadSummary && threadSummary.length > 20) {
    contextMessages.push({
      role: 'system',
      content: `RINGKASAN PERCAKAPAN SEBELUMNYA:
${threadSummary}

(Ringkasan di atas adalah konteks dari percakapan sebelumnya yang sudah dirangkum. Gunakan informasi ini untuk memahami konteks user, tetapi prioritaskan pesan terbaru.)`,
    });
  }

  // Log knowledge context info (debug level - skipped in production)
  if (knowledgeContext && knowledgeContext.length > 0) {
    logger.debug({
      count: knowledgeContext.length,
      topSimilarity: (knowledgeContext[0]?.similarity || 0).toFixed(2),
      categories: knowledgeContext.map(d => d.category).join(','),
    }, 'Knowledge context');
  }

  // If this is a service/procedural query but NO knowledge context is available,
  // add explicit instruction to NOT make up answers
  if (isServiceQueryWithoutKnowledge) {
    contextMessages.push({
      role: 'system',
      content: `PERHATIAN - INFORMASI TIDAK TERSEDIA:
Pertanyaan user adalah tentang prosedur/layanan/tata cara, tetapi informasi spesifik TIDAK ditemukan di knowledge base.

WAJIB:
- Katakan dengan jujur bahwa informasi spesifik tentang layanan tersebut belum tersedia di sistem
- JANGAN mengarang atau mengira-ngira tahapan/prosedur
- Informasikan bahwa user bisa menghubungi langsung BPS Maluku Utara untuk informasi lebih lengkap
- JANGAN cantumkan nomor telepon/WhatsApp dalam teks — informasi kontak sudah ditampilkan terpisah oleh sistem
- Boleh menyebutkan bahwa BPS menyediakan berbagai layanan tapi JANGAN merinci tahapan yang tidak ada di knowledge base

Contoh respons yang BENAR:
"Mohon maaf, informasi detail tentang layanan rekomendasi statistik belum tersedia di sistem saya. Silakan hubungi BPS Maluku Utara untuk tahapan dan persyaratan lengkap."`,
    });
  }

  // Add knowledge base context if available (RAG)
  if (knowledgeContext && knowledgeContext.length > 0) {
    const topSimilarity = knowledgeContext[0]?.similarity || 0;

    // Check if we have actual BRS/Publication documents (statistical content)
    const hasStatisticalDocs = knowledgeContext.some(doc =>
      doc.category === 'BRS' || doc.category === 'Publikasi'
    );
    
    // Check if we have PPID/custom documents (non-statistical content)
    const hasPPIDDocs = knowledgeContext.some(doc =>
      doc.category === 'PPID' || doc.category === 'FAQ' || doc.category === 'Guide'
    );

    // Re-order docs: docs with indicator-extracted content from NEWER years should come FIRST.
    // This prevents the LLM from fixating on older-year data that appears first in context.
    // Compute data year for each doc to enable sorting and in-content annotation.
    const docsWithYear = knowledgeContext.map(doc => {
      let dataYear = null;
      if (doc.contentExtracted) {
        const head = (doc.content || '').substring(0, 800);
        const yearInTable = head.match(/,\s*(20\d{2})\b/);
        if (yearInTable) {
          dataYear = parseInt(yearInTable[1]);
        } else {
          const titleYear = (doc.title || '').match(/(\d{4})/);
          if (titleYear) {
            const isDalamAngka = /dalam angka/i.test(doc.title);
            dataYear = isDalamAngka ? parseInt(titleYear[1]) - 1 : parseInt(titleYear[1]);
          }
        }
      }
      return { doc, dataYear };
    });
    // Stable sort: extracted docs with newer years first, then by original order
    docsWithYear.sort((a, b) => {
      // Extracted docs with year come before those without
      if (a.dataYear && !b.dataYear) return -1;
      if (!a.dataYear && b.dataYear) return 1;
      // Among docs with years, newer year comes first
      if (a.dataYear && b.dataYear) return b.dataYear - a.dataYear;
      return 0;
    });

    // Detect query year from the latest user message in history (for year annotation)
    let queryYear = null;
    if (historyMessages && historyMessages.length > 0) {
      const lastUserMsg = [...historyMessages].reverse().find(m => m.role === 'user');
      if (lastUserMsg) {
        const yearMatch = (lastUserMsg.content || '').match(/\b(20\d{2})\b/);
        if (yearMatch) queryYear = parseInt(yearMatch[1]);
      }
    }

    // ── Detect multi-source overlap for smart compression ──────────────
    // When datasource table AND knowledge docs cover the same indicator,
    // compress lower-priority overlapping sources to reduce redundancy.
    // Priority: Table (🥇) > BRS (🥈) > Publikasi (🥉)
    const hasTableData = dataPreview?.title && dataPreview?.rows?.length > 0;
    const overlappingDocIds = new Set();

    if (hasTableData) {
      for (const { doc } of docsWithYear) {
        // Check title overlap (use extracted table title for yearbooks)
        const matchTitle = doc._extractedTableTitle || doc.title;
        // Indicator-extracted docs have precise table titles — require stricter overlap
        // (3+ shared words) to avoid false positives like "sekolah" + "pendidikan"
        // matching between "TK schools" and "villages with school facilities"
        const minWords = doc.contentExtracted ? 3 : 2;
        if (_hasTopicOverlap(dataPreview.title, matchTitle, minWords)) {
          overlappingDocIds.add(doc.id);
        }
      }
      if (overlappingDocIds.size > 0) {
        logger.info({
          tableTitle: dataPreview.title?.slice(0, 80),
          overlappingIds: [...overlappingDocIds],
          totalDocs: docsWithYear.length,
        }, 'Multi-source overlap: knowledge docs share topic with datasource table');
      }
    }

    // When no table, detect BRS-Pub overlap (BRS is primary, compress overlapping Pub)
    const pubOverlapWithBrs = new Set();
    if (!hasTableData && docsWithYear.length > 1) {
      const brsDocs = docsWithYear.filter(d => d.doc.category === 'BRS');
      const pubDocs = docsWithYear.filter(d => d.doc.category === 'Publikasi');
      if (brsDocs.length > 0 && pubDocs.length > 0) {
        const primaryBrsTitle = brsDocs[0].doc._extractedTableTitle || brsDocs[0].doc.title;
        for (const { doc } of pubDocs) {
          const pubTitle = doc._extractedTableTitle || doc.title;
          if (_hasTopicOverlap(primaryBrsTitle, pubTitle)) {
            pubOverlapWithBrs.add(doc.id);
          }
        }
      }
    }

    const knowledgeText = docsWithYear.map(({ doc, dataYear }, i) => {
      // Strip markdown formatting from knowledge content
      let cleanContent = stripMarkdownFormatting(doc.content);
      const docType = doc.category === 'BRS' ? '📰 BRS' :
        doc.category === 'Publikasi' ? '📕 Publikasi' : '📋 Dokumen';
      // Note if content was truncated (vector search caches at 10K chars)
      const contentLen = (doc.content || '').length;
      const truncNote = contentLen >= 9500 ? ' ⚠️ konten terpotong, dokumen asli lebih panjang' : '';
      // Mark indicator-extracted docs prominently so LLM knows this is authoritative table data
      let extractedTag = '';
      if (doc.contentExtracted) {
        const dataYearNote = dataYear ? ` | DATA TAHUN REFERENSI: ${dataYear}` : '';
        extractedTag = ` ⭐ TABEL RESMI DIEKSTRAK${dataYearNote}`;
        // Add prominent in-content year marker when data year matches user's query year
        // This makes it impossible for the LLM to miss the correct year's data
        if (dataYear && queryYear && dataYear === queryYear) {
          cleanContent = `⚡⚡⚡ TABEL INI BERISI DATA TAHUN ${dataYear} — PERSIS SESUAI PERMINTAAN USER. GUNAKAN DATA INI. ⚡⚡⚡\n\n${cleanContent}`;
        } else if (dataYear) {
          cleanContent = `[Data tahun referensi: ${dataYear}]\n\n${cleanContent}`;
        }
      }

      // ── Source priority label ────────────────────────────────────────
      let priorityLabel = '';
      if (hasTableData) {
        // Table is primary (🥇) → knowledge docs are lower priority
        priorityLabel = doc.category === 'BRS' ? ' 🥈' : doc.category === 'Publikasi' ? ' 🥉' : '';
      } else {
        // No table → BRS is primary, Pub is secondary
        priorityLabel = doc.category === 'BRS' ? ' 🥇' : doc.category === 'Publikasi' ? ' 🥈' : '';
      }

      // ── Smart compression for overlapping docs ──────────────────────
      // When a higher-priority source covers the same topic, compress the
      // lower-priority doc to its headline + key figures. This avoids
      // redundantly repeating the same data while preserving source
      // attribution. The LLM still knows the doc exists and can cite it.
      const isTableOverlap = overlappingDocIds.has(doc.id);
      const isBrsOverlap = pubOverlapWithBrs.has(doc.id);

      if ((isTableOverlap && hasTableData) || isBrsOverlap) {
        // Compression limits: BRS preserves more (narrative + trends), Pub less
        const maxChars = doc.category === 'BRS' ? 1200 : 800;
        if (cleanContent.length > maxChars) {
          const origLen = cleanContent.length;
          const higherSource = isTableOverlap ? 'tabel database' : 'BRS';
          cleanContent = cleanContent.slice(0, maxChars) +
            `\n\n[...diringkas — data serupa tersedia di ${higherSource} (sumber prioritas lebih tinggi). Asal: ${origLen} karakter]`;
          logger.debug({ docId: doc.id, category: doc.category, origLen, truncTo: maxChars },
            'Multi-source compression applied to overlapping doc');
        }
      }

      return `<document type="${doc.category || 'unknown'}" index="${i + 1}" title="${(doc.title || '').replace(/"/g, "'")}" relevance="${Math.round((doc.similarity || 0) * 100)}%"${extractedTag ? ' extracted="true"' : ''}${truncNote ? ' truncated="true"' : ''}>\n${cleanContent}\n</document>`;
    }).join('\n\n');

    // Wrap all documents in a knowledge_context container for clearer LLM parsing
    const wrappedKnowledgeText = `<knowledge_context>\n${knowledgeText}\n</knowledge_context>`;

    // Different instruction based on document type and similarity.
    // Gradient zones (M5 fix): 0.55+ high, 0.45-0.55 transitional, 0.40-0.45 medium, <0.40 low
    let instruction;
    if (hasStatisticalDocs && topSimilarity >= 0.55) {
      // High confidence BRS/Publication match — dynamic instruction
      instruction = buildDynamicBRSInstruction(wrappedKnowledgeText);
    } else if (hasStatisticalDocs && topSimilarity >= 0.45) {
      // Transitional zone (0.45-0.55) — use but add light caveat
      instruction = buildDynamicBRSInstruction(wrappedKnowledgeText) +
        '\n\nCATATAN: Sumber relevansinya MODERAT — sajikan data dari dokumen namun sebutkan bahwa informasi mungkin tidak 100% sesuai konteks pertanyaan jika ada keraguan.';
    } else if (hasPPIDDocs && topSimilarity >= 0.70) {
      // NEW: High confidence PPID/FAQ match - use content directly
      instruction = `INFORMASI RESMI DARI KNOWLEDGE BASE BPS:

${wrappedKnowledgeText}

INSTRUKSI WAJIB:
1. Dokumen di atas adalah sumber UTAMA untuk menjawab pertanyaan user
2. LANGSUNG sajikan informasi dari dokumen, JANGAN bertanya balik ke user
3. Kutip informasi PERSIS dari dokumen
4. Sebutkan bahwa informasi berasal dari database BPS
5. DILARANG mengarang informasi yang tidak ada di dokumen
6. DILARANG menggunakan markdown formatting (**, *, #, dll) dalam respons

CONTOH RESPONS YANG BENAR:
"Kepala BPS Provinsi Maluku Utara saat ini adalah Drs. Simon Sapary, M.Sc. Informasi ini berasal dari database resmi BPS Maluku Utara."`;
    } else if (hasStatisticalDocs && topSimilarity >= 0.40) {
      // Medium confidence - use but mention limitation
      instruction = `DOKUMEN TERKAIT DARI BPS:

${wrappedKnowledgeText}

INSTRUKSI:
1. Dokumen di atas MUNGKIN relevan dengan pertanyaan user
2. Jika dokumen menjawab pertanyaan, GUNAKAN informasi dari dokumen
3. Jika dokumen tidak cukup spesifik, katakan apa yang tersedia dan tawarkan informasi lebih lanjut
4. JANGAN mengarang data yang tidak ada di dokumen
5. DILARANG menggunakan markdown formatting`;
    } else if (hasPPIDDocs && topSimilarity >= 0.50) {
      // Medium confidence PPID/FAQ match
      instruction = `INFORMASI TERKAIT DARI BPS:

${wrappedKnowledgeText}

INSTRUKSI:
1. Dokumen di atas MUNGKIN relevan dengan pertanyaan user
2. Jika dokumen menjawab pertanyaan, GUNAKAN informasi dari dokumen
3. Jika dokumen tidak cukup spesifik, katakan apa yang tersedia dan tawarkan bantuan lebih lanjut
4. JANGAN mengarang informasi yang tidak ada di dokumen
5. DILARANG menggunakan markdown formatting`;
    } else {
      // Low confidence - be careful
      instruction = `INFORMASI INTERNAL BPS:

${wrappedKnowledgeText}

PERHATIAN:
- Dokumen di atas MUNGKIN terkait, tapi BELUM TENTU menjawab pertanyaan spesifik user
- Jika dokumen tidak menjawab pertanyaan SPESIFIK, katakan: "Mohon maaf, informasi tentang [topik] belum tersedia. Silakan hubungi BPS Maluku Utara untuk informasi lebih lanjut."
- JANGAN cantumkan nomor telepon/WhatsApp dalam teks — informasi kontak sudah ditampilkan terpisah oleh sistem
- JANGAN mengarang informasi yang tidak ada di dokumen
- DILARANG menggunakan markdown formatting`;
    }

    contextMessages.push({
      role: 'system',
      content: instruction,
    });
  }

  // Add data context if available
  if (dataPreview && dataPreview.rows && dataPreview.rows.length > 0) {
    // ── Format data as MARKDOWN TABLE for better LLM interpretation ──
    // gpt-4.1 reads markdown tables far more accurately than flat key-value pairs
    const MAX_DATA_ROWS = 100; // Maximized from 50 → 100 for full coverage
    const displayRows = dataPreview.rows.slice(0, MAX_DATA_ROWS);
    const cols = dataPreview.columns;

    // Build markdown table header
    const headerRow = '| ' + cols.join(' | ') + ' |';
    const separatorRow = '| ' + cols.map(() => '---').join(' | ') + ' |';

    // Build markdown table body
    const bodyRows = displayRows.map(row => {
      const values = cols.map(col => {
        const val = row[col];
        if (val == null || val === '') return '-';
        return String(val).replace(/\|/g, '\\|'); // escape pipes in values
      });
      return '| ' + values.join(' | ') + ' |';
    }).join('\n');

    const markdownTable = `${headerRow}\n${separatorRow}\n${bodyRows}`;

    // Detect numeric columns for interpretation hints
    const numericCols = cols.filter(col => {
      const sample = displayRows.slice(0, 5).map(r => r[col]).filter(v => v != null);
      return sample.some(v => /^-?\d+[.,]?\d*$/.test(String(v).replace(/\s/g, '')));
    });
    const pctCols = cols.filter(col => /persentase|persen|%|rate|rasio|ratio|indeks|index/i.test(col));

    let contextContent = `DATA STATISTIK DARI DATABASE BPS (sumber: ${dataPreview.from || 'database'}):

Judul: ${dataPreview.title}
Total baris tersedia: ${dataPreview.total_rows}
${dataPreview.total_columns && dataPreview.total_columns > cols.length ? `Kolom ditampilkan: ${cols.length} dari ${dataPreview.total_columns} kolom (${dataPreview.total_columns - cols.length} kolom lainnya tidak ditampilkan)` : ''}
${dataPreview.unit ? `Satuan: ${dataPreview.unit}` : ''}
${dataPreview.geo ? `Filter wilayah: ${dataPreview.geo}` : ''}
${numericCols.length > 0 ? `Kolom numerik: ${numericCols.join(', ')}` : ''}
${pctCols.length > 0 ? `Kolom persentase: ${pctCols.join(', ')}` : ''}`;

    // Add period fallback notice
    if (periodFallback) {
      contextContent += `

⚠️ CATATAN PERIODE: User meminta tahun ${periodFallback.requestedYear}, tetapi data tersebut BELUM TERSEDIA.
Data yang ditampilkan adalah tahun ${periodFallback.actualYear} (data ${periodFallback.direction} yang tersedia).
WAJIB sampaikan ini ke user dengan kalimat seperti: "Data tahun ${periodFallback.requestedYear} belum tersedia. Berikut data tahun ${periodFallback.actualYear} sebagai referensi:"`;
    }

    contextContent += `

DATA (${displayRows.length} dari ${dataPreview.total_rows} baris):

${markdownTable}`;

    contextContent += `

INSTRUKSI MEMBACA TABEL:
- Baca angka dari kolom yang tepat — perhatikan header kolom
- Baris "Jumlah/Total" adalah TOTAL, bukan data wilayah spesifik
- Jika user tanya wilayah spesifik, cari BARIS dengan nama wilayah tsb
- Sebutkan angka SPESIFIK dari tabel, jangan bilang "relatif tinggi/rendah" tanpa angka`;

    // Add available years info for follow-up questions like "tahun terbaru?"
    if (availableYearsInfo && availableYearsInfo.years && availableYearsInfo.years.length > 0) {
      const yearsStr = availableYearsInfo.years.slice(0, 5).join(', ');
      const latestYear = availableYearsInfo.years[0];

      // USE latestPeriodLabel from FULL data (computed before slice) if available
      // This is crucial for triwulan data where only 20 rows are shown but data goes up to Triwulan IV
      let latestPeriodLabel = dataPreview.latestPeriodLabel || `tahun ${latestYear}`;

      // Fallback: Extract the most specific latest period from displayed rows (less accurate)
      if (!dataPreview.latestPeriodLabel && dataPreview.rows && dataPreview.rows.length > 0) {
        const bulanValues = dataPreview.rows.map(r => r.Bulan || r.bulan || r.periode || r.Periode).filter(Boolean);
        if (bulanValues.length > 0) {
          // Check for triwulan patterns (Triwulan I, Triwulan II, etc.)
          const triwulanOrder = { 'Triwulan I': 1, 'Triwulan II': 2, 'Triwulan III': 3, 'Triwulan IV': 4 };
          const triwulans = bulanValues.filter(b => String(b).match(/Triwulan\s+(I{1,3}V?|IV)/i));
          if (triwulans.length > 0) {
            // Find the latest triwulan
            const sorted = triwulans.sort((a, b) => (triwulanOrder[String(b)] || 0) - (triwulanOrder[String(a)] || 0));
            const latestTriwulan = sorted[0];
            latestPeriodLabel = `${latestTriwulan} ${latestYear}`;
          } else {
            // Check for month patterns
            const monthOrder = { 'Januari': 1, 'Februari': 2, 'Maret': 3, 'April': 4, 'Mei': 5, 'Juni': 6, 'Juli': 7, 'Agustus': 8, 'September': 9, 'Oktober': 10, 'November': 11, 'Desember': 12 };
            const monthPattern = /\[?\d*\]?\s*(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)/i;
            const monthMatches = bulanValues.map(b => {
              const m = String(b).match(monthPattern);
              return m ? m[1] : null;
            }).filter(Boolean);
            if (monthMatches.length > 0) {
              const sorted = monthMatches.sort((a, b) => (monthOrder[b] || 0) - (monthOrder[a] || 0));
              const latestMonth = sorted[0];
              latestPeriodLabel = `${latestMonth} ${latestYear}`;
            }
            // Check for semester patterns
            const semesterPattern = /Semester\s+(I{1,2}|1|2)/i;
            const semesterMatches = bulanValues.filter(b => String(b).match(semesterPattern));
            if (semesterMatches.length > 0) {
              const sorted = semesterMatches.sort((a, b) => {
                const aNum = String(a).match(/II|2/) ? 2 : 1;
                const bNum = String(b).match(/II|2/) ? 2 : 1;
                return bNum - aNum;
              });
              latestPeriodLabel = `${sorted[0]} ${latestYear}`;
            }
          }
        }
      }

      contextContent += `

INFORMASI PERIODE TERSEDIA:
- Data TERBARU yang tersedia di database: ${latestPeriodLabel}
- Tahun yang tersedia: ${yearsStr}
- Jika user bertanya "data terbaru", jawab dengan PASTI menggunakan periode terbaru: "${latestPeriodLabel}"
- Sebutkan periode SPESIFIK (triwulan/bulan jika ada), jangan hanya menyebut tahun
- JANGAN katakan "belum tersedia di sistem" karena data SUDAH ADA di database`;
    }

    // === BRS/PUBLIKASI CONTEXT FOR ENHANCED INTERPRETATION ===
    // If BRS context is available, use it as PRIMARY source for interpretation
    // BUT: Only if BRS matches the data period - otherwise prioritize the data table
    if (brsContext && (brsContext.brs?.length > 0 || brsContext.publications?.length > 0)) {
      const topBrs = brsContext.brs?.[0];
      const topPub = brsContext.publications?.[0];

      // Extract the latest period from the data table for comparison
      // This helps us detect if BRS is outdated vs the actual data
      let dataLatestPeriod = null;
      if (dataPreview && dataPreview.rows && dataPreview.rows.length > 0) {
        // Try to extract year from title (e.g., "Inflasi Kota Ternate (2022 = 100) • 2025")
        const titleMatch = String(dataPreview.title || '').match(/•\s*(\d{4})/);
        if (titleMatch) {
          dataLatestPeriod = Number(titleMatch[1]);
        }
        // Check the last row for month/triwulan info
        const lastRow = dataPreview.rows[dataPreview.rows.length - 1];
        const bulanVal = String(lastRow?.Bulan || lastRow?.bulan || '');
        // Try triwulan match first (e.g., "Triwulan II")
        const triwulanMatch = bulanVal.match(/Triwulan\s+(I{1,3}V?|IV)/i);
        if (triwulanMatch && dataLatestPeriod) {
          const twMap = { 'I': 3, 'II': 6, 'III': 9, 'IV': 12 }; // Map to equivalent month
          dataLatestPeriod = { year: dataLatestPeriod, month: twMap[triwulanMatch[1].toUpperCase()] || 3 };
        } else {
          const bulanMatch = bulanVal.match(/\[?(\d+)\]?\s*(\w+)/i);
          if (bulanMatch && dataLatestPeriod) {
            // We have month info - the data is more granular
            dataLatestPeriod = { year: dataLatestPeriod, month: Number(bulanMatch[1]) };
          }
        }
      }

      // Extract period from BRS title (e.g., "inflasi Year on Year ... Februari 2025")
      let brsPeriod = null;
      if (topBrs && topBrs.title) {
        const brsMonthMatch = String(topBrs.title).match(MONTH_YEAR_REGEX);
        if (brsMonthMatch) {
          brsPeriod = { year: Number(brsMonthMatch[2]), month: MONTH_MAP_NUMERIC[brsMonthMatch[1].toLowerCase()] };
        } else {
          // Try triwulan match (e.g., "Triwulan IV-2025" or "Triwulan IV 2025")
          const brsTwMatch = String(topBrs.title).match(/Triwulan\s+(I{1,3}V?|IV)[- ](\d{4})/i);
          if (brsTwMatch) {
            const twMap = { 'I': 3, 'II': 6, 'III': 9, 'IV': 12 };
            brsPeriod = { year: Number(brsTwMatch[2]), month: twMap[brsTwMatch[1].toUpperCase()] || 3 };
          } else {
            const brsYearMatch = String(topBrs.title).match(/\b(20\d{2})\b/);
            if (brsYearMatch) {
              brsPeriod = Number(brsYearMatch[1]);
            }
          }
        }
      }

      // Check if BRS is outdated compared to data
      let brsIsOutdated = false;
      let brsIsNewer = false; // BRS has MORE RECENT data than the table
      if (dataLatestPeriod && brsPeriod) {
        const dataYear = typeof dataLatestPeriod === 'object' ? dataLatestPeriod.year : dataLatestPeriod;
        const dataMonth = typeof dataLatestPeriod === 'object' ? dataLatestPeriod.month : 0;
        const brsYear = typeof brsPeriod === 'object' ? brsPeriod.year : brsPeriod;
        const brsMonth = typeof brsPeriod === 'object' ? brsPeriod.month : 0;

        // BRS is outdated if data has more recent period
        // When month is 0 (year-only), treat as unknown — don't assume outdated
        if (dataYear > brsYear || (dataYear === brsYear && dataMonth > 0 && brsMonth > 0 && dataMonth > brsMonth)) {
          brsIsOutdated = true;
          logger.debug(`[StreamChat] BRS outdated: BRS=${brsYear}-${brsMonth}, Data=${dataYear}-${dataMonth}`);
        }
        // BRS is NEWER if BRS has more recent period than data table
        if (brsYear > dataYear || (brsYear === dataYear && brsMonth > 0 && dataMonth > 0 && brsMonth > dataMonth)) {
          brsIsNewer = true;
          logger.info({ brsYear, brsMonth, dataYear, dataMonth }, '[StreamChat] BRS has NEWER data than table');
        }
      }

      // CRITICAL FIX: For range queries (multiple years), BRS typically covers only one year
      // Using BRS as primary source causes AI to hallucinate values for years not covered
      // In range queries, always prioritize the TABLE DATA, not BRS
      const brsNotApplicableForRange = isRangeQuery === true;
      if (brsNotApplicableForRange) {
        logger.debug(`[StreamChat] Range query detected - BRS will NOT be used as primary source (would cause hallucination)`);
      }

      // === PERIOD PRIORITY CONTEXT (Phase 10 - 2026-02-09) ===
      // When BRS/Publikasi has NEWER data than the table, instruct LLM to prioritize BRS
      if (periodPriorityContext) {
        contextContent += `

${periodPriorityContext}`;
        logger.debug('[StreamChat] Added period priority context - BRS/Pub has newer data than table');
      }

      let brsNarrative = '';

      logger.debug({
        topBrsTitle: topBrs?.title?.slice(0, 60),
        topBrsSim: topBrs?.similarity,
        topBrsContentLen: topBrs?.content?.length,
        brsIsOutdated,
        brsNotApplicableForRange,
        willInject: topBrs && topBrs.similarity >= 0.45 && !brsIsOutdated && !brsNotApplicableForRange,
      }, '[StreamChat] BRS narrative injection check');

      if (topBrs && topBrs.similarity >= 0.45 && !brsIsOutdated && !brsNotApplicableForRange) {
        // Confidence ≥0.45 BRS and up-to-date AND not a range query - use as interpretation source
        // (M5 gradient: 0.55+ strong, 0.45-0.55 moderate)
        const newerLabel = brsIsNewer ? ' ⚠️ DATA INI LEBIH BARU DARI TABEL!' : '';
        brsNarrative += `

SUMBER RESMI BRS (WAJIB DIGUNAKAN${newerLabel}):
[BRS: ${topBrs.title}] (relevansi: ${Math.round(topBrs.similarity * 100)}%)
${topBrs.content || ''}`;
      }

      if (topPub && topPub.similarity >= 0.45) {
        brsNarrative += `

SUMBER PUBLIKASI RESMI:
[Publikasi: ${topPub.title}] (relevansi: ${Math.round(topPub.similarity * 100)}%)
${topPub.content || ''}`;
      }

      if (brsNarrative) {
        contextContent += brsNarrative;

        // When BRS has NEWER data than the table, add explicit prioritization instruction
        if (brsIsNewer) {
          contextContent += `

⚠️ PERHATIAN KRITIS - BRS MEMILIKI DATA LEBIH BARU DARI TABEL:
- Tabel di atas hanya berisi data sampai periode yang LEBIH LAMA
- BRS di atas memiliki data periode TERBARU yang belum masuk ke tabel
- User bertanya "data terbaru" → WAJIB jawab dengan data dari BRS (periode terbaru)
- MULAI jawaban dengan data TERBARU dari BRS, baru tambahkan detail dari tabel jika perlu
- Contoh BENAR: "Data PDRB terbaru dari BRS Triwulan IV-2025 menunjukkan ekonomi Maluku Utara tumbuh 29,81% (y-on-y) dengan PDRB mencapai Rp133.620,3 miliar. Sementara data per kabupaten/kota tersedia sampai Triwulan II-2025."
- Contoh SALAH: "Data PDRB terbaru Triwulan II-2025 adalah..." (SALAH karena BRS punya data TW IV yang LEBIH BARU!)`;
        }

        contextContent += `

INSTRUKSI INTERPRETASI DENGAN BRS (WAJIB DIIKUTI):
- SUMBER UTAMA: Semua interpretasi HARUS dari BRS/Publikasi di atas
- DILARANG KERAS membuat analisis/interpretasi sendiri yang tidak ada di BRS
- KUTIP langsung atau PARAFRASE konten BRS - jangan menambah-nambah
- Jika BRS menyebutkan angka spesifik, WAJIB gunakan angka tersebut
- Jika BRS menyebutkan tren (naik/turun), WAJIB sebutkan PERSIS seperti di BRS
- Jika BRS menyebutkan penyebab/faktor, boleh disebutkan
- JANGAN mengarang penyebab/faktor yang tidak ada di BRS
- TIDAK PERLU menulis "Sumber data: ..." karena sumber sudah ditampilkan di UI

AKHIRI DENGAN REKOMENDASI:
- Tawarkan data terkait yang mungkin dibutuhkan user (berdasarkan konteks BRS)
- Contoh: "Apakah Anda ingin melihat inflasi per kelompok pengeluaran atau data kota lain?"
- Jawab dalam 2-4 kalimat + 1 rekomendasi`;
      } else if (brsNotApplicableForRange) {
        // Range query (multiple years) - BRS typically covers only one year, so use TABLE DATA as primary
        contextContent += `

PENTING - QUERY MULTI-TAHUN (WAJIB BACA TABEL, JANGAN MENGARANG):
- User meminta data untuk BEBERAPA TAHUN sekaligus
- BRS TIDAK BOLEH digunakan sebagai sumber (hanya mencakup satu periode)
- SUMBER DATA WAJIB: Tabel di atas adalah SATU-SATUNYA sumber yang valid

INSTRUKSI WAJIB UNTUK MULTI-TAHUN:
1. CARI baris dengan kolom "Wilayah" = "Maluku Utara" untuk setiap tahun (ini adalah total provinsi)
2. KUTIP ANGKA PERSIS dari kolom "Nilai" untuk setiap tahun yang TERLIHAT di tabel
3. Jika tahun tertentu TIDAK ADA di tabel, katakan "data belum tersedia"
4. DILARANG KERAS mengarang/memperkirakan angka yang TIDAK ADA di tabel
5. DILARANG menggunakan angka dari BRS/Publikasi

CONTOH FORMAT BENAR (untuk tabel kemiskinan):
"Jumlah penduduk miskin Maluku Utara periode 2021-2025:
- 2021: 87,16 ribu (dari baris Maluku Utara tahun 2021)
- 2022: 79,88 ribu (dari baris Maluku Utara tahun 2022)
- 2023: 83,80 ribu (dari baris Maluku Utara tahun 2023)
- dst..."

CONTOH SALAH (DILARANG):
"2022: 84,45 ribu" - angka ini TIDAK ADA di tabel, ini HALUSINASI

Jika tabel tidak menampilkan semua tahun yang diminta, WAJIB sampaikan ke user.`;
      } else if (brsIsOutdated) {
        // BRS is outdated - prioritize data table but keep simple
        contextContent += `

PENTING - BRS TIDAK UP-TO-DATE:
- BRS yang ditemukan LEBIH LAMA dari data di tabel
- Gunakan data dari TABEL di atas (bukan BRS)
- Identifikasi baris TERAKHIR sebagai data TERBARU

INSTRUKSI INTERPRETASI (SEDERHANA - TANPA ANALISIS MENDALAM):
- WAJIB sebutkan ANGKA SPESIFIK dari BARIS TERAKHIR tabel (data terbaru)
- Contoh: "Inflasi Desember 2025 tercatat 1,63% (year-on-year), 0,05% (month-to-month)"
- JANGAN membuat analisis tren/penyebab tanpa dasar dari BRS
- TIDAK PERLU menulis "Sumber data: ..." 
- Berikan respons singkat (max 2-3 kalimat) + tawarkan data terkait`;
      } else {
        // BRS available but low similarity - simple summary only
        contextContent += `

INSTRUKSI INTERPRETASI (BRS TIDAK CUKUP RELEVAN - RINGKASAN SEDERHANA):
- WAJIB sebutkan ANGKA SPESIFIK dari data terbaru di tabel
- JANGAN membuat analisis mendalam tanpa dukungan BRS
- Contoh baik: "Data terbaru menunjukkan TPT Kepulauan Sula tahun 2023 adalah 2,67%"
- DILARANG mengarang perbandingan/tren/penyebab
- TIDAK PERLU menulis "Sumber data: ..."
- Respons singkat max 2-3 kalimat + tawarkan data terkait`;
      }
    } else {
      // No BRS context - give SIMPLE summary only, no deep analysis
      contextContent += `

INSTRUKSI INTERPRETASI (TANPA BRS - RINGKASAN SEDERHANA SAJA):
- WAJIB sebutkan ANGKA SPESIFIK dari data terbaru di tabel
- HANYA berikan ringkasan angka, JANGAN membuat analisis mendalam
- DILARANG mengarang tren/penyebab/interpretasi tanpa dasar
- Contoh baik: "Data terbaru menunjukkan inflasi Desember 2025 sebesar 1,63% (year-on-year)"
- Contoh BURUK: "Inflasi menurun karena..." (DILARANG mengarang penyebab)
- TIDAK PERLU menulis "Sumber data: ..."
- Respons max 2-3 kalimat + tawarkan data terkait`;
    }

    // ── Inject Reconciliation Map (Data Reconciler Sub-Agent result) ──────
    // When the reconciler has compared table vs BRS/Pub per-row,
    // inject its decisions as authoritative instructions for the main LLM.
    if (reconciliationContext) {
      contextContent += `\n\n${reconciliationContext}`;
      logger.info('buildContextMessages: injected reconciliation map into data context');
    }

    contextMessages.push({
      role: 'system',
      content: contextContent,
    });

    // Add secondary data preview if available (dual EXIM or multi-datasource queries)
    if (dataPreviewSecondary && dataPreviewSecondary.rows && dataPreviewSecondary.rows.length > 0) {
      const rows2 = dataPreviewSecondary.rows.slice(0, 100);
      const cols2 = dataPreviewSecondary.columns;
      const header2 = '| ' + cols2.join(' | ') + ' |';
      const sep2 = '| ' + cols2.map(() => '---').join(' | ') + ' |';
      const body2 = rows2.map(row => {
        const values = cols2.map(col => {
          const val = row[col];
          if (val == null || val === '') return '-';
          return String(val).replace(/\|/g, '\\|');
        });
        return '| ' + values.join(' | ') + ' |';
      }).join('\n');

      const isExim = dataPreviewSecondary.eximMode === 'impor' || dataPreviewSecondary.eximMode === 'ekspor';
      const typeLabel = isExim
        ? (dataPreviewSecondary.eximMode === 'impor' ? 'IMPOR' : 'EKSPOR')
        : (dataPreviewSecondary.title || 'TABEL KEDUA');
      const instruction = isExim
        ? 'INSTRUKSI: Gabungkan analisis data ini dengan data sebelumnya. Sebutkan angka dari KEDUA tabel (ekspor DAN impor).'
        : 'INSTRUKSI: Gabungkan analisis data ini dengan data tabel pertama. Jawab pertanyaan user berdasarkan KEDUA indikator.';

      contextMessages.push({
        role: 'system',
        content: `DATA STATISTIK TAMBAHAN (${typeLabel}) DARI DATABASE BPS:

Judul: ${dataPreviewSecondary.title}
Total baris: ${dataPreviewSecondary.total_rows}

DATA (${rows2.length} baris):

${header2}
${sep2}
${body2}

${instruction}`,
      });
    }
  } else if (candidates?.length > 0) {
    // Has candidates but no preview - list the found datasources with available years info
    const topCandidates = candidates.slice(0, 3).map(c => `- "${c.name}"`).join('\n');

    // Build available years context
    let yearsContext = '';
    if (availableYearsInfo && availableYearsInfo.years && availableYearsInfo.years.length > 0) {
      const yearsStr = availableYearsInfo.years.slice(0, 5).join(', ');
      const latestYear = availableYearsInfo.years[0];
      yearsContext = `

INFORMASI PERIODE:
- Data terbaru yang tersedia: tahun ${latestYear}
- Tahun yang tersedia: ${yearsStr}
${availableYearsInfo.requestedYear && !availableYearsInfo.years.includes(availableYearsInfo.requestedYear)
        ? `- Data tahun ${availableYearsInfo.requestedYear} BELUM tersedia di sistem
- WAJIB sampaikan: "Data tahun ${availableYearsInfo.requestedYear} belum tersedia. Data terbaru yang tersedia adalah tahun ${latestYear}."`
        : ''}`;
    }

    contextMessages.push({
      role: 'system',
      content: `INDIKATOR/DATASOURCE YANG DITEMUKAN:
${topCandidates}
${yearsContext}

INSTRUKSI PENTING:
1. Sebutkan nama indikator yang relevan dari daftar di atas
2. JANGAN bilang "data tidak tersedia" atau "belum tersedia di sistem" - karena indikator sudah DITEMUKAN
3. Jelaskan tahun/periode yang tersedia (jika ada info di atas)
4. Tawarkan user untuk melihat data dari indikator tersebut
5. JANGAN menyebut angka statistik apapun (karena tabel belum dimuat)
6. Jika user menanyakan periode/tahun yang belum ada, sarankan hubungi BPS via WhatsApp di [+62 851-7676-4422](https://wa.me/6285176764422) untuk konfirmasi jadwal rilis data`,
    });
  } else {
    contextMessages.push({
      role: 'system',
      content: 'Tidak ada indikator yang cocok ditemukan untuk query user. Bantu user menentukan: indikator apa, periode (tahun/bulan), dan wilayah yang dibutuhkan. JANGAN menyebut angka apapun.',
    });
  }

  // Add conversation history
  if (historyMessages && historyMessages.length > 0) {
    const recent = historyMessages.slice(-24);
    for (const msg of recent) {
      // Strip malika_ui JSON blocks from assistant messages to save tokens
      let content = String(msg.content || '').slice(0, 5000);
      content = content.replace(/```\s*malika_ui[\s\S]*?```/gi, '').trim();
      content = content.replace(/\[MALIKA_UI_V1\][\s\S]*?\[\/MALIKA_UI_V1\]/gi, '').trim();
      if (!content) continue; // skip empty messages after stripping
      contextMessages.push({
        role: msg.role,
        content,
      });
    }
  }

  return contextMessages;
}

/**
 * Enrich knowledge context with query-specific extracted content
 * 
 * For large BRS/Publikasi documents, fetches full content from DB
 * and extracts only the sections relevant to the user's query.
 * 
 * @param {Array} knowledgeContext - Array of knowledge docs from vector search
 * @param {string} query - User query
 * @returns {Promise<Array>} - Enriched knowledge context with extracted content
 */
async function enrichKnowledgeWithExtraction(knowledgeContext, query, opts = {}) {
  const requestId = opts.requestId || '';
  if (!knowledgeContext || knowledgeContext.length === 0) {
    return knowledgeContext;
  }

  // ── Indicator-index injection: find large docs with matching indicators ──
  // If vector search missed a major yearbook/publication that has a matching
  // indicator entry, inject it into the context so extraction can work on it.
  const existingDocIds = new Set(knowledgeContext.map(d => d.id));
  try {
    const queryLower = query.toLowerCase();
    const stopWords = new Set(['yang', 'dan', 'atau', 'untuk', 'dari', 'bps', 'data', 'tahun',
      'provinsi', 'maluku', 'utara', 'kabupaten', 'kota', 'berapa', 'per', 'menurut', 'di']);
    const queryWords = queryLower.split(/\s+/)
      .map(w => w.replace(/[?!.,;:]+$/, '')) // strip trailing punctuation
      .filter(w => (w.length >= 3 || SHORT_WORD_WHITELIST.has(w)) && !stopWords.has(w) && !/^20\d{2}$/.test(w));

    if (queryWords.length >= 2) {
      // Cache ALL docs with indicator_index (lightweight: no content loaded)
      let candidateDocs = _injectionCandidateCache.get('allWithIndex');
      if (!candidateDocs) {
        candidateDocs = await KnowledgeBase.findAll({
          attributes: ['id', 'title', 'content_length', 'indicator_index', 'category'],
          where: {
            parent_id: null,
            status: 'ready',
            indicator_index: { [require('sequelize').Op.ne]: null },
            content_length: { [require('sequelize').Op.gte]: 100000 }, // only large docs
          },
        });
        _injectionCandidateCache.set('allWithIndex', candidateDocs);
        logger.debug({ count: candidateDocs.length }, 'Injection candidate cache: all large docs with indicator_index');
      }

      // Score ALL candidates by indicator match against query words
      const METADATA_TYPES_INJ = new Set(['KEYWORDS', 'TOPICS', 'PERIOD', 'ABBREV', 'INFO']);
      const LOW_SPEC = new Set([
        'jumlah', 'banyaknya', 'angka', 'indeks', 'nilai', 'rata-rata',
        'persentase', 'proporsi', 'luas', 'volume', 'tingkat', 'laju',
        'rumah', 'penduduk', 'produksi', 'wilayah', 'daerah', 'nasional',
        'jenis', 'kelompok', 'golongan', 'status', 'kategori', 'tipe',
        'tahun', 'bulan', 'triwulan', 'semester',
      ]);
      const minMatchForInjection = queryWords.length <= 2 ? 1.0 : queryWords.length <= 3 ? 1.5 : 2;

      // Detect if query asks for per-kabupaten/kota breakdown
      const isPerKabQuery = /per\s*kab|kabupaten.*kota|kab.*kota|menurut\s*kab/i.test(query);

      const scored = [];
      for (const candidate of candidateDocs) {
        if (existingDocIds.has(candidate.id)) continue;
        if (!candidate.indicator_index) continue;

        const entries = candidate.indicator_index.split('\n');
        let bestMatchCount = 0;
        let bestEntryHasKab = false;
        for (const entry of entries) {
          const parts = entry.split('|');
          if (parts.length < 3 || METADATA_TYPES_INJ.has(parts[0])) continue;
          const titleLower = parts[2].toLowerCase();
          let mc = 0;
          for (const w of queryWords) {
            if (titleLower.includes(w)) mc += LOW_SPEC.has(w) ? 0.3 : 1.0;
          }
          // Per-kab boost: if query asks per kab/kota AND indicator entry mentions it
          const entryHasKab = /kabupaten|kab\/kota/i.test(titleLower);
          if (isPerKabQuery && entryHasKab) mc += 1.5;
          if (mc > bestMatchCount) {
            bestMatchCount = mc;
            bestEntryHasKab = entryHasKab;
          }
        }

        if (bestMatchCount >= minMatchForInjection) {
          scored.push({ candidate, bestMatchCount, hasKabData: bestEntryHasKab });
        }
      }

      // Inject top 2 qualifying docs (limit to 2 to conserve token budget)
      const maxInject = Math.min(INDICATOR_INJECTION.MAX_INJECTIONS, 2);
      if (scored.length > 0) {
        scored.sort((a, b) => b.bestMatchCount - a.bestMatchCount
          || (a.candidate.content_length || 0) - (b.candidate.content_length || 0));
        const toInject = scored.slice(0, maxInject);
        for (const item of toInject) {
          // Load full content on demand for injected doc
          const fullDoc = await KnowledgeBase.findByPk(item.candidate.id, {
            attributes: ['id', 'title', 'content', 'content_length', 'indicator_index', 'category'],
          });
          if (!fullDoc?.content) continue;
          const entries = fullDoc.indicator_index?.split('\n') || [];
          logger.info({
            requestId,
            docId: fullDoc.id,
            title: fullDoc.title?.slice(0, 50),
            bestMatchCount: item.bestMatchCount,
            totalScored: scored.length,
            queryWords,
          }, 'Indicator-index injection: adding doc to context');
          knowledgeContext.push({
            id: fullDoc.id,
            title: fullDoc.title,
            content: fullDoc.content,
            indicatorIndex: fullDoc.indicator_index,
            _parsedIndicatorEntries: entries,
            category: fullDoc.category,
            similarity: 0.5, // synthetic score
            _injectedByIndicator: true,
          });
          existingDocIds.add(fullDoc.id);
        }
      }
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Indicator-index injection: failed, continuing without');
  }

  const enrichedDocs = await Promise.all(
    knowledgeContext.map(async (doc) => {
      const contentLength = doc.content?.length || 0;
      
      // Log doc processing at debug level
      logger.debug({
        docId: doc.id,
        title: doc.title?.slice(0, 40),
        contentLength,
        hasIndicatorIndex: !!doc.indicatorIndex,
        indicatorIndexLen: doc.indicatorIndex?.length || 0,
        hasMatchedChunk: !!doc.matchedChunkText,
      }, 'enrichKnowledgeWithExtraction: processing doc');
      
      // ═══════════════════════════════════════════════════════════════════
      // INDICATOR-GUIDED EXTRACTION (highest priority)
      // ═══════════════════════════════════════════════════════════════════
      // When a large document has an indicator_index (from DAFTAR TABEL /
      // DAFTAR ISI / DAFTAR GAMBAR / DAFTAR LAMPIRAN extraction) that
      // matches query keywords, we can find the EXACT table/section in
      // the document and extract around it.
      // Works for any publication type: yearbooks, statistical reports,
      // directories, etc. — any doc with structured TOC content.
      // Config: INDICATOR_INJECTION.ENRICHMENT_GATE_CHARS (default 50K)
      // ═══════════════════════════════════════════════════════════════════
      if (doc.indicatorIndex && contentLength > INDICATOR_INJECTION.ENRICHMENT_GATE_CHARS) {
        const indicatorResult = await extractByIndicatorIndex(doc, query);
        if (indicatorResult) return indicatorResult;
      }
      
      // ═══════════════════════════════════════════════════════════════════
      // CHUNK-WINDOW EXTRACTION (fallback for massive docs without indicator match)
      // ═══════════════════════════════════════════════════════════════════
      // When vector search matched a specific chunk in a massive doc, the
      // chunk position tells us where the relevant data is. Extract a
      // focused window around the matched chunk's position.
      // Config: INDICATOR_INJECTION.CHUNK_WINDOW_GATE_CHARS (default 400K)
      // ═══════════════════════════════════════════════════════════════════
      if (doc.matchedChunkText && contentLength > INDICATOR_INJECTION.CHUNK_WINDOW_GATE_CHARS) {
        return await extractChunkWindow(doc, query);
      }
      
      // ═══ All other docs: keep as-is from vector search cache ═══════
      // Medium docs (80-300K) rely on SMART_CONTEXT trimming which:
      //   1. Prepends matchedChunkText for query-relevant focus
      //   2. Takes first N chars of content (TOC/summary sections)
      //   3. Trims to perDocChars limit per tier
      // This preserves document structure the model needs, unlike keyword
      // extraction + DB load which inflates total context and triggers
      // the Knowledge Analyst's lossy compression.
      
      // For docs with matched chunks, add hint marker
      if (doc.matchedChunkText) {
        return {
          ...doc,
          content: `[BAGIAN PALING RELEVAN]\n${doc.matchedChunkText}\n\n[DOKUMEN LENGKAP]\n${doc.content}`,
          hasMatchedChunk: true,
        };
      }
      
      return doc;
    })
  );
  
  return enrichedDocs;
}

/**
 * Extract a focused content window around the matched chunk's position
 * in the full parent document. For large yearbooks (750+ pages), this
 * provides much more accurate content than keyword extraction.
 * 
 * Strategy:
 * 1. Find where matchedChunkText appears in the full document
 * 2. Extract ±WINDOW_SIZE chars around it (line-aligned)
 * 3. If chunk is in first 15% (likely TOC/header), ALSO search for
 *    query keywords deeper in the doc to find actual data tables
 * 4. Prepend a TOC excerpt from document start for structure context
 * 
 * @param {object} doc - Document with content and matchedChunkText
 * @param {string} query - User query (for keyword search + logging)
 * @param {number} windowSize - Chars to extract before/after chunk (default: 20000)
 * @returns {Promise<object>} - Enriched document
 */
async function extractChunkWindow(doc, query, windowSize = 20000) {
  try {
    // doc.content already has full parent content from vector search cache
    const fullContent = doc.content;
    if (!fullContent || fullContent.length < 1000) {
      return doc; // fallback
    }
    
    const chunkText = doc.matchedChunkText;
    // Find first occurrence of the chunk in the full content
    // Use first 200 chars of chunk to handle minor differences
    const searchSnippet = chunkText.slice(0, 200);
    let chunkPos = fullContent.indexOf(searchSnippet);
    
    if (chunkPos === -1) {
      // Chunk text not found (shouldn't happen) — fall back to standard extraction
      logger.warn({ docId: doc.id, chunkLen: chunkText.length }, 
        'extractChunkWindow: matched chunk not found in parent content, falling back');
      const extracted = await extractRelevantContent(doc.id, query);
      if (extracted && extracted.method === 'extracted') {
        return {
          ...doc,
          content: `[BAGIAN PALING RELEVAN]\n${chunkText}\n\n[KONTEN RELEVAN DIEKSTRAK]\n${extracted.content}`,
          contentExtracted: true,
          indicatorInjected: true,
          extractionMethod: extracted.method,
          hasMatchedChunk: true,
        };
      }
      return doc;
    }
    
    const positionPct = (chunkPos / fullContent.length) * 100;
    
    // ── Extract primary window around matched chunk ──
    const extractWindow = (pos, size) => {
      const rawStart = Math.max(0, pos - size);
      const rawEnd = Math.min(fullContent.length, pos + chunkText.length + size);
      const alignedStart = rawStart === 0 ? 0 : (fullContent.indexOf('\n', rawStart) + 1) || rawStart;
      const alignedEnd = rawEnd >= fullContent.length ? fullContent.length : (fullContent.lastIndexOf('\n', rawEnd) || rawEnd);
      return fullContent.slice(alignedStart, alignedEnd);
    };
    
    const primaryWindow = extractWindow(chunkPos, windowSize);
    
    // ── Dual-window: if chunk is in TOC area (first 15%), find data deeper ──
    // The TOC chunk matched semantically (has query keywords in table titles)
    // but actual DATA tables with numbers are deep in the document.
    let deepDataWindow = '';
    let deepDataPos = -1;
    
    if (positionPct < 15 && fullContent.length > 100000) {
      // Extract specific keywords from query (filter out generic terms)
      const queryLower = query.toLowerCase();
      const genericTerms = new Set(['maluku', 'utara', 'provinsi', 'kabupaten', 'kota', 'per', 'tahun', 'data', 'berapa', 'jumlah', '2024', '2023', '2025']);
      const specificTerms = queryLower
        .split(/\s+/)
        .filter(w => (w.length >= 3 || SHORT_WORD_WHITELIST.has(w)) && !genericTerms.has(w));
      
      if (specificTerms.length > 0) {
        // Search for specific keywords in the deep part of the document (>50%)
        const deepStart = Math.floor(fullContent.length * 0.50);
        const deepContent = fullContent.slice(deepStart).toLowerCase();
        
        // Find the best keyword match position (prefer position with most keywords)
        let bestPos = -1;
        let bestScore = 0;
        
        // Scan in steps to find data-dense sections
        const step = 2000;
        for (let scanPos = 0; scanPos < deepContent.length - step; scanPos += step) {
          const section = deepContent.slice(scanPos, scanPos + step);
          let score = 0;
          for (const term of specificTerms) {
            // Count occurrences of each term
            const matches = section.split(term).length - 1;
            score += matches;
          }
          // Bonus for sections with numeric data (tables have lots of numbers)
          if (/\d+[.,]\d+.*\d+[.,]\d+/.test(section)) {
            score += 2;
          }
          if (score > bestScore) {
            bestScore = score;
            bestPos = scanPos;
          }
        }
        
        if (bestPos >= 0 && bestScore >= 2) {
          deepDataPos = deepStart + bestPos;
          const deepWinSize = Math.floor(windowSize * 0.7); // Slightly smaller window
          deepDataWindow = extractWindow(deepDataPos, deepWinSize);
          
          logger.info({
            docId: doc.id,
            chunkPct: positionPct.toFixed(1),
            deepDataPct: ((deepDataPos / fullContent.length) * 100).toFixed(1),
            keywordScore: bestScore,
            specificTerms,
            deepWindowLen: deepDataWindow.length,
          }, 'Chunk-window: TOC chunk detected, added deep data window via keyword search');
        }
      }
    }
    
    // Extract TOC/structure from document beginning (helps LLM understand context)
    const tocSize = 4000;
    const toc = fullContent.slice(0, Math.min(fullContent.length, tocSize));
    
    // Build focused content
    const contentParts = [
      `[DAFTAR ISI / STRUKTUR DOKUMEN "${doc.title || ''}"]`,
      toc,
      '',
      `[BAGIAN TERKAIT - sekitar posisi ${positionPct.toFixed(1)}% dokumen]`,
      primaryWindow,
    ];
    
    if (deepDataWindow) {
      const deepPct = ((deepDataPos / fullContent.length) * 100).toFixed(1);
      contentParts.push('');
      contentParts.push(`[DATA TABEL - bagian data di posisi ${deepPct}% dokumen]`);
      contentParts.push(deepDataWindow);
    }
    
    const content = contentParts.join('\n');
    
    logger.info({
      docId: doc.id,
      title: doc.title?.slice(0, 50),
      method: 'chunk-window',
      chunkPosition: chunkPos,
      docLength: fullContent.length,
      windowSize,
      tocSize,
      extractedLength: content.length,
      positionPct: positionPct.toFixed(1),
      hasDeepWindow: !!deepDataWindow,
      deepDataPos,
      query: query?.slice(0, 60),
    }, 'Chunk-window extraction: focused on matched chunk position');
    
    return {
      ...doc,
      content,
      contentExtracted: true,
      indicatorInjected: false,
      extractionMethod: 'chunk-window',
      chunkPosition: chunkPos,
      hasMatchedChunk: true,
    };
  } catch (err) {
    logger.warn({ err: err.message, docId: doc.id }, 'extractChunkWindow failed, using original');
    return doc;
  }
}

/**
 * Indicator-guided extraction: use indicator_index to find and extract
 * specific tables/sections from a large document.
 * 
 * When query matches entries in the indicator_index (e.g., "restoran" matches
 * "TBL|8.5|Jumlah Rumah Makan/Restoran"), we search the document for that
 * specific table and extract a window around it.
 * 
 * @param {object} doc - Document with content and indicatorIndex
 * @param {string} query - User query
 * @returns {Promise<object|null>} - Enriched document or null if no match
 */
async function extractByIndicatorIndex(doc, query) {
  try {
    const indicatorIndex = doc.indicatorIndex;
    if (!indicatorIndex) return null;

    const queryLower = query.toLowerCase();
    const stopWords = new Set(['yang', 'dan', 'atau', 'untuk', 'dari', 'bps', 'data', 'tahun',
      'provinsi', 'maluku', 'utara', 'kabupaten', 'kota', 'berapa', 'per', 'menurut', 'di']);
    const queryWords = queryLower.split(/\s+/)
      .map(w => w.replace(/[?!.,;:]+$/, '')) // strip trailing punctuation
      .filter(w => (w.length >= 3 || SHORT_WORD_WHITELIST.has(w)) && !stopWords.has(w) && !/^20\d{2}$/.test(w));

    if (queryWords.length === 0) return null;

    // ── Parse ABBREV and KEYWORDS metadata from indicator_index ──
    // ABBREV lines: "ABBREV|TPK=Tingkat Penghunian Kamar|PDRB=Produk Domestik Regional Bruto"
    // KEYWORDS lines: "KEYWORDS|rumah makan|restoran|kuliner|..."
    const abbrevMap = new Map(); // abbrev lowercase → expansion lowercase
    let keywordsText = '';       // joined KEYWORDS for secondary boost

    // QW-1: reuse pre-parsed entries from injection scoring if available
    const entries = doc._parsedIndicatorEntries || indicatorIndex.split('\n');
    for (const entry of entries) {
      if (entry.startsWith('ABBREV|')) {
        const pairs = entry.slice(7).split('|');
        for (const pair of pairs) {
          const eqIdx = pair.indexOf('=');
          if (eqIdx > 0) {
            abbrevMap.set(pair.slice(0, eqIdx).trim().toLowerCase(), pair.slice(eqIdx + 1).trim().toLowerCase());
          }
        }
      } else if (entry.startsWith('KEYWORDS|')) {
        keywordsText += ' ' + entry.slice(9).replace(/\|/g, ' ');
      }
    }

    // Also merge static BPS abbreviations for expansion
    const { BPS_ABBREVIATION_MAP } = require('../../../shared/bpsAbbreviations');
    for (const [abbr, expansion] of Object.entries(BPS_ABBREVIATION_MAP)) {
      if (!abbrevMap.has(abbr)) abbrevMap.set(abbr, expansion.toLowerCase());
    }

    // Expand abbreviations in query words: "tpk" → also match "tingkat penghunian kamar"
    const expandedQueryWords = [...queryWords];
    for (const word of queryWords) {
      const expansion = abbrevMap.get(word);
      if (expansion) {
        const expansionWords = expansion.split(/\s+/).filter(w => w.length >= 3 && !stopWords.has(w));
        for (const ew of expansionWords) {
          if (!expandedQueryWords.includes(ew)) expandedQueryWords.push(ew);
        }
      }
    }

    const keywordsLower = keywordsText.toLowerCase();

    // Find indicator entries matching query words
    const matchedEntries = [];

    const METADATA_TYPES = new Set(['KEYWORDS', 'TOPICS', 'PERIOD', 'ABBREV', 'INFO']);

    // ── Specificity weighting for query words ──────────────────────────
    // Generic BPS table words ("jumlah", "rumah", "penduduk", etc.) appear
    // in 30-60% of all table titles. Matching them alone causes massive
    // false positives (e.g., "rumah makan" query matching "Rumah Tangga
    // Usaha Pertanian"). Weight generic words at 0.3 vs 1.0 for specific.
    const LOW_SPECIFICITY_WORDS = new Set([
      'jumlah', 'banyaknya', 'angka', 'indeks', 'nilai', 'rata-rata',
      'persentase', 'proporsi', 'luas', 'volume', 'tingkat', 'laju',
      'rumah', 'penduduk', 'produksi', 'wilayah', 'daerah', 'nasional',
      'jenis', 'kelompok', 'golongan', 'status', 'kategori', 'tipe',
      'tahun', 'bulan', 'triwulan', 'semester',
    ]);

    for (const entry of entries) {
      const parts = entry.split('|');
      if (parts.length < 3) continue;
      const [type, num, title] = parts;
      if (METADATA_TYPES.has(type)) continue;
      const titleLower = title.toLowerCase();

      // Count weighted matches: specific words score 1.0, generic score 0.3
      let matchCount = 0;
      for (const word of expandedQueryWords) {
        if (titleLower.includes(word)) {
          matchCount += LOW_SPECIFICITY_WORDS.has(word) ? 0.3 : 1.0;
        }
      }

      // Phrase bonus: consecutive query word pairs that appear consecutively in title
      // Disambiguates "sumber air minum" (matches 2 pairs) vs "akses air minum layak" (1 pair)
      let phraseBonus = 0;
      for (let i = 0; i < expandedQueryWords.length - 1; i++) {
        const bigram = expandedQueryWords[i] + ' ' + expandedQueryWords[i + 1];
        if (titleLower.includes(bigram)) phraseBonus += 0.5;
      }
      matchCount += phraseBonus;

      // Secondary boost: check if KEYWORDS mention this entry's key terms
      // This helps when query terms appear in KEYWORDS but not directly in the title
      let keywordBoost = 0;
      if (matchCount === 0 && keywordsLower) {
        // Check if original query words appear in KEYWORDS
        const qWordsInKeywords = queryWords.filter(w => keywordsLower.includes(w)).length;
        // And if title words appear in KEYWORDS near query words
        const titleTokens = titleLower.split(/\s+/).filter(w => w.length >= 3);
        const titleInKeywords = titleTokens.filter(w => keywordsLower.includes(w)).length;
        if (qWordsInKeywords >= 1 && titleInKeywords >= 2) {
          keywordBoost = 0.5; // Partial boost — not as strong as direct title match
        }
      }

      const totalScore = matchCount + keywordBoost;

      // Require at least 1 match (2+ for short query words)
      if (totalScore >= 1) {
        matchedEntries.push({ type, num, title, matchCount: totalScore, entry });
      }
    }
    
    if (matchedEntries.length === 0) return null;
    
    // Sort by match count (best matches first), prefer TBL over BAB/TOC
    // Deprioritize Sampling Error entries — they mirror real tables but contain
    // only statistical error margins, not actual data. Without this, queries like
    // "sumber air minum ... 2024" match SE tables higher because they include the year.
    const querySamplingError = queryLower.includes('sampling error') || queryLower.includes('standard error');
    matchedEntries.sort((a, b) => {
      const aIsSE = !querySamplingError && /sampling error/i.test(a.title);
      const bIsSE = !querySamplingError && /sampling error/i.test(b.title);
      if (aIsSE !== bIsSE) return aIsSE ? 1 : -1; // Push SE entries to the bottom
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      // TBL > TOC > FIG > APP > BAB
      const typeOrder = { TBL: 5, TOC: 4, FIG: 3, APP: 2, BAB: 1 };
      return (typeOrder[b.type] || 0) - (typeOrder[a.type] || 0);
    });
    
    const bestEntry = matchedEntries[0];
    
    // Need at least 2 query words matching for specificity (or 1 if it's a rare word)
    if (bestEntry.matchCount < 1 || (queryWords.length >= 3 && bestEntry.matchCount < 2)) {
      return null;
    }
    
    logger.info({
      docId: doc.id,
      title: doc.title?.slice(0, 50),
      bestEntry: bestEntry.entry,
      matchCount: bestEntry.matchCount,
      queryWords,
      totalMatches: matchedEntries.length,
    }, 'Indicator-guided extraction: found matching indicators');
    
    // ── Extract year hint from entry title (for labeling) ──
    const yearMatch = bestEntry.title.match(/(20\d{2})(?:\/20\d{2})?/);
    const yearHint = yearMatch ? yearMatch[0] : '';
    
    // Search for the table/section in the document content
    const fullContent = doc.content;
    if (!fullContent) return null;
    
    // Build search patterns based on entry type and number (generic for all types)
    const searchPatterns = [];
    const tableNum = bestEntry.num;
    
    // Type-specific patterns — covers TBL, BAB, FIG, APP, TOC and any future types
    const TYPE_PATTERNS = {
      TBL: [`Tabel ${tableNum}`, `Table ${tableNum}`, `Tabel  ${tableNum}`, `Table  ${tableNum}`],
      BAB: [`BAB ${tableNum}`, `Bab ${tableNum}`, `Chapter ${tableNum}`],
      FIG: [`Gambar ${tableNum}`, `Figure ${tableNum}`, `Grafik ${tableNum}`],
      APP: [`Lampiran ${tableNum}`, `Appendix ${tableNum}`, `Lampiran  ${tableNum}`],
      TOC: [`${tableNum} `],
    };
    
    const typePatterns = TYPE_PATTERNS[bestEntry.type] || [];
    searchPatterns.push(...typePatterns);
    
    // Always add number-based fallback and title keyword search
    searchPatterns.push(`${tableNum}  `);
    const titleWords = bestEntry.title.split(/\s+/).filter(w => w.length > 3).slice(0, 3);
    if (titleWords.length >= 2) {
      searchPatterns.push(titleWords.join('.*').substring(0, 60));
    }
    
    // Find the best match position (prefer data area, >30% of doc)
    const contentLower = fullContent.toLowerCase();
    // Also create a newline-normalized version for pattern matching —
    // PDF-extracted text often has "Tabel\n6.11" instead of "Tabel 6.11"
    const contentNorm = contentLower.replace(/\n/g, ' ');
    let bestPos = -1;
    let bestPosLabel = '';
    const dataThreshold = detectDataStart(fullContent);

    for (const pattern of searchPatterns) {
      const patLower = pattern.toLowerCase();
      // Try exact match first, then newline-normalized match
      let pos = contentLower.indexOf(patLower, dataThreshold);
      if (pos === -1) pos = contentNorm.indexOf(patLower, dataThreshold);
      if (pos === -1) pos = contentLower.indexOf(patLower);
      if (pos === -1) pos = contentNorm.indexOf(patLower);
      if (pos >= 0 && (bestPos === -1 || pos > dataThreshold)) {
        // Prefer positions in the data area (>15%)
        if (bestPos === -1 || (pos > dataThreshold && bestPos < dataThreshold) || 
            (pos > dataThreshold && bestPos > dataThreshold && pos < bestPos)) {
          bestPos = pos;
          bestPosLabel = pattern;
        }
      }
    }
    
    if (bestPos === -1) return null;
    
    const positionPct = (bestPos / fullContent.length) * 100;
    
    // Extract window around the found position — adaptive size
    // BPS per-kab/kota tables can span 3-8K chars; base 15K ensures full table data
    // Deep tables (e.g., 8.1.2.3) and "per kabupaten" queries need more room
    const tableDepth = (bestEntry.num.match(/\./g) || []).length; // "8.1.2" → depth 2
    const isPerKabQuery = /per\s*kab|kabupaten.*kota|kab.*kota/i.test(query);
    const windowSize = EXTRACTION.WINDOW_SIZE
      + (tableDepth >= 3 ? 5000 : 0)   // Deep sub-tables: +5K
      + (isPerKabQuery ? EXTRACTION.PER_KAB_EXTRA : 0);
    const rawStart = Math.max(0, bestPos - 500); // Small prefix for context
    const rawEnd = Math.min(fullContent.length, bestPos + windowSize);
    const alignedStart = rawStart === 0 ? 0 : (fullContent.indexOf('\n', rawStart) + 1) || rawStart;
    const alignedEnd = rawEnd >= fullContent.length ? fullContent.length : (fullContent.lastIndexOf('\n', rawEnd) || rawEnd);
    const dataWindow = fullContent.slice(alignedStart, alignedEnd);
    
    // Also extract additional matching tables for compound queries (e.g., "hotel DAN restoran")
    // Each additional entry gets its own extraction window if it's in a different location
    const extraWindows = [];
    const MAX_EXTRA_TABLES = 3; // Limit to prevent context bloat
    for (let i = 1; i < matchedEntries.length && extraWindows.length < MAX_EXTRA_TABLES; i++) {
      const secondEntry = matchedEntries[i];
      // Require meaningful match: at least 1 query word, or 2 for longer queries
      const minMatch = queryWords.length <= 2 ? 1 : 2;
      if (secondEntry.matchCount < minMatch) continue;
      
      // Build patterns for this entry using same TYPE_PATTERNS
      const secTypePatterns = (TYPE_PATTERNS[secondEntry.type] || []).map(p => p.toLowerCase());
      secTypePatterns.push(`${secondEntry.num}  `.toLowerCase());
      let secondPos = -1;
      for (const sp of secTypePatterns) {
        secondPos = contentLower.indexOf(sp, dataThreshold);
        if (secondPos >= 0) break;
      }
      // Must be in a different location (>3K apart from best and all previous extra windows)
      if (secondPos >= 0 && Math.abs(secondPos - bestPos) > 3000) {
        const tooCloseToExisting = extraWindows.some(ew => Math.abs(ew.pos - secondPos) < 3000);
        if (tooCloseToExisting) continue;
        
        const s2Start = Math.max(0, secondPos - 500);
        const s2End = Math.min(fullContent.length, secondPos + EXTRACTION.PER_KAB_EXTRA);
        const s2AlignedStart = s2Start === 0 ? 0 : (fullContent.indexOf('\n', s2Start) + 1) || s2Start;
        const s2AlignedEnd = s2End >= fullContent.length ? fullContent.length : (fullContent.lastIndexOf('\n', s2End) || s2End);
        extraWindows.push({
          pos: secondPos,
          title: secondEntry.title,
          num: secondEntry.num,
          content: fullContent.slice(s2AlignedStart, s2AlignedEnd),
        });
      }
    }
    
    // Build focused content: TOC excerpt + indicator-guided window
    const tocSize = 3000;
    const toc = fullContent.slice(0, Math.min(fullContent.length, tocSize));
    
    // Disambiguation hint: when top-2 entries have very close scores, help LLM pick the right one
    let disambiguationHint = '';
    if (matchedEntries.length >= 2) {
      const gap = matchedEntries[0].matchCount - matchedEntries[1].matchCount;
      if (gap < 0.5) {
        disambiguationHint = `CATATAN: Tabel yang paling relevan dengan pertanyaan adalah "${matchedEntries[0].title}". Gunakan tabel ini.\n`;
      }
    }

    const contentParts = [
      `[DAFTAR ISI / STRUKTUR DOKUMEN "${doc.title || ''}"]`,
      toc,
      '',
      ...(disambiguationHint ? [disambiguationHint] : []),
      `⭐ TABEL RESMI DIEKSTRAK — ${bestEntry.type === 'TBL' ? 'Tabel' : bestEntry.type} ${bestEntry.num}${yearHint ? ` (DATA ${yearHint})` : ''}: ${bestEntry.title}`,
      `Relevansi terhadap pertanyaan: ${bestEntry.matchCount >= 4 ? 'SANGAT TINGGI' : bestEntry.matchCount >= 3 ? 'TINGGI' : 'SEDANG'} (skor ${bestEntry.matchCount.toFixed(1)}).${bestEntry.matchCount >= 4 ? ' PRIORITASKAN tabel ini di atas tabel lain dengan skor lebih rendah.' : ''} GUNAKAN DATA DARI TABEL INI UNTUK MENJAWAB.`,
      dataWindow,
    ];
    
    for (const ew of extraWindows) {
      contentParts.push('');
      contentParts.push(`⭐ TABEL TAMBAHAN ${ew.num}: ${ew.title}`);
      contentParts.push(ew.content);
    }
    
    // Skip prepending matchedChunkText for indicator-guided extraction.
    // The extraction already found the exact table — adding a random chunk
    // from elsewhere (often TOC or a different section) confuses the LLM.
    
    const content = contentParts.join('\n');
    
    logger.info({
      docId: doc.id,
      title: doc.title?.slice(0, 50),
      method: 'indicator-guided',
      tableFound: bestEntry.entry,
      searchPattern: bestPosLabel,
      position: bestPos,
      positionPct: positionPct.toFixed(1),
      docLength: fullContent.length,
      extractedLength: content.length,
      extraTables: extraWindows.length,
      query: query?.slice(0, 60),
    }, 'Indicator-guided extraction: found table in document');
    
    return {
      ...doc,
      content,
      contentExtracted: true,
      indicatorInjected: true,
      extractionMethod: 'indicator-guided',
      _extractedTableTitle: bestEntry.entry,
      _indicatorMatchScore: bestEntry.matchCount,
      hasMatchedChunk: !!doc.matchedChunkText,
    };
  } catch (err) {
    logger.warn({ err: err.message, docId: doc.id }, 'extractByIndicatorIndex failed');
    return null;
  }
}

module.exports = {
  searchKnowledgeBase,
  isKnowledgeTypeQuery,
  buildContextMessages,
  enrichKnowledgeWithExtraction,
  extractRelevantContent,
  detectDataStart,
  _hasTopicOverlap,
};
