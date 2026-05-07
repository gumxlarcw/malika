/**
 * Publication Agent — Pipeline V2 Layer 2
 *
 * Handles BRS + Publikasi knowledge base search with confidence-based
 * retry and query reformulation for improved publication stability.
 *
 * Replaces: stageKnowledgeSearch (BRS/Pub portion) from V1 pipeline.
 * Reuses: knowledgeContext.service, vectorSearch.service, hybridSearch.service
 *
 * Key improvement over V1: confidence-based retry with query reformulation.
 * When initial search confidence is low (< 0.7), the agent reformulates
 * the query using LLM synonyms and retries, addressing cosine noise in
 * large (300-page) publication retrieval.
 *
 * @module publicationAgent
 */

'use strict';

const { okResult, failResult, agentStatus, agentDetail, agentThinking } = require('./agentProtocol');
const { SIMILARITY, INDICATOR_INJECTION } = require('../config');
const logger = require('../../../../utils/logger').child({ service: 'PublicationAgent' });

// Confidence threshold: below this triggers reformulation retry
const RETRY_CONFIDENCE_THRESHOLD = 0.55;
// Maximum retry attempts
const MAX_RETRIES = 1;

/**
 * Run the publication agent.
 *
 * @param {import('./agentProtocol').AgentInput} input
 * @returns {Promise<import('./agentProtocol').AgentOutput>}
 */
async function run(input) {
  const startMs = Date.now();
  const timings = {};

  try {
    const { gate, sse, norm } = input;

    // Skip for greetings
    if (gate?.route === 'greeting' || input._isGreeting) {
      return okResult('publication', { sources: [], skipped: true }, { latencyMs: Date.now() - startMs });
    }

    agentStatus(sse, 'knowledge', 'Mencari referensi BRS & Publikasi…');

    const { searchKnowledgeBase, enrichKnowledgeWithExtraction } = require('../knowledgeContext.service');

    // ── Phase 1: Initial search ─────────────────────────────────────────
    // Use original effectiveQuery for KB search (not DNA-enriched — see V1 comment)
    const kbQuery = input.effectiveQuery || input.query;
    // Always skip DocumentJudge reranking — publicationAgent has its own quality
    // control via confidence-based retry + series dedup + latest-edition preference
    const skipRerank = true;

    const t1 = Date.now();
    let docs = await searchKnowledgeBase(kbQuery, 15, { skipRerank });
    timings.initialSearch = Date.now() - t1;

    // Filter to only stat categories (BRS + Publikasi)
    if (docs?.length > 0) {
      docs = docs.filter(d => d.category === 'BRS' || d.category === 'Publikasi');
    }

    let searchAttempts = 1;
    let reformulated = false;

    // ── Phase 2: Confidence check + retry ───────────────────────────────
    // If top result confidence is low, reformulate and retry
    const topSim = docs?.[0]?.similarity || 0;
    if (docs.length > 0 && topSim < RETRY_CONFIDENCE_THRESHOLD && MAX_RETRIES > 0) {
      logger.info({ topSim, threshold: RETRY_CONFIDENCE_THRESHOLD, query: kbQuery.slice(0, 80) },
        'publicationAgent: low confidence — attempting reformulation');

      const reformulatedQuery = _reformulateQuery(kbQuery, norm);
      if (reformulatedQuery && reformulatedQuery !== kbQuery) {
        const t2 = Date.now();
        const retryDocs = await searchKnowledgeBase(reformulatedQuery, 15, { skipRerank });
        timings.retrySearch = Date.now() - t2;
        searchAttempts++;

        // Filter to stat categories
        const retryStatDocs = (retryDocs || []).filter(d => d.category === 'BRS' || d.category === 'Publikasi');

        // Merge: deduplicate by ID, keep higher similarity
        if (retryStatDocs.length > 0) {
          const merged = _mergeDeduplicate(docs, retryStatDocs);
          if (merged[0]?.similarity > topSim) {
            docs = merged;
            reformulated = true;
            logger.info({
              originalTop: topSim.toFixed(3),
              retryTop: merged[0].similarity.toFixed(3),
              reformulatedQuery: reformulatedQuery.slice(0, 80),
            }, 'publicationAgent: reformulation improved results');
          }
        }
      }
    }

    // ── Phase 3: Prefer latest editions ─────────────────────────────────
    if (docs?.length > 1) {
      docs = _preferLatestEditions(docs);
    }

    // ── Phase 4: Enrich large documents ─────────────────────────────────
    const docSizes = docs.map(d => (d.content?.length || 0));
    const hasLargeDoc = docSizes.some(s => s > INDICATOR_INJECTION.ENRICHMENT_GATE_CHARS);
    if (hasLargeDoc && enrichKnowledgeWithExtraction) {
      const tEnrich = Date.now();
      docs = await enrichKnowledgeWithExtraction(docs, input.effectiveQuery);
      timings.enrichment = Date.now() - tEnrich;
    }

    // ── Phase 5: Follow-up KB anchoring ─────────────────────────────────
    if (input._shouldPreferPrevCandidates && input.context.prevUiMeta?.knowledgeCandidates?.length > 0) {
      docs = await _anchorPreviousKB(docs, input.context.prevUiMeta.knowledgeCandidates);
    }

    // Emit thinking
    if (docs.length > 0) {
      const brsList = docs.filter(d => d.category === 'BRS');
      const pubList = docs.filter(d => d.category === 'Publikasi');
      const parts = [];
      if (brsList.length > 0) parts.push(`${brsList.length} BRS`);
      if (pubList.length > 0) parts.push(`${pubList.length} Publikasi`);
      const topTitle = (brsList[0] || pubList[0])?.title || '';
      agentThinking(sse, {
        step: 'knowledge', icon: '📚',
        label: `${parts.join(' + ')} referensi ditemukan`,
        detail: topTitle.slice(0, 100),
        brsCount: brsList.length, pubCount: pubList.length,
        elapsedMs: Date.now() - startMs,
      });
      agentDetail(sse, 'knowledge', `${docs.length} dokumen: ${topTitle.slice(0, 50)}${reformulated ? ' (reformulasi)' : ''}`,
        { resultStatus: 'ok' });
    } else {
      agentDetail(sse, 'knowledge', 'Tidak ada referensi BRS/Publikasi', { resultStatus: 'empty' });
    }

    return okResult('publication', {
      sources: docs,
      searchAttempts,
      reformulated,
      topSimilarity: docs[0]?.similarity || 0,
    }, { latencyMs: Date.now() - startMs, timings });
  } catch (err) {
    return failResult('publication', err, { latencyMs: Date.now() - startMs });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Reformulate query for retry using normalization context.
 * Uses BPS domain synonyms and abbreviation expansion.
 */
function _reformulateQuery(query, norm) {
  const { expandAbbreviationsInline } = require('../../../../shared/bpsAbbreviations');

  // Strategy 1: Expand abbreviations (IPM → Indeks Pembangunan Manusia)
  let expanded = expandAbbreviationsInline(query);

  // Strategy 2: If DNA enrichment found official names, use them
  if (norm?.dnaEnrichedQuery && norm.dnaEnrichedQuery !== query) {
    // Use DNA-enriched query but only the enrichment terms (not full query)
    const enrichTerms = norm.dnaEnrichedQuery.replace(norm.normalizedQuery || query, '').trim();
    if (enrichTerms) {
      expanded = `${expanded} ${enrichTerms}`;
    }
  }

  // Strategy 3: Add common BPS domain synonyms
  const { BPS_SYNONYMS } = require('../../../../shared/bpsDomainSynonyms');
  const lower = query.toLowerCase();
  const synonymParts = [];
  for (const [key, syns] of Object.entries(BPS_SYNONYMS || {})) {
    if (lower.includes(key) && Array.isArray(syns)) {
      synonymParts.push(...syns.slice(0, 2));
    }
  }
  if (synonymParts.length > 0) {
    expanded = `${expanded} ${synonymParts.join(' ')}`;
  }

  return expanded.trim() !== query.trim() ? expanded.trim() : null;
}

/**
 * Merge two document arrays, deduplicating by ID, keeping higher similarity.
 */
function _mergeDeduplicate(primary, secondary) {
  const map = new Map();
  for (const doc of primary) {
    if (doc.id) map.set(doc.id, doc);
  }
  for (const doc of secondary) {
    if (!doc.id) continue;
    const existing = map.get(doc.id);
    if (!existing || (doc.similarity || 0) > (existing.similarity || 0)) {
      map.set(doc.id, doc);
    }
  }
  return [...map.values()].sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
}

/**
 * Prefer latest edition when multiple publications from same series exist.
 */
function _preferLatestEditions(docs) {
  if (!docs || docs.length <= 1) return docs;
  const yearRe = /\b(19|20)\d{2}\b/g;
  const seriesMap = new Map();

  for (const doc of docs) {
    const title = (doc.title || '').trim();
    const years = title.match(yearRe);
    const latestYear = years?.length ? Math.max(...years.map(Number)) : 0;
    const seriesKey = title.replace(yearRe, '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!seriesMap.has(seriesKey)) seriesMap.set(seriesKey, []);
    seriesMap.get(seriesKey).push({ doc, year: latestYear });
  }

  const keep = new Set();
  for (const [, editions] of seriesMap) {
    if (editions.length <= 1) { keep.add(editions[0].doc); continue; }
    editions.sort((a, b) => b.year - a.year);
    keep.add(editions[0].doc);
  }

  return docs.filter(d => keep.has(d)).slice(0, 10);
}

/**
 * Re-inject previous KB docs if completely lost (follow-up anchoring).
 */
async function _anchorPreviousKB(currentDocs, prevCandidates) {
  try {
    const prevKbIds = new Set(prevCandidates.map(k => k.id).filter(Boolean));
    const currentKbIds = new Set((currentDocs || []).map(k => k.id));
    const retained = [...prevKbIds].filter(id => currentKbIds.has(id)).length;

    if (retained === 0 && currentDocs?.length > 0 && prevKbIds.size > 0) {
      const { loadKnowledgeEmbeddings } = require('../../../ai/vectorSearch.service');
      const kbCache = await loadKnowledgeEmbeddings();
      for (const prevDoc of prevCandidates) {
        if (!prevDoc.id || currentKbIds.has(prevDoc.id)) continue;
        const cached = kbCache.get(prevDoc.id);
        if (cached) {
          currentDocs.push({
            id: prevDoc.id, name: cached.title, title: cached.title,
            category: cached.category, content: cached.content,
            similarity: 0.50, source: 'knowledge', _anchored: true,
          });
          currentKbIds.add(prevDoc.id);
        }
      }
    }
  } catch (e) {
    logger.debug({ error: e.message }, 'Follow-up KB anchoring failed');
  }
  return currentDocs;
}

module.exports = { run };
