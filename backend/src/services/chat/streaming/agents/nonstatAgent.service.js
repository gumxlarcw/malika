/**
 * Non-Stat Agent — Pipeline V2 Layer 2
 *
 * Handles non-statistical knowledge base search (internal docs, FAQ,
 * institutional info). Simpler than publicationAgent — no retry needed.
 *
 * Filters KB results to non-stat categories (Informasi, Internal, FAQ).
 *
 * @module nonstatAgent
 */

'use strict';

const { okResult, failResult, agentDetail, agentThinking } = require('./agentProtocol');
const logger = require('../../../../utils/logger').child({ service: 'NonstatAgent' });

// Non-stat categories in KB
const NONSTAT_CATEGORIES = new Set(['Informasi', 'Internal', 'FAQ', 'Prosedur', 'Layanan']);

/**
 * Run the non-stat agent.
 *
 * @param {import('./agentProtocol').AgentInput} input
 * @returns {Promise<import('./agentProtocol').AgentOutput>}
 */
async function run(input) {
  const startMs = Date.now();

  try {
    const { gate, sse } = input;

    // Skip for greetings or pure statistical queries
    if (gate?.route === 'greeting' || input._isGreeting) {
      return okResult('nonstat', { sources: [], skipped: true }, { latencyMs: Date.now() - startMs });
    }

    // Also skip if gate strongly indicates statistical-only
    if (gate?.route === 'statistical_fast' || gate?.route === 'statistical_exim') {
      return okResult('nonstat', { sources: [], skipped: true }, { latencyMs: Date.now() - startMs });
    }

    const { searchKnowledgeBase } = require('../knowledgeContext.service');
    const kbQuery = input.effectiveQuery || input.query;

    const tSearch = Date.now();
    let docs = await searchKnowledgeBase(kbQuery, 10, { skipRerank: true });
    const searchMs = Date.now() - tSearch;

    // Filter to non-stat categories
    if (docs?.length > 0) {
      docs = docs.filter(d => {
        const cat = d.category || '';
        return NONSTAT_CATEGORIES.has(cat) || (!['BRS', 'Publikasi'].includes(cat) && cat !== '');
      });
    }

    if (docs?.length > 0) {
      agentThinking(sse, {
        step: 'nonstat', icon: '📝',
        label: `${docs.length} referensi non-statistik`,
        detail: (docs[0]?.title || '').slice(0, 80),
        elapsedMs: searchMs,
      });
      agentDetail(sse, 'nonstat', `${docs.length} dokumen informasi ditemukan`);
    }

    return okResult('nonstat', {
      sources: docs || [],
    }, { latencyMs: Date.now() - startMs, timings: { search: searchMs } });
  } catch (err) {
    return failResult('nonstat', err, { latencyMs: Date.now() - startMs });
  }
}

module.exports = { run };
