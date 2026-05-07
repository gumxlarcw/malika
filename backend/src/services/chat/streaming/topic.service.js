/**
 * Topic Context Service
 *
 * Extracted from streaming.service.js for modularity.
 */

'use strict';

const logger = require('../../../utils/logger').child({ service: 'TopicContext' });
const { stripMalikaUiBlock, isConfirmMessage, parseUiMetaFromContent } = require('./chatHelpers');
const {
  isLikelyTimeOrPeriodFragment,
  isLikelyGeoOnlyFragment,
  isShortFollowUp,
} = require('./queryContext.service');
const {
  SERVICE_PATTERNS,
  INDICATOR_PATTERNS,
  SERVICE_TOPIC_NAMES,
  TOPIC_DISPLAY_MAP,
} = require('./topicPatterns');

/**
 * Extract topic keywords from a query
 */
function extractTopicKeywords(query) {
  const q = String(query || '').toLowerCase();
  const topics = [];

  for (const { pattern, display } of SERVICE_PATTERNS) {
    if (pattern.test(q)) {
      topics.push(display);
    }
  }

  for (const pattern of INDICATOR_PATTERNS) {
    const match = q.match(pattern);
    if (match) topics.push(match[1]);
  }

  return topics;
}

/**
 * Check if user query is asking about a NEW topic
 */
function isNewTopicQuery(userQuery, conversationTopic) {
  if (!conversationTopic) return true;

  const queryTopics = extractTopicKeywords(userQuery);
  if (queryTopics.length === 0) return false;

  const convTopicNorm = conversationTopic.toLowerCase();
  for (const qt of queryTopics) {
    if (!convTopicNorm.includes(qt) && !qt.includes(convTopicNorm)) {
      return true;
    }
  }
  return false;
}

/**
 * Find the conversation topic from history
 */
function findConversationTopic(historyMessages) {
  if (!Array.isArray(historyMessages) || historyMessages.length < 1) return null;

  let dataIndicatorTopic = null;
  let serviceTopic = null;

  for (let i = historyMessages.length - 1; i >= 0; i--) {
    const m = historyMessages[i];
    if (!m) continue;

    // Skip greeting/template assistant messages — they mention example indicators
    // ("kemiskinan, pengangguran, inflasi, PDRB") which pollute topic detection
    const raw = String(m.content || '');
    if (m.role === 'assistant' && /"tier"\s*:\s*"GREETING"|"model"\s*:\s*"template"/i.test(raw)) {
      continue;
    }

    const content = m.role === 'assistant'
      ? stripMalikaUiBlock(raw)
      : raw;

    const topics = extractTopicKeywords(content);

    for (const t of topics) {
      const isServiceTopic = SERVICE_TOPIC_NAMES.has(t);

      if (isServiceTopic) {
        if (m.role === 'user' && !serviceTopic) {
          serviceTopic = t;
        }
      } else {
        if (!dataIndicatorTopic) {
          dataIndicatorTopic = t;
        }
      }
    }

    if (dataIndicatorTopic) {
      return dataIndicatorTopic;
    }
  }

  return serviceTopic || null;
}

/**
 * Normalize topic keyword for display
 */
function normalizeTopicForDisplay(topic) {
  const t = String(topic || '').trim().toLowerCase();
  if (!t) return '';

  if (TOPIC_DISPLAY_MAP[t]) return TOPIC_DISPLAY_MAP[t];
  return t.replace(/\b\w/g, c => c.toUpperCase());
}

// ============================================================================
// ACCUMULATED CONTEXT BUILDER
// ============================================================================

/**
 * Extract geo region from text (kabupaten/kota shorthand or full name)
 */
function extractGeoFromText(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  
  const geoMappings = [
    { patterns: ['haltim', 'halmahera timur'], canonical: 'Halmahera Timur' },
    { patterns: ['halsel', 'halmahera selatan'], canonical: 'Halmahera Selatan' },
    { patterns: ['halut', 'halmahera utara'], canonical: 'Halmahera Utara' },
    { patterns: ['halbar', 'halmahera barat'], canonical: 'Halmahera Barat' },
    { patterns: ['halteng', 'halmahera tengah'], canonical: 'Halmahera Tengah' },
    { patterns: ['kepsul', 'kepulauan sula'], canonical: 'Kepulauan Sula' },
    { patterns: ['tikep', 'tidore kepulauan', 'kota tidore'], canonical: 'Tidore Kepulauan' },
    { patterns: ['morotai', 'pulau morotai'], canonical: 'Pulau Morotai' },
    { patterns: ['taliabu', 'pulau taliabu'], canonical: 'Pulau Taliabu' },
    { patterns: ['ternate', 'kota ternate'], canonical: 'Kota Ternate' },
  ];
  
  for (const { patterns, canonical } of geoMappings) {
    for (const p of patterns) {
      if (t.includes(p)) return canonical;
    }
  }
  
  return null;
}

/**
 * Extract period range from text (e.g., "5 tahun terakhir", "2021-2025")
 */
function extractPeriodFromText(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  
  // "N tahun terakhir" pattern
  const relativeMatch = t.match(/(\d+)\s*tahun\s*terakhir/);
  if (relativeMatch) {
    const n = parseInt(relativeMatch[1], 10);
    const currentYear = new Date().getFullYear();
    return {
      type: 'relative',
      n,
      start: currentYear - n + 1,
      end: currentYear,
      label: `${n} tahun terakhir`,
    };
  }
  
  // Explicit year range "2021-2025"
  const rangeMatch = t.match(/\b(20\d{2})\s*[-–]\s*(20\d{2})\b/);
  if (rangeMatch) {
    return {
      type: 'range',
      start: parseInt(rangeMatch[1], 10),
      end: parseInt(rangeMatch[2], 10),
      label: `${rangeMatch[1]}-${rangeMatch[2]}`,
    };
  }
  
  // Single year "2024"
  const yearMatch = t.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    return {
      type: 'single',
      start: year,
      end: year,
      label: `${year}`,
    };
  }
  
  return null;
}

/**
 * Extract metric types from text (persentase, jumlah, indeks, etc.)
 */
function extractMetricsFromText(text) {
  if (!text) return [];
  const t = String(text).toLowerCase();
  const metrics = [];
  
  if (/\b(persentase|persen|%)\b/.test(t)) metrics.push('persentase');
  if (/\b(jumlah|angka|ribu|juta)\b/.test(t)) metrics.push('jumlah');
  if (/\b(indeks|index)\b/.test(t)) metrics.push('indeks');
  if (/\b(laju|pertumbuhan|growth)\b/.test(t)) metrics.push('laju');
  if (/\b(kedalaman|keparahan|severity|depth)\b/.test(t)) metrics.push('kedalaman');
  if (/\b(garis\s*kemiskinan)\b/.test(t)) metrics.push('garis kemiskinan');
  
  return metrics;
}

/**
 * Build accumulated context from conversation history
 * This is the KEY function that solves the context carryover problem
 * 
 * @param {Array} historyMessages - Array of chat messages
 * @param {Object} prevUiMeta - Previous assistant UI metadata
 * @returns {Object} Accumulated context with topic, period, geo, metrics
 */
function buildAccumulatedContext(historyMessages, prevUiMeta) {
  const context = {
    topic: null,           // Main data topic (e.g., "kemiskinan")
    period: null,          // Period info {start, end, label}
    geo: null,             // Geographic filter (e.g., "Halmahera Timur")
    metrics: [],           // Requested metrics (e.g., ["persentase", "jumlah"])
    datasourceId: null,    // Locked datasource ID
    lastQuery: null,       // Last full meaningful query
  };
  
  // 1. Extract from prevUiMeta (most reliable for period/datasource)
  if (prevUiMeta) {
    // Get datasource ID from candidates or table
    if (prevUiMeta.candidates?.[0]?.id) {
      context.datasourceId = prevUiMeta.candidates[0].id;
    }
    
    // Get period from table metadata
    if (prevUiMeta.table?.periodRange?.requested) {
      const req = prevUiMeta.table.periodRange.requested;
      context.period = {
        type: req.isSpecificYears ? 'specific' : 'range',
        start: req.start,
        end: req.end,
        label: `${req.start}-${req.end}`,
      };
    }
    
    // Get geo from table title
    if (prevUiMeta.table?.title) {
      const geo = extractGeoFromText(prevUiMeta.table.title);
      if (geo) context.geo = geo;
    }
  }
  
  // 2. Scan history for context accumulation (newest to oldest)
  if (Array.isArray(historyMessages)) {
    for (let i = historyMessages.length - 1; i >= 0; i--) {
      const m = historyMessages[i];
      if (!m) continue;
      
      const content = m.role === 'assistant'
        ? stripMalikaUiBlock(String(m.content || ''))
        : String(m.content || '');
      
      // Skip empty or greeting-only messages
      if (!content || content.length < 3) continue;
      if (isConfirmMessage(content)) continue;
      
      // Extract topic if not set
      if (!context.topic) {
        const topics = extractTopicKeywords(content);
        if (topics.length > 0) {
          context.topic = topics[0];
        }
      }
      
      // Extract period if not set from UI meta
      if (!context.period && m.role === 'user') {
        const period = extractPeriodFromText(content);
        if (period) context.period = period;
      }
      
      // Extract geo if not set
      if (!context.geo) {
        const geo = extractGeoFromText(content);
        if (geo) context.geo = geo;
      }
      
      // Extract metrics from user messages
      if (m.role === 'user') {
        const metrics = extractMetricsFromText(content);
        for (const metric of metrics) {
          if (!context.metrics.includes(metric)) {
            context.metrics.push(metric);
          }
        }
      }
      
      // Track last meaningful user query
      if (m.role === 'user' && !context.lastQuery) {
        if (!isConfirmMessage(content) && 
            !isLikelyTimeOrPeriodFragment(content) && 
            !isLikelyGeoOnlyFragment(content) &&
            content.length > 10) {
          context.lastQuery = content;
        }
      }
    }
  }
  
  return context;
}

/**
 * Build effective query from current input + accumulated context
 * This replaces the simple mergeQuery for context-aware scenarios
 * 
 * @param {string} currentQuery - Current user input
 * @param {Object} accContext - Accumulated context from buildAccumulatedContext
 * @returns {string} Effective query with full context
 */
function buildEffectiveQueryFromContext(currentQuery, accContext) {
  if (!accContext) return currentQuery;
  
  const query = String(currentQuery || '').trim();
  const parts = [];
  
  // Start with topic if query doesn't have it
  if (accContext.topic && !extractTopicKeywords(query).length) {
    parts.push(accContext.topic);
  }
  
  // Add current query (filtered)
  const filteredQuery = query
    .replace(/^(ya|iya|oke|ok|lanjut|boleh)\s*/i, '')
    .replace(/^\?+\s*/, '')
    .trim();
  
  if (filteredQuery && filteredQuery.length > 2) {
    parts.push(filteredQuery);
  }
  
  // Add geo if not in query
  if (accContext.geo && !extractGeoFromText(query)) {
    parts.push(accContext.geo);
  }
  
  // Add period if not in query
  if (accContext.period && !extractPeriodFromText(query)) {
    parts.push(accContext.period.label);
  }
  
  // Add metrics if asked
  if (accContext.metrics.length > 0) {
    const queryMetrics = extractMetricsFromText(query);
    for (const m of accContext.metrics) {
      if (!queryMetrics.includes(m) && !parts.some(p => p.toLowerCase().includes(m))) {
        // Only add if explicitly asked in this or previous turn
        // Skip for now to avoid over-specifying
      }
    }
  }
  
  const result = parts.join(' ').replace(/\s+/g, ' ').trim();
  
  // Log context building for debugging
  logger.debug({
    currentQuery: query.slice(0, 50),
    accTopic: accContext.topic,
    accGeo: accContext.geo,
    accPeriod: accContext.period?.label,
    result: result.slice(0, 80),
  }, '[AccumulatedContext] Built effective query');
  
  return result || query;
}

/**
 * Generate chat title from topics array
 */
function generateTitleFromTopics(topics, firstUserMessage = '') {
  if (!Array.isArray(topics) || topics.length === 0) {
    const msg = String(firstUserMessage || '').trim();
    if (!msg) return 'Chat baru';
    const capitalized = msg.charAt(0).toUpperCase() + msg.slice(1);
    if (capitalized.length <= 35) return capitalized;
    return capitalized.slice(0, 32) + '...';
  }

  const displayTopics = topics.map(normalizeTopicForDisplay).filter(Boolean);

  const uniqueTopics = [];
  const seen = new Set();
  for (const t of displayTopics) {
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueTopics.push(t);
    }
  }

  if (uniqueTopics.length === 0) return 'Chat baru';
  if (uniqueTopics.length === 1) return uniqueTopics[0];
  if (uniqueTopics.length === 2) {
    const title = `${uniqueTopics[0]}, ${uniqueTopics[1]}`;
    if (title.length <= 40) return title;
    return `${uniqueTopics[0]}, ${uniqueTopics[1].slice(0, 5)}...`;
  }

  let title = uniqueTopics.slice(0, 2).join(', ');
  if (title.length > 35) {
    title = uniqueTopics[0];
  }
  return title.length <= 37 ? `${title}...` : `${title.slice(0, 34)}...`;
}

/**
 * Update chat thread title based on detected topics
 */
async function updateThreadTitleIfNeeded(thread, userMessage) {
  try {
    const newTopics = extractTopicKeywords(userMessage);
    if (newTopics.length === 0) return false;

    let existingTopics = [];
    try {
      existingTopics = Array.isArray(thread.topics) ? thread.topics : JSON.parse(thread.topics || '[]');
    } catch {
      existingTopics = [];
    }

    const existingSet = new Set(existingTopics.map(t => t.toLowerCase()));
    const actuallyNewTopics = newTopics.filter(t => !existingSet.has(t.toLowerCase()));

    if (actuallyNewTopics.length === 0) return false;

    const mergedTopics = [...existingTopics, ...actuallyNewTopics];
    const newTitle = generateTitleFromTopics(mergedTopics, userMessage);

    await thread.update({
      topics: mergedTopics,
      title: newTitle,
      updated_at: new Date(),
    });

    return true;
  } catch (err) {
    logger.error({ error: err.message }, 'Failed to update thread title');
    return false;
  }
}

/**
 * Find the last meaningful user query from history
 */
function findLastMeaningfulUserQuery(historyMessages) {
  if (!Array.isArray(historyMessages) || historyMessages.length < 2) return '';

  for (let i = historyMessages.length - 2; i >= 0; i--) {
    const m = historyMessages[i];
    if (!m || m.role !== 'user') continue;

    const txt = stripMalikaUiBlock(String(m.content || '')).trim();
    if (!txt) continue;
    if (isConfirmMessage(txt)) continue;
    if (isLikelyTimeOrPeriodFragment(txt)) continue;
    if (isLikelyGeoOnlyFragment(txt)) continue;
    if (isShortFollowUp(txt)) continue;
    if (txt.replace(/\s+/g, ' ').trim().length < 5) continue;

    return txt.slice(0, 4000);
  }
  return '';
}

/**
 * Find the last assistant's UI meta with candidates
 */
function findLastAssistantUiMeta(historyMessages) {
  if (!Array.isArray(historyMessages) || historyMessages.length < 1) return null;

  for (let i = historyMessages.length - 1; i >= 0; i--) {
    const m = historyMessages[i];
    if (!m || m.role !== 'assistant') continue;

    const ui = parseUiMetaFromContent(m.content);
    if (ui && Array.isArray(ui.candidates) && ui.candidates.length > 0) {
      return ui;
    }
  }
  return null;
}

module.exports = {
  extractTopicKeywords,
  isNewTopicQuery,
  findConversationTopic,
  normalizeTopicForDisplay,
  generateTitleFromTopics,
  updateThreadTitleIfNeeded,
  findLastMeaningfulUserQuery,
  findLastAssistantUiMeta,
  // Accumulated context helpers
  extractGeoFromText,
  extractPeriodFromText,
  extractMetricsFromText,
  buildAccumulatedContext,
  buildEffectiveQueryFromContext,
};
