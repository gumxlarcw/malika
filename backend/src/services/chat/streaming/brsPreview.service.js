/**
 * BRS/Publikasi Preview Service
 *
 * Extracted from streaming.service.js for modularity.
 */

'use strict';

const baseLogger = require('../../../utils/logger').child({ service: 'BRSPreview' });
const { SimpleCache } = require('../../../utils/simpleCache');
const { now } = require('../../../utils/dateHelper');

const brsSearchCache = new SimpleCache(10 * 60 * 1000, 200);

function buildCacheKey(query, options = {}) {
  return JSON.stringify({
    query: String(query || '').trim().toLowerCase(),
    indicator: String(options.indicator || '').trim().toLowerCase(),
    period: String(options.period || '').trim().toLowerCase(),
    geo: String(options.geo || '').trim().toLowerCase(),
  });
}

/**
 * Search BRS/Publikasi specifically for statistical data interpretation
 * This is used to enrich data interpretation with official BRS narratives
 *
 * @param {string} query - User query (e.g., "inflasi desember 2025")
 * @param {object} options - Search options
 * @param {string} options.indicator - Indicator name from datasource
 * @param {string} options.period - Period string (e.g., "2025", "2025-12")
 * @param {string} options.geo - Geographic filter
 * @param {object} deps - Optional dependencies
 * @param {object} deps.vectorSearchService - Optional injected vector search service
 * @param {object} deps.contentFilterService - Optional injected content filter service
 * @param {object} deps.logger - Optional injected logger
 * @returns {Promise<{brs: Array, publications: Array, meta: Object}>}
 */
async function searchBrsForInterpretation(query, options = {}, deps = {}) {
  const logger = deps.logger || baseLogger;
  let vectorSearchService = deps.vectorSearchService;
  let contentFilterService = deps.contentFilterService;

  const cacheKey = buildCacheKey(query, options);
  const cached = brsSearchCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (!vectorSearchService) {
    try {
      vectorSearchService = require('../../ai/vectorSearch.service');
    } catch {
      vectorSearchService = null;
    }
  }

  if (!contentFilterService) {
    try {
      contentFilterService = require('../../ai/contentFilter.service');
    } catch {
      contentFilterService = null;
    }
  }

  if (!vectorSearchService?.searchKnowledge) {
    return { brs: [], publications: [], meta: { method: 'no_service' } };
  }

  const keywordSynonyms = {
    'pdrb': ['pdrb', 'produk', 'domestik', 'regional', 'bruto', 'ekonomi', 'pertumbuhan'],
    'inflasi': ['inflasi', 'ihk', 'harga', 'konsumen'],
    'kemiskinan': ['kemiskinan', 'miskin', 'garis'],
    'pengangguran': ['pengangguran', 'angkatan', 'kerja', 'tpt', 'bekerja'],
    'penduduk': ['penduduk', 'populasi', 'demografi', 'sensus'],
    'ekspor': ['ekspor', 'impor', 'neraca', 'perdagangan', 'luar'],
    'ntp': ['ntp', 'tukar', 'petani', 'pertanian'],
    'ipm': ['ipm', 'pembangunan', 'manusia'],
    'gini': ['gini', 'ketimpangan', 'ratio'],
    'migrasi': ['migrasi', 'perpindahan', 'penduduk'],
  };

  try {
    let enrichedQuery = query;
    let indicatorKeywords = [];
    if (options.indicator) {
      const indicatorClean = String(options.indicator)
        .replace(/•\s*\d{4}$/, '')
        .replace(/\(\d{4}\s*=\s*\d+\)/g, '')
        .trim();
      enrichedQuery = `${indicatorClean} ${query}`;
      indicatorKeywords = indicatorClean
        .toLowerCase()
        .replace(/\[.*?\]/g, '')
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !['dan', 'atau', 'yang', 'untuk', 'dengan', 'dari', 'menurut', 'provinsi', 'kabupaten', 'kota', 'maluku', 'utara', 'seri'].includes(w));
    }

    const isTerbaruQuery = /\b(terbaru|terakhir|latest|recent)\b/i.test(query);
    if (options.period && !isTerbaruQuery) {
      const periodYear = parseInt(String(options.period).match(/\d{4}/)?.[0]);
      const isBaseYear = [2010, 2012, 2022].includes(periodYear);
      if (!isBaseYear) {
        enrichedQuery = `${enrichedQuery} ${options.period}`;
      }
    }

    const queryKeywords = query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !['data', 'terbaru', 'tahun', 'bulan', 'triwulan', 'dan', 'atau', 'yang', 'untuk', 'dengan', 'dari'].includes(w));

    const allKeywords = [...new Set([...queryKeywords, ...indicatorKeywords])];
    const expandedKeywords = new Set(allKeywords);
    for (const kw of allKeywords) {
      for (const [main, synonyms] of Object.entries(keywordSynonyms)) {
        if (synonyms.includes(kw) || main === kw) {
          synonyms.forEach(syn => expandedKeywords.add(syn));
        }
      }
    }

    const result = await vectorSearchService.searchKnowledge(enrichedQuery, 12);
    const results = (result.results || []).filter(r => r.similarity >= 0.45);

    const topicRelevantResults = results.filter(r => {
      const titleLower = (r.name || '').toLowerCase();
      const hasKeywordMatch = [...expandedKeywords].some(kw => {
        const pattern = new RegExp(`\\b${kw}\\b`, 'i');
        return pattern.test(titleLower);
      });
      if (!hasKeywordMatch && expandedKeywords.size > 0) {
        logger.debug(`[StreamChat] Filtered out irrelevant source: "${r.name?.slice(0, 50)}..." (no keyword match for: ${[...expandedKeywords].slice(0, 6).join(', ')})`);
      }
      return hasKeywordMatch || expandedKeywords.size === 0;
    });

    let allBrs = topicRelevantResults.filter(r => r.category === 'BRS');
    let allPubs = topicRelevantResults.filter(r => r.category === 'Publikasi');

    const indicatorLower = (options.indicator || '').toLowerCase();
    const isCountConcept = /\bjumlah\b/.test(indicatorLower);
    const isPercentConcept = /\bpersentase\b|\bpersen\b/.test(indicatorLower);

    if ((isCountConcept || isPercentConcept) && allBrs.length > 0) {
      allBrs = allBrs.map(brs => {
        const brsTitle = (brs.name || '').toLowerCase();
        const brsIsCount = /\bjumlah\b/.test(brsTitle);
        const brsIsPercent = /\bpersentase\b|\bpersen\b/.test(brsTitle);

        let conceptMatch = 'neutral';
        if (isCountConcept && brsIsCount) conceptMatch = 'match';
        else if (isPercentConcept && brsIsPercent) conceptMatch = 'match';
        else if (isCountConcept && brsIsPercent) conceptMatch = 'mismatch';
        else if (isPercentConcept && brsIsCount) conceptMatch = 'mismatch';

        return { ...brs, conceptMatch };
      });

      const matchedBrs = allBrs.filter(b => b.conceptMatch !== 'mismatch');

      if (matchedBrs.length > 0) {
        allBrs = matchedBrs;
        logger.debug(`[StreamChat] Concept alignment: filtered to ${matchedBrs.length} matching BRS for "${isCountConcept ? 'Jumlah' : 'Persentase'}" concept`);
      } else {
        logger.debug(`[StreamChat] Concept mismatch: all ${allBrs.length} BRS are about "${isCountConcept ? 'Persentase' : 'Jumlah'}" but table is about "${isCountConcept ? 'Jumlah' : 'Persentase'}" - skipping BRS context`);
        allBrs = [];
      }
    }

    const currentDataYear = options.period ? parseInt(String(options.period).match(/\d{4}/)?.[0]) : now().getFullYear();
    const minAcceptableYear = currentDataYear - 2;

    const extractYearFromTitle = (title) => {
      const match = String(title || '').match(/\b(20\d{2})\b/);
      return match ? parseInt(match[1]) : null;
    };

    const filterByRecency = (items, label) => items.filter(r => {
      const docYear = extractYearFromTitle(r.name);
      if (docYear && docYear < minAcceptableYear) {
        logger.debug(`[StreamChat] Filtered out outdated ${label}: "${r.name?.slice(0, 60)}..." (year ${docYear} < min ${minAcceptableYear})`);
        return false;
      }
      return true;
    });

    if (isTerbaruQuery && allBrs.length > 0) {
      const monthOrder = {
        'januari': 1, 'februari': 2, 'maret': 3, 'april': 4, 'mei': 5, 'juni': 6,
        'juli': 7, 'agustus': 8, 'september': 9, 'oktober': 10, 'november': 11, 'desember': 12
      };
      const triwulanOrder = { 'i': 1, 'ii': 2, 'iii': 3, 'iv': 4 };

      allBrs = allBrs.map(r => {
        const titleLower = (r.name || '').toLowerCase();
        const docYear = extractYearFromTitle(r.name) || 2020;

        let monthValue = 0;
        for (const [monthName, value] of Object.entries(monthOrder)) {
          if (titleLower.includes(monthName)) {
            monthValue = value;
            break;
          }
        }

        if (!monthValue) {
          const triwMatch = titleLower.match(/triwulan\s*(i{1,3}v?|iv)/i);
          if (triwMatch) {
            const triwNum = triwulanOrder[triwMatch[1].toLowerCase()] || 0;
            monthValue = triwNum * 3;
          }
        }

        const dateScore = docYear * 100 + monthValue;
        return { ...r, originalSimilarity: r.similarity, dateScore };
      });

      allBrs = allBrs.sort((a, b) => {
        if (b.dateScore !== a.dateScore) return b.dateScore - a.dateScore;
        return b.originalSimilarity - a.originalSimilarity;
      });
      logger.debug(`[StreamChat] TERBARU boost applied: top BRS now "${allBrs[0]?.name?.slice(0, 60)}..." (dateScore: ${allBrs[0]?.dateScore}, sim: ${allBrs[0]?.originalSimilarity?.toFixed(3)})`);
    }

    const rawBrs = allBrs.slice(0, 3);
    const rawPubs = allPubs.slice(0, 2);

    const recencyFilteredBrs = filterByRecency(rawBrs, 'BRS');
    const recencyFilteredPubs = filterByRecency(rawPubs, 'Publication');

    const filterStats = { brs: [], pubs: [] };

    const brs = recencyFilteredBrs.map(doc => {
      if (contentFilterService?.filterBrsContent) {
        const filtered = contentFilterService.filterBrsContent(doc.content);
        filterStats.brs.push({ id: doc.id, method: filtered.method, origLen: doc.content?.length || 0, newLen: filtered.content.length });
        return { ...doc, content: filtered.content, filterMethod: filtered.method };
      }
      return { ...doc, content: (doc.content || '').slice(0, 20000), filterMethod: 'fallback' };
    });

    const publications = recencyFilteredPubs.map(doc => {
      if (contentFilterService?.filterPublicationContent) {
        const filtered = contentFilterService.filterPublicationContent(doc.content, enrichedQuery);
        filterStats.pubs.push({
          id: doc.id,
          method: filtered.method,
          chapter: filtered.chapter,
          origLen: doc.content?.length || 0,
          newLen: filtered.content.length
        });
        return { ...doc, content: filtered.content, filterMethod: filtered.method, chapter: filtered.chapter };
      }
      return { ...doc, content: (doc.content || '').slice(0, 15000), filterMethod: 'fallback' };
    });

    const totalOriginal = [...recencyFilteredBrs, ...recencyFilteredPubs].reduce((sum, d) => sum + (d.content?.length || 0), 0);
    const totalFiltered = [...brs, ...publications].reduce((sum, d) => sum + (d.content?.length || 0), 0);
    const savedChars = totalOriginal - totalFiltered;

    logger.debug(`[StreamChat] BRS search for interpretation: query="${enrichedQuery.slice(0, 50)}..." -> ${brs.length} BRS, ${publications.length} Pub | Content: ${totalOriginal} -> ${totalFiltered} chars (saved ${savedChars})`);

    if (filterStats.pubs.some(p => p.chapter)) {
      logger.debug(`[StreamChat] Publication chapters extracted: ${filterStats.pubs.filter(p => p.chapter).map(p => p.chapter).join(', ')}`);
    }

    const payload = {
      brs,
      publications,
      meta: {
        query: enrichedQuery,
        totalOriginal,
        totalFiltered,
        savedChars,
        filterStats,
      }
    };

    brsSearchCache.set(cacheKey, payload);
    return payload;
  } catch (e) {
    logger.warn({ error: e.message }, 'BRS search for interpretation failed');
    return { brs: [], publications: [], meta: { error: e.message } };
  }
}

function searchBRS(query, options = {}, deps = {}) {
  return searchBrsForInterpretation(query, options, deps);
}

function formatBRSPreview(brsContext = {}) {
  const brs = (brsContext.brs || []).map(doc => ({
    title: doc.title || doc.name || null,
    similarity: doc.similarity,
    url: doc.url || doc.link || doc.source_url || null,
    snippet: doc.content ? String(doc.content).slice(0, 400) : null,
  }));

  const publications = (brsContext.publications || []).map(doc => ({
    title: doc.title || doc.name || null,
    similarity: doc.similarity,
    url: doc.url || doc.link || doc.source_url || null,
    snippet: doc.content ? String(doc.content).slice(0, 400) : null,
  }));

  return {
    brs,
    publications,
    meta: brsContext.meta || {},
  };
}

function buildBRSSuggestions(brsContext = {}) {
  const suggestions = [];
  const topBrs = brsContext.brs?.[0];
  const topPub = brsContext.publications?.[0];

  if (topBrs?.title || topBrs?.name) {
    suggestions.push(`Ringkas BRS: ${topBrs.title || topBrs.name}`);
  }
  if (topPub?.title || topPub?.name) {
    suggestions.push(`Ringkas publikasi: ${topPub.title || topPub.name}`);
  }

  return suggestions.slice(0, 3);
}

module.exports = {
  searchBrsForInterpretation,
  searchBRS,
  formatBRSPreview,
  buildBRSSuggestions,
};
