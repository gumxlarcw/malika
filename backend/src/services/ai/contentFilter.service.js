/**
 * Content Filter Service
 * 
 * Runtime content filtering for Publications and BRS documents.
 * - Publications: TOC-based chapter extraction (95% have TOC)
 * - BRS: Full content (no filtering, just limit increase)
 * 
 * NO RE-EMBEDDING REQUIRED - filters at query time only.
 */

// Content limits
const BRS_CONTENT_LIMIT = 50000;        // BRS: full content (maximized for accuracy)
const PUB_CONTENT_LIMIT = 50000;        // Publication: full chapter content (maximized)
const PUB_FALLBACK_LIMIT = 50000;       // Publication without TOC: full content (maximized)

// Boilerplate patterns to remove
const BOILERPLATE_PATTERNS = [
  // Page markers
  /-- \d+ of \d+ --/g,
  // URL footers
  /https?:\/\/malut\.bps\.go\.id/g,
  // Catalog numbers alone on line
  /^Katalog[:\s]*[\d\.\-]+\s*$/gim,
  // Empty page markers
  /^\s*https?:\/\/[^\s]+\s*$/gm,
];

// Sections to strip from publications
const STRIP_SECTIONS = [
  { start: /KATA PENGANTAR/i, end: /(?=\n\n|DAFTAR|BAB|Bab\s+\d)/i },
  { start: /TIM PENYUSUN/i, end: /(?=\n\n|KATA|DAFTAR|BAB)/i },
  { start: /UCAPAN TERIMA KASIH/i, end: /(?=\n\n|DAFTAR|BAB)/i },
  { start: /DAFTAR GAMBAR/i, end: /(?=\n\n|BAB|Bab\s+\d)/i },
  { start: /DAFTAR LAMPIRAN/i, end: /(?=\n\n|BAB|Bab\s+\d)/i },
];

/**
 * Remove boilerplate patterns from content
 * @param {string} content - Raw content
 * @returns {string} - Cleaned content
 */
function stripBoilerplate(content) {
  let cleaned = String(content || '');
  
  for (const pattern of BOILERPLATE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  
  // Remove excessive whitespace
  cleaned = cleaned.replace(/\n{4,}/g, '\n\n\n');
  
  return cleaned.trim();
}

/**
 * Parse Table of Contents (DAFTAR ISI) from publication content
 * @param {string} content - Full publication content
 * @returns {Array<{title: string, page: number, level: number}>|null}
 */
function parseTOC(content) {
  if (!content) return null;
  
  // Find DAFTAR ISI section
  const tocMatch = content.match(/DAFTAR ISI[\s\S]*?(?=\n\n(?:BAB|Bab\s+\d|PENDAHULUAN|I\.\s|1\.\s)|-- \d+ of)/i);
  if (!tocMatch) return null;
  
  const tocSection = tocMatch[0];
  const entries = [];
  
  // Pattern for TOC entries: "Bab 1 Title .... 5" or "1.1 SubTitle ... 10"
  const entryPattern = /(?:Bab\s+)?(\d+(?:\.\d+)*)\s+([^\.]+)\.{2,}\s*(\d+)/gi;
  let match;
  
  while ((match = entryPattern.exec(tocSection)) !== null) {
    const number = match[1];
    const title = match[2].trim();
    const page = parseInt(match[3], 10);
    const level = number.split('.').length;
    
    entries.push({
      number,
      title,
      page,
      level,
      fullTitle: `${number} ${title}`,
    });
  }
  
  // Also try "BAB I", "BAB II" Roman numeral pattern
  const romanPattern = /BAB\s+([IVX]+)\s+([^\.]+)\.{2,}\s*(\d+)/gi;
  while ((match = romanPattern.exec(tocSection)) !== null) {
    const number = match[1];
    const title = match[2].trim();
    const page = parseInt(match[3], 10);
    
    entries.push({
      number,
      title,
      page,
      level: 1,
      fullTitle: `BAB ${number} ${title}`,
    });
  }
  
  return entries.length > 0 ? entries : null;
}

/**
 * Find the most relevant TOC entry for a query
 * @param {Array} tocEntries - Parsed TOC entries
 * @param {string} query - User query
 * @returns {Object|null} - Best matching entry
 */
function findRelevantChapter(tocEntries, query) {
  if (!tocEntries || !query) return null;
  
  const q = String(query).toLowerCase();
  const words = q.split(/\s+/).filter(w => w.length >= 3);
  
  let bestMatch = null;
  let bestScore = 0;
  
  for (const entry of tocEntries) {
    const titleLower = entry.title.toLowerCase();
    let score = 0;
    
    // Exact keyword matches
    for (const word of words) {
      if (titleLower.includes(word)) {
        score += word.length; // Longer words = higher score
      }
    }
    
    // Boost for statistical keywords
    const statKeywords = [
      'data', 'statistik', 'analisis', 'hasil', 'perkembangan',
      'tabel', 'grafik', 'metodologi', 'konsep', 'definisi',
    ];
    for (const kw of statKeywords) {
      if (titleLower.includes(kw) && q.includes(kw)) {
        score += 5;
      }
    }
    
    // Prefer main chapters (level 1) over subchapters
    if (entry.level === 1 && score > 0) {
      score += 3;
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }
  
  return bestScore >= 3 ? bestMatch : null;
}

/**
 * Extract chapter content based on page markers
 * @param {string} content - Full content
 * @param {Object} targetEntry - TOC entry to extract
 * @param {Array} allEntries - All TOC entries (to find end point)
 * @returns {string} - Extracted chapter content
 */
function extractChapterContent(content, targetEntry, allEntries) {
  if (!content || !targetEntry) return content;
  
  // Find the next chapter's page to determine end point
  const sortedEntries = [...allEntries].sort((a, b) => a.page - b.page);
  const targetIdx = sortedEntries.findIndex(e => e.page === targetEntry.page);
  const nextEntry = sortedEntries[targetIdx + 1];
  
  const startPage = targetEntry.page;
  const endPage = nextEntry ? nextEntry.page : startPage + 20;
  
  // Try to find content between page markers
  const pagePattern = (page) => new RegExp(`-- ${page} of \\d+ --`, 'i');
  
  let startIdx = -1;
  let endIdx = content.length;
  
  // Find start marker (or nearby)
  for (let p = startPage; p <= startPage + 2; p++) {
    const pattern = pagePattern(p);
    const match = content.match(pattern);
    if (match) {
      startIdx = content.indexOf(match[0]);
      break;
    }
  }
  
  // Find end marker
  for (let p = endPage; p >= endPage - 2; p--) {
    const pattern = pagePattern(p);
    const match = content.match(pattern);
    if (match) {
      endIdx = content.indexOf(match[0]);
      break;
    }
  }
  
  // If page markers not found, try chapter title pattern
  if (startIdx === -1) {
    // Try to find "Bab X Title" or "BAB X Title" in content
    const chapterPattern = new RegExp(
      `(?:Bab|BAB)\\s+${targetEntry.number}[^\\n]*${targetEntry.title.slice(0, 20)}`,
      'i'
    );
    const match = content.match(chapterPattern);
    if (match) {
      startIdx = content.indexOf(match[0]);
    }
  }
  
  if (startIdx === -1) {
    // Fallback: return from beginning
    return content.slice(0, PUB_CONTENT_LIMIT);
  }
  
  const extracted = content.slice(startIdx, endIdx);
  return extracted.slice(0, PUB_CONTENT_LIMIT);
}

/**
 * Apply basic content filter for publications without TOC
 * Removes common non-statistical sections
 * @param {string} content - Raw content
 * @returns {string} - Filtered content
 */
function filterPublicationBasic(content) {
  let filtered = stripBoilerplate(content);
  
  // Remove known non-statistical sections
  for (const section of STRIP_SECTIONS) {
    const startMatch = filtered.match(section.start);
    if (startMatch) {
      const startIdx = filtered.indexOf(startMatch[0]);
      const afterStart = filtered.slice(startIdx);
      const endMatch = afterStart.match(section.end);
      
      if (endMatch) {
        const endIdx = startIdx + afterStart.indexOf(endMatch[0]);
        // Remove section
        filtered = filtered.slice(0, startIdx) + filtered.slice(endIdx);
      }
    }
  }
  
  // Remove DAFTAR ISI section itself (but keep reference)
  filtered = filtered.replace(
    /DAFTAR ISI[\s\S]*?(?=\n\n(?:BAB|Bab\s+\d|PENDAHULUAN|I\.\s|1\.\s)|-- \d+ of)/gi,
    '[DAFTAR ISI dihapus]\n\n'
  );
  
  return filtered.slice(0, PUB_FALLBACK_LIMIT);
}

/**
 * Main function: Filter publication content for RAG context
 * @param {string} content - Full publication content
 * @param {string} query - User query (optional, for chapter detection)
 * @param {Object} options - Options
 * @returns {{content: string, method: string, chapter?: string}}
 */
function filterPublicationContent(content, query = '', options = {}) {
  if (!content) {
    return { content: '', method: 'empty' };
  }
  
  // Step 1: Strip boilerplate
  let cleaned = stripBoilerplate(content);
  
  // Step 2: Try TOC-based extraction
  const toc = parseTOC(content);
  
  if (toc && toc.length > 0 && query) {
    // Find relevant chapter
    const relevantChapter = findRelevantChapter(toc, query);
    
    if (relevantChapter) {
      // Extract just that chapter
      const chapterContent = extractChapterContent(cleaned, relevantChapter, toc);
      return {
        content: chapterContent,
        method: 'toc_chapter',
        chapter: relevantChapter.fullTitle,
        pageStart: relevantChapter.page,
      };
    }
    
    // TOC exists but no specific chapter matches query
    // Return first substantive chapter (skip intro/methodology for data queries)
    const dataChapter = toc.find(e => 
      /hasil|analisis|statistik|data|perkembangan/i.test(e.title)
    );
    
    if (dataChapter) {
      const chapterContent = extractChapterContent(cleaned, dataChapter, toc);
      return {
        content: chapterContent,
        method: 'toc_data_chapter',
        chapter: dataChapter.fullTitle,
        pageStart: dataChapter.page,
      };
    }
  }
  
  // Step 3: No TOC or no match - use basic filter
  const fallbackContent = filterPublicationBasic(cleaned);
  return {
    content: fallbackContent,
    method: toc ? 'toc_no_match' : 'no_toc_fallback',
  };
}

/**
 * Filter BRS content (minimal filtering, just limit)
 * BRS content is typically narrative and should be preserved
 * @param {string} content - Full BRS content
 * @returns {{content: string, method: string}}
 */
function filterBrsContent(content) {
  if (!content) {
    return { content: '', method: 'empty' };
  }
  
  // Strip only page markers and URLs
  let cleaned = stripBoilerplate(content);
  
  // BRS content is valuable - return more of it
  return {
    content: cleaned.slice(0, BRS_CONTENT_LIMIT),
    method: 'brs_full',
  };
}

/**
 * Main entry point: Filter document content based on category
 * @param {Object} doc - Document object with content and category
 * @param {string} query - User query
 * @returns {{content: string, method: string, chapter?: string}}
 */
function filterDocumentContent(doc, query = '') {
  if (!doc || !doc.content) {
    return { content: '', method: 'empty' };
  }
  
  const category = String(doc.category || '').toLowerCase();
  
  if (category === 'brs') {
    return filterBrsContent(doc.content);
  }
  
  if (category === 'publikasi') {
    return filterPublicationContent(doc.content, query);
  }
  
  // Other categories (PPID, custom) - return as-is with limit
  return {
    content: String(doc.content).slice(0, 30000),
    method: 'other',
  };
}

module.exports = {
  filterDocumentContent,
  filterPublicationContent,
  filterBrsContent,
  stripBoilerplate,
  parseTOC,
  findRelevantChapter,
  // Constants
  BRS_CONTENT_LIMIT,
  PUB_CONTENT_LIMIT,
  PUB_FALLBACK_LIMIT,
};
