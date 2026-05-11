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
// Phase C 2026-05-11: embeddings flow through the migrated knowledgeDoc.service
// helpers, which write to retrieval_chunks via xenova multilingual-e5-base.
const { chunkText, processEmbeddings, MAX_CHUNK_SIZE, CHUNK_OVERLAP } = require('../ai/knowledgeDoc.service');
const { extractAllKeywords } = require('../ai/keywordExtractor.service');
const { extractIndicatorIndex } = require('../../../scripts/populate-indicator-index');

// ── Run-log capture ─────────────────────────────────────────────────────
// Rolling 1000-line buffer that persists across runs (and across PM2 reloads
// via app_settings). All info/warn/error calls go to pino AND this buffer.
// Buffer is hydrated from app_settings at first access and re-persisted at
// each sync-end (success or error). Old lines drop off the front when the cap
// is reached so we never accumulate beyond 1000.
const _baseLogger = require('../../utils/logger').child({ service: 'KnowledgeSync' });
let _runLogs = [];
let _hydrated = false;
const _MAX_LOG_LINES = 1000;

function _captureLogLine(level, args) {
  const ts = new Date().toISOString();
  let payload = null;
  let msg = '';
  if (args.length === 1) {
    msg = typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0]).slice(0, 300);
  } else if (args.length >= 2) {
    payload = args[0];
    msg = args[1];
  }
  const payloadStr = payload ? ' ' + JSON.stringify(payload).slice(0, 300) : '';
  _runLogs.push(`[${ts}] ${level.toUpperCase()}: ${msg}${payloadStr}`);
  if (_runLogs.length > _MAX_LOG_LINES) _runLogs.shift();
}

const logger = {
  info: (...args) => { _captureLogLine('info', args); _baseLogger.info(...args); },
  warn: (...args) => { _captureLogLine('warn', args); _baseLogger.warn(...args); },
  error: (...args) => { _captureLogLine('error', args); _baseLogger.error(...args); },
  debug: (...args) => _baseLogger.debug(...args),  // not captured (too noisy)
};

async function _hydrateRunLogsFromDb() {
  if (_hydrated) return;
  _hydrated = true;  // guard set BEFORE await so concurrent callers don't re-load
  try {
    const saved = await getJson(STATE_KEY);
    const persisted = saved?.persistedLogs;
    if (Array.isArray(persisted) && persisted.length > 0) {
      _runLogs = persisted.slice(-_MAX_LOG_LINES);
    }
  } catch {
    // best-effort; fresh buffer is acceptable
  }
}

async function _persistRunLogs() {
  try {
    const state = (await getJson(STATE_KEY)) || {};
    state.persistedLogs = _runLogs.slice(-_MAX_LOG_LINES);
    await setJson(STATE_KEY, state);
  } catch {
    // best-effort
  }
}

function _snapshotRunLogs() { return _runLogs.slice(); }

async function getCurrentRunLogs() {
  await _hydrateRunLogsFromDb();
  return _runLogs.slice();
}

function _pushSeparator(label) {
  _runLogs.push(`[${new Date().toISOString()}] ────── ${label} ──────`);
  if (_runLogs.length > _MAX_LOG_LINES) _runLogs.shift();
}

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
    // Build base content from abstract; augment with PDF if available.
    let content = `${doc.title}\n\n${doc.abstract || doc.description || ''}`;
    let indexMode = 'abstract';
    let pdfExtracted = false;

    if (pdfUrl && SYNC_CONFIG.INDEX_MODE.includes('pdf')) {
      try {
        const pdfResult = await extractTextFromUrl(pdfUrl, {
          timeout: SYNC_CONFIG.PDF_TIMEOUT_MS,
        });
        if (pdfResult && pdfResult.text && pdfResult.text.length > 100) {
          content = `${doc.title}\n\n${doc.abstract || doc.description || ''}\n\n--- PDF Content ---\n\n${pdfResult.text}`;
          indexMode = 'abstract+pdf';
          pdfExtracted = true;
          logger.info({ externalId, docType, pdfPages: pdfResult.pages, textLength: pdfResult.text.length }, 'PDF content extracted');
        }
      } catch (pdfErr) {
        logger.warn({ externalId, docType, error: pdfErr.message }, 'PDF extraction failed, using abstract only');
      }
    }

    // Year from release_date
    let year = null;
    const releaseDate = doc.release_date || doc.rl_date;
    if (releaseDate) {
      const match = String(releaseDate).match(/(\d{4})/);
      if (match) year = parseInt(match[1]);
    }

    // 1) Create parent KnowledgeBase row.
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

    // 2) Keywords (best-effort, parent only).
    try {
      const keywords = await extractAllKeywords(
        doc.title,
        doc.abstract || doc.description,
        content,
      );
      if (keywords) {
        await kbDoc.update({ keywords });
        logger.info({ externalId, docType, keywords: keywords.slice(0, 80) }, 'Keywords extracted');
      }
    } catch (kwErr) {
      logger.warn({ externalId, docType, error: kwErr.message }, 'Keyword extraction failed (non-fatal)');
    }

    // 3) Indicator index for large docs (TOC extraction).
    let indicatorEntries = 0;
    if (content.length > 10000) {
      try {
        const category = docType === 'brs' ? 'BRS' : 'Publikasi';
        const indicatorIndex = extractIndicatorIndex(content, category);
        if (indicatorIndex && indicatorIndex.length > 10) {
          await kbDoc.update({ indicator_index: indicatorIndex });
          indicatorEntries = indicatorIndex.split('\n').length;
          logger.info({ externalId, docType, entries: indicatorEntries }, 'Indicator index extracted');
        }
      } catch (idxErr) {
        logger.warn({ externalId, docType, error: idxErr.message }, 'Indicator index extraction failed (non-fatal)');
      }
    }

    // 4) Chunk the body and create child rows.
    const chunkIds = [];
    if (content.length > MAX_CHUNK_SIZE) {
      const chunks = chunkText(content, MAX_CHUNK_SIZE, CHUNK_OVERLAP);
      for (let i = 0; i < chunks.length; i++) {
        const child = await KnowledgeBase.create({
          title: `${doc.title} (${i + 1}/${chunks.length})`,
          category: kbDoc.category,
          source_type: 'text',
          source_url: pdfUrl,
          content: chunks[i],
          content_length: chunks[i].length,
          chunk_index: i,
          parent_id: kbDoc.id,
          status: 'pending',
        });
        chunkIds.push(child.id);
      }
    }

    // 5) Embed parent + chunks via xenova -> retrieval_chunks.
    await processEmbeddings([kbDoc.id, ...chunkIds]);

    // 6) Read back lifecycle status (processEmbeddings flips it).
    await kbDoc.reload();
    const embeddingSuccess = kbDoc.status === 'ready';

    // 7) Audit row in indexed_brs_publikasi.
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
      error_message: embeddingSuccess ? null : (kbDoc.error_message || 'Embedding failed'),
      created_at: new Date(),
      updated_at: new Date(),
    });

    logger.info({
      docType, externalId, title: doc.title?.slice(0, 50),
      indexMode, contentLength: content.length, pdfExtracted,
      embeddingSuccess, chunksCreated: chunkIds.length, indicatorEntries,
    }, 'Document indexed');

    return { success: embeddingSuccess, id: kbDoc.id, pdfExtracted, chunksCreated: chunkIds.length };
  } catch (error) {
    logger.error({ docType, externalId, error: error.message }, 'Failed to index document');
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
  
  // No vector cache to invalidate — unified retrieval (USE_UNIFIED_RETRIEVAL=true)
  // queries retrieval_chunks live. The legacy in-memory cache was retired in
  // Phase C 2026-05-09.
  let cacheInvalidated = false;
  if (brsStats.indexed > 0 || pubStats.indexed > 0) {
    // Refresh keyword index so new KB keywords are discoverable immediately.
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
 * Get sync statistics — merged with scheduler state for the admin UI.
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

  const scheduler = await getSchedulerState();

  return {
    indexed: {
      brs: brsCount[0]?.cnt || 0,
      publikasi: pubCount[0]?.cnt || 0,
    },
    knowledgeBase: kbCount,
    scheduler,
  };
}

// ── Scheduler state ─────────────────────────────────────────────────────
const { getJson, setJson } = require('../settings/appSettings.service');

const STATE_KEY = 'scheduler:knowledge-sync';
const DEFAULT_STATE = {
  enabled: true,
  hour: 6,
  minute: 0,
  lastRunAt: null,
  lastResult: null,
  history: [],
};

let _runningFlag = false;
let _nextRunAt = null;

async function loadState() {
  const saved = await getJson(STATE_KEY);
  return { ...DEFAULT_STATE, ...(saved || {}) };
}

async function saveState(state) {
  await setJson(STATE_KEY, state);
}

function isRunning() {
  return _runningFlag;
}

function getNextRunAt() {
  return _nextRunAt;
}

function _setNextRunAt(d) {
  _nextRunAt = d;
}

async function getSchedulerState() {
  const state = await loadState();
  await _hydrateRunLogsFromDb();  // populate _runLogs on first call after boot
  return {
    name: 'knowledge-sync',
    enabled: Boolean(state.enabled),
    schedule: `${String(state.hour).padStart(2, '0')}:${String(state.minute).padStart(2, '0')}`,
    running: _runningFlag,
    lastRunAt: state.lastRunAt,
    lastResult: state.lastResult,
    nextRunAt: _nextRunAt ? _nextRunAt.toISOString() : null,
    history: state.history || [],
    // Rolling 1000-line buffer covering ALL recent runs (newest last).
    // Persisted across PM2 reloads via app_settings.persistedLogs.
    currentRunLogs: _snapshotRunLogs(),
  };
}

async function updateSchedule({ enabled, hour, minute } = {}) {
  const state = await loadState();
  const next = { ...state };
  if (typeof enabled === 'boolean') next.enabled = enabled;
  if (Number.isFinite(hour) && hour >= 0 && hour <= 23) next.hour = Number(hour);
  if (Number.isFinite(minute) && minute >= 0 && minute <= 59) next.minute = Number(minute);
  await saveState(next);
  return next;
}

/**
 * Wrapper around runDailySync that updates persistent state.
 * Rejects (resolves with { skipped: true }) if another run is in flight.
 */
async function runDailySyncTracked() {
  if (_runningFlag) {
    return { skipped: true, reason: 'Already running' };
  }
  _runningFlag = true;
  // Hydrate the rolling buffer from DB if not yet loaded (first call after boot).
  await _hydrateRunLogsFromDb();
  _pushSeparator(`START sync (manual or scheduled)`);
  const startedAt = new Date();

  try {
    const result = await runDailySync();
    const state = await loadState();
    const finishedAt = new Date();
    _pushSeparator(`END sync OK · brs=${result.brs.indexed}/+${result.brs.errors}err · pub=${result.publikasi.indexed}/+${result.publikasi.errors}err · ${result.durationMs}ms`);

    const lastResult = {
      success: true,
      brs: { indexed: result.brs.indexed, errors: result.brs.errors },
      publikasi: { indexed: result.publikasi.indexed, errors: result.publikasi.errors },
      durationMs: result.durationMs,
      timestamp: finishedAt.toISOString(),
    };
    const newState = {
      ...state,
      lastRunAt: finishedAt.toISOString(),
      lastResult,
      history: [lastResult, ...(state.history || [])].slice(0, 5),
      persistedLogs: _runLogs.slice(-_MAX_LOG_LINES),
    };
    await saveState(newState);
    return result;
  } catch (e) {
    const state = await loadState();
    const finishedAt = new Date();
    _pushSeparator(`END sync FAILED · ${e?.message || String(e)}`);

    const lastResult = {
      success: false,
      error: e?.message || String(e),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      timestamp: finishedAt.toISOString(),
    };
    const newState = {
      ...state,
      lastRunAt: finishedAt.toISOString(),
      lastResult,
      history: [lastResult, ...(state.history || [])].slice(0, 5),
      persistedLogs: _runLogs.slice(-_MAX_LOG_LINES),
    };
    await saveState(newState);
    throw e;
  } finally {
    _runningFlag = false;
  }
}

module.exports = {
  runDailySync,
  runDailySyncTracked,
  syncBrs,
  syncPublikasi,
  isAlreadyIndexed,
  indexSingleDocument,
  getSyncStats,
  getSchedulerState,
  updateSchedule,
  isRunning,
  getNextRunAt,
  _setNextRunAt,
  getCurrentRunLogs,
  SYNC_CONFIG,
};
